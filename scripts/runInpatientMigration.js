// Manual script to run inpatient migration
require('dotenv').config();
const { migrateInpatientTables } = require('./migrateInpatientTables');

console.log('Starting inpatient migration...\n');

migrateInpatientTables()
  .then(() => {
    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
