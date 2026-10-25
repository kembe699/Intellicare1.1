// Cash flow counts money in and out of the hospital, not money moved between its own cash and bank
// accounts: with 1105 Cash at Hand flagged as a cash account, a transfer 1100 → 1105 nets to zero.
// It used to show as an outflow from 1100 with the inflow to 1105 nowhere. An insurer's claim
// payment into the bank is cash in.
import { AFTER, call, q, done, newPatient, serviceByName, line, check, summary, today } from './lib.mjs';

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const D = `dateFrom=${today}&dateTo=${tomorrow}&allBranches=true`;
const [cash] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1100' AND clinic_id = 1");
const [hand] = await q("SELECT id, is_bank_account FROM chart_of_accounts WHERE account_code = '1105' AND clinic_id = 1");
const flow = async () => (await call(AFTER, 'GET', `/reports-v2/accounting/cash-flow?${D}`)).body;
const netOf = (f) => (f.rows || []).reduce((s, r) => s + r.netChange, 0);
const near = (a, b) => Math.abs(a - b) < 0.01;

try {
  const flag = await call(AFTER, 'PUT', `/accounting/chart-of-accounts/${hand.id}`, { is_bank_account: true });
  check('1105 Cash at Hand flagged as a cash account (through the API)', flag.ok, JSON.stringify({ s: flag.status, e: flag.body?.error }));

  // Fund 1100 so the transfer is allowed (a posted journal entry from 3200), then move 5,000 to 1105.
  const [equity] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '3200' AND clinic_id = 1");
  const fund = (await call(AFTER, 'POST', '/accounting/journal-entries', { clinic_id: 1, entry_date: today, description: 'T36 funding', reference: 'T36',
    lines: [{ account_id: cash.id, debit_amount: 50000000, credit_amount: 0 }, { account_id: equity.id, debit_amount: 0, credit_amount: 50000000 }] })).body;
  for (const step of ['submit', 'approve', 'post']) await call(AFTER, 'POST', `/accounting/journal-entries/${fund.id}/${step}`, {});
  const before = await flow();
  const t = await call(AFTER, 'POST', '/cash-transfers', { from_account_id: cash.id, to_account_id: hand.id, amount: 5000, notes: 'T36 float' });
  const afterTransfer = await flow();
  check('transfer recorded', t.ok, JSON.stringify({ s: t.status, e: t.body?.error || t.body?.details }));
  check('cash flow: an internal transfer changes nothing', near(netOf(afterTransfer), netOf(before)) && !(afterTransfer.rows || []).some((r) => r.sourceModule === 'cash_transfer'),
    JSON.stringify({ before: netOf(before), after: netOf(afterTransfer), rows: afterTransfer.rows }));
  const detail = (await call(AFTER, 'GET', `/reports-v2/accounting/cash-flow?${D}&detail=true`)).body;
  check('cash flow detail: the transfer\'s two legs are not listed', !(detail.rows || []).some((r) => /T36 float|Transfer (to|from)/.test(r.description || '') && r.sourceModule === 'cash_transfer'));

  // An insurer pays a claim into the bank: cash in.
  const consult = await serviceByName('Consultation - General Practitioner');
  const code = `T36${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T36 ${code}`, scheme_type: 'corporate', is_insurance: true, currency: 'SSP', is_credit_allowed: true });
  const schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
  await call(AFTER, 'POST', `/schemes/${schemeId}/service-pricing`, { clinic_id: 1, service_id: consult.id, scheme_price: 20000, scheme_currency: 'SSP', effective_from: today });
  const pt = await newPatient(AFTER, 'T36');
  await call(AFTER, 'POST', `/schemes/patient-schemes/${pt.id}`, { scheme_id: schemeId, clinic_id: 1, member_number: 'T36-1' });
  const bill = (await call(AFTER, 'POST', '/patient-bills', { patient_id: pt.id, patient_name: 'T36', clinic_id: 1, created_by: 'T36', bill_date: today, status: 'pending', paid_amount: 0, scheme_id: schemeId, total_amount: 1, services: [line(consult)] })).body;
  const [b] = await q('SELECT * FROM patient_bills WHERE id = $1', [bill.id]);
  const inv = await call(AFTER, 'POST', '/invoices', { bill_id: b.id, patient_id: b.patient_id, patient_name: b.patient_name, clinic_id: 1, amount: Number(b.balance_amount), currency: 'SSP',
    payment_terms: 30, services: typeof b.services === 'string' ? JSON.parse(b.services) : b.services, scheme_id: schemeId });
  const cl = await call(AFTER, 'POST', '/insurance-claims', { scheme_id: schemeId, date_from: today, date_to: today, invoice_ids: [inv.body.data?.id || inv.body.id], claim_amount: Number(b.total_amount) });
  const claimId = cl.body.data?.id || cl.body.id;
  for (const status of ['submitted', 'accepted']) await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status });
  const bank = ((await call(AFTER, 'GET', `/insurance-claims/${claimId}/deposit-accounts`)).body.data || []).find((x) => x.account_code === '1110');
  await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: Number(b.total_amount), deposit_account_id: bank?.id });
  const afterClaim = await flow();
  check(`cash flow: the claim payment (${b.total_amount}) is cash in`, near(netOf(afterClaim) - netOf(afterTransfer), Number(b.total_amount)), `${netOf(afterClaim) - netOf(afterTransfer)}`);
} finally {
  await call(AFTER, 'PUT', `/accounting/chart-of-accounts/${hand.id}`, { is_bank_account: hand.is_bank_account });
}
await done();
process.exit(summary() ? 1 : 0);
