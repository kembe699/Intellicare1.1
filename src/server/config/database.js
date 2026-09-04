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


const { buildSequelize } = require('./dbConnectionOptions');

// The default (non-request-scoped) connection.
//
// Every real request runs inside a tenant context and uses that tenant's own
// schema-scoped connection (see tenantDb.js). This one is what boot-time
// migrations and standalone scripts fall back to, so it points at the tenant
// TEMPLATE schema: schema changes made at boot land in the template, and every
// tenant provisioned afterwards inherits them. It deliberately does NOT point
// at `public`, which holds only the control plane (clients, plans, invoices).
const defaultSchema = process.env.DEFAULT_SCHEMA || process.env.TENANT_TEMPLATE_SCHEMA || 'tenant_template';

console.log(`🔌 Initializing PostgreSQL connection → schema "${defaultSchema}"`);

const sequelize = buildSequelize(defaultSchema);

(async () => {
  try {
    await sequelize.authenticate();
    const [[row]] = await sequelize.query('SELECT current_user AS user, current_database() AS database_name, current_schema() AS schema;');
    console.log(`✅ PostgreSQL connection successful | ${row.user}@${row.database_name} | schema: ${row.schema}`);
  } catch (error) {
    console.error(`❌ PostgreSQL connection failed:`, error.message);
    // Read straight from the environment: host/user/db were never in scope
    // here, so this line used to throw a ReferenceError and replace the
    // connection diagnostic with a stack trace about the diagnostic itself.
    console.error(`💡 DB_HOST=${process.env.DB_HOST} | DB_USER=${process.env.DB_USER} | DB_NAME=${process.env.DB_NAME} | schema: ${defaultSchema}`);
  }
})();

module.exports = sequelize;
