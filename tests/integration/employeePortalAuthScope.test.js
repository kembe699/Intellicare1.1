/**
 * Employee-portal login (wrong code/lockout/disabled/PIN-required gate) and
 * the hard scope separation between the employee-portal JWT and the normal
 * HMIS user JWT: a portal token must never reach an HMIS API route, and an
 * HMIS user token must never reach a portal route.
 *
 * Calls the REAL route handlers/middleware directly (see
 * tests/integration/antenatal.test.js for why — no HTTP test harness in
 * this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const JWT_SECRET = process.env.JWT_SECRET;

let sequelize;
let testConn;
let loginHandler;
let setPinHandler;
let meHandler;
let authenticateEmployeePortal;
let authenticateToken;
let employeeId;
let employeeNumber;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = () => {};
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

  const router = require('../../src/server/routes/employeePortal');
  loginHandler = handlerFor(router, '/login', 'post');
  setPinHandler = handlerFor(router, '/auth/set-pin', 'post');
  meHandler = handlerFor(router, '/me', 'get');
  ({ authenticateEmployeePortal } = require('../../src/server/middleware/employeePortalAuth'));
  ({ authenticateToken } = require('../../src/server/middleware/auth'));

  employeeId = uuid();
  employeeNumber = `PORTAL-TEST-${Date.now()}`;
  const codeHash = await bcrypt.hash('111111', 12);
  await sequelize.query(`
    INSERT INTO employees (id, clinic_id, branch_id, employee_number, employment_type, first_name, last_name,
      employment_status, is_active, portal_access_enabled, portal_code_hash, created_at, updated_at)
    VALUES (:id, 1, 1, :empNum, 'staff', 'Portal', 'Tester', 'active', TRUE, TRUE, :codeHash, NOW(), NOW())
  `, { replacements: { id: employeeId, empNum: employeeNumber, codeHash } });
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM portal_login_attempts WHERE employee_id = :id`, { replacements: { id: employeeId } });
    await sequelize.query(`DELETE FROM employees WHERE id = :id`, { replacements: { id: employeeId } });
  } catch (e) { console.warn('employeePortalAuthScope cleanup failed (non-fatal):', e.message); }
});

describe('POST /login', () => {
  test('rejects a wrong code with a generic error (no account enumeration)', async () => {
    const req = { body: { code: 'invalidcode', employee_number: employeeNumber, credential: '111111' }, ip: '127.0.0.1', headers: {} };
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/Invalid employee number or code/);
  });

  test('rejects a wrong credential for a real employee', async () => {
    // Needs a real tenant code — resolve it from the platform Client row
    // pointing at this schema, same as the route itself does.
    const { Client } = require('../../src/server/models/platform');
    const client = await Client.findOne({ where: { schema_name: TEST_SCHEMA } });
    const req = { body: { code: client.code, employee_number: employeeNumber, credential: 'wrong-code' }, ip: '127.0.0.1', headers: {} };
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('5 wrong attempts lock the account for subsequent attempts, including a later-correct one', async () => {
    // Clean slate — an earlier test in this file ("rejects a wrong
    // credential") already incremented portal_failed_attempts by 1, and
    // without resetting here that earlier increment pushes the lockout
    // threshold one attempt earlier than this test's own loop expects.
    await sequelize.query(`UPDATE employees SET portal_failed_attempts = 0, portal_locked_until = NULL WHERE id = :id`, { replacements: { id: employeeId } });

    const { Client } = require('../../src/server/models/platform');
    const client = await Client.findOne({ where: { schema_name: TEST_SCHEMA } });
    for (let i = 0; i < 5; i++) {
      const res = mockRes();
      await loginHandler({ body: { code: client.code, employee_number: employeeNumber, credential: 'nope' }, ip: '127.0.0.1', headers: {} }, res);
      expect(res.statusCode).toBe(401);
    }
    const lockedRes = mockRes();
    await loginHandler({ body: { code: client.code, employee_number: employeeNumber, credential: '111111' }, ip: '127.0.0.1', headers: {} }, lockedRes);
    expect(lockedRes.statusCode).toBe(423);
    expect(lockedRes.body.error).toMatch(/Too many failed attempts/);

    // Reset the lockout for the tests below.
    await sequelize.query(`UPDATE employees SET portal_failed_attempts = 0, portal_locked_until = NULL WHERE id = :id`, { replacements: { id: employeeId } });
  }, 15000);

  test('a disabled portal account cannot log in even with the right code', async () => {
    await sequelize.query(`UPDATE employees SET portal_access_enabled = FALSE WHERE id = :id`, { replacements: { id: employeeId } });
    const { Client } = require('../../src/server/models/platform');
    const client = await Client.findOne({ where: { schema_name: TEST_SCHEMA } });
    const res = mockRes();
    await loginHandler({ body: { code: client.code, employee_number: employeeNumber, credential: '111111' }, ip: '127.0.0.1', headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/Portal access has not been set up/);
    await sequelize.query(`UPDATE employees SET portal_access_enabled = TRUE WHERE id = :id`, { replacements: { id: employeeId } });
  });

  test('a correct one-time code succeeds and returns mustSetPin: true', async () => {
    // Defensive — this test must start unlocked regardless of what ran before.
    await sequelize.query(`UPDATE employees SET portal_failed_attempts = 0, portal_locked_until = NULL WHERE id = :id`, { replacements: { id: employeeId } });
    const { Client } = require('../../src/server/models/platform');
    const client = await Client.findOne({ where: { schema_name: TEST_SCHEMA } });
    const res = mockRes();
    await loginHandler({ body: { code: client.code, employee_number: employeeNumber, credential: '111111' }, ip: '127.0.0.1', headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.mustSetPin).toBe(true);
    expect(res.body.token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, JWT_SECRET);
    expect(decoded.isEmployeePortal).toBe(true);
    expect(decoded.employeeId).toBe(employeeId);
  });
});

describe('requirePortalPinSet gate', () => {
  test('every route but set-pin is blocked until a PIN is set', async () => {
    await withTenant(async () => {
      const req = { employee: { id: employeeId, mustSetPin: true } };
      const res = mockRes();
      const { requirePortalPinSet } = require('../../src/server/middleware/employeePortalAuth');
      let nextCalled = false;
      requirePortalPinSet(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('set_pin_required');
    });
  });

  test('setting a PIN clears portal_code_hash and portal_pin_set_at is populated', async () => {
    await withTenant(async () => {
      const req = { employee: { id: employeeId }, body: { pin: '2468' } };
      const res = mockRes();
      await setPinHandler(req, res);
      expect(res.statusCode).toBe(200);
    });
    const [[row]] = await sequelize.query(`SELECT portal_code_hash, portal_pin_hash, portal_pin_set_at FROM employees WHERE id = :id`, { replacements: { id: employeeId } });
    expect(row.portal_code_hash).toBeNull();
    expect(row.portal_pin_hash).not.toBeNull();
    expect(row.portal_pin_set_at).not.toBeNull();
  });
});

describe('scope separation — a portal JWT must never reach an HMIS API route, and vice versa', () => {
  test('a genuine employee-portal JWT is rejected by authenticateToken (no userId in the payload)', (done) => {
    const portalToken = jwt.sign({ employeeId, schemaName: TEST_SCHEMA, isEmployeePortal: true }, JWT_SECRET, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${portalToken}` }, path: '/hr/employees' };
    const res = {
      status(code) {
        expect(code).toBe(401);
        return this;
      },
      json(body) {
        done();
        return this;
      },
    };
    authenticateToken(req, res, () => {
      done(new Error('authenticateToken must not call next() for a portal token'));
    });
  }, 10000);

  test('a genuine HMIS user JWT is rejected by authenticateEmployeePortal (missing isEmployeePortal)', async () => {
    const hmisToken = jwt.sign({ userId: 1, email: 'admin@test.local', role: 'admin', clinicId: 1, branchId: 1, schemaName: TEST_SCHEMA, clientCode: 'test' }, JWT_SECRET, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${hmisToken}` } };
    const res = mockRes();
    let nextCalled = false;
    await new Promise((resolve) => {
      authenticateEmployeePortal(req, res, () => { nextCalled = true; resolve(); });
      setTimeout(resolve, 2000);
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  }, 10000);

  test('a portal JWT for a since-disabled employee is rejected live (not just at issue time)', async () => {
    await sequelize.query(`UPDATE employees SET portal_access_enabled = FALSE WHERE id = :id`, { replacements: { id: employeeId } });
    const portalToken = jwt.sign({ employeeId, schemaName: TEST_SCHEMA, isEmployeePortal: true }, JWT_SECRET, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${portalToken}` } };
    const res = mockRes();
    let nextCalled = false;
    await new Promise((resolve) => {
      authenticateEmployeePortal(req, res, () => { nextCalled = true; resolve(); });
      setTimeout(resolve, 2000);
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    await sequelize.query(`UPDATE employees SET portal_access_enabled = TRUE WHERE id = :id`, { replacements: { id: employeeId } });
  }, 10000);
});
