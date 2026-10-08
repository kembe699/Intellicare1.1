/**
 * Income Statement, cash basis — a voided or refunded receipt's amount must
 * NOT count as collected revenue.
 *
 * Bug found while investigating a client-reported "income statement looks
 * wrong" complaint: fetchCashRevenue()'s receipts filter was
 * `COALESCE(r.is_voided, false) = false`, but receipts.js's void/refund
 * endpoint (PUT /:receiptId/status) only ever sets `status` — it never
 * writes `is_voided`/`is_refunded` — so that filter was a permanent no-op
 * and every voided/refunded receipt's payment_amount was still being
 * recognized as revenue. Fixed to filter on `r.status = 'active'`, the same
 * column/value every other report in this codebase already uses
 * (reportBillingByUser.js, reportRevenue.js, reportCancelledTransactions.js).
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;
// Far-future, synthetic date — avoids colliding with other test files' fixed-
// date fixtures on the shared tenant_test receipts/account_ledger tables.
const TEST_DATE = '2031-05-20';

let sequelize;
let testConn;
let getHandler;
let revenueAccountId;
let ledgerIds = [];
let glIds = [];
let receiptIds = [];

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
    user: { id: 1, displayName: 'Income Statement Void Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
  };
}

async function ensureAccount(code, name, type, balanceType) {
  const [[existing]] = await sequelize.query(
    `SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = :code`,
    { replacements: { clinicId: TEST_CLINIC_ID, code } }
  );
  if (existing) {
    await sequelize.query(`UPDATE chart_of_accounts SET is_active = true WHERE id = :id`, { replacements: { id: existing.id } });
    return existing.id;
  }
  const id = uuid();
  await sequelize.query(
    `INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, balance_type, is_active)
     VALUES (:id, :clinicId, :code, :name, :type, :balanceType, true)`,
    { replacements: { id, clinicId: TEST_CLINIC_ID, code, name, type, balanceType } }
  );
  return id;
}

// Posts a minimal "bill revenue was recognized" GL entry for a given bill_id
// — a general_ledger header (reference_module='patient_billing') plus the
// account_ledger credit line fetchCashRevenue's bill_revenue CTE reads.
async function postBillRevenue(billId, amount) {
  const glId = uuid();
  glIds.push(glId);
  await sequelize.query(
    `INSERT INTO general_ledger (id, clinic_id, gl_number, transaction_date, description, reference_id, reference_module, created_by, total_debit, total_credit, is_posted, status)
     VALUES (:id, :clinicId, :glNumber, :date, 'Test bill revenue', :billId, 'patient_billing', 'test', :amount, :amount, true, 'posted')`,
    { replacements: { id: glId, clinicId: TEST_CLINIC_ID, glNumber: `GL-VOIDTEST-${glId.slice(0, 8)}`, date: TEST_DATE, billId, amount } }
  );
  const ledgerId = uuid();
  ledgerIds.push(ledgerId);
  await sequelize.query(
    `INSERT INTO account_ledger (id, clinic_id, account_id, transaction_id, transaction_date, debit_amount, credit_amount, is_posted, source_module)
     VALUES (:id, :clinicId, :accountId, :glId, :date, 0, :amount, true, 'test')`,
    { replacements: { id: ledgerId, clinicId: TEST_CLINIC_ID, accountId: revenueAccountId, glId, date: TEST_DATE, amount } }
  );
}

async function insertReceipt({ billId, amount, status }) {
  const id = uuid();
  receiptIds.push(id);
  await sequelize.query(
    `INSERT INTO receipts (id, receipt_number, clinic_id, bill_id, payment_date, payment_amount, status, from_lease, created_at, updated_at)
     VALUES (:id, :receiptNumber, :clinicId, :billId, :date, :amount, :status, false, NOW(), NOW())`,
    { replacements: { id, receiptNumber: `RCP-VOIDTEST-${id.slice(0, 8)}`, clinicId: TEST_CLINIC_ID, billId, date: TEST_DATE, amount, status } }
  );
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/reportIncomeStatement');
  getHandler = handlerFor(router, '/', 'get');

  revenueAccountId = await ensureAccount('4199', 'Test Other Revenue', 'revenue', 'credit');

  const activeBillId = uuid();
  await postBillRevenue(activeBillId, 15000);
  await insertReceipt({ billId: activeBillId, amount: 15000, status: 'active' });

  const voidedBillId = uuid();
  await postBillRevenue(voidedBillId, 9000);
  await insertReceipt({ billId: voidedBillId, amount: 9000, status: 'voided' });

  const refundedBillId = uuid();
  await postBillRevenue(refundedBillId, 4000);
  await insertReceipt({ billId: refundedBillId, amount: 4000, status: 'refunded' });
}, 30000);

afterAll(async () => {
  try {
    if (receiptIds.length > 0) await sequelize.query(`DELETE FROM receipts WHERE id IN (:ids)`, { replacements: { ids: receiptIds } });
    if (ledgerIds.length > 0) await sequelize.query(`DELETE FROM account_ledger WHERE id IN (:ids)`, { replacements: { ids: ledgerIds } });
    if (glIds.length > 0) await sequelize.query(`DELETE FROM general_ledger WHERE id IN (:ids)`, { replacements: { ids: glIds } });
  } catch (e) { console.warn('incomeStatementExcludesVoidedReceipts cleanup failed (non-fatal):', e.message); }
});

describe('GET /api/reports-v2/income-statement?basis=cash — voided/refunded receipts', () => {
  test('a voided or refunded receipt contributes nothing to cash-basis revenue', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, basis: 'cash' }), res));
    expect(res.statusCode).toBe(200);
    // Only the active receipt's 15000 should count — the voided (9000) and
    // refunded (4000) receipts must be excluded entirely, not partially.
    expect(res.body.totals.totalRevenue).toBe(15000);
  });
});
