/**
 * HR-side geofenced attendance: sites (create/edit/deactivate/regenerate
 * QR key) and the QR codes themselves. Mounted at /api/attendance, after
 * authenticateToken/branchAccessControl like every other tenant router —
 * see routes/employeePortal.js for the separate, portal-side clock
 * in/out API this pairs with.
 *
 * The "Today board"/reports/manual-correction endpoints (Section 6) and
 * shift CRUD (Section 4) are a later phase — this file is Sections 1 + 2
 * only (sites + QR codes).
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { sequelize } = require('../models');
const { authorize } = require('../middleware/authorize');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { generateSiteKey, signStaticToken, signRotatingToken } = require('../utils/attendanceQr');

function branchScope(req, replacements) {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  return ' AND branch_id = :branchId';
}

router.get('/sites', authorize('attendance.view'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { clinicId };
    const [rows] = await sequelize.query(
      `SELECT * FROM attendance_sites WHERE clinic_id = :clinicId${branchScope(req, replacements)} ORDER BY name`,
      { replacements }
    );
    res.json(rows.map((r) => ({ ...r, qr_key: undefined })));
  } catch (error) {
    console.error('Error listing attendance sites:', error);
    res.status(500).json({ error: 'Failed to load attendance sites' });
  }
});

router.post('/sites', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const { name, latitude, longitude, radius_m, qr_mode } = req.body || {};
    if (!name || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ error: 'Name, latitude, and longitude are required.' });
    }
    const radius = Number(radius_m) || 100;
    if (radius < 30 || radius > 2000) {
      return res.status(400).json({ error: 'Radius must be between 30 and 2000 meters.' });
    }
    const id = uuidv4();
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchId = getCreateBranchId(req);
    if (!branchId) return res.status(400).json({ error: 'A branch is required to create an attendance site.' });

    await sequelize.query(
      `INSERT INTO attendance_sites (id, clinic_id, branch_id, name, latitude, longitude, radius_m, is_active, qr_mode, qr_key, qr_key_created_at, created_by, created_at, updated_at)
       VALUES (:id, :clinicId, :branchId, :name, :latitude, :longitude, :radius, TRUE, :qrMode, :qrKey, NOW(), :createdBy, NOW(), NOW())`,
      {
        replacements: {
          id, clinicId, branchId, name, latitude, longitude, radius,
          qrMode: qr_mode === 'rotating' ? 'rotating' : 'printed',
          qrKey: generateSiteKey(),
          createdBy: req.user.id,
        },
      }
    );
    const [[site]] = await sequelize.query(`SELECT * FROM attendance_sites WHERE id = :id`, { replacements: { id } });
    res.status(201).json(site);
  } catch (error) {
    console.error('Error creating attendance site:', error);
    res.status(500).json({ error: 'Failed to create attendance site' });
  }
});

router.put('/sites/:id', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const { name, latitude, longitude, radius_m, qr_mode, is_active } = req.body || {};
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { id: req.params.id, clinicId };
    const [[existing]] = await sequelize.query(
      `SELECT * FROM attendance_sites WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`,
      { replacements }
    );
    if (!existing) return res.status(404).json({ error: 'Attendance site not found' });

    if (radius_m !== undefined && (Number(radius_m) < 30 || Number(radius_m) > 2000)) {
      return res.status(400).json({ error: 'Radius must be between 30 and 2000 meters.' });
    }

    await sequelize.query(
      `UPDATE attendance_sites SET
         name = COALESCE(:name, name),
         latitude = COALESCE(:latitude, latitude),
         longitude = COALESCE(:longitude, longitude),
         radius_m = COALESCE(:radius, radius_m),
         qr_mode = COALESCE(:qrMode, qr_mode),
         is_active = COALESCE(:isActive, is_active),
         updated_at = NOW()
       WHERE id = :id`,
      {
        replacements: {
          id: existing.id,
          name: name ?? null,
          latitude: typeof latitude === 'number' ? latitude : null,
          longitude: typeof longitude === 'number' ? longitude : null,
          radius: radius_m !== undefined ? Number(radius_m) : null,
          qrMode: qr_mode === 'rotating' || qr_mode === 'printed' ? qr_mode : null,
          isActive: typeof is_active === 'boolean' ? is_active : null,
        },
      }
    );
    const [[updated]] = await sequelize.query(`SELECT * FROM attendance_sites WHERE id = :id`, { replacements: { id: existing.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating attendance site:', error);
    res.status(500).json({ error: 'Failed to update attendance site' });
  }
});

// Regenerating the key invalidates every previously-printed poster
// immediately — see utils/attendanceQr.js's verifyToken, which checks the
// scanned key against the site's CURRENT qr_key.
router.post('/sites/:id/regenerate-key', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { id: req.params.id, clinicId };
    const [[existing]] = await sequelize.query(
      `SELECT * FROM attendance_sites WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`,
      { replacements }
    );
    if (!existing) return res.status(404).json({ error: 'Attendance site not found' });

    const qrKey = generateSiteKey();
    await sequelize.query(
      `UPDATE attendance_sites SET qr_key = :qrKey, qr_key_created_at = NOW(), updated_at = NOW() WHERE id = :id`,
      { replacements: { id: existing.id, qrKey } }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error regenerating attendance site key:', error);
    res.status(500).json({ error: 'Failed to regenerate QR key' });
  }
});

async function loadSiteOr404(req, res) {
  const clinicId = BranchQueryFilter.resolveClinicId(req);
  const replacements = { id: req.params.id, clinicId };
  const [[site]] = await sequelize.query(
    `SELECT * FROM attendance_sites WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`,
    { replacements }
  );
  if (!site) { res.status(404).json({ error: 'Attendance site not found' }); return null; }
  return site;
}

// Returns the printed-poster QR as a data URL — encodes
// /staff/clock?token=...&sig=... so scanning with an ordinary camera app
// also works (it just opens that URL), same as the existing payroll-sign
// QR precedent (routes/hr.js's /signing-link endpoint).
router.get('/sites/:id/qr', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const site = await loadSiteOr404(req, res);
    if (!site) return;
    if (site.qr_mode !== 'printed') {
      return res.status(409).json({ error: 'This site uses a rotating display code, not a printed QR. See /sites/:id/rotating-token.' });
    }
    const { token, sig } = signStaticToken(site);
    const origin = typeof req.query.origin === 'string' && /^https?:\/\//.test(req.query.origin)
      ? req.query.origin.replace(/\/$/, '')
      : `${req.protocol}://${req.get('host')}`;
    const url = `${origin}/staff/clock?token=${encodeURIComponent(token)}&sig=${encodeURIComponent(sig)}`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });
    res.json({ site_name: site.name, url, qr_data_url: qrDataUrl });
  } catch (error) {
    console.error('Error generating attendance site QR:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Polled every ~30s by the HR-only full-screen display page
// (/attendance/display/:site_id, frontend) to refresh the rotating code.
router.get('/sites/:id/rotating-token', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const site = await loadSiteOr404(req, res);
    if (!site) return;
    if (site.qr_mode !== 'rotating') {
      return res.status(409).json({ error: 'This site uses a printed QR code, not a rotating display.' });
    }
    const { token, sig, expiresInMs } = signRotatingToken(site);
    const origin = typeof req.query.origin === 'string' && /^https?:\/\//.test(req.query.origin)
      ? req.query.origin.replace(/\/$/, '')
      : `${req.protocol}://${req.get('host')}`;
    const url = `${origin}/staff/clock?token=${encodeURIComponent(token)}&sig=${encodeURIComponent(sig)}`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });
    res.json({ site_name: site.name, url, qr_data_url: qrDataUrl, expiresInMs });
  } catch (error) {
    console.error('Error generating rotating attendance token:', error);
    res.status(500).json({ error: 'Failed to generate rotating QR code' });
  }
});

module.exports = router;
