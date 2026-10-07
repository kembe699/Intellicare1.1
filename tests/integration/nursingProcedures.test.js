/**
 * Outpatient/triage nursing procedures log — split into two kinds of entry:
 * a free-form unbilled NOTE a nurse logs directly, and a billable PROCEDURE
 * that must start as a doctor/reception ORDER (billed immediately against a
 * Nursing-category services catalog entry, same pattern as Theatre's
 * TheatreService.createRequest) and which a nurse later completes.
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
let getHandler;
let getCatalogHandler;
let getParticipantHandler;
let postNoteHandler;
let postOrderHandler;
let putCompleteHandler;
let participantId;
let serviceId;
let serviceId2;
let freeServiceId;

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

function req(overrides, role = 'nurse') {
  return {
    params: {}, body: {}, query: {},
    user: { id: 1, displayName: 'Nursing Procedures Tester', role },
    branchContext: { isAdmin: false },
    models: testConn,
    ...overrides,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/nursingProcedures');
  getHandler = handlerFor(router, '/', 'get');
  getCatalogHandler = handlerFor(router, '/catalog', 'get');
  getParticipantHandler = handlerFor(router, '/participant/:participantId', 'get');
  postNoteHandler = handlerFor(router, '/notes', 'post');
  postOrderHandler = handlerFor(router, '/orders', 'post');
  putCompleteHandler = handlerFor(router, '/:id/complete', 'put');

  participantId = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name) VALUES (?, ?, 'NursingProc', 'Patient')`,
    { replacements: [participantId, `NURSINGPROC-${Date.now()}`] }
  );

  serviceId = uuid();
  await sequelize.query(
    `INSERT INTO services (id, service_name, category, price, is_active) VALUES (?, ?, 'Nursing', 15000, true)`,
    { replacements: [serviceId, `Wound Dressing Test ${Date.now()}`] }
  );
  serviceId2 = uuid();
  await sequelize.query(
    `INSERT INTO services (id, service_name, category, price, is_active) VALUES (?, ?, 'Nursing', 8000, true)`,
    { replacements: [serviceId2, `IM Injection Test ${Date.now()}`] }
  );
  freeServiceId = uuid();
  await sequelize.query(
    `INSERT INTO services (id, service_name, category, price, is_active) VALUES (?, ?, 'Nursing', 0, true)`,
    { replacements: [freeServiceId, `Free Nursing Check Test ${Date.now()}`] }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM nursing_procedures WHERE participant_id = :id`, { replacements: { id: participantId } });
    await sequelize.query(`DELETE FROM patient_bills WHERE patient_id = :id`, { replacements: { id: participantId } });
    await sequelize.query(`DELETE FROM services WHERE id IN (:a, :b, :c)`, { replacements: { a: serviceId, b: freeServiceId, c: serviceId2 } });
    await sequelize.query(`DELETE FROM lis_participants WHERE id = :id`, { replacements: { id: participantId } });
  } catch (e) { console.warn('nursingProcedures cleanup failed (non-fatal):', e.message); }
});

describe('POST /api/nursing-procedures/notes', () => {
  test('rejects a missing participant_id', async () => {
    const res = mockRes();
    await withTenant(() => postNoteHandler(req({ body: { note: 'x' } }), res));
    expect(res.statusCode).toBe(400);
  });

  test('rejects a missing note', async () => {
    const res = mockRes();
    await withTenant(() => postNoteHandler(req({ body: { participant_id: participantId } }), res));
    expect(res.statusCode).toBe(400);
  });

  test('a nurse logs a free note — completed immediately, unbilled, no service', async () => {
    const res = mockRes();
    await withTenant(() => postNoteHandler(req({ body: { participant_id: participantId, note: 'Patient resting comfortably, no complaints.' } }), res));
    expect(res.statusCode).toBe(201);

    const getRes = mockRes();
    await withTenant(() => getParticipantHandler(req({ params: { participantId } }), getRes));
    const row = getRes.body.find((r) => r.id === res.body.id);
    expect(row.entry_type).toBe('note');
    expect(row.status).toBe('completed');
    expect(row.bill_id).toBeNull();
    expect(row.nurse_id).toBe(1);
  });
});

describe('GET /api/nursing-procedures/catalog', () => {
  test('returns Nursing-category services', async () => {
    const res = mockRes();
    await withTenant(() => getCatalogHandler(req({}, 'doctor'), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.some((s) => s.id === serviceId)).toBe(true);
  });
});

describe('POST /api/nursing-procedures/orders', () => {
  test('rejects a missing service_id', async () => {
    const res = mockRes();
    await withTenant(() => postOrderHandler(req({ body: { participant_id: participantId, procedure_type: 'dressing' } }, 'doctor'), res));
    expect(res.statusCode).toBe(400);
  });

  test('rejects an invalid procedure_type', async () => {
    const res = mockRes();
    await withTenant(() => postOrderHandler(req({ body: { participant_id: participantId, service_id: serviceId, procedure_type: 'surgery' } }, 'doctor'), res));
    expect(res.statusCode).toBe(400);
  });

  test('a doctor orders a priced procedure — pending, billed, bill_id set', async () => {
    const res = mockRes();
    await withTenant(() => postOrderHandler(req({ body: { participant_id: participantId, service_id: serviceId, procedure_type: 'dressing', notes: 'Change dressing, left leg' } }, 'doctor'), res));
    expect(res.statusCode).toBe(201);
    expect(res.body.bill_id).toBeTruthy();

    const [[bill]] = await sequelize.query(`SELECT id, total_amount FROM patient_bills WHERE id = :id`, { replacements: { id: res.body.bill_id } });
    expect(bill).toBeTruthy();
    expect(parseFloat(bill.total_amount)).toBeGreaterThanOrEqual(15000);

    const getRes = mockRes();
    await withTenant(() => getParticipantHandler(req({ params: { participantId } }), getRes));
    const row = getRes.body.find((r) => r.id === res.body.id);
    expect(row.entry_type).toBe('procedure');
    expect(row.status).toBe('pending');
    expect(parseFloat(row.fee_amount)).toBe(15000);
    expect(row.ordered_by).toBe(1);
  });

  test('a receptionist can also place a walk-in order; a zero-priced service is not billed', async () => {
    const res = mockRes();
    await withTenant(() => postOrderHandler(req({ body: { participant_id: participantId, service_id: freeServiceId, procedure_type: 'other' } }, 'reception'), res));
    expect(res.statusCode).toBe(201);
    expect(res.body.bill_id).toBeNull();
  });
});

describe('POST /api/nursing-procedures/orders — multiple items in one order', () => {
  test('a doctor orders several procedures for the same patient in one submission, billed together on one bill', async () => {
    const res = mockRes();
    await withTenant(() => postOrderHandler(req({
      body: {
        participant_id: participantId,
        items: [
          { service_id: serviceId, procedure_type: 'dressing', notes: 'Left leg' },
          { service_id: serviceId2, procedure_type: 'injection', notes: 'IM Diclofenac' },
          { service_id: freeServiceId, procedure_type: 'other' },
        ],
      },
    }, 'doctor'), res));

    expect(res.statusCode).toBe(201);
    expect(res.body.ids.length).toBe(3);
    expect(res.body.bill_id).toBeTruthy();

    const [[bill]] = await sequelize.query(`SELECT services FROM patient_bills WHERE id = ?`, { replacements: [res.body.bill_id] });
    const billedNames = JSON.parse(typeof bill.services === 'string' ? bill.services : JSON.stringify(bill.services)).map((s) => s.serviceName);
    expect(billedNames.some((n) => n.includes('Wound Dressing Test'))).toBe(true);
    expect(billedNames.some((n) => n.includes('IM Injection Test'))).toBe(true);

    const getRes = mockRes();
    await withTenant(() => getParticipantHandler(req({ params: { participantId } }), getRes));
    const rows = res.body.ids.map((id) => getRes.body.find((r) => r.id === id));
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    // The two priced items share the one bill; the zero-priced item isn't billed at all.
    expect(rows.filter((r) => r.bill_id === res.body.bill_id).length).toBe(2);
    expect(rows.find((r) => r.service_id === freeServiceId).bill_id).toBeNull();
  });

  test('rejects the whole batch if any one item has an invalid procedure_type', async () => {
    const res = mockRes();
    await withTenant(() => postOrderHandler(req({
      body: { participant_id: participantId, items: [{ service_id: serviceId, procedure_type: 'dressing' }, { service_id: serviceId2, procedure_type: 'surgery' }] },
    }, 'doctor'), res));
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/nursing-procedures/:id/complete', () => {
  let orderId;

  beforeAll(async () => {
    const res = mockRes();
    await withTenant(() => postOrderHandler(req({ body: { participant_id: participantId, service_id: serviceId, procedure_type: 'injection' } }, 'doctor'), res));
    orderId = res.body.id;
  });

  test('rejects completing a free-form note', async () => {
    const noteRes = mockRes();
    await withTenant(() => postNoteHandler(req({ body: { participant_id: participantId, note: 'just a note' } }), noteRes));
    const res = mockRes();
    await withTenant(() => putCompleteHandler(req({ params: { id: noteRes.body.id }, body: {} }), res));
    expect(res.statusCode).toBe(400);
  });

  test('a nurse completes a pending order, recording what was actually done', async () => {
    const res = mockRes();
    await withTenant(() => putCompleteHandler(req({ params: { id: orderId }, body: { description: 'IM injection given, left deltoid' } }), res));
    expect(res.statusCode).toBe(200);

    const getRes = mockRes();
    await withTenant(() => getParticipantHandler(req({ params: { participantId } }), getRes));
    const row = getRes.body.find((r) => r.id === orderId);
    expect(row.status).toBe('completed');
    expect(row.description).toBe('IM injection given, left deltoid');
    expect(row.nurse_id).toBe(1);
  });

  test('rejects completing the same order twice', async () => {
    const res = mockRes();
    await withTenant(() => putCompleteHandler(req({ params: { id: orderId }, body: {} }), res));
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/nursing-procedures', () => {
  test('shows up in the clinic-wide recent log with the patient name joined in', async () => {
    const getRes = mockRes();
    await withTenant(() => getHandler(req({}), getRes));
    expect(getRes.statusCode).toBe(200);
    const mine = getRes.body.filter((r) => r.participant_id === participantId);
    expect(mine.length).toBeGreaterThanOrEqual(4);
    expect(mine[0].first_name).toBe('NursingProc');
  });
});
