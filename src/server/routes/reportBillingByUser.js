// ══════════════════════════════════════════════════════════════════════════
// Billing Report by User — collections per cashier over a date range
//
// Rebuilt from scratch (2026-07) to replace the old Postgres-flavoured SQL
// in routes/reports.js (AGE(), ::date casts, quoted INTERVAL, ON CONFLICT —
// all silently broken on MySQL, the engine at the time). Every query here is PostgreSQL syntax,
// verified against the live `intellicare` DB before shipping.
//
// Mount as:
//   const reportBillingByUserRouter = require('./routes/reportBillingByUser');
//   app.use('/api/reports-v2/billing-by-user', reportBillingByUserRouter);
//
// (Mount AFTER `app.use('/api', authenticateToken)` so req.user is populated —
// this router does not add its own auth middleware.)
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { getBranchConditionSQL } = require('../middleware/branchFilter');

/** Returns today's date as YYYY-MM-DD in server-local time (SQL DATE format). */
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Basic YYYY-MM-DD validator — reject anything else so we don't hand raw junk to the database. */
function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// GET /  -- per-cashier billing totals for a date range (defaults to today)
// Query params:
//   dateFrom, dateTo  (YYYY-MM-DD, both default to today)
//   clinic_id         (optional; scopes to a single clinic if provided)
router.get('/', async (req, res) => {
  try {
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null;

    const clinicSQL = clinicId ? ' AND r.clinic_id = ?' : '';
    const clinicParams = clinicId ? [clinicId] : [];
    const branch = getBranchConditionSQL(req, 'r');

    // ── Per-cashier totals ──────────────────────────────────────────────────
    // Group key: canonical cashier_id when present, otherwise fall back to the
    // stored cashier_name string (covers receipts created before cashier_id
    // was reliably captured). Every non-grouped column is aggregated so this
    // lists every non-aggregated column, which PostgreSQL requires.
    const [cashierRows] = await sequelize.query(
      `SELECT
         CASE WHEN r.cashier_id IS NOT NULL THEN ('id:' || r.cashier_id) ELSE ('name:' || COALESCE(r.cashier_name, 'Unknown')) END AS group_key,
         MAX(r.cashier_id) AS cashier_id,
         COALESCE(MAX(u.display_name), MAX(r.cashier_name), 'Unknown') AS cashier_name,
         COUNT(*) AS transaction_count,
         COALESCE(SUM(r.payment_amount), 0) AS total_collected
       FROM receipts r
       LEFT JOIN users u ON u.id = r.cashier_id
       WHERE r.status = 'active'
         AND DATE(r.payment_date) BETWEEN ? AND ?
         ${clinicSQL} ${branch.sql}
       GROUP BY group_key
       ORDER BY total_collected DESC`,
      { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params] }
    );

    // ── Per-cashier, per-payment-method breakdown ───────────────────────────
    const [methodRows] = await sequelize.query(
      `SELECT
         CASE WHEN r.cashier_id IS NOT NULL THEN ('id:' || r.cashier_id) ELSE ('name:' || COALESCE(r.cashier_name, 'Unknown')) END AS group_key,
         r.payment_method AS payment_method,
         COUNT(*) AS method_count,
         COALESCE(SUM(r.payment_amount), 0) AS method_total
       FROM receipts r
       WHERE r.status = 'active'
         AND DATE(r.payment_date) BETWEEN ? AND ?
         ${clinicSQL} ${branch.sql}
       GROUP BY group_key, r.payment_method`,
      { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params] }
    );

    const methodsByGroup = {};
    for (const m of methodRows) {
      if (!methodsByGroup[m.group_key]) methodsByGroup[m.group_key] = {};
      methodsByGroup[m.group_key][m.payment_method] = {
        count: parseInt(m.method_count, 10) || 0,
        amount: parseFloat(m.method_total) || 0,
      };
    }

    const cashiers = cashierRows.map((row) => ({
      cashierId: row.cashier_id ?? null,
      cashierName: row.cashier_name,
      transactionCount: parseInt(row.transaction_count, 10) || 0,
      totalCollected: parseFloat(row.total_collected) || 0,
      methods: methodsByGroup[row.group_key] || {},
    }));

    const totalCollected = cashiers.reduce((sum, c) => sum + c.totalCollected, 0);
    const totalTransactions = cashiers.reduce((sum, c) => sum + c.transactionCount, 0);
    const topCashier = cashiers.length > 0 ? cashiers[0] : null;

    res.json({
      dateFrom,
      dateTo,
      clinicId,
      cashiers,
      summary: {
        totalCollected,
        totalTransactions,
        cashierCount: cashiers.length,
        topCashierName: topCashier ? topCashier.cashierName : null,
        topCashierAmount: topCashier ? topCashier.totalCollected : 0,
      },
    });
  } catch (err) {
    console.error('Billing report by user error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
