/**
 * Antenatal (ANC) care — register a pregnancy, log visits, and auto-register
 * straight from Triage/LIS whenever a female patient's "Antenatal Care" box
 * (GynaeInfo.antenatal_enabled) is ticked and saved.
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
let getListHandler;
let postRegisterHandler;
let getProfileHandler;
let postVisitHandler;
let ensureAntenatalRegistration;
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
    user: { id: 1, displayName: 'Antenatal Tester', role: 'nurse' },
    branchContext: { isAdmin: false },
    models: testConn,
    ...overrides,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/antenatal');
  ensureAntenatalRegistration = router.ensureAntenatalRegistration;
  getListHandler = handlerFor(router, '/', 'get');
  postRegisterHandler = handlerFor(router, '/', 'post');
  getProfileHandler = handlerFor(router, '/:id', 'get');
  postVisitHandler = handlerFor(router, '/:id/visits', 'post');

  participantId = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name, gender) VALUES (?, ?, 'Antenatal', 'Patient', 'Female')`,
    { replacements: [participantId, `ANTENATAL-${Date.now()}`] }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(
      `DELETE FROM antenatal_visits WHERE registration_id IN (SELECT id FROM antenatal_registrations WHERE participant_id = :id)`,
      { replacements: { id: participantId } }
    );
    await sequelize.query(`DELETE FROM antenatal_registrations WHERE participant_id = :id`, { replacements: { id: participantId } });
    await sequelize.query(`DELETE FROM lis_participants WHERE id = :id`, { replacements: { id: participantId } });
  } catch (e) { console.warn('antenatal cleanup failed (non-fatal):', e.message); }
});

describe('ensureAntenatalRegistration (Triage/LIS trigger)', () => {
  test('does nothing when antenatal_enabled is not set', async () => {
    const id = await ensureAntenatalRegistration(sequelize, { participantId, clinicId: 1, gynae: { antenatal_enabled: false } });
    expect(id).toBeNull();
  });

  test('registers the patient straight away when antenatal_enabled is ticked', async () => {
    const id = await ensureAntenatalRegistration(sequelize, {
      participantId, clinicId: 1, gynae: { antenatal_enabled: true, lmp: '2026-01-01', edd: '2026-10-08', gravida: '2', para: '1' }, registeredBy: 1,
    });
    expect(id).toBeTruthy();

    const [[row]] = await sequelize.query(`SELECT * FROM antenatal_registrations WHERE id = ?`, { replacements: [id] });
    expect(row.status).toBe('active');
    expect(row.source).toBe('auto');
    expect(row.gravida).toBe('2');
  });

  test('is idempotent — a second tick finds the existing active registration instead of duplicating', async () => {
    const [[before]] = await sequelize.query(`SELECT COUNT(*) as cnt FROM antenatal_registrations WHERE participant_id = ?`, { replacements: [participantId] });
    const id = await ensureAntenatalRegistration(sequelize, { participantId, clinicId: 1, gynae: { antenatal_enabled: true, lmp: '2026-02-01' } });
    const [[after]] = await sequelize.query(`SELECT COUNT(*) as cnt FROM antenatal_registrations WHERE participant_id = ?`, { replacements: [participantId] });
    expect(after.cnt).toBe(before.cnt);
    expect(id).toBeTruthy();
  });
});

describe('POST /api/antenatal (manual registration)', () => {
  test('rejects a missing participant_id', async () => {
    const res = mockRes();
    await withTenant(() => postRegisterHandler(req({ body: {} }), res));
    expect(res.statusCode).toBe(400);
  });

  test('rejects registering a patient who already has an active registration', async () => {
    const res = mockRes();
    await withTenant(() => postRegisterHandler(req({ body: { participant_id: participantId } }), res));
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /api/antenatal and /:id', () => {
  let registrationId;

  beforeAll(async () => {
    const [[row]] = await sequelize.query(`SELECT id FROM antenatal_registrations WHERE participant_id = ?`, { replacements: [participantId] });
    registrationId = row.id;
  });

  test('lists the registration with the patient name joined in', async () => {
    const res = mockRes();
    await withTenant(() => getListHandler(req({}), res));
    expect(res.statusCode).toBe(200);
    const mine = res.body.find((r) => r.id === registrationId);
    expect(mine.first_name).toBe('Antenatal');
    expect(Number(mine.visit_count)).toBe(0);
  });

  test('returns 404 for an unknown registration', async () => {
    const res = mockRes();
    await withTenant(() => getProfileHandler(req({ params: { id: uuid() } }), res));
    expect(res.statusCode).toBe(404);
  });

  test('a profile fetch returns the registration plus its (empty) visit list', async () => {
    const res = mockRes();
    await withTenant(() => getProfileHandler(req({ params: { id: registrationId } }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.participant_number).toBeTruthy();
    expect(res.body.visits).toEqual([]);
  });
});

describe('POST /api/antenatal/:id/visits', () => {
  let registrationId;

  beforeAll(async () => {
    const [[row]] = await sequelize.query(`SELECT id FROM antenatal_registrations WHERE participant_id = ?`, { replacements: [participantId] });
    registrationId = row.id;
  });

  test('returns 404 for an unknown registration', async () => {
    const res = mockRes();
    await withTenant(() => postVisitHandler(req({ params: { id: uuid() }, body: {} }), res));
    expect(res.statusCode).toBe(404);
  });

  test('records a visit, retrievable via the profile', async () => {
    const res = mockRes();
    await withTenant(() => postVisitHandler(req({
      params: { id: registrationId },
      body: { gestational_age_weeks: '28', blood_pressure: '110/70', weight: '62.5', fundal_height: '28', fetal_heart_rate: '140', next_appointment: '2026-11-01' },
    }), res));
    expect(res.statusCode).toBe(201);

    const profileRes = mockRes();
    await withTenant(() => getProfileHandler(req({ params: { id: registrationId } }), profileRes));
    expect(profileRes.body.visits.length).toBe(1);
    expect(profileRes.body.visits[0].blood_pressure).toBe('110/70');
    expect(profileRes.body.visits[0].recorded_by).toBe(1);
  });
});
