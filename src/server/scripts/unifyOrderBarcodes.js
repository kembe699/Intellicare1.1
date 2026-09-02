// One-time data fix: every test in a single lab order should share one
// barcode (one physical draw), but a bug in POST /api/lis/orders minted a
// new random barcode per test instead of once per order. This finds every
// order with more than one distinct barcode across its specimens and
// collapses them to a single canonical barcode (the earliest-created one).
// Safe to re-run — orders that are already unified are skipped.

// lis_specimens.barcode originally had a UNIQUE constraint (one row = one
// barcode), which is incompatible with multiple specimen rows intentionally
// sharing a barcode. Must be dropped before the backfill UPDATE below can
// succeed — checked via information_schema so this is safe to run repeatedly
// and on databases where it's already been dropped.
async function dropBarcodeUniqueConstraint(sequelize) {
  const [[idx]] = await sequelize.query(`
    SELECT COUNT(*) AS cnt FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = 'lis_specimens' AND indexname = 'uq_barcode'
  `);
  if (idx.cnt > 0) {
    await sequelize.query(`ALTER TABLE lis_specimens DROP INDEX uq_barcode`);
    console.log('  Dropped uq_barcode unique constraint on lis_specimens');
    return true;
  }
  return false;
}

async function unifyOrderBarcodes() {
  const { sequelize } = require('../models');

  await dropBarcodeUniqueConstraint(sequelize);

  const [affectedOrders] = await sequelize.query(`
    SELECT order_id, COUNT(DISTINCT barcode) AS distinct_barcodes
    FROM lis_specimens
    GROUP BY order_id
    HAVING COUNT(DISTINCT barcode) > 1
  `);

  console.log(`Found ${affectedOrders.length} order(s) with mismatched barcodes.`);

  let fixed = 0;
  for (const { order_id } of affectedOrders) {
    const [[canonical]] = await sequelize.query(
      `SELECT barcode FROM lis_specimens WHERE order_id = :order_id ORDER BY created_at ASC LIMIT 1`,
      { replacements: { order_id } }
    );
    if (!canonical) continue;

    const [result] = await sequelize.query(
      `UPDATE lis_specimens SET barcode = :barcode WHERE order_id = :order_id AND barcode != :barcode`,
      { replacements: { barcode: canonical.barcode, order_id } }
    );
    console.log(`  Order ${order_id} → unified to barcode ${canonical.barcode}`);
    fixed++;
  }

  console.log(`Unified ${fixed} order(s).`);
  return { ordersFound: affectedOrders.length, ordersFixed: fixed };
}

if (require.main === module) {
  unifyOrderBarcodes()
    .then((r) => { console.log('Done:', r); process.exit(0); })
    .catch((e) => { console.error('Failed:', e); process.exit(1); });
}

module.exports = { unifyOrderBarcodes, dropBarcodeUniqueConstraint };
