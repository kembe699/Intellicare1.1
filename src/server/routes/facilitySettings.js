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

const DEFAULTS = {
  queue_receipt_enabled: true,
  billing_redirect_after_queue_enabled: true,
  patient_number_prefix: 'PTN',
  patient_number_suffix: '',
};

router.get('/', async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = parseInt(req.query.clinic_id) || req.user?.clinicId || 1;
    const [[row]] = await db.query(
      `SELECT queue_receipt_enabled, billing_redirect_after_queue_enabled, patient_number_prefix, patient_number_suffix, updated_at
       FROM facility_settings WHERE clinic_id = ?`,
      { replacements: [clinicId] }
    );
    res.json({ clinic_id: clinicId, ...DEFAULTS, ...(row || {}) });
  } catch (error) {
    console.error('Error fetching facility settings:', error);
    res.status(500).json({ error: 'Failed to fetch facility settings' });
  }
});

router.put('/', authorize('setup.facility_settings.manage'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = parseInt(req.body.clinic_id) || req.user?.clinicId || 1;
    const {
      queue_receipt_enabled, billing_redirect_after_queue_enabled,
      patient_number_prefix, patient_number_suffix,
    } = req.body;

    // Prefix/suffix flow straight onto a printed receipt and into
    // participant_number — plain alphanumerics/dashes only, so a stray
    // character here can't break a downstream format string or inject
    // anything into the printed slip.
    const cleanSegment = (v) => String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);

    await db.query(
      `INSERT INTO facility_settings (clinic_id, queue_receipt_enabled, billing_redirect_after_queue_enabled, patient_number_prefix, patient_number_suffix, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT (clinic_id) DO UPDATE SET
         queue_receipt_enabled = EXCLUDED.queue_receipt_enabled,
         billing_redirect_after_queue_enabled = EXCLUDED.billing_redirect_after_queue_enabled,
         patient_number_prefix = EXCLUDED.patient_number_prefix,
         patient_number_suffix = EXCLUDED.patient_number_suffix,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      {
        replacements: [
          clinicId,
          queue_receipt_enabled !== false,
          billing_redirect_after_queue_enabled !== false,
          cleanSegment(patient_number_prefix) || 'PTN',
          cleanSegment(patient_number_suffix),
          req.user?.id || null,
        ],
      }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving facility settings:', error);
    res.status(500).json({ error: 'Failed to save facility settings' });
  }
});

module.exports = router;
