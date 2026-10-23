/**
 * The mobile Employee Portal's own API — login, first-login PIN setup, and
 * geofenced QR clock in/out. Mounted at /api/employee-portal, registered in
 * index.js BEFORE `app.use('/api', authenticateToken)` for the public
 * /auth/login route (no JWT exists yet, same reasoning as
 * routes/publicPayroll.js), with every other route gated by this file's own
 * authenticateEmployeePortal middleware instead of the main one — see
 * middleware/employeePortalAuth.js for why that separation matters.
 *
 * Leave/salary-advance portal tabs and the HOD "Approvals" tab are a
 * separate, later phase — see the HR attendance/portal feature's planning
 * notes. This file is Section 3 + the portal-login half of Section 5 only.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Client } = require('../models/platform');
const { getTenantConnection } = require('../tenantDb');
const tenantContext = require('../tenantContext');
const { portalLoginLimiter, portalClockLimiter } = require('../middleware/rateLimiters');
const { authenticateEmployeePortal, requirePortalPinSet } = require('../middleware/employeePortalAuth');
const { verifyToken } = require('../utils/attendanceQr');
const { checkGeofence } = require('../utils/geofence');
const { getWorkflowSettings } = require('../config/ensureHrWorkflowSettings');
const { resolveApprover, isApproverFor } = require('../utils/approverResolution');
const { notifyRole, notifyUser } = require('../services/notificationService');
const { notifyEmployee } = require('../utils/portalNotify');
const { completePayrollLineReceipt } = require('../services/PayrollPayment');
const { checkRosterForClockIn } = require('../utils/rosterCheck');

const JWT_SECRET = process.env.JWT_SECRET;
const PORTAL_TOKEN_EXPIRY = '30d';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const DUPLICATE_TAP_WINDOW_MS = 2 * 60 * 1000;
// Mirrors publicPayroll.js's own signing-link lifetime — the same QR is
// meant to work the same way whether it's scanned by the kiosk page or from
// inside the portal.
const PAYROLL_TOKEN_MAX_AGE_DAYS = 14;

async function resolveTenantConnection(code) {
  const client = await Client.findOne({ where: { code: String(code || '').trim().toLowerCase() } });
  if (!client || client.status !== 'active') return null;
  return { tenantConnection: await getTenantConnection(client.schema_name), schemaName: client.schema_name };
}

async function logLoginAttempt(sequelize, { clinicId, employeeId, employeeNumber, success, req }) {
  try {
    await sequelize.query(
      `INSERT INTO portal_login_attempts (id, clinic_id, employee_id, employee_number, success, ip, user_agent, created_at)
       VALUES (:id, :clinicId, :employeeId, :employeeNumber, :success, :ip, :userAgent, NOW())`,
      {
        replacements: {
          id: uuidv4(),
          clinicId: clinicId || null,
          employeeId: employeeId || null,
          employeeNumber: employeeNumber || null,
          success,
          ip: req.ip,
          userAgent: (req.headers['user-agent'] || '').slice(0, 500),
        },
      }
    );
  } catch (e) { /* best-effort audit log — never block login on this */ }
}

// ─── POST /login — public, no JWT yet ──────────────────────────────────
router.post('/login', portalLoginLimiter, async (req, res) => {
  try {
    const { code, employee_number, credential } = req.body || {};
    if (!code || !employee_number || !credential) {
      return res.status(400).json({ error: 'Code, employee number, and PIN/access code are required.' });
    }

    const resolved = await resolveTenantConnection(code);
    if (!resolved) return res.status(401).json({ error: 'Invalid employee number or code.' });
    const { tenantConnection, schemaName } = resolved;

    return tenantContext.run(tenantConnection, async () => {
      const { sequelize } = tenantConnection;
      const [[employee]] = await sequelize.query(
        `SELECT * FROM employees WHERE LOWER(employee_number) = LOWER(:employeeNumber) AND is_active = TRUE LIMIT 1`,
        { replacements: { employeeNumber: String(employee_number).trim() } }
      );

      if (!employee || employee.employment_status !== 'active') {
        await logLoginAttempt(sequelize, { employeeNumber: employee_number, success: false, req });
        return res.status(401).json({ error: 'Invalid employee number or code.' });
      }
      if (!employee.portal_access_enabled) {
        await logLoginAttempt(sequelize, { clinicId: employee.clinic_id, employeeId: employee.id, employeeNumber: employee_number, success: false, req });
        return res.status(401).json({ error: 'Portal access has not been set up for this account. Contact HR.' });
      }
      if (employee.portal_locked_until && new Date(employee.portal_locked_until) > new Date()) {
        await logLoginAttempt(sequelize, { clinicId: employee.clinic_id, employeeId: employee.id, employeeNumber: employee_number, success: false, req });
        const minutesLeft = Math.ceil((new Date(employee.portal_locked_until) - new Date()) / 60000);
        return res.status(423).json({ error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` });
      }

      const hashToCheck = employee.portal_pin_hash || employee.portal_code_hash;
      const isValid = hashToCheck ? await bcrypt.compare(String(credential), hashToCheck) : false;

      if (!isValid) {
        const attempts = (employee.portal_failed_attempts || 0) + 1;
        const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
        await sequelize.query(
          `UPDATE employees SET portal_failed_attempts = :attempts, portal_locked_until = :lockedUntil WHERE id = :id`,
          { replacements: { attempts, lockedUntil, id: employee.id } }
        );
        await logLoginAttempt(sequelize, { clinicId: employee.clinic_id, employeeId: employee.id, employeeNumber: employee_number, success: false, req });
        return res.status(401).json({ error: 'Invalid employee number or code.' });
      }

      await sequelize.query(
        `UPDATE employees SET portal_failed_attempts = 0, portal_locked_until = NULL, portal_last_login_at = NOW() WHERE id = :id`,
        { replacements: { id: employee.id } }
      );
      await logLoginAttempt(sequelize, { clinicId: employee.clinic_id, employeeId: employee.id, employeeNumber: employee_number, success: true, req });

      const token = jwt.sign(
        { employeeId: employee.id, schemaName, isEmployeePortal: true },
        JWT_SECRET,
        { expiresIn: PORTAL_TOKEN_EXPIRY }
      );
      return res.json({
        token,
        mustSetPin: !employee.portal_pin_hash,
        employee: {
          id: employee.id,
          employeeNumber: employee.employee_number,
          firstName: employee.first_name,
          lastName: employee.last_name,
        },
      });
    });
  } catch (error) {
    console.error('Employee portal login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─── Everything below requires the employee-portal JWT ─────────────────
router.use(authenticateEmployeePortal);

// Allowed even on a first-login (mustSetPin) session — this is the only
// way to clear that flag.
router.post('/auth/set-pin', async (req, res) => {
  try {
    const { pin } = req.body || {};
    if (!pin || !/^\d{4,6}$/.test(String(pin))) {
      return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
    }
    const { sequelize } = require('../models');
    const pinHash = await bcrypt.hash(String(pin), 12);
    await sequelize.query(
      `UPDATE employees SET portal_pin_hash = :pinHash, portal_pin_set_at = NOW(), portal_code_hash = NULL WHERE id = :id`,
      { replacements: { pinHash, id: req.employee.id } }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Set PIN error:', error);
    res.status(500).json({ error: 'Could not set PIN. Please try again.' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [[headRow]] = await sequelize.query(
      `SELECT 1 FROM departments WHERE head_employee_id = :employeeId LIMIT 1`,
      { replacements: { employeeId: req.employee.id } }
    );
    res.json({
      employee: {
        id: req.employee.id,
        employeeNumber: req.employee.employeeNumber,
        firstName: req.employee.firstName,
        lastName: req.employee.lastName,
        department: req.employee.department,
      },
      mustSetPin: req.employee.mustSetPin,
      isDepartmentHead: !!headRow,
    });
  } catch (error) {
    console.error('Employee portal /me error:', error);
    res.status(500).json({ error: 'Could not load your profile.' });
  }
});

// Everything from here on requires a PIN already set.
router.use(requirePortalPinSet);

async function findOpenOrLastRecord(sequelize, employeeId) {
  // 'corrected' counts as a real clock event too — same reasoning as the
  // attendance_days view (see ensureAttendanceTables.js): a corrected
  // record is HR's authoritative version of what happened, not a
  // rejection, so the employee's current in/out status must reflect it.
  const [[last]] = await sequelize.query(
    `SELECT * FROM attendance_records WHERE employee_id = :employeeId AND status IN ('accepted', 'corrected')
     ORDER BY occurred_at DESC LIMIT 1`,
    { replacements: { employeeId } }
  );
  return last || null;
}

async function storeRecord(sequelize, fields) {
  const id = uuidv4();
  await sequelize.query(
    `INSERT INTO attendance_records (
       id, clinic_id, branch_id, employee_id, site_id, type, occurred_at, shift_date,
       latitude, longitude, accuracy_m, distance_m, method, status, reject_reason, device_info, ip, created_at
     ) VALUES (
       :id, :clinicId, :branchId, :employeeId, :siteId, :type, NOW(), :shiftDate,
       :latitude, :longitude, :accuracyM, :distanceM, :method, :status, :rejectReason, :deviceInfo, :ip, NOW()
     )`,
    { replacements: { id, ...fields } }
  );
  return id;
}

router.post('/attendance/clock', portalClockLimiter, async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const { token, sig, type, latitude, longitude, accuracy_m } = req.body || {};
    if (!['in', 'out'].includes(type)) {
      return res.status(400).json({ error: 'Invalid clock type.' });
    }
    const siteId = String(token || '').split('.')[0];
    const [[site]] = await sequelize.query(
      `SELECT * FROM attendance_sites WHERE id = :siteId AND clinic_id = :clinicId AND is_active = TRUE LIMIT 1`,
      { replacements: { siteId, clinicId: req.employee.clinicId } }
    );
    if (!site) {
      return res.status(400).json({ error: 'This QR code does not belong to a known attendance site.' });
    }

    const verification = verifyToken({ token, sig, site });
    const attemptedMethod = verification.method || (String(token).split('.').length === 3 ? 'qr_rotating' : 'qr_static');
    const deviceInfo = (req.headers['user-agent'] || '').slice(0, 500);
    const baseFields = {
      clinicId: req.employee.clinicId,
      branchId: site.branch_id,
      employeeId: req.employee.id,
      siteId: site.id,
      type,
      latitude: typeof latitude === 'number' ? latitude : null,
      longitude: typeof longitude === 'number' ? longitude : null,
      accuracyM: typeof accuracy_m === 'number' ? accuracy_m : null,
      distanceM: null,
      method: attemptedMethod,
      deviceInfo,
      ip: req.ip,
    };

    if (!verification.valid) {
      await storeRecord(sequelize, { ...baseFields, shiftDate: new Date().toISOString().slice(0, 10), status: 'rejected', rejectReason: verification.reason });
      return res.status(400).json({ error: verification.reason });
    }

    const geo = checkGeofence({ latitude, longitude, accuracyM: accuracy_m, site });
    if (!geo.ok) {
      await storeRecord(sequelize, { ...baseFields, distanceM: geo.distance_m, shiftDate: new Date().toISOString().slice(0, 10), status: 'rejected', rejectReason: geo.reason });
      return res.status(400).json({ error: geo.reason });
    }

    const last = await findOpenOrLastRecord(sequelize, req.employee.id);
    const now = Date.now();
    let shiftDate;

    // Duplicate-tap guard: a second rapid tap of the SAME action (e.g. a
    // network retry after clocking out) is checked before the sequence
    // rules below, which would otherwise reject it as "not clocked in"/
    // "already clocked in" with a confusing, differently-worded message.
    if (last && last.type === type && now - new Date(last.occurred_at).getTime() < DUPLICATE_TAP_WINDOW_MS) {
      return res.status(400).json({ error: 'Please wait a moment before trying again.' });
    }

    if (type === 'in') {
      if (last && last.type === 'in') {
        await storeRecord(sequelize, { ...baseFields, distanceM: geo.distance_m, shiftDate: new Date().toISOString().slice(0, 10), status: 'rejected', rejectReason: `You're already clocked in since ${new Date(last.occurred_at).toLocaleTimeString()}. Clock out first.` });
        return res.status(400).json({ error: "You're already clocked in. Clock out first." });
      }
      // Duty roster rule (off unless HR turned it on and the department's
      // roster for the month is approved) — see utils/rosterCheck.js.
      const rosterCheck = await checkRosterForClockIn(sequelize, { clinicId: req.employee.clinicId, employeeId: req.employee.id });
      if (!rosterCheck.ok) {
        await storeRecord(sequelize, { ...baseFields, distanceM: geo.distance_m, shiftDate: new Date().toISOString().slice(0, 10), status: 'rejected', rejectReason: rosterCheck.reason });
        return res.status(400).json({ error: rosterCheck.reason });
      }
      if (rosterCheck.shiftDate) {
        shiftDate = rosterCheck.shiftDate;
      } else {
        const [[today]] = await sequelize.query(`SELECT CURRENT_DATE AS d`);
        shiftDate = today.d;
      }
    } else {
      if (!last || last.type === 'out') {
        await storeRecord(sequelize, { ...baseFields, distanceM: geo.distance_m, shiftDate: new Date().toISOString().slice(0, 10), status: 'rejected', rejectReason: "You're not clocked in." });
        return res.status(400).json({ error: "You're not clocked in." });
      }
      // Overnight shift: an 'out' belongs to the shift_date of its matching
      // open 'in', even if the calendar date has rolled over since.
      shiftDate = last.shift_date;
    }

    await storeRecord(sequelize, { ...baseFields, distanceM: geo.distance_m, shiftDate, status: 'accepted', rejectReason: null });

    res.json({
      ok: true,
      type,
      site_name: site.name,
      occurred_at: new Date().toISOString(),
      message: type === 'in'
        ? `Clocked in at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${site.name}`
        : `Clocked out at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${site.name}`,
    });
  } catch (error) {
    console.error('Employee portal clock error:', error);
    if (String(error.message || '').includes('ATTENDANCE_QR_SECRET')) {
      return res.status(503).json({ error: 'Attendance is not configured on this server yet. Contact your administrator.' });
    }
    res.status(500).json({ error: 'Could not record attendance. Please try again.' });
  }
});

// My Roster — the employee's own shifts for a month, from APPROVED rosters only.
router.get('/roster', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.period || '')) ? String(req.query.period) : null;
    const [[cur]] = await sequelize.query(`SELECT TO_CHAR(CURRENT_DATE, 'YYYY-MM') AS p, CURRENT_DATE AS d`);
    const month = period || cur.p;
    const [[emp]] = await sequelize.query(`SELECT department FROM employees WHERE id = :id`, { replacements: { id: req.employee.id } });
    const [[roster]] = await sequelize.query(
      `SELECT status FROM duty_rosters WHERE clinic_id = :clinicId AND department = :department AND period = :period
        ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END LIMIT 1`,
      { replacements: { clinicId: req.employee.clinicId, department: emp?.department || '', period: month } }
    );
    const [entries] = await sequelize.query(
      `SELECT dre.duty_date, s.name, s.code, s.kind, s.color, s.start_time, s.end_time
         FROM duty_roster_entries dre
         JOIN duty_rosters dr ON dr.id = dre.roster_id AND dr.status = 'approved' AND dr.period = :period
         JOIN shifts s ON s.id = dre.shift_id
        WHERE dre.employee_id = :employeeId
        ORDER BY dre.duty_date`,
      { replacements: { employeeId: req.employee.id, period: month } }
    );
    res.json({
      period: month,
      today: String(cur.d instanceof Date ? cur.d.toISOString() : cur.d).slice(0, 10),
      department: emp?.department || null,
      status: roster?.status || null,
      entries: entries.map((e) => ({ ...e, duty_date: String(e.duty_date instanceof Date ? e.duty_date.toISOString() : e.duty_date).slice(0, 10) })),
    });
  } catch (error) {
    console.error('Employee portal roster error:', error);
    res.status(500).json({ error: 'Could not load your roster.' });
  }
});

router.get('/attendance/summary', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [week] = await sequelize.query(
      `SELECT shift_date, first_in, last_out, hours_worked FROM attendance_days
       WHERE employee_id = :employeeId AND shift_date >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY shift_date DESC`,
      { replacements: { employeeId: req.employee.id } }
    );
    const [[month]] = await sequelize.query(
      `SELECT COALESCE(SUM(hours_worked), 0) AS total_hours FROM attendance_days
       WHERE employee_id = :employeeId AND date_trunc('month', shift_date) = date_trunc('month', CURRENT_DATE)`,
      { replacements: { employeeId: req.employee.id } }
    );
    const [[today]] = await sequelize.query(
      `SELECT first_in, last_out FROM attendance_days WHERE employee_id = :employeeId AND shift_date = CURRENT_DATE`,
      { replacements: { employeeId: req.employee.id } }
    );
    res.json({
      today: today || null,
      week,
      monthTotalHours: Number(month.total_hours) || 0,
    });
  } catch (error) {
    console.error('Employee portal summary error:', error);
    res.status(500).json({ error: 'Could not load attendance summary.' });
  }
});

// ─── Notifications bell ─────────────────────────────────────────────────

router.get('/notifications', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [rows] = await sequelize.query(
      `SELECT * FROM portal_notifications WHERE employee_id = :employeeId ORDER BY created_at DESC LIMIT 50`,
      { replacements: { employeeId: req.employee.id } }
    );
    const [[unread]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM portal_notifications WHERE employee_id = :employeeId AND is_read = FALSE`,
      { replacements: { employeeId: req.employee.id } }
    );
    res.json({ notifications: rows, unreadCount: parseInt(unread.cnt, 10) });
  } catch (error) {
    console.error('Employee portal notifications error:', error);
    res.status(500).json({ error: 'Could not load notifications.' });
  }
});

router.post('/notifications/:id/read', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    await sequelize.query(
      `UPDATE portal_notifications SET is_read = TRUE WHERE id = :id AND employee_id = :employeeId`,
      { replacements: { id: req.params.id, employeeId: req.employee.id } }
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not update notification.' });
  }
});

// ─── Payroll — view own payslips, scan the HR-generated QR to confirm
// receipt. The QR already encodes a real, working link (hr.js's
// POST /payroll/runs/:id/lines/:lineId/signing-link + the public kiosk page
// at routes/publicPayroll.js): /payroll-sign/{tenantCode}/{signing_token}.
// Scanning it from inside the portal reuses that exact signing_token and the
// same underlying payment completion (PayrollPayment.completePayrollLineReceipt)
// instead of re-implementing it — the only thing that changes is how
// identity is proven: the public kiosk page has no login at all, so it
// re-asks for the employee number; here the portal's own JWT already proves
// who's scanning, so the one check that actually matters is that the
// token's line belongs to THIS employee. No signature is captured here (per
// product decision) — a null signature on an otherwise-paid/signed line is
// how this path is told apart from the kiosk one if that's ever needed.
router.get('/payroll/lines', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [rows] = await sequelize.query(
      `SELECT prl.id, prl.net_pay, prl.currency, prl.status, prl.signed_at,
              pr.run_number, pr.period_month, pr.period_year
       FROM payroll_run_lines prl
       JOIN payroll_runs pr ON pr.id = prl.payroll_run_id
       WHERE prl.employee_id = :employeeId
       ORDER BY pr.period_year DESC, pr.period_month DESC`,
      { replacements: { employeeId: req.employee.id } }
    );
    res.json(rows.map((r) => ({
      id: r.id,
      run_number: r.run_number,
      period_month: r.period_month,
      period_year: r.period_year,
      net_pay: r.net_pay,
      currency: r.currency,
      status: r.status,
      received: !!r.signed_at,
      received_at: r.signed_at,
    })));
  } catch (error) {
    console.error('Employee portal payroll lines error:', error);
    res.status(500).json({ error: 'Could not load your payroll.' });
  }
});

router.post('/payroll/confirm-receipt', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    // The scanner may hand back the bare token or the full scanned URL
    // (…/payroll-sign/{code}/{token}) — accept either.
    const raw = String(req.body?.token || '').trim();
    const token = raw.includes('/') ? raw.split('/').filter(Boolean).pop() : raw;
    if (!token) return res.status(400).json({ error: 'No valid code found in that QR code.' });

    const [[line]] = await sequelize.query(
      `SELECT prl.*, pr.run_number, pr.period_month, pr.period_year, pr.status AS run_status, pr.clinic_id, pr.run_date,
              pr.payment_account_id AS run_payment_account_id,
              e.employee_number, e.first_name, e.last_name, e.employment_type
       FROM payroll_run_lines prl
       JOIN payroll_runs pr ON pr.id = prl.payroll_run_id
       JOIN employees e ON e.id = prl.employee_id
       WHERE prl.signing_token = :token`,
      { replacements: { token } }
    );
    if (!line) return res.status(404).json({ error: 'This QR code is invalid or has expired. Ask HR to generate a new one.' });

    // The real security boundary for this authenticated path: the raw token
    // alone (as the unauthenticated kiosk page uses it) has no owner check,
    // but a portal session must only ever be able to confirm its OWN line.
    if (line.employee_id !== req.employee.id) {
      return res.status(403).json({ error: 'This QR code belongs to a different employee.' });
    }
    if (line.signing_token_created_at) {
      const ageMs = Date.now() - new Date(line.signing_token_created_at).getTime();
      if (ageMs > PAYROLL_TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
        return res.status(410).json({ error: 'This QR code has expired. Ask HR to generate a new one.' });
      }
    }

    const glEntry = await completePayrollLineReceipt(sequelize, line, { signatureData: null, userId: null });

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: null, user_name: `${line.first_name} ${line.last_name} (employee portal)`, user_role: 'employee',
        module: 'HR', action: 'PAYROLL_LINE_SIGNED', entity_type: 'PayrollRunLine', entity_id: line.id,
        description: `Payroll ${line.run_number} — ${line.first_name} ${line.last_name} confirmed receipt via the employee portal, GL entry ${glEntry.gl_number}`,
        status: 'success',
      });
    } catch (e) { /* non-blocking */ }

    res.json({ ok: true, net_pay: line.net_pay, currency: line.currency, run_number: line.run_number });
  } catch (error) {
    console.error('Employee portal confirm-receipt error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Could not confirm receipt. Please try again.' });
  }
});

// ─── Tab 2: Leave requests — uses the EXISTING leave_requests/leave_types
// tables and the same workflow leave.js enforces, just scoped to the
// logged-in employee instead of an HMIS user. ───────────────────────────

function calcLeaveDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}

router.get('/leave/balance', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const [types] = await sequelize.query(
      `SELECT * FROM leave_types WHERE clinic_id = :clinicId AND is_active = true ORDER BY name`,
      { replacements: { clinicId: req.employee.clinicId } }
    );
    const [taken] = await sequelize.query(
      `SELECT leave_type_id, COALESCE(SUM(days), 0) AS taken_days FROM leave_requests
       WHERE employee_id = :employeeId AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = :year
       GROUP BY leave_type_id`,
      { replacements: { employeeId: req.employee.id, year } }
    );
    const takenByType = Object.fromEntries(taken.map((t) => [t.leave_type_id, parseFloat(t.taken_days) || 0]));
    res.json(types.map((t) => {
      const entitled = parseFloat(t.default_annual_days) || 0;
      const takenDays = takenByType[t.id] || 0;
      return { leave_type_id: t.id, leave_type_name: t.name, entitled_days: entitled, taken_days: takenDays, remaining_days: Math.max(entitled - takenDays, 0) };
    }));
  } catch (error) {
    console.error('Employee portal leave balance error:', error);
    res.status(500).json({ error: 'Could not load leave balance.' });
  }
});

router.get('/leave/requests', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [rows] = await sequelize.query(
      `SELECT lr.*, lt.name AS leave_type_name FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.employee_id = :employeeId ORDER BY lr.created_at DESC`,
      { replacements: { employeeId: req.employee.id } }
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Could not load leave requests.' });
  }
});

router.post('/leave/requests', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const b = req.body || {};
    if (!b.leave_type_id || !b.start_date || !b.end_date) {
      return res.status(400).json({ error: 'Leave type, start date, and end date are required.' });
    }
    if (b.end_date < b.start_date) return res.status(400).json({ error: 'End date must be on or after the start date.' });

    const [[leaveType]] = await sequelize.query(
      `SELECT id, name, default_annual_days FROM leave_types WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: b.leave_type_id, clinicId: req.employee.clinicId } }
    );
    if (!leaveType) return res.status(404).json({ error: 'Leave type not found.' });

    const days = calcLeaveDays(b.start_date, b.end_date);
    const entitled = parseFloat(leaveType.default_annual_days) || 0;
    if (entitled > 0) {
      const year = new Date(`${b.start_date}T00:00:00Z`).getUTCFullYear();
      const [[takenRow]] = await sequelize.query(
        `SELECT COALESCE(SUM(days), 0) AS taken_days FROM leave_requests
         WHERE employee_id = :employeeId AND leave_type_id = :leaveTypeId AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = :year`,
        { replacements: { employeeId: req.employee.id, leaveTypeId: b.leave_type_id, year } }
      );
      const remaining = Math.max(entitled - (parseFloat(takenRow.taken_days) || 0), 0);
      if (days > remaining) {
        return res.status(400).json({ error: `This request is for ${days} day(s) of ${leaveType.name}, but only ${remaining} day(s) remain of the ${entitled}-day annual entitlement.` });
      }
    }

    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO leave_requests (id, clinic_id, branch_id, employee_id, leave_type_id, start_date, end_date, days, reason, status, attachment_url, created_at, updated_at)
       VALUES (:id, :clinicId, :branchId, :employeeId, :leaveTypeId, :startDate, :endDate, :days, :reason, 'pending', :attachmentUrl, NOW(), NOW())`,
      {
        replacements: {
          id, clinicId: req.employee.clinicId, branchId: req.employee.branchId, employeeId: req.employee.id,
          leaveTypeId: b.leave_type_id, startDate: b.start_date, endDate: b.end_date, days,
          reason: b.reason || null, attachmentUrl: b.attachment_url || null,
        },
      }
    );

    const settings = await getWorkflowSettings(sequelize, req.employee.clinicId);
    const employeeLabel = `${req.employee.firstName} ${req.employee.lastName}`;
    let notifiedApprover = false;
    if (settings.leave_require_hod) {
      const approver = await resolveApprover(sequelize, { clinicId: req.employee.clinicId, employeeId: req.employee.id, department: req.employee.department });
      if (approver?.approverUserId) {
        await notifyUser(sequelize, { clinic_id: req.employee.clinicId, user_id: approver.approverUserId, type: 'leave_request_awaiting_hod', title: 'Leave request awaiting your approval', message: `${employeeLabel} requested ${days} day(s) of ${leaveType.name}.`, entity_type: 'leave_request', entity_id: id, link: '/hr/leave' });
        notifiedApprover = true;
      }
      if (approver?.approverEmployeeId) {
        await notifyEmployee(sequelize, { clinic_id: req.employee.clinicId, employee_id: approver.approverEmployeeId, type: 'leave_request_awaiting_hod', title: 'Leave request awaiting your approval', message: `${employeeLabel} requested ${days} day(s) of ${leaveType.name}.`, entity_type: 'leave_request', entity_id: id });
        notifiedApprover = true;
      }
    }
    if (!notifiedApprover) {
      await notifyRole(sequelize, { clinic_id: req.employee.clinicId, role: 'admin', branch_id: req.employee.branchId, type: 'leave_request_awaiting_hr', title: 'Leave request awaiting approval', message: `${employeeLabel} requested ${days} day(s) of ${leaveType.name}.`, entity_type: 'leave_request', entity_id: id, link: '/hr/leave' });
    }

    const [[created]] = await sequelize.query(`SELECT * FROM leave_requests WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Employee portal leave request error:', error);
    res.status(500).json({ error: 'Could not submit leave request.' });
  }
});

router.post('/leave/requests/:id/cancel', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [, meta] = await sequelize.query(
      `UPDATE leave_requests SET status = 'cancelled', updated_at = NOW()
       WHERE id = :id AND employee_id = :employeeId AND status IN ('pending', 'approved_by_hod', 'approved')`,
      { replacements: { id: req.params.id, employeeId: req.employee.id } }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Only a pending or approved request can be cancelled.' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not cancel leave request.' });
  }
});

// ─── Tab 3: Salary advances — same existing salary_advances table/rules
// as SalaryAdvancesManagement.tsx, scoped to the logged-in employee. ────

router.get('/advances', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [rows] = await sequelize.query(
      `SELECT sa.*, (SELECT COALESCE(SUM(amount), 0) FROM salary_advance_repayments WHERE salary_advance_id = sa.id) AS total_repaid
       FROM salary_advances sa WHERE sa.employee_id = :employeeId ORDER BY sa.created_at DESC`,
      { replacements: { employeeId: req.employee.id } }
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Could not load salary advances.' });
  }
});

router.post('/advances', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const b = req.body || {};
    const amountRequested = parseFloat(b.amount);
    if (!(amountRequested > 0)) return res.status(400).json({ error: 'A positive amount is required.' });

    const [[employee]] = await sequelize.query(`SELECT basic_salary, hire_date FROM employees WHERE id = :id`, { replacements: { id: req.employee.id } });
    const settings = await getWorkflowSettings(sequelize, req.employee.clinicId);

    const maxAllowed = (parseFloat(employee.basic_salary) || 0) * (parseFloat(settings.advance_max_percent_of_salary) / 100);
    if (maxAllowed > 0 && amountRequested > maxAllowed + 0.01) {
      return res.status(400).json({ error: `This advance exceeds the limit of ${settings.advance_max_percent_of_salary}% of basic salary (max ${maxAllowed.toFixed(2)}).` });
    }
    const [[openRow]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM salary_advances WHERE employee_id = :employeeId AND status IN ('pending', 'approved_by_hod', 'approved', 'disbursed', 'repaying')`,
      { replacements: { employeeId: req.employee.id } }
    );
    if (parseInt(openRow.cnt, 10) >= settings.advance_max_open_advances) {
      return res.status(400).json({ error: `You already have ${openRow.cnt} open advance(s); the maximum allowed is ${settings.advance_max_open_advances}.` });
    }
    if (settings.advance_min_months_of_service > 0) {
      if (!employee.hire_date) return res.status(400).json({ error: `A minimum of ${settings.advance_min_months_of_service} month(s) of service is required.` });
      const monthsOfService = (Date.now() - new Date(employee.hire_date).getTime()) / (30.44 * 24 * 60 * 60 * 1000);
      if (monthsOfService < settings.advance_min_months_of_service) {
        return res.status(400).json({ error: `A minimum of ${settings.advance_min_months_of_service} month(s) of service is required.` });
      }
    }
    if (b.repayment_months !== undefined && Number(b.repayment_months) > settings.advance_max_repayment_months) {
      return res.status(400).json({ error: `Repayment period cannot exceed ${settings.advance_max_repayment_months} months.` });
    }

    const [[seqRow]] = await sequelize.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(advance_number, '^.*-', ''), '')::int), 0) AS last FROM salary_advances WHERE advance_number ~ '^ADV-[0-9]+$'`
    );
    const advanceNumber = `ADV-${String((parseInt(seqRow?.last, 10) || 0) + 1).padStart(4, '0')}`;
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO salary_advances (id, clinic_id, branch_id, employee_id, advance_number, amount, currency, reason, request_date, status, balance_remaining, repayment_months, created_at, updated_at)
       VALUES (:id, :clinicId, :branchId, :employeeId, :advanceNumber, :amount, :currency, :reason, CURRENT_DATE, 'pending', :amount, :repaymentMonths, NOW(), NOW())`,
      {
        replacements: {
          id, clinicId: req.employee.clinicId, branchId: req.employee.branchId, employeeId: req.employee.id,
          advanceNumber, amount: amountRequested, currency: b.currency || 'USD', reason: b.reason || null,
          repaymentMonths: b.repayment_months ? parseInt(b.repayment_months, 10) : null,
        },
      }
    );

    const employeeLabel = `${req.employee.firstName} ${req.employee.lastName}`;
    let notifiedApprover = false;
    if (settings.advance_require_hod) {
      const approver = await resolveApprover(sequelize, { clinicId: req.employee.clinicId, employeeId: req.employee.id, department: req.employee.department });
      if (approver?.approverUserId) {
        await notifyUser(sequelize, { clinic_id: req.employee.clinicId, user_id: approver.approverUserId, type: 'advance_request_awaiting_hod', title: 'Salary advance awaiting your approval', message: `${employeeLabel} requested an advance of ${b.currency || 'USD'} ${amountRequested}.`, entity_type: 'salary_advance', entity_id: id, link: '/hr/salary-advances' });
        notifiedApprover = true;
      }
      if (approver?.approverEmployeeId) {
        await notifyEmployee(sequelize, { clinic_id: req.employee.clinicId, employee_id: approver.approverEmployeeId, type: 'advance_request_awaiting_hod', title: 'Salary advance awaiting your approval', message: `${employeeLabel} requested an advance of ${b.currency || 'USD'} ${amountRequested}.`, entity_type: 'salary_advance', entity_id: id });
        notifiedApprover = true;
      }
    }
    if (!notifiedApprover) {
      await notifyRole(sequelize, { clinic_id: req.employee.clinicId, role: 'admin', branch_id: req.employee.branchId, type: 'advance_request_awaiting_hr', title: 'Salary advance awaiting approval', message: `${employeeLabel} requested an advance of ${b.currency || 'USD'} ${amountRequested}.`, entity_type: 'salary_advance', entity_id: id, link: '/hr/salary-advances' });
    }

    const [[created]] = await sequelize.query(`SELECT * FROM salary_advances WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Employee portal advance request error:', error);
    res.status(500).json({ error: 'Could not submit advance request.' });
  }
});

router.post('/advances/:id/cancel', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [, meta] = await sequelize.query(
      `UPDATE salary_advances SET status = 'cancelled', updated_at = NOW()
       WHERE id = :id AND employee_id = :employeeId AND status IN ('pending', 'approved_by_hod', 'approved')`,
      { replacements: { id: req.params.id, employeeId: req.employee.id } }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Only a pending or approved advance can be cancelled.' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not cancel advance request.' });
  }
});

// ─── Tab 4 (heads of department only): Approvals ───────────────────────
// Only shown when GET /me's isDepartmentHead is true. Approves/rejects a
// team member's leave/advance exactly like the HMIS HOD endpoints in
// routes/leave.js / routes/salaryAdvances.js, authorized against
// req.employee.id directly instead of an HMIS user id.

router.get('/approvals', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [[headRow]] = await sequelize.query(`SELECT 1 FROM departments WHERE head_employee_id = :employeeId`, { replacements: { employeeId: req.employee.id } });
    const [overrideRows] = await sequelize.query(`SELECT employee_id FROM employee_approver_overrides WHERE approver_employee_id = :employeeId`, { replacements: { employeeId: req.employee.id } });
    if (!headRow && overrideRows.length === 0) return res.json({ leave: [], advances: [] });

    const [leave] = await sequelize.query(
      `SELECT lr.*, e.first_name, e.last_name, e.department, lt.name AS leave_type_name FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.status = 'pending' AND lr.clinic_id = :clinicId ORDER BY lr.created_at DESC`,
      { replacements: { clinicId: req.employee.clinicId } }
    );
    const [advances] = await sequelize.query(
      `SELECT sa.*, e.first_name, e.last_name, e.department FROM salary_advances sa
       JOIN employees e ON e.id = sa.employee_id
       WHERE sa.status = 'pending' AND sa.clinic_id = :clinicId ORDER BY sa.created_at DESC`,
      { replacements: { clinicId: req.employee.clinicId } }
    );
    // Filter down to requests this employee is actually the resolved
    // approver for — the query above is a clinic-wide draw, narrowed here
    // per-row since approver resolution depends on each requester's own
    // department/override.
    const mine = [];
    for (const row of leave) {
      if (await isApproverFor(sequelize, { clinicId: req.employee.clinicId, employeeId: row.employee_id, department: row.department, actingEmployeeId: req.employee.id })) mine.push(row);
    }
    const mineAdvances = [];
    for (const row of advances) {
      if (await isApproverFor(sequelize, { clinicId: req.employee.clinicId, employeeId: row.employee_id, department: row.department, actingEmployeeId: req.employee.id })) mineAdvances.push(row);
    }
    res.json({ leave: mine, advances: mineAdvances });
  } catch (error) {
    console.error('Employee portal approvals error:', error);
    res.status(500).json({ error: 'Could not load approvals.' });
  }
});

router.post('/approvals/leave/:id/approve', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [[request]] = await sequelize.query(`SELECT * FROM leave_requests WHERE id = :id AND clinic_id = :clinicId AND status = 'pending'`, { replacements: { id: req.params.id, clinicId: req.employee.clinicId } });
    if (!request) return res.status(404).json({ error: 'Leave request not found or not pending.' });
    const [[employee]] = await sequelize.query(`SELECT department, user_id, first_name, last_name FROM employees WHERE id = :id`, { replacements: { id: request.employee_id } });
    if (!(await isApproverFor(sequelize, { clinicId: req.employee.clinicId, employeeId: request.employee_id, department: employee?.department, actingEmployeeId: req.employee.id }))) {
      return res.status(403).json({ error: "You are not this employee's approver." });
    }
    await sequelize.query(`UPDATE leave_requests SET status = 'approved_by_hod', hod_approved_by = :approverUserId, hod_approved_at = NOW(), updated_at = NOW() WHERE id = :id`, { replacements: { id: request.id, approverUserId: null } });
    await notifyRole(sequelize, { clinic_id: req.employee.clinicId, role: 'admin', type: 'leave_request_awaiting_hr', title: 'Leave request awaiting HR approval', message: `${employee?.first_name} ${employee?.last_name}'s leave request was approved by their HOD.`, entity_type: 'leave_request', entity_id: request.id, link: '/hr/leave' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Portal HOD leave approve error:', error);
    res.status(500).json({ error: 'Could not approve leave request.' });
  }
});

router.post('/approvals/leave/:id/reject', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'A reason is required.' });
    const [[request]] = await sequelize.query(`SELECT * FROM leave_requests WHERE id = :id AND clinic_id = :clinicId AND status = 'pending'`, { replacements: { id: req.params.id, clinicId: req.employee.clinicId } });
    if (!request) return res.status(404).json({ error: 'Leave request not found or not pending.' });
    const [[employee]] = await sequelize.query(`SELECT department, user_id FROM employees WHERE id = :id`, { replacements: { id: request.employee_id } });
    if (!(await isApproverFor(sequelize, { clinicId: req.employee.clinicId, employeeId: request.employee_id, department: employee?.department, actingEmployeeId: req.employee.id }))) {
      return res.status(403).json({ error: "You are not this employee's approver." });
    }
    await sequelize.query(`UPDATE leave_requests SET status = 'rejected', hod_rejected_reason = :reason, rejection_reason = :reason, updated_at = NOW() WHERE id = :id`, { replacements: { id: request.id, reason } });
    if (employee?.user_id) await notifyUser(sequelize, { clinic_id: req.employee.clinicId, user_id: employee.user_id, type: 'leave_request_rejected', title: 'Your leave request was rejected', message: reason, entity_type: 'leave_request', entity_id: request.id });
    await notifyEmployee(sequelize, { clinic_id: req.employee.clinicId, employee_id: request.employee_id, type: 'leave_request_rejected', title: 'Your leave request was rejected', message: reason, entity_type: 'leave_request', entity_id: request.id });
    res.json({ ok: true });
  } catch (error) {
    console.error('Portal HOD leave reject error:', error);
    res.status(500).json({ error: 'Could not reject leave request.' });
  }
});

router.post('/approvals/advance/:id/approve', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [[advance]] = await sequelize.query(`SELECT * FROM salary_advances WHERE id = :id AND clinic_id = :clinicId AND status = 'pending'`, { replacements: { id: req.params.id, clinicId: req.employee.clinicId } });
    if (!advance) return res.status(404).json({ error: 'Advance not found or not pending.' });
    const [[employee]] = await sequelize.query(`SELECT department, first_name, last_name FROM employees WHERE id = :id`, { replacements: { id: advance.employee_id } });
    if (!(await isApproverFor(sequelize, { clinicId: req.employee.clinicId, employeeId: advance.employee_id, department: employee?.department, actingEmployeeId: req.employee.id }))) {
      return res.status(403).json({ error: "You are not this employee's approver." });
    }
    await sequelize.query(`UPDATE salary_advances SET status = 'approved_by_hod', hod_approved_at = NOW(), updated_at = NOW() WHERE id = :id`, { replacements: { id: advance.id } });
    await notifyRole(sequelize, { clinic_id: req.employee.clinicId, role: 'admin', type: 'advance_request_awaiting_hr', title: 'Salary advance awaiting HR approval', message: `${employee?.first_name} ${employee?.last_name}'s advance was approved by their HOD.`, entity_type: 'salary_advance', entity_id: advance.id, link: '/hr/salary-advances' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Portal HOD advance approve error:', error);
    res.status(500).json({ error: 'Could not approve advance.' });
  }
});

router.post('/approvals/advance/:id/reject', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'A reason is required.' });
    const [[advance]] = await sequelize.query(`SELECT * FROM salary_advances WHERE id = :id AND clinic_id = :clinicId AND status = 'pending'`, { replacements: { id: req.params.id, clinicId: req.employee.clinicId } });
    if (!advance) return res.status(404).json({ error: 'Advance not found or not pending.' });
    const [[employee]] = await sequelize.query(`SELECT department, user_id FROM employees WHERE id = :id`, { replacements: { id: advance.employee_id } });
    if (!(await isApproverFor(sequelize, { clinicId: req.employee.clinicId, employeeId: advance.employee_id, department: employee?.department, actingEmployeeId: req.employee.id }))) {
      return res.status(403).json({ error: "You are not this employee's approver." });
    }
    await sequelize.query(`UPDATE salary_advances SET status = 'cancelled', hod_rejected_reason = :reason, updated_at = NOW() WHERE id = :id`, { replacements: { id: advance.id, reason } });
    if (employee?.user_id) await notifyUser(sequelize, { clinic_id: req.employee.clinicId, user_id: employee.user_id, type: 'advance_request_rejected', title: 'Your salary advance request was rejected', message: reason, entity_type: 'salary_advance', entity_id: advance.id });
    await notifyEmployee(sequelize, { clinic_id: req.employee.clinicId, employee_id: advance.employee_id, type: 'advance_request_rejected', title: 'Your salary advance request was rejected', message: reason, entity_type: 'salary_advance', entity_id: advance.id });
    res.json({ ok: true });
  } catch (error) {
    console.error('Portal HOD advance reject error:', error);
    res.status(500).json({ error: 'Could not reject advance.' });
  }
});

module.exports = router;
