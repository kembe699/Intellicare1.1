// ══════════════════════════════════════════════════════════════════════════
// Revenue Report — collections grouped by scheme or by branch.
//
// Complements the two breakdowns that already existed before this file:
// by cashier/user (reportBillingByUser.js) and by clinic/department
// (reportClinicPerformance.js, which also fuzzy-matches a department
// breakdown off the services catalog — see its own header comment for why
// that's inferred rather than a real FK). Those two are intentionally left
// as-is rather than duplicated here; the frontend Revenue Report page calls
// all three endpoints and presents them as one dimension-switchable view.
//
// `receipts.status = 'active'` (not is_voided) is the same filter
// reportBillingByUser.js uses — matches its own 2026-07 header comment
// about being the rebuilt, verified-against-Postgres version of this report
// family, so this file follows the same convention rather than the older
// is_voided style used elsewhere.
//
// Mount as:
//   const reportRevenueRouter = require('./routes/reportRevenue');
//   app.use('/api/reports-v2/revenue', reportRevenueRouter);
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { getBranchConditionSQL } = require('../middleware/branchFilter');

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// GET /?groupBy=scheme|branch&dateFrom=&dateTo=&clinic_id=
router.get('/', async (req, res) => {
  try {
    const groupBy = ['scheme', 'branch'].includes(req.query.groupBy) ? req.query.groupBy : 'scheme';
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null;

    const clinicSQL = clinicId ? ' AND r.clinic_id = ?' : '';
    const clinicParams = clinicId ? [clinicId] : [];
    const branch = getBranchConditionSQL(req, 'r');

    let rows;
    if (groupBy === 'branch') {
      // Branch is already a real column on receipts — this is the
      // straightforward breakdown, no join needed.
      [rows] = await sequelize.query(
        `SELECT
           COALESCE(r.branch_id::text, 'none') AS group_key,
           r.branch_id,
           COALESCE(b.name, CASE WHEN r.branch_id IS NULL THEN 'No Branch Assigned' ELSE 'Branch ' || r.branch_id END) AS group_label,
           COUNT(*) AS transaction_count,
           COALESCE(SUM(r.payment_amount), 0) AS total_collected
         FROM receipts r
         LEFT JOIN branches b ON b.id = r.branch_id
         WHERE r.status = 'active'
           AND DATE(r.payment_date) BETWEEN ? AND ?
           ${clinicSQL} ${branch.sql}
         GROUP BY r.branch_id, b.name
         ORDER BY total_collected DESC`,
        { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params] }
      );
    } else {
      // Scheme lives on the BILL, not the receipt — a receipt only carries
      // bill_id, so this joins through patient_bills to find which scheme (if
      // any) the paid bill belonged to. A bill with no scheme_id (a cash
      // patient) groups under "Cash / No Scheme" rather than being dropped,
      // so the breakdown still accounts for every collected amount.
      [rows] = await sequelize.query(
        `SELECT
           COALESCE(pb.scheme_id, 'none') AS group_key,
           pb.scheme_id,
           COALESCE(ps.scheme_name, 'Cash / No Scheme') AS group_label,
           COUNT(*) AS transaction_count,
           COALESCE(SUM(r.payment_amount), 0) AS total_collected
         FROM receipts r
         LEFT JOIN patient_bills pb ON pb.id = r.bill_id
         LEFT JOIN patient_schemes ps ON ps.id = pb.scheme_id
         WHERE r.status = 'active'
           AND DATE(r.payment_date) BETWEEN ? AND ?
           ${clinicSQL} ${branch.sql}
         GROUP BY pb.scheme_id, ps.scheme_name
         ORDER BY total_collected DESC`,
        { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params] }
      );
    }

    const totalCollected = rows.reduce((sum, r) => sum + (parseFloat(r.total_collected) || 0), 0);

    res.json({
      groupBy,
      period: { dateFrom, dateTo },
      rows: rows.map((r) => ({
        key: r.group_key,
        id: groupBy === 'branch' ? r.branch_id : r.scheme_id,
        label: r.group_label,
        transactionCount: parseInt(r.transaction_count, 10) || 0,
        totalCollected: parseFloat(r.total_collected) || 0,
      })),
      totals: { totalCollected },
    });
  } catch (err) {
    console.error('Revenue report error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
