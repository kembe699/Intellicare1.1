/**
 * Outpatient/triage nursing procedures log — a standalone record of care a
 * nurse gives directly, outside the doctor's prescription pipeline and
 * outside an inpatient admission: an injection given, a minor procedure
 * performed, a dressing changed. Separate from inpatient's own
 * drug_administrations (that's for an admitted patient's prescribed
 * medications; this is for a nurse's own direct outpatient care, with or
 * without a prescription behind it).
 *
 * Keyed on lis_participants.id, same convention as patient_referrals.js —
 * the app's real, actively-used patient record. order_id optionally links
 * the visit this happened under so it can surface on that visit's Visit
 * Summary alongside everything else done for the patient that day.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');

const PROCEDURE_TYPES = ['injection', 'minor_procedure', 'dressing', 'other'];

// GET / — recent log, clinic-wide (branch-scoped for a non-admin), newest first.
router.get('/', authorize('nursing.procedures.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchFilter = getBranchConditionSQL(req, 'np');
    const [rows] = await db.query(
      `SELECT np.*, p.first_name, p.last_name, p.participant_number, u.display_name as nurse_name
       FROM nursing_procedures np
       LEFT JOIN lis_participants p ON p.id = np.participant_id
       LEFT JOIN users u ON u.id = np.nurse_id
       WHERE np.clinic_id = ? ${branchFilter.sql}
       ORDER BY np.performed_at DESC
       LIMIT 200`,
      { replacements: [clinicId, ...branchFilter.params] }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching nursing procedures:', error);
    res.status(500).json({ error: 'Failed to fetch nursing procedures' });
  }
});

// GET /participant/:participantId — this one patient's history, for the
// nursing procedures page's own patient view. (Visit Summary gets this
// same data through GET /lis/visit-summaries instead, which already
// aggregates everything for a visit in one response under lis.clinical.read
// — a doctor viewing Visit Summary doesn't need nursing.procedures.write.)
router.get('/participant/:participantId', authorize('nursing.procedures.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [rows] = await db.query(
      `SELECT np.*, u.display_name as nurse_name
       FROM nursing_procedures np
       LEFT JOIN users u ON u.id = np.nurse_id
       WHERE np.participant_id = ?
       ORDER BY np.performed_at DESC`,
      { replacements: [req.params.participantId] }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching patient nursing procedures:', error);
    res.status(500).json({ error: 'Failed to fetch patient nursing procedures' });
  }
});

// POST / — log a new entry.
router.post('/', authorize('nursing.procedures.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { participant_id, order_id, procedure_type, description, notes, performed_at } = req.body;
    if (!participant_id) return res.status(400).json({ error: 'participant_id is required' });
    if (!PROCEDURE_TYPES.includes(procedure_type)) {
      return res.status(400).json({ error: `procedure_type must be one of: ${PROCEDURE_TYPES.join(', ')}` });
    }
    if (!description || !description.trim()) return res.status(400).json({ error: 'description is required' });

    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();
    await db.query(
      `INSERT INTO nursing_procedures (id, clinic_id, branch_id, participant_id, order_id, nurse_id, procedure_type, description, notes, performed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      { replacements: [
        id, clinicId, getCreateBranchId(req), participant_id, order_id || null, req.user?.id || null,
        procedure_type, description.trim(), notes || null, performed_at || new Date(),
      ] }
    );
    res.status(201).json({ id, message: 'Nursing procedure logged' });
  } catch (error) {
    console.error('Error logging nursing procedure:', error);
    res.status(500).json({ error: 'Failed to log nursing procedure' });
  }
});

module.exports = router;
