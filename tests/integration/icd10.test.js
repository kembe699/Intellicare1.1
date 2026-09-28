/**
 * ICD-10 feature — DB-backed behavior against tenant_test (never a real
 * tenant — see tests/setup/testDb.js).
 *
 * public.icd10_codes is genuinely shared across every schema in this
 * database (see scripts/importIcd10.js), so seeding it here via the real
 * importer is the same idempotent operation the app's own boot-time
 * migration performs — safe to run repeatedly, and it exercises the actual
 * 98k-row CMS dataset rather than a hand-built fixture. visit_diagnoses
 * itself is per-tenant, created directly in tenant_test.
 *
 * A unique, far-future period-free test scope (dedicated branch ids, and a
 * cleanup pass in afterAll) keeps this from colliding with any other data.
 */
const { getSequelize, query, closeConnection, uuid } = require('../setup/testDb');
const { migrateVisitDiagnosesTable } = require('../../src/server/scripts/migrateVisitDiagnosesTable');
const { migrateIcd10Table, importIcd10Codes } = require('../../src/server/scripts/importIcd10');
const { searchIcd10, getPriorityList, getRecentList, getIcd10ByCode } = require('../../src/server/routes/icd10').__testHelpers;
const visitDiagnosesService = require('../../src/server/services/visitDiagnosesService');
const { backfillVisitDiagnoses } = require('../../src/server/scripts/backfillVisitDiagnoses');

const BRANCH_A = 900101;
const BRANCH_B = 900102;

let sequelize;

beforeAll(async () => {
  sequelize = getSequelize();
  await migrateVisitDiagnosesTable(sequelize);
  await migrateIcd10Table(sequelize);
  await importIcd10Codes(sequelize); // idempotent — fast no-op after the first run anywhere on this DB
}, 120000);

afterAll(async () => {
  await query(`DELETE FROM visit_diagnoses WHERE branch_id IN (:a, :b)`, { a: BRANCH_A, b: BRANCH_B });
  await query(`DELETE FROM lis_test_orders WHERE branch_id IN (:a, :b)`, { a: BRANCH_A, b: BRANCH_B });
  await query(`DELETE FROM lis_participants WHERE branch_id IN (:a, :b)`, { a: BRANCH_A, b: BRANCH_B });
  await closeConnection();
});

describe('searchIcd10 — code lookup', () => {
  test('finds a code with the dot', async () => {
    const results = await searchIcd10(sequelize, { q: 'A01.0' });
    expect(results[0].code).toBe('A01.0');
  });

  test('finds the same code without the dot, in any case', async () => {
    const withoutDot = await searchIcd10(sequelize, { q: 'a010' });
    expect(withoutDot[0].code).toBe('A01.0');
  });

  test('exact code match ranks first even among many text matches', async () => {
    const results = await searchIcd10(sequelize, { q: 'B54' });
    expect(results[0].code).toBe('B54');
  });

  test('a code prefix returns its subcodes', async () => {
    const results = await searchIcd10(sequelize, { q: 'A00' });
    const codes = results.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['A00', 'A00.0', 'A00.1', 'A00.9']));
  });
});

describe('searchIcd10 — text search', () => {
  test('word order does not matter', async () => {
    const a = await searchIcd10(sequelize, { q: 'malaria falciparum' });
    const b = await searchIcd10(sequelize, { q: 'falciparum malaria' });
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((r) => r.code).sort()).toEqual(b.map((r) => r.code).sort());
  });

  test('a synonym (uti) finds urinary tract infection codes', async () => {
    const results = await searchIcd10(sequelize, { q: 'uti' });
    expect(results.some((r) => /urinary tract infection/i.test(r.description))).toBe(true);
  });

  test('billable codes rank at or above their non-billable category header for equal relevance', async () => {
    // A00 (Cholera, header) and A00.9 (Cholera, unspecified, billable) are
    // both non-priority with zero usage in a fresh scope, so is_billable is
    // the only tier that can separate them here.
    const results = await searchIcd10(sequelize, { q: 'cholera' });
    const headerIdx = results.findIndex((r) => r.code === 'A00');
    const leafIdx = results.findIndex((r) => r.code === 'A00.9');
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(leafIdx).toBeGreaterThanOrEqual(0);
    expect(leafIdx).toBeLessThan(headerIdx);
  });
});

describe('getPriorityList / is_priority flag', () => {
  test('a MoH priority code (malaria) is flagged, an unrelated code is not', async () => {
    const priority = await getPriorityList(sequelize);
    const codes = priority.map((r) => r.code);
    expect(codes).toContain('B54');
    const cholera = await getIcd10ByCode(sequelize, 'A00.9');
    expect(cholera.is_priority).toBe(false);
  });

  test('a remapped MoH code (M13.9 -> M13.80) is flagged priority at its real target', async () => {
    const m1380 = await getIcd10ByCode(sequelize, 'M13.80');
    expect(m1380.is_priority).toBe(true);
  });
});

describe('visitDiagnosesService — duplicate prevention, closed-visit rule, custom path, primary reassignment', () => {
  let openOrderId;
  let closedOrderId;
  let participantId;

  beforeAll(async () => {
    participantId = uuid();
    await query(
      `INSERT INTO lis_participants (id, participant_number, first_name, last_name, gender, date_of_birth, branch_id, created_at)
       VALUES (:id, :num, 'Test', 'Patient', 'Female', '1990-01-01', :branchId, NOW())`,
      { id: participantId, num: `TP-${participantId.slice(0, 8)}`, branchId: BRANCH_A }
    );
    openOrderId = uuid();
    await query(
      `INSERT INTO lis_test_orders (id, participant_id, status, branch_id, created_at) VALUES (:id, :pid, 'ordered', :branchId, NOW())`,
      { id: openOrderId, pid: participantId, branchId: BRANCH_A }
    );
    closedOrderId = uuid();
    await query(
      `INSERT INTO lis_test_orders (id, participant_id, status, branch_id, created_at) VALUES (:id, :pid, 'closed', :branchId, NOW())`,
      { id: closedOrderId, pid: participantId, branchId: BRANCH_A }
    );
  });

  test('adds a coded diagnosis and appends the coded clinical_notes line', async () => {
    const result = await visitDiagnosesService.addVisitDiagnosis(sequelize, {
      orderId: openOrderId, icdCode: 'B54', icdSource: 'CMS-ICD10CM', icdVersion: '2027', description: 'Unspecified malaria',
    });
    expect(result.status).toBe(201);
    expect(result.diagnosis.source).toBe('icd');
    expect(result.diagnosis.is_primary).toBe(true); // first diagnosis on the visit

    const [[order]] = await sequelize.query('SELECT clinical_notes FROM lis_test_orders WHERE id = :id', { replacements: { id: openOrderId } });
    expect(order.clinical_notes).toBe('Diagnosis: B54 - Unspecified malaria');
  });

  test('rejects a duplicate ICD code on the same visit', async () => {
    const result = await visitDiagnosesService.addVisitDiagnosis(sequelize, {
      orderId: openOrderId, icdCode: 'B54', description: 'Unspecified malaria',
    });
    expect(result.status).toBe(409);
  });

  test('a second, different diagnosis is not primary and appends its own clinical_notes line (custom path unchanged)', async () => {
    const result = await visitDiagnosesService.addVisitDiagnosis(sequelize, {
      orderId: openOrderId, description: 'Feeling generally unwell',
    });
    expect(result.status).toBe(201);
    expect(result.diagnosis.source).toBe('custom');
    expect(result.diagnosis.is_primary).toBe(false);

    const [[order]] = await sequelize.query('SELECT clinical_notes FROM lis_test_orders WHERE id = :id', { replacements: { id: openOrderId } });
    expect(order.clinical_notes).toBe('Diagnosis: B54 - Unspecified malaria\n\nDiagnosis: Feeling generally unwell');
  });

  test('rejects a duplicate custom diagnosis (case-insensitive) on the same visit', async () => {
    const result = await visitDiagnosesService.addVisitDiagnosis(sequelize, {
      orderId: openOrderId, description: 'FEELING GENERALLY UNWELL',
    });
    expect(result.status).toBe(409);
  });

  test('a closed visit rejects new diagnoses', async () => {
    const result = await visitDiagnosesService.addVisitDiagnosis(sequelize, {
      orderId: closedOrderId, icdCode: 'A01.0', description: 'Typhoid fever',
    });
    expect(result.status).toBe(409);
  });

  test('removing the primary diagnosis promotes the next-oldest remaining one', async () => {
    const list = await visitDiagnosesService.listVisitDiagnoses(sequelize, openOrderId);
    const primary = list.find((d) => d.is_primary);
    expect(primary.icd_code).toBe('B54');

    const removed = await visitDiagnosesService.removeVisitDiagnosis(sequelize, { orderId: openOrderId, diagnosisId: primary.id });
    expect(removed.status).toBe(200);

    const after = await visitDiagnosesService.listVisitDiagnoses(sequelize, openOrderId);
    expect(after).toHaveLength(1);
    expect(after[0].is_primary).toBe(true);
    expect(after[0].description).toBe('Feeling generally unwell');
  });

  test('a closed visit rejects removing a diagnosis', async () => {
    // Give the closed order a diagnosis directly (bypassing the service,
    // which would itself reject it) so there's something to try removing.
    const directId = uuid();
    await query(
      `INSERT INTO visit_diagnoses (id, order_id, participant_id, branch_id, description, is_primary, source, created_at)
       VALUES (:id, :orderId, :participantId, :branchId, 'Pre-existing', true, 'custom', NOW())`,
      { id: directId, orderId: closedOrderId, participantId, branchId: BRANCH_A }
    );
    const result = await visitDiagnosesService.removeVisitDiagnosis(sequelize, { orderId: closedOrderId, diagnosisId: directId });
    expect(result.status).toBe(409);
  });
});

describe('tenant/branch isolation of usage counts', () => {
  let orderA;
  let orderB;
  let participantA;
  let participantB;

  beforeAll(async () => {
    participantA = uuid();
    participantB = uuid();
    await query(
      `INSERT INTO lis_participants (id, participant_number, first_name, last_name, branch_id, created_at)
       VALUES (:id, :num, 'Test', 'A', :branchId, NOW())`,
      { id: participantA, num: `TP-${participantA.slice(0, 8)}`, branchId: BRANCH_A }
    );
    await query(
      `INSERT INTO lis_participants (id, participant_number, first_name, last_name, branch_id, created_at)
       VALUES (:id, :num, 'Test', 'B', :branchId, NOW())`,
      { id: participantB, num: `TP-${participantB.slice(0, 8)}`, branchId: BRANCH_B }
    );
    orderA = uuid();
    orderB = uuid();
    await query(`INSERT INTO lis_test_orders (id, participant_id, status, branch_id, created_at) VALUES (:id, :pid, 'ordered', :branchId, NOW())`, { id: orderA, pid: participantA, branchId: BRANCH_A });
    await query(`INSERT INTO lis_test_orders (id, participant_id, status, branch_id, created_at) VALUES (:id, :pid, 'ordered', :branchId, NOW())`, { id: orderB, pid: participantB, branchId: BRANCH_B });

    // BRANCH_A uses J00 (common cold) three times; BRANCH_B uses it once —
    // getRecentList scoped to BRANCH_B must never see BRANCH_A's count.
    for (let i = 0; i < 3; i++) {
      await visitDiagnosesService.addVisitDiagnosis(sequelize, { orderId: orderA, icdCode: 'J00', description: `Common cold visit ${i}` });
      // Each call needs a fresh order to avoid the duplicate-code rule within one visit.
      if (i < 2) {
        const nextOrder = uuid();
        await query(`INSERT INTO lis_test_orders (id, participant_id, status, branch_id, created_at) VALUES (:id, :pid, 'ordered', :branchId, NOW())`, { id: nextOrder, pid: participantA, branchId: BRANCH_A });
        orderA = nextOrder;
      }
    }
    await visitDiagnosesService.addVisitDiagnosis(sequelize, { orderId: orderB, icdCode: 'J00', description: 'Common cold' });
  });

  test('recent-list usage counts are scoped to the requesting branch', async () => {
    const recentA = await getRecentList(sequelize, { branchId: BRANCH_A, limit: 10 });
    const recentB = await getRecentList(sequelize, { branchId: BRANCH_B, limit: 10 });
    const j00A = recentA.find((r) => r.code === 'J00');
    const j00B = recentB.find((r) => r.code === 'J00');
    expect(j00A.usage_count).toBe(3);
    expect(j00B.usage_count).toBe(1);
  });

  test('search ranking\'s usage tier is also branch-scoped', async () => {
    const resultsA = await searchIcd10(sequelize, { q: 'cold', branchId: BRANCH_A });
    const j00 = resultsA.find((r) => r.code === 'J00');
    expect(j00.usage_count).toBe(3);
  });
});

describe('backfill idempotency', () => {
  test('running the backfill twice never creates duplicate rows for the same order', async () => {
    const participantId = uuid();
    await query(
      `INSERT INTO lis_participants (id, participant_number, first_name, last_name, branch_id, created_at)
       VALUES (:id, :num, 'Backfill', 'Test', :branchId, NOW())`,
      { id: participantId, num: `TP-${participantId.slice(0, 8)}`, branchId: BRANCH_A }
    );
    const orderId = uuid();
    await query(
      `INSERT INTO lis_test_orders (id, participant_id, status, branch_id, clinical_notes, created_at)
       VALUES (:id, :pid, 'closed', :branchId, 'Diagnosis: Pre-existing free text diagnosis', NOW())`,
      { id: orderId, pid: participantId, branchId: BRANCH_A }
    );

    const dryRun = await backfillVisitDiagnoses(sequelize, { apply: false });
    expect(dryRun.wouldInsert).toBeGreaterThanOrEqual(1);

    const first = await backfillVisitDiagnoses(sequelize, { apply: true });
    expect(first.inserted).toBeGreaterThanOrEqual(1);

    const [rowsAfterFirst] = await sequelize.query('SELECT COUNT(*)::int AS count FROM visit_diagnoses WHERE order_id = :id', { replacements: { id: orderId } });
    expect(rowsAfterFirst[0].count).toBe(1);

    const second = await backfillVisitDiagnoses(sequelize, { apply: true });
    const [rowsAfterSecond] = await sequelize.query('SELECT COUNT(*)::int AS count FROM visit_diagnoses WHERE order_id = :id', { replacements: { id: orderId } });
    expect(rowsAfterSecond[0].count).toBe(1); // still exactly one — the second run found it already present
  });
});
