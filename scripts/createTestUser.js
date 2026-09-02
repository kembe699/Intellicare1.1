const bcrypt = require('bcrypt');
const { User, initializeDatabase } = require('../models');

async function createTestUser() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    // Hash the password
    const saltRounds = 12;
    const password = 'admin123'; // Test password
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Create test user
    const testUser = await User.create({
      email: 'admin@test.com',
      password_hash: passwordHash,
      display_name: 'Test Admin',
      role: 'admin',
      clinic_id: 1,
      status: 'active',
      is_active: true,
    });
    
    console.log('✅ Test user created successfully:');
    console.log('📧 Email: admin@test.com');
    console.log('🔑 Password: admin123');
    console.log('👤 Role: admin');
    console.log('🆔 User ID:', testUser.id);
    
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      console.log('ℹ️  Test user already exists');
      
      // Update existing user's password
      const existingUser = await User.findOne({ where: { email: 'admin@test.com' } });
      if (existingUser) {
        const saltRounds = 12;
        const password = 'admin123';
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        await existingUser.update({ 
          password_hash: passwordHash,
          is_active: true,
          status: 'active'
        });
        
        console.log('✅ Updated existing test user password');
        console.log('📧 Email: admin@test.com');
        console.log('🔑 Password: admin123');
      }
    } else {
      console.error('❌ Error creating test user:', error);
    }
  } finally {
    process.exit(0);
  }
}

createTestUser();
