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

  // Traces a payroll deduction line back to the salary_advances row it was
  // automatically generated from — payroll_run_line_components otherwise
  // has no way to distinguish an advance repayment from a tax/pension/any
  // other deduction an admin typed in.
  await addColumnIfMissing(sequelize, 'payroll_run_line_components', 'source_type', 'VARCHAR(30)');
  await addColumnIfMissing(sequelize, 'payroll_run_line_components', 'source_id', 'VARCHAR(36)');

  // Lets a reversed automatic-deduction repayment row stay in history
  // (never deleted) while no longer counting as a live repayment — see
  // PayrollPayment.js's restoreSalaryAdvanceDeduction (not called from
  // anywhere yet; written ready for a future payroll-line-reversal
  // feature, which doesn't exist in this codebase today).
  await addColumnIfMissing(sequelize, 'salary_advance_repayments', 'reversed_at', 'TIMESTAMPTZ');
}

module.exports = { ensureLeaveAdvanceWorkflowColumns };
