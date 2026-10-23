// #14 Consultant Payments: consultant bills and theatre team fee splits in one list, paid from
// Accounting through the existing endpoints; Theatre shows "Pay in Accounting".
import { randomUUID } from 'crypto';
import { chromium } from 'playwright';
import { q, done, tokenFor, check, summary } from '../lib.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:8093';
const tag = randomUUID().slice(0, 6).toUpperCase();
const [emp] = await q("SELECT id FROM employees WHERE first_name = 'Test' AND last_name = 'Employee'");
const [nurse] = await q("SELECT id FROM employees WHERE first_name = 'Head' AND last_name = 'Nurse'");
const [patient] = await q('SELECT id FROM patients LIMIT 1');

// Fixtures: an unpaid consultant bill, and a completed operation with two unpaid fee splits.
const cbId = randomUUID();
await q(`INSERT INTO consultant_bills (id, clinic_id, branch_id, consultant_id, bill_number, period_from, period_to, total_consultation_revenue, fee_percentage, bill_amount, currency, status, exchange_rate, base_currency_amount)
         VALUES ($1, 1, 1, $2, $3, CURRENT_DATE - 30, CURRENT_DATE, 100000, 30, 30000, 'SSP', 'unpaid', 1, 30000)`, [cbId, emp.id, `CB-T14-${tag}`]);
const opId = randomUUID();
await q(`INSERT INTO theatre_operations (id, clinic_id, branch_id, patient_id, procedure_name, status, procedure_fee, fee_currency, ended_at, created_at, updated_at)
         VALUES ($1, 1, 1, $2, $3, 'completed', 200000, 'SSP', NOW(), NOW(), NOW())`, [opId, patient.id, `T14 Appendectomy ${tag}`]);
for (const [e, role, amt] of [[emp.id, 'surgeon', 40000], [nurse.id, 'scrub_nurse', 10000]]) {
  await q(`INSERT INTO theatre_team_payouts (id, operation_id, employee_id, role, fee_percentage, amount, currency, status) VALUES ($1, $2, $3, $4, 10, $5, 'SSP', 'unpaid')`, [randomUUID(), opId, e, role, amt]);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem('auth_token', t), tokenFor());
const page = await ctx.newPage();
await page.goto(`${BASE}/accounting/payments/consultants`, { waitUntil: 'networkidle' });
await page.waitForSelector(`text=CB-T14-${tag}`, { timeout: 20000 });
const cbRow = page.locator('tr', { hasText: `CB-T14-${tag}` });
const opRow = page.locator('tr', { hasText: `T14 Appendectomy ${tag}` });
check('consultant bill and theatre fees listed together', await cbRow.count() === 1 && await opRow.count() === 1);
check('theatre row totals the team (SSP 50,000.00)', /SSP 50,000\.00/.test(await opRow.innerText()), await opRow.innerText());
await page.screenshot({ path: 'tests/batch1/screenshots/admin-consultant-payments.png', fullPage: true });

async function payRow(row) {
  await row.getByRole('button', { name: 'Pay' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /1105/ }).click();
  await dlg.getByRole('button', { name: /^Pay SSP/ }).click();
  await page.waitForTimeout(2500);
}
await payRow(opRow);
const splits = await q("SELECT status, gl_entry_id FROM theatre_team_payouts WHERE operation_id = $1", [opId]);
check('paying the theatre row pays every split with a ledger entry', splits.every((s) => s.status === 'paid' && s.gl_entry_id), JSON.stringify(splits));
await payRow(page.locator('tr', { hasText: `CB-T14-${tag}` }));
const [cb] = await q('SELECT status, gl_entry_id FROM consultant_bills WHERE id = $1', [cbId]);
check('paying the consultant bill marks it paid with a ledger entry', cb.status === 'paid' && !!cb.gl_entry_id, JSON.stringify(cb));
const posted = await q(`SELECT c.account_code, SUM(li.debit_amount)::float d FROM gl_line_items li JOIN chart_of_accounts c ON c.id = li.account_id
  WHERE li.gl_id::text IN (SELECT gl_entry_id::text FROM theatre_team_payouts WHERE operation_id = $1 UNION SELECT gl_entry_id::text FROM consultant_bills WHERE id = $2) AND li.debit_amount > 0 GROUP BY 1`, [opId, cbId]);
check('both post Dr 5110 Doctor Fees (80,000 total)', posted.length === 1 && posted[0].account_code === '5110' && posted[0].d === 80000, JSON.stringify(posted));

await page.goto(`${BASE}/theatre/operations/${opId}`, { waitUntil: 'networkidle' });
await page.waitForSelector('aside nav');
await page.waitForTimeout(1500);
check('theatre operation page offers no in-place "Pay Team"', await page.getByRole('button', { name: 'Pay Team' }).count() === 0);

await browser.close();
await done();
process.exit(summary() ? 1 : 0);
