const express = require('express');
const { LabTest, LabTestComponent, Service, sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { resolveRevenueAccount } = require('../utils/resolveRevenueAccount');
const router = express.Router();

// Get all lab tests (with optional clinic filter)
router.get('/', async (req, res) => {
  try {
    const clinicId = req.query.clinic;
    
    // Build WHERE clause based on clinic filter
    const whereClause = clinicId ? `WHERE lt.clinic_id = ${parseInt(clinicId)}` : '';
    
    // Fetch lab tests using raw SQL
    const labTests = await LabTest.sequelize.query(`
      SELECT 
        lt.id,
        lt.test_name,
        lt.test_code,
        lt.category,
        lt.price,
        lt.service_id,
        lt.clinic_id,
        lt.is_active,
        lt.machine_integration,
        lt.created_at,
        lt.updated_at
      FROM lab_tests lt
      ${whereClause}
      ORDER BY lt.test_name ASC
    `, {
      type: LabTest.sequelize.QueryTypes.SELECT
    });

    // Fetch components for each test
    for (const test of labTests) {
      const components = await LabTest.sequelize.query(`
        SELECT 
          id,
          component_name as name,
          unit,
          reference_range,
          display_order AS display_order
        FROM lab_test_components
        WHERE lab_test_id = :testId
        ORDER BY display_order ASC
      `, {
        replacements: { testId: test.id },
        type: LabTest.sequelize.QueryTypes.SELECT
      });
      test.components = components;
    }

    console.log(`Found ${labTests.length} lab tests with components`);
    res.json(labTests);
  } catch (error) {
    console.error('Error fetching lab tests:', error);
    res.status(500).json({ 
      error: 'Failed to fetch lab tests', 
      details: error.message
    });
  }
});

// Search lab tests (must come before /:id route)
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Use raw SQL to avoid association issues
    const [labTests] = await sequelize.query(`
      SELECT 
        lt.id,
        lt.test_name,
        lt.test_code,
        lt.category,
        lt.price,
        lt.service_id,
        lt.clinic_id,
        lt.is_active,
        lt.machine_integration,
        lt.created_at,
        lt.updated_at
      FROM lab_tests lt
      WHERE lt.test_name LIKE ?
      ORDER BY lt.test_name ASC
    `, {
      replacements: [`%${q}%`]
    });
    
    // Fetch components for each test
    for (const test of labTests) {
      const [components] = await sequelize.query(`
        SELECT 
          id,
          component_name as name,
          unit,
          reference_range,
          display_order AS display_order
        FROM lab_test_components
        WHERE lab_test_id = ?
        ORDER BY display_order ASC
      `, {
        replacements: [test.id]
      });
      test.components = components;
    }
    
    console.log(`Search for "${q}" found ${labTests.length} lab tests`);
    res.json(labTests);
  } catch (error) {
    console.error('Error searching lab tests:', error);
    res.status(500).json({ 
      error: 'Failed to search lab tests', 
      details: error.message
    });
  }
});

// Get lab tests by clinic
router.get('/clinic/:clinicId', async (req, res) => {
  try {
    // Fetch lab tests using raw SQL
    const labTests = await LabTest.sequelize.query(`
      SELECT 
        lt.id,
        lt.test_name,
        lt.test_code,
        lt.category,
        lt.price,
        lt.service_id,
        lt.clinic_id,
        lt.is_active,
        lt.machine_integration,
        lt.created_at,
        lt.updated_at
      FROM lab_tests lt
      WHERE lt.clinic_id = :clinicId
      ORDER BY lt.test_name ASC
    `, {
      replacements: { clinicId: req.params.clinicId },
      type: LabTest.sequelize.QueryTypes.SELECT
    });

    // Fetch components for each test
    for (const test of labTests) {
      const components = await LabTest.sequelize.query(`
        SELECT 
          id,
          component_name as name,
          unit,
          reference_range,
          display_order AS display_order
        FROM lab_test_components
        WHERE lab_test_id = :testId
        ORDER BY display_order ASC
      `, {
        replacements: { testId: test.id },
        type: LabTest.sequelize.QueryTypes.SELECT
      });
      test.components = components;
    }

    res.json(labTests);
  } catch (error) {
    console.error('Error fetching lab tests by clinic:', error);
    res.status(500).json({ error: 'Failed to fetch lab tests' });
  }
});

// Get lab test by ID (must come after specific routes) will be moved below.

// Get lab tests by category
router.get('/category/:category', async (req, res) => {
  try {
    // include: needs the real, tenant-bound model classes (not the
    // request-agnostic top-level import) so Sequelize's association lookup
    // matches correctly — see models/index.js's tenant-aware proxy comment.
    const { LabTest, LabTestComponent } = req.models;
    const labTests = await LabTest.findAll({
      where: {
        category: req.params.category,
        is_active: true
      },
      include: [{
        model: LabTestComponent,
        as: 'components',
        order: [['display_order', 'ASC']],
      }],
      order: [['test_name', 'ASC']],
    });
    res.json(labTests);
  } catch (error) {
    console.error('Error fetching lab tests by category:', error);
    res.status(500).json({ error: 'Failed to fetch lab tests' });
  }
});

// Get lab test by code (also tries test_name as fallback)
router.get('/code/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const [[labTest]] = await LabTest.sequelize.query(`SELECT * FROM lab_tests WHERE test_code = ? OR test_name = ? LIMIT 1`, { replacements: [code, code] });
    if (!labTest) return res.status(404).json({ error: 'Lab test not found' });
    const [components] = await LabTest.sequelize.query(`SELECT id, component_name as name, unit, reference_range, display_order AS display_order, display_order FROM lab_test_components WHERE lab_test_id = ? ORDER BY display_order ASC`, { replacements: [labTest.id] });
    labTest.components = components;
    res.json(labTest);
  } catch (error) {
    console.error('Error fetching lab test by code:', error);
    res.status(500).json({ error: 'Failed to fetch lab test', details: error.message });
  }
});

// Get lab test by ID (must come after specific routes)
router.get('/:id', async (req, res) => {
  try {
    const { LabTest, LabTestComponent } = req.models;
    const labTest = await LabTest.findByPk(req.params.id, {
      include: [{
        model: LabTestComponent,
        as: 'components',
        order: [['display_order', 'ASC']],
      }],
    });
    if (!labTest) {
      return res.status(404).json({ error: 'Lab test not found' });
    }
    res.json(labTest);
  } catch (error) {
    console.error('Error fetching lab test:', error);
    res.status(500).json({ error: 'Failed to fetch lab test' });
  }
});

// Create new lab test
router.post('/', authorize(['admin']), async (req, res) => {
  try {
    
    // Use raw SQL to insert directly into lab_tests table
    const { test_name, test_code, category, price, clinic_id } = req.body;
    
    const testId = require('crypto').randomUUID();
    const [results] = await LabTest.sequelize.query(`
      INSERT INTO lab_tests (id, test_name, test_code, category, price, clinic_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, true, NOW(), NOW())
    `, {
      replacements: [testId, test_name, test_code, category, price || 0, clinic_id]
    });
    
    // Fetch the created record
    const [created] = await LabTest.sequelize.query(`
      SELECT * FROM lab_tests 
      WHERE id = ?
    `, {
      replacements: [testId]
    });
    
    console.log('Lab test created successfully:', created[0]);
    res.status(201).json(created[0]);
  } catch (error) {
    console.error('Error creating lab test:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ error: 'Failed to create lab test', details: error.message });
  }
});

// Create lab test with components
router.post('/with-components', authorize(['admin']), async (req, res) => {
  const transaction = await LabTest.sequelize.transaction();
  const crypto = require('crypto');
  
  try {
    const { test, components } = req.body;
    
    console.log('Creating lab test with data:', JSON.stringify({ test, components }, null, 2));
    
    // Validate required fields
    if (!test.test_name || !test.test_code || !test.category || !test.clinic_id) {
      await transaction.rollback();
      return res.status(400).json({ error: 'test_name, test_code, category and clinic_id are required' });
    }
    
    const testCode = test.test_code.toUpperCase();
    const clinicId = parseInt(test.clinic_id);
    const price = parseFloat(test.price) || 0;
    const serviceId = test.service_id || null;
    const machineIntegration = test.machine_integration || null;

    // Check if test_code already exists
    const [[existingTest]] = await LabTest.sequelize.query(
      `SELECT id FROM lab_tests WHERE test_code = ?`,
      { replacements: [testCode], transaction }
    );

    let testId;

    if (existingTest) {
      // Update the existing test
      testId = existingTest.id;
      console.log('Test code exists, updating existing test:', testId);
      await LabTest.sequelize.query(
        `UPDATE lab_tests SET test_name = ?, category = ?, price = ?, service_id = ?, machine_integration = ?, updated_at = NOW() WHERE id = ?`,
        { replacements: [test.test_name, test.category, price, serviceId, machineIntegration, testId], transaction }
      );
    } else {
      // Create new lab test
      testId = crypto.randomUUID();
      console.log('Creating new lab test with id:', testId);
      await LabTest.sequelize.query(
        `INSERT INTO lab_tests (id, test_name, test_code, category, clinic_id, price, service_id, machine_integration, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, NOW(), NOW())`,
        { replacements: [testId, test.test_name, testCode, test.category, clinicId, price, serviceId, machineIntegration], transaction }
      );
    }

    // Only delete+replace components if we actually have valid ones to insert
    const validComponents = Array.isArray(components)
      ? components.filter(c => c.component_name && c.component_name.trim() !== '')
      : [];

    if (validComponents.length > 0) {
      await LabTest.sequelize.query(
        `DELETE FROM lab_test_components WHERE lab_test_id = ?`,
        { replacements: [testId], transaction }
      );
      console.log('Inserting', validComponents.length, 'components for test:', testId);
      for (let i = 0; i < validComponents.length; i++) {
        const comp = validComponents[i];
        const compId = crypto.randomUUID();
        await LabTest.sequelize.query(
          `INSERT INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          {
            replacements: [
              compId,
              testId,
              comp.component_name.trim(),
              comp.unit || '',
              comp.reference_range || '',
              comp.display_order !== undefined ? comp.display_order : i
            ],
            transaction
          }
        );
      }
    } else {
      console.log('No valid components provided - preserving existing components for test:', testId);
    }

    await transaction.commit();

    // Fetch the complete result
    const [[savedTest]] = await LabTest.sequelize.query(
      `SELECT * FROM lab_tests WHERE id = ?`, { replacements: [testId] }
    );
    const [savedComponents] = await LabTest.sequelize.query(
      `SELECT * FROM lab_test_components WHERE lab_test_id = ? ORDER BY display_order ASC`,
      { replacements: [testId] }
    );

    console.log('Lab test saved successfully with', savedComponents.length, 'components');
    res.status(existingTest ? 200 : 201).json({ ...savedTest, components: savedComponents });

  } catch (error) {
    await transaction.rollback();
    console.error('Error creating lab test with components:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to save lab test with components', details: error.message });
  }
});

// Update lab test
router.put('/:id', authorize(['admin']), async (req, res) => {
  try {
    const { test_name, test_code, category, price } = req.body;
    
    // Use raw SQL to update directly in lab_tests table
    const [results] = await LabTest.sequelize.query(`
      UPDATE lab_tests 
      SET test_name = ?, test_code = ?, category = ?, price = ?, updated_at = NOW()
      WHERE id = ?
    `, {
      replacements: [test_name, test_code, category, price || 0, req.params.id]
    });
    
    // Fetch the updated record
    const [updated] = await LabTest.sequelize.query(`
      SELECT * FROM lab_tests WHERE id = ?
    `, {
      replacements: [req.params.id]
    });
    
    if (!updated[0]) return res.status(404).json({ error: 'Lab test not found' });
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating lab test:', error);
    res.status(500).json({ error: 'Failed to update lab test', details: error.message });
  }
});

// Update lab test with components
router.put('/:id/with-components', authorize(['admin']), async (req, res) => {
  const transaction = await LabTest.sequelize.transaction();
  
  try {
    const { test, components } = req.body;
    
    console.log('Updating lab test id:', req.params.id, 'with data:', JSON.stringify({ test, components }, null, 2));
    
    if (!test) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Test data is required' });
    }
    
    // Use raw SQL to avoid Sequelize model validation issues
    const [updateResult] = await LabTest.sequelize.query(
      `UPDATE lab_tests SET test_name = ?, test_code = ?, category = ?, price = ?, service_id = ?, machine_integration = ?, updated_at = NOW() WHERE id = ?`,
      {
        replacements: [
          test.test_name,
          test.test_code ? test.test_code.toUpperCase() : test.test_code,
          test.category,
          parseFloat(test.price) || 0,
          test.service_id || null,
          test.machine_integration || null,
          req.params.id
        ],
        transaction
      }
    );
    
    if (!updateResult || (updateResult.rowCount !== undefined && updateResult.rowCount === 0)) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Lab test not found' });
    }
    
    // Only delete+replace components if we actually have valid ones to insert
    const validPutComponents = Array.isArray(components)
      ? components.filter(c => c.component_name && c.component_name.trim() !== '')
      : [];

    if (validPutComponents.length > 0) {
      await LabTest.sequelize.query(
        `DELETE FROM lab_test_components WHERE lab_test_id = ?`,
        { replacements: [req.params.id], transaction }
      );
      for (let i = 0; i < validPutComponents.length; i++) {
        const component = validPutComponents[i];
        const componentId = require('crypto').randomUUID();
        await LabTest.sequelize.query(
          `INSERT INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          {
            replacements: [
              componentId,
              req.params.id,
              component.component_name.trim(),
              component.unit || '',
              component.reference_range || '',
              component.display_order !== undefined ? component.display_order : i
            ],
            transaction
          }
        );
      }
    } else {
      console.log('No valid components provided - preserving existing components for test:', req.params.id);
    }
    
    await transaction.commit();
    
    // Fetch the complete updated lab test with components
    const [updatedTests] = await LabTest.sequelize.query(
      `SELECT * FROM lab_tests WHERE id = ?`,
      { replacements: [req.params.id] }
    );
    const [updatedComponents] = await LabTest.sequelize.query(
      `SELECT * FROM lab_test_components WHERE lab_test_id = ? ORDER BY display_order ASC`,
      { replacements: [req.params.id] }
    );
    
    const result = updatedTests[0] ? { ...updatedTests[0], components: updatedComponents } : null;
    
    console.log('Lab test updated successfully:', req.params.id);
    res.json(result);
  } catch (error) {
    await transaction.rollback();
    console.error('Error updating lab test with components:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to update lab test with components', details: error.message });
  }
});

// Delete lab test (soft delete)
router.delete('/:id', authorize(['admin']), async (req, res) => {
  try {
    // Check if test exists first
    const [test] = await LabTest.sequelize.query(`
      SELECT id FROM lab_tests WHERE id = :id
    `, {
      replacements: { id: req.params.id },
      type: LabTest.sequelize.QueryTypes.SELECT
    });

    if (!test) {
      return res.status(404).json({ error: 'Lab test not found' });
    }

    // Use raw SQL to soft delete directly in lab_tests table
    const [results] = await LabTest.sequelize.query(`
      UPDATE lab_tests 
      SET is_active = false, updated_at = NOW()
      WHERE id = :id
    `, {
      replacements: { id: req.params.id }
    });
    
    res.json({ message: 'Lab test deleted successfully' });
  } catch (error) {
    console.error('Error deleting lab test:', error);
    res.status(500).json({ error: 'Failed to delete lab test', details: error.message });
  }
});

// Delete lab test with components (HARD DELETE)
router.delete('/:id/with-components', authorize(['admin']), async (req, res) => {
  const transaction = await LabTest.sequelize.transaction();
  
  try {
    // Check if test exists first
    const [test] = await LabTest.sequelize.query(`
      SELECT id FROM lab_tests WHERE id = :id
    `, {
      replacements: { id: req.params.id },
      type: LabTest.sequelize.QueryTypes.SELECT,
      transaction
    });

    if (!test) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Lab test not found' });
    }

    // Delete components first using raw SQL (HARD DELETE)
    await LabTest.sequelize.query(`
      DELETE FROM lab_test_components WHERE lab_test_id = :id
    `, {
      replacements: { id: req.params.id },
      transaction
    });
    
    // Delete the lab test permanently using raw SQL (HARD DELETE)
    await LabTest.sequelize.query(`
      DELETE FROM lab_tests WHERE id = :id
    `, {
      replacements: { id: req.params.id },
      transaction
    });
    
    await transaction.commit();
    res.json({ message: 'Lab test and components deleted successfully' });
  } catch (error) {
    await transaction.rollback();
    console.error('Error deleting lab test with components:', error);
    res.status(500).json({ error: 'Failed to delete lab test with components', details: error.message });
  }
});

// Add sample lab test data for testing
router.post('/seed', authorize(['admin']), async (req, res) => {
  try {
    
    const sampleTests = [
      {
        test_name: 'Complete Blood Count',
        test_code: 'CBC',
        category: 'Hematology',
        price: 25.00,
        clinic_id: 1
      },
      {
        test_name: 'Lipid Profile',
        test_code: 'LP',
        category: 'Chemistry',
        price: 35.00,
        clinic_id: 1
      },
      {
        test_name: 'Blood Film for Malaria',
        test_code: 'BFFM',
        category: 'Parasitology',
        price: 15.00,
        clinic_id: 1
      }
    ];
    
    for (const test of sampleTests) {
      try {
        await LabTest.sequelize.query(`
          INSERT INTO lab_tests (id, test_name, test_code, category, price, clinic_id, is_active, created_at, updated_at)
          VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, true, NOW(), NOW())
        `, {
          replacements: [test.test_name, test.test_code, test.category, test.price, test.clinic_id]
        });
      } catch (insertError) {
        // Skip if test already exists (duplicate test_code)
        if (!insertError.message.includes('Duplicate entry') && insertError.code !== '23505') {
          throw insertError;
        }
      }
    }
    
    // Fetch all tests to return
    const [results] = await LabTest.sequelize.query(`
      SELECT * FROM lab_tests WHERE is_active = true ORDER BY test_name ASC
      
    `);
    
    res.json({ 
      message: 'Sample lab tests seeded successfully', 
      count: results.length,
      tests: results 
    });
  } catch (error) {
    console.error('Error seeding lab tests:', error);
    res.status(500).json({ error: 'Failed to seed lab tests', details: error.message });
  }
});

// Bulk upload lab tests from CSV
router.post('/bulk-upload', authorize(['admin']), async (req, res) => {
  try {
    const { csvData, clinic_id } = req.body;
    
    if (!csvData) {
      return res.status(400).json({ error: 'CSV data is required' });
    }

    console.log('Starting bulk upload for clinic:', clinic_id);
    
    // Parse CSV data
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV file is empty or invalid' });
    }

    // Parse header
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    console.log('CSV headers:', headers);

    // Group rows by test_code
    const testGroups = {};
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Parse CSV line (handle quoted fields)
      const values = [];
      let currentValue = '';
      let inQuotes = false;
      
      for (let char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim());

      // Create object from headers and values
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });

      const testCode = row.test_code?.toUpperCase();
      if (!testCode) continue;

      if (!testGroups[testCode]) {
        testGroups[testCode] = {
          test_code: testCode,
          test_name: row.test_name,
          category: row.category,
          price: parseFloat(row.price) || 0,
          service_name: row.service_name || '',
          components: []
        };
      }

      // Accept both column name variants from the export template
      const compName = row.component_name || row.component || '';
      const refRange = row.reference_range || row.reference || '';
      const dispOrder = parseInt(row.display_order || row.display_order) || testGroups[testCode].components.length + 1;

      if (compName) {
        testGroups[testCode].components.push({
          component_name: compName,
          unit: row.unit || '',
          reference_range: refRange,
          display_order: dispOrder
        });
      }
    }

    console.log('Parsed test groups:', Object.keys(testGroups).length);

    let created = 0;
    let updated = 0;
    let componentsCreated = 0;

    // Process each test
    for (const [testCode, testData] of Object.entries(testGroups)) {
      try {
        const testId = uuidv4();

        // Resolve service_name → service_id if provided
        let serviceId = null;
        if (testData.service_name) {
          const [svcRows] = await sequelize.query(
            `SELECT id FROM services WHERE LOWER(service_name) = LOWER(?) AND clinic_id = ? LIMIT 1`,
            { replacements: [testData.service_name, clinic_id || 1] }
          );
          if (svcRows.length > 0) serviceId = svcRows[0].id;
        }
        
        // Check if test exists
        const [existing] = await sequelize.query(
          'SELECT id FROM lab_tests WHERE test_code = ? AND clinic_id = ?',
          { replacements: [testCode, clinic_id || 1] }
        );

        let finalTestId;

        if (existing.length > 0) {
          // Update existing test (also update service_id if resolved)
          finalTestId = existing[0].id;
          await sequelize.query(`
            UPDATE lab_tests 
            SET test_name = ?, category = ?, price = ?,
                service_id = COALESCE(?, service_id),
                updated_at = NOW()
            WHERE id = ?
          `, {
            replacements: [testData.test_name, testData.category, testData.price, serviceId, finalTestId]
          });
          updated++;
          console.log(`Updated test: ${testCode}`);
        } else {
          // Create new test
          finalTestId = testId;
          await sequelize.query(`
            INSERT INTO lab_tests (id, test_code, test_name, category, price, service_id, clinic_id, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, true, NOW(), NOW())
          `, {
            replacements: [testId, testCode, testData.test_name, testData.category, testData.price, serviceId, clinic_id || 1]
          });
          created++;
          console.log(`Created test: ${testCode}`);
        }

        // Delete existing components then re-insert from CSV
        await sequelize.query(
          'DELETE FROM lab_test_components WHERE lab_test_id = ?',
          { replacements: [finalTestId] }
        );

        // Insert components
        for (const component of testData.components) {
          const componentId = uuidv4();
          await sequelize.query(`
            INSERT INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, display_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
          `, {
            replacements: [
              componentId,
              finalTestId,
              component.component_name,
              component.unit || '',
              component.reference_range || '',
              component.display_order
            ]
          });
          componentsCreated++;
        }

      } catch (error) {
        console.error(`Error processing test ${testCode}:`, error);
        // Continue with next test
      }
    }

    console.log(`Bulk upload complete: ${created} created, ${updated} updated, ${componentsCreated} components`);

    res.json({
      message: 'Bulk upload completed',
      created,
      updated,
      componentsCreated,
      total: created + updated
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ error: 'Failed to process bulk upload', details: error.message });
  }
});

// Seed the curated common lab-test catalog (see scripts/labTestsSeedData.js) —
// each test gets a linked Service (found by name, or created on the spot if
// missing) and one component matching the test itself. Safely re-runnable.
router.post('/seed-common', authorize(['admin']), async (req, res) => {
  try {
    const { clinic_id } = req.body;
    if (!clinic_id) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }
    const { seedCommonLabTests } = require('../scripts/seedCommonLabTests');
    const result = await seedCommonLabTests(parseInt(clinic_id), req.user?.id, { LabTest, Service, resolveRevenueAccount });
    res.status(201).json(result);
  } catch (error) {
    console.error('Error seeding common lab tests:', error);
    res.status(500).json({ error: 'Failed to seed lab tests', details: error.message });
  }
});

module.exports = router;
