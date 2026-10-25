// A drug's revenue and cost of sale are posted once. Billing posts both (the bill line is stamped
// cogsPosted); dispensing those doses at the counter afterwards — how an insurance prescription is
// billed then dispensed — must not charge, book revenue or cost them again. The counter still sends
// its selling price. Doses beyond what was billed are charged and costed as before.
import { AFTER, call, q, done, newPatient, newBill, ensureShift, pay, check, summary } from './lib.mjs';

const [item] = await q("SELECT id, item_name, quantity_on_hand, units_per_pack, selling_price, current_unit_cost, average_unit_cost, category_id FROM inventory_items WHERE is_active = true ORDER BY item_name LIMIT 1");
const [drugsCat] = await q("SELECT id FROM categories WHERE type = 'item' AND name = 'Drugs' LIMIT 1");
const orig = { ...item };
const billCogs = async (billId) => Number((await q(`SELECT COALESCE(SUM(li.debit_amount),0)::float c FROM general_ledger gl JOIN gl_line_items li ON li.gl_id = gl.id
  JOIN chart_of_accounts coa ON coa.id = li.account_id WHERE gl.reference_id::text = $1 AND gl.transaction_type = 'pharmacy_bill_cogs' AND coa.account_type = 'expense'`, [String(billId)]))[0].c);
const dispenseCogs = async (pid) => Number((await q(`SELECT COALESCE(SUM(li.debit_amount),0)::float c FROM dispensing_records d
  JOIN general_ledger gl ON gl.reference_id::text = d.id::text AND gl.transaction_type = 'pharmacy_dispensing_cogs'
  JOIN gl_line_items li ON li.gl_id = gl.id JOIN chart_of_accounts coa ON coa.id = li.account_id AND coa.account_type = 'expense'
  WHERE d.patient_id::text = $1`, [String(pid)]))[0].c);
const dispense = (pid, qty) => call(AFTER, 'POST', '/pharmacy-module/dispensing', {
  clinic_id: 1, patient_id: pid, drug_id: item.id, pharmacist_id: 1, quantity_dispensed: qty, unit_of_measure: 'tablet', unit_price: 5000 });
// Revenue entries and pharmacy charges raised by the patient's dispenses.
const dispenseRevenue = async (pid) => (await q(`SELECT COUNT(gl.id)::int n, COUNT(c.id)::int charges, COALESCE(SUM(c.charge_amount),0)::float amt
  FROM dispensing_records d LEFT JOIN general_ledger gl ON gl.id::text = d.revenue_gl_entry_id::text
  LEFT JOIN pharmacy_charges c ON c.dispensing_record_id::text = d.id::text WHERE d.patient_id::text = $1`, [String(pid)]))[0];

await q('UPDATE inventory_items SET quantity_on_hand = 100, units_per_pack = 10, selling_price = 5000, current_unit_cost = 2000, average_unit_cost = 2000, category_id = COALESCE($2, category_id) WHERE id = $1', [item.id, drugsCat?.id || null]);
try {
  await ensureShift(AFTER);
  // 18 tablets billed by pack (1.8 strips): bill COGS 3,600. Paid, so dispensing isn't blocked.
  const pt = await newPatient(AFTER, 'T27');
  const bill = await newBill(AFTER, pt, [{ serviceId: item.id, serviceName: item.item_name, quantity: 18, packQuantity: 1.8, unitPrice: 500, totalPrice: 9000, category: 'Pharmacy / Inventory' }]);
  await pay(AFTER, bill.id, 9000);
  check('billing posted COGS once: 1.8 × 2,000 = 3,600', (await billCogs(bill.id)) === 3600, String(await billCogs(bill.id)));

  const d1 = await dispense(pt.id, 18);
  check('dispensing the 18 billed tablets posts no second COGS', d1.ok && (await dispenseCogs(pt.id)) === 0, JSON.stringify({ s: d1.status, e: d1.body?.error, c: await dispenseCogs(pt.id) }));
  const r1 = await dispenseRevenue(pt.id);
  check('…and no second revenue entry or pharmacy charge', r1.n === 0 && r1.charges === 0, JSON.stringify(r1));

  const d2 = await dispense(pt.id, 10);
  // (costed at the dispensed batch's own cost when it has one, so only "posted" is checked)
  check('10 more tablets, never billed, get their own COGS', d2.ok && (await dispenseCogs(pt.id)) > 0, JSON.stringify({ s: d2.status, c: await dispenseCogs(pt.id) }));
  const r2 = await dispenseRevenue(pt.id);
  check('…and are charged as before: one revenue entry, one charge of 5,000', r2.n === 1 && r2.charges === 1 && r2.amt === 5000, JSON.stringify(r2));

  // A drug dispensed on payment (autoDispense, no COGS of its own) has used up its bill's coverage.
  const pt2 = await newPatient(AFTER, 'T27');
  const bill2 = await newBill(AFTER, pt2, [{ serviceId: item.id, serviceName: item.item_name, quantity: 1, unitPrice: 5000, totalPrice: 5000, category: 'Pharmacy / Inventory', dispenseOnPayment: true }]);
  await pay(AFTER, bill2.id, 5000);
  const auto = await q('SELECT quantity_dispensed::float q FROM dispensing_records WHERE patient_id::text = $1', [String(pt2.id)]);
  const d3 = await dispense(pt2.id, 10);
  check('after a dispense-on-payment used the billed strip, another strip at the counter gets COGS',
    auto.length === 1 && d3.ok && (await dispenseCogs(pt2.id)) > 0, JSON.stringify({ auto, s: d3.status, c: await dispenseCogs(pt2.id) }));
} finally {
  await q('UPDATE inventory_items SET quantity_on_hand = $2, units_per_pack = $3, selling_price = $4, current_unit_cost = $5, average_unit_cost = $6, category_id = $7 WHERE id = $1',
    [item.id, orig.quantity_on_hand, orig.units_per_pack, orig.selling_price, orig.current_unit_cost, orig.average_unit_cost, orig.category_id]);
}
await done();
process.exit(summary() ? 1 : 0);
