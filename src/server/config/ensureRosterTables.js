/**
 * DDL only — monthly departmental duty rosters. Additive: two new tables,
 * new nullable/defaulted columns on `shifts` and `hr_workflow_settings`.
 * Safe to call repeatedly and per tenant, like every other ensureXxx here.
 *
 *   duty_rosters         one per department per month (YYYY-MM), with the
 *                        draft → submitted → approved / returned workflow
 *   duty_roster_entries  one shift per employee per day; no row = off duty
 *
 * Called from ensureAttendanceTables before the attendance_days view is
 * (re)built, because that view reads the approved roster to know which shift
 * a person was actually on for a given day.
 */
const { addColumnIfMissing } = require('./ensureEmployeePortalAccess');

async function ensureRosterTables(sequelize) {
  // Shift codes as they appear on a paper/Excel roster (M, E, N, OC …), what
  // kind of duty the shift is, a colour for the grid, and how early someone
  // may clock in before it starts.
  await addColumnIfMissing(sequelize, 'shifts', 'code', 'VARCHAR(10)');
  await addColumnIfMissing(sequelize, 'shifts', 'kind', "VARCHAR(10) NOT NULL DEFAULT 'work'");
  await addColumnIfMissing(sequelize, 'shifts', 'color', 'VARCHAR(20)');
  await addColumnIfMissing(sequelize, 'shifts', 'early_window_min', 'INTEGER NOT NULL DEFAULT 60');

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS duty_rosters (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      department VARCHAR(150) NOT NULL,
      period VARCHAR(7) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
      version INTEGER NOT NULL DEFAULT 1,
      source VARCHAR(20),
      created_by INTEGER,
      submitted_by INTEGER,
      submitted_at TIMESTAMPTZ,
      approved_by INTEGER,
      approved_at TIMESTAMPTZ,
      returned_by INTEGER,
      returned_at TIMESTAMPTZ,
      return_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // COALESCE so a branchless roster still conflicts with itself (a plain
  // UNIQUE treats every NULL branch_id as distinct — see
  // ensureAttendanceTables' department_shift_defaults for the same fix).
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS duty_rosters_dept_period_uidx
    ON duty_rosters (clinic_id, COALESCE(branch_id, -1), department, period)
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS duty_roster_entries (
      id VARCHAR(36) PRIMARY KEY,
      roster_id VARCHAR(36) NOT NULL,
      employee_id VARCHAR(36) NOT NULL,
      duty_date DATE NOT NULL,
      shift_id VARCHAR(36) NOT NULL,
      note VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (roster_id, employee_id, duty_date)
    )
  `);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS duty_roster_entries_employee_date_idx ON duty_roster_entries (employee_id, duty_date)`);

  // Audit trail of every workflow step and bulk change (who/when/what).
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS duty_roster_events (
      id VARCHAR(36) PRIMARY KEY,
      roster_id VARCHAR(36) NOT NULL,
      action VARCHAR(30) NOT NULL,
      actor_user_id INTEGER,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

module.exports = { ensureRosterTables };
