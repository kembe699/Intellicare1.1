require('dotenv').config();
const sequelize = require('../config/database');

const tables = ['patients', 'lab_requests', 'prescriptions', 'pharmacy_dispensing', 'patient_bills', 'receipts', 'lab_tests', 'lab_results'];

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Connected to DB');
    for (const table of tables) {
      try {
        await sequelize.query(`ALTER TABLE ${table} ADD COLUMN branch_id INT NULL`);
        console.log(`Added branch_id to ${table}`);
      } catch (err) {
        if (err.message.includes('Duplicate column name')) {
          console.log(`Column branch_id already exists in ${table}`);
        } else {
          console.error(`Error altering ${table}:`, err.message);
        }
      }
    }
    console.log('Done!');
  } catch (error) {
    console.error('Connection failed:', error.message);
  } finally {
    process.exit();
  }
})();
