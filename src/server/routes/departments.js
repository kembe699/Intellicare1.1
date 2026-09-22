const express = require('express');
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');
const router = express.Router();

// Get all departments
router.get('/', async (req, res) => {
  try {
    const { clinic } = req.query;
    const clinicId = parseInt(clinic) || 1;
    
    // Build branch filter with named parameters
    const isAdmin = req.user?.role === 'admin';
    const branchId = req.branchContext?.branchId || req.user?.branchId || null;
    let branchSQL = '';
    const replacements = { clinicId };
    
    if (!isAdmin && branchId) {
      branchSQL = ' AND d.branch_id = :branchId';
      replacements.branchId = branchId;
    }
    
    const [departments] = await sequelize.query(`
      SELECT 
        d.id,
        d.department_name,
        d.department_code,
        d.description,
        d.is_active,
        d.clinic_id,
        d.branch_id,
        d.created_at,
        d.updated_at
      FROM departments d
      WHERE d.clinic_id = :clinicId
        ${branchSQL}
      ORDER BY d.department_name ASC
    `, {
      replacements
    });
    
    console.log(`Found ${departments.length} departments for clinic ${clinicId}`);
    res.json(departments);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments', details: error.message });
  }
});

// Get single department by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Build branch filter with named parameters — same inline style as
    // GET / above (getBranchConditionSQL's positional `?` placeholders
    // can't mix with the named :params this query uses).
    const isAdmin = req.user?.role === 'admin';
    const branchId = req.branchContext?.branchId || req.user?.branchId || null;
    let branchSQL = '';
    const replacements = { id };
    if (!isAdmin && branchId) {
      branchSQL = ' AND d.branch_id = :branchId';
      replacements.branchId = branchId;
    }

    const [departments] = await sequelize.query(`
      SELECT
        d.id,
        d.department_name,
        d.department_code,
        d.description,
        d.is_active,
        d.clinic_id,
        d.branch_id,
        d.created_at,
        d.updated_at
      FROM departments d
      WHERE d.id = :id
        ${branchSQL}
    `, {
      replacements
    });
    
    if (departments.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }
    
    res.json(departments[0]);
  } catch (error) {
    console.error('Error fetching department:', error);
    res.status(500).json({ error: 'Failed to fetch department', details: error.message });
  }
});

// Create new department
router.post('/', authorize('setup.departments.manage'), async (req, res) => {
  try {
    const { department_name, department_code, description, clinic_id, is_active } = req.body;
    
    if (!department_name || !department_code) {
      return res.status(400).json({ error: 'Department name and code are required' });
    }
    
    const id = uuidv4();
    const branchId = getCreateBranchId(req);

    // Check if department code already exists — scoped to this branch
    // (admins: clinic-wide), so a second branch creating its own department
    // with the same code doesn't get a false "already exists" 409 against a
    // different branch's department. Same convention as labTests.js's
    // POST /with-components uses for its equivalent check.
    const existsReplacements = { code: department_code.toUpperCase(), clinicId: clinic_id || 1 };
    let existsBranchSQL = '';
    if (branchId) {
      existsBranchSQL = ' AND branch_id = :branchId';
      existsReplacements.branchId = branchId;
    } else if (req.user?.role !== 'admin') {
      existsBranchSQL = ' AND branch_id IS NULL';
    }
    const [existing] = await sequelize.query(`
      SELECT id FROM departments
      WHERE department_code = :code AND clinic_id = :clinicId${existsBranchSQL}
    `, {
      replacements: existsReplacements
    });

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Department code already exists for this clinic' });
    }
    
    await sequelize.query(`
      INSERT INTO departments (
        id, department_name, department_code, description, 
        is_active, clinic_id, branch_id, created_at, updated_at
      ) VALUES (
        :id, :department_name, :department_code, :description,
        :is_active, :clinic_id, :branch_id, NOW(), NOW()
      )
    `, {
      replacements: {
        id,
        department_name,
        department_code: department_code.toUpperCase(),
        description: description || null,
        is_active: is_active !== false,
        clinic_id: clinic_id || 1,
        branch_id: branchId
      }
    });
    
    console.log(`Created department: ${department_name} (${department_code})`);
    
    res.status(201).json({
      id,
      department_name,
      department_code: department_code.toUpperCase(),
      description,
      is_active: is_active !== false,
      clinic_id: clinic_id || 1,
      branch_id: branchId,
      message: 'Department created successfully'
    });
  } catch (error) {
    console.error('Error creating department:', error);
    res.status(500).json({ error: 'Failed to create department', details: error.message });
  }
});

// Update department
router.put('/:id', authorize('setup.departments.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { department_name, department_code, description, is_active } = req.body;
    
    if (!department_name || !department_code) {
      return res.status(400).json({ error: 'Department name and code are required' });
    }
    
    // Check if department exists
    const [existing] = await sequelize.query(`
      SELECT id, clinic_id FROM departments WHERE id = :id
    `, {
      replacements: { id }
    });
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }
    
    // Check if new code conflicts with another department
    const [codeConflict] = await sequelize.query(`
      SELECT id FROM departments 
      WHERE department_code = :code 
        AND clinic_id = :clinicId 
        AND id != :id
    `, {
      replacements: { 
        code: department_code.toUpperCase(), 
        clinicId: existing[0].clinic_id,
        id 
      }
    });
    
    if (codeConflict.length > 0) {
      return res.status(409).json({ error: 'Department code already exists for this clinic' });
    }
    
    await sequelize.query(`
      UPDATE departments 
      SET 
        department_name = :department_name,
        department_code = :department_code,
        description = :description,
        is_active = :is_active,
        updated_at = NOW()
      WHERE id = :id
    `, {
      replacements: {
        id,
        department_name,
        department_code: department_code.toUpperCase(),
        description: description || null,
        is_active: is_active !== false
      }
    });
    
    console.log(`Updated department: ${id}`);
    
    res.json({
      id,
      department_name,
      department_code: department_code.toUpperCase(),
      description,
      is_active: is_active !== false,
      message: 'Department updated successfully'
    });
  } catch (error) {
    console.error('Error updating department:', error);
    res.status(500).json({ error: 'Failed to update department', details: error.message });
  }
});

// Delete department
router.delete('/:id', authorize('setup.departments.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if department exists
    const [existing] = await sequelize.query(`
      SELECT id FROM departments WHERE id = :id
    `, {
      replacements: { id }
    });
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }
    
    // Soft delete by setting is_active to false
    await sequelize.query(`
      UPDATE departments 
      SET is_active = false, updated_at = NOW()
      WHERE id = :id
    `, {
      replacements: { id }
    });
    
    console.log(`Deleted (soft) department: ${id}`);
    
    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({ error: 'Failed to delete department', details: error.message });
  }
});

module.exports = router;
