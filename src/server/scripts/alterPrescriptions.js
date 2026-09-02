require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');

const cols = [
  "medications JSON",
  "medication_name VARCHAR(255)",
  "take_instructions VARCHAR(100)",
  "frequency VARCHAR(100)",
  "duration VARCHAR(100)",
  "quantity VARCHAR(50)",
  "instructions TEXT"
];

(async () => {
  try {
    await sequelize.authenticate();
    for (const col of cols) {
      const colName = col.split(' ')[0];
      try {
        await sequelize.query(`ALTER TABLE prescriptions ADD COLUMN ${col}`);
        console.log(`Added ${colName}`);
      } catch (e) {
        if (e.message.includes('Duplicate column name')) {
          console.log(`${colName} already exists`);
        } else {
          console.error(`Error adding ${colName}:`, e.message);
        }
      }
    }
  } catch (err) {
    console.error('Connection Error:', err.message);
  } finally {
    process.exit();
  }
})();
