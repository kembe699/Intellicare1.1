const { sequelize } = require('../models');

async function migrateInsuranceBatchClaims() {
  console.log('\n=== Insurance Batch Claims Migration ===\n');

  // 1. insurance_batch_claims
  console.log('1. Creating insurance_batch_claims table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS insurance_batch_claims (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INT NOT NULL DEFAULT 1,
      branch_id INT NULL,
      claim_number VARCHAR(50) UNIQUE NOT NULL,
      scheme_id VARCHAR(36) NOT NULL,
      scheme_name VARCHAR(255),
      scheme_code VARCHAR(50),
      claim_amount DECIMAL(15,2) DEFAULT 0,
      invoice_count INT DEFAULT 0,
      status ENUM('draft','pending','submitted','accepted','partially_paid','rejected','paid','cancelled') DEFAULT 'draft',
      priority ENUM('normal','urgent') DEFAULT 'normal',
      date_from DATE,
      date_to DATE,
      notes TEXT,
      contact_person VARCHAR(255),
      contact_email VARCHAR(255),
      contact_phone VARCHAR(50),
      submitted_at DATETIME NULL,
      accepted_at DATETIME NULL,
      paid_at DATETIME NULL,
      paid_amount DECIMAL(15,2) DEFAULT 0,
      rejected_reason TEXT,
      created_by VARCHAR(36),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  insurance_batch_claims table ready');

  // 2. insurance_batch_claim_items (link table to invoices)
  console.log('2. Creating insurance_batch_claim_items table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS insurance_batch_claim_items (
      id VARCHAR(36) PRIMARY KEY,
      claim_id VARCHAR(36) NOT NULL,
      invoice_id VARCHAR(36) NOT NULL,
      bill_id VARCHAR(36),
      patient_id VARCHAR(36),
      patient_name VARCHAR(255),
      invoice_number VARCHAR(50),
      invoice_date DATE,
      amount DECIMAL(15,2) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_claim_id (claim_id),
      INDEX idx_invoice_id (invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  insurance_batch_claim_items table ready');

  // 3. insurance_batch_claim_status_history
  console.log('3. Creating insurance_batch_claim_status_history table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS insurance_batch_claim_status_history (
      id VARCHAR(36) PRIMARY KEY,
      claim_id VARCHAR(36) NOT NULL,
      old_status VARCHAR(50),
      new_status VARCHAR(50),
      notes TEXT,
      created_by VARCHAR(36),
      created_by_name VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_claim_id (claim_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  insurance_batch_claim_status_history table ready');

  console.log('\n=== Insurance Batch Claims Migration Complete ===\n');
}

module.exports = migrateInsuranceBatchClaims;

if (require.main === module) {
  migrateInsuranceBatchClaims()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
