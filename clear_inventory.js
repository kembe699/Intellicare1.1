require('dotenv').config();
const sequelize = require('./src/server/config/database');

async function clearInventory() {
  try {
    console.log('🗑️  Clearing all inventory items...');
    
    const [result] = await sequelize.query(`
      DELETE FROM inventory_items WHERE clinic_id = 1;
    `);
    
    console.log(`✅ Successfully deleted all inventory items for clinic_id = 1`);
    console.log(`   Rows affected: ${result.rowCount || 0}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing inventory:', error.message);
    process.exit(1);
  }
}

clearInventory();
