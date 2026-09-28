/**
 * DHIS2 monthly report — DB-backed behavior.
 *
 * Exercises the actual section-computation functions against real rows in
 * tenant_test (never a real tenant — see tests/setup/testDb.js), calling
 * them the same way the route handlers do but through tenantContext.run()
 * so the models Proxy in src/server/models/index.js resolves `sequelize` to
 * this test connection instead of the app's default one. That's the same
 * mechanism middleware/auth.js uses per-request, so this also doubles as a
 * live proof that two concurrent tenant contexts never see each other's
 * connection (the exact bug class the clinicalDiagnoses.js history warns
 * about).
 *
 * A unique, far-future period (2031-06) plus dedicated test branch ids keep
 * this from ever colliding with real data, and every row this file inserts
 * is deleted again in afterAll.
 */
const { getSequelize, query, closeConnection, uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { migrateDhis2Tables } = require('../../src/server/scripts/migrateDhis2Tables');

const PERIOD = '2031-06';
const BRANCH_A = 900001;
const BRANCH_B = 900002;

let reportDhis2;
let testConn;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  const sequelize = getSequelize();
  testConn = { sequelize, models: {} };
  await migrateDhis2Tables(sequelize);

  // Required after the tenant DB is confirmed up. Its own top-level
  // `require('../models')` still resolves outside any request (falls back
  // to the app's default connection per tenantContext.js) but every call
  // below explicitly wraps in tenantContext.run() instead of relying on
  // that fallback, so it never touches the default connection.
  reportDhis2 = require('../../src/server/routes/reportDhis2');

  const p = (id, dob, gender, branchId = BRANCH_A) => query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name, gender, date_of_birth, branch_id, created_at)
     VALUES (:id, :num, 'Test', 'Patient', :gender, :dob, :branchId, NOW())`,
    { id, num: `TP-${id.slice(0, 8)}`, gender, dob, branchId }
  );
  const order = (id, participantId, notes, createdAt, branchId = BRANCH_A) => query(
    `INSERT INTO lis_test_orders (id, participant_id, clinical_notes, created_at, branch_id)
     VALUES (:id, :participantId, :notes, :createdAt, :branchId)`,
    { id, participantId, notes, createdAt, branchId }
  );
  const specimen = (id, orderId, testName, branchId = BRANCH_A) => query(
    `INSERT INTO lis_specimens (id, order_id, test_code, test_name, barcode, branch_id, created_at)
     VALUES (:id, :orderId, 'TC', :testName, :barcode, :branchId, NOW())`,
    { id, orderId, testName, barcode: `BC-${id.slice(0, 8)}`, branchId }
  );
  const result = (id, specimenId, value, status, branchId = BRANCH_A) => query(
    `INSERT INTO lis_results (id, specimen_id, test_code, analyte, value, status, branch_id, created_at)
     VALUES (:id, :specimenId, 'TC', 'result', :value, :status, :branchId, NOW())`,
    { id, specimenId, value, status, branchId }
  );

  // p1: first visit in January (outside the reporting period), second visit
  // in June (the reporting period) — the June visit must be Re-attendance.
  const p1 = uuid();
  await p(p1, '2001-03-10', 'Female');
  await order(uuid(), p1, 'Diagnosis: Common cold', '2031-01-15 09:00:00');
  await order(uuid(), p1, 'Diagnosis: Common cold', '2031-06-10 09:00:00');

  // p2: single visit, in June, first visit of the year — New.
  const p2 = uuid();
  await p(p2, '1990-01-01', 'Male');
  await order(uuid(), p2, 'Diagnosis: Common cold', '2031-06-12 09:00:00');

  // p3: missing date of birth AND gender — must land in "unknown", not be
  // guessed into a band, and still be counted in the attendance total.
  const p3 = uuid();
  await p(p3, null, null);
  await order(uuid(), p3, 'Diagnosis: Common cold', '2031-06-05 09:00:00');

  // p4: malaria diagnosis + a same-visit APPROVED POSITIVE malaria RDT ->
  // Malaria (confirmed).
  const p4 = uuid();
  await p(p4, '2000-01-01', 'Male');
  const o4 = uuid();
  await order(o4, p4, 'Diagnosis: Malaria', '2031-06-06 09:00:00');
  const s4 = uuid();
  await specimen(s4, o4, 'Malaria RDT');
  await result(uuid(), s4, 'Positive', 'approved');

  // p5: malaria diagnosis with NO lab test ordered at all -> Malaria
  // (clinical, not confirmed).
  const p5 = uuid();
  await p(p5, '1995-01-01', 'Female');
  await order(uuid(), p5, 'Diagnosis: Malaria', '2031-06-07 09:00:00');

  // p6: malaria diagnosis + a same-visit APPROVED but NEGATIVE malaria RDT ->
  // still "clinical, not confirmed" — a test alone isn't enough.
  const p6 = uuid();
  await p(p6, '1992-01-01', 'Male');
  const o6 = uuid();
  await order(o6, p6, 'Diagnosis: Malaria', '2031-06-08 09:00:00');
  const s6 = uuid();
  await specimen(s6, o6, 'Malaria RDT');
  await result(uuid(), s6, 'Negative', 'approved');

  // p7: negated BEFORE the keyword ("rule out malaria") -> must not count
  // toward either malaria row; falls through to "All other diagnoses".
  const p7 = uuid();
  await p(p7, '1988-01-01', 'Female');
  await order(uuid(), p7, 'Diagnosis: rule out malaria', '2031-06-09 09:00:00');

  // p8: negated AFTER the keyword ("malaria negative") -> same as p7.
  const p8 = uuid();
  await p(p8, '1985-01-01', 'Male');
  await order(uuid(), p8, 'Diagnosis: malaria negative', '2031-06-11 09:00:00');

  // p9: clinical_notes with no "Diagnosis:" segment at all -> counts toward
  // "no diagnosis recorded", not toward any Section B row.
  const p9 = uuid();
  await p(p9, '1980-01-01', 'Female');
  await order(uuid(), p9, 'Patient seen, nothing documented.', '2031-06-13 09:00:00');

  // p10: a specimen with TWO approved analyte rows — must count as ONE
  // tested (grouped by specimen, not by lis_results row), positive overall.
  const p10 = uuid();
  await p(p10, '1970-01-01', 'Male');
  const o10 = uuid();
  await order(o10, p10, 'Diagnosis: routine visit', '2031-06-18 09:00:00');
  const s10 = uuid();
  await specimen(s10, o10, 'Malaria RDT');
  await result(uuid(), s10, 'Positive', 'approved');
  await result(uuid(), s10, 'Faint positive band', 'approved');

  // p11: a specimen with ONLY a pending (non-approved) result — must not be
  // counted as tested at all.
  const p11 = uuid();
  await p(p11, '1971-01-01', 'Female');
  const o11 = uuid();
  await order(o11, p11, 'Diagnosis: routine visit', '2031-06-19 09:00:00');
  const s11 = uuid();
  await specimen(s11, o11, 'HIV Test');
  await result(uuid(), s11, 'inconclusive', 'pending_manager_review');

  // p12: a specimen with an approved NEGATIVE result — counted as tested,
  // not positive.
  const p12 = uuid();
  await p(p12, '1972-01-01', 'Male');
  const o12 = uuid();
  await order(o12, p12, 'Diagnosis: routine visit', '2031-06-20 09:00:00');
  const s12 = uuid();
  await specimen(s12, o12, 'HIV Test');
  await result(uuid(), s12, 'Negative', 'approved');

  // Branch isolation: one visit under a DIFFERENT branch, same period — must
  // never appear when computing for BRANCH_A.
  const pB = uuid();
  await p(pB, '1999-01-01', 'Male', BRANCH_B);
  await order(uuid(), pB, 'Diagnosis: Malaria', '2031-06-17 09:00:00', BRANCH_B);
});

afterAll(async () => {
  await query(`DELETE FROM lis_results WHERE branch_id IN (:a, :b)`, { a: BRANCH_A, b: BRANCH_B });
  await query(`DELETE FROM lis_specimens WHERE branch_id IN (:a, :b)`, { a: BRANCH_A, b: BRANCH_B });
  await query(`DELETE FROM lis_test_orders WHERE branch_id IN (:a, :b)`, { a: BRANCH_A, b: BRANCH_B });
  await query(`DELETE FROM lis_participants WHERE branch_id IN (:a, :b)`, { a: BRANCH_A, b: BRANCH_B });
  await query(`DELETE FROM dhis2_monthly_reports WHERE branch_id IN (:a, :b)`, { a: BRANCH_A, b: BRANCH_B });
  await closeConnection();
});

describe('computeAttendanceAndMorbidity (Sections A & B)', () => {
  let result;
  beforeAll(async () => {
    result = await withTenant(() =>
      reportDhis2.__testHelpers.computeAttendanceAndMorbidity({}, 1, BRANCH_A, PERIOD)
    );
  });

  test('a visit whose first order this year falls outside the period counts as Re-attendance, not New', () => {
    expect(result.sectionA.reattendance.total).toBe(1);
    expect(result.sectionA.new.total).toBe(11);
  });

  test('section A total equals the sum of every age/sex column, including unknown', () => {
    const t = result.sectionA.total;
    expect(t.u5m + t.u5f + t.ge5m + t.ge5f + t.unknown).toBe(t.total);
    expect(t.total).toBe(12);
  });

  test('missing date of birth and gender land in "unknown", not a guessed band, but still count in total', () => {
    expect(result.sectionA.total.unknown).toBe(1);
  });

  test('a malaria diagnosis with a same-visit approved POSITIVE test is "Malaria (confirmed)"', () => {
    expect(result.sectionB.malaria_confirmed.total).toBe(1);
  });

  test('a malaria diagnosis with no lab test at all, or an approved but NEGATIVE test, both fall through to "clinical, not confirmed"', () => {
    expect(result.sectionB.malaria_clinical.total).toBe(2);
    expect(result.sectionB.malaria_confirmed.total).toBe(1);
  });

  test('negation on either side of the keyword excludes the visit from both malaria rows entirely', () => {
    // 5 visits mention "malaria" (p4-p8), but only p4-p6 are genuine matches;
    // p7 (negated before) and p8 (negated after) must not inflate either row.
    expect(result.sectionB.malaria_confirmed.total + result.sectionB.malaria_clinical.total).toBe(3);
  });

  test('a visit with no "Diagnosis:" segment is tallied as "no diagnosis recorded" and excluded from the morbidity total', () => {
    expect(result.diagnosisReview.noDiagnosisCount).toBe(1);
    expect(result.sectionB.no_diagnosis.total).toBe(1);
    // "No diagnosis recorded" is not itself a morbidity case, so it must not
    // be folded into the Section B Total row.
    expect(result.sectionB.total.total).toBe(11);
  });

  test('visits with at least one recorded diagnosis never exceed total attendance', () => {
    expect(result.diagnosisReview.visitsWithDiagnosis).toBeLessThanOrEqual(result.diagnosisReview.totalAttendance);
    expect(result.diagnosisReview.visitsWithDiagnosis).toBe(11);
    expect(result.diagnosisReview.totalAttendance).toBe(12);
  });
});

describe('computeLaboratory (Section C)', () => {
  let cRows;
  beforeAll(async () => {
    cRows = await withTenant(() =>
      reportDhis2.__testHelpers.computeLaboratory({}, 1, BRANCH_A, PERIOD)
    );
  });

  test('a specimen with several approved analyte rows counts as ONE tested, not one per row', () => {
    // p4 (positive) + p6 (negative) + p10 (2 approved rows, still 1 specimen) = 3 tested.
    expect(cRows.malaria_rdt.tested).toBe(3);
    expect(cRows.malaria_rdt.positive).toBe(2); // p4 and p10
  });

  test('a specimen with only a pending (non-approved) result is not counted as tested at all', () => {
    // p11's pending-only specimen excluded; p12's approved-negative specimen counted.
    expect(cRows.hiv.tested).toBe(1);
    expect(cRows.hiv.positive).toBe(0);
  });
});

describe('branch isolation', () => {
  test('a visit recorded under a different branch never appears when computing for this branch', async () => {
    const resultA = await withTenant(() =>
      reportDhis2.__testHelpers.computeAttendanceAndMorbidity({}, 1, BRANCH_A, PERIOD)
    );
    expect(resultA.sectionA.total.total).toBe(12);

    const resultB = await withTenant(() =>
      reportDhis2.__testHelpers.computeAttendanceAndMorbidity({}, 1, BRANCH_B, PERIOD)
    );
    expect(resultB.sectionA.total.total).toBe(1);
  });

  test('requesting "All Branches" (branchId=null) sees both', async () => {
    const resultAll = await withTenant(() =>
      reportDhis2.__testHelpers.computeAttendanceAndMorbidity({ user: { role: 'admin' }, branchContext: { adminScoped: false } }, 1, null, PERIOD)
    );
    expect(resultAll.sectionA.total.total).toBe(13);
  });
});

describe('tenant isolation — the AsyncLocalStorage mechanism reportDhis2.js relies on', () => {
  test('two overlapping async tenant contexts never see each other\'s connection', async () => {
    const callsA = [];
    const callsB = [];
    const fakeConnA = { sequelize: { query: async (sql) => { await new Promise((r) => setTimeout(r, 15)); callsA.push(sql); return 'A'; } }, models: {} };
    const fakeConnB = { sequelize: { query: async (sql) => { callsB.push(sql); return 'B'; } }, models: {} };
    const { sequelize: proxySequelize } = require('../../src/server/models');

    const [resultA, resultB] = await Promise.all([
      tenantContext.run(fakeConnA, () => proxySequelize.query('FROM-BRANCH-A-REQUEST')),
      tenantContext.run(fakeConnB, () => proxySequelize.query('FROM-BRANCH-B-REQUEST')),
    ]);

    expect(resultA).toBe('A');
    expect(resultB).toBe('B');
    expect(callsA).toEqual(['FROM-BRANCH-A-REQUEST']);
    expect(callsB).toEqual(['FROM-BRANCH-B-REQUEST']);
  });
});
