// Operating Theatre / OR module — requests, rooms, and the full lifecycle of
// an operation (schedule -> start -> checklist/vitals -> complete/cancel).
// req.models is the tenant-scoped connection set up by tenantContext (see
// reportOccupancy.js's own header comment) — safe to use directly, unlike
// require('../config/database').
const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
const TheatreService = require('../services/TheatreService');
const BranchQueryFilter = require('../services/BranchQueryFilter');

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

// T10/T11: TheatreService attaches a real statusCode to what it throws
// (httpError) — this reads it back instead of every route flattening every
// failure to one blanket code (writes used to always be 400, reads always
// 500, so "not found" and "wrong state" and "bad input" were indistinguishable
// to a client). Falls back to the route's own historical default for an
// error the service didn't specifically classify.
function statusFor(error, fallback) {
  return error?.statusCode || fallback;
}

// T5: branch isolation. TheatreService's own lookups only ever filtered by
// clinic_id — a branch-scoped user who knew (or guessed/enumerated) another
// branch's operation/request id could view or act on it, same class of gap
// already closed elsewhere in this app (BranchQueryFilter.canAccessRecord).
// Checked at the route layer, before the service call that would act on it,
// against a lightweight fetch of just the record's own branch_id.
async function assertBranchAccess(req, res, table, id) {
  const { sequelize } = req.models;
  const [[record]] = await sequelize.query(`SELECT branch_id FROM ${table} WHERE id = :id`, { replacements: { id } });
  if (!record) {
    res.status(404).json({ error: `${table === 'theatre_requests' ? 'Request' : 'Operation'} not found` });
    return false;
  }
  if (!BranchQueryFilter.canAccessRecord(record, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
    res.status(403).json({ error: `Access denied to this ${table === 'theatre_requests' ? 'request' : 'operation'}` });
    return false;
  }
  return true;
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
// Rooms are added/edited at /setup/rooms (the general rooms table, tagged
// room_type = 'or') — not here. This just lists the OR-tagged ones with
// their live status, and start/complete/cancel (in TheatreService) update
// that status as an operation moves through the room.

router.get('/rooms', authorize('theatre.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const replacements = { clinicId };
    const branchSql = branchScope(req, replacements, 'r');
    const [rows] = await sequelize.query(
      `SELECT r.id, r.room_number AS name, COALESCE(trs.status, 'available') AS status
       FROM rooms r
       LEFT JOIN theatre_room_status trs ON trs.room_id = r.id
       WHERE r.clinic_id = :clinicId AND r.room_type = 'or' AND r.is_active = true ${branchSql}
       ORDER BY r.room_number`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing theatre rooms:', error);
    res.status(500).json({ error: 'Failed to list theatre rooms' });
  }
});

// ── Inventory (drugs/consumables/blood used during an operation) ────────
// Proxies stock_locations/inventory_items rather than requiring
// inventory.read/inventory.write — a nurse/doctor with theatre.write
// shouldn't need full inventory-management access just to pick a location
// and search what's on its shelf.

router.get('/locations', authorize('theatre.write'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const [rows] = await sequelize.query(
      `SELECT id, location_code, location_name, location_type FROM stock_locations WHERE clinic_id = :clinicId AND is_active = true ORDER BY location_name`,
      { replacements: { clinicId } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing locations for theatre:', error);
    res.status(500).json({ error: 'Failed to list locations' });
  }
});

router.get('/items/search', authorize('theatre.write'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  const { location_id: locationId, q, category, exclude_category: excludeCategory } = req.query;
  if (!locationId) return res.status(400).json({ error: 'location_id is required' });
  try {
    const replacements = { clinicId, locationId };
    let sql = `
      SELECT i.id, i.item_name, i.item_code, i.unit_of_measure, i.item_category,
             COALESCE(loc.quantity_on_hand, 0) AS available_quantity
      FROM inventory_items i
      LEFT JOIN stock_by_location loc ON loc.item_id = i.id AND loc.location_id = :locationId
      WHERE i.clinic_id = :clinicId AND i.is_active = true
        AND EXISTS (SELECT 1 FROM stock_by_location sbl WHERE sbl.item_id = i.id AND sbl.location_id = :locationId AND sbl.quantity_on_hand > 0)`;
    if (q && q.trim()) { sql += ' AND (i.item_name ILIKE :q OR i.item_code ILIKE :q)'; replacements.q = `%${q.trim()}%`; }
    // Lets the "Blood Used" section search only blood-category items, and
    // "Drugs & Consumables" exclude them, from this same endpoint.
    if (category) { sql += ' AND i.item_category = :category'; replacements.category = category; }
    if (excludeCategory) { sql += ' AND (i.item_category IS DISTINCT FROM :excludeCategory)'; replacements.excludeCategory = excludeCategory; }
    sql += ' ORDER BY i.item_name LIMIT 30';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error searching items for theatre:', error);
    res.status(500).json({ error: 'Failed to search items' });
  }
});

router.post('/operations/:id/items', authorize('theatre.write'), async (req, res) => {
  try {
    if (!(await assertBranchAccess(req, res, 'theatre_operations', req.params.id))) return;
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const usage = await TheatreService.recordItemUsage(clinicId, req.params.id, req.body, req.user?.id);
    await logAudit(req, { action: 'ITEM_USED', entity_type: 'TheatreOperation', entity_id: req.params.id, description: `Used ${usage.quantity} ${usage.unit_of_measure || ''} of ${usage.item_name}`, new_values: usage });
    res.status(201).json(usage);
  } catch (error) {
    console.error('Error recording item usage for theatre operation:', error);
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to record item usage' });
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
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to create theatre request' });
  }
});

router.post('/requests/:id/cancel', authorize('theatre.write'), async (req, res) => {
  try {
    if (!(await assertBranchAccess(req, res, 'theatre_requests', req.params.id))) return;
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const request = await TheatreService.cancelRequest(clinicId, req.params.id, req.body.reason);
    await logAudit(req, { action: 'REQUEST_CANCELLED', entity_type: 'TheatreRequest', entity_id: req.params.id, description: `Theatre request cancelled — ${req.body.reason || ''}` });
    res.json(request);
  } catch (error) {
    console.error('Error cancelling theatre request:', error);
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to cancel request' });
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
             r.room_number AS room_name, s.first_name AS surgeon_first_name, s.last_name AS surgeon_last_name
      FROM theatre_operations t
      LEFT JOIN patients p ON p.id = t.patient_id
      LEFT JOIN lis_participants lp ON lp.id = t.patient_id
      LEFT JOIN rooms r ON r.id = t.theatre_room_id
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
    if (!(await assertBranchAccess(req, res, 'theatre_operations', req.params.id))) return;
    const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
    const operation = await TheatreService.getOperation(clinicId, req.params.id);
    if (!operation) return res.status(404).json({ error: 'Operation not found' });
    res.json(operation);
  } catch (error) {
    console.error('Error fetching theatre operation:', error);
    res.status(statusFor(error, 500)).json({ error: 'Failed to fetch operation' });
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
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to schedule operation' });
  }
});

router.post('/operations/:id/start', authorize('theatre.write'), async (req, res) => {
  try {
    if (!(await assertBranchAccess(req, res, 'theatre_operations', req.params.id))) return;
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const operation = await TheatreService.startOperation(clinicId, req.params.id, req.user?.id);
    await logAudit(req, { action: 'OPERATION_STARTED', entity_type: 'TheatreOperation', entity_id: req.params.id, description: 'Operation started' });
    res.json(operation);
  } catch (error) {
    console.error('Error starting theatre operation:', error);
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to start operation' });
  }
});

router.post('/operations/:id/complete', authorize('theatre.write'), async (req, res) => {
  try {
    if (!(await assertBranchAccess(req, res, 'theatre_operations', req.params.id))) return;
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const operation = await TheatreService.completeOperation(clinicId, req.params.id, req.body, req.user?.id);
    await logAudit(req, { action: 'OPERATION_COMPLETED', entity_type: 'TheatreOperation', entity_id: req.params.id, description: `Operation completed — outcome: ${req.body.outcome}`, new_values: { outcome: req.body.outcome, duration_minutes: operation.duration_minutes } });
    res.json(operation);
  } catch (error) {
    console.error('Error completing theatre operation:', error);
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to complete operation' });
  }
});

router.post('/operations/:id/cancel', authorize('theatre.write'), async (req, res) => {
  try {
    if (!(await assertBranchAccess(req, res, 'theatre_operations', req.params.id))) return;
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const operation = await TheatreService.cancelOperation(clinicId, req.params.id, req.body.reason);
    await logAudit(req, { action: 'OPERATION_CANCELLED', entity_type: 'TheatreOperation', entity_id: req.params.id, description: `Operation cancelled — ${req.body.reason || ''}` });
    res.json(operation);
  } catch (error) {
    console.error('Error cancelling theatre operation:', error);
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to cancel operation' });
  }
});

router.put('/operations/:id/checklist/:itemId', authorize('theatre.write'), async (req, res) => {
  try {
    if (!(await assertBranchAccess(req, res, 'theatre_operations', req.params.id))) return;
    const item = await TheatreService.toggleChecklistItem(req.params.id, req.params.itemId, req.body.checked, req.user?.id);
    res.json(item);
  } catch (error) {
    console.error('Error updating checklist item:', error);
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to update checklist item' });
  }
});

router.post('/operations/:id/checklist', authorize('theatre.write'), async (req, res) => {
  try {
    if (!(await assertBranchAccess(req, res, 'theatre_operations', req.params.id))) return;
    const item = await TheatreService.addChecklistItem(req.params.id, req.body.phase, req.body.item_text);
    res.status(201).json(item);
  } catch (error) {
    console.error('Error adding checklist item:', error);
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to add checklist item' });
  }
});

router.post('/operations/:id/vitals', authorize('theatre.write'), async (req, res) => {
  try {
    if (!(await assertBranchAccess(req, res, 'theatre_operations', req.params.id))) return;
    const vitals = await TheatreService.recordVitals(req.params.id, req.body, req.user?.id);
    res.status(201).json(vitals);
  } catch (error) {
    console.error('Error recording vitals:', error);
    res.status(statusFor(error, 400)).json({ error: error.message || 'Failed to record vitals' });
  }
});

// T4: after completeOperation marks a room 'cleaning', nothing ever moved it
// back to 'available' — the room stayed permanently blocked in the OR board
// until someone manually fixed the row in the database. This is that missing
// step: staff mark the room ready once it's actually been cleaned/turned over.
router.post('/rooms/:id/ready', authorize('theatre.write'), async (req, res) => {
  try {
    const { sequelize } = req.models;
    const [[room]] = await sequelize.query(`SELECT branch_id FROM rooms WHERE id = :id AND room_type = 'or'`, { replacements: { id: req.params.id } });
    if (!room) return res.status(404).json({ error: 'Theatre room not found' });
    if (!BranchQueryFilter.canAccessRecord(room, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this room' });
    }
    await TheatreService.setRoomReady(req.params.id);
    await logAudit(req, { action: 'ROOM_MARKED_READY', entity_type: 'TheatreRoom', entity_id: req.params.id, description: 'Room marked ready after cleaning' });
    res.json({ id: req.params.id, status: 'available' });
  } catch (error) {
    console.error('Error marking theatre room ready:', error);
    res.status(statusFor(error, 500)).json({ error: error.message || 'Failed to mark room ready' });
  }
});

module.exports = router;
