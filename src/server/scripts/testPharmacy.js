require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');
const { getBranchConditionSQL } = require('../middleware/branchFilter');

(async () => {
  try {
    await sequelize.authenticate();
    const req = { user: { role: 'admin' }, query: { clinic_id: 1, status: 'active' } };
    const { clinic_id, status } = req.query;
    const branchFilter = getBranchConditionSQL(req, 'pp');

    const [results] = await sequelize.query(`
      SELECT 
        pp.id, pp.patient_id, pp.patient_name, pp.visit_id, pp.prescribed_by, 
        pp.clinic_id, pp.medications, pp.medication_name, pp.take_instructions, 
        pp.frequency, pp.duration, pp.quantity, pp.instructions, pp.status, 
        pp.prescribed_at, pp.notes, pp.created_at, pp.updated_at,
        p.first_name, p.last_name, p.date_of_birth, p.gender,
        u.display_name as doctor_name
      FROM prescriptions pp
      LEFT JOIN patients p ON pp.patient_id = p.id
      LEFT JOIN users u ON pp.doctor_id = u.id
      WHERE pp.clinic_id = ? AND pp.status = ?
      ${branchFilter.sql}
      ORDER BY pp.prescribed_at DESC
    `, {
      replacements: [clinic_id, status, ...branchFilter.params]
    });
    console.log('OK', results.length);
  } catch (err) {
    console.error('SQL Error:', err.message);
  } finally {
    process.exit();
  }
})();
