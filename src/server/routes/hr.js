const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const AccountingService = require('../services/AccountingService');

// Non-admin users only see rows from their own branch; admins see everything
// clinic-wide. Written inline with named replacements (not
// branchFilter.js's getBranchConditionSQL, which uses positional `?`
// placeholders that can't mix with the named :params the rest of this file
// uses in the same query).
function branchScope(req, replacements) {
  if (req.user?.role === 'admin') return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  return ' AND branch_id = :branchId';
}

// ═══════════════════════════════════════════════════
// EMPLOYEES
// ═══════════════════════════════════════════════════

router.get('/employees', authorize('hr.employees.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { employment_type, search, status } = req.query;
    const conditions = ['clinic_id = :clinicId'];
    const replacements = { clinicId };
    if (employment_type) { conditions.push('employment_type = :employmentType'); replacements.employmentType = employment_type; }
    if (status) { conditions.push('employment_status = :status'); replacements.status = status; }
    if (search) {
      conditions.push('(first_name ILIKE :search OR last_name ILIKE :search OR employee_number ILIKE :search OR job_title ILIKE :search)');
      replacements.search = `%${search}%`;
    }
    const where = conditions.join(' AND ') + branchScope(req, replacements);

    const [employees] = await sequelize.query(
      `SELECT * FROM employees WHERE ${where} ORDER BY first_name ASC, last_name ASC`,
      { replacements }
    );
    res.json(employees);
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

router.get('/employees/:id', authorize('hr.employees.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[employee]] = await sequelize.query(
      `SELECT * FROM employees WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const [components] = await sequelize.query(
      `SELECT * FROM employee_salary_components WHERE employee_id = :id AND is_active = true ORDER BY component_type, name`,
      { replacements: { id: req.params.id } }
    );

    const [payrollHistory] = await sequelize.query(`
      SELECT prl.id, prl.gross_pay, prl.net_pay, prl.currency, prl.created_at,
        pr.run_number, pr.period_month, pr.period_year, pr.status
      FROM payroll_run_lines prl
      JOIN payroll_runs pr ON pr.id = prl.payroll_run_id
      WHERE prl.employee_id = :id
      ORDER BY pr.period_year DESC, pr.period_month DESC
      LIMIT 24
    `, { replacements: { id: req.params.id } });

    res.json({ ...employee, salary_components: components, payroll_history: payrollHistory });
  } catch (error) {
    console.error('Error fetching employee:', error);
    res.status(500).json({ error: 'Failed to fetch employee' });
  }
});

router.post('/employees', authorize('hr.employees.write'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.first_name?.trim() || !b.last_name?.trim()) {
      return res.status(400).json({ error: 'First and last name are required' });
    }
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();

    // Next employee number, same MAX-based approach as PO numbers in
    // procurement.js (COUNT(*) assumes no gaps and races two concurrent
    // creates onto the same number; MAX+1 doesn't).
    const [[seqRow]] = await sequelize.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number, '^.*-', ''), '')::int), 0) AS last
         FROM employees WHERE employee_number ~ '^EMP-[0-9]+$'`
    );
    const employeeNumber = `EMP-${String((parseInt(seqRow?.last, 10) || 0) + 1).padStart(4, '0')}`;

    await sequelize.query(`
      INSERT INTO employees (
        id, clinic_id, branch_id, user_id, employee_number, employment_type,
        first_name, last_name, gender, date_of_birth, national_id, phone, email, address,
        job_title, department, hire_date, termination_date, employment_status, contract_type,
        bank_name, bank_account_name, bank_account_number,
        emergency_contact_name, emergency_contact_phone,
        basic_salary, salary_currency, pay_frequency, notes, is_active, created_at, updated_at
      ) VALUES (
        :id, :clinicId, :branchId, :userId, :employeeNumber, :employmentType,
        :firstName, :lastName, :gender, :dateOfBirth, :nationalId, :phone, :email, :address,
        :jobTitle, :department, :hireDate, :terminationDate, :employmentStatus, :contractType,
        :bankName, :bankAccountName, :bankAccountNumber,
        :emergencyContactName, :emergencyContactPhone,
        :basicSalary, :salaryCurrency, :payFrequency, :notes, true, NOW(), NOW()
      )
    `, {
      replacements: {
        id, clinicId, branchId: b.branch_id || getCreateBranchId(req), userId: b.user_id || null,
        employeeNumber, employmentType: b.employment_type || 'staff',
        firstName: b.first_name.trim(), lastName: b.last_name.trim(), gender: b.gender || null,
        dateOfBirth: b.date_of_birth || null, nationalId: b.national_id || null,
        phone: b.phone || null, email: b.email || null, address: b.address || null,
        jobTitle: b.job_title || null, department: b.department || null,
        hireDate: b.hire_date || null, terminationDate: b.termination_date || null,
        employmentStatus: b.employment_status || 'active', contractType: b.contract_type || 'full_time',
        bankName: b.bank_name || null, bankAccountName: b.bank_account_name || null, bankAccountNumber: b.bank_account_number || null,
        emergencyContactName: b.emergency_contact_name || null, emergencyContactPhone: b.emergency_contact_phone || null,
        basicSalary: parseFloat(b.basic_salary) || 0, salaryCurrency: b.salary_currency || 'USD',
        payFrequency: b.pay_frequency || 'monthly', notes: b.notes || null,
      }
    });

    const [[created]] = await sequelize.query(`SELECT * FROM employees WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

router.put('/employees/:id', authorize('hr.employees.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const b = req.body || {};
    const fields = {
      user_id: b.user_id, employment_type: b.employment_type,
      first_name: b.first_name, last_name: b.last_name, gender: b.gender,
      date_of_birth: b.date_of_birth, national_id: b.national_id, phone: b.phone, email: b.email, address: b.address,
      job_title: b.job_title, department: b.department, hire_date: b.hire_date, termination_date: b.termination_date,
      employment_status: b.employment_status, contract_type: b.contract_type,
      bank_name: b.bank_name, bank_account_name: b.bank_account_name, bank_account_number: b.bank_account_number,
      emergency_contact_name: b.emergency_contact_name, emergency_contact_phone: b.emergency_contact_phone,
      basic_salary: b.basic_salary !== undefined ? parseFloat(b.basic_salary) || 0 : undefined,
      salary_currency: b.salary_currency, pay_frequency: b.pay_frequency, notes: b.notes,
      is_active: b.is_active,
    };
    const setClauses = [];
    const replacements = { id: req.params.id, clinicId };
    for (const [col, val] of Object.entries(fields)) {
      if (val === undefined) continue;
      setClauses.push(`${col} = :${col}`);
      replacements[col] = val;
    }
    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });
    setClauses.push('updated_at = NOW()');

    const [, meta] = await sequelize.query(
      `UPDATE employees SET ${setClauses.join(', ')} WHERE id = :id AND clinic_id = :clinicId`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Employee not found' });

    const [[updated]] = await sequelize.query(`SELECT * FROM employees WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// No hard delete for a record other tables (payroll_run_lines) may already
// reference — same reasoning as suppliers using on_hold instead of deletion.
router.post('/employees/:id/terminate', authorize('hr.employees.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, meta] = await sequelize.query(
      `UPDATE employees SET employment_status = 'terminated', is_active = false,
         termination_date = COALESCE(:terminationDate, CURRENT_DATE), updated_at = NOW()
       WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId, terminationDate: req.body?.termination_date || null } }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error terminating employee:', error);
    res.status(500).json({ error: 'Failed to terminate employee' });
  }
});

router.post('/employees/:id/reactivate', authorize('hr.employees.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, meta] = await sequelize.query(
      `UPDATE employees SET employment_status = 'active', is_active = true, termination_date = NULL, updated_at = NOW()
       WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error reactivating employee:', error);
    res.status(500).json({ error: 'Failed to reactivate employee' });
  }
});

// ═══════════════════════════════════════════════════
// SALARY COMPONENTS (allowances / deductions)
// ═══════════════════════════════════════════════════

router.get('/employees/:id/salary-components', authorize('hr.employees.read'), async (req, res) => {
  try {
    const [components] = await sequelize.query(
      `SELECT * FROM employee_salary_components WHERE employee_id = :id ORDER BY component_type, name`,
      { replacements: { id: req.params.id } }
    );
    res.json(components);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch salary components' });
  }
});

router.post('/employees/:id/salary-components', authorize('hr.employees.write'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim() || !b.component_type) {
      return res.status(400).json({ error: 'name and component_type are required' });
    }
    if (!['allowance', 'deduction'].includes(b.component_type)) {
      return res.status(400).json({ error: "component_type must be 'allowance' or 'deduction'" });
    }
    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO employee_salary_components (id, employee_id, component_type, name, amount, is_percentage, account_code, is_active, created_at, updated_at)
      VALUES (:id, :employeeId, :componentType, :name, :amount, :isPercentage, :accountCode, true, NOW(), NOW())
    `, {
      replacements: {
        id, employeeId: req.params.id, componentType: b.component_type, name: b.name.trim(),
        amount: parseFloat(b.amount) || 0, isPercentage: !!b.is_percentage, accountCode: b.account_code || null,
      }
    });
    const [[created]] = await sequelize.query(`SELECT * FROM employee_salary_components WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating salary component:', error);
    res.status(500).json({ error: 'Failed to create salary component' });
  }
});

router.delete('/salary-components/:id', authorize('hr.employees.write'), async (req, res) => {
  try {
    const [, meta] = await sequelize.query(
      `UPDATE employee_salary_components SET is_active = false, updated_at = NOW() WHERE id = :id`,
      { replacements: { id: req.params.id } }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Component not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove salary component' });
  }
});

// ═══════════════════════════════════════════════════
// PAYROLL RUNS
// ═══════════════════════════════════════════════════

router.get('/payroll/runs', authorize('hr.payroll.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [runs] = await sequelize.query(`
      SELECT pr.*, coa.account_name AS payment_account_name,
        (SELECT COUNT(*) FROM payroll_run_lines l WHERE l.payroll_run_id = pr.id) AS employee_count
      FROM payroll_runs pr
      LEFT JOIN chart_of_accounts coa ON coa.id = pr.payment_account_id
      WHERE pr.clinic_id = :clinicId
      ORDER BY pr.period_year DESC, pr.period_month DESC, pr.created_at DESC
    `, { replacements: { clinicId } });
    res.json(runs);
  } catch (error) {
    console.error('Error fetching payroll runs:', error);
    res.status(500).json({ error: 'Failed to fetch payroll runs' });
  }
});

router.get('/payroll/runs/:id', authorize('hr.payroll.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[run]] = await sequelize.query(
      `SELECT pr.*, coa.account_name AS payment_account_name FROM payroll_runs pr
       LEFT JOIN chart_of_accounts coa ON coa.id = pr.payment_account_id
       WHERE pr.id = :id AND pr.clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });

    const [lines] = await sequelize.query(`
      SELECT prl.*, e.employee_number, e.first_name, e.last_name, e.employment_type, e.job_title
      FROM payroll_run_lines prl
      JOIN employees e ON e.id = prl.employee_id
      WHERE prl.payroll_run_id = :id
      ORDER BY e.first_name, e.last_name
    `, { replacements: { id: req.params.id } });

    const lineIds = lines.map(l => l.id);
    let components = [];
    if (lineIds.length > 0) {
      const [rows] = await sequelize.query(
        `SELECT * FROM payroll_run_line_components WHERE payroll_run_line_id IN (:lineIds)`,
        { replacements: { lineIds } }
      );
      components = rows;
    }
    const componentsByLine = {};
    for (const c of components) {
      (componentsByLine[c.payroll_run_line_id] ||= []).push(c);
    }
    const linesWithComponents = lines.map(l => ({ ...l, components: componentsByLine[l.id] || [] }));

    res.json({ ...run, lines: linesWithComponents });
  } catch (error) {
    console.error('Error fetching payroll run:', error);
    res.status(500).json({ error: 'Failed to fetch payroll run' });
  }
});

// Creates a draft run and snapshots every active employee's current salary +
// components into payroll_run_lines/payroll_run_line_components. Snapshotted
// deliberately — editing an employee's standing salary later must never
// silently change what a past (or in-progress) payroll run already recorded.
router.post('/payroll/runs', authorize('hr.payroll.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { period_month, period_year, employee_ids, payment_account_id, notes } = req.body || {};
    if (!period_month || !period_year) {
      await t.rollback();
      return res.status(400).json({ error: 'period_month and period_year are required' });
    }
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    const [[existing]] = await sequelize.query(
      `SELECT id FROM payroll_runs WHERE clinic_id = :clinicId AND period_month = :periodMonth AND period_year = :periodYear AND status != 'cancelled'`,
      { replacements: { clinicId, periodMonth: period_month, periodYear: period_year }, transaction: t }
    );
    if (existing) {
      await t.rollback();
      return res.status(409).json({ error: `A payroll run for ${period_month}/${period_year} already exists` });
    }

    const employeeCondition = Array.isArray(employee_ids) && employee_ids.length > 0
      ? 'AND id IN (:employeeIds)' : '';
    const [employees] = await sequelize.query(
      `SELECT * FROM employees WHERE clinic_id = :clinicId AND employment_status = 'active' AND is_active = true ${employeeCondition}`,
      { replacements: { clinicId, employeeIds: employee_ids || [] }, transaction: t }
    );
    if (employees.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'No active employees to run payroll for' });
    }

    const [[seqRow]] = await sequelize.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(run_number, '^.*-', ''), '')::int), 0) AS last
         FROM payroll_runs WHERE run_number ~ '^PR-[0-9]+$'`,
      { transaction: t }
    );
    const runNumber = `PR-${String((parseInt(seqRow?.last, 10) || 0) + 1).padStart(4, '0')}`;
    const runId = uuidv4();

    await sequelize.query(`
      INSERT INTO payroll_runs (id, clinic_id, branch_id, run_number, period_month, period_year, run_date, status, payment_account_id, created_by, notes, created_at, updated_at)
      VALUES (:id, :clinicId, :branchId, :runNumber, :periodMonth, :periodYear, CURRENT_DATE, 'draft', :paymentAccountId, :createdBy, :notes, NOW(), NOW())
    `, {
      replacements: {
        id: runId, clinicId, branchId: getCreateBranchId(req), runNumber,
        periodMonth: period_month, periodYear: period_year,
        paymentAccountId: payment_account_id || null, createdBy: req.user?.id || null, notes: notes || null,
      },
      transaction: t,
    });

    for (const emp of employees) {
      const [components] = await sequelize.query(
        `SELECT * FROM employee_salary_components WHERE employee_id = :id AND is_active = true`,
        { replacements: { id: emp.id }, transaction: t }
      );
      const basic = parseFloat(emp.basic_salary) || 0;
      const calcAmount = (c) => (c.is_percentage ? basic * (parseFloat(c.amount) || 0) / 100 : parseFloat(c.amount) || 0);
      const allowances = components.filter(c => c.component_type === 'allowance');
      const deductions = components.filter(c => c.component_type === 'deduction');
      const allowancesTotal = allowances.reduce((s, c) => s + calcAmount(c), 0);
      const deductionsTotal = deductions.reduce((s, c) => s + calcAmount(c), 0);
      const grossPay = basic + allowancesTotal;
      const netPay = grossPay - deductionsTotal;

      const lineId = uuidv4();
      await sequelize.query(`
        INSERT INTO payroll_run_lines (id, payroll_run_id, employee_id, basic_salary, allowances_total, deductions_total, gross_pay, net_pay, currency, exchange_rate, base_currency_net, created_at, updated_at)
        VALUES (:id, :runId, :employeeId, :basic, :allowancesTotal, :deductionsTotal, :grossPay, :netPay, :currency, 1, :netPay, NOW(), NOW())
      `, {
        replacements: {
          id: lineId, runId, employeeId: emp.id, basic, allowancesTotal, deductionsTotal, grossPay, netPay,
          currency: emp.salary_currency || 'USD',
        },
        transaction: t,
      });

      for (const c of [...allowances, ...deductions]) {
        await sequelize.query(`
          INSERT INTO payroll_run_line_components (id, payroll_run_line_id, component_type, name, amount, account_code, created_at)
          VALUES (:id, :lineId, :type, :name, :amount, :accountCode, NOW())
        `, {
          replacements: { id: uuidv4(), lineId, type: c.component_type, name: c.name, amount: calcAmount(c), accountCode: c.account_code || null },
          transaction: t,
        });
      }
    }

    await t.commit();
    const [[created]] = await sequelize.query(`SELECT * FROM payroll_runs WHERE id = :id`, { replacements: { id: runId } });
    res.status(201).json(created);
  } catch (error) {
    await t.rollback();
    console.error('Error creating payroll run:', error);
    res.status(500).json({ error: 'Failed to create payroll run' });
  }
});

// Only while still a draft — payment_account_id and notes are the two fields
// worth changing before approval locks everything else in place.
router.put('/payroll/runs/:id', authorize('hr.payroll.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const b = req.body || {};
    const fields = { payment_account_id: b.payment_account_id, notes: b.notes };
    const setClauses = [];
    const replacements = { id: req.params.id, clinicId };
    for (const [col, val] of Object.entries(fields)) {
      if (val === undefined) continue;
      setClauses.push(`${col} = :${col}`);
      replacements[col] = val;
    }
    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });
    setClauses.push('updated_at = NOW()');

    const [, meta] = await sequelize.query(
      `UPDATE payroll_runs SET ${setClauses.join(', ')} WHERE id = :id AND clinic_id = :clinicId AND status = 'draft'`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Run not found or no longer a draft' });
    const [[updated]] = await sequelize.query(`SELECT * FROM payroll_runs WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating payroll run:', error);
    res.status(500).json({ error: 'Failed to update payroll run' });
  }
});

router.post('/payroll/runs/:id/approve', authorize('hr.payroll.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, meta] = await sequelize.query(
      `UPDATE payroll_runs SET status = 'approved', approved_by = :userId, approved_at = NOW(), updated_at = NOW()
       WHERE id = :id AND clinic_id = :clinicId AND status = 'draft'`,
      { replacements: { id: req.params.id, clinicId, userId: req.user?.id || null } }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Run not found or not in draft status' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error approving payroll run:', error);
    res.status(500).json({ error: 'Failed to approve payroll run' });
  }
});

router.post('/payroll/runs/:id/cancel', authorize('hr.payroll.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, meta] = await sequelize.query(
      `UPDATE payroll_runs SET status = 'cancelled', updated_at = NOW()
       WHERE id = :id AND clinic_id = :clinicId AND status = 'draft'`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Only a draft run can be cancelled' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel payroll run' });
  }
});

// The accounting integration: posts one balanced GL entry for the whole run.
// Per employee — debit gross pay to Salaries & Wages (5100, staff) or Doctor
// Fees (5110, consultant); credit each deduction to its mapped account
// (default 2200 Payroll Liabilities); credit the run's payment account for
// net pay. Mirrors POST /supplier-bill-payment in daily-expenses.js — the
// established "pay something real, post it to the GL" pattern in this app.
router.post('/payroll/runs/:id/pay', authorize('hr.payroll.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[run]] = await sequelize.query(
      `SELECT * FROM payroll_runs WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status !== 'approved') return res.status(409).json({ error: 'Only an approved run can be paid' });
    if (!run.payment_account_id) return res.status(400).json({ error: 'This run has no payment account set' });

    const [lines] = await sequelize.query(`
      SELECT prl.*, e.employment_type, e.first_name, e.last_name, e.employee_number
      FROM payroll_run_lines prl JOIN employees e ON e.id = prl.employee_id
      WHERE prl.payroll_run_id = :id
    `, { replacements: { id: req.params.id } });
    if (lines.length === 0) return res.status(400).json({ error: 'This run has no lines to pay' });

    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = TRUE LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'USD';

    const [salariesAccount, doctorFeesAccount, payrollLiabilitiesAccount] = await Promise.all([
      AccountingService.getAccountByCode(clinicId, '5100'),
      AccountingService.getAccountByCode(clinicId, '5110'),
      AccountingService.getAccountByCode(clinicId, '2200'),
    ]);
    if (!salariesAccount || !doctorFeesAccount || !payrollLiabilitiesAccount) {
      return res.status(500).json({ error: 'Payroll accounts (5100/5110/2200) are missing from the Chart of Accounts' });
    }

    const lineItems = [];
    const lineUpdates = [];
    for (const line of lines) {
      const cur = line.currency || baseCurrency;
      let rate = 1;
      if (cur !== baseCurrency) {
        try { rate = await AccountingService.getExchangeRate(clinicId, cur, baseCurrency, run.run_date) || 1; }
        catch (e) { rate = 1; }
      }
      const conv = (amt) => AccountingService.convertAmount(parseFloat(amt) || 0, rate);
      const baseGross = conv(line.gross_pay);
      const baseNet = conv(line.net_pay);
      const employeeLabel = `${line.first_name} ${line.last_name} (${line.employee_number})`;

      const expenseAccount = line.employment_type === 'consultant' ? doctorFeesAccount : salariesAccount;
      lineItems.push({ account_id: expenseAccount.id, debit_amount: baseGross, credit_amount: 0, description: `Payroll ${run.run_number} — ${employeeLabel} gross pay` });

      const [components] = await sequelize.query(
        `SELECT * FROM payroll_run_line_components WHERE payroll_run_line_id = :id AND component_type = 'deduction'`,
        { replacements: { id: line.id } }
      );
      for (const d of components) {
        const baseDeduction = conv(d.amount);
        if (baseDeduction <= 0) continue;
        let deductionAccount = payrollLiabilitiesAccount;
        if (d.account_code) {
          const mapped = await AccountingService.getAccountByCode(clinicId, d.account_code);
          if (mapped) deductionAccount = mapped;
        }
        lineItems.push({ account_id: deductionAccount.id, debit_amount: 0, credit_amount: baseDeduction, description: `Payroll ${run.run_number} — ${employeeLabel} ${d.name}` });
      }

      lineItems.push({ account_id: run.payment_account_id, debit_amount: 0, credit_amount: baseNet, description: `Payroll ${run.run_number} — ${employeeLabel} net pay` });

      lineUpdates.push({ id: line.id, exchange_rate: rate, base_currency_net: baseNet });
    }

    const glEntry = await AccountingService.createGLEntry({
      clinic_id: clinicId,
      transaction_date: run.run_date,
      transaction_type: 'payroll_payment',
      description: `Payroll run ${run.run_number} — ${run.period_month}/${run.period_year}`,
      reference_id: run.id,
      reference_module: 'payroll_run',
    }, lineItems, req.user?.id);
    await AccountingService.postGLEntry(glEntry.id, req.user?.id);

    for (const u of lineUpdates) {
      await sequelize.query(
        `UPDATE payroll_run_lines SET gl_entry_id = :glId, exchange_rate = :rate, base_currency_net = :baseNet, updated_at = NOW() WHERE id = :id`,
        { replacements: { id: u.id, glId: glEntry.id, rate: u.exchange_rate, baseNet: u.base_currency_net } }
      );
    }

    await sequelize.query(
      `UPDATE payroll_runs SET status = 'paid', paid_by = :userId, paid_at = NOW(), updated_at = NOW() WHERE id = :id`,
      { replacements: { id: run.id, userId: req.user?.id || null } }
    );

    try {
      const rr = require('./reports');
      await rr.logAudit({
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'HR', action: 'PAYROLL_PAID', entity_type: 'PayrollRun', entity_id: run.id,
        description: `Payroll run ${run.run_number} paid — ${lines.length} employee(s), GL entry ${glEntry.gl_number}`,
        status: 'success',
      });
    } catch (e) { /* non-blocking */ }

    res.json({ success: true, gl_entry_id: glEntry.id, gl_number: glEntry.gl_number });
  } catch (error) {
    console.error('Error paying payroll run:', error);
    res.status(500).json({ error: error.message || 'Failed to pay payroll run' });
  }
});

module.exports = router;
