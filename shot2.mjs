import { chromium } from '@playwright/test';
const routes = JSON.parse(process.env.ROUTES_JSON);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:8081/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#code', { timeout: 15000 });
await page.fill('#code','demo'); await page.fill('#email','zz-audit@audit.test'); await page.fill('#password','AuditTest!2609');
await page.click('button[type="submit"]'); await page.waitForTimeout(3500);
for (const r of routes) {
  await page.goto('http://127.0.0.1:8081' + r, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.screenshot({ path: `${process.env.OUT}/${r.replace(/\//g,'_').replace(/^_/,'')}.png` });
}
await b.close(); console.log('ok');
