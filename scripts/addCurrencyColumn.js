const { sequelize } = require('../models');

async function addCurrencyColumn() {
  try {
    const [cols] = await sequelize.query("SHOW COLUMNS FROM patient_schemes LIKE 'currency'");
    if (cols.length === 0) {
      await sequelize.query("ALTER TABLE patient_schemes ADD COLUMN currency VARCHAR(3) DEFAULT 'SSP'");
      console.log('Added currency column to patient_schemes');
    } else {
      console.log('currency column already exists');
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await sequelize.close();
  }
}

addCurrencyColumn();
