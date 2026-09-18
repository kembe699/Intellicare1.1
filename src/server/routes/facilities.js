const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
const { Facility, sequelize } = require('../models');

// ============================================================
// Ensure branches table exists
// ============================================================
async function ensureBranchesTable() {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        facility_id INT,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        is_main_branch BOOLEAN DEFAULT FALSE,
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        city VARCHAR(100),
        region VARCHAR(100),
        country VARCHAR(100) DEFAULT 'South Sudan',
        manager_name VARCHAR(255),
        manager_phone VARCHAR(50),
        opening_time VARCHAR(10) DEFAULT '08:00',
        closing_time VARCHAR(10) DEFAULT '17:00',
        bed_capacity INT DEFAULT 0,
        staff_count INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('branches table ensured');
  } catch (error) {
    console.log('Note: Could not ensure branches table:', error.message);
  }
}
ensureBranchesTable();

// ============================================================
// BRANCHES ENDPOINTS (must be defined BEFORE /:id catch-all)
// ============================================================

// GET /api/facilities/name - This facility's display name.
// Declared before the /:id catch-all, which would otherwise swallow "name".
// It previously lived in index.js ahead of authenticateToken and therefore read
// the template schema; it is authenticated now, like every other tenant route.
router.get('/name', async (req, res) => {
  try {
    const [facilities] = await sequelize.query(
      `SELECT name FROM facilities ORDER BY id LIMIT 1`
    );
    res.json({ success: true, name: facilities[0]?.name || '' });
  } catch (error) {
    console.error('Error fetching facility name:', error);
    res.json({ success: true, name: '' });
  }
});

// GET /api/facilities/branches/all - Get all branches
router.get('/branches/all', async (req, res) => {
  try {
    const [branches] = await sequelize.query(`
      SELECT * FROM branches ORDER BY is_main_branch DESC, name ASC
    `);
    res.json({ success: true, data: branches });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch branches' });
  }
});

// GET /api/facilities/branches/:id - Get single branch
router.get('/branches/:id', async (req, res) => {
  try {
    const [branches] = await sequelize.query(
      'SELECT * FROM branches WHERE id = $1',
      { bind: [req.params.id], type: sequelize.QueryTypes.SELECT }
    );
    if (branches.length === 0) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }
    res.json({ success: true, data: branches[0] });
  } catch (error) {
    console.error('Error fetching branch:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch branch' });
  }
});

// POST /api/facilities/branches - Create new branch
router.post('/branches', authorize('setup.facilities.manage'), async (req, res) => {
  try {
    const {
      name, description, is_main_branch, phone, email,
      address, city, region, country,
      manager_name, manager_phone,
      opening_time, closing_time, bed_capacity, is_active,
      facility_id
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Branch name is required' });
    }

    // If setting as main branch, unset others first
    if (is_main_branch) {
      await sequelize.query('UPDATE branches SET is_main_branch = FALSE WHERE is_main_branch = TRUE');
    }

    const [rows] = await sequelize.query(`
      INSERT INTO branches (facility_id, name, description, is_main_branch, phone, email, address, city, region, country, manager_name, manager_phone, opening_time, closing_time, bed_capacity, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id
    `, {
      bind: [
        facility_id || null,
        name,
        description || null,
        is_main_branch ? true : false,
        phone || null,
        email || null,
        address || null,
        city || null,
        region || null,
        country || 'South Sudan',
        manager_name || null,
        manager_phone || null,
        opening_time || '08:00',
        closing_time || '17:00',
        bed_capacity || 0,
        is_active !== undefined ? !!is_active : true
      ],
      type: sequelize.QueryTypes.INSERT
    });

    const branchId = rows[0]?.id;
    const newBranch = await sequelize.query('SELECT * FROM branches WHERE id = $1', {
      bind: [branchId],
      type: sequelize.QueryTypes.SELECT
    });

    res.status(201).json({ success: true, data: newBranch[0] || { id: branchId } });
  } catch (error) {
    console.error('Error creating branch:', error);
    res.status(500).json({ success: false, error: 'Failed to create branch' });
  }
});

// PUT /api/facilities/branches/:id - Update branch
router.put('/branches/:id', authorize('setup.facilities.manage'), async (req, res) => {
  try {
    const branchId = req.params.id;
    const {
      name, description, is_main_branch, phone, email,
      address, city, region, country,
      manager_name, manager_phone,
      opening_time, closing_time, bed_capacity, is_active
    } = req.body;

    // Check branch exists
    const existing = await sequelize.query('SELECT id FROM branches WHERE id = $1', {
      bind: [branchId],
      type: sequelize.QueryTypes.SELECT
    });
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    // If setting as main branch, unset others first
    if (is_main_branch) {
      await sequelize.query('UPDATE branches SET is_main_branch = FALSE WHERE is_main_branch = TRUE AND id != $1', {
        bind: [branchId]
      });
    }

    await sequelize.query(`
      UPDATE branches SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        is_main_branch = COALESCE($3, is_main_branch),
        phone = COALESCE($4, phone),
        email = COALESCE($5, email),
        address = COALESCE($6, address),
        city = COALESCE($7, city),
        region = COALESCE($8, region),
        country = COALESCE($9, country),
        manager_name = COALESCE($10, manager_name),
        manager_phone = COALESCE($11, manager_phone),
        opening_time = COALESCE($12, opening_time),
        closing_time = COALESCE($13, closing_time),
        bed_capacity = COALESCE($14, bed_capacity),
        is_active = COALESCE($15, is_active),
        updated_at = NOW()
      WHERE id = $16
    `, {
      bind: [
        name || null, description || null,
        is_main_branch !== undefined ? !!is_main_branch : null,
        phone || null, email || null,
        address || null, city || null, region || null, country || null,
        manager_name || null, manager_phone || null,
        opening_time || null, closing_time || null,
        bed_capacity !== undefined ? bed_capacity : null,
        is_active !== undefined ? !!is_active : null,
        branchId
      ]
    });

    const updated = await sequelize.query('SELECT * FROM branches WHERE id = $1', {
      bind: [branchId],
      type: sequelize.QueryTypes.SELECT
    });

    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error updating branch:', error);
    res.status(500).json({ success: false, error: 'Failed to update branch' });
  }
});

// DELETE /api/facilities/branches/:id - Delete branch
router.delete('/branches/:id', authorize('setup.facilities.manage'), async (req, res) => {
  try {
    const branchId = req.params.id;
    const existing = await sequelize.query('SELECT id, name FROM branches WHERE id = $1', {
      bind: [branchId],
      type: sequelize.QueryTypes.SELECT
    });
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    await sequelize.query('DELETE FROM branches WHERE id = $1', {
      bind: [branchId]
    });

    res.json({ success: true, message: `Branch "${existing[0].name}" deleted successfully` });
  } catch (error) {
    console.error('Error deleting branch:', error);
    res.status(500).json({ success: false, error: 'Failed to delete branch' });
  }
});

// PATCH /api/facilities/branches/:id/toggle - Toggle branch active status
router.patch('/branches/:id/toggle', authorize('setup.facilities.manage'), async (req, res) => {
  try {
    const branchId = req.params.id;
    const existing = await sequelize.query('SELECT id, is_active FROM branches WHERE id = $1', {
      bind: [branchId],
      type: sequelize.QueryTypes.SELECT
    });
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    const newStatus = !existing[0].is_active;
    await sequelize.query('UPDATE branches SET is_active = $1, updated_at = NOW() WHERE id = $2', {
      bind: [newStatus, branchId]
    });

    res.json({ success: true, data: { id: branchId, is_active: !!newStatus } });
  } catch (error) {
    console.error('Error toggling branch:', error);
    res.status(500).json({ success: false, error: 'Failed to toggle branch status' });
  }
});

// ============================================================
// FACILITY (Hospital) ENDPOINTS (after branches to avoid /:id conflicts)
// ============================================================

// GET /api/facilities - Get primary facility
router.get('/', async (req, res) => {
  try {
    // Use raw query as fallback-safe approach
    const [facilities] = await sequelize.query(
      'SELECT * FROM facilities ORDER BY created_at ASC LIMIT 1'
    );
    const primary = facilities.length > 0 ? facilities[0] : null;
    res.json({ success: true, data: primary });
  } catch (error) {
    console.error('Error fetching facility:', error.message);
    // If table doesn't exist yet, return null gracefully
    res.json({ success: true, data: null });
  }
});

// Helper: sanitize facility data (convert empty strings to null for optional fields)
function sanitizeFacilityData(body) {
  const data = { ...body };
  // Integer fields — convert empty string to null
  if (data.bed_capacity === '' || data.bed_capacity === undefined) data.bed_capacity = null;
  // Date fields — convert empty string to null
  if (!data.established_date) data.established_date = null;
  // Optional string fields — convert empty string to null
  ['fax', 'website', 'license_number', 'postal_code', 'city', 'state', 'description', 'logo'].forEach(f => {
    if (data[f] === '') data[f] = null;
  });
  // Ensure required defaults
  if (!data.type) data.type = 'Hospital';
  if (!data.country) data.country = 'South Sudan';
  return data;
}

// POST /api/facilities - Create new facility
router.post('/', authorize('setup.facilities.manage'), async (req, res) => {
  try {
    const data = sanitizeFacilityData(req.body);
    const facility = await Facility.create(data);
    res.status(201).json({ success: true, data: facility });
  } catch (error) {
    console.error('Error creating facility:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create facility: ' + error.message });
  }
});

// PUT /api/facilities/:id - Update facility
router.put('/:id', authorize('setup.facilities.manage'), async (req, res) => {
  try {
    const facility = await Facility.findByPk(req.params.id);
    if (!facility) {
      return res.status(404).json({ success: false, error: 'Facility not found' });
    }
    const data = sanitizeFacilityData(req.body);
    await facility.update(data);
    res.json({ success: true, data: facility });
  } catch (error) {
    console.error('Error updating facility:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update facility: ' + error.message });
  }
});

// DELETE /api/facilities/:id - Delete facility
router.delete('/:id', authorize('setup.facilities.manage'), async (req, res) => {
  try {
    const facility = await Facility.findByPk(req.params.id);
    if (!facility) {
      return res.status(404).json({ success: false, error: 'Facility not found' });
    }
    await facility.destroy();
    res.json({ success: true, message: 'Facility deleted successfully' });
  } catch (error) {
    console.error('Error deleting facility:', error);
    res.status(500).json({ success: false, error: 'Failed to delete facility' });
  }
});

module.exports = router;
