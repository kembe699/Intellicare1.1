require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');

const cols = [
  "patient_name VARCHAR(255)",
  "doctor_name VARCHAR(255)",
  "visit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  "date TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  "clinical_notes TEXT",
  "vitals JSON",
  "lab_requests JSON",
  "diagnosis TEXT",
  "diagnosis_code VARCHAR(50)",
  "prescription JSON",
  "disposition VARCHAR(255)",
  "follow_up_date DATE"
];

(async () => {
  try {
    await sequelize.authenticate();
    for (const col of cols) {
      const colName = col.split(' ')[0];
      try {
        await sequelize.query(`ALTER TABLE visits ADD COLUMN ${col}`);
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
