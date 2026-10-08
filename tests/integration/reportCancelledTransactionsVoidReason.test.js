/**
 * Cancelled Invoices (reportCancelledTransactions.js's voidedLineItems) now
 * surfaces the void reason captured on a bill line item — patientBills.js's
 * POST /:billId/void-item already stored `voidReason` on the JSON line item,
 * but this report dropped it before it ever reached the response.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;
const TEST_DATE = '2031-07-09';

let sequelize;
let testConn;
let getHandler;
let billId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function handlerFor(router, routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(query) {
  return {
    params: {}, body: {}, query,
    user: { id: 1, displayName: 'Void Reason Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/reportCancelledTransactions');
  getHandler = handlerFor(router, '/', 'get');

  billId = uuid();
  const services = [
    { serviceName: 'Test Voided Service', totalPrice: 7000, isVoided: true, voidReason: 'Billed in error — wrong patient' },
  ];
  await sequelize.query(
    `INSERT INTO patient_bills (id, bill_number, patient_id, patient_name, clinic_id, bill_date, total_amount, paid_amount, balance_amount, status, services, updated_by, created_by, created_at, updated_at)
     VALUES (:id, :billNumber, :patientId, 'Void Reason Patient', :clinicId, :date, 0, 0, 0, 'paid', :services, 'tester', 'test', NOW(), NOW())`,
    { replacements: { id: billId, billNumber: `BILL-VOIDREASON-${billId.slice(0, 8)}`, patientId: uuid(), clinicId: TEST_CLINIC_ID, date: TEST_DATE, services: JSON.stringify(services) } }
  );
}, 30000);

afterAll(async () => {
  try {
    if (billId) await sequelize.query(`DELETE FROM patient_bills WHERE id = :id`, { replacements: { id: billId } });
  } catch (e) { console.warn('reportCancelledTransactionsVoidReason cleanup failed (non-fatal):', e.message); }
});

describe('GET /api/reports-v2/cancelled-transactions — voidedLineItems', () => {
  test('surfaces the voidReason captured on the bill line item', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE }), res));
    expect(res.statusCode).toBe(200);

    const line = res.body.voidedLineItems.find((v) => v.billId === billId);
    expect(line).toBeTruthy();
    expect(line.reason).toBe('Billed in error — wrong patient');
  });
});
