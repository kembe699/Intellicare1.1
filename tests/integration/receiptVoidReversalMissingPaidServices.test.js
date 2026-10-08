/**
 * R1: applyVoidReversal() in receipts.js only reversed individual line
 * items' `paid` flags when receipt.paid_services had entries. A real
 * client-reported bug (bill BILL-2026-949716, Nation tenant): when a
 * receipt's paid_services came back empty (older receipt, or a payment
 * recorded through a path that never attributed it to specific lines),
 * voiding it correctly reversed the bill's paid_amount/balance/status but
 * left every line item stuck showing "Paid" forever — which ALSO meant
 * reports kept counting that line's revenue as collected indefinitely
 * (collectedForItem() checks item.paid first).
 *
 * The fix: when paid_services is empty, reverse every currently-paid line
 * ONLY if this is the sole active receipt on the bill (nothing else could
 * have legitimately paid any of them); if other active receipts exist,
 * leave the lines untouched and log a warning rather than guessing.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app) against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');
const { normalizeServices } = require('../../src/server/utils/normalizeServices');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const PAYMENT_AMOUNT = 50000;

let sequelize;
let testConn;
let Receipt;
let PatientBill;
let statusHandler;
let adminUserId;

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

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  Receipt = testConn.models.Receipt;
  PatientBill = testConn.models.PatientBill;

  const receiptsRouter = require('../../src/server/routes/receipts');
  statusHandler = handlerFor(receiptsRouter, '/:receiptId/status', 'put');

  adminUserId = Math.floor(Math.random() * 1_000_000) + 900_000;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'VOIDMISSING-%'`);
    await sequelize.query(`DELETE FROM receipts WHERE receipt_number LIKE 'VOIDMISSING-%'`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%VOIDMISSING-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%VOIDMISSING-%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%VOIDMISSING-%'`);
  } catch (e) { console.warn('receiptVoidReversalMissingPaidServices cleanup failed (non-fatal):', e.message); }
});

async function makeBill(suffix, { totalAmount, paidAmount, services }) {
  return withTenant(() => PatientBill.create({
    clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'VoidMissing Test Patient',
    bill_number: `VOIDMISSING-${suffix}`, total_amount: totalAmount, paid_amount: paidAmount,
    balance_amount: totalAmount - paidAmount,
    status: paidAmount >= totalAmount ? 'paid' : 'partial', bill_date: '2026-01-01',
    created_by: 'test-system', bill_currency: 'SSP', services,
  }));
}

function makeReceipt(suffix, { billId, amount, paidServices }) {
  return withTenant(() => Receipt.create({
    id: uuid(), receipt_number: `VOIDMISSING-${suffix}`, clinic_id: TEST_CLINIC_ID,
    bill_id: billId, payment_date: new Date(), payment_amount: amount,
    payment_method: 'cash', paid_services: paidServices, status: 'active',
  }));
}

describe('R1: void reversal fallback when receipt.paid_services is empty', () => {
  test('sole active receipt on the bill: empty paid_services reverses ALL paid line items', async () => {
    const suffix = `SOLE-${Date.now()}`;
    const services = [
      { serviceName: 'Pediatric Consultation', totalPrice: PAYMENT_AMOUNT, paid: true },
      { serviceName: 'Lab Test', totalPrice: PAYMENT_AMOUNT, paid: true },
    ];
    const bill = await makeBill(suffix, { totalAmount: PAYMENT_AMOUNT * 2, paidAmount: PAYMENT_AMOUNT * 2, services });
    const receipt = await makeReceipt(suffix, { billId: bill.id, amount: PAYMENT_AMOUNT * 2, paidServices: [] });

    const req = { params: { receiptId: receipt.id }, body: { status: 'voided', reason: 'test — cancelled bill' }, user: { id: adminUserId, role: 'admin', displayName: 'Admin' } };
    const res = mockRes();
    await withTenant(() => statusHandler(req, res));

    expect(res.statusCode).toBe(200);
    expect(res.body.receipt.status).toBe('voided');

    const reloadedBill = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(parseFloat(reloadedBill.paid_amount)).toBe(0);
    expect(reloadedBill.status).toBe('pending');
    // The actual bug: without the fix, these stayed `paid: true` forever.
    for (const item of normalizeServices(reloadedBill.services)) {
      expect(item.paid).toBe(false);
      expect(item.paidAt).toBeUndefined();
      expect(item.status).toBeUndefined();
    }
  });

  test('other active receipts exist on the bill: empty paid_services leaves line items unchanged', async () => {
    const suffix = `MULTI-${Date.now()}`;
    const services = [
      { serviceName: 'Consultation A', totalPrice: PAYMENT_AMOUNT, paid: true },
      { serviceName: 'Consultation B', totalPrice: PAYMENT_AMOUNT, paid: true },
    ];
    const bill = await makeBill(suffix, { totalAmount: PAYMENT_AMOUNT * 2, paidAmount: PAYMENT_AMOUNT * 2, services });
    // A still-active receipt legitimately covering the OTHER line (correctly attributed).
    await makeReceipt(`${suffix}-OTHER`, { billId: bill.id, amount: PAYMENT_AMOUNT, paidServices: [1] });
    // The receipt we're about to void has no attribution recorded.
    const receiptToVoid = await makeReceipt(`${suffix}-VOID`, { billId: bill.id, amount: PAYMENT_AMOUNT, paidServices: [] });

    const req = { params: { receiptId: receiptToVoid.id }, body: { status: 'voided', reason: 'test — ambiguous attribution' }, user: { id: adminUserId, role: 'admin', displayName: 'Admin' } };
    const res = mockRes();
    await withTenant(() => statusHandler(req, res));

    expect(res.statusCode).toBe(200);
    expect(res.body.receipt.status).toBe('voided');

    const reloadedBill = await withTenant(() => PatientBill.findByPk(bill.id));
    // Bill-level balance still correctly reverses this receipt's amount.
    expect(parseFloat(reloadedBill.paid_amount)).toBe(PAYMENT_AMOUNT);
    // But since which line THIS receipt covered is unknowable, nothing was guessed —
    // both lines stay exactly as they were (still paid), rather than wrongly un-paying
    // the line the OTHER active receipt legitimately covers.
    for (const item of normalizeServices(reloadedBill.services)) {
      expect(item.paid).toBe(true);
    }
  });
});
