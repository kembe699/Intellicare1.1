// Adding an exchange rate ends the previous one the day before the new rate starts (expiry_date) —
// it no longer deactivates every earlier rate — so each date keeps converting at its own rate.
// A backdated rate slots in between; a rate on the same start day replaces that day's rate.
import { AFTER, call, q, done, check, summary } from './lib.mjs';

const FROM = 'EUR', TO = 'SSP';
await q("DELETE FROM exchange_rates WHERE from_currency = $1 AND to_currency = $2", [FROM, TO]);
const add = (rate, effective_date) => call(AFTER, 'POST', '/accounting/exchange-rates', { clinic_id: 1, from_currency: FROM, to_currency: TO, rate, effective_date });
const rateOn = async (date) => Number((await call(AFTER, 'GET', `/accounting/exchange-rates/current?clinic_id=1&from_currency=${FROM}&to_currency=${TO}&date=${date}`)).body.rate);
const rows = () => q("SELECT rate::float r, effective_date::text e, expiry_date::text x, is_active a FROM exchange_rates WHERE from_currency = $1 AND to_currency = $2 ORDER BY effective_date, created_at", [FROM, TO]);

try {
  await add(1000, '2026-01-01');
  await add(1200, '2026-06-01');
  let r = await rows();
  check('the earlier rate ends the day before the new one, and stays active',
    r[0].r === 1000 && r[0].x === '2026-05-31' && r[0].a === true && r[1].r === 1200 && r[1].x === null, JSON.stringify(r));
  check('a date before the change keeps its own rate; after it, the new one', (await rateOn('2026-03-15')) === 1000 && (await rateOn('2026-07-01')) === 1200,
    JSON.stringify({ mar: await rateOn('2026-03-15'), jul: await rateOn('2026-07-01') }));

  await add(1100, '2026-03-01');
  r = await rows();
  const byStart = Object.fromEntries(r.filter((x) => x.a).map((x) => [x.e, x]));
  check('a backdated rate slots in: earlier ends 28 Feb, the new one ends 31 May',
    byStart['2026-01-01'].x === '2026-02-28' && byStart['2026-03-01'].x === '2026-05-31' && byStart['2026-06-01'].x === null, JSON.stringify(r));
  check('each date converts at its own rate', (await rateOn('2026-02-10')) === 1000 && (await rateOn('2026-04-10')) === 1100 && (await rateOn('2026-08-10')) === 1200);

  await add(1300, '2026-06-01');
  r = await rows();
  check('a rate on the same start day replaces it', r.some((x) => x.r === 1200 && x.a === false) && (await rateOn('2026-08-10')) === 1300, JSON.stringify(r));
} finally {
  await q("DELETE FROM exchange_rates WHERE from_currency = $1 AND to_currency = $2", [FROM, TO]);
}
await done();
process.exit(summary() ? 1 : 0);
