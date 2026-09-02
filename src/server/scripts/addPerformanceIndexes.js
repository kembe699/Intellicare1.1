/**
 * Performance indexes for frequently-queried columns.
 * Safe to run multiple times — uses CREATE INDEX IF NOT EXISTS.
 */
const { sequelize } = require('../models');

const INDEXES = [
  // users — auth middleware lookups
  'CREATE INDEX IF NOT EXISTS idx_users_id_active ON users (id, is_active)',

  // patients — branch-filtered list queries
  'CREATE INDEX IF NOT EXISTS idx_patients_branch_id ON patients (branch_id)',
  'CREATE INDEX IF NOT EXISTS idx_patients_clinic_id ON patients (clinic_id)',
  'CREATE INDEX IF NOT EXISTS idx_patients_clinic_branch ON patients (clinic_id, branch_id)',

  // visits — clinical list + branch filter
  'CREATE INDEX IF NOT EXISTS idx_visits_clinic_branch ON visits (clinic_id, branch_id)',
  'CREATE INDEX IF NOT EXISTS idx_visits_doctor_id ON visits (doctor_id)',
  'CREATE INDEX IF NOT EXISTS idx_visits_patient_id ON visits (patient_id)',
  'CREATE INDEX IF NOT EXISTS idx_visits_visit_date ON visits (visit_date DESC)',

  // patient_queue — queue list queries
  'CREATE INDEX IF NOT EXISTS idx_patient_queue_status ON patient_queue (status)',
  'CREATE INDEX IF NOT EXISTS idx_patient_queue_branch ON patient_queue (branch_id)',
  'CREATE INDEX IF NOT EXISTS idx_patient_queue_clinic ON patient_queue (clinic_id)',

  // user_branches — branch context lookup on every request
  'CREATE INDEX IF NOT EXISTS idx_user_branches_user_id ON user_branches (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_branches_user_primary ON user_branches (user_id, is_primary)',

  // inventory_batches — batch tracking queries
  'CREATE INDEX IF NOT EXISTS idx_inv_batches_item_id ON inventory_batches (item_id)',
  'CREATE INDEX IF NOT EXISTS idx_inv_batches_status ON inventory_batches (status)',
  'CREATE INDEX IF NOT EXISTS idx_inv_batches_expiry ON inventory_batches (expiry_date)',

  // inventory_items — item lookup
  'CREATE INDEX IF NOT EXISTS idx_inv_items_clinic ON inventory_items (clinic_id)',
  'CREATE INDEX IF NOT EXISTS idx_inv_items_active ON inventory_items (clinic_id, is_active)',

  // lab_requests — clinical lab queries
  'CREATE INDEX IF NOT EXISTS idx_lab_requests_visit_id ON lab_requests (visit_id)',
  'CREATE INDEX IF NOT EXISTS idx_lab_requests_clinic ON lab_requests (clinic_id)',

  // patient_bills — billing lookups
  'CREATE INDEX IF NOT EXISTS idx_patient_bills_patient ON patient_bills (patient_id)',
  'CREATE INDEX IF NOT EXISTS idx_patient_bills_clinic ON patient_bills (clinic_id)',
];

async function addPerformanceIndexes() {
  let added = 0;
  for (const sql of INDEXES) {
    try {
      await sequelize.query(sql);
      added++;
    } catch (err) {
      // Non-fatal: table may not exist yet
      console.log(`Index skipped: ${err.message.split('\n')[0]}`);
    }
  }
  console.log(`✅ Performance indexes: ${added}/${INDEXES.length} applied`);
}

module.exports = { addPerformanceIndexes };
