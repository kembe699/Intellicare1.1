const { Sequelize } = require('sequelize');
const dns = require('dns');
require('dotenv').config();

// Try with Google DNS
dns.setServers(['8.8.8.8', '8.8.4.4']);

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
    console.log('🔄 Testing Supabase connection with Google DNS...');
    
    // First test DNS resolution
    const dns = require('dns').promises;
    try {
      const addresses = await dns.lookup('db.kedsqdzfualtjrnthipe.supabase.co');
      console.log('✅ DNS resolved:', addresses);
    } catch (dnsError) {
      console.log('❌ DNS resolution failed:', dnsError.message);
      return;
    }
    
    await sequelize.authenticate();
    console.log('✅ Database connection successful!');
    
    // Test a simple query
    const [results] = await sequelize.query('SELECT version();');
    console.log('📊 PostgreSQL version:', results[0].version);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.log('💡 Try running the migration in Supabase dashboard first');
    process.exit(1);
  }
}

testConnection();
