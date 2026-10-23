// Opens a page, clicks a button by its accessible name, and screenshots the dialog that opens.
//   node tests/batch1/ui/modal.mjs <name>=<path>@<button text> [...]
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { tokenFor } from '../lib.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:8093';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem('auth_token', t), tokenFor());
const page = await ctx.newPage();
for (const spec of process.argv.slice(2)) {
  const [name, rest] = spec.split('=');
  const [url, label] = rest.split('@');
  try {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForSelector('aside nav', { timeout: 20000 });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: label }).first().click();
    const dlg = page.getByRole('dialog').or(page.getByRole('alertdialog')).or(page.locator('.ic-modal')).first();
    await dlg.waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    await dlg.screenshot({ path: `${OUT}/modal-${name}.png` });
    console.log('OK', name);
  } catch (e) {
    console.log('FAIL', name, e.message.split('\n')[0]);
  }
}
await browser.close();
