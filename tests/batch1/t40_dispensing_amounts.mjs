// A dispensing record's amount is what was charged for it, in base currency, by the pack:
// - doses already on an insurance bill record the bill's price (USD 3.75 × rate), not the counter's
//   cash price — so dispensing history agrees with revenue;
// - doses not on any bill record the counter price × packs (10 tablets of a 10-pack = one pack).
// The history screen shows this stored total; it used to multiply the per-pack price by the tablet
// count (24 tablets × 20,000 a pack = 480,000).
import { AFTER, call, q, done, newPatient, check, summary, today } from './lib.mjs';

const RATE = 2799.37;
await q("DELETE FROM exchange_rates WHERE notes = 't40'");
const [rateRow] = await q(`INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active, notes, created_at, updated_at)
  VALUES (gen_random_uuid(), 1, 'USD', 'SSP', $1, $2, true, 't40', NOW(), NOW()) RETURNING id`, [RATE, today]);
const [item] = await q("SELECT id, item_name, units_per_pack, selling_price, quantity_on_hand FROM inventory_items WHERE is_active = true ORDER BY item_name LIMIT 1");
const near = (a, b) => Math.abs(a - b) < 0.02;
const record = async (pid) => (await q('SELECT total_price::float t, total_price_base::float b, currency_code c FROM dispensing_records WHERE patient_id::text = $1 ORDER BY created_at DESC LIMIT 1', [String(pid)]))[0];
const code = `T40${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
try {
  await q('UPDATE inventory_items SET units_per_pack = 10, selling_price = 12000, quantity_on_hand = quantity_on_hand + 20 WHERE id = $1', [item.id]);
  const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T40 ${code}`, scheme_type: 'corporate', is_insurance: true, currency: 'USD', is_credit_allowed: true });
  const schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
  await call(AFTER, 'POST', `/schemes/${schemeId}/product-pricing`, { clinic_id: 1, product_id: item.id, product_type: 'inventory_item', scheme_price: 2.5, scheme_currency: 'USD', effective_from: today });

  // Insured: 15 capsules (1.5 packs at USD 2.50) billed to the scheme, then dispensed at the counter.
  const pt = await newPatient(AFTER, 'T40');
  await call(AFTER, 'POST', `/schemes/patient-schemes/${pt.id}`, { scheme_id: schemeId, clinic_id: 1, member_number: 'T40-1' });
  const bill = await call(AFTER, 'POST', '/patient-bills', { patient_id: pt.id, patient_name: 'T40', clinic_id: 1, created_by: 'T40', bill_date: today, status: 'pending', paid_amount: 0, scheme_id: schemeId, total_amount: 1,
    services: [{ serviceId: item.id, serviceName: item.item_name, quantity: 15, packQuantity: 1.5, unitPrice: 1200, totalPrice: 18000, category: 'Pharmacy / Inventory' }] });
  const d1 = await call(AFTER, 'POST', '/pharmacy-module/dispensing', { clinic_id: 1, patient_id: pt.id, drug_id: item.id, pharmacist_id: 1, quantity_dispensed: 15, unit_price: 12000 });
  const r1 = await record(pt.id);
  const want = Math.round(3.75 * RATE * 100) / 100;
  check(`insured doses record the bill's price: USD 3.75 × ${RATE} = ${want}`, bill.ok && d1.ok && near(r1.b, want) && r1.c === 'SSP', JSON.stringify({ bill: bill.status, d: d1.status, r1 }));

  // Not billed: 10 tablets at the counter = one pack at 12,000.
  const pt2 = await newPatient(AFTER, 'T40');
  const d2 = await call(AFTER, 'POST', '/pharmacy-module/dispensing', { clinic_id: 1, patient_id: pt2.id, drug_id: item.id, pharmacist_id: 1, quantity_dispensed: 10, unit_price: 12000 });
  const r2 = await record(pt2.id);
  check('unbilled counter dispense: 10 tablets = 1 pack × 12,000', d2.ok && near(r2.t, 12000), JSON.stringify({ d: d2.status, r2 }));

  // The history endpoint carries the stored total the screen now shows.
  const hist = (await call(AFTER, 'GET', `/pharmacy-module/dispensing?patient_id=${pt.id}`)).body;
  const rows = Array.isArray(hist) ? hist : hist.data || hist.records || [];
  const h = rows.find((x) => String(x.patient_id) === String(pt.id));
  check('history returns the stored base total', h && near(parseFloat(h.total_price_base ?? h.total_price), want), JSON.stringify(h && { t: h.total_price, b: h.total_price_base }));
} finally {
  await q('UPDATE inventory_items SET units_per_pack = $2, selling_price = $3 WHERE id = $1', [item.id, item.units_per_pack, item.selling_price]);
  await q('DELETE FROM exchange_rates WHERE id = $1', [rateRow.id]);
}
await done();
process.exit(summary() ? 1 : 0);
