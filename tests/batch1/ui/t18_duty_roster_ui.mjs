// Duty Rosters page: month overview → Nursing → download the Excel template →
// fill it in → upload it → paint one cell in the grid → save → submit →
// approve. Removes the roster again at the end.
import { chromium } from 'playwright';
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { q, done, tokenFor, check, summary } from '../lib.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const BASE = process.env.UI_BASE || 'http://localhost:8093';
const OUT = 'tests/batch1/screenshots';
const period = new Date().toISOString().slice(0, 7);
const dept = 'Nursing';
const cleanup = async () => {
  await q("DELETE FROM duty_roster_entries WHERE roster_id IN (SELECT id FROM duty_rosters WHERE department = $1 AND period = $2)", [dept, period]);
  await q("DELETE FROM duty_roster_events WHERE roster_id IN (SELECT id FROM duty_rosters WHERE department = $1 AND period = $2)", [dept, period]);
  await q("DELETE FROM duty_rosters WHERE department = $1 AND period = $2", [dept, period]);
};
await cleanup();
await q("UPDATE shifts SET code = 'D' WHERE name = 'Day Shift'");
await q("UPDATE shifts SET code = 'N' WHERE name = 'Night Shift'");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript((t) => localStorage.setItem('auth_token', t), tokenFor({ userId: 5, role: 'hr', email: 'hr@preview.local' }));
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/hr/rosters?period=${period}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(`text=${dept}`, { timeout: 20000 });
  check('HR sees the month overview with departments', await page.locator('tr', { hasText: dept }).count() >= 1);
  await page.screenshot({ path: `${OUT}/hr-rosters-overview.png`, fullPage: true });

  await page.locator('tr', { hasText: dept }).first().click();
  await page.waitForSelector('text=Excel template');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel template' }).click()]);
  const wb = XLSX.readFile(await dl.path());
  const grid = XLSX.utils.sheet_to_json(wb.Sheets.Roster, { header: 1, defval: '' });
  const h = grid.findIndex((r) => r[0] === 'Employee No');
  check('template has a header row and one row per staff member', h >= 0 && grid.length - h - 1 >= 1, `header at ${h}, rows ${grid.length - h - 1}`);
  // Fill: first person days 1-10 D, second person days 11-20 N
  grid.slice(h + 1).forEach((row, i) => {
    for (let c = 2; c < row.length; c++) {
      const d = Number(grid[h][c]);
      row[c] = i === 0 ? (d <= 10 ? 'D' : '') : (d > 10 && d <= 20 ? 'n' : 'off');
    }
  });
  const filled = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(filled, XLSX.utils.aoa_to_sheet(grid), 'Roster');
  const file = '/tmp/claude-1000/-home-levi96-Documents-flippedpos/cc284ac1-c686-433a-b4be-55a9db0c3f6e/scratchpad/roster-upload.xlsx';
  XLSX.writeFile(filled, file);
  await page.locator('input[type=file]').setInputFiles(file);
  await page.waitForSelector('text=/Uploaded — \\d+ shift/', { timeout: 15000 });
  const n = (await q("SELECT COUNT(*)::int n FROM duty_roster_entries e JOIN duty_rosters r ON r.id = e.roster_id WHERE r.department = $1 AND r.period = $2", [dept, period]))[0].n;
  check('uploading the filled template saves 20 shifts (codes are case-insensitive, OFF = off)', n === 20, String(n));

  // Paint one more cell with the Night brush (day 25 of the first person) and save
  await page.getByRole('button', { name: /Night Shift/ }).first().click();
  const firstRow = page.locator('tbody tr').first();
  await firstRow.locator('td').nth(25).dispatchEvent('mousedown');
  await page.getByRole('button', { name: /^Save \(1\)/ }).click();
  await page.waitForSelector('text=Roster saved');
  const n2 = (await q("SELECT COUNT(*)::int n FROM duty_roster_entries e JOIN duty_rosters r ON r.id = e.roster_id WHERE r.department = $1 AND r.period = $2", [dept, period]))[0].n;
  check('painting a cell and saving adds it', n2 === 21, String(n2));
  await page.screenshot({ path: `${OUT}/hr-rosters-grid.png`, fullPage: true });

  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await page.waitForSelector('text=Awaiting approval');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForSelector('text=Roster approved');
  check('submit then approve from the page', (await q("SELECT status FROM duty_rosters WHERE department=$1 AND period=$2", [dept, period]))[0].status === 'approved');
  await page.getByRole('tab', { name: 'Rostered vs attended' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/hr-rosters-report.png`, fullPage: true });
  check('report tab renders', await page.getByText('Rostered vs attended —').count() === 1);
} finally {
  await cleanup();
  await browser.close();
}
await done();
process.exit(summary() ? 1 : 0);
