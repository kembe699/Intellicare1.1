/**
 * DDL only — creates the nursing_procedures table if it doesn't exist yet.
 * Same shape as ensurePatientReferralsTable.js: safe to call repeatedly,
 * safe to call per-tenant (see tenantDb.js's buildTenantConnection for why
 * per-tenant call sites, not a one-off boot migration, are how a brand-new
 * table actually reaches every schema — two earlier fixes this same week
 * hit exactly that gap the other way, via a boot-time-only migration that
 * only ever touched one tenant).
 *
 * A standalone outpatient/triage log of nursing care given directly (not
 * via a doctor's prescription and not tied to an inpatient admission —
 * that's drug_administrations under Inpatient): an injection given, a
 * minor procedure performed, or a dressing changed. participant_id
 * references lis_participants.id (the app's real patient record, same
 * convention as patient_referrals); order_id optionally links the visit
 * this happened under (lis_test_orders.id) so it can surface on that
 * visit's summary, but is nullable — a nurse can log one against a
 * patient with no open order. No FKs declared, consistent with this
 * codebase's other ensureXxxTable migrations.
 */
async function ensureNursingProceduresTable(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS nursing_procedures (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER,
      branch_id INTEGER,
      participant_id VARCHAR(36) NOT NULL,
      order_id VARCHAR(36),
      nurse_id INTEGER,
      procedure_type VARCHAR(30) NOT NULL,
      description TEXT NOT NULL,
      notes TEXT,
      performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_nursing_procedures_participant ON nursing_procedures(participant_id, performed_at DESC)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_nursing_procedures_order ON nursing_procedures(order_id)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_nursing_procedures_clinic ON nursing_procedures(clinic_id, performed_at DESC)`);
}

module.exports = { ensureNursingProceduresTable };
