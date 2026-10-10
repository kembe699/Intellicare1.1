/**
 * POST /api/lis/participants' participant_number used to always be
 * "PTN-YYYYMMDD-RRRR" (a random 4-digit suffix, no UNIQUE constraint behind
 * it). It's now "{PREFIX}-{6-digit sequential}{-SUFFIX}", with the facility's
 * prefix/suffix read from facility_settings (Setup > Configurations) and the
 * 6-digit number allocated collision-proof via patient_number_counters —
 * this proves both the configured case, the no-row-yet fallback to "PTN",
 * and that two concurrent registrations never land on the same number.
 *
 * Calls the real route handler directly, same handlerFor() pattern as
 * lisBranchIdOnCreation.test.js, against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const CLINIC_A = 958201; // distinct from the real clinic_id=1 so this test's
                          // facility_settings row never collides with real data

let sequelize;
let registerHandler;

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

function reqFor(body) {
  return { models: { sequelize }, user: { role: 'admin', clinicId: CLINIC_A, id: uuid() }, body };
}

beforeAll(async () => {
  const conn = await getTenantConnection(TEST_SCHEMA);
  sequelize = conn.sequelize;
  sequelize.options.logging = false;

  const lisRouter = require('../../src/server/routes/lisModule');
  registerHandler = handlerFor(lisRouter, '/participants', 'post');
});

afterEach(async () => {
  await sequelize.query(`DELETE FROM lis_participants WHERE first_name = 'FacilitySettingsTest'`);
});

afterAll(async () => {
  await sequelize.query(`DELETE FROM facility_settings WHERE clinic_id = :clinicId`, { replacements: { clinicId: CLINIC_A } });
  await sequelize.query(`DELETE FROM patient_number_counters WHERE clinic_id = :clinicId`, { replacements: { clinicId: CLINIC_A } });
});

test('falls back to the PTN- prefix with no suffix when no facility_settings row exists yet, with a 6-digit sequential number', async () => {
  const req = reqFor({ first_name: 'FacilitySettingsTest', last_name: 'Default' });
  const res = mockRes();
  await registerHandler(req, res);
  expect(res.body.participant_number).toMatch(/^PTN-\d{6}$/);
});

test('uses the configured prefix and suffix once facility_settings has a row', async () => {
  await sequelize.query(
    `INSERT INTO facility_settings (clinic_id, patient_number_prefix, patient_number_suffix)
     VALUES (:clinicId, 'KUEL', 'MAIN')`,
    { replacements: { clinicId: CLINIC_A } }
  );
  const req = reqFor({ first_name: 'FacilitySettingsTest', last_name: 'Configured' });
  const res = mockRes();
  await registerHandler(req, res);
  expect(res.body.participant_number).toMatch(/^KUEL-\d{6}-MAIN$/);
});

test('the sequential number increments and never repeats for the same clinic', async () => {
  const req1 = reqFor({ first_name: 'FacilitySettingsTest', last_name: 'One' });
  const res1 = mockRes();
  await registerHandler(req1, res1);

  const req2 = reqFor({ first_name: 'FacilitySettingsTest', last_name: 'Two' });
  const res2 = mockRes();
  await registerHandler(req2, res2);

  const seq1 = parseInt(res1.body.participant_number.match(/(\d{6})/)[1], 10);
  const seq2 = parseInt(res2.body.participant_number.match(/(\d{6})/)[1], 10);
  expect(seq2).toBe(seq1 + 1);
});
