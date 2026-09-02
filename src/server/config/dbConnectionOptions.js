// Shared PostgreSQL connection settings — reused by the app's default database
// connection (config/database.js), the platform control-plane connection, and
// every dynamically-created per-tenant connection (tenantDb.js), so all three
// stay on the same host/pool/dialect conventions instead of drifting apart.
const { Sequelize } = require('sequelize');

function connectionHost() {
  const rawHost = process.env.DB_HOST || '127.0.0.1';
  return rawHost === 'localhost' ? '127.0.0.1' : rawHost;
}

// Render (and most managed Postgres) require TLS, while a local container does
// not offer it — so SSL follows DB_SSL rather than being hardcoded either way.
function sslOptions() {
  const flag = String(process.env.DB_SSL || '').toLowerCase();
  if (flag === 'true' || flag === 'require') {
    return { ssl: { require: true, rejectUnauthorized: false } };
  }
  return {};
}

function buildSequelize(dbName, { logging, user: userOverride, password: passwordOverride } = {}) {
  const host = connectionHost();
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  // Overridable per-connection — needed on hosts (e.g. Hostinger shared
  // hosting) where each database is tied to its own dedicated MySQL user
  // with no cross-database grant available, so the platform (control-plane)
  // database can't always share the tenant DB's credentials.
  const user = userOverride || process.env.DB_USER;
  const pass = passwordOverride ?? (process.env.DB_PASSWORD || '');

  if (!dbName || !user) {
    throw new Error('DB_NAME (or an explicit dbName) and DB_USER must be set');
  }

  return new Sequelize(dbName, user, pass, {
    host,
    port,
    dialect: 'postgres',
    dialectOptions: {
      ...sslOptions()
    },
    // Matches config/database.js's max: 15 — that file's own history is exactly
    // why this can't stay small: it was raised from 5 after billing writes that
    // hold a connection for a row-locked transaction (see billingResolver.js)
    // exhausted a 5-connection pool under a handful of concurrent bill updates,
    // producing a ~30s stall (the pool's acquire timeout below) before failing.
    // That fix only ever landed on the default connection — every real tenant's
    // pharmacy/billing traffic goes through THIS pool instead, so it was still
    // sitting at the same too-small max:5 that caused the original incident.
    // The DB allows up to 151 connections, so 15 per active tenant leaves
    // headroom at the platform's current scale.
    pool: {
      max: 15,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    logging: logging ?? (process.env.NODE_ENV === 'development' ? console.log : false),
    timezone: '+00:00'
  });
}

module.exports = { buildSequelize, connectionHost };
