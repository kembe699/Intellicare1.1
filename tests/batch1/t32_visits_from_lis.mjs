// Visits are counted from LIS (one lis_test_orders row per encounter), with the legacy `visits`
// table only as the fallback for a period LIS has none. The dashboard and Clinic Performance used to
// read only the legacy table and showed 0 visits on a full day.
import { AFTER, call, q, done, check, summary, today } from './lib.mjs';

const [clinic] = await q('SELECT id, name FROM dr_clinics WHERE is_active IS NOT FALSE ORDER BY name LIMIT 1');
const reg = await call(AFTER, 'POST', '/lis/participants', {
  first_name: 'T32', last_name: `Visit-${Math.random().toString(36).slice(2, 6)}`, gender: 'female', date_of_birth: '1995-01-01',
  phone: `+211 9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, residence: 'Juba', clinic_id: clinic?.id, clinic_name: clinic?.name, room_number: '',
});
check('setup: patient registered and queued', reg.ok, JSON.stringify({ s: reg.status, e: reg.body?.error }));
const [{ n: lisToday }] = await q(`SELECT COUNT(*)::int n FROM lis_test_orders WHERE created_at::date = $1::date`, [today]);
check('setup: today has LIS visits', lisToday > 0, String(lisToday));

const dash = (await call(AFTER, 'GET', `/dashboard/stats/1?dateFrom=${today}&dateTo=${today}`)).body;
check('dashboard: visits today = LIS visits today', dash.todayVisits === lisToday, JSON.stringify({ dash: dash.todayVisits, lisToday }));

const perf = (await call(AFTER, 'GET', `/reports-v2/clinic-performance?dateFrom=${today}&dateTo=${today}`)).body;
check('clinic performance: total visits = LIS visits', perf.summary?.totalVisits === lisToday, JSON.stringify({ perf: perf.summary?.totalVisits, lisToday }));

const ov = (await call(AFTER, 'GET', `/reports-v2/overview?dateFrom=${today}&dateTo=${today}`)).body;
const perClinic = (ov.revenueByClinic || []).reduce((s, c) => s + (c.visits || 0), 0);
check('overview: per-clinic visits add up to the headline total', perClinic === ov.kpis?.totalVisits && perClinic === lisToday, JSON.stringify({ perClinic, kpi: ov.kpis?.totalVisits, lisToday }));

// A day with legacy visits and no LIS visits: the legacy table is the fallback.
const [legacyDay] = await q(`SELECT v.visit_date::date::text d, COUNT(*)::int n FROM visits v
  WHERE NOT EXISTS (SELECT 1 FROM lis_test_orders o WHERE o.created_at::date = v.visit_date::date) GROUP BY 1 ORDER BY 2 DESC LIMIT 1`);
if (legacyDay) {
  const p2 = (await call(AFTER, 'GET', `/reports-v2/clinic-performance?dateFrom=${legacyDay.d}&dateTo=${legacyDay.d}`)).body;
  check(`fallback: ${legacyDay.d} (no LIS visits) counts the ${legacyDay.n} legacy visits`, p2.summary?.totalVisits === legacyDay.n, JSON.stringify({ got: p2.summary?.totalVisits }));
} else {
  console.log('(fallback check skipped: no day with only legacy visits in this database)');
}
await done();
process.exit(summary() ? 1 : 0);
