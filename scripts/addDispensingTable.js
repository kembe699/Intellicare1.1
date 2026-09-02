const { sequelize } = require('../models');

async function addDispensingTable() {
  try {
    console.log('Creating pharmacy_dispensing table...');
    
    // Create pharmacy_dispensing table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS pharmacy_dispensing (
        id VARCHAR(36) PRIMARY KEY,
        drug_id VARCHAR(36) NOT NULL,
        drug_name VARCHAR(255) NOT NULL,
        patient_id VARCHAR(255),
        patient_name VARCHAR(255) NOT NULL,
        visit_id VARCHAR(36),
        quantity INT NOT NULL,
        unit_of_measure VARCHAR(50),
        prescribed_by VARCHAR(255),
        dispensed_by VARCHAR(255) NOT NULL,
        clinic_id INT NOT NULL,
        dispensed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_clinic_id (clinic_id),
        INDEX idx_patient_id (patient_id),
        INDEX idx_drug_id (drug_id),
        INDEX idx_dispensed_at (dispensed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    
    console.log('✅ pharmacy_dispensing table created successfully');
    
  } catch (error) {
    if (error.original?.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('pharmacy_dispensing table already exists');
    } else {
      console.error('Error creating pharmacy_dispensing table:', error);
      throw error;
    }
  }
}

// Run the migration
if (require.main === module) {
  addDispensingTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addDispensingTable;
