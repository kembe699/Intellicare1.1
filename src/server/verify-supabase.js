require('dotenv').config();
const { Sequelize } = require('sequelize');
const dns = require('dns').promises;
const net = require('net');

async function verifyConnection() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 SUPABASE CONNECTION VERIFICATION');
  console.log('='.repeat(60) + '\n');

  // 1. Environment Variables
  console.log('1️⃣  Environment Variables:');
  console.log('-'.repeat(60));
  const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  for (const key of required) {
    const val = process.env[key];
    if (val) {
      console.log(`✅ ${key.padEnd(20)}: ${val.substring(0, 40)}...`);
    } else {
      console.log(`❌ ${key.padEnd(20)}: NOT SET`);
    }
  }

  // 2. Parse URL
  console.log('\n2️⃣  Connection String Analysis:');
  console.log('-'.repeat(60));
  try {
    const url = new URL(process.env.DATABASE_URL);
    console.log(`   Protocol : ${url.protocol.replace(':', '')}`);
    console.log(`   Host     : ${url.hostname}`);
    console.log(`   Port     : ${url.port}`);
    console.log(`   Database : ${url.pathname.replace('/', '')}`);
    console.log(`   Username : ${url.username}`);
  } catch (e) {
    console.log(`❌ Invalid DATABASE_URL: ${e.message}`);
    return;
  }

  // 3. DNS Resolution
  console.log('\n3️⃣  DNS Resolution:');
  console.log('-'.repeat(60));
  const host = new URL(process.env.DATABASE_URL).hostname;
  try {
    const addrs = await dns.resolve4(host);
    console.log(`✅ IPv4 resolved: ${addrs.join(', ')}`);
  } catch (e) {
    console.log(`❌ IPv4 (A) failed: ${e.message}`);
  }
  try {
    const addrs = await dns.resolve6(host);
    console.log(`✅ IPv6 resolved: ${addrs[0]}`);
  } catch (e) {
    console.log(`❌ IPv6 (AAAA) failed: ${e.message}`);
  }

  // 4. TCP Port Check
  console.log('\n4️⃣  TCP Port Connectivity:');
  console.log('-'.repeat(60));
  const port = parseInt(new URL(process.env.DATABASE_URL).port);
  await new Promise(resolve => {
    const s = net.createConnection({ host, port, timeout: 6000 });
    s.on('connect', () => { console.log(`✅ TCP port ${port} open`); s.destroy(); resolve(); });
    s.on('timeout', () => { console.log(`❌ TCP timeout on port ${port}`); s.destroy(); resolve(); });
    s.on('error', e => { console.log(`❌ TCP error: ${e.message}`); resolve(); });
  });

  // 5. Sequelize Connection
  console.log('\n5️⃣  Sequelize Authentication:');
  console.log('-'.repeat(60));
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    logging: false,
    pool: { max: 2, min: 0, acquire: 15000, idle: 5000 }
  });
  try {
    console.log('⏳ Connecting...');
    await sequelize.authenticate();
    console.log('✅ Sequelize connected!');
    const [[row]] = await sequelize.query('SELECT version()');
    console.log(`✅ PostgreSQL: ${row.version.substring(0, 50)}`);
    await sequelize.close();
  } catch (e) {
    console.log(`❌ Sequelize failed: ${e.message}`);
    if (e.message.includes('Tenant or user not found')) {
      console.log('\n⚠️  ROOT CAUSE: Supabase connection pooler (Supavisor)');
      console.log('   has not registered this project tenant yet.');
      console.log('   This happens with brand-new projects.');
      console.log('\n   FIX: Go to Supabase Dashboard → Settings → Database');
      console.log('   → Reset Database Password (click "Generate new password")');
      console.log('   → Copy the new password and update .env DB_PASSWORD');
      console.log('   → This triggers Supavisor to register the tenant.');
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

verifyConnection().catch(console.error);
