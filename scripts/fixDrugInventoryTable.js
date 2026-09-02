const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function fixDrugInventoryTable() {
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
      "ALTER TABLE drug_inventory ADD COLUMN IF NOT EXISTS generic_name VARCHAR(255)",
      "ALTER TABLE drug_inventory ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(255)",
      "ALTER TABLE drug_inventory ADD COLUMN IF NOT EXISTS unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00",
      "ALTER TABLE drug_inventory ADD COLUMN IF NOT EXISTS notes TEXT",
      "ALTER TABLE drug_inventory ADD COLUMN IF NOT EXISTS status ENUM('active', 'inactive', 'expired') DEFAULT 'active'",
      "ALTER TABLE drug_inventory ADD COLUMN IF NOT EXISTS createdAt DATETIME DEFAULT CURRENT_TIMESTAMP",
      "ALTER TABLE drug_inventory ADD COLUMN IF NOT EXISTS updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      "ALTER TABLE drug_inventory MODIFY COLUMN unit_of_measure VARCHAR(100)",
      "ALTER TABLE drug_inventory ADD COLUMN IF NOT EXISTS unit_type VARCHAR(100)"
    ];

    for (const query of alterQueries) {
      try {
        await connection.execute(query);
        console.log('✅ Executed:', query.substring(0, 50) + '...');
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log('⚠️ Column already exists:', query.substring(0, 50) + '...');
        } else {
          console.error('❌ Error executing:', query, error.message);
        }
      }
    }

    // Update unit_type from unit_of_measure if needed
    try {
      await connection.execute(`
        UPDATE drug_inventory 
        SET unit_type = unit_of_measure 
        WHERE unit_type IS NULL AND unit_of_measure IS NOT NULL
      `);
      console.log('✅ Updated unit_type from unit_of_measure');
    } catch (error) {
      console.log('⚠️ Could not update unit_type:', error.message);
    }

    // Verify table structure
    console.log('Verifying updated table structure...');
    const [rows] = await connection.execute('DESCRIBE drug_inventory;');
    console.log('Updated table structure:');
    console.table(rows);
    
    console.log('✅ Drug inventory table fixed successfully!');
    
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
fixDrugInventoryTable();
