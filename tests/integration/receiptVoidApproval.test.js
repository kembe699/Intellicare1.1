/**
 * B5: PUT /:receiptId/status used to let ANY authorized user (anyone holding
 * receipts.write) void/refund a receipt in one step, immediately reversing
 * the payment — a cashier could void/refund their own payment unilaterally,
 * with no record that a second person ever looked at it. A requester who
 * does NOT hold the new receipt_void_approve grant now only files a request
 * (status flips to pending_void/pending_refund, nothing on the bill/GL is
 * touched yet); a holder of that grant (or an admin, per
 * requireApprovalPermission's own bypass rule) must call the new
 * /approve-void endpoint before the reversal actually runs, or /reject-void
 * to send it back to active with nothing reversed.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app) against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const PAYMENT_AMOUNT = 5000;

let sequelize;
let testConn;
let Receipt;
let PatientBill;
let statusHandler;
let approveHandler;
let rejectHandler;
let unprivilegedUserId;
let privilegedUserId;

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
  approveHandler = handlerFor(receiptsRouter, '/:receiptId/approve-void', 'post');
  rejectHandler = handlerFor(receiptsRouter, '/:receiptId/reject-void', 'post');

  unprivilegedUserId = Math.floor(Math.random() * 1_000_000) + 700_000;
  privilegedUserId = Math.floor(Math.random() * 1_000_000) + 800_000;
  await sequelize.query(
    `INSERT INTO approval_permissions (id, clinic_id, user_id, approval_type, granted_by) VALUES (:id, :c, :u, 'receipt_void_approve', :u)`,
    { replacements: { id: uuid(), c: TEST_CLINIC_ID, u: privilegedUserId } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM approval_permissions WHERE approval_type = 'receipt_void_approve' AND user_id = :u`, { replacements: { u: privilegedUserId } });
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'VOIDAPPROVE-%'`);
    await sequelize.query(`DELETE FROM receipts WHERE receipt_number LIKE 'VOIDAPPROVE-%'`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%VOIDAPPROVE-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%VOIDAPPROVE-%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%VOIDAPPROVE-%'`);
    await sequelize.query(`DELETE FROM journal_entry_lines WHERE je_id IN (SELECT id FROM journal_entries WHERE reference LIKE 'VOIDAPPROVE-%')`);
    await sequelize.query(`DELETE FROM journal_entries WHERE reference LIKE 'VOIDAPPROVE-%'`);
  } catch (e) { console.warn('receiptVoidApproval cleanup failed (non-fatal):', e.message); }
});

async function setUpBillAndReceipt(suffix) {
  const billNumber = `VOIDAPPROVE-${suffix}`;
  const bill = await withTenant(() => PatientBill.create({
    clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'VoidApprove Test Patient',
    bill_number: billNumber, total_amount: PAYMENT_AMOUNT, paid_amount: PAYMENT_AMOUNT, balance_amount: 0,
    status: 'paid', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP',
    services: [{ serviceName: 'VOIDAPPROVE Test Service', totalPrice: PAYMENT_AMOUNT, paid: true }],
  }));
  const receipt = await withTenant(() => Receipt.create({
    id: uuid(), receipt_number: `VOIDAPPROVE-${suffix}`, clinic_id: TEST_CLINIC_ID,
    bill_id: bill.id, payment_date: new Date(), payment_amount: PAYMENT_AMOUNT,
    payment_method: 'cash', paid_services: [0], status: 'active',
  }));
  return { bill, receipt };
}

describe('B5: void/refund requires a second person\'s approval', () => {
  test('an unprivileged requester\'s void only files a request — nothing is reversed yet', async () => {
    const { bill, receipt } = await setUpBillAndReceipt(`REQ-${Date.now()}`);

    const req = { params: { receiptId: receipt.id }, body: { status: 'voided', reason: 'test request' }, user: { id: unprivilegedUserId, role: 'cashier', displayName: 'Unprivileged Cashier' } };
    const res = mockRes();
    await withTenant(() => statusHandler(req, res));

    expect(res.statusCode).toBe(200);
    expect(res.body.pendingApproval).toBe(true);
    expect(res.body.receipt.status).toBe('pending_void');

    // Nothing on the bill has moved — the reversal has not run.
    const reloadedBill = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(parseFloat(reloadedBill.paid_amount)).toBe(PAYMENT_AMOUNT);
    expect(reloadedBill.status).toBe('paid');
  });

  test('a privileged user can still void immediately, in one step (unchanged for authorized staff)', async () => {
    const { bill, receipt } = await setUpBillAndReceipt(`IMM-${Date.now()}`);

    const req = { params: { receiptId: receipt.id }, body: { status: 'voided', reason: 'immediate' }, user: { id: privilegedUserId, role: 'cashier', displayName: 'Privileged Supervisor' } };
    const res = mockRes();
    await withTenant(() => statusHandler(req, res));

    expect(res.statusCode).toBe(200);
    expect(res.body.pendingApproval).toBeUndefined();
    expect(res.body.receipt.status).toBe('voided');

    const reloadedBill = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(parseFloat(reloadedBill.paid_amount)).toBe(0);
  });

  test('an admin bypasses the approval gate too', async () => {
    const { receipt } = await setUpBillAndReceipt(`ADMIN-${Date.now()}`);
    const req = { params: { receiptId: receipt.id }, body: { status: 'voided' }, user: { id: 999999, role: 'admin', displayName: 'Admin' } };
    const res = mockRes();
    await withTenant(() => statusHandler(req, res));
    expect(res.body.receipt.status).toBe('voided');
    expect(res.body.pendingApproval).toBeUndefined();
  });

  test('approving a pending request runs the reversal', async () => {
    const { bill, receipt } = await setUpBillAndReceipt(`APPROVE-${Date.now()}`);

    const reqReq = { params: { receiptId: receipt.id }, body: { status: 'refunded' }, user: { id: unprivilegedUserId, role: 'cashier' } };
    await withTenant(() => statusHandler(reqReq, mockRes()));

    const approveReq = { params: { receiptId: receipt.id }, body: { reason: 'confirmed with patient' }, user: { id: privilegedUserId, role: 'cashier', displayName: 'Approver' } };
    const approveRes = mockRes();
    await withTenant(() => approveHandler(approveReq, approveRes));

    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.body.receipt.status).toBe('refunded');

    const reloadedBill = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(parseFloat(reloadedBill.paid_amount)).toBe(0);
    expect(reloadedBill.status).toBe('pending');
  });

  test('rejecting a pending request returns it to active with nothing reversed', async () => {
    const { bill, receipt } = await setUpBillAndReceipt(`REJECT-${Date.now()}`);

    const reqReq = { params: { receiptId: receipt.id }, body: { status: 'voided' }, user: { id: unprivilegedUserId, role: 'cashier' } };
    await withTenant(() => statusHandler(reqReq, mockRes()));

    const rejectReq = { params: { receiptId: receipt.id }, body: { reason: 'not a mistake after all' }, user: { id: privilegedUserId, role: 'cashier' } };
    const rejectRes = mockRes();
    await withTenant(() => rejectHandler(rejectReq, rejectRes));

    expect(rejectRes.statusCode).toBe(200);
    expect(rejectRes.body.receipt.status).toBe('active');

    const reloadedBill = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(parseFloat(reloadedBill.paid_amount)).toBe(PAYMENT_AMOUNT); // untouched throughout
  });

  test('an unprivileged user cannot approve or reject their own request', async () => {
    const { receipt } = await setUpBillAndReceipt(`SELFAPPROVE-${Date.now()}`);
    const reqReq = { params: { receiptId: receipt.id }, body: { status: 'voided' }, user: { id: unprivilegedUserId, role: 'cashier' } };
    await withTenant(() => statusHandler(reqReq, mockRes()));

    // approve-void/reject-void are mounted behind requireApprovalPermission
    // middleware, which we bypass by extracting the terminal handler — so
    // this asserts the middleware itself denies it, called directly.
    const { requireApprovalPermission } = require('../../src/server/middleware/requireApprovalPermission');
    const gate = requireApprovalPermission('receipt_void_approve');
    const req = { user: { id: unprivilegedUserId, role: 'cashier' } };
    const res = mockRes();
    let nextCalled = false;
    await gate(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
