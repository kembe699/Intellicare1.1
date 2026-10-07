/**
 * Antenatal (ANC) care — register a pregnancy, log visits against it, and
 * print a WHO-style antenatal visit history card. A registration can arrive
 * two ways: registered manually here, or auto-created the moment a female
 * patient's "Antenatal Care" box is ticked on Triage/LIS clinical notes (see
 * ensureAntenatalRegistration, called from lisModule.js) — `source`
 * distinguishes the two, but both are managed identically from here on.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { getCreateBranchId } = require('../middleware/branchFilter');

// Finds (or, when `gynae` carries real registration data, creates) this
// patient's active ANC registration, AND — when the antenatal sub-section
// (gestational age / fundal height / FHR / presentation / notes) actually
// carries anything — records it as a visit against that registration. Called
// from lisModule.js whenever a saved vitals/clinical-notes payload carries
// gynae.antenatal_enabled — "let it register straight" per the user's own
// words, and "make sure everything captured ... appears" for the visit log
// too. Never overwrites an existing active registration's lmp/edd/gravida/para
// once created; a nurse or doctor edits those from the Antenatal module
// itself if they change.
//
// `orderId` (the lis_test_orders row this came from) dedupes the visit: a
// second save of the same visit's clinical notes (e.g. triage then an edit)
// updates the one visit already created for that order instead of appending
// a duplicate every time the form is saved.
async function ensureAntenatalRegistration(db, { participantId, clinicId, branchId, orderId, vitals, registeredBy }) {
  const gynae = vitals?.gynae;
  if (!participantId || !gynae?.antenatal_enabled) return null;
  try {
    let registrationId;
    const [[existing]] = await db.query(
      `SELECT id FROM antenatal_registrations WHERE participant_id = ? AND status = 'active' LIMIT 1`,
      { replacements: [participantId] }
    );
    if (existing) {
      registrationId = existing.id;
    } else {
      registrationId = uuidv4();
      await db.query(
        `INSERT INTO antenatal_registrations
           (id, clinic_id, branch_id, participant_id, registration_number, lmp, edd, gravida, para, registered_by, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto')`,
        { replacements: [
          registrationId, clinicId || 1, branchId || null, participantId, `ANC-${Date.now().toString().slice(-8)}`,
          gynae.lmp || null, gynae.edd || null, gynae.gravida || null, gynae.para || null, registeredBy || null,
        ] }
      );
    }

    const anc = gynae.antenatal || {};
    const hasVisitData = [anc.gestational_age_weeks, anc.fundal_height_cm, anc.fetal_heart_rate, anc.fetal_presentation, anc.notes, vitals?.blood_pressure, vitals?.weight]
      .some((v) => v !== undefined && v !== null && v !== '');
    if (hasVisitData) {
      const visitFields = [
        anc.gestational_age_weeks || null, vitals?.blood_pressure || null, vitals?.weight || null,
        anc.fundal_height_cm || null, anc.fetal_heart_rate || null, anc.fetal_presentation || null, anc.notes || null,
      ];
      let existingVisit = null;
      if (orderId) {
        [[existingVisit]] = await db.query(
          `SELECT id FROM antenatal_visits WHERE registration_id = ? AND order_id = ? LIMIT 1`,
          { replacements: [registrationId, orderId] }
        );
      }
      if (existingVisit) {
        await db.query(
          `UPDATE antenatal_visits SET
             gestational_age_weeks = ?, blood_pressure = ?, weight = ?, fundal_height = ?,
             fetal_heart_rate = ?, fetal_presentation = ?, notes = ?
           WHERE id = ?`,
          { replacements: [...visitFields, existingVisit.id] }
        );
      } else {
        await db.query(
          `INSERT INTO antenatal_visits
             (id, registration_id, participant_id, order_id, gestational_age_weeks, blood_pressure, weight,
              fundal_height, fetal_heart_rate, fetal_presentation, notes, recorded_by, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto')`,
          { replacements: [uuidv4(), registrationId, participantId, orderId || null, ...visitFields, registeredBy || null] }
        );
      }
    }

    return registrationId;
  } catch (error) {
    console.error('Error auto-registering antenatal patient:', error);
    return null;
  }
}

router.get('/', authorize('antenatal.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { status } = req.query;
    const params = [clinicId];
    let statusFilter = '';
    if (status) { statusFilter = ' AND ar.status = ?'; params.push(status); }
    const [rows] = await db.query(
      `SELECT ar.*, p.first_name, p.last_name, p.participant_number, p.date_of_birth,
              u.display_name as registered_by_name,
              (SELECT COUNT(*) FROM antenatal_visits av WHERE av.registration_id = ar.id) as visit_count,
              (SELECT MAX(visit_date) FROM antenatal_visits av WHERE av.registration_id = ar.id) as last_visit_date
       FROM antenatal_registrations ar
       LEFT JOIN lis_participants p ON p.id = ar.participant_id
       LEFT JOIN users u ON u.id = ar.registered_by
       WHERE ar.clinic_id = ?${statusFilter}
       ORDER BY ar.created_at DESC
       LIMIT 500`,
      { replacements: params }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching antenatal registrations:', error);
    res.status(500).json({ error: 'Failed to fetch antenatal registrations' });
  }
});

router.post('/', authorize('antenatal.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { participant_id, lmp, edd, gravida, para, blood_group, risk_notes } = req.body;
    if (!participant_id) return res.status(400).json({ error: 'participant_id is required' });

    const [[existing]] = await db.query(
      `SELECT id FROM antenatal_registrations WHERE participant_id = ? AND status = 'active' LIMIT 1`,
      { replacements: [participant_id] }
    );
    if (existing) return res.status(409).json({ error: 'This patient already has an active antenatal registration', id: existing.id });

    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();
    await db.query(
      `INSERT INTO antenatal_registrations
         (id, clinic_id, branch_id, participant_id, registration_number, lmp, edd, gravida, para, blood_group, risk_notes, registered_by, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
      { replacements: [
        id, clinicId, getCreateBranchId(req), participant_id, `ANC-${Date.now().toString().slice(-8)}`,
        lmp || null, edd || null, gravida || null, para || null, blood_group || null, risk_notes || null, req.user?.id || null,
      ] }
    );
    res.status(201).json({ id, message: 'Patient registered for antenatal care' });
  } catch (error) {
    console.error('Error registering antenatal patient:', error);
    res.status(500).json({ error: 'Failed to register antenatal patient' });
  }
});

router.get('/:id', authorize('antenatal.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [[registration]] = await db.query(
      `SELECT ar.*, p.first_name, p.last_name, p.participant_number, p.date_of_birth, p.phone,
              u.display_name as registered_by_name
       FROM antenatal_registrations ar
       LEFT JOIN lis_participants p ON p.id = ar.participant_id
       LEFT JOIN users u ON u.id = ar.registered_by
       WHERE ar.id = ?`,
      { replacements: [req.params.id] }
    );
    if (!registration) return res.status(404).json({ error: 'Registration not found' });

    const [visits] = await db.query(
      `SELECT av.*, u.display_name as recorded_by_name
       FROM antenatal_visits av
       LEFT JOIN users u ON u.id = av.recorded_by
       WHERE av.registration_id = ?
       ORDER BY av.visit_date DESC`,
      { replacements: [req.params.id] }
    );
    res.json({ ...registration, visits });
  } catch (error) {
    console.error('Error fetching antenatal profile:', error);
    res.status(500).json({ error: 'Failed to fetch antenatal profile' });
  }
});

router.put('/:id', authorize('antenatal.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { lmp, edd, gravida, para, blood_group, risk_notes, status } = req.body;
    const [[existing]] = await db.query(`SELECT id FROM antenatal_registrations WHERE id = ?`, { replacements: [req.params.id] });
    if (!existing) return res.status(404).json({ error: 'Registration not found' });
    if (status && !['active', 'delivered', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'status must be active, delivered, or closed' });
    }
    await db.query(
      `UPDATE antenatal_registrations SET
         lmp = COALESCE(?, lmp), edd = COALESCE(?, edd), gravida = COALESCE(?, gravida), para = COALESCE(?, para),
         blood_group = COALESCE(?, blood_group), risk_notes = COALESCE(?, risk_notes), status = COALESCE(?, status), updated_at = NOW()
       WHERE id = ?`,
      { replacements: [lmp || null, edd || null, gravida || null, para || null, blood_group || null, risk_notes || null, status || null, req.params.id] }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating antenatal registration:', error);
    res.status(500).json({ error: 'Failed to update registration' });
  }
});

router.post('/:id/visits', authorize('antenatal.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [[registration]] = await db.query(`SELECT id, participant_id FROM antenatal_registrations WHERE id = ?`, { replacements: [req.params.id] });
    if (!registration) return res.status(404).json({ error: 'Registration not found' });

    const {
      visit_date, gestational_age_weeks, blood_pressure, weight, fundal_height,
      fetal_heart_rate, fetal_presentation, urine_protein, urine_glucose, hb_level, next_appointment, notes,
    } = req.body;

    const id = uuidv4();
    await db.query(
      `INSERT INTO antenatal_visits
         (id, registration_id, participant_id, visit_date, gestational_age_weeks, blood_pressure, weight, fundal_height,
          fetal_heart_rate, fetal_presentation, urine_protein, urine_glucose, hb_level, next_appointment, notes, recorded_by)
       VALUES (?, ?, ?, COALESCE(?, NOW()), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      { replacements: [
        id, registration.id, registration.participant_id, visit_date || null, gestational_age_weeks || null,
        blood_pressure || null, weight || null, fundal_height || null, fetal_heart_rate || null, fetal_presentation || null,
        urine_protein || null, urine_glucose || null, hb_level || null, next_appointment || null, notes || null, req.user?.id || null,
      ] }
    );
    res.status(201).json({ id, message: 'Visit recorded' });
  } catch (error) {
    console.error('Error recording antenatal visit:', error);
    res.status(500).json({ error: 'Failed to record visit' });
  }
});

module.exports = router;
module.exports.ensureAntenatalRegistration = ensureAntenatalRegistration;
