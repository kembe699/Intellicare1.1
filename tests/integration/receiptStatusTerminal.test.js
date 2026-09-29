/**
 * B3: PUT /:receiptId/status only had reversal logic for an active ->
 * voided/refunded transition — any OTHER transition (voided -> active,
 * refunded -> active, voided -> refunded) fell through to a bare status
 * column update with no accounting undone, leaving a receipt that reads
 * "active" for a payment the bill/GL had already reversed the money for.
 * voided/refunded is now terminal: any transition away from it is rejected
 * before the transaction even opens.
 *
 * This calls the REAL route handler directly (extracted from the Express
 * router's own stack, not a copy of its logic) against tenant_test, since
 * this app has no HTTP-level test harness — matching patientReferrals
 * .test.js's documented convention of reading/driving routes directly rather
 * than through supertest.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let Receipt;
let statusHandler;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  Receipt = testConn.models.Receipt;

  const receiptsRouter = require('../../src/server/routes/receipts');
  const layer = receiptsRouter.stack.find((l) => l.route && l.route.path === '/:receiptId/status' && l.route.methods.put);
  expect(layer).toBeDefined(); // route must still exist under this exact path/method
  statusHandler = layer.route.stack[layer.route.stack.length - 1].handle;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM receipts WHERE receipt_number LIKE 'TERM-%'`);
  } catch (e) { console.warn('receiptStatusTerminal cleanup failed (non-fatal):', e.message); }
});

async function createReceipt(status) {
  return withTenant(() => Receipt.create({
    id: uuid(), receipt_number: `TERM-${Date.now()}-${status}`, clinic_id: TEST_CLINIC_ID,
    payment_date: new Date(), payment_amount: 1000, status,
  }));
}

describe('B3: voided/refunded receipt status is terminal', () => {
  test('voided -> active is rejected', async () => {
    const receipt = await createReceipt('voided');
    const req = { params: { receiptId: receipt.id }, body: { status: 'active' }, user: { id: 1, role: 'admin' } };
    const res = mockRes();
    await withTenant(() => statusHandler(req, res));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/already voided/i);

    const reloaded = await withTenant(() => Receipt.findByPk(receipt.id));
    expect(reloaded.status).toBe('voided'); // unchanged
  });

  test('refunded -> active is rejected', async () => {
    const receipt = await createReceipt('refunded');
    const req = { params: { receiptId: receipt.id }, body: { status: 'active' }, user: { id: 1, role: 'admin' } };
    const res = mockRes();
    await withTenant(() => statusHandler(req, res));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/already refunded/i);
  });

  test('voided -> refunded (crossing terminal states) is also rejected', async () => {
    const receipt = await createReceipt('voided');
    const req = { params: { receiptId: receipt.id }, body: { status: 'refunded' }, user: { id: 1, role: 'admin' } };
    const res = mockRes();
    await withTenant(() => statusHandler(req, res));
    expect(res.statusCode).toBe(400);
  });

  test('re-sending the SAME terminal status is a no-op, not an error', async () => {
    const receipt = await createReceipt('voided');
    const req = { params: { receiptId: receipt.id }, body: { status: 'voided' }, user: { id: 1, role: 'admin' } };
    const res = mockRes();
    await withTenant(() => statusHandler(req, res));
    expect(res.statusCode).not.toBe(400);
  });
});
