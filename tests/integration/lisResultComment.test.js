/**
 * Requested: the Result Entry screen (/lis/results-entry) gets a comment
 * field for the report — but ONE per test (specimen), not one per analyte.
 * A CBC panel has 20 components; the first cut of this feature put a
 * "Comment" input on every one of those 20 rows, which was wrong — the
 * correction asked for exactly one comment box representing the whole
 * test, the same regardless of how many components that test has.
 *
 * lis_specimens gets a nullable `comment` column (not lis_results — a
 * per-analyte column was the wrong place for a per-test note). POST
 * /specimens/:id/results now takes a single top-level `comment` alongside
 * the `results` array and writes it onto the specimen row; GET
 * /specimens/:id/results, /results/pending-review and /results/history all
 * join lis_specimens already (or now do) and return it as `test_comment`
 * on every one of that specimen's result rows — same value on every row,
 * by construction, since there's exactly one source (the specimen itself).
 * Only shows on the printed report when filled in (see handlePrintResults
 * in LISResultsEntry.tsx / LISManagerReview.tsx), never as a blank line.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let postResultsHandler;
let getResultsHandler;

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
    user: { id: 1, displayName: 'Comment Tester', role: 'admin' },
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
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name) VALUES (?, ?, 'CommentTest', 'Patient')`,
    { replacements: [participantId, `${prefix}-${Date.now()}`] }
  );
  await sequelize.query(
    `INSERT INTO lis_test_orders (id, participant_id, status) VALUES (?, ?, 'ordered')`,
    { replacements: [orderId, participantId] }
  );
  await sequelize.query(
    `INSERT INTO lis_specimens (id, order_id, test_code, test_name, barcode, status)
     VALUES (?, ?, ?, ?, ?, 'analyzed')`,
    { replacements: [specimenId, orderId, `${prefix}-CODE`, `${prefix} Test`, `${prefix}-${Date.now()}`] }
  );
  return { orderId, specimenId, participantId };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  await sequelize.query(`ALTER TABLE lis_specimens ADD COLUMN IF NOT EXISTS comment TEXT DEFAULT NULL`);

  const lisRouter = require('../../src/server/routes/lisModule');
  postResultsHandler = handlerFor(lisRouter, '/specimens/:id/results', 'post');
  getResultsHandler = handlerFor(lisRouter, '/specimens/:id/results', 'get');
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM lis_results WHERE specimen_id IN (SELECT id FROM lis_specimens WHERE test_code LIKE 'RESULTCOMMENT-%')`);
    await sequelize.query(`DELETE FROM lis_specimens WHERE test_code LIKE 'RESULTCOMMENT-%'`);
    await sequelize.query(`DELETE FROM lis_test_orders WHERE participant_id IN (SELECT id FROM lis_participants WHERE participant_number LIKE 'RESULTCOMMENT-%')`);
    await sequelize.query(`DELETE FROM lis_participants WHERE participant_number LIKE 'RESULTCOMMENT-%'`);
  } catch (e) { console.warn('lisResultComment cleanup failed (non-fatal):', e.message); }
});

describe('POST /specimens/:id/results persists ONE comment per test, not per analyte', () => {
  test('a single-component test saved with a comment comes back with it', async () => {
    const { specimenId } = await makeOrderWithSpecimen('RESULTCOMMENT-A');
    const postRes = mockRes();
    await withTenant(() => postResultsHandler(req({
      params: { id: specimenId },
      body: {
        test_code: 'RESULTCOMMENT-A-CODE',
        results: [{ analyte: 'Total Bilirubin', value: '2.1', unit: 'mg/dL' }],
        comment: 'Slight hemolysis noted',
      },
    }), postRes));
    expect(postRes.statusCode).toBe(200);

    const getRes = mockRes();
    await withTenant(() => getResultsHandler(req({ params: { id: specimenId } }), getRes));
    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].test_comment).toBe('Slight hemolysis noted');
  });

  test('a test saved with no comment stores it as NULL, not an empty string placeholder', async () => {
    const { specimenId } = await makeOrderWithSpecimen('RESULTCOMMENT-B');
    const postRes = mockRes();
    await withTenant(() => postResultsHandler(req({
      params: { id: specimenId },
      body: { test_code: 'RESULTCOMMENT-B-CODE', results: [{ analyte: 'Urea', value: '5.0', unit: 'mmol/L' }], comment: '' },
    }), postRes));
    expect(postRes.statusCode).toBe(200);

    const getRes = mockRes();
    await withTenant(() => getResultsHandler(req({ params: { id: specimenId } }), getRes));
    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].test_comment == null).toBe(true);
  });

  test('a multi-component test (CBC-style) gets exactly ONE comment, carried identically on every analyte row — not a separate comment per component', async () => {
    const { specimenId } = await makeOrderWithSpecimen('RESULTCOMMENT-C');
    const postRes = mockRes();
    await withTenant(() => postResultsHandler(req({
      params: { id: specimenId },
      body: {
        test_code: 'RESULTCOMMENT-C-CODE',
        results: [
          { analyte: 'WBC', value: '7.2', unit: '10^9/L' },
          { analyte: 'Lymph#', value: '2.1', unit: '10^9/L' },
          { analyte: 'Platelets', value: '450', unit: '10^9/L' },
        ],
        comment: 'Mild thrombocytosis, repeat in 1 week',
      },
    }), postRes));
    expect(postRes.statusCode).toBe(200);

    const getRes = mockRes();
    await withTenant(() => getResultsHandler(req({ params: { id: specimenId } }), getRes));
    expect(getRes.body.length).toBe(3);
    // Every single row — not just one of them — carries the SAME test-level comment.
    for (const row of getRes.body) {
      expect(row.test_comment).toBe('Mild thrombocytosis, repeat in 1 week');
    }
  });
});
