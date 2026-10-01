/**
 * Production report: approving results on /lis/review "takes forever".
 * LISManagerReview.tsx used to call POST /results/:id/review once PER RESULT
 * in a sequential for-await loop — a 5-analyte panel was 5 full HTTP round
 * trips before the button's spinner stopped, and "Approve All N Tests"
 * nested that inside a per-specimen loop on top. This endpoint does every
 * result (and the specimens they belong to) in exactly two statements, one
 * transaction, regardless of how many ids are passed — the frontend now
 * calls it once per request instead of looping.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let batchReviewHandler;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function req(overrides) {
  return {
    params: {}, body: {}, query: {},
    user: { id: 1, displayName: 'Review Tester', role: 'admin' },
    branchContext: { isAdmin: true },
    models: testConn,
    ...overrides,
  };
}

async function makeOrderWithSpecimen(prefix) {
  const orderId = uuid();
  const specimenId = uuid();
  const participantId = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name) VALUES (?, ?, 'Batch', 'Reviewee')`,
    { replacements: [participantId, `BR-${prefix}-${Date.now()}`] }
  );
  await sequelize.query(
    `INSERT INTO lis_test_orders (id, participant_id, status) VALUES (?, ?, 'ordered')`,
    { replacements: [orderId, participantId] }
  );
  await sequelize.query(
    `INSERT INTO lis_specimens (id, order_id, test_code, test_name, barcode, status)
     VALUES (?, ?, ?, ?, ?, 'pending_manager_review')`,
    { replacements: [specimenId, orderId, `${prefix}-CODE`, `${prefix} Test`, `BR-${prefix}-${Date.now()}`] }
  );
  return { orderId, specimenId };
}

async function makeResult(specimenId, analyte) {
  const id = uuid();
  await sequelize.query(
    `INSERT INTO lis_results (id, specimen_id, test_code, analyte, value, status)
     VALUES (?, ?, 'T1', ?, '5', 'pending_manager_review')`,
    { replacements: [id, specimenId, analyte] }
  );
  return id;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const lisRouter = require('../../src/server/routes/lisModule');
  const layer = lisRouter.stack.find((l) => l.route && l.route.path === '/results/batch-review' && l.route.methods.post);
  batchReviewHandler = layer.route.stack[layer.route.stack.length - 1].handle;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM lis_results WHERE test_code = 'T1'`);
    await sequelize.query(`DELETE FROM lis_specimens WHERE barcode LIKE 'BR-%'`);
    await sequelize.query(`DELETE FROM lis_test_orders WHERE participant_id IN (SELECT id FROM lis_participants WHERE participant_number LIKE 'BR-%')`);
    await sequelize.query(`DELETE FROM lis_participants WHERE participant_number LIKE 'BR-%'`);
  } catch (e) { console.warn('lisResultsBatchReview cleanup failed (non-fatal):', e.message); }
});

describe('POST /api/lis/results/batch-review', () => {
  test('approves every result and its specimen in one call, across multiple specimens', async () => {
    const a = await makeOrderWithSpecimen('BatchA');
    const b = await makeOrderWithSpecimen('BatchB');
    const r1 = await makeResult(a.specimenId, 'Glucose');
    const r2 = await makeResult(a.specimenId, 'Sodium');
    const r3 = await makeResult(b.specimenId, 'Potassium');

    const res = mockRes();
    await withTenant(() => batchReviewHandler(
      req({ body: { ids: [r1, r2, r3], action: 'approved', manager_notes: '', manager_id: 7 } }),
      res
    ));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, updated: 3 });

    const [results] = await sequelize.query(`SELECT id, status, manager_review_by FROM lis_results WHERE id IN (?)`, { replacements: [[r1, r2, r3]] });
    expect(results.every((r) => r.status === 'approved')).toBe(true);
    expect(results.every((r) => r.manager_review_by === 7)).toBe(true);

    const [specimens] = await sequelize.query(`SELECT id, status FROM lis_specimens WHERE id IN (?)`, { replacements: [[a.specimenId, b.specimenId]] });
    expect(specimens.every((s) => s.status === 'approved')).toBe(true);
  });

  test('records manager_notes on a query/reject action', async () => {
    const a = await makeOrderWithSpecimen('BatchQ');
    const r1 = await makeResult(a.specimenId, 'Creatinine');

    const res = mockRes();
    await withTenant(() => batchReviewHandler(
      req({ body: { ids: [r1], action: 'queried', manager_notes: 'repeat sample', manager_id: 9 } }),
      res
    ));

    expect(res.statusCode).toBe(200);
    const [[result]] = await sequelize.query(`SELECT status, manager_notes FROM lis_results WHERE id = ?`, { replacements: [r1] });
    expect(result.status).toBe('queried');
    expect(result.manager_notes).toBe('repeat sample');
  });

  test('rejects an empty ids array', async () => {
    const res = mockRes();
    await withTenant(() => batchReviewHandler(req({ body: { ids: [], action: 'approved' } }), res));
    expect(res.statusCode).toBe(400);
  });

  test('rejects a missing action', async () => {
    const res = mockRes();
    await withTenant(() => batchReviewHandler(req({ body: { ids: [uuid()] } }), res));
    expect(res.statusCode).toBe(400);
  });
});
