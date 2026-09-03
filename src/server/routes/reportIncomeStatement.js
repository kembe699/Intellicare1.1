/**
 * Income Statement (Profit & Loss) — v2 report, PostgreSQL syntax.
 *
 * Source of truth: chart_of_accounts joined against account_ledger.
 * Sign conventions:
 *   - Revenue accounts have normal balance = credit, so period amount = SUM(credit) - SUM(debit).
 *   - Expense accounts have normal balance = debit,  so period amount = SUM(debit) - SUM(credit).
 *   - Net Income = Total Revenue - Total Expenses.
 *
 * Mount this router at: /api/reports-v2/income-statement  (exported variable: `router`)
 * e.g. in index.js:
 *   const reportIncomeStatementRouter = require('./routes/reportIncomeStatement');
 *   app.use('/api/reports-v2/income-statement', reportIncomeStatementRouter);
 *
 * Then the endpoint is GET /api/reports-v2/income-statement?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *
 * This file is intentionally self-contained and does not touch routes/reports.js or index.js.
 */

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');

// Auth is applied globally in index.js via `app.use('/api', authenticateToken)`,
// so req.user is already populated by the time requests reach this router.

function defaultThisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${y}-${pad(m + 1)}-01`;
  const to = now.toISOString().split('T')[0];
  return { from, to };
}

// Fetches the net period amount per active account of a given type ('revenue' | 'expense'),
// for the given clinic and date range. Only accounts with non-zero net activity are returned.
async function fetchSection(clinicId, accountType, dateFrom, dateTo) {
  // Revenue: credit - debit increases the balance. Expense: debit - credit increases the balance.
  const amountExpr =
    accountType === 'revenue'
      ? 'COALESCE(SUM(al.credit_amount), 0) - COALESCE(SUM(al.debit_amount), 0)'
      : 'COALESCE(SUM(al.debit_amount), 0) - COALESCE(SUM(al.credit_amount), 0)';

  const [rows] = await sequelize.query(
    `SELECT
       coa.id AS account_id,
       coa.account_code,
       coa.account_name,
       ${amountExpr} AS amount
     FROM chart_of_accounts coa
     LEFT JOIN account_ledger al
       ON al.account_id = coa.id
      AND al.clinic_id = coa.clinic_id
      AND al.is_posted = true
      AND al.transaction_date BETWEEN :dateFrom AND :dateTo
     WHERE coa.clinic_id = :clinicId
       AND coa.is_active = true
       AND coa.account_type = :accountType
     GROUP BY coa.id, coa.account_code, coa.account_name
     -- The aggregate is repeated rather than referenced by its output alias:
     -- MySQL let HAVING use a SELECT alias, PostgreSQL allows that only in
     -- GROUP BY and ORDER BY, so the alias form failed with
     -- 'column amount does not exist'.
     HAVING ABS(${amountExpr}) > 0.001
     ORDER BY coa.account_code ASC`,
    {
      replacements: { clinicId, accountType, dateFrom, dateTo },
    }
  );

  return rows.map((r) => ({
    account_id: r.account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    amount: parseFloat(r.amount) || 0,
  }));
}

router.get('/', async (req, res) => {
  try {
    const clinicId = req.user?.clinicId || req.query.clinic_id || 1;
    const defaults = defaultThisMonthRange();
    const dateFrom = req.query.dateFrom || defaults.from;
    const dateTo = req.query.dateTo || defaults.to;

    const [revenue, expenses] = await Promise.all([
      fetchSection(clinicId, 'revenue', dateFrom, dateTo),
      fetchSection(clinicId, 'expense', dateFrom, dateTo),
    ]);

    const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netIncome = totalRevenue - totalExpenses;

    res.json({
      period: { dateFrom, dateTo },
      revenue,
      expenses,
      totals: {
        totalRevenue,
        totalExpenses,
        netIncome,
      },
    });
  } catch (err) {
    console.error('Income statement (v2) error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
