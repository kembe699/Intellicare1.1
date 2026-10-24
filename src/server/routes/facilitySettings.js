/**
 * Setup > Configurations — per-facility operational toggles that used to be
 * hardcoded tenant checks in the frontend (the queue receipt's billing
 * redirect was `user.tenantCode === 'kuelmc'`). One row per clinic_id, same
 * scoping convention as billing_settings. GET is unauthenticated-privilege
 * (any logged-in user whose page can read it — e.g. LIS Registration needs
 * these values just to render correctly); PUT is admin-only via
 * setup.facility_settings.manage.
 */
const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
const { getFacilitySettings } = require('../utils/facilitySettings');

router.get('/', async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = parseInt(req.query.clinic_id) || req.user?.clinicId || 1;
    res.json({ clinic_id: clinicId, ...(await getFacilitySettings(db, clinicId)) });
  } catch (error) {
    console.error('Error fetching facility settings:', error);
    res.status(500).json({ error: 'Failed to fetch facility settings' });
  }
});

router.put('/', authorize('setup.facility_settings.manage'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = parseInt(req.body.clinic_id) || req.user?.clinicId || 1;
    // Anything not sent keeps its current value.
    const cur = await getFacilitySettings(db, clinicId);
    const b = { ...cur, ...req.body };
    const bool = (v) => v === true || v === 'true';
    const level = (v, max, dflt) => Math.min(max, Math.max(1, parseInt(v, 10) || dflt));

    // Prefix/suffix flow straight onto a printed receipt and into
    // participant_number — plain alphanumerics/dashes only, so a stray
    // character here can't break a downstream format string or inject
    // anything into the printed slip.
    const cleanSegment = (v) => String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);

    await db.query(
      `INSERT INTO facility_settings (clinic_id, queue_receipt_enabled, billing_redirect_after_queue_enabled, patient_number_prefix, patient_number_suffix,
         approvals_allow_same_person, expense_approvals_required, supplier_bill_approvals_required, receipt_void_requires_approval, credit_note_separate_approver,
         updated_by, updated_at)
       VALUES (:clinicId, :qr, :redir, :prefix, :suffix, :same, :expReq, :billReq, :voidReq, :cnSep, :userId, NOW())
       ON CONFLICT (clinic_id) DO UPDATE SET
         queue_receipt_enabled = EXCLUDED.queue_receipt_enabled,
         billing_redirect_after_queue_enabled = EXCLUDED.billing_redirect_after_queue_enabled,
         patient_number_prefix = EXCLUDED.patient_number_prefix,
         patient_number_suffix = EXCLUDED.patient_number_suffix,
         approvals_allow_same_person = EXCLUDED.approvals_allow_same_person,
         expense_approvals_required = EXCLUDED.expense_approvals_required,
         supplier_bill_approvals_required = EXCLUDED.supplier_bill_approvals_required,
         receipt_void_requires_approval = EXCLUDED.receipt_void_requires_approval,
         credit_note_separate_approver = EXCLUDED.credit_note_separate_approver,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      {
        replacements: {
          clinicId,
          qr: b.queue_receipt_enabled !== false,
          redir: b.billing_redirect_after_queue_enabled !== false,
          prefix: cleanSegment(b.patient_number_prefix) || 'PTN',
          suffix: cleanSegment(b.patient_number_suffix),
          same: bool(b.approvals_allow_same_person),
          expReq: level(b.expense_approvals_required, 2, 2),
          billReq: level(b.supplier_bill_approvals_required, 3, 3),
          voidReq: b.receipt_void_requires_approval !== false && b.receipt_void_requires_approval !== 'false',
          cnSep: bool(b.credit_note_separate_approver),
          userId: req.user?.id || null,
        },
      }
    );
    try {
      const rr = require('./reports');
      await rr.logAudit({ req, clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Setup', action: 'CONFIGURATIONS_UPDATED', entity_type: 'FacilitySettings', entity_id: String(clinicId),
        description: 'Updated Setup › Configurations', old_values: cur, new_values: await getFacilitySettings(db, clinicId), ip_address: req.ip, status: 'success' });
    } catch (e) { /* audit is best-effort */ }
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving facility settings:', error);
    res.status(500).json({ error: 'Failed to save facility settings' });
  }
});

module.exports = router;
