/**
 * DDL only — creates the geofenced-QR-attendance tables if they don't exist
 * yet. Same shape as ensureHRTables.js: safe to call repeatedly, safe to
 * call per-tenant (see tenantDb.js's buildTenantConnection for why).
 *
 * attendance_days is a VIEW, not a table — it's a pure aggregation over
 * attendance_records (accepted rows only) joined to whichever shift the
 * employee is assigned on that date, so it can never drift out of sync with
 * the records it summarizes. "Keep it simple" per spec — no rostering, one
 * current shift assignment per employee, no assignment history.
 */
async function ensureAttendanceTables(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS attendance_sites (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL,
      name VARCHAR(150) NOT NULL,
      latitude NUMERIC(10,7) NOT NULL,
      longitude NUMERIC(10,7) NOT NULL,
      radius_m INTEGER NOT NULL DEFAULT 100 CHECK (radius_m BETWEEN 30 AND 2000),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      qr_mode VARCHAR(20) NOT NULL DEFAULT 'printed' CHECK (qr_mode IN ('printed', 'rotating')),
      qr_key VARCHAR(64),
      qr_key_created_at TIMESTAMPTZ,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS shifts (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      name VARCHAR(100) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      grace_minutes INTEGER NOT NULL DEFAULT 10,
      working_days VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // One current shift per employee — no history, matches "no complex
  // rostering" in the spec. A department-level default is a separate,
  // lower-priority table below.
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS employee_shift_assignments (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      employee_id VARCHAR(36) NOT NULL UNIQUE,
      shift_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS department_shift_defaults (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      department VARCHAR(150) NOT NULL,
      shift_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (clinic_id, branch_id, department)
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL,
      employee_id VARCHAR(36) NOT NULL,
      site_id VARCHAR(36) NOT NULL,
      type VARCHAR(10) NOT NULL CHECK (type IN ('in', 'out')),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      shift_date DATE NOT NULL,
      latitude NUMERIC(10,7),
      longitude NUMERIC(10,7),
      accuracy_m NUMERIC(8,2),
      distance_m NUMERIC(10,2),
      method VARCHAR(20) NOT NULL CHECK (method IN ('qr_static', 'qr_rotating', 'manual')),
      status VARCHAR(20) NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'rejected', 'corrected')),
      reject_reason TEXT,
      device_info VARCHAR(500),
      ip VARCHAR(64),
      corrected_by INTEGER,
      correction_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS attendance_records_employee_date_idx ON attendance_records (employee_id, shift_date)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS attendance_records_site_idx ON attendance_records (site_id)`);
  // Blocks a duplicate tap of the same type within the same second-level
  // bucket isn't reliable for the "no double tap within 2 minutes" rule
  // (that needs a time-window check, done in application code at write
  // time) — this index just makes that window query fast.
  await sequelize.query(`CREATE INDEX IF NOT EXISTS attendance_records_employee_occurred_idx ON attendance_records (employee_id, occurred_at)`);

  // Generic audit trail for manual corrections — "every change audited
  // (who/when/old/new)". old_values/new_values are JSONB snapshots of the
  // attendance_records row, not a fixed column list, so this doesn't need
  // its own migration every time attendance_records gains a column.
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS attendance_record_audit (
      id VARCHAR(36) PRIMARY KEY,
      record_id VARCHAR(36) NOT NULL,
      changed_by INTEGER NOT NULL,
      reason TEXT NOT NULL,
      old_values JSONB,
      new_values JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Login-attempt log for the employee portal (lockout + HR-visible "locked
  // accounts" list) — separate from app-wide users, since portal principals
  // (employees) aren't rows in the users table.
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS portal_login_attempts (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      employee_id VARCHAR(36),
      employee_number VARCHAR(50),
      success BOOLEAN NOT NULL,
      ip VARCHAR(64),
      user_agent VARCHAR(500),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS portal_login_attempts_employee_idx ON portal_login_attempts (employee_id, created_at)`);

  // Per-employee per-date summary, computed on read. late_minutes/
  // early_leave_minutes are NULL whenever the employee has no shift
  // assignment at all (nothing to be late/early against).
  await sequelize.query(`
    CREATE OR REPLACE VIEW attendance_days AS
    SELECT
      ar.clinic_id,
      ar.branch_id,
      ar.employee_id,
      ar.shift_date,
      MIN(ar.occurred_at) FILTER (WHERE ar.type = 'in') AS first_in,
      MAX(ar.occurred_at) FILTER (WHERE ar.type = 'out') AS last_out,
      EXTRACT(EPOCH FROM (
        MAX(ar.occurred_at) FILTER (WHERE ar.type = 'out') -
        MIN(ar.occurred_at) FILTER (WHERE ar.type = 'in')
      )) / 3600.0 AS hours_worked,
      s.id AS shift_id,
      s.name AS shift_name,
      GREATEST(0, EXTRACT(EPOCH FROM (
        MIN(ar.occurred_at) FILTER (WHERE ar.type = 'in')::time - s.start_time - (s.grace_minutes || ' minutes')::interval
      )) / 60.0) AS late_minutes,
      GREATEST(0, EXTRACT(EPOCH FROM (
        s.end_time - MAX(ar.occurred_at) FILTER (WHERE ar.type = 'out')::time
      )) / 60.0) AS early_leave_minutes,
      (MIN(ar.occurred_at) FILTER (WHERE ar.type = 'in') IS NOT NULL
        AND MAX(ar.occurred_at) FILTER (WHERE ar.type = 'out') IS NULL
        AND ar.shift_date < CURRENT_DATE) AS missing_clock_out
    FROM attendance_records ar
    LEFT JOIN employee_shift_assignments esa ON esa.employee_id = ar.employee_id
    LEFT JOIN shifts s ON s.id = esa.shift_id
    WHERE ar.status = 'accepted'
    GROUP BY ar.clinic_id, ar.branch_id, ar.employee_id, ar.shift_date, s.id, s.name, s.start_time, s.end_time, s.grace_minutes
  `);
}

module.exports = { ensureAttendanceTables };
