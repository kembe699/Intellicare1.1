/**
 * Geofenced QR clock in/out: sequence rules, duplicate-tap suppression,
 * and overnight-shift shift_date inheritance, calling the REAL
 * POST /attendance/clock handler directly (see
 * tests/integration/antenatal.test.js for why — no HTTP test harness in
 * this app), against tenant_test.
 *
 * Geofence/signature rejection themselves are covered by the pure unit
 * tests (tests/unit/attendanceGeofence.test.js,
 * tests/unit/attendanceQr.test.js) — this file is specifically the
 * route-level sequencing behavior that only exists once a real
 * attendance_records history is involved.
 *
 * Each test clears this employee's attendance_records first and seeds
 * exactly the "last record" state it needs directly via SQL, rather than
 * chaining off whatever the previous test left behind — the clock
 * endpoint's own duplicate-tap rule (same action within 2 minutes) means
 * two real handler calls made moments apart inside a fast test run would
 * otherwise collide with whichever sequence rule the test actually means
 * to exercise.
 */
process.env.ATTENDANCE_QR_SECRET = process.env.ATTENDANCE_QR_SECRET || 'test-secret-do-not-use-in-production';

const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');
const { signStaticToken, generateSiteKey } = require('../../src/server/utils/attendanceQr');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let clockHandler;
let employeeId;
let siteId;

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

function clockReq(overrides) {
  return {
    body: {}, ip: '127.0.0.1', headers: { 'user-agent': 'jest-test' },
    employee: { id: employeeId, clinicId: 1, branchId: 1 },
    ...overrides,
  };
}

async function clearRecords() {
  await sequelize.query(`DELETE FROM attendance_records WHERE employee_id = :id`, { replacements: { id: employeeId } });
}

// Inserts a historical accepted record well outside the 2-minute
// duplicate-tap window, so a test can exercise "already clocked in" /
// "not clocked in" without a real clock-handler call racing its own
// duplicate-tap check.
async function seedRecord({ type, hoursAgo, shiftDate }) {
  const id = uuid();
  const occurredAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const dateStr = shiftDate || occurredAt.toISOString().slice(0, 10);
  await sequelize.query(`
    INSERT INTO attendance_records (id, clinic_id, branch_id, employee_id, site_id, type, occurred_at, shift_date,
      latitude, longitude, accuracy_m, distance_m, method, status, device_info, ip, created_at)
    VALUES (:id, 1, 1, :empId, :siteId, :type, :occurredAt, :shiftDate, 1.2921, 36.8219, 10, 0, 'qr_static', 'accepted', 'test', '127.0.0.1', NOW())
  `, { replacements: { id, empId: employeeId, siteId, type, occurredAt: occurredAt.toISOString(), shiftDate: dateStr } });
  return { id, occurredAt, dateStr };
}

async function freshToken() {
  const [[site]] = await sequelize.query(`SELECT * FROM attendance_sites WHERE id = :id`, { replacements: { id: siteId } });
  return signStaticToken(site);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/employeePortal');
  clockHandler = handlerFor(router, '/attendance/clock', 'post');

  employeeId = uuid();
  await sequelize.query(`
    INSERT INTO employees (id, clinic_id, branch_id, employee_number, employment_type, first_name, last_name,
      employment_status, is_active, portal_access_enabled, created_at, updated_at)
    VALUES (:id, 1, 1, :empNum, 'staff', 'Sequence', 'Tester', 'active', TRUE, TRUE, NOW(), NOW())
  `, { replacements: { id: employeeId, empNum: `SEQ-TEST-${Date.now()}` } });

  siteId = uuid();
  await sequelize.query(`
    INSERT INTO attendance_sites (id, clinic_id, branch_id, name, latitude, longitude, radius_m, is_active, qr_mode, qr_key, qr_key_created_at, created_at, updated_at)
    VALUES (:id, 1, 1, 'Sequence Test Site', 1.2921, 36.8219, 100, TRUE, 'printed', :qrKey, NOW(), NOW(), NOW())
  `, { replacements: { id: siteId, qrKey: generateSiteKey() } });
}, 30000);

afterAll(async () => {
  try {
    await clearRecords();
    await sequelize.query(`DELETE FROM attendance_sites WHERE id = :id`, { replacements: { id: siteId } });
    await sequelize.query(`DELETE FROM employees WHERE id = :id`, { replacements: { id: employeeId } });
  } catch (e) { console.warn('attendanceClockSequence cleanup failed (non-fatal):', e.message); }
});

describe('clock sequence rules', () => {
  test('a valid clock-in at an empty history is accepted', async () => {
    await clearRecords();
    const { token, sig } = await freshToken();
    const res = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token, sig, type: 'in', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('in');
  });

  test('clocking in while already clocked in (last record is an "in" from well outside the duplicate-tap window) is rejected', async () => {
    await clearRecords();
    await seedRecord({ type: 'in', hoursAgo: 3 });
    const { token, sig } = await freshToken();
    const res = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token, sig, type: 'in', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), res));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/already clocked in/i);
  });

  test('a valid clock-out closes an open shift', async () => {
    await clearRecords();
    await seedRecord({ type: 'in', hoursAgo: 3 });
    const { token, sig } = await freshToken();
    const res = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token, sig, type: 'out', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('out');
  });

  test('clocking out with no open shift (no history at all) is rejected', async () => {
    await clearRecords();
    const { token, sig } = await freshToken();
    const res = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token, sig, type: 'out', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), res));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/not clocked in/i);
  });

  test('clocking out when the last record is already an "out" from outside the duplicate-tap window is rejected as a sequence error', async () => {
    await clearRecords();
    await seedRecord({ type: 'in', hoursAgo: 4 });
    await seedRecord({ type: 'out', hoursAgo: 3 });
    const { token, sig } = await freshToken();
    const res = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token, sig, type: 'out', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), res));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/not clocked in/i);
  });

  test('a duplicate tap of the same action within 2 minutes is rejected as a duplicate, not a sequence error', async () => {
    await clearRecords();
    const { token, sig } = await freshToken();
    const first = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token, sig, type: 'in', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), first));
    expect(first.statusCode).toBe(200);

    const second = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token, sig, type: 'in', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), second));
    expect(second.statusCode).toBe(400);
    expect(second.body.error).toMatch(/wait a moment/i);
  });

  test('an overnight shift: a clock-out after midnight inherits the PRIOR day\'s shift_date from its matching open clock-in', async () => {
    await clearRecords();
    const yesterday = new Date(Date.now() - 20 * 60 * 60 * 1000); // 20h ago, well outside the duplicate-tap window
    const yesterdayDateStr = yesterday.toISOString().slice(0, 10);
    await seedRecord({ type: 'in', hoursAgo: 20, shiftDate: yesterdayDateStr });

    const { token, sig } = await freshToken();
    const res = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token, sig, type: 'out', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), res));
    expect(res.statusCode).toBe(200);

    const [[outRow]] = await sequelize.query(
      `SELECT shift_date FROM attendance_records WHERE employee_id = :id AND type = 'out' ORDER BY occurred_at DESC LIMIT 1`,
      { replacements: { id: employeeId } }
    );
    // node-postgres returns a DATE column as a plain "YYYY-MM-DD" string
    // (no custom type parser registered), not a JS Date object.
    const outShiftDate = outRow.shift_date instanceof Date ? outRow.shift_date.toISOString().slice(0, 10) : String(outRow.shift_date).slice(0, 10);
    expect(outShiftDate).toBe(yesterdayDateStr);
  });

  test('a rejected clock attempt (tampered signature) is persisted for HR review but does not open/close a shift', async () => {
    await clearRecords();
    const [[row]] = await sequelize.query(`SELECT * FROM attendance_sites WHERE id = :id`, { replacements: { id: siteId } });
    const forgedSig = '0'.repeat(64);
    const res = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token: `${siteId}.${row.qr_key}`, sig: forgedSig, type: 'in', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), res));
    expect(res.statusCode).toBe(400);

    const [[rejectedRow]] = await sequelize.query(
      `SELECT status FROM attendance_records WHERE employee_id = :id ORDER BY created_at DESC LIMIT 1`,
      { replacements: { id: employeeId } }
    );
    expect(rejectedRow.status).toBe('rejected');

    // Confirm the rejected attempt really doesn't count as an open shift —
    // a genuine clock-in right after it must still succeed as a fresh "in".
    const { token, sig } = await freshToken();
    const follow = mockRes();
    await withTenant(() => clockHandler(clockReq({ body: { token, sig, type: 'in', latitude: 1.2921, longitude: 36.8219, accuracy_m: 10 } }), follow));
    expect(follow.statusCode).toBe(200);
    expect(follow.body.type).toBe('in');
  });
});
