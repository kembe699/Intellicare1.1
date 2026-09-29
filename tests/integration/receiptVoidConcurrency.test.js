/**
 * B2: PUT /:receiptId/status used to read the receipt (and the bill it
 * reverses) with no row lock at all. Two void/refund requests landing close
 * together for the SAME receipt — a double-click, or two staff acting on the
 * same payment within the same second — both read status === 'active', both
 * passed, and both ran the full reversal: the bill's paid_amount got
 * decremented twice for one real payment, and the GL reversal got posted
 * twice. The handler now opens its transaction and locks the receipt (and,
 * inside the reversal branch, the bill) with SELECT ... FOR UPDATE before
 * reading anything, so a second concurrent request blocks until the first
 * commits and then re-reads the now-already-voided row — landing on B3's
 * terminal-state no-op instead of double-reversing.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), firing two invocations
 * genuinely concurrently (Promise.all, same pattern as glNumbering.test.js's
 * concurrent-allocation proof) against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const PAYMENT_AMOUNT = 4000;

let sequelize;
let testConn;
let Receipt;
let PatientBill;
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
  PatientBill = testConn.models.PatientBill;

  const receiptsRouter = require('../../src/server/routes/receipts');
  const layer = receiptsRouter.stack.find((l) => l.route && l.route.path === '/:receiptId/status' && l.route.methods.put);
  statusHandler = layer.route.stack[layer.route.stack.length - 1].handle;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'VOIDRACE-%'`);
    await sequelize.query(`DELETE FROM receipts WHERE receipt_number LIKE 'VOIDRACE-%'`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%VOIDRACE-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%VOIDRACE-%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%VOIDRACE-%'`);
    await sequelize.query(`DELETE FROM journal_entry_lines WHERE je_id IN (SELECT id FROM journal_entries WHERE reference LIKE 'VOIDRACE-%')`);
    await sequelize.query(`DELETE FROM journal_entries WHERE reference LIKE 'VOIDRACE-%'`);
  } catch (e) { console.warn('receiptVoidConcurrency cleanup failed (non-fatal):', e.message); }
});

test('B2: two concurrent void requests for the same receipt only reverse the payment once', async () => {
  const billNumber = `VOIDRACE-${Date.now()}`;
  const bill = await withTenant(() => PatientBill.create({
    clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'VoidRace Test Patient',
    bill_number: billNumber, total_amount: PAYMENT_AMOUNT, paid_amount: PAYMENT_AMOUNT, balance_amount: 0,
    status: 'paid', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP',
    services: [{ serviceName: 'VOIDRACE Test Service', totalPrice: PAYMENT_AMOUNT }],
  }));

  const receipt = await withTenant(() => Receipt.create({
    id: uuid(), receipt_number: `VOIDRACE-${Date.now()}`, clinic_id: TEST_CLINIC_ID,
    bill_id: bill.id, payment_date: new Date(), payment_amount: PAYMENT_AMOUNT,
    payment_method: 'cash', paid_services: [], status: 'active',
  }));

  const req1 = { params: { receiptId: receipt.id }, body: { status: 'voided', reason: 'race-1' }, user: { id: 1, displayName: 'Tester', role: 'admin' } };
  const req2 = { params: { receiptId: receipt.id }, body: { status: 'voided', reason: 'race-2' }, user: { id: 1, displayName: 'Tester', role: 'admin' } };
  const res1 = mockRes();
  const res2 = mockRes();

  // Genuinely concurrent — both hit the handler before either has a chance to
  // commit. Without B2's row lock, both would read the bill's paid_amount as
  // PAYMENT_AMOUNT and both would decrement it by PAYMENT_AMOUNT.
  await Promise.all([
    withTenant(() => statusHandler(req1, res1)),
    withTenant(() => statusHandler(req2, res2)),
  ]);

  // Exactly one request actually performed the reversal; the other's own
  // (post-lock, re-read) previousStatus was already 'voided' by the time it
  // got the lock, so B3's terminal-state check made it a same-status no-op.
  const statusCodes = [res1.statusCode, res2.statusCode].sort();
  expect(statusCodes).toEqual([200, 200]); // neither request errors — the second is a harmless no-op, not a 400/500

  const finalBill = await withTenant(() => PatientBill.findByPk(bill.id));
  // The critical assertion: paid_amount went back to 0 exactly once, not
  // negative (which double-decrementing by PAYMENT_AMOUNT would produce, since
  // the route clamps at 0 — so the real symptom is the balance/status only,
  // not a negative number this assertion could catch on its own).
  expect(parseFloat(finalBill.paid_amount)).toBe(0);
  expect(parseFloat(finalBill.balance_amount)).toBe(PAYMENT_AMOUNT);
  expect(finalBill.status).toBe('pending');

  // No duplicate GL reversal: the reversal journal entry for this receipt's
  // own RCP-<id> reference was only ever posted once.
  const [reversalEntries] = await sequelize.query(
    `SELECT id FROM journal_entries WHERE reference = :ref`,
    { replacements: { ref: `RCP-${receipt.id}` } }
  );
  expect(reversalEntries).toHaveLength(1);
});
