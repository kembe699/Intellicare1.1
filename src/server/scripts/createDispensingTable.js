const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function createDispensingTable() {
  let connection;
  
  try {
    // Create database connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'intellicare_db'
    });

    console.log('Connected to MySQL database');

    // Check if table exists
    const [rows] = await connection.execute(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = ? AND table_name = 'pharmacy_dispensing'
    `, [process.env.DB_NAME || 'intellicare_db']);

    if (rows[0].count > 0) {
      console.log('pharmacy_dispensing table already exists');
      return;
    }

    console.log('Creating pharmacy_dispensing table...');

    // Create the pharmacy_dispensing table
    await connection.execute(`
      CREATE TABLE pharmacy_dispensing (
        id VARCHAR(36) PRIMARY KEY,
        drug_id VARCHAR(36) NOT NULL,
        drug_name VARCHAR(255) NOT NULL,
        patient_id VARCHAR(255) NULL,
        patient_name VARCHAR(255) NOT NULL,
        visit_id VARCHAR(36) NULL,
        quantity INT NOT NULL,
        unit_of_measure VARCHAR(50) NULL,
        prescribed_by VARCHAR(255) NULL,
        dispensed_by VARCHAR(255) NOT NULL,
        clinic_id INT NOT NULL,
        dispensed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        notes TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        INDEX idx_clinic_id (clinic_id),
        INDEX idx_patient_id (patient_id),
        INDEX idx_drug_id (drug_id),
        INDEX idx_dispensed_at (dispensed_at),
        INDEX idx_drug_name (drug_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ pharmacy_dispensing table created successfully');

    // Verify table was created
    const [verifyRows] = await connection.execute(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = ? AND table_name = 'pharmacy_dispensing'
    `, [process.env.DB_NAME || 'intellicare_db']);

    if (verifyRows[0].count > 0) {
      console.log('✅ Table creation verified');
      
      // Show table structure
      const [structure] = await connection.execute('DESCRIBE pharmacy_dispensing');
      console.log('Table structure:');
      console.table(structure);
    } else {
      console.error('❌ Table creation failed - table not found after creation');
    }

  } catch (error) {
    console.error('Error creating pharmacy_dispensing table:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

// Run the script
if (require.main === module) {
  createDispensingTable()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = createDispensingTable;
