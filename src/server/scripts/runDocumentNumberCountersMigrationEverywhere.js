// One-shot: creates document_number_counters and seeds it from existing
// GL-/JE-number sequences, in every real tenant schema. Safe to re-run.
//
// Usage (from the repo root, with production.env / .env present):
//   node src/server/scripts/runDocumentNumberCountersMigrationEverywhere.js

async function main() {
  const { migrateAcrossTenants } = require('./migrateAcrossTenants');
  const { migrateDocumentNumberCounters } = require('./migrateDocumentNumberCounters');

  console.log('Running document_number_counters migration across every tenant...\n');
  const results = await migrateAcrossTenants(migrateDocumentNumberCounters, 'Document Number Counters');

  const failed = results.filter((r) => !r[1]);
  console.log('\n=== Summary ===');
  console.log(`${results.length - failed.length}/${results.length} schemas succeeded`);
  results.forEach(([schema, ok, msg]) => console.log(`  ${ok ? '✅' : '❌'} ${schema}${msg ? ' - ' + msg : ''}`));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error running document number counters migration:', err);
  process.exit(1);
});
