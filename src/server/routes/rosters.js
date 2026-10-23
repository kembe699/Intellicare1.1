/**
 * Monthly departmental duty rosters — mounted at /api/rosters.
 *
 * One roster per department per month (YYYY-MM): a grid of employee × day,
 * one shift per cell, an empty cell meaning off duty. HR (roster.manage) or
 * the department's head prepares it — by uploading the filled-in Excel/CSV
 * template or editing the grid — then submits it; roster.approve approves it
 * or returns it with a reason. Only an APPROVED roster counts anywhere else:
 * the attendance_days view (lateness against the rostered shift), the staff
 * portal's "My Roster", the optional clock-in rule (utils/rosterCheck.js)
 * and the rostered-vs-attended report below.
 *
 * Tables: see config/ensureRosterTables.js.
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { sequelize } = require('../models');
const { getRolePrivileges } = require('../middleware/authorize');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { getWorkflowSettings } = require('../config/ensureHrWorkflowSettings');
const { notifyUser, notifyRole } = require('../services/notificationService');
const { notifyEmployee } = require('../utils/portalNotify');

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EDITABLE = ['draft', 'returned'];
const OFF_CODES = new Set(['', 'OFF', 'O', '-', 'X', '/']);

// ── helpers ────────────────────────────────────────────────────────────
function monthDays(period) {
  const [y, m] = period.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
}
function previousPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isoDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

async function privileges(req) {
  const has = async (key) => {
    if (req.user?.role === 'admin') return true;
    const grants = await getRolePrivileges(req.models?.sequelize || sequelize, req.tenantSchema);
    return [req.user.role, ...(req.user.additionalRoles || [])].some((r) => grants.get(r)?.has(key));
  };
  return { view: await has('roster.view'), manage: await has('roster.manage'), approve: await has('roster.approve') };
}

/** Departments this user heads (departments.head_employee_id → employees.user_id). */
async function departmentsHeadedBy(req) {
  const [rows] = await sequelize.query(
    `SELECT d.department_name FROM departments d JOIN employees e ON e.id = d.head_employee_id
      WHERE d.clinic_id = :clinicId AND e.user_id = :userId`,
    { replacements: { clinicId: BranchQueryFilter.resolveClinicId(req), userId: req.user.id } }
  );
  return rows.map((r) => r.department_name);
}

async function access(req, department) {
  const p = await privileges(req);
  const headOf = await departmentsHeadedBy(req);
  const isHead = department ? headOf.includes(department) : false;
  return { ...p, headOf, canView: p.view || p.manage || p.approve || isHead, canEdit: p.manage || isHead };
}

function params(req, res) {
  const department = decodeURIComponent(req.params.department || '');
  const { period } = req.params;
  if (!department || !PERIOD_RE.test(period || '')) {
    res.status(400).json({ error: 'A department and a month (YYYY-MM) are required.' });
    return null;
  }
  return { department, period, clinicId: BranchQueryFilter.resolveClinicId(req), branchId: getCreateBranchId(req) };
}

async function findRoster({ clinicId, branchId, department, period }, transaction) {
  const [[row]] = await sequelize.query(
    `SELECT * FROM duty_rosters WHERE clinic_id = :clinicId AND COALESCE(branch_id, -1) = COALESCE(:branchId, -1)
       AND department = :department AND period = :period`,
    { replacements: { clinicId, branchId, department, period }, transaction }
  );
  return row || null;
}

async function getOrCreateRoster(ctx, userId, transaction) {
  const existing = await findRoster(ctx, transaction);
  if (existing) return existing;
  const id = uuidv4();
  await sequelize.query(
    `INSERT INTO duty_rosters (id, clinic_id, branch_id, department, period, status, version, created_by, created_at, updated_at)
     VALUES (:id, :clinicId, :branchId, :department, :period, 'draft', 1, :userId, NOW(), NOW())`,
    { replacements: { id, ...ctx, userId }, transaction }
  );
  return findRoster(ctx, transaction);
}

async function logEvent(rosterId, action, userId, detail, transaction) {
  await sequelize.query(
    `INSERT INTO duty_roster_events (id, roster_id, action, actor_user_id, detail, created_at) VALUES (:id, :rosterId, :action, :userId, :detail, NOW())`,
    { replacements: { id: uuidv4(), rosterId, action, userId: userId || null, detail: detail || null }, transaction }
  );
}

async function departmentEmployees({ clinicId, branchId, department }) {
  const [rows] = await sequelize.query(
    `SELECT id, employee_number, first_name, last_name, job_title, branch_id
       FROM employees
      WHERE clinic_id = :clinicId AND department = :department AND is_active = TRUE
        AND COALESCE(employment_status, 'active') = 'active'
        ${branchId ? 'AND (branch_id = :branchId OR branch_id IS NULL)' : ''}
      ORDER BY first_name, last_name`,
    { replacements: { clinicId, branchId, department } }
  );
  return rows;
}

async function activeShifts(clinicId) {
  const [rows] = await sequelize.query(
    `SELECT id, name, code, kind, color, start_time, end_time, early_window_min, is_active
       FROM shifts WHERE clinic_id = :clinicId ORDER BY start_time, name`,
    { replacements: { clinicId } }
  );
  return rows;
}

/** Approved leave overlapping the month, one row per request. */
async function leaveInMonth(employeeIds, period) {
  if (!employeeIds.length) return [];
  const days = monthDays(period);
  const [rows] = await sequelize.query(
    `SELECT lr.employee_id, lr.start_date, lr.end_date, COALESCE(lt.name, 'Leave') AS leave_type
       FROM leave_requests lr LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id IN (:ids) AND lr.status = 'approved'
        AND lr.start_date <= :last AND lr.end_date >= :first`,
    { replacements: { ids: employeeIds, first: days[0], last: days[days.length - 1] } }
  );
  return rows.map((r) => ({ ...r, start_date: isoDate(r.start_date), end_date: isoDate(r.end_date) }));
}

/** Working/on-call shifts placed on a day the person is on approved leave. */
function leaveConflicts(entries, leave, shiftsById) {
  const out = [];
  for (const e of entries) {
    const s = shiftsById.get(e.shift_id);
    if (!s) continue;
    const l = leave.find((x) => x.employee_id === e.employee_id && x.start_date <= e.duty_date && x.end_date >= e.duty_date);
    if (l) out.push({ employee_id: e.employee_id, duty_date: e.duty_date, shift: s.code || s.name, leave_type: l.leave_type });
  }
  return out;
}

async function rosterEntries(rosterId) {
  if (!rosterId) return [];
  const [rows] = await sequelize.query(
    `SELECT employee_id, duty_date, shift_id, note FROM duty_roster_entries WHERE roster_id = :rosterId`,
    { replacements: { rosterId } }
  );
  return rows.map((r) => ({ ...r, duty_date: isoDate(r.duty_date) }));
}

// ── meta: shifts, departments, what this user may do ────────────────────
router.get('/meta', async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const acc = await access(req);
    if (!acc.view && !acc.manage && !acc.approve && !acc.headOf.length) {
      return res.status(403).json({ error: 'You do not have access to duty rosters.' });
    }
    const [departments] = await sequelize.query(
      `SELECT name, MAX(head_name) AS head_name, SUM(employees)::int AS employees FROM (
         SELECT d.department_name AS name, NULLIF(TRIM(CONCAT(h.first_name, ' ', h.last_name)), '') AS head_name, 0 AS employees
           FROM departments d LEFT JOIN employees h ON h.id = d.head_employee_id
          WHERE d.clinic_id = :clinicId AND COALESCE(d.is_active, TRUE)
         UNION ALL
         SELECT e.department, NULL, COUNT(*) FROM employees e
          WHERE e.clinic_id = :clinicId AND e.is_active = TRUE AND e.department IS NOT NULL AND e.department <> ''
          GROUP BY e.department
       ) x GROUP BY name ORDER BY name`,
      { replacements: { clinicId } }
    );
    const visible = acc.view || acc.manage || acc.approve ? departments : departments.filter((d) => acc.headOf.includes(d.name));
    const settings = await getWorkflowSettings(sequelize, clinicId);
    res.json({
      shifts: await activeShifts(clinicId),
      departments: visible,
      permissions: { view: acc.view, manage: acc.manage, approve: acc.approve, head_of: acc.headOf },
      enforce_clock_in: !!settings.roster_enforce_clock_in,
    });
  } catch (error) {
    console.error('Roster meta error:', error);
    res.status(500).json({ error: 'Could not load roster settings' });
  }
});

// ── month overview: every department's roster status ───────────────────
router.get('/', async (req, res) => {
  try {
    const period = String(req.query.period || '');
    if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'period (YYYY-MM) is required.' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchId = getCreateBranchId(req);
    const acc = await access(req);
    const [rows] = await sequelize.query(
      `SELECT r.*, (SELECT COUNT(*)::int FROM duty_roster_entries e WHERE e.roster_id = r.id) AS entry_count,
              su.display_name AS submitted_by_name, au.display_name AS approved_by_name
         FROM duty_rosters r
         LEFT JOIN users su ON su.id = r.submitted_by
         LEFT JOIN users au ON au.id = r.approved_by
        WHERE r.clinic_id = :clinicId AND COALESCE(r.branch_id, -1) = COALESCE(:branchId, -1) AND r.period = :period`,
      { replacements: { clinicId, branchId, period } }
    );
    const all = acc.view || acc.manage || acc.approve;
    res.json(all ? rows : rows.filter((r) => acc.headOf.includes(r.department)));
  } catch (error) {
    console.error('Roster list error:', error);
    res.status(500).json({ error: 'Could not load rosters' });
  }
});

// ── shift codes/colours used on rosters ────────────────────────────────
router.put('/shifts/:id', async (req, res) => {
  try {
    const acc = await access(req);
    if (!acc.manage) return res.status(403).json({ error: 'Only roster managers can change shift codes.' });
    const { code, kind, color, early_window_min } = req.body || {};
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const cleanCode = code ? String(code).trim().toUpperCase().slice(0, 10) : null;
    if (cleanCode && OFF_CODES.has(cleanCode)) return res.status(400).json({ error: `"${cleanCode}" means off duty on a roster — pick another code.` });
    if (cleanCode) {
      const [[dup]] = await sequelize.query(
        `SELECT name FROM shifts WHERE clinic_id = :clinicId AND UPPER(code) = :code AND id <> :id`,
        { replacements: { clinicId, code: cleanCode, id: req.params.id } }
      );
      if (dup) return res.status(400).json({ error: `Code ${cleanCode} is already used by ${dup.name}.` });
    }
    if (kind && !['work', 'on_call'].includes(kind)) return res.status(400).json({ error: 'kind must be work or on_call.' });
    await sequelize.query(
      `UPDATE shifts SET code = :code, kind = COALESCE(:kind, kind), color = :color,
              early_window_min = COALESCE(:early, early_window_min), updated_at = NOW()
        WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId, code: cleanCode, kind: kind || null, color: color || null, early: Number.isFinite(Number(early_window_min)) && early_window_min !== '' && early_window_min !== null && early_window_min !== undefined ? Number(early_window_min) : null } }
    );
    res.json((await activeShifts(clinicId)).find((s) => s.id === req.params.id) || null);
  } catch (error) {
    console.error('Roster shift update error:', error);
    res.status(500).json({ error: 'Could not update the shift' });
  }
});

// ── clock-in rule switch ───────────────────────────────────────────────
router.put('/settings', async (req, res) => {
  try {
    const acc = await access(req);
    if (!acc.approve) return res.status(403).json({ error: 'Only roster approvers can change this setting.' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const on = !!req.body?.enforce_clock_in;
    await sequelize.query(
      `INSERT INTO hr_workflow_settings (clinic_id, roster_enforce_clock_in, updated_by, created_at, updated_at)
       VALUES (:clinicId, :on, :userId, NOW(), NOW())
       ON CONFLICT (clinic_id) DO UPDATE SET roster_enforce_clock_in = :on, updated_by = :userId, updated_at = NOW()`,
      { replacements: { clinicId, on, userId: req.user.id } }
    );
    res.json({ enforce_clock_in: on });
  } catch (error) {
    console.error('Roster settings error:', error);
    res.status(500).json({ error: 'Could not save the setting' });
  }
});

// ── rostered vs attended ───────────────────────────────────────────────
router.get('/report', async (req, res) => {
  try {
    const period = String(req.query.period || '');
    const department = String(req.query.department || '');
    if (!PERIOD_RE.test(period) || !department) return res.status(400).json({ error: 'department and period are required.' });
    const acc = await access(req, department);
    if (!acc.canView) return res.status(403).json({ error: 'You do not have access to this roster.' });
    const ctx = { clinicId: BranchQueryFilter.resolveClinicId(req), branchId: getCreateBranchId(req), department, period };
    const roster = await findRoster(ctx);
    const employees = await departmentEmployees(ctx);
    const ids = employees.map((e) => e.id);
    const days = monthDays(period);
    const entries = roster && roster.status === 'approved' ? await rosterEntries(roster.id) : [];
    const leave = await leaveInMonth(ids, period);
    let attended = [];
    if (ids.length) {
      [attended] = await sequelize.query(
        `SELECT employee_id, shift_date, first_in, late_minutes FROM attendance_days
          WHERE employee_id IN (:ids) AND shift_date BETWEEN :first AND :last`,
        { replacements: { ids, first: days[0], last: days[days.length - 1] } }
      );
    }
    const [[today]] = await sequelize.query(`SELECT CURRENT_DATE AS d`);
    const todayIso = isoDate(today.d);
    const rows = employees.map((e) => {
      const mine = entries.filter((x) => x.employee_id === e.id);
      const rosteredDates = new Set(mine.map((x) => x.duty_date));
      const att = attended.filter((a) => a.employee_id === e.id && a.first_in);
      const attendedDates = new Set(att.map((a) => isoDate(a.shift_date)));
      const onLeave = (d) => leave.some((l) => l.employee_id === e.id && l.start_date <= d && l.end_date >= d);
      const past = [...rosteredDates].filter((d) => d < todayIso);
      return {
        employee_id: e.id,
        employee_number: e.employee_number,
        name: `${e.first_name} ${e.last_name}`,
        rostered_days: rosteredDates.size,
        attended_rostered: [...rosteredDates].filter((d) => attendedDates.has(d)).length,
        absent: past.filter((d) => !attendedDates.has(d) && !onLeave(d)).length,
        unrostered_attendance: [...attendedDates].filter((d) => !rosteredDates.has(d)).length,
        late_days: att.filter((a) => rosteredDates.has(isoDate(a.shift_date)) && Number(a.late_minutes) > 0).length,
        late_minutes: Math.round(att.filter((a) => rosteredDates.has(isoDate(a.shift_date))).reduce((s, a) => s + (Number(a.late_minutes) || 0), 0)),
        leave_days: days.filter((d) => onLeave(d)).length,
      };
    });
    res.json({ roster_status: roster?.status || null, rows });
  } catch (error) {
    console.error('Roster report error:', error);
    res.status(500).json({ error: 'Could not build the roster report' });
  }
});

// ── one roster ─────────────────────────────────────────────────────────
router.get('/:department/:period', async (req, res) => {
  try {
    const ctx = params(req, res); if (!ctx) return;
    const acc = await access(req, ctx.department);
    if (!acc.canView) return res.status(403).json({ error: 'You do not have access to this roster.' });
    const roster = await findRoster(ctx);
    const employees = await departmentEmployees(ctx);
    const shifts = await activeShifts(ctx.clinicId);
    const entries = await rosterEntries(roster?.id);
    const leave = await leaveInMonth(employees.map((e) => e.id), ctx.period);
    let events = [];
    if (roster) {
      [events] = await sequelize.query(
        `SELECT ev.action, ev.detail, ev.created_at, u.display_name AS actor
           FROM duty_roster_events ev LEFT JOIN users u ON u.id = ev.actor_user_id
          WHERE ev.roster_id = :id ORDER BY ev.created_at DESC LIMIT 30`,
        { replacements: { id: roster.id } }
      );
    }
    res.json({
      roster,
      days: monthDays(ctx.period),
      employees,
      shifts,
      entries,
      leave,
      conflicts: leaveConflicts(entries, leave, new Map(shifts.map((s) => [s.id, s]))),
      events,
      can: {
        edit: acc.canEdit && (!roster || EDITABLE.includes(roster.status)),
        submit: acc.canEdit && !!roster && EDITABLE.includes(roster.status),
        approve: acc.approve && roster?.status === 'submitted',
        reopen: acc.approve && roster?.status === 'approved',
      },
    });
  } catch (error) {
    console.error('Roster load error:', error);
    res.status(500).json({ error: 'Could not load the roster' });
  }
});

/** Applies cell changes to an editable roster inside a transaction. */
async function applyChanges(req, res, ctx, changes, { replace = false, source = 'grid', action = 'edited' } = {}) {
  const acc = await access(req, ctx.department);
  if (!acc.canEdit) { res.status(403).json({ error: 'You can only prepare rosters for departments you manage.' }); return null; }
  const days = new Set(monthDays(ctx.period));
  const employees = await departmentEmployees(ctx);
  const empIds = new Set(employees.map((e) => e.id));
  const shifts = await activeShifts(ctx.clinicId);
  const shiftIds = new Set(shifts.filter((s) => s.is_active !== false).map((s) => s.id));
  for (const c of changes) {
    if (!empIds.has(c.employee_id)) { res.status(400).json({ error: 'One of the employees is not in this department.' }); return null; }
    if (!days.has(c.duty_date)) { res.status(400).json({ error: `${c.duty_date} is not in ${ctx.period}.` }); return null; }
    if (c.shift_id && !shiftIds.has(c.shift_id)) { res.status(400).json({ error: 'Unknown or inactive shift.' }); return null; }
  }
  const t = await sequelize.transaction();
  try {
    const roster = await getOrCreateRoster(ctx, req.user.id, t);
    if (!EDITABLE.includes(roster.status)) {
      await t.rollback();
      res.status(409).json({ error: `This roster is ${roster.status}. ${roster.status === 'approved' ? 'Reopen it to make changes.' : 'Wait for it to be approved or returned.'}` });
      return null;
    }
    if (replace) await sequelize.query(`DELETE FROM duty_roster_entries WHERE roster_id = :id`, { replacements: { id: roster.id }, transaction: t });
    for (const c of changes) {
      if (!c.shift_id) {
        await sequelize.query(
          `DELETE FROM duty_roster_entries WHERE roster_id = :id AND employee_id = :emp AND duty_date = :date`,
          { replacements: { id: roster.id, emp: c.employee_id, date: c.duty_date }, transaction: t }
        );
      } else {
        await sequelize.query(
          `INSERT INTO duty_roster_entries (id, roster_id, employee_id, duty_date, shift_id, note, created_at, updated_at)
           VALUES (:eid, :id, :emp, :date, :shift, :note, NOW(), NOW())
           ON CONFLICT (roster_id, employee_id, duty_date) DO UPDATE SET shift_id = :shift, note = :note, updated_at = NOW()`,
          { replacements: { eid: uuidv4(), id: roster.id, emp: c.employee_id, date: c.duty_date, shift: c.shift_id, note: c.note || null }, transaction: t }
        );
      }
    }
    await sequelize.query(`UPDATE duty_rosters SET source = :source, updated_at = NOW() WHERE id = :id`, { replacements: { id: roster.id, source }, transaction: t });
    await logEvent(roster.id, action, req.user.id, `${changes.length} cell(s)${replace ? ', replacing the whole month' : ''}`, t);
    await t.commit();
    return roster;
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

router.put('/:department/:period/entries', async (req, res) => {
  try {
    const ctx = params(req, res); if (!ctx) return;
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : null;
    if (!changes) return res.status(400).json({ error: 'changes[] is required.' });
    const roster = await applyChanges(req, res, ctx, changes.map((c) => ({ ...c, duty_date: String(c.duty_date).slice(0, 10) })), { replace: !!req.body.replace });
    if (roster) res.json({ ok: true, roster_id: roster.id });
  } catch (error) {
    console.error('Roster save error:', error);
    res.status(500).json({ error: 'Could not save the roster' });
  }
});

/**
 * Upload: rows of { employee_number, duty_date, code } parsed from the
 * Excel/CSV template in the browser. All-or-nothing — any bad row returns
 * every problem found and nothing is saved. Replaces the whole month.
 */
router.post('/:department/:period/import', async (req, res) => {
  try {
    const ctx = params(req, res); if (!ctx) return;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) return res.status(400).json({ error: 'rows[] is required.' });
    const employees = await departmentEmployees(ctx);
    const byNumber = new Map(employees.map((e) => [String(e.employee_number).trim().toUpperCase(), e]));
    const shifts = (await activeShifts(ctx.clinicId)).filter((s) => s.is_active !== false);
    const byCode = new Map();
    for (const s of shifts) {
      if (s.code) byCode.set(String(s.code).toUpperCase(), s);
      byCode.set(String(s.name).toUpperCase(), s);
    }
    const days = new Set(monthDays(ctx.period));
    const errors = [];
    const changes = [];
    const seen = new Set();
    rows.forEach((r, i) => {
      const where = r.row ? `Row ${r.row}` : `Line ${i + 1}`;
      const num = String(r.employee_number || '').trim().toUpperCase();
      const emp = byNumber.get(num);
      if (!emp) { errors.push(`${where}: employee "${r.employee_number}" is not in ${ctx.department}.`); return; }
      const date = String(r.duty_date || '').slice(0, 10);
      if (!days.has(date)) { errors.push(`${where}: ${date || 'missing date'} is not a day in ${ctx.period}.`); return; }
      const code = String(r.code ?? '').trim().toUpperCase();
      if (OFF_CODES.has(code)) return; // off duty — no entry
      const shift = byCode.get(code);
      if (!shift) { errors.push(`${where}: unknown shift code "${r.code}" for ${emp.first_name} ${emp.last_name} on ${date}.`); return; }
      const key = `${emp.id}|${date}`;
      if (seen.has(key)) { errors.push(`${where}: ${emp.first_name} ${emp.last_name} has two shifts on ${date}.`); return; }
      seen.add(key);
      changes.push({ employee_id: emp.id, duty_date: date, shift_id: shift.id });
    });
    if (errors.length) return res.status(422).json({ error: `${errors.length} problem(s) in the file — nothing was saved.`, errors: errors.slice(0, 200) });
    const roster = await applyChanges(req, res, ctx, changes, { replace: true, source: 'upload', action: 'uploaded' });
    if (roster) res.json({ ok: true, imported: changes.length, roster_id: roster.id });
  } catch (error) {
    console.error('Roster import error:', error);
    res.status(500).json({ error: 'Could not import the roster' });
  }
});

/** Copies last month's pattern: each day takes the shift from 28 days earlier (same weekday). */
router.post('/:department/:period/copy-previous', async (req, res) => {
  try {
    const ctx = params(req, res); if (!ctx) return;
    const prev = await findRoster({ ...ctx, period: previousPeriod(ctx.period) });
    if (!prev) return res.status(404).json({ error: `There is no roster for ${previousPeriod(ctx.period)} to copy.` });
    const prevEntries = await rosterEntries(prev.id);
    const byKey = new Map(prevEntries.map((e) => [`${e.employee_id}|${e.duty_date}`, e.shift_id]));
    const empIds = new Set((await departmentEmployees(ctx)).map((e) => e.id));
    const changes = [];
    for (const day of monthDays(ctx.period)) {
      const src = addDays(day, -28);
      for (const emp of empIds) {
        const shift = byKey.get(`${emp}|${src}`) || byKey.get(`${emp}|${addDays(src, -7)}`);
        if (shift) changes.push({ employee_id: emp, duty_date: day, shift_id: shift });
      }
    }
    const roster = await applyChanges(req, res, ctx, changes, { replace: true, source: 'copy', action: 'copied' });
    if (roster) res.json({ ok: true, copied: changes.length });
  } catch (error) {
    console.error('Roster copy error:', error);
    res.status(500).json({ error: 'Could not copy last month' });
  }
});

// ── workflow ───────────────────────────────────────────────────────────
async function notifyStatus(roster, title, message, userId, clinicId) {
  if (!userId) return;
  try {
    await notifyUser(sequelize, { clinic_id: clinicId, user_id: userId, type: 'duty_roster', title, message, entity_type: 'duty_roster', entity_id: roster.id, link: `/hr/rosters?department=${encodeURIComponent(roster.department)}&period=${roster.period}` });
  } catch (e) { /* notifications are best-effort */ }
}

router.post('/:department/:period/submit', async (req, res) => {
  try {
    const ctx = params(req, res); if (!ctx) return;
    const acc = await access(req, ctx.department);
    if (!acc.canEdit) return res.status(403).json({ error: 'You can only submit rosters for departments you manage.' });
    const roster = await findRoster(ctx);
    if (!roster || !EDITABLE.includes(roster.status)) return res.status(409).json({ error: 'Only a draft or returned roster can be submitted.' });
    const entries = await rosterEntries(roster.id);
    if (!entries.length) return res.status(400).json({ error: 'The roster is empty — add shifts before submitting.' });
    const employees = await departmentEmployees(ctx);
    const shifts = await activeShifts(ctx.clinicId);
    const conflicts = leaveConflicts(entries, await leaveInMonth(employees.map((e) => e.id), ctx.period), new Map(shifts.map((s) => [s.id, s])));
    if (conflicts.length) {
      return res.status(422).json({ error: `${conflicts.length} shift(s) fall on approved leave. Clear them before submitting.`, conflicts });
    }
    await sequelize.query(
      `UPDATE duty_rosters SET status = 'submitted', submitted_by = :userId, submitted_at = NOW(), return_reason = NULL, updated_at = NOW() WHERE id = :id`,
      { replacements: { id: roster.id, userId: req.user.id } }
    );
    await logEvent(roster.id, 'submitted', req.user.id, `${entries.length} shift(s)`);
    for (const role of ['hr', 'admin']) {
      try {
        await notifyRole(sequelize, { clinic_id: ctx.clinicId, role, excludeUserId: req.user.id, type: 'duty_roster', title: 'Duty roster awaiting approval', message: `${ctx.department} roster for ${ctx.period} was submitted.`, entity_type: 'duty_roster', entity_id: roster.id, link: `/hr/rosters?department=${encodeURIComponent(ctx.department)}&period=${ctx.period}` });
      } catch (e) { /* best-effort */ }
    }
    res.json({ ok: true, status: 'submitted' });
  } catch (error) {
    console.error('Roster submit error:', error);
    res.status(500).json({ error: 'Could not submit the roster' });
  }
});

router.post('/:department/:period/approve', async (req, res) => {
  try {
    const ctx = params(req, res); if (!ctx) return;
    const acc = await access(req, ctx.department);
    if (!acc.approve) return res.status(403).json({ error: 'You do not have permission to approve rosters.' });
    const roster = await findRoster(ctx);
    if (!roster || roster.status !== 'submitted') return res.status(409).json({ error: 'Only a submitted roster can be approved.' });
    await sequelize.query(
      `UPDATE duty_rosters SET status = 'approved', approved_by = :userId, approved_at = NOW(), updated_at = NOW() WHERE id = :id`,
      { replacements: { id: roster.id, userId: req.user.id } }
    );
    await logEvent(roster.id, 'approved', req.user.id, null);
    await notifyStatus(roster, 'Duty roster approved', `${ctx.department} roster for ${ctx.period} was approved.`, roster.submitted_by, ctx.clinicId);
    // Tell everyone on it that their month is out (staff portal bell).
    const [people] = await sequelize.query(`SELECT DISTINCT employee_id FROM duty_roster_entries WHERE roster_id = :id`, { replacements: { id: roster.id } });
    for (const p of people) {
      try {
        await notifyEmployee(sequelize, { clinic_id: ctx.clinicId, employee_id: p.employee_id, type: 'duty_roster', title: 'Your duty roster is out', message: `Your ${ctx.period} duty roster is ready — open My Roster to see your shifts.`, entity_type: 'duty_roster', entity_id: roster.id });
      } catch (e) { /* best-effort */ }
    }
    res.json({ ok: true, status: 'approved' });
  } catch (error) {
    console.error('Roster approve error:', error);
    res.status(500).json({ error: 'Could not approve the roster' });
  }
});

router.post('/:department/:period/return', async (req, res) => {
  try {
    const ctx = params(req, res); if (!ctx) return;
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Say why the roster is being returned.' });
    const acc = await access(req, ctx.department);
    if (!acc.approve) return res.status(403).json({ error: 'You do not have permission to return rosters.' });
    const roster = await findRoster(ctx);
    if (!roster || roster.status !== 'submitted') return res.status(409).json({ error: 'Only a submitted roster can be returned.' });
    await sequelize.query(
      `UPDATE duty_rosters SET status = 'returned', returned_by = :userId, returned_at = NOW(), return_reason = :reason, updated_at = NOW() WHERE id = :id`,
      { replacements: { id: roster.id, userId: req.user.id, reason } }
    );
    await logEvent(roster.id, 'returned', req.user.id, reason);
    await notifyStatus(roster, 'Duty roster returned', `${ctx.department} roster for ${ctx.period} was returned: ${reason}`, roster.submitted_by, ctx.clinicId);
    res.json({ ok: true, status: 'returned' });
  } catch (error) {
    console.error('Roster return error:', error);
    res.status(500).json({ error: 'Could not return the roster' });
  }
});

/** Approved → draft again (new version) so it can be changed and re-approved. */
router.post('/:department/:period/reopen', async (req, res) => {
  try {
    const ctx = params(req, res); if (!ctx) return;
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Say why the roster is being reopened.' });
    const acc = await access(req, ctx.department);
    if (!acc.approve) return res.status(403).json({ error: 'You do not have permission to reopen rosters.' });
    const roster = await findRoster(ctx);
    if (!roster || roster.status !== 'approved') return res.status(409).json({ error: 'Only an approved roster can be reopened.' });
    await sequelize.query(
      `UPDATE duty_rosters SET status = 'draft', version = version + 1, submitted_at = NULL, approved_at = NULL, approved_by = NULL, updated_at = NOW() WHERE id = :id`,
      { replacements: { id: roster.id } }
    );
    await logEvent(roster.id, 'reopened', req.user.id, reason);
    res.json({ ok: true, status: 'draft' });
  } catch (error) {
    console.error('Roster reopen error:', error);
    res.status(500).json({ error: 'Could not reopen the roster' });
  }
});

module.exports = router;
module.exports.monthDays = monthDays;
