// One-shot: creates the DHIS2 report tables in every real tenant schema
// (plus tenant_template), not just whichever schema the default connection
// happens to be pinned to. Safe to re-run — every table is CREATE TABLE IF
// NOT EXISTS.
//
// Usage (from the src/server directory, with production.env / .env present):
//   node scripts/runDhis2MigrationEverywhere.js

async function main() {
  const { migrateAcrossTenants } = require('./migrateAcrossTenants');
  const { migrateDhis2Tables } = require('./migrateDhis2Tables');

  console.log('Running DHIS2 table migration across every tenant...\n');
  const results = await migrateAcrossTenants(migrateDhis2Tables, 'DHIS2 tables');

  const failed = results.filter((r) => !r[1]);
  console.log('\n=== Summary ===');
  console.log(`${results.length - failed.length}/${results.length} schemas succeeded`);
  if (failed.length) {
    console.log('\nFailed schemas:');
    failed.forEach(([schema, , msg]) => console.log(`  - ${schema}: ${msg}`));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error running DHIS2 migration:', err);
  process.exit(1);
});
