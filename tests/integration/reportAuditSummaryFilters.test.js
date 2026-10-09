/**
 * Audit Log report (reportAuditSummary.js) — proves the new action/status
 * filters and the GET /actions endpoint added for the redesigned Audit Log
 * page actually narrow/list correctly against real seeded `audit_logs` rows.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const SUFFIX = `AUDITFILT${Date.now()}`;

let sequelize;
let testConn;
let router;
let ids = [];

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function handlerFor(routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(query) {
  return { query, user: { id: 1, role: 'admin', clinicId: 1 }, branchContext: { isAdmin: true } };
}

async function run(path, query) {
  const handler = handlerFor(path, 'get');
  const res = mockRes();
  await withTenant(() => handler(req(query), res));
  return res;
}

async function insertLog({ action, status, userId, userName, createdAt, description }) {
  const id = uuid();
  ids.push(id);
  await sequelize.query(
    `INSERT INTO audit_logs (id, clinic_id, user_id, user_name, user_role, module, action, description, status, created_at)
     VALUES (:id, 1, :userId, :userName, 'staff', 'test', :action, :description, :status, :createdAt)`,
    { replacements: { id, userId, userName, action, description: description || null, status, createdAt } }
  );
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  router = require('../../src/server/routes/reportAuditSummary');

  // Two users, two action types, one success and one failure (with a
  // reason in description — the "note" the Activity Log's Note/Reason
  // column should surface), all inside the test's date range.
  await insertLog({ action: `${SUFFIX}_LOGIN`, status: 'success', userId: 9001, userName: `${SUFFIX} Alice`, createdAt: '2026-03-01 09:00:00' });
  await insertLog({ action: `${SUFFIX}_LOGIN`, status: 'failure', userId: 9002, userName: `${SUFFIX} Bob`, createdAt: '2026-03-02 10:00:00', description: 'Invalid password' });
  await insertLog({ action: `${SUFFIX}_BILL_VOID`, status: 'success', userId: 9001, userName: `${SUFFIX} Alice`, createdAt: '2026-03-03 11:00:00' });

  // One row from BEFORE the test's date range, with a third action type —
  // proves GET /actions is unscoped by date (lists it) while the main
  // report's Activity Log (scoped to the date range) does not.
  await insertLog({ action: `${SUFFIX}_OLD_ACTION`, status: 'success', userId: 9001, userName: `${SUFFIX} Alice`, createdAt: '2020-01-01 08:00:00' });
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM audit_logs WHERE id IN (:ids)`, { replacements: { ids } });
  } catch (e) { console.warn('reportAuditSummaryFilters cleanup failed (non-fatal):', e.message); }
});

const range = { dateFrom: '2026-01-01', dateTo: '2026-12-31', clinic_id: '1' };

describe('Audit Log filters', () => {
  test('GET /actions lists every distinct action ever logged, including ones outside any date range', async () => {
    const res = await run('/actions', { clinic_id: '1' });
    expect(res.body.actions).toContain(`${SUFFIX}_LOGIN`);
    expect(res.body.actions).toContain(`${SUFFIX}_BILL_VOID`);
    expect(res.body.actions).toContain(`${SUFFIX}_OLD_ACTION`);
  });

  test('action filter narrows the Activity Log to just that action', async () => {
    const res = await run('/', { ...range, action: `${SUFFIX}_LOGIN` });
    const mine = res.body.activity.rows.filter((r) => r.action.startsWith(SUFFIX));
    expect(mine.length).toBe(2);
    expect(mine.every((r) => r.action === `${SUFFIX}_LOGIN`)).toBe(true);
  });

  test('the old out-of-range action never appears in the date-scoped Activity Log', async () => {
    const res = await run('/', range);
    const mine = res.body.activity.rows.filter((r) => r.action.startsWith(SUFFIX));
    expect(mine.some((r) => r.action === `${SUFFIX}_OLD_ACTION`)).toBe(false);
  });

  test('status filter narrows to failures only, and the failure reason is in description', async () => {
    const res = await run('/', { ...range, status: 'failure' });
    const mine = res.body.activity.rows.filter((r) => r.action.startsWith(SUFFIX));
    expect(mine.length).toBe(1);
    expect(mine[0].userName).toBe(`${SUFFIX} Bob`);
    expect(mine[0].description).toBe('Invalid password');
  });

  test('user + action filters combine (AND, not OR)', async () => {
    const res = await run('/', { ...range, userId: '9001', action: `${SUFFIX}_LOGIN` });
    const mine = res.body.activity.rows.filter((r) => r.action.startsWith(SUFFIX));
    // Alice's LOGIN row only (Bob's LOGIN is excluded by userId, Alice's
    // BILL_VOID is excluded by action).
    expect(mine.length).toBe(1);
    expect(mine[0].userName).toBe(`${SUFFIX} Alice`);
    expect(mine[0].action).toBe(`${SUFFIX}_LOGIN`);
  });

  test('an action filter narrows the Staff Activity Summary and totals tiles too, not just the Activity Log', async () => {
    // Real bug this covers: byUser/mostActiveUser/totalsRow used to stay
    // scoped only by date+branch, never by the action/status filters —
    // picking an action showed a "Total Actions Logged: 0" tile next to a
    // Staff Activity Summary row still claiming "5 actions" for the same
    // filter, because the two were reading from differently-scoped queries.
    const res = await run('/', { ...range, action: `${SUFFIX}_LOGIN` });
    const alice = res.body.byUser.find((r) => r.userName === `${SUFFIX} Alice`);
    const bob = res.body.byUser.find((r) => r.userName === `${SUFFIX} Bob`);
    // Alice has 2 total actions (LOGIN + BILL_VOID) but only 1 LOGIN.
    expect(alice.actionCount).toBe(1);
    expect(bob.actionCount).toBe(1);
    // totalsRow must agree with what byUser now shows: 1 + 1 = 2, not the
    // unfiltered total of 3.
    expect(res.body.totals.totalActions).toBe(2);
    expect(res.body.totals.activeStaffCount).toBe(2);
  });
});
