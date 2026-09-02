// ─── Accounts Receivable Aging Report (v2) ────────────────────────────────
//
// Current-state snapshot (not period-bound) of every outstanding patient
// bill, bucketed by how many days have elapsed since bill_date. Built as a
// self-contained MySQL-native router, matching the convention established
// by reportPatients.js / reportInventory.js this session — no Postgres-only
// date syntax, no dependency on reports.js or index.js.
//
// Mount e.g.:
//   app.use('/api/reports-v2/ar-aging', require('./routes/reportARAging'));
//
// Auth: relies on the global `app.use('/api', authenticateToken)` +
// `branchAccessControl` middleware already applied ahead of route mounting
// in index.js — req.user is expected to be populated by the time requests
// reach this router.
//
// GET / — Query params:
//   clinic_id          (optional, defaults to the authenticated user's clinic, else 1)
//   dateFrom, dateTo    (optional, YYYY-MM-DD) — restricts to bills whose bill_date falls
//                        in this range. The aging math itself always buckets against
//                        CURRENT_DATE (this stays a "balances owed as of today" report), the
//                        date range only narrows which bills are considered, e.g. "AR aging
//                        for bills raised last quarter" vs. the whole open book.
//
// Bucketing rule: ((CURRENT_DATE)::date - (bill_date)::date) computed in plain MySQL
// (no Postgres AGE()/::date/INTERVAL-quoting), against every patient_bills
// row where status IN ('pending','partial') AND balance_amount > 0:
//   current   : 0–30 days
//   d31_60    : 31–60 days
//   d61_90    : 61–90 days
//   d90_plus  : 90+ days

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

const BUCKETS = ['current', 'd31_60', 'd61_90', 'd90_plus'];

const BUCKET_META = {
  current: { label: 'Current (0-30 days)', min: 0, max: 30 },
  d31_60: { label: '31-60 Days', min: 31, max: 60 },
  d61_90: { label: '61-90 Days', min: 61, max: 90 },
  d90_plus: { label: '90+ Days', min: 91, max: null },
};

function bucketFor(daysOverdue) {
  const d = Number(daysOverdue) || 0;
  if (d <= 30) return 'current';
  if (d <= 60) return 'd31_60';
  if (d <= 90) return 'd61_90';
  return 'd90_plus';
}

function asDateStr(v) {
  if (!v || typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

router.get('/', async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id, 10) || req.user?.clinicId || 1;
    const dateFrom = asDateStr(req.query.dateFrom);
    const dateTo = asDateStr(req.query.dateTo);

    let dateClause = '';
    const repl = { clinicId };
    if (dateFrom) { dateClause += ' AND bill_date >= :fromTs'; repl.fromTs = `${dateFrom} 00:00:00`; }
    if (dateTo) { dateClause += ' AND bill_date <= :toTs'; repl.toTs = `${dateTo} 23:59:59`; }

    // Every outstanding bill for the clinic, oldest/most-overdue first.
    // ((CURRENT_DATE)::date - (bill_date)::date) — plain MySQL date math only.
    const bills = await sequelize.query(
      `SELECT
         id,
         bill_number,
         patient_id,
         patient_name,
         bill_date,
         due_date,
         status,
         total_amount,
         paid_amount,
         balance_amount,
         ((CURRENT_DATE)::date - (bill_date)::date) AS days_overdue
       FROM patient_bills
       WHERE clinic_id = :clinicId
         AND status IN ('pending', 'partial')
         AND balance_amount > 0
         ${dateClause}
       ORDER BY days_overdue DESC, bill_date ASC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // Bucket in JS (four buckets, small dataset — keeps the SQL simple and
    // guarantees the bucket boundaries used here and in the frontend badges
    // stay in lockstep with BUCKET_META below).
    const bucketTotals = Object.fromEntries(BUCKETS.map(b => [b, { count: 0, amount: 0 }]));
    let totalOutstanding = 0;
    let totalCount = 0;

    const items = bills.map(row => {
      const balance = Number(row.balance_amount) || 0;
      const daysOverdue = Number(row.days_overdue) || 0;
      const bucket = bucketFor(daysOverdue);

      bucketTotals[bucket].count += 1;
      bucketTotals[bucket].amount += balance;
      totalOutstanding += balance;
      totalCount += 1;

      return {
        id: row.id,
        billNumber: row.bill_number,
        patientId: row.patient_id,
        patientName: row.patient_name,
        billDate: row.bill_date,
        dueDate: row.due_date,
        status: row.status,
        totalAmount: Number(row.total_amount) || 0,
        paidAmount: Number(row.paid_amount) || 0,
        balanceAmount: balance,
        daysOverdue,
        bucket,
      };
    });

    const agingSummary = BUCKETS.map(b => ({
      bucket: b,
      label: BUCKET_META[b].label,
      count: bucketTotals[b].count,
      amount: bucketTotals[b].amount,
      pctOfTotal: totalOutstanding > 0 ? (bucketTotals[b].amount / totalOutstanding) * 100 : 0,
    }));

    res.json({
      clinicId,
      asOf: new Date().toISOString(),
      summary: {
        totalOutstanding,
        totalCount,
        buckets: Object.fromEntries(
          BUCKETS.map(b => [b, { count: bucketTotals[b].count, amount: bucketTotals[b].amount }])
        ),
      },
      agingSummary,
      items,
    });
  } catch (err) {
    console.error('[reportARAging] Failed to build AR aging report:', err);
    res.status(500).json({ error: 'Failed to generate accounts receivable aging report' });
  }
});

module.exports = router;
