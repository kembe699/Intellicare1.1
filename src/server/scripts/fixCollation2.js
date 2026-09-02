require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');

(async () => {
  try {
    await sequelize.authenticate();
    const collation = 'utf8mb4_0900_ai_ci';
    const charset = 'utf8mb4';

    const tables = ['pharmacy_prescriptions', 'visits', 'prescriptions', 'lab_requests'];
    
    for (const table of tables) {
      console.log(`Converting ${table}...`);
      await sequelize.query(`ALTER TABLE ${table} CONVERT TO CHARACTER SET ${charset} COLLATE ${collation}`);
    }
    console.log('Collation fix complete.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit();
  }
})();
