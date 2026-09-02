const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function addMissingColumns() {
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

    // Add missing columns to drug_inventory table
    console.log('Adding missing columns to drug_inventory table...');
    
    const alterQueries = [
      "ALTER TABLE drug_inventory ADD COLUMN generic_name VARCHAR(255) AFTER drug_name",
      "ALTER TABLE drug_inventory ADD COLUMN manufacturer VARCHAR(255) AFTER generic_name",
      "ALTER TABLE drug_inventory ADD COLUMN unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER current_stock",
      "ALTER TABLE drug_inventory ADD COLUMN notes TEXT AFTER unit_price",
      "ALTER TABLE drug_inventory ADD COLUMN status ENUM('active', 'inactive', 'expired') DEFAULT 'active' AFTER notes"
    ];

    for (const query of alterQueries) {
      try {
        await connection.execute(query);
        console.log('✅ Added column:', query.split('ADD COLUMN ')[1].split(' ')[0]);
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log('⚠️ Column already exists:', query.split('ADD COLUMN ')[1].split(' ')[0]);
        } else {
          console.error('❌ Error adding column:', error.message);
        }
      }
    }

    // Verify table structure
    console.log('Verifying updated table structure...');
    const [rows] = await connection.execute('DESCRIBE drug_inventory;');
    console.log('Updated table structure:');
    console.table(rows);
    
    console.log('✅ Missing columns added successfully!');
    
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
addMissingColumns();
