// Control-plane database — holds only the SaaS layer (clients, platform admins,
// subscription plans, invoices). Never holds any hospital/tenant data; every
// tenant's actual hospital data lives in its own separate database, created and
// connected to dynamically via tenantDb.js.
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: true });
try {
  if (os.userInfo().username !== 'levi96') {
    require('dotenv').config({ path: path.resolve(__dirname, '../production.env'), override: true });
  }
} catch (e) {
  require('dotenv').config({ path: path.resolve(__dirname, '../production.env'), override: true });
}

const { buildSequelize } = require('./dbConnectionOptions');

const platformDbName = process.env.PLATFORM_DB_NAME;
if (!platformDbName) {
  console.error('❌ CRITICAL: PLATFORM_DB_NAME must be set');
  process.exit(1);
}

// Optional dedicated credentials — needed on hosts (e.g. Hostinger shared
// hosting) where each database is tied to its own MySQL user with no
// cross-database grant available in the panel, so the tenant DB's user
// can't always also read/write the platform database. Falls back to the
// shared DB_USER/DB_PASSWORD when unset, so nothing changes for hosts
// (like local dev) where one user already has access to everything.
const platformDbUser = process.env.PLATFORM_DB_USER;
const platformDbPassword = process.env.PLATFORM_DB_PASSWORD;

console.log(`🔌 Initializing platform (control-plane) MySQL connection → ${platformDbName}${platformDbUser ? ` (as ${platformDbUser})` : ''}`);
const platformSequelize = buildSequelize(platformDbName, {
  user: platformDbUser,
  password: platformDbPassword,
});

module.exports = platformSequelize;
