// Stock is kept in packs and can be fractional (18 tablets of a 10-tablet strip leave 96.4 strips).
// The stock-valuation-by-location and below-reorder reports used to truncate it to 96.
import { AFTER, call, q, done, check, summary } from './lib.mjs';

const [row] = await q(`SELECT s.id, s.quantity_on_hand, s.item_id, i.item_code, i.minimum_stock_level FROM stock_by_location s
  JOIN inventory_items i ON i.id::text = s.item_id::text WHERE i.is_active = true AND i.average_unit_cost > 0 ORDER BY i.item_name LIMIT 1`);
const [item] = await q('SELECT quantity_on_hand, minimum_stock_level FROM inventory_items WHERE id::text = $1', [String(row.item_id)]);
try {
  await q('UPDATE stock_by_location SET quantity_on_hand = 96.4 WHERE id = $1', [row.id]);
  const r = (await call(AFTER, 'GET', '/reports-v2/inventory/stock-valuation-by-location')).body;
  const mine = (r.rows || []).find((x) => x.itemCode === row.item_code && Math.abs(x.quantityOnHand - 96.4) < 1e-9);
  check('stock by location keeps the fraction: 96.4', !!mine, JSON.stringify((r.rows || []).filter((x) => x.itemCode === row.item_code)));

  await q('UPDATE inventory_items SET quantity_on_hand = 2.5, minimum_stock_level = 10 WHERE id::text = $1', [String(row.item_id)]);
  const low = (await call(AFTER, 'GET', '/reports-v2/inventory/below-reorder-level')).body;
  const lowRow = (low.rows || []).find((x) => x.itemCode === row.item_code || x.item_code === row.item_code);
  check('below reorder level keeps the fraction: 2.5', lowRow && lowRow.quantityOnHand === 2.5, JSON.stringify(lowRow));
} finally {
  await q('UPDATE stock_by_location SET quantity_on_hand = $2 WHERE id = $1', [row.id, row.quantity_on_hand]);
  await q('UPDATE inventory_items SET quantity_on_hand = $2, minimum_stock_level = $3 WHERE id::text = $1', [String(row.item_id), item.quantity_on_hand, item.minimum_stock_level]);
}
await done();
process.exit(summary() ? 1 : 0);
