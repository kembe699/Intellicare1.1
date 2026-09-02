require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');
const { getBranchConditionSQL } = require('../middleware/branchFilter');

(async () => {
  try {
    await sequelize.authenticate();
    const req = { user: { role: 'admin' }, query: { clinic_id: 1, status: 'active' } };
    const { clinic_id, status } = req.query;
    
    let where = 'WHERE v.clinic_id = :cid';
    const replacements = { cid: parseInt(clinic_id) || 1 };
    
    where += " AND pr.status = 'active'";
    
    const { sql: branchSQL, params: branchParams } = getBranchConditionSQL(req, 'v');
    if (branchSQL) { where += ' AND v.branch_id = :branchId'; replacements.branchId = branchParams[0]; }

    const [rows] = await sequelize.query(`
      SELECT pr.*, (p.first_name || ' ' || p.last_name) AS patient_name_joined,
        v.chief_complaint, v.visit_date, v.doctor_name
      FROM prescriptions pr
      LEFT JOIN patients p ON pr.patient_id = p.id
      LEFT JOIN visits v ON pr.visit_id = v.id
      ${where}
      ORDER BY pr.prescribed_at DESC
    `, { replacements });
    
    console.log('OK', rows.length);
  } catch (err) {
    console.error('SQL Error:', err.message);
  } finally {
    process.exit();
  }
})();
