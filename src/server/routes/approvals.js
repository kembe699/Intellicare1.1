const express = require('express');
const { reportSchemaGuardFailure } = require('../utils/legacyDDL');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { APPROVAL_TYPES } = require('../middleware/requireApprovalPermission');

// Ensure the approval_permissions table exists on startup (self-migrating,
// matches the try/catch + CREATE TABLE IF NOT EXISTS convention used
// throughout this codebase, e.g. src/server/routes/procurement.js).
(async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS approval_permissions (
        id CHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL DEFAULT 1,
        user_id INT NOT NULL,
        approval_type VARCHAR(50) NOT NULL,
        granted_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_clinic_user_type (clinic_id, user_id, approval_type)
      )
    `);
    console.log('✅ approval_permissions table ready');
  } catch (error) {
    reportSchemaGuardFailure('approval_permissions table', error);
  }
})();

// GET /api/approvals/types — static catalog of every approval/authorization
// action in the system.
router.get('/types', (req, res) => {
  const types = Object.entries(APPROVAL_TYPES).map(([key, v]) => ({
    key,
    label: v.label,
    module: v.module,
    description: v.description || '',
  }));
  res.json(types);
});

// GET /api/approvals/permissions?clinic_id=X — list all current grants,
// joined with users for display_name/email.
router.get('/permissions', async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id) || req.user?.clinicId || 1;
    const [rows] = await sequelize.query(
      `SELECT ap.id, ap.clinic_id, ap.user_id, ap.approval_type, ap.granted_by, ap.created_at, ap.updated_at,
              u.display_name, u.email,
              gu.display_name AS granted_by_name
       FROM approval_permissions ap
       JOIN users u ON u.id = ap.user_id
       LEFT JOIN users gu ON gu.id = ap.granted_by
       WHERE ap.clinic_id = :clinicId
       ORDER BY ap.created_at DESC`,
      { replacements: { clinicId } }
    );
    const withLabels = rows.map(r => ({
      ...r,
      label: APPROVAL_TYPES[r.approval_type]?.label || r.approval_type,
      module: APPROVAL_TYPES[r.approval_type]?.module || '',
    }));
    res.json(withLabels);
  } catch (error) {
    console.error('Error fetching approval permissions:', error);
    res.status(500).json({ error: 'Failed to fetch approval permissions' });
  }
});

// POST /api/approvals/permissions — grant a permission (upsert; ignore if
// already granted).
router.post('/permissions', authorize('approvals.manage'), async (req, res) => {
  try {
    const { user_id, approval_type, clinic_id } = req.body;
    if (!user_id || !approval_type) {
      return res.status(400).json({ error: 'user_id and approval_type are required' });
    }
    if (!APPROVAL_TYPES[approval_type]) {
      return res.status(400).json({ error: `Unknown approval_type '${approval_type}'` });
    }
    const clinicId = parseInt(clinic_id) || req.user?.clinicId || 1;
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO approval_permissions (id, clinic_id, user_id, approval_type, granted_by)
       VALUES (:id, :clinicId, :userId, :approvalType, :grantedBy)
       ON CONFLICT (clinic_id, user_id, approval_type) DO UPDATE SET updated_at = NOW()`,
      {
        replacements: {
          id,
          clinicId,
          userId: parseInt(user_id),
          approvalType: approval_type,
          grantedBy: req.user?.id || null,
        },
      }
    );
    res.status(201).json({ message: 'Permission granted' });
  } catch (error) {
    console.error('Error granting approval permission:', error);
    res.status(500).json({ error: 'Failed to grant approval permission' });
  }
});

// DELETE /api/approvals/permissions/:id — revoke.
router.delete('/permissions/:id', authorize('approvals.manage'), async (req, res) => {
  try {
    await sequelize.query('DELETE FROM approval_permissions WHERE id = :id', {
      replacements: { id: req.params.id },
    });
    res.json({ message: 'Permission revoked' });
  } catch (error) {
    console.error('Error revoking approval permission:', error);
    res.status(500).json({ error: 'Failed to revoke approval permission' });
  }
});

module.exports = router;
