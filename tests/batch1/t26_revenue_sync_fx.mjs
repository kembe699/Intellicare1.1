// The bill-revenue sync compares in BASE currency, at the bill's booked rate.
// It used to compare a USD bill's own-currency total with the SSP ledger and
// reverse almost all of its revenue. Checks: a USD bill, an SSP bill, a USD bill
// with items in four revenue categories at a non-round rate, the same after an
// insurance claim is paid — the sync posts nothing on each — and a bill carrying
// the old wrong reversal, which the sync puts right.
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { AFTER, call, q, done, newPatient, serviceByName, line, check, summary, today } from './lib.mjs';

const RATE = 2799.37; // non-round, so per-account conversion rounds
const sync = (billId) => {
  const out = execFileSync('node', ['tests/batch1/sync_bill.cjs', billId], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' });
  const m = out.match(/@@RESULT (.*)/); if (!m) throw new Error(out.slice(-500));
  return JSON.parse(m[1]);
};
const revenue = async (billId) => Number((await q(`
  SELECT COALESCE(SUM(al.credit_amount) - SUM(al.debit_amount), 0) v
    FROM account_ledger al JOIN chart_of_accounts c ON c.id = al.account_id
    JOIN general_ledger gl ON gl.id = al.transaction_id
   WHERE gl.reference_id = $1 AND gl.reference_module IN ('patient_billing','bill_item_void','bill_revenue_adjustment')
     AND (c.account_type = 'revenue' OR c.id::text IN (SELECT account_id::text FROM tax_rates WHERE account_id IS NOT NULL))`, [String(billId)]))[0].v);
// Over the bill's own entries plus any other references (a claim payment is keyed to the claim).
const receivable = async (billId, code, others = []) => Number((await q(`
  SELECT COALESCE(SUM(al.debit_amount) - SUM(al.credit_amount), 0) v
    FROM account_ledger al JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_code = $2
    JOIN general_ledger gl ON gl.id = al.transaction_id WHERE gl.reference_id = ANY($1)`, [[String(billId), ...others.map(String)], code]))[0].v);
const adjustments = async (billId) => Number((await q(`SELECT COUNT(*) n FROM general_ledger WHERE reference_id = $1 AND reference_module = 'bill_revenue_adjustment'`, [String(billId)]))[0].n);
const billRow = async (id) => (await q('SELECT total_amount::float t, base_currency_total::float b, exchange_rate::float r FROM patient_bills WHERE id = $1', [id]))[0];
const near = (a, b, tol = 0.05) => Math.abs(a - b) < tol;

await q("DELETE FROM exchange_rates WHERE notes = 't26'"); // left by an earlier run that crashed
const [rateRow] = await q(`INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active, notes, created_at, updated_at)
  VALUES (gen_random_uuid(), 1, 'USD', 'SSP', $1, $2, true, 't26', NOW(), NOW()) RETURNING id`, [RATE, today]);
const svc = {
  consult: await serviceByName('Consultation - General Practitioner'),
  lab: await serviceByName('Complete Blood Count'),
  xray: await serviceByName('Chest X-Ray'),
  dressing: await serviceByName('Wound Dressing'),
};
const USD = { consult: 7.35, lab: 5.15, xray: 12.4, dressing: 3.05 };
const code = `T26${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
let schemeId;
try {
  const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T26 ${code}`, scheme_type: 'corporate', is_insurance: true,
    currency: 'USD', is_credit_allowed: true, payment_terms: 'net_30', has_copay: false, default_copay_percentage: 0 });
  schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
  for (const [k, s] of Object.entries(svc)) {
    const r = await call(AFTER, 'POST', `/schemes/${schemeId}/service-pricing`, { clinic_id: 1, service_id: s.id, scheme_price: USD[k], scheme_currency: 'USD', effective_from: today });
    if (!r.ok) throw new Error('pricing: ' + JSON.stringify(r.body));
  }

  const usdBill = async (keys) => {
    const pt = await newPatient(AFTER, 'T26');
    await call(AFTER, 'POST', `/schemes/patient-schemes/${pt.id}`, { scheme_id: schemeId, clinic_id: 1, member_number: 'T26-1' });
    const [first, ...rest] = keys;
    const r = await call(AFTER, 'POST', '/patient-bills', { patient_id: pt.id, patient_name: `${pt.first_name} ${pt.last_name}`, clinic_id: 1, created_by: 'T26',
      bill_date: today, services: [line(svc[first])], total_amount: Number(svc[first].price), paid_amount: 0, status: 'pending', scheme_id: schemeId });
    if (!r.ok) throw new Error('usd bill: ' + JSON.stringify(r.body));
    if (rest.length) {
      const a = await call(AFTER, 'PUT', `/patient-bills/${r.body.id}/add-services`, { services: rest.map((k) => line(svc[k])), scheme_id: schemeId });
      if (!a.ok) throw new Error('add-services: ' + JSON.stringify(a.body));
    }
    return { bill: r.body, patient: pt };
  };

  // 1. USD bill, created then topped up (each add-services runs the sync)
  {
    const { bill } = await usdBill(['consult', 'lab']);
    const b = await billRow(bill.id); const want = (USD.consult + USD.lab) * RATE;
    check('USD bill: total in USD', near(b.t, USD.consult + USD.lab, 0.001), JSON.stringify(b));
    check('USD bill: booked rate and base total stamped on the bill', b.r === RATE && near(b.b, want), JSON.stringify(b));
    check('USD bill: revenue in the ledger = total × booked rate', near(await revenue(bill.id), want), String(await revenue(bill.id)));
    check('USD bill: no revenue adjustment posted', (await adjustments(bill.id)) === 0);
    check('USD bill: sync posts nothing', sync(bill.id) === 0);
  }

  // 2. SSP (cash) bill
  {
    const pt = await newPatient(AFTER, 'T26');
    const r = await call(AFTER, 'POST', '/patient-bills', { patient_id: pt.id, patient_name: 'T26 cash', clinic_id: 1, created_by: 'T26', bill_date: today,
      services: [line(svc.consult)], total_amount: Number(svc.consult.price), paid_amount: 0, status: 'pending' });
    await call(AFTER, 'PUT', `/patient-bills/${r.body.id}/add-services`, { services: [line(svc.lab)] });
    const b = await billRow(r.body.id); const want = Number(svc.consult.price) + Number(svc.lab.price);
    check('SSP bill: base total = total, rate 1', b.r === 1 && b.b === want && b.t === want, JSON.stringify(b));
    check('SSP bill: revenue = total', near(await revenue(r.body.id), want, 0.01));
    check('SSP bill: sync posts nothing', sync(r.body.id) === 0 && (await adjustments(r.body.id)) === 0);
  }

  // 3. USD bill, four revenue categories, non-round rate
  let mixed;
  {
    mixed = await usdBill(['consult', 'lab', 'xray', 'dressing']);
    const want = Object.values(USD).reduce((a, b) => a + b, 0) * RATE;
    check('mixed USD bill: revenue = total × rate (within rounding)', near(await revenue(mixed.bill.id), want), `${await revenue(mixed.bill.id)} vs ${want.toFixed(2)}`);
    check('mixed USD bill: no adjustment, sync posts nothing', (await adjustments(mixed.bill.id)) === 0 && sync(mixed.bill.id) === 0);
  }

  // 4. Same bill after it is invoiced, claimed and the claim paid into the bank
  {
    const [b] = await q('SELECT * FROM patient_bills WHERE id = $1', [mixed.bill.id]);
    const services = (typeof b.services === 'string' ? JSON.parse(b.services) : b.services).filter((l) => !l.isVoided && !l.paid);
    const inv = await call(AFTER, 'POST', '/invoices', { bill_id: b.id, patient_id: b.patient_id, patient_name: b.patient_name, clinic_id: 1, amount: Number(b.balance_amount),
      currency: b.bill_currency, payment_terms: 30, notes: 'T26', services, scheme_id: schemeId, scheme_name: `T26 ${code}` });
    const invoiceId = inv.body.data?.id || inv.body.id;
    const cl = await call(AFTER, 'POST', '/insurance-claims', { scheme_id: schemeId, date_from: today, date_to: today, invoice_ids: [invoiceId], claim_amount: Number(b.total_amount) });
    const claimId = cl.body.data?.id || cl.body.id;
    for (const status of ['submitted', 'accepted']) await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status });
    const accts = (await call(AFTER, 'GET', `/insurance-claims/${claimId}/deposit-accounts`)).body.data || [];
    const bank = accts.find((a) => a.account_code === '1110') || accts[0];
    const paid = await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: Number(b.total_amount), deposit_account_id: bank?.id });
    check('claim paid', paid.ok && inv.ok && cl.ok, JSON.stringify({ inv: inv.status, cl: cl.status, paid: paid.status, e: paid.body?.error || cl.body?.error || inv.body?.error }));
    check('after the claim payment: sync posts nothing', sync(mixed.bill.id) === 0 && (await adjustments(mixed.bill.id)) === 0);
    const left = await receivable(mixed.bill.id, '1210', [claimId]);
    check('after the claim payment: insurance receivable cleared', near(left, 0, 0.06), String(left));
  }

  // 5. A bill carrying the old bug's reversal (revenue cut to its USD number) is put right
  {
    const { bill } = await usdBill(['consult', 'lab']);
    const want = Math.round((USD.consult + USD.lab) * RATE * 100) / 100;
    const cut = Math.round((want - (USD.consult + USD.lab)) * 100) / 100;
    const [rev] = await q(`SELECT c.id FROM chart_of_accounts c JOIN account_ledger al ON al.account_id = c.id JOIN general_ledger gl ON gl.id = al.transaction_id
                            WHERE gl.reference_id = $1 AND c.account_type = 'revenue' AND al.credit_amount > 0 ORDER BY al.credit_amount DESC LIMIT 1`, [String(bill.id)]);
    const [ar] = await q(`SELECT id FROM chart_of_accounts WHERE account_code = '1210' AND clinic_id = 1`);
    const [gl] = await q(`INSERT INTO general_ledger (id, clinic_id, gl_number, transaction_date, transaction_type, description, reference_id, reference_module, total_debit, total_credit,
                            base_total_debit, base_total_credit, is_posted, status, created_by, created_at, updated_at)
                          VALUES (gen_random_uuid(), 1, 'GL-T26-' || substr(md5(random()::text), 1, 8), $1, 'bill_revenue_adjustment', 'T26 old-bug reversal', $2, 'bill_revenue_adjustment',
                                  $3, $3, $3, $3, true, 'posted', 'T26', NOW(), NOW()) RETURNING id`, [today, String(bill.id), cut]);
    for (const [acct, d, c] of [[rev.id, cut, 0], [ar.id, 0, cut]]) {
      await q(`INSERT INTO account_ledger (id, clinic_id, account_id, transaction_id, transaction_date, debit_amount, credit_amount, description, is_posted, source_module, created_at, updated_at)
               VALUES (gen_random_uuid(), 1, $1, $2, $3, $4, $5, 'T26 old-bug reversal', true, 'bill_revenue_adjustment', NOW(), NOW())`, [acct, gl.id, today, d, c]);
    }
    check('planted: revenue cut to the USD number', near(await revenue(bill.id), USD.consult + USD.lab), String(await revenue(bill.id)));
    const fixed = sync(bill.id);
    check('repair: sync restores the cut amount', near(fixed, cut), String(fixed));
    check('repair: revenue = total × rate again', near(await revenue(bill.id), want), String(await revenue(bill.id)));
    check('repair: 1210 back to total × rate', near(await receivable(bill.id, '1210'), want), String(await receivable(bill.id, '1210')));
    check('repair: a second sync posts nothing', sync(bill.id) === 0);
  }
} finally {
  await q('DELETE FROM exchange_rates WHERE id = $1', [rateRow.id]);
}
await done();
process.exit(summary() ? 1 : 0);
