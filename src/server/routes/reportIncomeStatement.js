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
const { authorize } = require('../middleware/authorize');
// Every reports-v2 route carries financial/clinical data and was previously
// gated only on the frontend's requiredPrivilege="pages.reports.view" check
// (src/App.tsx) -- any authenticated user of any role could call these
// endpoints directly (devtools/Postman/a future UI surface) and get the
// data with no server-side check at all. Mirrors reportDhis2.js, the one
// report file that already did this correctly.
router.use(authorize('pages.reports.view'));

const { sequelize } = require('../models');

// Auth is applied globally in index.js via `app.use('/api', authenticateToken)`,
// so req.user is already populated by the time requests reach this router.

// Non-admin users only see rows from their own branch; admins see everything
// clinic-wide. Written inline with named replacements (not branchFilter.js's
// getBranchConditionSQL, which uses positional `?` placeholders that can't
// mix with the named :params this file uses in the same query) — same
// convention as branchScope() in routes/hr.js.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

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
async function fetchSection(clinicId, accountType, dateFrom, dateTo, req) {
  // Revenue: credit - debit increases the balance. Expense: debit - credit increases the balance.
  const amountExpr =
    accountType === 'revenue'
      ? 'COALESCE(SUM(al.credit_amount), 0) - COALESCE(SUM(al.debit_amount), 0)'
      : 'COALESCE(SUM(al.debit_amount), 0) - COALESCE(SUM(al.credit_amount), 0)';

  const replacements = { clinicId, accountType, dateFrom, dateTo };
  const branchSql = branchScope(req, replacements, 'al');

  const [rows] = await sequelize.query(
    `SELECT
       coa.id AS account_id,
       coa.account_code,
       coa.account_name,
       coa.sub_account_type,
       ${amountExpr} AS amount
     FROM chart_of_accounts coa
     LEFT JOIN account_ledger al
       ON al.account_id = coa.id
      AND al.clinic_id = coa.clinic_id
      AND al.is_posted = true
      AND al.transaction_date BETWEEN :dateFrom AND :dateTo
      ${branchSql}
     WHERE coa.clinic_id = :clinicId
       AND coa.is_active = true
       AND coa.account_type = :accountType
     GROUP BY coa.id, coa.account_code, coa.account_name, coa.sub_account_type
     -- The aggregate is repeated rather than referenced by its output alias:
     -- MySQL let HAVING use a SELECT alias, PostgreSQL allows that only in
     -- GROUP BY and ORDER BY, so the alias form failed with
     -- 'column amount does not exist'.
     HAVING ABS(${amountExpr}) > 0.001
     ORDER BY coa.account_code ASC`,
    {
      replacements,
    }
  );

  return rows.map((r) => ({
    account_id: r.account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    // Lets the frontend group expense rows into real sections — Cost of
    // Sales (e.g. Pharmaceutical COGS 5210) vs Operating Expenses vs
    // Financial Expenses — instead of one flat list where a huge
    // Miscellaneous line has nothing next to it explaining what it isn't.
    subAccountType: r.sub_account_type || null,
    amount: parseFloat(r.amount) || 0,
  }));
}

/**
 * Revenue actually collected in the period, split across the revenue accounts
 * each paying bill was posted to.
 *
 * A part-payment is allocated to a bill's revenue lines in order, filling each
 * one before moving to the next, rather than by multiplying the payment by each
 * line's share of the bill. The ratio approach looked more "fair" but produced
 * fractional cents on every partial payment: paying 81,000 of a 189,500 bill
 * split across three whole-number lines turned each of them fractional, and the
 * report read as SSP 248,548.81 of consultations that cost 20,000 or 50,000
 * each. Waterfall allocation only ever subtracts whole amounts, so the result is
 * exact whenever the underlying prices are, and a bill paid in full in one
 * receipt allocates to precisely what the bill says — the common case, and the
 * one this was breaking.
 *
 * Bills whose ledger entry is missing contribute nothing rather than being
 * lumped into a catch-all account — the ledger sweeper repairs those within
 * minutes, and inventing a classification here would quietly disagree with it.
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Spread `target` across `lines` (each `{ key, capacity }`), filling one
 * capacity before touching the next, in the order given. Lines whose capacity
 * runs the opposite sign to `target` are skipped — a positive payment has
 * nothing to do with a line that nets negative (a voided item's reversal).
 * Anything left over once every matching line is exhausted — an overpayment, or
 * a bill classified into lines that do not cover the full amount — lands on the
 * single largest-magnitude line, the one where it is least likely to mislead.
 */
function waterfallAllocate(target, lines) {
  let remaining = round2(target);
  const out = lines.map((l) => ({ key: l.key, capacity: l.capacity, amount: 0 }));

  for (const line of out) {
    if (remaining === 0) break;
    if (line.capacity === 0) continue;
    if (Math.sign(line.capacity) !== Math.sign(remaining)) continue;
    const take = Math.sign(remaining) * Math.min(Math.abs(remaining), Math.abs(line.capacity));
    line.amount = round2(take);
    remaining = round2(remaining - take);
  }

  if (remaining !== 0 && out.length > 0) {
    const largest = out.reduce((a, b) => (Math.abs(b.capacity) > Math.abs(a.capacity) ? b : a));
    largest.amount = round2(largest.amount + remaining);
  }

  return out;
}

async function fetchCashRevenue(clinicId, dateFrom, dateTo, req) {
  // Each bill's revenue lines, in a fixed order (account_code), for bills that
  // took money in the period — the waterfall below fills them in this order.
  const billRevenueReplacements = { clinicId, dateFrom, dateTo };
  const branchSqlAl = branchScope(req, billRevenueReplacements, 'al');
  // branchScope() stamped `branchId` into the replacements object above already;
  // reuse it (rather than calling branchScope again, which would just recompute
  // the same value) for the two receipts subqueries below.
  const branchSqlReceipts = billRevenueReplacements.branchId ? ' AND r.branch_id = :branchId' : '';
  const [billRevenueRows] = await sequelize.query(
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
          ${branchSqlAl}
        GROUP BY 1, 2
       HAVING SUM(al.credit_amount - al.debit_amount) <> 0
     )
     SELECT br.bill_id, coa.id AS account_id, coa.account_code, coa.account_name, coa.sub_account_type, br.amount
       FROM bill_revenue br
       JOIN chart_of_accounts coa ON coa.id = br.account_id
      WHERE coa.is_active = true
        AND br.bill_id IN (
              SELECT DISTINCT bill_id::text FROM (
                SELECT r.bill_id FROM receipts r
                 WHERE r.clinic_id = :clinicId AND r.status = 'active'
                   AND r.bill_id IS NOT NULL AND r.payment_date::date BETWEEN :dateFrom AND :dateTo
                   ${branchSqlReceipts}
                UNION
                SELECT r.bill_id FROM receipts r
                 WHERE r.clinic_id = :clinicId AND COALESCE(r.refund_amount, 0) > 0
                   AND r.bill_id IS NOT NULL AND r.refund_date::date BETWEEN :dateFrom AND :dateTo
                   ${branchSqlReceipts}
              ) x
            )
      ORDER BY br.bill_id, coa.account_code ASC`,
    { replacements: billRevenueReplacements }
  );

  // What was actually taken in on each of those bills during the period —
  // payments in, refunds out — this is the amount the lines above must sum to.
  const collectedReplacements = { clinicId, dateFrom, dateTo };
  const branchSqlCollected = branchScope(req, collectedReplacements, 'r');
  const [collectedRows] = await sequelize.query(
    `WITH movements AS (
       SELECT r.bill_id::text AS bill_id,
              SUM(COALESCE(NULLIF(r.base_currency_amount, 0), r.payment_amount)) AS amount
         FROM receipts r
        WHERE r.clinic_id = :clinicId
          AND r.status = 'active'
          AND r.bill_id IS NOT NULL
          AND r.payment_date::date BETWEEN :dateFrom AND :dateTo
          ${branchSqlCollected}
        GROUP BY 1
       UNION ALL
       SELECT r.bill_id::text AS bill_id,
              -SUM(COALESCE(r.refund_amount, 0)) AS amount
         FROM receipts r
        WHERE r.clinic_id = :clinicId
          AND COALESCE(r.refund_amount, 0) > 0
          AND r.bill_id IS NOT NULL
          AND r.refund_date::date BETWEEN :dateFrom AND :dateTo
          ${branchSqlCollected}
        GROUP BY 1
     )
     SELECT bill_id, SUM(amount) AS amount FROM movements GROUP BY 1`,
    { replacements: collectedReplacements }
  );

  const linesByBill = new Map();
  for (const r of billRevenueRows) {
    const bill = linesByBill.get(r.bill_id) || [];
    bill.push({ key: r.account_id, capacity: Number(r.amount) || 0, account_code: r.account_code, account_name: r.account_name, sub_account_type: r.sub_account_type });
    linesByBill.set(r.bill_id, bill);
  }

  const totalsByAccount = new Map();
  for (const c of collectedRows) {
    const lines = linesByBill.get(c.bill_id);
    if (!lines || lines.length === 0) continue;
    const allocated = waterfallAllocate(Number(c.amount) || 0, lines);
    for (const a of allocated) {
      if (a.amount === 0) continue;
      const line = lines.find((l) => l.key === a.key);
      const running = totalsByAccount.get(a.key) || { account_id: a.key, account_code: line.account_code, account_name: line.account_name, sub_account_type: line.sub_account_type, amount: 0 };
      running.amount = round2(running.amount + a.amount);
      totalsByAccount.set(a.key, running);
    }
  }

  const rows = [...totalsByAccount.values()]
    .filter((r) => Math.abs(r.amount) > 0.001)
    .sort((a, b) => String(a.account_code).localeCompare(String(b.account_code)));

  const lines = rows.map((r) => ({
    account_id: r.account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    subAccountType: r.sub_account_type || null,
    exact: parseFloat(r.amount) || 0,
    amount: Math.round((parseFloat(r.amount) || 0) * 100) / 100,
  }));

  // A safety net, not the primary mechanism now that allocation is a waterfall
  // of whole amounts rather than a ratio.
  //
  // Genuinely fractional prices (a scheme rate, a currency conversion) can still
  // leave floating-point noise after many additions — round2() at each step
  // keeps that from accumulating, but this catches anything that slips through
  // by putting it on the largest line, where a cent is least significant and
  // which is certain to be big enough to absorb it. On whole-number prices this
  // fires never; it existed as the whole fix before the waterfall replaced the
  // ratio split, which is why a day's takings of 2,009,500.00 once came out as
  // 2,009,499.99.
  const exactTotal = Math.round(lines.reduce((sum, l) => sum + l.exact, 0) * 100) / 100;
  const roundedTotal = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  const remainder = Math.round((exactTotal - roundedTotal) * 100) / 100;

  if (remainder !== 0 && lines.length > 0) {
    const largest = lines.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
    largest.amount = Math.round((largest.amount + remainder) * 100) / 100;
  }

  return lines.map(({ exact, ...line }) => line);
}

// Splits the flat expense-account list into the three sections a reader
// actually wants to see apart: Cost of Goods Sold (sub_account_type =
// 'cost_of_sales' — e.g. Pharmaceutical Cost of Sales 5210), Miscellaneous
// (account 5900 specifically — called out on its own, not folded into
// "other", precisely because a client complaint was a surprisingly large
// Miscellaneous balance going unnoticed inside one flat list), and
// everything else as Operating Expenses. Revenue has no such split today —
// there is currently no "services cost of sales" account in the chart of
// accounts at all (a real gap, not something this endpoint can paper over).
function splitExpenseSections(expenses) {
  const cogs = [];
  const miscellaneous = [];
  const operating = [];
  for (const line of expenses) {
    if (line.account_code === '5900') miscellaneous.push(line);
    else if (line.subAccountType === 'cost_of_sales') cogs.push(line);
    else operating.push(line);
  }
  const sum = (lines) => lines.reduce((s, l) => s + l.amount, 0);
  return {
    costOfGoodsSold: { lines: cogs, total: sum(cogs) },
    operatingExpenses: { lines: operating, total: sum(operating) },
    miscellaneous: { lines: miscellaneous, total: sum(miscellaneous) },
  };
}

function dateRangeDays(dateFrom, dateTo, maxDays) {
  const days = [];
  const d = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  while (d <= end && days.length < maxDays) {
    days.push(d.toISOString().split('T')[0]);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

// One row per calendar day in the range — a trend line, not a full
// per-account breakdown per day (that would be a very wide, very expensive
// table for little extra benefit; drill into a single day via the normal
// dateFrom=dateTo=that day for its own account-level detail). Reuses
// fetchSection/fetchCashRevenue exactly as the whole-range totals do, one
// day at a time, rather than rewriting the cash-basis waterfall allocation
// to be date-bucket-aware — that logic is intricate enough (see its own
// comments) that re-deriving a day-grouped version risks a subtly different
// answer from the range total for the same data. Capped at 92 days (~3
// months) since this is N sequential queries per day, not a huge concern
// for an admin report but not something to let run unbounded either.
const MAX_DAILY_RANGE = 92;
async function fetchDailyBreakdown(clinicId, dateFrom, dateTo, basis, req) {
  const days = dateRangeDays(dateFrom, dateTo, MAX_DAILY_RANGE);
  const out = [];
  for (const day of days) {
    const [revenue, expenses] = await Promise.all([
      basis === 'cash' ? fetchCashRevenue(clinicId, day, day, req) : fetchSection(clinicId, 'revenue', day, day, req),
      fetchSection(clinicId, 'expense', day, day, req),
    ]);
    const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
    const sections = splitExpenseSections(expenses);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    out.push({
      date: day,
      totalRevenue,
      totalCostOfGoodsSold: sections.costOfGoodsSold.total,
      totalOperatingExpenses: sections.operatingExpenses.total,
      totalMiscellaneous: sections.miscellaneous.total,
      totalExpenses,
      netIncome: totalRevenue - totalExpenses,
    });
  }
  return out;
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
    const wantsDaily = String(req.query.daily || '').toLowerCase() === 'true';

    const [revenue, expenses, dailyBreakdown] = await Promise.all([
      basis === 'cash'
        ? fetchCashRevenue(clinicId, dateFrom, dateTo, req)
        : fetchSection(clinicId, 'revenue', dateFrom, dateTo, req),
      fetchSection(clinicId, 'expense', dateFrom, dateTo, req),
      wantsDaily ? fetchDailyBreakdown(clinicId, dateFrom, dateTo, basis, req) : Promise.resolve(null),
    ]);

    const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netIncome = totalRevenue - totalExpenses;
    const expenseSections = splitExpenseSections(expenses);

    res.json({
      period: { dateFrom, dateTo },
      basis,
      revenue,
      expenses,
      expenseSections,
      dailyBreakdown,
      dailyRangeTruncated: wantsDaily && dateRangeDays(dateFrom, dateTo, MAX_DAILY_RANGE + 1).length > MAX_DAILY_RANGE,
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
