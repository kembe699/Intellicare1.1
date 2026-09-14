/**
 * DDL only — creates the HR/payroll tables if they don't exist yet. Same
 * shape as ensureNotificationsTable.js/ensureRolesTables.js: safe to call
 * repeatedly, safe to call per-tenant (see tenantDb.js's buildTenantConnection
 * for why per-tenant call sites, not a one-off boot migration, are how a
 * brand-new table actually reaches every schema).
 *
 * Deductions are freeform (employee_salary_components.account_code is a
 * plain nullable string, not an FK to a fixed statutory-tax table) —
 * deliberately not hardcoded to any one country's payroll tax regime, since
 * the chart of accounts' PAYE/NHIF/NSSF accounts are Kenya-specific and most
 * real tenants are not in Kenya. A deduction with no account_code posts to
 * 2200 Payroll Liabilities by default at pay time.
 */
async function ensureHRTables(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      user_id INTEGER,
      employee_number VARCHAR(50) NOT NULL,
      employment_type VARCHAR(20) NOT NULL DEFAULT 'staff',
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      gender VARCHAR(20),
      date_of_birth DATE,
      national_id VARCHAR(100),
      phone VARCHAR(50),
      email VARCHAR(255),
      address TEXT,
      job_title VARCHAR(150),
      department VARCHAR(150),
      hire_date DATE,
      termination_date DATE,
      employment_status VARCHAR(20) NOT NULL DEFAULT 'active',
      contract_type VARCHAR(20) NOT NULL DEFAULT 'full_time',
      bank_name VARCHAR(150),
      bank_account_name VARCHAR(150),
      bank_account_number VARCHAR(100),
      emergency_contact_name VARCHAR(150),
      emergency_contact_phone VARCHAR(50),
      basic_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
      salary_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      pay_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS employee_salary_components (
      id VARCHAR(36) PRIMARY KEY,
      employee_id VARCHAR(36) NOT NULL,
      component_type VARCHAR(20) NOT NULL,
      name VARCHAR(150) NOT NULL,
      amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      is_percentage BOOLEAN NOT NULL DEFAULT FALSE,
      account_code VARCHAR(50),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      run_number VARCHAR(50) NOT NULL,
      period_month INTEGER NOT NULL,
      period_year INTEGER NOT NULL,
      run_date DATE NOT NULL DEFAULT CURRENT_DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      payment_account_id VARCHAR(36),
      created_by INTEGER,
      approved_by INTEGER,
      approved_at TIMESTAMPTZ,
      paid_by INTEGER,
      paid_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS payroll_run_lines (
      id VARCHAR(36) PRIMARY KEY,
      payroll_run_id VARCHAR(36) NOT NULL,
      employee_id VARCHAR(36) NOT NULL,
      basic_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
      allowances_total NUMERIC(15,2) NOT NULL DEFAULT 0,
      deductions_total NUMERIC(15,2) NOT NULL DEFAULT 0,
      gross_pay NUMERIC(15,2) NOT NULL DEFAULT 0,
      net_pay NUMERIC(15,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      exchange_rate NUMERIC(15,6) NOT NULL DEFAULT 1,
      base_currency_net NUMERIC(15,2) NOT NULL DEFAULT 0,
      gl_entry_id VARCHAR(36),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS payroll_run_line_components (
      id VARCHAR(36) PRIMARY KEY,
      payroll_run_line_id VARCHAR(36) NOT NULL,
      component_type VARCHAR(20) NOT NULL,
      name VARCHAR(150) NOT NULL,
      amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      account_code VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const [idxName, idxSql] of [
    ['employees_clinic_idx', 'CREATE INDEX employees_clinic_idx ON employees(clinic_id)'],
    ['employees_type_status_idx', 'CREATE INDEX employees_type_status_idx ON employees(employment_type, employment_status)'],
    ['employees_number_uniq_idx', 'CREATE UNIQUE INDEX employees_number_uniq_idx ON employees(employee_number)'],
    ['salary_components_employee_idx', 'CREATE INDEX salary_components_employee_idx ON employee_salary_components(employee_id)'],
    ['payroll_runs_clinic_idx', 'CREATE INDEX payroll_runs_clinic_idx ON payroll_runs(clinic_id)'],
    ['payroll_runs_number_uniq_idx', 'CREATE UNIQUE INDEX payroll_runs_number_uniq_idx ON payroll_runs(run_number)'],
    ['payroll_run_lines_run_idx', 'CREATE INDEX payroll_run_lines_run_idx ON payroll_run_lines(payroll_run_id)'],
    ['payroll_run_lines_employee_idx', 'CREATE INDEX payroll_run_lines_employee_idx ON payroll_run_lines(employee_id)'],
    ['payroll_run_line_components_line_idx', 'CREATE INDEX payroll_run_line_components_line_idx ON payroll_run_line_components(payroll_run_line_id)'],
  ]) {
    try {
      const [[check]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :idxName`,
        { replacements: { idxName } }
      );
      if (!check.cnt) await sequelize.query(idxSql);
    } catch (e) { /* index creation is best-effort */ }
  }
}

module.exports = { ensureHRTables };
