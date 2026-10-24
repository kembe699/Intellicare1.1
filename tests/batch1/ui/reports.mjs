// Screenshots Reports-centre pages (step-up verified), clicking View when the page needs it.
//   node tests/batch1/ui/reports.mjs name=/reports/dashboard/accounting[@Option label] ...
import { chromium } from 'playwright';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { tokenFor } from '../lib.mjs';
const require = createRequire(import.meta.url);
const jwt = require('../../../src/server/node_modules/jsonwebtoken');
const SECRET = require('../../../src/server/node_modules/dotenv').parse(readFileSync('src/server/.env')).JWT_SECRET;
const stepUp = jwt.sign({ userId: 1, reportsAccess: true }, SECRET, { expiresIn: '30m' });
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([t, s]) => { localStorage.setItem('auth_token', t); sessionStorage.setItem('reports_verified', 'true'); sessionStorage.setItem('reports_verified_at', new Date().toISOString()); sessionStorage.setItem('reports_step_up_token', s); }, [tokenFor(), stepUp]);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 150)));
for (const spec of process.argv.slice(2)) {
  const [name, rest] = spec.split('='); const [url, option] = rest.split('@');
  await p.goto('http://localhost:8093' + url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  if (option) {
    await p.getByRole('combobox').first().click();
    await p.getByRole('option', { name: option, exact: true }).click();
  }
  const view = p.getByRole('button', { name: 'View', exact: true });
  if (await view.count()) { await view.first().click(); await p.waitForLoadState('networkidle'); }
  await p.waitForTimeout(2000);
  await p.screenshot({ path: `tests/batch1/screenshots/rpt-${name}.png`, fullPage: true });
  console.log('OK', name);
}
await b.close();
