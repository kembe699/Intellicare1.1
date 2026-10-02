const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { requireApprovalPermission } = require('../middleware/requireApprovalPermission');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');

// Calendar days inclusive of both endpoints — a simplification (no weekend/
// holiday exclusion), same "keep it simple" scope as the rest of this
// leave feature. Stated up front rather than silently baked in, since it's
// the kind of thing HR will notice and ask about.
function calcDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}

const DEFAULT_LEAVE_TYPES = [
  { name: 'Annual Leave', default_annual_days: 21 },
  { name: 'Sick Leave', default_annual_days: 10 },
  { name: 'Maternity Leave', default_annual_days: 90 },
  { name: 'Paternity Leave', default_annual_days: 14 },
  { name: 'Compassionate Leave', default_annual_days: 5 },
  { name: 'Unpaid Leave', default_annual_days: 0 },
];

// ═══════════════════════════════════════════════════
// LEAVE TYPES
// ═══════════════════════════════════════════════════

router.get('/types', authorize('hr.leave.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    let [types] = await sequelize.query(
      `SELECT * FROM leave_types WHERE clinic_id = :clinicId AND is_active = true ORDER BY name`,
      { replacements: { clinicId } }
    );
    if (types.length === 0) {
      // First time this clinic has looked at leave types — seed the
      // defaults rather than starting from a blank list nobody can use yet.
      for (const t of DEFAULT_LEAVE_TYPES) {
        await sequelize.query(`
          INSERT INTO leave_types (id, clinic_id, name, default_annual_days, is_active, created_at, updated_at)
          VALUES (:id, :clinicId, :name, :days, true, NOW(), NOW())
        `, { replacements: { id: uuidv4(), clinicId, name: t.name, days: t.default_annual_days } });
      }
      [types] = await sequelize.query(
        `SELECT * FROM leave_types WHERE clinic_id = :clinicId AND is_active = true ORDER BY name`,
        { replacements: { clinicId } }
      );
    }
    res.json(types);
  } catch (error) {
    console.error('Error fetching leave types:', error);
    res.status(500).json({ error: 'Failed to fetch leave types' });
  }
});

router.post('/types', authorize('hr.leave.write'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ error: 'Name is required' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO leave_types (id, clinic_id, name, default_annual_days, is_active, created_at, updated_at)
      VALUES (:id, :clinicId, :name, :days, true, NOW(), NOW())
    `, { replacements: { id, clinicId, name: b.name.trim(), days: parseFloat(b.default_annual_days) || 0 } });
    const [[created]] = await sequelize.query(`SELECT * FROM leave_types WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating leave type:', error);
    res.status(500).json({ error: 'Failed to create leave type' });
  }
});

router.put('/types/:id', authorize('hr.leave.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const b = req.body || {};
    const fields = {
      name: b.name?.trim(),
      default_annual_days: b.default_annual_days !== undefined ? parseFloat(b.default_annual_days) || 0 : undefined,
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
      `UPDATE leave_types SET ${setClauses.join(', ')} WHERE id = :id AND clinic_id = :clinicId`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Leave type not found' });
    const [[updated]] = await sequelize.query(`SELECT * FROM leave_types WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update leave type' });
  }
});

// ═══════════════════════════════════════════════════
// LEAVE REQUESTS
// ═══════════════════════════════════════════════════

router.get('/requests', authorize('hr.leave.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { status, employee_id } = req.query;
    const conditions = ['lr.clinic_id = :clinicId'];
    const replacements = { clinicId };
    if (status) { conditions.push('lr.status = :status'); replacements.status = status; }
    if (employee_id) { conditions.push('lr.employee_id = :employeeId'); replacements.employeeId = employee_id; }
    if (req.user?.role !== 'admin') {
      const branchId = req.branchContext?.branchId || req.user?.branchId;
      if (branchId) { conditions.push('lr.branch_id = :branchId'); replacements.branchId = branchId; }
    }

    const [requests] = await sequelize.query(`
      SELECT lr.*, e.first_name, e.last_name, e.employee_number, lt.name AS leave_type_name
      FROM leave_requests lr
      JOIN employees e ON e.id = lr.employee_id
      JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY lr.created_at DESC
    `, { replacements });
    res.json(requests);
  } catch (error) {
    console.error('Error fetching leave requests:', error);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

router.post('/requests', authorize('hr.leave.write'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.employee_id || !b.leave_type_id || !b.start_date || !b.end_date) {
      return res.status(400).json({ error: 'employee_id, leave_type_id, start_date, and end_date are required' });
    }
    if (b.end_date < b.start_date) return res.status(400).json({ error: 'End date must be on or after the start date' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[employee]] = await sequelize.query(
      `SELECT id FROM employees WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: b.employee_id, clinicId } }
    );
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const [[leaveType]] = await sequelize.query(
      `SELECT id, name, default_annual_days FROM leave_types WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: b.leave_type_id, clinicId } }
    );
    if (!leaveType) return res.status(404).json({ error: 'Leave type not found' });

    const days = calcDays(b.start_date, b.end_date);

    // A 0-day entitlement (e.g. the default "Unpaid Leave" type) means
    // "no fixed annual allowance", not "always over the limit" — that check
    // only makes sense for a type that actually carries a cap. Matched to
    // the request's own start year, same as the balance shown on the
    // employee's leave summary, so what the requester sees lines up with
    // what this enforces.
    const entitled = parseFloat(leaveType.default_annual_days) || 0;
    if (entitled > 0) {
      const year = new Date(`${b.start_date}T00:00:00Z`).getUTCFullYear();
      const [[takenRow]] = await sequelize.query(`
        SELECT COALESCE(SUM(days), 0) AS taken_days
        FROM leave_requests
        WHERE employee_id = :employeeId AND leave_type_id = :leaveTypeId AND status = 'approved'
          AND EXTRACT(YEAR FROM start_date) = :year
      `, { replacements: { employeeId: b.employee_id, leaveTypeId: b.leave_type_id, year } });
      const taken = parseFloat(takenRow.taken_days) || 0;
      const remaining = Math.max(entitled - taken, 0);
      if (days > remaining) {
        return res.status(400).json({
          error: `This request is for ${days} day(s) of ${leaveType.name}, but only ${remaining} day(s) remain of the ${entitled}-day annual entitlement for ${year}.`,
        });
      }
    }

    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO leave_requests (id, clinic_id, branch_id, employee_id, leave_type_id, start_date, end_date, days, reason, status, requested_by, notes, created_at, updated_at)
      VALUES (:id, :clinicId, :branchId, :employeeId, :leaveTypeId, :startDate, :endDate, :days, :reason, 'pending', :requestedBy, :notes, NOW(), NOW())
    `, {
      replacements: {
        id, clinicId, branchId: getCreateBranchId(req), employeeId: b.employee_id, leaveTypeId: b.leave_type_id,
        startDate: b.start_date, endDate: b.end_date, days, reason: b.reason || null,
        requestedBy: req.user?.id || null, notes: b.notes || null,
      }
    });
    const [[created]] = await sequelize.query(`SELECT * FROM leave_requests WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating leave request:', error);
    res.status(500).json({ error: 'Failed to create leave request' });
  }
});

// Audit finding: approve/reject/cancel below only ever scoped their UPDATE
// by clinic_id, unlike GET /requests (just above) which also restricts a
// non-admin to their own branch_id. A branch-scoped HR user could approve,
// reject, or cancel a leave request belonging to a different branch in the
// same clinic simply by knowing/guessing its id. Mirrors GET /requests'
// own inline branch-scoping so the same request is reachable the same way
// whether reading or mutating it.
function nonAdminBranchId(req) {
  if (req.user?.role === 'admin') return null;
  return req.branchContext?.branchId || req.user?.branchId || null;
}

router.post('/requests/:id/approve', requireApprovalPermission('leave_request_approve'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['id = :id', 'clinic_id = :clinicId', "status = 'pending'"];
    const replacements = { id: req.params.id, clinicId, userId: req.user?.id || null };
    const branchId = nonAdminBranchId(req);
    if (branchId) { conditions.push('branch_id = :branchId'); replacements.branchId = branchId; }
    const [, meta] = await sequelize.query(
      `UPDATE leave_requests SET status = 'approved', approved_by = :userId, approved_at = NOW(), updated_at = NOW()
       WHERE ${conditions.join(' AND ')}`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Request not found or not pending' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve leave request' });
  }
});

router.post('/requests/:id/reject', requireApprovalPermission('leave_request_approve'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { reason } = req.body || {};
    const conditions = ['id = :id', 'clinic_id = :clinicId', "status = 'pending'"];
    const replacements = { id: req.params.id, clinicId, userId: req.user?.id || null, reason: reason || null };
    const branchId = nonAdminBranchId(req);
    if (branchId) { conditions.push('branch_id = :branchId'); replacements.branchId = branchId; }
    const [, meta] = await sequelize.query(
      `UPDATE leave_requests SET status = 'rejected', approved_by = :userId, approved_at = NOW(), rejection_reason = :reason, updated_at = NOW()
       WHERE ${conditions.join(' AND ')}`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Request not found or not pending' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject leave request' });
  }
});

router.post('/requests/:id/cancel', authorize('hr.leave.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['id = :id', 'clinic_id = :clinicId', "status IN ('pending', 'approved')"];
    const replacements = { id: req.params.id, clinicId };
    const branchId = nonAdminBranchId(req);
    if (branchId) { conditions.push('branch_id = :branchId'); replacements.branchId = branchId; }
    const [, meta] = await sequelize.query(
      `UPDATE leave_requests SET status = 'cancelled', updated_at = NOW()
       WHERE ${conditions.join(' AND ')}`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Only a pending or approved request can be cancelled' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel leave request' });
  }
});

// ═══════════════════════════════════════════════════
// PER-EMPLOYEE LEAVE SUMMARY (entitlement / taken / remaining)
// ═══════════════════════════════════════════════════

router.get('/employees/:id/summary', authorize('hr.leave.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const employeeReplacements = { id: req.params.id, clinicId };
    let employeeBranchSQL = '';
    if (req.user?.role !== 'admin') {
      const branchId = req.branchContext?.branchId || req.user?.branchId;
      if (branchId) { employeeBranchSQL = ' AND branch_id = :branchId'; employeeReplacements.branchId = branchId; }
    }
    const [[employee]] = await sequelize.query(
      `SELECT id, first_name, last_name, employee_number FROM employees WHERE id = :id AND clinic_id = :clinicId${employeeBranchSQL}`,
      { replacements: employeeReplacements }
    );
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    let [types] = await sequelize.query(
      `SELECT * FROM leave_types WHERE clinic_id = :clinicId AND is_active = true ORDER BY name`,
      { replacements: { clinicId } }
    );
    if (types.length === 0) {
      for (const t of DEFAULT_LEAVE_TYPES) {
        await sequelize.query(`
          INSERT INTO leave_types (id, clinic_id, name, default_annual_days, is_active, created_at, updated_at)
          VALUES (:id, :clinicId, :name, :days, true, NOW(), NOW())
        `, { replacements: { id: uuidv4(), clinicId, name: t.name, days: t.default_annual_days } });
      }
      [types] = await sequelize.query(
        `SELECT * FROM leave_types WHERE clinic_id = :clinicId AND is_active = true ORDER BY name`,
        { replacements: { clinicId } }
      );
    }

    // Only approved requests count against the entitlement — pending/rejected/
    // cancelled ones don't consume days. Matched to the request's own start
    // year (a request spanning New Year's Eve into the next year is a rare
    // enough edge case to not need splitting for this).
    const [taken] = await sequelize.query(`
      SELECT leave_type_id, COALESCE(SUM(days), 0) AS taken_days
      FROM leave_requests
      WHERE employee_id = :id AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = :year
      GROUP BY leave_type_id
    `, { replacements: { id: req.params.id, year } });
    const takenByType = Object.fromEntries(taken.map(t => [t.leave_type_id, parseFloat(t.taken_days) || 0]));

    const summary = types.map(t => {
      const entitled = parseFloat(t.default_annual_days) || 0;
      const takenDays = takenByType[t.id] || 0;
      return {
        leave_type_id: t.id, leave_type_name: t.name,
        entitled_days: entitled, taken_days: takenDays,
        remaining_days: Math.max(entitled - takenDays, 0),
      };
    });

    const [history] = await sequelize.query(`
      SELECT lr.*, lt.name AS leave_type_name
      FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id = :id
      ORDER BY lr.start_date DESC
      LIMIT 50
    `, { replacements: { id: req.params.id } });

    res.json({ employee, year, summary, history });
  } catch (error) {
    console.error('Error fetching leave summary:', error);
    res.status(500).json({ error: 'Failed to fetch leave summary' });
  }
});

module.exports = router;
