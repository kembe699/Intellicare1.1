const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function createNewAdminUser() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306
  });

  try {
    // Password comes from SEED_ADMIN_PASSWORD
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!password) throw new Error('Set SEED_ADMIN_PASSWORD to seed an admin account');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    const userId = uuidv4();
    const now = new Date();

    // Insert admin user
    const [result] = await connection.execute(
      `INSERT INTO users (id, email, display_name, role, is_active, status, password_hash, created_at, password_set_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, 'admin@intellicare.com', 'IntelliCare Admin', 'admin', 1, 'active', passwordHash, now, now]
    );

    console.log('✅ Admin user created successfully!');
    console.log('Email: admin@intellicare.com');
    console.log('Password: (the SEED_ADMIN_PASSWORD you set)');
    console.log('Role: admin');
    console.log('Display Name: IntelliCare Admin');
    console.log('User ID:', userId);

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      console.log('⚠️  User with this email already exists');
    } else {
      console.error('❌ Error creating admin user:', error.message);
    }
  } finally {
    await connection.end();
  }
}

createNewAdminUser();
