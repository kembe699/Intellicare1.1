/**
 * Inter-branch patient referral: a doctor at one branch asks another branch
 * to take over a patient's care, the receiving branch reviews a snapshot of
 * the patient's recent record and accepts or rejects, and on accept the
 * patient becomes that branch's patient going forward.
 *
 * Keyed on lis_participants.id — the app's real, actively-used patient
 * record (the older `patients` table is a largely-unused secondary source;
 * see src/lib/patientDirectory.ts for why both still get searched).
 *
 * lis_participants.branch_id is already only loosely enforced elsewhere in
 * this app (only the participant search list filters by it), so "the
 * patient becomes the receiving branch's patient" is simply reassigning
 * that one column on accept — there is no existing hard lock to work
 * around. Historical visits/results/prescriptions/bills keep whatever
 * branch_id they were actually created under; only the patient record
 * itself moves.
 *
 * Visibility is deliberately narrow and lives entirely in this file (not in
 * branchAccessControl.js/BranchQueryFilter.js, which have no idea this
 * table exists): a user only ever sees a referral where their own current
 * branch is either side of it, unless they're an unscoped admin.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { getCreateBranchId } = require('../middleware/branchFilter');

const router = express.Router();

// Same resolution branchFilter.js's own helpers use — an unscoped admin
// (role === 'admin' and no explicit TopBar branch switch) gets null, which
// this file treats as "sees/acts on everything," matching that convention.
function getUserBranchId(req) {
  return req.branchContext?.branchId || req.user?.branchId || null;
}
function isUnscopedAdmin(req) {
  return req.user?.role === 'admin' && !req.branchContext?.adminScoped;
}

// GET / — every referral touching the caller's own branch, either side.
router.get('/', authorize('pages.patient_referral.view'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const branchId = getUserBranchId(req);
    const scoped = !isUnscopedAdmin(req) && !!branchId;
    const statusFilter = req.query.status ? ` AND r.status = :status` : '';
    const [rows] = await db.query(
      `SELECT r.*, fb.name as from_branch_name, tb.name as to_branch_name
       FROM patient_referrals r
       LEFT JOIN branches fb ON fb.id = r.from_branch_id
       LEFT JOIN branches tb ON tb.id = r.to_branch_id
       WHERE 1=1 ${scoped ? 'AND (r.from_branch_id = :branchId OR r.to_branch_id = :branchId)' : ''} ${statusFilter}
       ORDER BY r.created_at DESC`,
      { replacements: { branchId, status: req.query.status } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing patient referrals:', error);
    res.status(500).json({ error: 'Failed to list referrals' });
  }
});

// GET /:id — the referral plus a recent-record snapshot of the patient, for
// the receiving side to judge whether they can take the case.
router.get('/:id', authorize('pages.patient_referral.view'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [[referral]] = await db.query(
      `SELECT r.*, fb.name as from_branch_name, tb.name as to_branch_name
       FROM patient_referrals r
       LEFT JOIN branches fb ON fb.id = r.from_branch_id
       LEFT JOIN branches tb ON tb.id = r.to_branch_id
       WHERE r.id = ?`,
      { replacements: [req.params.id] }
    );
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    const branchId = getUserBranchId(req);
    const isParty = String(referral.from_branch_id) === String(branchId) || String(referral.to_branch_id) === String(branchId);
    if (!isUnscopedAdmin(req) && !isParty) {
      return res.status(403).json({ error: 'This referral does not involve your branch' });
    }

    const [[participant]] = await db.query(
      `SELECT id, participant_number, first_name, last_name, gender, date_of_birth, phone, residence, demographics
       FROM lis_participants WHERE id = ?`,
      { replacements: [referral.patient_id] }
    );

    // Last few visits — vitals/notes live directly on lis_test_orders in
    // this module, no separate table.
    const [orders] = await db.query(
      `SELECT id, created_at, clinical_notes, vitals, status
       FROM lis_test_orders WHERE participant_id = ? ORDER BY created_at DESC LIMIT 5`,
      { replacements: [referral.patient_id] }
    );

    let labResults = [];
    if (orders.length > 0) {
      const orderIds = orders.map((o) => o.id);
      const [specimens] = await db.query(
        `SELECT id, order_id, test_name, status FROM lis_specimens WHERE order_id IN (:orderIds)`,
        { replacements: { orderIds } }
      );
      if (specimens.length > 0) {
        const specimenIds = specimens.map((s) => s.id);
        const [results] = await db.query(
          `SELECT r.specimen_id, r.analyte, r.value, r.unit, r.flag, r.status, c.reference_range
           FROM lis_results r
           LEFT JOIN lab_tests t ON r.test_code = t.test_code AND (t.branch_id = r.branch_id OR t.branch_id IS NULL)
           LEFT JOIN lab_test_components c ON t.id = c.lab_test_id AND r.analyte = c.component_name
           WHERE r.specimen_id IN (:specimenIds)
           ORDER BY r.created_at DESC`,
          { replacements: { specimenIds } }
        );
        const specimenById = Object.fromEntries(specimens.map((s) => [s.id, s]));
        labResults = results.map((r) => ({
          test: specimenById[r.specimen_id]?.test_name || null,
          analyte: r.analyte, value: r.value, unit: r.unit,
          reference_range: r.reference_range || null, flag: r.flag || null, status: r.status,
        }));
      }
    }

    const [prescriptions] = await db.query(
      `SELECT pp.prescription_number, pp.prescription_date, pl.dose_strength, pl.frequency, pl.duration_days,
              COALESCE(ii.item_name, pl.external_drug_name) as drug_name
       FROM pharmacy_prescriptions pp
       JOIN prescription_lines pl ON pl.prescription_id = pp.id
       LEFT JOIN inventory_items ii ON pl.drug_id = ii.id
       WHERE pp.patient_id = ? AND pp.status != 'cancelled'
       ORDER BY pp.prescription_date DESC LIMIT 10`,
      { replacements: [referral.patient_id] }
    );

    res.json({
      referral,
      patient: participant || null,
      visits: orders.map((o) => ({
        id: o.id, created_at: o.created_at, status: o.status,
        clinical_notes: o.clinical_notes,
        vitals: typeof o.vitals === 'string' ? JSON.parse(o.vitals || '{}') : (o.vitals || {}),
      })),
      lab_results: labResults,
      prescriptions,
    });
  } catch (error) {
    console.error('Error fetching patient referral:', error);
    res.status(500).json({ error: 'Failed to fetch referral' });
  }
});

router.post('/', authorize('referrals.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { patient_id, to_branch_id, reason } = req.body;
  try {
    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });
    if (!to_branch_id) return res.status(400).json({ error: 'to_branch_id is required' });

    const fromBranchId = getCreateBranchId(req);
    if (!fromBranchId) return res.status(400).json({ error: 'Your account has no branch to refer from' });
    if (String(to_branch_id) === String(fromBranchId)) {
      return res.status(400).json({ error: 'Choose a different branch to refer to' });
    }

    const [[toBranch]] = await db.query(`SELECT id, name FROM branches WHERE id = ? AND is_active IS NOT FALSE`, { replacements: [to_branch_id] });
    if (!toBranch) return res.status(400).json({ error: 'That branch is not available' });

    const [[participant]] = await db.query(`SELECT id, first_name, last_name FROM lis_participants WHERE id = ?`, { replacements: [patient_id] });
    if (!participant) return res.status(404).json({ error: 'Patient not found' });

    const id = uuidv4();
    const patientName = `${participant.first_name || ''} ${participant.last_name || ''}`.trim();
    await db.query(
      `INSERT INTO patient_referrals
         (id, clinic_id, patient_id, patient_name, from_branch_id, to_branch_id, reason, requested_by, requested_by_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
      { replacements: [id, req.user?.clinicId || null, patient_id, patientName, fromBranchId, to_branch_id, reason || null, req.user?.id || null, req.user?.displayName || req.user?.email || null] }
    );

    try {
      const { notifyRole } = require('../services/notificationService');
      await notifyRole(db, {
        clinic_id: req.user?.clinicId, role: 'doctor', branch_id: to_branch_id,
        type: 'referral_received', title: 'New patient referral',
        message: `${patientName} referred from another branch — please review and respond`,
        entity_type: 'PatientReferral', entity_id: id, link: '/patient-referrals',
      });
      await notifyRole(db, {
        clinic_id: req.user?.clinicId, role: 'admin', branch_id: to_branch_id,
        type: 'referral_received', title: 'New patient referral',
        message: `${patientName} referred from another branch — please review and respond`,
        entity_type: 'PatientReferral', entity_id: id, link: '/patient-referrals',
      });
    } catch (e) { /* non-blocking */ }

    try {
      const rr = require('./reports');
      await rr.logAudit({
        req, clinic_id: req.user?.clinicId, user_id: req.user?.id, user_name: req.user?.displayName, user_role: req.user?.role,
        module: 'Clinical', action: 'REFERRAL_CREATED', entity_type: 'PatientReferral', entity_id: id,
        description: `${patientName} referred to ${toBranch.name}`,
      });
    } catch (e) { /* non-blocking */ }

    res.status(201).json({ id, status: 'pending' });
  } catch (error) {
    console.error('Error creating patient referral:', error);
    res.status(500).json({ error: 'Failed to create referral' });
  }
});

async function decide(req, res, { newStatus, requireToBranch, notifyMessage, auditAction }) {
  const { sequelize: db } = req.models;
  try {
    const [[referral]] = await db.query(`SELECT * FROM patient_referrals WHERE id = ?`, { replacements: [req.params.id] });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });
    if (referral.status !== 'pending') return res.status(409).json({ error: `This referral is already ${referral.status}` });

    const branchId = getUserBranchId(req);
    if (requireToBranch && !isUnscopedAdmin(req) && String(referral.to_branch_id) !== String(branchId)) {
      return res.status(403).json({ error: 'Only the receiving branch can respond to this referral' });
    }

    const decisionReason = req.body?.decision_reason || null;
    const t = await db.transaction();
    try {
      await db.query(
        `UPDATE patient_referrals SET status = ?, decided_by = ?, decided_by_name = ?, decision_reason = ?, decided_at = NOW(), updated_at = NOW() WHERE id = ?`,
        { replacements: [newStatus, req.user?.id || null, req.user?.displayName || req.user?.email || null, decisionReason, referral.id], transaction: t }
      );
      if (newStatus === 'accepted') {
        await db.query(`UPDATE lis_participants SET branch_id = ?, updated_at = NOW() WHERE id = ?`, { replacements: [referral.to_branch_id, referral.patient_id], transaction: t });
      }
      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }

    try {
      const { notifyUser } = require('../services/notificationService');
      if (referral.requested_by) {
        await notifyUser(db, {
          clinic_id: req.user?.clinicId, user_id: referral.requested_by,
          type: 'referral_decided', title: notifyMessage.title,
          message: notifyMessage.body(referral),
          entity_type: 'PatientReferral', entity_id: referral.id, link: '/patient-referrals',
        });
      }
    } catch (e) { /* non-blocking */ }

    try {
      const rr = require('./reports');
      await rr.logAudit({
        req, clinic_id: req.user?.clinicId, user_id: req.user?.id, user_name: req.user?.displayName, user_role: req.user?.role,
        module: 'Clinical', action: auditAction, entity_type: 'PatientReferral', entity_id: referral.id,
        description: `Referral for ${referral.patient_name} ${newStatus}`,
      });
    } catch (e) { /* non-blocking */ }

    res.json({ id: referral.id, status: newStatus });
  } catch (error) {
    console.error(`Error deciding patient referral (${newStatus}):`, error);
    res.status(500).json({ error: 'Failed to update referral' });
  }
}

router.post('/:id/accept', authorize('referrals.write'), (req, res) => decide(req, res, {
  newStatus: 'accepted', requireToBranch: true,
  notifyMessage: { title: 'Referral accepted', body: (r) => `${r.patient_name} was accepted by the receiving branch` },
  auditAction: 'REFERRAL_ACCEPTED',
}));

router.post('/:id/reject', authorize('referrals.write'), (req, res) => decide(req, res, {
  newStatus: 'rejected', requireToBranch: true,
  notifyMessage: { title: 'Referral rejected', body: (r) => `${r.patient_name} was declined by the receiving branch` },
  auditAction: 'REFERRAL_REJECTED',
}));

// Only the original requester (or an admin) can withdraw their own
// still-pending referral — not the receiving branch, which uses
// accept/reject instead.
router.post('/:id/cancel', authorize('referrals.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [[referral]] = await db.query(`SELECT * FROM patient_referrals WHERE id = ?`, { replacements: [req.params.id] });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });
    if (referral.status !== 'pending') return res.status(409).json({ error: `This referral is already ${referral.status}` });
    if (req.user?.role !== 'admin' && String(referral.requested_by) !== String(req.user?.id)) {
      return res.status(403).json({ error: 'Only the person who sent this referral can cancel it' });
    }

    await db.query(
      `UPDATE patient_referrals SET status = 'cancelled', decided_by = ?, decided_by_name = ?, decided_at = NOW(), updated_at = NOW() WHERE id = ?`,
      { replacements: [req.user?.id || null, req.user?.displayName || req.user?.email || null, referral.id] }
    );

    try {
      const rr = require('./reports');
      await rr.logAudit({
        req, clinic_id: req.user?.clinicId, user_id: req.user?.id, user_name: req.user?.displayName, user_role: req.user?.role,
        module: 'Clinical', action: 'REFERRAL_CANCELLED', entity_type: 'PatientReferral', entity_id: referral.id,
        description: `Referral for ${referral.patient_name} cancelled`,
      });
    } catch (e) { /* non-blocking */ }

    res.json({ id: referral.id, status: 'cancelled' });
  } catch (error) {
    console.error('Error cancelling patient referral:', error);
    res.status(500).json({ error: 'Failed to cancel referral' });
  }
});

module.exports = router;
