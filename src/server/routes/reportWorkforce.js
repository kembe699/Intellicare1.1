// ─── Workforce Reports (v2) ───────────────────────────────────────────────
//
// Attendance, Leave, Salary Advances, and Payroll registers — none of these
// had any report at all before this file (unlike Procurement/Accounting,
// which had their own standalone reporting UI before the central Reports
// Center existed, there's no HR-side reporting page to bridge in from).
// Same per-mode-sub-route shape as reportClinical.js: one router, one
// GET per register, each returning { period, rows }.
//
// Mounted as:
//   app.use('/api/reports-v2/workforce', require('./routes/reportWorkforce'));

const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
// Same reasoning as every other reports-v2 file — server-side gate, not
// just the frontend's requiredPrivilege check.
router.use(authorize('pages.reports.view'));

const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

function isoDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function asDateStr(v) {
  if (!v || typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function boolParam(v) { return v === 'true' || v === '1' || v === true; }

// Same convention as reportClinical.js's branchScope.
function branchScope(req, replacements, alias = '', skip = false) {
  if (skip) return '';
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

// ── GET /attendance-register ────────────────────────────────────────────
// Reads the existing attendance_days VIEW (ensureAttendanceTables.js) —
// already does the per-shift first-in/last-out/hours-worked/late-minutes
// aggregation; nothing to re-derive here.
router.get('/attendance-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const replacements = { dateFrom, dateTo };
    const branchSql = branchScope(req, replacements, 'ad', allBranches);

    const rows = await sequelize.query(
      `SELECT ad.employee_id AS "employeeId",
              COALESCE(e.first_name || ' ' || e.last_name, 'Unknown') AS "employeeName",
              e.employee_number AS "employeeNumber", e.department,
              ad.shift_date AS "shiftDate", ad.shift_name AS "shiftName",
              ad.first_in AS "firstIn", ad.last_out AS "lastOut",
              ROUND(ad.hours_worked::numeric, 2) AS "hoursWorked",
              ROUND(ad.late_minutes::numeric, 0) AS "lateMinutes",
              ROUND(ad.early_leave_minutes::numeric, 0) AS "earlyLeaveMinutes",
              ad.missing_clock_out AS "missingClockOut",
              b.name AS "branchName"
       FROM attendance_days ad
       JOIN employees e ON e.id = ad.employee_id
       LEFT JOIN branches b ON b.id = ad.branch_id
       WHERE ad.shift_date BETWEEN :dateFrom AND :dateTo ${branchSql}
       ORDER BY ad.shift_date DESC, e.first_name`,
      { replacements, type: QueryTypes.SELECT }
    );
    res.json({ period: { dateFrom, dateTo }, rows });
  } catch (err) {
    console.error('Workforce attendance-register error:', err);
    res.status(500).json({ error: 'Failed to generate attendance register' });
  }
});

// ── GET /leave-register ─────────────────────────────────────────────────
router.get('/leave-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const replacements = { dateFrom, dateTo };
    const branchSql = branchScope(req, replacements, 'lr', allBranches);

    const rows = await sequelize.query(
      `SELECT lr.employee_id AS "employeeId",
              COALESCE(e.first_name || ' ' || e.last_name, 'Unknown') AS "employeeName",
              e.employee_number AS "employeeNumber", e.department,
              lt.name AS "leaveTypeName",
              lr.start_date AS "startDate", lr.end_date AS "endDate", lr.days,
              lr.status, lr.reason,
              b.name AS "branchName"
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN branches b ON b.id = lr.branch_id
       WHERE lr.start_date BETWEEN :dateFrom AND :dateTo ${branchSql}
       ORDER BY lr.start_date DESC`,
      { replacements, type: QueryTypes.SELECT }
    );
    res.json({ period: { dateFrom, dateTo }, rows });
  } catch (err) {
    console.error('Workforce leave-register error:', err);
    res.status(500).json({ error: 'Failed to generate leave register' });
  }
});

// ── GET /salary-advances-register ───────────────────────────────────────
router.get('/salary-advances-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const replacements = { dateFrom, dateTo };
    const branchSql = branchScope(req, replacements, 'sa', allBranches);

    const rows = await sequelize.query(
      `SELECT sa.employee_id AS "employeeId",
              COALESCE(e.first_name || ' ' || e.last_name, 'Unknown') AS "employeeName",
              e.employee_number AS "employeeNumber", e.department,
              sa.advance_number AS "advanceNumber", sa.amount, sa.currency,
              sa.balance_remaining AS "balanceRemaining", sa.status,
              sa.request_date AS "requestDate", sa.repayment_months AS "repaymentMonths",
              b.name AS "branchName"
       FROM salary_advances sa
       JOIN employees e ON e.id = sa.employee_id
       LEFT JOIN branches b ON b.id = sa.branch_id
       WHERE sa.request_date BETWEEN :dateFrom AND :dateTo ${branchSql}
       ORDER BY sa.request_date DESC`,
      { replacements, type: QueryTypes.SELECT }
    );
    res.json({ period: { dateFrom, dateTo }, rows });
  } catch (err) {
    console.error('Workforce salary-advances-register error:', err);
    res.status(500).json({ error: 'Failed to generate salary advances register' });
  }
});

// ── GET /payroll-register ───────────────────────────────────────────────
// receiptConfirmed is derived from signed_at IS NOT NULL — the one column
// both the public kiosk signing page (routes/publicPayroll.js) AND the
// employee-portal QR scan (routes/employeePortal.js's confirm-receipt)
// stamp on a successful self-service confirmation, so this surfaces both
// paths without needing to know which one an employee used.
router.get('/payroll-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const replacements = { dateFrom, dateTo };
    const branchSql = branchScope(req, replacements, 'pr', allBranches);

    const rows = await sequelize.query(
      `SELECT prl.employee_id AS "employeeId",
              COALESCE(e.first_name || ' ' || e.last_name, 'Unknown') AS "employeeName",
              e.employee_number AS "employeeNumber", e.department,
              pr.run_number AS "runNumber", pr.period_month AS "periodMonth", pr.period_year AS "periodYear",
              prl.gross_pay AS "grossPay", prl.net_pay AS "netPay", prl.currency, prl.status,
              (prl.signed_at IS NOT NULL) AS "receiptConfirmed", prl.signed_at AS "signedAt", prl.paid_at AS "paidAt",
              b.name AS "branchName"
       FROM payroll_run_lines prl
       JOIN payroll_runs pr ON pr.id = prl.payroll_run_id
       JOIN employees e ON e.id = prl.employee_id
       LEFT JOIN branches b ON b.id = pr.branch_id
       WHERE pr.run_date BETWEEN :dateFrom AND :dateTo ${branchSql}
       ORDER BY pr.run_date DESC, e.first_name`,
      { replacements, type: QueryTypes.SELECT }
    );
    res.json({ period: { dateFrom, dateTo }, rows });
  } catch (err) {
    console.error('Workforce payroll-register error:', err);
    res.status(500).json({ error: 'Failed to generate payroll register' });
  }
});

module.exports = router;
