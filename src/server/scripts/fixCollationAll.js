require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');

(async () => {
  try {
    await sequelize.authenticate();
    const collation = 'utf8mb4_0900_ai_ci';
    const charset = 'utf8mb4';

    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    
    const [tables] = await sequelize.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = 'intellicare' AND TABLE_TYPE = 'BASE TABLE'
    `);
    
    for (const { TABLE_NAME: table } of tables) {
      console.log(`Converting ${table}...`);
      try {
        await sequelize.query(`ALTER TABLE ${table} CONVERT TO CHARACTER SET ${charset} COLLATE ${collation}`);
      } catch (e) {
        console.error(`Error converting ${table}:`, e.message);
      }
    }
    
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Database collation fix complete.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit();
  }
})();
