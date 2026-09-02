const { Sequelize, DataTypes } = require('sequelize');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Create Sequelize instance
const sequelize = new Sequelize(
  process.env.DB_NAME || 'intellicare_db',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    dialect: 'mysql',
    logging: console.log,
  }
);

async function createVisitsTable() {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    // Drop foreign key constraints first, then drop visits table if it exists
    console.log('Dropping foreign key constraints and existing visits table if it exists...');
    try {
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');
      await sequelize.query('DROP TABLE IF EXISTS vitals;');
      await sequelize.query('DROP TABLE IF EXISTS visits;');
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
      console.log('✅ Existing tables dropped.');
    } catch (error) {
      console.log('Note: Error dropping tables:', error.message);
    }

    // Create visits table with correct schema (without foreign key constraints)
    console.log('Creating visits table...');
    await sequelize.query(`
      CREATE TABLE visits (
        id VARCHAR(36) PRIMARY KEY,
        patient_id VARCHAR(36) NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        clinic_id INT NOT NULL,
        date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        chief_complaints TEXT,
        clinical_notes TEXT,
        doctor_id VARCHAR(255) NOT NULL,
        doctor_name VARCHAR(255) NOT NULL,
        status ENUM('active', 'inactive', 'completed') DEFAULT 'active',
        vitals JSON,
        lab_requests JSON,
        diagnosis VARCHAR(255),
        diagnosis_code VARCHAR(100),
        closed_at DATETIME NULL,
        closed_by VARCHAR(255) NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    
    // Add indexes separately
    console.log('Adding indexes...');
    await sequelize.query('CREATE INDEX idx_patient_id ON visits (patient_id);');
    await sequelize.query('CREATE INDEX idx_clinic_id ON visits (clinic_id);');
    await sequelize.query('CREATE INDEX idx_doctor_id ON visits (doctor_id);');
    await sequelize.query('CREATE INDEX idx_date ON visits (date);');
    await sequelize.query('CREATE INDEX idx_status ON visits (status);');
    
    console.log('✅ Visits table created successfully with proper schema.');
    
    // Verify table structure
    console.log('Verifying table structure...');
    const [results] = await sequelize.query('DESCRIBE visits;');
    console.log('Table structure:');
    console.table(results);
    
    console.log('✅ Visits table setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error setting up visits table:', error);
  } finally {
    await sequelize.close();
    console.log('Database connection closed.');
  }
}

// Run the script
createVisitsTable();
