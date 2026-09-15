const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { requireApprovalPermission } = require('../middleware/requireApprovalPermission');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const AccountingService = require('../services/AccountingService');

// A cash advance against future salary. Deliberately simple compared to
// Supplier Bills' 3-level approval chain — matches Consultant Bills'
// shape instead: request -> approve -> disburse (posts a GL entry) ->
// repay in one or more manually-recorded installments (no automatic
// payroll deduction — that's a real feature this pass didn't build).

// There's no pre-existing "Employee Advances Receivable" account in this
// app's chart of accounts (unlike payroll's 5100/5110/2200, which were
// already there) — auto-provisions one per clinic the first time it's
// needed, the same pattern already used for Patient Deposits Held (2150,
// see patientDeposits.js) rather than requiring an admin to set it up by
// hand first.
async function ensureAdvancesAccount(clinicId) {
  let account = await AccountingService.getAccountByCode(clinicId, '1250');
  if (account) return account;
  try {
    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, sub_account_type, balance_type, opening_balance, is_active, created_at, updated_at)
      VALUES (:id, :clinicId, '1250', 'Employee Advances Receivable', 'asset', 'current_asset', 'debit', 0, true, NOW(), NOW())
    `, { replacements: { id, clinicId } });
  } catch (e) { /* another request may have created it first — re-fetch either way */ }
  return AccountingService.getAccountByCode(clinicId, '1250');
}

router.get('/', authorize('hr.salary_advances.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { status, employee_id } = req.query;
    const conditions = ['sa.clinic_id = :clinicId'];
    const replacements = { clinicId };
    if (status) { conditions.push('sa.status = :status'); replacements.status = status; }
    if (employee_id) { conditions.push('sa.employee_id = :employeeId'); replacements.employeeId = employee_id; }

    const [advances] = await sequelize.query(`
      SELECT sa.*, e.first_name, e.last_name, e.employee_number
      FROM salary_advances sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY sa.created_at DESC
    `, { replacements });
    res.json(advances);
  } catch (error) {
    console.error('Error fetching salary advances:', error);
    res.status(500).json({ error: 'Failed to fetch salary advances' });
  }
});

router.get('/:id', authorize('hr.salary_advances.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[advance]] = await sequelize.query(`
      SELECT sa.*, e.first_name, e.last_name, e.employee_number
      FROM salary_advances sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.id = :id AND sa.clinic_id = :clinicId
    `, { replacements: { id: req.params.id, clinicId } });
    if (!advance) return res.status(404).json({ error: 'Salary advance not found' });

    const [repayments] = await sequelize.query(
      `SELECT * FROM salary_advance_repayments WHERE salary_advance_id = :id ORDER BY payment_date DESC, created_at DESC`,
      { replacements: { id: req.params.id } }
    );
    res.json({ ...advance, repayments });
  } catch (error) {
    console.error('Error fetching salary advance:', error);
    res.status(500).json({ error: 'Failed to fetch salary advance' });
  }
});

router.post('/', authorize('hr.salary_advances.write'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.employee_id || !(parseFloat(b.amount) > 0)) {
      return res.status(400).json({ error: 'employee_id and a positive amount are required' });
    }
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[employee]] = await sequelize.query(
      `SELECT id FROM employees WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: b.employee_id, clinicId } }
    );
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const [[seqRow]] = await sequelize.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(advance_number, '^.*-', ''), '')::int), 0) AS last
         FROM salary_advances WHERE advance_number ~ '^ADV-[0-9]+$'`
    );
    const advanceNumber = `ADV-${String((parseInt(seqRow?.last, 10) || 0) + 1).padStart(4, '0')}`;
    const id = uuidv4();
    const amount = parseFloat(b.amount);

    await sequelize.query(`
      INSERT INTO salary_advances (id, clinic_id, branch_id, employee_id, advance_number, amount, currency, reason, request_date, status, balance_remaining, created_by, notes, created_at, updated_at)
      VALUES (:id, :clinicId, :branchId, :employeeId, :advanceNumber, :amount, :currency, :reason, :requestDate, 'pending', :amount, :createdBy, :notes, NOW(), NOW())
    `, {
      replacements: {
        id, clinicId, branchId: getCreateBranchId(req), employeeId: b.employee_id, advanceNumber,
        amount, currency: b.currency || 'USD', reason: b.reason || null,
        requestDate: b.request_date || new Date().toISOString().split('T')[0],
        createdBy: req.user?.id || null, notes: b.notes || null,
      }
    });
    const [[created]] = await sequelize.query(`SELECT * FROM salary_advances WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating salary advance:', error);
    res.status(500).json({ error: 'Failed to create salary advance' });
  }
});

router.post('/:id/approve', requireApprovalPermission('salary_advance_approve'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, meta] = await sequelize.query(
      `UPDATE salary_advances SET status = 'approved', approved_by = :userId, approved_at = NOW(), updated_at = NOW()
       WHERE id = :id AND clinic_id = :clinicId AND status = 'pending'`,
      { replacements: { id: req.params.id, clinicId, userId: req.user?.id || null } }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Advance not found or not pending' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve advance' });
  }
});

router.post('/:id/cancel', authorize('hr.salary_advances.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, meta] = await sequelize.query(
      `UPDATE salary_advances SET status = 'cancelled', updated_at = NOW()
       WHERE id = :id AND clinic_id = :clinicId AND status IN ('pending', 'approved')`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Only a pending or approved advance can be cancelled' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel advance' });
  }
});

// Disbursement: the actual cash-out. Debit the Employee Advances
// Receivable account (an asset — the employee owes this back), credit the
// payment account. Mirrors the payroll/consultant-bill payment pattern.
router.post('/:id/disburse', authorize('hr.salary_advances.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { payment_account_id, account_name, disbursement_date } = req.body || {};
    if (!payment_account_id) return res.status(400).json({ error: 'payment_account_id is required' });

    const [[advance]] = await sequelize.query(`
      SELECT sa.*, e.first_name, e.last_name, e.employee_number FROM salary_advances sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.id = :id AND sa.clinic_id = :clinicId
    `, { replacements: { id: req.params.id, clinicId } });
    if (!advance) return res.status(404).json({ error: 'Salary advance not found' });
    if (advance.status !== 'approved') return res.status(409).json({ error: 'Only an approved advance can be disbursed' });

    const advancesAccount = await ensureAdvancesAccount(clinicId);
    if (!advancesAccount) return res.status(500).json({ error: 'Could not find or create the Employee Advances Receivable account' });

    const payDate = disbursement_date || new Date().toISOString().split('T')[0];
    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'USD';
    const advanceCurrency = advance.currency || baseCurrency;
    let rate = 1;
    if (advanceCurrency !== baseCurrency) {
      try { rate = await AccountingService.getExchangeRate(clinicId, advanceCurrency, baseCurrency, payDate) || 1; }
      catch (e) { rate = 1; }
    }
    const baseAmount = AccountingService.convertAmount(parseFloat(advance.amount) || 0, rate);
    const employeeLabel = `${advance.first_name} ${advance.last_name} (${advance.employee_number})`;

    const glEntry = await AccountingService.createGLEntry({
      clinic_id: clinicId,
      transaction_date: payDate,
      transaction_type: 'salary_advance_disbursement',
      description: `Salary advance ${advance.advance_number} disbursed to ${employeeLabel}`,
      reference_id: advance.id,
      reference_module: 'salary_advance',
    }, [
      { account_id: advancesAccount.id, debit_amount: baseAmount, credit_amount: 0, description: `Salary advance ${advance.advance_number} — ${employeeLabel}` },
      { account_id: String(payment_account_id), debit_amount: 0, credit_amount: baseAmount, description: `Disbursed via ${account_name || 'cash/bank'} (${advanceCurrency} ${advance.amount} @ ${rate})` },
    ], req.user?.id);
    await AccountingService.postGLEntry(glEntry.id, req.user?.id);

    await sequelize.query(`
      UPDATE salary_advances SET status = 'disbursed', payment_account_id = :accountId, exchange_rate = :rate,
        base_currency_amount = :baseAmount, disbursement_gl_entry_id = :glId, disbursed_by = :userId, disbursed_at = NOW(), updated_at = NOW()
      WHERE id = :id
    `, {
      replacements: { id: advance.id, accountId: String(payment_account_id), rate, baseAmount, glId: glEntry.id, userId: req.user?.id || null }
    });

    res.json({ success: true, gl_entry_id: glEntry.id, gl_number: glEntry.gl_number });
  } catch (error) {
    console.error('Error disbursing salary advance:', error);
    res.status(500).json({ error: error.message || 'Failed to disburse advance' });
  }
});

// A repayment: cash coming back in. Debit the payment account, credit the
// Employee Advances Receivable account (reducing what's owed). Can be
// partial — repeat until balance_remaining hits 0, which marks it repaid.
router.post('/:id/repay', authorize('hr.salary_advances.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { amount, payment_account_id, account_name, payment_date, notes } = req.body || {};
    const repayAmount = parseFloat(amount);
    if (!(repayAmount > 0) || !payment_account_id) {
      return res.status(400).json({ error: 'A positive amount and payment_account_id are required' });
    }

    const [[advance]] = await sequelize.query(`
      SELECT sa.*, e.first_name, e.last_name, e.employee_number FROM salary_advances sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.id = :id AND sa.clinic_id = :clinicId
    `, { replacements: { id: req.params.id, clinicId } });
    if (!advance) return res.status(404).json({ error: 'Salary advance not found' });
    if (!['disbursed', 'repaying'].includes(advance.status)) {
      return res.status(409).json({ error: 'Only a disbursed advance can be repaid' });
    }
    const balance = parseFloat(advance.balance_remaining);
    if (repayAmount > balance + 0.01) {
      return res.status(400).json({ error: `Amount exceeds the outstanding balance of ${advance.currency} ${balance.toFixed(2)}` });
    }

    const advancesAccount = await ensureAdvancesAccount(clinicId);
    const payDate = payment_date || new Date().toISOString().split('T')[0];
    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'USD';
    const advanceCurrency = advance.currency || baseCurrency;
    let rate = 1;
    if (advanceCurrency !== baseCurrency) {
      try { rate = await AccountingService.getExchangeRate(clinicId, advanceCurrency, baseCurrency, payDate) || 1; }
      catch (e) { rate = 1; }
    }
    const baseAmount = AccountingService.convertAmount(repayAmount, rate);
    const employeeLabel = `${advance.first_name} ${advance.last_name} (${advance.employee_number})`;

    let glEntry = null;
    if (advancesAccount) {
      glEntry = await AccountingService.createGLEntry({
        clinic_id: clinicId,
        transaction_date: payDate,
        transaction_type: 'salary_advance_repayment',
        description: `Salary advance ${advance.advance_number} repayment — ${employeeLabel}`,
        reference_id: advance.id,
        reference_module: 'salary_advance',
      }, [
        { account_id: String(payment_account_id), debit_amount: baseAmount, credit_amount: 0, description: `Repayment via ${account_name || 'cash/bank'} (${advanceCurrency} ${repayAmount} @ ${rate})` },
        { account_id: advancesAccount.id, debit_amount: 0, credit_amount: baseAmount, description: `Salary advance ${advance.advance_number} repayment — ${employeeLabel}` },
      ], req.user?.id);
      await AccountingService.postGLEntry(glEntry.id, req.user?.id);
    }

    const repaymentId = uuidv4();
    await sequelize.query(`
      INSERT INTO salary_advance_repayments (id, salary_advance_id, amount, payment_date, payment_account_id, gl_entry_id, recorded_by, notes, created_at)
      VALUES (:id, :advanceId, :amount, :paymentDate, :accountId, :glId, :userId, :notes, NOW())
    `, {
      replacements: {
        id: repaymentId, advanceId: advance.id, amount: repayAmount, paymentDate: payDate,
        accountId: String(payment_account_id), glId: glEntry?.id || null, userId: req.user?.id || null, notes: notes || null,
      }
    });

    const newBalance = Math.round((balance - repayAmount) * 100) / 100;
    const newStatus = newBalance <= 0.01 ? 'repaid' : 'repaying';
    await sequelize.query(
      `UPDATE salary_advances SET balance_remaining = :balance, status = :status, updated_at = NOW() WHERE id = :id`,
      { replacements: { id: advance.id, balance: Math.max(newBalance, 0), status: newStatus } }
    );

    res.json({ success: true, balance_remaining: Math.max(newBalance, 0), status: newStatus, gl_entry_id: glEntry?.id || null });
  } catch (error) {
    console.error('Error recording advance repayment:', error);
    res.status(500).json({ error: error.message || 'Failed to record repayment' });
  }
});

module.exports = router;
