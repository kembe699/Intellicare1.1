/**
 * Requested: a prescription must never be saved for more than what's
 * actually available in stock, anywhere — called out specifically for
 * inpatient, which previously had no stock check at all (frontend or
 * backend). The shared outpatient/LIS path (POST /pharmacy-module/
 * prescriptions) had no backend check either — only a client-side warning
 * in LISTestOrders.tsx that a direct API call could simply bypass. Both
 * routes now reject (400) a non-external line whose quantity exceeds the
 * drug's current quantity_on_hand, via the shared
 * findInsufficientStockLine helper (see utils/checkDrugStock.js). A line
 * marked external (bought at an outside pharmacy, no drug_id) is never
 * checked — there's no inventory item to check against.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let postInpatientRxHandler;
let postPharmacyRxHandler;
let drugId;

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

function req(overrides) {
  return {
    params: {}, body: {}, query: {},
    user: { id: 1, displayName: 'Stock Limit Tester', role: 'admin' },
    branchContext: { isAdmin: true },
    models: testConn,
    ...overrides,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const inpatientRouter = require('../../src/server/routes/inpatient');
  postInpatientRxHandler = handlerFor(inpatientRouter, '/prescriptions', 'post');
  const pharmacyRouter = require('../../src/server/routes/pharmacyModule');
  postPharmacyRxHandler = handlerFor(pharmacyRouter, '/prescriptions', 'post');

  const [[item]] = await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, quantity_on_hand, unit_of_measure, selling_price, is_active)
     VALUES (:id, :c, :code, 'STOCKLIMIT Test Drug', 10, 'tablet', 100, true) RETURNING id`,
    { replacements: { id: uuid(), c: TEST_CLINIC_ID, code: `STOCKLIMIT-${Date.now()}` } }
  );
  drugId = item.id;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM inpatient_prescriptions WHERE drug_id = :id`, { replacements: { id: drugId } });
    await sequelize.query(`DELETE FROM prescription_lines WHERE drug_id = :id`, { replacements: { id: drugId } });
    await sequelize.query(`DELETE FROM pharmacy_prescriptions WHERE id IN (SELECT prescription_id FROM prescription_lines WHERE drug_id = :id)`, { replacements: { id: drugId } }).catch(() => {});
    await sequelize.query(`DELETE FROM inventory_items WHERE id = :id`, { replacements: { id: drugId } });
  } catch (e) { console.warn('prescriptionStockLimit cleanup failed (non-fatal):', e.message); }
});

describe('POST /api/inpatient/prescriptions rejects a quantity over stock', () => {
  test('quantity more than quantity_on_hand is rejected with 400, nothing saved', async () => {
    const admissionId = uuid();
    const res = mockRes();
    await withTenant(() => postInpatientRxHandler(req({
      body: { admission_id: admissionId, patient_id: uuid(), drug_id: drugId, medication_name: 'STOCKLIMIT Test Drug', frequency: 'OD', dosage: '500mg', quantity: 11 },
    }), res));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/only 10/i);

    const [rows] = await sequelize.query(`SELECT id FROM inpatient_prescriptions WHERE admission_id = :id`, { replacements: { id: admissionId } });
    expect(rows.length).toBe(0);
  });

  test('quantity within stock is accepted', async () => {
    const admissionId = uuid();
    const res = mockRes();
    await withTenant(() => postInpatientRxHandler(req({
      body: { admission_id: admissionId, patient_id: uuid(), drug_id: drugId, medication_name: 'STOCKLIMIT Test Drug', frequency: 'OD', dosage: '500mg', quantity: 5 },
    }), res));
    expect(res.statusCode).toBe(201);
  });

  test('an external line (bought outside) is never stock-checked, even for a huge quantity', async () => {
    const admissionId = uuid();
    const res = mockRes();
    await withTenant(() => postInpatientRxHandler(req({
      body: { admission_id: admissionId, patient_id: uuid(), is_external: true, external_drug_name: 'STOCKLIMIT Outside Drug', medication_name: 'STOCKLIMIT Outside Drug', frequency: 'OD', dosage: '500mg', quantity: 9999 },
    }), res));
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /api/pharmacy-module/prescriptions rejects a line quantity over stock', () => {
  test('a line quantity more than quantity_on_hand is rejected with 400, nothing saved', async () => {
    const res = mockRes();
    await withTenant(() => postPharmacyRxHandler(req({
      body: { patient_id: uuid(), lines: [{ drug_id: drugId, quantity_prescribed: 11 }] },
    }), res));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/only 10/i);
  });

  test('a line quantity within stock is accepted', async () => {
    const res = mockRes();
    await withTenant(() => postPharmacyRxHandler(req({
      body: { patient_id: uuid(), lines: [{ drug_id: drugId, quantity_prescribed: 3 }] },
    }), res));
    expect(res.statusCode).toBe(201);
  });

  test('one bad line among several blocks the whole prescription — nothing is saved', async () => {
    const otherDrugId = (await sequelize.query(
      `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, quantity_on_hand, unit_of_measure, selling_price, is_active)
       VALUES (:id, :c, :code, 'STOCKLIMIT Second Drug', 50, 'tablet', 50, true) RETURNING id`,
      { replacements: { id: uuid(), c: TEST_CLINIC_ID, code: `STOCKLIMIT2-${Date.now()}` } }
    ))[0][0].id;
    try {
      const res = mockRes();
      await withTenant(() => postPharmacyRxHandler(req({
        body: { patient_id: uuid(), lines: [
          { drug_id: otherDrugId, quantity_prescribed: 2 },
          { drug_id: drugId, quantity_prescribed: 50 },
        ] },
      }), res));
      expect(res.statusCode).toBe(400);
      const [rows] = await sequelize.query(`SELECT id FROM prescription_lines WHERE drug_id = :id`, { replacements: { id: otherDrugId } });
      expect(rows.length).toBe(0);
    } finally {
      await sequelize.query(`DELETE FROM inventory_items WHERE id = :id`, { replacements: { id: otherDrugId } });
    }
  });
});
