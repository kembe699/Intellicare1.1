/**
 * Performance finding: GET /api/dashboard/stats/:clinicId ran 8 mutually
 * independent count/sum queries one after another, each paying its own
 * full round-trip to Postgres in series — on a loaded connection this
 * endpoint (hit on every dashboard load) could take roughly 8x longer than
 * it needed to. Fixed by issuing them concurrently via Promise.all, each
 * still wrapped in its own try/catch with the same default-0 fallback as
 * before.
 *
 * The real risk in that kind of refactor is a silent reordering bug — the
 * destructured result array no longer lining up with the array of
 * promises. This test seeds a distinct, branch-scoped count for several of
 * the stats and asserts each comes back under its own correct key, with a
 * decoy row in a different branch proving branch-scoping also survived the
 * refactor unchanged.
 *
 * Calls the REAL route handler directly (see receiptVoidApproval.test.js
 * for the established handlerFor() extraction pattern) against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const BRANCH_A = 939401;
const BRANCH_B = 939402;

let sequelize;
let testConn;
let PatientBill;
let PatientQueue;
let statsHandler;

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
  PatientBill = testConn.models.PatientBill;
  PatientQueue = testConn.models.PatientQueue;

  const dashboardRouter = require('../../src/server/routes/dashboard');
  statsHandler = handlerFor(dashboardRouter, '/stats/:clinicId', 'get');

  // 2 participants in branch A, 1 decoy in branch B — totalPatients for a
  // branch-A user should read exactly 2, not 3.
  for (const branchId of [BRANCH_A, BRANCH_A, BRANCH_B]) {
    await sequelize.query(
      `INSERT INTO lis_participants (id, participant_number, first_name, last_name, branch_id, created_at)
       VALUES (:id, :num, 'DashStats', 'TestParticipant', :branchId, '2020-01-01')`,
      { replacements: { id: uuid(), num: `DASHSTATS-${Date.now()}-${Math.random()}`, branchId } }
    );
  }

  // 1 low-stock item in branch A, 1 decoy (well-stocked, so it must NOT
  // count) also in branch A, 1 low-stock decoy in branch B.
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, branch_id, is_active, quantity_on_hand, minimum_stock_level)
     VALUES (:id, :c, :code, 'DashStats Low Stock Item', :branchId, true, 2, 10)`,
    { replacements: { id: uuid(), c: TEST_CLINIC_ID, code: `DASHSTATS-LOW-${Date.now()}`, branchId: BRANCH_A } }
  );
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, branch_id, is_active, quantity_on_hand, minimum_stock_level)
     VALUES (:id, :c, :code, 'DashStats Well Stocked Item', :branchId, true, 500, 10)`,
    { replacements: { id: uuid(), c: TEST_CLINIC_ID, code: `DASHSTATS-OK-${Date.now()}`, branchId: BRANCH_A } }
  );
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, branch_id, is_active, quantity_on_hand, minimum_stock_level)
     VALUES (:id, :c, :code, 'DashStats Low Stock Decoy (branch B)', :branchId, true, 1, 10)`,
    { replacements: { id: uuid(), c: TEST_CLINIC_ID, code: `DASHSTATS-DECOY-${Date.now()}`, branchId: BRANCH_B } }
  );

  // 1 queued patient in branch A, 1 decoy in branch B. patient_queue.patient_id
  // has a real FK into `patients`, so a plain random uuid won't insert.
  const Patient = testConn.models.Patient;
  const queuePatientA = await withTenant(() => Patient.create({
    patient_id: `DASHSTATS-QA-${Date.now()}`, first_name: 'DashStats', last_name: 'QueueA',
    date_of_birth: '1990-01-01', gender: 'other', registration_date: '2026-01-01',
  }));
  const queuePatientB = await withTenant(() => Patient.create({
    patient_id: `DASHSTATS-QB-${Date.now()}`, first_name: 'DashStats', last_name: 'QueueB',
    date_of_birth: '1990-01-01', gender: 'other', registration_date: '2026-01-01',
  }));
  await withTenant(() => PatientQueue.create({ patient_id: queuePatientA.id, queue_type: 'consultation', status: 'waiting', branch_id: BRANCH_A }));
  await withTenant(() => PatientQueue.create({ patient_id: queuePatientB.id, queue_type: 'consultation', status: 'waiting', branch_id: BRANCH_B }));

  // One unpaid bill (balance 750) in branch A, one fully-paid bill (balance
  // 0, must not count) also in branch A, one unpaid decoy in branch B.
  await withTenant(() => PatientBill.create({
    clinic_id: TEST_CLINIC_ID, branch_id: BRANCH_A, patient_id: uuid(), patient_name: 'DashStats Patient',
    bill_number: `DASHSTATS-UNPAID-${Date.now()}`, total_amount: 750, paid_amount: 0, balance_amount: 750,
    status: 'pending', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP', services: [],
  }));
  await withTenant(() => PatientBill.create({
    clinic_id: TEST_CLINIC_ID, branch_id: BRANCH_A, patient_id: uuid(), patient_name: 'DashStats Patient',
    bill_number: `DASHSTATS-PAID-${Date.now()}`, total_amount: 300, paid_amount: 300, balance_amount: 0,
    status: 'paid', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP', services: [],
  }));
  await withTenant(() => PatientBill.create({
    clinic_id: TEST_CLINIC_ID, branch_id: BRANCH_B, patient_id: uuid(), patient_name: 'DashStats Decoy Patient',
    bill_number: `DASHSTATS-DECOY-${Date.now()}`, total_amount: 9999, paid_amount: 0, balance_amount: 9999,
    status: 'pending', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP', services: [],
  }));
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM lis_participants WHERE participant_number LIKE 'DASHSTATS-%'`);
    await sequelize.query(`DELETE FROM inventory_items WHERE item_code LIKE 'DASHSTATS-%'`);
    await sequelize.query(`DELETE FROM patient_queue WHERE branch_id IN (:a, :b)`, { replacements: { a: BRANCH_A, b: BRANCH_B } });
    await sequelize.query(`DELETE FROM patients WHERE patient_id LIKE 'DASHSTATS-%'`);
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'DASHSTATS-%'`);
  } catch (e) { console.warn('dashboardStatsConcurrency cleanup failed (non-fatal):', e.message); }
});

describe('GET /dashboard/stats/:clinicId — concurrent queries stay correctly mapped and branch-scoped', () => {
  test('each stat is both the right value and the right branch\'s value', async () => {
    const req = { params: { clinicId: String(TEST_CLINIC_ID) }, query: {}, user: { id: 1, role: 'staff', clinicId: TEST_CLINIC_ID, branchId: BRANCH_A }, branchContext: { branchId: BRANCH_A } };
    const res = mockRes();
    await withTenant(() => statsHandler(req, res));

    expect(res.statusCode).toBe(200);
    expect(res.body.totalPatients).toBe(2);
    expect(res.body.lowStockItems).toBe(1);
    expect(res.body.queuePatients).toBe(1);
    expect(res.body.totalOutstanding).toBe(750);
    // Fields untouched by this fix's seeding — still present with the right type.
    expect(typeof res.body.todayPatients).toBe('number');
    expect(typeof res.body.todayVisits).toBe('number');
    expect(typeof res.body.pendingLabTests).toBe('number');
    expect(typeof res.body.completedLabTests).toBe('number');
  });

  test('an admin (no branch scope) sees branch A + branch B combined', async () => {
    const req = { params: { clinicId: String(TEST_CLINIC_ID) }, query: {}, user: { id: 1, role: 'admin', clinicId: TEST_CLINIC_ID } };
    const res = mockRes();
    await withTenant(() => statsHandler(req, res));

    expect(res.statusCode).toBe(200);
    expect(res.body.totalPatients).toBeGreaterThanOrEqual(3);
    expect(res.body.lowStockItems).toBeGreaterThanOrEqual(2);
    expect(res.body.queuePatients).toBeGreaterThanOrEqual(2);
    expect(res.body.totalOutstanding).toBeGreaterThanOrEqual(750 + 9999);
  });
});
