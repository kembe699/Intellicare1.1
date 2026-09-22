// ─── Patient Report (v2) ──────────────────────────────────────────────────
//
// Rewrite of the patient volume / billing report. The
// old src/server/routes/reports.js was full of Postgres-only SQL (AGE(),
// ::date casts, quoted INTERVAL literals, ON CONFLICT) that silently
// returned zeros on MySQL, the engine at the time. This router is self-contained
// only, and does not
// touch reports.js or index.js — it is meant to be mounted separately,
// e.g.:
//
//   const reportPatientsRouter = require('./routes/reportPatients');
//   app.use('/api/reports-v2/patients', reportPatientsRouter);
//
// Auth: relies on the global `app.use('/api', authenticateToken)` +
// `branchAccessControl` middleware already applied ahead of route mounting
// in index.js — req.user is expected to be populated by the time requests
// reach this router.
//
// IMPORTANT — two independent patient registries: this system tracks
// patients in BOTH the main `patients` table AND `lis_participants` (used
// by the LIS/lab registration flow at /lis/registration). Both are real
// sources of "a patient" and must be merged for any patient-count metric.
// `lis_participants` has no clinic_id column, so — matching the existing
// convention in src/pages/PatientsBill.tsx's fetchPeople(), which fetches
// LIS participants unfiltered by clinic — LIS registrations are counted
// clinic-agnostically here too.

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

// ── Helpers ──────────────────────────────────────────────────────────────

/** YYYY-MM-DD for `daysAgo` days before today (local server date). */
function isoDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

/** Validates a YYYY-MM-DD string; returns null if invalid/missing. */
function asDateStr(v) {
  if (!v || typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Non-admin users only see rows from their own branch; admins see everything.
// Written inline with named replacements (not branchFilter.js's
// getBranchConditionSQL, which uses positional `?` placeholders that can't
// mix with the named :params this file uses in the same query) — same
// convention as branchScope() in routes/hr.js.
function branchScope(req, replacements) {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  return ' AND branch_id = :branchId';
}

// ── GET / ────────────────────────────────────────────────────────────────
// Query params:
//   dateFrom, dateTo  — YYYY-MM-DD, default to the last 30 days
//   clinic_id         — defaults to the authenticated user's clinic
router.get('/', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = parseInt(req.query.clinic_id, 10) || req.user?.clinicId || 1;

    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { clinicId, fromTs, toTs };
    const branchSql = branchScope(req, repl);

    // 1. Visit volume in the period (clinic-scoped). The `visits` table is a legacy,
    //    barely-used table (3 rows total, all months stale) — the live clinical workflow's
    //    real unit of encounter is an `lis_test_orders` row, created per visit via
    //    POST /lis/orders (see billingResolver.js's getCurrentOpenVisitId, which treats
    //    it the same way). Counting those instead is what makes this stat non-zero.
    //
    //    NOT clinic-scoped, matching dashboard.js / reportLaboratory.js /
    //    reportDoctorPerformance.js: lis_test_orders.clinic_id is a false
    //    cognate — the *consulting clinic* (a dr_clinics UUID, alongside
    //    clinic_name/room_number), not the facility id. Comparing it to a
    //    numeric clinic_id matched almost nothing under MySQL (which coerced
    //    each UUID to 0) and errors outright on PostgreSQL, so this count was
    //    wrong before the migration and broken after it. Each tenant has its
    //    own schema, so the table already belongs to exactly one facility.
    const [visitsRow] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM lis_test_orders
       WHERE created_at BETWEEN :fromTs AND :toTs ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 2. Registered patients in the period — merged patients + lis_participants.
    const [patientsRow] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM patients
       WHERE clinic_id = :clinicId AND created_at BETWEEN :fromTs AND :toTs ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const [lisRow] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM lis_participants
       WHERE created_at BETWEEN :fromTs AND :toTs ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const fromPatients = parseInt(patientsRow.total, 10) || 0;
    const fromLis = parseInt(lisRow.total, 10) || 0;

    // 3. Paid in full — bills with status = 'paid' created in the period.
    const [paidRow] = await sequelize.query(
      `SELECT COUNT(*) AS cnt,
              COALESCE(SUM(total_amount), 0) AS "totalAmount",
              COALESCE(SUM(paid_amount), 0) AS "paidAmount"
       FROM patient_bills
       WHERE clinic_id = :clinicId AND status = 'paid'
         AND created_at BETWEEN :fromTs AND :toTs ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 4. Amount owed — current-state outstanding receivables (pending/partial),
    //    not bound to the period, plus the slice of that which originated
    //    within the selected period.
    const [outstandingAllRow] = await sequelize.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(balance_amount), 0) AS "totalOutstanding"
       FROM patient_bills
       WHERE clinic_id = :clinicId AND status IN ('pending', 'partial') ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const [outstandingInPeriodRow] = await sequelize.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(balance_amount), 0) AS "totalOutstanding"
       FROM patient_bills
       WHERE clinic_id = :clinicId AND status IN ('pending', 'partial')
         AND created_at BETWEEN :fromTs AND :toTs ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 5. Breakdown table — every bill created in the period (any status).
    const bills = await sequelize.query(
      `SELECT id, bill_number AS "billNumber", patient_id AS "patientId", patient_name AS "patientName",
              total_amount AS "totalAmount", paid_amount AS "paidAmount", balance_amount AS "balanceAmount",
              status, bill_date AS "billDate", created_at AS "createdAt"
       FROM patient_bills
       WHERE clinic_id = :clinicId AND created_at BETWEEN :fromTs AND :toTs ${branchSql}
       ORDER BY created_at DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({
      period: { dateFrom, dateTo },
      clinicId,
      visits: {
        total: parseInt(visitsRow.total, 10) || 0,
      },
      patientsRegistered: {
        total: fromPatients + fromLis,
        fromPatients,
        fromLis,
      },
      paidInFull: {
        count: parseInt(paidRow.cnt, 10) || 0,
        totalAmount: parseFloat(paidRow.totalAmount) || 0,
        paidAmount: parseFloat(paidRow.paidAmount) || 0,
      },
      outstanding: {
        totalOutstanding: parseFloat(outstandingAllRow.totalOutstanding) || 0,
        totalOutstandingCount: parseInt(outstandingAllRow.cnt, 10) || 0,
        inPeriodOutstanding: parseFloat(outstandingInPeriodRow.totalOutstanding) || 0,
        inPeriodOutstandingCount: parseInt(outstandingInPeriodRow.cnt, 10) || 0,
      },
      bills,
    });
  } catch (err) {
    console.error('Patient report error:', err);
    res.status(500).json({ error: 'Failed to generate patient report' });
  }
});

module.exports = router;
