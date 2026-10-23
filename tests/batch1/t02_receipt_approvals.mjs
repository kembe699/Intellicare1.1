// #2 Receipt void/refund approval: a cashier's request goes pending, shows up in the
// approvals list, and an approver can approve (reverses payment) or reject (back to active).
import { BEFORE, AFTER, call, q, done, newPatient, serviceByName, newBill, line, ensureShift, pay, tokenFor, ledgerFor, check, summary } from './lib.mjs';

const CASHIER = tokenFor({ userId: 3, role: 'cashier', email: 'cashier@preview.local' });
const consult = await serviceByName('Consultation - General Practitioner');

async function paidReceipt(base) {
  await ensureShift(base);
  const p = await newPatient(base, 'T02');
  const bill = await newBill(base, p, [line(consult)]);
  const r = await pay(base, bill.id, 20000);
  if (!r.ok) throw new Error('pay failed ' + JSON.stringify(r.body));
  const [rc] = await q('SELECT id, receipt_number FROM receipts WHERE bill_id::text = $1', [bill.id]);
  return { bill, receipt: rc };
}

async function scenario(base) {
  const out = {};
  const a = await paidReceipt(base);
  const req = await call(base, 'PUT', `/receipts/${a.receipt.id}/status`, { status: 'voided', reason: 'Wrong patient' }, CASHIER);
  out.requestStatus = req.status; out.requestBody = req.body?.error || req.body?.message;
  const [{ status }] = await q('SELECT status::text FROM receipts WHERE id::text = $1', [a.receipt.id]);
  out.statusAfterRequest = status;
  const list = await call(base, 'GET', '/receipts/clinic/1?status=pending_void,pending_refund');
  out.inList = Array.isArray(list.body) && list.body.some((r) => r.id === a.receipt.id);
  out.cashierApprove = (await call(base, 'POST', `/receipts/${a.receipt.id}/approve-void`, { reason: 'x' }, CASHIER)).status;
  out.ledgerBefore = await ledgerFor([a.bill.id, a.receipt.receipt_number]);
  const approve = await call(base, 'POST', `/receipts/${a.receipt.id}/approve-void`, { reason: 'Confirmed wrong patient' });
  out.approve = approve.status;
  const [{ status: s2 }] = await q('SELECT status::text FROM receipts WHERE id::text = $1', [a.receipt.id]);
  out.statusAfterApprove = s2;
  const [b] = await q('SELECT paid_amount::float, balance_amount::float FROM patient_bills WHERE id = $1', [a.bill.id]);
  out.billAfterApprove = b;
  out.ledgerAfter = await ledgerFor([a.bill.id, a.receipt.receipt_number]);

  const r2 = await paidReceipt(base);
  await call(base, 'PUT', `/receipts/${r2.receipt.id}/status`, { status: 'refunded', reason: 'Asked for money back' }, CASHIER);
  const reject = await call(base, 'POST', `/receipts/${r2.receipt.id}/reject-void`, { reason: 'Service was given' });
  out.reject = reject.status;
  const [{ status: s3 }] = await q('SELECT status::text FROM receipts WHERE id::text = $1', [r2.receipt.id]);
  out.statusAfterReject = s3;
  return out;
}

const before = await scenario(BEFORE).catch((e) => ({ error: e.message }));
console.log('BEFORE', JSON.stringify(before));
check('before: a cashier void request never becomes a visible pending request',
  before.error || before.requestStatus >= 400 || !before.inList,
  `request ${before.requestStatus} (${before.requestBody}), status ${before.statusAfterRequest}, listed ${before.inList}`);

const after = await scenario(AFTER);
console.log('AFTER ', JSON.stringify(after));
check('after: cashier request accepted and parked as pending_void', after.requestStatus === 200 && after.statusAfterRequest === 'pending_void');
check('after: pending request appears in the approvals list', after.inList);
check('after: cashier cannot approve their own request (403)', after.cashierApprove === 403, `status ${after.cashierApprove}`);
check('after: approver approves → receipt voided', after.approve === 200 && after.statusAfterApprove === 'voided');
check('after: bill payment reversed (paid 0, balance 20,000)', after.billAfterApprove.paid_amount === 0 && after.billAfterApprove.balance_amount === 20000);
const cashBefore = after.ledgerBefore.find((r) => r.code === '1100')?.net || 0;
const cashAfter = after.ledgerAfter.find((r) => r.code === '1100')?.net || 0;
check('after: ledger cash for the bill goes from 20,000 to 0', cashBefore === 20000 && cashAfter === 0, `1100 ${cashBefore} → ${cashAfter}`);
check('after: rejected request goes back to active', after.reject === 200 && after.statusAfterReject === 'active');

await done();
process.exit(summary() ? 1 : 0);
