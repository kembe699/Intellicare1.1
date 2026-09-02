const path = require('path');
const os = require('os');
// override: true ensures OUR .env wins over Hostinger's panel env vars
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: true });

try {
  if (os.userInfo().username !== 'levi96') {
    require('dotenv').config({ path: path.resolve(__dirname, '../production.env'), override: true });
  }
} catch (e) {
  // Fallback in case os.userInfo() fails in restricted environments
  require('dotenv').config({ path: path.resolve(__dirname, '../production.env'), override: true });
}


const { Sequelize } = require('sequelize');

const rawHost = process.env.DB_HOST || '127.0.0.1';
const host = rawHost === 'localhost' ? '127.0.0.1' : rawHost;
const port = parseInt(process.env.DB_PORT || '5432', 10);
const db   = process.env.DB_NAME;
const user = process.env.DB_USER;
const pass = process.env.DB_PASSWORD || '';

if (!db || !user) {
  console.error('❌ CRITICAL: DB_NAME and DB_USER must be set');
  process.exit(1);
}

console.log(`🔌 Initializing PostgreSQL connection → ${user}@${host}:${port}/${db}`);

const sequelize = new Sequelize(db, user, pass, {
  host,
  port,
  dialect: 'postgres',
  dialectOptions: {
    // Managed Postgres (Render) terminates TLS; a local container doesn't offer
    // it, so this follows DB_SSL instead of being hardcoded either way.
    ...(['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase())
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {}),
  },
  // max: 5 was too small once billing writes started holding a connection for the
  // duration of a row-locked transaction (see billingResolver.js) instead of a single
  // auto-committed query — a handful of concurrent writes to the same bill could exhaust
  // the pool and fail with a connection-acquire timeout instead of just waiting briefly
  // for the row lock. The DB itself allows up to 151 connections; 15 leaves generous
  // headroom for this single app process while fixing the observed contention.
  pool: {
    max: 15,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  timezone: '+00:00'
});

(async () => {
  try {
    await sequelize.authenticate();
    const [[row]] = await sequelize.query('SELECT current_user AS user, current_database() AS database_name;');
    console.log(`✅ PostgreSQL connection successful | Connected as: ${row.user} | DB: ${row.database_name}`);
  } catch (error) {
    console.error(`❌ PostgreSQL connection failed:`, error.message);
    console.error(`💡 DB_HOST=${host} | DB_USER=${user} | DB_NAME=${db}`);
  }
})();

module.exports = sequelize;
