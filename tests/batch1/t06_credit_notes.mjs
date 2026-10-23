// #6 Applying a credit note lowers the bill's total/balance and leaves paid_amount (cash collected) alone.
import { BEFORE, AFTER, call, q, done, newPatient, serviceByName, newBill, line, ensureShift, pay, check, summary } from './lib.mjs';

const consult = await serviceByName('Consultation - General Practitioner');
const cbc = await serviceByName('Complete Blood Count');
const inj = await serviceByName('Injection Administration');

async function revenueFor(billId, noteId) {
  const [r] = await q(`
    SELECT COALESCE(SUM(al.credit_amount - al.debit_amount), 0)::float AS revenue
      FROM account_ledger al
      JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
      JOIN general_ledger gl ON gl.id::text = al.transaction_id::text
     WHERE gl.reference_id::text IN ($1, $2)`, [billId, noteId]);
  return r.revenue;
}

async function scenario(base) {
  await ensureShift(base);
  const p = await newPatient(base, 'T06');
  const bill = await newBill(base, p, [line(consult), line(cbc)]);
  await pay(base, bill.id, 10000);
  const cn = await call(base, 'POST', '/billing/credit-notes', { original_bill_id: bill.id, credit_amount: 5000, credit_currency: 'SSP', reason: 'adjustment', reason_details: 'Goodwill' });
  await call(base, 'PUT', `/billing/credit-notes/${cn.body.id}/approve`, {});
  const apply = await call(base, 'PUT', `/billing/credit-notes/${cn.body.id}/apply`, {});
  const [b1] = await q('SELECT total_amount::float t, paid_amount::float p, balance_amount::float b FROM patient_bills WHERE id = $1', [bill.id]);
  const rev1 = await revenueFor(bill.id, cn.body.id);
  // add-services runs the revenue sync — it must not reverse the credit a second time
  await call(base, 'PUT', `/patient-bills/${bill.id}/add-services`, { services: [line(inj)] });
  const [b2] = await q('SELECT total_amount::float t, paid_amount::float p, balance_amount::float b FROM patient_bills WHERE id = $1', [bill.id]);
  const rev2 = await revenueFor(bill.id, cn.body.id);
  const over = await call(base, 'POST', '/billing/credit-notes', { original_bill_id: bill.id, credit_amount: 999999, credit_currency: 'SSP', reason: 'adjustment' });
  await call(base, 'PUT', `/billing/credit-notes/${over.body.id}/approve`, {});
  const overApply = await call(base, 'PUT', `/billing/credit-notes/${over.body.id}/apply`, {});
  return { apply: apply.status, b1, rev1, b2, rev2, overApply: overApply.status, overError: overApply.body?.error };
}

const before = await scenario(BEFORE);
console.log('BEFORE', JSON.stringify(before));
// Baseline code runs `paid_amount = paid_amount + credit` with a text CASE for status: on text-status
// tenants (the real schema, pgout/1_schema.sql) that inflates paid_amount; on enum-status schemas like this
// preview it fails outright. Either way the credit can't be applied correctly.
check('before: credit either inflates paid_amount (10,000 → 15,000) or the apply fails',
  before.b1.p === 15000 || before.apply === 500, `apply ${before.apply}, bill ${JSON.stringify(before.b1)}`);

const after = await scenario(AFTER);
console.log('AFTER ', JSON.stringify(after));
check('after: credit applied', after.apply === 200);
check('after: paid_amount unchanged at 10,000', after.b1.p === 10000, JSON.stringify(after.b1));
check('after: total 45,000 → 40,000, balance 35,000 → 30,000', after.b1.t === 40000 && after.b1.b === 30000);
check('after: ledger revenue for the bill = 40,000 (matches the bill)', after.rev1 === 40000, String(after.rev1));
check('after: adding a 5,000 item keeps ledger revenue = bill total (no double reversal)', after.b2.t === 45000 && after.rev2 === 45000, `total ${after.b2.t}, revenue ${after.rev2}`);
check('after: a credit bigger than what is owed is refused', after.overApply === 400, after.overError);

await done();
process.exit(summary() ? 1 : 0);
