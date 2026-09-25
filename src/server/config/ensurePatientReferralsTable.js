/**
 * DDL only — creates the patient_referrals table if it doesn't exist yet.
 * Same shape as ensureClinicalInsightsTable.js: safe to call repeatedly,
 * safe to call per-tenant (see tenantDb.js's buildTenantConnection for why
 * per-tenant call sites, not a one-off boot migration, are how a brand-new
 * table actually reaches every schema).
 *
 * One row per referral, status pending -> accepted|rejected|cancelled.
 * patient_id references lis_participants.id (the app's real patient record —
 * see patientReferrals.js's own comment for why), from_branch_id/
 * to_branch_id reference branches.id. No FKs declared — this app's other
 * ensureXxxTable migrations don't either, consistent with a schema that
 * predates strict FK enforcement across these tables.
 *
 * queued_at/queued_order_id record that an ACCEPTED referral's patient was
 * put on the receiving branch's queue (a separate, later action from
 * acceptance itself — the receiving branch may accept before the patient has
 * actually arrived). queued_order_id points at the lis_test_orders row the
 * queue action created. Added via ALTER ... ADD COLUMN IF NOT EXISTS (not
 * baked into the original CREATE TABLE) since this table may already exist
 * in a tenant from before this pair of columns was introduced.
 */
async function ensurePatientReferralsTable(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS patient_referrals (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER,
      patient_id VARCHAR(36) NOT NULL,
      patient_name VARCHAR(255),
      from_branch_id INTEGER NOT NULL,
      to_branch_id INTEGER NOT NULL,
      reason TEXT,
      requested_by INTEGER,
      requested_by_name VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      decided_by INTEGER,
      decided_by_name VARCHAR(255),
      decision_reason TEXT,
      decided_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await sequelize.query(`ALTER TABLE patient_referrals ADD COLUMN IF NOT EXISTS queued_at TIMESTAMP WITH TIME ZONE`);
  await sequelize.query(`ALTER TABLE patient_referrals ADD COLUMN IF NOT EXISTS queued_order_id VARCHAR(36)`);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_patient_referrals_branches ON patient_referrals(from_branch_id, to_branch_id, status)
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_patient_referrals_patient ON patient_referrals(patient_id)
  `);
}

module.exports = { ensurePatientReferralsTable };
