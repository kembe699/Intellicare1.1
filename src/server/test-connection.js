const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  logging: console.log
});

async function testConnection() {
  try {
    console.log('🔄 Testing Supabase connection...');
    await sequelize.authenticate();
    console.log('✅ Connection successful!');
    
    // Test a simple query
    const [results] = await sequelize.query('SELECT version();');
    console.log('📊 PostgreSQL version:', results[0].version);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.log('💡 DNS may still be propagating. Try again in 5-10 minutes.');
    process.exit(1);
  }
}

testConnection();
