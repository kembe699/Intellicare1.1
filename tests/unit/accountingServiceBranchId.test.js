/**
 * AccountingService.createGLEntry's AccountLedger.create() call never read
 * glData.branch_id, so every account_ledger row ever posted through it had
 * branch_id = NULL — regardless of what any caller passed. Every
 * branch-scoped financial report (both Income Statement variants, trial
 * balance, balance sheet) filters on account_ledger.branch_id, so a
 * branch-scoped viewer saw 0 for real revenue/expenses while the dashboard
 * (which reads receipts directly, not the ledger) kept showing real totals —
 * reported in production on the "nation" tenant.
 *
 * Same connection pattern as billCreationAtomicity.test.js: AccountingService
 * resolves require('../models') to the tenant-context Proxy, which only sees
 * a real connection from inside tenantContext.run() against a getTenantConnection
 * connection — not tests/setup/testDb.js's separate one.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;

let sequelize;
let testConn;
let AccountingService;
let testBranchId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  AccountingService = require('../../src/server/services/AccountingService');

  const [[branch]] = await sequelize.query(
    `INSERT INTO branches (name, is_active) VALUES ('t-BranchIdRegressionTest', true) RETURNING id`
  );
  testBranchId = branch.id;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM account_ledger WHERE description LIKE '%BRANCHID-TEST%'`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%BRANCHID-TEST%'`);
    await sequelize.query(`DELETE FROM branches WHERE id = :id`, { replacements: { id: testBranchId } });
  } catch (e) { console.warn('cleanup failed (non-fatal):', e.message); }
});

describe('AccountingService.createGLEntry branch_id', () => {
  test('stores branch_id on every account_ledger line when glData.branch_id is given', async () => {
    const [[revenueAccount]] = await sequelize.query(
      `SELECT id FROM chart_of_accounts WHERE clinic_id = :cid AND account_type = 'revenue' AND is_active = true LIMIT 1`,
      { replacements: { cid: TEST_CLINIC_ID } }
    );
    const [[cashAccount]] = await sequelize.query(
      `SELECT id FROM chart_of_accounts WHERE clinic_id = :cid AND account_code = '1100' LIMIT 1`,
      { replacements: { cid: TEST_CLINIC_ID } }
    );

    const glEntry = await withTenant(() =>
      AccountingService.createGLEntry(
        {
          clinic_id: TEST_CLINIC_ID,
          transaction_date: new Date(),
          transaction_type: 'test',
          description: 'BRANCHID-TEST entry',
          reference_id: uuid(),
          reference_module: 'patient_billing',
          branch_id: testBranchId,
        },
        [
          { account_id: cashAccount.id, debit_amount: 1000, credit_amount: 0, description: 'BRANCHID-TEST debit' },
          { account_id: revenueAccount.id, debit_amount: 0, credit_amount: 1000, description: 'BRANCHID-TEST credit' },
        ],
        'test-system'
      )
    );

    const [rows] = await sequelize.query(
      `SELECT branch_id FROM account_ledger WHERE transaction_id = :glId`,
      { replacements: { glId: glEntry.id } }
    );
    expect(rows.length).toBe(2);
    for (const row of rows) expect(Number(row.branch_id)).toBe(Number(testBranchId));
  });

  test('createGLFromPatientBill threads billData.branch_id through to account_ledger', async () => {
    const billId = 't-' + uuid().replace(/-/g, '').slice(0, 34);
    const billData = {
      id: billId,
      clinic_id: TEST_CLINIC_ID,
      branch_id: testBranchId,
      patient_id: uuid(),
      bill_number: 'BRANCHID-TEST-' + Date.now(),
      patient_name: 'Branch Id Test Patient',
      total_amount: 2500,
      bill_date: new Date().toISOString().split('T')[0],
      services: [{ serviceName: 'Consultation', totalPrice: 2500 }],
    };

    await withTenant(() => AccountingService.createGLFromPatientBill(billData, 'test-system'));

    const [rows] = await sequelize.query(
      `SELECT al.branch_id
         FROM account_ledger al
         JOIN general_ledger gl ON gl.id = al.transaction_id
        WHERE gl.reference_id = :billId AND gl.reference_module = 'patient_billing'`,
      { replacements: { billId } }
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Number(row.branch_id)).toBe(Number(testBranchId));

    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE reference_id = :billId)`, { replacements: { billId } });
    await sequelize.query(`DELETE FROM general_ledger WHERE reference_id = :billId`, { replacements: { billId } });
    await sequelize.query(`DELETE FROM patient_receivables WHERE bill_id = :billId`, { replacements: { billId } }).catch(() => {});
  });
});
