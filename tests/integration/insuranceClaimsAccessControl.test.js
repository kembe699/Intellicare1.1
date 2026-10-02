/**
 * Security audit finding: insuranceClaims.js had five GET routes
 * (/insurance-schemes, /unpaid-invoices, GET /, GET /:id, GET /:id/pdf) with
 * no authorize() call at all — any authenticated user of any role could list
 * and read every insurance claim. The file's own top-of-file comment says
 * these endpoints are meant to "mirror the roles App.tsx allows on
 * /billing-management" (claims.write — confirmed in src/App.tsx's route
 * guards for /billing-management and /billing-management/claims/:claimId),
 * but only the mutating routes (POST/PUT/DELETE) actually enforced it.
 * GET /:id/pdf also skipped the branch check its sibling GET /:id already
 * had, so any authenticated user, any branch, could pull a claim's PDF
 * (patient + financial detail) by id.
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
let handlers = {};
let branchAId, branchBId;
let claimId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = () => res;
  res.send = (body) => { res.sent = body; return res; };
  return res;
}

function handlerFor(router, routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(overrides) {
  return {
    params: {}, body: {}, query: {},
    user: { id: 1, displayName: 'Claims Tester', role: 'doctor', clinicId: TEST_CLINIC_ID },
    branchContext: {},
    ...overrides,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const claimsRouter = require('../../src/server/routes/insuranceClaims');
  handlers = {
    getById: handlerFor(claimsRouter, '/:id', 'get'),
    getPdf: handlerFor(claimsRouter, '/:id/pdf', 'get'),
  };

  const [[a]] = await sequelize.query(`INSERT INTO branches (name, is_active) VALUES ('ClaimsTest Branch A', true) RETURNING id`);
  const [[b]] = await sequelize.query(`INSERT INTO branches (name, is_active) VALUES ('ClaimsTest Branch B', true) RETURNING id`);
  branchAId = a.id; branchBId = b.id;

  claimId = uuid();
  await sequelize.query(
    `INSERT INTO insurance_batch_claims (id, clinic_id, branch_id, claim_number, scheme_id, claim_amount, status)
     VALUES (:id, :c, :b, :num, :scheme, 1000, 'draft')`,
    { replacements: { id: claimId, c: TEST_CLINIC_ID, b: branchAId, num: `CLAIMSTEST-${Date.now()}`, scheme: uuid() } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM insurance_batch_claims WHERE id = :id`, { replacements: { id: claimId } });
    await sequelize.query(`DELETE FROM branches WHERE id IN (:a, :b)`, { replacements: { a: branchAId, b: branchBId } });
  } catch (e) { console.warn('insuranceClaimsAccessControl cleanup failed (non-fatal):', e.message); }
});

describe('insuranceClaims.js read routes require claims.write and enforce branch access', () => {
  // authorize() is Express middleware — handlerFor() extracts only the final
  // route handler, bypassing it, so privilege enforcement is verified by
  // source inspection (same convention as documentsPdfAccess.test.js).
  test('all five previously-unguarded GET routes now require authorize(\'claims.write\')', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/server/routes/insuranceClaims.js'), 'utf8');
    expect(src).toMatch(/router\.get\('\/insurance-schemes',\s*authorize\('claims\.write'\)/);
    expect(src).toMatch(/router\.get\('\/unpaid-invoices',\s*authorize\('claims\.write'\)/);
    expect(src).toMatch(/router\.get\('\/',\s*authorize\('claims\.write'\)/);
    expect(src).toMatch(/router\.get\('\/:id',\s*authorize\('claims\.write'\)/);
    expect(src).toMatch(/router\.get\('\/:id\/pdf',\s*authorize\('claims\.write'\)/);
  });

  test('a branch-scoped user CANNOT fetch another branch\'s claim via GET /:id', async () => {
    const res = mockRes();
    await withTenant(() => handlers.getById(req({
      params: { id: claimId },
      user: { id: 2, role: 'accountant', clinicId: TEST_CLINIC_ID, branchId: branchBId },
      branchContext: { branchId: branchBId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(404);
  });

  test('a branch-scoped user CAN fetch their own branch\'s claim via GET /:id', async () => {
    const res = mockRes();
    await withTenant(() => handlers.getById(req({
      params: { id: claimId },
      user: { id: 3, role: 'accountant', clinicId: TEST_CLINIC_ID, branchId: branchAId },
      branchContext: { branchId: branchAId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(200);
  });

  test('a branch-scoped user CANNOT fetch another branch\'s claim PDF — the gap GET /:id already had closed but /:id/pdf did not', async () => {
    const res = mockRes();
    await withTenant(() => handlers.getPdf(req({
      params: { id: claimId },
      user: { id: 4, role: 'accountant', clinicId: TEST_CLINIC_ID, branchId: branchBId },
      branchContext: { branchId: branchBId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(404);
  });
});
