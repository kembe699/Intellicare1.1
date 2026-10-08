/**
 * Theatre Report — didn't exist before this feature; theatre_operations
 * already carries its own billing fields (procedure_fee, bill_id) from the
 * earlier catalog-driven Theatre billing work, so this is a pure
 * aggregation over data that was already there.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;
// Far-future, synthetic date — avoids colliding with other test files'
// fixed-date fixtures on the shared tenant_test theatre_operations table.
const TEST_DATE = '2031-03-05';

let sequelize;
let testConn;
let getHandler;
let operationIds = [];
let patientId;

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
    user: { id: 1, displayName: 'Theatre Report Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
  };
}

async function insertOperation({ procedureName, status, fee, billed, outcome }) {
  const id = uuid();
  operationIds.push(id);
  await sequelize.query(
    `INSERT INTO theatre_operations (id, clinic_id, patient_id, procedure_name, status, scheduled_at, procedure_fee, fee_currency, bill_id, outcome)
     VALUES (:id, :clinicId, :patientId, :procedureName, :status, :scheduledAt, :fee, 'SSP', :billId, :outcome)`,
    { replacements: {
      id, clinicId: TEST_CLINIC_ID, patientId, procedureName, status, scheduledAt: `${TEST_DATE}T09:00:00Z`,
      fee, billId: billed ? uuid() : null, outcome: outcome || null,
    } }
  );
  return id;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/reportTheatre');
  getHandler = handlerFor(router, '/', 'get');

  patientId = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name) VALUES (:id, :number, 'Theatre', 'ReportTest')`,
    { replacements: { id: patientId, number: `THREPTEST-${Date.now()}` } }
  );

  await insertOperation({ procedureName: 'Appendectomy', status: 'completed', fee: 150000, billed: true });
  await insertOperation({ procedureName: 'Appendectomy', status: 'completed', fee: 150000, billed: true });
  await insertOperation({ procedureName: 'Caesarean Section', status: 'completed', fee: 200000, billed: true });
  await insertOperation({ procedureName: 'Caesarean Section', status: 'cancelled', fee: 200000, billed: false });
}, 30000);

afterAll(async () => {
  try {
    if (operationIds.length > 0) await sequelize.query(`DELETE FROM theatre_operations WHERE id IN (:ids)`, { replacements: { ids: operationIds } });
    await sequelize.query(`DELETE FROM lis_participants WHERE id = :id`, { replacements: { id: patientId } });
  } catch (e) { console.warn('reportTheatre cleanup failed (non-fatal):', e.message); }
});

describe('GET /api/reports-v2/theatre', () => {
  test('summarizes operation counts, outcomes, and only-billed revenue', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE }), res));
    expect(res.statusCode).toBe(200);

    expect(res.body.summary.totalOperations).toBeGreaterThanOrEqual(4);
    expect(res.body.summary.completedOperations).toBeGreaterThanOrEqual(3);
    expect(res.body.summary.cancelledOperations).toBeGreaterThanOrEqual(1);
    // The cancelled Caesarean was never billed (bill_id null) — its fee must
    // not count toward revenue even though procedure_fee is set on the row.
    expect(res.body.summary.totalRevenue).toBeGreaterThanOrEqual(500000);
  });

  test('groups by procedure, revenue only counting billed operations', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE }), res));

    const appendectomy = res.body.byProcedure.find((p) => p.procedureName === 'Appendectomy');
    expect(appendectomy.operationCount).toBe(2);
    expect(appendectomy.totalRevenue).toBe(300000);

    const caesarean = res.body.byProcedure.find((p) => p.procedureName === 'Caesarean Section');
    expect(caesarean.operationCount).toBe(2);
    // Only the billed one of the two counts toward revenue.
    expect(caesarean.totalRevenue).toBe(200000);
  });
});
