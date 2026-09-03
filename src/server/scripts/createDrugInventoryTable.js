const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function createDrugInventoryTable() {
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

    // Create drug_inventory table
    console.log('Creating drug_inventory table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS drug_inventory (
        id VARCHAR(36) PRIMARY KEY,
        drug_name VARCHAR(255) NOT NULL,
        generic_name VARCHAR(255),
        manufacturer VARCHAR(255),
        batch_number VARCHAR(255),
        expiry_date DATE NOT NULL,
        current_stock INTEGER NOT NULL DEFAULT 0,
        unit_type VARCHAR(100) NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        reorder_level INTEGER NOT NULL DEFAULT 10,
        clinic_id INTEGER NOT NULL,
        date_received DATE NOT NULL,
        received_by VARCHAR(255) NOT NULL,
        notes TEXT,
        status ENUM('active', 'inactive', 'expired') DEFAULT 'active',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_clinic_id (clinic_id),
        INDEX idx_drug_name (drug_name),
        INDEX idx_expiry_date (expiry_date)
      );
    `);
    
    console.log('✅ drug_inventory table created successfully.');

    // Verify table structure
    console.log('Verifying table structure...');
    const [rows] = await connection.execute('DESCRIBE drug_inventory;');
    console.log('Table structure:');
    console.table(rows);
    
    console.log('✅ Drug inventory table setup completed!');
    
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
createDrugInventoryTable();
