// The Overview's revenue (headline, daily trend, payment-method split, revenue by clinic) and the
// Analytics Assistant's "revenue collected" give the same figure as the cash-basis income statement:
// all money received (receipts, invoice and claim payments), tax excluded. They used to count
// counter receipts only, tax included.
import { AFTER, call, q, done, check, summary } from './lib.mjs';

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // the server's own "today"
const near = (a, b) => Math.abs(a - b) < 0.05;

const is = (await call(AFTER, 'GET', `/reports-v2/income-statement?dateFrom=${day}&dateTo=${day}`)).body;
const cashRevenue = is.totals.totalRevenue;
check('setup: some revenue received today', cashRevenue > 0, String(cashRevenue));

const ov = (await call(AFTER, 'GET', `/reports-v2/overview?dateFrom=${day}&dateTo=${day}`)).body;
check('overview headline revenue = income statement (cash)', near(ov.kpis.totalRevenue, cashRevenue), `${ov.kpis.totalRevenue} vs ${cashRevenue}`);
const trend = (ov.revenueTrend || []).reduce((s, x) => s + x.revenue, 0);
const methods = (ov.paymentMethodBreakdown || []).reduce((s, x) => s + x.total, 0);
const clinics = (ov.revenueByClinic || []).reduce((s, x) => s + x.revenue, 0);
check('overview: daily trend, payment methods and clinics add up to the headline', near(trend, cashRevenue) && near(methods, cashRevenue) && near(clinics, cashRevenue),
  JSON.stringify({ trend, methods, clinics }));

const chat = (await call(AFTER, 'POST', '/analytics-chat/ask', { question: 'How much revenue was collected today?' })).body;
const figure = Number(String(chat.reply?.text || '').match(/([\d,]+\.\d{2})/)?.[1]?.replace(/,/g, ''));
check('assistant: revenue collected today = income statement (cash)', near(figure, cashRevenue), `${chat.reply?.text} vs ${cashRevenue}`);

await done();
process.exit(summary() ? 1 : 0);
