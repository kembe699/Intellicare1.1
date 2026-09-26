const { sequelize } = require('../models');

// Standalone radiology request/report queue for the LIS (outpatient) flow —
// distinct from inpatient_radiology_requests, which is admission-scoped and has
// no concept of an LIS participant/order. One row per requested exam (not one
// row per order with multiple lines) since each exam is independently
// confirmed and reported, often by different people at different times.
async function migrateRadiologyModule() {
  console.log('\n=== Radiology Module Migration ===\n');

  try {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS radiology_requests (
      id CHAR(36) PRIMARY KEY,
      clinic_id VARCHAR(36) NOT NULL,
      branch_id INTEGER,
      request_number VARCHAR(50) NOT NULL,
      participant_id VARCHAR(36) NOT NULL,
      order_id VARCHAR(36),
      service_id VARCHAR(36),
      exam_name VARCHAR(255) NOT NULL,
      doctor_id INTEGER,
      requested_by_name VARCHAR(255),
      request_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      clinical_indication TEXT,
      urgent BOOLEAN DEFAULT FALSE,
      status VARCHAR(20) DEFAULT 'pending',
      report_html TEXT,
      confirmed_by INTEGER,
      confirmed_by_name VARCHAR(255),
      confirmed_at TIMESTAMP,
      reported_by INTEGER,
      reported_by_name VARCHAR(255),
      reported_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('  ✅ radiology_requests table ready');
  } catch (err) {
    console.error('  ❌ Error creating radiology_requests:', err.message);
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_radiology_requests_participant ON radiology_requests(participant_id)',
    'CREATE INDEX IF NOT EXISTS idx_radiology_requests_status ON radiology_requests(status)',
    'CREATE INDEX IF NOT EXISTS idx_radiology_requests_clinic ON radiology_requests(clinic_id, status)',
  ];
  for (const idx of indexes) {
    try { await sequelize.query(idx); } catch (err) { /* ignore duplicate index errors */ }
  }
  console.log('  ✅ Indexes created');

  console.log('\n=== Radiology Module Migration Complete ===\n');
}

module.exports = { migrateRadiologyModule };
