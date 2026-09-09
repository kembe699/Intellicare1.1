require('dotenv').config();
const { sequelize } = require('../models');

async function addIndexes() {
  const indexes = [
    // Patients - most queried table
    `CREATE INDEX IF NOT EXISTS idx_patients_clinic_id ON patients(clinic_id)`,
    // Both are filtered on every read of their table and had no index.
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic ON audit_logs(clinic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_receipts_branch ON receipts(branch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(first_name, last_name)`,

    // Visits
    `CREATE INDEX IF NOT EXISTS idx_visits_patient_id ON visits(patient_id)`,
    `CREATE INDEX IF NOT EXISTS idx_visits_clinic_id ON visits(clinic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status)`,

    // Patient bills
    `CREATE INDEX IF NOT EXISTS idx_patient_bills_patient_id ON patient_bills(patient_id)`,
    `CREATE INDEX IF NOT EXISTS idx_patient_bills_clinic_id ON patient_bills(clinic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_patient_bills_status ON patient_bills(payment_status)`,
    `CREATE INDEX IF NOT EXISTS idx_patient_bills_created_at ON patient_bills(created_at DESC)`,

    // Lab requests/results
    `CREATE INDEX IF NOT EXISTS idx_lab_requests_patient_id ON lab_requests(patient_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lab_requests_clinic_id ON lab_requests(clinic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lab_requests_status ON lab_requests(status)`,
    `CREATE INDEX IF NOT EXISTS idx_lab_results_request_id ON lab_results(request_id)`,

    // Users
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_clinic_id ON users(clinic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,

    // Receipts
    `CREATE INDEX IF NOT EXISTS idx_receipts_clinic_id ON receipts(clinic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_receipts_patient_id ON receipts(patient_id)`,

    // Pharmacy / drug inventory
    `CREATE INDEX IF NOT EXISTS idx_drug_inventory_clinic_id ON drug_inventory(clinic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_drug_inventory_drug_name ON drug_inventory(drug_name)`,

    // Patient queue
    `CREATE INDEX IF NOT EXISTS idx_patient_queue_clinic_id ON patient_queue(clinic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_patient_queue_status ON patient_queue(status)`,
    `CREATE INDEX IF NOT EXISTS idx_patient_queue_date ON patient_queue(queue_date)`,

    // Insurance claims
    `CREATE INDEX IF NOT EXISTS idx_insurance_claims_clinic_id ON insurance_claims(clinic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_insurance_claims_status ON insurance_claims(status)`,
  ];

  console.log('🔧 Adding database indexes...');
  let added = 0;
  let skipped = 0;

  for (const sql of indexes) {
    try {
      await sequelize.query(sql);
      console.log(`  ✅ ${sql.match(/idx_\w+/)?.[0] || 'index'}`);
      added++;
    } catch (err) {
      console.log(`  ⚠️  Skipped: ${err.message.split('\n')[0]}`);
      skipped++;
    }
  }

  console.log(`\n✅ Done: ${added} indexes added, ${skipped} skipped`);
  process.exit(0);
}

addIndexes().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
