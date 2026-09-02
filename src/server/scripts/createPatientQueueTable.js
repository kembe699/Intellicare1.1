const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function createPatientQueueTable() {
  let connection;
  
  try {
    // Create direct MySQL connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'intellicare_db',
    });

    console.log('Connected to MySQL database');

    // Drop existing table if it exists (to recreate with correct schema)
    await connection.execute('DROP TABLE IF EXISTS patient_queue');
    console.log('Dropped existing patient_queue table if it existed');

    // Create patient_queue table with correct schema
    const createTableSQL = `
      CREATE TABLE patient_queue (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        patient_id VARCHAR(255) NOT NULL,
        patient_doc_id VARCHAR(36) NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        age INT NOT NULL,
        clinic_id INT NOT NULL,
        doctor VARCHAR(255) NOT NULL,
        priority ENUM('normal', 'urgent', 'emergency') DEFAULT 'normal',
        notes TEXT,
        status ENUM('waiting', 'in_progress', 'completed', 'cancelled') DEFAULT 'waiting',
        queued_by VARCHAR(255) NOT NULL,
        queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;

    await connection.execute(createTableSQL);
    console.log('✅ Created patient_queue table successfully');

    // Verify table structure
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'patient_queue'
      ORDER BY ORDINAL_POSITION
    `, [process.env.DB_NAME || 'intellicare_db']);

    console.log('📊 Table structure:');
    columns.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME}: ${col.DATA_TYPE} ${col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

createPatientQueueTable();
