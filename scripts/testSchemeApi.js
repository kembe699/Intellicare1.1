const { sequelize } = require('../models');

async function test() {
  try {
    // Test SELECT * which includes currency
    const [rows] = await sequelize.query('SELECT * FROM patient_schemes LIMIT 1');
    if (rows.length > 0) {
      console.log('Sample scheme keys:', Object.keys(rows[0]).join(', '));
      console.log('currency value:', rows[0].currency);
    } else {
      console.log('No schemes found');
    }

    // Test the exact query from the GET /:id route
    const [all] = await sequelize.query('SELECT id FROM patient_schemes LIMIT 5');
    if (all.length > 0) {
      const testId = all[0].id;
      console.log('\nTesting GET /:id with id:', testId);
      const [result] = await sequelize.query('SELECT * FROM patient_schemes WHERE id = :id', { replacements: { id: testId } });
      console.log('GET result:', result.length > 0 ? 'OK' : 'NOT FOUND');
    }

    // Test update with currency
    if (all.length > 0) {
      const testId = all[0].id;
      console.log('\nTesting UPDATE with currency field...');
      await sequelize.query('UPDATE patient_schemes SET currency = :currency WHERE id = :id', { replacements: { currency: 'SSP', id: testId } });
      console.log('UPDATE: OK');
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error('Full error:', e);
  } finally {
    await sequelize.close();
  }
}

test();
