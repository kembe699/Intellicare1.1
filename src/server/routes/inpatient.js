const express = require('express');
const { isUniqueViolation, isDuplicateColumn } = require('../utils/dbErrors');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const redisCache = require('../services/RedisCache');
const { findInsufficientStockLine } = require('../utils/checkDrugStock');

// doctor_notes.vital_signs / nursing_notes.vital_signs are stored via
// JSON.stringify() on write (see POST handlers below), but this schema's
// column type doesn't come back auto-parsed on read the way a real
// json/jsonb column would — confirmed live: GET returned it as the raw
// string `"{\"temperature\":...}"`, so every `vital_signs.temperature`-style
// read on the frontend silently evaluated to undefined (a string has no
// such property) — the vitals line rendered with every value blank
// ("Temp: °C • BP: ..."), never an error, so it went unnoticed until now.
function parseVitalSigns(row) {
  if (typeof row.vital_signs === 'string') {
    try { row.vital_signs = JSON.parse(row.vital_signs); } catch { /* leave as-is */ }
  }
  return row;
}

// doctor_notes/nursing_notes.vital_signs only lives inside
// migrateInpatientTables.js's CREATE TABLE statements, which are a no-op
// for a tenant whose table already existed before that column was added —
// confirmed live: POST /nursing-notes 500'd in tenant_nation the moment
// the nursing form actually started sending vital_signs (previously the
// column had simply never been written to, so the gap stayed invisible).
// migrateAcrossTenants now also runs an explicit ALTER for this on every
// boot, but that only takes effect on the next deploy/restart — this
// self-heals immediately, using the REQUEST-scoped connection (correctly
// resolved to the calling tenant). Cached per schema, not globally — one
// tenant succeeding can't mask another's still-missing column.
const vitalSignsColumnEnsuredSchemas = new Set();
async function ensureVitalSignsColumns(db, schema) {
  if (schema && vitalSignsColumnEnsuredSchemas.has(schema)) return;
  try {
    await db.query(`ALTER TABLE doctor_notes ADD COLUMN IF NOT EXISTS vital_signs JSON`);
    await db.query(`ALTER TABLE nursing_notes ADD COLUMN IF NOT EXISTS vital_signs JSON`);
    if (schema) vitalSignsColumnEnsuredSchemas.add(schema);
  } catch (e) {
    // Try again next call — don't cache a failure as done.
  }
}

// Non-admin users only see/touch rows from their own branch; admins see everything
// clinic-wide. Written inline with named replacements (not branchFilter.js's
// getBranchConditionSQL, which uses positional `?` placeholders that can't mix with
// the named :params every query in this file uses) — same idea as hr.js's branchScope.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

// Cross-branch FK safety check: wards.service_id references services.id with no DB-level
// branch check, so without this a ward could be linked to another branch's service now
// that services are branch-isolated too. NULL-inclusive (a legacy/shared, not-yet-backfilled
// service is a valid link for any branch) — same reasoning as labTests.js's serviceIsLinkable.
function serviceBelongsToBranch(service, req) {
  if (!service) return false;
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return true;
  const branchId = req.branchContext?.branchId || req.user?.branchId || null;
  if (!branchId) return true;
  if (!service.branch_id) return true;
  return String(service.branch_id) === String(branchId);
}

// Ward/room/bed layout is facility configuration — everyone who works with inpatient care
// needs to read it, but only admin changes it (matches the admin-only pattern already used
// for Clinics/Departments/Facilities in Setup).
// Admitting/discharging a patient — matches the sidebar's Admissions/Admitted Patients roles.
// Clinical documentation (doctor notes, prescriptions, drug administration, nursing notes)
// — no dedicated "nurse" role exists in this app's current role vocabulary, so these fall
// to doctor/admin, matching how the rest of the app gates clinical actions.
// Lab/radiology requests raised from the ward — doctor orders, lab/radiology-adjacent
// staff also need to see them; no separate radiology role exists either, so lab covers it.

// Bed/ward daily billing rate, used to charge patients for their stay.
(async () => {
  try {
    await sequelize.query(`ALTER TABLE wards ADD COLUMN daily_rate DECIMAL(10,2) DEFAULT 0`);
    console.log('✅ Added daily_rate to wards');
  } catch (e) {
    if (!isDuplicateColumn(e)) {
      console.log('Note: Could not add daily_rate to wards:', e.message);
    }
  }
  try {
    await sequelize.query(`ALTER TABLE wards ADD COLUMN service_id VARCHAR(36) DEFAULT NULL`);
    console.log('✅ Added service_id to wards');
  } catch (e) {
    if (!isDuplicateColumn(e)) {
      console.log('Note: Could not add service_id to wards:', e.message);
    }
  }
})();

// Second line of defense against bed double-booking, behind the atomic conditional
// UPDATE in POST /admissions below. A generated column that's only non-NULL while an
// admission is active means the database itself can never hold two 'active' rows for the
// same bed_id — MySQL treats every NULL as distinct under a UNIQUE index, so discharged/
// cancelled admissions (status != 'active') don't count against it, and the constraint
// self-maintains as admissions are discharged without any extra application code.
(async () => {
  try {
    const [[colCheck]] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'inpatient_admissions' AND column_name = 'active_bed_id'
    `);
    if (colCheck.cnt === 0) {
      await sequelize.query(`
        ALTER TABLE inpatient_admissions
        ADD COLUMN active_bed_id CHAR(36)
        GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN bed_id ELSE NULL END) STORED
      `);
      console.log('✅ Added inpatient_admissions.active_bed_id generated column');
    }
    const [[idxCheck]] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'inpatient_admissions' AND indexname = 'uniq_inpatient_admissions_active_bed'
    `);
    if (idxCheck.cnt === 0) {
      await sequelize.query(`CREATE UNIQUE INDEX uniq_inpatient_admissions_active_bed ON inpatient_admissions(active_bed_id)`);
      console.log('✅ Added unique index preventing two active admissions per bed');
    }
  } catch (e) {
    console.log('Note: Could not ensure unique active-bed constraint:', e.message);
  }
})();

// Admission requests — a doctor flags a patient for admission; ward staff later
// picks a ward/room/bed to turn the request into an actual inpatient_admissions row.
(async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS admission_requests (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        reason TEXT,
        diagnosis VARCHAR(500),
        requested_by VARCHAR(36),
        requested_by_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        admission_id CHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ admission_requests table ready');
  } catch (e) {
    console.log('Note: Could not create admission_requests table:', e.message);
  }
  try {
    await sequelize.query(`ALTER TABLE admission_requests ADD COLUMN diagnosis VARCHAR(500)`);
    console.log('✅ Added diagnosis to admission_requests');
  } catch (e) {
    if (!isDuplicateColumn(e)) {
      console.log('Note: Could not add diagnosis to admission_requests:', e.message);
    }
  }
})();

// ======================== WARDS ========================

// GET all wards
router.get('/wards', authorize('inpatient.facility.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { clinicId };
    const [rows] = await sequelize.query(
      `SELECT w.*, s.service_name, s.price as service_price,
        (SELECT COUNT(*) FROM beds b WHERE b.ward_id = w.id AND b.status = 'occupied') as current_occupancy,
        (SELECT COUNT(*) FROM beds b WHERE b.ward_id = w.id AND b.is_active = true) as total_beds,
        (SELECT COUNT(*) FROM rooms r WHERE r.ward_id = w.id AND r.is_active = true) as total_rooms
       FROM wards w LEFT JOIN services s ON s.id = w.service_id
       WHERE w.clinic_id = :clinicId AND w.is_active = true${branchScope(req, replacements, 'w')} ORDER BY w.name`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching wards:', error);
    console.error('SQL Error details:', error.original || error);
    res.status(500).json({ error: 'Failed to fetch wards', details: error.message });
  }
});

// POST create ward — billing rate is derived from the linked service's price, not typed manually
router.post('/wards', authorize('inpatient.facility.write'), async (req, res) => {
  try {
    // Validate before writing: wards.code and rooms.room_number are NOT NULL, so
    // a blank field reached the database as a constraint violation and came back
    // as a 500 "Failed to create" — which reads as a broken server rather than a
    // missing field.
    if (!req.body?.name?.trim() || !req.body?.code?.trim()) {
      return res.status(400).json({ error: 'Ward name and code are both required' });
    }
    const { name, code, description, ward_type, capacity, service_id } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();

    let dailyRate = 0;
    if (service_id) {
      const { Service } = require('../models');
      const service = await Service.findByPk(service_id);
      if (!serviceBelongsToBranch(service, req)) {
        return res.status(400).json({ error: 'Selected service does not belong to your branch' });
      }
      dailyRate = service ? parseFloat(service.price) || 0 : 0;
    }

    const branchId = getCreateBranchId(req);
    await sequelize.query(
      `INSERT INTO wards (id, clinic_id, name, code, description, ward_type, capacity, daily_rate, service_id, is_active, branch_id) VALUES (:id, :clinicId, :name, :code, :description, :wardType, :capacity, :dailyRate, :serviceId, TRUE, :branchId)`,
      { replacements: { id, clinicId, name, code, description: description || null, wardType: ward_type || 'general', capacity: parseInt(capacity) || 0, dailyRate, serviceId: service_id || null, branchId } }
    );
    res.status(201).json({ id, name, code, description, ward_type, capacity, daily_rate: dailyRate, service_id: service_id || null, branch_id: branchId });
  } catch (error) {
    console.error('Error creating ward:', error);
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'Ward code already exists' });
    }
    res.status(500).json({ error: 'Failed to create ward' });
  }
});

// PUT update ward — billing rate is derived from the linked service's price, not typed manually
router.put('/wards/:id', authorize('inpatient.facility.write'), async (req, res) => {
  try {
    const { name, code, description, ward_type, capacity, service_id } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    let dailyRate = 0;
    if (service_id) {
      const { Service } = require('../models');
      const service = await Service.findByPk(service_id);
      if (!serviceBelongsToBranch(service, req)) {
        return res.status(400).json({ error: 'Selected service does not belong to your branch' });
      }
      dailyRate = service ? parseFloat(service.price) || 0 : 0;
    }

    // clinic_id (and, for non-admins, branch_id) in the WHERE clause is the ownership
    // check itself (same pattern as the atomic bed-claim UPDATE in POST /admissions
    // below) — a non-admin can never match, let alone update, another clinic's or
    // another branch's ward.
    const replacements = { id: req.params.id, clinicId, name, code, description: description || null, wardType: ward_type || 'general', capacity: parseInt(capacity) || 0, dailyRate, serviceId: service_id || null };
    const [, meta] = await sequelize.query(
      `UPDATE wards SET name = :name, code = :code, description = :description, ward_type = :wardType, capacity = :capacity, daily_rate = :dailyRate, service_id = :serviceId WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Ward not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating ward:', error);
    res.status(500).json({ error: 'Failed to update ward' });
  }
});

// DELETE ward
router.delete('/wards/:id', authorize('inpatient.facility.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    // Check if ward has active admissions
    const [active] = await sequelize.query(
      `SELECT COUNT(*) as cnt FROM inpatient_admissions WHERE ward_id = :id AND status = 'active'`,
      { replacements: { id: req.params.id } }
    );
    if (active[0]?.cnt > 0) {
      return res.status(400).json({ error: 'Cannot delete ward with active admissions' });
    }
    const replacements = { id: req.params.id, clinicId };
    const [, meta] = await sequelize.query(`UPDATE wards SET is_active = false WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`, { replacements });
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Ward not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting ward:', error);
    res.status(500).json({ error: 'Failed to delete ward' });
  }
});

// ======================== ROOMS ========================

// GET rooms
router.get('/rooms', authorize('inpatient.facility.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const wardId = req.query.ward_id;
    let sql = `SELECT r.*, w.name as ward_name,
      (SELECT COUNT(*) FROM beds b WHERE b.room_id = r.id AND b.status = 'occupied') as current_occupancy,
      (SELECT COUNT(*) FROM beds b WHERE b.room_id = r.id AND b.is_active = true) as total_beds
      FROM rooms r LEFT JOIN wards w ON r.ward_id = w.id WHERE r.clinic_id = :clinicId AND r.is_active = true`;
    const replacements = { clinicId };
    if (wardId) { sql += ' AND r.ward_id = :wardId'; replacements.wardId = wardId; }
    sql += branchScope(req, replacements, 'r');
    sql += ' ORDER BY w.name, r.room_number';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// POST create room
router.post('/rooms', authorize('inpatient.facility.write'), async (req, res) => {
  try {
    if (!req.body?.room_number?.trim()) {
      return res.status(400).json({ error: 'Room number is required' });
    }
    const { ward_id, room_number, room_type, description, capacity } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();
    const branchId = getCreateBranchId(req);
    await sequelize.query(
      `INSERT INTO rooms (id, ward_id, clinic_id, room_number, room_type, description, capacity, is_active, branch_id) VALUES (:id, :wardId, :clinicId, :roomNumber, :roomType, :description, :capacity, TRUE, :branchId)`,
      { replacements: { id, wardId: ward_id || null, clinicId, roomNumber: room_number, roomType: room_type || 'standard', description: description || null, capacity: parseInt(capacity) || 0, branchId } }
    );
    res.status(201).json({ id, ward_id, room_number, room_type, description, capacity, branch_id: branchId });
  } catch (error) {
    console.error('Error creating room:', error);
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'Room number already exists in this clinic' });
    }
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// PUT update room
router.put('/rooms/:id', authorize('inpatient.facility.write'), async (req, res) => {
  try {
    const { room_number, room_type, description, capacity } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { id: req.params.id, clinicId, roomNumber: room_number, roomType: room_type || 'standard', description: description || null, capacity: parseInt(capacity) || 0 };
    const [, meta] = await sequelize.query(
      `UPDATE rooms SET room_number = :roomNumber, room_type = :roomType, description = :description, capacity = :capacity WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Room not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

// DELETE room
router.delete('/rooms/:id', authorize('inpatient.facility.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { id: req.params.id, clinicId };
    const [, meta] = await sequelize.query(`UPDATE rooms SET is_active = false WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`, { replacements });
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Room not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

// ======================== BEDS ========================

// GET beds
router.get('/beds', authorize('inpatient.facility.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const roomId = req.query.room_id;
    const wardId = req.query.ward_id;
    const status = req.query.status;
    let sql = `SELECT b.*, r.room_number, w.name as ward_name
      FROM beds b JOIN rooms r ON b.room_id = r.id JOIN wards w ON b.ward_id = w.id
      WHERE b.clinic_id = :clinicId AND b.is_active = true`;
    const replacements = { clinicId };
    if (roomId) { sql += ' AND b.room_id = :roomId'; replacements.roomId = roomId; }
    if (wardId) { sql += ' AND b.ward_id = :wardId'; replacements.wardId = wardId; }
    if (status) { sql += ' AND b.status = :status'; replacements.status = status; }
    sql += branchScope(req, replacements, 'b');
    sql += ' ORDER BY w.name, r.room_number, b.bed_number';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching beds:', error);
    res.status(500).json({ error: 'Failed to fetch beds' });
  }
});

// POST create bed
router.post('/beds', authorize('inpatient.facility.write'), async (req, res) => {
  try {
    const { room_id, ward_id, bed_number, bed_type, status } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();
    const bedStatus = status || 'available';
    const branchId = getCreateBranchId(req);
    await sequelize.query(
      `INSERT INTO beds (id, room_id, ward_id, clinic_id, bed_number, bed_type, status, is_active, branch_id) VALUES (:id, :roomId, :wardId, :clinicId, :bedNumber, :bedType, :status, TRUE, :branchId)`,
      { replacements: { id, roomId: room_id, wardId: ward_id, clinicId, bedNumber: bed_number, bedType: bed_type || 'standard', status: bedStatus, branchId } }
    );
    res.status(201).json({ id, room_id, ward_id, bed_number, bed_type, status: bedStatus, branch_id: branchId });
  } catch (error) {
    console.error('Error creating bed:', error);
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'Bed number already exists' });
    }
    res.status(500).json({ error: 'Failed to create bed' });
  }
});

// PUT update bed status
router.put('/beds/:id', authorize('inpatient.facility.write'), async (req, res) => {
  try {
    const { status, bed_number, bed_type } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const fields = [];
    const replacements = { id: req.params.id, clinicId };
    if (status) { fields.push('status = :status'); replacements.status = status; }
    if (bed_number) { fields.push('bed_number = :bedNumber'); replacements.bedNumber = bed_number; }
    if (bed_type) { fields.push('bed_type = :bedType'); replacements.bedType = bed_type; }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    const [, meta] = await sequelize.query(`UPDATE beds SET ${fields.join(', ')} WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`, { replacements });
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Bed not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating bed:', error);
    res.status(500).json({ error: 'Failed to update bed' });
  }
});

// DELETE bed
router.delete('/beds/:id', authorize('inpatient.facility.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [active] = await sequelize.query(
      `SELECT COUNT(*) as cnt FROM inpatient_admissions WHERE bed_id = :id AND status = 'active'`,
      { replacements: { id: req.params.id } }
    );
    if (active[0]?.cnt > 0) {
      return res.status(400).json({ error: 'Cannot delete bed with active admission' });
    }
    const replacements = { id: req.params.id, clinicId };
    const [, meta] = await sequelize.query(`UPDATE beds SET is_active = false WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`, { replacements });
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Bed not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting bed:', error);
    res.status(500).json({ error: 'Failed to delete bed' });
  }
});

// ======================== ADMISSION REQUESTS ========================

// GET admission requests
router.get('/admission-requests', authorize('inpatient.admissions.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const status = req.query.status || 'pending';
    const [rows] = await sequelize.query(
      `SELECT * FROM admission_requests WHERE clinic_id = :clinicId AND status = :status ORDER BY created_at DESC`,
      { replacements: { clinicId, status } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching admission requests:', error);
    res.status(500).json({ error: 'Failed to fetch admission requests' });
  }
});

// POST create admission request (doctor flags a patient for admission)
router.post('/admission-requests', authorize('inpatient.admissions.write'), async (req, res) => {
  try {
    const { patient_id, patient_name, reason, diagnosis } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    if (!patient_id || !patient_name) return res.status(400).json({ error: 'Patient is required' });
    if (!diagnosis || !diagnosis.trim()) return res.status(400).json({ error: 'Diagnosis is required to request admission' });
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO admission_requests (id, clinic_id, patient_id, patient_name, reason, diagnosis, requested_by, requested_by_name)
       VALUES (:id, :clinicId, :patientId, :patientName, :reason, :diagnosis, :requestedBy, :requestedByName)`,
      { replacements: { id, clinicId, patientId: patient_id, patientName: patient_name, reason: reason || null, diagnosis: diagnosis.trim(), requestedBy: req.user?.id || null, requestedByName: req.user?.displayName || req.user?.email || 'Doctor' } }
    );
    res.status(201).json({ id, message: 'Admission requested' });
  } catch (error) {
    console.error('Error creating admission request:', error);
    res.status(500).json({ error: 'Failed to request admission' });
  }
});

// PUT cancel/decline an admission request
router.put('/admission-requests/:id/cancel', authorize('inpatient.admissions.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, meta] = await sequelize.query(`UPDATE admission_requests SET status = 'cancelled' WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id: req.params.id, clinicId } });
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Admission request not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling admission request:', error);
    res.status(500).json({ error: 'Failed to cancel admission request' });
  }
});

// ======================== ADMISSIONS ========================

// GET admissions
router.get('/admissions', authorize('inpatient.admissions.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const status = req.query.status;
    const search = req.query.search;
    let sql = `SELECT a.*,
      COALESCE(p.first_name, lp.first_name) as first_name,
      COALESCE(p.last_name, lp.last_name) as last_name,
      COALESCE(p.patient_id, lp.participant_number) as patient_number,
      COALESCE(p.date_of_birth, lp.date_of_birth) as date_of_birth,
      COALESCE(p.gender, lp.gender) as gender,
      (COALESCE(p.first_name, lp.first_name, '') || ' ' || COALESCE(p.last_name, lp.last_name, '')) as patient_name,
      w.name as ward_name, w.daily_rate as ward_daily_rate, r.room_number, be.bed_number,
      u.display_name as admitted_by_name,
      COALESCE(d.display_name, c.first_name || ' ' || c.last_name) as doctor_name
      FROM inpatient_admissions a
      LEFT JOIN patients p ON p.id = a.patient_id
      LEFT JOIN lis_participants lp ON lp.id = a.patient_id
      LEFT JOIN wards w ON a.ward_id = w.id
      LEFT JOIN rooms r ON a.room_id = r.id
      LEFT JOIN beds be ON a.bed_id = be.id
      LEFT JOIN users u ON u.id = a.admitted_by_user_id
      LEFT JOIN users d ON d.id = a.attending_doctor_id
      LEFT JOIN employees c ON c.id = a.consultant_id
      WHERE a.clinic_id = :clinicId`;
    const replacements = { clinicId };
    if (status) { sql += ' AND a.status = :status'; replacements.status = status; }
    if (req.query.discharge_outcome) { sql += ' AND a.discharge_outcome = :dischargeOutcome'; replacements.dischargeOutcome = req.query.discharge_outcome; }
    if (search) {
      sql += ` AND ((COALESCE(p.first_name, lp.first_name, '') || ' ' || COALESCE(p.last_name, lp.last_name, '')) LIKE :search OR p.patient_id LIKE :search OR lp.participant_number LIKE :search OR w.name LIKE :search)`;
      replacements.search = `%${search}%`;
    }
    sql += branchScope(req, replacements, 'a');
    sql += ' ORDER BY a.admission_date DESC';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching admissions:', error);
    res.status(500).json({ error: 'Failed to fetch admissions' });
  }
});

// GET single admission with full details
router.get('/admissions/:id', authorize('inpatient.admissions.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { id: req.params.id, clinicId };
    const [rows] = await sequelize.query(
      `SELECT a.*,
        (COALESCE(p.first_name, lp.first_name, '') || ' ' || COALESCE(p.last_name, lp.last_name, '')) as patient_name,
        COALESCE(p.patient_id, lp.participant_number) as patient_number,
        COALESCE(p.date_of_birth, lp.date_of_birth) as date_of_birth,
        COALESCE(p.gender, lp.gender) as gender,
        COALESCE(p.phone_number, lp.phone) as phone_number,
        w.name as ward_name, w.daily_rate as ward_daily_rate, r.room_number, be.bed_number,
        u.display_name as admitted_by_name,
        COALESCE(d.display_name, c.first_name || ' ' || c.last_name) as doctor_name
        FROM inpatient_admissions a
        LEFT JOIN patients p ON p.id = a.patient_id
        LEFT JOIN lis_participants lp ON lp.id = a.patient_id
        LEFT JOIN wards w ON a.ward_id = w.id
        LEFT JOIN rooms r ON a.room_id = r.id
        LEFT JOIN beds be ON a.bed_id = be.id
        LEFT JOIN users u ON u.id = a.admitted_by_user_id
        LEFT JOIN users d ON d.id = a.attending_doctor_id
        LEFT JOIN employees c ON c.id = a.consultant_id
        WHERE a.id = :id AND a.clinic_id = :clinicId${branchScope(req, replacements, 'a')}`,
      { replacements }
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Admission not found' });

    // Bring the bed-charge quantity up to date with today before responding, so whoever's
    // looking at this patient (and the bill they're about to open) sees the real day count
    // instead of whatever it was last time someone happened to view this admission.
    if (rows[0].status === 'active') {
      await reconcileBedCharge(req.params.id, getCreateBranchId(req));
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching admission:', error);
    res.status(500).json({ error: 'Failed to fetch admission' });
  }
});

// POST create admission
router.post('/admissions', authorize('inpatient.admissions.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { patient_id, ward_id, room_id, bed_id, admission_reason, diagnosis, diagnosis_code, admission_type, attending_doctor_id, consultant_id, request_id } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const userId = req.user?.id;
    const id = uuidv4();

    // Claim the bed atomically: the UPDATE's own WHERE clause is the check, so there's no
    // gap between "read status" and "write status" for a concurrent request to land in.
    // Postgres row-locks the matched row for the statement's duration, so a second
    // concurrent UPDATE against the same bed_id blocks until the first transaction
    // resolves, then re-evaluates `status = 'available'` against the now-committed row —
    // it correctly matches nothing and rowCount comes back 0.
    //
    // That check used to test claimMeta.affectedRows, a MySQL-era name this app's Postgres
    // driver never populates (pg's query result carries rowCount instead) — so it was
    // always `undefined === 0`, i.e. always false. The 409 branch below could never run: a
    // losing concurrent request still got a 201 and believed it had claimed the bed. There
    // is no unique constraint on beds/admissions backing this up either (checked directly —
    // only the ordinary, non-unique bed_id index exists), so this UPDATE's own atomicity was
    // the only thing standing between two admissions and the same physical bed.
    const [, claimMeta] = await sequelize.query(
      `UPDATE beds SET status = 'occupied' WHERE id = :bedId AND status = 'available'`,
      { replacements: { bedId: bed_id }, transaction: t }
    );
    if (claimMeta.rowCount === 0) {
      await t.rollback();
      const [bedCheck] = await sequelize.query(`SELECT id FROM beds WHERE id = :bedId`, { replacements: { bedId: bed_id } });
      if (bedCheck.length === 0) return res.status(404).json({ error: 'Bed not found' });
      return res.status(409).json({ error: 'Bed is not available — it was just taken by another admission' });
    }

    // Create admission. inpatient_admissions_active_bed_uniq (see
    // ensureInpatientBedUniqueness.js) is the second line of defense: even if this INSERT
    // somehow raced past the bed claim above, Postgres rejects a second 'active' row for
    // the same bed_id outright.
    // A consultant with no linked user account has no valid users.id to put in
    // attending_doctor_id (see ensureInpatientConsultantSupport.js) — goes in
    // consultant_id instead, and attending_doctor_id must stay null rather
    // than falling back to the admitting user, which would otherwise silently
    // credit them as the attending doctor instead of the chosen consultant.
    const doctorId = consultant_id ? null : (attending_doctor_id || userId);

    // branch_id is stamped from the acting user's own branch (getCreateBranchId), not
    // derived from the ward/bed — the ward and bed pickers now only ever offer the
    // user's own branch (GET /wards, GET /rooms, GET /beds are branch-filtered above),
    // so in normal use they always agree anyway.
    const branchId = getCreateBranchId(req);
    await sequelize.query(
      `INSERT INTO inpatient_admissions (id, clinic_id, patient_id, admission_date, bed_id, room_id, ward_id, admission_reason, diagnosis, diagnosis_code, admission_type, admitted_by_user_id, attending_doctor_id, consultant_id, branch_id)
       VALUES (:id, :clinicId, :patientId, NOW(), :bedId, :roomId, :wardId, :reason, :diagnosis, :diagnosisCode, :type, :userId, :doctorId, :consultantId, :branchId)`,
      { replacements: { id, clinicId, patientId: patient_id, bedId: bed_id, roomId: room_id, wardId: ward_id, reason: admission_reason, diagnosis: diagnosis || null, diagnosisCode: diagnosis_code || null, type: admission_type || 'planned', userId, doctorId, consultantId: consultant_id || null, branchId }, transaction: t }
    );

    // If this admission fulfills a pending request, close it out
    if (request_id) {
      await sequelize.query(
        `UPDATE admission_requests SET status = 'fulfilled', admission_id = :admissionId, updated_at = NOW() WHERE id = :requestId`,
        { replacements: { admissionId: id, requestId: request_id }, transaction: t }
      );
    }

    await t.commit();
    await chargeBedAdmission(id, branchId);

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Inpatient', action: 'PATIENT_ADMITTED', entity_type: 'Admission', entity_id: id,
        description: `Patient admitted — ${admission_reason || 'no reason given'}${diagnosis ? ` (${diagnosis})` : ''}`,
        new_values: { patient_id, bed_id, ward_id, admission_type: admission_type || 'planned' },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.status(201).json({ id, message: 'Patient admitted successfully' });
  } catch (error) {
    // t may already be committed by the time we get here (the error could come from
    // chargeBedAdmission/audit-log, which run AFTER commit) — rolling back a finished
    // transaction throws itself, and that second throw would go unhandled inside this
    // async handler and take the whole process down. Only roll back if it's still open.
    if (!t.finished) await t.rollback().catch(() => {});
    console.error('Error creating admission:', error);
    res.status(500).json({ error: 'Failed to admit patient' });
  }
});

// Best-effort: adds a line item to the patient's active bill (or creates one if none
// exists). Never blocks/rolls back the caller if billing fails.
//
// Previously this reimplemented its own "find the active bill" query — patient_id +
// clinic_id + status only, with no notion of visit at all. That meant a bed charge could
// land on whatever bill happened to be most-recently-created for the patient (including
// one from an older, unrelated encounter, or a bill from a same-day outpatient visit
// running in parallel with the admission), while the bill actually tied to *this*
// admission's visit got skipped — the charge existed, just not on the bill anyone was
// looking at. addLineItemsToBill resolves "the active bill" the same visit-scoped way
// GET /api/patient-bills/active/:patientId/:clinicId does, and locks the row for the
// duration of the read-modify-write so two charges landing close together (e.g. the
// admission charge and a same-second pharmacy charge) can't overwrite each other's total.
async function addBillLineItem(patientId, patientName, clinicId, branchId, lineItem, autoNote, admissionId) {
  try {
    const { addLineItemsToBill } = require('../utils/billingResolver');
    await addLineItemsToBill({
      patientId, patientName, clinicId, branchId, lineItems: [lineItem], notes: autoNote, createdBy: 'System',
      // Every inpatient charge already knows exactly which admission it belongs to —
      // pass it straight through instead of asking resolveActiveBill to re-derive "the
      // current visit" from ambient state. That resolution briefly disagrees with
      // reality right at discharge (see reconcileBedCharge's own call, a few lines
      // down, for the case that actually surfaced this): the admission's status has
      // already flipped to 'discharged' by the time the final charge lands, so a
      // lookup would find no active admission and start a brand new bill instead of
      // finishing the one this stay has been accumulating on all along.
      visitId: admissionId,
    });
  } catch (e) {
    console.error('Error adding bill line item:', e);
  }
}

async function getAdmissionBillingContext(admissionId) {
  const [[admission]] = await sequelize.query(
    `SELECT a.clinic_id, a.patient_id, a.admission_date, a.discharge_date, w.name as ward_name, w.daily_rate,
      COALESCE(p.first_name, lp.first_name, '') as first_name, COALESCE(p.last_name, lp.last_name, '') as last_name
     FROM inpatient_admissions a
     LEFT JOIN wards w ON a.ward_id = w.id
     LEFT JOIN patients p ON p.id = a.patient_id
     LEFT JOIN lis_participants lp ON lp.id = a.patient_id
     WHERE a.id = :id`,
    { replacements: { id: admissionId } }
  );
  return admission;
}

// Best-effort: charges the ward's linked service to the patient's bill immediately on admission.
// Uses a stable serviceName (no day-count baked into the text) so reconcileBedCharge can find
// and grow this exact same line every day the patient stays, instead of adding a new line.
async function chargeBedAdmission(admissionId, branchId) {
  try {
    const admission = await getAdmissionBillingContext(admissionId);
    if (!admission || !admission.daily_rate || parseFloat(admission.daily_rate) <= 0) return;

    const rate = parseFloat(admission.daily_rate);
    const patientName = `${admission.first_name} ${admission.last_name}`.trim() || 'Patient';
    const lineItem = { revenueCategory: 'inpatient', serviceName: `Bed Charge — ${admission.ward_name || 'Ward'}`, quantity: 1, unitPrice: rate, totalPrice: rate };
    await addBillLineItem(admission.patient_id, patientName, parseInt(admission.clinic_id) || 1, branchId, lineItem, 'Auto-generated inpatient bed charge on admission', admissionId);
  } catch (e) {
    console.error('Error charging bed on admission:', e);
  }
}

// Best-effort: brings the bed-charge line item's quantity up to the number of days the
// patient has actually been admitted, as of `asOfDate` (defaults to now — pass the real
// discharge_date when finalizing at discharge). Grows the SAME line created at admission
// rather than adding a second one, so the bill shows one steadily-increasing bed charge
// instead of a lump sum that only appears at discharge. Called on every admission-detail
// fetch for an active admission, so the quantity is always current whenever anyone looks —
// there's no background job ticking this over at midnight.
async function reconcileBedCharge(admissionId, branchId, asOfDate) {
  try {
    const admission = await getAdmissionBillingContext(admissionId);
    if (!admission || !admission.daily_rate || parseFloat(admission.daily_rate) <= 0) return;

    const end = asOfDate || new Date();
    const days = Math.max(1, Math.ceil((end - new Date(admission.admission_date)) / 86400000));
    const rate = parseFloat(admission.daily_rate);
    const patientName = `${admission.first_name} ${admission.last_name}`.trim() || 'Patient';
    const { updateOrAddLineItem } = require('../utils/billingResolver');
    await updateOrAddLineItem({
      patientId: admission.patient_id,
      patientName,
      clinicId: parseInt(admission.clinic_id) || 1,
      branchId,
      serviceName: `Bed Charge — ${admission.ward_name || 'Ward'}`,
      quantity: days,
      unitPrice: rate,
      notes: 'Auto-generated inpatient bed charge',
      createdBy: 'System',
      revenueCategory: 'inpatient',
      // This admission is known exactly, not derived — matters specifically at
      // discharge, the one time this runs after the admission's own status has
      // already flipped away from 'active' (see PUT /admissions/:id/discharge,
      // called right after the status UPDATE commits). Without this, the final
      // day-count reconciliation would find no "currently open" admission and
      // create a brand new bill for the last day's charge instead of finishing
      // the one the whole stay has been on.
      visitId: admissionId,
    });
  } catch (e) {
    console.error('Error reconciling bed charge:', e);
  }
}

// Best-effort: bills a clinical request (prescription, lab test, imaging) raised from the
// patient-details page against the admission's active bill. Resolves patient/clinic context
// server-side from the admission itself rather than trusting the request body, so a stale or
// tampered patient_name can't misdirect the charge.
async function billInpatientRequest(admissionId, branchId, lineItem, autoNote) {
  try {
    const admission = await getAdmissionBillingContext(admissionId);
    if (!admission) return;
    const patientName = `${admission.first_name} ${admission.last_name}`.trim() || 'Patient';
    await addBillLineItem(admission.patient_id, patientName, parseInt(admission.clinic_id) || 1, branchId, lineItem, autoNote, admissionId);
  } catch (e) {
    console.error('Error billing inpatient request:', e);
  }
}

// Best-effort: mirrors a ward prescription into the real pharmacy dispensing queue
// (pharmacy_prescriptions/prescription_lines — the tables Pharmacy's own UI reads from).
// Without this, a prescription written from the ward only ever exists in
// inpatient_prescriptions, which Pharmacy has no visibility into at all. Only runs when a
// real catalog drug was selected (drug_id present) — prescription_lines.drug_id is NOT NULL
// and must be an inventory_items.id, which a free-typed medication name can't satisfy.
async function mirrorPrescriptionToPharmacy(clinicId, patientId, doctorId, doctorName, admissionId, wardName, rx, branchId) {
  try {
    if (!rx.drug_id) return null;
    const id = uuidv4();
    const now = new Date();
    const prefix = `RX-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [countResult] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM pharmacy_prescriptions WHERE prescription_number LIKE :prefix`,
      { replacements: { prefix: `${prefix}%` } }
    );
    const seq = (countResult[0]?.cnt || 0) + 1;
    const rxNumber = `${prefix}-${String(seq).padStart(4, '0')}`;
    const rxDate = now.toISOString().split('T')[0];
    const validDays = 30;
    const expiresDate = new Date(now.getTime() + validDays * 86400000).toISOString().split('T')[0];

    // Both inserts must land together — a header row with no line would sit in the
    // pharmacy dispensing queue as a "ghost" prescription with nothing to dispense.
    const mirrorTxn = await sequelize.transaction();
    const lineId = uuidv4();
    try {
      await sequelize.query(
        `INSERT INTO pharmacy_prescriptions (id, clinic_id, branch_id, prescription_number, visit_id, patient_id, doctor_id,
          prescription_date, prescribed_by_name, prescription_notes, special_instructions,
          status, expires_date, valid_for_days, number_of_refills_allowed)
         VALUES (:id, :clinicId, :branchId, :rxNumber, NULL, :patientId, :doctorId, :rxDate, :doctorName,
          :notes, :instructions, 'pending', :expiresDate, :validDays, 0)`,
        { replacements: {
          id, clinicId, branchId: branchId || null, rxNumber, patientId, doctorId: doctorId || null, rxDate, doctorName: doctorName || null,
          notes: `Inpatient ward prescription — Admission ${admissionId}${wardName ? ` (${wardName})` : ''}`,
          instructions: rx.instructions || null, expiresDate, validDays,
        }, transaction: mirrorTxn }
      );

      await sequelize.query(
        `INSERT INTO prescription_lines (id, prescription_id, line_number, drug_id,
          quantity_prescribed, unit_of_measure, dose_strength, frequency, duration_days,
          allow_generic_substitution, notes)
         VALUES (:id, :rxId, 1, :drugId, :qty, :uom, :doseStrength, :frequency, :durationDays, true, :notes)`,
        { replacements: {
          id: lineId, rxId: id, drugId: rx.drug_id, qty: Math.max(1, parseInt(rx.quantity) || 1),
          uom: rx.unit_of_measure || 'unit', doseStrength: rx.dosage || null, frequency: rx.frequency || null,
          durationDays: parseInt(rx.duration) || null, notes: rx.instructions || null,
        }, transaction: mirrorTxn }
      );
      await mirrorTxn.commit();
    } catch (innerErr) {
      if (!mirrorTxn.finished) await mirrorTxn.rollback().catch(() => {});
      throw innerErr;
    }
    return lineId;
  } catch (e) {
    console.error('Error mirroring inpatient prescription to pharmacy:', e);
    return null;
  }
}

// Best-effort: mirrors a ward lab request into the real LIS collection queue
// (lis_test_orders/lis_specimens — the tables /lis/collection reads from). Only runs when
// the admitted patient is actually registered as an lis_participants record — patients and
// lis_participants are two separate registries in this app with no bridge between them, so
// an OPD-only patient with no LIS registration is skipped rather than producing a specimen
// row LIS can never resolve back to a person.
//
// Bug: this never took a branchId at all, unlike its sibling mirrorPrescriptionToPharmacy,
// so every row it created landed with branch_id NULL — invisible to any non-admin on
// /lis/collection (whose query is a strict `AND branch_id = :branchId`, which never matches
// NULL) while an unscoped admin saw it regardless, since their query has no branch filter.
async function mirrorLabRequestToLis(patientId, clinicId, testName, testCode, department, branchId) {
  try {
    const [participants] = await sequelize.query(`SELECT id FROM lis_participants WHERE id = :pid LIMIT 1`, { replacements: { pid: patientId } });
    if (participants.length === 0) {
      // Every real check here found ZERO overlap between patients and
      // lis_participants — an inpatient admitted the normal way (through the
      // main Patient Registry, not the LIS module's own separate
      // registration form) has no lis_participants row at all, so this used
      // to just silently return: the request stayed visible on the
      // inpatient page and got billed correctly, but no lab technician ever
      // saw it, because nothing was ever created for them to see. Mirroring
      // one in on demand, keyed to the same id as the source patients row
      // (which is exactly what every COALESCE(p.x, lp.x) join elsewhere in
      // this file already assumes is possible), closes that gap instead of
      // requiring every inpatient to separately exist in the LIS module.
      const [[patient]] = await sequelize.query(
        `SELECT first_name, last_name, gender, date_of_birth, phone_number, address FROM patients WHERE id = :pid LIMIT 1`,
        { replacements: { pid: patientId } }
      );
      if (!patient) return; // truly unknown id — nothing to mirror against
      const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      await sequelize.query(
        `INSERT INTO lis_participants (id, participant_number, first_name, last_name, gender, date_of_birth, phone, residence)
         VALUES (:id, :participantNumber, :firstName, :lastName, :gender, :dob, :phone, :residence)`,
        {
          replacements: {
            id: patientId, participantNumber: `PTN-${dateStr}-${randomSuffix}`,
            firstName: patient.first_name || 'Unknown', lastName: patient.last_name || 'Patient',
            gender: patient.gender || null, dob: patient.date_of_birth || null,
            phone: patient.phone_number || null, residence: patient.address || null,
          },
        }
      );
    }

    const [[dup]] = await sequelize.query(
      `SELECT sp.id FROM lis_specimens sp JOIN lis_test_orders o ON o.id = sp.order_id
       WHERE o.participant_id = :pid AND o.status != 'closed' AND LOWER(sp.test_name) = LOWER(:name) AND sp.status = 'pending_collection'
       LIMIT 1`,
      { replacements: { pid: patientId, name: testName } }
    );
    if (dup) return;

    const { getCurrentOpenVisitId } = require('../utils/billingResolver');
    let orderId = await getCurrentOpenVisitId(patientId, clinicId);
    if (!orderId) {
      orderId = uuidv4();
      await sequelize.query(
        `INSERT INTO lis_test_orders (id, participant_id, clinic_id, status, branch_id) VALUES (:id, :pid, :clinicId, 'ordered', :branchId)`,
        { replacements: { id: orderId, pid: patientId, clinicId: clinicId || null, branchId: branchId || null } }
      );
    }

    const specimenId = uuidv4();
    const barcode = Math.floor(1000000 + Math.random() * 9000000).toString();
    const code = testCode || testName.substring(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
    await sequelize.query(
      `INSERT INTO lis_specimens (id, order_id, test_code, test_name, barcode, department, status, branch_id)
       VALUES (:id, :orderId, :code, :name, :barcode, :department, 'pending_collection', :branchId)`,
      { replacements: { id: specimenId, orderId, code, name: testName, barcode, department: department || null, branchId: branchId || null } }
    );
  } catch (e) {
    console.error('Error mirroring inpatient lab request to LIS:', e);
  }
}

// PUT discharge patient
router.put('/admissions/:id/discharge', authorize('inpatient.admissions.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { discharge_reason, discharge_summary, discharge_outcome } = req.body;
    const userId = req.user?.id;
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    if (!['alive', 'dead', 'absconded'].includes(discharge_outcome)) {
      await t.rollback();
      return res.status(400).json({ error: 'discharge_outcome must be one of: alive, dead, absconded' });
    }

    // Get admission to find bed
    const dischargeReplacements = { id: req.params.id, clinicId };
    const [admission] = await sequelize.query(
      `SELECT bed_id FROM inpatient_admissions WHERE id = :id AND status = 'active' AND clinic_id = :clinicId${branchScope(req, dischargeReplacements)}`,
      { replacements: dischargeReplacements, transaction: t }
    );
    if (admission.length === 0) { await t.rollback(); return res.status(404).json({ error: 'Active admission not found' }); }

    // Update admission
    await sequelize.query(
      `UPDATE inpatient_admissions SET status = 'discharged', discharge_date = NOW(), discharge_reason = :reason, discharge_summary = :summary, discharge_outcome = :outcome, discharged_by_user_id = :userId WHERE id = :id`,
      { replacements: { id: req.params.id, reason: discharge_reason || null, summary: discharge_summary || null, outcome: discharge_outcome, userId }, transaction: t }
    );

    // Free the bed
    await sequelize.query(`UPDATE beds SET status = 'available' WHERE id = :bedId`, { replacements: { bedId: admission[0].bed_id }, transaction: t });

    // Cancel active prescriptions
    await sequelize.query(
      `UPDATE inpatient_prescriptions SET status = 'completed' WHERE admission_id = :id AND status = 'active'`,
      { replacements: { id: req.params.id }, transaction: t }
    );

    await t.commit();
    await reconcileBedCharge(req.params.id, getCreateBranchId(req));

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Inpatient', action: 'PATIENT_DISCHARGED', entity_type: 'Admission', entity_id: req.params.id,
        description: `Patient discharged (${discharge_outcome})${discharge_reason ? ` — ${discharge_reason}` : ''}`,
        new_values: { discharge_reason: discharge_reason || null, discharge_outcome }, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ success: true, message: 'Patient discharged successfully' });
  } catch (error) {
    // Same reasoning as POST /admissions — chargeBedStay/audit-log run after commit,
    // so t may already be finished by the time an error here reaches this catch.
    if (!t.finished) await t.rollback().catch(() => {});
    console.error('Error discharging patient:', error);
    res.status(500).json({ error: 'Failed to discharge patient' });
  }
});

// ======================== DOCTOR NOTES ========================

// GET doctor notes for admission
router.get('/doctor-notes', authorize('inpatient.clinical.write'), async (req, res) => {
  try {
    await ensureVitalSignsColumns(sequelize, req.tenantSchema);
    const admissionId = req.query.admission_id;
    if (!admissionId) return res.status(400).json({ error: 'admission_id required' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [rows] = await sequelize.query(
      `SELECT dn.*, u.display_name as doctor_name
       FROM doctor_notes dn LEFT JOIN users u ON dn.doctor_id = u.id
       WHERE dn.admission_id = :admissionId AND dn.clinic_id = :clinicId ORDER BY dn.note_date DESC`,
      { replacements: { admissionId, clinicId } }
    );
    res.json(rows.map(parseVitalSigns));
  } catch (error) {
    console.error('Error fetching doctor notes:', error);
    res.status(500).json({ error: 'Failed to fetch doctor notes' });
  }
});

// POST create doctor note
router.post('/doctor-notes', authorize('inpatient.clinical.write'), async (req, res) => {
  try {
    await ensureVitalSignsColumns(sequelize, req.tenantSchema);
    const { admission_id, patient_id, note_type, clinical_assessment, examination_findings, vital_signs, diagnosis, diagnosis_code, treatment_plan, progress_status } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const doctorId = req.user?.id;
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO doctor_notes (id, clinic_id, admission_id, patient_id, doctor_id, note_date, note_type, clinical_assessment, examination_findings, vital_signs, diagnosis, diagnosis_code, treatment_plan, progress_status)
       VALUES (:id, :clinicId, :admissionId, :patientId, :doctorId, NOW(), :noteType, :assessment, :findings, :vitals, :diagnosis, :diagnosisCode, :plan, :status)`,
      { replacements: { id, clinicId, admissionId: admission_id, patientId: patient_id, doctorId, noteType: note_type || 'progress', assessment: clinical_assessment, findings: examination_findings || null, vitals: vital_signs ? JSON.stringify(vital_signs) : null, diagnosis: diagnosis || null, diagnosisCode: diagnosis_code || null, plan: treatment_plan || null, status: progress_status || 'stable' } }
    );
    res.status(201).json({ id, message: 'Note saved' });
  } catch (error) {
    console.error('Error creating doctor note:', error);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// ======================== INPATIENT PRESCRIPTIONS ========================

// GET prescriptions for admission
router.get('/prescriptions', authorize('inpatient.medications.manage'), async (req, res) => {
  try {
    const admissionId = req.query.admission_id;
    if (!admissionId) return res.status(400).json({ error: 'admission_id required' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { admissionId, clinicId };
    const [rows] = await sequelize.query(
      `SELECT ip.*, u.display_name as doctor_name,
        CASE WHEN pl.status IN ('dispensed', 'partial') THEN true ELSE false END AS is_dispensed
       FROM inpatient_prescriptions ip
       LEFT JOIN users u ON ip.doctor_id = u.id
       LEFT JOIN prescription_lines pl ON pl.id = ip.pharmacy_line_id
       WHERE ip.admission_id = :admissionId AND ip.clinic_id = :clinicId${branchScope(req, replacements, 'ip')} ORDER BY ip.prescription_date DESC`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching prescriptions:', error);
    res.status(500).json({ error: 'Failed to fetch prescriptions' });
  }
});

// POST create prescription
router.post('/prescriptions', authorize('inpatient.clinical.write'), async (req, res) => {
  try {
    const { admission_id, patient_id, drug_id, medication_name, dosage, frequency, duration, route, instructions, quantity, unit_of_measure, start_date, end_date, unit_price,
            duration_days, dose_amount, is_external, external_drug_name, location_id } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const doctorId = req.user?.id;
    const id = uuidv4();

    // Out-of-stock medicine the family buys outside: no inventory item to point
    // at, so the name is carried as text. Same rule as the outpatient flow.
    const isExternal = !!is_external || (!drug_id && !!external_drug_name);
    const medName = isExternal ? (external_drug_name || medication_name) : medication_name;
    const branchId = getCreateBranchId(req);

    const insufficient = await findInsufficientStockLine(sequelize, [
      { drugId: isExternal ? null : drug_id, quantity, isExternal, locationId: location_id || null },
    ]);
    if (insufficient) {
      return res.status(400).json({
        error: `Only ${insufficient.available} ${insufficient.drugName ? `of ${insufficient.drugName} ` : ''}in stock — reduce the quantity, or tick "Not in stock" to prescribe it for purchase outside.`,
      });
    }

    await sequelize.query(
      `INSERT INTO inpatient_prescriptions (id, clinic_id, admission_id, patient_id, doctor_id, drug_id, medication_name, prescription_date, dosage, frequency, duration, route, instructions, quantity, start_date, end_date, duration_days, dose_amount, is_external, external_drug_name, branch_id)
       VALUES (:id, :clinicId, :admissionId, :patientId, :doctorId, :drugId, :medName, NOW(), :dosage, :frequency, :duration, :route, :instructions, :qty, :startDate, :endDate, :durDays, :doseAmt, :ext, :extName, :branchId)`,
      { replacements: { id, clinicId, admissionId: admission_id, patientId: patient_id, doctorId, drugId: isExternal ? null : (drug_id || null), medName, dosage, frequency, duration: duration || null, route: route || 'oral', instructions: instructions || null, qty: parseInt(quantity) || 0, startDate: start_date || null, endDate: end_date || null,
        durDays: duration_days != null && duration_days !== '' ? parseInt(duration_days, 10) : null,
        doseAmt: dose_amount != null && dose_amount !== '' ? Number(dose_amount) : null,
        ext: isExternal, extName: isExternal ? medName : null, branchId } }
    );
    // An external medicine is bought outside, so it is neither billed here nor
    // sent to this pharmacy to dispense — doing either would charge or task the
    // hospital for something it is not supplying.
    const price = isExternal ? 0 : parseFloat(unit_price);
    if (price > 0) {
      const qty = Math.max(1, parseInt(quantity) || 1);
      const total = parseFloat((qty * price).toFixed(2));
      await billInpatientRequest(admission_id, branchId, {
        serviceName: `Medication — ${medication_name}${dosage ? ` (${dosage})` : ''}`,
        quantity: qty, unitPrice: price, totalPrice: total, revenueCategory: 'pharmacy',
      }, 'Auto-billed inpatient prescription');
    }

    const admissionCtx = isExternal ? null : await getAdmissionBillingContext(admission_id);
    const pharmacyLineId = isExternal ? null : await mirrorPrescriptionToPharmacy(
      clinicId, patient_id, doctorId, req.user?.displayName || req.user?.email, admission_id, admissionCtx?.ward_name,
      { drug_id, quantity, unit_of_measure, dosage, frequency, duration, instructions }, branchId
    );
    if (pharmacyLineId) {
      await sequelize.query(`UPDATE inpatient_prescriptions SET pharmacy_line_id = :lineId WHERE id = :id`, { replacements: { lineId: pharmacyLineId, id } });
    }

    // Both /inpatient/prescriptions and /pharmacy-module/prescriptions read
    // through the 60s response cache — without this a fresh prescription
    // stays invisible on the pharmacy queue until the TTL expires.
    try { redisCache.delPattern(`ic|${req.tenantSchema}|`); } catch (e) { /* ignore */ }

    res.status(201).json({ id, pharmacy_line_id: pharmacyLineId, message: 'Prescription created' });
  } catch (error) {
    console.error('Error creating prescription:', error);
    res.status(500).json({ error: 'Failed to create prescription' });
  }
});

// PUT update prescription status
router.put('/prescriptions/:id', authorize('inpatient.medications.manage'), async (req, res) => {
  try {
    const { status } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { id: req.params.id, status, clinicId };
    const [, meta] = await sequelize.query(`UPDATE inpatient_prescriptions SET status = :status WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`, { replacements });
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Prescription not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating prescription:', error);
    res.status(500).json({ error: 'Failed to update prescription' });
  }
});

// ======================== DRUG ADMINISTRATION ========================

// GET administrations for admission or prescription
router.get('/drug-administrations', authorize('inpatient.medications.manage'), async (req, res) => {
  try {
    const admissionId = req.query.admission_id;
    const prescriptionId = req.query.prescription_id;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    let sql = `SELECT da.*, u.display_name as nurse_name
       FROM drug_administrations da LEFT JOIN users u ON da.nurse_id = u.id WHERE da.clinic_id = :clinicId`;
    const replacements = { clinicId };
    if (admissionId) { sql += ' AND da.admission_id = :admissionId'; replacements.admissionId = admissionId; }
    if (prescriptionId) { sql += ' AND da.prescription_id = :prescriptionId'; replacements.prescriptionId = prescriptionId; }
    sql += ' ORDER BY da.administered_at DESC';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching drug administrations:', error);
    res.status(500).json({ error: 'Failed to fetch drug administrations' });
  }
});

// POST create drug administration
router.post('/drug-administrations', authorize('inpatient.clinical.write'), async (req, res) => {
  try {
    const { prescription_id, admission_id, patient_id, drug_id, medication_name, dosage_given, route, notes, patient_reaction, status } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const nurseId = req.user?.id;
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO drug_administrations (id, clinic_id, prescription_id, admission_id, patient_id, drug_id, medication_name, nurse_id, administered_at, dosage_given, route, notes, patient_reaction, status)
       VALUES (:id, :clinicId, :prescriptionId, :admissionId, :patientId, :drugId, :medName, :nurseId, NOW(), :dosage, :route, :notes, :reaction, :status)`,
      { replacements: { id, clinicId, prescriptionId: prescription_id, admissionId: admission_id, patientId: patient_id, drugId: drug_id || null, medName: medication_name, nurseId, dosage: dosage_given, route: route || 'oral', notes: notes || null, reaction: patient_reaction || null, status: status || 'given' } }
    );
    res.status(201).json({ id, message: 'Drug administration recorded' });
  } catch (error) {
    console.error('Error recording drug administration:', error);
    res.status(500).json({ error: 'Failed to record drug administration' });
  }
});

// ======================== NURSING NOTES ========================

// GET nursing notes
router.get('/nursing-notes', authorize('inpatient.clinical.write'), async (req, res) => {
  try {
    await ensureVitalSignsColumns(sequelize, req.tenantSchema);
    const admissionId = req.query.admission_id;
    if (!admissionId) return res.status(400).json({ error: 'admission_id required' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [rows] = await sequelize.query(
      `SELECT nn.*, u.display_name as nurse_name
       FROM nursing_notes nn LEFT JOIN users u ON nn.nurse_id = u.id
       WHERE nn.admission_id = :admissionId AND nn.clinic_id = :clinicId ORDER BY nn.note_date DESC`,
      { replacements: { admissionId, clinicId } }
    );
    res.json(rows.map(parseVitalSigns));
  } catch (error) {
    console.error('Error fetching nursing notes:', error);
    res.status(500).json({ error: 'Failed to fetch nursing notes' });
  }
});

// POST create nursing note
router.post('/nursing-notes', authorize('inpatient.clinical.write'), async (req, res) => {
  try {
    await ensureVitalSignsColumns(sequelize, req.tenantSchema);
    const { admission_id, patient_id, shift, care_activities, patient_condition, vital_signs, fluid_intake, fluid_output, wound_care, pain_level, mobility_status, notes } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const nurseId = req.user?.id;
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO nursing_notes (id, clinic_id, admission_id, patient_id, nurse_id, note_date, shift, care_activities, patient_condition, vital_signs, fluid_intake, fluid_output, wound_care, pain_level, mobility_status, notes)
       VALUES (:id, :clinicId, :admissionId, :patientId, :nurseId, NOW(), :shift, :activities, :condition, :vitals, :fluidIn, :fluidOut, :wound, :pain, :mobility, :notes)`,
      { replacements: { id, clinicId, admissionId: admission_id, patientId: patient_id, nurseId, shift: shift || 'morning', activities: care_activities, condition: patient_condition || null, vitals: vital_signs ? JSON.stringify(vital_signs) : null, fluidIn: fluid_intake || null, fluidOut: fluid_output || null, wound: wound_care || null, pain: pain_level || null, mobility: mobility_status || null, notes: notes || null } }
    );
    res.status(201).json({ id, message: 'Nursing note saved' });
  } catch (error) {
    console.error('Error creating nursing note:', error);
    res.status(500).json({ error: 'Failed to save nursing note' });
  }
});

// ======================== INPATIENT LAB REQUESTS ========================

// GET lab requests
router.get('/lab-requests', authorize('inpatient.ancillary.write'), async (req, res) => {
  try {
    const admissionId = req.query.admission_id;
    if (!admissionId) return res.status(400).json({ error: 'admission_id required' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { admissionId, clinicId };
    const [rows] = await sequelize.query(
      `SELECT lr.*, u.display_name as doctor_name, u2.display_name as completed_by_name
       FROM inpatient_lab_requests lr
       LEFT JOIN users u ON lr.doctor_id = u.id
       LEFT JOIN users u2 ON lr.completed_by = u2.id
       WHERE lr.admission_id = :admissionId AND lr.clinic_id = :clinicId${branchScope(req, replacements, 'lr')} ORDER BY lr.request_date DESC`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching lab requests:', error);
    res.status(500).json({ error: 'Failed to fetch lab requests' });
  }
});

// POST create lab request
router.post('/lab-requests', authorize('inpatient.ancillary.write'), async (req, res) => {
  try {
    const { admission_id, patient_id, test_type, test_code, category, urgent, clinical_indication, sample_type, unit_price } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const doctorId = req.user?.id;
    const id = uuidv4();
    const branchId = getCreateBranchId(req);
    await sequelize.query(
      `INSERT INTO inpatient_lab_requests (id, clinic_id, admission_id, patient_id, doctor_id, request_date, test_type, test_code, urgent, clinical_indication, sample_type, branch_id)
       VALUES (:id, :clinicId, :admissionId, :patientId, :doctorId, NOW(), :testType, :testCode, :urgent, :indication, :sampleType, :branchId)`,
      { replacements: { id, clinicId, admissionId: admission_id, patientId: patient_id, doctorId, testType: test_type, testCode: test_code || null, urgent: urgent || false, indication: clinical_indication || null, sampleType: sample_type || null, branchId } }
    );

    const price = parseFloat(unit_price);
    if (price > 0) {
      await billInpatientRequest(admission_id, branchId, {
        serviceName: `Lab Test — ${test_type}`, quantity: 1, unitPrice: price, totalPrice: price, revenueCategory: 'laboratory',
      }, 'Auto-billed inpatient lab request');
    }

    await mirrorLabRequestToLis(patient_id, clinicId, test_type, test_code, category, branchId);

    res.status(201).json({ id, message: 'Lab request created' });
  } catch (error) {
    console.error('Error creating lab request:', error);
    res.status(500).json({ error: 'Failed to create lab request' });
  }
});

// PUT update lab request (for results)
router.put('/lab-requests/:id', authorize('inpatient.ancillary.write'), async (req, res) => {
  try {
    const { status, results, result_notes } = req.body;
    const completedBy = req.user?.id;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const fields = ['status = :status'];
    const replacements = { id: req.params.id, status, clinicId };
    if (results) { fields.push('results = :results'); replacements.results = JSON.stringify(results); }
    if (result_notes) { fields.push('result_notes = :resultNotes'); replacements.resultNotes = result_notes; }
    if (status === 'completed') { fields.push('completed_date = NOW()'); fields.push('completed_by = :completedBy'); replacements.completedBy = completedBy; }
    const [, meta] = await sequelize.query(`UPDATE inpatient_lab_requests SET ${fields.join(', ')} WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`, { replacements });
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Lab request not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating lab request:', error);
    res.status(500).json({ error: 'Failed to update lab request' });
  }
});

// ======================== INPATIENT RADIOLOGY REQUESTS ========================

// GET radiology requests
router.get('/radiology-requests', authorize('inpatient.ancillary.write'), async (req, res) => {
  try {
    const admissionId = req.query.admission_id;
    if (!admissionId) return res.status(400).json({ error: 'admission_id required' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { admissionId, clinicId };
    const [rows] = await sequelize.query(
      `SELECT rr.*, u.display_name as doctor_name, u2.display_name as completed_by_name
       FROM inpatient_radiology_requests rr
       LEFT JOIN users u ON rr.doctor_id = u.id
       LEFT JOIN users u2 ON rr.completed_by = u2.id
       WHERE rr.admission_id = :admissionId AND rr.clinic_id = :clinicId${branchScope(req, replacements, 'rr')} ORDER BY rr.request_date DESC`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching radiology requests:', error);
    res.status(500).json({ error: 'Failed to fetch radiology requests' });
  }
});

// POST create radiology request
router.post('/radiology-requests', authorize('inpatient.ancillary.write'), async (req, res) => {
  try {
    const { admission_id, patient_id, imaging_type, body_part, urgent, clinical_indication, unit_price } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const doctorId = req.user?.id;
    const id = uuidv4();
    const branchId = getCreateBranchId(req);
    await sequelize.query(
      `INSERT INTO inpatient_radiology_requests (id, clinic_id, admission_id, patient_id, doctor_id, request_date, imaging_type, body_part, urgent, clinical_indication, branch_id)
       VALUES (:id, :clinicId, :admissionId, :patientId, :doctorId, NOW(), :imagingType, :bodyPart, :urgent, :indication, :branchId)`,
      { replacements: { id, clinicId, admissionId: admission_id, patientId: patient_id, doctorId, imagingType: imaging_type, bodyPart: body_part || null, urgent: urgent || false, indication: clinical_indication || null, branchId } }
    );

    const price = parseFloat(unit_price);
    if (price > 0) {
      await billInpatientRequest(admission_id, branchId, {
        serviceName: `Imaging — ${imaging_type}${body_part ? ` (${body_part})` : ''}`, quantity: 1, unitPrice: price, totalPrice: price, revenueCategory: 'radiology',
      }, 'Auto-billed inpatient radiology request');
    }

    res.status(201).json({ id, message: 'Radiology request created' });
  } catch (error) {
    console.error('Error creating radiology request:', error);
    res.status(500).json({ error: 'Failed to create radiology request' });
  }
});

// PUT update radiology request
router.put('/radiology-requests/:id', authorize('inpatient.ancillary.write'), async (req, res) => {
  try {
    const { status, findings, impression } = req.body;
    const completedBy = req.user?.id;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const fields = ['status = :status'];
    const replacements = { id: req.params.id, status, clinicId };
    if (findings) { fields.push('findings = :findings'); replacements.findings = findings; }
    if (impression) { fields.push('impression = :impression'); replacements.impression = impression; }
    if (status === 'completed') { fields.push('completed_date = NOW()'); fields.push('completed_by = :completedBy'); replacements.completedBy = completedBy; }
    const [, meta] = await sequelize.query(`UPDATE inpatient_radiology_requests SET ${fields.join(', ')} WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`, { replacements });
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Radiology request not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating radiology request:', error);
    res.status(500).json({ error: 'Failed to update radiology request' });
  }
});

// ======================== DASHBOARD STATS ========================

router.get('/stats', authorize('inpatient.admissions.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const r1 = { clinicId };
    const [[admissions]] = await sequelize.query(`SELECT COUNT(*) as cnt FROM inpatient_admissions WHERE clinic_id = :clinicId AND status = 'active'${branchScope(req, r1)}`, { replacements: r1 });
    const r2 = { clinicId };
    const [[totalBeds]] = await sequelize.query(`SELECT COUNT(*) as cnt FROM beds WHERE clinic_id = :clinicId AND is_active = true${branchScope(req, r2)}`, { replacements: r2 });
    const r3 = { clinicId };
    const [[availableBeds]] = await sequelize.query(`SELECT COUNT(*) as cnt FROM beds WHERE clinic_id = :clinicId AND is_active = true AND status = 'available'${branchScope(req, r3)}`, { replacements: r3 });
    const r4 = { clinicId };
    const [[totalWards]] = await sequelize.query(`SELECT COUNT(*) as cnt FROM wards WHERE clinic_id = :clinicId AND is_active = true${branchScope(req, r4)}`, { replacements: r4 });
    const r5 = { clinicId };
    const [[dischargedToday]] = await sequelize.query(`SELECT COUNT(*) as cnt FROM inpatient_admissions WHERE clinic_id = :clinicId AND status = 'discharged' AND DATE(discharge_date) = CURRENT_DATE${branchScope(req, r5)}`, { replacements: r5 });
    const r6 = { clinicId };
    const [[admittedToday]] = await sequelize.query(`SELECT COUNT(*) as cnt FROM inpatient_admissions WHERE clinic_id = :clinicId AND DATE(admission_date) = CURRENT_DATE${branchScope(req, r6)}`, { replacements: r6 });

    res.json({
      active_admissions: admissions.cnt,
      total_beds: totalBeds.cnt,
      available_beds: availableBeds.cnt,
      total_wards: totalWards.cnt,
      discharged_today: dischargedToday.cnt,
      admitted_today: admittedToday.cnt,
      occupancy_rate: totalBeds.cnt > 0 ? Math.round(((totalBeds.cnt - availableBeds.cnt) / totalBeds.cnt) * 100) : 0
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
