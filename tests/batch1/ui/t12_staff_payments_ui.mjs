// #12 Staff Payments: an approved payroll line is paid from Accounting › Payments › Staff Payments
// (existing pay endpoint), approved advances are listed for disbursement, and HR shows
// "Pay in Accounting" instead of pay buttons.
import { randomUUID } from 'crypto';
import { chromium } from 'playwright';
import { AFTER, call, q, done, tokenFor, check, summary } from '../lib.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:8093';
const [emp] = await q("SELECT id FROM employees WHERE first_name = 'Test' AND last_name = 'Employee'");
const [cash] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1105'");
let y, m;
for (;;) { y = 2140 + Math.floor(Math.random() * 50); m = 1 + Math.floor(Math.random() * 12);
  if (!(await q("SELECT 1 FROM payroll_runs WHERE period_year=$1 AND period_month=$2 AND status!='cancelled'", [y, m])).length) break; }
const run = await call(AFTER, 'POST', '/hr/payroll/runs', { period_month: m, period_year: y, employee_ids: [emp.id], payment_account_id: cash.id });
await call(AFTER, 'POST', `/hr/payroll/runs/${run.body.id}/approve`, {});
const [line] = await q('SELECT id FROM payroll_run_lines WHERE payroll_run_id = $1', [run.body.id]);
// Our own approved, not-yet-disbursed advance (earlier runs' payroll deductions repay any shared one).
const advNo = `ADV-T12-${randomUUID().slice(0, 4).toUpperCase()}`;
await q(`INSERT INTO salary_advances (id, clinic_id, branch_id, employee_id, advance_number, amount, currency, reason, request_date, status, balance_remaining, exchange_rate, base_currency_amount, created_by, approved_by, approved_at, created_at, updated_at)
         VALUES ($1, 1, 1, $2, $3, 100, 'SSP', 'T12 fixture', CURRENT_DATE, 'approved', 100, 1, 100, 1, 1, NOW(), NOW(), NOW())`, [randomUUID(), emp.id, advNo]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem('auth_token', t), tokenFor());
const page = await ctx.newPage();

await page.goto(`${BASE}/accounting/payments/staff`, { waitUntil: 'networkidle' });
await page.waitForSelector(`text=${run.body.run_number}`, { timeout: 20000 });
const row = page.locator('tr', { hasText: run.body.run_number });
check('approved run line is listed under Staff Payments', await row.count() === 1);
await row.getByRole('button', { name: 'Pay', exact: true }).click();
await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Pay', exact: true }).click();
await page.waitForSelector(`text=${run.body.run_number}`, { state: 'detached', timeout: 20000 }).catch(() => {});
const [paid] = await q('SELECT status, gl_entry_id FROM payroll_run_lines WHERE id = $1', [line.id]);
check('clicking Pay pays the line with a ledger entry (existing pay logic)', paid.status === 'paid' && !!paid.gl_entry_id, JSON.stringify(paid));

await page.getByRole('tab', { name: /Salary advances/ }).click();
await page.waitForTimeout(500);
check(`approved advance ${advNo} listed for disbursement`, await page.locator('tr', { hasText: advNo }).count() === 1);
await page.screenshot({ path: 'tests/batch1/screenshots/admin-staff-payments-advances.png', fullPage: true });

await page.goto(`${BASE}/hr/payroll/${run.body.id}`, { waitUntil: 'networkidle' });
await page.waitForSelector('aside nav');
await page.waitForTimeout(800);
const hrText = await page.locator('main, body').first().innerText();
check('HR payroll run page has no "Pay All Remaining" button', !/Pay All Remaining/.test(hrText));
await page.goto(`${BASE}/hr/salary-advances`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
check('HR salary advances shows "Disburse in Accounting" for approved advances', await page.getByRole('button', { name: 'Disburse in Accounting' }).count() >= 1);
await page.screenshot({ path: 'tests/batch1/screenshots/admin-hr-salary-advances.png', fullPage: true });

await q("DELETE FROM salary_advances WHERE advance_number = $1", [advNo]);
await browser.close();
await done();
process.exit(summary() ? 1 : 0);
