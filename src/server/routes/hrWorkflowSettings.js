/**
 * The configurable leave/advance approval-workflow settings (spec section
 * 6B): HOD/Finance step toggles and the server-enforced advance limits.
 * Mounted at /api/hr/workflow-settings. Also the per-employee approver
 * override CRUD (employee_approver_overrides) used by
 * utils/approverResolution.js.
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { sequelize } = require('../models');
const { authorize } = require('../middleware/authorize');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { getWorkflowSettings } = require('../config/ensureHrWorkflowSettings');

router.get('/', authorize('hr.leave.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    res.json(await getWorkflowSettings(sequelize, clinicId));
  } catch (error) {
    console.error('Error loading HR workflow settings:', error);
    res.status(500).json({ error: 'Failed to load workflow settings' });
  }
});

router.put('/', authorize('leave.manage_settings'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const b = req.body || {};
    await sequelize.query(
      `INSERT INTO hr_workflow_settings (
         clinic_id, leave_require_hod, advance_require_hod, advance_require_finance,
         advance_max_percent_of_salary, advance_max_open_advances, advance_max_repayment_months,
         advance_min_months_of_service, updated_by, created_at, updated_at
       ) VALUES (
         :clinicId, :leaveRequireHod, :advanceRequireHod, :advanceRequireFinance,
         :advanceMaxPercent, :advanceMaxOpen, :advanceMaxMonths, :advanceMinService, :userId, NOW(), NOW()
       )
       ON CONFLICT (clinic_id) DO UPDATE SET
         leave_require_hod = :leaveRequireHod, advance_require_hod = :advanceRequireHod,
         advance_require_finance = :advanceRequireFinance, advance_max_percent_of_salary = :advanceMaxPercent,
         advance_max_open_advances = :advanceMaxOpen, advance_max_repayment_months = :advanceMaxMonths,
         advance_min_months_of_service = :advanceMinService, updated_by = :userId, updated_at = NOW()`,
      {
        replacements: {
          clinicId,
          leaveRequireHod: !!b.leave_require_hod,
          advanceRequireHod: !!b.advance_require_hod,
          advanceRequireFinance: !!b.advance_require_finance,
          advanceMaxPercent: Number(b.advance_max_percent_of_salary) || 50,
          advanceMaxOpen: Number(b.advance_max_open_advances) || 1,
          advanceMaxMonths: Number(b.advance_max_repayment_months) || 12,
          advanceMinService: Number(b.advance_min_months_of_service) || 0,
          userId: req.user.id,
        },
      }
    );
    res.json(await getWorkflowSettings(sequelize, clinicId));
  } catch (error) {
    console.error('Error saving HR workflow settings:', error);
    res.status(500).json({ error: 'Failed to save workflow settings' });
  }
});

router.get('/approver-overrides', authorize('hr.leave.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [rows] = await sequelize.query(
      `SELECT o.*, e1.first_name AS employee_first_name, e1.last_name AS employee_last_name,
              e2.first_name AS approver_first_name, e2.last_name AS approver_last_name
       FROM employee_approver_overrides o
       JOIN employees e1 ON e1.id = o.employee_id
       JOIN employees e2 ON e2.id = o.approver_employee_id
       WHERE o.clinic_id = :clinicId`,
      { replacements: { clinicId } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error loading approver overrides:', error);
    res.status(500).json({ error: 'Failed to load approver overrides' });
  }
});

router.put('/approver-overrides/:employeeId', authorize('leave.manage_settings'), async (req, res) => {
  try {
    const { approver_employee_id } = req.body || {};
    if (!approver_employee_id) return res.status(400).json({ error: 'approver_employee_id is required' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    await sequelize.query(
      `INSERT INTO employee_approver_overrides (id, clinic_id, employee_id, approver_employee_id, created_at, updated_at)
       VALUES (:id, :clinicId, :employeeId, :approverEmployeeId, NOW(), NOW())
       ON CONFLICT (employee_id) DO UPDATE SET approver_employee_id = :approverEmployeeId, updated_at = NOW()`,
      { replacements: { id: uuidv4(), clinicId, employeeId: req.params.employeeId, approverEmployeeId: approver_employee_id } }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error setting approver override:', error);
    res.status(500).json({ error: 'Failed to set approver override' });
  }
});

router.delete('/approver-overrides/:employeeId', authorize('leave.manage_settings'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    await sequelize.query(
      `DELETE FROM employee_approver_overrides WHERE clinic_id = :clinicId AND employee_id = :employeeId`,
      { replacements: { clinicId, employeeId: req.params.employeeId } }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error removing approver override:', error);
    res.status(500).json({ error: 'Failed to remove approver override' });
  }
});

module.exports = router;
