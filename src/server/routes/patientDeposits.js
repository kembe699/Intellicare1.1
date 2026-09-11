const express = require('express');
const { isUniqueViolation, isDuplicateColumn } = require('../utils/dbErrors');
const router = express.Router();
const { sequelize, Receipt, ChartOfAccounts, JournalEntries, JournalEntryLines, AccountLedger, CashierShift } = require('../models');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { getCreateBranchId } = require('../middleware/branchFilter');
const { authorize } = require('../middleware/authorize');
const { requireApprovalPermission } = require('../middleware/requireApprovalPermission');

const BASE_CURRENCY = 'SSP';
// Same roles as BILLS_FINANCIAL_ACTION in patientBills.js — recording a payment/deposit
// is a cashier/finance action, matching how the rest of the billing surface is gated.

// ─── Table Bootstrap ──────────────────────────────────────────────────────────
// Self-migrating, matches the CREATE TABLE IF NOT EXISTS convention used throughout
// this codebase (cashier.js, apiConfigurations.js, approvals.js).
(async () => {
  try {
    // The locked, current-state balance per (patient, clinic, currency) — this is what
    // every deposit/usage/refund/reversal locks with SELECT ... FOR UPDATE so concurrent
    // writes for the same patient can never overdraw it. Deliberately NOT keyed by branch:
    // a deposit is usable clinic-wide, at whichever branch the patient happens to be at.
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS patient_deposit_balances (
        patient_id VARCHAR(36) NOT NULL,
        clinic_id INT NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT '${BASE_CURRENCY}',
        balance DECIMAL(15,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (patient_id, clinic_id, currency)
      )
    `);
    // The append-only audit ledger — every deposit, use-against-a-bill, reversal-of-a-use
    // (when a deposit-paid receipt is voided), and refund is one row here, each carrying a
    // balance_after snapshot for fast history display.
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS patient_deposits (
        id CHAR(36) PRIMARY KEY,
        patient_id VARCHAR(36) NOT NULL,
        patient_name VARCHAR(255),
        clinic_id INT NOT NULL,
        branch_id INT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT '${BASE_CURRENCY}',
        type ENUM('deposit','usage','usage_reversal','refund') NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        balance_after DECIMAL(15,2) NOT NULL,
        bill_id CHAR(36) NULL,
        receipt_id CHAR(36) NULL,
        reversed_receipt_id CHAR(36) NULL,
        payment_method VARCHAR(30) NULL,
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pd_patient (patient_id, clinic_id, created_at),
        INDEX idx_pd_bill (bill_id)
      )
    `);
    console.log('✅ patient_deposits / patient_deposit_balances tables ready');
  } catch (e) {
    console.warn('patient_deposits table bootstrap warning:', e.message);
  }
})();

// receipts.receipt_type distinguishes a normal bill payment from a deposit/deposit-refund
// receipt (which has bill_id: null) — added the established ADD COLUMN + catch-ER_DUP_FIELDNAME
// way (matches cashier.js's reconciliation-column bootstrap), since MySQL doesn't support
// ADD COLUMN IF NOT EXISTS.
(async () => {
  try {
    await sequelize.query(`ALTER TABLE receipts ADD COLUMN receipt_type ENUM('payment','deposit','deposit_refund') NOT NULL DEFAULT 'payment'`);
    console.log('✅ Added receipts.receipt_type column');
  } catch (e) {
    if (!isDuplicateColumn(e)) console.warn('Could not add receipts.receipt_type:', e.message);
  }
})();

// Ensures the "Patient Deposits Held" liability account exists even for clinics whose
// chart of accounts was initialized before this feature existed — initializeChartOfAccounts.js
// seeds it for brand-new clinics; this findOrCreate covers everyone else.
(async () => {
  try {
    const [clinics] = await sequelize.query(`SELECT DISTINCT clinic_id FROM chart_of_accounts`);
    for (const { clinic_id } of clinics) {
      const [existing] = await sequelize.query(
        `SELECT id FROM chart_of_accounts WHERE clinic_id = ? AND account_code = '2150' LIMIT 1`,
        { replacements: [clinic_id] }
      );
      if (existing.length === 0) {
        await ChartOfAccounts.create({
          clinic_id, account_code: '2150', account_name: 'Patient Deposits Held',
          account_type: 'liability', sub_account_type: 'current_liability', balance_type: 'credit',
          description: 'Unearned patient deposits held until applied to a bill or refunded',
          is_active: true, opening_balance: 0,
        });
        console.log(`✅ Created 2150 Patient Deposits Held for clinic ${clinic_id}`);
      }
    }
  } catch (e) {
    console.warn('Patient Deposits Held account bootstrap warning:', e.message);
  }
})();

// ─── Core: race-safe balance mutation ─────────────────────────────────────────
// Every deposit/usage/usage_reversal/refund goes through this. Must be called inside an
// existing transaction `t` — locks the patient's balance row for the duration of `t`, so
// a second concurrent call for the same (patient, clinic, currency) blocks until the first
// commits or rolls back, then sees the up-to-date balance. This is what makes "two
// simultaneous bill payments for the same patient can't both pass the balance check and
// overdraw the deposit" true — the existing GL tables in this codebase derive balances by
// summing on read (fine for accounting reports, not safe enough for a spendable balance
// that must never go negative), so this dedicated locked row is a deliberate departure
// from that pattern for this one table.
async function adjustDepositBalance(t, {
  patientId, patientName, clinicId, branchId, currency, type, amount,
  billId, receiptId, reversedReceiptId, paymentMethod, notes, createdBy,
}) {
  if (!patientId) throw new Error('patientId is required');
  if (!(amount > 0)) throw new Error('amount must be greater than zero');
  const cur = currency || BASE_CURRENCY;

  // Ensure the balance row exists, then lock it. The no-op ON CONFLICT DO NOTHING is the
  // standard idiom for "insert if absent" without a separate existence check racing
  // against another transaction doing the same thing.
  await sequelize.query(
    `INSERT INTO patient_deposit_balances (patient_id, clinic_id, currency, balance)
     VALUES (?, ?, ?, 0)
     ON CONFLICT (patient_id, clinic_id, currency) DO NOTHING`,
    { replacements: [patientId, clinicId, cur], transaction: t }
  );
  const [rows] = await sequelize.query(
    `SELECT balance FROM patient_deposit_balances WHERE patient_id = ? AND clinic_id = ? AND currency = ? FOR UPDATE`,
    { replacements: [patientId, clinicId, cur], transaction: t }
  );
  const current = parseFloat(rows[0]?.balance) || 0;
  const delta = (type === 'deposit' || type === 'usage_reversal') ? amount : -amount;
  const next = current + delta;
  if (next < -0.01) {
    const err = new Error('Insufficient deposit balance');
    err.code = 'INSUFFICIENT_DEPOSIT';
    err.available = current;
    throw err;
  }

  await sequelize.query(
    `UPDATE patient_deposit_balances SET balance = ? WHERE patient_id = ? AND clinic_id = ? AND currency = ?`,
    { replacements: [next, patientId, clinicId, cur], transaction: t }
  );

  const id = uuidv4();
  await sequelize.query(
    `INSERT INTO patient_deposits
      (id, patient_id, patient_name, clinic_id, branch_id, currency, type, amount, balance_after,
       bill_id, receipt_id, reversed_receipt_id, payment_method, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    {
      replacements: [
        id, patientId, patientName || null, clinicId, branchId || null, cur, type, amount, next,
        billId || null, receiptId || null, reversedReceiptId || null, paymentMethod || null,
        notes || null, createdBy || null,
      ],
      transaction: t,
    }
  );

  return { id, balance: next };
}

// Read-only helper — used by patientBills.js to check "does this patient have enough
// deposit" before attempting the transactional draw-down, and by the GET endpoints below.
async function getDepositBalance(patientId, clinicId, currency = BASE_CURRENCY) {
  const [rows] = await sequelize.query(
    `SELECT balance FROM patient_deposit_balances WHERE patient_id = ? AND clinic_id = ? AND currency = ?`,
    { replacements: [patientId, clinicId, currency] }
  );
  return parseFloat(rows[0]?.balance) || 0;
}

// ─── GL posting (best-effort, mirrors patientBills.js:1324-1421) ─────────────
async function resolveCashOrBankAccount(clinicId, method) {
  if (method === 'cash') {
    // 1100 (Cash) first, matching patientBills.js's payment posting — a deposit
    // taken in cash lands in the same account a bill payment would.
    return await ChartOfAccounts.findOne({
      where: { clinic_id: clinicId, account_code: '1100', is_active: true }
    }) || await ChartOfAccounts.findOne({
      where: { clinic_id: clinicId, account_type: 'asset', is_active: true, account_name: { [Op.iLike]: 'cash' } }
    }) || await ChartOfAccounts.findOne({
      where: { clinic_id: clinicId, account_type: 'asset', is_active: true, account_name: { [Op.iLike]: '%cash%hand%' } },
      order: [['account_code', 'ASC']]
    }) || await ChartOfAccounts.findOne({
      where: { clinic_id: clinicId, account_type: 'asset', is_active: true, account_name: { [Op.iLike]: '%cash%' } },
      order: [['account_code', 'ASC']]
    });
  }
  return await ChartOfAccounts.findOne({
    where: { clinic_id: clinicId, is_bank_account: true, is_active: true },
    order: [['account_code', 'ASC']]
  }) || await ChartOfAccounts.findOne({
    where: { clinic_id: clinicId, account_type: 'asset', is_active: true },
    order: [['account_code', 'ASC']]
  });
}

async function generateJENumber(clinicId) {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const lastJE = await JournalEntries.findOne({
    where: { clinic_id: clinicId, je_number: { [Op.like]: `JE-${year}${month}-%` } },
    order: [['je_number', 'DESC']]
  });
  const seq = lastJE ? parseInt(lastJE.je_number.split('-').pop()) + 1 : 1;
  return `JE-${year}${month}-${String(seq).padStart(4, '0')}`;
}

// direction: 'in' = deposit taken (Dr Cash/Bank, Cr 2150), 'out' = refund paid (Dr 2150, Cr Cash/Bank)
async function postDepositGL({ clinicId, amount, method, direction, reference, description, userId }) {
  try {
    const cashOrBank = await resolveCashOrBankAccount(clinicId, (method || 'cash').toLowerCase());
    const depositsHeld = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '2150', is_active: true } });
    if (!cashOrBank || !depositsHeld) {
      console.warn('Non-fatal: skipping deposit GL posting — missing account(s)', { cashOrBank: !!cashOrBank, depositsHeld: !!depositsHeld });
      return;
    }
    const debitAccount = direction === 'in' ? cashOrBank : depositsHeld;
    const creditAccount = direction === 'in' ? depositsHeld : cashOrBank;
    const jeNumber = await generateJENumber(clinicId);
    const today = new Date().toISOString().split('T')[0];

    const t2 = await sequelize.transaction();
    try {
      const je = await JournalEntries.create({
        clinic_id: clinicId, je_number: jeNumber, entry_date: today, description,
        narration: reference, reference, transaction_currency: BASE_CURRENCY, base_currency: BASE_CURRENCY,
        exchange_rate: 1.0, total_debit: amount, total_credit: amount, base_total_debit: amount, base_total_credit: amount,
        status: 'posted', created_by: userId || 'system', posted_by: userId || 'system', posted_date: new Date(),
      }, { transaction: t2 });

      await JournalEntryLines.bulkCreate([
        { je_id: je.id, account_id: debitAccount.id, debit_amount: amount, credit_amount: 0, base_debit_amount: amount, base_credit_amount: 0, description },
        { je_id: je.id, account_id: creditAccount.id, debit_amount: 0, credit_amount: amount, base_debit_amount: 0, base_credit_amount: amount, description },
      ], { transaction: t2 });

      await AccountLedger.bulkCreate([
        { clinic_id: clinicId, account_id: debitAccount.id, transaction_date: today, debit_amount: amount, credit_amount: 0, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'billing' },
        { clinic_id: clinicId, account_id: creditAccount.id, transaction_date: today, debit_amount: 0, credit_amount: amount, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'billing' },
      ], { transaction: t2 });

      await t2.commit();
      console.log(`Deposit GL posted: ${jeNumber} (${debitAccount.account_name} / ${creditAccount.account_name})`);
    } catch (jeErr) {
      await t2.rollback();
      console.warn('Non-fatal: failed to post deposit GL:', jeErr.message);
    }
  } catch (coaErr) {
    console.warn('Non-fatal: deposit GL posting skipped:', coaErr.message);
  }
}

async function requireOpenShift(req, res) {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: 'Authentication required' }); return null; }
  const shift = await CashierShift.findOne({ where: { cashier_id: userId, status: 'open' }, order: [['start_time', 'DESC']] });
  if (!shift) { res.status(403).json({ error: 'No active cashier shift found. Please start a cashier shift before recording a deposit.', requiresShift: true }); return null; }
  return shift;
}

// ─── Routes ────────────────────────────────────────────────────────────────

router.get('/:patientId/balance', authorize('deposits.read'), async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id) || req.user?.clinic || 1;
    const currency = req.query.currency || BASE_CURRENCY;
    const balance = await getDepositBalance(req.params.patientId, clinicId, currency);
    const [totals] = await sequelize.query(
      `SELECT type, COALESCE(SUM(amount), 0) AS total FROM patient_deposits
       WHERE patient_id = ? AND clinic_id = ? AND currency = ? GROUP BY type`,
      { replacements: [req.params.patientId, clinicId, currency] }
    );
    const byType = Object.fromEntries(totals.map(r => [r.type, parseFloat(r.total)]));
    res.json({
      balance, currency,
      totalDeposited: byType.deposit || 0,
      totalUsed: (byType.usage || 0) - (byType.usage_reversal || 0),
      totalRefunded: byType.refund || 0,
    });
  } catch (error) {
    console.error('Error fetching deposit balance:', error);
    res.status(500).json({ error: 'Failed to fetch deposit balance' });
  }
});

router.get('/:patientId/history', authorize('deposits.read'), async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id) || req.user?.clinic || 1;
    const [rows] = await sequelize.query(
      `SELECT * FROM patient_deposits WHERE patient_id = ? AND clinic_id = ? ORDER BY created_at DESC LIMIT 200`,
      { replacements: [req.params.patientId, clinicId] }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching deposit history:', error);
    res.status(500).json({ error: 'Failed to fetch deposit history' });
  }
});

router.post('/', authorize('deposits.write'), async (req, res) => {
  let t;
  try {
    const shift = await requireOpenShift(req, res);
    if (!shift) return;

    const { patient_id, patient_name, amount, payment_method, notes } = req.body;
    const amountNum = parseFloat(amount);
    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });
    if (!(amountNum > 0)) return res.status(400).json({ error: 'A valid deposit amount is required' });
    if (!payment_method) return res.status(400).json({ error: 'Payment method is required' });

    const clinicId = parseInt(req.body.clinic_id) || req.user?.clinic || 1;
    const branchId = getCreateBranchId(req);
    const currency = req.body.currency || BASE_CURRENCY;
    const receiptId = uuidv4();
    const receiptNumber = `DEP-${Date.now().toString().slice(-8)}`;

    t = await sequelize.transaction();
    const { balance } = await adjustDepositBalance(t, {
      patientId: patient_id, patientName: patient_name, clinicId, branchId, currency,
      type: 'deposit', amount: amountNum, receiptId, paymentMethod: payment_method,
      notes, createdBy: req.user?.displayName || req.user?.email,
    });

    await Receipt.create({
      id: receiptId, receipt_number: receiptNumber, bill_id: null, receipt_type: 'deposit',
      patient_id, patient_name, clinic_id: clinicId, branch_id: branchId,
      total_amount: amountNum, amount_paid: amountNum, payment_amount: amountNum,
      payment_method, payment_date: new Date(), notes, status: 'active',
      cashier_name: req.user?.displayName || 'System', cashier_id: req.user?.id || null,
    }, { transaction: t });

    await t.commit();

    postDepositGL({
      clinicId, amount: amountNum, method: payment_method, direction: 'in',
      reference: `RCP-${receiptId}`, description: `Patient deposit — ${patient_name || patient_id} (${receiptNumber})`,
      userId: req.user?.id,
    });

    try {
      const rr = require('./reports');
      await rr.logAudit({
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Billing', action: 'PATIENT_DEPOSIT_TAKEN', entity_type: 'PatientDeposit', entity_id: receiptId,
        description: `Deposit of ${amountNum} ${currency} taken from ${patient_name || patient_id} (${receiptNumber}) — new balance ${balance}`,
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.status(201).json({
      deposit: { balance, currency, amount: amountNum },
      receipt: { id: receiptId, receipt_number: receiptNumber, amount: amountNum, method: payment_method, date: new Date(), patient_name, notes },
    });
  } catch (error) {
    if (t) await t.rollback();
    console.error('Error recording patient deposit:', error);
    res.status(500).json({ error: 'Failed to record patient deposit', details: error.message });
  }
});

router.post('/:patientId/refund', requireApprovalPermission('deposit_refund_approve'), async (req, res) => {
  let t;
  try {
    const shift = await requireOpenShift(req, res);
    if (!shift) return;

    const { patientId } = req.params;
    const { amount, payment_method, notes, patient_name } = req.body;
    const amountNum = parseFloat(amount);
    if (!(amountNum > 0)) return res.status(400).json({ error: 'A valid refund amount is required' });
    if (!payment_method) return res.status(400).json({ error: 'Payment method is required' });

    const clinicId = parseInt(req.body.clinic_id) || req.user?.clinic || 1;
    const branchId = getCreateBranchId(req);
    const currency = req.body.currency || BASE_CURRENCY;
    const receiptId = uuidv4();
    const receiptNumber = `DEPR-${Date.now().toString().slice(-8)}`;

    t = await sequelize.transaction();
    let balance;
    try {
      ({ balance } = await adjustDepositBalance(t, {
        patientId, patientName: patient_name, clinicId, branchId, currency,
        type: 'refund', amount: amountNum, receiptId, paymentMethod: payment_method,
        notes, createdBy: req.user?.displayName || req.user?.email,
      }));
    } catch (err) {
      await t.rollback();
      if (err.code === 'INSUFFICIENT_DEPOSIT') {
        return res.status(400).json({ error: `Cannot refund more than the available deposit balance (${err.available}).` });
      }
      throw err;
    }

    await Receipt.create({
      id: receiptId, receipt_number: receiptNumber, bill_id: null, receipt_type: 'deposit_refund',
      patient_id: patientId, patient_name, clinic_id: clinicId, branch_id: branchId,
      total_amount: amountNum, amount_paid: amountNum, payment_amount: amountNum,
      payment_method, payment_date: new Date(), notes, status: 'active',
      cashier_name: req.user?.displayName || 'System', cashier_id: req.user?.id || null,
    }, { transaction: t });

    await t.commit();

    postDepositGL({
      clinicId, amount: amountNum, method: payment_method, direction: 'out',
      reference: `RCP-${receiptId}`, description: `Deposit refund — ${patient_name || patientId} (${receiptNumber})`,
      userId: req.user?.id,
    });

    try {
      const rr = require('./reports');
      await rr.logAudit({
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Billing', action: 'PATIENT_DEPOSIT_REFUNDED', entity_type: 'PatientDeposit', entity_id: receiptId,
        description: `Deposit refund of ${amountNum} ${currency} paid to ${patient_name || patientId} (${receiptNumber}) — new balance ${balance}`,
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.status(201).json({
      deposit: { balance, currency, amount: amountNum },
      receipt: { id: receiptId, receipt_number: receiptNumber, amount: amountNum, method: payment_method, date: new Date(), patient_name, notes },
    });
  } catch (error) {
    if (t) await t.rollback();
    console.error('Error refunding patient deposit:', error);
    res.status(500).json({ error: 'Failed to refund patient deposit', details: error.message });
  }
});

module.exports = router;
module.exports.adjustDepositBalance = adjustDepositBalance;
module.exports.getDepositBalance = getDepositBalance;
module.exports.postDepositGL = postDepositGL;
module.exports.resolveCashOrBankAccount = resolveCashOrBankAccount;
module.exports.generateJENumber = generateJENumber;
module.exports.BASE_CURRENCY = BASE_CURRENCY;
