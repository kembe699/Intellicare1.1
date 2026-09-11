/**
 * Income Statement (Profit & Loss) — v2 report, PostgreSQL syntax.
 *
 * Reports on a CASH basis by default: revenue counts when the patient pays, not
 * when the bill is raised. A clinic that bills 265,000 and collects 195,000 has
 * earned 195,000 in the sense that matters to whoever is reading this — the
 * accrual figure was read as the day's takings and did not match the cashier,
 * because an unpaid bill is not money in the drawer.
 *
 * The ledger itself stays on an accrual footing (Dr Receivable / Cr Revenue when
 * the bill is raised), because that is what makes receivables and the aging
 * report possible at all. This report converts: for each payment received in the
 * period it recognises that payment across the revenue accounts the bill posted
 * to, in the same proportion. A part-payment of a bill spanning consultation and
 * laboratory therefore lands on both, proportionally, rather than arbitrarily on
 * whichever came first. Refunds in the period count against it.
 *
 * Pass ?basis=accrual for the billed-not-collected view, which is what the
 * receivable balance reconciles against.
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

/**
 * Revenue actually collected in the period, split across the revenue accounts
 * each paying bill was posted to.
 *
 * The proportion comes from the bill's own ledger lines, so a payment is
 * recognised the way that bill's revenue was classified. Bills whose ledger
 * entry is missing contribute nothing rather than being lumped into a catch-all
 * account — the ledger sweeper repairs those within minutes, and inventing a
 * classification here would quietly disagree with it.
 */
async function fetchCashRevenue(clinicId, dateFrom, dateTo) {
  const [rows] = await sequelize.query(
    `WITH bill_revenue AS (
       SELECT gl.reference_id AS bill_id,
              al.account_id,
              SUM(al.credit_amount - al.debit_amount) AS amount
         FROM account_ledger al
         JOIN general_ledger gl ON gl.id = al.transaction_id
         JOIN chart_of_accounts c ON c.id = al.account_id
          AND c.account_type = 'revenue'
        WHERE al.is_posted = true
          AND al.clinic_id = :clinicId
          AND gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')
        GROUP BY 1, 2
       HAVING SUM(al.credit_amount - al.debit_amount) <> 0
     ),
     bill_total AS (
       SELECT bill_id, SUM(amount) AS total FROM bill_revenue GROUP BY 1
     ),
     movements AS (
       -- money taken in during the period
       SELECT r.bill_id::text AS bill_id,
              SUM(COALESCE(NULLIF(r.base_currency_amount, 0), r.payment_amount)) AS amount
         FROM receipts r
        WHERE r.clinic_id = :clinicId
          AND COALESCE(r.is_voided, false) = false
          AND r.bill_id IS NOT NULL
          AND r.payment_date::date BETWEEN :dateFrom AND :dateTo
        GROUP BY 1
       UNION ALL
       -- money handed back during the period reduces what was earned
       SELECT r.bill_id::text AS bill_id,
              -SUM(COALESCE(r.refund_amount, 0)) AS amount
         FROM receipts r
        WHERE r.clinic_id = :clinicId
          AND COALESCE(r.refund_amount, 0) > 0
          AND r.bill_id IS NOT NULL
          AND r.refund_date::date BETWEEN :dateFrom AND :dateTo
        GROUP BY 1
     ),
     collected AS (
       SELECT bill_id, SUM(amount) AS amount FROM movements GROUP BY 1
     )
     SELECT coa.id AS account_id,
            coa.account_code,
            coa.account_name,
            SUM(col.amount * (br.amount / bt.total)) AS amount
       FROM collected col
       JOIN bill_total bt ON bt.bill_id = col.bill_id AND bt.total <> 0
       JOIN bill_revenue br ON br.bill_id = col.bill_id
       JOIN chart_of_accounts coa ON coa.id = br.account_id
      WHERE coa.is_active = true
      GROUP BY 1, 2, 3
     HAVING ABS(SUM(col.amount * (br.amount / bt.total))) > 0.001
      ORDER BY coa.account_code ASC`,
    { replacements: { clinicId, dateFrom, dateTo } }
  );

  const lines = rows.map((r) => ({
    account_id: r.account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    exact: parseFloat(r.amount) || 0,
    amount: Math.round((parseFloat(r.amount) || 0) * 100) / 100,
  }));

  // Put the rounding remainder back.
  //
  // Each account's share is a proportion of a payment, so it rarely lands on a
  // whole cent. Rounding every line and then adding them is not the same as
  // adding and then rounding: a day's takings of 2,009,500.00 came out as
  // 2,009,499.99, and a total a penny away from the cashier's reads as the books
  // being wrong rather than as a rounding artefact.
  //
  // The unrounded total is what was actually collected, so the difference goes
  // onto the largest line — where a cent is least significant, and which is the
  // only line certain to be big enough to absorb it.
  const exactTotal = Math.round(lines.reduce((sum, l) => sum + l.exact, 0) * 100) / 100;
  const roundedTotal = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  const remainder = Math.round((exactTotal - roundedTotal) * 100) / 100;

  if (remainder !== 0 && lines.length > 0) {
    const largest = lines.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
    largest.amount = Math.round((largest.amount + remainder) * 100) / 100;
  }

  return lines.map(({ exact, ...line }) => line);
}

router.get('/', async (req, res) => {
  try {
    const clinicId = req.user?.clinicId || req.query.clinic_id || 1;
    const defaults = defaultThisMonthRange();
    const dateFrom = req.query.dateFrom || defaults.from;
    const dateTo = req.query.dateTo || defaults.to;

    // Cash unless explicitly asked otherwise: what was collected is the figure
    // people compare against the cashier and the dashboard.
    const basis = String(req.query.basis || 'cash').toLowerCase() === 'accrual' ? 'accrual' : 'cash';

    const [revenue, expenses] = await Promise.all([
      basis === 'cash'
        ? fetchCashRevenue(clinicId, dateFrom, dateTo)
        : fetchSection(clinicId, 'revenue', dateFrom, dateTo),
      fetchSection(clinicId, 'expense', dateFrom, dateTo),
    ]);

    const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netIncome = totalRevenue - totalExpenses;

    res.json({
      period: { dateFrom, dateTo },
      basis,
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
