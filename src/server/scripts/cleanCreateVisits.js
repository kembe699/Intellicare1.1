const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function cleanCreateVisitsTable() {
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
    
    // Drop all related tables that might have foreign keys to visits
    console.log('Dropping all related tables...');
    const tablesToDrop = ['diagnoses', 'lab_requests', 'prescriptions', 'vitals', 'visits'];
    
    for (const table of tablesToDrop) {
      try {
        await connection.execute(`DROP TABLE IF EXISTS ${table};`);
        console.log(`✅ Dropped table: ${table}`);
      } catch (error) {
        console.log(`Note: Could not drop table ${table}: ${error.message}`);
      }
    }

    // Create visits table with simple structure
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

    // Verify table structure
    console.log('Verifying table structure...');
    const [rows] = await connection.execute('DESCRIBE visits;');
    console.log('Table structure:');
    console.table(rows);
    
    console.log('✅ Visits table setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed.');
    }
  }
}

// Run the script
cleanCreateVisitsTable();
