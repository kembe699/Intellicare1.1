/**
 * The theatre operation page's "Request Lab Test"/"Request Radiology"
 * buttons reuse the main LIS/radiology endpoints (POST /api/lis/orders,
 * POST /api/radiology/requests) rather than the admission-scoped
 * inpatient_lab_requests/inpatient_radiology_requests tables, since a
 * theatre patient may not have an admission at all.
 *
 * Neither endpoint billed the patient before this change. LISTestOrders.tsx
 * already calls POST /api/lis/orders and bills the ordered tests itself,
 * client-side, right after — billing unconditionally in the backend would
 * double-charge every order placed from that existing page. So billing here
 * is opt-in via `auto_bill: true`, sent only by the new theatre UI; every
 * other caller's behavior (no backend billing) must be unchanged.
 *
 * Radiology ordered via LISTestOrders.tsx is explicitly NOT billed at all
 * today ("radiology billing isn't wired up yet" — see that file's own
 * comment near selectedRadiologyIds), a real, separate, pre-existing gap
 * this isn't fixing — auto_bill again only applies to the new theatre path.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let lisOrdersHandler;
let radiologyRequestsHandler;
let participantId;

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
    user: { id: 1, displayName: 'Theatre Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
    ip: '127.0.0.1',
    ...overrides,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const lisRouter = require('../../src/server/routes/lisModule');
  lisOrdersHandler = handlerFor(lisRouter, '/orders', 'post');
  const radiologyRouter = require('../../src/server/routes/radiology');
  radiologyRequestsHandler = handlerFor(radiologyRouter, '/requests', 'post');

  participantId = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name, gender)
     VALUES (:id, :pn, 'AutoBill', 'TestPatient', 'female')`,
    { replacements: { id: participantId, pn: `TAUTOBILL-${Date.now()}` } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM patient_bills WHERE patient_id = :p`, { replacements: { p: participantId } });
    await sequelize.query(`DELETE FROM radiology_requests WHERE participant_id = :p`, { replacements: { p: participantId } });
    await sequelize.query(`DELETE FROM lis_specimens WHERE order_id IN (SELECT id FROM lis_test_orders WHERE participant_id = :p)`, { replacements: { p: participantId } });
    await sequelize.query(`DELETE FROM lis_test_orders WHERE participant_id = :p`, { replacements: { p: participantId } });
    await sequelize.query(`DELETE FROM lis_participants WHERE id = :p`, { replacements: { p: participantId } });
  } catch (e) { console.warn('theatreAutoBillRequests cleanup failed (non-fatal):', e.message); }
});

describe('POST /api/lis/orders — auto_bill opt-in', () => {
  test('auto_bill: true bills the patient at the catalog price', async () => {
    const res = mockRes();
    await withTenant(() => lisOrdersHandler(req({
      body: { participant_id: participantId, tests: [{ code: 'CBC', name: 'Complete Blood Count', department: 'Haematology', price: 15000 }], auto_bill: true },
    }), res));
    expect(res.statusCode).toBe(201);

    const [[bill]] = await sequelize.query(`SELECT total_amount, services FROM patient_bills WHERE patient_id = :p`, { replacements: { p: participantId } });
    expect(bill).toBeDefined();
    expect(parseFloat(bill.total_amount)).toBe(15000);
    const services = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
    expect(services[0].serviceName).toBe('Complete Blood Count');

    await sequelize.query(`DELETE FROM patient_bills WHERE patient_id = :p`, { replacements: { p: participantId } });
  });

  test('without auto_bill, no bill is created — existing LISTestOrders.tsx behavior is unchanged', async () => {
    const res = mockRes();
    await withTenant(() => lisOrdersHandler(req({
      body: { participant_id: participantId, tests: [{ code: 'CBC2', name: 'Complete Blood Count 2', department: 'Haematology', price: 15000 }] },
    }), res));
    expect(res.statusCode).toBe(201);

    const [[bill]] = await sequelize.query(`SELECT id FROM patient_bills WHERE patient_id = :p`, { replacements: { p: participantId } });
    expect(bill).toBeUndefined();
  });
});

describe('POST /api/radiology/requests — auto_bill opt-in', () => {
  test('auto_bill: true bills the patient at the catalog price', async () => {
    const res = mockRes();
    await withTenant(() => radiologyRequestsHandler(req({
      body: { participant_id: participantId, items: [{ exam_name: 'Chest X-Ray', price: 25000 }], auto_bill: true },
    }), res));
    expect(res.statusCode).toBe(201);

    const [[bill]] = await sequelize.query(`SELECT total_amount, services FROM patient_bills WHERE patient_id = :p`, { replacements: { p: participantId } });
    expect(bill).toBeDefined();
    expect(parseFloat(bill.total_amount)).toBe(25000);
    const services = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
    expect(services[0].serviceName).toBe('Chest X-Ray');

    await sequelize.query(`DELETE FROM patient_bills WHERE patient_id = :p`, { replacements: { p: participantId } });
  });

  test('without auto_bill, no bill is created — matches LISTestOrders.tsx\'s own documented gap', async () => {
    const res = mockRes();
    await withTenant(() => radiologyRequestsHandler(req({
      body: { participant_id: participantId, items: [{ exam_name: 'Chest X-Ray 2', price: 25000 }] },
    }), res));
    expect(res.statusCode).toBe(201);

    const [[bill]] = await sequelize.query(`SELECT id FROM patient_bills WHERE patient_id = :p`, { replacements: { p: participantId } });
    expect(bill).toBeUndefined();
  });
});
