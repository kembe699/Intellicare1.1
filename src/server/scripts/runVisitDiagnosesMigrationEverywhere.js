// One-shot: creates visit_diagnoses (+ clinical_diagnoses.icd_code) in every
// real tenant schema, not just whichever schema the default connection
// happens to be pinned to. Safe to re-run — CREATE TABLE IF NOT EXISTS /
// ADD COLUMN IF NOT EXISTS throughout.
//
// Usage (from the repo root, with production.env / .env present):
//   node src/server/scripts/runVisitDiagnosesMigrationEverywhere.js

async function main() {
  const { migrateAcrossTenants } = require('./migrateAcrossTenants');
  const { migrateVisitDiagnosesTable } = require('./migrateVisitDiagnosesTable');

  console.log('Running visit_diagnoses migration across every tenant...\n');
  const results = await migrateAcrossTenants(migrateVisitDiagnosesTable, 'visit_diagnoses');

  const failed = results.filter((r) => !r[1]);
  console.log('\n=== Summary ===');
  console.log(`${results.length - failed.length}/${results.length} schemas succeeded`);
  results.forEach(([schema, ok, msg]) => console.log(`  ${ok ? '✅' : '❌'} ${schema}${msg ? ' - ' + msg : ''}`));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error running visit_diagnoses migration:', err);
  process.exit(1);
});
