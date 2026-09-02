const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
const path = require('path');

// .env.test (dedicated, gitignored) — NOT the project-root .env, which is a Docker-
// oriented config for a different, near-empty database (intellicare_hmis) than the one
// the app actually runs against. Tests were silently running against that stale/empty
// database for who knows how long, which is why ~30 tests failed on "missing" columns
// the real app's database has always had. See .env.test for the full explanation.
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

let sequelize = null;

/**
 * Get or create a Sequelize connection for testing.
 * Uses a schema-identical clone of the app's real database (intellicare_test),
 * never the live one — see .env.test.
 */
function getSequelize() {
  if (!sequelize) {
    sequelize = new Sequelize(
      process.env.DB_NAME || 'intellicare_test',
      process.env.DB_USER || 'root',
      process.env.DB_PASSWORD || '',
      {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 3306,
        dialect: 'mysql',
        logging: false,
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
  const rows = await query(`SHOW TABLES LIKE :t`, { t: tableName });
  return rows.length > 0;
}

/**
 * Check if a column exists on a table.
 */
async function columnExists(tableName, columnName) {
  const rows = await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
    { t: tableName, c: columnName }
  );
  return rows.length > 0;
}

/**
 * Get all column names for a table.
 */
async function getColumns(tableName) {
  const rows = await query(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t
     ORDER BY ORDINAL_POSITION`,
    { t: tableName }
  );
  return rows;
}

/**
 * Get all indexes on a table.
 */
async function getIndexes(tableName) {
  return query(`SHOW INDEX FROM \`${tableName}\``);
}

/**
 * Get row count for a table.
 */
async function rowCount(tableName) {
  return scalar(`SELECT COUNT(*) FROM \`${tableName}\``);
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
