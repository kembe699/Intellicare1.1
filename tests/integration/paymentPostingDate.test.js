/**
 * B6: the payment-posting GL/JE entry used to always be dated "today" (the
 * server's own clock, in UTC) regardless of what payment_date the cashier
 * actually entered on the receipt — a backdated end-of-day reconciliation,
 * or a payment taken just after local midnight while the server's UTC clock
 * still reads the previous day, landed the ledger entry on the wrong
 * calendar date, disagreeing with the receipt's own printed date and
 * potentially landing revenue in the wrong accounting period. The posting
 * now uses payment_date directly.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app) against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const BACKDATED_PAYMENT_DATE = '2020-03-15'; // deliberately not "today", however this test happens to run

let sequelize;
let testConn;
let PatientBill;
let CashierShift;
let paymentsHandler;

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
  PatientBill = testConn.models.PatientBill;
  CashierShift = testConn.models.CashierShift;

  const billsRouter = require('../../src/server/routes/patientBills');
  const layer = billsRouter.stack.find((l) => l.route && l.route.path === '/:billId/payments' && l.route.methods.post);
  expect(layer).toBeDefined();
  paymentsHandler = layer.route.stack[layer.route.stack.length - 1].handle;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM receipts WHERE bill_id IN (SELECT id FROM patient_bills WHERE bill_number LIKE 'PAYDATE-%')`);
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'PAYDATE-%'`);
    await sequelize.query(`DELETE FROM cashier_shifts WHERE cashier_name = 'PAYDATE Test Cashier'`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%PAYDATE-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%PAYDATE-%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%PAYDATE-%'`);
    await sequelize.query(`DELETE FROM journal_entry_lines WHERE je_id IN (SELECT id FROM journal_entries WHERE description LIKE '%PAYDATE-%')`);
    await sequelize.query(`DELETE FROM journal_entries WHERE description LIKE '%PAYDATE-%'`);
  } catch (e) { console.warn('paymentPostingDate cleanup failed (non-fatal):', e.message); }
});

test('B6: the JE posted for a payment is dated the payment\'s own payment_date, not server "today"', async () => {
  const cashierUserId = Math.floor(Math.random() * 1_000_000) + 500_000;
  await withTenant(() => CashierShift.create({
    cashier_id: cashierUserId, cashier_name: 'PAYDATE Test Cashier', status: 'open',
  }));

  const billNumber = `PAYDATE-${Date.now()}`;
  const bill = await withTenant(() => PatientBill.create({
    clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'PAYDATE Test Patient',
    bill_number: billNumber, total_amount: 3000, paid_amount: 0, balance_amount: 3000,
    status: 'pending', bill_date: BACKDATED_PAYMENT_DATE, created_by: 'test-system', bill_currency: 'SSP',
    services: [{ serviceName: 'PAYDATE Test Service', totalPrice: 3000 }],
  }));

  const req = {
    params: { billId: bill.id },
    body: {
      amount: 3000, payment_method: 'cash', payment_date: BACKDATED_PAYMENT_DATE,
      paidServiceIndexes: [0],
    },
    user: { id: cashierUserId, displayName: 'PAYDATE Test Cashier', role: 'admin' },
    branchContext: { isAdmin: true },
  };
  const res = mockRes();
  await withTenant(() => paymentsHandler(req, res));

  expect(res.statusCode).toBe(200);

  const [[je]] = await sequelize.query(
    `SELECT entry_date::text FROM journal_entries WHERE description LIKE :d ORDER BY created_at DESC LIMIT 1`,
    { replacements: { d: `%Bill ${bill.id}%` } }
  );
  expect(je).toBeDefined();
  expect(je.entry_date).toBe(BACKDATED_PAYMENT_DATE);

  const [[ledgerRow]] = await sequelize.query(
    `SELECT transaction_date::text FROM account_ledger WHERE reference_number = (SELECT je_number FROM journal_entries WHERE description LIKE :d ORDER BY created_at DESC LIMIT 1) LIMIT 1`,
    { replacements: { d: `%Bill ${bill.id}%` } }
  );
  expect(ledgerRow.transaction_date).toBe(BACKDATED_PAYMENT_DATE);
});
