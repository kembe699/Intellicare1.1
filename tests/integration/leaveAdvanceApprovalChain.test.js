/**
 * The configurable HOD->HR approval chain for leave and salary advances:
 * steps on/off, rejection requires a reason, and an HOD only ever sees/can
 * act on their own resolved team's requests. Calls the REAL route handlers
 * directly (see tests/integration/antenatal.test.js for why), against
 * tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let createLeaveHandler;
let approveHodLeaveHandler;
let rejectHodLeaveHandler;
let approveLeaveHandler;
let departmentId;
let hodEmployeeId;
let staffEmployeeId;
let leaveTypeId;
let adminUser;

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

function adminReq(overrides) {
  return {
    params: {}, body: {}, query: {},
    user: { id: 1, role: 'admin', clinicId: 1, branchId: 1, displayName: 'Admin Tester' },
    branchContext: { isAdmin: true },
    models: testConn,
    ...overrides,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const leaveRouter = require('../../src/server/routes/leave');
  createLeaveHandler = handlerFor(leaveRouter, '/requests', 'post');
  approveHodLeaveHandler = handlerFor(leaveRouter, '/requests/:id/approve-hod', 'post');
  rejectHodLeaveHandler = handlerFor(leaveRouter, '/requests/:id/reject-hod', 'post');
  approveLeaveHandler = handlerFor(leaveRouter, '/requests/:id/approve', 'post');

  const deptSuffix = Date.now();
  hodEmployeeId = uuid();
  staffEmployeeId = uuid();
  await sequelize.query(`
    INSERT INTO employees (id, clinic_id, branch_id, employee_number, employment_type, first_name, last_name, department, employment_status, is_active, created_at, updated_at)
    VALUES
      (:hodId, 1, 1, :hodNum, 'staff', 'Chain', 'Hod', 'ChainDept', 'active', TRUE, NOW(), NOW()),
      (:staffId, 1, 1, :staffNum, 'staff', 'Chain', 'Staff', 'ChainDept', 'active', TRUE, NOW(), NOW())
  `, { replacements: { hodId: hodEmployeeId, hodNum: `CHAIN-HOD-${deptSuffix}`, staffId: staffEmployeeId, staffNum: `CHAIN-STAFF-${deptSuffix}` } });

  departmentId = uuid();
  await sequelize.query(`
    INSERT INTO departments (id, department_name, department_code, clinic_id, branch_id, is_active, head_employee_id, created_at, updated_at)
    VALUES (:id, 'ChainDept', :code, 1, 1, TRUE, :headId, NOW(), NOW())
  `, { replacements: { id: departmentId, code: `CHD${deptSuffix}`.slice(0, 20), headId: hodEmployeeId } });

  const [[leaveType]] = await sequelize.query(`SELECT id FROM leave_types WHERE clinic_id = 1 LIMIT 1`);
  if (leaveType) {
    leaveTypeId = leaveType.id;
  } else {
    leaveTypeId = uuid();
    await sequelize.query(`INSERT INTO leave_types (id, clinic_id, name, default_annual_days, is_active, created_at, updated_at) VALUES (:id, 1, 'Chain Test Leave', 21, TRUE, NOW(), NOW())`, { replacements: { id: leaveTypeId } });
  }

  await sequelize.query(`
    INSERT INTO hr_workflow_settings (clinic_id, leave_require_hod, advance_require_hod, advance_require_finance, created_at, updated_at)
    VALUES (1, TRUE, FALSE, FALSE, NOW(), NOW())
    ON CONFLICT (clinic_id) DO UPDATE SET leave_require_hod = TRUE, updated_at = NOW()
  `);
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM leave_requests WHERE employee_id = :id`, { replacements: { id: staffEmployeeId } });
    await sequelize.query(`DELETE FROM departments WHERE id = :id`, { replacements: { id: departmentId } });
    await sequelize.query(`DELETE FROM employees WHERE id IN (:a, :b)`, { replacements: { a: hodEmployeeId, b: staffEmployeeId } });
    await sequelize.query(`UPDATE hr_workflow_settings SET leave_require_hod = FALSE WHERE clinic_id = 1`);
  } catch (e) { console.warn('leaveAdvanceApprovalChain cleanup failed (non-fatal):', e.message); }
});

async function createPendingLeaveRequest() {
  const res = mockRes();
  await withTenant(() => createLeaveHandler(adminReq({
    body: { employee_id: staffEmployeeId, leave_type_id: leaveTypeId, start_date: '2027-06-01', end_date: '2027-06-02', reason: 'chain test' },
  }), res));
  expect(res.statusCode).toBe(201);
  return res.body.id;
}

describe('HOD step ON: leave cannot be HR-approved directly from pending', () => {
  test('a direct HR approve on a fresh pending request is rejected (still needs HOD)', async () => {
    const id = await createPendingLeaveRequest();
    const res = mockRes();
    await withTenant(() => approveLeaveHandler(adminReq({ params: { id } }), res));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/HOD approval/);
  });

  test('the resolved HOD can approve it, moving it to approved_by_hod', async () => {
    const id = await createPendingLeaveRequest();
    // The HOD department-head identity check runs against req.user.id via
    // employees.user_id — admin always bypasses it, so this exercises the
    // "admin can always act" path; the dynamic non-admin identity check
    // itself is exercised directly in employeePortalAuthScope-style logic
    // and was verified live against a real non-admin HOD user+employee
    // during this feature's own development (see the HR attendance/
    // portal feature's Phase 4 commit message for the exact live result).
    const res = mockRes();
    await withTenant(() => approveHodLeaveHandler(adminReq({ params: { id } }), res));
    expect(res.statusCode).toBe(200);
    const [[row]] = await sequelize.query(`SELECT status FROM leave_requests WHERE id = :id`, { replacements: { id } });
    expect(row.status).toBe('approved_by_hod');
  });

  test('HR can now approve it, moving it to approved', async () => {
    const id = await createPendingLeaveRequest();
    await withTenant(() => approveHodLeaveHandler(adminReq({ params: { id } }), mockRes()));
    const res = mockRes();
    await withTenant(() => approveLeaveHandler(adminReq({ params: { id } }), res));
    expect(res.statusCode).toBe(200);
    const [[row]] = await sequelize.query(`SELECT status FROM leave_requests WHERE id = :id`, { replacements: { id } });
    expect(row.status).toBe('approved');
  });

  test('HOD rejection without a reason is refused', async () => {
    const id = await createPendingLeaveRequest();
    const res = mockRes();
    await withTenant(() => rejectHodLeaveHandler(adminReq({ params: { id }, body: {} }), res));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/reason is required/i);
    const [[row]] = await sequelize.query(`SELECT status FROM leave_requests WHERE id = :id`, { replacements: { id } });
    expect(row.status).toBe('pending'); // unchanged
  });

  test('HOD rejection with a reason moves it to rejected and stores the reason', async () => {
    const id = await createPendingLeaveRequest();
    const res = mockRes();
    await withTenant(() => rejectHodLeaveHandler(adminReq({ params: { id }, body: { reason: 'team short-staffed' } }), res));
    expect(res.statusCode).toBe(200);
    const [[row]] = await sequelize.query(`SELECT status, hod_rejected_reason, rejection_reason FROM leave_requests WHERE id = :id`, { replacements: { id } });
    expect(row.status).toBe('rejected');
    expect(row.hod_rejected_reason).toBe('team short-staffed');
    expect(row.rejection_reason).toBe('team short-staffed');
  });
});

describe('HOD step OFF: HR can approve a fresh pending request directly', () => {
  beforeAll(async () => {
    await sequelize.query(`UPDATE hr_workflow_settings SET leave_require_hod = FALSE WHERE clinic_id = 1`);
  });
  afterAll(async () => {
    await sequelize.query(`UPDATE hr_workflow_settings SET leave_require_hod = TRUE WHERE clinic_id = 1`);
  });

  test('a direct HR approve on a fresh pending request succeeds when the HOD step is off', async () => {
    const id = await createPendingLeaveRequest();
    const res = mockRes();
    await withTenant(() => approveLeaveHandler(adminReq({ params: { id } }), res));
    expect(res.statusCode).toBe(200);
    const [[row]] = await sequelize.query(`SELECT status FROM leave_requests WHERE id = :id`, { replacements: { id } });
    expect(row.status).toBe('approved');
  });
});

describe('isApproverFor / resolveApprover — department-head resolution', () => {
  test('resolves the configured department head for an employee in that department', async () => {
    const { resolveApprover } = require('../../src/server/utils/approverResolution');
    const approver = await withTenant(() => resolveApprover(sequelize, { clinicId: 1, employeeId: staffEmployeeId, department: 'ChainDept' }));
    expect(approver).not.toBeNull();
    expect(approver.approverEmployeeId).toBe(hodEmployeeId);
  });

  test('a per-employee override takes priority over the department head', async () => {
    const overrideApproverId = uuid();
    await sequelize.query(`
      INSERT INTO employees (id, clinic_id, branch_id, employee_number, employment_type, first_name, last_name, employment_status, is_active, created_at, updated_at)
      VALUES (:id, 1, 1, :num, 'staff', 'Override', 'Approver', 'active', TRUE, NOW(), NOW())
    `, { replacements: { id: overrideApproverId, num: `CHAIN-OVERRIDE-${Date.now()}` } });
    await sequelize.query(`
      INSERT INTO employee_approver_overrides (id, clinic_id, employee_id, approver_employee_id, created_at, updated_at)
      VALUES (:id, 1, :empId, :approverId, NOW(), NOW())
    `, { replacements: { id: uuid(), empId: staffEmployeeId, approverId: overrideApproverId } });

    const { resolveApprover } = require('../../src/server/utils/approverResolution');
    const approver = await withTenant(() => resolveApprover(sequelize, { clinicId: 1, employeeId: staffEmployeeId, department: 'ChainDept' }));
    expect(approver.approverEmployeeId).toBe(overrideApproverId);

    await sequelize.query(`DELETE FROM employee_approver_overrides WHERE employee_id = :id`, { replacements: { id: staffEmployeeId } });
    await sequelize.query(`DELETE FROM employees WHERE id = :id`, { replacements: { id: overrideApproverId } });
  });

  test('isApproverFor is false for an unrelated employee', async () => {
    const { isApproverFor } = require('../../src/server/utils/approverResolution');
    const randomActorId = uuid();
    const result = await withTenant(() => isApproverFor(sequelize, { clinicId: 1, employeeId: staffEmployeeId, department: 'ChainDept', actingEmployeeId: randomActorId }));
    expect(result).toBe(false);
  });
});
