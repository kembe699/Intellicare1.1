/**
 * PO received quantities now move when a GRN is ACCEPTED, not when it is
 * created. GRNs created before this change already applied their quantities
 * at creation, so they are flagged as applied; accepting one of them later
 * must not add the same quantities a second time. New GRNs start FALSE.
 *
 * Additive only: adds one nullable column and fills it for existing rows.
 */
async function ensureGrnPoQuantityFlag(sequelize) {
  try {
    const [[col]] = await sequelize.query(
      `SELECT 1 AS ok FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'goods_receipt_notes' AND column_name = 'po_quantities_applied'`
    );
    if (col) return;
    await sequelize.query(`ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS po_quantities_applied BOOLEAN`);
    await sequelize.query(`UPDATE goods_receipt_notes SET po_quantities_applied = TRUE WHERE po_quantities_applied IS NULL`);
    await sequelize.query(`ALTER TABLE goods_receipt_notes ALTER COLUMN po_quantities_applied SET DEFAULT FALSE`);
  } catch (e) { /* best-effort — table may not exist yet on a brand-new tenant */ }
}

module.exports = { ensureGrnPoQuantityFlag };
