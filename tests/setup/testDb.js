const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
const path = require('path');

// .env.test (dedicated, gitignored) — NOT the project-root .env, which is a Docker-
// oriented config for a different, near-empty database. See .env.test.
//
// Since the MySQL -> PostgreSQL migration this connects to the `tenant_test`
// SCHEMA of the app's database. Isolation is by search_path, exactly as the app
// does it for real tenants, so the suite can never read or write a tenant's rows.
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

let sequelize = null;

/**
 * Get or create a Sequelize connection for testing.
 * Uses a schema-identical clone of the app's real database (intellicare_test),
 * never the live one — see .env.test.
 */
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(TEST_SCHEMA)) {
  throw new Error(`Unsafe DB_SCHEMA for tests: ${TEST_SCHEMA}`);
}

function getSequelize() {
  if (!sequelize) {
    sequelize = new Sequelize(
      process.env.DB_NAME || 'intellicareoff',
      process.env.DB_USER || 'intellicare',
      process.env.DB_PASSWORD || '',
      {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false,
        ...(String(process.env.DB_SSL).toLowerCase() === 'true'
          ? { dialectOptions: { ssl: { rejectUnauthorized: false } } }
          : {}),
        // Pin the schema on every pooled connection, the same way the app does
        // for a tenant. Without this a test would silently read `public`.
        hooks: {
          async afterConnect(connection) {
            await connection.query(`SET search_path TO "${TEST_SCHEMA}"`);
          },
        },
        pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
      }
    );
  }
  return sequelize;
}

/**
 * Raw query helper – returns rows only.
 */
async function query(sql, replacements = {}) {
  const db = getSequelize();
  const [rows] = await db.query(sql, { replacements });
  return rows;
}

/**
 * Run a single-value scalar query.
 */
async function scalar(sql, replacements = {}) {
  const rows = await query(sql, replacements);
  if (!rows.length) return null;
  return Object.values(rows[0])[0];
}

/**
 * Check if a table exists.
 */
async function tableExists(tableName) {
  const rows = await query(
    `SELECT 1 FROM pg_tables WHERE schemaname = :s AND tablename = :t`,
    { s: TEST_SCHEMA, t: tableName }
  );
  return rows.length > 0;
}

/**
 * Check if a column exists on a table.
 */
async function columnExists(tableName, columnName) {
  const rows = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = :s AND table_name = :t AND column_name = :c`,
    { s: TEST_SCHEMA, t: tableName, c: columnName }
  );
  return rows.length > 0;
}

/**
 * Get all column names for a table.
 */
async function getColumns(tableName) {
  const rows = await query(
    `SELECT column_name AS "COLUMN_NAME", data_type AS "DATA_TYPE",
            is_nullable AS "IS_NULLABLE", column_default AS "COLUMN_DEFAULT"
     FROM information_schema.columns
     WHERE table_schema = :s AND table_name = :t
     ORDER BY ordinal_position`,
    { s: TEST_SCHEMA, t: tableName }
  );
  return rows;
}

/**
 * Get all indexes on a table.
 */
async function getIndexes(tableName) {
  return query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = :s AND tablename = :t`,
    { s: TEST_SCHEMA, t: tableName }
  );
}

/**
 * Get row count for a table.
 */
async function rowCount(tableName) {
  return scalar(`SELECT COUNT(*)::int FROM "${tableName}"`);
}

/**
 * Close connection pool.
 */
async function closeConnection() {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
  }
}

/**
 * Generate a UUID v4 (simple version without external dep in test context).
 */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Timing helper – returns [result, elapsedMs].
 */
async function timed(fn) {
  const start = Date.now();
  const result = await fn();
  return [result, Date.now() - start];
}

module.exports = {
  TEST_SCHEMA,
  getSequelize,
  query,
  scalar,
  tableExists,
  columnExists,
  getColumns,
  getIndexes,
  rowCount,
  closeConnection,
  uuid,
  timed,
};
