require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');
const { getBranchConditionSQL } = require('../middleware/branchFilter');

(async () => {
  try {
    await sequelize.authenticate();
    const req = { user: { role: 'admin' } };
    const clinic = 1;
    const branchFilter = getBranchConditionSQL(req, 'lr');
    const [results] = await sequelize.query(`
      SELECT 
        lr.*,
        p.first_name,
        p.last_name,
        p.date_of_birth,
        p.gender,
        p.patient_id,
        COALESCE((p.first_name || ' ' || p.last_name), lr.patient_name) as patient_name,
        CASE WHEN p.date_of_birth IS NOT NULL THEN (EXTRACT(YEAR FROM AGE((CURRENT_DATE)::timestamp, (p.date_of_birth)::timestamp)))::int ELSE NULL END as age
      FROM lab_requests lr
      LEFT JOIN patients p ON p.id = lr.patient_id
      WHERE lr.clinic_id = ?
      ${branchFilter.sql}
      ORDER BY lr.requested_at DESC
    `, {
      replacements: [clinic, ...branchFilter.params]
    });
    console.log('OK', results.length);
  } catch (err) {
    console.error('SQL Error:', err.message);
  } finally {
    process.exit();
  }
})();
