// One-shot: creates the Fixed Assets tables (+ the extra chart-of-accounts
// rows and default categories they need) in every real tenant schema, not
// just whichever schema the default connection happens to be pinned to.
// Safe to re-run — every table is CREATE TABLE IF NOT EXISTS, every seeded
// account/category is inserted only if missing.
//
// Usage (from the repo root, with production.env / .env present):
//   node src/server/scripts/runFixedAssetsMigrationEverywhere.js

async function main() {
  const { migrateAcrossTenants } = require('./migrateAcrossTenants');
  const { migrateFixedAssetsTables } = require('./migrateFixedAssetsTables');

  console.log('Running Fixed Assets migration across every tenant...\n');
  const results = await migrateAcrossTenants(migrateFixedAssetsTables, 'Fixed Assets');

  const failed = results.filter((r) => !r[1]);
  console.log('\n=== Summary ===');
  console.log(`${results.length - failed.length}/${results.length} schemas succeeded`);
  results.forEach(([schema, ok, msg]) => console.log(`  ${ok ? '✅' : '❌'} ${schema}${msg ? ' - ' + msg : ''}`));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error running Fixed Assets migration:', err);
  process.exit(1);
});
