/**
 * One row per clinic holding the configurable leave/advance approval-
 * workflow toggles from spec section 6B: whether the HOD step is required
 * before HR, whether advances also need a Finance/Accounts step before
 * payout, and the server-side advance limits (max % of basic salary, max
 * open advances, max repayment months, min months of service). Ensured
 * per-tenant the same way as every other ensureXxxTable in this codebase.
 */
const { addColumnIfMissing } = require('./ensureEmployeePortalAccess');

async function ensureHrWorkflowSettings(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS hr_workflow_settings (
      clinic_id INTEGER PRIMARY KEY,
      leave_require_hod BOOLEAN NOT NULL DEFAULT FALSE,
      advance_require_hod BOOLEAN NOT NULL DEFAULT FALSE,
      advance_require_finance BOOLEAN NOT NULL DEFAULT FALSE,
      advance_max_percent_of_salary NUMERIC(5,2) NOT NULL DEFAULT 50,
      advance_max_open_advances INTEGER NOT NULL DEFAULT 1,
      advance_max_repayment_months INTEGER NOT NULL DEFAULT 12,
      advance_min_months_of_service INTEGER NOT NULL DEFAULT 0,
      advance_deduction_cap_percent NUMERIC(5,2) NOT NULL DEFAULT 50,
      advance_deduct_same_period BOOLEAN NOT NULL DEFAULT FALSE,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Backfill for tenants where this table already existed before these two
  // columns were added — CREATE TABLE IF NOT EXISTS above is a no-op there.
  await addColumnIfMissing(sequelize, 'hr_workflow_settings', 'advance_deduction_cap_percent', 'NUMERIC(5,2) NOT NULL DEFAULT 50');
  await addColumnIfMissing(sequelize, 'hr_workflow_settings', 'advance_deduct_same_period', 'BOOLEAN NOT NULL DEFAULT FALSE');

  // A per-employee override of who approves their requests, instead of
  // their department's head — kept as its own table rather than a new
  // column on employees (would be yet another existing-table alteration).
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS employee_approver_overrides (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      employee_id VARCHAR(36) NOT NULL UNIQUE,
      approver_employee_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // The employee-portal's own notification bell. app_notifications
  // (ensureNotificationsTable.js) requires a users.id recipient, which a
  // portal-only employee with no HMIS login may not have — this is the
  // same shape for an employees.id recipient instead, read by the "bell" on
  // /staff and written by the leave/advance workflow endpoints below.
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS portal_notifications (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      employee_id VARCHAR(36) NOT NULL,
      type VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT,
      entity_type VARCHAR(100),
      entity_id VARCHAR(100),
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS portal_notifications_employee_idx ON portal_notifications (employee_id, created_at)`);
}

async function getWorkflowSettings(sequelize, clinicId) {
  const [[row]] = await sequelize.query(`SELECT * FROM hr_workflow_settings WHERE clinic_id = :clinicId`, { replacements: { clinicId } });
  if (row) return row;
  // Defaults when a clinic has never saved settings — every step off,
  // same "simplest workflow" starting point as the rest of this feature.
  return {
    clinic_id: clinicId,
    leave_require_hod: false,
    advance_require_hod: false,
    advance_require_finance: false,
    advance_max_percent_of_salary: 50,
    advance_max_open_advances: 1,
    advance_max_repayment_months: 12,
    advance_min_months_of_service: 0,
    advance_deduction_cap_percent: 50,
    advance_deduct_same_period: false,
  };
}

module.exports = { ensureHrWorkflowSettings, getWorkflowSettings };
