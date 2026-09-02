const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function addPasswordColumn() {
  let connection;
  
  try {
    // Create direct MySQL connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'intellicare_db',
    });

    console.log('Connected to MySQL database');

    // Check if password_hash column exists
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'
    `, [process.env.DB_NAME || 'intellicare_db']);

    if (columns.length === 0) {
      // Add password_hash column
      await connection.execute(`
        ALTER TABLE users 
        ADD COLUMN password_hash VARCHAR(255) NULL
      `);
      console.log('✅ Added password_hash column to users table');
    } else {
      console.log('ℹ️  password_hash column already exists');
    }

    // Check if users table has any data
    const [users] = await connection.execute('SELECT COUNT(*) as count FROM users');
    console.log(`📊 Users table has ${users[0].count} records`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

addPasswordColumn();
