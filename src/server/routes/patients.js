const express = require('express');
const { Patient } = require('../models');
const { Op } = require('sequelize');
const { getBranchCondition, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const router = express.Router();

// Get all patients (filtered by branch and optionally by date)
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, clinic_id } = req.query;
    const where = { ...getBranchCondition(req) };

    if (clinic_id) {
      where.clinic_id = parseInt(clinic_id);
    }

    if (startDate && endDate) {
      where.created_at = {
        [Op.between]: [new Date(`${startDate}T00:00:00.000Z`), new Date(`${endDate}T23:59:59.999Z`)]
      };
    } else if (startDate) {
      where.created_at = {
        [Op.gte]: new Date(`${startDate}T00:00:00.000Z`)
      };
    } else if (endDate) {
      where.created_at = {
        [Op.lte]: new Date(`${endDate}T23:59:59.999Z`)
      };
    }

    const patients = await Patient.findAll({
      where,
      order: [['last_name', 'ASC'], ['first_name', 'ASC']],
    });
    res.json(patients);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Search patients by name (filtered by branch)
// Must be registered before the /:id catch-all below, or Express matches "search" as an :id.
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const patients = await Patient.findAll({
      where: {
        ...getBranchCondition(req),
        [Op.or]: [
          { first_name: { [Op.like]: `%${q}%` } },
          { last_name: { [Op.like]: `%${q}%` } },
          { patient_id: { [Op.like]: `%${q}%` } },
        ],
      },
      order: [['last_name', 'ASC'], ['first_name', 'ASC']],
      limit: 50,
    });
    res.json(patients);
  } catch (error) {
    console.error('Error searching patients:', error);
    res.status(500).json({ error: 'Failed to search patients' });
  }
});

// Lookup patient by readable patient_id (e.g. UH-989887) or UUID
router.get('/lookup/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId);
    const orConditions = [{ patient_id: patientId }];
    if (isUUID) orConditions.push({ id: patientId });
    const patient = await Patient.findOne({
      where: {
        ...getBranchCondition(req),
        [Op.or]: orConditions
      }
    });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(patient);
  } catch (error) {
    console.error('Error looking up patient:', error);
    res.status(500).json({ error: 'Failed to lookup patient' });
  }
});

// Get patient by ID
router.get('/:id', async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(patient, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this patient' });
    }
    res.json(patient);
  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({ error: 'Failed to fetch patient' });
  }
});

// Get patients by clinic (filtered by branch)
router.get('/clinic/:clinicId', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const where = { clinic_id: req.params.clinicId, ...getBranchCondition(req) };

    if (startDate && endDate) {
      where.created_at = {
        [Op.between]: [new Date(`${startDate}T00:00:00.000Z`), new Date(`${endDate}T23:59:59.999Z`)]
      };
    } else if (startDate) {
      where.created_at = {
        [Op.gte]: new Date(`${startDate}T00:00:00.000Z`)
      };
    } else if (endDate) {
      where.created_at = {
        [Op.lte]: new Date(`${endDate}T23:59:59.999Z`)
      };
    }

    const patients = await Patient.findAll({
      where,
      attributes: ['id', 'patient_id', 'first_name', 'last_name', 'date_of_birth', 'phone_number', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: startDate || endDate ? undefined : 500
    });
    res.json(patients);
  } catch (error) {
    console.error('Error fetching patients by clinic:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Create new patient (stamps branch_id from current user)
router.post('/', async (req, res) => {
  try {
    const patientData = {
      ...req.body,
      gender: req.body.gender ? req.body.gender.toLowerCase() : req.body.gender,
      registration_date: req.body.registration_date || new Date(),
      clinic_id: req.body.clinic_id || 6,
      registered_by: req.body.registered_by || null,
      branch_id: req.body.branch_id || getCreateBranchId(req),
    };
    
    console.log('Creating patient with data:', JSON.stringify(patientData, null, 2));
    const patient = await Patient.create(patientData);
    console.log('Patient created successfully:', patient.id);
    res.status(201).json(patient);
  } catch (error) {
    console.error('Error creating patient:', error);
    console.error('Error details:', error.message);
    if (error.errors) {
      console.error('Validation errors:', error.errors.map(e => ({ field: e.path, message: e.message })));
    }
    res.status(500).json({ error: 'Failed to create patient', details: error.message });
  }
});

// Update patient
router.put('/:id', async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(patient, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to update this patient' });
    }
    
    const bodyWithNormalizedGender = req.body.gender
      ? { ...req.body, gender: req.body.gender.toLowerCase() }
      : req.body;
    const branchSafePayload = req.user?.role === 'admin'
      ? bodyWithNormalizedGender
      : { ...bodyWithNormalizedGender, branch_id: patient.branch_id };

    const beforeValues = patient.toJSON();
    const updatedPatient = await patient.update(branchSafePayload);

    try {
      const changedFields = Object.keys(branchSafePayload).filter(k => JSON.stringify(beforeValues[k]) !== JSON.stringify(branchSafePayload[k]));
      const rr = require('./reports');
      await rr.logAudit({
        clinic_id: patient.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Patients', action: 'PATIENT_UPDATED', entity_type: 'Patient', entity_id: patient.id,
        description: `Updated patient ${patient.first_name} ${patient.last_name} (${patient.patient_id}) — changed: ${changedFields.join(', ') || 'no fields'}`,
        old_values: Object.fromEntries(changedFields.map(k => [k, beforeValues[k]])),
        new_values: Object.fromEntries(changedFields.map(k => [k, branchSafePayload[k]])),
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json(updatedPatient);
  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({ error: 'Failed to update patient' });
  }
});

// Delete patient
router.delete('/:id', async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(patient, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to delete this patient' });
    }
    
    const deletedInfo = { first_name: patient.first_name, last_name: patient.last_name, patient_id: patient.patient_id, clinic_id: patient.clinic_id };
    await patient.destroy();

    try {
      const rr = require('./reports');
      await rr.logAudit({
        clinic_id: deletedInfo.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Patients', action: 'PATIENT_DELETED', entity_type: 'Patient', entity_id: req.params.id,
        description: `Deleted patient ${deletedInfo.first_name} ${deletedInfo.last_name} (${deletedInfo.patient_id})`,
        old_values: deletedInfo, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ message: 'Patient deleted successfully' });
  } catch (error) {
    console.error('Error deleting patient:', error);
    res.status(500).json({ error: 'Failed to delete patient' });
  }
});

module.exports = router;
