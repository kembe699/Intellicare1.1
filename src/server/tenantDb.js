// Caches one real Sequelize connection (+ its bound model set) per tenant
// database, keyed by db_name. Built lazily on first use and reused after that —
// a hospital that's actively being used doesn't pay a fresh-connection cost on
// every request, but one that's never logged in today never opens a pool either.
const { buildSequelize } = require('./config/dbConnectionOptions');
const { createModels } = require('./models');

const connections = new Map(); // dbName -> { sequelize, models }
const pending = new Map(); // dbName -> in-flight build Promise, to de-dupe concurrent first-requests

const CREDENTIAL_LOOKUP_ATTEMPTS = 3;
const CREDENTIAL_RETRY_BASE_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reads this client's own DB credentials from the platform database.
// Resolves to { user, password } — either may be undefined, which legitimately
// means "this host shares one MySQL user across every database" (local dev, a
// VPS) and the caller should fall back to DB_USER/DB_PASSWORD.
//
// Throws if the platform database itself couldn't be reached. That case must
// NOT be confused with "no per-tenant credentials configured" — see
// buildTenantConnection for why conflating the two caused a recurring outage.
async function lookupTenantCredentials(dbName) {
  // Required lazily (not at module top level) so a missing PLATFORM_DB_NAME
  // can't crash the app before it even starts listening — same reasoning as
  // the lazy require in index.js's own platform-DB boot step.
  const { Client } = require('./models/platform');
  let lastErr;
  for (let attempt = 1; attempt <= CREDENTIAL_LOOKUP_ATTEMPTS; attempt++) {
    try {
      const client = await Client.findOne({ where: { db_name: dbName }, attributes: ['db_user', 'db_password'] });
      return {
        user: client?.db_user || undefined,
        password: client?.db_password ?? undefined,
      };
    } catch (err) {
      lastErr = err;
      // A pooled connection dropped server-side (the app sitting idle
      // overnight is enough to get one reaped) fails the first query and
      // succeeds on the next, so a blip shouldn't cost the tenant anything.
      if (attempt < CREDENTIAL_LOOKUP_ATTEMPTS) await sleep(CREDENTIAL_RETRY_BASE_MS * attempt);
    }
  }
  throw lastErr;
}

async function buildTenantConnection(dbName) {
  // Per-tenant credentials, if this client has its own dedicated DB user —
  // required on hosts (e.g. Hostinger shared hosting) where every database
  // has its own user with no cross-database grant available, so the app's
  // main DB_USER can't reach a tenant's database at all.
  //
  // A failure here used to be swallowed, silently falling back to the shared
  // DB_USER — which on such a host can never reach the tenant's database.
  // Because Sequelize connects lazily, that unusable connection still "built"
  // fine and got cached below for the life of the process, so one momentary
  // platform-DB blip took a whole tenant offline until someone restarted Node
  // by hand. It now propagates instead: the request fails (login and the auth
  // middleware both answer with a retryable 503), nothing is cached, and the
  // next attempt rebuilds from scratch.
  const { user: dbUser, password: dbPassword } = await lookupTenantCredentials(dbName);

  const sequelize = buildSequelize(dbName, { user: dbUser, password: dbPassword });

  // Connect eagerly. Sequelize is lazy by default, so a connection built with
  // unusable credentials is indistinguishable from a good one until the first
  // real query — by which point getTenantConnection has already cached it.
  try {
    await sequelize.authenticate();
  } catch (err) {
    await sequelize.close().catch(() => {});
    throw err;
  }

  const models = createModels(sequelize);

  // Repairs that used to run only once, at boot, against the single default
  // database (see routes/inventory.js) — before multi-tenancy existed that WAS
  // every database there was. Run once per tenant here instead, the first time
  // each tenant's connection is actually built (this function only runs once per
  // dbName per process, since getTenantConnection caches the result), so every
  // tenant gets the same cleanup the original default database always got.
  // Non-blocking: a repair failure must never prevent a tenant from logging in.
  const { backfillInventoryBranchIds } = require('./utils/inventoryMaintenance');
  backfillInventoryBranchIds(sequelize, dbName).catch(() => {});

  return { sequelize, models };
}

async function getTenantConnection(dbName) {
  if (!dbName) throw new Error('getTenantConnection requires a dbName');

  if (connections.has(dbName)) return connections.get(dbName);

  if (!pending.has(dbName)) {
    pending.set(dbName, buildTenantConnection(dbName).finally(() => pending.delete(dbName)));
  }
  const connection = await pending.get(dbName);
  connections.set(dbName, connection);
  return connection;
}

// Used after provisioning a brand-new tenant database elsewhere in the same
// process (rare in practice — provisioning runs the schema bootstrap in its
// own child process, see scripts/provisionTenant.js) to make sure a stale,
// pre-provisioning connection (e.g. one opened by a failed earlier attempt at
// the same db_name) is never reused.
function evictTenantConnection(dbName) {
  const existing = connections.get(dbName);
  if (existing) {
    existing.sequelize.close().catch(() => {});
    connections.delete(dbName);
  }
}

module.exports = { getTenantConnection, evictTenantConnection };
