/**
 * approval_permissions.sole_approver — a deliberate, explicit, per-user/
 * per-approval_type exemption from the segregation-of-duties rule in
 * daily-expenses.js's two multi-level approval chains (see
 * dailyExpenseApprovalSegregation.test.js for the behavioral proof that it
 * actually lets a user clear every level alone). This file covers the grant
 * API itself: POST /api/approvals/permissions is an upsert keyed on
 * (clinic_id, user_id, approval_type), and re-granting an existing
 * permission_type without mentioning sole_approver must not silently reset
 * a previously-set exemption back to false — that would be a quiet,
 * hard-to-notice way to undo an intentional grant.
 *
 * Calls the REAL route handler directly (see receiptVoidApproval.test.js
 * for the established handlerFor() extraction pattern) against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let grantHandler;
let testUserId;

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

async function getGrant(userId, approvalType) {
  const [[row]] = await sequelize.query(
    `SELECT * FROM approval_permissions WHERE clinic_id = :c AND user_id = :u AND approval_type = :type`,
    { replacements: { c: TEST_CLINIC_ID, u: userId, type: approvalType } }
  );
  return row;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  await sequelize.query(`ALTER TABLE approval_permissions ADD COLUMN IF NOT EXISTS sole_approver BOOLEAN NOT NULL DEFAULT FALSE`);

  const approvalsRouter = require('../../src/server/routes/approvals');
  grantHandler = handlerFor(approvalsRouter, '/permissions', 'post');

  const [[user]] = await sequelize.query(
    `INSERT INTO users (email, display_name, role, password_hash, clinic_id, status, is_active, created_at, updated_at)
     VALUES (:email, 'SoleApproverGrant Tester', 'accountant', 'x', :c, 'active', true, NOW(), NOW()) RETURNING id`,
    { replacements: { email: `soleapprovergrant-${Date.now()}@example.test`, c: TEST_CLINIC_ID } }
  );
  testUserId = user.id;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM approval_permissions WHERE user_id = :u`, { replacements: { u: testUserId } });
    await sequelize.query(`DELETE FROM users WHERE id = :u`, { replacements: { u: testUserId } });
  } catch (e) { console.warn('approvalPermissionsSoleApprover cleanup failed (non-fatal):', e.message); }
});

describe('POST /api/approvals/permissions — sole_approver upsert semantics', () => {
  test('granting with sole_approver: true sets it', async () => {
    const res = mockRes();
    await withTenant(() => grantHandler({ body: { user_id: testUserId, approval_type: 'expense_approve', sole_approver: true }, user: { id: 1 } }, res));
    expect(res.statusCode).toBe(201);
    const grant = await getGrant(testUserId, 'expense_approve');
    expect(grant.sole_approver).toBe(true);
  });

  test('re-granting the same type WITHOUT mentioning sole_approver preserves the existing true', async () => {
    const res = mockRes();
    await withTenant(() => grantHandler({ body: { user_id: testUserId, approval_type: 'expense_approve' }, user: { id: 1 } }, res));
    expect(res.statusCode).toBe(201);
    const grant = await getGrant(testUserId, 'expense_approve');
    expect(grant.sole_approver).toBe(true);
  });

  test('explicitly sending sole_approver: false clears it', async () => {
    const res = mockRes();
    await withTenant(() => grantHandler({ body: { user_id: testUserId, approval_type: 'expense_approve', sole_approver: false }, user: { id: 1 } }, res));
    expect(res.statusCode).toBe(201);
    const grant = await getGrant(testUserId, 'expense_approve');
    expect(grant.sole_approver).toBe(false);
  });

  test('a brand-new grant with no sole_approver field defaults to false', async () => {
    const res = mockRes();
    await withTenant(() => grantHandler({ body: { user_id: testUserId, approval_type: 'supplier_bill_approve' }, user: { id: 1 } }, res));
    expect(res.statusCode).toBe(201);
    const grant = await getGrant(testUserId, 'supplier_bill_approve');
    expect(grant.sole_approver).toBe(false);
  });
});
