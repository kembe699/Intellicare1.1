const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');

async function createTestLabRequest() {
  try {
    console.log('Creating test lab request...');
    
    // First, get existing patient, visit, and user from the database
    const [patients] = await sequelize.query(`
      SELECT id FROM patients LIMIT 1
    `);
    
    if (patients.length === 0) {
      console.log('❌ No patients found in database. Please add a patient first.');
      return;
    }
    
    const [visits] = await sequelize.query(`
      SELECT id FROM visits LIMIT 1
    `);
    
    if (visits.length === 0) {
      console.log('❌ No visits found in database. Please create a visit first.');
      return;
    }
    
    const [users] = await sequelize.query(`
      SELECT id FROM users LIMIT 1
    `);
    
    if (users.length === 0) {
      console.log('❌ No users found in database. Please add a user first.');
      return;
    }
    
    const requestId = uuidv4();
    const testPatientId = patients[0].id; // Use real patient ID
    const testVisitId = visits[0].id; // Use real visit ID
    const testUserId = users[0].id; // Use real user ID
    
    console.log('Using patient ID:', testPatientId);
    console.log('Using visit ID:', testVisitId);
    console.log('Using user ID:', testUserId);
    
    const insertQuery = `
      INSERT INTO lab_requests (
        id, patient_id, visit_id, test_code, test_name, status, 
        priority, requested_by, clinic_id, notes, requested_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    
    const replacements = [
      requestId,
      testPatientId,
      testVisitId,
      'ICT',
      'ICT for Malaria',
      'pending',
      'normal',
      testUserId, // Use real user ID for requested_by
      1,
      'Test lab request created by script'
    ];
    
    console.log('Executing SQL query:', insertQuery);
    console.log('With replacements:', replacements);
    
    await sequelize.query(insertQuery, { replacements });
    
    console.log('✅ Lab request created successfully!');
    console.log('Request ID:', requestId);
    console.log('Patient ID:', testPatientId);
    console.log('Test Name: ICT for Malaria');
    
    // Verify the insertion by querying the record
    const [results] = await sequelize.query(`
      SELECT * FROM lab_requests WHERE id = ?
    `, {
      replacements: [requestId]
    });
    
    if (results.length > 0) {
      console.log('✅ Verified: Lab request found in database');
      console.log('Record:', results[0]);
    } else {
      console.log('❌ Error: Lab request not found in database');
    }
    
  } catch (error) {
    console.error('❌ Error creating lab request:', error);
    console.error('Error details:', error.message);
    console.error('SQL State:', error.sqlState);
    console.error('Error Number:', error.errno);
  } finally {
    process.exit(0);
  }
}

// Run the test
createTestLabRequest();
