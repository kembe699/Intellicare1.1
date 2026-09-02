const { sequelize } = require('./server/models');

async function checkVisitsTable() {
  try {
    console.log('\n=== Checking visits table structure ===\n');
    
    const [columns] = await sequelize.query(`
      DESCRIBE visits
    `);
    
    console.log('Visits table columns:');
    columns.forEach(col => {
      console.log(`  - ${col.Field} (${col.Type})`);
    });
    
    // Check if there are any visits
    const [count] = await sequelize.query('SELECT COUNT(*) as total FROM visits');
    console.log(`\nTotal visits in database: ${count[0].total}`);
    
    if (count[0].total > 0) {
      const [sample] = await sequelize.query('SELECT * FROM visits LIMIT 1');
      console.log('\nSample visit record:');
      console.log(JSON.stringify(sample[0], null, 2));
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

checkVisitsTable();
