require('dotenv').config();
const bcrypt = require('bcrypt');
const { Sequelize } = require('sequelize');

const seq = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false
});

async function createAdminUser() {
  try {
    await seq.authenticate();
    console.log('✅ Connected to database');

    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!seedPassword) throw new Error('Set SEED_ADMIN_PASSWORD to seed an admin account');
    const hash = await bcrypt.hash(seedPassword, 12);

    const [rows] = await seq.query(
      `INSERT INTO users (id, email, password_hash, display_name, role, clinic_id, status, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), 'kembe699@gmail.com', :hash, 'Admin Kembe', 'admin', 1, 'active', true, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE
         SET password_hash  = EXCLUDED.password_hash,
             display_name   = EXCLUDED.display_name,
             role           = EXCLUDED.role,
             status         = EXCLUDED.status,
             is_active      = EXCLUDED.is_active,
             updated_at     = NOW()
       RETURNING id, email, display_name, role, status`,
      { replacements: { hash }, type: Sequelize.QueryTypes.INSERT }
    );

    const user = rows[0];
    console.log('\n✅ Admin user created/updated:');
    console.log('  Email   :', user.email);
    console.log('  Name    :', user.display_name);
    console.log('  Role    :', user.role);
    console.log('  Status  :', user.status);
    console.log('  ID      :', user.id);
    console.log('\n🔑 Login: kembe699@gmail.com / (the SEED_ADMIN_PASSWORD you set)\n');
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  } finally {
    await seq.close();
  }
}

createAdminUser();
