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
//
// migrationFn(sequelize) is called with the tenant's own connection — but a
// migration script written in this codebase's dominant style
// (`const { sequelize } = require('../models')` at the top of the file,
// used directly, with no `db` parameter threaded through its own internal
// helper functions) ignores that argument entirely and falls back to
// whatever models/index.js's tenant-aware proxy resolves outside a request:
// the hardcoded tenant_template default (see models/index.js's own comment
// on this exact fallback). A performance audit found 13 of this codebase's
// ~18 migration scripts are written exactly that way and were STILL only
// ever reaching tenant_template despite being listed in
// runBackgroundMigrations() — the identical bug this function was built to
// fix for addPerformanceIndexes.js/migrateTheatreTables.js/etc, just not yet
// caught for every caller.
//
// Wrapping the call in tenantContext.run() closes this for every migration
// function regardless of whether it personally uses its own `sequelize`
// parameter or falls through to the top-level require('../models') import —
// the exact same mechanism every request handler in this app already relies
// on (tenantContext.js's own header comment). This makes the explicit
// migrationFn(sequelize) argument redundant for scripts using the
// require('../models') pattern, but harmless to keep passing — a script
// that already takes an explicit `db` parameter (addPerformanceIndexes.js,
// migrateTheatreTables.js, ...) keeps using it exactly as before.
async function migrateAcrossTenants(migrationFn, label) {
  const { Client } = require('../models/platform');
  const { getTenantConnection } = require('../tenantDb');
  const tenantContext = require('../tenantContext');

  const clients = await Client.findAll({ attributes: ['schema_name'] });
  const schemas = Array.from(new Set(['tenant_template', ...clients.map((c) => c.schema_name)]));

  const results = [];
  for (const schema of schemas) {
    try {
      const connection = await getTenantConnection(schema);
      await tenantContext.run(connection, () => migrationFn(connection.sequelize));
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
