// #16 Separate pay privileges: granted on day one to exactly the roles that could pay before,
// and enforced on the server (revoking the pay privilege blocks paying, not preparing).
import { BEFORE, AFTER, call, q, done, today, tokenFor, check, summary } from './lib.mjs';

const CASHIER = tokenFor({ userId: 3, role: 'cashier', email: 'cashier@preview.local' });
const HR = tokenFor({ userId: 5, role: 'hr', email: 'hr@preview.local' });

// 1. Day-one grants equal the source grants, per tenant.
const pairs = [['expenses.pay', 'expenses.write'], ['supplier_bills.pay', 'expenses.write'], ['consultant_bills.pay', 'expenses.write'],
  ['payroll.pay', 'hr.payroll.write'], ['salary_advances.disburse', 'hr.salary_advances.write']];
const rolesWith = async (key) => (await q(`SELECT r.role_key FROM role_privileges rp JOIN roles r ON r.id = rp.role_id JOIN privileges p ON p.id = rp.privilege_id WHERE p.privilege_key = $1 ORDER BY 1`, [key])).map((r) => r.role_key).join(',');
for (const [k, src] of pairs) {
  const a = await rolesWith(k), b = await rolesWith(src);
  check(`day one: ${k} held by exactly the roles holding ${src}`, a === b && a.length > 0, `${k}=[${a}] ${src}=[${b}]`);
}
const approvers = (await q(`SELECT DISTINCT u.role FROM approval_permissions ap JOIN users u ON u.id = ap.user_id WHERE ap.approval_type IN ('receipt_void_approve','deposit_refund_approve') ORDER BY 1`)).map((r) => r.role).join(',');
check('day one: refunds.approve held by the roles of users with refund approval rights', (await rolesWith('refunds.approve')) === approvers, `[${await rolesWith('refunds.approve')}] vs [${approvers}]`);

// Helpers to revoke/restore one privilege from a role through the Roles API (clears the auth cache).
async function setGrant(roleKey, privKey, on) {
  const [role] = await q('SELECT id FROM roles WHERE role_key = $1', [roleKey]);
  const [priv] = await q('SELECT id FROM privileges WHERE privilege_key = $1', [privKey]);
  const current = (await q('SELECT privilege_id FROM role_privileges WHERE role_id = $1', [role.id])).map((r) => r.privilege_id);
  const next = on ? [...new Set([...current, priv.id])] : current.filter((id) => id !== priv.id);
  const r = await call(AFTER, 'PUT', `/roles/${role.id}/privileges`, { privilege_ids: next });
  await call(BEFORE, 'PUT', `/roles/${role.id}/privileges`, { privilege_ids: next }); // clear that server's cache too
  if (!r.ok) throw new Error('roles api ' + JSON.stringify(r.body));
}

const [cat] = await q("SELECT id FROM categories WHERE type = 'expense' AND name = 'Office Supplies' LIMIT 1");
const [cash] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1100'");
async function approvedExpense(base) {
  const e = await call(base, 'POST', '/daily-expenses', { description: 'T16 expense', amount: 1000, category: 'Office Supplies', category_id: cat.id, account_id: cash.id, expense_date: today, payment_method: 'cash' });
  for (let i = 0; i < 2; i++) await call(base, 'POST', `/daily-expenses/${e.body.id}/approve`, { approved_by_title: 'Admin', notes: 'ok' });
  return e.body.id;
}

// 2. Day one: the cashier can still pay.
check('day one: cashier can still pay an approved expense', (await call(AFTER, 'POST', `/daily-expenses/${await approvedExpense(AFTER)}/pay`, {}, CASHIER)).status === 200);

// 3. Revoke expenses.pay from cashier: paying is blocked on the server, preparing still works.
await setGrant('cashier', 'expenses.pay', false);
try {
  const beforePay = await call(BEFORE, 'POST', `/daily-expenses/${await approvedExpense(BEFORE)}/pay`, {}, CASHIER);
  check('before: paying only needed expenses.write — cashier still pays (no separation possible)', beforePay.status === 200, `status ${beforePay.status}`);
  const afterPay = await call(AFTER, 'POST', `/daily-expenses/${await approvedExpense(AFTER)}/pay`, {}, CASHIER);
  check('after: without expenses.pay, the server refuses the payment (403)', afterPay.status === 403, `status ${afterPay.status}`);
  const create = await call(AFTER, 'POST', '/daily-expenses', { description: 'T16 still allowed', amount: 500, category: 'Office Supplies', category_id: cat.id, account_id: cash.id, expense_date: today }, CASHIER);
  check('after: the same cashier can still raise expenses (expenses.write)', create.status === 201, `status ${create.status}`);
} finally {
  await setGrant('cashier', 'expenses.pay', true);
}

// 4. Revoke payroll.pay from HR: HR can prepare payroll but not pay it.
const [emp] = await q("SELECT id FROM employees WHERE first_name = 'Test' AND last_name = 'Employee'");
async function approvedLine(base) {
  let y, m;
  for (;;) { y = 2200 + Math.floor(Math.random() * 300); m = 1 + Math.floor(Math.random() * 12);
    if (!(await q("SELECT 1 FROM payroll_runs WHERE period_year=$1 AND period_month=$2 AND status!='cancelled'", [y, m])).length) break; }
  const run = await call(base, 'POST', '/hr/payroll/runs', { period_month: m, period_year: y, employee_ids: [emp.id], payment_account_id: cash.id }, HR);
  await call(base, 'POST', `/hr/payroll/runs/${run.body.id}/approve`, {});
  const [line] = await q('SELECT id FROM payroll_run_lines WHERE payroll_run_id = $1', [run.body.id]);
  return { runStatus: run.status, runId: run.body.id, lineId: line.id };
}
await setGrant('hr', 'payroll.pay', false);
try {
  const b = await approvedLine(BEFORE);
  const bp = await call(BEFORE, 'POST', `/hr/payroll/runs/${b.runId}/lines/${b.lineId}/pay`, {}, HR);
  check('before: HR pays payroll with just hr.payroll.write', bp.status === 200, `status ${bp.status}`);
  const a = await approvedLine(AFTER);
  check('after: HR can still prepare a payroll run', a.runStatus === 201);
  const ap = await call(AFTER, 'POST', `/hr/payroll/runs/${a.runId}/lines/${a.lineId}/pay`, {}, HR);
  check('after: without payroll.pay, HR is refused paying the line (403)', ap.status === 403, `status ${ap.status}`);
  const qr = await call(AFTER, 'POST', `/hr/payroll/runs/${a.runId}/lines/${a.lineId}/signing-link`, { origin: 'http://localhost' }, HR);
  check('after: …and refused generating the pay-by-signature QR (403)', qr.status === 403, `status ${qr.status}`);
} finally {
  await setGrant('hr', 'payroll.pay', true);
}

// 5. refunds.approve gates approving a void on the server.
const anyReceipt = (await q("SELECT id FROM receipts WHERE status::text = 'active' LIMIT 1"))[0];
const cashierApprove = await call(AFTER, 'POST', `/receipts/${anyReceipt.id}/approve-void`, { reason: 'x' }, CASHIER);
check('after: a role without refunds.approve cannot approve a void (403)', cashierApprove.status === 403, `status ${cashierApprove.status}`);

await done();
process.exit(summary() ? 1 : 0);
