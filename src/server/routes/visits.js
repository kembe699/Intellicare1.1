const express = require('express');
const { authorize } = require('../middleware/authorize');
const { Visit } = require('../models');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on clinical visit creation, so the API enforces what the client already assumes.
const VISIT_WRITE = ['admin', 'reception', 'doctor', 'nurse'];
const router = express.Router();

// Create new visit
router.post('/', authorize(VISIT_WRITE), async (req, res) => {
  try {
    // Validate before writing. Without this the missing field surfaced as a 500
    // from the database driver, which reads to the caller as "the server broke"
    // rather than "you left something out".
    if (!req.body?.patient_id) {
      return res.status(400).json({ error: 'patient_id is required' });
    }
    const { v4: uuidv4 } = require('uuid');
    
    const visitData = {
      id: uuidv4(),
      patient_id: req.body.patient_id,
      visit_date: req.body.visit_date || new Date(),
      clinic_id: req.body.clinic_id,
      status: req.body.status || 'pending',
      chief_complaint: req.body.chief_complaint || null,
      doctor_id: req.body.doctor_id || null,
      branch_id: req.body.branch_id || getCreateBranchId(req),
    };
    
    const visit = await Visit.create(visitData);
    res.status(201).json(visit);
  } catch (error) {
    console.error('Error creating visit:', error);
    res.status(500).json({ error: 'Failed to create visit', details: error.message });
  }
});

// Get visit by ID
router.get('/:id', async (req, res) => {
  try {
    const visit = await Visit.findByPk(req.params.id);
    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(visit, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this visit' });
    }
    res.json(visit);
  } catch (error) {
    console.error('Error fetching visit:', error);
    res.status(500).json({ error: 'Failed to fetch visit' });
  }
});

// Get visits by patient
router.get('/patient/:patientId', async (req, res) => {
  try {
    const visits = await Visit.findAll({
      where: {
        patient_id: req.params.patientId,
        ...BranchQueryFilter.buildBranchWhere(req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })
      },
      order: [['visit_date', 'DESC']]
    });
    res.json(visits);
  } catch (error) {
    console.error('Error fetching visits:', error);
    res.status(500).json({ error: 'Failed to fetch visits' });
  }
});

module.exports = router;
