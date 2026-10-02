/**
 * Theatre requests become catalog-driven and bidirectionally linked to
 * billing:
 *
 * 1. /theatre/requests picks a Procedure-category service from the catalog
 *    (not free text) — TheatreService.createRequest bills the patient for
 *    it immediately (addLineItemsToBill), stamping the request with the
 *    resulting bill_id/estimated_fee.
 * 2. Scheduling an operation from an already-billed request carries that
 *    bill_id forward onto the operation, so completeOperation's existing
 *    `!bill_id` guard skips billing it a SECOND time.
 * 3. The reverse direction: a Procedure-category service billed through the
 *    normal billing routes (POST /patient-bills, PUT /:billId/add-services)
 *    auto-creates a pending theatre_requests row — mirroring how a
 *    Laboratory-category service already auto-creates a lab order there
 *    (createLabRequestsFromBill).
 * 4. Dedup: TheatreService.createRequest bills via billingResolver.js's
 *    addLineItemsToBill directly against the PatientBill model — it never
 *    calls either of the two general billing routes the reverse hook is
 *    wired into, so a request created from /theatre/requests can never also
 *    trigger a duplicate via the reverse hook.
 * 5. Multi-member surgical team: theatre_operation_team holds the full
 *    roster per role; theatre_operations.surgeon_employee_id/etc. keep
 *    storing just the primary (first-added) member of each role.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');
const { migrateTheatreTables } = require('../../src/server/scripts/migrateTheatreTables');
const { normalizeServices } = require('../../src/server/utils/normalizeServices');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let handlers = {};
let billHandlers = {};

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
    user: { id: 1, displayName: 'Theatre Billing Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
    ip: '127.0.0.1',
    ...overrides,
  };
}

let procedureServiceId, procedurePrice;
let employeeAId, employeeBId, employeeCId;

async function seedEmployee(name) {
  const id = uuid();
  await sequelize.query(
    `INSERT INTO employees (id, clinic_id, employee_number, first_name, last_name) VALUES (:id, :c, :num, :name, 'TRBTest')`,
    { replacements: { id, c: TEST_CLINIC_ID, num: `TRBTEST-${name}-${Date.now()}`, name } }
  );
  return id;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  await migrateTheatreTables(sequelize);

  const theatreRouter = require('../../src/server/routes/theatre');
  handlers = {
    createRequest: handlerFor(theatreRouter, '/requests', 'post'),
    scheduleOperation: handlerFor(theatreRouter, '/operations', 'post'),
    startOperation: handlerFor(theatreRouter, '/operations/:id/start', 'post'),
    completeOperation: handlerFor(theatreRouter, '/operations/:id/complete', 'post'),
    addTeamMember: handlerFor(theatreRouter, '/operations/:id/team', 'post'),
    removeTeamMember: handlerFor(theatreRouter, '/operations/:id/team/:teamMemberId', 'delete'),
  };

  const billsRouter = require('../../src/server/routes/patientBills');
  billHandlers = {
    createBill: handlerFor(billsRouter, '/', 'post'),
    addServices: handlerFor(billsRouter, '/:billId/add-services', 'put'),
  };

  procedurePrice = 150000;
  const [[svc]] = await sequelize.query(
    `INSERT INTO services (id, service_name, category, price, is_active) VALUES (:id, 'TRBTEST-Appendectomy', 'Procedure', :price, true) RETURNING id`,
    { replacements: { id: uuid(), price: procedurePrice } }
  );
  procedureServiceId = svc.id;

  employeeAId = await seedEmployee('SurgeonA');
  employeeBId = await seedEmployee('SurgeonB');
  employeeCId = await seedEmployee('Anaesthetist');
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM theatre_operation_team WHERE operation_id IN (SELECT id FROM theatre_operations WHERE procedure_name LIKE 'TRBTEST-%')`);
    await sequelize.query(`DELETE FROM theatre_operations WHERE procedure_name LIKE 'TRBTEST-%'`);
    await sequelize.query(`DELETE FROM theatre_requests WHERE procedure_name LIKE 'TRBTEST-%'`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%TRBTEST%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%TRBTEST%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%TRBTEST%'`);
    await sequelize.query(`DELETE FROM patient_receivables WHERE bill_id IN (SELECT id FROM patient_bills WHERE patient_name LIKE 'TRBTEST%')`);
    await sequelize.query(`DELETE FROM patient_bills WHERE patient_name LIKE 'TRBTEST%'`);
    await sequelize.query(`DELETE FROM services WHERE service_name LIKE 'TRBTEST-%'`);
    await sequelize.query(`DELETE FROM employees WHERE employee_number LIKE 'TRBTEST-%'`);
  } catch (e) { console.warn('theatreRequestBilling cleanup failed (non-fatal):', e.message); }
});

describe('TheatreService.createRequest bills the procedure from the catalog', () => {
  test('creates a theatre_requests row AND bills the patient for the catalog price', async () => {
    const patientId = uuid();
    const res = mockRes();
    await withTenant(() => handlers.createRequest(req({
      body: { clinic_id: TEST_CLINIC_ID, patient_id: patientId, service_id: procedureServiceId, requesting_department: 'TRBTEST Ward' },
    }), res));

    expect(res.statusCode).toBe(201);
    const request = res.body;
    expect(request.procedure_name).toBe('TRBTEST-Appendectomy');
    expect(parseFloat(request.estimated_fee)).toBe(procedurePrice);
    expect(request.bill_id).toBeTruthy();

    const bill = await withTenant(() => testConn.models.PatientBill.findByPk(request.bill_id));
    expect(bill).toBeTruthy();
    expect(parseFloat(bill.total_amount)).toBe(procedurePrice);
    expect(normalizeServices(bill.services).some((s) => s.serviceName === 'TRBTEST-Appendectomy')).toBe(true);
  });

  test('a service priced at 0 creates the request without billing (not billed through this module)', async () => {
    const [[freeSvc]] = await sequelize.query(
      `INSERT INTO services (id, service_name, category, price, is_active) VALUES (:id, 'TRBTEST-FreeProcedure', 'Procedure', 0, true) RETURNING id`,
      { replacements: { id: uuid() } }
    );
    const res = mockRes();
    await withTenant(() => handlers.createRequest(req({
      body: { clinic_id: TEST_CLINIC_ID, patient_id: uuid(), service_id: freeSvc.id },
    }), res));
    expect(res.statusCode).toBe(201);
    expect(res.body.bill_id).toBeNull();
  });

  test('exactly one theatre_requests row exists for the bill — the reverse hook does not also fire', async () => {
    const res = mockRes();
    await withTenant(() => handlers.createRequest(req({
      body: { clinic_id: TEST_CLINIC_ID, patient_id: uuid(), service_id: procedureServiceId },
    }), res));
    const billId = res.body.bill_id;
    const [rows] = await sequelize.query(`SELECT id FROM theatre_requests WHERE bill_id = :billId`, { replacements: { billId } });
    expect(rows.length).toBe(1);
  });
});

describe('Scheduling from an already-billed request does not double-bill at completion', () => {
  test('the operation carries the request\'s bill_id forward, and completing it creates no second bill', async () => {
    const patientId = uuid();
    const reqRes = mockRes();
    await withTenant(() => handlers.createRequest(req({
      body: { clinic_id: TEST_CLINIC_ID, patient_id: patientId, service_id: procedureServiceId },
    }), reqRes));
    const request = reqRes.body;

    const opRes = mockRes();
    await withTenant(() => handlers.scheduleOperation(req({
      body: { clinic_id: TEST_CLINIC_ID, request_id: request.id, scheduled_at: '2026-02-01T09:00:00Z' },
    }), opRes));
    expect(opRes.statusCode).toBe(201);
    const operation = opRes.body;
    expect(operation.bill_id).toBe(request.bill_id);
    expect(parseFloat(operation.procedure_fee)).toBe(procedurePrice);

    await withTenant(() => handlers.startOperation(req({ params: { id: operation.id } }), mockRes()));
    await withTenant(() => handlers.completeOperation(req({ params: { id: operation.id }, body: { outcome: 'successful' } }), mockRes()));

    const [bills] = await sequelize.query(`SELECT id FROM patient_bills WHERE patient_id = :patientId`, { replacements: { patientId } });
    expect(bills.length).toBe(1);
  });
});

describe('Multi-member surgical team', () => {
  test('scheduling with team arrays stores the primary on theatre_operations and the full roster in theatre_operation_team', async () => {
    const res = mockRes();
    await withTenant(() => handlers.scheduleOperation(req({
      body: {
        clinic_id: TEST_CLINIC_ID, patient_id: uuid(), procedure_name: 'TRBTEST-TeamOp', scheduled_at: '2026-02-02T09:00:00Z',
        surgeon_employee_ids: [employeeAId, employeeBId], anesthetist_employee_ids: [employeeCId],
      },
    }), res));
    expect(res.statusCode).toBe(201);
    const operation = res.body;
    expect(operation.surgeon_employee_id).toBe(employeeAId);
    expect(operation.team.filter((m) => m.role === 'surgeon').map((m) => m.employee_id).sort()).toEqual([employeeAId, employeeBId].sort());
    expect(operation.team.filter((m) => m.role === 'anesthetist').map((m) => m.employee_id)).toEqual([employeeCId]);
  });

  test('add/remove team member round-trips through the operation\'s team list', async () => {
    const scheduleRes = mockRes();
    await withTenant(() => handlers.scheduleOperation(req({
      body: { clinic_id: TEST_CLINIC_ID, patient_id: uuid(), procedure_name: 'TRBTEST-TeamOp2', scheduled_at: '2026-02-03T09:00:00Z' },
    }), scheduleRes));
    const operationId = scheduleRes.body.id;

    const addRes = mockRes();
    await withTenant(() => handlers.addTeamMember(req({ params: { id: operationId }, body: { employee_id: employeeAId, role: 'scrub_nurse' } }), addRes));
    expect(addRes.statusCode).toBe(201);
    expect(addRes.body.some((m) => m.employee_id === employeeAId && m.role === 'scrub_nurse')).toBe(true);

    const memberId = addRes.body.find((m) => m.employee_id === employeeAId).id;
    const removeRes = mockRes();
    await withTenant(() => handlers.removeTeamMember(req({ params: { id: operationId, teamMemberId: memberId } }), removeRes));
    expect(removeRes.statusCode).toBe(200);
    expect(removeRes.body.some((m) => m.id === memberId)).toBe(false);
  });
});

describe('Reverse hook: billing a Procedure-category service elsewhere creates a pending theatre request', () => {
  test('POST /patient-bills creates a theatre_requests row for a Procedure-category line item', async () => {
    const patientId = uuid();
    const res = mockRes();
    await withTenant(() => billHandlers.createBill(req({
      body: {
        patient_id: patientId, patient_name: 'TRBTEST Patient', clinic_id: TEST_CLINIC_ID, created_by: 'TRBTEST Staff',
        services: [{ serviceId: procedureServiceId, serviceName: 'TRBTEST-Appendectomy', quantity: 1, unitPrice: procedurePrice, totalPrice: procedurePrice }],
      },
    }), res));
    expect(res.statusCode).toBe(200);
    const bill = res.body;

    const [rows] = await sequelize.query(`SELECT * FROM theatre_requests WHERE bill_id = :billId`, { replacements: { billId: bill.id } });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].service_id).toBe(procedureServiceId);
    expect(parseFloat(rows[0].estimated_fee)).toBe(procedurePrice);
  });

  test('PUT /:billId/add-services only creates a request for the newly-added line, not pre-existing ones', async () => {
    const patientId = uuid();
    const createRes = mockRes();
    await withTenant(() => billHandlers.createBill(req({
      body: {
        patient_id: patientId, patient_name: 'TRBTEST Patient2', clinic_id: TEST_CLINIC_ID, created_by: 'TRBTEST Staff',
        services: [{ serviceName: 'TRBTEST Consultation', quantity: 1, unitPrice: 5000, totalPrice: 5000 }],
      },
    }), createRes));
    const bill = createRes.body;
    const [beforeRows] = await sequelize.query(`SELECT id FROM theatre_requests WHERE bill_id = :billId`, { replacements: { billId: bill.id } });
    expect(beforeRows.length).toBe(0);

    const addRes = mockRes();
    await withTenant(() => billHandlers.addServices(req({
      params: { billId: bill.id },
      body: { services: [{ serviceId: procedureServiceId, serviceName: 'TRBTEST-Appendectomy', quantity: 1, unitPrice: procedurePrice, totalPrice: procedurePrice }] },
    }), addRes));
    expect(addRes.statusCode).toBe(200);

    const [afterRows] = await sequelize.query(`SELECT id FROM theatre_requests WHERE bill_id = :billId`, { replacements: { billId: bill.id } });
    expect(afterRows.length).toBe(1);
  });
});
