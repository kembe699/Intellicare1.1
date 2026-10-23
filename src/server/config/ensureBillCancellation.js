/**
 * Bills with ledger postings or payments are cancelled (full reversing entry),
 * never deleted. Additive only:
 *  - enum-typed patient_bills.status gets 'cancelled' and 'written_off' (the
 *    write-off route already writes 'written_off', which an enum without that
 *    label rejects; text-typed tenants need nothing here)
 *  - three nullable columns recording who cancelled, when and why
 */
async function ensureBillCancellation(sequelize) {
  try {
    const [[col]] = await sequelize.query(
      `SELECT udt_schema, udt_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'patient_bills' AND column_name = 'status'`
    );
    if (col?.data_type === 'USER-DEFINED') {
      const type = `"${col.udt_schema}"."${col.udt_name}"`;
      await sequelize.query(`ALTER TYPE ${type} ADD VALUE IF NOT EXISTS 'cancelled'`);
      await sequelize.query(`ALTER TYPE ${type} ADD VALUE IF NOT EXISTS 'written_off'`);
    }
    await sequelize.query(`ALTER TABLE patient_bills ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`);
    await sequelize.query(`ALTER TABLE patient_bills ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(255)`);
    await sequelize.query(`ALTER TABLE patient_bills ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`);
  } catch (e) { /* best-effort — table may not exist yet on a brand-new tenant */ }
}

module.exports = { ensureBillCancellation };
