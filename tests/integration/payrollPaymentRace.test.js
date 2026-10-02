/**
 * Audit finding: payOnePayrollLine checked line.status === 'paid' in the
 * CALLER, then posted a GL entry, then updated the line's status — no row
 * lock and no transaction spanned the gap, so two near-simultaneous calls
 * for the same line (an admin clicking Pay while the employee submits their
 * own QR signing link, or a double-click/retry) could both pass the status
 * check before either write landed, producing two GL entries and two
 * postings for the same payroll line.
 *
 * Fixed with a FOR UPDATE row lock + re-check inside a transaction shared
 * with the GL entry creation and the status flip — a concurrent call
 * against the same line now serializes, and the loser sees the
 * already-'paid' status and is rejected with a 409.
 *
 * Also covers the co-located branch_id gap: createGLEntry's call here never
 * passed the run's branch_id, so payroll GL entries always posted with
 * branch_id NULL regardless of which branch the run belonged to.
 *
 * Calls the REAL service function directly against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');
const { resolvePayrollAccounts, payOnePayrollLine } = require('../../src/server/services/PayrollPayment');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_BRANCH_ID = 909101;

let sequelize;
let testConn;
let accounts;
let paymentAccountId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

async function makeEmployee() {
  const id = uuid();
  await sequelize.query(
    `INSERT INTO employees (id, clinic_id, employee_number, first_name, last_name, employment_type)
     VALUES (:id, :c, :num, 'PayrollRace', 'TestEmployee', 'staff')`,
    { replacements: { id, c: TEST_CLINIC_ID, num: `PAYROLLRACE-${Date.now()}-${Math.random()}` } }
  );
  return id;
}

async function makeRunAndLine() {
  const runId = uuid();
  await sequelize.query(
    `INSERT INTO payroll_runs (id, clinic_id, branch_id, run_number, period_month, period_year, run_date, status, payment_account_id)
     VALUES (:id, :c, :b, :num, 1, 2026, '2026-01-31', 'approved', :paymentAccountId)`,
    { replacements: { id: runId, c: TEST_CLINIC_ID, b: TEST_BRANCH_ID, num: `PAYROLLRACE-RUN-${Date.now()}`, paymentAccountId } }
  );
  const employeeId = await makeEmployee();
  const lineId = uuid();
  await sequelize.query(
    `INSERT INTO payroll_run_lines (id, payroll_run_id, employee_id, basic_salary, allowances_total, deductions_total, gross_pay, net_pay, currency, status)
     VALUES (:id, :runId, :employeeId, 1000, 0, 0, 1000, 1000, 'USD', 'unpaid')`,
    { replacements: { id: lineId, runId, employeeId } }
  );
  const [[line]] = await sequelize.query(`
    SELECT prl.*, e.employment_type, e.first_name, e.last_name, e.employee_number
    FROM payroll_run_lines prl JOIN employees e ON e.id = prl.employee_id
    WHERE prl.id = :id
  `, { replacements: { id: lineId } });
  const [[run]] = await sequelize.query(`SELECT * FROM payroll_runs WHERE id = :id`, { replacements: { id: runId } });
  return { run, line };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  accounts = await withTenant(() => resolvePayrollAccounts(TEST_CLINIC_ID));
  const [[cashAccount]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1100' LIMIT 1`, { replacements: { c: TEST_CLINIC_ID } });
  paymentAccountId = cashAccount?.id || accounts.payrollLiabilitiesAccount.id;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%PAYROLLRACE%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%PAYROLLRACE%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%PAYROLLRACE%'`);
    await sequelize.query(`DELETE FROM payroll_run_lines WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE run_number LIKE 'PAYROLLRACE-%')`);
    await sequelize.query(`DELETE FROM payroll_runs WHERE run_number LIKE 'PAYROLLRACE-%'`);
    await sequelize.query(`DELETE FROM employees WHERE employee_number LIKE 'PAYROLLRACE-%'`);
  } catch (e) { console.warn('payrollPaymentRace cleanup failed (non-fatal):', e.message); }
});

describe('payOnePayrollLine cannot be run twice for the same line', () => {
  test('two concurrent pay attempts: exactly one succeeds, the other is rejected, only one GL entry exists', async () => {
    const { run, line } = await makeRunAndLine();

    const attempt = () => withTenant(() => payOnePayrollLine(sequelize, TEST_CLINIC_ID, run, line, accounts, 'USD', paymentAccountId, 1));
    const results = await Promise.allSettled([attempt(), attempt()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason.statusCode).toBe(409);

    const [glRows] = await sequelize.query(
      `SELECT id FROM general_ledger WHERE reference_id = :lineId AND reference_module = 'payroll_run_line'`,
      { replacements: { lineId: line.id } }
    );
    expect(glRows.length).toBe(1);

    const [[reloadedLine]] = await sequelize.query(`SELECT status FROM payroll_run_lines WHERE id = :id`, { replacements: { id: line.id } });
    expect(reloadedLine.status).toBe('paid');
  });

  test('paying an already-paid line is rejected, not double-posted', async () => {
    const { run, line } = await makeRunAndLine();
    await withTenant(() => payOnePayrollLine(sequelize, TEST_CLINIC_ID, run, line, accounts, 'USD', paymentAccountId, 1));

    await expect(withTenant(() => payOnePayrollLine(sequelize, TEST_CLINIC_ID, run, line, accounts, 'USD', paymentAccountId, 1)))
      .rejects.toMatchObject({ statusCode: 409 });

    const [glRows] = await sequelize.query(
      `SELECT id FROM general_ledger WHERE reference_id = :lineId AND reference_module = 'payroll_run_line'`,
      { replacements: { lineId: line.id } }
    );
    expect(glRows.length).toBe(1);
  });

  test('the GL entry carries the payroll run\'s branch_id', async () => {
    const { run, line } = await makeRunAndLine();
    const glEntry = await withTenant(() => payOnePayrollLine(sequelize, TEST_CLINIC_ID, run, line, accounts, 'USD', paymentAccountId, 1));

    const [ledgerRows] = await sequelize.query(
      `SELECT branch_id FROM account_ledger WHERE transaction_id = :id`,
      { replacements: { id: glEntry.id } }
    );
    expect(ledgerRows.length).toBeGreaterThan(0);
    expect(ledgerRows.every((r) => r.branch_id === TEST_BRANCH_ID)).toBe(true);
  });
});
