const express = require('express');
const { authorize } = require('../middleware/authorize');
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /laboratory, so the API enforces what the client already assumes.
const LAB_WRITE = ['admin', 'lab', 'doctor'];
const router = express.Router();

async function getLabRequestById(id) {
  const [rows] = await sequelize.query(`SELECT * FROM lab_requests WHERE id = ?`, {
    replacements: [id]
  });
  return rows[0] || null;
}

function canAccessBranchRecord(record, req) {
  if (!record) return false;
  if (req.branchContext?.isAdmin || req.user?.role === 'admin') return true;
  // Allow access if record has no branch_id set (legacy records or clinic-wide records)
  if (!record.branch_id || record.branch_id === null) return true;
  // Convert both to strings for comparison to handle type mismatches
  const recordBranchId = String(record.branch_id);
  const userBranchId = String(req.branchContext?.branchId || req.user?.branchId || '');
  return recordBranchId === userBranchId;
}

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Lab requests API is working',
    timestamp: new Date().toISOString()
  });
});

// Get lab requests by clinic
router.get('/', async (req, res) => {
  try {
    const { clinic, startDate, endDate } = req.query;
    const branchFilter = getBranchConditionSQL(req, 'lr');
    
    if (!clinic) {
      return res.status(400).json({ error: 'Clinic parameter is required' });
    }

    let dateFilter = '';
    if (startDate && endDate) {
      dateFilter = `AND lr.requested_at >= '${startDate} 00:00:00' AND lr.requested_at <= '${endDate} 23:59:59'`;
    } else if (startDate) {
      dateFilter = `AND lr.requested_at >= '${startDate} 00:00:00'`;
    } else if (endDate) {
      dateFilter = `AND lr.requested_at <= '${endDate} 23:59:59'`;
    }

    const [results] = await sequelize.query(`
      SELECT 
        lr.*,
        p.first_name,
        p.last_name,
        p.date_of_birth,
        p.gender,
        p.patient_id,
        COALESCE((p.first_name || ' ' || p.last_name), lr.patient_name) as patient_name,
        CASE WHEN p.date_of_birth IS NOT NULL THEN (EXTRACT(YEAR FROM AGE((CURRENT_DATE)::timestamp, (p.date_of_birth)::timestamp)))::int ELSE NULL END as age
      FROM lab_requests lr
      LEFT JOIN patients p ON p.id = lr.patient_id
      WHERE lr.clinic_id = ?
      ${branchFilter.sql}
      ${dateFilter}
      ORDER BY lr.requested_at DESC
    `, {
      replacements: [clinic, ...branchFilter.params]
    });

    console.log('Lab requests query results:', JSON.stringify(results, null, 2));
    res.json(results);
  } catch (error) {
    console.error('Error fetching lab requests:', error);
    res.status(500).json({ error: 'Failed to fetch lab requests' });
  }
});

// Create new lab request
router.post('/', authorize(LAB_WRITE), async (req, res) => {
  try {
    console.log('=== LAB REQUEST CREATION START ===');
    console.log('Lab request creation - received body:', JSON.stringify(req.body, null, 2));
    
    // Add basic validation first
    if (!req.body) {
      console.log('ERROR: No request body received');
      return res.status(400).json({ error: 'Request body is required' });
    }
    
    // Ensure lab_requests table exists with correct structure
    try {
      console.log('Ensuring lab_requests table exists...');
      
      // Try to create the table (will be ignored if exists)
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS lab_requests (
          id VARCHAR(36) PRIMARY KEY,
          patient_id VARCHAR(255) NOT NULL,
          patient_name VARCHAR(255) NULL,
          clinic_id INT NOT NULL,
          test_id VARCHAR(36) NULL,
          test_name VARCHAR(255) NOT NULL,
          test_code VARCHAR(50) NULL,
          requested_by VARCHAR(255) DEFAULT 'System',
          requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('normal','urgent','stat')),
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','collected','processing','completed','cancelled')),
          notes TEXT NULL,
          visit_id VARCHAR(36) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP NULL
        )
      `);
      console.log('Lab requests table ensured');
      
      // Test a simple query to verify table structure
      await sequelize.query('SELECT COUNT(*) FROM lab_requests LIMIT 1');
      console.log('Table structure verified');
      
    } catch (tableError) {
      console.error('Error with lab_requests table:', tableError.message);
      
      // If there's a structure issue, try to recreate the table
      if (tableError.message.includes('Unknown column') || tableError.message.includes('doesn\'t exist')) {
        console.log('Attempting to recreate lab_requests table...');
        try {
          await sequelize.query('DROP TABLE IF EXISTS lab_requests');
          await sequelize.query(`
            CREATE TABLE lab_requests (
              id VARCHAR(36) PRIMARY KEY,
              patient_id VARCHAR(255) NOT NULL,
              patient_name VARCHAR(255) NULL,
              clinic_id INT NOT NULL,
              test_name VARCHAR(255) NOT NULL,
              requested_by VARCHAR(255) DEFAULT 'System',
              status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
              priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('normal','urgent','stat')),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
          console.log('Lab requests table recreated successfully');
        } catch (recreateError) {
          console.error('Failed to recreate table:', recreateError.message);
        }
      }
    }
    
    const {
      patient_id,
      patient_name,
      clinic_id,
      test_id,
      test_name,
      test_code,
      test_type,
      requested_by,
      requested_at,
      priority = 'normal',
      notes,
      visit_id,
      status = 'pending',
      bill_id
    } = req.body;

    // Validate required fields
    if (!patient_id || !patient_name || !clinic_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: patient_id, patient_name, clinic_id' 
      });
    }

    if (!test_name && !test_code && !test_type) {
      return res.status(400).json({ 
        error: 'At least one of test_name, test_code, or test_type is required' 
      });
    }

    // Dedup check: return existing request if same test already pending for this visit
    const resolvedTestName = test_name || test_type || test_code || 'Unknown Test';
    if (visit_id) {
      const [existing] = await sequelize.query(
        `SELECT * FROM lab_requests WHERE patient_id = ? AND visit_id = ? AND test_name = ? AND status NOT IN ('cancelled') LIMIT 1`,
        { replacements: [patient_id, visit_id, resolvedTestName] }
      );
      if (existing.length > 0) {
        console.log('Duplicate lab request prevented for test:', resolvedTestName);
        return res.status(201).json(existing[0]);
      }
    }

    const requestId = uuidv4();
    
    const branchId = getCreateBranchId(req);
    
    const insertQuery = `
      INSERT INTO lab_requests (
        id, patient_id, patient_name, clinic_id, test_id, test_name, test_code, requested_by, status, priority, notes, visit_id, branch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const replacements = [
      requestId,
      patient_id,
      patient_name || 'Unknown Patient',
      parseInt(clinic_id),
      test_id || null,
      test_name || test_type || test_code || 'Unknown Test',
      test_code || null,
      requested_by || 'System',
      status || 'pending',
      priority || 'normal',
      notes || null,
      visit_id || null,
      branchId
    ];
    
    console.log('Lab request insert query:', insertQuery);
    console.log('Lab request replacements:', replacements);
    console.log('Replacement count:', replacements.length);
    console.log('Expected columns: 8');
    
    // Validate data before insertion
    console.log('Data validation:');
    console.log('- requestId:', requestId, typeof requestId);
    console.log('- patient_id:', patient_id, typeof patient_id);
    console.log('- patient_name:', patient_name, typeof patient_name);
    console.log('- clinic_id:', clinic_id, typeof clinic_id);
    console.log('- test_name:', test_name, typeof test_name);
    
    await sequelize.query(insertQuery, {
      replacements: replacements
    });

    const [created] = await sequelize.query(`
      SELECT * FROM lab_requests WHERE id = ?
    `, {
      replacements: [requestId]
    });

    console.log('Lab request created successfully:', created[0]);
    res.status(201).json(created[0]);
  } catch (error) {
    console.error('Error creating lab request:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    console.error('SQL Error code:', error.code);
    console.error('SQL Error errno:', error.errno);
    res.status(500).json({ 
      error: 'Failed to create lab request',
      details: error.message,
      code: error.code,
      errno: error.errno
    });
  }
});

// Get saved component values for a lab request
router.get('/:id/component-values', async (req, res) => {
  try {
    const { id } = req.params;
    const labRequest = await getLabRequestById(id);
    if (!labRequest) {
      return res.status(404).json({ error: 'Lab request not found' });
    }
    if (!canAccessBranchRecord(labRequest, req)) {
      return res.status(403).json({ error: 'Access denied to this lab request' });
    }
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS lab_result_component_values (
        id VARCHAR(36) PRIMARY KEY,
        result_id VARCHAR(36) NOT NULL,
        component_name VARCHAR(255) NOT NULL,
        value TEXT,
        unit VARCHAR(50),
        normal_range VARCHAR(100),
        is_abnormal BOOLEAN DEFAULT false,
        remark TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const [components] = await sequelize.query(
      `SELECT cv.* FROM lab_result_component_values cv
       JOIN lab_results lr ON lr.id = cv.result_id
       WHERE lr.lab_request_id = ?
       ORDER BY cv.created_at ASC`,
      { replacements: [id] }
    );
    res.json(components);
  } catch (error) {
    console.error('Error fetching component values:', error.message);
    res.status(500).json({ error: 'Failed to fetch component values', details: error.message });
  }
});

// Auto-save component value
router.post('/:id/auto-save', authorize(LAB_WRITE), async (req, res) => {
  const crypto = require('crypto');
  try {
    const { id } = req.params;
    const { componentName, componentValue, remark, unit, normalRange } = req.body;

    console.log('Auto-save request:', { id, componentName, componentValue, remark });

    // Check if lab request exists
    const [[labRequest]] = await sequelize.query(
      `SELECT * FROM lab_requests WHERE id = ?`,
      { replacements: [id] }
    );

    if (!labRequest) {
      return res.status(404).json({ error: 'Lab request not found' });
    }
    if (!canAccessBranchRecord(labRequest, req)) {
      return res.status(403).json({ error: 'Access denied to this lab request' });
    }

    // Find or create a lab_results entry for this lab_request
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS lab_result_component_values (
        id VARCHAR(36) PRIMARY KEY,
        result_id VARCHAR(36) NOT NULL,
        component_name VARCHAR(255) NOT NULL,
        value TEXT,
        unit VARCHAR(50),
        normal_range VARCHAR(100),
        is_abnormal BOOLEAN DEFAULT false,
        remark TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    let [[labResult]] = await sequelize.query(
      `SELECT * FROM lab_results WHERE lab_request_id = ? LIMIT 1`,
      { replacements: [id] }
    );

    if (!labResult) {
      // Resolve actual patient UUID (lab_requests.patient_id may be readable ID like 'UH-989887')
      const [[patientRow]] = await sequelize.query(
        `SELECT id FROM patients WHERE patient_id = ? LIMIT 1`,
        { replacements: [labRequest.patient_id] }
      );
      const patientUUID = patientRow?.id || labRequest.patient_id;

      const resultId = crypto.randomUUID();
      const performedById = req.user?.id || null;
      await sequelize.query(
        `INSERT INTO lab_results (id, lab_request_id, patient_id, test_code, test_name, result_date, performed_by, status, clinic_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), ?, 'partial', ?, NOW(), NOW())`,
        {
          replacements: [
            resultId,
            id,
            patientUUID,
            labRequest.test_code || '',
            labRequest.test_name || '',
            performedById || 'system',
            labRequest.clinic_id || null
          ]
        }
      );
      [[labResult]] = await sequelize.query(
        `SELECT * FROM lab_results WHERE id = ?`, { replacements: [resultId] }
      );
    }

    // Determine if value is abnormal based on normal_range
    let isAbnormal = false;
    if (normalRange && componentValue && !isNaN(Number(componentValue))) {
      const rangeMatch = normalRange.match(/^([\d.]+)-([\d.]+)$/);
      if (rangeMatch) {
        const val = parseFloat(componentValue);
        isAbnormal = (val < parseFloat(rangeMatch[1]) || val > parseFloat(rangeMatch[2]));
      }
    }

    // Upsert component value — update if exists, insert if not
    const [[existing]] = await sequelize.query(
      `SELECT id FROM lab_result_component_values WHERE result_id = ? AND component_name = ?`,
      { replacements: [labResult.id, componentName] }
    );

    if (existing) {
      await sequelize.query(
        `UPDATE lab_result_component_values SET value = ?, unit = ?, normal_range = ?, is_abnormal = ?, remark = ?, updated_at = NOW() WHERE id = ?`,
        { replacements: [componentValue, unit || '', normalRange || '', isAbnormal, remark || '', existing.id] }
      );
    } else {
      await sequelize.query(
        `INSERT INTO lab_result_component_values (id, result_id, component_name, value, unit, normal_range, is_abnormal, remark, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        {
          replacements: [
            labResult.id,
            componentName,
            componentValue,
            unit || '',
            normalRange || '',
            isAbnormal,
            remark || ''
          ]
        }
      );
    }

    // Mark lab_request as partial if still pending
    if (labRequest.status === 'pending') {
      await sequelize.query(
        `UPDATE lab_requests SET status = 'partial', updated_at = NOW() WHERE id = ?`,
        { replacements: [id] }
      );
    }

    console.log('Auto-saved component:', componentName, '=', componentValue);
    res.json({ success: true, message: `${componentName} saved`, componentName, componentValue, remark });
  } catch (error) {
    console.error('Error auto-saving component:', error.message);
    res.status(500).json({ error: 'Failed to auto-save component', details: error.message });
  }
});

// Submit lab results and lock the request
router.post('/:id/results', authorize(LAB_WRITE), async (req, res) => {
  const crypto = require('crypto');
  try {
    const { id } = req.params;
    const { components, resultText, performedBy, status = 'completed' } = req.body;

    // Verify the lab request exists
    const [[labRequest]] = await sequelize.query(
      `SELECT * FROM lab_requests WHERE id = ?`, { replacements: [id] }
    );
    if (!labRequest) return res.status(404).json({ error: 'Lab request not found' });
    if (!canAccessBranchRecord(labRequest, req)) {
      return res.status(403).json({ error: 'Access denied to this lab request' });
    }

    // Find or create a lab_results entry for this request (same as auto-save)
    let [[labResult]] = await sequelize.query(
      `SELECT * FROM lab_results WHERE lab_request_id = ? LIMIT 1`, { replacements: [id] }
    );
    if (!labResult) {
      const [[patientRow]] = await sequelize.query(
        `SELECT id FROM patients WHERE patient_id = ? LIMIT 1`,
        { replacements: [labRequest.patient_id] }
      );
      const patientUUID = patientRow?.id || labRequest.patient_id;
      const resultId = crypto.randomUUID();
      const performedById = req.user?.id || null;
      await sequelize.query(
        `INSERT INTO lab_results (id, lab_request_id, patient_id, test_code, test_name, result_date, performed_by, status, clinic_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, NOW(), NOW())`,
        { replacements: [resultId, id, patientUUID, labRequest.test_code || '', labRequest.test_name || '', performedById || 'system', status, labRequest.clinic_id || null] }
      );
      [[labResult]] = await sequelize.query(`SELECT * FROM lab_results WHERE id = ?`, { replacements: [resultId] });
    } else {
      // Update existing result status
      await sequelize.query(
        `UPDATE lab_results SET status = ?, updated_at = NOW() WHERE id = ?`,
        { replacements: [status, labResult.id] }
      );
    }

    // Upsert each component value via result_id
    if (Array.isArray(components)) {
      for (const comp of components) {
        if (!comp.name || comp.value === undefined || comp.value === null || !comp.value.toString().trim()) continue;
        let isAbnormal = false;
        const refRange = comp.normalRangeText || (comp.normalRangeMin != null && comp.normalRangeMax != null ? `${comp.normalRangeMin}-${comp.normalRangeMax}` : '');
        if (refRange && !isNaN(Number(comp.value))) {
          const m = refRange.match(/^([\d.]+)-([\d.]+)$/);
          if (m) {
            const val = parseFloat(comp.value);
            isAbnormal = (val < parseFloat(m[1]) || val > parseFloat(m[2]));
          }
        }
        const [[existing]] = await sequelize.query(
          `SELECT id FROM lab_result_component_values WHERE result_id = ? AND component_name = ?`,
          { replacements: [labResult.id, comp.name] }
        );
        if (existing) {
          await sequelize.query(
            `UPDATE lab_result_component_values SET value = ?, unit = ?, normal_range = ?, is_abnormal = ?, remark = ?, updated_at = NOW() WHERE id = ?`,
            { replacements: [comp.value, comp.unit || '', refRange, isAbnormal, comp.remark || '', existing.id] }
          );
        } else {
          await sequelize.query(
            `INSERT INTO lab_result_component_values (id, result_id, component_name, value, unit, normal_range, is_abnormal, remark, created_at, updated_at)
             VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            { replacements: [labResult.id, comp.name, comp.value, comp.unit || '', refRange, isAbnormal, comp.remark || ''] }
          );
        }
      }
    }

    // Lock the lab_request (completed_by has FK to users.id — only update status/timestamp)
    await sequelize.query(
      `UPDATE lab_requests SET status = ?, updated_at = NOW() WHERE id = ?`,
      { replacements: [status, id] }
    );

    const [[updated]] = await sequelize.query(`SELECT * FROM lab_requests WHERE id = ?`, { replacements: [id] });
    res.json(updated);
  } catch (error) {
    console.error('Error saving lab results:', error.message);
    res.status(500).json({ error: 'Failed to save lab results', details: error.message });
  }
});

// Send lab results back to requesting doctor
router.post('/:id/send-results', authorize(LAB_WRITE), async (req, res) => {
  try {
    const { id } = req.params;
    const { components } = req.body;

    console.log('Sending lab results for request:', id);
    console.log('Results data:', { componentsCount: Array.isArray(components) ? components.length : 0 });

    const crypto = require('crypto');
    const [[labRequest]] = await sequelize.query(
      `SELECT * FROM lab_requests WHERE id = ?`,
      { replacements: [id] }
    );

    if (!labRequest) {
      return res.status(404).json({ error: 'Lab request not found' });
    }
    if (!canAccessBranchRecord(labRequest, req)) {
      return res.status(403).json({ error: 'Access denied to this lab request' });
    }

    let [[labResult]] = await sequelize.query(
      `SELECT * FROM lab_results WHERE lab_request_id = ? LIMIT 1`,
      { replacements: [id] }
    );

    if (!labResult) {
      const [[patientRow]] = await sequelize.query(
        `SELECT id FROM patients WHERE patient_id = ? LIMIT 1`,
        { replacements: [labRequest.patient_id] }
      );
      const patientUUID = patientRow?.id || labRequest.patient_id;
      const resultId = crypto.randomUUID();
      const performedById = req.user?.id || null;
      await sequelize.query(
        `INSERT INTO lab_results (id, lab_request_id, patient_id, test_code, test_name, result_date, performed_by, status, clinic_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), ?, 'completed', ?, NOW(), NOW())`,
        {
          replacements: [
            resultId,
            id,
            patientUUID,
            labRequest.test_code || '',
            labRequest.test_name || '',
            performedById || 'system',
            labRequest.clinic_id || null
          ]
        }
      );
      [[labResult]] = await sequelize.query(
        `SELECT * FROM lab_results WHERE id = ?`,
        { replacements: [resultId] }
      );
    } else {
      await sequelize.query(
        `UPDATE lab_results SET status = 'completed', updated_at = NOW() WHERE id = ?`,
        { replacements: [labResult.id] }
      );
    }

    // Save component values if provided
    if (components && components.length > 0) {
      for (const comp of components) {
        if (!comp.value || !comp.value.trim()) continue;
        
        const refRange = comp.normalRangeMin && comp.normalRangeMax 
          ? `${comp.normalRangeMin}-${comp.normalRangeMax}` 
          : comp.normalRangeText || '';
        
        let isAbnormal = false;
        if (comp.value && comp.normalRangeMin && comp.normalRangeMax) {
          const val = parseFloat(comp.value);
          if (!isNaN(val)) {
            isAbnormal = (val < parseFloat(comp.normalRangeMin) || val > parseFloat(comp.normalRangeMax));
          }
        }

        const [[existing]] = await sequelize.query(
          `SELECT id FROM lab_result_component_values WHERE result_id = ? AND component_name = ?`,
          { replacements: [labResult.id, comp.name] }
        );

        if (existing) {
          await sequelize.query(
            `UPDATE lab_result_component_values SET value = ?, unit = ?, normal_range = ?, is_abnormal = ?, remark = ?, updated_at = NOW() WHERE id = ?`,
            { replacements: [comp.value, comp.unit || '', refRange, isAbnormal, comp.remark || '', existing.id] }
          );
        } else {
          await sequelize.query(
            `INSERT INTO lab_result_component_values (id, result_id, component_name, value, unit, normal_range, is_abnormal, remark, created_at, updated_at)
             VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            { replacements: [labResult.id, comp.name, comp.value, comp.unit || '', refRange, isAbnormal, comp.remark || ''] }
          );
        }
      }
    }

    // Mark the lab request completed so it appears back in clinical workflow
    await sequelize.query(
      `UPDATE lab_requests SET status = 'completed', updated_at = NOW() WHERE id = ?`,
      { replacements: [id] }
    );

    console.log('Lab results sent successfully for request:', id);
    res.json({ 
      message: 'Lab results sent successfully',
      requestId: id,
      resultId: labResult.id,
      sentAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error sending lab results:', error);
    res.status(500).json({ error: 'Failed to send lab results', details: error.message });
  }
});

module.exports = router;
