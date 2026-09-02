// Control-plane connection — clients, platform admins, subscription plans and
// invoices. It lives in the `public` schema of the SAME database every tenant
// uses; each tenant's hospital data is isolated in its own schema (see
// tenantDb.js). Nothing here ever reads tenant data.
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

// PLATFORM_SCHEMA exists only as an escape hatch; `public` is the default and
// what the deploy docs assume. There is no separate platform *database* any
// more — a managed Postgres instance gives you exactly one.
const platformSchema = process.env.PLATFORM_SCHEMA || 'public';

console.log(`🔌 Initializing platform (control-plane) connection → schema "${platformSchema}"`);
const platformSequelize = buildSequelize(platformSchema);

module.exports = platformSequelize;
