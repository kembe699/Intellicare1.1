/**
 * B5: a receipt's void/refund now goes through an approval step —
 * requesting one sets status to 'pending_void'/'pending_refund' rather than
 * immediately reversing the payment (see receipts.js's applyVoidReversal /
 * /approve-void / /reject-void). receipts.status carries a CHECK constraint
 * restricting it to ('active','voided','refunded'), so those two new values
 * need the constraint widened before any receipt can actually take them.
 *
 * Idempotent: checks the constraint's own definition text before touching
 * it, so a schema that already has the wider constraint is left alone.
 *
 * Same per-tenant self-migration shape as ensureInpatientDischargeOutcome.js
 * — see tenantDb.js's buildTenantConnection for why this runs per tenant
 * connection rather than as a boot-time IIFE against one static database.
 */
async function ensureReceiptPendingVoidStatus(sequelize) {
  // Some tenants were provisioned with receipts.status as a Postgres enum
  // (no CHECK constraint at all), where the pending values were never
  // added — every pending request failed with "invalid input value for
  // enum". Adding enum labels is additive and idempotent.
  try {
    const [[col]] = await sequelize.query(
      `SELECT udt_schema, udt_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'receipts' AND column_name = 'status'`
    );
    if (col?.data_type === 'USER-DEFINED') {
      const type = `"${col.udt_schema}"."${col.udt_name}"`;
      await sequelize.query(`ALTER TYPE ${type} ADD VALUE IF NOT EXISTS 'pending_void'`);
      await sequelize.query(`ALTER TYPE ${type} ADD VALUE IF NOT EXISTS 'pending_refund'`);
    }
  } catch (e) { /* best-effort — table may not exist yet on a brand-new tenant */ }

  try {
    const [[existing]] = await sequelize.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'receipts'::regclass AND conname = 'receipts_status_check'`
    );
    if (existing?.def?.includes('pending_void')) return; // already widened

    await sequelize.query(`ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_status_check`);
    await sequelize.query(
      `ALTER TABLE receipts ADD CONSTRAINT receipts_status_check
         CHECK (status = ANY (ARRAY['active','voided','refunded','pending_void','pending_refund']))`
    );
  } catch (e) { /* best-effort — table may not exist yet on a brand-new tenant */ }
}

module.exports = { ensureReceiptPendingVoidStatus };
