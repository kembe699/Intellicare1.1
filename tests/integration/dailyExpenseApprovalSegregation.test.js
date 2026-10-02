/**
 * Audit finding: both multi-level approval routes in daily-expenses.js only
 * ever checked the NUMBER of existing approval rows (existing.length >= N),
 * never which user each row belonged to. A single person holding the
 * relevant approval permission (expense_approve / supplier_bill_approve)
 * could call the same endpoint repeatedly and single-handedly supply every
 * required approval level, defeating the whole point of a multi-level
 * approval chain (segregation of duties).
 *
 * Fixed by rejecting a second approval attempt from the same user_id with a
 * 400, requiring a genuinely different approver for the next level.
 *
 * Calls the REAL route handlers directly (see receiptVoidApproval.test.js
 * for the established handlerFor() extraction pattern — requireApprovalPermission
 * is Express middleware and is bypassed here by extracting the terminal
 * handler; that's fine because this fix lives entirely inside the handler,
 * not in the permission gate) against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let DailyExpense;
let PurchaseOrder;
let approveExpenseHandler;
let approveSupplierBillHandler;
let userAId;
let userBId;

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

async function makeUser(suffix) {
  const [[user]] = await sequelize.query(
    `INSERT INTO users (email, display_name, role, password_hash, clinic_id, status, is_active, created_at, updated_at)
     VALUES (:email, :name, 'accountant', 'x', :clinicId, 'active', true, NOW(), NOW()) RETURNING id`,
    { replacements: { email: `segtest-${suffix}-${Date.now()}@example.test`, name: `SegTest Approver ${suffix}`, clinicId: TEST_CLINIC_ID } }
  );
  return user.id;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  DailyExpense = testConn.models.DailyExpense;
  PurchaseOrder = testConn.models.PurchaseOrder;

  const dailyExpensesRouter = require('../../src/server/routes/daily-expenses');
  approveExpenseHandler = handlerFor(dailyExpensesRouter, '/:id/approve', 'post');
  approveSupplierBillHandler = handlerFor(dailyExpensesRouter, '/supplier-bills/:po_id/approve', 'post');

  // approval_permissions.sole_approver is normally added by routes/approvals.js's
  // own self-migrating IIFE on require, against whatever the ambient default
  // connection is at that moment — not reliably tenant_test. Ensuring it
  // directly here, same idempotent ADD COLUMN IF NOT EXISTS, guarantees it
  // exists against the schema this test actually runs against.
  await sequelize.query(`ALTER TABLE approval_permissions ADD COLUMN IF NOT EXISTS sole_approver BOOLEAN NOT NULL DEFAULT FALSE`);

  userAId = await makeUser('A');
  userBId = await makeUser('B');
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM daily_expense_approvals WHERE expense_id IN (SELECT id FROM daily_expenses WHERE description LIKE 'SEGTEST-%')`);
    await sequelize.query(`DELETE FROM daily_expenses WHERE description LIKE 'SEGTEST-%'`);
    await sequelize.query(`DELETE FROM supplier_bill_approvals WHERE po_id IN (SELECT id::text FROM purchase_orders WHERE po_number LIKE 'SEGTEST-%')`);
    await sequelize.query(`DELETE FROM purchase_orders WHERE po_number LIKE 'SEGTEST-%'`);
    await sequelize.query(`DELETE FROM approval_permissions WHERE user_id IN (:ids)`, { replacements: { ids: [userAId, userBId] } });
    await sequelize.query(`DELETE FROM users WHERE id IN (:ids)`, { replacements: { ids: [userAId, userBId] } });
  } catch (e) { console.warn('dailyExpenseApprovalSegregation cleanup failed (non-fatal):', e.message); }
});

async function makeExpense(suffix) {
  const expense = await withTenant(() => DailyExpense.create({
    expense_date: new Date(), description: `SEGTEST-${suffix}`, amount: 1000,
    account_id: uuid(), clinic_id: TEST_CLINIC_ID, status: 'pending_approval',
  }));
  return expense.id;
}

async function makeSupplierBillPO(suffix) {
  const order = await withTenant(() => PurchaseOrder.create({
    po_number: `SEGTEST-${suffix}-${Date.now()}`, supplier_id: 1, order_date: new Date(),
    total_amount: 5000, status: 'authorized', clinic_id: TEST_CLINIC_ID,
  }));
  return order.id;
}

async function grantSoleApprover(userId, approvalType) {
  await sequelize.query(
    `INSERT INTO approval_permissions (id, clinic_id, user_id, approval_type, sole_approver)
     VALUES (:id, :c, :u, :type, true)
     ON CONFLICT (clinic_id, user_id, approval_type) DO UPDATE SET sole_approver = true`,
    { replacements: { id: uuid(), c: TEST_CLINIC_ID, u: userId, type: approvalType } }
  );
}

describe('Expense approval (2-level) requires two different approvers', () => {
  test('the same user cannot supply both required approvals alone', async () => {
    const expenseId = await makeExpense(`DUP-${Date.now()}`);
    const req = () => ({ params: { id: expenseId }, body: {}, user: { id: userAId, role: 'accountant' } });

    const firstRes = mockRes();
    await withTenant(() => approveExpenseHandler(req(), firstRes));
    expect(firstRes.statusCode).toBe(201);
    expect(firstRes.body.approval_level).toBe(1);

    const secondRes = mockRes();
    await withTenant(() => approveExpenseHandler(req(), secondRes));
    expect(secondRes.statusCode).toBe(400);
    expect(secondRes.body.error).toMatch(/already approved/i);

    const [rows] = await sequelize.query(`SELECT * FROM daily_expense_approvals WHERE expense_id = :id`, { replacements: { id: expenseId } });
    expect(rows.length).toBe(1);

    const [[reloaded]] = await sequelize.query(`SELECT status FROM daily_expenses WHERE id = :id`, { replacements: { id: expenseId } });
    expect(reloaded.status).not.toBe('approved');
  });

  test('two different approvers can still reach full approval', async () => {
    const expenseId = await makeExpense(`OK-${Date.now()}`);

    const firstRes = mockRes();
    await withTenant(() => approveExpenseHandler({ params: { id: expenseId }, body: {}, user: { id: userAId, role: 'accountant' } }, firstRes));
    expect(firstRes.statusCode).toBe(201);
    expect(firstRes.body.approval_level).toBe(1);

    const secondRes = mockRes();
    await withTenant(() => approveExpenseHandler({ params: { id: expenseId }, body: {}, user: { id: userBId, role: 'accountant' } }, secondRes));
    expect(secondRes.statusCode).toBe(201);
    expect(secondRes.body.approval_level).toBe(2);

    const [[reloaded]] = await sequelize.query(`SELECT status, voucher_number FROM daily_expenses WHERE id = :id`, { replacements: { id: expenseId } });
    expect(reloaded.status).toBe('approved');
    expect(reloaded.voucher_number).toBeTruthy();
  });
});

describe('Supplier bill approval (3-level) requires a different approver per level', () => {
  test('the same user cannot supply all three required approvals alone', async () => {
    const poId = await makeSupplierBillPO('DUP');
    const req = () => ({ params: { po_id: String(poId) }, body: {}, user: { id: userAId, role: 'accountant' } });

    const firstRes = mockRes();
    await withTenant(() => approveSupplierBillHandler(req(), firstRes));
    expect(firstRes.statusCode).toBe(201);
    expect(firstRes.body.approval_level).toBe(1);

    const secondRes = mockRes();
    await withTenant(() => approveSupplierBillHandler(req(), secondRes));
    expect(secondRes.statusCode).toBe(400);
    expect(secondRes.body.error).toMatch(/already approved/i);

    const [rows] = await sequelize.query(`SELECT * FROM supplier_bill_approvals WHERE po_id = :poId`, { replacements: { poId: String(poId) } });
    expect(rows.length).toBe(1);
  });

  test('three different approvers can still reach full approval', async () => {
    const poId = await makeSupplierBillPO('OK');
    const userCId = await makeUser('C');
    try {
      const levels = [userAId, userBId, userCId];
      for (let i = 0; i < levels.length; i++) {
        const res = mockRes();
        await withTenant(() => approveSupplierBillHandler({ params: { po_id: String(poId) }, body: {}, user: { id: levels[i], role: 'accountant' } }, res));
        expect(res.statusCode).toBe(201);
        expect(res.body.approval_level).toBe(i + 1);
      }
      const [rows] = await sequelize.query(`SELECT * FROM supplier_bill_approvals WHERE po_id = :poId`, { replacements: { poId: String(poId) } });
      expect(rows.length).toBe(3);
    } finally {
      await sequelize.query(`DELETE FROM supplier_bill_approvals WHERE po_id = :poId`, { replacements: { poId: String(poId) } });
      await sequelize.query(`DELETE FROM users WHERE id = :id`, { replacements: { id: userCId } });
    }
  });
});

describe('sole_approver is a deliberate, explicit, per-user/per-type exemption', () => {
  test('a user granted sole_approver for expense_approve CAN clear both levels alone', async () => {
    await grantSoleApprover(userAId, 'expense_approve');
    try {
      const expenseId = await makeExpense(`SOLE-${Date.now()}`);
      const req = () => ({ params: { id: expenseId }, body: {}, user: { id: userAId, role: 'accountant' } });

      const firstRes = mockRes();
      await withTenant(() => approveExpenseHandler(req(), firstRes));
      expect(firstRes.statusCode).toBe(201);
      expect(firstRes.body.approval_level).toBe(1);

      const secondRes = mockRes();
      await withTenant(() => approveExpenseHandler(req(), secondRes));
      expect(secondRes.statusCode).toBe(201);
      expect(secondRes.body.approval_level).toBe(2);

      const [rows] = await sequelize.query(`SELECT * FROM daily_expense_approvals WHERE expense_id = :id`, { replacements: { id: expenseId } });
      expect(rows.length).toBe(2);
      expect(rows.every((r) => String(r.user_id) === String(userAId))).toBe(true);

      const [[reloaded]] = await sequelize.query(`SELECT status FROM daily_expenses WHERE id = :id`, { replacements: { id: expenseId } });
      expect(reloaded.status).toBe('approved');
    } finally {
      await sequelize.query(`DELETE FROM approval_permissions WHERE user_id = :u AND approval_type = 'expense_approve'`, { replacements: { u: userAId } });
    }
  });

  test('the exemption is per approval_type — sole_approver on expense_approve does not also exempt supplier_bill_approve', async () => {
    await grantSoleApprover(userAId, 'expense_approve');
    try {
      const poId = await makeSupplierBillPO('SOLEBLEED');
      const req = () => ({ params: { po_id: String(poId) }, body: {}, user: { id: userAId, role: 'accountant' } });

      const firstRes = mockRes();
      await withTenant(() => approveSupplierBillHandler(req(), firstRes));
      expect(firstRes.statusCode).toBe(201);

      const secondRes = mockRes();
      await withTenant(() => approveSupplierBillHandler(req(), secondRes));
      expect(secondRes.statusCode).toBe(400);
    } finally {
      await sequelize.query(`DELETE FROM approval_permissions WHERE user_id = :u AND approval_type = 'expense_approve'`, { replacements: { u: userAId } });
    }
  });

  test('a user granted sole_approver for supplier_bill_approve CAN clear all three levels alone', async () => {
    await grantSoleApprover(userAId, 'supplier_bill_approve');
    try {
      const poId = await makeSupplierBillPO('SOLE3');
      const req = () => ({ params: { po_id: String(poId) }, body: {}, user: { id: userAId, role: 'accountant' } });

      for (let level = 1; level <= 3; level++) {
        const res = mockRes();
        await withTenant(() => approveSupplierBillHandler(req(), res));
        expect(res.statusCode).toBe(201);
        expect(res.body.approval_level).toBe(level);
      }

      const fourthRes = mockRes();
      await withTenant(() => approveSupplierBillHandler(req(), fourthRes));
      expect(fourthRes.statusCode).toBe(400);
      expect(fourthRes.body.error).toMatch(/already has 3 approvals/i);

      const [rows] = await sequelize.query(`SELECT * FROM supplier_bill_approvals WHERE po_id = :poId`, { replacements: { poId: String(poId) } });
      expect(rows.length).toBe(3);
    } finally {
      await sequelize.query(`DELETE FROM approval_permissions WHERE user_id = :u AND approval_type = 'supplier_bill_approve'`, { replacements: { u: userAId } });
    }
  });
});
