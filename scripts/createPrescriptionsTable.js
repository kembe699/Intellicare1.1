const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config({ path: '../.env' });

// Create Sequelize instance using environment variables
const sequelize = new Sequelize(
  process.env.DB_NAME || 'intellicare_db',
  process.env.DB_USER || 'root', 
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: console.log
  }
);

async function createPrescriptionsTable() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    console.log('🔄 Creating prescriptions table...');
    
    // Create prescriptions table without foreign key constraints
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS prescriptions (
        id VARCHAR(36) PRIMARY KEY,
        visit_id VARCHAR(36) NOT NULL,
        patient_id VARCHAR(36) NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        medication_name VARCHAR(255) NOT NULL,
        take_instructions VARCHAR(100) NOT NULL,
        frequency VARCHAR(100) NOT NULL,
        duration VARCHAR(100) NOT NULL,
        instructions TEXT,
        quantity VARCHAR(50) NOT NULL,
        prescribed_by VARCHAR(255) NOT NULL,
        prescribed_at DATETIME NOT NULL,
        clinic_id INT NOT NULL,
        status ENUM('active', 'completed', 'cancelled') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        INDEX idx_visit_id (visit_id),
        INDEX idx_patient_id (patient_id),
        INDEX idx_clinic_id (clinic_id),
        INDEX idx_status (status),
        INDEX idx_prescribed_at (prescribed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('✅ Prescriptions table created successfully!');

    // Verify table structure
    const [results] = await sequelize.query('DESCRIBE prescriptions');
    console.log('\n📋 Prescriptions table structure:');
    results.forEach(column => {
      console.log(`  ${column.Field}: ${column.Type} ${column.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${column.Key ? `(${column.Key})` : ''}`);
    });

  } catch (error) {
    console.error('❌ Error creating prescriptions table:', error);
  } finally {
    await sequelize.close();
    console.log('🔌 Database connection closed.');
  }
}

// Run the script
createPrescriptionsTable();
