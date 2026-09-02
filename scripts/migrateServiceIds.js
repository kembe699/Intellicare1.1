const { LabTest, sequelize } = require('../models');

async function migrateServiceIds() {
  try {
    console.log('Starting service_id migration...');
    
    // Get all lab tests with integer service_ids
    const [labTests] = await sequelize.query(`
      SELECT id, service_id FROM lab_tests 
      WHERE service_id IS NOT NULL 
      AND service_id REGEXP '^[0-9]+$'
    `);
    
    console.log(`Found ${labTests.length} lab tests with integer service_ids`);
    
    // Get all services to create mapping
    const [services] = await sequelize.query(`
      SELECT id, service_name FROM services ORDER BY id
    `);
    
    console.log(`Found ${services.length} services`);
    
    if (services.length === 0) {
      console.log('No services found. Exiting.');
      return;
    }
    
    // Create mapping from integer index to UUID
    const serviceMapping = {};
    services.forEach((service, index) => {
      // Map 1-based integers to service UUIDs (assuming 1=first service, 2=second, etc.)
      serviceMapping[index + 1] = service.id;
      console.log(`Mapping service ${index + 1} -> ${service.id} (${service.service_name})`);
    });
    
    // Update each lab test
    for (const labTest of labTests) {
      const oldServiceId = parseInt(labTest.service_id);
      const newServiceId = serviceMapping[oldServiceId];
      
      if (newServiceId) {
        await sequelize.query(`
          UPDATE lab_tests 
          SET service_id = ? 
          WHERE id = ?
        `, {
          replacements: [newServiceId, labTest.id]
        });
        
        console.log(`Updated lab test ${labTest.id}: service_id ${oldServiceId} -> ${newServiceId}`);
      } else {
        console.log(`No mapping found for service_id ${oldServiceId} in lab test ${labTest.id}`);
        
        // Set to null if no mapping found
        await sequelize.query(`
          UPDATE lab_tests 
          SET service_id = NULL 
          WHERE id = ?
        `, {
          replacements: [labTest.id]
        });
        
        console.log(`Set service_id to NULL for lab test ${labTest.id}`);
      }
    }
    
    console.log('Service ID migration completed successfully!');
    
  } catch (error) {
    console.error('Error during migration:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateServiceIds()
    .then(() => {
      console.log('Migration finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = migrateServiceIds;
