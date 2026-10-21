/**
 * Best-effort ALTERs adding the HOD/Finance approval-step columns to the
 * existing leave_requests and salary_advances tables. New status *values*
 * (e.g. "approved_by_hod") need no schema change — status is already a
 * plain unconstrained VARCHAR(20) on both tables — only these new columns
 * to record who/when/why at each step do.
 */
const { addColumnIfMissing } = require('./ensureEmployeePortalAccess');

async function ensureLeaveAdvanceWorkflowColumns(sequelize) {
  await addColumnIfMissing(sequelize, 'leave_requests', 'hod_approved_by', 'INTEGER');
  await addColumnIfMissing(sequelize, 'leave_requests', 'hod_approved_at', 'TIMESTAMPTZ');
  await addColumnIfMissing(sequelize, 'leave_requests', 'hod_rejected_reason', 'TEXT');
  await addColumnIfMissing(sequelize, 'leave_requests', 'attachment_url', 'VARCHAR(500)');
  await addColumnIfMissing(sequelize, 'leave_requests', 'changes_requested_reason', 'TEXT');

  await addColumnIfMissing(sequelize, 'salary_advances', 'hod_approved_by', 'INTEGER');
  await addColumnIfMissing(sequelize, 'salary_advances', 'hod_approved_at', 'TIMESTAMPTZ');
  await addColumnIfMissing(sequelize, 'salary_advances', 'hod_rejected_reason', 'TEXT');
  await addColumnIfMissing(sequelize, 'salary_advances', 'finance_approved_by', 'INTEGER');
  await addColumnIfMissing(sequelize, 'salary_advances', 'finance_approved_at', 'TIMESTAMPTZ');
  await addColumnIfMissing(sequelize, 'salary_advances', 'payment_method', 'VARCHAR(50)');
  await addColumnIfMissing(sequelize, 'salary_advances', 'changes_requested_reason', 'TEXT');
  await addColumnIfMissing(sequelize, 'salary_advances', 'repayment_months', 'INTEGER');
}

module.exports = { ensureLeaveAdvanceWorkflowColumns };
