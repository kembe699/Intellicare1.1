/**
 * Follow-up/next-visit appointments — scheduled from a Visit Summary or
 * directly from the Appointments page, then queued straight to the doctor
 * they were booked with via the same lis_test_orders queue every other
 * "see a doctor" flow uses.
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
let postHandler;
let putHandler;
let postQueueHandler;
let getLisQueueHandler;
let getVisitSummariesHandler;
let participantId;
let doctorUserId;

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
    user: { id: 1, displayName: 'Appointments Tester', role: 'doctor', clinicId: 1 },
    branchContext: { isAdmin: false },
    models: testConn,
    ...overrides,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/appointments');
  getHandler = handlerFor(router, '/', 'get');
  postHandler = handlerFor(router, '/', 'post');
  putHandler = handlerFor(router, '/:id', 'put');
  postQueueHandler = handlerFor(router, '/:id/queue', 'post');

  const lisRouter = require('../../src/server/routes/lisModule');
  getLisQueueHandler = handlerFor(lisRouter, '/queue', 'get');
  getVisitSummariesHandler = handlerFor(lisRouter, '/visit-summaries', 'get');

  participantId = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name) VALUES (?, ?, 'Appointment', 'Patient')`,
    { replacements: [participantId, `APPT-${Date.now()}`] }
  );

  // Unlike nursing_procedures.ordered_by, lis_test_orders.doctor_id carries a
  // real FK (fk_lis_doctor) to users.id — queuing with a non-existent doctor
  // id fails the insert, so a real row is needed here.
  doctorUserId = Math.floor(900000 + Math.random() * 90000);
  await sequelize.query(
    `INSERT INTO users (id, email, role, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'doctor', 'x', 'Appointments Test Doctor', NOW(), NOW())`,
    { replacements: [doctorUserId, `appt-doctor-${doctorUserId}@test.local`] }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM lis_test_orders WHERE participant_id = :id`, { replacements: { id: participantId } });
    await sequelize.query(`DELETE FROM appointments WHERE participant_id = :id`, { replacements: { id: participantId } });
    await sequelize.query(`DELETE FROM lis_participants WHERE id = :id`, { replacements: { id: participantId } });
    await sequelize.query(`DELETE FROM users WHERE id = :id`, { replacements: { id: doctorUserId } });
  } catch (e) { console.warn('appointments cleanup failed (non-fatal):', e.message); }
});

describe('POST /api/appointments', () => {
  test('rejects a missing participant_id', async () => {
    const res = mockRes();
    await withTenant(() => postHandler(req({ body: { scheduled_date: '2026-12-01' } }), res));
    expect(res.statusCode).toBe(400);
  });

  test('rejects a missing scheduled_date', async () => {
    const res = mockRes();
    await withTenant(() => postHandler(req({ body: { participant_id: participantId } }), res));
    expect(res.statusCode).toBe(400);
  });

  test('schedules a follow-up appointment', async () => {
    const res = mockRes();
    await withTenant(() => postHandler(req({
      body: { participant_id: participantId, doctor_id: doctorUserId, scheduled_date: '2026-12-01', reason: 'Follow-up after antenatal visit' },
    }), res));
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBeTruthy();

    const [[row]] = await sequelize.query(`SELECT * FROM appointments WHERE id = ?`, { replacements: [res.body.id] });
    expect(row.status).toBe('scheduled');
    expect(row.doctor_id).toBe(doctorUserId);
    expect(row.reason).toBe('Follow-up after antenatal visit');
  });
});

describe('GET /api/appointments', () => {
  test('lists the appointment with the patient and doctor names joined in', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({}), res));
    expect(res.statusCode).toBe(200);
    const mine = res.body.filter((r) => r.participant_id === participantId);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].first_name).toBe('Appointment');
  });

  test('filters by status', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ query: { status: 'cancelled' } }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.every((r) => r.status === 'cancelled')).toBe(true);
  });
});

describe('PUT /api/appointments/:id', () => {
  let appointmentId;

  beforeAll(async () => {
    const res = mockRes();
    await withTenant(() => postHandler(req({ body: { participant_id: participantId, scheduled_date: '2026-12-05' } }), res));
    appointmentId = res.body.id;
  });

  test('returns 404 for an unknown appointment', async () => {
    const res = mockRes();
    await withTenant(() => putHandler(req({ params: { id: uuid() }, body: {} }), res));
    expect(res.statusCode).toBe(404);
  });

  test('reschedules the appointment', async () => {
    const res = mockRes();
    await withTenant(() => putHandler(req({ params: { id: appointmentId }, body: { scheduled_date: '2026-12-10' } }), res));
    expect(res.statusCode).toBe(200);
    const [[row]] = await sequelize.query(`SELECT scheduled_date FROM appointments WHERE id = ?`, { replacements: [appointmentId] });
    expect(new Date(row.scheduled_date).toISOString().slice(0, 10)).toBe('2026-12-10');
  });

  test('can be cancelled', async () => {
    const res = mockRes();
    await withTenant(() => putHandler(req({ params: { id: appointmentId }, body: { status: 'cancelled' } }), res));
    expect(res.statusCode).toBe(200);
    const [[row]] = await sequelize.query(`SELECT status FROM appointments WHERE id = ?`, { replacements: [appointmentId] });
    expect(row.status).toBe('cancelled');
  });
});

describe('POST /api/appointments/:id/queue', () => {
  let appointmentId;

  beforeAll(async () => {
    const res = mockRes();
    await withTenant(() => postHandler(req({ body: { participant_id: participantId, doctor_id: doctorUserId, scheduled_date: '2026-12-15', reason: 'Follow-up after antenatal visit' } }), res));
    appointmentId = res.body.id;
  });

  test('returns 404 for an unknown appointment', async () => {
    const res = mockRes();
    await withTenant(() => postQueueHandler(req({ params: { id: uuid() } }), res));
    expect(res.statusCode).toBe(404);
  });

  test('queues the patient straight to the booked doctor, linking the new order back to the appointment', async () => {
    const res = mockRes();
    await withTenant(() => postQueueHandler(req({ params: { id: appointmentId } }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.order_id).toBeTruthy();

    const [[order]] = await sequelize.query(`SELECT * FROM lis_test_orders WHERE id = ?`, { replacements: [res.body.order_id] });
    expect(order.participant_id).toBe(participantId);
    expect(order.doctor_id).toBe(doctorUserId);
    expect(order.status).toBe('waiting');
    expect(order.appointment_id).toBe(appointmentId);

    const [[appt]] = await sequelize.query(`SELECT status, queued_order_id FROM appointments WHERE id = ?`, { replacements: [appointmentId] });
    expect(appt.status).toBe('queued');
    expect(appt.queued_order_id).toBe(res.body.order_id);
  });

  test('rejects queuing the same appointment twice', async () => {
    const res = mockRes();
    await withTenant(() => postQueueHandler(req({ params: { id: appointmentId } }), res));
    expect(res.statusCode).toBe(409);
  });

  test('a queued appointment can no longer be edited', async () => {
    const res = mockRes();
    await withTenant(() => putHandler(req({ params: { id: appointmentId }, body: { reason: 'changed' } }), res));
    expect(res.statusCode).toBe(409);
  });

  test('the resulting visit shows up as a follow-up on the LIS queue and in the visit summary', async () => {
    const queueRes = mockRes();
    await withTenant(() => getLisQueueHandler(req({}), queueRes));
    expect(queueRes.statusCode).toBe(200);
    const queuedRow = queueRes.body.find((r) => r.participant_id === participantId);
    expect(queuedRow).toBeTruthy();
    expect(queuedRow.appointment_id).toBe(appointmentId);
    expect(queuedRow.appointment_reason).toBe('Follow-up after antenatal visit');

    const summaryRes = mockRes();
    await withTenant(() => getVisitSummariesHandler(req({ query: { participant_id: participantId } }), summaryRes));
    expect(summaryRes.statusCode).toBe(200);
    const summaryRow = summaryRes.body.find((s) => s.participant_id === participantId);
    expect(summaryRow).toBeTruthy();
    expect(summaryRow.appointment_id).toBe(appointmentId);
    expect(summaryRow.appointment_reason).toBe('Follow-up after antenatal visit');
  });
});
