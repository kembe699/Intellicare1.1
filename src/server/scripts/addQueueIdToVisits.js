const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function addQueueIdToVisits() {
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

    // Add queue_id column to visits table
    console.log('Adding queue_id column to visits table...');
    try {
      await connection.execute(`
        ALTER TABLE visits 
        ADD COLUMN queue_id VARCHAR(36) NULL,
        ADD INDEX idx_queue_id (queue_id);
      `);
      console.log('✅ queue_id column added successfully.');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('✅ queue_id column already exists.');
      } else {
        throw error;
      }
    }

    // Verify table structure
    console.log('Verifying table structure...');
    const [rows] = await connection.execute('DESCRIBE visits;');
    console.log('Table structure:');
    console.table(rows);
    
    console.log('✅ Visits table updated successfully!');
    
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
addQueueIdToVisits();
