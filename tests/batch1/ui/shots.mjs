// Opens pages as a given role against the branch frontend, records console errors and
// failed API calls, and saves full-page screenshots.
//   node tests/batch1/ui/shots.mjs <role> <name>=<path> [<name>=<path> ...]
// Roles: admin | cashier | accountant | hr   (local preview test users)
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tokenFor } from '../lib.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:8093';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots');
mkdirSync(OUT, { recursive: true });

const USERS = {
  admin: { userId: 1, role: 'admin', email: 'admin@preview.local' },
  cashier: { userId: 3, role: 'cashier', email: 'cashier@preview.local' },
  accountant: { userId: 4, role: 'accountant', email: 'accountant@preview.local' },
  hr: { userId: 5, role: 'hr', email: 'hr@preview.local' },
};

// Endpoints that 500 on the baseline too, because the local preview DB has no LIS tables
// (lis_participants, lis_specimens) — a sandbox gap, not something these pages broke.
const KNOWN_PREVIEW_GAPS = /pharmacy-module\/((clinical-)?prescriptions|returns)|clinical\/patient-visits-history/;

const [role, ...pages] = process.argv.slice(2);
const token = tokenFor(USERS[role]);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript((t) => { localStorage.setItem('auth_token', t); }, token);
const page = await context.newPage();

let failures = 0;
for (const spec of pages) {
  const [name, url] = spec.split('=');
  const errors = [];
  const known = [];
  const onConsole = (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); };
  const onResponse = (r) => {
    if (!r.url().includes('/api/') || r.status() < 500) return;
    (KNOWN_PREVIEW_GAPS.test(r.url()) ? known : errors).push(`HTTP ${r.status()} ${r.url().replace(BASE, '').split('?')[0]}`);
  };
  page.on('console', onConsole); page.on('response', onResponse);
  await page.goto(BASE + url, { waitUntil: 'networkidle' }).catch((e) => errors.push('nav: ' + e.message));
  // Wait for the app shell (sidebar) and for page-level loading states to finish.
  await page.waitForSelector('aside nav', { timeout: 20000 }).catch(() => errors.push('app shell never rendered'));
  await page.waitForFunction(() => !/\bLoading\.\.\./.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
  const text = await page.locator('body').innerText().catch(() => '');
  const notFound = /page not found|404/i.test(text.slice(0, 400));
  const denied = /access denied|don't have permission|not authorized/i.test(text);
  if (name.startsWith('sidebar')) {
    // The sidebar scrolls inside a fixed-height panel; unclip it so the whole menu is captured.
    await page.evaluate(() => {
      const aside = document.querySelector('aside');
      if (!aside) return;
      aside.style.position = 'absolute'; aside.style.height = 'auto';
      aside.querySelectorAll('div, nav').forEach((el) => { el.style.overflow = 'visible'; if (el.classList.contains('h-full')) el.style.height = 'auto'; });
    });
    await page.locator('aside').screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
  } else {
    await page.screenshot({ path: path.join(OUT, `${role}-${name}.png`), fullPage: true });
  }
  page.off('console', onConsole); page.off('response', onResponse);
  const bad = notFound || errors.length > 0;
  if (bad) failures++;
  console.log(`${bad ? 'FAIL' : (denied ? 'DENY' : 'OK  ')}  ${role.padEnd(10)} ${url}${notFound ? '  [not found]' : ''}${errors.length ? '  ' + JSON.stringify(errors.slice(0, 3)) : ''}${known.length ? `  (preview gap: ${[...new Set(known)].join(', ')})` : ''}`);
}
await browser.close();
process.exit(failures ? 1 : 0);
