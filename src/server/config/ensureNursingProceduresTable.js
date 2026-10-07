/**
 * DDL only — creates the nursing_procedures table if it doesn't exist yet,
 * and retrofits it with the order/bill columns added after the first cut
 * of this feature shipped. Same shape as ensurePatientReferralsTable.js:
 * safe to call repeatedly, safe to call per-tenant (see tenantDb.js's
 * buildTenantConnection for why per-tenant call sites, not a one-off boot
 * migration, are how a brand-new table/column actually reaches every
 * schema — two earlier fixes this same week hit exactly that gap the
 * other way, via a boot-time-only migration that only ever touched one
 * tenant).
 *
 * Two kinds of row, told apart by entry_type:
 *  - 'note': a free-form, unbilled observation a nurse adds directly — no
 *    order needed, since nothing here is charged for.
 *  - 'procedure': something billable (an injection, a dressing, a minor
 *    procedure) — must start as a doctor- or reception-placed ORDER
 *    (status='pending', billed immediately via the same addLineItemsToBill
 *    a theatre request uses — see TheatreService.createRequest for the
 *    identical pattern), which a nurse later fulfills (status='completed'),
 *    filling in what was actually done.
 *
 * participant_id references lis_participants.id (the app's real patient
 * record, same convention as patient_referrals); order_id optionally links
 * the visit this happened under (lis_test_orders.id) so it can surface on
 * that visit's summary, but is nullable. No FKs declared, consistent with
 * this codebase's other ensureXxxTable migrations.
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
      procedure_type VARCHAR(30),
      description TEXT NOT NULL,
      notes TEXT,
      performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // A tenant whose table already existed before procedure_type/description
  // got their constraints relaxed here needs an explicit ALTER — CREATE
  // TABLE IF NOT EXISTS is a no-op once the table's already there.
  try { await sequelize.query(`ALTER TABLE nursing_procedures ALTER COLUMN procedure_type DROP NOT NULL`); } catch (e) { /* already nullable */ }

  for (const [column, def] of [
    ["entry_type", "VARCHAR(20) NOT NULL DEFAULT 'note'"],
    ["status", "VARCHAR(20) NOT NULL DEFAULT 'completed'"],
    ["ordered_by", "INTEGER"],
    ["ordered_at", "TIMESTAMP WITH TIME ZONE"],
    ["service_id", "VARCHAR(36)"],
    ["bill_id", "VARCHAR(36)"],
    ["fee_amount", "NUMERIC(15,2)"],
    ["fee_currency", "VARCHAR(3)"],
  ]) {
    await sequelize.query(`ALTER TABLE nursing_procedures ADD COLUMN IF NOT EXISTS ${column} ${def}`);
  }

  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_nursing_procedures_participant ON nursing_procedures(participant_id, performed_at DESC)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_nursing_procedures_order ON nursing_procedures(order_id)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_nursing_procedures_clinic ON nursing_procedures(clinic_id, performed_at DESC)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_nursing_procedures_status ON nursing_procedures(status)`);
}

module.exports = { ensureNursingProceduresTable };
