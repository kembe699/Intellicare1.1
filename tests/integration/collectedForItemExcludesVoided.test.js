/**
 * collectedForItem() (reportRevenue.js, and its two inline duplicates in
 * reportClinicPerformance.js / reportDoctorPerformance.js) checked
 * `item.paid` before anything else. A line item voided via /void-item keeps
 * `paid: true` as a deliberate historical marker (see patientBills.js) —
 * which meant a voided line kept counting as collected revenue forever,
 * same for a receipt-void that predates the R1 fix. Real client report:
 * a cancelled "Pediatric Consultation" kept showing up as collected in the
 * Revenue by Item report after the bill it belonged to was reversed.
 *
 * Fix: isVoided is checked first and always collects 0, regardless of any
 * stale paid flag.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;
const TEST_DATE = '2031-07-21';

let sequelize;
let testConn;
let getHandler;
let billIds = [];
const voidedName = `CFI Voided Consultation ${Date.now()}`;
const normalName = `CFI Normal Consultation ${Date.now()}`;

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
    user: { id: 1, displayName: 'CFI Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/reportRevenue');
  getHandler = handlerFor(router, '/', 'get');

  // A bill whose only line item has paid:true (stale, left over from a
  // reversal) AND isVoided:true — the exact shape /void-item and the
  // cancelItems receipt-void path both produce.
  const voidedBillId = uuid();
  billIds.push(voidedBillId);
  await sequelize.query(
    `INSERT INTO patient_bills (id, bill_number, patient_id, patient_name, clinic_id, bill_date, total_amount, paid_amount, balance_amount, status, services, created_by, created_at, updated_at)
     VALUES (:id, :billNumber, :patientId, :patientName, :clinicId, :date, 0, 0, 0, 'pending', :services, 'test', NOW(), NOW())`,
    {
      replacements: {
        id: voidedBillId, billNumber: `BILL-CFIVOID-${voidedBillId.slice(0, 8)}`, patientId: uuid(), patientName: 'CFI Voided Patient',
        clinicId: TEST_CLINIC_ID, date: TEST_DATE,
        services: JSON.stringify([{ serviceName: voidedName, totalPrice: 50000, paid: true, isVoided: true, voidReason: 'Visit cancelled' }]),
      },
    }
  );

  // A normal, genuinely paid, not-voided bill — must still count, proving
  // the fix doesn't just zero out everything.
  const normalBillId = uuid();
  billIds.push(normalBillId);
  await sequelize.query(
    `INSERT INTO patient_bills (id, bill_number, patient_id, patient_name, clinic_id, bill_date, total_amount, paid_amount, balance_amount, status, services, created_by, created_at, updated_at)
     VALUES (:id, :billNumber, :patientId, :patientName, :clinicId, :date, :amount, :amount, 0, 'paid', :services, 'test', NOW(), NOW())`,
    {
      replacements: {
        id: normalBillId, billNumber: `BILL-CFINORM-${normalBillId.slice(0, 8)}`, patientId: uuid(), patientName: 'CFI Normal Patient',
        clinicId: TEST_CLINIC_ID, date: TEST_DATE, amount: 30000,
        services: JSON.stringify([{ serviceName: normalName, totalPrice: 30000, paid: true }]),
      },
    }
  );
}, 30000);

afterAll(async () => {
  try {
    if (billIds.length > 0) await sequelize.query(`DELETE FROM patient_bills WHERE id IN (:ids)`, { replacements: { ids: billIds } });
  } catch (e) { console.warn('collectedForItemExcludesVoided cleanup failed (non-fatal):', e.message); }
});

describe('GET /api/reports-v2/revenue?groupBy=item — voided lines never count as collected', () => {
  test('a voided line with a stale paid:true flag collects 0', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ groupBy: 'item', dateFrom: TEST_DATE, dateTo: TEST_DATE, clinic_id: String(TEST_CLINIC_ID) }), res));
    expect(res.statusCode).toBe(200);

    const voidedRow = res.body.rows.find((r) => r.label === voidedName);
    expect(voidedRow).toBeTruthy();
    expect(voidedRow.totalCollected).toBe(0);
  });

  test('a normal paid, not-voided line still collects its full amount', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ groupBy: 'item', dateFrom: TEST_DATE, dateTo: TEST_DATE, clinic_id: String(TEST_CLINIC_ID) }), res));
    expect(res.statusCode).toBe(200);

    const normalRow = res.body.rows.find((r) => r.label === normalName);
    expect(normalRow).toBeTruthy();
    expect(normalRow.totalCollected).toBe(30000);
  });
});
