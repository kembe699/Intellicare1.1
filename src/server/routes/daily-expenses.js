const express = require('express');
const { reportSchemaGuardFailure } = require('../utils/legacyDDL');
const router = express.Router();
const { DailyExpense, LedgerAccount, ChartOfAccounts, sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const AccountingService = require('../services/AccountingService');
const { requireApprovalPermission } = require('../middleware/requireApprovalPermission');
const { authorize } = require('../middleware/authorize');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { getBranchCondition, getCreateBranchId } = require('../middleware/branchFilter');

// Named-replacement raw-SQL branch filter, same convention as accounting.js's
// branchScope — this file uses named `:params` throughout, not positional `?`.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

// Mirrors allowedRoles already enforced client-side for /procurement/daily-expenses in
// App.tsx — none of these routes had any role gate server-side, including /:id/pay,
// which releases an actual payment once an expense is approved.

// Maps a daily-expense category to the Chart of Accounts expense-account code
// it should be debited against when the expense is paid (see POST /:id/pay).
const CATEGORY_EXPENSE_CODE = {
  // Staff costs get their own accounts rather than falling into Miscellaneous.
  // Doctor fees and allowances are large, recurring and reported on separately;
  // burying them in 5900 would make the income statement useless for the two
  // lines a clinic is asked about most.
  'Doctor Fees': '5110',       // Doctor Fees
  'Allowance': '5120',         // Employee Benefits
  'Office Supplies': '5400',   // Office Supplies Expense
  'Utilities': '5310',         // Utilities Expense
  'Maintenance': '5330',       // Maintenance and Repairs
  'Transport': '5800',         // Travel and Transport
  'Medical Supplies': '5200',  // Medical Supplies Expense
};
const DEFAULT_EXPENSE_CODE = '5900'; // Miscellaneous Expenses — fallback for Catering/Cleaning/Security/Other/unknown

// MySQL 8 does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (it's Postgres-only
// syntax and throws a 1064 syntax error). This helper checks information_schema first so
// column additions are actually idempotent AND actually happen on MySQL.
async function ensureColumn(table, column, definitionSql) {
  try {
    const [rows] = await sequelize.query(
      `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
      { replacements: { table, column } }
    );
    if (rows.length === 0) {
      await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definitionSql}`);
    }
  } catch (e) { console.warn(`ensureColumn(${table}.${column}) failed:`, e.message); }
}

// MySQL equivalent of Postgres' `ALTER COLUMN ... TYPE ... USING ...::type` — only runs
// the MODIFY when the column's current type doesn't already match.
async function ensureColumnType(table, column, expectedDataType, modifySql) {
  try {
    const [rows] = await sequelize.query(
      `SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
      { replacements: { table, column } }
    );
    if (rows.length && rows[0].DATA_TYPE !== expectedDataType) {
      await sequelize.query(modifySql);
    }
  } catch (e) { reportSchemaGuardFailure('daily_expenses column type', e); }
}

// Ensure supplier_bill_payments table
(async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS supplier_bill_payments (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER,
        po_id VARCHAR(36) NOT NULL,
        po_number VARCHAR(100),
        supplier_id INTEGER,
        supplier_name VARCHAR(255),
        payment_date DATE NOT NULL,
        amount_paid DECIMAL(15,2) NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'cash',
        account_id VARCHAR(36),
        account_name VARCHAR(255),
        reference_number VARCHAR(100),
        notes TEXT,
        payment_voucher_number VARCHAR(100),
        paid_by VARCHAR(255),
        approved_by VARCHAR(255),
        created_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await ensureColumn('purchase_orders', 'paid_amount', `DECIMAL(15,2) DEFAULT 0`);
    await ensureColumn('purchase_orders', 'payment_status', `VARCHAR(20) DEFAULT 'unpaid'`);
    await ensureColumn('supplier_bill_payments', 'paid_by', `VARCHAR(255)`);
    await ensureColumn('supplier_bill_payments', 'approved_by', `VARCHAR(255)`);
    await ensureColumn('supplier_bill_payments', 'created_by', `VARCHAR(36)`);
    await ensureColumn('supplier_bill_payments', 'reference_number', `VARCHAR(100)`);
    await ensureColumn('supplier_bill_payments', 'payment_voucher_number', `VARCHAR(100)`);
    await ensureColumn('supplier_bill_payments', 'account_name', `VARCHAR(255)`);
    await ensureColumn('supplier_bill_payments', 'supplier_name', `VARCHAR(255)`);
    await ensureColumn('supplier_bill_payments', 'po_number', `VARCHAR(100)`);
    await ensureColumn('daily_expenses', 'clinic_id', `INTEGER`);
    // account_id must hold Chart of Accounts UUIDs (varchar(36)), not the legacy INTEGER type
    await ensureColumnType('daily_expenses', 'account_id', 'varchar', `ALTER TABLE daily_expenses MODIFY COLUMN account_id VARCHAR(36) NOT NULL`);
    // created_by holds a display-name string (matches the Sequelize model and the rest of
    // this feature's approval trail, e.g. daily_expense_approvals.approved_by), not a
    // numeric user id — the legacy INTEGER column rejected every insert with
    // ER_TRUNCATED_WRONG_VALUE_FOR_FIELD, silently 500-ing every expense creation.
    await ensureColumnType('daily_expenses', 'created_by', 'varchar', `ALTER TABLE daily_expenses MODIFY COLUMN created_by VARCHAR(255) NULL`);
    await ensureColumn('daily_expenses', 'status', `VARCHAR(30) DEFAULT 'pending_approval'`);
    await ensureColumn('daily_expenses', 'paid_at', `TIMESTAMP NULL`);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS daily_expense_approvals (
        id VARCHAR(36) PRIMARY KEY,
        expense_id INTEGER NOT NULL,
        user_id VARCHAR(36),
        approval_level INTEGER NOT NULL,
        approved_by VARCHAR(255) NOT NULL,
        approved_by_title VARCHAR(100),
        signature TEXT,
        notes TEXT,
        approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(()=>{});
    await sequelize.query(`CREATE INDEX idx_dea_expense ON daily_expense_approvals(expense_id)`).catch(()=>{});
    await ensureColumn('daily_expenses', 'payment_method', `VARCHAR(50) DEFAULT 'cash'`);
    await ensureColumn('daily_expenses', 'voucher_number', `VARCHAR(100)`);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS supplier_bill_approvals (
        id VARCHAR(36) PRIMARY KEY,
        po_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36),
        approval_level INTEGER NOT NULL,
        approved_by VARCHAR(255) NOT NULL,
        approved_by_title VARCHAR(100),
        signature TEXT,
        notes TEXT,
        approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(()=>{});
    await ensureColumn('supplier_bill_approvals', 'user_id', `VARCHAR(36)`);
    await ensureColumn('supplier_bill_approvals', 'signature', `TEXT`);
    await sequelize.query(`CREATE INDEX idx_sba_po ON supplier_bill_approvals(po_id)`).catch(()=>{});
  } catch(e){ console.warn('daily-expenses init:', e.message); }
})();

// Foreign-currency POs (mostly USD in this system) are settled against Cash/Bank accounts
// that operate in the base currency (SSP). The exchange rate on the day the liability was
// booked (GRN acceptance) will almost never match the rate on the day it's actually paid —
// the difference is a realized FX gain or loss and needs a home of its own on the P&L
// rather than being silently absorbed into Accounts Payable or Cash (see POST
// /supplier-bill-payment below). Ensure one such account exists per clinic.
(async () => {
  try {
    const [clinics] = await sequelize.query(`SELECT DISTINCT clinic_id FROM chart_of_accounts`);
    for (const { clinic_id } of clinics) {
      const [existing] = await sequelize.query(
        `SELECT id FROM chart_of_accounts WHERE clinic_id = :cid AND account_code = '5610' LIMIT 1`,
        { replacements: { cid: clinic_id } }
      );
      if (existing.length === 0) {
        // gen_random_uuid(), not MySQL's UUID(), and a real boolean for
        // is_active — the MySQL forms threw here after the PostgreSQL move and
        // the catch below only warned, so this account silently stopped being
        // created for new tenants. It is now also seeded by
        // scripts/initializeChartOfAccounts.js; this remains the repair path
        // for tenants provisioned before that.
        await sequelize.query(`
          INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, balance_type, opening_balance, is_active, description)
          VALUES (gen_random_uuid()::text, :cid, '5610', 'Foreign Exchange Gain/Loss', 'expense', 'debit', 0, TRUE, 'Realized FX gain/loss on settling foreign-currency (e.g. USD) supplier liabilities against the SSP base currency. A gain nets against this account as a credit (reducing it), a loss debits it — one net line rather than separate gain/loss accounts.')
        `, { replacements: { cid: clinic_id } });
        console.log(`✅ Added Foreign Exchange Gain/Loss account (5610) for clinic ${clinic_id}`);
      }
    }
  } catch (e) { console.warn('FX Gain/Loss account migration:', e.message); }
})();

router.get('/', authorize('expenses.read'), async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const where = { clinic_id: BranchQueryFilter.resolveClinicId(req), ...getBranchCondition(req) };

    // Optional date window. The page asks for today by default — the list grows
    // without limit otherwise, and a day's expenses are what anyone actually
    // needs to see.
    //
    // expense_date is a timestamp, not a date, so the closing day has to run to
    // its end: comparing against the bare date gives midnight, and "today to
    // today" would match only an expense recorded exactly at 00:00:00.
    const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
    if (dateFrom && dateTo) {
      where.expense_date = { [Op.between]: [new Date(dateFrom), endOfDay(dateTo)] };
    } else if (dateFrom) {
      where.expense_date = { [Op.gte]: new Date(dateFrom) };
    } else if (dateTo) {
      where.expense_date = { [Op.lte]: endOfDay(dateTo) };
    }

    const expenses = await DailyExpense.findAll({ where, order: [['expense_date', 'DESC'], ['id', 'DESC']] });
    res.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// Get supplier bills (all authorized/received POs — paid, partial, and unpaid)
//
// Used to exclude fully-paid bills entirely, on the reasoning that this is an
// "awaiting payment" worklist. That also meant a currency with no *outstanding*
// bills right now — every bill in it already settled — vanished completely
// from the page, including its own Total Billed/Paid figures: a real supplier
// paid in full in SSP looked like it had never been billed in SSP at all.
// Paid bills are still clearly marked via payment_status in the response.
router.get('/supplier-bills', authorize('expenses.read'), async (req, res) => {
  try {
    const cf = `AND po.clinic_id = ${BranchQueryFilter.resolveClinicId(req)}`;
    const supplierBillsReplacements = {};
    const supplierBillsBranchScope = branchScope(req, supplierBillsReplacements, 'po');
    const [bills] = await sequelize.query(`
      SELECT po.id, po.po_number, po.order_date, po.total_amount, po.po_currency,
        po.payment_terms, po.status,
        COALESCE(po.paid_amount,0) AS paid_amount,
        COALESCE(po.payment_status,'unpaid') AS payment_status,
        (po.total_amount - COALESCE(po.paid_amount,0)) AS balance_due,
        s.name AS supplier_name, s.contact_person, s.phone AS supplier_phone
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.status IN ('authorized','received')
        ${cf}
        ${supplierBillsBranchScope}
      ORDER BY po.order_date DESC
    `, { replacements: supplierBillsReplacements });
    res.json(bills);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch supplier bills' });
  }
});

// Get approvals for a PO
router.get('/supplier-bills/:po_id/approvals', authorize('expenses.read'), async (req, res) => {
  try {
    const approvalsReplacements = { po_id: String(req.params.po_id) };
    const approvalsBranchScope = branchScope(req, approvalsReplacements);
    const [approvals] = await sequelize.query(
      `SELECT * FROM supplier_bill_approvals WHERE po_id = :po_id ${approvalsBranchScope} ORDER BY approval_level ASC`,
      { replacements: approvalsReplacements }
    );
    res.json(approvals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch approvals' });
  }
});

// Submit an approval for a PO (permission-gated via approval_permissions,
// auto-captures user from JWT — password re-entry was removed in favor of
// the granular approval-permission system, see requireApprovalPermission)
router.post('/supplier-bills/:po_id/approve', requireApprovalPermission('supplier_bill_approve'), async (req, res) => {
  try {
    const { approved_by_title, notes } = req.body;
    if (!req.user?.id) return res.status(401).json({ error: 'Not authenticated' });

    // Fetch user from DB to get display_name and signature
    const [[dbUser]] = await sequelize.query(
      'SELECT id, display_name, signature FROM users WHERE id = ? LIMIT 1',
      { replacements: [req.user.id] }
    );
    if (!dbUser) return res.status(401).json({ error: 'User not found' });

    const approved_by = dbUser.display_name;
    const signature = dbUser.signature || null;

    const [existing] = await sequelize.query(
      'SELECT * FROM supplier_bill_approvals WHERE po_id = :po_id ORDER BY approval_level ASC',
      { replacements: { po_id: String(req.params.po_id) } }
    );
    if (existing.length >= 3) return res.status(400).json({ error: 'This bill already has 3 approvals' });

    const nextLevel = existing.length + 1;
    const id = uuidv4();
    await sequelize.query(
      'INSERT INTO supplier_bill_approvals (id, po_id, user_id, approval_level, approved_by, approved_by_title, signature, notes, branch_id) VALUES (:id, :po_id, :user_id, :level, :approved_by, :title, :signature, :notes, :branchId)',
      { replacements: { id, po_id: req.params.po_id, user_id: req.user.id, level: nextLevel, approved_by, title: approved_by_title || null, signature, notes: notes || null, branchId: getCreateBranchId(req) } }
    );
    res.status(201).json({ id, approval_level: nextLevel, approved_by, signature, total_approvals: nextLevel });
  } catch (error) {
    console.error('Error submitting approval:', error);
    res.status(500).json({ error: 'Failed to submit approval' });
  }
});

// Get PO line items for a bill
router.get('/supplier-bills/:po_id/items', authorize('expenses.read'), async (req, res) => {
  try {
    const [items] = await sequelize.query(
      `SELECT line_number, item_name, description, quantity, unit_of_measure, unit_price, total_price, status
       FROM purchase_order_items WHERE purchase_order_id = :po_id ORDER BY line_number, id`,
      { replacements: { po_id: parseInt(req.params.po_id) } }
    );
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch PO items' });
  }
});

// Get payments for a PO
router.get('/supplier-bills/:po_id/payments', authorize('expenses.read'), async (req, res) => {
  try {
    const paymentsReplacements = { po_id: String(req.params.po_id) };
    const paymentsBranchScope = branchScope(req, paymentsReplacements);
    const [payments] = await sequelize.query(
      `SELECT * FROM supplier_bill_payments WHERE po_id = :po_id ${paymentsBranchScope} ORDER BY payment_date DESC`,
      { replacements: paymentsReplacements }
    );
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Record supplier bill payment
router.post('/supplier-bill-payment', authorize('expenses.write'), async (req, res) => {
  try {
    const { po_id, po_number, supplier_id, supplier_name,
      payment_date, amount_paid, payment_method, account_id, account_name,
      reference_number, notes, paid_by, approved_by, created_by } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);
    if (!po_id || !amount_paid || !account_id)
      return res.status(400).json({ error: 'po_id, amount_paid, account_id required' });
    const [pos] = await sequelize.query('SELECT * FROM purchase_orders WHERE id = :id AND clinic_id = :clinic_id', { replacements: { id: parseInt(po_id), clinic_id } });
    if (!pos.length) return res.status(404).json({ error: 'PO not found' });
    const po = pos[0];

    // Enforce 3-approval requirement
    const [approvals] = await sequelize.query(
      'SELECT COUNT(*) as cnt FROM supplier_bill_approvals WHERE po_id = :po_id',
      { replacements: { po_id: String(po_id) } }
    );
    if (parseInt(approvals[0].cnt || 0) < 3) {
      return res.status(403).json({ error: 'Payment requires 3 approvals. Currently approved: ' + approvals[0].cnt });
    }

    const payAmt = parseFloat(amount_paid);
    const newPaid = parseFloat(po.paid_amount || 0) + payAmt;
    const total = parseFloat(po.total_amount || 0);
    const payStatus = newPaid >= total ? 'paid' : 'partial';
    const voucherNo = `PV-${Date.now().toString().slice(-8)}`;
    const paymentId = uuidv4();

    // Step 1: INSERT — try with explicit UUID id first, fall back to auto-id
    let insertedId = null;
    const paymentBranchId = getCreateBranchId(req);
    try {
      await sequelize.query(
        `INSERT INTO supplier_bill_payments (id, po_id, payment_date, amount_paid, payment_method, account_id, clinic_id, branch_id) VALUES (:id, :po_id, :payment_date, :amount_paid, :payment_method, :account_id, :clinic_id, :branch_id)`,
        { replacements: { id: paymentId, po_id: String(po_id), payment_date: payment_date || new Date().toISOString().split('T')[0], amount_paid: payAmt, payment_method: payment_method || 'cash', account_id: String(account_id), clinic_id: parseInt(clinic_id || 1), branch_id: paymentBranchId } }
      );
      insertedId = paymentId;
    } catch(e1) {
      // id column may be SERIAL — try without specifying id
      await sequelize.query(
        `INSERT INTO supplier_bill_payments (po_id, payment_date, amount_paid, payment_method, account_id, clinic_id, branch_id) VALUES (:po_id, :payment_date, :amount_paid, :payment_method, :account_id, :clinic_id, :branch_id)`,
        { replacements: { po_id: String(po_id), payment_date: payment_date || new Date().toISOString().split('T')[0], amount_paid: payAmt, payment_method: payment_method || 'cash', account_id: String(account_id), clinic_id: parseInt(clinic_id || 1), branch_id: paymentBranchId } }
      );
      const [lastRow] = await sequelize.query(
        `SELECT id FROM supplier_bill_payments WHERE po_id = :po_id ORDER BY created_at DESC LIMIT 1`,
        { replacements: { po_id: String(po_id) } }
      );
      insertedId = lastRow[0]?.id || null;
    }

    // Step 3: UPDATE payment record with remaining details (all columns already exist
    // on supplier_bill_payments per the CREATE TABLE above — no ALTER needed here)
    if (insertedId) {
      await sequelize.query(
        `UPDATE supplier_bill_payments SET po_number=:pn, supplier_name=:sn, account_name=:an, reference_number=:ref, notes=:notes, payment_voucher_number=:voucher, paid_by=:paid_by, created_by=:created_by WHERE id=:id`,
        { replacements: { pn: po_number||po.po_number||'', sn: supplier_name||'', an: account_name||'', ref: reference_number||null, notes: notes||null, voucher: voucherNo, paid_by: paid_by||null, created_by: created_by||null, id: insertedId } }
      ).catch(()=>{});
    }
    await sequelize.query('UPDATE purchase_orders SET paid_amount=:paid, payment_status=:status, updated_at=NOW() WHERE id=:id', { replacements: { paid: newPaid, status: payStatus, id: parseInt(po_id) } });

    // Post to the General Ledger: Debit Accounts Payable (settling the liability),
    // Credit the cash/bank account the payment was made from. Non-blocking — a GL
    // failure must never prevent the actual payment from completing (matches
    // BillingIntegrationService.handleBillCreation's pattern elsewhere in this app).
    //
    // payAmt is in the PO's own currency (po.po_currency — mostly USD in this system), but
    // the cash/bank account being credited operates in the SSP base currency, so it must be
    // converted at *today's* rate rather than posted as if it were already SSP. And because
    // the liability was originally booked (GRN acceptance) at whatever rate was current on
    // that earlier date, the SSP amount being paid out now will almost never exactly match
    // the SSP amount originally booked to Accounts Payable for this PO — that difference is
    // a realized FX gain or loss and gets its own line (account 5610) rather than being
    // silently absorbed into AP or Cash.
    try {
      const clinicIdNum = parseInt(clinic_id || po.clinic_id || 1);
      const apAccount = await AccountingService.getAccountByCode(clinicIdNum, '2100');
      const fxAccount = await AccountingService.getAccountByCode(clinicIdNum, '5610');

      const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
      const baseCurrency = baseCurrencyRow?.code || 'SSP';
      const poCurrency = po.po_currency || baseCurrency;
      const payDate = payment_date || new Date().toISOString().split('T')[0];

      let rateNow = 1.0;
      try {
        rateNow = await AccountingService.getExchangeRate(clinicIdNum, poCurrency, baseCurrency, payDate);
      } catch (rateErr) {
        console.warn(`No ${poCurrency}->${baseCurrency} rate for ${payDate}, posting at 1:1 — FX gain/loss will be understated:`, rateErr.message);
      }
      const paymentBaseAmount = AccountingService.convertAmount(payAmt, rateNow);

      // apBaseAmount is the SSP-equivalent booked to AP when this PO's goods were accepted
      // (see POST /goods-receipt-notes/:id/accept in procurement.js) — it's only ever set by
      // GRN acceptance. A PO can be authorized and paid with no GRN ever created (approval
      // sign-off has nothing to do with goods receipt), in which case apBaseAmount is 0 —
      // there is no AP liability on the books for this PO to settle. Debiting AP anyway (the
      // old behavior) posted a debit against a balance nothing had ever credited, silently
      // pushing Accounts Payable negative while the cash outflow vanished from every report —
      // not deferred to COGS like a real accrual entry, just dropped. Since no line-item
      // category is available pre-GRN to pick a specific expense account, this posts straight
      // to Miscellaneous Expenses (5900) instead, so the spend is visible on the Income
      // Statement immediately, same as it would be for a purchase that never goes through
      // formal goods receipt at all.
      const apBaseAmount = parseFloat(po.ap_base_currency_amount) || 0;
      const hasGrnLiability = apBaseAmount > 0;

      if (hasGrnLiability && apAccount) {
        const total = parseFloat(po.total_amount) || 0;
        const bookedShare = total > 0 ? apBaseAmount * (payAmt / total) : paymentBaseAmount;
        const fxDelta = Math.round((bookedShare - paymentBaseAmount) * 100) / 100; // >0 gain, <0 loss

        const lineItems = [
          { account_id: apAccount.id, debit_amount: bookedShare, credit_amount: 0, description: `Settle accounts payable — PO ${po_number || po.po_number}` },
          { account_id: String(account_id), debit_amount: 0, credit_amount: paymentBaseAmount, description: `Payment via ${account_name || payment_method || 'cash'} (${poCurrency} ${payAmt} @ ${rateNow})` },
        ];
        if (fxAccount && Math.abs(fxDelta) > 0.01) {
          lineItems.push(fxDelta > 0
            ? { account_id: fxAccount.id, debit_amount: 0, credit_amount: fxDelta, description: `FX gain settling PO ${po_number || po.po_number}` }
            : { account_id: fxAccount.id, debit_amount: -fxDelta, credit_amount: 0, description: `FX loss settling PO ${po_number || po.po_number}` }
          );
        } else if (!fxAccount && Math.abs(fxDelta) > 0.01) {
          console.warn(`Supplier bill payment ${insertedId}: FX delta of ${fxDelta} ${baseCurrency} could not be posted — account 5610 not found for clinic ${clinicIdNum}`);
        }

        const glEntry = await AccountingService.createGLEntry({
          clinic_id: clinicIdNum,
          transaction_date: payDate,
          transaction_type: 'supplier_bill_payment',
          description: `Supplier bill payment — PO ${po_number || po.po_number} to ${supplier_name || 'supplier'} (Voucher ${voucherNo})`,
          reference_id: String(insertedId || paymentId),
          reference_module: 'supplier_bill_payment',
        }, lineItems, req.user.id);
        await AccountingService.postGLEntry(glEntry.id, req.user.id);
      } else if (!hasGrnLiability) {
        const expenseAccount = await AccountingService.getAccountByCode(clinicIdNum, '5900');
        if (expenseAccount) {
          const lineItems = [
            { account_id: expenseAccount.id, debit_amount: paymentBaseAmount, credit_amount: 0, description: `Supplier payment (no goods receipt on file) — PO ${po_number || po.po_number} to ${supplier_name || 'supplier'}` },
            { account_id: String(account_id), debit_amount: 0, credit_amount: paymentBaseAmount, description: `Payment via ${account_name || payment_method || 'cash'} (${poCurrency} ${payAmt} @ ${rateNow})` },
          ];
          const glEntry = await AccountingService.createGLEntry({
            clinic_id: clinicIdNum,
            transaction_date: payDate,
            transaction_type: 'supplier_bill_payment',
            description: `Supplier bill payment — PO ${po_number || po.po_number} to ${supplier_name || 'supplier'} (Voucher ${voucherNo}) — posted direct to expense, no GRN on file`,
            reference_id: String(insertedId || paymentId),
            reference_module: 'supplier_bill_payment',
          }, lineItems, req.user.id);
          await AccountingService.postGLEntry(glEntry.id, req.user.id);
        } else {
          console.warn(`Supplier bill payment ${insertedId}: skipped GL posting — Miscellaneous Expenses account (5900) not found for clinic ${clinicIdNum}`);
        }
      } else {
        console.warn(`Supplier bill payment ${insertedId}: skipped GL posting — Accounts Payable account (2100) not found for clinic ${clinicIdNum}`);
      }
    } catch (glErr) {
      console.error('Non-blocking: failed to post GL entry for supplier bill payment', insertedId, glErr.message);
    }

    res.status(201).json({ id: paymentId, voucher_number: voucherNo, payment_status: payStatus, paid_amount: newPaid, balance_due: total - newPaid });
  } catch (error) {
    console.error('Error recording payment:', error);
    let cols = [];
    try {
      const [c] = await sequelize.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'supplier_bill_payments' ORDER BY ordinal_position`);
      cols = c.map(r => `${r.column_name}(${r.data_type})`);
    } catch(e2) { cols = ['could not fetch']; }
    res.status(500).json({ error: 'Failed to record payment', detail: error.message, hint: error.original?.detail || error.original?.message || null, columns: cols });
  }
});

// Pay an approved expense — deducts from account and marks as paid
// ─── Consultant Bills ───────────────────────────────────────────────────
// A consultant bill (created from a consultant's HR profile — see
// POST /api/hr/consultants/:id/bills) is a percentage-of-consultation-fees
// payable, distinct from a supplier PO bill: there's no PO/GRN chain or
// pre-booked Accounts Payable liability behind it, so paying one is a
// straight debit-expense/credit-cash entry (mirrors the "no GRN on file"
// branch of the supplier bill payment above, not the AP-settlement branch).

router.get('/consultant-bills', authorize('expenses.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [bills] = await sequelize.query(`
      SELECT cb.*, e.first_name, e.last_name, e.employee_number
      FROM consultant_bills cb
      JOIN employees e ON e.id = cb.consultant_id
      WHERE cb.clinic_id = :clinicId
      ORDER BY cb.created_at DESC
    `, { replacements: { clinicId } });
    res.json(bills);
  } catch (error) {
    console.error('Error fetching consultant bills:', error);
    res.status(500).json({ error: 'Failed to fetch consultant bills' });
  }
});

router.post('/consultant-bill-payment', authorize('expenses.write'), async (req, res) => {
  try {
    const { consultant_bill_id, payment_date, account_id, account_name, payment_method, reference_number, notes } = req.body || {};
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    if (!consultant_bill_id || !account_id) {
      return res.status(400).json({ error: 'consultant_bill_id and account_id are required' });
    }
    const [[bill]] = await sequelize.query(
      `SELECT cb.*, e.first_name, e.last_name, e.employee_number FROM consultant_bills cb
       JOIN employees e ON e.id = cb.consultant_id
       WHERE cb.id = :id AND cb.clinic_id = :clinicId`,
      { replacements: { id: consultant_bill_id, clinicId } }
    );
    if (!bill) return res.status(404).json({ error: 'Consultant bill not found' });
    if (bill.status !== 'unpaid') return res.status(409).json({ error: 'This bill has already been paid or cancelled' });

    const payDate = payment_date || new Date().toISOString().split('T')[0];
    const consultantLabel = `${bill.first_name} ${bill.last_name} (${bill.employee_number})`;

    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'USD';
    const billCurrency = bill.currency || baseCurrency;
    let rate = 1;
    if (billCurrency !== baseCurrency) {
      try { rate = await AccountingService.getExchangeRate(clinicId, billCurrency, baseCurrency, payDate) || 1; }
      catch (e) { rate = 1; }
    }
    const baseAmount = AccountingService.convertAmount(parseFloat(bill.bill_amount) || 0, rate);

    const doctorFeesAccount = await AccountingService.getAccountByCode(clinicId, '5110');
    let glEntry = null;
    if (doctorFeesAccount) {
      const lineItems = [
        { account_id: doctorFeesAccount.id, debit_amount: baseAmount, credit_amount: 0, description: `Consultant bill ${bill.bill_number} — ${consultantLabel} (${bill.period_from} to ${bill.period_to})` },
        { account_id: String(account_id), debit_amount: 0, credit_amount: baseAmount, description: `Payment via ${account_name || payment_method || 'cash'} (${billCurrency} ${bill.bill_amount} @ ${rate})` },
      ];
      glEntry = await AccountingService.createGLEntry({
        clinic_id: clinicId,
        transaction_date: payDate,
        transaction_type: 'consultant_bill_payment',
        description: `Consultant bill payment — ${bill.bill_number} to ${consultantLabel}`,
        reference_id: bill.id,
        reference_module: 'consultant_bill',
      }, lineItems, req.user?.id);
      await AccountingService.postGLEntry(glEntry.id, req.user?.id);
    } else {
      console.warn(`Consultant bill payment ${bill.id}: skipped GL posting — Doctor Fees account (5110) not found for clinic ${clinicId}`);
    }

    await sequelize.query(`
      UPDATE consultant_bills SET status = 'paid', payment_account_id = :accountId, exchange_rate = :rate,
        base_currency_amount = :baseAmount, gl_entry_id = :glId, paid_by = :userId, paid_at = NOW(),
        notes = :notes, updated_at = NOW()
      WHERE id = :id
    `, {
      replacements: {
        id: bill.id, accountId: String(account_id), rate, baseAmount,
        glId: glEntry?.id || null, userId: req.user?.id || null, notes: notes || null,
      }
    });

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.display_name, user_role: req.user?.role,
        module: 'HR', action: 'CONSULTANT_BILL_PAID', entity_type: 'ConsultantBill', entity_id: bill.id,
        description: `Consultant bill ${bill.bill_number} paid to ${consultantLabel} — ${billCurrency} ${bill.bill_amount}${glEntry ? `, GL entry ${glEntry.gl_number}` : ''}`,
        status: 'success',
      });
    } catch (e) { /* non-blocking */ }

    res.json({ success: true, gl_entry_id: glEntry?.id || null, gl_number: glEntry?.gl_number || null });
  } catch (error) {
    console.error('Error paying consultant bill:', error);
    res.status(500).json({ error: error.message || 'Failed to pay consultant bill' });
  }
});


router.post('/:id/pay', authorize('expenses.write'), async (req, res) => {
  try {
    const expenseId = parseInt(req.params.id);
    const payClinicId = BranchQueryFilter.resolveClinicId(req);
    const payReplacements = { id: expenseId, clinicId: payClinicId };
    const payBranchScope = branchScope(req, payReplacements);
    const [[exp]] = await sequelize.query(
      `SELECT * FROM daily_expenses WHERE id = :id AND clinic_id = :clinicId ${payBranchScope} LIMIT 1`,
      { replacements: payReplacements }
    );
    if (!exp) return res.status(404).json({ error: 'Expense not found' });
    if (exp.status !== 'approved') return res.status(400).json({ error: 'Expense must be fully approved before payment' });

    // Post to the General Ledger: Debit the category's expense account (the cost),
    // Credit the account the expense was paid from (cash/bank leaving). Replaces the
    // previous raw `UPDATE chart_of_accounts SET current_balance = ...` mutation, which
    // (a) targeted a column that does not exist on chart_of_accounts in this schema and
    // silently failed every time, and (b) bypassed the double-entry GL/account_ledger
    // system entirely even when it did work. Non-blocking — a GL failure must never
    // prevent the payment itself from completing.
    try {
      const clinicIdNum = parseInt(exp.clinic_id || 1);
      const expenseAccountCode = CATEGORY_EXPENSE_CODE[exp.category] || DEFAULT_EXPENSE_CODE;
      const expenseAccount = await AccountingService.getAccountByCode(clinicIdNum, expenseAccountCode);
      if (!expenseAccount) {
        // getAccountByCode only returns active accounts, so a category mapped to
        // a deactivated code silently posts nothing: the expense is paid and the
        // ledger never hears about it. Say so rather than leaving the books to
        // quietly drift.
        console.error(
          `Daily expense ${expenseId} paid but NOT posted: expense account ${expenseAccountCode} ` +
          `for category "${exp.category}" is missing or inactive in clinic ${clinicIdNum}.`
        );
      }
      if (expenseAccount && exp.account_id) {
        const glEntry = await AccountingService.createGLEntry({
          clinic_id: clinicIdNum,
          transaction_date: new Date(),
          transaction_type: 'daily_expense_payment',
          description: `Expense paid: ${exp.description} (Voucher ${exp.voucher_number || `EXP-${expenseId}`})`,
          reference_id: String(expenseId),
          reference_module: 'daily_expense',
        }, [
          { account_id: expenseAccount.id, debit_amount: parseFloat(exp.amount), credit_amount: 0, description: `${exp.category || 'Expense'} — ${exp.description}` },
          { account_id: String(exp.account_id), debit_amount: 0, credit_amount: parseFloat(exp.amount), description: `Payment via ${exp.payment_method || 'cash'} — ${exp.description}` },
        ], req.user.id);
        await AccountingService.postGLEntry(glEntry.id, req.user.id);
      } else {
        console.warn(`Daily expense ${expenseId}: skipped GL posting — expense account (${expenseAccountCode}) or deduct-from account not found for clinic ${clinicIdNum}`);
      }
    } catch (glErr) {
      console.error('Non-blocking: failed to post GL entry for daily expense payment', expenseId, glErr.message);
    }

    await sequelize.query(
      `UPDATE daily_expenses SET status='paid', paid_at=NOW() WHERE id=:id`,
      { replacements: { id: expenseId } }
    );

    try { const rr = require('./reports'); await rr.logAudit({ req, user_id: req.user?.id, user_name: req.user?.display_name, user_role: req.user?.role, module: 'Expenses', action: 'EXPENSE_PAID', entity_type: 'DailyExpense', entity_id: String(expenseId), description: `Expense paid: ${exp.description} — ${exp.amount} (voucher: ${exp.voucher_number})`, ip_address: req.ip, status: 'success' }); } catch(e) {}
    res.json({ success: true, status: 'paid', voucher_number: exp.voucher_number });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// Get single expense by id
router.get('/:id', authorize('expenses.read'), async (req, res) => {
  try {
    const getReplacements = { id: parseInt(req.params.id), clinicId: BranchQueryFilter.resolveClinicId(req) };
    const getBranchScope = branchScope(req, getReplacements);
    const [rows] = await sequelize.query(
      `SELECT * FROM daily_expenses WHERE id = :id AND clinic_id = :clinicId ${getBranchScope} LIMIT 1`,
      { replacements: getReplacements }
    );
    if (!rows.length) return res.status(404).json({ error: 'Expense not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

// Get approvals for an expense
router.get('/:id/approvals', authorize('expenses.read'), async (req, res) => {
  try {
    const expApprovalsReplacements = { id: parseInt(req.params.id), clinicId: BranchQueryFilter.resolveClinicId(req) };
    const expApprovalsBranchScope = branchScope(req, expApprovalsReplacements, 'de');
    const [approvals] = await sequelize.query(
      `SELECT dea.* FROM daily_expense_approvals dea
       JOIN daily_expenses de ON de.id = dea.expense_id
       WHERE dea.expense_id = :id AND de.clinic_id = :clinicId ${expApprovalsBranchScope}
       ORDER BY dea.approval_level ASC`,
      { replacements: expApprovalsReplacements }
    );
    res.json(approvals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch approvals' });
  }
});

// Submit approval for an expense (permission-gated via approval_permissions —
// password re-entry was removed in favor of the granular approval-permission
// system, see requireApprovalPermission)
router.post('/:id/approve', requireApprovalPermission('expense_approve'), async (req, res) => {
  try {
    const { approved_by_title, notes } = req.body;
    if (!req.user?.id) return res.status(401).json({ error: 'Not authenticated' });

    const [[dbUser]] = await sequelize.query(
      'SELECT id, display_name, signature FROM users WHERE id = ? LIMIT 1',
      { replacements: [req.user.id] }
    );
    if (!dbUser) return res.status(401).json({ error: 'User not found' });

    const expenseId = parseInt(req.params.id);
    const [existing] = await sequelize.query(
      'SELECT * FROM daily_expense_approvals WHERE expense_id = :id ORDER BY approval_level ASC',
      { replacements: { id: expenseId } }
    );
    if (existing.length >= 2) return res.status(400).json({ error: 'This expense already has all required approvals' });

    const nextLevel = existing.length + 1;
    const id = uuidv4();
    await sequelize.query(
      'INSERT INTO daily_expense_approvals (id, expense_id, user_id, approval_level, approved_by, approved_by_title, signature, notes, branch_id) VALUES (:id, :expense_id, :user_id, :level, :approved_by, :title, :signature, :notes, :branchId)',
      { replacements: { id, expense_id: expenseId, user_id: req.user.id, level: nextLevel, approved_by: dbUser.display_name, title: null, signature: dbUser.signature || null, notes: notes || null, branchId: getCreateBranchId(req) } }
    );

    let voucherNo = null;
    // On 2nd (final) approval: mark as approved and assign voucher number
    // Account deduction happens only when Pay Now is clicked
    if (nextLevel === 2) {
      voucherNo = `EXP-${Date.now().toString().slice(-8)}`;
      await sequelize.query(
        `UPDATE daily_expenses SET status='approved', voucher_number=:v WHERE id=:id`,
        { replacements: { v: voucherNo, id: expenseId } }
      );
    }

    try { const rr = require('./reports'); await rr.logAudit({ req, user_id: req.user?.id, user_name: dbUser.display_name, user_role: req.user?.role, module: 'Expenses', action: nextLevel === 2 ? 'EXPENSE_FINAL_APPROVED' : 'EXPENSE_APPROVED', entity_type: 'DailyExpense', entity_id: String(expenseId), description: `Expense approval level ${nextLevel} by ${dbUser.display_name}${voucherNo ? ` — voucher ${voucherNo}` : ''}`, ip_address: req.ip, status: 'success' }); } catch(e) {}
    res.status(201).json({ id, approval_level: nextLevel, approved_by: dbUser.display_name, signature: dbUser.signature || null, total_approvals: nextLevel, voucher_number: voucherNo });
  } catch (error) {
    console.error('Error submitting expense approval:', error);
    res.status(500).json({ error: 'Failed to submit approval' });
  }
});

/**
 * Load an expense that is still editable, or explain why it is not.
 *
 * An expense stops being editable the moment someone has approved it: the
 * figures are what they signed against, and a final approval also assigns a
 * voucher number and opens the door to payment. Until then it is a draft and
 * correcting a wrong amount, category or account should not require deleting
 * the record and starting again.
 */
async function loadEditableExpense(req) {
  const id = parseInt(req.params.id);
  if (!Number.isFinite(id)) return { error: { code: 400, body: { error: 'Invalid expense id' } } };

  const editReplacements = { id, cid: BranchQueryFilter.resolveClinicId(req) };
  const editBranchScope = branchScope(req, editReplacements);
  const [[expense]] = await sequelize.query(
    `SELECT * FROM daily_expenses WHERE id = :id AND clinic_id = :cid ${editBranchScope} LIMIT 1`,
    { replacements: editReplacements });
  if (!expense) return { error: { code: 404, body: { error: 'Expense not found' } } };

  if (expense.status === 'paid' || expense.paid_at) {
    return { error: { code: 400, body: { error: 'This expense has already been paid and cannot be changed' } } };
  }
  if (expense.status === 'approved') {
    return { error: { code: 400, body: { error: 'This expense is fully approved and cannot be changed' } } };
  }

  const [approvals] = await sequelize.query(
    'SELECT id FROM daily_expense_approvals WHERE expense_id = :id', { replacements: { id } });
  if (approvals.length > 0) {
    return { error: { code: 400, body: { error: `This expense already has ${approvals.length} approval(s) and cannot be changed. Reject it first if it is wrong.` } } };
  }

  return { expense, id };
}

// Edit an expense that has not been approved yet
router.put('/:id', authorize('expenses.write'), async (req, res) => {
  try {
    const { expense, id, error } = await loadEditableExpense(req);
    if (error) return res.status(error.code).json(error.body);

    const { account_id, amount, description, expense_date, category, notes, payment_method } = req.body;

    if (amount !== undefined && !(parseFloat(amount) > 0)) {
      return res.status(400).json({ error: 'Amount must be greater than zero' });
    }

    // Keep account_name in step with account_id: it is denormalised onto the row
    // and printed on the voucher, so leaving it stale would show one account on
    // the paperwork and post to another.
    let accountName = expense.account_name;
    if (account_id !== undefined && String(account_id) !== String(expense.account_id)) {
      accountName = 'Unknown';
      try {
        const coa = await ChartOfAccounts.findByPk(account_id);
        if (coa) accountName = coa.account_name;
        else {
          const la = await LedgerAccount.findByPk(account_id);
          if (la) accountName = la.account_name;
        }
      } catch (e) { /* keep 'Unknown' rather than failing the edit */ }
    }

    const next = {
      account_id: account_id ?? expense.account_id,
      account_name: accountName,
      amount: amount !== undefined ? parseFloat(amount) : expense.amount,
      description: description ?? expense.description,
      expense_date: expense_date ?? expense.expense_date,
      category: category ?? expense.category,
      notes: notes ?? expense.notes,
      payment_method: payment_method ?? expense.payment_method,
    };

    await sequelize.query(
      `UPDATE daily_expenses SET account_id = :account_id, account_name = :account_name,
              amount = :amount, description = :description, expense_date = :expense_date,
              category = :category, notes = :notes, payment_method = :payment_method,
              updated_at = NOW()
        WHERE id = :id`,
      { replacements: { ...next, id } });

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.display_name, user_role: req.user?.role,
        module: 'Expenses', action: 'EXPENSE_UPDATED', entity_type: 'DailyExpense', entity_id: String(id),
        description: `Expense edited before approval: ${next.description} — ${next.amount}`,
        old_values: { amount: expense.amount, description: expense.description, category: expense.category, account_name: expense.account_name },
        new_values: { amount: next.amount, description: next.description, category: next.category, account_name: next.account_name },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) { /* audit must not block the edit */ }

    const [[updated]] = await sequelize.query('SELECT * FROM daily_expenses WHERE id = :id', { replacements: { id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

// Remove an expense that has not been approved yet
router.delete('/:id', authorize('expenses.write'), async (req, res) => {
  try {
    const { expense, id, error } = await loadEditableExpense(req);
    if (error) return res.status(error.code).json(error.body);

    await sequelize.query('DELETE FROM daily_expenses WHERE id = :id', { replacements: { id } });

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.display_name, user_role: req.user?.role,
        module: 'Expenses', action: 'EXPENSE_DELETED', entity_type: 'DailyExpense', entity_id: String(id),
        description: `Expense removed before approval: ${expense.description} — ${expense.amount}`,
        old_values: { amount: expense.amount, description: expense.description, category: expense.category },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) { /* audit must not block the delete */ }

    res.json({ message: 'Expense removed' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

/**
 * Reject an expense.
 *
 * Rejecting is an approver's decision, so it needs the approval permission
 * rather than the write permission — and unlike editing it stays available
 * after a first approval, which is the case it exists for: the second approver
 * disagreeing with the first. A rejected expense keeps its record and its
 * reason instead of being deleted, so the decision is auditable, and it never
 * reaches the payment step.
 */
router.post('/:id/reject', requireApprovalPermission('expense_approve'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { reason } = req.body;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid expense id' });
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason is required when rejecting an expense' });
    }

    const rejectReplacements = { id, cid: BranchQueryFilter.resolveClinicId(req) };
    const rejectBranchScope = branchScope(req, rejectReplacements);
    const [[expense]] = await sequelize.query(
      `SELECT * FROM daily_expenses WHERE id = :id AND clinic_id = :cid ${rejectBranchScope} LIMIT 1`,
      { replacements: rejectReplacements });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.status === 'paid' || expense.paid_at) {
      return res.status(400).json({ error: 'This expense has already been paid and cannot be rejected' });
    }
    if (expense.status === 'rejected') {
      return res.status(400).json({ error: 'This expense is already rejected' });
    }

    await sequelize.query(
      `UPDATE daily_expenses SET status = 'rejected',
              notes = COALESCE(NULLIF(notes, ''), '') ||
                      CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END ||
                      'Rejected: ' || :reason,
              updated_at = NOW()
        WHERE id = :id`,
      { replacements: { id, reason: String(reason).trim() } });

    // Clear any approvals already given, so a re-submitted expense starts over
    // rather than inheriting a signature from before the objection was raised.
    await sequelize.query('DELETE FROM daily_expense_approvals WHERE expense_id = :id', { replacements: { id } });

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.display_name, user_role: req.user?.role,
        module: 'Expenses', action: 'EXPENSE_REJECTED', entity_type: 'DailyExpense', entity_id: String(id),
        description: `Expense rejected: ${expense.description} — ${expense.amount} (${String(reason).trim()})`,
        old_values: { status: expense.status },
        new_values: { status: 'rejected', reason: String(reason).trim() },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) { /* audit must not block the rejection */ }

    res.json({ message: 'Expense rejected', status: 'rejected' });
  } catch (error) {
    console.error('Error rejecting expense:', error);
    res.status(500).json({ error: 'Failed to reject expense' });
  }
});

router.post('/', authorize('expenses.write'), async (req, res) => {
  try {
    // Validate before writing. Without this the missing field surfaced as a 500
    // from the database driver, which reads to the caller as "the server broke"
    // rather than "you left something out".
    if (!req.body?.description || !(parseFloat(req.body?.amount) > 0) || !req.body?.account_id) {
      return res.status(400).json({ error: 'description, a positive amount and account_id are required' });
    }
    const { account_id, amount, description, expense_date, category, notes, created_by, payment_method } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);
    let accountName = 'Unknown';
    try {
      const coa = await ChartOfAccounts.findByPk(account_id);
      if (coa) { accountName = coa.account_name; }
      else {
        const la = await LedgerAccount.findByPk(account_id);
        if (la) { accountName = la.account_name; }
      }
    } catch(e){}
    // Written in the INSERT itself rather than as a follow-up UPDATE. That
    // UPDATE carried the only thing forcing a new expense to 'pending_approval',
    // yet swallowed its own errors — so whenever it failed the row silently kept
    // the column default, which on older tables is 'paid'. A brand-new expense
    // then showed as already paid, skipping the approval flow entirely.
    const expense = await DailyExpense.create({
      expense_date: expense_date || new Date(),
      description, amount, account_id,
      account_name: accountName, category, notes, created_by,
      clinic_id: parseInt(clinic_id || 1),
      payment_method: payment_method || 'cash',
      status: 'pending_approval',
      branch_id: getCreateBranchId(req),
    });
    try { const rr = require('./reports'); await rr.logAudit({ req, user_id: req.user?.id, user_name: created_by || req.user?.display_name, user_role: req.user?.role, module: 'Expenses', action: 'EXPENSE_CREATED', entity_type: 'DailyExpense', entity_id: String(expense.id), description: `Expense created: ${description} — ${amount}`, new_values: { amount, category, account_name: accountName }, ip_address: req.ip, status: 'success' }); } catch(e) {}
    res.status(201).json({ ...expense.toJSON(), status: 'pending_approval' });
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});


module.exports = router;
