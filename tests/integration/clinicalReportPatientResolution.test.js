/**
 * Prescription Register (and the other Clinical Reports endpoints joining a
 * patient_id column) only joined the `patients` table — but pharmacy
 * prescriptions, inpatient admissions, and inpatient radiology requests can
 * all reference EITHER `patients` OR `lis_participants` (confirmed by the
 * exact same dual-join convention already used in pharmacyModule.js's own
 * GET /prescriptions/:id and inpatient.js's own admission queries). Real
 * client report: Prescription Register (All Branches) showed every patient
 * as "Unknown".
 *
 * Also: the register showed only `frequency` for dosing, which prescribers
 * routinely leave blank while filling `dose_strength` instead (same
 * "{dose} · {frequency}" display convention PrescriptionManagement.tsx
 * already uses) — fixed to combine both into one "dosage" field.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let handler;
let lpId;
let rxId;

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

function req(query) {
  return { params: {}, body: {}, query, user: { id: 1, displayName: 'Patient Resolution Tester', role: 'admin' }, branchContext: { isAdmin: true } };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/reportClinical');
  handler = handlerFor(router, '/prescription-register', 'get');

  lpId = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name, gender, date_of_birth)
     VALUES (:id, :pn, 'PatRes', 'Participant', 'female', '1990-01-01')`,
    { replacements: { id: lpId, pn: `PATRES-${Date.now()}` } }
  );
  rxId = uuid();
  await sequelize.query(
    `INSERT INTO pharmacy_prescriptions (id, clinic_id, prescription_number, patient_id, prescription_date, prescribed_by_name, status)
     VALUES (:id, 1, :pn, :lpId, CURRENT_DATE, 'Dr PatRes Tester', 'active')`,
    { replacements: { id: rxId, pn: `PATRES-RX-${Date.now()}`, lpId } }
  );
  await sequelize.query(
    `INSERT INTO prescription_lines (id, prescription_id, line_number, external_drug_name, is_external, dose_strength, frequency)
     VALUES (:id, :rxId, 1, 'PatRes Drug', true, '500mg', 'TDS')`,
    { replacements: { id: uuid(), rxId } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM prescription_lines WHERE prescription_id = :rxId`, { replacements: { rxId } });
    await sequelize.query(`DELETE FROM pharmacy_prescriptions WHERE id = :rxId`, { replacements: { rxId } });
    await sequelize.query(`DELETE FROM lis_participants WHERE id = :lpId`, { replacements: { lpId } });
  } catch (e) { console.warn('clinicalReportPatientResolution cleanup failed (non-fatal):', e.message); }
});

describe('GET /api/reports-v2/clinical/prescription-register — patient resolves from either registry', () => {
  test('a prescription whose patient_id is a lis_participants row resolves a real name, not "Unknown"', async () => {
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: '2020-01-01', dateTo: '2030-01-01', allBranches: 'true' }), res));
    expect(res.statusCode).toBe(200);

    const row = res.body.rows.find((r) => r.prescriberName === 'Dr PatRes Tester');
    expect(row).toBeTruthy();
    expect(row.patientName).toBe('PatRes Participant');
    expect(row.patientName).not.toBe('Unknown');
  });

  test('dosage combines dose_strength and frequency, not frequency alone', async () => {
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: '2020-01-01', dateTo: '2030-01-01', allBranches: 'true' }), res));

    const row = res.body.rows.find((r) => r.prescriberName === 'Dr PatRes Tester');
    expect(row.dosage).toBe('500mg · TDS');
  });
});
