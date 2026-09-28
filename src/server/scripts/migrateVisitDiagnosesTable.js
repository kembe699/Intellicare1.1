const { sequelize } = require('../models');

// visit_diagnoses: one row per diagnosis recorded on a visit (a visit can
// have several). Per-tenant and branch-scoped like every other clinical
// table — NOT the shared reference data (see importIcd10.js for
// public.icd10_codes, which this table's icd_code column points into,
// unenforced by an FK on purpose since a coded diagnosis must never become
// unreadable just because a future ICD-10 version drops or renumbers a
// code).
async function migrateVisitDiagnosesTable(db = sequelize) {
  console.log('\n=== Visit Diagnoses Module Migration ===\n');

  await db.query(`
    CREATE TABLE IF NOT EXISTS visit_diagnoses (
      id CHAR(36) PRIMARY KEY,
      order_id VARCHAR(36) NOT NULL,
      participant_id VARCHAR(36) NOT NULL,
      branch_id INTEGER,
      icd_code VARCHAR(10),
      icd_source VARCHAR(50),
      icd_version VARCHAR(20),
      description TEXT NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      source VARCHAR(10) NOT NULL DEFAULT 'custom',
      custom_diagnosis_id VARCHAR(36),
      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP,
      deleted_by VARCHAR(36),
      CONSTRAINT chk_visit_diagnoses_source CHECK (source IN ('icd', 'custom'))
    )
  `);

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_visit_diagnoses_order ON visit_diagnoses (order_id)',
    'CREATE INDEX IF NOT EXISTS idx_visit_diagnoses_participant ON visit_diagnoses (participant_id)',
    'CREATE INDEX IF NOT EXISTS idx_visit_diagnoses_branch ON visit_diagnoses (branch_id)',
    'CREATE INDEX IF NOT EXISTS idx_visit_diagnoses_code ON visit_diagnoses (icd_code)',
    // Usage-count ranking in the search API filters live rows for a branch —
    // this is the exact shape of that query.
    'CREATE INDEX IF NOT EXISTS idx_visit_diagnoses_usage ON visit_diagnoses (branch_id, icd_code) WHERE deleted_at IS NULL AND icd_code IS NOT NULL',
  ];
  for (const idx of indexes) {
    try { await db.query(idx); } catch (err) { console.error('Index creation failed:', err.message); }
  }

  // clinical_diagnoses (the existing free-text list) gains an optional
  // mapped code, assigned later from the "Uncoded diagnoses" admin screen.
  try {
    await db.query(`ALTER TABLE clinical_diagnoses ADD COLUMN IF NOT EXISTS icd_code VARCHAR(10)`);
  } catch (err) {
    console.error('Could not add icd_code to clinical_diagnoses:', err.message);
  }

  console.log('  ✅ visit_diagnoses table ready');
  console.log('  ✅ clinical_diagnoses.icd_code ready');
  console.log('\n=== Visit Diagnoses Module Migration Complete ===\n');
}

module.exports = { migrateVisitDiagnosesTable };
