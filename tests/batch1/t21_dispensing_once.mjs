// Dispensing happens once per prescription line, in pack units, and drugs billed straight
// onto a bill are dispensed (stock out, history record) when paid.
import { AFTER, call, q, done, newPatient, newBill, ensureShift, pay, check, summary } from './lib.mjs';

const [item] = await q("SELECT id, item_name, quantity_on_hand, units_per_pack, selling_price FROM inventory_items WHERE is_active = true ORDER BY item_name LIMIT 1");
let [loc] = await q('SELECT id FROM stock_locations LIMIT 1');
let madeLoc = null;
if (!loc) { madeLoc = 'tdisploc-' + Math.random().toString(36).slice(2, 8); await q("INSERT INTO stock_locations (id, clinic_id, location_name, location_code) VALUES ($1, 1, 'T21 Pharmacy', $1)", [madeLoc]); loc = { id: madeLoc }; }
const orig = { ...item };
const storeRows = await q('SELECT id, location_id, quantity_on_hand FROM stock_by_location WHERE item_id = $1', [item.id]);
const madeStore = 'tdisp-' + Math.random().toString(36).slice(2, 8);
const stock = async () => {
  const [i] = await q('SELECT quantity_on_hand::float q FROM inventory_items WHERE id = $1', [item.id]);
  const [s] = await q('SELECT quantity_on_hand::float q FROM stock_by_location WHERE id = $1', [madeStore]);
  return { item: i.q, store: s?.q };
};
const records = (pid) => q('SELECT dispensing_number, quantity_dispensed::float qty, status FROM dispensing_records WHERE patient_id::text = $1 ORDER BY created_at', [String(pid)]);

await q('DELETE FROM stock_by_location WHERE item_id = $1', [item.id]);
await q('INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES ($1, 1, $2, $3, 50)', [madeStore, item.id, loc.id]);
await q('UPDATE inventory_items SET quantity_on_hand = 50, units_per_pack = 10, selling_price = 1000 WHERE id = $1', [item.id]);
try {
  await ensureShift(AFTER);

  // A. Prescription for 20 tablets (2 strips), billed and paid → auto-dispensed once; the
  //    counter's own Dispense for the same line is refused.
  const pA = await newPatient(AFTER, 'T21');
  const rx = await call(AFTER, 'POST', '/pharmacy-module/prescriptions', {
    clinic_id: 1, patient_id: pA.id, prescription_date: new Date().toISOString().slice(0, 10),
    lines: [{ drug_id: item.id, quantity_prescribed: 20, unit_of_measure: 'tablet', frequency: 'BD', duration_days: 5 }],
  });
  const rxId = rx.body.id || rx.body.data?.id;
  const [rxLine] = await q('SELECT id FROM prescription_lines WHERE prescription_id::text = $1', [String(rxId)]);
  const billA = await newBill(AFTER, pA, [{ serviceId: item.id, serviceName: item.item_name, quantity: 2, unitPrice: 1000, totalPrice: 2000, category: 'Pharmacy / Inventory' }]);
  await pay(AFTER, billA.id, 2000);
  const afterAuto = await stock();
  const recA = await records(pA.id);
  check('paid prescription auto-dispensed once, in strips: 2 strips off item and store stock',
    recA.length === 1 && afterAuto.item === 48 && afterAuto.store === 48, JSON.stringify({ rx: rx.status, recA, afterAuto }));
  const again = await call(AFTER, 'POST', '/pharmacy-module/dispensing', {
    clinic_id: 1, prescription_id: rxId, prescription_line_id: rxLine?.id, patient_id: pA.id, drug_id: item.id,
    pharmacist_id: 1, quantity_dispensed: 20, unit_price: 1000,
  });
  const afterAgain = await stock();
  check('counter dispense of the same line refused (409), no second record, stock unchanged',
    again.status === 409 && (await records(pA.id)).length === 1 && afterAgain.item === 48, JSON.stringify({ s: again.status, e: again.body.error, afterAgain }));

  // B. A drug added straight onto a bill (no prescription), marked dispenseOnPayment → dispensed on payment.
  const pB = await newPatient(AFTER, 'T21');
  const billB = await newBill(AFTER, pB, [{ serviceId: item.id, serviceName: item.item_name, quantity: 3, unitPrice: 1000, totalPrice: 3000, category: 'Pharmacy / Inventory', dispenseOnPayment: true }]);
  await pay(AFTER, billB.id, 3000);
  const recB = await records(pB.id);
  const afterB = await stock();
  const [bRow] = await q('SELECT services FROM patient_bills WHERE id = $1', [billB.id]);
  const lineB = (typeof bRow.services === 'string' ? JSON.parse(bRow.services) : bRow.services)[0];
  check('billed drug dispensed on payment: history record, 3 strips off item and store, line stamped',
    recB.length === 1 && afterB.item === 45 && afterB.store === 45 && !!lineB.dispensingNumber, JSON.stringify({ recB, afterB, dn: lineB.dispensingNumber }));

  // C. Same drug billed without the mark (as the pharmacy screens bill prescription lines) is not dispensed by the bill.
  const pC = await newPatient(AFTER, 'T21');
  const billC = await newBill(AFTER, pC, [{ serviceId: item.id, serviceName: item.item_name, quantity: 1, unitPrice: 1000, totalPrice: 1000, category: 'Pharmacy / Inventory' }]);
  await pay(AFTER, billC.id, 1000);
  check('unmarked billed drug with no prescription: not dispensed by the bill', (await records(pC.id)).length === 0 && (await stock()).item === 45);
} finally {
  await q('DELETE FROM stock_by_location WHERE id = $1', [madeStore]);
  if (madeLoc) await q('DELETE FROM stock_locations WHERE id = $1', [madeLoc]);
  for (const r of storeRows) await q('INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES ($1, 1, $2, $3, $4)', [r.id, item.id, r.location_id, r.quantity_on_hand]);
  await q('UPDATE inventory_items SET quantity_on_hand = $2, units_per_pack = $3, selling_price = $4 WHERE id = $1', [item.id, orig.quantity_on_hand, orig.units_per_pack, orig.selling_price]);
}
await done();
process.exit(summary() ? 1 : 0);
