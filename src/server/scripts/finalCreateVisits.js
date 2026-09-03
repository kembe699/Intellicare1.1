const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function finalCreateVisitsTable() {
  let connection;
  
  try {
    console.log('Connecting to MySQL database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'intellicare_db'
    });
    
    console.log('✅ Connected to database successfully.');

    // Disable foreign key checks
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0;');
    
    // Drop ALL tables that might reference visits
    console.log('Dropping ALL potentially conflicting tables...');
    const allTables = [
      'pharmacy_dispensing', 'lab_results', 'diagnoses', 'lab_requests', 
      'prescriptions', 'vitals', 'visits', 'patient_vitals', 'visit_diagnoses',
      'visit_prescriptions', 'visit_lab_requests'
    ];
    
    for (const table of allTables) {
      try {
        await connection.execute(`DROP TABLE IF EXISTS ${table};`);
        console.log(`✅ Dropped table: ${table}`);
      } catch (error) {
        console.log(`Note: Table ${table} did not exist or could not be dropped`);
      }
    }

    // Create visits table with completely clean structure
    console.log('Creating visits table...');
    const createTableSQL = `
      CREATE TABLE visits (
        id VARCHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        clinic_id INT NOT NULL,
        date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        chief_complaints TEXT,
        clinical_notes TEXT,
        doctor_id VARCHAR(255) NOT NULL,
        doctor_name VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        vitals TEXT,
        lab_requests TEXT,
        diagnosis VARCHAR(255),
        diagnosis_code VARCHAR(100),
        closed_at DATETIME NULL,
        closed_by VARCHAR(255) NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await connection.execute(createTableSQL);
    console.log('✅ Visits table created successfully.');

    // Re-enable foreign key checks
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1;');

    // Test insert to make sure it works
    console.log('Testing table with sample insert...');
    const testId = 'test-' + Date.now();
    await connection.execute(`
      INSERT INTO visits (
        id, patient_id, patient_name, clinic_id, doctor_id, doctor_name, 
        chief_complaints, clinical_notes, vitals, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      testId, 'patient-123', 'Test Patient', 1, 'doctor-123', 'Test Doctor',
      'Test complaint', 'Test notes', '{"pulse": "80"}', 'active'
    ]);
    
    console.log('✅ Test insert successful.');
    
    // Clean up test data
    await connection.execute('DELETE FROM visits WHERE id = ?', [testId]);
    console.log('✅ Test data cleaned up.');

    // Verify table structure
    console.log('Verifying table structure...');
    const [rows] = await connection.execute('DESCRIBE visits;');
    console.log('Table structure:');
    console.table(rows);
    
    console.log('✅ Visits table setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed.');
    }
  }
}

// Run the script
finalCreateVisitsTable();
