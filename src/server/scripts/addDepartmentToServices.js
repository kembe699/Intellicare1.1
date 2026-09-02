const { sequelize } = require('../models');

async function addDepartmentToServices() {
  console.log('\n=== Adding Department to Services ===\n');

  try {
    // Add department_id column to services table
    console.log('1. Adding department_id column to services table...');
    await sequelize.query(`
      ALTER TABLE services 
      ADD COLUMN IF NOT EXISTS department_id VARCHAR(36)
    `);
    console.log('  ✅ department_id column added');

    // Create index for department_id
    console.log('2. Creating index on department_id...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_services_department ON services(department_id)
    `);
    console.log('  ✅ index created');

    // Add foreign key constraint (optional - commented out as it might fail if departments don't exist)
    // console.log('3. Adding foreign key constraint...');
    // await sequelize.query(`
    //   ALTER TABLE services 
    //   ADD CONSTRAINT fk_services_department 
    //   FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
    // `);
    // console.log('  ✅ foreign key constraint added');

    console.log('\n=== Migration Complete ===\n');
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  addDepartmentToServices()
    .then(() => {
      console.log('✅ Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addDepartmentToServices;
