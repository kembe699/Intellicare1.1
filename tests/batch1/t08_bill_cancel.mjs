// #8 Posted/paid bills can't be deleted; "Cancel bill" reverses every posting at the original rate.
import { randomUUID } from 'crypto';
import { BEFORE, AFTER, call, q, done, newPatient, serviceByName, newBill, line, ensureShift, pay, tokenFor, check, summary } from './lib.mjs';

const CASHIER = tokenFor({ userId: 3, role: 'cashier', email: 'cashier@preview.local' });
const consult = await serviceByName('Consultation - General Practitioner');
const cbc = await serviceByName('Complete Blood Count');
const [drug] = await q("SELECT id, item_name AS service_name, selling_price AS price FROM inventory_items WHERE item_code = 'DRG-AMX500'");

const billLinkedNet = (billId) => q(`
  SELECT c.account_code AS code, ROUND(SUM(li.debit_amount - li.credit_amount)::numeric, 2)::float AS net
    FROM general_ledger gl JOIN gl_line_items li ON li.gl_id::text = gl.id::text
    JOIN chart_of_accounts c ON c.id = li.account_id
   WHERE (gl.reference_id::text = $1 AND gl.reference_module IN ('patient_billing','bill_item_void','bill_revenue_adjustment','pharmacy_bill_cogs','bill_cancellation'))
      OR (gl.reference_module = 'billing_discount' AND gl.reference_id::text IN (SELECT id::text FROM bill_discounts WHERE bill_id::text = $1))
   GROUP BY 1 ORDER BY 1`, [billId]);

async function scenario(base) {
  const o = {};
  await ensureShift(base);
  // 1. delete a posted bill
  const p1 = await newPatient(base, 'T08');
  const posted = await newBill(base, p1, [line(consult)]);
  o.deletePosted = (await call(base, 'DELETE', `/patient-bills/${posted.id}`)).status;
  o.glAfterDelete = (await q('SELECT COUNT(*)::int n FROM general_ledger WHERE reference_id::text = $1', [posted.id]))[0].n;
  o.billExistsAfterDelete = (await q('SELECT COUNT(*)::int n FROM patient_bills WHERE id = $1', [posted.id]))[0].n;

  // 2. delete an unposted bill (bare fixture row, never reached the ledger)
  const bare = randomUUID();
  await q(`INSERT INTO patient_bills (id, bill_number, patient_id, patient_name, clinic_id, total_amount, paid_amount, balance_amount, status, bill_date, services, created_by, branch_id, created_at, updated_at)
           VALUES ($1, $2, $3, 'T08 bare', 1, 0, 0, 0, 'pending', CURRENT_DATE, '[]', 'T08', 1, NOW(), NOW())`, [bare, `T08-${bare.slice(0, 8)}`, p1.id]);
  o.deleteBare = (await call(base, 'DELETE', `/patient-bills/${bare}`)).status;

  // 3. cancel: refused with a payment, reason required, privilege enforced, then full reversal
  const p2 = await newPatient(base, 'T08');
  const bill = await newBill(base, p2, [line(consult), line(cbc), line(drug, 10)]);
  await call(base, 'POST', `/billing/bills/${bill.id}/discounts`, { discount_type: 'fixed_amount', discount_amount: 2000, reason: 'T08 discount' });
  o.netBeforeCancel = await billLinkedNet(bill.id);
  const paid = await newBill(base, await newPatient(base, 'T08'), [line(consult)]);
  await pay(base, paid.id, 5000);
  o.cancelPaid = await call(base, 'POST', `/patient-bills/${paid.id}/cancel`, { reason: 'Wrong patient' });
  o.cancelNoReason = (await call(base, 'POST', `/patient-bills/${bill.id}/cancel`, { reason: '' })).status;
  o.cancelCashier = (await call(base, 'POST', `/patient-bills/${bill.id}/cancel`, { reason: 'Wrong patient' }, CASHIER)).status;
  o.cancel = await call(base, 'POST', `/patient-bills/${bill.id}/cancel`, { reason: 'Billed to the wrong patient' });
  const [b] = await q('SELECT status::text, balance_amount::float b, cancellation_reason FROM patient_bills WHERE id = $1', [bill.id]);
  o.billAfterCancel = b;
  o.netAfterCancel = await billLinkedNet(bill.id);
  o.payCancelled = (await pay(base, bill.id, 1000)).status;
  return o;
}

const before = await scenario(BEFORE);
console.log('BEFORE', JSON.stringify({ ...before, netBeforeCancel: undefined }));
check('before: deleting a posted bill succeeds and leaves its ledger entries orphaned',
  before.deletePosted === 200 && before.billExistsAfterDelete === 0 && before.glAfterDelete > 0, `delete ${before.deletePosted}, GL entries left ${before.glAfterDelete}`);
check('before: no cancel action exists', before.cancel.status === 404);

const after = await scenario(AFTER);
console.log('AFTER ', JSON.stringify({ ...after, netBeforeCancel: undefined }));
check('after: deleting a posted bill refused (409), bill and entries kept', after.deletePosted === 409 && after.billExistsAfterDelete === 1);
check('after: a bill with no postings can still be deleted', after.deleteBare === 200);
check('after: cancel refused while the bill has a payment', after.cancelPaid.status === 409 && /Void or refund its receipts first/.test(after.cancelPaid.body.error), after.cancelPaid.body.error);
check('after: cancel without a reason refused (400)', after.cancelNoReason === 400);
check('after: cashier without bills.cancel refused (403)', after.cancelCashier === 403);
check('after: cancel succeeds and marks the bill cancelled with balance 0', after.cancel.status === 200 && after.billAfterCancel.status === 'cancelled' && after.billAfterCancel.b === 0, JSON.stringify(after.billAfterCancel));
const nonZeroBefore = after.netBeforeCancel.filter((r) => r.net !== 0);
const nonZeroAfter = after.netAfterCancel.filter((r) => r.net !== 0);
check('after: before cancelling, the bill had postings on receivable, revenue, COGS, inventory and discount',
  ['1200', '5210', '1310', '5230'].every((code) => nonZeroBefore.some((r) => r.code === code))
    && nonZeroBefore.filter((r) => r.code.startsWith('41')).length >= 2, JSON.stringify(after.netBeforeCancel));
check('after: every account the bill touched nets to exactly 0 after cancelling', nonZeroAfter.length === 0, JSON.stringify(after.netAfterCancel));
check('after: payment on a cancelled bill refused (409)', after.payCancelled === 409);

await done();
process.exit(summary() ? 1 : 0);
