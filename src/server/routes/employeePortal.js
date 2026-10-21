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

const JWT_SECRET = process.env.JWT_SECRET;
const PORTAL_TOKEN_EXPIRY = '30d';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const DUPLICATE_TAP_WINDOW_MS = 2 * 60 * 1000;

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
  const [[last]] = await sequelize.query(
    `SELECT * FROM attendance_records WHERE employee_id = :employeeId AND status = 'accepted'
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
      const [[today]] = await sequelize.query(`SELECT CURRENT_DATE AS d`);
      shiftDate = today.d;
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
    res.status(500).json({ error: 'Could not record attendance. Please try again.' });
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

module.exports = router;
