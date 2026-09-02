require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');
const { getBranchConditionSQL } = require('../middleware/branchFilter');

(async () => {
  try {
    await sequelize.authenticate();
    const req = { user: { role: 'admin' }, query: { clinic_id: 1, status: 'pending' } };
    const { clinic_id, status } = req.query;
    
    let where = 'WHERE pp.clinic_id = :cid';
    const replacements = { cid: parseInt(clinic_id) || 1 };
    
    if (status && status !== 'all') { where += ' AND pp.status = :status'; replacements.status = status; }
    
    const { sql: rxBranchSQL, params: rxBranchParams } = getBranchConditionSQL(req, 'pp');
    if (rxBranchSQL) { where += ' AND pp.branch_id = :rxBranchId'; replacements.rxBranchId = rxBranchParams[0]; }

    const [rows] = await sequelize.query(`
      SELECT pp.*, (p.first_name || ' ' || p.last_name) AS patient_name, u.display_name AS doctor_name,
        (SELECT COUNT(*) FROM prescription_lines pl WHERE pl.prescription_id = pp.id) AS line_count,
        (SELECT COUNT(*) FROM prescription_lines pl WHERE pl.prescription_id = pp.id AND pl.status = 'dispensed') AS dispensed_count
      FROM pharmacy_prescriptions pp
      LEFT JOIN patients p ON pp.patient_id = p.id
      LEFT JOIN users u ON pp.doctor_id = u.id
      ${where}
      ORDER BY pp.prescription_date DESC, pp.created_at DESC
    `, { replacements });
    
    console.log('OK', rows.length);
  } catch (err) {
    console.error('SQL Error:', err.message);
  } finally {
    process.exit();
  }
})();
