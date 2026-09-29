// Operating Theatre / OR module — requests, rooms, and the full lifecycle of
// an operation (schedule -> start -> checklist/vitals -> complete/cancel).
// req.models is the tenant-scoped connection set up by tenantContext (see
// reportOccupancy.js's own header comment) — safe to use directly, unlike
// require('../config/database').
const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
const TheatreService = require('../services/TheatreService');

// Same inline branch-scoping convention as accounting.js/hr.js/fixedAssets.js.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

function getCreateBranchId(req) {
  if (!req.user) return null;
  return req.branchContext?.branchId || req.user.branchId || null;
}

async function logAudit(req, { action, entity_type: entityType, entity_id: entityId, description, new_values: newValues }) {
  try {
    const rr = require('./reports');
    await rr.logAudit({
      req, clinic_id: req.body?.clinic_id || req.query?.clinic_id || req.user?.clinicId || 1,
      user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
      module: 'Theatre', action, entity_type: entityType, entity_id: entityId, description,
      new_values: newValues, ip_address: req.ip, status: 'success',
    });
  } catch (e) { /* audit logging is best-effort */ }
}

// ── Patient search ──────────────────────────────────────────────────────

router.get('/patients/search', authorize('theatre.view'), async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);
  try {
    res.json(await TheatreService.searchPatients(q.trim()));
  } catch (error) {
    console.error('Error searching patients for theatre:', error);
    res.status(500).json({ error: 'Failed to search patients' });
  }
});

// ── Rooms ───────────────────────────────────────────────────────────────

router.get('/rooms', authorize('theatre.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const replacements = { clinicId };
    const branchSql = branchScope(req, replacements);
    const [rows] = await sequelize.query(`SELECT * FROM theatre_rooms WHERE clinic_id = :clinicId ${branchSql} ORDER BY name`, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing theatre rooms:', error);
    res.status(500).json({ error: 'Failed to list theatre rooms' });
  }
});

router.post('/rooms', authorize('theatre.write'), async (req, res) => {
  const { sequelize } = req.models;
  const { v4: uuidv4 } = require('uuid');
  const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
  const { name, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO theatre_rooms (id, clinic_id, branch_id, name, notes) VALUES (:id, :clinicId, :branchId, :name, :notes)`,
      { replacements: { id, clinicId, branchId: req.body.branch_id || getCreateBranchId(req), name: name.trim(), notes: notes || null } }
    );
    const [[created]] = await sequelize.query(`SELECT * FROM theatre_rooms WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating theatre room:', error);
    res.status(500).json({ error: 'Failed to create theatre room' });
  }
});

router.put('/rooms/:id', authorize('theatre.write'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
  const { name, status, notes, is_active: isActive } = req.body;
  if (status && !['available', 'in_use', 'cleaning', 'maintenance'].includes(status)) {
    return res.status(400).json({ error: 'status must be available, in_use, cleaning, or maintenance' });
  }
  try {
    const [[existing]] = await sequelize.query(`SELECT id FROM theatre_rooms WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id: req.params.id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Room not found' });
    await sequelize.query(
      `UPDATE theatre_rooms SET name = COALESCE(:name, name), status = COALESCE(:status, status), notes = COALESCE(:notes, notes), is_active = COALESCE(:isActive, is_active), updated_at = NOW() WHERE id = :id`,
      { replacements: { id: req.params.id, name: name || null, status: status || null, notes: notes != null ? notes : null, isActive: isActive != null ? isActive : null } }
    );
    const [[updated]] = await sequelize.query(`SELECT * FROM theatre_rooms WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating theatre room:', error);
    res.status(500).json({ error: 'Failed to update theatre room' });
  }
});

// ── Requests ────────────────────────────────────────────────────────────

router.get('/requests', authorize('theatre.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const replacements = { clinicId };
    const branchSql = branchScope(req, replacements, 't');
    let sql = `
      SELECT t.*, COALESCE(p.first_name, lp.first_name) AS patient_first_name, COALESCE(p.last_name, lp.last_name) AS patient_last_name,
             COALESCE(p.patient_id, lp.participant_number) AS patient_code
      FROM theatre_requests t
      LEFT JOIN patients p ON p.id = t.patient_id
      LEFT JOIN lis_participants lp ON lp.id = t.patient_id
      WHERE t.clinic_id = :clinicId ${branchSql}`;
    if (req.query.status) { sql += ' AND t.status = :status'; replacements.status = req.query.status; }
    sql += ` ORDER BY CASE t.priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, t.created_at DESC`;
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing theatre requests:', error);
    res.status(500).json({ error: 'Failed to list theatre requests' });
  }
});

router.post('/requests', authorize('theatre.write'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const request = await TheatreService.createRequest(
      { ...req.body, clinic_id: clinicId, branch_id: req.body.branch_id || getCreateBranchId(req) },
      req.user?.id
    );
    await logAudit(req, { action: 'REQUEST_CREATED', entity_type: 'TheatreRequest', entity_id: request.id, description: `Theatre request — ${request.procedure_name}`, new_values: request });
    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating theatre request:', error);
    res.status(400).json({ error: error.message || 'Failed to create theatre request' });
  }
});

router.post('/requests/:id/cancel', authorize('theatre.write'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const request = await TheatreService.cancelRequest(clinicId, req.params.id, req.body.reason);
    await logAudit(req, { action: 'REQUEST_CANCELLED', entity_type: 'TheatreRequest', entity_id: req.params.id, description: `Theatre request cancelled — ${req.body.reason || ''}` });
    res.json(request);
  } catch (error) {
    console.error('Error cancelling theatre request:', error);
    res.status(400).json({ error: error.message || 'Failed to cancel request' });
  }
});

// ── Operations ──────────────────────────────────────────────────────────

router.get('/operations', authorize('theatre.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const replacements = { clinicId };
    const branchSql = branchScope(req, replacements, 't');
    let sql = `
      SELECT t.*, COALESCE(p.first_name, lp.first_name) AS patient_first_name, COALESCE(p.last_name, lp.last_name) AS patient_last_name,
             COALESCE(p.patient_id, lp.participant_number) AS patient_code,
             r.name AS room_name, s.first_name AS surgeon_first_name, s.last_name AS surgeon_last_name
      FROM theatre_operations t
      LEFT JOIN patients p ON p.id = t.patient_id
      LEFT JOIN lis_participants lp ON lp.id = t.patient_id
      LEFT JOIN theatre_rooms r ON r.id = t.theatre_room_id
      LEFT JOIN employees s ON s.id = t.surgeon_employee_id
      WHERE t.clinic_id = :clinicId ${branchSql}`;
    if (req.query.status) { sql += ' AND t.status = :status'; replacements.status = req.query.status; }
    sql += ' ORDER BY t.scheduled_at DESC NULLS LAST, t.created_at DESC';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing theatre operations:', error);
    res.status(500).json({ error: 'Failed to list theatre operations' });
  }
});

router.get('/operations/:id', authorize('theatre.view'), async (req, res) => {
  try {
    const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
    const operation = await TheatreService.getOperation(clinicId, req.params.id);
    if (!operation) return res.status(404).json({ error: 'Operation not found' });
    res.json(operation);
  } catch (error) {
    console.error('Error fetching theatre operation:', error);
    res.status(500).json({ error: 'Failed to fetch operation' });
  }
});

router.post('/operations', authorize('theatre.write'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const operation = await TheatreService.scheduleOperation(
      { ...req.body, clinic_id: clinicId, branch_id: req.body.branch_id || getCreateBranchId(req) },
      req.user?.id
    );
    await logAudit(req, { action: 'OPERATION_SCHEDULED', entity_type: 'TheatreOperation', entity_id: operation.id, description: `Scheduled operation — ${operation.procedure_name}` });
    res.status(201).json(operation);
  } catch (error) {
    console.error('Error scheduling theatre operation:', error);
    res.status(400).json({ error: error.message || 'Failed to schedule operation' });
  }
});

router.post('/operations/:id/start', authorize('theatre.write'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const operation = await TheatreService.startOperation(clinicId, req.params.id, req.user?.id);
    await logAudit(req, { action: 'OPERATION_STARTED', entity_type: 'TheatreOperation', entity_id: req.params.id, description: 'Operation started' });
    res.json(operation);
  } catch (error) {
    console.error('Error starting theatre operation:', error);
    res.status(400).json({ error: error.message || 'Failed to start operation' });
  }
});

router.post('/operations/:id/complete', authorize('theatre.write'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const operation = await TheatreService.completeOperation(clinicId, req.params.id, req.body, req.user?.id);
    await logAudit(req, { action: 'OPERATION_COMPLETED', entity_type: 'TheatreOperation', entity_id: req.params.id, description: `Operation completed — outcome: ${req.body.outcome}`, new_values: { outcome: req.body.outcome, duration_minutes: operation.duration_minutes } });
    res.json(operation);
  } catch (error) {
    console.error('Error completing theatre operation:', error);
    res.status(400).json({ error: error.message || 'Failed to complete operation' });
  }
});

router.post('/operations/:id/cancel', authorize('theatre.write'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const operation = await TheatreService.cancelOperation(clinicId, req.params.id, req.body.reason);
    await logAudit(req, { action: 'OPERATION_CANCELLED', entity_type: 'TheatreOperation', entity_id: req.params.id, description: `Operation cancelled — ${req.body.reason || ''}` });
    res.json(operation);
  } catch (error) {
    console.error('Error cancelling theatre operation:', error);
    res.status(400).json({ error: error.message || 'Failed to cancel operation' });
  }
});

router.put('/operations/:id/checklist/:itemId', authorize('theatre.write'), async (req, res) => {
  try {
    const item = await TheatreService.toggleChecklistItem(req.params.id, req.params.itemId, req.body.checked, req.user?.id);
    res.json(item);
  } catch (error) {
    console.error('Error updating checklist item:', error);
    res.status(400).json({ error: error.message || 'Failed to update checklist item' });
  }
});

router.post('/operations/:id/checklist', authorize('theatre.write'), async (req, res) => {
  try {
    const item = await TheatreService.addChecklistItem(req.params.id, req.body.phase, req.body.item_text);
    res.status(201).json(item);
  } catch (error) {
    console.error('Error adding checklist item:', error);
    res.status(400).json({ error: error.message || 'Failed to add checklist item' });
  }
});

router.post('/operations/:id/vitals', authorize('theatre.write'), async (req, res) => {
  try {
    const vitals = await TheatreService.recordVitals(req.params.id, req.body, req.user?.id);
    res.status(201).json(vitals);
  } catch (error) {
    console.error('Error recording vitals:', error);
    res.status(400).json({ error: error.message || 'Failed to record vitals' });
  }
});

module.exports = router;
