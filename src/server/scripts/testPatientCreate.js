require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');
const { Patient } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    const patientData = {
      first_name: 'Test',
      last_name: 'Patient',
      gender: 'male',
      date_of_birth: '1990-01-01',
      phone_number: '1234567890',
      patient_id: 'UH-11111',
      registration_date: new Date(),
      clinic_id: 1,
      branch_id: 1
    };
    const patient = await Patient.create(patientData);
    console.log('OK created', patient.id);
  } catch (err) {
    console.error('Create Error:', err.message);
    if (err.parent) console.error('SQL Error:', err.parent.message);
  } finally {
    process.exit();
  }
})();
