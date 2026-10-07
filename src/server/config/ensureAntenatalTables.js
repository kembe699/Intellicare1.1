/**
 * Antenatal (ANC) care — a pregnancy registration plus its visit log.
 * Ensured per-tenant the same way as ensureNursingProceduresTable.js (see
 * tenantDb.js's buildTenantConnection for why per-tenant call sites, not a
 * one-off boot migration, are how a new table actually reaches every tenant).
 *
 * One registration per pregnancy (status tracks it through to delivery/close);
 * many visits per registration, each a single ANC contact's measurements —
 * laid out to print as a WHO-style antenatal card (gestational age, BP,
 * weight, fundal height, fetal heart rate, urine/Hb when taken, next
 * appointment). participant_id references lis_participants.id, same
 * convention as nursing_procedures/patient_referrals. No FKs declared,
 * consistent with this codebase's other ensureXxxTable migrations.
 */
async function ensureAntenatalTables(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS antenatal_registrations (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER,
      branch_id INTEGER,
      participant_id VARCHAR(36) NOT NULL,
      registration_number VARCHAR(50),
      lmp DATE,
      edd DATE,
      gravida VARCHAR(10),
      para VARCHAR(10),
      blood_group VARCHAR(10),
      risk_notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      registered_by INTEGER,
      source VARCHAR(20) NOT NULL DEFAULT 'manual',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS antenatal_visits (
      id VARCHAR(36) PRIMARY KEY,
      registration_id VARCHAR(36) NOT NULL,
      participant_id VARCHAR(36) NOT NULL,
      visit_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      gestational_age_weeks NUMERIC(4,1),
      blood_pressure VARCHAR(20),
      weight NUMERIC(6,2),
      fundal_height NUMERIC(5,2),
      fetal_heart_rate VARCHAR(20),
      fetal_presentation VARCHAR(30),
      urine_protein VARCHAR(20),
      urine_glucose VARCHAR(20),
      hb_level VARCHAR(20),
      next_appointment DATE,
      notes TEXT,
      recorded_by INTEGER,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // A tenant whose antenatal_registrations table predates the "auto-registered
  // from Triage/LIS" trigger needs this retroactively — same reasoning as
  // nursing_procedures's entry_type ALTER.
  await sequelize.query(`ALTER TABLE antenatal_registrations ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual'`);

  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_antenatal_registrations_participant ON antenatal_registrations(participant_id)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_antenatal_registrations_clinic ON antenatal_registrations(clinic_id, created_at DESC)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_antenatal_registrations_status ON antenatal_registrations(status)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_antenatal_visits_registration ON antenatal_visits(registration_id, visit_date DESC)`);
}

module.exports = { ensureAntenatalTables };
