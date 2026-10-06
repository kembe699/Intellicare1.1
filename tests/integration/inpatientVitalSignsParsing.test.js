/**
 * Live bug report: a doctor's note's vitals line rendered as "Temp: °C •
 * BP: • Pulse: • RR:" — every value blank. Root cause: vital_signs is
 * written via JSON.stringify() (see POST /doctor-notes, POST /nursing-
 * notes), but on this schema the column doesn't come back auto-parsed on
 * read the way a real json/jsonb column would through node-postgres — GET
 * returned it as the raw string `"{\"temperature\":...}"`, so
 * `vital_signs.temperature` on the frontend silently evaluated to
 * undefined (a string has no such property). No error anywhere, so it
 * went unnoticed until someone actually looked at a saved note.
 *
 * Fixed by parsing it server-side (parseVitalSigns) before the response
 * goes out, for both GET /doctor-notes and GET /nursing-notes.
 *
 * Separately: vitals moved from Doctor's Note to Nursing Note (a nurse
 * records vitals, not a doctor) — this test seeds a nursing note with
 * vital_signs (the now-correct home for it) and a doctor note without,
 * matching the corrected UI.
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
let postDoctorNoteHandler;
let getDoctorNotesHandler;
let postNursingNoteHandler;
let getNursingNotesHandler;

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
    user: { id: 1, displayName: 'Vitals Tester', role: 'admin' },
    branchContext: { isAdmin: true },
    models: testConn,
    ...overrides,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const inpatientRouter = require('../../src/server/routes/inpatient');
  postDoctorNoteHandler = handlerFor(inpatientRouter, '/doctor-notes', 'post');
  getDoctorNotesHandler = handlerFor(inpatientRouter, '/doctor-notes', 'get');
  postNursingNoteHandler = handlerFor(inpatientRouter, '/nursing-notes', 'post');
  getNursingNotesHandler = handlerFor(inpatientRouter, '/nursing-notes', 'get');
}, 30000);

const createdAdmissionIds = [];

afterAll(async () => {
  try {
    for (const id of createdAdmissionIds) {
      await sequelize.query(`DELETE FROM doctor_notes WHERE admission_id = :id`, { replacements: { id } });
      await sequelize.query(`DELETE FROM nursing_notes WHERE admission_id = :id`, { replacements: { id } });
    }
  } catch (e) { console.warn('inpatientVitalSignsParsing cleanup failed (non-fatal):', e.message); }
});

describe('vital_signs round-trips as a real object, not a JSON string', () => {
  test('a nursing note saved with vital_signs comes back with it parsed into an object with the right values', async () => {
    const admissionId = uuid();
    const patientId = uuid();
    createdAdmissionIds.push(admissionId);

    const postRes = mockRes();
    await withTenant(() => postNursingNoteHandler(req({
      body: {
        admission_id: admissionId, patient_id: patientId, shift: 'morning', care_activities: 'Routine obs',
        vital_signs: { temperature: '37.5', blood_pressure: '120/80', pulse: '80', respiratory_rate: '18' },
      },
    }), postRes));
    expect(postRes.statusCode).toBe(201);

    const getRes = mockRes();
    await withTenant(() => getNursingNotesHandler(req({ query: { admission_id: admissionId } }), getRes));
    expect(getRes.body.length).toBe(1);
    const vitals = getRes.body[0].vital_signs;
    expect(typeof vitals).toBe('object');
    expect(vitals).not.toBeNull();
    expect(vitals.temperature).toBe('37.5');
    expect(vitals.blood_pressure).toBe('120/80');
    expect(vitals.pulse).toBe('80');
    expect(vitals.respiratory_rate).toBe('18');
  });

  test('a doctor note with no vitals (the corrected flow — vitals belong to nursing now) comes back with vital_signs null, not a broken string', async () => {
    const admissionId = uuid();
    const patientId = uuid();
    createdAdmissionIds.push(admissionId);

    const postRes = mockRes();
    await withTenant(() => postDoctorNoteHandler(req({
      body: { admission_id: admissionId, patient_id: patientId, clinical_assessment: 'Improving', progress_status: 'stable' },
    }), postRes));
    expect(postRes.statusCode).toBe(201);

    const getRes = mockRes();
    await withTenant(() => getDoctorNotesHandler(req({ query: { admission_id: admissionId } }), getRes));
    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].vital_signs).toBeNull();
    expect(getRes.body[0].clinical_assessment).toBe('Improving');
  });
});
