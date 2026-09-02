const mysql = require('mysql2/promise');
require('dotenv').config();

async function addCostPriceColumns() {
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

    // Check if columns already exist
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'drug_inventory' 
      AND COLUMN_NAME IN ('unit_cost', 'selling_price')
    `, [process.env.DB_NAME || 'intellicare_db']);

    const existingColumns = columns.map(col => col.COLUMN_NAME);

    // Add unit_cost column if it doesn't exist
    if (!existingColumns.includes('unit_cost')) {
      await connection.execute(`
        ALTER TABLE drug_inventory 
        ADD COLUMN unit_cost DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Cost per unit of the drug'
      `);
      console.log('✅ Added unit_cost column to drug_inventory table');
    } else {
      console.log('unit_cost column already exists');
    }

    // Add selling_price column if it doesn't exist
    if (!existingColumns.includes('selling_price')) {
      await connection.execute(`
        ALTER TABLE drug_inventory 
        ADD COLUMN selling_price DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Selling price per unit of the drug'
      `);
      console.log('✅ Added selling_price column to drug_inventory table');
    } else {
      console.log('selling_price column already exists');
    }

    console.log('✅ Database schema updated successfully');

  } catch (error) {
    console.error('❌ Error updating database schema:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

// Run the migration
addCostPriceColumns()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
