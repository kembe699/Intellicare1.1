/**
 * Live report: a bill showed Status: paid / Balance: SSP 0.00, while one of
 * its own line items ("Appendectomy") still showed Status: Unpaid in the
 * Bill Items table — an internally contradictory state. The line had been
 * added (by TheatreService.createRequest's billing call) to a bill whose
 * other 4 lines were already fully paid; the remaining balance was then
 * settled with a single lump "Record Payment" for exactly that line's price,
 * with no items checked. BillDetails.tsx is supposed to auto-attribute an
 * unitemized payment that covers the whole payable balance to every payable
 * line (its own isFullPayment check), but nothing enforced that same
 * invariant server-side — so any caller that doesn't replicate it exactly
 * (a stale client, a direct API call) desyncs bill.status/balance_amount
 * from the per-line paid flags. Worse: once balance_amount hits 0, the
 * existing "payment cannot exceed balance" guard blocks ANY further payment
 * against the bill, so a desynced line could never be paid off afterward.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');
const { normalizeServices } = require('../../src/server/utils/normalizeServices');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let PatientBill;
let CashierShift;
let paymentsHandler;
let cashierUserId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function makeBill(billNumber, services, totalAmount, paidAmount, balanceAmount) {
  return withTenant(() => PatientBill.create({
    clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'BPLS Test Patient',
    bill_number: billNumber, total_amount: totalAmount, paid_amount: paidAmount, balance_amount: balanceAmount,
    status: paidAmount > 0 ? 'partial' : 'pending', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP',
    services,
  }));
}

function paymentReq(billId, body) {
  return {
    params: { billId },
    body: { payment_method: 'cash', payment_date: '2026-01-01', ...body },
    user: { id: cashierUserId, displayName: 'BPLS Test Cashier', role: 'admin' },
    branchContext: { isAdmin: true },
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  PatientBill = testConn.models.PatientBill;
  CashierShift = testConn.models.CashierShift;

  const billsRouter = require('../../src/server/routes/patientBills');
  const layer = billsRouter.stack.find((l) => l.route && l.route.path === '/:billId/payments' && l.route.methods.post);
  paymentsHandler = layer.route.stack[layer.route.stack.length - 1].handle;

  cashierUserId = Math.floor(Math.random() * 1_000_000) + 700_000;
  await withTenant(() => CashierShift.create({ cashier_id: cashierUserId, cashier_name: 'BPLS Test Cashier', status: 'open' }));
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM receipts WHERE bill_id IN (SELECT id FROM patient_bills WHERE bill_number LIKE 'BPLS-%')`);
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'BPLS-%'`);
    await sequelize.query(`DELETE FROM cashier_shifts WHERE cashier_name = 'BPLS Test Cashier'`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%BPLS-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%BPLS-%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%BPLS-%'`);
    await sequelize.query(`DELETE FROM journal_entry_lines WHERE je_id IN (SELECT id FROM journal_entries WHERE description LIKE '%BPLS-%')`);
    await sequelize.query(`DELETE FROM journal_entries WHERE description LIKE '%BPLS-%'`);
  } catch (e) { console.warn('billPaymentLineSync cleanup failed (non-fatal):', e.message); }
});

describe('A lump, unitemized payment that fully settles the bill marks every remaining line paid', () => {
  test('an already-partly-paid bill with one straggling unpaid line gets that line marked paid too', async () => {
    const existingPaid = [
      { line_id: 'l1', serviceName: 'General Consultation', quantity: 1, unitPrice: 50000, totalPrice: 50000, paid: true, status: 'paid' },
      { line_id: 'l2', serviceName: 'Urine General', quantity: 1, unitPrice: 15000, totalPrice: 15000, paid: true, status: 'paid' },
      { line_id: 'l3', serviceName: 'Potassium (K+)', quantity: 1, unitPrice: 40000, totalPrice: 40000, paid: true, status: 'paid' },
      { line_id: 'l4', serviceName: 'Urine General', quantity: 1, unitPrice: 15000, totalPrice: 15000, paid: true, status: 'paid' },
      { line_id: 'l5', serviceName: 'Appendectomy', quantity: 1, unitPrice: 50000, totalPrice: 50000 },
    ];
    const bill = await makeBill(`BPLS-${Date.now()}`, existingPaid, 170000, 120000, 50000);

    // Exactly how the reported case happened: no paidServiceIndexes/paidLineIds
    // sent at all, amount equals the remaining balance.
    const req = paymentReq(bill.id, { amount: 50000 });
    const res = mockRes();
    await withTenant(() => paymentsHandler(req, res));

    expect(res.statusCode).toBe(200);
    const reloaded = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(parseFloat(reloaded.paid_amount)).toBe(170000);
    expect(parseFloat(reloaded.balance_amount)).toBe(0);
    expect(reloaded.status).toBe('paid');

    const services = normalizeServices(reloaded.services);
    const appendectomy = services.find((s) => s.serviceName === 'Appendectomy');
    expect(appendectomy.paid).toBe(true);
    expect(appendectomy.status).toBe('paid');
  });

  test('a partial unitemized payment that does NOT fully settle the bill leaves lines untouched', async () => {
    const services = [
      { line_id: 'l1', serviceName: 'Consultation', quantity: 1, unitPrice: 5000, totalPrice: 5000, paid: true, status: 'paid' },
      { line_id: 'l2', serviceName: 'Lab Panel', quantity: 1, unitPrice: 20000, totalPrice: 20000 },
    ];
    const bill = await makeBill(`BPLS-${Date.now()}`, services, 25000, 5000, 20000);

    const req = paymentReq(bill.id, { amount: 10000 }); // short of the full 20000 balance
    const res = mockRes();
    await withTenant(() => paymentsHandler(req, res));

    expect(res.statusCode).toBe(200);
    const reloaded = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(reloaded.status).toBe('partial');
    const labPanel = normalizeServices(reloaded.services).find((s) => s.serviceName === 'Lab Panel');
    expect(labPanel.paid).toBeFalsy();
  });

  test('a voided or unbilled-insurance line is never marked paid, even once the bill is fully settled', async () => {
    const services = [
      { line_id: 'l1', serviceName: 'Consultation', quantity: 1, unitPrice: 5000, totalPrice: 5000 },
      { line_id: 'l2', serviceName: 'Voided Line', quantity: 1, unitPrice: 3000, totalPrice: 3000, isVoided: true },
      { line_id: 'l3', serviceName: 'Scheme Line', quantity: 1, unitPrice: 0, totalPrice: 0, schemePrice: 9000 },
    ];
    const bill = await makeBill(`BPLS-${Date.now()}`, services, 5000, 0, 5000);

    const req = paymentReq(bill.id, { amount: 5000 });
    const res = mockRes();
    await withTenant(() => paymentsHandler(req, res));

    expect(res.statusCode).toBe(200);
    const reloaded = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(reloaded.status).toBe('paid');
    const reloadedServices = normalizeServices(reloaded.services);
    expect(reloadedServices.find((s) => s.serviceName === 'Voided Line').paid).toBeFalsy();
    expect(reloadedServices.find((s) => s.serviceName === 'Scheme Line').paid).toBeFalsy();
  });

  test('a corrupted services array with stray non-object entries does not crash the payment', async () => {
    // Some older bills carry garbage non-object elements in `services` from a
    // known pre-existing double-stringify bug (see normalizeServices.js) — a
    // string spread into the array one character at a time. The safety net
    // must skip these, not throw trying to set properties on them.
    const services = ['a', 'b', { line_id: 'l1', serviceName: 'Real Line', quantity: 1, unitPrice: 5000, totalPrice: 5000 }];
    const bill = await makeBill(`BPLS-${Date.now()}`, services, 5000, 0, 5000);

    const req = paymentReq(bill.id, { amount: 5000 });
    const res = mockRes();
    await withTenant(() => paymentsHandler(req, res));

    expect(res.statusCode).toBe(200);
    const reloaded = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(reloaded.status).toBe('paid');
    const realLine = normalizeServices(reloaded.services).find((s) => s && s.serviceName === 'Real Line');
    expect(realLine.paid).toBe(true);
  });
});
