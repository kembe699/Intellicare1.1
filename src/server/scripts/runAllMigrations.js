// One-shot schema repair: runs every startup migration synchronously and
// prints a clear pass/fail per step. Use this after deploying new backend
// code to a database that may be missing recent tables/columns, instead of
// waiting on the silent background migration runner in index.js.
//
// Usage (from the src/server directory, with production.env / .env present):
//   node scripts/runAllMigrations.js

async function main() {
  const steps = [
    ['Accounting',        () => require('./migrateAccountingTables').setupAccountingModule()],
    ['CashTransfers',     () => require('./migrateCashTransfers').migrateCashTransfers()],
    ['Procurement',       () => require('./migrateProcurementTables').migrateProcurementTables()],
    ['Inventory',         () => require('./migrateInventoryTables').migrateInventoryTables()],
    ['Pharmacy',          () => require('./migratePharmacyTables').migratePharmacyTables()],
    ['Billing',           () => require('./migrateBillingEnhancements').migrateBillingEnhancements()],
    ['Schemes',           () => require('./migrateSchemes').migrateSchemes()],
    ['Invoices',          () => require('./migrateInvoices').migrateInvoiceTables()],
    ['InsuranceClaims',   () => require('./migrateInsuranceClaims')()],
    ['MultiCurrency',     () => require('./migrateMultiCurrency').migrateMultiCurrency()],
    ['Inpatient',         () => require('./migrateInpatientTables').migrateInpatientTables()],
    ['Radiology',         () => require('./migrateRadiologyModule').migrateRadiologyModule()],
    ['Dhis2Report',       () => require('./migrateDhis2Tables').migrateDhis2Tables()],
    ['Icd10Reference',    () => require('./importIcd10').migrateAndImportIcd10()],
    ['VisitDiagnoses',    () => require('./migrateVisitDiagnosesTable').migrateVisitDiagnosesTable()],
    ['FixedAssets',       () => require('./migrateFixedAssetsTables').migrateFixedAssetsTables()],
    ['Departments',       () => require('./migrateDepartments')()],
    ['PerfIndexes',       () => require('./addPerformanceIndexes').addPerformanceIndexes()],
    ['Reporting',         () => require('./migrateReportingTables').migrateReportingTables()],
    ['AuditLogs',         async () => {
      const { sequelize: sq } = require('../models');
      await sq.query(`CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER,
        user_id VARCHAR(36),
        user_name VARCHAR(255),
        user_role VARCHAR(50),
        module VARCHAR(100) NOT NULL,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100),
        entity_id VARCHAR(100),
        description TEXT,
        old_values TEXT,
        new_values TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        status VARCHAR(20) DEFAULT 'success',
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      for (const [idxName, idxSql] of [
        ['idx_audit_logs_created', 'CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC)'],
        ['idx_audit_logs_module', 'CREATE INDEX idx_audit_logs_module ON audit_logs(module)'],
        ['idx_audit_logs_user', 'CREATE INDEX idx_audit_logs_user ON audit_logs(user_id)'],
      ]) {
        const [[idxCheck]] = await sq.query(
          `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'audit_logs' AND indexname = :idxName`,
          { replacements: { idxName } }
        );
        if (!idxCheck.cnt) await sq.query(idxSql);
      }
    }],
  ];

  console.log(`Running ${steps.length} migration steps against the configured database...\n`);
  const results = [];
  for (const [name, run] of steps) {
    process.stdout.write(`  ${name}... `);
    try {
      await run();
      console.log('OK');
      results.push([name, true, null]);
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      results.push([name, false, err.message]);
    }
  }

  const failed = results.filter(r => !r[1]);
  console.log('\n=== Summary ===');
  console.log(`${results.length - failed.length}/${results.length} steps succeeded`);
  if (failed.length) {
    console.log('\nFailed steps:');
    failed.forEach(([name, , msg]) => console.log(`  - ${name}: ${msg}`));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error running migrations:', err);
  process.exit(1);
});
