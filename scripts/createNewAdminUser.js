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
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      console.error('❌ Set ADMIN_EMAIL and ADMIN_PASSWORD env vars before running this script (no default credentials are hardcoded).');
      process.exitCode = 1;
      return;
    }
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const userId = uuidv4();
    const now = new Date();

    // Insert admin user
    const [result] = await connection.execute(
      `INSERT INTO users (id, email, display_name, role, is_active, status, password_hash, created_at, password_set_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, email, 'IntelliCare Admin', 'admin', 1, 'active', passwordHash, now, now]
    );

    console.log('✅ Admin user created successfully!');
    console.log('Email:', email);
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
