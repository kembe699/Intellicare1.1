/**
 * New feature: a standalone outpatient/triage nursing procedures log — an
 * injection administered, a minor procedure performed, a dressing changed —
 * separate from the doctor's prescription pipeline and from inpatient's own
 * drug_administrations (admitted patients). Lives under the new "Nursing
 * Station" sidebar group alongside Triage.
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
let postHandler;
let getHandler;
let getParticipantHandler;
let participantId;

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
    user: { id: 1, displayName: 'Nursing Procedures Tester', role: 'nurse' },
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
  postHandler = handlerFor(router, '/', 'post');
  getHandler = handlerFor(router, '/', 'get');
  getParticipantHandler = handlerFor(router, '/participant/:participantId', 'get');

  participantId = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name) VALUES (?, ?, 'NursingProc', 'Patient')`,
    { replacements: [participantId, `NURSINGPROC-${Date.now()}`] }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM nursing_procedures WHERE participant_id = :id`, { replacements: { id: participantId } });
    await sequelize.query(`DELETE FROM lis_participants WHERE id = :id`, { replacements: { id: participantId } });
  } catch (e) { console.warn('nursingProcedures cleanup failed (non-fatal):', e.message); }
});

describe('POST /api/nursing-procedures', () => {
  test('rejects a missing participant_id', async () => {
    const res = mockRes();
    await withTenant(() => postHandler(req({ body: { procedure_type: 'injection', description: 'x' } }), res));
    expect(res.statusCode).toBe(400);
  });

  test('rejects an invalid procedure_type', async () => {
    const res = mockRes();
    await withTenant(() => postHandler(req({ body: { participant_id: participantId, procedure_type: 'surgery', description: 'x' } }), res));
    expect(res.statusCode).toBe(400);
  });

  test('rejects a missing description', async () => {
    const res = mockRes();
    await withTenant(() => postHandler(req({ body: { participant_id: participantId, procedure_type: 'injection' } }), res));
    expect(res.statusCode).toBe(400);
  });

  test('logs an injection, a minor procedure, and a dressing, each retrievable by participant', async () => {
    for (const [type, desc] of [
      ['injection', 'IM Diclofenac 75mg given'],
      ['minor_procedure', 'Incision and drainage of abscess, left forearm'],
      ['dressing', 'Wound dressing changed — right leg'],
    ]) {
      const res = mockRes();
      await withTenant(() => postHandler(req({ body: { participant_id: participantId, procedure_type: type, description: desc } }), res));
      expect(res.statusCode).toBe(201);
    }

    const getRes = mockRes();
    await withTenant(() => getParticipantHandler(req({ params: { participantId } }), getRes));
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.length).toBe(3);
    expect(getRes.body.map((r) => r.procedure_type).sort()).toEqual(['dressing', 'injection', 'minor_procedure']);
    expect(getRes.body.every((r) => r.participant_id === participantId)).toBe(true);
  });

  test('shows up in the clinic-wide recent log with the patient name and nurse joined in', async () => {
    const getRes = mockRes();
    await withTenant(() => getHandler(req({}), getRes));
    expect(getRes.statusCode).toBe(200);
    const mine = getRes.body.filter((r) => r.participant_id === participantId);
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine[0].first_name).toBe('NursingProc');
  });
});
