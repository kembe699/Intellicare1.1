const bcrypt = require('bcrypt');
const { User, initializeDatabase } = require('../models');

async function createTestUser() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run: this creates an admin-role account and must not be run against production.');
    process.exit(1);
  }
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    console.error('❌ Set TEST_USER_EMAIL and TEST_USER_PASSWORD env vars before running this script (no default credentials are hardcoded).');
    process.exit(1);
  }
  try {
    // Initialize database connection
    await initializeDatabase();

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create test user
    const testUser = await User.create({
      email,
      password_hash: passwordHash,
      display_name: 'Test Admin',
      role: 'admin',
      clinic_id: 1,
      status: 'active',
      is_active: true,
    });

    console.log('✅ Test user created successfully:');
    console.log('📧 Email:', email);
    console.log('👤 Role: admin');
    console.log('🆔 User ID:', testUser.id);

  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      console.log('ℹ️  Test user already exists');

      // Update existing user's password
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        await existingUser.update({
          password_hash: passwordHash,
          is_active: true,
          status: 'active'
        });

        console.log('✅ Updated existing test user password');
        console.log('📧 Email:', email);
      }
    } else {
      console.error('❌ Error creating test user:', error);
    }
  } finally {
    process.exit(0);
  }
}

createTestUser();
