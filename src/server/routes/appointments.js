/**
 * Follow-up / next-visit appointments — scheduled from a patient's Visit
 * Summary (by a doctor) or directly from the Appointments page (reception),
 * then queued straight to the doctor who asked for the follow-up when the
 * patient actually shows up, via the same lis_test_orders queue every other
 * "see a doctor" flow in this app uses (see POST /api/lis/participants/:id
 * /queue in lisModule.js — this route's own /:id/queue mirrors it exactly,
 * rather than importing that handler, since Express routers aren't easily
 * composed across files here and the insert itself is two lines).
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');

router.get('/', authorize('appointments.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { status, from, to } = req.query;
    const params = [clinicId];
    let filter = '';
    if (status) { filter += ' AND a.status = ?'; params.push(status); }
    if (from) { filter += ' AND a.scheduled_date >= ?'; params.push(from); }
    if (to) { filter += ' AND a.scheduled_date <= ?'; params.push(to); }
    const branchFilter = getBranchConditionSQL(req, 'a');
    filter += branchFilter.sql;
    params.push(...branchFilter.params);

    const [rows] = await db.query(
      `SELECT a.*, p.first_name, p.last_name, p.participant_number, p.gender, p.phone,
              u.display_name as doctor_name, cu.display_name as created_by_name
       FROM appointments a
       LEFT JOIN lis_participants p ON p.id = a.participant_id
       LEFT JOIN users u ON u.id = a.doctor_id
       LEFT JOIN users cu ON cu.id = a.created_by
       WHERE a.clinic_id = ?${filter}
       ORDER BY a.scheduled_date ASC, a.created_at ASC
       LIMIT 500`,
      { replacements: params }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

router.post('/', authorize('appointments.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { participant_id, doctor_id, scheduled_date, reason, source_order_id } = req.body;
    if (!participant_id) return res.status(400).json({ error: 'participant_id is required' });
    if (!scheduled_date) return res.status(400).json({ error: 'scheduled_date is required' });

    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();
    await db.query(
      `INSERT INTO appointments
         (id, clinic_id, branch_id, participant_id, doctor_id, scheduled_date, reason, source_order_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      { replacements: [
        id, clinicId, getCreateBranchId(req), participant_id, doctor_id || null,
        scheduled_date, reason || null, source_order_id || null, req.user?.id || null,
      ] }
    );

    // Non-blocking — lets the doctor know a follow-up was booked for them,
    // same pattern as the queue notification below (and in lisModule.js).
    if (doctor_id) {
      try {
        const { notifyUser } = require('../services/notificationService');
        const [[participant]] = await db.query(`SELECT first_name, last_name FROM lis_participants WHERE id = ?`, { replacements: [participant_id] });
        const patientName = participant ? `${participant.first_name} ${participant.last_name}`.trim() : 'A patient';
        await notifyUser(db, {
          clinic_id: clinicId, user_id: doctor_id,
          type: 'appointment_scheduled', title: 'Follow-up appointment scheduled',
          message: `${patientName} — follow-up on ${new Date(scheduled_date).toLocaleDateString()}`,
          entity_type: 'Appointment', entity_id: id, link: '/appointments',
        });
      } catch (e) { /* non-blocking */ }
    }

    res.status(201).json({ id, message: 'Appointment scheduled' });
  } catch (error) {
    console.error('Error scheduling appointment:', error);
    res.status(500).json({ error: 'Failed to schedule appointment' });
  }
});

router.put('/:id', authorize('appointments.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { scheduled_date, reason, doctor_id, status } = req.body;
    const [[existing]] = await db.query(`SELECT id, status FROM appointments WHERE id = ?`, { replacements: [req.params.id] });
    if (!existing) return res.status(404).json({ error: 'Appointment not found' });
    if (existing.status === 'queued') return res.status(409).json({ error: 'This appointment has already been queued and can no longer be edited' });
    if (status && !['scheduled', 'cancelled'].includes(status)) return res.status(400).json({ error: 'status must be scheduled or cancelled' });

    await db.query(
      `UPDATE appointments SET
         scheduled_date = COALESCE(?, scheduled_date), reason = COALESCE(?, reason),
         doctor_id = COALESCE(?, doctor_id), status = COALESCE(?, status), updated_at = NOW()
       WHERE id = ?`,
      { replacements: [scheduled_date || null, reason || null, doctor_id || null, status || null, req.params.id] }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Queue this appointment's patient straight to the doctor it was booked
// with — the actual "patient showed up" handoff into the normal LIS/queue
// flow. Mirrors POST /api/lis/participants/:id/queue in lisModule.js.
router.post('/:id/queue', authorize('appointments.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [[appt]] = await db.query(`SELECT * FROM appointments WHERE id = ?`, { replacements: [req.params.id] });
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    if (appt.status !== 'scheduled') return res.status(409).json({ error: `This appointment is already ${appt.status}` });

    const orderId = uuidv4();
    await db.query(
      `INSERT INTO lis_test_orders (id, participant_id, doctor_id, status, branch_id, appointment_id) VALUES (?, ?, ?, 'waiting', ?, ?)`,
      { replacements: [orderId, appt.participant_id, appt.doctor_id, appt.branch_id || getCreateBranchId(req), appt.id] }
    );
    await db.query(
      `UPDATE appointments SET status = 'queued', queued_order_id = ?, updated_at = NOW() WHERE id = ?`,
      { replacements: [orderId, req.params.id] }
    );

    try {
      const { notifyUser, notifyRole } = require('../services/notificationService');
      const [[participant]] = await db.query(`SELECT first_name, last_name FROM lis_participants WHERE id = ?`, { replacements: [appt.participant_id] });
      const patientName = participant ? `${participant.first_name} ${participant.last_name}`.trim() : 'A patient';
      if (appt.doctor_id) {
        await notifyUser(db, {
          clinic_id: req.user?.clinicId, user_id: appt.doctor_id,
          type: 'patient_queued', title: 'Follow-up patient queued',
          message: `${patientName} (follow-up) has been queued for you`,
          entity_type: 'LisTestOrder', entity_id: orderId, link: '/lis/queue',
        });
      } else {
        await notifyRole(db, {
          clinic_id: req.user?.clinicId, role: 'doctor', branch_id: req.user?.branchId,
          type: 'patient_queued', title: 'Follow-up patient queued',
          message: `${patientName} (follow-up) has been added to the consultation queue`,
          entity_type: 'LisTestOrder', entity_id: orderId, link: '/lis/queue',
        });
      }
    } catch (e) { /* non-blocking */ }

    res.json({ success: true, order_id: orderId, message: 'Patient queued' });
  } catch (error) {
    console.error('Error queuing appointment:', error);
    res.status(500).json({ error: 'Failed to queue appointment' });
  }
});

module.exports = router;
