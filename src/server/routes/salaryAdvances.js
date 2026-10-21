const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize, getRolePrivileges } = require('../middleware/authorize');
const { requireApprovalPermission } = require('../middleware/requireApprovalPermission');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const AccountingService = require('../services/AccountingService');
const { getWorkflowSettings } = require('../config/ensureHrWorkflowSettings');
const { resolveApprover, isApproverFor } = require('../utils/approverResolution');
const { notifyUser, notifyRole } = require('../services/notificationService');
const { notifyEmployee } = require('../utils/portalNotify');

// Inline privilege check (not route middleware) — the Finance/Accounts
// payout step is only gated by advance.mark_paid when
// hr_workflow_settings.advance_require_finance is on, a per-request DB
// read that route-level authorize() can't branch on. Same admin-bypass +
// role-union logic as authorize.js itself.
async function hasPrivilege(req, key) {
  if (req.user?.role === 'admin') return true;
  const roles = [req.user.role, ...(req.user.additionalRoles || [])];
  const grants = await getRolePrivileges(req.models?.sequelize || sequelize, req.tenantSchema);
  return roles.some((r) => grants.get(r)?.has(key));
}

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
    if (req.user?.role !== 'admin') {
      const branchId = req.branchContext?.branchId || req.user?.branchId;
      if (branchId) { conditions.push('sa.branch_id = :branchId'); replacements.branchId = branchId; }
    }

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
    const replacements = { id: req.params.id, clinicId };
    let branchSQL = '';
    if (req.user?.role !== 'admin') {
      const branchId = req.branchContext?.branchId || req.user?.branchId;
      if (branchId) { branchSQL = ' AND sa.branch_id = :branchId'; replacements.branchId = branchId; }
    }
    const [[advance]] = await sequelize.query(`
      SELECT sa.*, e.first_name, e.last_name, e.employee_number
      FROM salary_advances sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.id = :id AND sa.clinic_id = :clinicId${branchSQL}
    `, { replacements });
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
      `SELECT id, department, first_name, last_name, basic_salary, hire_date FROM employees WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: b.employee_id, clinicId } }
    );
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const amountRequested = parseFloat(b.amount);
    const settings = await getWorkflowSettings(sequelize, clinicId);

    const maxAllowed = (parseFloat(employee.basic_salary) || 0) * (parseFloat(settings.advance_max_percent_of_salary) / 100);
    if (maxAllowed > 0 && amountRequested > maxAllowed + 0.01) {
      return res.status(400).json({ error: `This advance exceeds the limit of ${settings.advance_max_percent_of_salary}% of basic salary (max ${maxAllowed.toFixed(2)}).` });
    }

    const [[openRow]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM salary_advances WHERE employee_id = :employeeId AND status IN ('pending', 'approved_by_hod', 'approved', 'disbursed', 'repaying')`,
      { replacements: { employeeId: b.employee_id } }
    );
    if (parseInt(openRow.cnt, 10) >= settings.advance_max_open_advances) {
      return res.status(400).json({ error: `This employee already has ${openRow.cnt} open advance(s), the maximum allowed is ${settings.advance_max_open_advances}.` });
    }

    if (settings.advance_min_months_of_service > 0) {
      if (!employee.hire_date) {
        return res.status(400).json({ error: `A minimum of ${settings.advance_min_months_of_service} month(s) of service is required and this employee has no hire date on record.` });
      }
      const monthsOfService = (Date.now() - new Date(employee.hire_date).getTime()) / (30.44 * 24 * 60 * 60 * 1000);
      if (monthsOfService < settings.advance_min_months_of_service) {
        return res.status(400).json({ error: `A minimum of ${settings.advance_min_months_of_service} month(s) of service is required (this employee has ${Math.floor(monthsOfService)}).` });
      }
    }
    if (b.repayment_months !== undefined && Number(b.repayment_months) > settings.advance_max_repayment_months) {
      return res.status(400).json({ error: `Repayment period cannot exceed ${settings.advance_max_repayment_months} months.` });
    }

    const [[seqRow]] = await sequelize.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(advance_number, '^.*-', ''), '')::int), 0) AS last
         FROM salary_advances WHERE advance_number ~ '^ADV-[0-9]+$'`
    );
    const advanceNumber = `ADV-${String((parseInt(seqRow?.last, 10) || 0) + 1).padStart(4, '0')}`;
    const id = uuidv4();
    const amount = amountRequested;

    await sequelize.query(`
      INSERT INTO salary_advances (id, clinic_id, branch_id, employee_id, advance_number, amount, currency, reason, request_date, status, balance_remaining, repayment_months, created_by, notes, created_at, updated_at)
      VALUES (:id, :clinicId, :branchId, :employeeId, :advanceNumber, :amount, :currency, :reason, :requestDate, 'pending', :amount, :repaymentMonths, :createdBy, :notes, NOW(), NOW())
    `, {
      replacements: {
        id, clinicId, branchId: getCreateBranchId(req), employeeId: b.employee_id, advanceNumber,
        amount, currency: b.currency || 'USD', reason: b.reason || null,
        requestDate: b.request_date || new Date().toISOString().split('T')[0],
        repaymentMonths: b.repayment_months ? parseInt(b.repayment_months, 10) : null,
        createdBy: req.user?.id || null, notes: b.notes || null,
      }
    });
    const [[created]] = await sequelize.query(`SELECT * FROM salary_advances WHERE id = :id`, { replacements: { id } });

    const employeeLabel = `${employee.first_name} ${employee.last_name}`;
    let notifiedApprover = false;
    if (settings.advance_require_hod) {
      const approver = await resolveApprover(sequelize, { clinicId, employeeId: b.employee_id, department: employee.department });
      if (approver?.approverUserId) {
        await notifyUser(sequelize, { clinic_id: clinicId, user_id: approver.approverUserId, type: 'advance_request_awaiting_hod', title: 'Salary advance awaiting your approval', message: `${employeeLabel} requested an advance of ${b.currency || 'USD'} ${amount}.`, entity_type: 'salary_advance', entity_id: id, link: '/hr/salary-advances' });
        notifiedApprover = true;
      }
      if (approver?.approverEmployeeId) {
        await notifyEmployee(sequelize, { clinic_id: clinicId, employee_id: approver.approverEmployeeId, type: 'advance_request_awaiting_hod', title: 'Salary advance awaiting your approval', message: `${employeeLabel} requested an advance of ${b.currency || 'USD'} ${amount}.`, entity_type: 'salary_advance', entity_id: id });
        notifiedApprover = true;
      }
    }
    if (!notifiedApprover) {
      await notifyRole(sequelize, { clinic_id: clinicId, role: 'admin', branch_id: getCreateBranchId(req), type: 'advance_request_awaiting_hr', title: 'Salary advance awaiting approval', message: `${employeeLabel} requested an advance of ${b.currency || 'USD'} ${amount}.`, entity_type: 'salary_advance', entity_id: id, link: '/hr/salary-advances' });
    }

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating salary advance:', error);
    res.status(500).json({ error: 'Failed to create salary advance' });
  }
});

// Audit finding: approve/cancel/disburse/repay below only ever scoped by
// clinic_id, unlike GET /:id (above) which also restricts a non-admin to
// their own branch_id. A branch-scoped HR user could approve, cancel,
// disburse, or repay a salary advance belonging to a different branch in
// the same clinic simply by knowing/guessing its id. Mirrors GET /:id's own
// inline branch-scoping.
function nonAdminBranchId(req) {
  if (req.user?.role === 'admin') return null;
  return req.branchContext?.branchId || req.user?.branchId || null;
}

async function loadAdvanceForApproval(req, clinicId) {
  const replacements = { id: req.params.id, clinicId };
  const branchId = nonAdminBranchId(req);
  let branchSQL = '';
  if (branchId) { branchSQL = ' AND branch_id = :branchId'; replacements.branchId = branchId; }
  const [[advance]] = await sequelize.query(`SELECT * FROM salary_advances WHERE id = :id AND clinic_id = :clinicId${branchSQL}`, { replacements });
  return advance || null;
}

router.post('/:id/approve-hod', authorize('hr.salary_advances.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const advance = await loadAdvanceForApproval(req, clinicId);
    if (!advance) return res.status(404).json({ error: 'Salary advance not found' });
    if (advance.status !== 'pending') return res.status(409).json({ error: 'Only a pending advance can be approved by the HOD' });

    const [[employee]] = await sequelize.query(`SELECT department, first_name, last_name FROM employees WHERE id = :id`, { replacements: { id: advance.employee_id } });
    const authorized = req.user?.role === 'admin' || await isApproverFor(sequelize, { clinicId, employeeId: advance.employee_id, department: employee?.department, actingUserId: req.user?.id });
    if (!authorized) return res.status(403).json({ error: 'You are not this employee\'s approver.' });

    await sequelize.query(
      `UPDATE salary_advances SET status = 'approved_by_hod', hod_approved_by = :userId, hod_approved_at = NOW(), updated_at = NOW() WHERE id = :id`,
      { replacements: { id: advance.id, userId: req.user.id } }
    );
    await notifyRole(sequelize, { clinic_id: clinicId, role: 'admin', type: 'advance_request_awaiting_hr', title: 'Salary advance awaiting HR approval', message: `${employee?.first_name} ${employee?.last_name}'s advance was approved by their HOD.`, entity_type: 'salary_advance', entity_id: advance.id, link: '/hr/salary-advances' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error approving advance (HOD):', error);
    res.status(500).json({ error: 'Failed to approve advance' });
  }
});

router.post('/:id/reject-hod', authorize('hr.salary_advances.read'), async (req, res) => {
  try {
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'A reason is required to reject an advance.' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const advance = await loadAdvanceForApproval(req, clinicId);
    if (!advance) return res.status(404).json({ error: 'Salary advance not found' });
    if (advance.status !== 'pending') return res.status(409).json({ error: 'Only a pending advance can be rejected by the HOD' });

    const [[employee]] = await sequelize.query(`SELECT department, user_id FROM employees WHERE id = :id`, { replacements: { id: advance.employee_id } });
    const authorized = req.user?.role === 'admin' || await isApproverFor(sequelize, { clinicId, employeeId: advance.employee_id, department: employee?.department, actingUserId: req.user?.id });
    if (!authorized) return res.status(403).json({ error: 'You are not this employee\'s approver.' });

    await sequelize.query(
      `UPDATE salary_advances SET status = 'cancelled', hod_approved_by = :userId, hod_rejected_reason = :reason, updated_at = NOW() WHERE id = :id`,
      { replacements: { id: advance.id, userId: req.user.id, reason } }
    );
    if (employee?.user_id) {
      await notifyUser(sequelize, { clinic_id: clinicId, user_id: employee.user_id, type: 'advance_request_rejected', title: 'Your salary advance request was rejected', message: reason, entity_type: 'salary_advance', entity_id: advance.id });
    }
    await notifyEmployee(sequelize, { clinic_id: clinicId, employee_id: advance.employee_id, type: 'advance_request_rejected', title: 'Your salary advance request was rejected', message: reason, entity_type: 'salary_advance', entity_id: advance.id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error rejecting advance (HOD):', error);
    res.status(500).json({ error: 'Failed to reject advance' });
  }
});

router.post('/:id/approve', requireApprovalPermission('salary_advance_approve'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const settings = await getWorkflowSettings(sequelize, clinicId);
    const requiredStatus = settings.advance_require_hod ? 'approved_by_hod' : 'pending';
    const conditions = ['id = :id', 'clinic_id = :clinicId', 'status = :requiredStatus'];
    const replacements = { id: req.params.id, clinicId, userId: req.user?.id || null, requiredStatus };
    const branchId = nonAdminBranchId(req);
    if (branchId) { conditions.push('branch_id = :branchId'); replacements.branchId = branchId; }
    const [, meta] = await sequelize.query(
      `UPDATE salary_advances SET status = 'approved', approved_by = :userId, approved_at = NOW(), updated_at = NOW()
       WHERE ${conditions.join(' AND ')}`,
      { replacements }
    );
    if (meta.rowCount === 0) {
      return res.status(409).json({ error: settings.advance_require_hod ? 'Advance not found, or still awaiting HOD approval' : 'Advance not found or not pending' });
    }
    const [[advance]] = await sequelize.query(`SELECT employee_id FROM salary_advances WHERE id = :id`, { replacements: { id: req.params.id } });
    const [[employee]] = await sequelize.query(`SELECT user_id FROM employees WHERE id = :id`, { replacements: { id: advance.employee_id } });
    if (employee?.user_id) {
      await notifyUser(sequelize, { clinic_id: clinicId, user_id: employee.user_id, type: 'advance_request_approved', title: 'Your salary advance was approved', entity_type: 'salary_advance', entity_id: req.params.id });
    }
    await notifyEmployee(sequelize, { clinic_id: clinicId, employee_id: advance.employee_id, type: 'advance_request_approved', title: 'Your salary advance was approved', entity_type: 'salary_advance', entity_id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve advance' });
  }
});

router.post('/:id/cancel', authorize('hr.salary_advances.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['id = :id', 'clinic_id = :clinicId', "status IN ('pending', 'approved_by_hod', 'approved')"];
    const replacements = { id: req.params.id, clinicId };
    const branchId = nonAdminBranchId(req);
    if (branchId) { conditions.push('branch_id = :branchId'); replacements.branchId = branchId; }
    const [, meta] = await sequelize.query(
      `UPDATE salary_advances SET status = 'cancelled', updated_at = NOW()
       WHERE ${conditions.join(' AND ')}`,
      { replacements }
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

    const settings = await getWorkflowSettings(sequelize, clinicId);
    if (settings.advance_require_finance && !(await hasPrivilege(req, 'advance.mark_paid'))) {
      return res.status(403).json({ error: 'This clinic requires Finance/Accounts sign-off before an advance can be paid out.' });
    }

    const disburseReplacements = { id: req.params.id, clinicId };
    let disburseBranchSQL = '';
    const disburseBranchId = nonAdminBranchId(req);
    if (disburseBranchId) { disburseBranchSQL = ' AND sa.branch_id = :branchId'; disburseReplacements.branchId = disburseBranchId; }
    const [[advance]] = await sequelize.query(`
      SELECT sa.*, e.first_name, e.last_name, e.employee_number FROM salary_advances sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.id = :id AND sa.clinic_id = :clinicId${disburseBranchSQL}
    `, { replacements: disburseReplacements });
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

    const [[payoutEmployee]] = await sequelize.query(`SELECT user_id FROM employees WHERE id = :id`, { replacements: { id: advance.employee_id } });
    if (payoutEmployee?.user_id) {
      await notifyUser(sequelize, { clinic_id: clinicId, user_id: payoutEmployee.user_id, type: 'advance_paid', title: 'Your salary advance has been paid out', entity_type: 'salary_advance', entity_id: advance.id });
    }
    await notifyEmployee(sequelize, { clinic_id: clinicId, employee_id: advance.employee_id, type: 'advance_paid', title: 'Your salary advance has been paid out', entity_type: 'salary_advance', entity_id: advance.id });

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

    const repayReplacements = { id: req.params.id, clinicId };
    let repayBranchSQL = '';
    const repayBranchId = nonAdminBranchId(req);
    if (repayBranchId) { repayBranchSQL = ' AND sa.branch_id = :branchId'; repayReplacements.branchId = repayBranchId; }
    const [[advance]] = await sequelize.query(`
      SELECT sa.*, e.first_name, e.last_name, e.employee_number FROM salary_advances sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.id = :id AND sa.clinic_id = :clinicId${repayBranchSQL}
    `, { replacements: repayReplacements });
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
