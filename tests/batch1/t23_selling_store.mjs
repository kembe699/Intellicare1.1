// Default selling store: set from Storage Locations, listed for every seller, filters the
// drug list to what the store holds, and a product sold from it leaves that store's stock.
import { AFTER, call, q, done, newPatient, newBill, ensureShift, pay, check, summary } from './lib.mjs';

const mk = async (name) => { const id = 'tss-' + Math.random().toString(36).slice(2, 8); await q("INSERT INTO stock_locations (id, clinic_id, location_name, location_code, is_active) VALUES ($1, 1, $2, $1, true)", [id, name]); return id; };
const A = await mk('T23 Front Pharmacy');
const B = await mk('T23 Back Store');
const [item] = await q('SELECT id, item_name, quantity_on_hand FROM inventory_items WHERE is_active = true ORDER BY item_name OFFSET 1 LIMIT 1');
const [other] = await q('SELECT id FROM inventory_items WHERE is_active = true AND id <> $1 ORDER BY item_name LIMIT 1', [item.id]);
const [settings] = await q('SELECT default_pharmacy_location_id d FROM pharmacy_settings WHERE clinic_id = 1');
const sbl = async (loc) => (await q('SELECT quantity_on_hand::float q FROM stock_by_location WHERE item_id = $1 AND location_id = $2', [item.id, loc]))[0]?.q;
await q("INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES ('tssa-'||$3, 1, $1, $2, 20)", [item.id, A, A]);
await q("INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES ('tssb-'||$3, 1, $1, $2, 20)", [item.id, B, B]);
await q("INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES ('tssc-'||$3, 1, $1, $2, 5)", [other.id, B, B]);
await q('UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + 40 WHERE id = $1', [item.id]);
try {
  const set = await call(AFTER, 'PUT', `/inventory/locations/${A}/default-selling`, {});
  const stores = await call(AFTER, 'GET', '/inventory/selling-stores');
  const def = (stores.body || []).find((s) => s.is_default);
  check('set as default selling store; the store list marks it default', set.ok && def?.id === A, JSON.stringify({ set: set.body, def }));
  const locs = await call(AFTER, 'GET', '/inventory/locations?clinic_id=1');
  check('Storage Locations shows which store is the default', (locs.body || []).find((l) => l.id === A)?.is_default_selling === true);

  const drugsA = await call(AFTER, 'GET', `/pharmacy-module/drugs?clinic_id=1&is_active=true&location_id=${A}&stocked_only=true`);
  const idsA = (drugsA.body || []).map((d) => d.id);
  check('drug list for a store shows only what it holds', idsA.includes(item.id) && !idsA.includes(other.id), `${idsA.length} items`);

  await ensureShift(AFTER);
  const pt = await newPatient(AFTER, 'T23');
  const bill = await newBill(AFTER, pt, [{ serviceId: item.id, serviceName: item.item_name, quantity: 3, unitPrice: 100, totalPrice: 300, category: 'Pharmacy / Inventory', dispenseOnPayment: true, locationId: B, locationName: 'T23 Back Store' }]);
  await pay(AFTER, bill.id, 300);
  check('a product sold from a chosen store leaves that store (B -3), not the default (A unchanged)', (await sbl(B)) === 17 && (await sbl(A)) === 20, JSON.stringify({ A: await sbl(A), B: await sbl(B) }));
} finally {
  await q('DELETE FROM stock_by_location WHERE location_id = ANY($1)', [[A, B]]);
  await q('UPDATE inventory_items SET quantity_on_hand = $2 WHERE id = $1', [item.id, item.quantity_on_hand]);
  await q('UPDATE pharmacy_settings SET default_pharmacy_location_id = $1 WHERE clinic_id = 1', [settings?.d || null]);
  await q('DELETE FROM stock_locations WHERE id = ANY($1)', [[A, B]]);
}
await done();
process.exit(summary() ? 1 : 0);
