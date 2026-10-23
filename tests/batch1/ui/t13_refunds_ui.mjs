// #13 Refunds page: approve a cashier's pending receipt void, refund a deposit, see pharmacy refunds.
import { chromium } from 'playwright';
import { AFTER, call, q, done, newPatient, serviceByName, newBill, line, ensureShift, pay, tokenFor, check, summary } from '../lib.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:8093';
const CASHIER = tokenFor({ userId: 3, role: 'cashier', email: 'cashier@preview.local' });
const consult = await serviceByName('Consultation - General Practitioner');

// A paid receipt the cashier asks to void (goes pending), and a patient holding a deposit.
await ensureShift(AFTER);
const p1 = await newPatient(AFTER, 'T13');
const bill = await newBill(AFTER, p1, [line(consult)]);
await pay(AFTER, bill.id, 20000);
const [rc] = await q('SELECT id, receipt_number FROM receipts WHERE bill_id::text = $1', [bill.id]);
await call(AFTER, 'PUT', `/receipts/${rc.id}/status`, { status: 'voided', reason: 'T13 wrong patient' }, CASHIER);
const p2 = await newPatient(AFTER, 'T13Dep');
const dep = await call(AFTER, 'POST', '/patient-deposits', { patient_id: p2.id, patient_name: `${p2.first_name} ${p2.last_name}`, amount: 5000, payment_method: 'cash', clinic_id: 1 });
check('fixture: deposit taken', dep.ok, JSON.stringify(dep.body).slice(0, 120));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem('auth_token', t), tokenFor());
const page = await ctx.newPage();
await page.goto(`${BASE}/accounting/payments/refunds`, { waitUntil: 'networkidle' });
await page.waitForSelector(`text=${rc.receipt_number}`, { timeout: 20000 });
await page.screenshot({ path: 'tests/batch1/screenshots/admin-refunds-receipts.png', fullPage: true });
await page.locator('tr', { hasText: rc.receipt_number }).getByRole('button', { name: 'Approve' }).click();
await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: /Approve void/ }).click();
await page.waitForSelector(`text=${rc.receipt_number}`, { state: 'detached', timeout: 20000 }).catch(() => {});
const [after] = await q('SELECT status::text FROM receipts WHERE id::text = $1', [rc.id]);
check('approving from the Refunds page voids the receipt', after.status === 'voided', after.status);

await page.getByRole('tab', { name: /Deposit refunds/ }).click();
const depRow = page.locator('tr', { hasText: p2.last_name });
await depRow.waitFor({ timeout: 15000 });
check('patient with a deposit is listed', await depRow.count() === 1);
await depRow.getByRole('button', { name: 'Refund' }).click();
const dlg = page.getByRole('dialog');
await dlg.locator('input[type=number]').fill('2000');
await page.screenshot({ path: 'tests/batch1/screenshots/admin-refunds-deposit-dialog.png', fullPage: true });
await dlg.getByRole('button', { name: /^Refund/ }).click();
await page.waitForTimeout(2500);
const [bal] = await q('SELECT balance::float b FROM patient_deposit_balances WHERE patient_id = $1', [p2.id]);
check('refunding 2,000 from the page leaves 3,000 held', bal?.b === 3000, JSON.stringify(bal));

await page.getByRole('tab', { name: /Pharmacy refunds/ }).click();
await page.waitForTimeout(1200);
check('pharmacy refunds tab renders', await page.getByText('Pharmacy › Returns').count() >= 1);
await page.screenshot({ path: 'tests/batch1/screenshots/admin-refunds-pharmacy.png', fullPage: true });

await browser.close();
await done();
process.exit(summary() ? 1 : 0);
