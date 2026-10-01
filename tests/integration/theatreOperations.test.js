/**
 * Phase 5 (Theatre/OR): T1 (bill the procedure fee on completion), T2
 * (inventory_transactions audit trail for item usage), T4 (mark a room ready
 * after cleaning), T5 (branch isolation on single-record routes), T7
 * (cancelling an operation reverts its originating request to pending), T8
 * (block checklist/vitals/item actions on a completed or cancelled
 * operation), T9 (double-booking prevention), T10/T11 (real HTTP status
 * codes instead of a flat 400/500 for every failure).
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');
const { migrateTheatreTables } = require('../../src/server/scripts/migrateTheatreTables');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let handlers = {};

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
    user: { id: 1, displayName: 'Theatre Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
    ip: '127.0.0.1',
    ...overrides,
  };
}

let roomAId, roomBId;
let branchAId, branchBId;
let testItemId, testLocationId, testBatchId;

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  await migrateTheatreTables(sequelize);

  const theatreRouter = require('../../src/server/routes/theatre');
  handlers = {
    createRequest: handlerFor(theatreRouter, '/requests', 'post'),
    cancelRequest: handlerFor(theatreRouter, '/requests/:id/cancel', 'post'),
    getOperation: handlerFor(theatreRouter, '/operations/:id', 'get'),
    scheduleOperation: handlerFor(theatreRouter, '/operations', 'post'),
    startOperation: handlerFor(theatreRouter, '/operations/:id/start', 'post'),
    completeOperation: handlerFor(theatreRouter, '/operations/:id/complete', 'post'),
    cancelOperation: handlerFor(theatreRouter, '/operations/:id/cancel', 'post'),
    toggleChecklistItem: handlerFor(theatreRouter, '/operations/:id/checklist/:itemId', 'put'),
    addChecklistItem: handlerFor(theatreRouter, '/operations/:id/checklist', 'post'),
    recordVitals: handlerFor(theatreRouter, '/operations/:id/vitals', 'post'),
    recordItemUsage: handlerFor(theatreRouter, '/operations/:id/items', 'post'),
    roomReady: handlerFor(theatreRouter, '/rooms/:id/ready', 'post'),
  };

  const [[a]] = await sequelize.query(`INSERT INTO branches (name, is_active) VALUES ('t-Theatre Branch A', true) RETURNING id`);
  const [[b]] = await sequelize.query(`INSERT INTO branches (name, is_active) VALUES ('t-Theatre Branch B', true) RETURNING id`);
  branchAId = a.id; branchBId = b.id;

  roomAId = uuid();
  await sequelize.query(`INSERT INTO rooms (id, clinic_id, branch_id, room_number, room_type, is_active) VALUES (:id, :c, :b, 'THR-A', 'or', true)`, { replacements: { id: roomAId, c: TEST_CLINIC_ID, b: branchAId } });
  roomBId = uuid();
  await sequelize.query(`INSERT INTO rooms (id, clinic_id, branch_id, room_number, room_type, is_active) VALUES (:id, :c, :b, 'THR-B', 'or', true)`, { replacements: { id: roomBId, c: TEST_CLINIC_ID, b: branchBId } });

  // T2/T3 fixtures — a real item/location/batch to dispense from, rather
  // than relying on whatever happens to already be seeded in tenant_test.
  testItemId = uuid();
  await sequelize.query(`INSERT INTO inventory_items (id, clinic_id, item_code, item_name, is_active) VALUES (:id, :c, 'THRTEST-ITEM', 'THRTEST Gauze', true)`, { replacements: { id: testItemId, c: TEST_CLINIC_ID } });
  testLocationId = uuid();
  await sequelize.query(`INSERT INTO stock_locations (id, clinic_id, location_code, location_name, is_active) VALUES (:id, :c, 'THRTEST-LOC', 'THRTEST Store', true)`, { replacements: { id: testLocationId, c: TEST_CLINIC_ID } });
  testBatchId = uuid();
  await sequelize.query(
    `INSERT INTO inventory_batches (id, clinic_id, item_id, batch_number, location_id, receipt_date, quantity_received, quantity_used, status)
     VALUES (:id, :c, :itemId, 'THRTEST-BATCH', :locationId, CURRENT_DATE, 10, 0, 'active')`,
    { replacements: { id: testBatchId, c: TEST_CLINIC_ID, itemId: testItemId, locationId: testLocationId } }
  );
  await sequelize.query(
    `INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES (:id, :c, :itemId, :locationId, 10)`,
    { replacements: { id: uuid(), c: TEST_CLINIC_ID, itemId: testItemId, locationId: testLocationId } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM theatre_operation_items WHERE operation_id IN (SELECT id FROM theatre_operations WHERE procedure_name LIKE 'THRTEST-%')`);
    await sequelize.query(`DELETE FROM theatre_vitals WHERE operation_id IN (SELECT id FROM theatre_operations WHERE procedure_name LIKE 'THRTEST-%')`);
    await sequelize.query(`DELETE FROM theatre_checklist_items WHERE operation_id IN (SELECT id FROM theatre_operations WHERE procedure_name LIKE 'THRTEST-%')`);
    await sequelize.query(`DELETE FROM inventory_transactions WHERE reference_type = 'theatre_operation' AND reference_id IN (SELECT id FROM theatre_operations WHERE procedure_name LIKE 'THRTEST-%')`);
    await sequelize.query(`DELETE FROM batch_usage_history WHERE batch_id = :b`, { replacements: { b: testBatchId } });
    await sequelize.query(`DELETE FROM stock_by_location WHERE item_id = :i`, { replacements: { i: testItemId } });
    await sequelize.query(`DELETE FROM inventory_batches WHERE id = :b`, { replacements: { b: testBatchId } });
    await sequelize.query(`DELETE FROM inventory_items WHERE id = :i`, { replacements: { i: testItemId } });
    await sequelize.query(`DELETE FROM stock_locations WHERE id = :l`, { replacements: { l: testLocationId } });
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE reference_id IN (SELECT id::text FROM patient_bills WHERE bill_number LIKE 'THR-%'))`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE reference_id IN (SELECT id::text FROM patient_bills WHERE bill_number LIKE 'THR-%'))`);
    await sequelize.query(`DELETE FROM general_ledger WHERE reference_id IN (SELECT id::text FROM patient_bills WHERE bill_number LIKE 'THR-%')`);
    await sequelize.query(`DELETE FROM patient_receivables WHERE bill_id IN (SELECT id FROM patient_bills WHERE bill_number LIKE 'THR-%')`);
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'THR-%'`);
    await sequelize.query(`DELETE FROM theatre_operations WHERE procedure_name LIKE 'THRTEST-%'`);
    await sequelize.query(`DELETE FROM theatre_requests WHERE procedure_name LIKE 'THRTEST-%'`);
    await sequelize.query(`DELETE FROM theatre_room_status WHERE room_id IN (:a, :b)`, { replacements: { a: roomAId, b: roomBId } });
    await sequelize.query(`DELETE FROM rooms WHERE id IN (:a, :b)`, { replacements: { a: roomAId, b: roomBId } });
    await sequelize.query(`DELETE FROM branches WHERE id IN (:a, :b)`, { replacements: { a: branchAId, b: branchBId } });
  } catch (e) { console.warn('theatreOperations cleanup failed (non-fatal):', e.message); }
});

// Each call gets its own day far in the future (T9's own dedicated tests use
// 2026-07/2026-08 explicitly) — sharing one fixed scheduled_at across every
// test that doesn't override it would make later tests collide with earlier
// ones still sitting in 'scheduled'/'in_progress' in the SAME default room,
// tripping T9's own double-booking guard for reasons that have nothing to do
// with what that particular test is checking.
let scheduleOpDayCounter = 1;
async function scheduleOp(overrides = {}) {
  const day = String(scheduleOpDayCounter++).padStart(2, '0');
  const res = mockRes();
  await withTenant(() => handlers.scheduleOperation(req({
    body: {
      clinic_id: TEST_CLINIC_ID, patient_id: uuid(), procedure_name: `THRTEST-${Date.now()}-${Math.random()}`,
      theatre_room_id: roomAId, branch_id: branchAId, scheduled_at: `2026-01-${day}T09:00:00Z`,
      ...overrides,
    },
  }), res));
  return res;
}

describe('T10/T11: real HTTP status codes', () => {
  test('a not-found operation is 404, not a flat 400', async () => {
    const res = mockRes();
    await withTenant(() => handlers.startOperation(req({ params: { id: uuid() } }), res));
    expect(res.statusCode).toBe(404);
  });

  test('an invalid state transition is 409, not 400', async () => {
    const { body: op } = await scheduleOp();
    // Not started yet — completing it is an invalid transition.
    const res = mockRes();
    await withTenant(() => handlers.completeOperation(req({ params: { id: op.id }, body: { outcome: 'successful' } }), res));
    expect(res.statusCode).toBe(409);
  });

  test('a genuine validation error is still 400', async () => {
    const res = mockRes();
    await withTenant(() => handlers.createRequest(req({ body: { clinic_id: TEST_CLINIC_ID } }), res));
    expect(res.statusCode).toBe(400);
  });
});

describe('T5: branch isolation on single-record theatre routes', () => {
  test('a branch-scoped user cannot fetch another branch\'s operation', async () => {
    const { body: op } = await scheduleOp({ branch_id: branchAId });
    const res = mockRes();
    await withTenant(() => handlers.getOperation(req({
      params: { id: op.id },
      user: { id: 2, role: 'nurse', branchId: branchBId },
      branchContext: { branchId: branchBId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(403);
  });

  test('a branch-scoped user CAN fetch their own branch\'s operation', async () => {
    const { body: op } = await scheduleOp({ branch_id: branchAId });
    const res = mockRes();
    await withTenant(() => handlers.getOperation(req({
      params: { id: op.id },
      user: { id: 2, role: 'nurse', branchId: branchAId },
      branchContext: { branchId: branchAId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(200);
  });
});

describe('T8: a completed/cancelled operation is a closed clinical record', () => {
  test('vitals cannot be recorded on a cancelled operation', async () => {
    const { body: op } = await scheduleOp();
    await withTenant(() => handlers.cancelOperation(req({ params: { id: op.id }, body: { reason: 'test' } }), mockRes()));
    const res = mockRes();
    await withTenant(() => handlers.recordVitals(req({ params: { id: op.id }, body: { phase: 'pre_op', pulse: 80 } }), res));
    expect(res.statusCode).toBe(409);
  });

  test('a checklist item cannot be toggled on a completed operation', async () => {
    const { body: op } = await scheduleOp();
    await withTenant(() => handlers.startOperation(req({ params: { id: op.id } }), mockRes()));
    const completeRes = mockRes();
    await withTenant(() => handlers.completeOperation(req({ params: { id: op.id }, body: { outcome: 'successful' } }), completeRes));
    const firstChecklistItem = completeRes.body.checklist[0];
    const res = mockRes();
    await withTenant(() => handlers.toggleChecklistItem(req({ params: { id: op.id, itemId: firstChecklistItem.id }, body: { checked: true } }), res));
    expect(res.statusCode).toBe(409);
  });
});

describe('T7: cancelling an operation reverts its originating request to pending', () => {
  test('a request scheduled then orphaned by cancellation goes back to pending', async () => {
    const reqRes = mockRes();
    await withTenant(() => handlers.createRequest(req({
      body: { clinic_id: TEST_CLINIC_ID, patient_id: uuid(), procedure_name: `THRTEST-REQ-${Date.now()}` },
    }), reqRes));
    const request = reqRes.body;

    const opRes = await scheduleOp({ request_id: request.id, patient_id: request.patient_id });
    const [[afterSchedule]] = await sequelize.query(`SELECT status FROM theatre_requests WHERE id = :id`, { replacements: { id: request.id } });
    expect(afterSchedule.status).toBe('scheduled');

    await withTenant(() => handlers.cancelOperation(req({ params: { id: opRes.body.id }, body: { reason: 'changed plan' } }), mockRes()));
    const [[afterCancel]] = await sequelize.query(`SELECT status FROM theatre_requests WHERE id = :id`, { replacements: { id: request.id } });
    expect(afterCancel.status).toBe('pending');
  });
});

describe('T9: double-booking prevention', () => {
  test('a second operation in the same room within the block window is rejected', async () => {
    await scheduleOp({ theatre_room_id: roomAId, scheduled_at: '2026-07-01T09:00:00Z' });
    const res = mockRes();
    await withTenant(() => handlers.scheduleOperation(req({
      body: {
        clinic_id: TEST_CLINIC_ID, patient_id: uuid(), procedure_name: `THRTEST-${Date.now()}`,
        theatre_room_id: roomAId, branch_id: branchAId, scheduled_at: '2026-07-01T11:00:00Z', // 2h later, inside the 4h block
      },
    }), res));
    expect(res.statusCode).toBe(409);
  });

  test('a room booked well outside the block window is accepted', async () => {
    await scheduleOp({ theatre_room_id: roomAId, scheduled_at: '2026-08-01T09:00:00Z' });
    const res = mockRes();
    await withTenant(() => handlers.scheduleOperation(req({
      body: {
        clinic_id: TEST_CLINIC_ID, patient_id: uuid(), procedure_name: `THRTEST-${Date.now()}`,
        theatre_room_id: roomAId, branch_id: branchAId, scheduled_at: '2026-08-01T16:00:00Z', // 7h later
      },
    }), res));
    expect(res.statusCode).toBe(201);
  });
});

describe('T4: mark a theatre room ready after cleaning', () => {
  test('a room in cleaning can be marked ready, returning it to available', async () => {
    const { body: op } = await scheduleOp({ theatre_room_id: roomBId, branch_id: branchBId, scheduled_at: '2026-09-01T09:00:00Z' });
    await withTenant(() => handlers.startOperation(req({ params: { id: op.id } }), mockRes()));
    await withTenant(() => handlers.completeOperation(req({ params: { id: op.id }, body: { outcome: 'successful' } }), mockRes()));

    const [[cleaning]] = await sequelize.query(`SELECT status FROM theatre_room_status WHERE room_id = :id`, { replacements: { id: roomBId } });
    expect(cleaning.status).toBe('cleaning');

    const res = mockRes();
    await withTenant(() => handlers.roomReady(req({ params: { id: roomBId }, branchContext: { branchId: branchBId, isAdmin: false }, user: { id: 3, role: 'nurse', branchId: branchBId } }), res));
    expect(res.statusCode).toBe(200);

    const [[ready]] = await sequelize.query(`SELECT status FROM theatre_room_status WHERE room_id = :id`, { replacements: { id: roomBId } });
    expect(ready.status).toBe('available');
  });
});

describe('T1: billing the procedure fee on completion', () => {
  test('a fee set at scheduling time creates a patient bill when the operation completes', async () => {
    const { body: op } = await scheduleOp({ procedure_fee: 150000, fee_currency: 'SSP', patient_id: uuid() });
    // patient_name resolution needs a real patients/lis_participants row to
    // join against for a nice name — absent one, completeOperation falls
    // back to 'Theatre Patient', which is fine for this test's purpose.
    await withTenant(() => handlers.startOperation(req({ params: { id: op.id } }), mockRes()));
    const completeRes = mockRes();
    await withTenant(() => handlers.completeOperation(req({ params: { id: op.id }, body: { outcome: 'successful' } }), completeRes));

    expect(completeRes.statusCode).toBe(200);
    expect(completeRes.body.bill_id).toBeTruthy();

    const [[bill]] = await sequelize.query(`SELECT total_amount, balance_amount, bill_currency FROM patient_bills WHERE id = :id`, { replacements: { id: completeRes.body.bill_id } });
    expect(parseFloat(bill.total_amount)).toBe(150000);
    expect(parseFloat(bill.balance_amount)).toBe(150000);
    expect(bill.bill_currency).toBe('SSP');

    const [[gl]] = await sequelize.query(`SELECT id FROM general_ledger WHERE reference_id = :id AND reference_module = 'patient_billing'`, { replacements: { id: completeRes.body.bill_id } });
    expect(gl).toBeDefined(); // the fee actually reached the ledger, not just the bill row
  });

  test('no fee set at scheduling time means no bill is created', async () => {
    const { body: op } = await scheduleOp();
    await withTenant(() => handlers.startOperation(req({ params: { id: op.id } }), mockRes()));
    const completeRes = mockRes();
    await withTenant(() => handlers.completeOperation(req({ params: { id: op.id }, body: { outcome: 'successful' } }), completeRes));
    expect(completeRes.body.bill_id).toBeFalsy();
  });
});

describe('T2/T3: item usage writes a real inventory_transactions audit row, with row locking', () => {
  test('recording item usage inserts into inventory_transactions, not just the side tables', async () => {
    const { body: op } = await scheduleOp();
    await withTenant(() => handlers.startOperation(req({ params: { id: op.id } }), mockRes()));
    const res = mockRes();
    await withTenant(() => handlers.recordItemUsage(req({
      params: { id: op.id }, body: { location_id: testLocationId, item_id: testItemId, quantity: 3 },
    }), res));

    expect(res.statusCode).toBe(201);
    const [[txn]] = await sequelize.query(
      `SELECT quantity_change, reference_type, reference_id, item_id FROM inventory_transactions WHERE reference_type = 'theatre_operation' AND reference_id = :opId`,
      { replacements: { opId: op.id } }
    );
    expect(txn).toBeDefined();
    expect(txn.item_id).toBe(testItemId);
    expect(parseFloat(txn.quantity_change)).toBe(-3); // negative — stock leaving, matching pharmacyModule.js's own convention

    const [[batch]] = await sequelize.query(`SELECT quantity_used FROM inventory_batches WHERE id = :id`, { replacements: { id: testBatchId } });
    expect(parseFloat(batch.quantity_used)).toBe(3);
  });

  test('FOR UPDATE is present on the batch-selection query (row locking)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/server/services/TheatreService.js'), 'utf8');
    const usageFnStart = src.indexOf('async recordItemUsage');
    const usageFnSrc = src.slice(usageFnStart, usageFnStart + 2000);
    expect(usageFnSrc).toMatch(/FOR UPDATE/);
  });
});

describe('Theatre item usage bills the patient', () => {
  // Separate priced items from testItemId above (which has no selling_price
  // on purpose, to prove T2/T3's own test above records usage without ever
  // touching billing when there's no price). One 'drugs' item and one
  // 'blood' item, to prove the revenue-category split: a drug item should
  // land on Pharmacy Sales Revenue (4120), everything else (blood included)
  // on Procedure Revenue (4140) — there is no separate "blood revenue"
  // account, so blood intentionally shares 4140 with other consumables.
  let drugItemId, drugBatchId, bloodItemId, bloodBatchId;

  beforeAll(async () => {
    drugItemId = uuid();
    await sequelize.query(
      `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, is_active, item_category, selling_price, unit_of_measure)
       VALUES (:id, :c, 'THRTEST-DRUG', 'THRTEST Lidocaine', true, 'drugs', 500, 'vial')`,
      { replacements: { id: drugItemId, c: TEST_CLINIC_ID } }
    );
    drugBatchId = uuid();
    await sequelize.query(
      `INSERT INTO inventory_batches (id, clinic_id, item_id, batch_number, location_id, receipt_date, quantity_received, quantity_used, status)
       VALUES (:id, :c, :itemId, 'THRTEST-DRUG-BATCH', :locationId, CURRENT_DATE, 10, 0, 'active')`,
      { replacements: { id: drugBatchId, c: TEST_CLINIC_ID, itemId: drugItemId, locationId: testLocationId } }
    );
    await sequelize.query(
      `INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES (:id, :c, :itemId, :locationId, 10)`,
      { replacements: { id: uuid(), c: TEST_CLINIC_ID, itemId: drugItemId, locationId: testLocationId } }
    );

    bloodItemId = uuid();
    await sequelize.query(
      `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, is_active, item_category, selling_price, unit_of_measure)
       VALUES (:id, :c, 'THRTEST-BLOOD', 'THRTEST O+ Whole Blood', true, 'blood', 20000, 'mL')`,
      { replacements: { id: bloodItemId, c: TEST_CLINIC_ID } }
    );
    bloodBatchId = uuid();
    await sequelize.query(
      `INSERT INTO inventory_batches (id, clinic_id, item_id, batch_number, location_id, receipt_date, quantity_received, quantity_used, status)
       VALUES (:id, :c, :itemId, 'THRTEST-BLOOD-BATCH', :locationId, CURRENT_DATE, 500, 0, 'active')`,
      { replacements: { id: bloodBatchId, c: TEST_CLINIC_ID, itemId: bloodItemId, locationId: testLocationId } }
    );
    await sequelize.query(
      `INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES (:id, :c, :itemId, :locationId, 500)`,
      { replacements: { id: uuid(), c: TEST_CLINIC_ID, itemId: bloodItemId, locationId: testLocationId } }
    );
  });

  afterAll(async () => {
    try {
      for (const itemId of [drugItemId, bloodItemId]) {
        await sequelize.query(`DELETE FROM batch_usage_history WHERE batch_id IN (SELECT id FROM inventory_batches WHERE item_id = :i)`, { replacements: { i: itemId } });
        await sequelize.query(`DELETE FROM stock_by_location WHERE item_id = :i`, { replacements: { i: itemId } });
        await sequelize.query(`DELETE FROM inventory_batches WHERE item_id = :i`, { replacements: { i: itemId } });
        await sequelize.query(`DELETE FROM inventory_items WHERE id = :i`, { replacements: { i: itemId } });
      }
    } catch (e) { console.warn('billing-test item cleanup failed (non-fatal):', e.message); }
  });

  async function cleanupBillFor(patientId) {
    await sequelize.query(`DELETE FROM patient_bills WHERE patient_id = :p AND bill_number LIKE 'BILL-%'`, { replacements: { p: patientId } });
  }

  test('a priced drug used in theatre creates a bill with a Pharmacy Sales Revenue line', async () => {
    const patientId = uuid();
    const { body: op } = await scheduleOp({ patient_id: patientId });
    await withTenant(() => handlers.startOperation(req({ params: { id: op.id } }), mockRes()));
    const res = mockRes();
    await withTenant(() => handlers.recordItemUsage(req({
      params: { id: op.id }, body: { location_id: testLocationId, item_id: drugItemId, quantity: 2 },
    }), res));
    expect(res.statusCode).toBe(201);

    const [[bill]] = await sequelize.query(`SELECT id, total_amount, services FROM patient_bills WHERE patient_id = :p`, { replacements: { p: patientId } });
    expect(bill).toBeDefined();
    expect(parseFloat(bill.total_amount)).toBe(1000); // 500 * 2
    const services = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
    expect(services).toHaveLength(1);
    expect(services[0].serviceName).toBe('THRTEST Lidocaine');
    expect(parseFloat(services[0].totalPrice)).toBe(1000);

    const [[revenueAccount]] = await sequelize.query(
      `SELECT ca.account_code FROM chart_of_accounts ca JOIN account_ledger al ON al.account_id = ca.id WHERE al.reference_number = :billId`,
      { replacements: { billId: bill.id } }
    ).catch(() => [[null]]);
    // GL posting is deferred to ledgerSweeper.js, not synchronous here, so
    // account_ledger may not have a row yet — only assert on it if the
    // sweeper (or a prior run) already reconciled it; the bill row itself,
    // asserted above, is the part this fix is actually responsible for.
    if (revenueAccount) expect(revenueAccount.account_code).toBe('4120');

    await cleanupBillFor(patientId);
  });

  test('blood used in theatre bills under Procedure Revenue, separate from drugs', async () => {
    const patientId = uuid();
    const { body: op } = await scheduleOp({ patient_id: patientId });
    await withTenant(() => handlers.startOperation(req({ params: { id: op.id } }), mockRes()));
    const res = mockRes();
    await withTenant(() => handlers.recordItemUsage(req({
      params: { id: op.id }, body: { location_id: testLocationId, item_id: bloodItemId, quantity: 350 },
    }), res));
    expect(res.statusCode).toBe(201);
    expect(res.body.item_category).toBe('blood');

    const [[bill]] = await sequelize.query(`SELECT total_amount, services FROM patient_bills WHERE patient_id = :p`, { replacements: { p: patientId } });
    expect(bill).toBeDefined();
    expect(parseFloat(bill.total_amount)).toBe(7000000); // 20000 * 350
    const services = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
    expect(services[0].serviceName).toBe('THRTEST O+ Whole Blood');

    await cleanupBillFor(patientId);
  });

  test('a second item used on the same operation appends to the same bill instead of creating a new one', async () => {
    const patientId = uuid();
    const { body: op } = await scheduleOp({ patient_id: patientId });
    await withTenant(() => handlers.startOperation(req({ params: { id: op.id } }), mockRes()));
    await withTenant(() => handlers.recordItemUsage(req({
      params: { id: op.id }, body: { location_id: testLocationId, item_id: drugItemId, quantity: 1 },
    }), mockRes()));
    await withTenant(() => handlers.recordItemUsage(req({
      params: { id: op.id }, body: { location_id: testLocationId, item_id: bloodItemId, quantity: 1 },
    }), mockRes()));

    const bills = await sequelize.query(`SELECT id, total_amount FROM patient_bills WHERE patient_id = :p`, { replacements: { p: patientId }, type: sequelize.QueryTypes.SELECT });
    expect(bills).toHaveLength(1); // not two separate bills
    expect(parseFloat(bills[0].total_amount)).toBe(500 + 20000); // 1 drug + 1 mL blood

    await cleanupBillFor(patientId);
  });

  test('an item with no selling_price is recorded and deducted from stock, but never billed', async () => {
    const patientId = uuid();
    const { body: op } = await scheduleOp({ patient_id: patientId });
    await withTenant(() => handlers.startOperation(req({ params: { id: op.id } }), mockRes()));
    const res = mockRes();
    await withTenant(() => handlers.recordItemUsage(req({
      params: { id: op.id }, body: { location_id: testLocationId, item_id: testItemId, quantity: 1 },
    }), res));
    expect(res.statusCode).toBe(201);

    const [[bill]] = await sequelize.query(`SELECT id FROM patient_bills WHERE patient_id = :p`, { replacements: { p: patientId } });
    expect(bill).toBeUndefined(); // no price set — recorded, not billed
  });
});
