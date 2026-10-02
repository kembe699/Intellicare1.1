/**
 * Audit finding: several approve/cancel/pay mutate routes only ever scoped
 * their lookup/UPDATE by clinic_id, even though their own sibling GET
 * routes in the same file already restrict a non-admin to their own
 * branch_id. A branch-scoped user could approve, cancel, pay, or disburse
 * a record belonging to a different branch in the same clinic simply by
 * knowing/guessing its id — read access was correctly branch-scoped, but
 * the mutating actions were not.
 *
 * Fixed by applying the same branchScope()/nonAdminBranchId() helper each
 * file's own GET routes already use to these mutate routes too.
 *
 * Calls the REAL route handlers directly (see receiptVoidApproval.test.js
 * for the established handlerFor() extraction pattern — requireApprovalPermission
 * is Express middleware and is bypassed here by extracting the terminal
 * handler; irrelevant to these fixes, which live inside the handlers) against
 * tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const BRANCH_A = 919201;
const BRANCH_B = 919202;

let sequelize;
let testConn;

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

function userIn(branchId) {
  return { id: Math.floor(Math.random() * 1_000_000) + 600_000, role: 'hr', clinicId: TEST_CLINIC_ID, branchId };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM payroll_run_lines WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE run_number LIKE 'BRANCHISO-%')`);
    await sequelize.query(`DELETE FROM payroll_runs WHERE run_number LIKE 'BRANCHISO-%'`);
    await sequelize.query(`DELETE FROM employees WHERE employee_number LIKE 'BRANCHISO-%' OR employee_number LIKE 'BRANCHISO-SA-%'`);
    await sequelize.query(`DELETE FROM leave_requests WHERE reason LIKE 'BRANCHISO-%'`);
    await sequelize.query(`DELETE FROM salary_advances WHERE advance_number LIKE 'BRANCHISO-%'`);
    await sequelize.query(`DELETE FROM purchase_orders WHERE po_number LIKE 'BRANCHISO-%'`);
    await sequelize.query(`DELETE FROM supplier_bill_approvals WHERE po_id IN (SELECT id::text FROM purchase_orders WHERE po_number LIKE 'BRANCHISO-%')`);
  } catch (e) { console.warn('approvalMutationBranchIsolation cleanup failed (non-fatal):', e.message); }
});

describe('Payroll run approve/cancel/pay/signing-link respect branch isolation', () => {
  let approveHandler, cancelHandler, signingLinkHandler, payLineHandler, payAllHandler;
  let runId, lineId;

  beforeAll(async () => {
    const hrRouter = require('../../src/server/routes/hr');
    approveHandler = handlerFor(hrRouter, '/payroll/runs/:id/approve', 'post');
    cancelHandler = handlerFor(hrRouter, '/payroll/runs/:id/cancel', 'post');
    signingLinkHandler = handlerFor(hrRouter, '/payroll/runs/:id/lines/:lineId/signing-link', 'post');
    payLineHandler = handlerFor(hrRouter, '/payroll/runs/:id/lines/:lineId/pay', 'post');
    payAllHandler = handlerFor(hrRouter, '/payroll/runs/:id/pay', 'post');
  });

  beforeEach(async () => {
    runId = uuid();
    await sequelize.query(
      `INSERT INTO payroll_runs (id, clinic_id, branch_id, run_number, period_month, period_year, run_date, status)
       VALUES (:id, :c, :b, :num, 1, 2026, '2026-01-31', 'draft')`,
      { replacements: { id: runId, c: TEST_CLINIC_ID, b: BRANCH_A, num: `BRANCHISO-RUN-${Date.now()}-${Math.random()}` } }
    );
    const employeeId = uuid();
    await sequelize.query(
      `INSERT INTO employees (id, clinic_id, employee_number, first_name, last_name, employment_type)
       VALUES (:id, :c, :num, 'BranchIso', 'TestEmployee', 'staff')`,
      { replacements: { id: employeeId, c: TEST_CLINIC_ID, num: `BRANCHISO-${Date.now()}-${Math.random()}` } }
    );
    lineId = uuid();
    await sequelize.query(
      `INSERT INTO payroll_run_lines (id, payroll_run_id, employee_id, basic_salary, allowances_total, deductions_total, gross_pay, net_pay, currency, status)
       VALUES (:id, :runId, :employeeId, 1000, 0, 0, 1000, 1000, 'USD', 'unpaid')`,
      { replacements: { id: lineId, runId, employeeId } }
    );
  });

  test('a user in a different branch cannot approve the run', async () => {
    const res = mockRes();
    await withTenant(() => approveHandler({ params: { id: runId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(409);
    const [[run]] = await sequelize.query(`SELECT status FROM payroll_runs WHERE id = :id`, { replacements: { id: runId } });
    expect(run.status).toBe('draft');
  });

  test('a user in the same branch can approve the run', async () => {
    const res = mockRes();
    await withTenant(() => approveHandler({ params: { id: runId }, body: {}, user: userIn(BRANCH_A), branchContext: { branchId: BRANCH_A } }, res));
    expect(res.statusCode).toBe(200);
    const [[run]] = await sequelize.query(`SELECT status FROM payroll_runs WHERE id = :id`, { replacements: { id: runId } });
    expect(run.status).toBe('approved');
  });

  test('a user in a different branch cannot cancel the run', async () => {
    const res = mockRes();
    await withTenant(() => cancelHandler({ params: { id: runId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(409);
    const [[run]] = await sequelize.query(`SELECT status FROM payroll_runs WHERE id = :id`, { replacements: { id: runId } });
    expect(run.status).toBe('draft');
  });

  test('a user in a different branch cannot generate a signing link for the run', async () => {
    await withTenant(() => approveHandler({ params: { id: runId }, body: {}, user: userIn(BRANCH_A), branchContext: { branchId: BRANCH_A } }, mockRes()));
    const res = mockRes();
    await withTenant(() => signingLinkHandler({ params: { id: runId, lineId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(404);
  });

  test('a user in a different branch cannot pay a single line on the run', async () => {
    await withTenant(() => approveHandler({ params: { id: runId }, body: {}, user: userIn(BRANCH_A), branchContext: { branchId: BRANCH_A } }, mockRes()));
    const res = mockRes();
    await withTenant(() => payLineHandler({ params: { id: runId, lineId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(404);
    const [[line]] = await sequelize.query(`SELECT status FROM payroll_run_lines WHERE id = :id`, { replacements: { id: lineId } });
    expect(line.status).toBe('unpaid');
  });

  test('a user in a different branch cannot pay-all on the run', async () => {
    await withTenant(() => approveHandler({ params: { id: runId }, body: {}, user: userIn(BRANCH_A), branchContext: { branchId: BRANCH_A } }, mockRes()));
    const res = mockRes();
    await withTenant(() => payAllHandler({ params: { id: runId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(404);
  });
});

describe('Leave request approve/reject/cancel respect branch isolation', () => {
  let approveHandler, rejectHandler, cancelHandler;
  let requestId;

  beforeAll(async () => {
    const leaveRouter = require('../../src/server/routes/leave');
    approveHandler = handlerFor(leaveRouter, '/requests/:id/approve', 'post');
    rejectHandler = handlerFor(leaveRouter, '/requests/:id/reject', 'post');
    cancelHandler = handlerFor(leaveRouter, '/requests/:id/cancel', 'post');
  });

  beforeEach(async () => {
    requestId = uuid();
    await sequelize.query(
      `INSERT INTO leave_requests (id, clinic_id, branch_id, employee_id, leave_type_id, start_date, end_date, days, reason, status)
       VALUES (:id, :c, :b, :employeeId, :typeId, '2026-02-01', '2026-02-02', 2, 'BRANCHISO-test', 'pending')`,
      { replacements: { id: requestId, c: TEST_CLINIC_ID, b: BRANCH_A, employeeId: uuid(), typeId: uuid() } }
    );
  });

  test('a user in a different branch cannot approve the leave request', async () => {
    const res = mockRes();
    await withTenant(() => approveHandler({ params: { id: requestId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(409);
  });

  test('a user in a different branch cannot reject the leave request', async () => {
    const res = mockRes();
    await withTenant(() => rejectHandler({ params: { id: requestId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(409);
  });

  test('a user in a different branch cannot cancel the leave request', async () => {
    const res = mockRes();
    await withTenant(() => cancelHandler({ params: { id: requestId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(409);
  });

  test('a user in the same branch can still approve the leave request', async () => {
    const res = mockRes();
    await withTenant(() => approveHandler({ params: { id: requestId }, body: {}, user: userIn(BRANCH_A), branchContext: { branchId: BRANCH_A } }, res));
    expect(res.statusCode).toBe(200);
  });
});

describe('Salary advance approve/cancel/disburse/repay respect branch isolation', () => {
  let approveHandler, cancelHandler, disburseHandler, repayHandler;
  let advanceId;

  beforeAll(async () => {
    const salaryAdvancesRouter = require('../../src/server/routes/salaryAdvances');
    approveHandler = handlerFor(salaryAdvancesRouter, '/:id/approve', 'post');
    cancelHandler = handlerFor(salaryAdvancesRouter, '/:id/cancel', 'post');
    disburseHandler = handlerFor(salaryAdvancesRouter, '/:id/disburse', 'post');
    repayHandler = handlerFor(salaryAdvancesRouter, '/:id/repay', 'post');
  });

  beforeEach(async () => {
    // disburse/repay JOIN employees — a non-existent employee_id makes the
    // lookup 404 regardless of branch, which would mask the fix. Needs a
    // real row.
    const employeeId = uuid();
    await sequelize.query(
      `INSERT INTO employees (id, clinic_id, employee_number, first_name, last_name, employment_type)
       VALUES (:id, :c, :num, 'BranchIso', 'SalaryAdvanceEmployee', 'staff')`,
      { replacements: { id: employeeId, c: TEST_CLINIC_ID, num: `BRANCHISO-SA-${Date.now()}-${Math.random()}` } }
    );
    advanceId = uuid();
    await sequelize.query(
      `INSERT INTO salary_advances (id, clinic_id, branch_id, employee_id, advance_number, amount, currency, status, balance_remaining)
       VALUES (:id, :c, :b, :employeeId, :num, 500, 'USD', 'pending', 500)`,
      { replacements: { id: advanceId, c: TEST_CLINIC_ID, b: BRANCH_A, employeeId, num: `BRANCHISO-${Date.now()}-${Math.random()}` } }
    );
  });

  test('a user in a different branch cannot approve the advance', async () => {
    const res = mockRes();
    await withTenant(() => approveHandler({ params: { id: advanceId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(409);
  });

  test('a user in a different branch cannot cancel the advance', async () => {
    const res = mockRes();
    await withTenant(() => cancelHandler({ params: { id: advanceId }, body: {}, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(409);
  });

  test('a user in a different branch cannot disburse the advance', async () => {
    await withTenant(() => approveHandler({ params: { id: advanceId }, body: {}, user: userIn(BRANCH_A), branchContext: { branchId: BRANCH_A } }, mockRes()));
    const res = mockRes();
    await withTenant(() => disburseHandler({ params: { id: advanceId }, body: { payment_account_id: uuid() }, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(404);
  });

  test('a user in a different branch cannot record a repayment on the advance', async () => {
    await sequelize.query(`UPDATE salary_advances SET status = 'disbursed' WHERE id = :id`, { replacements: { id: advanceId } });
    const res = mockRes();
    await withTenant(() => repayHandler({ params: { id: advanceId }, body: { amount: 100, payment_account_id: uuid() }, user: userIn(BRANCH_B), branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(404);
  });
});

describe('Supplier bill approval checks the PO\'s own branch (previously no check at all)', () => {
  let approveHandler;
  let poId;
  let branchBUserId;

  beforeAll(async () => {
    const dailyExpensesRouter = require('../../src/server/routes/daily-expenses');
    approveHandler = handlerFor(dailyExpensesRouter, '/supplier-bills/:po_id/approve', 'post');

    // This route looks the approver up in `users` (for display_name/signature)
    // before reaching the PO branch check, so a real row is needed here —
    // unlike the other routes in this file, which trust the JWT payload alone.
    const [[dbUser]] = await sequelize.query(
      `INSERT INTO users (email, display_name, role, password_hash, clinic_id, branch_id, status, is_active, created_at, updated_at)
       VALUES ('branchiso-supplierbill@example.test', 'BranchIso SupplierBill Approver', 'accountant', 'x', :c, :b, 'active', true, NOW(), NOW()) RETURNING id`,
      { replacements: { c: TEST_CLINIC_ID, b: BRANCH_B } }
    );
    branchBUserId = dbUser.id;
  });

  afterAll(async () => {
    try { await sequelize.query(`DELETE FROM users WHERE id = :id`, { replacements: { id: branchBUserId } }); }
    catch (e) { /* non-fatal */ }
  });

  beforeEach(async () => {
    const order = await withTenant(() => testConn.models.PurchaseOrder.create({
      po_number: `BRANCHISO-${Date.now()}-${Math.random()}`, supplier_id: 1, order_date: new Date(),
      total_amount: 5000, status: 'authorized', clinic_id: TEST_CLINIC_ID, branch_id: BRANCH_A,
    }));
    poId = order.id;
  });

  test('a user in a different branch gets 404, not an approval row on someone else\'s PO', async () => {
    const res = mockRes();
    await withTenant(() => approveHandler({ params: { po_id: String(poId) }, body: {}, user: { id: branchBUserId, role: 'accountant', clinicId: TEST_CLINIC_ID, branchId: BRANCH_B }, branchContext: { branchId: BRANCH_B } }, res));
    expect(res.statusCode).toBe(404);
    const [rows] = await sequelize.query(`SELECT * FROM supplier_bill_approvals WHERE po_id = :poId`, { replacements: { poId: String(poId) } });
    expect(rows.length).toBe(0);
  });
});
