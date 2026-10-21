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
  const { backfillInventoryBranchIds, backfillBranchIds } = require('./utils/inventoryMaintenance');
  backfillInventoryBranchIds(sequelize, schema).catch(() => {});

  // Adds branch_id to LIS/Inpatient/Accounting/Procurement tables that don't
  // have it yet, then backfills any resulting NULLs the same safe way as
  // above (single-branch tenants only — see ensureBranchIsolationColumns.js
  // and backfillBranchIds for why). Chained, not parallel, since the backfill
  // needs the column to already exist.
  // Also widens services.service_name and the 6 real unique indexes across the
  // scheme/insurance tables to include branch_id (see ensureServiceNameUniqueness.js /
  // ensureSchemeUniqueness.js) — chained after the branch_id column itself exists, same
  // reasoning as the backfill.
  const { ensureBranchIsolationColumns, TABLES_NEEDING_BRANCH_ID } = require('./config/ensureBranchIsolationColumns');
  ensureBranchIsolationColumns(sequelize, schema)
    .then(() => {
      backfillBranchIds(sequelize, schema, TABLES_NEEDING_BRANCH_ID).catch(() => {});
      const { ensureServiceNameUniqueness } = require('./config/ensureServiceNameUniqueness');
      ensureServiceNameUniqueness(sequelize, schema).catch(() => {});
      const { ensureSchemeUniqueness } = require('./config/ensureSchemeUniqueness');
      ensureSchemeUniqueness(sequelize, schema).catch(() => {});
    })
    .catch(() => {});

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
    .then(() => {
      // Needs the roles table (and its system-role rows) to already exist — see
      // ensureUsersRoleForeignKey.js for why users.role's old hardcoded CHECK
      // constraint blocked ever assigning a custom role as someone's primary role.
      const { ensureUsersRoleForeignKey } = require('./config/ensureUsersRoleForeignKey');
      return ensureUsersRoleForeignKey(sequelize, schema);
    })
    .catch(() => {});

  // In-app notifications table, ensured per-tenant the same way.
  const { ensureNotificationsTable } = require('./config/ensureNotificationsTable');
  ensureNotificationsTable(sequelize).catch(() => {});

  // HR/payroll tables, ensured per-tenant the same way.
  const { ensureHRTables } = require('./config/ensureHRTables');
  ensureHRTables(sequelize).catch(() => {});

  // clinical_insights (Clinical Insights AI decision-support panel), ensured
  // per-tenant the same way.
  const { ensureClinicalInsightsTable } = require('./config/ensureClinicalInsightsTable');
  ensureClinicalInsightsTable(sequelize).catch(() => {});

  // patient_referrals (inter-branch patient referral workflow), ensured
  // per-tenant the same way.
  const { ensurePatientReferralsTable } = require('./config/ensurePatientReferralsTable');
  ensurePatientReferralsTable(sequelize).catch(() => {});

  // nursing_procedures (outpatient/triage log of injections, minor
  // procedures, dressings), ensured per-tenant the same way.
  const { ensureNursingProceduresTable } = require('./config/ensureNursingProceduresTable');
  ensureNursingProceduresTable(sequelize).catch(() => {});

  // antenatal_registrations/antenatal_visits (ANC care), ensured per-tenant
  // the same way.
  const { ensureAntenatalTables } = require('./config/ensureAntenatalTables');
  ensureAntenatalTables(sequelize).catch(() => {});

  // appointments (follow-up/next-visit scheduling), ensured per-tenant the
  // same way.
  const { ensureAppointmentsTable } = require('./config/ensureAppointmentsTable');
  ensureAppointmentsTable(sequelize).catch(() => {});

  // lis_test_orders.appointment_id (links a queued visit back to the
  // appointment it came from), ensured per-tenant the same way.
  const { ensureLisAppointmentLink } = require('./config/ensureLisAppointmentLink');
  ensureLisAppointmentLink(sequelize).catch(() => {});

  // lis_test_orders.consultant_id, ensured per-tenant the same way — lets a
  // visit be attributed to a consultant with no linked user account.
  const { ensureLisConsultantSupport } = require('./config/ensureLisConsultantSupport');
  ensureLisConsultantSupport(sequelize).catch(() => {});

  // Same for inpatient_admissions.consultant_id — lets an admission's
  // attending doctor be a consultant with no linked user account.
  const { ensureInpatientConsultantSupport } = require('./config/ensureInpatientConsultantSupport');
  ensureInpatientConsultantSupport(sequelize).catch(() => {});

  // lis_test_orders.queue_number + queue_number_counters (daily sequential
  // ticket numbers for the printable queue receipt), ensured per-tenant the
  // same way.
  const { ensureQueueNumberSupport } = require('./config/ensureQueueNumberSupport');
  ensureQueueNumberSupport(sequelize).catch(() => {});

  // facility_settings (queue receipt / billing-redirect toggles, patient
  // number prefix+suffix — Setup > Configurations), ensured per-tenant the
  // same way.
  const { ensureFacilitySettingsTable } = require('./config/ensureFacilitySettingsTable');
  ensureFacilitySettingsTable(sequelize).catch(() => {});

  // patient_number_counters (6-digit sequential patient numbers), ensured
  // per-tenant the same way.
  const { ensurePatientNumberCounterTable } = require('./config/ensurePatientNumberCounterTable');
  ensurePatientNumberCounterTable(sequelize).catch(() => {});

  // inventory_items.units_per_pack/dose_unit_label + fractional pack-quantity
  // columns (fixes dose-count vs. pack-count conflation at dispense time),
  // ensured per-tenant the same way.
  const { ensureInventoryPackSizeSupport } = require('./config/ensureInventoryPackSizeSupport');
  ensureInventoryPackSizeSupport(sequelize).catch(() => {});

  // inpatient_admissions.discharge_outcome (alive/dead/absconded), ensured
  // per-tenant the same way.
  const { ensureInpatientDischargeOutcome } = require('./config/ensureInpatientDischargeOutcome');
  ensureInpatientDischargeOutcome(sequelize).catch(() => {});

  // B5: widens receipts.status's CHECK constraint to allow pending_void/
  // pending_refund — see ensureReceiptPendingVoidStatus.js and receipts.js's
  // approval-gated void/refund flow.
  const { ensureReceiptPendingVoidStatus } = require('./config/ensureReceiptPendingVoidStatus');
  ensureReceiptPendingVoidStatus(sequelize).catch(() => {});

  // Database-level backstop against double-booking a bed — see
  // ensureInpatientBedUniqueness.js and the bed-claim comment in
  // routes/inpatient.js for why this didn't actually exist before.
  const { ensureInpatientBedUniqueness } = require('./config/ensureInpatientBedUniqueness');
  ensureInpatientBedUniqueness(sequelize).catch(() => {});

  // Widens inventory_items' and departments' item/department-code unique
  // constraints from clinic-wide to (…, branch_id) — see
  // ensureInventoryItemCodeUniqueness.js / ensureDepartmentCodeUniqueness.js
  // for why the clinic-only versions wrongly blocked two different branches
  // from ever sharing a code.
  const { ensureInventoryItemCodeUniqueness } = require('./config/ensureInventoryItemCodeUniqueness');
  ensureInventoryItemCodeUniqueness(sequelize, schema).catch(() => {});
  const { ensureDepartmentCodeUniqueness } = require('./config/ensureDepartmentCodeUniqueness');
  ensureDepartmentCodeUniqueness(sequelize, schema).catch(() => {});
  // Same fix for stock_locations' (clinic_id, location_code) constraint — see
  // ensureStockLocationUniqueness.js for why a "Pharmacy" storeroom needs its own
  // per-branch identity, not a single tenant-wide one.
  const { ensureStockLocationUniqueness } = require('./config/ensureStockLocationUniqueness');
  ensureStockLocationUniqueness(sequelize, schema).catch(() => {});

  // chatbot_conversations/chatbot_messages (Analytics Assistant chat
  // history), ensured per-tenant the same way.
  const { ensureChatbotTables } = require('./config/ensureChatbotTables');
  ensureChatbotTables(sequelize).catch(() => {});

  // The Analytics Assistant's dedicated read-only Postgres role (see
  // ensureAnalyticsReadOnlyRole.js) — grants it SELECT on this tenant's
  // schema, same per-tenant/fire-and-forget pattern as everything above. A
  // genuine no-op when DB_READONLY_PASSWORD isn't set (the feature is
  // entirely opt-in).
  const { grantReadOnlySelect } = require('./config/ensureAnalyticsReadOnlyRole');
  grantReadOnlySelect(sequelize, schema).catch(() => {});

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

// A second, SELECT-only connection pool for the Analytics Assistant (see
// ensureAnalyticsReadOnlyRole.js) — genuinely separate credentials/pool
// from getTenantConnection's full-access one, not the same connection with
// different query logic. Returns null whenever this layer isn't usable
// (DB_READONLY_PASSWORD unset, or this schema's grant hasn't landed yet) so
// every caller can fall back to the normal tenant connection unconditionally
// — this is a defense-in-depth addition, never a hard requirement for the
// assistant to work.
const readOnlyConnections = new Map(); // schema -> sequelize
const readOnlyPending = new Map();
const readOnlyFailures = new Map(); // schema -> ms timestamp of last failed attempt
const READONLY_RETRY_COOLDOWN_MS = 60 * 1000;

async function getReadOnlyTenantConnection(schemaName) {
  const { isConfigured, READONLY_ROLE } = require('./config/ensureAnalyticsReadOnlyRole');
  if (!isConfigured()) return null;
  const schema = assertValidSchema(schemaName);

  if (readOnlyConnections.has(schema)) return readOnlyConnections.get(schema);

  // Don't retry a schema whose role/grant isn't ready on every single
  // question — the grant is applied fire-and-forget elsewhere and, once it
  // lands, the next attempt after this cooldown picks it up.
  const lastFailure = readOnlyFailures.get(schema);
  if (lastFailure && Date.now() - lastFailure < READONLY_RETRY_COOLDOWN_MS) return null;

  if (!readOnlyPending.has(schema)) {
    readOnlyPending.set(schema, (async () => {
      const sequelize = buildSequelize(schema, {
        user: READONLY_ROLE,
        pass: process.env.DB_READONLY_PASSWORD,
        poolMax: parseInt(process.env.DB_READONLY_POOL_MAX || '3', 10),
      });
      // A real SELECT, not just authenticate() — proves the role's grants
      // have actually landed for this schema (grantReadOnlySelect runs
      // fire-and-forget and can still be in flight the first time a
      // schema's connection is built), not just that the credentials work.
      await sequelize.query('SELECT 1 FROM users LIMIT 1');
      return sequelize;
    })().finally(() => readOnlyPending.delete(schema)));
  }

  try {
    const sequelize = await readOnlyPending.get(schema);
    readOnlyConnections.set(schema, sequelize);
    readOnlyFailures.delete(schema);
    return sequelize;
  } catch {
    readOnlyFailures.set(schema, Date.now());
    return null;
  }
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
  const existingReadOnly = readOnlyConnections.get(schemaName);
  if (existingReadOnly) {
    existingReadOnly.close().catch(() => {});
    readOnlyConnections.delete(schemaName);
  }
  readOnlyFailures.delete(schemaName);
}

// Test-only cleanup: each Jest test FILE gets its own fresh module registry
// (even with maxWorkers: 1 — Jest resets modules per file regardless of
// worker reuse), so the `connections` Map above is created fresh per file and
// its pool is never closed by anything else. Left alone, a pool only drains
// itself via the idle timeout (10s — see dbConnectionOptions.js), and with
// 60+ test files running in one process, many files' pools are still within
// that 10s window when later files open their OWN pools, so open connections
// accumulate across the whole run far faster than they're reaped —
// eventually exceeding Postgres's max_connections well before the suite
// finishes. Wired into every test file via tests/setup/closeTenantConnections.js
// (see jest.config.cjs's setupFilesAfterEnv) so each file's connection(s) are
// released the moment that file's own tests finish, not up to 10s later.
async function closeAllConnections() {
  const closing = [
    ...Array.from(connections.values()).map((c) => c.sequelize.close().catch(() => {})),
    ...Array.from(readOnlyConnections.values()).map((s) => s.close().catch(() => {})),
  ];
  connections.clear();
  readOnlyConnections.clear();
  readOnlyFailures.clear();
  await Promise.all(closing);
}

module.exports = { getTenantConnection, getReadOnlyTenantConnection, evictTenantConnection, closeAllConnections };
