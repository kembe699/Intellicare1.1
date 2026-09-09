import { chromium } from '@playwright/test';
import fs from 'fs';
const OUT = process.env.OUT;
const routes = JSON.parse(process.env.ROUTES_JSON);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:8081/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#code', { timeout: 10000 });
await page.fill('#code','demo'); await page.fill('#email','zz-audit@audit.test'); await page.fill('#password','AuditTest!2609');
await page.click('button[type="submit"]'); await page.waitForTimeout(3000);
for (const r of routes) {
  await page.goto('http://127.0.0.1:8081' + r, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const name = r.replace(/\//g,'_').replace(/^_/,'') || 'root';
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
await b.close();
console.log('captured', routes.length);
