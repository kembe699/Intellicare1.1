const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
const { DrClinic, sequelize } = require('../models');

// Get all clinics
router.get('/', async (req, res) => {
  try {
    const { noFallback } = req.query;
    
    const clinics = await DrClinic.findAll({
      order: [['created_at', 'DESC']]
    });

    // If dr_clinics is empty and fallback is allowed, fetch from clinic_names table
    if (clinics.length === 0 && noFallback !== 'true') {
      const [clinicNames] = await sequelize.query('SELECT * FROM clinic_names ORDER BY name ASC');
      const transformedClinics = clinicNames.map(clinic => ({
        id: clinic.id,
        name: clinic.name,
        description: null,
        department: null,
        service: null,
        isActive: true,
        createdAt: clinic.created_at,
        updatedAt: clinic.updated_at
      }));
      return res.json(transformedClinics);
    }

    // Transform data for frontend
    const transformedClinics = clinics.map(clinic => ({
      id: clinic.id,
      name: clinic.name,
      description: clinic.description,
      department: clinic.department,
      service: clinic.service || null,
      isActive: clinic.is_active,
      createdAt: clinic.created_at,
      updatedAt: clinic.updated_at
    }));

    res.json(transformedClinics);
  } catch (error) {
    console.error('Error fetching clinics:', error);
    res.status(500).json({ error: 'Failed to fetch clinics' });
  }
});

// Get clinic by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const clinic = await DrClinic.findByPk(id);

    if (!clinic) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    const transformedClinic = {
      id: clinic.id,
      name: clinic.name,
      description: clinic.description,
      department: clinic.department,
      service: clinic.service || null,
      isActive: clinic.is_active,
      createdAt: clinic.created_at,
      updatedAt: clinic.updated_at
    };

    res.json(transformedClinic);
  } catch (error) {
    console.error('Error fetching clinic:', error);
    res.status(500).json({ error: 'Failed to fetch clinic' });
  }
});

// Create new clinic
router.post('/', authorize(['admin']), async (req, res) => {
  try {
    const clinicData = req.body;
    console.log('Creating clinic with data:', clinicData);

    // Validate required fields
    if (!clinicData.name) {
      return res.status(400).json({ error: 'Clinic name is required' });
    }
    if (!clinicData.department) {
      return res.status(400).json({ error: 'Department is required' });
    }

    // Create clinic
    const clinic = await DrClinic.create({
      name: clinicData.name.trim(),
      description: clinicData.description?.trim() || null,
      department: clinicData.department,
      service: clinicData.service || null,
      is_active: clinicData.is_active !== undefined ? clinicData.is_active : true,
      created_by: clinicData.created_by || 'system'
    });

    console.log('Clinic created successfully:', clinic.id);

    // Transform response
    const transformedClinic = {
      id: clinic.id,
      name: clinic.name,
      description: clinic.description,
      department: clinic.department,
      service: clinic.service || null,
      isActive: clinic.is_active,
      createdAt: clinic.created_at,
      updatedAt: clinic.updated_at
    };

    res.status(201).json(transformedClinic);
  } catch (error) {
    console.error('Error creating clinic:', error);
    
    // Handle unique constraint violation
    if (error.original?.code === '23505' || error.message?.includes('unique')) {
      return res.status(400).json({ error: 'A clinic with this name already exists' });
    }
    
    res.status(500).json({ 
      error: 'Failed to create clinic',
      details: error.message 
    });
  }
});

// Update clinic
router.put('/:id', authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log('Updating clinic:', id, 'with data:', updateData);

    const clinic = await DrClinic.findByPk(id);
    if (!clinic) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    // Validate required fields
    if (updateData.name && !updateData.name.trim()) {
      return res.status(400).json({ error: 'Clinic name cannot be empty' });
    }

    // Update clinic
    await clinic.update({
      name: updateData.name?.trim() || clinic.name,
      description: updateData.description?.trim() || clinic.description,
      department: updateData.department || clinic.department,
      service: updateData.service !== undefined ? updateData.service : clinic.service,
      is_active: updateData.is_active !== undefined ? updateData.is_active : clinic.is_active,
      updated_by: updateData.updated_by || 'system'
    });

    console.log('Clinic updated successfully:', clinic.id);

    // Transform response
    const transformedClinic = {
      id: clinic.id,
      name: clinic.name,
      description: clinic.description,
      department: clinic.department,
      service: clinic.service || null,
      isActive: clinic.is_active,
      createdAt: clinic.created_at,
      updatedAt: clinic.updated_at
    };

    res.json(transformedClinic);
  } catch (error) {
    console.error('Error updating clinic:', error);
    
    // Handle unique constraint violation
    if (error.original?.code === '23505' || error.message?.includes('unique')) {
      return res.status(400).json({ error: 'A clinic with this name already exists' });
    }
    
    res.status(500).json({ 
      error: 'Failed to update clinic',
      details: error.message 
    });
  }
});

// Delete clinic
router.delete('/:id', authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const clinic = await DrClinic.findByPk(id);
    if (!clinic) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    await clinic.destroy();
    console.log('Clinic deleted successfully:', id);

    res.json({ message: 'Clinic deleted successfully' });
  } catch (error) {
    console.error('Error deleting clinic:', error);
    res.status(500).json({ 
      error: 'Failed to delete clinic',
      details: error.message 
    });
  }
});

// Get clinics by department
router.get('/department/:department', async (req, res) => {
  try {
    const { department } = req.params;
    
    const clinics = await DrClinic.findAll({
      where: { 
        department: department,
        is_active: true 
      },
      order: [['name', 'ASC']]
    });

    // Transform data for frontend
    const transformedClinics = clinics.map(clinic => ({
      id: clinic.id,
      name: clinic.name,
      description: clinic.description,
      department: clinic.department,
      service: clinic.service || null,
      isActive: clinic.is_active,
      createdAt: clinic.created_at,
      updatedAt: clinic.updated_at
    }));

    res.json(transformedClinics);
  } catch (error) {
    console.error('Error fetching clinics by department:', error);
    res.status(500).json({ error: 'Failed to fetch clinics' });
  }
});

module.exports = router;
