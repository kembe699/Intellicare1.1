// Setup › Configurations — each approval/control setting is enforced by the server.
// Restores the clinic's original settings at the end.
import { AFTER, call, q, done, today, tokenFor, check, summary } from './lib.mjs';

const CASHIER = tokenFor({ userId: 3, role: 'cashier', email: 'cashier@preview.local' });
const orig = (await call(AFTER, 'GET', '/facility-settings')).body;
const set = (patch) => call(AFTER, 'PUT', '/facility-settings', { ...patch });
const [cat] = await q("SELECT id FROM categories WHERE type = 'expense' AND name = 'Office Supplies' LIMIT 1");
const [cash] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1105'");
const newExpense = async () => (await call(AFTER, 'POST', '/daily-expenses', { description: 'T19', amount: 100, category: 'Office Supplies', category_id: cat.id, account_id: cash.id, expense_date: today, payment_method: 'cash' })).body.id;
const status = async (id) => (await q('SELECT status FROM daily_expenses WHERE id = $1', [id]))[0].status;

// The preview admin is a per-user sole approver for expenses; switch that off for the test.
const [soleRow] = await q("SELECT sole_approver FROM approval_permissions WHERE user_id = 1 AND approval_type = 'expense_approve'");
await q("UPDATE approval_permissions SET sole_approver = false WHERE user_id = 1 AND approval_type = 'expense_approve'");
try {
  check('defaults: 2 expense approvals, 3 supplier-bill approvals, separate approvers', orig.expense_approvals_required === 2 && orig.supplier_bill_approvals_required === 3 && orig.approvals_allow_same_person === false && orig.receipt_void_requires_approval === true, JSON.stringify(orig));
  check('a cashier cannot change configurations', (await call(AFTER, 'PUT', '/facility-settings', { approvals_allow_same_person: true }, CASHIER)).status === 403);

  // Same person — off: second approval by the same user is refused
  await set({ approvals_allow_same_person: false, expense_approvals_required: 2 });
  let e = await newExpense();
  await call(AFTER, 'POST', `/daily-expenses/${e}/approve`, { notes: 'a' });
  const refused = await call(AFTER, 'POST', `/daily-expenses/${e}/approve`, { notes: 'b' });
  check('same person off: the same user cannot give the second approval', refused.status === 400 && /different approver/.test(refused.body.error), refused.body.error);

  // Same person — on: allowed, and the expense becomes approved
  await set({ approvals_allow_same_person: true });
  const ok2 = await call(AFTER, 'POST', `/daily-expenses/${e}/approve`, { notes: 'b' });
  check('same person on: the same user can give the second approval', ok2.status === 201 && (await status(e)) === 'approved', `${ok2.status} ${await status(e)}`);

  // One approval required: a fresh expense is approved after one
  await set({ approvals_allow_same_person: false, expense_approvals_required: 1 });
  e = await newExpense();
  const one = await call(AFTER, 'POST', `/daily-expenses/${e}/approve`, { notes: 'a' });
  check('1 approval required: one approval approves the expense and issues a voucher', one.status === 201 && one.body.voucher_number && (await status(e)) === 'approved', JSON.stringify(one.body));

  // Lowering the count completes an expense already waiting with enough approvals
  await set({ expense_approvals_required: 2 });
  e = await newExpense();
  await call(AFTER, 'POST', `/daily-expenses/${e}/approve`, { notes: 'a' });
  await set({ expense_approvals_required: 1 });
  const finish = await call(AFTER, 'POST', `/daily-expenses/${e}/approve`, { notes: 'again' });
  check('count lowered to 1: an expense with 1 approval can be finished, not stuck', finish.ok && (await status(e)) === 'approved', JSON.stringify(finish.body));

  // Supplier bills: 1 approval lets it be paid
  await set({ supplier_bill_approvals_required: 1 });
  const [po] = await q("SELECT id, clinic_id FROM purchase_orders WHERE status IN ('authorized','received') AND COALESCE(paid_amount,0) < total_amount AND id NOT IN (SELECT po_id::int FROM supplier_bill_approvals) ORDER BY id DESC LIMIT 1");
  if (po) {
    const a1 = await call(AFTER, 'POST', `/daily-expenses/supplier-bills/${po.id}/approve`, { approved_by_title: 'Admin', notes: 't19' });
    const a2 = await call(AFTER, 'POST', `/daily-expenses/supplier-bills/${po.id}/approve`, { approved_by_title: 'Admin', notes: 't19' });
    check('supplier bill, 1 required: first approval accepted, a second refused as already complete', a1.status === 201 && a2.status === 400, `${a1.status} ${a2.status} ${a2.body?.error}`);
    await q('DELETE FROM supplier_bill_approvals WHERE po_id = $1', [String(po.id)]);
  }

  // Credit notes: creator may not approve when switched on
  const [bill] = await q("SELECT id FROM patient_bills WHERE balance_amount > 100 ORDER BY created_at DESC LIMIT 1");
  await set({ credit_note_separate_approver: true });
  const cn = await call(AFTER, 'POST', '/billing/credit-notes', { original_bill_id: bill.id, credit_amount: 10, reason: 'price_adjustment', reason_details: 'T19' });
  const own = await call(AFTER, 'PUT', `/billing/credit-notes/${cn.body.id}/approve`, {});
  check('credit note rule on: the creator cannot approve their own credit note', own.status === 400, `${own.status} ${own.body?.error}`);
  await set({ credit_note_separate_approver: false });
  const own2 = await call(AFTER, 'PUT', `/billing/credit-notes/${cn.body.id}/approve`, {});
  check('credit note rule off: the creator can approve it (previous behaviour)', own2.ok && own2.body.status === 'approved', `${own2.status}`);
  await q("DELETE FROM credit_notes WHERE id = $1", [cn.body.id]);
} finally {
  if (soleRow) await q("UPDATE approval_permissions SET sole_approver = $1 WHERE user_id = 1 AND approval_type = 'expense_approve'", [soleRow.sole_approver]);
  await set({
    approvals_allow_same_person: orig.approvals_allow_same_person, expense_approvals_required: orig.expense_approvals_required,
    supplier_bill_approvals_required: orig.supplier_bill_approvals_required, receipt_void_requires_approval: orig.receipt_void_requires_approval,
    credit_note_separate_approver: orig.credit_note_separate_approver,
  });
}
const back = (await call(AFTER, 'GET', '/facility-settings')).body;
check('settings restored', back.expense_approvals_required === orig.expense_approvals_required && back.approvals_allow_same_person === orig.approvals_allow_same_person);
await done();
process.exit(summary() ? 1 : 0);
