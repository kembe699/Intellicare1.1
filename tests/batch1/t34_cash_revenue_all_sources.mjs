// Cash-basis revenue counts ALL money received — patient receipts, invoice payments and insurer
// claim payments — in base currency, with tax collected taken out and shown as a liability. Every
// /revenue grouping gives the same total, equal to the income statement's cash revenue.
// (It used to read receipts only: a claim payment never counted, VAT landed in revenue, and
// grouping by item gave a different total from grouping by scheme.)
import { AFTER, call, q, done, newPatient, newBill, serviceByName, line, ensureShift, pay, check, summary, today } from './lib.mjs';

const RATE = 2799.37;
const near = (a, b, tol = 0.05) => Math.abs(a - b) < tol;
await q("DELETE FROM exchange_rates WHERE notes = 't34'"); // left by an earlier run that crashed
const [rateRow] = await q(`INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active, notes, created_at, updated_at)
  VALUES (gen_random_uuid(), 1, 'USD', 'SSP', $1, $2, true, 't34', NOW(), NOW()) RETURNING id`, [RATE, today]);
const consult = await serviceByName('Consultation - General Practitioner');
const cbc = await serviceByName('Complete Blood Count');
const [catRow] = await q('SELECT category_id::text cat FROM services WHERE id = $1', [consult.id]);
// Through tomorrow (UTC): the server dates some postings by its own local day.
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const D = `dateFrom=${today}&dateTo=${tomorrow}`;
const GROUPS = ['scheme', 'branch', 'payment_mode', 'item', 'department'];
const snapshot = async () => {
  const is = (await call(AFTER, 'GET', `/reports-v2/income-statement?${D}`)).body;
  const out = { isRevenue: is.totals.totalRevenue, isTax: is.totals.taxCollected, rev: {} };
  for (const g of GROUPS) {
    const r = (await call(AFTER, 'GET', `/reports-v2/revenue?${D}&groupBy=${g}`)).body;
    out.rev[g] = { total: r.totals.totalCollected, rowsSum: r.rows.reduce((s, x) => s + x.totalCollected, 0), tax: r.totals.taxCollected };
  }
  return out;
};

const tax = await call(AFTER, 'POST', '/tax-rates', { name: 'VAT', code: 'T34', rate: 18 });
const code = `T34${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
try {
  await call(AFTER, 'PUT', '/tax-rates/assign', { kind: 'category', id: catRow.cat, tax_rate_id: tax.body.id });
  await ensureShift(AFTER);
  const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T34 ${code}`, scheme_type: 'corporate', is_insurance: true,
    currency: 'USD', is_credit_allowed: true, payment_terms: 'net_30', has_copay: false, default_copay_percentage: 0 });
  const schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
  await call(AFTER, 'POST', `/schemes/${schemeId}/service-pricing`, { clinic_id: 1, service_id: cbc.id, scheme_price: 5, scheme_currency: 'USD', effective_from: today });

  const before = await snapshot();

  // A. Cash bill: consultation + 18% VAT, paid at the counter.
  const P = Number(consult.price);
  const billA = await newBill(AFTER, await newPatient(AFTER, 'T34'), [line(consult)]);
  const [a] = await q('SELECT total_amount::float t FROM patient_bills WHERE id = $1', [billA.id]);
  const payA = await pay(AFTER, billA.id, a.t);

  // B. USD scheme bill (CBC USD 5) → invoice → claim → paid by the insurer into the bank.
  const ptB = await newPatient(AFTER, 'T34');
  await call(AFTER, 'POST', `/schemes/patient-schemes/${ptB.id}`, { scheme_id: schemeId, clinic_id: 1, member_number: 'T34-1' });
  const billB = (await call(AFTER, 'POST', '/patient-bills', { patient_id: ptB.id, patient_name: 'T34 B', clinic_id: 1, created_by: 'T34', bill_date: today, status: 'pending',
    paid_amount: 0, scheme_id: schemeId, total_amount: 1, services: [line(cbc)] })).body;
  const [bRow] = await q('SELECT * FROM patient_bills WHERE id = $1', [billB.id]);
  const invB = await call(AFTER, 'POST', '/invoices', { bill_id: bRow.id, patient_id: bRow.patient_id, patient_name: bRow.patient_name, clinic_id: 1, amount: Number(bRow.balance_amount),
    currency: bRow.bill_currency, payment_terms: 30, services: typeof bRow.services === 'string' ? JSON.parse(bRow.services) : bRow.services, scheme_id: schemeId, scheme_name: `T34 ${code}` });
  const cl = await call(AFTER, 'POST', '/insurance-claims', { scheme_id: schemeId, date_from: today, date_to: today, invoice_ids: [invB.body.data?.id || invB.body.id], claim_amount: Number(bRow.total_amount) });
  const claimId = cl.body.data?.id || cl.body.id;
  for (const status of ['submitted', 'accepted']) await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status });
  const bank = ((await call(AFTER, 'GET', `/insurance-claims/${claimId}/deposit-accounts`)).body.data || []).find((x) => x.account_code === '1110');
  const paidB = await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: Number(bRow.total_amount), deposit_account_id: bank?.id });

  // C. SSP bill (CBC, untaxed) → credit invoice → invoice payment.
  const billC = await newBill(AFTER, await newPatient(AFTER, 'T34'), [line(cbc)]);
  const [cRow] = await q('SELECT * FROM patient_bills WHERE id = $1', [billC.id]);
  const invC = await call(AFTER, 'POST', '/invoices', { bill_id: cRow.id, patient_id: cRow.patient_id, patient_name: cRow.patient_name, clinic_id: 1, amount: Number(cRow.balance_amount),
    currency: cRow.bill_currency || 'SSP', payment_terms: 30, services: typeof cRow.services === 'string' ? JSON.parse(cRow.services) : cRow.services });
  const payC = await call(AFTER, 'POST', `/invoices/${invC.body.data?.id || invC.body.id}/payments`, { amount: Number(cRow.total_amount), payment_method: 'bank_transfer', payment_date: today });

  check('setup: receipt, claim payment and invoice payment recorded', payA.ok && paidB.ok && payC.ok,
    JSON.stringify({ a: payA.status, b: paidB.status, c: payC.status, e: payA.body?.error || paidB.body?.error || payC.body?.error }));

  const after = await snapshot();
  const wantRevenue = P + 5 * RATE + Number(cRow.total_amount);
  const wantTax = Math.round(P * 0.18 * 100) / 100;
  const dRev = after.isRevenue - before.isRevenue;
  const dTax = after.isTax - before.isTax;
  check('income statement (cash): revenue adds receipt + claim + invoice payment, VAT excluded', near(dRev, wantRevenue), `${dRev.toFixed(2)} vs ${wantRevenue.toFixed(2)}`);
  check('income statement (cash): VAT shown as tax collected', near(dTax, wantTax), `${dTax.toFixed(2)} vs ${wantTax}`);
  for (const g of GROUPS) {
    const d = after.rev[g].total - before.rev[g].total;
    check(`/revenue by ${g}: same revenue (${wantRevenue.toFixed(2)}), rows add up to the total`,
      near(d, wantRevenue) && near(after.rev[g].rowsSum, after.rev[g].total), `${d.toFixed(2)}; rows ${after.rev[g].rowsSum.toFixed(2)} / total ${after.rev[g].total.toFixed(2)}`);
  }
  check('/revenue: every grouping has the same total and tax', GROUPS.every((g) => near(after.rev[g].total, after.rev.scheme.total) && near(after.rev[g].tax, after.rev.scheme.tax)));
  check('/revenue total = income statement cash revenue', near(after.rev.scheme.total, after.isRevenue), `${after.rev.scheme.total} vs ${after.isRevenue}`);
} finally {
  await call(AFTER, 'PUT', '/tax-rates/assign', { kind: 'category', id: catRow.cat, tax_rate_id: null });
  if (tax.body?.id) await call(AFTER, 'DELETE', `/tax-rates/${tax.body.id}`);
  await q('DELETE FROM exchange_rates WHERE id = $1', [rateRow.id]);
}
await done();
process.exit(summary() ? 1 : 0);
