/**
 * Outpatient/triage nursing procedures log — separate from the doctor's
 * prescription pipeline and from inpatient's own drug_administrations
 * (admitted patients). Two kinds of entry:
 *
 *  - A free-form, unbilled NOTE a nurse adds directly (entry_type='note'),
 *    always already 'completed' — nothing here is charged for, so no
 *    ordering step is needed.
 *  - A billable PROCEDURE (entry_type='procedure') — an injection, a
 *    dressing, a minor procedure — which must start as a doctor- or
 *    reception-placed ORDER (status='pending'), billed immediately the
 *    same way a theatre request bills (see TheatreService.createRequest —
 *    identical pattern: pick a catalog service, bill it via
 *    addLineItemsToBill, store the resulting bill_id), and which a nurse
 *    later fulfills (status='completed'), filling in what was actually
 *    done. A nurse never decides to bill something themselves.
 *
 * Keyed on lis_participants.id, same convention as patient_referrals.js.
 */
const express = require('express');
const { getBaseCurrencyCode } = require('../utils/baseCurrency');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authorize, getRolePrivileges } = require('../middleware/authorize');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { addLineItemsToBill } = require('../utils/billingResolver');

const PROCEDURE_TYPES = ['injection', 'minor_procedure', 'dressing', 'other'];

// authorize() takes either ONE privilege key or a literal ROLE array — there's
// no "any of these privilege keys" shape, so the patient-history read (which
// the nurse who fulfills AND the doctor/reception who orders both need) gets
// its own small OR-of-privileges middleware instead of misusing either shape.
const authorizeAny = (keys) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role === 'admin') return next();
  const roles = [req.user.role, ...(req.user.additionalRoles || [])];
  try {
    const grants = await getRolePrivileges(req.models.sequelize, req.tenantSchema);
    const ok = keys.some((key) => roles.some((r) => grants.get(r)?.has(key)));
    if (!ok) return res.status(403).json({ error: 'Insufficient permissions', required: keys, current: req.user.role });
    return next();
  } catch (err) {
    console.error('authorizeAny lookup failed:', err.message);
    return res.status(503).json({ error: 'Could not verify permissions, please try again' });
  }
};

// GET / — recent log (orders + notes, pending + completed), branch-scoped.
router.get('/', authorizeAny(['nursing.procedures.write', 'nursing.procedures.order']), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchFilter = getBranchConditionSQL(req, 'np');
    const [rows] = await db.query(
      `SELECT np.*, p.first_name, p.last_name, p.participant_number,
              nu.display_name as nurse_name, ou.display_name as ordered_by_name
       FROM nursing_procedures np
       LEFT JOIN lis_participants p ON p.id = np.participant_id
       LEFT JOIN users nu ON nu.id = np.nurse_id
       LEFT JOIN users ou ON ou.id = np.ordered_by
       WHERE np.clinic_id = ? ${branchFilter.sql}
       ORDER BY np.created_at DESC
       LIMIT 300`,
      { replacements: [clinicId, ...branchFilter.params] }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching nursing procedures:', error);
    res.status(500).json({ error: 'Failed to fetch nursing procedures' });
  }
});

// GET /catalog — Nursing-category billable services, for the order form.
// Set up by the clinic at /setup/services the same way Procedure/Laboratory
// services already are — nothing seeded by default here.
router.get('/catalog', authorize('nursing.procedures.order'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [rows] = await db.query(
      `SELECT id, service_name, price FROM services WHERE category = 'Nursing' AND is_active = true ORDER BY service_name`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching nursing service catalog:', error);
    res.status(500).json({ error: 'Failed to fetch nursing service catalog' });
  }
});

// GET /participant/:participantId — this one patient's full history (orders + notes).
router.get('/participant/:participantId', authorizeAny(['nursing.procedures.write', 'nursing.procedures.order']), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [rows] = await db.query(
      `SELECT np.*, p.first_name, p.last_name, p.participant_number, p.gender,
              ou.display_name as ordered_by_name, nu.display_name as nurse_name
       FROM nursing_procedures np
       LEFT JOIN lis_participants p ON p.id = np.participant_id
       LEFT JOIN users ou ON ou.id = np.ordered_by
       LEFT JOIN users nu ON nu.id = np.nurse_id
       WHERE np.participant_id = ?
       ORDER BY np.created_at DESC`,
      { replacements: [req.params.participantId] }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching patient nursing procedures:', error);
    res.status(500).json({ error: 'Failed to fetch patient nursing procedures' });
  }
});

// POST /notes — a nurse's free-form, unbilled note. No order, no billing.
router.post('/notes', authorize('nursing.procedures.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { participant_id, order_id, note } = req.body;
    if (!participant_id) return res.status(400).json({ error: 'participant_id is required' });
    if (!note || !note.trim()) return res.status(400).json({ error: 'note is required' });

    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const id = uuidv4();
    await db.query(
      `INSERT INTO nursing_procedures (id, clinic_id, branch_id, participant_id, order_id, nurse_id, entry_type, status, description, performed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'note', 'completed', ?, NOW())`,
      { replacements: [id, clinicId, getCreateBranchId(req), participant_id, order_id || null, req.user?.id || null, note.trim()] }
    );
    res.status(201).json({ id, message: 'Note added' });
  } catch (error) {
    console.error('Error adding nursing note:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// POST /orders — a doctor or receptionist orders one OR SEVERAL billable
// procedures for the same patient in one go (`items: [{ service_id,
// procedure_type, notes }, ...]` — a single `service_id`/`procedure_type`/
// `notes` at the top level is still accepted as shorthand for one item).
// All priced items bill together as one bill update (same pattern as
// TheatreService.createRequest's single-item version), each inserted
// 'pending' for a nurse to fulfill individually via PUT /:id/complete.
router.post('/orders', authorize('nursing.procedures.order'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { participant_id, order_id } = req.body;
    const items = Array.isArray(req.body.items) && req.body.items.length > 0
      ? req.body.items
      : [{ service_id: req.body.service_id, procedure_type: req.body.procedure_type, notes: req.body.notes }];

    if (!participant_id) return res.status(400).json({ error: 'participant_id is required' });
    for (const item of items) {
      if (!item.service_id) return res.status(400).json({ error: 'service_id is required for every procedure — pick a service from the Nursing catalog' });
      if (!PROCEDURE_TYPES.includes(item.procedure_type)) {
        return res.status(400).json({ error: `procedure_type must be one of: ${PROCEDURE_TYPES.join(', ')}` });
      }
    }

    const serviceIds = [...new Set(items.map((i) => i.service_id))];
    const [services] = await db.query(
      `SELECT id, service_name, price FROM services WHERE id IN (:serviceIds) AND category = 'Nursing' AND is_active = true`,
      { replacements: { serviceIds } }
    );
    const serviceById = new Map(services.map((s) => [s.id, s]));
    for (const item of items) {
      if (!serviceById.has(item.service_id)) return res.status(404).json({ error: 'One or more services were not found in the Nursing catalog' });
    }

    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchId = getCreateBranchId(req);

    const [[participant]] = await db.query(
      `SELECT first_name, last_name FROM lis_participants WHERE id = ?`,
      { replacements: [participant_id] }
    );
    const patientName = participant ? `${participant.first_name} ${participant.last_name}` : 'Patient';

    const lines = items.map((item) => {
      const service = serviceById.get(item.service_id);
      return { item, service, fee: parseFloat(service.price) || 0 };
    });

    const billableLines = lines.filter((l) => l.fee > 0);
    let billId = null;
    if (billableLines.length > 0) {
      const bill = await addLineItemsToBill({
        patientId: participant_id, patientName, clinicId, branchId,
        lineItems: billableLines.map((l) => ({ serviceId: l.service.id, serviceName: l.service.service_name, quantity: 1, unitPrice: l.fee, totalPrice: l.fee, revenueCategory: 'Nursing Procedure' })),
        notes: `Nursing procedures — ${billableLines.map((l) => l.service.service_name).join(', ')}`,
        createdBy: req.user?.displayName || String(req.user?.id || 'System'),
      });
      billId = bill?.id || null;
    }

    const ids = [];
    const feeCurrency = await getBaseCurrencyCode();
    for (const { item, service, fee } of lines) {
      const id = uuidv4();
      await db.query(
        `INSERT INTO nursing_procedures
           (id, clinic_id, branch_id, participant_id, order_id, ordered_by, ordered_at, entry_type, status,
            procedure_type, service_id, fee_amount, fee_currency, bill_id, description, notes, performed_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), 'procedure', 'pending',
                 ?, ?, ?, ?, ?, ?, ?, NOW())`,
        { replacements: [
          id, clinicId, branchId, participant_id, order_id || null, req.user?.id || null,
          item.procedure_type, service.id, fee, feeCurrency, fee > 0 ? billId : null, service.service_name, item.notes || null,
        ] }
      );
      ids.push(id);
    }

    res.status(201).json({ ids, id: ids[0], bill_id: billId, message: `${ids.length} procedure${ids.length > 1 ? 's' : ''} ordered` });
  } catch (error) {
    console.error('Error ordering nursing procedure:', error);
    res.status(500).json({ error: 'Failed to order nursing procedure' });
  }
});

// PUT /:id/complete — a nurse fulfills a pending order, recording what was
// actually done (defaults to the ordered service's name if left blank).
router.put('/:id/complete', authorize('nursing.procedures.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { description, notes } = req.body;
    const [[row]] = await db.query(`SELECT * FROM nursing_procedures WHERE id = ?`, { replacements: [req.params.id] });
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.entry_type !== 'procedure') return res.status(400).json({ error: 'Only an ordered procedure can be completed' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'This procedure is not pending' });

    await db.query(
      `UPDATE nursing_procedures SET status = 'completed', nurse_id = ?, performed_at = NOW(), updated_at = NOW(),
              description = COALESCE(?, description), notes = COALESCE(?, notes)
       WHERE id = ?`,
      { replacements: [req.user?.id || null, description || null, notes || null, req.params.id] }
    );
    res.json({ success: true, message: 'Procedure marked complete' });
  } catch (error) {
    console.error('Error completing nursing procedure:', error);
    res.status(500).json({ error: 'Failed to complete nursing procedure' });
  }
});

module.exports = router;
