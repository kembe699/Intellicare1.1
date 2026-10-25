// A drug prescribed in doses is billed by its pack equivalent: 18 tablets of a 10-tablet strip at
// 5,000 a strip = 9,000 (not 90,000); bill COGS = 1.8 strips × cost; a scheme's per-pack price too.
import { AFTER, call, q, done, newPatient, newBill, check, summary } from './lib.mjs';

const [item] = await q("SELECT id, item_name, units_per_pack, selling_price, current_unit_cost, category_id FROM inventory_items WHERE is_active = true ORDER BY item_name LIMIT 1");
const [drugsCat] = await q("SELECT id FROM categories WHERE type = 'item' AND name = 'Drugs' LIMIT 1");
await q('UPDATE inventory_items SET units_per_pack = 10, selling_price = 5000, current_unit_cost = 2000, category_id = COALESCE($2, category_id) WHERE id = $1', [item.id, drugsCat?.id || null]);
const line = { serviceId: item.id, serviceName: item.item_name, quantity: 18, packQuantity: 1.8, unitPrice: 500, totalPrice: 9000, category: 'Pharmacy / Inventory' };
try {
  const pt = await newPatient(AFTER, 'T25');
  const bill = await newBill(AFTER, pt, [line]);
  const [b] = await q('SELECT total_amount::float t FROM patient_bills WHERE id = $1', [bill.id]);
  const [cogs] = await q(`SELECT COALESCE(SUM(li.debit_amount),0)::float c FROM general_ledger gl JOIN gl_line_items li ON li.gl_id = gl.id JOIN chart_of_accounts coa ON coa.id = li.account_id
                          WHERE gl.reference_id::text = $1 AND gl.transaction_type = 'pharmacy_bill_cogs' AND coa.account_type = 'expense'`, [String(bill.id)]);
  check('18 tablets of a 10-per-strip drug at 5,000/strip bills 9,000', b.t === 9000, JSON.stringify(b));
  check('bill COGS on the pack equivalent: 1.8 × 2,000 = 3,600', cogs.c === 3600, JSON.stringify(cogs));

  const code = `T25${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T25 ${code}`, scheme_type: 'corporate', is_insurance: true, currency: 'SSP' });
  const schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
  const pp = await call(AFTER, 'POST', `/schemes/${schemeId}/product-pricing`, { clinic_id: 1, product_id: item.id, product_type: 'inventory_item', scheme_price: 1000, scheme_currency: 'SSP', effective_from: new Date().toISOString().slice(0, 10) });
  if (!pp.ok) { console.log(`(scheme check skipped: product pricing unavailable on this database — ${pp.status})`); throw Object.assign(new Error('skip'), { skip: true }); }
  const pt2 = await newPatient(AFTER, 'T25');
  await q('UPDATE patients SET default_scheme_id = $2 WHERE id = $1', [pt2.id, schemeId]);
  const r = await call(AFTER, 'POST', '/patient-bills', { patient_id: pt2.id, patient_name: 'T25', clinic_id: 1, bill_date: new Date().toISOString(), status: 'pending', paid_amount: 0, created_by: 'T25', services: [line], total_amount: 9000, scheme_id: schemeId });
  check('scheme per-pack price on the pack equivalent: 1.8 × 1,000 = 1,800', r.ok && Number(r.body.total_amount) === 1800, JSON.stringify({ s: r.status, t: r.body.total_amount, e: r.body.error }));
} catch (e) { if (!e.skip) throw e; } finally {
  await q('UPDATE inventory_items SET units_per_pack = $2, selling_price = $3, current_unit_cost = $4, category_id = $5 WHERE id = $1', [item.id, item.units_per_pack, item.selling_price, item.current_unit_cost, item.category_id]);
}
await done();
process.exit(summary() ? 1 : 0);
