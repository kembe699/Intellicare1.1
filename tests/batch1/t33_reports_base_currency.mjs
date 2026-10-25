// The Laboratory, Pharmacy and Overview reports convert every bill line to base currency at the
// bill's booked rate before adding. They used to add a USD scheme bill's amounts to SSP as-is
// (CIC's USD 5 CBC counted as SSP 5).
import { AFTER, call, q, done, newPatient, newBill, serviceByName, line, check, summary, today } from './lib.mjs';

const RATE = 2799.37;
await q("DELETE FROM exchange_rates WHERE notes = 't33'"); // left by an earlier run that crashed
const [rateRow] = await q(`INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active, notes, created_at, updated_at)
  VALUES (gen_random_uuid(), 1, 'USD', 'SSP', $1, $2, true, 't33', NOW(), NOW()) RETURNING id`, [RATE, today]);
const cbc = await serviceByName('Complete Blood Count');
const [drug] = await q("SELECT id, item_name, selling_price FROM inventory_items WHERE item_name = 'Amoxicillin 500mg Capsule'");
const near = (a, b) => Math.abs(a - b) < 0.05;
const D = `dateFrom=${today}&dateTo=${today}`;
const snapshot = async () => {
  const lab = (await call(AFTER, 'GET', `/reports-v2/laboratory?${D}`)).body;
  const ph = (await call(AFTER, 'GET', `/reports-v2/pharmacy?${D}`)).body;
  const ov = (await call(AFTER, 'GET', `/reports-v2/overview?${D}`)).body;
  return {
    labCbc: (lab.byTest || []).filter((t) => /complete blood count/i.test(t.testName)).reduce((s, t) => s + t.totalBilled, 0),
    drug: (ph.byDrug || []).filter((d) => d.drugName === drug.item_name).reduce((s, d) => s + d.totalBilled, 0),
    billed: ov.kpis?.totalBilled || 0,
  };
};

const code = `T33${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
try {
  const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T33 ${code}`, scheme_type: 'corporate', is_insurance: true,
    currency: 'USD', is_credit_allowed: true, payment_terms: 'net_30', has_copay: false, default_copay_percentage: 0 });
  const schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
  const sp = await call(AFTER, 'POST', `/schemes/${schemeId}/service-pricing`, { clinic_id: 1, service_id: cbc.id, scheme_price: 5, scheme_currency: 'USD', effective_from: today });
  const pp = await call(AFTER, 'POST', `/schemes/${schemeId}/product-pricing`, { clinic_id: 1, product_id: drug.id, product_type: 'inventory_item', scheme_price: 0.5, scheme_currency: 'USD', effective_from: today });
  check('setup: USD scheme prices', sp.ok && pp.ok, JSON.stringify({ sp: sp.status, pp: pp.status, e: pp.body?.error || sp.body?.error }));

  const before = await snapshot();
  // An SSP cash bill (CBC 25,000) and a USD scheme bill (CBC USD 5 + 2 packs of the drug at USD 0.50).
  const cash = await newBill(AFTER, await newPatient(AFTER, 'T33'), [line(cbc)]);
  const pt = await newPatient(AFTER, 'T33');
  await call(AFTER, 'POST', `/schemes/patient-schemes/${pt.id}`, { scheme_id: schemeId, clinic_id: 1, member_number: 'T33-1' });
  const usd = await call(AFTER, 'POST', '/patient-bills', { patient_id: pt.id, patient_name: 'T33 USD', clinic_id: 1, created_by: 'T33', bill_date: today, status: 'pending', paid_amount: 0,
    scheme_id: schemeId, total_amount: 1, services: [line(cbc),
      { serviceId: drug.id, serviceName: drug.item_name, quantity: 2, packQuantity: 2, unitPrice: Number(drug.selling_price), totalPrice: 2 * Number(drug.selling_price), category: 'Pharmacy / Inventory' }] });
  const [u] = await q('SELECT bill_currency, total_amount::float t FROM patient_bills WHERE id = $1', [usd.body.id]);
  check('setup: USD bill', usd.ok && u?.bill_currency === 'USD', JSON.stringify({ s: usd.status, u, e: usd.body?.error }));
  const after = await snapshot();

  const labDelta = after.labCbc - before.labCbc;
  check(`lab report: CBC adds 25,000 + USD 5 × ${RATE}`, near(labDelta, 25000 + 5 * RATE), `${labDelta.toFixed(2)} vs ${(25000 + 5 * RATE).toFixed(2)}`);
  const drugDelta = after.drug - before.drug;
  check(`pharmacy report: drug adds USD 1 × ${RATE}`, near(drugDelta, RATE), `${drugDelta.toFixed(2)}`);
  const billedDelta = after.billed - before.billed;
  const expected = Number(cash.total_amount) + u.t * RATE;
  check('overview: total billed adds both bills in SSP', near(billedDelta, expected), `${billedDelta.toFixed(2)} vs ${expected.toFixed(2)}`);
} finally {
  await q('DELETE FROM exchange_rates WHERE id = $1', [rateRow.id]);
}
await done();
process.exit(summary() ? 1 : 0);
