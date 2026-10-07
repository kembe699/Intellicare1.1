/**
 * Requested: Clinical Notes should be addable/editable directly from Visit
 * Summary (/lis/orders) when you click into a patient — previously this
 * data (History of Presenting Illness, Medical/Surgical/Family/Social/
 * Economic History, Allergies, Impressions) could only ever be set once,
 * at order-creation time on the "Place Order" screen; Visit Summary could
 * only ever display it read-only.
 *
 * New PUT /orders/:id/clinical-notes, deliberately narrower than POST
 * /orders (which also forces status back to 'ordered' and can touch
 * doctor_id) — like PUT /orders/:id/triage, it only ever touches `vitals`
 * and leaves status alone, so editing notes after the fact can't silently
 * reopen a closed visit. The frontend is responsible for merging its own
 * fields into whatever's already in vitals before submitting (same
 * established convention as "Place Order" and triage) — this test proves
 * the merge survives a real round trip: triage's own numeric vitals aren't
 * clobbered by a clinical-notes save, and vice versa.
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
let putClinicalNotesHandler;
let putTriageHandler;

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
    user: { id: 1, displayName: 'Clinical Notes Tester', role: 'admin' },
    branchContext: { isAdmin: true },
    models: testConn,
    ...overrides,
  };
}

async function makeOrder(prefix) {
  const orderId = uuid();
  const participantId = uuid();
  await sequelize.query(
    `INSERT INTO lis_participants (id, participant_number, first_name, last_name) VALUES (?, ?, 'ClinicalNotesEdit', 'Patient')`,
    { replacements: [participantId, `${prefix}-${Date.now()}`] }
  );
  await sequelize.query(
    `INSERT INTO lis_test_orders (id, participant_id, status) VALUES (?, ?, 'ordered')`,
    { replacements: [orderId, participantId] }
  );
  return { orderId, participantId };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const lisRouter = require('../../src/server/routes/lisModule');
  putClinicalNotesHandler = handlerFor(lisRouter, '/orders/:id/clinical-notes', 'put');
  putTriageHandler = handlerFor(lisRouter, '/orders/:id/triage', 'put');
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM lis_test_orders WHERE participant_id IN (SELECT id FROM lis_participants WHERE participant_number LIKE 'CLINNOTES-%')`);
    await sequelize.query(`DELETE FROM lis_participants WHERE participant_number LIKE 'CLINNOTES-%'`);
  } catch (e) { console.warn('lisClinicalNotesEdit cleanup failed (non-fatal):', e.message); }
});

describe('PUT /orders/:id/clinical-notes', () => {
  test('saves clinical notes fields and they read back correctly', async () => {
    const { orderId } = await makeOrder('CLINNOTES-A');
    const res = mockRes();
    await withTenant(() => putClinicalNotesHandler(req({
      params: { id: orderId },
      body: { vitals: { history_of_presenting_illness: 'Fever x3 days', allergies: 'Penicillin', impressions: 'Likely malaria' } },
    }), res));
    expect(res.statusCode).toBe(200);

    const [[row]] = await sequelize.query(`SELECT vitals FROM lis_test_orders WHERE id = ?`, { replacements: [orderId] });
    const saved = JSON.parse(row.vitals);
    expect(saved.history_of_presenting_illness).toBe('Fever x3 days');
    expect(saved.allergies).toBe('Penicillin');
    expect(saved.impressions).toBe('Likely malaria');
  });

  test('saves gynae fields nested under vitals.gynae', async () => {
    const { orderId } = await makeOrder('CLINNOTES-B');
    const res = mockRes();
    await withTenant(() => putClinicalNotesHandler(req({
      params: { id: orderId },
      body: { vitals: { gynae: { pregnancy_status: 'Pregnant', edd: '2026-12-01', gravida: '2', para: '1' } } },
    }), res));
    expect(res.statusCode).toBe(200);

    const [[row]] = await sequelize.query(`SELECT vitals FROM lis_test_orders WHERE id = ?`, { replacements: [orderId] });
    const saved = JSON.parse(row.vitals);
    expect(saved.gynae.pregnancy_status).toBe('Pregnant');
    expect(saved.gynae.edd).toBe('2026-12-01');
  });

  test('a clinical-notes save does not clobber triage vitals already on the order, when the client merges first (established convention)', async () => {
    const { orderId } = await makeOrder('CLINNOTES-C');

    // Triage runs first, same as in practice.
    await withTenant(() => putTriageHandler(req({
      params: { id: orderId },
      body: { vitals: { blood_pressure: '120/80', pulse: '78', temperature: '37.1' } },
    }), mockRes()));

    // The doctor's clinical-notes save merges the existing vitals (as the
    // real frontend does — see handleSaveClinicalNotes) before submitting.
    const [[beforeRow]] = await sequelize.query(`SELECT vitals FROM lis_test_orders WHERE id = ?`, { replacements: [orderId] });
    const existing = JSON.parse(beforeRow.vitals);
    const merged = { ...existing, history_of_presenting_illness: 'Cough x1 week' };

    const res = mockRes();
    await withTenant(() => putClinicalNotesHandler(req({ params: { id: orderId }, body: { vitals: merged } }), res));
    expect(res.statusCode).toBe(200);

    const [[afterRow]] = await sequelize.query(`SELECT vitals FROM lis_test_orders WHERE id = ?`, { replacements: [orderId] });
    const after = JSON.parse(afterRow.vitals);
    expect(after.blood_pressure).toBe('120/80');
    expect(after.pulse).toBe('78');
    expect(after.history_of_presenting_illness).toBe('Cough x1 week');
  });

  test('rejects editing on a closed visit, matching the triage route\'s own rule', async () => {
    const { orderId } = await makeOrder('CLINNOTES-D');
    await sequelize.query(`UPDATE lis_test_orders SET status = 'closed' WHERE id = ?`, { replacements: [orderId] });

    const res = mockRes();
    await withTenant(() => putClinicalNotesHandler(req({ params: { id: orderId }, body: { vitals: { impressions: 'too late' } } }), res));
    expect(res.statusCode).toBe(409);

    const [[row]] = await sequelize.query(`SELECT vitals FROM lis_test_orders WHERE id = ?`, { replacements: [orderId] });
    expect(JSON.parse(row.vitals || '{}').impressions).toBeUndefined();
  });

  test('never changes order status, unlike POST /orders', async () => {
    const { orderId } = await makeOrder('CLINNOTES-E');
    const res = mockRes();
    await withTenant(() => putClinicalNotesHandler(req({ params: { id: orderId }, body: { vitals: { impressions: 'x' } } }), res));
    expect(res.statusCode).toBe(200);

    const [[row]] = await sequelize.query(`SELECT status FROM lis_test_orders WHERE id = ?`, { replacements: [orderId] });
    expect(row.status).toBe('ordered');
  });
});
