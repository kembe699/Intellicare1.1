// Simple script to clear all inventory items from the database
// Run with: node clear_inventory_items.js

const { Client } = require('pg');

// Parse connection string from environment or use default
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/intellicare_db';

async function clearInventory() {
  const client = new Client({ connectionString });
  
  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully');
    
    console.log('🗑️  Deleting all inventory items for clinic_id = 1...');
    const result = await client.query('DELETE FROM inventory_items WHERE clinic_id = 1');
    
    console.log(`✅ Successfully deleted ${result.rowCount} inventory items`);
    console.log('✨ Inventory cleared! You can now upload fresh items.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\n💡 Tip: Make sure your DATABASE_URL is set correctly');
    console.error('   You can set it like: export DATABASE_URL="postgresql://user:pass@host:port/dbname"');
  } finally {
    await client.end();
  }
}

clearInventory();
