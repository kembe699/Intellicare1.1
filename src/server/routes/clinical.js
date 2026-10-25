const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gates. None of these endpoints had one, so any authenticated
// user of any role could open a visit, write a prescription or change a service
// price. Split by what the endpoint actually does rather than one list for the
// file: recording an encounter and editing the service catalogue are different
// jobs held by different people.
// Matches /setup/services in App.tsx.
// Changing every price at once is a financial act, not a catalogue edit.
const router = express.Router();
const { Patient, PatientQueue, Visit, DrugInventory, Prescription, PatientBill, LabTest, Service, sequelize } = require('../models');
const { Op } = require('sequelize');
const { getBranchCondition, getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const redisCacheMiddleware = require('../middleware/redisCacheMiddleware');
const { normalizeServices } = require('../utils/normalizeServices');
const { getAdjustmentMultiplier } = require('../utils/priceAdjustment');



// Get patients for clinical (same as patients API but for clinical context)
router.get('/patients/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    
    const branchCond = getBranchCondition(req);
    const whereClause = Object.keys(branchCond).length > 0 ? { ...branchCond } : {};
    const patients = await Patient.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: 200
    });

    res.json(patients);
  } catch (error) {
    console.error('Error fetching patients for clinical:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Get patient queue for clinical
router.get('/queue/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { startDate, endDate } = req.query;
    // Build a NULL-inclusive branch filter: show entries belonging to user's branch OR unassigned
    const isAdmin = req.user?.role === 'admin' && !req.branchContext?.adminScoped;
    const userBranchId = req.branchContext?.branchId || req.user?.branchId || null;
    const branchSql = (!isAdmin && userBranchId)
      ? `AND (pq.branch_id = ? OR pq.branch_id IS NULL)`
      : '';
    const branchParams = (!isAdmin && userBranchId) ? [userBranchId] : [];

    let dateFilter = '';
    if (startDate && endDate) {
      dateFilter = `AND pq.created_at >= '${startDate} 00:00:00' AND pq.created_at <= '${endDate} 23:59:59'`;
    } else if (startDate) {
      dateFilter = `AND pq.created_at >= '${startDate} 00:00:00'`;
    } else if (endDate) {
      dateFilter = `AND pq.created_at <= '${endDate} 23:59:59'`;
    }

    // Get all queue entries with status waiting or in_progress, joined with patient data
    const queueEntries = await sequelize.query(`
      SELECT 
        pq.*,
        p.first_name,
        p.last_name,
        p.patient_id as patient_doc_id,
        p.date_of_birth,
        CASE WHEN p.date_of_birth IS NOT NULL THEN (EXTRACT(YEAR FROM AGE((CURRENT_DATE)::timestamp, (p.date_of_birth)::timestamp)))::int ELSE NULL END as age
      FROM patient_queue pq
      LEFT JOIN patients p ON pq.patient_id = p.id
      WHERE pq.status = 'waiting'
      ${branchSql}
      ${dateFilter}
      ORDER BY pq.created_at DESC
    `, {
      replacements: [...branchParams],
      type: sequelize.QueryTypes.SELECT
    });

    // Transform to include patient name
    const transformedQueue = queueEntries.map(entry => ({
      ...entry,
      patient_name: entry.first_name && entry.last_name 
        ? `${entry.first_name} ${entry.last_name}`.trim()
        : entry.first_name || entry.last_name || 'Unknown'
    }));

    res.json(transformedQueue);
  } catch (error) {
    console.error('Error fetching patient queue for clinical:', error);
    res.status(500).json({ error: 'Failed to fetch patient queue', details: error.message });
  }
});

// Get lab result notifications for clinical panel
router.get('/lab-notifications/:clinicId/:doctorId', async (req, res) => {
  try {
    const { clinicId, doctorId } = req.params;
    const branchFilter = getBranchConditionSQL(req, 'lq');

    const [rows] = await sequelize.query(`
      SELECT 
        lr.id,
        lr.id as result_id,
        lr.request_id,
        lq.visit_id,
        lq.test_name as test_type,
        p.first_name,
        p.last_name,
        lq.patient_name as backup_name,
        COALESCE(lr.updated_at, lq.updated_at, lq.requested_at) as completed_at,
        COALESCE(lr.performed_by, 'Laboratory') as completed_by,
        'Lab result is ready for review' as message
      FROM lab_requests lq
      INNER JOIN visits v ON v.id = lq.visit_id
      LEFT JOIN patients p ON v.patient_id = p.id
      LEFT JOIN lab_results lr ON lr.lab_request_id = lq.id
      WHERE lq.clinic_id = ?
        AND v.doctor_id = ?
        ${branchFilter.sql}
        AND (lq.status = 'completed' OR lr.status IN ('completed', 'sent'))
      ORDER BY COALESCE(lr.updated_at, lq.updated_at, lq.requested_at) DESC
      LIMIT 50
    `, {
      replacements: [parseInt(clinicId), doctorId, ...branchFilter.params]
    });

    const transformedRows = (rows || []).map(row => ({
      ...row,
      id: `lab-${row.id}`,
      patient_name: row.first_name && row.last_name ? `${row.first_name} ${row.last_name}`.trim() : (row.backup_name || 'Unknown Patient')
    }));

    res.json(transformedRows);
  } catch (error) {
    console.error('Error fetching lab notifications:', error);
    res.status(500).json({ error: 'Failed to fetch lab notifications', details: error.message });
  }
});

// Get visits for clinical (5-second cache for near real-time updates)
router.get('/visits/:clinicId/:doctorId', redisCacheMiddleware(5), async (req, res) => {
  try {
    const { clinicId, doctorId } = req.params;
    const { startDate, endDate } = req.query;
    const branchFilter = getBranchConditionSQL(req, 'v');
    
    let dateFilter = '';
    if (startDate && endDate) {
      dateFilter = `AND v.visit_date >= '${startDate} 00:00:00' AND v.visit_date <= '${endDate} 23:59:59'`;
    } else if (startDate) {
      dateFilter = `AND v.visit_date >= '${startDate} 00:00:00'`;
    } else if (endDate) {
      dateFilter = `AND v.visit_date <= '${endDate} 23:59:59'`;
    }
    
    // Get visits with optional date filtering
    const visits = await sequelize.query(`
      SELECT 
        v.*,
        p.first_name,
        p.last_name,
        p.patient_id as patient_doc_id
      FROM visits v
      LEFT JOIN patients p ON v.patient_id = p.id
      WHERE v.clinic_id = ?
      ${doctorId && doctorId !== 'all' ? 'AND v.doctor_id = ?' : ''}
      ${branchFilter.sql}
      ${dateFilter}
      ORDER BY v.visit_date DESC
    `, {
      replacements: [
        parseInt(clinicId),
        ...(doctorId && doctorId !== 'all' ? [doctorId] : []),
        ...branchFilter.params
      ],
      type: sequelize.QueryTypes.SELECT
    });
    
    // Transform to include patient name and map fields correctly
    const transformedVisits = visits.map(visit => ({
      ...visit,
      patient_name: visit.first_name && visit.last_name 
        ? `${visit.first_name} ${visit.last_name}`.trim()
        : visit.first_name || visit.last_name || 'Unknown',
      date: visit.visit_date,
      chief_complaints: visit.chief_complaint
    }));

    res.json(transformedVisits);
  } catch (error) {
    console.error('Error fetching visits for clinical:', error);
    res.status(500).json({ error: 'Failed to fetch visits', details: error.message });
  }
});

// Create visit
router.post('/visits', authorize('clinical.encounters.write'), async (req, res) => {
  try {
    const visitData = req.body;
    console.log('=== CLINICAL ROUTE: Creating visit with data ===');
    console.log('Creating visit with data:', visitData);
    console.log('Vitals data received:', visitData.vitals);
    console.log('Lab requests received:', visitData.lab_requests);
    
    // Stamp branch_id from current user
    visitData.branch_id = visitData.branch_id || getCreateBranchId(req);
    
    const visit = await Visit.create(visitData);
    console.log('Visit created successfully:', visit.id);
    console.log('Visit vitals saved:', visit.vitals);
    
    // Update patient queue status to 'in_progress' if patient came from queue
    // This moves them from Patient Queue to Today's Visits section
    if (visitData.queue_id) {
      try {
        await PatientQueue.update(
          { status: 'in_progress' },
          { where: { id: visitData.queue_id } }
        );
        console.log('Updated queue status to in_progress for queue ID:', visitData.queue_id);
      } catch (queueError) {
        console.error('Error updating queue status:', queueError);
        // Don't fail the visit creation if queue update fails
      }
    }
    
    // Bust cache immediately after visit creation to ensure real-time updates
    const redisCache = require('../services/RedisCache');
    const schemaName = req.tenantSchema || 'default';
    const userId = req.user?.id || 'anon';
    const branchId = req.branchContext?.branchId || req.user?.branchId || 'none';
    // Tenant-wide for the same reason as the global buster in index.js:
    // a per-user prefix leaves every other user reading stale data.
    await redisCache.delPattern(`ic|${schemaName}|`).catch(() => {});
    console.log('Cache busted for user:', userId, 'branch:', branchId);
    
    // Add lab tests to existing patient bill and create lab requests if lab requests exist
    console.log('Checking for lab_requests in visitData:', visitData.lab_requests);
    console.log('Type of lab_requests:', typeof visitData.lab_requests);
    
    let labRequests = visitData.lab_requests;
    
    // Parse lab_requests if it's a string
    if (typeof labRequests === 'string' && labRequests.trim()) {
      try {
        labRequests = JSON.parse(labRequests);
        console.log('Parsed lab_requests:', labRequests);
      } catch (parseError) {
        console.error('Error parsing lab_requests JSON:', parseError);
        labRequests = null;
      }
    }
    
    if (labRequests && Array.isArray(labRequests) && labRequests.length > 0) {
      console.log('Processing lab requests:', labRequests);
      try {
        await addLabTestsToExistingBill({ ...visitData, lab_requests: labRequests, visit_id: visit.id });
        await createLabRequestsFromVisit({ ...visitData, lab_requests: labRequests }, visit);
      } catch (billError) {
        console.error('Error adding lab tests to bill or creating lab requests:', billError);
        // Don't fail visit creation if bill update fails
      }
    } else {
      console.log('No lab requests to process');
    }
    
    res.json(visit);
  } catch (error) {
    console.error('Error creating visit:', error);
    res.status(500).json({ error: 'Failed to create visit', details: error.message });
  }
});

// Function to add lab tests to existing patient bill
//
// Previously this hand-rolled its own "find bill for this visit, then update-or-create"
// logic, including a plain PatientBill.update({...}, { where }) with no transaction or row
// lock — two lab-test requests landing close together (e.g. a doctor adding tests to two
// patients' visits back-to-back, or a double-submit of the same request) could both read
// the same total_amount and one write would silently clobber the other's line items. Now
// delegates to the shared, locked, visit-scoped resolver every other billing writer uses.
async function addLabTestsToExistingBill(visitData) {
  try {
    const { addLineItemsToBill } = require('../utils/billingResolver');
    const patientId = visitData.patient_id;
    const clinicId = parseInt(visitData.clinic_id) || 1;

    const labTestsWithPrices = await Promise.all(
      visitData.lab_requests.map(async (testName) => {
        try {
          const labTest = await LabTest.findOne({ where: { test_name: testName } });
          const price = parseFloat(labTest?.price) || 0;
          // `category` (new): this is unconditionally a lab test, so the category is known
          // for certain right here — no need for a later report to guess it from the name.
          // `department` is the older, display-only field this line already carried; kept
          // alongside rather than replaced, in case anything else still reads it.
          return { serviceName: testName, name: testName, quantity: 1, unitPrice: price, totalPrice: price, department: 'Laboratory', category: 'Laboratory', type: 'Lab Test', date: new Date().toISOString() };
        } catch (error) {
          console.error(`Error fetching price for ${testName}:`, error);
          return { serviceName: testName, name: testName, quantity: 1, unitPrice: 0, totalPrice: 0, department: 'Laboratory', category: 'Laboratory', type: 'Lab Test', date: new Date().toISOString() };
        }
      })
    );

    const bill = await addLineItemsToBill({
      patientId,
      patientName: visitData.patient_name || 'Patient',
      clinicId,
      branchId: visitData.branch_id || null,
      lineItems: labTestsWithPrices,
      notes: 'Auto-generated from visit lab requests',
      createdBy: visitData.doctor_name || 'System',
      visitId: visitData.visit_id || null,
    });
    console.log('Lab test charges applied to bill:', bill?.bill_number);
  } catch (error) {
    console.error('Error in addLabTestsToExistingBill:', error);
    throw error;
  }
}

// Test endpoint to verify routing
router.get('/test', (req, res) => {
  console.log('Test endpoint hit!');
  res.json({ message: 'Clinical API is working' });
});

// Get visit details by ID
router.get('/visit-details/:visitId', async (req, res) => {
  try {
    const { visitId } = req.params;
    console.log('=== VISIT DETAILS API CALLED ===');
    console.log('Fetching visit details for ID:', visitId);
    console.log('Visit model available:', !!Visit);
    
    const visit = await Visit.findByPk(visitId);
    console.log('Raw visit data from database:', JSON.stringify(visit, null, 2));
    
    if (!visit) {
      console.log('Visit not found for ID:', visitId);
      return res.status(404).json({ error: 'Visit not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(visit, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this visit' });
    }
    
    // Log specific fields we're interested in
    console.log('Visit clinical_notes:', visit.clinical_notes);
    console.log('Visit vitals (raw):', visit.vitals);
    console.log('Visit lab_requests (raw):', visit.lab_requests);
    console.log('Visit diagnosis:', visit.diagnosis);
    console.log('Visit diagnosis_code:', visit.diagnosis_code);

    const [labRequests] = await sequelize.query(`
      SELECT id, patient_id, visit_id, test_code, test_name, status, priority, requested_by, requested_at, notes, created_at, updated_at
      FROM lab_requests
      WHERE visit_id = ?
      ORDER BY requested_at DESC
    `, {
      replacements: [visitId]
    });

    const [labResultsRows] = await sequelize.query(`
      SELECT 
        lr.id,
        lr.lab_request_id as request_id,
        lr.test_name,
        lr.test_code,
        lr.status,
        lr.result_date as performed_at,
        lr.performed_by,
        lr.created_at,
        lr.updated_at
      FROM lab_results lr
      WHERE lr.lab_request_id IN (
        SELECT id FROM lab_requests WHERE visit_id = ?
      )
      ORDER BY lr.created_at DESC
    `, {
      replacements: [visitId]
    });

    // Fetch component values for each lab result
    const labResultsWithComponents = await Promise.all(
      labResultsRows.map(async (row) => {
        try {
          const [componentValues] = await sequelize.query(`
            SELECT 
              component_name,
              value,
              unit,
              normal_range,
              is_abnormal,
              remark
            FROM lab_result_component_values
            WHERE result_id = ?
            ORDER BY created_at ASC
          `, {
            replacements: [row.id]
          });
          return { ...row, componentValues };
        } catch (e) {
          return { ...row, componentValues: [] };
        }
      })
    );

    const groupedLabResults = labResultsWithComponents.map(row => {
      // Map component values to frontend expected format
      const componentValues = (row.componentValues || []).map(comp => ({
        name: comp.component_name,
        value: comp.value,
        unit: comp.unit || '',
        referenceRange: comp.normal_range || '',
        normalRangeText: comp.normal_range || '',
        status: comp.is_abnormal ? 'Abnormal' : 'Normal',
        remark: comp.remark || ''
      }));

      return {
        id: row.id,
        requestId: row.request_id,
        testName: row.test_name,
        testType: row.test_name, // Frontend expects testType
        testCode: row.test_code,
        status: row.status,
        completedAt: row.performed_at || row.updated_at || row.created_at,
        resultDate: row.performed_at || row.updated_at || row.created_at, // Frontend expects resultDate
        reportedAt: row.updated_at || row.created_at,
        performedBy: row.performed_by || 'Laboratory', // Frontend expects performedBy
        parameters: componentValues, // Keep for backward compatibility
        componentValues: componentValues // Frontend expects componentValues
      };
    });
    
    res.json({
      ...visit.toJSON(),
      lab_requests: labRequests || [],
      labResults: groupedLabResults
    });
  } catch (error) {
    console.error('Error fetching visit details:', error);
    console.error('Full error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch visit details' });
  }
});

// Get lab tests from lab_tests table
router.get('/lab-tests', async (req, res) => {
  try {
    const { LabTest } = require('../models');

    const labTests = await LabTest.findAll({
      attributes: ['test_name'],
      where: { ...getBranchCondition(req) },
      order: [['test_name', 'ASC']]
    });
    
    // Extract just the test names for the dropdown
    const testNames = labTests.map(test => test.test_name);
    
    res.json(testNames);
  } catch (error) {
    console.error('Error fetching lab tests:', error);
    res.status(500).json({ error: 'Failed to fetch lab tests' });
  }
});

// Get drugs for clinical prescribing (from inventory_items — where pharmacy/inventory entries live)
router.get('/medicines/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const cid = parseInt(clinicId) || 1;

    // Build branch filter with named parameters
    const isAdmin = req.user?.role === 'admin' && !req.branchContext?.adminScoped;
    const branchId = req.branchContext?.branchId || req.user?.branchId || null;

    let branchSQL = '';
    const replacements = { cid };

    if (!isAdmin && branchId) {
      branchSQL = ' AND i.branch_id = :branchId';
      replacements.branchId = branchId;
    }

    // price_usd/price_ssp were hardcoded to 0 regardless of what the drugs table
    // actually held, and default_currency fell back to the literal 'KES' — both
    // presumably copied from wherever this app's pharmacy module originated
    // and never adapted. Read the real columns and fall back to this tenant's
    // actual configured base currency instead of a fixed one.
    const CurrencyService = require('../services/CurrencyService');
    const baseCurrency = (await CurrencyService.getBaseCurrency()).code;
    replacements.baseCurrency = baseCurrency;

    // Primary source is inventory_items (all drugs entered via inventory/pharmacy module).
    // LEFT JOIN drugs for extra pharmaceutical metadata when available.
    const [medicines] = await sequelize.query(`
      SELECT
        i.id,
        COALESCE(d.drug_name, i.item_name)          AS drug_name,
        COALESCE(d.generic_name, '')                 AS generic_name,
        COALESCE(d.strength, '')                     AS strength,
        COALESCE(d.dosage_form, 'tablet')            AS dosage_form,
        i.unit_of_measure,
        COALESCE(d.therapeutic_category, i.item_category) AS therapeutic_category,
        COALESCE(d.is_controlled_substance, FALSE)   AS is_controlled_substance,
        COALESCE(d.requires_prescription, TRUE)      AS requires_prescription,
        COALESCE(d.price_kes, i.selling_price, 0)    AS price_kes,
        COALESCE(d.price_usd, 0)                     AS price_usd,
        COALESCE(d.price_ssp, 0)                     AS price_ssp,
        COALESCE(d.default_currency, i.cost_currency, :baseCurrency) AS default_currency,
        i.quantity_on_hand                           AS current_stock,
        i.unit_of_measure                            AS inventory_uom
      FROM inventory_items i
      LEFT JOIN drugs d ON d.inventory_item_id = i.id
      WHERE i.is_active = TRUE
        AND (i.clinic_id = :cid OR i.clinic_id IS NULL)
        ${branchSQL}
      ORDER BY i.item_name ASC
    `, { replacements });

    console.log(`Medicines found for clinic ${cid}, branch ${branchId || 'all'}:`, medicines.length);
    res.json(medicines);
  } catch (error) {
    console.error('Error fetching medicines:', error);
    res.status(500).json({ error: 'Failed to fetch medicines' });
  }
});

// Get prescriptions by visit ID
router.get('/prescriptions/visit/:visitId', async (req, res) => {
  try {
    const { visitId } = req.params;
    
    const prescriptions = await Prescription.findAll({
      where: {
        visit_id: visitId,
        ...BranchQueryFilter.buildBranchWhere(req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })
      },
      order: [['prescribed_at', 'DESC']]
    });
    
    res.json(prescriptions);
  } catch (error) {
    console.error('Error fetching prescriptions for visit:', error);
    res.status(500).json({ error: 'Failed to fetch prescriptions' });
  }
});

// Create prescription
router.post('/prescriptions', authorize('clinical.prescriptions.write'), async (req, res) => {
  try {
    const body = req.body;
    console.log('Creating prescription with data:', body);
    
    const { v4: uuidv4 } = require('uuid');

    const prescriptionData = {
      id: uuidv4(),
      visit_id: body.visit_id,
      patient_id: body.patient_id,
      drug_name: body.medication_name || body.drug_name,
      dosage: body.take_instructions || body.dosage || null,
      frequency: body.frequency,
      duration: body.duration,
      instructions: body.instructions || null,
      quantity: body.quantity ? parseInt(body.quantity, 10) || null : null,
      prescribed_by: req.user?.id || req.user?.userId || null,
      prescribed_at: body.prescribed_at || new Date().toISOString(),
      status: body.status || 'active',
      branch_id: body.branch_id || req.user?.branchId || null,
    };
    
    const prescription = await Prescription.create(prescriptionData);
    console.log('Prescription created successfully:', prescription.id);
    
    res.json(prescription);
  } catch (error) {
    console.error('Error creating prescription:', error);
    res.status(500).json({ error: 'Failed to create prescription' });
  }
});

// Update patient queue status (e.g., remove from queue when visit is created)
router.put('/queue/:queueId', authorize('clinical.queue.write'), async (req, res) => {
  try {
    const { queueId } = req.params;
    const { status } = req.body;
    const queueEntry = await PatientQueue.findByPk(queueId);
    if (!queueEntry) {
      return res.status(404).json({ error: 'Queue entry not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(queueEntry, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this queue entry' });
    }
    
    await queueEntry.update({ status, updated_at: new Date() });

    res.json({ message: 'Queue status updated successfully' });
  } catch (error) {
    console.error('Error updating queue status:', error);
    res.status(500).json({ error: 'Failed to update queue status' });
  }
});

// Update visit details (chief complaints, clinical notes, vitals)
router.put('/visits/:visitId/details', authorize('clinical.encounters.write'), async (req, res) => {
  try {
    const { visitId } = req.params;
    const { chief_complaint, clinical_notes, vitals, diagnosis, diagnosis_code } = req.body;
    const visit = await Visit.findByPk(visitId);
    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(visit, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to update this visit' });
    }

    const updateData = {};
    if (chief_complaint !== undefined) updateData.chief_complaint = chief_complaint;
    if (clinical_notes !== undefined) updateData.clinical_notes = clinical_notes;
    if (vitals !== undefined) updateData.vitals = typeof vitals === 'string' ? vitals : JSON.stringify(vitals);
    if (diagnosis !== undefined) updateData.diagnosis = diagnosis;
    if (diagnosis_code !== undefined) updateData.diagnosis_code = diagnosis_code;

    const updatedVisit = await visit.update(updateData);
    res.json(updatedVisit);
  } catch (error) {
    console.error('Error updating visit details:', error);
    res.status(500).json({ error: 'Failed to update visit details' });
  }
});

// Close visit and update queue status to completed
router.put('/visits/:visitId/close', authorize('clinical.encounters.write'), async (req, res) => {
  try {
    const { visitId } = req.params;
    const { closedBy } = req.body;
    const visit = await Visit.findByPk(visitId);
    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(visit, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to close this visit' });
    }
    
    // Update visit status to inactive (keeps visit visible in Today's Visits)
    await visit.update({ 
      status: 'inactive',
      closed_at: new Date(),
      closed_by: closedBy
    });

    // Get the visit to find associated queue entry
    console.log('Found visit for closing:', visit ? visit.id : 'not found');
    console.log('Visit patient_id:', visit ? visit.patient_id : 'no patient_id');
    console.log('Visit queue_id:', visit ? visit.queue_id : 'no queue_id');
    
    if (visit) {
      // Find and update the queue entry for this patient to completed
      try {
        let updatedRows = 0;
        
        // First try using the queue_id if it exists (most reliable)
        if (visit.queue_id) {
          console.log('Updating queue entry by queue_id:', visit.queue_id);
          [updatedRows] = await PatientQueue.update(
            { status: 'completed' },
            { where: { id: visit.queue_id } }
          );
          console.log('Queue update by queue_id result - rows affected:', updatedRows);
        }
        
        // If queue_id update didn't work, try by patient_id
        if (updatedRows === 0 && visit.patient_id) {
          console.log('Trying to update by patient_id:', visit.patient_id);
          
          // First, let's see what queue entries exist for this patient
          const existingQueueEntries = await PatientQueue.findAll({
            where: { patient_id: visit.patient_id }
          });
          console.log('All queue entries for patient:', existingQueueEntries.map(q => ({ id: q.id, status: q.status, patient_id: q.patient_id })));
          
          [updatedRows] = await PatientQueue.update(
            { status: 'completed' },
            { 
              where: { 
                patient_id: visit.patient_id,
                status: { [Op.in]: ['waiting', 'in_progress'] }
              } 
            }
          );
          console.log('Queue update by patient_id result - rows affected:', updatedRows);
        }
        
        // Verify the update by checking the current status
        if (visit.queue_id) {
          const updatedQueueEntry = await PatientQueue.findByPk(visit.queue_id);
          console.log('Queue entry after update:', updatedQueueEntry ? { id: updatedQueueEntry.id, status: updatedQueueEntry.status } : 'not found');
        }
        
      } catch (queueError) {
        console.error('Error updating queue status to completed:', queueError);
      }
    } else {
      console.log('No visit found');
    }

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: visit.clinic_id, user_id: req.user?.id, user_name: closedBy || req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Clinical', action: 'VISIT_CLOSED', entity_type: 'Visit', entity_id: visitId,
        description: `Visit closed for ${visit.patient_name || visit.patient_id}`,
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ message: 'Visit closed successfully' });
  } catch (error) {
    console.error('Error closing visit:', error);
    res.status(500).json({ error: 'Failed to close visit' });
  }
});

// Delete patient from queue
router.delete('/queue/:queueId', authorize('clinical.queue.write'), async (req, res) => {
  try {
    const { queueId } = req.params;
    const queueEntry = await PatientQueue.findByPk(queueId);
    if (!queueEntry) {
      return res.status(404).json({ error: 'Queue entry not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(queueEntry, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to delete this queue entry' });
    }
    
    await queueEntry.destroy();

    res.json({ message: 'Patient removed from queue successfully' });
  } catch (error) {
    console.error('Error removing patient from queue:', error);
    res.status(500).json({ error: 'Failed to remove patient from queue' });
  }
});

// Services CRUD endpoints
// Non-admin users only see/manage services from their own branch; admins see everything.
// Existing rows keep branch_id NULL until backfilled, so reads are deliberately
// NULL-inclusive rather than strict-equality — same reasoning and same helper shape as
// routes/services.js's branchWhere()/canAccessService(), duplicated here because this
// file has its own separate (and equally unscoped) services CRUD implementation.
function servicesBranchWhere(req) {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return {};
  const branchId = req.branchContext?.branchId || req.user?.branchId || null;
  if (!branchId) return {};
  return { [Op.or]: [{ branch_id: branchId }, { branch_id: null }] };
}
function canAccessServiceRecord(service, req) {
  if (!service) return false;
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return true;
  const branchId = req.branchContext?.branchId || req.user?.branchId || null;
  if (!branchId) return true;
  if (!service.branch_id) return true;
  return String(service.branch_id) === String(branchId);
}

// Get services by clinic
router.get('/services/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;


    // Since the services table doesn't have clinic_id, return all active services
    // (scoped by branch instead — see servicesBranchWhere() above).
    const services = await Service.findAll({
      where: { is_active: true, ...servicesBranchWhere(req) },
      order: [['created_at', 'DESC']]
    });

    res.json(services);
  } catch (error) {
    console.error('Error fetching services GET:', error);
    res.status(500).json({ error: 'Failed to fetch services', details: error.message, stack: error.stack });
  }
});

// Create new service
router.post('/services', authorize('clinical.services.manage'), async (req, res) => {
  try {

    const { service_name, category, price, description, revenue_account_id, department_id, created_by } = req.body;

    const service = await Service.create({
      service_name,
      category,
      price: parseFloat(price || 0),
      description,
      revenue_account_id: revenue_account_id || null,
      department_id: department_id || null,
      is_active: true,
      created_by: created_by ? String(created_by) : null,
      branch_id: getCreateBranchId(req)
    });

    res.status(201).json(service);
  } catch (error) {
    console.error('Error creating service:', error);
    if (error.name === 'SequelizeValidationError' || error.name === 'SequelizeUniqueConstraintError') {
      const details = error.errors ? error.errors.map(e => e.message).join(', ') : error.message;
      return res.status(400).json({ error: 'Validation Error', details });
    }
    res.status(500).json({ error: 'Failed to create service', details: error.message });
  }
});

// Update service
router.put('/services/:id', authorize('clinical.services.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { service_name, category, price, description, revenue_account_id, department_id, is_active, updated_by } = req.body;
    
    const service = await Service.findByPk(id);
    if (!service || !canAccessServiceRecord(service, req)) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const updateData = {
      service_name,
      category,
      price: parseFloat(price || 0),
      description,
      revenue_account_id: revenue_account_id || null,
      department_id: department_id || null,
      updated_by: updated_by ? String(updated_by) : null
    };
    
    if (is_active !== undefined) {
      updateData.is_active = is_active;
    }
    
    await service.update(updateData);
    
    res.json(service);
  } catch (error) {
    console.error('Error updating service PUT:', error);
    if (error.name === 'SequelizeValidationError' || error.name === 'SequelizeUniqueConstraintError') {
      const details = error.errors ? error.errors.map(e => e.message).join(', ') : error.message;
      return res.status(400).json({ error: 'Validation Error', details });
    }
    res.status(500).json({ error: 'Failed to update service', details: error.message });
  }
});

// Bulk-adjust service prices by percentage (increase or decrease)
router.post('/services/bulk-price-adjustment', authorize('clinical.services.reprice'), async (req, res) => {
  try {
    const { mode, percentage, direction, new_rate, category } = req.body;

    let multiplier, currentRate, newRate;
    try {
      ({ multiplier, currentRate, newRate } = await getAdjustmentMultiplier({ sequelize, mode, percentage, direction, new_rate }));
    } catch (e) {
      if (e.isValidation) return res.status(400).json({ error: e.message });
      throw e;
    }

    const conditions = ['is_active = true', 'price > 0'];
    const replacements = { multiplier };
    if (category) { conditions.push('category = :category'); replacements.category = category; }
    // NULL-inclusive branch scope (see servicesBranchWhere() above) — a non-admin bulk
    // reprice must not silently touch another branch's prices, but must still reach the
    // caller's own not-yet-backfilled (branch_id NULL) services.
    if (req.user?.role !== 'admin') {
      const branchId = req.branchContext?.branchId || req.user?.branchId || null;
      if (branchId) { conditions.push('(branch_id = :branchId OR branch_id IS NULL)'); replacements.branchId = branchId; }
    }
    const where = conditions.join(' AND ');

    const [[before]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM services WHERE ${where}`,
      { replacements }
    );
    const affectedCount = parseInt(before.cnt, 10) || 0;
    if (affectedCount === 0) return res.status(404).json({ error: 'No matching priced services found for this filter' });

    await sequelize.query(
      `UPDATE services SET price = GREATEST(0, ROUND(price * :multiplier, 2)) WHERE ${where}`,
      { replacements }
    );

    const description = mode === 'rate'
      ? `Service prices rebased from USD/SSP rate ${currentRate} to ${newRate}${category ? ` (category: ${category})` : ''} — ${affectedCount} service(s) affected`
      : `Bulk ${direction}d service prices by ${percentage}%${category ? ` (category: ${category})` : ''} — ${affectedCount} service(s) affected`;

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: req.user?.clinicId || 1,
        user_id: req.user?.id,
        user_name: req.user?.displayName,
        user_role: req.user?.role,
        module: 'Setup',
        action: 'BULK_PRICE_ADJUSTMENT',
        entity_type: 'Service',
        description,
        new_values: { mode: mode || 'percentage', direction, percentage, currentRate, newRate, category: category || null, affected_count: affectedCount }
      });
    } catch (e) {}

    res.json({
      message: `Adjusted price on ${affectedCount} service(s)`,
      affected_count: affectedCount,
      mode: mode || 'percentage',
      direction,
      percentage,
      currentRate,
      newRate,
    });
  } catch (error) {
    console.error('Error applying bulk service price adjustment:', error);
    res.status(500).json({ error: 'Failed to apply price adjustment' });
  }
});

// Delete service
router.delete('/services/:id', authorize('clinical.services.manage'), async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await Service.findByPk(id);
    if (!existing || !canAccessServiceRecord(existing, req)) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const deletedRows = await Service.destroy({
      where: { id: id }
    });

    if (deletedRows === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// Function to create lab requests from visit data
async function createLabRequestsFromVisit(visitData, visit) {
  try {
    const { v4: uuidv4 } = require('uuid');
    const { getCreateBranchId } = require('../middleware/branchFilter');
    
    console.log('Creating lab requests from visit data:', visitData.lab_requests);
    
    // Parse lab requests if it's a string
    let labTests = visitData.lab_requests;
    if (typeof labTests === 'string') {
      labTests = JSON.parse(labTests);
    }
    
    if (!Array.isArray(labTests) || labTests.length === 0) {
      console.log('No lab tests to create requests for');
      return;
    }
    
    for (const testName of labTests) {
      try {
        // Dedup check: skip if a non-cancelled request for same test+visit already exists
        const [existingRows] = await sequelize.query(
          `SELECT id FROM lab_requests WHERE patient_id = ? AND visit_id = ? AND test_name = ? AND status NOT IN ('cancelled') LIMIT 1`,
          { replacements: [visitData.patient_id, visit.id, testName] }
        );
        if (existingRows.length > 0) {
          console.log('Skipping duplicate lab request for test:', testName);
          continue;
        }

        const requestId = uuidv4();
        
        // Get branch_id from visit or use visit's branch_id
        const branchId = visit.branch_id || visitData.branch_id || null;
        
        // Create lab request directly in database - matching actual table structure
        const insertQuery = `
          INSERT INTO lab_requests (
            id, patient_id, visit_id, test_code, test_name, status, 
            priority, requested_by, clinic_id, notes, requested_at, created_at, branch_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
        `;
        
        const replacements = [
          requestId,
          visitData.patient_id,
          visit.id, // visit_id
          testName.substring(0, 3).toUpperCase(), // test_code
          testName, // test_name
          'pending', // status
          'normal', // priority
          visitData.doctor_id || visitData.user_id || '723d4f28-9b59-4006-a012-03bdff7c30b6', // requested_by (must be user ID)
          visitData.clinic_id, // clinic_id
          'Lab test requested during clinical visit', // notes
          branchId // branch_id
        ];
        
        console.log('Creating lab request with data:', {
          requestId,
          patient_id: visitData.patient_id,
          patient_name: visitData.patient_name,
          test_name: testName,
          visit_id: visit.id
        });
        
        console.log('Executing SQL query:', insertQuery);
        console.log('With replacements:', replacements);
        
        await sequelize.query(insertQuery, { replacements });
        console.log(`Lab request created successfully for test: ${testName}`);
        
      } catch (testError) {
        console.error(`Error creating lab request for ${testName}:`, testError);
        // Continue with other tests even if one fails
      }
    }
    
    console.log('Finished creating lab requests from visit');
    
  } catch (error) {
    console.error('Error in createLabRequestsFromVisit:', error);
    throw error;
  }
}

// Get visit by ID
router.get('/visits/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const visit = await Visit.findByPk(id);
    
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

// Get all visits for a clinic
router.get('/visits/clinic/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    
    const visits = await Visit.findAll({
      where: { clinic_id: parseInt(clinicId), ...BranchQueryFilter.buildBranchWhere(req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' }) },
      order: [['created_at', 'DESC']]
    });
    
    res.json(visits);
  } catch (error) {
    console.error('Error fetching visits:', error);
    res.status(500).json({ error: 'Failed to fetch visits' });
  }
});

// Get visits for a patient
router.get('/visits/patient/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    
    const visits = await Visit.findAll({
      where: { patient_id: patientId, ...BranchQueryFilter.buildBranchWhere(req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' }) },
      order: [['created_at', 'DESC']]
    });
    
    res.json(visits);
  } catch (error) {
    console.error('Error fetching patient visits:', error);
    res.status(500).json({ error: 'Failed to fetch patient visits' });
  }
});

// Get all patient visits with comprehensive details and filtering
router.get('/patient-visits-history', async (req, res) => {
  try {
    const { from, to, search, doctor_id, status, patient_id } = req.query;
    // A single-patient lookup (PatientsChart) means "this patient's full
    // history", not "visits in the last 30 days" — only apply the rolling
    // 30-day default when nobody asked for one specific patient.
    const dateFrom = from || (patient_id ? '1970-01-01' : new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
    const dateTo = to || new Date().toISOString().split('T')[0];

    // Visits come from two places. Hospitals working the LIS flow (registration
    // → queue → triage → doctor) record each visit as an lis_test_orders row
    // against an lis_participants patient — that is where every real visit is;
    // the general `visits` table was empty in every tenant, so this page showed
    // nothing at all. Both are read, mapped to one shape.
    const branchV = getBranchConditionSQL(req, 'v');
    const branchO = getBranchConditionSQL(req, 'o');
    const repl = { dateFrom, dateTo: `${dateTo} 23:59:59` };
    if (branchV.params.length) repl.branchId = branchV.params[0];
    const branchSqlV = branchV.sql ? ' AND v.branch_id = :branchId' : '';
    const branchSqlO = branchO.sql ? ' AND o.branch_id = :branchId' : '';

    const [[lis]] = await sequelize.query(
      `SELECT (to_regclass(current_schema() || '.lis_test_orders') IS NOT NULL
               AND to_regclass(current_schema() || '.lis_participants') IS NOT NULL) AS orders,
              to_regclass(current_schema() || '.visit_diagnoses') IS NOT NULL AS dx`);
    const lisDiagnosis = lis?.dx
      ? `(SELECT string_agg(COALESCE(d.description, d.icd_code), '; ' ORDER BY d.is_primary DESC NULLS LAST)
            FROM visit_diagnoses d WHERE d.order_id::text = o.id::text AND d.deleted_at IS NULL)`
      : 'NULL';
    const allVisits = `
      WITH all_visits AS (
        SELECT v.id::text AS visit_id, v.visit_date, 'General' AS visit_type,
               v.chief_complaint, v.diagnosis, v.clinical_notes AS notes,
               v.status::text AS visit_status, v.created_at,
               p.id::text AS patient_id, p.patient_id AS patient_number, p.first_name, p.last_name,
               p.date_of_birth, p.gender, p.phone_number AS phone,
               v.doctor_id::text AS doctor_id, u.display_name AS doctor_name, u.email AS doctor_email,
               'visit' AS source,
               (SELECT pb.id::text FROM patient_bills pb WHERE pb.visit_id::text = v.id::text ORDER BY pb.created_at DESC LIMIT 1) AS bill_id
          FROM visits v
          LEFT JOIN patients p ON p.id::text = v.patient_id::text
          LEFT JOIN users u ON u.id::text = v.doctor_id::text
         WHERE v.visit_date BETWEEN :dateFrom AND :dateTo ${branchSqlV}
        ${lis?.orders ? `UNION ALL
        SELECT o.id::text, o.created_at, 'Outpatient',
               o.clinical_notes,
               ${lisDiagnosis},
               NULL,
               CASE WHEN o.status IN ('closed', 'completed') THEN 'completed'
                    WHEN o.status = 'cancelled' THEN 'cancelled'
                    ELSE 'pending' END,
               o.created_at,
               lp.id::text, lp.participant_number, lp.first_name, lp.last_name,
               lp.date_of_birth, lp.gender, lp.phone,
               COALESCE(o.doctor_id::text, o.consultant_id::text), du.display_name, du.email,
               'lis',
               -- The patient's bill from the visit day (LIS visits have no bill link of their own).
               (SELECT pb.id::text FROM patient_bills pb WHERE pb.patient_id::text = o.participant_id::text
                   AND DATE(pb.bill_date) = DATE(o.created_at) AND pb.status::text <> 'cancelled'
                 ORDER BY pb.created_at DESC LIMIT 1)
          FROM lis_test_orders o
          LEFT JOIN lis_participants lp ON lp.id::text = o.participant_id::text
          LEFT JOIN users du ON du.id::text = COALESCE(o.doctor_id::text, o.consultant_id::text)
         WHERE o.created_at BETWEEN :dateFrom AND :dateTo ${branchSqlO}` : ''}
      )`;

    const where = [];
    if (search) {
      where.push(`((COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) ILIKE :search OR patient_number ILIKE :search
                   OR chief_complaint ILIKE :search OR diagnosis ILIKE :search)`);
      repl.search = `%${search}%`;
    }
    if (doctor_id) { where.push('doctor_id = :doctorId'); repl.doctorId = String(doctor_id); }
    if (status) { where.push('visit_status = :status'); repl.status = status; }
    if (patient_id) { where.push('patient_id = :patientId'); repl.patientId = String(patient_id); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [visits] = await sequelize.query(`${allVisits}
      SELECT a.*,
             (COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')) AS patient_name,
             (EXTRACT(YEAR FROM AGE(CURRENT_DATE::timestamp, a.date_of_birth::timestamp)))::int AS age,
             (SELECT COUNT(*) FROM all_visits x WHERE x.patient_id = a.patient_id) AS total_visits,
             (SELECT MAX(x.visit_date) FROM all_visits x WHERE x.patient_id = a.patient_id AND x.visit_id <> a.visit_id) AS last_visit_date
        FROM all_visits a ${whereSql}
       ORDER BY a.visit_date DESC, a.created_at DESC LIMIT 500`, { replacements: repl });

    const [stats] = await sequelize.query(`${allVisits}
      SELECT COUNT(DISTINCT visit_id) AS total_visits, COUNT(DISTINCT patient_id) AS unique_patients,
             COUNT(DISTINCT doctor_id) AS doctors_involved, COUNT(DISTINCT DATE(visit_date)) AS visit_days
        FROM all_visits ${whereSql}`, { replacements: repl });

    const [doctors] = await sequelize.query(`${allVisits}
      SELECT DISTINCT doctor_id AS id, doctor_name AS display_name, doctor_email AS email
        FROM all_visits WHERE doctor_id IS NOT NULL ORDER BY doctor_name`, { replacements: repl });

    res.json({
      visits,
      summary: stats[0] || { total_visits: 0, unique_patients: 0, doctors_involved: 0, visit_days: 0 },
      doctors: doctors || []
    });
  } catch (error) {
    console.error('Error fetching patient visits history:', error);
    res.status(500).json({ error: 'Failed to fetch patient visits history', details: error.message });
  }
});

module.exports = router;
