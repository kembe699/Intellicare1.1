// Duty rosters end to end against the local preview DB, through the running
// branch backend (:3013) plus the REAL portal clock handler called in-process:
// shift codes → upload (bad file rejected, good file saved) → leave conflict
// blocks submit → submit → return → resubmit → approve → My Roster → the
// clock-in rule. Leaves the clinic's clock-in rule OFF and removes its roster.
process.env.DB_HOST = 'localhost'; process.env.DB_PORT = '5435'; process.env.DB_NAME = 'intellicare_preview';
process.env.DB_USER = 'preview'; process.env.DB_PASSWORD = 'preview_pass'; process.env.DEFAULT_SCHEMA = 'tenant_preview';
process.env.ATTENDANCE_QR_SECRET = process.env.ATTENDANCE_QR_SECRET || 'preview-attendance-secret';
const dotenv = require('../../src/server/node_modules/dotenv'); const orig = dotenv.config.bind(dotenv); dotenv.config = (o) => orig({ ...o, override: false });

(async () => {
  const lib = await import('./lib.mjs');
  const { AFTER, call, q, done, check, summary, tokenFor } = lib;
  const HR = tokenFor({ userId: 5, role: 'hr', email: 'hr@preview.local' });
  const CASHIER = tokenFor({ userId: 3, role: 'cashier', email: 'cashier@preview.local' });
  const now = new Date();
  const period = now.toISOString().slice(0, 7);
  const today = (await q('SELECT CURRENT_DATE::text d'))[0].d;
  const dept = 'Nursing';
  const base = `/rosters/${encodeURIComponent(dept)}/${period}`;
  const emps = await q("SELECT id, employee_number, first_name FROM employees WHERE department = $1 AND is_active ORDER BY first_name", [dept]);
  const [day, night] = await q("SELECT id, name FROM shifts ORDER BY start_time");
  await q("DELETE FROM duty_roster_entries WHERE roster_id IN (SELECT id FROM duty_rosters WHERE department = $1 AND period = $2)", [dept, period]);
  await q("DELETE FROM duty_rosters WHERE department = $1 AND period = $2", [dept, period]);

  // Shift codes
  const c1 = await call(AFTER, 'PUT', `/rosters/shifts/${day.id}`, { code: 'D', kind: 'work', color: '#0F766E', early_window_min: 60 }, HR);
  const c2 = await call(AFTER, 'PUT', `/rosters/shifts/${night.id}`, { code: 'N', kind: 'work', color: '#7C3AED', early_window_min: 60 }, HR);
  check('HR can set shift codes', c1.ok && c2.ok, `${c1.status} ${c2.status}`);
  const dupe = await call(AFTER, 'PUT', `/rosters/shifts/${night.id}`, { code: 'D' }, HR);
  check('a code already used by another shift is refused', dupe.status === 400, dupe.body?.error);
  check('a role without roster rights cannot open rosters', (await call(AFTER, 'GET', '/rosters/meta', null, CASHIER)).status === 403);

  // Upload with mistakes → nothing saved, every problem listed
  const bad = await call(AFTER, 'POST', `${base}/import`, { rows: [
    { row: 4, employee_number: 'NOPE-1', duty_date: `${period}-01`, code: 'D' },
    { row: 5, employee_number: emps[0].employee_number, duty_date: `${period}-02`, code: 'ZZ' },
  ] }, HR);
  check('a file with bad rows is rejected with each problem listed', bad.status === 422 && bad.body.errors.length === 2, JSON.stringify(bad.body.errors));
  check('…and nothing was saved', (await q("SELECT COUNT(*)::int n FROM duty_rosters WHERE department = $1 AND period = $2", [dept, period]))[0].n === 0);

  // Good upload: emp0 on day shift every day, emp1 nights on even days, blanks = off
  const days = (await call(AFTER, 'GET', base, null, HR)).body.days;
  const rows = [];
  days.forEach((d, i) => {
    rows.push({ row: 4, employee_number: emps[0].employee_number, duty_date: d, code: 'D' });
    if (emps[1]) rows.push({ row: 5, employee_number: emps[1].employee_number, duty_date: d, code: i % 2 ? 'N' : '' });
  });
  const up = await call(AFTER, 'POST', `${base}/import`, { rows }, HR);
  const expected = days.length + (emps[1] ? Math.floor(days.length / 2) : 0);
  check(`good upload saves ${expected} shifts (blank cells = off)`, up.ok && up.body.imported === expected, JSON.stringify(up.body));

  // Approved leave on a rostered day blocks submit
  const [lt] = await q("SELECT id FROM leave_types LIMIT 1");
  const leaveId = require('crypto').randomUUID();
  await q(`INSERT INTO leave_requests (id, clinic_id, branch_id, employee_id, leave_type_id, start_date, end_date, days, reason, status, created_at, updated_at)
           VALUES ($1, 1, 1, $2, $3, $4, $4, 1, 'T17', 'approved', NOW(), NOW())`, [leaveId, emps[0].id, lt.id, days[days.length - 1]]);
  const blocked = await call(AFTER, 'POST', `${base}/submit`, {}, HR);
  check('a shift on approved leave blocks submit', blocked.status === 422 && blocked.body.conflicts?.length === 1, JSON.stringify(blocked.body).slice(0, 200));
  await call(AFTER, 'PUT', `${base}/entries`, { changes: [{ employee_id: emps[0].id, duty_date: days[days.length - 1], shift_id: null }] }, HR);
  const sub = await call(AFTER, 'POST', `${base}/submit`, {}, HR);
  check('after clearing the leave day the roster submits', sub.ok, JSON.stringify(sub.body));
  check('a submitted roster cannot be edited', (await call(AFTER, 'PUT', `${base}/entries`, { changes: [{ employee_id: emps[0].id, duty_date: days[0], shift_id: null }] }, HR)).status === 409);

  check('returning needs a reason', (await call(AFTER, 'POST', `${base}/return`, {}, HR)).status === 400);
  const ret = await call(AFTER, 'POST', `${base}/return`, { reason: 'No weekend nights' }, HR);
  check('approver can return it with a reason', ret.ok && (await q("SELECT status, return_reason FROM duty_rosters WHERE department=$1 AND period=$2", [dept, period]))[0].return_reason === 'No weekend nights');
  await call(AFTER, 'POST', `${base}/submit`, {}, HR);
  const appr = await call(AFTER, 'POST', `${base}/approve`, {}, HR);
  check('resubmitted roster is approved', appr.ok && (await q("SELECT status FROM duty_rosters WHERE department=$1 AND period=$2", [dept, period]))[0].status === 'approved');
  const notes = await q("SELECT COUNT(*)::int n FROM portal_notifications WHERE type = 'duty_roster' AND employee_id = $1 AND created_at > NOW() - INTERVAL '5 minutes'", [emps[0].id]);
  check('staff on the roster get a portal notification', notes[0].n >= 1);

  const report = await call(AFTER, 'GET', `/rosters/report?department=${encodeURIComponent(dept)}&period=${period}`, null, HR);
  const r0 = report.body.rows.find((r) => r.employee_id === emps[0].id);
  check('report counts rostered days and leave', r0 && r0.rostered_days === days.length - 1 && r0.leave_days === 1, JSON.stringify(r0));

  // Staff portal + clock-in rule, through the real handlers
  const tenantContext = require('../../src/server/tenantContext');
  const { getTenantConnection } = require('../../src/server/tenantDb');
  const conn = await getTenantConnection('tenant_preview');
  const portal = require('../../src/server/routes/employeePortal');
  const handler = (p, m) => { const l = portal.stack.find((x) => x.route && x.route.path === p && x.route.methods[m]); return l.route.stack[l.route.stack.length - 1].handle; };
  const run = (fn) => new Promise((resolve) => tenantContext.run(conn, async () => resolve(await fn())));
  const res = () => { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const mine = await run(async () => { const r = res(); await handler('/roster', 'get')({ query: { period }, employee: { id: emps[0].id, clinicId: 1 } }, r); return r; });
  check('My Roster lists the employee’s approved shifts', mine.statusCode === 200 && mine.body.entries.length === days.length - 1, `${mine.statusCode} ${mine.body?.entries?.length}`);

  const { checkRosterForClockIn } = require('../../src/server/utils/rosterCheck');
  await q("UPDATE hr_workflow_settings SET roster_enforce_clock_in = FALSE WHERE clinic_id = 1");
  check('rule off: anyone may clock in', (await run(() => checkRosterForClockIn(require('../../src/server/models').sequelize, { clinicId: 1, employeeId: emps[1]?.id || emps[0].id }))).ok);
  await call(AFTER, 'PUT', '/rosters/settings', { enforce_clock_in: true }, HR);
  if (emps[1]) {
    const offToday = (Number(today.slice(8)) - 1) % 2 === 0; // emp1 works odd-index days only
    const r1 = await run(() => checkRosterForClockIn(require('../../src/server/models').sequelize, { clinicId: 1, employeeId: emps[1].id }));
    check(offToday ? 'rule on: someone off today is refused' : 'rule on: rostered night worker gets a time-window answer', offToday ? (!r1.ok && /not on the duty roster/.test(r1.reason)) : (r1.ok || /starts at|ended/.test(r1.reason)), JSON.stringify(r1));
  }
  // emp0 is on Day 08:00–17:00 today (unless today is the leave day): allowed only inside 07:00–17:00
  const hour = Number((await q("SELECT EXTRACT(HOUR FROM LOCALTIMESTAMP)::int h"))[0].h);
  const r0c = await run(() => checkRosterForClockIn(require('../../src/server/models').sequelize, { clinicId: 1, employeeId: emps[0].id }));
  const expectOk = today !== days[days.length - 1] && hour >= 7 && hour < 17;
  check(`rule on: day-shift worker at ${hour}:xx is ${expectOk ? 'allowed' : 'refused with the reason'}`, expectOk ? r0c.ok : (!r0c.ok && r0c.reason.length > 10), JSON.stringify(r0c));
  const otherDept = await q("SELECT id FROM employees WHERE COALESCE(department,'') <> $1 AND is_active LIMIT 1", [dept]);
  if (otherDept[0]) check('rule on: a department without an approved roster is unaffected', (await run(() => checkRosterForClockIn(require('../../src/server/models').sequelize, { clinicId: 1, employeeId: otherDept[0].id }))).ok);

  // Inside the shift window: a temporary shift that started 30 minutes ago
  const tmp = require('crypto').randomUUID();
  await q(`INSERT INTO shifts (id, clinic_id, branch_id, name, start_time, end_time, grace_minutes, working_days, is_active, code, kind, early_window_min, created_at, updated_at)
           VALUES ($1, 1, 1, 'T17 Now', (LOCALTIMESTAMP - INTERVAL '30 minutes')::time, (LOCALTIMESTAMP + INTERVAL '2 hours')::time, 10, '1,2,3,4,5,6,0', TRUE, 'T17', 'work', 60, NOW(), NOW())`, [tmp]);
  const [rost] = await q("SELECT id FROM duty_rosters WHERE department=$1 AND period=$2", [dept, period]);
  await q(`INSERT INTO duty_roster_entries (id, roster_id, employee_id, duty_date, shift_id, created_at, updated_at) VALUES ($1, $2, $3, CURRENT_DATE, $4, NOW(), NOW())
           ON CONFLICT (roster_id, employee_id, duty_date) DO UPDATE SET shift_id = $4`, [require('crypto').randomUUID(), rost.id, emps[0].id, tmp]);
  const inWin = await run(() => checkRosterForClockIn(require('../../src/server/models').sequelize, { clinicId: 1, employeeId: emps[0].id }));
  const crossesMidnight = (await q("SELECT (LOCALTIMESTAMP + INTERVAL '2 hours')::date <> CURRENT_DATE AS x"))[0].x;
  check('rule on: someone rostered on a shift that is running now is allowed, dated today', inWin.ok && String(inWin.shiftDate).slice(0, 10) === today || crossesMidnight, JSON.stringify(inWin));
  await q("DELETE FROM duty_roster_entries WHERE shift_id = $1", [tmp]);
  await q("DELETE FROM shifts WHERE id = $1", [tmp]);

  // Reopen → draft, version 2, rule no longer applies to the department
  const reo = await call(AFTER, 'POST', `${base}/reopen`, { reason: 'swap' }, HR);
  check('reopen makes it a new draft version', reo.ok && (await q("SELECT status, version FROM duty_rosters WHERE department=$1 AND period=$2", [dept, period]))[0].version === 2);

  // Clean up
  await call(AFTER, 'PUT', '/rosters/settings', { enforce_clock_in: false }, HR);
  await q("DELETE FROM leave_requests WHERE id = $1", [leaveId]);
  await q("DELETE FROM duty_roster_entries WHERE roster_id IN (SELECT id FROM duty_rosters WHERE department = $1 AND period = $2)", [dept, period]);
  await q("DELETE FROM duty_roster_events WHERE roster_id IN (SELECT id FROM duty_rosters WHERE department = $1 AND period = $2)", [dept, period]);
  await q("DELETE FROM duty_rosters WHERE department = $1 AND period = $2", [dept, period]);
  await done();
  process.exit(summary() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
