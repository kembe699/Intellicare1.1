// Caches one Sequelize connection (+ its bound model set) per tenant SCHEMA.
// Built lazily on first use and reused after that — a hospital that's actively
// being used doesn't pay a fresh-connection cost on every request, but one
// nobody logs into today never opens a pool either.
//
// Every tenant shares the same database and is isolated by schema: the
// connection's search_path is pinned in an afterConnect hook, so models and raw
// queries alike land inside that tenant's schema and cannot see another's.
const { buildSequelize, assertValidSchema } = require('./config/dbConnectionOptions');
const { createModels } = require('./models');

const connections = new Map(); // schema -> { sequelize, models }
const pending = new Map(); // schema -> in-flight build Promise, to de-dupe concurrent first-requests

async function buildTenantConnection(schemaName) {
  const schema = assertValidSchema(schemaName);
  const sequelize = buildSequelize(schema);

  // Connect eagerly. Sequelize is lazy by default, so a connection pointed at a
  // schema that doesn't exist is indistinguishable from a good one until the
  // first real query — by which point getTenantConnection has already cached it.
  try {
    await sequelize.authenticate();
    const [[row]] = await sequelize.query('SELECT current_schema() AS schema');
    if (!row || row.schema !== schema) {
      throw new Error(`search_path did not resolve to "${schema}" (got ${row && row.schema}) — schema missing?`);
    }
  } catch (err) {
    await sequelize.close().catch(() => {});
    throw err;
  }

  const models = createModels(sequelize);

  // Repairs that used to run only once, at boot, against the single default
  // database (see routes/inventory.js). Run once per tenant here instead, the
  // first time each tenant's connection is actually built, so every tenant gets
  // the same cleanup the original default database always got.
  // Non-blocking: a repair failure must never prevent a tenant from logging in.
  const { backfillInventoryBranchIds } = require('./utils/inventoryMaintenance');
  backfillInventoryBranchIds(sequelize, schema).catch(() => {});

  // roles/privileges/role_privileges tables, ensured per-tenant. The old
  // boot-time IIFE in routes/roles.js only ever ran against the single
  // default connection, never a real tenant schema — this is the actual
  // per-tenant equivalent. Non-blocking for the same reason — but chained
  // (not fired in parallel) into the catalog seed below, which queries
  // these same tables and would fail outright on a brand new tenant where
  // they don't exist until this create step actually finishes.
  const { ensureRolesTables } = require('./config/ensureRolesTables');
  const { ensurePrivilegesCatalog } = require('./config/ensurePrivilegesCatalog');
  ensureRolesTables(sequelize)
    .then(() => ensurePrivilegesCatalog(sequelize))
    .catch(() => {});

  // In-app notifications table, ensured per-tenant the same way.
  const { ensureNotificationsTable } = require('./config/ensureNotificationsTable');
  ensureNotificationsTable(sequelize).catch(() => {});

  // HR/payroll tables, ensured per-tenant the same way.
  const { ensureHRTables } = require('./config/ensureHRTables');
  ensureHRTables(sequelize).catch(() => {});

  // lis_test_orders.consultant_id, ensured per-tenant the same way — lets a
  // visit be attributed to a consultant with no linked user account.
  const { ensureLisConsultantSupport } = require('./config/ensureLisConsultantSupport');
  ensureLisConsultantSupport(sequelize).catch(() => {});

  // Same for inpatient_admissions.consultant_id — lets an admission's
  // attending doctor be a consultant with no linked user account.
  const { ensureInpatientConsultantSupport } = require('./config/ensureInpatientConsultantSupport');
  ensureInpatientConsultantSupport(sequelize).catch(() => {});

  // Database-level backstop against double-booking a bed — see
  // ensureInpatientBedUniqueness.js and the bed-claim comment in
  // routes/inpatient.js for why this didn't actually exist before.
  const { ensureInpatientBedUniqueness } = require('./config/ensureInpatientBedUniqueness');
  ensureInpatientBedUniqueness(sequelize).catch(() => {});

  return { sequelize, models };
}

async function getTenantConnection(schemaName) {
  if (!schemaName) throw new Error('getTenantConnection requires a schema name');

  if (connections.has(schemaName)) return connections.get(schemaName);

  if (!pending.has(schemaName)) {
    pending.set(schemaName, buildTenantConnection(schemaName).finally(() => pending.delete(schemaName)));
  }
  const connection = await pending.get(schemaName);
  connections.set(schemaName, connection);
  return connection;
}

// Used after provisioning (or dropping) a tenant schema in the same process, so
// a stale connection — e.g. one opened by a failed earlier attempt at the same
// name — is never reused.
function evictTenantConnection(schemaName) {
  const existing = connections.get(schemaName);
  if (existing) {
    existing.sequelize.close().catch(() => {});
    connections.delete(schemaName);
  }
}

module.exports = { getTenantConnection, evictTenantConnection };
