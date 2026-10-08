/**
 * Revenue by Department/Category (reportClinicPerformance.js's byCategory) —
 * a billed line item that doesn't match the `services` catalog but DOES
 * match the active inventory catalog (e.g. a dispensed drug) is now labeled
 * "Pharmacy / Inventory" instead of being lumped into an unexplained
 * "Uncategorized" bucket. Requested after the client correctly guessed that
 * most of "Uncategorized" was actually pharmacy revenue.
 *
 * A line item matching NEITHER catalog still falls to "Uncategorized" —
 * this file proves both halves of that split.
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
// date fixtures on the shared tenant_test patient_bills table.
const TEST_DATE = '2031-06-11';

let sequelize;
let testConn;
let getHandler;
let billIds = [];
let inventoryItemId;
const drugName = `Reclass Test Amoxicillin ${Date.now()}`;
const unmatchedName = `Totally Unknown Line Item ${Date.now()}`;

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
    user: { id: 1, displayName: 'Pharmacy Label Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
  };
}

async function insertBill(patientName, serviceName, amount) {
  const id = uuid();
  billIds.push(id);
  await sequelize.query(
    `INSERT INTO patient_bills (id, bill_number, patient_id, patient_name, clinic_id, bill_date, total_amount, paid_amount, balance_amount, status, services, created_by, created_at, updated_at)
     VALUES (:id, :billNumber, :patientId, :patientName, :clinicId, :date, :amount, :amount, 0, 'paid', :services, 'test', NOW(), NOW())`,
    {
      replacements: {
        id, billNumber: `BILL-PHARMLABEL-${id.slice(0, 8)}`, patientId: uuid(), patientName, clinicId: TEST_CLINIC_ID, date: TEST_DATE,
        amount, services: JSON.stringify([{ serviceName, totalPrice: amount, paid: true }]),
      },
    }
  );
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/reportClinicPerformance');
  getHandler = handlerFor(router, '/', 'get');

  inventoryItemId = uuid();
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, item_category, is_active, created_at, updated_at)
     VALUES (:id, :clinicId, :code, :name, 'drugs', true, NOW(), NOW())`,
    { replacements: { id: inventoryItemId, clinicId: TEST_CLINIC_ID, code: `PHARMLABEL-${Date.now()}`, name: drugName } }
  );

  await insertBill('Pharmacy Label Patient', drugName, 12000);
  await insertBill('Unmatched Label Patient', unmatchedName, 3000);
}, 30000);

afterAll(async () => {
  try {
    if (billIds.length > 0) await sequelize.query(`DELETE FROM patient_bills WHERE id IN (:ids)`, { replacements: { ids: billIds } });
    if (inventoryItemId) await sequelize.query(`DELETE FROM inventory_items WHERE id = :id`, { replacements: { id: inventoryItemId } });
  } catch (e) { console.warn('reportClinicPerformancePharmacyLabel cleanup failed (non-fatal):', e.message); }
});

describe('GET /api/reports-v2/clinic-performance — byCategory', () => {
  test('a line item matching the inventory catalog (not the services catalog) is labeled "Pharmacy / Inventory"', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE }), res));
    expect(res.statusCode).toBe(200);

    const pharmacyRow = res.body.byCategory.find((c) => c.category === 'Pharmacy / Inventory');
    expect(pharmacyRow).toBeTruthy();
    expect(pharmacyRow.totalBilled).toBeGreaterThanOrEqual(12000);
  });

  test('a line item matching neither catalog still falls to "Uncategorized"', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE }), res));
    expect(res.statusCode).toBe(200);

    const uncategorizedRow = res.body.byCategory.find((c) => c.category === 'Uncategorized');
    expect(uncategorizedRow).toBeTruthy();
    expect(uncategorizedRow.totalBilled).toBeGreaterThanOrEqual(3000);
  });
});
