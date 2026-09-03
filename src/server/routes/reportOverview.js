// ─── Dashboard Overview Report (v2) ───────────────────────────────────────
//
// Top-level analytics landing page for hospital administrators — headline
// KPIs, a daily revenue trend, a daily patient-registration trend, a
// payment-method breakdown, and a revenue-by-clinic breakdown.
//
// Follows the same conventions as the other
// reports-v2 routers (reportPatients.js, reportLaboratory.js, etc.) — plain
// MySQL SQL only (DATE()/DATEDIFF/unquoted INTERVAL n DAY), self-contained,
// not mounted here. Intended mount:
//
//   const reportOverviewRouter = require('./routes/reportOverview');
//   app.use('/api/reports-v2/overview', reportOverviewRouter);
//
// Auth: relies on the global `app.use('/api', authenticateToken)` +
// `branchAccessControl` middleware already applied ahead of route mounting
// in index.js — req.user is expected to be populated by the time requests
// reach this router.
//
// IMPORTANT — two independent patient registries: this system tracks
// patients in BOTH the main `patients` table AND `lis_participants` (used by
// the LIS/lab registration flow). Both are real sources of "a patient" and
// are merged here for patient-count metrics and the registration trend,
// matching the convention established in reportPatients.js.
//
// IMPORTANT — payment_method is a real MySQL enum with values
// ('cash','card','check','lease','insurance') — verified live against the
// `receipts` table on 2026-07-13. Do NOT assume mobile_money/bank_transfer/
// cheque, those are not real values in this schema.
//
// Clinic scoping: KPIs, the revenue trend, the patient trend and the
// payment-method breakdown are all scoped to a single clinic (the
// authenticated user's clinic, or ?clinic_id=), matching every other
// reports-v2 router. The "revenue by clinic" section is the one deliberate
// exception — it is intentionally unscoped so it can show all clinics side
// by side (there are only 2 clinic_names rows in this system).

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

/** Inclusive list of YYYY-MM-DD strings from `from` to `to`. */
function dateRange(from, to) {
  const out = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    out.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
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
    const days = dateRange(dateFrom, dateTo);

    // 1. Total revenue in the period (clinic-scoped, active receipts only).
    const [revenueRow] = await sequelize.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(payment_amount), 0) AS total
       FROM receipts
       WHERE clinic_id = :clinicId AND status = 'active'
         AND payment_date BETWEEN :fromTs AND :toTs`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 2. Patients registered in the period — merged patients + lis_participants.
    const [patientsRow] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM patients
       WHERE clinic_id = :clinicId AND created_at BETWEEN :fromTs AND :toTs`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const [lisRow] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM lis_participants
       WHERE created_at BETWEEN :fromTs AND :toTs`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const fromPatients = parseInt(patientsRow.total, 10) || 0;
    const fromLis = parseInt(lisRow.total, 10) || 0;

    // 3. Total visits in the period.
    //
    //    Counts lis_test_orders, not the `visits` table, matching the decision
    //    already documented in reportPatients.js: `visits` is legacy and barely
    //    written (6 rows here, newest 2026-06-29), while the live clinical
    //    workflow creates one lis_test_orders row per encounter via POST
    //    /lis/orders (58 rows, current). Reading `visits` made this headline KPI
    //    show 0 for any recent period.
    //
    //    Not clinic-scoped: lis_test_orders.clinic_id is the *consulting clinic*
    //    (a dr_clinics UUID), not the facility id — see dashboard.js and
    //    reportLaboratory.js. Each tenant has its own schema, so the table
    //    already belongs to exactly one facility.
    const [visitsRow] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM lis_test_orders
       WHERE created_at BETWEEN :fromTs AND :toTs`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 4. Outstanding receivables — current-state (pending/partial), NOT
    //    period-bound.
    const [outstandingRow] = await sequelize.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(balance_amount), 0) AS total
       FROM patient_bills
       WHERE clinic_id = :clinicId AND status IN ('pending', 'partial')`,
      { replacements: { clinicId }, type: QueryTypes.SELECT }
    );

    // 5. Payments collected vs pending — bills created in the period.
    const [collectionRow] = await sequelize.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS "totalBilled",
              COALESCE(SUM(paid_amount), 0) AS "totalPaid",
              COALESCE(SUM(balance_amount), 0) AS "totalPending"
       FROM patient_bills
       WHERE clinic_id = :clinicId AND created_at BETWEEN :fromTs AND :toTs`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const totalBilled = parseFloat(collectionRow.totalBilled) || 0;
    const totalPaid = parseFloat(collectionRow.totalPaid) || 0;
    const totalPending = parseFloat(collectionRow.totalPending) || 0;
    const collectionRate = totalBilled > 0 ? totalPaid / totalBilled : 0;

    // 6. Active cashiers in the period (distinct cashier_id on active receipts).
    const [cashiersRow] = await sequelize.query(
      `SELECT COUNT(DISTINCT cashier_id) AS total
       FROM receipts
       WHERE clinic_id = :clinicId AND status = 'active' AND cashier_id IS NOT NULL
         AND payment_date BETWEEN :fromTs AND :toTs`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 7. Daily revenue trend (clinic-scoped, active receipts).
    const revenueByDay = await sequelize.query(
      `SELECT DATE(payment_date) AS day, COALESCE(SUM(payment_amount), 0) AS total
       FROM receipts
       WHERE clinic_id = :clinicId AND status = 'active'
         AND payment_date BETWEEN :fromTs AND :toTs
       GROUP BY DATE(payment_date)`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const revenueMap = new Map(revenueByDay.map(r => [
      (r.day instanceof Date ? r.day.toISOString().split('T')[0] : String(r.day)),
      parseFloat(r.total) || 0,
    ]));
    const revenueTrend = days.map(day => ({ day, revenue: revenueMap.get(day) || 0 }));

    // 8. Daily patient-registration trend — merged patients + lis_participants.
    const patientsByDay = await sequelize.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS cnt
       FROM patients
       WHERE clinic_id = :clinicId AND created_at BETWEEN :fromTs AND :toTs
       GROUP BY DATE(created_at)`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const lisByDay = await sequelize.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS cnt
       FROM lis_participants
       WHERE created_at BETWEEN :fromTs AND :toTs
       GROUP BY DATE(created_at)`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const toDayKey = r => (r.day instanceof Date ? r.day.toISOString().split('T')[0] : String(r.day));
    const patientsMap = new Map(patientsByDay.map(r => [toDayKey(r), parseInt(r.cnt, 10) || 0]));
    const lisMap = new Map(lisByDay.map(r => [toDayKey(r), parseInt(r.cnt, 10) || 0]));
    const patientTrend = days.map(day => ({
      day,
      count: (patientsMap.get(day) || 0) + (lisMap.get(day) || 0),
    }));

    // 9. Payment-method breakdown (clinic-scoped, active receipts).
    //    Real enum values, verified live: cash, card, check, lease, insurance.
    const paymentMethodRows = await sequelize.query(
      `SELECT payment_method AS method, COUNT(*) AS cnt, COALESCE(SUM(payment_amount), 0) AS total
       FROM receipts
       WHERE clinic_id = :clinicId AND status = 'active'
         AND payment_date BETWEEN :fromTs AND :toTs
       GROUP BY payment_method
       ORDER BY total DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const paymentMethodBreakdown = paymentMethodRows.map(r => ({
      method: r.method,
      count: parseInt(r.cnt, 10) || 0,
      total: parseFloat(r.total) || 0,
    }));

    // 10. Revenue by clinic — deliberately UNSCOPED (all clinics), since this
    //     system only has 2 clinic_names rows and the whole point of this
    //     section is to compare them side by side.
    const clinicRevenueRows = await sequelize.query(
      `SELECT cn.id AS "clinicId", cn.name AS "clinicName",
              COALESCE(SUM(CASE WHEN r.status = 'active' THEN r.payment_amount ELSE 0 END), 0) AS revenue,
              COUNT(DISTINCT CASE WHEN r.status = 'active' THEN r.id END) AS "receiptCount"
       FROM clinic_names cn
       LEFT JOIN receipts r ON r.clinic_id = cn.id AND r.payment_date BETWEEN :fromTs AND :toTs
       GROUP BY cn.id, cn.name
       ORDER BY cn.id`,
      { replacements: { fromTs, toTs }, type: QueryTypes.SELECT }
    );
    // Still the legacy `visits` table: lis_test_orders cannot substitute here,
    // because its clinic_id is a dr_clinics UUID and this widget keys on
    // clinic_names.id (an int) — there is no join between the two dimensions.
    // These per-clinic visit counts are therefore stale; the headline Total
    // Visits KPI above is the accurate figure.
    const clinicVisitRows = await sequelize.query(
      `SELECT clinic_id AS "clinicId", COUNT(*) AS cnt
       FROM visits
       WHERE visit_date BETWEEN :fromTs AND :toTs
       GROUP BY clinic_id`,
      { replacements: { fromTs, toTs }, type: QueryTypes.SELECT }
    );
    const visitCountByClinic = new Map(clinicVisitRows.map(r => [parseInt(r.clinicId, 10), parseInt(r.cnt, 10) || 0]));
    const revenueByClinic = clinicRevenueRows.map(r => ({
      clinicId: parseInt(r.clinicId, 10),
      clinicName: r.clinicName,
      revenue: parseFloat(r.revenue) || 0,
      receiptCount: parseInt(r.receiptCount, 10) || 0,
      visits: visitCountByClinic.get(parseInt(r.clinicId, 10)) || 0,
    }));

    // 11. Recent activity — last 8 receipts (clinic-scoped, active only).
    const recentActivity = await sequelize.query(
      `SELECT id, receipt_number AS "receiptNumber", patient_name AS "patientName",
              payment_amount AS "paymentAmount", payment_method AS "paymentMethod",
              payment_date AS "paymentDate", cashier_name AS "cashierName"
       FROM receipts
       WHERE clinic_id = :clinicId AND status = 'active'
       ORDER BY payment_date DESC
       LIMIT 8`,
      { replacements: { clinicId }, type: QueryTypes.SELECT }
    );

    res.json({
      period: { dateFrom, dateTo },
      clinicId,
      kpis: {
        totalRevenue: parseFloat(revenueRow.total) || 0,
        revenueReceiptCount: parseInt(revenueRow.cnt, 10) || 0,
        patientsRegistered: fromPatients + fromLis,
        patientsFromRegistry: fromPatients,
        patientsFromLis: fromLis,
        totalVisits: parseInt(visitsRow.total, 10) || 0,
        outstandingReceivables: parseFloat(outstandingRow.total) || 0,
        outstandingCount: parseInt(outstandingRow.cnt, 10) || 0,
        collectionRate,
        totalBilled,
        totalPaid,
        totalPending,
        activeCashiers: parseInt(cashiersRow.total, 10) || 0,
      },
      revenueTrend,
      patientTrend,
      paymentMethodBreakdown,
      revenueByClinic,
      recentActivity,
    });
  } catch (err) {
    console.error('Dashboard overview report error:', err);
    res.status(500).json({ error: 'Failed to generate dashboard overview report' });
  }
});

module.exports = router;
