/**
 * Clock-in rule for duty rosters (routes/employeePortal.js POST /attendance/clock).
 *
 * Applies only when the clinic has switched it on (hr_workflow_settings.
 * roster_enforce_clock_in) AND the employee's department has an APPROVED
 * roster covering today. Otherwise clock-in works exactly as before — so a
 * department can start using rosters before the rule bites.
 *
 * A clock-in is allowed from (shift start − early_window_min) until shift
 * end. A night shift that started yesterday and ends today counts too, and
 * the attendance day is then the day the shift STARTED.
 *
 * Returns { ok: true, shiftDate? } or { ok: false, reason }.
 */
const { getWorkflowSettings } = require('../config/ensureHrWorkflowSettings');

async function checkRosterForClockIn(sequelize, { clinicId, employeeId }) {
  const settings = await getWorkflowSettings(sequelize, clinicId);
  if (!settings.roster_enforce_clock_in) return { ok: true };

  const [[emp]] = await sequelize.query(
    `SELECT department, branch_id FROM employees WHERE id = :employeeId`,
    { replacements: { employeeId } }
  );
  if (!emp?.department) return { ok: true };

  // Is today's (or yesterday's, for a night shift) month covered by an approved roster?
  const [rosters] = await sequelize.query(
    `SELECT id, period FROM duty_rosters
      WHERE clinic_id = :clinicId AND department = :department AND status = 'approved'
        AND (branch_id IS NULL OR branch_id = :branchId OR :branchId IS NULL)
        AND period IN (TO_CHAR(CURRENT_DATE, 'YYYY-MM'), TO_CHAR(CURRENT_DATE - 1, 'YYYY-MM'))`,
    { replacements: { clinicId, department: emp.department, branchId: emp.branch_id || null } }
  );
  const [[todayRow]] = await sequelize.query(`SELECT TO_CHAR(CURRENT_DATE, 'YYYY-MM') AS p`);
  if (!rosters.some((r) => r.period === todayRow.p)) return { ok: true };

  const [entries] = await sequelize.query(
    `SELECT dre.duty_date, s.name, s.code, s.kind, s.start_time, s.end_time, s.early_window_min,
            (dre.duty_date + s.start_time - (COALESCE(s.early_window_min, 60) || ' minutes')::interval) AS opens_at,
            (dre.duty_date + s.end_time + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AS ends_at,
            LOCALTIMESTAMP AS now_local,
            (dre.duty_date = CURRENT_DATE) AS is_today
       FROM duty_roster_entries dre
       JOIN duty_rosters dr ON dr.id = dre.roster_id AND dr.id IN (:rosterIds)
       JOIN shifts s ON s.id = dre.shift_id
      WHERE dre.employee_id = :employeeId AND dre.duty_date IN (CURRENT_DATE, CURRENT_DATE - 1)
      ORDER BY dre.duty_date DESC`,
    { replacements: { employeeId, rosterIds: rosters.map((r) => r.id) } }
  );

  const open = entries.find((e) => new Date(e.opens_at) <= new Date(e.now_local) && new Date(e.now_local) <= new Date(e.ends_at));
  if (open) return { ok: true, shiftDate: open.duty_date };

  const today = entries.find((e) => e.is_today);
  if (!today) return { ok: false, reason: "You're not on the duty roster today. Ask your head of department or HR if you've been called in." };
  const hhmm = (d) => new Date(d).toTimeString().slice(0, 5);
  const label = /shift$/i.test(String(today.name).trim()) ? today.name : `${today.name} shift`;
  if (new Date(today.now_local) < new Date(today.opens_at)) {
    return { ok: false, reason: `Your ${label} starts at ${String(today.start_time).slice(0, 5)} — you can clock in from ${hhmm(today.opens_at)}.` };
  }
  return { ok: false, reason: `Your ${label} today ended at ${String(today.end_time).slice(0, 5)}.` };
}

module.exports = { checkRosterForClockIn };
