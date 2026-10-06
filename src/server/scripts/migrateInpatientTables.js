const { sequelize } = require('../models');
const { reportSchemaGuardFailure } = require('../utils/legacyDDL');

async function migrateInpatientTables() {
  console.log('\n=== Inpatient Module Migration ===\n');

  const tables = [
    {
      name: 'wards',
      sql: `CREATE TABLE IF NOT EXISTS wards (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL,
        description TEXT,
        ward_type VARCHAR(100) DEFAULT 'general',
        capacity INT DEFAULT 0,
        current_occupancy INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_ward_code UNIQUE (clinic_id, code)
      )`
    },
    {
      name: 'rooms',
      sql: `CREATE TABLE IF NOT EXISTS rooms (
        id CHAR(36) PRIMARY KEY,
        ward_id CHAR(36) NOT NULL,
        clinic_id VARCHAR(36) NOT NULL,
        room_number VARCHAR(100) NOT NULL,
        room_type VARCHAR(100) DEFAULT 'standard',
        description TEXT,
        capacity INT DEFAULT 0,
        current_occupancy INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_room_number UNIQUE (clinic_id, room_number)
      )`
    },
    {
      name: 'beds',
      sql: `CREATE TABLE IF NOT EXISTS beds (
        id CHAR(36) PRIMARY KEY,
        room_id CHAR(36) NOT NULL,
        ward_id CHAR(36) NOT NULL,
        clinic_id VARCHAR(36) NOT NULL,
        bed_number VARCHAR(100) NOT NULL,
        bed_type VARCHAR(100) DEFAULT 'standard',
        status VARCHAR(50) DEFAULT 'available',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_bed_number UNIQUE (clinic_id, bed_number)
      )`
    },
    {
      name: 'inpatient_admissions',
      sql: `CREATE TABLE IF NOT EXISTS inpatient_admissions (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        admission_date TIMESTAMP NOT NULL,
        bed_id CHAR(36) NOT NULL,
        room_id CHAR(36) NOT NULL,
        ward_id CHAR(36) NOT NULL,
        admission_reason TEXT NOT NULL,
        diagnosis VARCHAR(500),
        diagnosis_code VARCHAR(50),
        admission_type VARCHAR(50) DEFAULT 'planned',
        status VARCHAR(50) DEFAULT 'active',
        admitted_by_user_id VARCHAR(36) NOT NULL,
        attending_doctor_id VARCHAR(36),
        discharge_date TIMESTAMP,
        discharge_reason TEXT,
        discharge_summary TEXT,
        discharged_by_user_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'doctor_notes',
      sql: `CREATE TABLE IF NOT EXISTS doctor_notes (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36) NOT NULL,
        admission_id CHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        doctor_id VARCHAR(36) NOT NULL,
        note_date TIMESTAMP NOT NULL,
        note_type VARCHAR(50) DEFAULT 'progress',
        clinical_assessment TEXT NOT NULL,
        examination_findings TEXT,
        vital_signs JSON,
        diagnosis VARCHAR(500),
        diagnosis_code VARCHAR(50),
        treatment_plan TEXT,
        progress_status VARCHAR(50) DEFAULT 'stable',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'inpatient_prescriptions',
      sql: `CREATE TABLE IF NOT EXISTS inpatient_prescriptions (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36) NOT NULL,
        admission_id CHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        doctor_id VARCHAR(36) NOT NULL,
        drug_id VARCHAR(36),
        medication_name VARCHAR(255) NOT NULL,
        prescription_date TIMESTAMP NOT NULL,
        dosage VARCHAR(100) NOT NULL,
        frequency VARCHAR(100) NOT NULL,
        duration VARCHAR(100),
        route VARCHAR(50) DEFAULT 'oral',
        instructions TEXT,
        quantity INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active',
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'drug_administrations',
      sql: `CREATE TABLE IF NOT EXISTS drug_administrations (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36) NOT NULL,
        prescription_id CHAR(36) NOT NULL,
        admission_id CHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        drug_id VARCHAR(36),
        medication_name VARCHAR(255) NOT NULL,
        nurse_id VARCHAR(36) NOT NULL,
        administered_at TIMESTAMP NOT NULL,
        dosage_given VARCHAR(100) NOT NULL,
        route VARCHAR(50) DEFAULT 'oral',
        notes TEXT,
        patient_reaction TEXT,
        status VARCHAR(50) DEFAULT 'given',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'nursing_notes',
      sql: `CREATE TABLE IF NOT EXISTS nursing_notes (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36) NOT NULL,
        admission_id CHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        nurse_id VARCHAR(36) NOT NULL,
        note_date TIMESTAMP NOT NULL,
        shift VARCHAR(50) DEFAULT 'morning',
        care_activities TEXT NOT NULL,
        patient_condition VARCHAR(255),
        vital_signs JSON,
        fluid_intake DECIMAL(10,2),
        fluid_output DECIMAL(10,2),
        wound_care TEXT,
        pain_level INT,
        mobility_status VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'inpatient_lab_requests',
      sql: `CREATE TABLE IF NOT EXISTS inpatient_lab_requests (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36) NOT NULL,
        admission_id CHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        doctor_id VARCHAR(36) NOT NULL,
        request_date TIMESTAMP NOT NULL,
        test_type VARCHAR(255) NOT NULL,
        test_code VARCHAR(100),
        urgent BOOLEAN DEFAULT FALSE,
        clinical_indication TEXT,
        sample_type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        results JSON,
        result_notes TEXT,
        completed_date TIMESTAMP,
        completed_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'inpatient_radiology_requests',
      sql: `CREATE TABLE IF NOT EXISTS inpatient_radiology_requests (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36) NOT NULL,
        admission_id CHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        doctor_id VARCHAR(36) NOT NULL,
        request_date TIMESTAMP NOT NULL,
        imaging_type VARCHAR(255) NOT NULL,
        body_part VARCHAR(255),
        urgent BOOLEAN DEFAULT FALSE,
        clinical_indication TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        findings TEXT,
        impression TEXT,
        completed_date TIMESTAMP,
        completed_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    }
  ];

  for (const table of tables) {
    try {
      await sequelize.query(table.sql);
      console.log(`  ✅ ${table.name} table ready`);
    } catch (err) {
      if (err.original?.code === 'ER_TABLE_EXISTS_ERROR') {
        console.log(`  ℹ️  ${table.name} already exists`);
      } else {
        console.error(`  ❌ Error creating ${table.name}:`, err.message);
      }
    }
  }

  // Consultation Rooms don't belong to a ward — relax the NOT NULL constraint.
  try {
    await sequelize.query('ALTER TABLE rooms MODIFY COLUMN ward_id CHAR(36) NULL');
    console.log('  ✅ rooms.ward_id is now nullable (for consultation rooms)');
  } catch (err) {
    reportSchemaGuardFailure('rooms.ward_id nullable', err);
  }

  // vital_signs only lives inside the CREATE TABLE statements above, which
  // are a no-op for a tenant whose doctor_notes/nursing_notes table already
  // existed before that column was added to this script — CREATE TABLE IF
  // NOT EXISTS never retrofits an existing table. Confirmed live: POST
  // /nursing-notes 500'd in tenant_nation the moment the nursing form
  // actually started sending vital_signs (previously the column had simply
  // never been written to, so the gap stayed invisible). Explicit ALTERs
  // here run through this same per-tenant migrateAcrossTenants loop, so
  // every tenant — not just brand-new ones — gets the column.
  for (const [table, column, def] of [
    ['doctor_notes', 'vital_signs', 'JSON'],
    ['nursing_notes', 'vital_signs', 'JSON'],
  ]) {
    try {
      await sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${def}`);
      console.log(`  ✅ ${table}.${column} ensured`);
    } catch (err) {
      reportSchemaGuardFailure(`${table}.${column}`, err);
    }
  }

  // Create indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_ip_admission_patient ON inpatient_admissions(patient_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_ip_admission_ward ON inpatient_admissions(ward_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_ip_admission_bed ON inpatient_admissions(bed_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_ip_doctor_notes ON doctor_notes(admission_id, note_date)',
    'CREATE INDEX IF NOT EXISTS idx_ip_nursing_notes ON nursing_notes(admission_id, note_date)',
    'CREATE INDEX IF NOT EXISTS idx_ip_prescriptions ON inpatient_prescriptions(admission_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_ip_drug_admin ON drug_administrations(prescription_id)',
    'CREATE INDEX IF NOT EXISTS idx_ip_lab_requests ON inpatient_lab_requests(admission_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_ip_radiology ON inpatient_radiology_requests(admission_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_beds_status ON beds(ward_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_rooms_ward ON rooms(ward_id)',
  ];

  for (const idx of indexes) {
    try {
      await sequelize.query(idx);
    } catch (err) {
      // Ignore duplicate index errors
    }
  }
  console.log('  ✅ Indexes created');

  console.log('\n=== Inpatient Module Migration Complete ===\n');
}

module.exports = { migrateInpatientTables };
