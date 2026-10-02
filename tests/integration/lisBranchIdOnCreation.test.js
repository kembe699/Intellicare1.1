/**
 * Live bug report: in a single-branch tenant ("nation", one branch "Main"),
 * an admin viewing "All Branches" could see new LIS requests on
 * /lis/collection, but non-admin users (correctly scoped to their one real
 * branch) could not see the exact same requests.
 *
 * Root cause: two side-door paths that also create lis_test_orders/
 * lis_specimens rows (the tables /lis/collection reads, via
 * GET /specimens/pending and /specimens/history) never stamped branch_id on
 * those rows at all, so they landed with branch_id = NULL:
 *
 *  1. Billing a Laboratory-category service directly on a Patient Bill
 *     (patientBills.js's createLisOrderForLabServices/createLabRequestsFromBill)
 *     — both the bill-creation route and PUT /:billId/add-services funnel
 *     through this, but only bill-creation had billData.branch_id already
 *     set; add-services built a fresh object literal that never included it.
 *  2. An inpatient ward lab request (inpatient.js's mirrorLabRequestToLis) —
 *     the function never even took a branchId parameter, unlike its sibling
 *     mirrorPrescriptionToPharmacy.
 *
 * GET /specimens/pending and /specimens/history filter non-admins with a
 * strict `AND branch_id = :branchId`, which never matches NULL — so these
 * requests silently vanished for every non-admin, in a single-branch tenant
 * exactly as in a multi-branch one. An admin who hasn't explicitly branch-
 * scoped themselves via the TopBar switcher gets no filter at all, so they
 * saw the NULL rows along with everything else, matching the reported
 * "admin sees it, nobody else does" symptom exactly.
 *
 * Calls the REAL route handlers directly (see receiptVoidApproval.test.js
 * for the established handlerFor() extraction pattern) against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const BRANCH_MAIN = 949501;

let sequelize;
let testConn;
let createBillHandler;
let addServicesHandler;
let createLabRequestHandler;

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

async function seedLisParticipant() {
  const id = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name)
     VALUES (:id, :num, 'LISBranchId', 'TestParticipant')`,
    { replacements: { id, num: `LISBRANCHID-${Date.now()}-${Math.random()}` } }
  );
  return id;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const billsRouter = require('../../src/server/routes/patientBills');
  createBillHandler = handlerFor(billsRouter, '/', 'post');
  addServicesHandler = handlerFor(billsRouter, '/:billId/add-services', 'put');

  const inpatientRouter = require('../../src/server/routes/inpatient');
  createLabRequestHandler = handlerFor(inpatientRouter, '/lab-requests', 'post');

  // A Laboratory-category catalog service — createLabRequestsFromBill
  // detects a billed line item as a lab order by matching its name against
  // this catalog (or lab_tests), not by any flag on the bill line itself.
  await sequelize.query(
    `INSERT INTO services (id, service_name, category, price, is_active) VALUES (:id, 'LISBRANCHID-CBC', 'Laboratory', 15000, true)`,
    { replacements: { id: uuid() } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM lis_specimens WHERE order_id IN (SELECT id FROM lis_test_orders WHERE clinic_name LIKE 'LISBRANCHID%' OR participant_id IN (SELECT id FROM lis_participants WHERE participant_number LIKE 'LISBRANCHID-%'))`);
    await sequelize.query(`DELETE FROM lis_test_orders WHERE participant_id IN (SELECT id FROM lis_participants WHERE participant_number LIKE 'LISBRANCHID-%')`);
    await sequelize.query(`DELETE FROM lis_participants WHERE participant_number LIKE 'LISBRANCHID-%'`);
    await sequelize.query(`DELETE FROM patient_bills WHERE patient_name LIKE 'LISBRANCHID%'`);
    await sequelize.query(`DELETE FROM services WHERE service_name LIKE 'LISBRANCHID-%'`);
    await sequelize.query(`DELETE FROM inpatient_lab_requests WHERE test_type LIKE 'LISBRANCHID-%'`);
  } catch (e) { console.warn('lisBranchIdOnCreation cleanup failed (non-fatal):', e.message); }
});

describe('Billing a lab service on a Patient Bill stamps branch_id on the LIS rows it creates', () => {
  test('POST /patient-bills (bill creation) stamps branch_id on both lis_test_orders and lis_specimens', async () => {
    const patientId = await seedLisParticipant();
    const res = mockRes();
    await withTenant(() => createBillHandler({
      params: {}, body: {
        patient_id: patientId, patient_name: 'LISBRANCHID Patient', clinic_id: TEST_CLINIC_ID, created_by: 'Test',
        services: [{ serviceName: 'LISBRANCHID-CBC', quantity: 1, unitPrice: 15000, totalPrice: 15000 }],
      },
      user: { id: 1, role: 'cashier', clinicId: TEST_CLINIC_ID, branchId: BRANCH_MAIN },
      branchContext: { branchId: BRANCH_MAIN },
    }, res));
    expect(res.statusCode).toBe(200);

    const [[order]] = await sequelize.query(`SELECT * FROM lis_test_orders WHERE participant_id = :pid`, { replacements: { pid: patientId } });
    expect(order).toBeTruthy();
    expect(order.branch_id).toBe(BRANCH_MAIN);

    const [specimens] = await sequelize.query(`SELECT * FROM lis_specimens WHERE order_id = :oid`, { replacements: { oid: order.id } });
    expect(specimens.length).toBe(1);
    expect(specimens[0].branch_id).toBe(BRANCH_MAIN);
  });

  test('PUT /:billId/add-services (the previously-broken path) also stamps branch_id', async () => {
    const patientId = await seedLisParticipant();
    const createRes = mockRes();
    await withTenant(() => createBillHandler({
      params: {}, body: {
        patient_id: patientId, patient_name: 'LISBRANCHID Patient2', clinic_id: TEST_CLINIC_ID, created_by: 'Test',
        services: [{ serviceName: 'LISBRANCHID Consultation', quantity: 1, unitPrice: 5000, totalPrice: 5000 }],
      },
      user: { id: 1, role: 'cashier', clinicId: TEST_CLINIC_ID, branchId: BRANCH_MAIN },
      branchContext: { branchId: BRANCH_MAIN },
    }, createRes));
    const bill = createRes.body;
    expect(bill.branch_id).toBe(BRANCH_MAIN);

    const addRes = mockRes();
    await withTenant(() => addServicesHandler({
      params: { billId: bill.id },
      body: { services: [{ serviceName: 'LISBRANCHID-CBC', quantity: 1, unitPrice: 15000, totalPrice: 15000 }] },
      user: { id: 1, role: 'cashier', clinicId: TEST_CLINIC_ID, branchId: BRANCH_MAIN },
      branchContext: { branchId: BRANCH_MAIN },
    }, addRes));
    expect(addRes.statusCode).toBe(200);

    const [[order]] = await sequelize.query(`SELECT * FROM lis_test_orders WHERE participant_id = :pid`, { replacements: { pid: patientId } });
    expect(order).toBeTruthy();
    expect(order.branch_id).toBe(BRANCH_MAIN);

    const [specimens] = await sequelize.query(
      `SELECT * FROM lis_specimens WHERE order_id = :oid AND LOWER(test_name) = LOWER('LISBRANCHID-CBC')`,
      { replacements: { oid: order.id } }
    );
    expect(specimens.length).toBe(1);
    expect(specimens[0].branch_id).toBe(BRANCH_MAIN);
  });
});

describe('An inpatient ward lab request stamps branch_id on the LIS rows it mirrors', () => {
  test('POST /inpatient/lab-requests stamps branch_id on both lis_test_orders and lis_specimens', async () => {
    const patientId = await seedLisParticipant();
    const res = mockRes();
    await withTenant(() => createLabRequestHandler({
      params: {}, body: {
        admission_id: uuid(), patient_id: patientId, test_type: 'LISBRANCHID-WardTest', category: 'Chemistry',
      },
      user: { id: 1, role: 'nurse', clinicId: TEST_CLINIC_ID, branchId: BRANCH_MAIN },
      branchContext: { branchId: BRANCH_MAIN },
    }, res));
    expect(res.statusCode).toBe(201);

    const [[order]] = await sequelize.query(`SELECT * FROM lis_test_orders WHERE participant_id = :pid`, { replacements: { pid: patientId } });
    expect(order).toBeTruthy();
    expect(order.branch_id).toBe(BRANCH_MAIN);

    const [specimens] = await sequelize.query(`SELECT * FROM lis_specimens WHERE order_id = :oid`, { replacements: { oid: order.id } });
    expect(specimens.length).toBe(1);
    expect(specimens[0].branch_id).toBe(BRANCH_MAIN);
  });
});
