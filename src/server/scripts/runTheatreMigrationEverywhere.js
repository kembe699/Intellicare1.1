// One-shot: creates the Theatre/OR module's tables in every real tenant
// schema, not just whichever schema the default connection happens to be
// pinned to. Safe to re-run — every table is CREATE TABLE IF NOT EXISTS.
// Not strictly needed for a fresh deploy (runBackgroundMigrations already
// loops this across every tenant at boot via migrateAcrossTenants), but kept
// for manual troubleshooting, matching every other module's convention.
//
// Usage (from the repo root, with production.env / .env present):
//   node src/server/scripts/runTheatreMigrationEverywhere.js

async function main() {
  const { migrateAcrossTenants } = require('./migrateAcrossTenants');
  const { migrateTheatreTables } = require('./migrateTheatreTables');

  console.log('Running Theatre migration across every tenant...\n');
  const results = await migrateAcrossTenants(migrateTheatreTables, 'Theatre');

  const failed = results.filter((r) => !r[1]);
  console.log('\n=== Summary ===');
  console.log(`${results.length - failed.length}/${results.length} schemas succeeded`);
  results.forEach(([schema, ok, msg]) => console.log(`  ${ok ? '✅' : '❌'} ${schema}${msg ? ' - ' + msg : ''}`));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error running Theatre migration:', err);
  process.exit(1);
});
