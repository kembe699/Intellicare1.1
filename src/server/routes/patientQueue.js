const express = require('express');
const { authorize } = require('../middleware/authorize');
const { PatientQueue, Patient, Visit } = require('../models');
const { getBranchCondition, getCreateBranchId } = require('../middleware/branchFilter');
const redisCacheMiddleware = require('../middleware/redisCacheMiddleware');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /lis/queue and triage, so the API enforces what the client already assumes.
const router = express.Router();

// Get all queue entries for a clinic (5-second cache for near real-time updates)
router.get('/clinic/:clinicId', redisCacheMiddleware(5), async (req, res) => {
  try {
    const queueEntries = await PatientQueue.findAll({
      where: { ...getBranchCondition(req) },
      order: [['created_at', 'DESC']],
    });
    res.json(queueEntries);
  } catch (error) {
    console.error('Error fetching queue entries:', error);
    res.status(500).json({ error: 'Failed to fetch queue entries' });
  }
});

// Get queue entries by status (5-second cache for near real-time updates)
router.get('/clinic/:clinicId/status/:status', redisCacheMiddleware(5), async (req, res) => {
  try {
    const queueEntries = await PatientQueue.findAll({
      where: { status: req.params.status, ...getBranchCondition(req) },
      order: [['created_at', 'DESC']],
    });
    res.json(queueEntries);
  } catch (error) {
    console.error('Error fetching queue entries by status:', error);
    res.status(500).json({ error: 'Failed to fetch queue entries' });
  }
});

// Priority mapping: convert string to integer
const priorityMap = {
  'emergency': 3,
  'urgent': 2,
  'normal': 1,
  'low': 0
};

// Add patient to queue
router.post('/', authorize('queue.write'), async (req, res) => {
  try {
    // Validate before writing. Without this the missing field surfaced as a 500
    // from the database driver, which reads to the caller as "the server broke"
    // rather than "you left something out".
    if (!req.body?.patient_id) {
      return res.status(400).json({ error: 'patient_id is required' });
    }
    console.log('=== PATIENT QUEUE CREATION ===');
    console.log('Request body:', req.body);
    console.log('Patient ID to find:', req.body.patient_id);
    
    // Find patient by patient_id field (UH-1234) instead of primary key
    const patient = await Patient.findOne({
      where: { patient_id: req.body.patient_id }
    });
    
    console.log('Patient found:', patient ? { id: patient.id, patient_id: patient.patient_id } : 'NOT FOUND');
    
    if (!patient) {
      console.log('Patient not found, returning 404');
      return res.status(404).json({ error: `Patient not found with ID: ${req.body.patient_id}` });
    }
    
    // Check if patient already has an active queue entry
    const existingQueue = await PatientQueue.findOne({
      where: {
        patient_id: patient.id,
        status: ['waiting', 'in_progress']
      }
    });
    
    if (existingQueue) {
      console.log('Patient already in queue:', existingQueue.id);
      // This used to return silently with no one notified — from the caller's
      // side, "queue this patient" had visibly succeeded, but if the earlier
      // queuing (possibly hours or days ago, if the entry was never resolved)
      // never reached a doctor, nothing here ever told anyone a patient was
      // waiting. Re-notifying every time this is hit is deliberate: calling
      // this endpoint again for an already-queued patient is itself a signal
      // worth surfacing, not just a no-op to swallow.
      if ((existingQueue.queue_type || 'consultation') === 'consultation') {
        try {
          const { notifyRole } = require('../services/notificationService');
          const BranchQueryFilter = require('../services/BranchQueryFilter');
          const { sequelize: db } = req.models;
          await notifyRole(db, {
            clinic_id: BranchQueryFilter.resolveClinicId(req), role: 'doctor', branch_id: existingQueue.branch_id,
            type: 'patient_queued', title: 'Patient waiting in queue',
            message: `${patient.first_name} ${patient.last_name} is still waiting in the consultation queue`,
            entity_type: 'PatientQueue', entity_id: existingQueue.id, link: '/lis/queue',
          });
        } catch (e) { /* non-blocking */ }
      }
      return res.status(200).json(existingQueue); // Return existing queue entry
    }
    
    // Convert priority string to integer
    let priorityValue = req.body.priority;
    if (typeof priorityValue === 'string') {
      priorityValue = priorityMap[priorityValue.toLowerCase()] || 1; // Default to normal (1)
    } else if (typeof priorityValue !== 'number') {
      priorityValue = 1; // Default to normal
    }
    
    // Don't create visit here - visit will be created when doctor saves in clinical page
    const queueData = {
      patient_id: patient.id, // Use the database ID instead of patient identifier
      queue_type: req.body.queue_type || 'consultation',
      priority: priorityValue,
      notes: req.body.notes,
      status: req.body.status || 'waiting',
      visit_id: null,
      branch_id: req.body.branch_id || getCreateBranchId(req),
    };
    
    console.log('Queue data to create:', queueData);
    
    const queueEntry = await PatientQueue.create(queueData);
    console.log('Queue entry created successfully:', queueEntry.id);

    // Notify doctors — this queue has no per-doctor assignment (queueData has
    // no doctor_id), any doctor picks up the next waiting patient, so this
    // broadcasts to the whole role rather than one specific recipient.
    // Non-blocking: never fail the queue entry over a notification hiccup.
    if (queueData.queue_type === 'consultation') {
      try {
        const { notifyRole } = require('../services/notificationService');
        const BranchQueryFilter = require('../services/BranchQueryFilter');
        const { sequelize: db } = req.models;
        await notifyRole(db, {
          clinic_id: BranchQueryFilter.resolveClinicId(req), role: 'doctor', branch_id: queueData.branch_id,
          type: 'patient_queued', title: 'New patient queued',
          message: `${patient.first_name} ${patient.last_name} has been added to the consultation queue`,
          entity_type: 'PatientQueue', entity_id: queueEntry.id, link: '/lis/queue',
        });
      } catch (e) { /* non-blocking */ }
    }

    res.status(201).json(queueEntry);
  } catch (error) {
    console.error('=== ERROR ADDING PATIENT TO QUEUE ===');
    console.error('Error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to add patient to queue', details: error.message });
  }
});

// Update queue entry status
router.put('/:id', authorize('queue.write'), async (req, res) => {
  try {
    const [updatedRows] = await PatientQueue.update(req.body, {
      where: { id: req.params.id },
    });
    
    if (updatedRows === 0) {
      return res.status(404).json({ error: 'Queue entry not found' });
    }
    
    const updatedEntry = await PatientQueue.findByPk(req.params.id);
    res.json(updatedEntry);
  } catch (error) {
    console.error('Error updating queue entry:', error);
    res.status(500).json({ error: 'Failed to update queue entry' });
  }
});

// Remove patient from queue
router.delete('/:id', authorize('queue.write'), async (req, res) => {
  try {
    const deletedRows = await PatientQueue.destroy({
      where: { id: req.params.id },
    });
    
    if (deletedRows === 0) {
      return res.status(404).json({ error: 'Queue entry not found' });
    }
    
    res.json({ message: 'Patient removed from queue successfully' });
  } catch (error) {
    console.error('Error removing patient from queue:', error);
    res.status(500).json({ error: 'Failed to remove patient from queue' });
  }
});

module.exports = router;
// Force restart now
