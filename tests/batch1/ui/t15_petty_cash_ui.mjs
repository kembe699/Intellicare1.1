// #15 Petty Cash: set up 1108 (explicit, confirmed), top up via cash transfer (from 1100 Cash), spend via an
// expense paid from petty cash; balance and movements follow the ledger.
// Leaves 1108 as it found it (inactive) at the end.
import { chromium } from 'playwright';
import { AFTER, call, q, done, today, tokenFor, check, summary } from '../lib.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:8093';
const [pc] = await q("SELECT id, is_active FROM chart_of_accounts WHERE account_code = '1108'");
const [cash] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1105'");
const balance = async () => (await q("SELECT COALESCE(SUM(debit_amount - credit_amount),0)::float b FROM account_ledger WHERE account_id::text = $1 AND COALESCE(is_posted, TRUE)", [pc.id]))[0].b;
const wasActive = pc.is_active;
await q("UPDATE chart_of_accounts SET is_active = FALSE WHERE id = $1", [pc.id]);
const start = await balance();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem('auth_token', t), tokenFor());
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/accounting/payments/petty-cash`, { waitUntil: 'networkidle' });
  await page.waitForSelector("text=Petty cash isn't set up", { timeout: 20000 });
  check('inactive 1108: page offers set-up instead of a balance', true);
  await page.screenshot({ path: 'tests/batch1/screenshots/admin-petty-cash-setup.png', fullPage: true });
  await page.getByRole('button', { name: 'Set up petty cash' }).first().click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Set up petty cash' }).click();
  await page.waitForSelector('text=Balance on hand', { timeout: 15000 });
  check('confirming set-up activates 1108', (await q('SELECT is_active FROM chart_of_accounts WHERE id = $1', [pc.id]))[0].is_active === true);

  await page.getByRole('button', { name: 'Top up' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /^1100/ }).click();
  await dlg.locator('input[type=number]').fill('50000');
  await dlg.getByRole('button', { name: 'Top up' }).click();
  await page.waitForTimeout(2500);
  check('top-up of 50,000 raises the petty cash balance by 50,000', (await balance()) - start === 50000, String((await balance()) - start));

  await page.getByRole('button', { name: /Spend/ }).click();
  await page.waitForURL(/\/procurement\/daily-expenses/, { timeout: 15000 });
  await page.waitForSelector('text=Record Daily Expense', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  check('"Spend" opens a new expense request with Petty Cash as the paid-from account',
    await page.getByText('Record Daily Expense').count() >= 1 && await page.getByText('Petty Cash', { exact: true }).count() >= 1);
  await page.screenshot({ path: 'tests/batch1/screenshots/admin-petty-cash-spend.png', fullPage: true });

  // Finish the spend through the normal flow: request → 2 approvals → pay from Accounting.
  const [cat] = await q("SELECT id FROM categories WHERE type = 'expense' AND name = 'Office Supplies' LIMIT 1");
  const exp = await call(AFTER, 'POST', '/daily-expenses', { description: 'T15 printer paper', amount: 8000, category: 'Office Supplies', category_id: cat.id, account_id: pc.id, expense_date: today, payment_method: 'cash' });
  for (let i = 0; i < 2; i++) await call(AFTER, 'POST', `/daily-expenses/${exp.body.id}/approve`, { approved_by_title: 'Admin', notes: 'ok' });
  const paid = await call(AFTER, 'POST', `/daily-expenses/${exp.body.id}/pay`, {});
  check('expense paid from petty cash lowers it by 8,000', paid.ok && (await balance()) - start === 42000, `${paid.status} ${(await balance()) - start}`);

  await page.goto(`${BASE}/accounting/payments/petty-cash`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Balance on hand');
  await page.waitForTimeout(800);
  const body = await page.locator('body').innerText();
  const expected = `SSP ${(start + 42000).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;
  check(`page shows the balance (${expected}) and the new movements`, body.includes(expected) && /T15 printer paper/.test(body), body.match(/Balance on hand\s*\n?\s*([^\n]+)/)?.[1]);
  await page.screenshot({ path: 'tests/batch1/screenshots/admin-petty-cash.png', fullPage: true });
} finally {
  await q('UPDATE chart_of_accounts SET is_active = $2 WHERE id = $1', [pc.id, wasActive]);
  await browser.close();
}
await done();
process.exit(summary() ? 1 : 0);
