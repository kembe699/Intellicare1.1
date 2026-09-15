const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const AccountingService = require('../services/AccountingService');
const { resolvePayrollAccounts, payOnePayrollLine, finalizeRunIfFullyPaid } = require('../services/PayrollPayment');
const { requireApprovalPermission } = require('../middleware/requireApprovalPermission');
const { getConsultationsForDoctor } = require('../services/ConsultantConsultations');
const ExcelJS = require('exceljs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const crypto = require('crypto');
const QRCode = require('qrcode');

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

// ═══════════════════════════════════════════════════
// BULK EMPLOYEE UPLOAD (staff only — consultants stay on the compact
// single-add form; salary/user-account linking are deliberately left off
// the template and set individually afterward). Registered before
// GET /employees/:id so 'bulk-template' isn't swallowed as an :id value.
// ═══════════════════════════════════════════════════

const BULK_HEADERS = [
  'First Name', 'Last Name', 'Gender', 'Date of Birth (YYYY-MM-DD)', 'National ID', 'Phone', 'Email', 'Address',
  'Job Title', 'Department', 'Hire Date (YYYY-MM-DD)', 'Contract Type', 'Employment Status',
  'Bank Name', 'Bank Account Name', 'Bank Account Number', 'Emergency Contact Name', 'Emergency Contact Phone', 'Notes',
];
const CONTRACT_TYPE_LABELS = { 'Full Time': 'full_time', 'Part Time': 'part_time', 'Contract': 'contract' };
const EMPLOYMENT_STATUS_LABELS = { 'Active': 'active', 'On Leave': 'on_leave' };

router.get('/employees/bulk-template', authorize('hr.employees.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [departments] = await sequelize.query(
      `SELECT department_name FROM departments WHERE clinic_id = :clinicId AND is_active = true ORDER BY department_name`,
      { replacements: { clinicId } }
    );

    const workbook = new ExcelJS.Workbook();

    // Hidden reference sheet — department names can contain commas/be long,
    // so they get a real cell range for the dropdown to point at instead of
    // an inline comma-joined formula (which also has a ~255 char cap).
    const listsSheet = workbook.addWorksheet('Lists');
    listsSheet.state = 'veryHidden';
    departments.forEach((d, i) => { listsSheet.getCell(`A${i + 1}`).value = d.department_name; });
    const deptRange = `Lists!$A$1:$A$${Math.max(departments.length, 1)}`;
    listsSheet.getCell('B1').value = 'Male'; listsSheet.getCell('B2').value = 'Female'; listsSheet.getCell('B3').value = 'Other';
    listsSheet.getCell('C1').value = 'Full Time'; listsSheet.getCell('C2').value = 'Part Time'; listsSheet.getCell('C3').value = 'Contract';
    listsSheet.getCell('D1').value = 'Active'; listsSheet.getCell('D2').value = 'On Leave';

    const sheet = workbook.addWorksheet('Employees');
    sheet.columns = BULK_HEADERS.map(h => ({ header: h, key: h, width: Math.max(16, h.length) }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

    // One filled example row so the format is obvious, not just headers. Added
    // BEFORE the data-validation loop below — touching cells via getCell()
    // first makes ExcelJS treat those rows as already occupied, which pushed
    // addRow() all the way down to row 501 instead of row 2.
    sheet.addRow(['Jane', 'Doe', 'Female', '1990-05-14', 'ID-00123', '0912345678', 'jane.doe@example.com', 'Juba, South Sudan', 'Nurse', departments[0]?.department_name || '', '2024-01-15', 'Full Time', 'Active', '', '', '', '', '', '']);

    const LAST_ROW = 500;
    for (let r = 2; r <= LAST_ROW; r++) {
      sheet.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['Lists!$B$1:$B$3'] };
      sheet.getCell(`J${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [deptRange] };
      sheet.getCell(`L${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['Lists!$C$1:$C$3'] };
      sheet.getCell(`M${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['Lists!$D$1:$D$2'] };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="employee_bulk_upload_template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error generating bulk upload template:', error);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

router.post('/employees/bulk-upload', authorize('hr.employees.write'), upload.single('file'), async (req, res) => {
  // multer's multipart parsing runs before this handler and empirically does
  // not preserve the AsyncLocalStorage tenant context the module-level
  // `sequelize` import relies on (see models/index.js's resolveReal) — every
  // other route in this file is a plain JSON request and keeps that context
  // fine, but this one silently fell back to the platform's default database
  // (which has no `employees` table at all) until switched to req.models
  // .sequelize, which auth.js sets directly on the request object and so
  // survives regardless of async-context propagation.
  const seq = req.models.sequelize;
  const t = await seq.transaction();
  try {
    if (!req.file) { await t.rollback(); return res.status(400).json({ error: 'No file uploaded' }); }
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchId = getCreateBranchId(req);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.getWorksheet('Employees') || workbook.worksheets[0];
    if (!sheet) { await t.rollback(); return res.status(400).json({ error: 'Could not find an Employees sheet in this file' }); }

    const headerRow = sheet.getRow(1).values; // 1-indexed, [0] is empty
    const colIndex = {};
    BULK_HEADERS.forEach(h => {
      const idx = headerRow.findIndex(v => String(v || '').trim() === h);
      if (idx > 0) colIndex[h] = idx;
    });
    if (colIndex['First Name'] === undefined || colIndex['Last Name'] === undefined) {
      await t.rollback();
      return res.status(400).json({ error: 'This file is missing the First Name / Last Name columns — please use the downloaded template' });
    }

    const cellText = (row, header) => {
      const idx = colIndex[header];
      if (!idx) return '';
      const cell = row.getCell(idx);
      const v = cell.value;
      if (v == null) return '';
      if (v instanceof Date) return v.toISOString().split('T')[0];
      if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim(); // formula cell
      return String(v).trim();
    };

    const [[numRow]] = await seq.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number, '^.*-', ''), '')::int), 0) AS last
         FROM employees WHERE employee_number ~ '^EMP-[0-9]+$'`,
      { transaction: t }
    );
    let nextSeq = (parseInt(numRow?.last, 10) || 0) + 1;

    const created = [];
    const skipped = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const firstName = cellText(row, 'First Name');
      const lastName = cellText(row, 'Last Name');
      if (!firstName && !lastName) continue; // blank row
      if (!firstName || !lastName) { skipped.push({ row: r, reason: 'Missing first or last name' }); continue; }

      const employeeNumber = `EMP-${String(nextSeq).padStart(4, '0')}`;
      const id = uuidv4();
      const contractLabel = cellText(row, 'Contract Type');
      const statusLabel = cellText(row, 'Employment Status');
      try {
        await seq.query(`
          INSERT INTO employees (
            id, clinic_id, branch_id, employee_number, employment_type,
            first_name, last_name, gender, date_of_birth, national_id, phone, email, address,
            job_title, department, hire_date, employment_status, contract_type,
            bank_name, bank_account_name, bank_account_number,
            emergency_contact_name, emergency_contact_phone, notes, is_active, created_at, updated_at
          ) VALUES (
            :id, :clinicId, :branchId, :employeeNumber, 'staff',
            :firstName, :lastName, :gender, :dateOfBirth, :nationalId, :phone, :email, :address,
            :jobTitle, :department, :hireDate, :employmentStatus, :contractType,
            :bankName, :bankAccountName, :bankAccountNumber,
            :emergencyContactName, :emergencyContactPhone, :notes, true, NOW(), NOW()
          )
        `, {
          replacements: {
            id, clinicId, branchId, employeeNumber,
            firstName, lastName, gender: cellText(row, 'Gender') || null,
            dateOfBirth: cellText(row, 'Date of Birth (YYYY-MM-DD)') || null, nationalId: cellText(row, 'National ID') || null,
            phone: cellText(row, 'Phone') || null, email: cellText(row, 'Email') || null, address: cellText(row, 'Address') || null,
            jobTitle: cellText(row, 'Job Title') || null, department: cellText(row, 'Department') || null,
            hireDate: cellText(row, 'Hire Date (YYYY-MM-DD)') || null,
            employmentStatus: EMPLOYMENT_STATUS_LABELS[statusLabel] || 'active',
            contractType: CONTRACT_TYPE_LABELS[contractLabel] || 'full_time',
            bankName: cellText(row, 'Bank Name') || null, bankAccountName: cellText(row, 'Bank Account Name') || null,
            bankAccountNumber: cellText(row, 'Bank Account Number') || null,
            emergencyContactName: cellText(row, 'Emergency Contact Name') || null,
            emergencyContactPhone: cellText(row, 'Emergency Contact Phone') || null,
            notes: cellText(row, 'Notes') || null,
          },
          transaction: t,
        });
        created.push({ row: r, employee_number: employeeNumber, name: `${firstName} ${lastName}` });
        nextSeq++;
      } catch (rowError) {
        skipped.push({ row: r, reason: rowError.message });
      }
    }

    if (created.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'No employees could be created', skipped });
    }
    await t.commit();
    res.status(201).json({ created: created.length, employees: created, skipped });
  } catch (error) {
    await t.rollback();
    console.error('Error bulk uploading employees:', error);
    res.status(500).json({ error: 'Failed to process the uploaded file' });
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

    let salaryStructure = null;
    if (employee.salary_structure_id) {
      const [[s]] = await sequelize.query(
        `SELECT id, name, basic_salary, currency, pay_frequency FROM salary_structures WHERE id = :id`,
        { replacements: { id: employee.salary_structure_id } }
      );
      salaryStructure = s || null;
    }

    res.json({ ...employee, salary_components: components, payroll_history: payrollHistory, salary_structure: salaryStructure });
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
        id, clinicId, branchId: b.branch_id || getCreateBranchId(req), userId: b.user_id ? parseInt(b.user_id, 10) : null,
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
      user_id: b.user_id !== undefined ? (b.user_id ? parseInt(b.user_id, 10) : null) : undefined,
      employment_type: b.employment_type,
      first_name: b.first_name, last_name: b.last_name, gender: b.gender,
      // DATE columns reject '' outright ("invalid input syntax for type
      // date") — the edit form sends an empty string for an unset date
      // rather than omitting the key, which this the naive `b.field`
      // pass-through turned into a 500 on every save of a record with no
      // date_of_birth/hire_date/termination_date set (e.g. the compact
      // consultant form, where DOB is the only date field and is easy to
      // leave blank).
      date_of_birth: b.date_of_birth !== undefined ? (b.date_of_birth || null) : undefined,
      national_id: b.national_id, phone: b.phone, email: b.email, address: b.address,
      job_title: b.job_title, department: b.department,
      hire_date: b.hire_date !== undefined ? (b.hire_date || null) : undefined,
      termination_date: b.termination_date !== undefined ? (b.termination_date || null) : undefined,
      employment_status: b.employment_status, contract_type: b.contract_type,
      bank_name: b.bank_name, bank_account_name: b.bank_account_name, bank_account_number: b.bank_account_number,
      emergency_contact_name: b.emergency_contact_name, emergency_contact_phone: b.emergency_contact_phone,
      basic_salary: b.basic_salary !== undefined ? parseFloat(b.basic_salary) || 0 : undefined,
      salary_currency: b.salary_currency, pay_frequency: b.pay_frequency, notes: b.notes,
      is_active: b.is_active,
      consultation_fee_percentage: b.consultation_fee_percentage !== undefined ? (b.consultation_fee_percentage === null || b.consultation_fee_percentage === '' ? null : parseFloat(b.consultation_fee_percentage)) : undefined,
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

// No authorize() gate here, matching GET /api/users — this only returns
// non-sensitive names for a "who saw this patient" picker (e.g. LIS
// Registration's Doctor dropdown), not the full HR employee record. That
// dropdown is used by front-desk/lab staff whose role has no reason to
// carry hr.employees.read (admin-only), so gating this behind it silently
// emptied the consultant half of that list for exactly the people who use
// it day to day.
router.get('/consultants/for-doctor-picker', async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    // Linking a user account is optional (see PUT /employees/:id) — every
    // active consultant is returned regardless, so the frontend can offer an
    // unlinked one too (recorded via lis_test_orders.consultant_id instead
    // of doctor_id, see lisModule.js).
    const [consultants] = await sequelize.query(
      `SELECT id, user_id, first_name, last_name FROM employees
       WHERE clinic_id = :clinicId AND employment_type = 'consultant'
         AND employment_status = 'active' AND is_active = true`,
      { replacements: { clinicId } }
    );
    res.json(consultants);
  } catch (error) {
    console.error('Error fetching consultants for doctor picker:', error);
    res.status(500).json({ error: 'Failed to fetch consultants' });
  }
});

// ═══════════════════════════════════════════════════
// CONSULTANT CONSULTATIONS & BILLING
// (percentage-of-fees pay model for consultants/doctors, in place of a
// salary — see ConsultantConsultations.js for the attribution heuristic)
// ═══════════════════════════════════════════════════

router.get('/consultants/:id/consultations', authorize('hr.employees.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[consultant]] = await sequelize.query(
      `SELECT * FROM employees WHERE id = :id AND clinic_id = :clinicId AND employment_type = 'consultant'`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (!consultant) return res.status(404).json({ error: 'Consultant not found' });

    const dateFrom = req.query.from || new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0];
    const dateTo = req.query.to || new Date().toISOString().split('T')[0];

    const { consultations, totalsByCurrency } = await getConsultationsForDoctor(
      sequelize, clinicId, { userId: consultant.user_id, employeeId: consultant.id }, dateFrom, dateTo
    );

    // Exclude patient bills already consumed by a previous bill for this consultant.
    const [alreadyBilledRows] = await sequelize.query(
      `SELECT patient_bill_id FROM consultant_bill_items WHERE consultant_id = :id`,
      { replacements: { id: req.params.id } }
    );
    const alreadyBilledIds = new Set(alreadyBilledRows.map(r => r.patient_bill_id));

    const billable = {};
    for (const c of consultations) {
      c.already_billed = alreadyBilledIds.has(c.patient_bill_id);
      if (!c.already_billed) {
        const t = (billable[c.currency] ||= { collected: 0 });
        t.collected += c.collected_amount;
      }
    }
    for (const cur of Object.keys(billable)) billable[cur].collected = Math.round(billable[cur].collected * 100) / 100;

    res.json({
      consultations, totalsByCurrency, billable,
      fee_percentage: consultant.consultation_fee_percentage,
      period: { from: dateFrom, to: dateTo },
    });
  } catch (error) {
    console.error('Error tracing consultant consultations:', error);
    res.status(500).json({ error: 'Failed to trace consultations' });
  }
});

router.get('/consultants/:id/bills', authorize('hr.employees.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [bills] = await sequelize.query(
      `SELECT * FROM consultant_bills WHERE consultant_id = :id AND clinic_id = :clinicId ORDER BY period_to DESC, created_at DESC`,
      { replacements: { id: req.params.id, clinicId } }
    );
    res.json(bills);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch consultant bills' });
  }
});

// Recomputes the billable total server-side (never trusts a client-sent
// figure for money) excluding anything already claimed by a previous bill,
// then locks those patient bills to this consultant_bill via
// consultant_bill_items so the same revenue can never be billed twice.
router.post('/consultants/:id/bills', authorize('hr.employees.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { period_from, period_to, currency } = req.body || {};
    if (!period_from || !period_to || !currency) {
      await t.rollback();
      return res.status(400).json({ error: 'period_from, period_to, and currency are required' });
    }
    const [[consultant]] = await sequelize.query(
      `SELECT * FROM employees WHERE id = :id AND clinic_id = :clinicId AND employment_type = 'consultant'`,
      { replacements: { id: req.params.id, clinicId }, transaction: t }
    );
    if (!consultant) { await t.rollback(); return res.status(404).json({ error: 'Consultant not found' }); }
    const pct = parseFloat(consultant.consultation_fee_percentage);
    if (!pct || pct <= 0) { await t.rollback(); return res.status(400).json({ error: 'Set this consultant\'s fee percentage before creating a bill' }); }

    const { consultations } = await getConsultationsForDoctor(
      sequelize, clinicId, { userId: consultant.user_id, employeeId: consultant.id }, period_from, period_to
    );
    const [alreadyBilledRows] = await sequelize.query(
      `SELECT patient_bill_id FROM consultant_bill_items WHERE consultant_id = :id`,
      { replacements: { id: req.params.id }, transaction: t }
    );
    const alreadyBilledIds = new Set(alreadyBilledRows.map(r => r.patient_bill_id));
    const billableItems = consultations.filter(c => c.currency === currency && !alreadyBilledIds.has(c.patient_bill_id) && c.collected_amount > 0);
    const totalRevenue = Math.round(billableItems.reduce((s, c) => s + c.collected_amount, 0) * 100) / 100;
    if (totalRevenue <= 0) {
      await t.rollback();
      return res.status(400).json({ error: `No unbilled ${currency} consultation revenue found for this period` });
    }
    const billAmount = Math.round(totalRevenue * pct) / 100;

    const [[seqRow]] = await sequelize.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(bill_number, '^.*-', ''), '')::int), 0) AS last
         FROM consultant_bills WHERE bill_number ~ '^CB-[0-9]+$'`,
      { transaction: t }
    );
    const billNumber = `CB-${String((parseInt(seqRow?.last, 10) || 0) + 1).padStart(4, '0')}`;
    const billId = uuidv4();

    await sequelize.query(`
      INSERT INTO consultant_bills (id, clinic_id, branch_id, consultant_id, bill_number, period_from, period_to,
        total_consultation_revenue, fee_percentage, bill_amount, currency, status, created_by, created_at, updated_at)
      VALUES (:id, :clinicId, :branchId, :consultantId, :billNumber, :periodFrom, :periodTo,
        :totalRevenue, :pct, :billAmount, :currency, 'unpaid', :createdBy, NOW(), NOW())
    `, {
      replacements: {
        id: billId, clinicId, branchId: getCreateBranchId(req), consultantId: req.params.id, billNumber,
        periodFrom: period_from, periodTo: period_to, totalRevenue, pct, billAmount, currency,
        createdBy: req.user?.id || null,
      },
      transaction: t,
    });

    for (const item of billableItems) {
      await sequelize.query(`
        INSERT INTO consultant_bill_items (id, consultant_bill_id, consultant_id, patient_bill_id, patient_id, visit_date, currency, amount, created_at)
        VALUES (:id, :billId, :consultantId, :patientBillId, :patientId, :visitDate, :currency, :amount, NOW())
      `, {
        replacements: {
          id: uuidv4(), billId, consultantId: req.params.id, patientBillId: item.patient_bill_id,
          patientId: item.patient_id, visitDate: item.visit_date, currency: item.currency, amount: item.collected_amount,
        },
        transaction: t,
      });
    }

    await t.commit();
    const [[created]] = await sequelize.query(`SELECT * FROM consultant_bills WHERE id = :id`, { replacements: { id: billId } });
    res.status(201).json(created);
  } catch (error) {
    await t.rollback();
    console.error('Error creating consultant bill:', error);
    res.status(500).json({ error: 'Failed to create consultant bill' });
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
// SALARY STRUCTURES (standard templates, assignable to employees)
// ═══════════════════════════════════════════════════

router.get('/salary-structures', authorize('hr.employees.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [structures] = await sequelize.query(`
      SELECT s.*, (SELECT COUNT(*) FROM salary_structure_components c WHERE c.salary_structure_id = s.id) AS component_count
      FROM salary_structures s WHERE s.clinic_id = :clinicId AND s.is_active = true
      ORDER BY s.name ASC
    `, { replacements: { clinicId } });
    res.json(structures);
  } catch (error) {
    console.error('Error fetching salary structures:', error);
    res.status(500).json({ error: 'Failed to fetch salary structures' });
  }
});

router.get('/salary-structures/:id', authorize('hr.employees.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[structure]] = await sequelize.query(
      `SELECT * FROM salary_structures WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (!structure) return res.status(404).json({ error: 'Salary structure not found' });
    const [components] = await sequelize.query(
      `SELECT * FROM salary_structure_components WHERE salary_structure_id = :id ORDER BY component_type, name`,
      { replacements: { id: req.params.id } }
    );
    res.json({ ...structure, components });
  } catch (error) {
    console.error('Error fetching salary structure:', error);
    res.status(500).json({ error: 'Failed to fetch salary structure' });
  }
});

router.post('/salary-structures', authorize('hr.employees.write'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ error: 'Name is required' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO salary_structures (id, clinic_id, branch_id, name, description, basic_salary, currency, pay_frequency, is_active, created_at, updated_at)
      VALUES (:id, :clinicId, :branchId, :name, :description, :basicSalary, :currency, :payFrequency, true, NOW(), NOW())
    `, {
      replacements: {
        id, clinicId, branchId: getCreateBranchId(req), name: b.name.trim(), description: b.description || null,
        basicSalary: parseFloat(b.basic_salary) || 0, currency: b.currency || 'USD', payFrequency: b.pay_frequency || 'monthly',
      }
    });
    const [[created]] = await sequelize.query(`SELECT * FROM salary_structures WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating salary structure:', error);
    res.status(500).json({ error: 'Failed to create salary structure' });
  }
});

router.put('/salary-structures/:id', authorize('hr.employees.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const b = req.body || {};
    const fields = {
      name: b.name?.trim(), description: b.description,
      basic_salary: b.basic_salary !== undefined ? parseFloat(b.basic_salary) || 0 : undefined,
      currency: b.currency, pay_frequency: b.pay_frequency,
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
      `UPDATE salary_structures SET ${setClauses.join(', ')} WHERE id = :id AND clinic_id = :clinicId`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Salary structure not found' });
    const [[updated]] = await sequelize.query(`SELECT * FROM salary_structures WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating salary structure:', error);
    res.status(500).json({ error: 'Failed to update salary structure' });
  }
});

router.delete('/salary-structures/:id', authorize('hr.employees.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, meta] = await sequelize.query(
      `UPDATE salary_structures SET is_active = false, updated_at = NOW() WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Salary structure not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove salary structure' });
  }
});

router.post('/salary-structures/:id/components', authorize('hr.employees.write'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim() || !b.component_type) return res.status(400).json({ error: 'name and component_type are required' });
    if (!['allowance', 'deduction'].includes(b.component_type)) {
      return res.status(400).json({ error: "component_type must be 'allowance' or 'deduction'" });
    }
    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO salary_structure_components (id, salary_structure_id, component_type, name, amount, is_percentage, account_code, created_at, updated_at)
      VALUES (:id, :structureId, :componentType, :name, :amount, :isPercentage, :accountCode, NOW(), NOW())
    `, {
      replacements: {
        id, structureId: req.params.id, componentType: b.component_type, name: b.name.trim(),
        amount: parseFloat(b.amount) || 0, isPercentage: !!b.is_percentage, accountCode: b.account_code || null,
      }
    });
    const [[created]] = await sequelize.query(`SELECT * FROM salary_structure_components WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error adding salary structure component:', error);
    res.status(500).json({ error: 'Failed to add component' });
  }
});

router.delete('/salary-structure-components/:id', authorize('hr.employees.write'), async (req, res) => {
  try {
    const [, meta] = await sequelize.query(`DELETE FROM salary_structure_components WHERE id = :id`, { replacements: { id: req.params.id } });
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Component not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove component' });
  }
});

// Applies a structure's basic_salary/currency/pay_frequency and components
// onto each selected employee. Existing active components are deactivated
// (not deleted — same soft-removal convention as the rest of this file)
// before the structure's components are cloned in, so re-assigning a
// structure cleanly replaces what an employee had rather than piling on.
router.post('/salary-structures/:id/assign', authorize('hr.employees.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const employeeIds = Array.isArray(req.body?.employee_ids) ? req.body.employee_ids : [];
    if (employeeIds.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'Select at least one employee' });
    }
    const [[structure]] = await sequelize.query(
      `SELECT * FROM salary_structures WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId }, transaction: t }
    );
    if (!structure) {
      await t.rollback();
      return res.status(404).json({ error: 'Salary structure not found' });
    }
    const [components] = await sequelize.query(
      `SELECT * FROM salary_structure_components WHERE salary_structure_id = :id`,
      { replacements: { id: req.params.id }, transaction: t }
    );

    const [employees] = await sequelize.query(
      `SELECT id FROM employees WHERE clinic_id = :clinicId AND id IN (:employeeIds)`,
      { replacements: { clinicId, employeeIds }, transaction: t }
    );

    for (const emp of employees) {
      await sequelize.query(
        `UPDATE employees SET basic_salary = :basicSalary, salary_currency = :currency, pay_frequency = :payFrequency, salary_structure_id = :structureId, updated_at = NOW() WHERE id = :id`,
        { replacements: { id: emp.id, basicSalary: structure.basic_salary, currency: structure.currency, payFrequency: structure.pay_frequency, structureId: structure.id }, transaction: t }
      );
      await sequelize.query(
        `UPDATE employee_salary_components SET is_active = false, updated_at = NOW() WHERE employee_id = :id AND is_active = true`,
        { replacements: { id: emp.id }, transaction: t }
      );
      for (const c of components) {
        await sequelize.query(`
          INSERT INTO employee_salary_components (id, employee_id, component_type, name, amount, is_percentage, account_code, is_active, created_at, updated_at)
          VALUES (:id, :employeeId, :componentType, :name, :amount, :isPercentage, :accountCode, true, NOW(), NOW())
        `, {
          replacements: {
            id: uuidv4(), employeeId: emp.id, componentType: c.component_type, name: c.name,
            amount: c.amount, isPercentage: c.is_percentage, accountCode: c.account_code,
          },
          transaction: t,
        });
      }
    }

    await t.commit();
    res.json({ success: true, applied_to: employees.length });
  } catch (error) {
    await t.rollback();
    console.error('Error assigning salary structure:', error);
    res.status(500).json({ error: 'Failed to assign salary structure' });
  }
});

// Clears the reference only — deliberately does not touch basic_salary,
// salary_currency, pay_frequency, or employee_salary_components, so an
// employee's actual pay is never zeroed out by this. It just stops being
// tracked as "on" a particular template, e.g. before hand-tuning their pay
// individually.
router.post('/employees/:id/unassign-salary-structure', authorize('hr.employees.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, meta] = await sequelize.query(
      `UPDATE employees SET salary_structure_id = NULL, updated_at = NOW() WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error unassigning salary structure:', error);
    res.status(500).json({ error: 'Failed to unassign salary structure' });
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

const PAYROLL_SHEET_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// A printable cash-disbursement register — one row per employee with a
// blank Signature/Date column, for cash payroll runs where the employee
// signs on paper to prove they physically received it. Finance then comes
// back into the app and marks each one paid there (POST .../lines/:lineId
// /pay) — this sheet is only ever the paper trail, it never marks anything
// paid itself.
router.get('/payroll/runs/:id/sheet', authorize('hr.payroll.read'), async (req, res) => {
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
      SELECT prl.*, e.employee_number, e.first_name, e.last_name, e.job_title
      FROM payroll_run_lines prl
      JOIN employees e ON e.id = prl.employee_id
      WHERE prl.payroll_run_id = :id
      ORDER BY e.first_name, e.last_name
    `, { replacements: { id: req.params.id } });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Payroll Sheet', { views: [{ state: 'frozen', ySplit: 6 }] });

    sheet.columns = [
      { key: 'num', width: 5 },
      { key: 'empNo', width: 14 },
      { key: 'name', width: 26 },
      { key: 'title', width: 20 },
      { key: 'currency', width: 10 },
      { key: 'gross', width: 14 },
      { key: 'deductions', width: 14 },
      { key: 'net', width: 16 },
      { key: 'status', width: 12 },
      { key: 'signature', width: 28 },
      { key: 'dateSigned', width: 16 },
    ];

    sheet.mergeCells('A1:K1');
    sheet.getCell('A1').value = 'PAYROLL DISBURSEMENT SHEET';
    sheet.getCell('A1').font = { bold: true, size: 14 };

    sheet.getCell('A2').value = `Run: ${run.run_number}`;
    sheet.getCell('D2').value = `Period: ${PAYROLL_SHEET_MONTHS[run.period_month - 1] || run.period_month} ${run.period_year}`;
    sheet.getCell('G2').value = `Status: ${run.status.toUpperCase()}`;
    sheet.getCell('A3').value = `Payment Account: ${run.payment_account_name || '—'}`;
    sheet.getCell('D3').value = `Generated: ${new Date().toLocaleDateString()}`;
    ['A2', 'D2', 'G2', 'A3', 'D3'].forEach(c => { sheet.getCell(c).font = { size: 10, italic: true }; });

    const headerRow = sheet.getRow(6);
    headerRow.values = ['#', 'Employee No.', 'Name', 'Job Title', 'Cur.', 'Gross', 'Deductions', 'Net Pay', 'Status', 'Signature (received cash)', 'Date'];
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    headerRow.eachCell(c => { c.border = { bottom: { style: 'thin' } }; });

    const totalsByCurrency = {};
    let embeddedSignatureCount = 0;
    lines.forEach((l, i) => {
      const row = sheet.addRow({
        num: i + 1,
        empNo: l.employee_number,
        name: `${l.first_name} ${l.last_name}`,
        title: l.job_title || '',
        currency: l.currency,
        gross: parseFloat(l.gross_pay) || 0,
        deductions: parseFloat(l.deductions_total) || 0,
        net: parseFloat(l.net_pay) || 0,
        status: l.status === 'paid' ? 'PAID' : 'UNPAID',
        signature: '',
        dateSigned: l.signed_at ? new Date(l.signed_at).toLocaleDateString() : '',
      });
      ['gross', 'deductions', 'net'].forEach(k => { row.getCell(k).numFmt = '#,##0.00'; });
      row.getCell('signature').border = { bottom: { style: 'thin' } };
      row.getCell('dateSigned').border = { bottom: { style: 'thin' } };
      row.height = 32;

      // An employee who signed electronically via the QR flow (routes/
      // publicPayroll.js) already has their signature captured — embed it
      // right into the sheet instead of leaving the cell blank for a
      // physical signature that was never going to happen for them.
      if (l.signature_data) {
        try {
          const match = /^data:image\/(png|jpe?g);base64,/i.exec(l.signature_data);
          const ext = match ? (match[1].toLowerCase().startsWith('jpe') ? 'jpeg' : 'png') : 'png';
          const imageId = workbook.addImage({ base64: l.signature_data, extension: ext });
          sheet.addImage(imageId, { tl: { col: 9, row: row.number - 1 }, ext: { width: 130, height: 40 } });
          embeddedSignatureCount++;
        } catch (e) { /* malformed signature data — leave the cell blank rather than fail the whole sheet */ }
      }

      const t = (totalsByCurrency[l.currency] ||= { gross: 0, deductions: 0, net: 0, count: 0 });
      t.gross += parseFloat(l.gross_pay) || 0;
      t.deductions += parseFloat(l.deductions_total) || 0;
      t.net += parseFloat(l.net_pay) || 0;
      t.count++;
    });

    sheet.addRow([]);
    // One totals line per currency actually present — never blended, same
    // as every other multi-currency total in this app.
    for (const [currency, t] of Object.entries(totalsByCurrency)) {
      const totalRow = sheet.addRow({ name: `TOTAL (${currency}) — ${t.count} employee(s)`, gross: t.gross, deductions: t.deductions, net: t.net });
      totalRow.font = { bold: true };
      ['gross', 'deductions', 'net'].forEach(k => { totalRow.getCell(k).numFmt = '#,##0.00'; });
    }

    sheet.addRow([]);
    const noteText = embeddedSignatureCount > 0
      ? `Each employee signs above to confirm they personally received the cash amount shown. ${embeddedSignatureCount} signature(s) shown were captured electronically via the QR self-service link. Mark paid in the system only after a signature is collected.`
      : 'Each employee signs above to confirm they personally received the cash amount shown. Mark paid in the system only after a signature is collected.';
    const noteRow = sheet.addRow([noteText]);
    noteRow.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF6B7280' } };
    sheet.mergeCells(`A${noteRow.number}:K${noteRow.number}`);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Payroll-${run.run_number}-Sheet.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error generating payroll sheet:', error);
    res.status(500).json({ error: 'Failed to generate payroll sheet' });
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

    // Consultants are excluded here unconditionally — they're paid a
    // percentage of consultation revenue (see the Consultant Bills feature)
    // rather than a salary, so they never belong in a payroll run.
    const employeeCondition = Array.isArray(employee_ids) && employee_ids.length > 0
      ? 'AND id IN (:employeeIds)' : '';
    const [employees] = await sequelize.query(
      `SELECT * FROM employees WHERE clinic_id = :clinicId AND employment_type = 'staff' AND employment_status = 'active' AND is_active = true ${employeeCondition}`,
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

router.post('/payroll/runs/:id/approve', requireApprovalPermission('payroll_run_approve'), async (req, res) => {
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

// The accounting integration: posts one balanced GL entry per employee.
// Shared with the public QR-code employee-signing flow — see
// services/PayrollPayment.js.

// Generates (or re-generates, if not yet signed) a unique token for this one
// employee's line and a QR code image pointing at the public signing page —
// see routes/publicPayroll.js. The employee scans it on their own phone,
// confirms their employee number, reviews their pay, and signs; that
// submission is what actually pays the line (same GL posting as the
// admin-driven /pay routes) and stores the signature for the payroll sheet.
router.post('/payroll/runs/:id/lines/:lineId/signing-link', authorize('hr.payroll.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[run]] = await sequelize.query(
      `SELECT * FROM payroll_runs WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status !== 'approved') return res.status(409).json({ error: 'Only an approved run can be paid' });
    if (!run.payment_account_id) return res.status(400).json({ error: 'This run has no payment account set' });

    const [[line]] = await sequelize.query(
      `SELECT * FROM payroll_run_lines WHERE id = :lineId AND payroll_run_id = :runId`,
      { replacements: { lineId: req.params.lineId, runId: req.params.id } }
    );
    if (!line) return res.status(404).json({ error: 'Payroll line not found' });
    if (line.status === 'paid') return res.status(409).json({ error: 'This employee has already been paid' });
    if (line.signed_at) return res.status(409).json({ error: 'This employee has already signed for payment' });

    const { Client } = require('../models/platform');
    const client = await Client.findOne({ where: { schema_name: req.tenantSchema } });
    if (!client) return res.status(500).json({ error: 'Could not resolve this instance\'s public code' });

    const token = crypto.randomBytes(24).toString('hex');
    await sequelize.query(
      `UPDATE payroll_run_lines SET signing_token = :token, signing_token_created_at = NOW(), signature_verify_attempts = 0, updated_at = NOW() WHERE id = :id`,
      { replacements: { id: line.id, token } }
    );

    const path = `/payroll-sign/${client.code}/${token}`;
    // The frontend and API are the same origin in production (one Express
    // service serves both), but not in local dev (vite on its own port) —
    // the browser is the only reliable source of "where the public page
    // actually loads from", so it sends its own origin rather than this
    // being inferred from the API request's host.
    const origin = typeof req.body?.origin === 'string' && /^https?:\/\//.test(req.body.origin)
      ? req.body.origin.replace(/\/$/, '')
      : `${req.protocol}://${req.get('host')}`;
    const qrDataUrl = await QRCode.toDataURL(`${origin}${path}`, { width: 320, margin: 2 });

    res.json({ token, path, qr_data_url: qrDataUrl });
  } catch (error) {
    console.error('Error generating payroll signing link:', error);
    res.status(500).json({ error: 'Failed to generate signing link' });
  }
});

router.post('/payroll/runs/:id/lines/:lineId/pay', authorize('hr.payroll.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[run]] = await sequelize.query(
      `SELECT * FROM payroll_runs WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status !== 'approved') return res.status(409).json({ error: 'Only an approved run can be paid' });

    const paymentAccountId = req.body?.payment_account_id || run.payment_account_id;
    if (!paymentAccountId) return res.status(400).json({ error: 'This run has no payment account set' });

    const [[line]] = await sequelize.query(`
      SELECT prl.*, e.employment_type, e.first_name, e.last_name, e.employee_number
      FROM payroll_run_lines prl JOIN employees e ON e.id = prl.employee_id
      WHERE prl.id = :lineId AND prl.payroll_run_id = :runId
    `, { replacements: { lineId: req.params.lineId, runId: req.params.id } });
    if (!line) return res.status(404).json({ error: 'Payroll line not found' });
    if (line.status === 'paid') return res.status(409).json({ error: 'This employee has already been paid' });

    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = TRUE LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'USD';
    const accounts = await resolvePayrollAccounts(clinicId);
    if (!accounts.salariesAccount || !accounts.doctorFeesAccount || !accounts.payrollLiabilitiesAccount) {
      return res.status(500).json({ error: 'Payroll accounts (5100/5110/2200) are missing from the Chart of Accounts' });
    }

    const glEntry = await payOnePayrollLine(sequelize, clinicId, run, line, accounts, baseCurrency, paymentAccountId, req.user?.id);
    const runFullyPaid = await finalizeRunIfFullyPaid(sequelize, run.id, req.user?.id);

    try {
      const rr = require('./reports');
      await rr.logAudit({
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'HR', action: 'PAYROLL_LINE_PAID', entity_type: 'PayrollRunLine', entity_id: line.id,
        description: `Payroll ${run.run_number} — ${line.first_name} ${line.last_name} paid, GL entry ${glEntry.gl_number}`,
        status: 'success',
      });
    } catch (e) { /* non-blocking */ }

    res.json({ success: true, gl_entry_id: glEntry.id, gl_number: glEntry.gl_number, run_fully_paid: runFullyPaid });
  } catch (error) {
    console.error('Error paying payroll line:', error);
    res.status(500).json({ error: error.message || 'Failed to pay this employee' });
  }
});

// "Pay All Remaining" — the same per-employee GL posting as the single
// -employee route above, just looped over everyone not yet paid, so a run
// can still be cleared in one action when there's no reason to pay people
// one at a time.
router.post('/payroll/runs/:id/pay', authorize('hr.payroll.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[run]] = await sequelize.query(
      `SELECT * FROM payroll_runs WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status !== 'approved') return res.status(409).json({ error: 'Only an approved run can be paid' });

    const paymentAccountId = req.body?.payment_account_id || run.payment_account_id;
    if (!paymentAccountId) return res.status(400).json({ error: 'This run has no payment account set' });

    const [lines] = await sequelize.query(`
      SELECT prl.*, e.employment_type, e.first_name, e.last_name, e.employee_number
      FROM payroll_run_lines prl JOIN employees e ON e.id = prl.employee_id
      WHERE prl.payroll_run_id = :id AND prl.status != 'paid'
    `, { replacements: { id: req.params.id } });
    if (lines.length === 0) return res.status(400).json({ error: 'Everyone on this run has already been paid' });

    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = TRUE LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'USD';
    const accounts = await resolvePayrollAccounts(clinicId);
    if (!accounts.salariesAccount || !accounts.doctorFeesAccount || !accounts.payrollLiabilitiesAccount) {
      return res.status(500).json({ error: 'Payroll accounts (5100/5110/2200) are missing from the Chart of Accounts' });
    }

    let paidCount = 0;
    for (const line of lines) {
      await payOnePayrollLine(sequelize, clinicId, run, line, accounts, baseCurrency, paymentAccountId, req.user?.id);
      paidCount++;
    }
    await finalizeRunIfFullyPaid(sequelize, run.id, req.user?.id);

    try {
      const rr = require('./reports');
      await rr.logAudit({
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'HR', action: 'PAYROLL_PAID', entity_type: 'PayrollRun', entity_id: run.id,
        description: `Payroll run ${run.run_number} — ${paidCount} employee(s) paid`,
        status: 'success',
      });
    } catch (e) { /* non-blocking */ }

    res.json({ success: true, paid_count: paidCount });
  } catch (error) {
    console.error('Error paying payroll run:', error);
    res.status(500).json({ error: error.message || 'Failed to pay payroll run' });
  }
});

module.exports = router;
