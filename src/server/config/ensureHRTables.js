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

  // Standard salary structure templates — defined once, then applied to a set
  // of employees (copies basic_salary/currency/pay_frequency + components
  // onto each, same values employee_salary_components already uses).
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS salary_structures (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      basic_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      pay_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS salary_structure_components (
      id VARCHAR(36) PRIMARY KEY,
      salary_structure_id VARCHAR(36) NOT NULL,
      component_type VARCHAR(20) NOT NULL,
      name VARCHAR(150) NOT NULL,
      amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      is_percentage BOOLEAN NOT NULL DEFAULT FALSE,
      account_code VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Consultants are paid a percentage of the consultation revenue they bring
  // in, not a salary — this column holds that percentage. Nullable/unused
  // for staff.
  try {
    const [[col]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'employees' AND column_name = 'consultation_fee_percentage'`
    );
    // COUNT(*) comes back as the STRING "0" via the pg driver, not the
    // number 0 — `!"0"` is false, so a naive truthiness check here would
    // never actually run the ALTER on a fresh tenant.
    if (parseInt(col.cnt, 10) === 0) {
      await sequelize.query(`ALTER TABLE employees ADD COLUMN consultation_fee_percentage NUMERIC(5,2)`);
    }
  } catch (e) { /* best-effort column add */ }

  // A consultant bill = a percentage of the consultation revenue collected
  // for that consultant over a period, computed from lis_test_orders +
  // patient_bills (see hr.js's consultation-attribution logic, adapted from
  // reportDoctorPerformance.js's documented same-patient/same-day heuristic
  // — there is no hard FK from a bill to the visit/doctor that generated
  // it). consultant_bill_items records exactly which patient bills were
  // counted into a given bill, keyed uniquely per (consultant, patient
  // bill), so the same collected revenue can never be billed to the same
  // consultant twice even across overlapping date ranges.
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS consultant_bills (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      consultant_id VARCHAR(36) NOT NULL,
      bill_number VARCHAR(50) NOT NULL,
      period_from DATE NOT NULL,
      period_to DATE NOT NULL,
      total_consultation_revenue NUMERIC(15,2) NOT NULL DEFAULT 0,
      fee_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
      bill_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
      payment_account_id VARCHAR(36),
      exchange_rate NUMERIC(15,6) NOT NULL DEFAULT 1,
      base_currency_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      gl_entry_id VARCHAR(36),
      created_by INTEGER,
      paid_by INTEGER,
      paid_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS consultant_bill_items (
      id VARCHAR(36) PRIMARY KEY,
      consultant_bill_id VARCHAR(36) NOT NULL,
      consultant_id VARCHAR(36) NOT NULL,
      patient_bill_id VARCHAR(36) NOT NULL,
      patient_id VARCHAR(36),
      visit_date DATE,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      amount NUMERIC(15,2) NOT NULL DEFAULT 0,
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
    ['salary_structures_clinic_idx', 'CREATE INDEX salary_structures_clinic_idx ON salary_structures(clinic_id)'],
    ['salary_structure_components_structure_idx', 'CREATE INDEX salary_structure_components_structure_idx ON salary_structure_components(salary_structure_id)'],
    ['consultant_bills_clinic_idx', 'CREATE INDEX consultant_bills_clinic_idx ON consultant_bills(clinic_id)'],
    ['consultant_bills_consultant_idx', 'CREATE INDEX consultant_bills_consultant_idx ON consultant_bills(consultant_id)'],
    ['consultant_bills_number_uniq_idx', 'CREATE UNIQUE INDEX consultant_bills_number_uniq_idx ON consultant_bills(bill_number)'],
    ['consultant_bill_items_bill_idx', 'CREATE INDEX consultant_bill_items_bill_idx ON consultant_bill_items(consultant_bill_id)'],
    ['consultant_bill_items_uniq_idx', 'CREATE UNIQUE INDEX consultant_bill_items_uniq_idx ON consultant_bill_items(consultant_id, patient_bill_id)'],
  ]) {
    try {
      const [[check]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :idxName`,
        { replacements: { idxName } }
      );
      // COUNT(*) comes back as the STRING "0" via the pg driver — `!"0"` is
      // false, so this silently never created a single one of these indexes
      // (including the two UNIQUE ones the employee-number/run-number/
      // consultant-bill-item de-duplication logic actually depends on) until
      // fixed to parse the count instead of testing its truthiness directly.
      if (parseInt(check.cnt, 10) === 0) await sequelize.query(idxSql);
    } catch (e) { /* index creation is best-effort */ }
  }

  // Some tenants' chart of accounts (older template seed) has 5100/5110/2200
  // present but marked inactive, which silently blocks payroll's /pay step
  // with "accounts are missing" even though they exist. Payroll cannot work
  // at all without these three accounts active, so reactivate them here —
  // safe to run on every connection, and self-heals every tenant on deploy
  // without needing a one-off manual DB fix per tenant.
  try {
    await sequelize.query(`
      UPDATE chart_of_accounts SET is_active = true, updated_at = NOW()
      WHERE account_code IN ('5100', '5110', '2200') AND is_active = false
    `);
  } catch (e) { /* chart_of_accounts may not exist yet for this tenant */ }
}

module.exports = { ensureHRTables };
