// A drug sold with no store chosen comes off the right store's shelf count: the default selling
// store if the item is kept there, else the one ACTIVE store holding it. An item kept in a retired
// (inactive) store and a new one used to have no store reduced at all. Payments taken at the same
// moment all dispense (no collision on the dispensing number).
import { AFTER, call, q, done, newPatient, newBill, ensureShift, pay, check, summary } from './lib.mjs';

const [item] = await q("SELECT id, item_name, quantity_on_hand, units_per_pack, selling_price FROM inventory_items WHERE is_active = true ORDER BY item_name LIMIT 1");
const tag = Math.random().toString(36).slice(2, 7);
const storeIds = { old: `t41-old-${tag}`, live: `t41-live-${tag}` };
const rowIds = { old: `t41o-${tag}`, live: `t41l-${tag}` };
const savedStores = await q('SELECT id, location_id, quantity_on_hand FROM stock_by_location WHERE item_id = $1', [item.id]);
const [settings] = await q("SELECT to_regclass('pharmacy_settings') IS NOT NULL AS ok");
const savedDefault = settings.ok ? (await q('SELECT default_pharmacy_location_id d FROM pharmacy_settings LIMIT 1'))[0]?.d : null;
const shelf = async (k) => Number((await q('SELECT quantity_on_hand FROM stock_by_location WHERE id = $1', [rowIds[k]]))[0].quantity_on_hand);
const sell = async (qty = 1) => {
  const bill = await newBill(AFTER, await newPatient(AFTER, 'T41'), [{ serviceId: item.id, serviceName: item.item_name, quantity: qty, unitPrice: 1000, totalPrice: 1000 * qty,
    category: 'Pharmacy / Inventory', dispenseOnPayment: true }]);
  return pay(AFTER, bill.id, 1000 * qty);
};

try {
  await q('DELETE FROM stock_by_location WHERE item_id = $1', [item.id]);
  await q("INSERT INTO stock_locations (id, clinic_id, location_name, location_code, is_active) VALUES ($1, 1, 'T41 old store', $1, false), ($2, 1, 'T41 new store', $2, true)", [storeIds.old, storeIds.live]);
  await q('INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES ($1, 1, $3, $4, 50), ($2, 1, $3, $5, 30)', [rowIds.old, rowIds.live, item.id, storeIds.old, storeIds.live]);
  await q('UPDATE inventory_items SET quantity_on_hand = 200, units_per_pack = 1 WHERE id = $1', [item.id]);
  if (settings.ok) await q('UPDATE pharmacy_settings SET default_pharmacy_location_id = NULL');
  await ensureShift(AFTER);

  const p1 = await sell(1);
  check('no store chosen, no default: comes off the one ACTIVE store (30 → 29), not the retired one', p1.ok && (await shelf('live')) === 29 && (await shelf('old')) === 50,
    JSON.stringify({ s: p1.status, live: await shelf('live'), old: await shelf('old') }));

  if (settings.ok) {
    await q("UPDATE stock_locations SET is_active = true WHERE id = $1", [storeIds.old]);
    await q('UPDATE pharmacy_settings SET default_pharmacy_location_id = $1', [storeIds.old]);
    const p2 = await sell(1);
    check('two active stores: comes off the default selling store (50 → 49)', p2.ok && (await shelf('old')) === 49 && (await shelf('live')) === 29,
      JSON.stringify({ old: await shelf('old'), live: await shelf('live') }));
    await q("UPDATE stock_locations SET is_active = false WHERE id = $1", [storeIds.old]);
    await q('UPDATE pharmacy_settings SET default_pharmacy_location_id = NULL');
  }

  // Eight bills paid at the same moment: every one dispensed, numbers unique.
  const before = await shelf('live');
  const bills = [];
  for (let i = 0; i < 8; i++) bills.push(await newBill(AFTER, await newPatient(AFTER, 'T41'), [{ serviceId: item.id, serviceName: item.item_name, quantity: 1, unitPrice: 1000, totalPrice: 1000,
    category: 'Pharmacy / Inventory', dispenseOnPayment: true }]));
  const paid = await Promise.all(bills.map((b) => pay(AFTER, b.id, 1000)));
  const stamped = await q(`SELECT s->>'dispensingNumber' dn FROM patient_bills b, LATERAL jsonb_array_elements(b.services::jsonb) s WHERE b.id = ANY($1::uuid[])`, [bills.map((b) => b.id)]);
  const numbers = stamped.map((r) => r.dn);
  check('8 simultaneous payments: all dispensed with distinct numbers, 8 off the shelf',
    paid.every((p) => p.ok) && numbers.every(Boolean) && new Set(numbers).size === 8 && (await shelf('live')) === before - 8,
    JSON.stringify({ statuses: paid.map((p) => p.status), numbers, shelf: await shelf('live'), before }));
} finally {
  await q('DELETE FROM stock_by_location WHERE id = ANY($1)', [[rowIds.old, rowIds.live]]);
  await q('DELETE FROM stock_locations WHERE id = ANY($1)', [[storeIds.old, storeIds.live]]);
  for (const r of savedStores) await q('INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES ($1, 1, $2, $3, $4)', [r.id, item.id, r.location_id, r.quantity_on_hand]);
  await q('UPDATE inventory_items SET quantity_on_hand = $2, units_per_pack = $3 WHERE id = $1', [item.id, item.quantity_on_hand, item.units_per_pack]);
  if (settings.ok) await q('UPDATE pharmacy_settings SET default_pharmacy_location_id = $1', [savedDefault]);
}
await done();
process.exit(summary() ? 1 : 0);
