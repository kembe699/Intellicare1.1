// ─── Accounting Reports (v2) — the NEW report types ───────────────────────
//
// Trial Balance, Income Statement, and Balance Sheet are NOT duplicated
// here — the frontend (ProcurementReport.tsx-style dropdown) calls the
// existing, already-correct endpoints directly:
//   GET /api/accounting/reports/trial-balance   (AccountingService.getTrialBalance)
//   GET /api/accounting/reports/balance-sheet
//   GET /api/reports-v2/income-statement        (reportIncomeStatement.js)
// This file only backs the report types that had no existing
// implementation: Cash Flow, Statement of Changes in Equity, General
// Ledger, Account/Sub-Account History, Journal Vouchers, and Expenses.
//
// `account_ledger` is the single shared sink BOTH GL posting pipelines
// write to (AccountingService.createGLEntry/postGLEntry, and
// JournalPostingService.postJournalEntry) — every query below reads from
// it directly rather than either pipeline-specific table, so nothing is
// missed regardless of which path posted it.
//
// chart_of_accounts has no branch_id and no real parent/sub-account
// hierarchy — "Ledger Sub Account History" uses sub_account_type (the only
// real "sub" grouping dimension that exists) rather than a fabricated
// account hierarchy. "By Department" (Income Statement) has no real
// department/cost-center data anywhere in the GL pipeline (department_id/
// cost_center_id columns exist on some models but are never populated) —
// mapped to branch_id instead, the only populated grouping dimension,
// flagged to the user in the frontend's report description.
//
// Mount e.g.: app.use('/api/reports-v2/accounting', require('./routes/reportAccounting'));

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

function branchScope(req, replacements, alias = '', skip = false) {
  if (skip) return '';
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}
function clinicIdFor(req) {
  return parseInt(req.query.clinic_id, 10) || req.user?.clinicId || 1;
}

// ── GET /income-statement-by-branch ──────────────────────────────────────
// "Department" mapped to branch_id — see header note.
router.get('/income-statement-by-branch', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom, dateTo };

    // Branches on each row's own balance_type (not a flat "revenue=credit,
    // expense=debit" assumption) so a contra-revenue or contra-expense
    // account — an ordinary chart-of-accounts shape, same class as this
    // tenant's existing contra-asset (1590) and contra-equity (3300)
    // accounts — nets the right direction instead of silently inverting.
    const rows = await sequelize.query(
      `SELECT COALESCE(b.name, 'Unassigned') AS "branchName",
              SUM(CASE WHEN coa.account_type = 'revenue' THEN
                    CASE WHEN coa.balance_type = 'credit' THEN al.credit_amount - al.debit_amount ELSE al.debit_amount - al.credit_amount END
                  ELSE 0 END) AS "totalRevenue",
              SUM(CASE WHEN coa.account_type = 'expense' THEN
                    CASE WHEN coa.balance_type = 'debit' THEN al.debit_amount - al.credit_amount ELSE al.credit_amount - al.debit_amount END
                  ELSE 0 END) AS "totalExpenses"
       FROM account_ledger al
       JOIN chart_of_accounts coa ON coa.id = al.account_id
       LEFT JOIN branches b ON b.id = al.branch_id
       WHERE al.clinic_id = :clinicId AND al.is_posted = true
         AND al.transaction_date BETWEEN :dateFrom AND :dateTo
         AND coa.account_type IN ('revenue', 'expense') AND coa.is_active = true
       GROUP BY b.name ORDER BY "totalRevenue" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({
      period: { dateFrom, dateTo },
      rows: rows.map(r => {
        const totalRevenue = parseFloat(r.totalRevenue) || 0;
        const totalExpenses = parseFloat(r.totalExpenses) || 0;
        return { ...r, totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses };
      }),
    });
  } catch (err) {
    console.error('Accounting income-statement-by-branch error:', err);
    res.status(500).json({ error: 'Failed to generate income statement by branch' });
  }
});

// ── GET /cash-flow ───────────────────────────────────────────────────────
// Direct method over the real cash/bank accounts (is_bank_account = true) —
// a cash account is a debit-balance asset, so a DEBIT is cash IN and a
// CREDIT is cash OUT. detail=true (Comprehensive) lists every transaction;
// detail=false groups by source_module as the closest real categorization
// dimension this schema has (there is no operating/investing/financing
// tagging anywhere in chart_of_accounts — flagged to the user in the
// frontend's report description, this is NOT a GAAP 3-section cash flow
// statement, it's a real, correct cash movement report).
router.get('/cash-flow', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const detail = boolParam(req.query.detail);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom };
    const branchSqlOpening = branchScope(req, repl, 'al', allBranches);

    // opening_balance and pre-period ledger activity are summed in two
    // separate subqueries rather than one joined aggregate — a bank account
    // can have many account_ledger rows, and joining them to
    // chart_of_accounts before SUM(coa.opening_balance) fans that opening
    // balance out once per matched ledger row (a 5-row account's $1,000
    // opening balance was being counted 5 times, reporting $5,000). Also
    // branches on each account's own balance_type rather than assuming
    // every is_bank_account row is debit-normal — true for every account in
    // this tenant today, but an overdraft/line-of-credit account marked
    // is_bank_account with balance_type='credit' is an ordinary real-world
    // shape this shouldn't silently get wrong.
    const [openingRow] = await sequelize.query(
      `SELECT
         COALESCE((SELECT SUM(opening_balance) FROM chart_of_accounts WHERE clinic_id = :clinicId AND is_bank_account = true AND is_active = true), 0)
         + COALESCE((
             SELECT SUM(CASE WHEN coa.balance_type = 'debit' THEN al.debit_amount - al.credit_amount ELSE al.credit_amount - al.debit_amount END)
             FROM account_ledger al
             JOIN chart_of_accounts coa ON coa.id = al.account_id
             WHERE coa.clinic_id = :clinicId AND coa.is_bank_account = true AND coa.is_active = true
               AND al.is_posted = true AND al.transaction_date < :dateFrom
               ${branchSqlOpening}
           ), 0) AS "openingBalance"`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const repl2 = { clinicId, dateFrom, dateTo };
    const branchSql2 = branchScope(req, repl2, 'al', allBranches);

    if (detail) {
      const rows = await sequelize.query(
        `SELECT al.id, al.transaction_date AS "transactionDate", al.description,
                al.debit_amount AS "cashIn", al.credit_amount AS "cashOut",
                al.source_module AS "sourceModule", al.reference_number AS "referenceNumber",
                coa.account_name AS "accountName", b.name AS "branchName"
         FROM account_ledger al
         JOIN chart_of_accounts coa ON coa.id = al.account_id
         LEFT JOIN branches b ON b.id = al.branch_id
         WHERE al.clinic_id = :clinicId AND al.is_posted = true
           AND coa.is_bank_account = true
           AND al.transaction_date BETWEEN :dateFrom AND :dateTo ${branchSql2}
         ORDER BY al.transaction_date DESC, al.created_at DESC`,
        { replacements: repl2, type: QueryTypes.SELECT }
      );
      const mapped = rows.map(r => ({ ...r, cashIn: parseFloat(r.cashIn) || 0, cashOut: parseFloat(r.cashOut) || 0 }));
      const netChange = mapped.reduce((s, r) => s + r.cashIn - r.cashOut, 0);
      const openingBalance = parseFloat(openingRow.openingBalance) || 0;
      res.json({ period: { dateFrom, dateTo }, openingBalance, closingBalance: openingBalance + netChange, rows: mapped });
    } else {
      const rows = await sequelize.query(
        `SELECT COALESCE(al.source_module, 'Other') AS "sourceModule",
                SUM(al.debit_amount) AS "cashIn", SUM(al.credit_amount) AS "cashOut", COUNT(*) AS "transactionCount"
         FROM account_ledger al
         JOIN chart_of_accounts coa ON coa.id = al.account_id
         WHERE al.clinic_id = :clinicId AND al.is_posted = true
           AND coa.is_bank_account = true
           AND al.transaction_date BETWEEN :dateFrom AND :dateTo ${branchSql2}
         GROUP BY al.source_module ORDER BY "cashIn" DESC`,
        { replacements: repl2, type: QueryTypes.SELECT }
      );
      const mapped = rows.map(r => ({ ...r, cashIn: parseFloat(r.cashIn) || 0, cashOut: parseFloat(r.cashOut) || 0, transactionCount: parseInt(r.transactionCount, 10) || 0, netChange: (parseFloat(r.cashIn) || 0) - (parseFloat(r.cashOut) || 0) }));
      const netChange = mapped.reduce((s, r) => s + r.netChange, 0);
      const openingBalance = parseFloat(openingRow.openingBalance) || 0;
      res.json({ period: { dateFrom, dateTo }, openingBalance, closingBalance: openingBalance + netChange, rows: mapped });
    }
  } catch (err) {
    console.error('Accounting cash-flow error:', err);
    res.status(500).json({ error: 'Failed to generate cash flow statement' });
  }
});

// ── GET /general-ledger ──────────────────────────────────────────────────
router.get('/general-ledger', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, 'al', allBranches);

    const rows = await sequelize.query(
      `SELECT al.id, al.transaction_date AS "transactionDate", al.description,
              al.debit_amount AS "debitAmount", al.credit_amount AS "creditAmount",
              al.reference_number AS "referenceNumber", al.source_module AS "sourceModule",
              coa.account_code AS "accountCode", coa.account_name AS "accountName",
              b.name AS "branchName"
       FROM account_ledger al
       JOIN chart_of_accounts coa ON coa.id = al.account_id
       LEFT JOIN branches b ON b.id = al.branch_id
       WHERE al.clinic_id = :clinicId AND al.is_posted = true
         AND al.transaction_date BETWEEN :dateFrom AND :dateTo ${branchSql}
       ORDER BY al.transaction_date DESC, al.created_at DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ period: { dateFrom, dateTo }, rows: rows.map(r => ({ ...r, debitAmount: parseFloat(r.debitAmount) || 0, creditAmount: parseFloat(r.creditAmount) || 0 })) });
  } catch (err) {
    console.error('Accounting general-ledger error:', err);
    res.status(500).json({ error: 'Failed to generate general ledger' });
  }
});

// ── GET /account-history ─────────────────────────────────────────────────
// One specific account's full activity with a running balance — the
// classic "T-account history" drill-down.
router.get('/account-history', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = clinicIdFor(req);
    const accountId = req.query.accountId;
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const [account] = await sequelize.query(
      `SELECT id, account_code AS "accountCode", account_name AS "accountName", balance_type AS "balanceType", opening_balance AS "openingBalance"
       FROM chart_of_accounts WHERE id = :accountId AND clinic_id = :clinicId`,
      { replacements: { accountId, clinicId }, type: QueryTypes.SELECT }
    );
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const [priorRow] = await sequelize.query(
      `SELECT COALESCE(SUM(debit_amount), 0) AS "priorDebit", COALESCE(SUM(credit_amount), 0) AS "priorCredit"
       FROM account_ledger WHERE account_id = :accountId AND is_posted = true AND transaction_date < :dateFrom`,
      { replacements: { accountId, dateFrom }, type: QueryTypes.SELECT }
    );
    const opening = parseFloat(account.openingBalance) || 0;
    const priorNet = (parseFloat(priorRow.priorDebit) || 0) - (parseFloat(priorRow.priorCredit) || 0);
    const signedOpeningBalance = account.balanceType === 'debit' ? opening + priorNet : opening - priorNet;

    const rows = await sequelize.query(
      `SELECT id, transaction_date AS "transactionDate", description, debit_amount AS "debitAmount",
              credit_amount AS "creditAmount", reference_number AS "referenceNumber", source_module AS "sourceModule"
       FROM account_ledger
       WHERE account_id = :accountId AND is_posted = true AND transaction_date BETWEEN :dateFrom AND :dateTo
       ORDER BY transaction_date ASC, created_at ASC`,
      { replacements: { accountId, dateFrom, dateTo }, type: QueryTypes.SELECT }
    );

    let running = signedOpeningBalance;
    const withRunning = rows.map(r => {
      const debit = parseFloat(r.debitAmount) || 0;
      const credit = parseFloat(r.creditAmount) || 0;
      running += account.balanceType === 'debit' ? (debit - credit) : (credit - debit);
      return { ...r, debitAmount: debit, creditAmount: credit, runningBalance: running };
    });

    res.json({ period: { dateFrom, dateTo }, account, openingBalance: signedOpeningBalance, closingBalance: running, rows: withRunning });
  } catch (err) {
    console.error('Accounting account-history error:', err);
    res.status(500).json({ error: 'Failed to generate account history' });
  }
});

// ── GET /sub-account-history ─────────────────────────────────────────────
// Combined drill-down across every account sharing one sub_account_type —
// the closest real "sub-account" grouping this schema has (chart_of_accounts
// has no parent/child account hierarchy at all).
router.get('/sub-account-history', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = clinicIdFor(req);
    const subAccountType = req.query.subAccountType;
    if (!subAccountType) return res.status(400).json({ error: 'subAccountType is required' });

    const rows = await sequelize.query(
      `SELECT al.id, al.transaction_date AS "transactionDate", al.description,
              al.debit_amount AS "debitAmount", al.credit_amount AS "creditAmount",
              al.reference_number AS "referenceNumber",
              coa.account_code AS "accountCode", coa.account_name AS "accountName"
       FROM account_ledger al
       JOIN chart_of_accounts coa ON coa.id = al.account_id
       WHERE al.clinic_id = :clinicId AND al.is_posted = true AND coa.sub_account_type = :subAccountType
         AND al.transaction_date BETWEEN :dateFrom AND :dateTo
       ORDER BY al.transaction_date DESC, al.created_at DESC`,
      { replacements: { clinicId, subAccountType, dateFrom, dateTo }, type: QueryTypes.SELECT }
    );
    res.json({ period: { dateFrom, dateTo }, subAccountType, rows: rows.map(r => ({ ...r, debitAmount: parseFloat(r.debitAmount) || 0, creditAmount: parseFloat(r.creditAmount) || 0 })) });
  } catch (err) {
    console.error('Accounting sub-account-history error:', err);
    res.status(500).json({ error: 'Failed to generate sub-account history' });
  }
});

// ── GET /journal-vouchers ────────────────────────────────────────────────
// No distinct "journal voucher" document exists — a voucher here is every
// account_ledger row sharing one reference_number, grouped into one row per
// voucher with its total debit/credit.
router.get('/journal-vouchers', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, 'al', allBranches);

    const rows = await sequelize.query(
      `SELECT al.reference_number AS "referenceNumber", MIN(al.transaction_date) AS "transactionDate",
              MIN(al.description) AS description, MIN(al.source_module) AS "sourceModule",
              SUM(al.debit_amount) AS "totalDebit", SUM(al.credit_amount) AS "totalCredit",
              COUNT(*) AS "lineCount", b.name AS "branchName"
       FROM account_ledger al
       LEFT JOIN branches b ON b.id = al.branch_id
       WHERE al.clinic_id = :clinicId AND al.is_posted = true
         AND al.transaction_date BETWEEN :dateFrom AND :dateTo
         AND al.reference_number IS NOT NULL ${branchSql}
       GROUP BY al.reference_number, b.name
       ORDER BY "transactionDate" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({
      period: { dateFrom, dateTo },
      rows: rows.map(r => ({ ...r, totalDebit: parseFloat(r.totalDebit) || 0, totalCredit: parseFloat(r.totalCredit) || 0, lineCount: parseInt(r.lineCount, 10) || 0 })),
    });
  } catch (err) {
    console.error('Accounting journal-vouchers error:', err);
    res.status(500).json({ error: 'Failed to generate journal vouchers report' });
  }
});

// ── GET /expenses ────────────────────────────────────────────────────────
// groupBy=none|category|period. Source: daily_expenses — the manually-
// entered operational expense log (an established convention elsewhere in
// this codebase), NOT the full GL expense-account activity (that's a
// different, broader number — see reportIncomeStatement.js's expenses[]
// for the accrual GL view). "Fiscal Period" has no real backing anywhere
// in this schema (no fiscal_periods table, no fiscal-year-start setting) —
// grouped by calendar month as the closest honest default.
router.get('/expenses', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const groupBy = ['category', 'period'].includes(req.query.groupBy) ? req.query.groupBy : 'none';
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, '', allBranches);

    if (groupBy === 'none') {
      const rows = await sequelize.query(
        `SELECT de.id, de.expense_date AS "expenseDate", de.description, de.amount,
                de.account_name AS "accountName", de.category, de.status,
                de.payment_method AS "paymentMethod", de.voucher_number AS "voucherNumber",
                b.name AS "branchName"
         FROM daily_expenses de
         LEFT JOIN branches b ON b.id = de.branch_id
         WHERE de.clinic_id = :clinicId AND de.expense_date BETWEEN :dateFrom AND :dateTo ${branchSql}
         ORDER BY de.expense_date DESC`,
        { replacements: repl, type: QueryTypes.SELECT }
      );
      return res.json({ period: { dateFrom, dateTo }, groupBy, rows: rows.map(r => ({ ...r, amount: parseFloat(r.amount) || 0 })) });
    }

    const groupExpr = groupBy === 'category' ? `COALESCE(de.category, 'Uncategorized')` : `TO_CHAR(de.expense_date, 'YYYY-MM')`;
    const rows = await sequelize.query(
      `SELECT ${groupExpr} AS "groupLabel", COUNT(*) AS "expenseCount", SUM(de.amount) AS "totalAmount"
       FROM daily_expenses de
       WHERE de.clinic_id = :clinicId AND de.expense_date BETWEEN :dateFrom AND :dateTo ${branchSql}
       GROUP BY "groupLabel" ORDER BY "groupLabel" ${groupBy === 'period' ? 'DESC' : ''}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({
      period: { dateFrom, dateTo }, groupBy,
      rows: rows.map(r => ({ ...r, expenseCount: parseInt(r.expenseCount, 10) || 0, totalAmount: parseFloat(r.totalAmount) || 0 })),
    });
  } catch (err) {
    console.error('Accounting expenses error:', err);
    res.status(500).json({ error: 'Failed to generate expenses report' });
  }
});

// ── GET /equity-statement ────────────────────────────────────────────────
// Rollforward per equity account (Opening Balance + period activity =
// Closing Balance), with the period's Net Income allocated live into
// Retained Earnings — the exact same "Current Year Earnings" methodology
// the existing balance-sheet route already uses (this system has no
// period-close step that formally posts net income, so every report that
// needs it computes it live, consistently, rather than each inventing its
// own approach).
router.get('/equity-statement', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom, dateTo };

    // Signed per the account's OWN balance_type (same convention as
    // AccountingService.getTrialBalance / the balance-sheet route) — equity
    // is credit-normal (Capital, Retained Earnings) EXCEPT Drawings, which
    // is a debit-normal contra-equity account. Hardcoding credit-debit for
    // every equity row would silently invert Drawings.
    const accounts = await sequelize.query(
      `SELECT coa.id, coa.account_code AS "accountCode", coa.account_name AS "accountName",
              coa.sub_account_type AS "subAccountType", coa.balance_type AS "balanceType", coa.opening_balance AS "openingBalanceRaw",
              COALESCE(SUM(CASE WHEN al.transaction_date < :dateFrom THEN
                (CASE WHEN coa.balance_type = 'debit' THEN al.debit_amount - al.credit_amount ELSE al.credit_amount - al.debit_amount END)
                ELSE 0 END), 0) AS "priorActivity",
              COALESCE(SUM(CASE WHEN al.transaction_date BETWEEN :dateFrom AND :dateTo THEN
                (CASE WHEN coa.balance_type = 'debit' THEN al.debit_amount - al.credit_amount ELSE al.credit_amount - al.debit_amount END)
                ELSE 0 END), 0) AS "periodActivity"
       FROM chart_of_accounts coa
       LEFT JOIN account_ledger al ON al.account_id = coa.id AND al.is_posted = true
       WHERE coa.clinic_id = :clinicId AND coa.account_type = 'equity' AND coa.is_active = true
       GROUP BY coa.id, coa.account_code, coa.account_name, coa.sub_account_type, coa.balance_type, coa.opening_balance
       ORDER BY coa.account_code`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // Branches on each row's own balance_type, not a flat account_type
    // assumption — same reasoning as /income-statement-by-branch above.
    const [netIncomeRow] = await sequelize.query(
      `SELECT SUM(CASE WHEN coa.account_type = 'revenue' THEN
                    CASE WHEN coa.balance_type = 'credit' THEN al.credit_amount - al.debit_amount ELSE al.debit_amount - al.credit_amount END
                  WHEN coa.account_type = 'expense' THEN
                    CASE WHEN coa.balance_type = 'debit' THEN -(al.debit_amount - al.credit_amount) ELSE -(al.credit_amount - al.debit_amount) END
                  ELSE 0 END) AS "netIncome"
       FROM account_ledger al
       JOIN chart_of_accounts coa ON coa.id = al.account_id
       WHERE coa.clinic_id = :clinicId AND al.is_posted = true AND al.transaction_date BETWEEN :dateFrom AND :dateTo
         AND coa.account_type IN ('revenue', 'expense')`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const netIncome = parseFloat(netIncomeRow.netIncome) || 0;

    const rows = accounts.map(a => {
      const opening = (parseFloat(a.openingBalanceRaw) || 0) + (parseFloat(a.priorActivity) || 0);
      let periodActivity = parseFloat(a.periodActivity) || 0;
      // Current Year Earnings isn't a real posted line on 3200 Retained
      // Earnings — add it here, same convention as the balance-sheet route.
      if (a.subAccountType === 'retained_earnings') periodActivity += netIncome;
      return { accountCode: a.accountCode, accountName: a.accountName, subAccountType: a.subAccountType, openingBalance: opening, periodActivity, closingBalance: opening + periodActivity };
    });

    res.json({ period: { dateFrom, dateTo }, netIncome, rows });
  } catch (err) {
    console.error('Accounting equity-statement error:', err);
    res.status(500).json({ error: 'Failed to generate statement of changes in equity' });
  }
});

module.exports = router;
