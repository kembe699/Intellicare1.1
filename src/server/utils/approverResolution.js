/**
 * Resolves who should act as an employee's HOD approver: a per-employee
 * override (employee_approver_overrides) wins if set, otherwise the
 * employee's department's head_employee_id (departments.head_employee_id).
 * Returns the approver's employees.id plus their linked users.id (nullable
 * — an HOD with no HMIS login can still approve via the mobile portal's
 * own "Approvals" tab, matched directly against employees.id there).
 */
async function resolveApprover(sequelize, { clinicId, employeeId, department }) {
  const [[override]] = await sequelize.query(
    `SELECT approver_employee_id FROM employee_approver_overrides WHERE clinic_id = :clinicId AND employee_id = :employeeId`,
    { replacements: { clinicId, employeeId } }
  );
  let approverEmployeeId = override?.approver_employee_id || null;

  if (!approverEmployeeId && department) {
    const [[dept]] = await sequelize.query(
      `SELECT head_employee_id FROM departments WHERE clinic_id = :clinicId AND department_name = :department AND head_employee_id IS NOT NULL LIMIT 1`,
      { replacements: { clinicId, department } }
    );
    approverEmployeeId = dept?.head_employee_id || null;
  }
  if (!approverEmployeeId) return null;

  const [[approverEmployee]] = await sequelize.query(
    `SELECT id, user_id, first_name, last_name FROM employees WHERE id = :id`,
    { replacements: { id: approverEmployeeId } }
  );
  if (!approverEmployee) return null;
  return {
    approverEmployeeId: approverEmployee.id,
    approverUserId: approverEmployee.user_id || null,
    approverName: `${approverEmployee.first_name} ${approverEmployee.last_name}`,
  };
}

/**
 * True if the acting principal — an HMIS user (userId set) or a portal
 * employee (employeeId set) — is the resolved HOD approver for the given
 * employee/department. Exactly one of userId/employeeId should be set by
 * the caller.
 */
async function isApproverFor(sequelize, { clinicId, employeeId, department, actingUserId, actingEmployeeId }) {
  const approver = await resolveApprover(sequelize, { clinicId, employeeId, department });
  if (!approver) return false;
  if (actingEmployeeId) return approver.approverEmployeeId === actingEmployeeId;
  if (actingUserId) return approver.approverUserId === actingUserId;
  return false;
}

module.exports = { resolveApprover, isApproverFor };
