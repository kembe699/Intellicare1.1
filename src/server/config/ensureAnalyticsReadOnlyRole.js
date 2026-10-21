/**
 * A dedicated, cluster-wide, SELECT-only Postgres role for the Analytics
 * Assistant chatbot — a second, independent layer of defense alongside the
 * application-level permission checks already in llmTools.js/
 * analyticsFunctions.js. Even if those checks were ever bypassed (a bug, a
 * future code path that forgets to call hasPrivilege), a connection opened
 * as this role still cannot INSERT/UPDATE/DELETE or run DDL — only SELECT.
 *
 * Opt-in: entirely gated on DB_READONLY_PASSWORD being set. If it isn't,
 * both functions below no-op (role never created, nothing granted) and the
 * chatbot keeps using the normal tenant connection exactly as before —
 * this feature is additive and never required for the assistant to work.
 *
 * Same shape as every other ensureXxx.js file (idempotent, safe to call
 * repeatedly, safe to call per-tenant — see tenantDb.js's
 * buildTenantConnection), with one addition specific to a role being a
 * CLUSTER-WIDE object rather than a per-schema one: ensureReadOnlyRole only
 * needs to actually run once per process lifetime (tracked in-memory
 * below), while grantReadOnlySelect is genuinely per-tenant-schema, same as
 * any other ensureXxx call.
 */
const READONLY_ROLE = 'intellicare_analytics_readonly';

function readOnlyPassword() {
  return process.env.DB_READONLY_PASSWORD || '';
}

// Single quotes are the only character that needs escaping inside a SQL
// string literal (doubled, the standard SQL escape) — this password only
// ever comes from an operator-set env var, never user input, but it's
// escaped anyway since it's being interpolated into DDL that can't use
// Sequelize's normal bound-replacement placeholders.
function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

let roleEnsured = false;

/**
 * Creates the read-only role cluster-wide, if it doesn't already exist.
 * Idempotent and safe to call from multiple tenant connections concurrently
 * at boot — the in-memory flag just avoids redundant round trips after the
 * first successful call in this process; the SQL itself is also safe to
 * run more than once (checked via pg_roles before CREATE ROLE).
 */
async function ensureReadOnlyRole(sequelize) {
  if (roleEnsured) return;
  const password = readOnlyPassword();
  if (!password) return; // feature not configured — no-op by design, see header comment

  await sequelize.query(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${READONLY_ROLE}') THEN
        CREATE ROLE ${READONLY_ROLE} WITH LOGIN PASSWORD '${escapeSqlLiteral(password)}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 10;
      ELSE
        ALTER ROLE ${READONLY_ROLE} WITH LOGIN PASSWORD '${escapeSqlLiteral(password)}';
      END IF;
    END
    $do$;
  `);
  roleEnsured = true;
}

/**
 * Grants the read-only role SELECT on every table in one tenant schema,
 * plus USAGE on the schema itself (required before SELECT means anything)
 * and a default-privileges rule so tables created AFTER this runs (by a
 * later ensureXxx migration, for instance) are automatically covered too —
 * without it, only tables that already existed at grant time would be
 * readable, silently breaking the assistant against any new table added
 * down the line. Broad SELECT (not a hand-curated per-table allowlist) is
 * the deliberate choice: the role can never write regardless of which
 * tables it can read, and analyticsFunctions.js already grows new queries
 * across many tables as the assistant's coverage expands — a table
 * allowlist here would need updating in lockstep with every new tool.
 */
async function grantReadOnlySelect(sequelize, schema) {
  if (!readOnlyPassword()) return; // feature not configured — no-op by design
  await ensureReadOnlyRole(sequelize);
  await sequelize.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${READONLY_ROLE}`);
  await sequelize.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${READONLY_ROLE}`);
  await sequelize.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT SELECT ON TABLES TO ${READONLY_ROLE}`);
}

module.exports = { READONLY_ROLE, ensureReadOnlyRole, grantReadOnlySelect, isConfigured: () => Boolean(readOnlyPassword()) };
