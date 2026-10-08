/**
 * Revenue report — new scheme and branch breakdowns (user/department already
 * existed, via reportBillingByUser.js / reportClinicPerformance.js, and are
 * intentionally not duplicated here).
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;
// Far-future, synthetic date range — avoids colliding with other test
// files' fixed-date fixtures on the same shared tenant_test receipts table
// (see incomeStatementDailyAndSections.test.js for the same reasoning).
const TEST_DATE = '2031-02-10';

let sequelize;
let testConn;
let getHandler;
let schemeId;
let branchAId;
let branchBId;
let billWithSchemeId;
let billNoSchemeId;
let receiptIds = [];
let billIds = [];

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
    user: { id: 1, displayName: 'Revenue Report Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
  };
}

async function insertReceipt({ id, billId, branchId, amount }) {
  receiptIds.push(id);
  await sequelize.query(
    `INSERT INTO receipts (id, receipt_number, clinic_id, bill_id, branch_id, payment_date, payment_amount, status, from_lease, created_at, updated_at)
     VALUES (:id, :receiptNumber, :clinicId, :billId, :branchId, :date, :amount, 'active', false, NOW(), NOW())`,
    { replacements: { id, receiptNumber: `RCP-TEST-${id.slice(0, 8)}`, clinicId: TEST_CLINIC_ID, billId, branchId: branchId || null, date: TEST_DATE, amount } }
  );
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/reportRevenue');
  getHandler = handlerFor(router, '/', 'get');

  // Two real branches to distinguish, using whatever's already seeded —
  // falls back to just not asserting branch names if the tenant genuinely
  // has none, since this suite doesn't own branch provisioning.
  const [branches] = await sequelize.query(`SELECT id FROM branches ORDER BY id LIMIT 2`);
  branchAId = branches[0]?.id ?? null;
  branchBId = branches[1]?.id ?? branchAId;

  schemeId = uuid();
  await sequelize.query(
    `INSERT INTO patient_schemes (id, clinic_id, scheme_code, scheme_name, is_active) VALUES (:id, :clinicId, :code, :name, true)`,
    { replacements: { id: schemeId, clinicId: TEST_CLINIC_ID, code: `REVTEST-${Date.now()}`, name: 'RevenueTest Insurance Co' } }
  );

  billWithSchemeId = uuid();
  billIds.push(billWithSchemeId);
  await sequelize.query(
    `INSERT INTO patient_bills (id, bill_number, patient_id, patient_name, clinic_id, bill_date, scheme_id, branch_id, created_by, created_at, updated_at)
     VALUES (:id, :billNumber, :patientId, 'Revenue Test Patient', :clinicId, :date, :schemeId, :branchId, 'test', NOW(), NOW())`,
    { replacements: { id: billWithSchemeId, billNumber: `BILL-REVTEST-${Date.now()}`, patientId: uuid(), clinicId: TEST_CLINIC_ID, date: TEST_DATE, schemeId, branchId: branchAId } }
  );

  billNoSchemeId = uuid();
  billIds.push(billNoSchemeId);
  await sequelize.query(
    `INSERT INTO patient_bills (id, bill_number, patient_id, patient_name, clinic_id, bill_date, scheme_id, branch_id, created_by, created_at, updated_at)
     VALUES (:id, :billNumber, :patientId, 'Revenue Test Cash Patient', :clinicId, :date, NULL, :branchId, 'test', NOW(), NOW())`,
    { replacements: { id: billNoSchemeId, billNumber: `BILL-REVTEST-CASH-${Date.now()}`, patientId: uuid(), clinicId: TEST_CLINIC_ID, date: TEST_DATE, branchId: branchBId } }
  );

  await insertReceipt({ id: uuid(), billId: billWithSchemeId, branchId: branchAId, amount: 15000 });
  await insertReceipt({ id: uuid(), billId: billNoSchemeId, branchId: branchBId, amount: 7000 });
}, 30000);

afterAll(async () => {
  try {
    if (receiptIds.length > 0) await sequelize.query(`DELETE FROM receipts WHERE id IN (:ids)`, { replacements: { ids: receiptIds } });
    if (billIds.length > 0) await sequelize.query(`DELETE FROM patient_bills WHERE id IN (:ids)`, { replacements: { ids: billIds } });
    await sequelize.query(`DELETE FROM patient_schemes WHERE id = :id`, { replacements: { id: schemeId } });
  } catch (e) { console.warn('reportRevenueBySchemeAndBranch cleanup failed (non-fatal):', e.message); }
});

describe('GET /api/reports-v2/revenue?groupBy=scheme', () => {
  test('groups collections by scheme, with an explicit "Cash / No Scheme" bucket for unschemed bills', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, groupBy: 'scheme' }), res));
    expect(res.statusCode).toBe(200);

    const schemeRow = res.body.rows.find((r) => r.id === schemeId);
    expect(schemeRow).toBeTruthy();
    expect(schemeRow.label).toBe('RevenueTest Insurance Co');
    expect(schemeRow.totalCollected).toBe(15000);

    const cashRow = res.body.rows.find((r) => r.label === 'Cash / No Scheme');
    expect(cashRow).toBeTruthy();
    expect(cashRow.totalCollected).toBeGreaterThanOrEqual(7000);
  });
});

describe('GET /api/reports-v2/revenue?groupBy=branch', () => {
  test('groups collections by branch', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, groupBy: 'branch' }), res));
    expect(res.statusCode).toBe(200);

    const totalFromRows = res.body.rows.reduce((s, r) => s + r.totalCollected, 0);
    expect(totalFromRows).toBeGreaterThanOrEqual(22000);
    expect(res.body.totals.totalCollected).toBe(totalFromRows);
  });
});
