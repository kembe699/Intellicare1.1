const { sequelize } = require('../models');

async function createClinic1() {
  try {
    await sequelize.authenticate();
    console.log('Connection to the database has been established successfully.');

    // Insert clinic with ID 1
    await sequelize.query(`
      INSERT IGNORE INTO clinic_names (id, name, created_at, updated_at) 
      VALUES (1, 'IntelliCare - Main Clinic', NOW(), NOW())
    `);
    
    console.log('Created clinic with ID 1: IntelliCare - Main Clinic');
    
    // Verify it was created
    const [clinics] = await sequelize.query('SELECT * FROM clinic_names WHERE id = 1');
    console.log('Clinic 1 details:', clinics[0]);
    
  } catch (error) {
    console.error('Error creating clinic 1:', error);
  } finally {
    await sequelize.close();
  }
}

createClinic1();
