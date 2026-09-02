const { sequelize } = require('../models');

async function createDefaultClinics() {
  try {
    // Check if clinics exist
    const [results] = await sequelize.query('SELECT COUNT(*) as count FROM clinic_names');
    console.log('Current clinic count:', results[0].count);
    
    if (results[0].count === 0) {
      console.log('No clinics found. Creating default clinics...');
      
      // Insert default clinics
      await sequelize.query(`
        INSERT INTO clinic_names (name, created_at) VALUES 
        ('General Medicine', NOW()),
        ('Emergency', NOW()),
        ('Pediatrics', NOW()),
        ('Surgery', NOW()),
        ('Laboratory', NOW())
      `);
      
      console.log('Default clinics created successfully');
    }
    
    // Show all available clinics
    const [clinics] = await sequelize.query('SELECT id, name FROM clinic_names ORDER BY id');
    console.log('Available clinics:');
    clinics.forEach(clinic => {
      console.log(`ID: ${clinic.id}, Name: ${clinic.name}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await sequelize.close();
  }
}

createDefaultClinics();
