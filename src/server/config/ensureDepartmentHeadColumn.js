/**
 * Best-effort ALTER adding departments.head_employee_id — a loose reference
 * to employees.id (no FK constraint, matching this schema's existing style
 * of unenforced cross-table references). Used to resolve an employee's
 * approver chain (HOD step) for leave/salary-advance requests. User-approved
 * addition — see the HR attendance/portal feature's planning discussion.
 */
const { addColumnIfMissing } = require('./ensureEmployeePortalAccess');

async function ensureDepartmentHeadColumn(sequelize) {
  const [[tableCheck]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'departments'`
  );
  if (parseInt(tableCheck.cnt, 10) === 0) return;
  await addColumnIfMissing(sequelize, 'departments', 'head_employee_id', 'VARCHAR(36)');
}

module.exports = { ensureDepartmentHeadColumn };
