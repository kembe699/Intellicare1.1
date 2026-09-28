// Runs a single-tenant migration function against EVERY tenant schema, not
// just the default/tenant_template connection runBackgroundMigrations()
// touches at boot. Generic and reusable — not specific to any one module —
// so a future module's migration can loop over every real tenant the same
// way instead of someone hand-running psql per schema, which is what the
// Radiology module had to do earlier.
//
// Outside a request/boot context there's no AsyncLocalStorage tenant to
// resolve (see tenantContext.js), so this goes straight to tenantDb.js's
// getTenantConnection() for each schema by name, exactly like
// middleware/auth.js does per-request.
async function migrateAcrossTenants(migrationFn, label) {
  const { Client } = require('../models/platform');
  const { getTenantConnection } = require('../tenantDb');

  const clients = await Client.findAll({ attributes: ['schema_name'] });
  const schemas = Array.from(new Set(['tenant_template', ...clients.map((c) => c.schema_name)]));

  const results = [];
  for (const schema of schemas) {
    try {
      const { sequelize } = await getTenantConnection(schema);
      await migrationFn(sequelize);
      console.log(`  ✅ ${label} — ${schema}`);
      results.push([schema, true, null]);
    } catch (err) {
      console.error(`  ❌ ${label} — ${schema}: ${err.message}`);
      results.push([schema, false, err.message]);
    }
  }
  return results;
}

module.exports = { migrateAcrossTenants };
