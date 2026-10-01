/**
 * Regression test for the bug found via accountingHealthCheck.js on the
 * "nation" tenant: billingEnhanced.js's recalculateBillTotals summed
 * bill_line_items (a table bills created the normal way — POST /patient-bills,
 * using the `services` JSON column — never populate) and unconditionally wrote
 * that sum, including zero, into patient_bills.total_amount. Hitting any of
 * the (frontend-unreachable) /bills/:billId/line-items routes for a normal
 * bill therefore zeroed its total while its GL revenue stayed fully posted at
 * the original amount — exactly the "posted 18000.00 vs bill 0.00" signature
 * the health check caught for 3 real bills.
 *
 * recalculateBillTotals uses `require('../models')`'s tenant-context-Proxy'd
 * sequelize, which outside tenantContext.run() falls back to the DEFAULT
 * connection (always schema tenant_template — see config/database.js), not
 * wherever tests/setup/testDb.js happens to point. Wrapping the call in
 * tenantContext.run(testConn, ...) against tenant_test, the same pattern
 * billCreationAtomicity.test.js uses, is what makes this test actually
 * exercise the function against the fixtures it creates.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;

let sequelize;
let testConn;
let recalculateBillTotals;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function testBillId() {
  return 't-' + uuid().replace(/-/g, '').slice(0, 34);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  // Resolves require('../models') to the tenant-aware Proxy; only matters
  // once a call actually runs inside tenantContext.run().
  ({ recalculateBillTotals } = require('../../src/server/routes/billingEnhanced'));
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM bill_line_items WHERE bill_id LIKE 't-%'`);
    await sequelize.query(`DELETE FROM patient_bills WHERE id LIKE 't-%'`);
  } catch (e) { console.warn('cleanup failed (non-fatal):', e.message); }
});

async function createBill(overrides = {}) {
  const id = testBillId();
  const data = {
    id,
    clinic_id: TEST_CLINIC_ID,
    patient_id: testBillId(),
    patient_name: 'Test Patient',
    bill_number: 'TBILL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    total_amount: 5000,
    paid_amount: 0,
    balance_amount: 5000,
    status: 'pending',
    bill_date: new Date().toISOString().split('T')[0],
    created_by: 'test-system',
    ...overrides,
    id, // id is never overridable
  };
  await sequelize.query(
    `INSERT INTO patient_bills (id, clinic_id, patient_id, patient_name, bill_number,
       total_amount, paid_amount, balance_amount, status, bill_date, created_by, created_at, updated_at)
     VALUES (:id, :clinic_id, :patient_id, :patient_name, :bill_number,
       :total_amount, :paid_amount, :balance_amount, :status, :bill_date, :created_by, NOW(), NOW())`,
    { replacements: data }
  );
  return data;
}

describe('billingEnhanced.recalculateBillTotals', () => {
  test('does not zero a bill that has no bill_line_items rows (the nation bug)', async () => {
    const bill = await createBill({ total_amount: 18000, paid_amount: 0, balance_amount: 18000, status: 'pending' });

    await withTenant(() => recalculateBillTotals(bill.id, undefined));

    const [[row]] = await sequelize.query(
      `SELECT total_amount, balance_amount, status FROM patient_bills WHERE id = :id`,
      { replacements: { id: bill.id } }
    );
    expect(parseFloat(row.total_amount)).toBe(18000);
    expect(parseFloat(row.balance_amount)).toBe(18000);
    expect(row.status).toBe('pending');
  });

  test('still recalculates correctly when bill_line_items genuinely has rows', async () => {
    const bill = await createBill({ total_amount: 5000, paid_amount: 0, balance_amount: 5000, status: 'pending' });
    await sequelize.query(
      `INSERT INTO bill_line_items (id, bill_id, service_category, service_name, line_total, item_status)
       VALUES (:id, :billId, 'other', 'Test charge', 1234, 'pending')`,
      { replacements: { id: testBillId(), billId: bill.id } }
    );

    await withTenant(() => recalculateBillTotals(bill.id, undefined));

    const [[row]] = await sequelize.query(
      `SELECT total_amount, balance_amount FROM patient_bills WHERE id = :id`,
      { replacements: { id: bill.id } }
    );
    expect(parseFloat(row.total_amount)).toBe(1234);
    expect(parseFloat(row.balance_amount)).toBe(1234);
  });
});
