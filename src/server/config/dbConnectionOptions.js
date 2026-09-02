// Shared PostgreSQL connection settings.
//
// Every connection in this app — the control plane and every tenant — points at
// ONE database and is separated by PostgreSQL schema, not by database. A tenant
// is a schema; the control plane (clients, plans, invoices) lives in `public`.
//
// This is what makes the app deployable on managed Postgres (Render, Supabase,
// Neon): those give you a single database and a role that cannot CREATE
// DATABASE, so the previous database-per-tenant design could never provision a
// new client there. Creating a schema needs no special privilege.
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

// Schema names are interpolated into SET search_path (they cannot be bound as
// parameters), so they are validated at every boundary rather than trusted.
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;

function assertValidSchema(schema) {
  if (!SCHEMA_RE.test(String(schema || ''))) {
    throw new Error(`Invalid schema name: ${JSON.stringify(schema)}`);
  }
  return schema;
}

/**
 * A Sequelize connection scoped to one schema.
 *
 * search_path is set in an afterConnect hook rather than per query, so every
 * connection this pool hands out is already scoped — which means models and
 * raw sequelize.query() calls both land in the right schema with no call-site
 * changes. `public` stays on the path so shared extensions still resolve.
 */
function buildSequelize(schemaName, { logging } = {}) {
  const schema = assertValidSchema(schemaName);
  const host = connectionHost();
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const pass = process.env.DB_PASSWORD || '';

  if (!database || !user) {
    throw new Error('DB_NAME and DB_USER must be set');
  }

  return new Sequelize(database, user, pass, {
    host,
    port,
    dialect: 'postgres',
    dialectOptions: {
      ...sslOptions(),
    },
    hooks: {
      async afterConnect(connection) {
        await connection.query(`SET search_path TO "${schema}", public`);
      },
    },
    // Every tenant now shares one database, so the per-tenant pools add up
    // against a single connection limit. Managed Postgres starter plans allow
    // far fewer connections than the old self-hosted server did, so this is
    // deliberately smaller than the previous 15 and tunable per environment.
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '5', 10),
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    logging: logging ?? (process.env.NODE_ENV === 'development' ? console.log : false),
    timezone: '+00:00',
  });
}

module.exports = { buildSequelize, connectionHost, assertValidSchema, SCHEMA_RE };
