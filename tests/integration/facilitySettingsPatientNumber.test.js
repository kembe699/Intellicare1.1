/**
 * POST /api/lis/participants' participant_number used to always be
 * "PTN-YYYYMMDD-RRRR", hardcoded. It now reads the facility's configured
 * prefix/suffix from facility_settings (Setup > Configurations) — this
 * proves both the configured case and the no-row-yet fallback to "PTN".
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
});

test('falls back to the PTN- prefix with no suffix when no facility_settings row exists yet', async () => {
  const req = reqFor({ first_name: 'FacilitySettingsTest', last_name: 'Default' });
  const res = mockRes();
  await registerHandler(req, res);
  expect(res.body.participant_number).toMatch(/^PTN-\d{8}-\d{4}$/);
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
  expect(res.body.participant_number).toMatch(/^KUEL-\d{8}-\d{4}-MAIN$/);
});
