/**
 * Security/data-integrity audit findings, both confirmed by reading the full
 * handlers:
 *
 * 1. POST /adjustments/:id/approve did `UPDATE inventory_items SET
 *    quantity_on_hand = :physical_count` unconditionally — for a
 *    location-specific physical count (adjustment.location_id set), this
 *    OVERWROTE the item's whole-clinic total with just that one location's
 *    count, silently discarding every other location's stock. Item with 50
 *    at Pharmacy-A and 30 at Pharmacy-B (total 80): counting Pharmacy-A at
 *    48 (variance -2) used to set the item's total to 48, erasing
 *    Pharmacy-B's 30 units.
 *
 * 2. POST /transactions with transaction_type: 'transfer' clamped the source
 *    location's stock with GREATEST(0, quantity_on_hand - qty) — silently
 *    absorbing any shortfall — while unconditionally crediting the
 *    destination the FULL requested quantity regardless of what the source
 *    actually had. Transferring 20 units from a location that only has 5
 *    used to leave the source at 0 (losing only 5) while the destination
 *    gained the full 20 — a net +15 units conjured for the clinic.
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
    user: { id: 1, displayName: 'Inventory Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    ...overrides,
  };
}

async function makeItem(code) {
  const id = uuid();
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, is_active, quantity_on_hand) VALUES (:id, :c, :code, :code, true, 0)`,
    { replacements: { id, c: TEST_CLINIC_ID, code } }
  );
  return id;
}

async function makeLocation(code) {
  const id = uuid();
  await sequelize.query(
    `INSERT INTO stock_locations (id, clinic_id, location_code, location_name, is_active) VALUES (:id, :c, :code, :code, true)`,
    { replacements: { id, c: TEST_CLINIC_ID, code } }
  );
  return id;
}

async function setStock(itemId, locationId, qty) {
  await sequelize.query(
    `INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES (:id, :c, :itemId, :locId, :qty)
     ON CONFLICT DO NOTHING`,
    { replacements: { id: uuid(), c: TEST_CLINIC_ID, itemId, locId: locationId, qty } }
  );
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const inventoryRouter = require('../../src/server/routes/inventory');
  handlers = {
    createTransaction: handlerFor(inventoryRouter, '/transactions', 'post'),
    approveAdjustment: handlerFor(inventoryRouter, '/adjustments/:id/approve', 'post'),
  };
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM inventory_transactions WHERE item_id IN (SELECT id FROM inventory_items WHERE item_code LIKE 'INVTEST-%')`);
    await sequelize.query(`DELETE FROM inventory_adjustments WHERE item_id IN (SELECT id FROM inventory_items WHERE item_code LIKE 'INVTEST-%')`);
    await sequelize.query(`DELETE FROM stock_by_location WHERE item_id IN (SELECT id FROM inventory_items WHERE item_code LIKE 'INVTEST-%')`);
    await sequelize.query(`DELETE FROM inventory_items WHERE item_code LIKE 'INVTEST-%'`);
    await sequelize.query(`DELETE FROM stock_locations WHERE location_code LIKE 'INVTEST-%'`);
  } catch (e) { console.warn('inventoryStockIntegrity cleanup failed (non-fatal):', e.message); }
});

describe('Adjustment approval only changes the item total by the variance at that location', () => {
  test('counting one location does not erase stock recorded at other locations', async () => {
    const itemId = await makeItem(`INVTEST-ADJ-${Date.now()}`);
    const locA = await makeLocation(`INVTEST-A-${Date.now()}`);
    const locB = await makeLocation(`INVTEST-B-${Date.now()}`);
    await setStock(itemId, locA, 50);
    await setStock(itemId, locB, 30);
    await sequelize.query(`UPDATE inventory_items SET quantity_on_hand = 80 WHERE id = :id`, { replacements: { id: itemId } });

    const adjId = uuid();
    await sequelize.query(
      `INSERT INTO inventory_adjustments (id, clinic_id, adjustment_number, item_id, location_id, system_quantity, physical_count, variance, approval_status)
       VALUES (:id, :c, :num, :itemId, :locId, 50, 48, -2, 'pending')`,
      { replacements: { id: adjId, c: TEST_CLINIC_ID, num: `INVTEST-ADJ-${Date.now()}`, itemId, locId: locA } }
    );

    const res = mockRes();
    await withTenant(() => handlers.approveAdjustment(req({ params: { id: adjId }, body: { approved_by: 'tester' } }), res));
    expect(res.statusCode).toBe(200);

    const [[item]] = await sequelize.query(`SELECT quantity_on_hand FROM inventory_items WHERE id = :id`, { replacements: { id: itemId } });
    expect(parseFloat(item.quantity_on_hand)).toBe(78); // 80 - 2, not 48

    const [[sblA]] = await sequelize.query(`SELECT quantity_on_hand FROM stock_by_location WHERE item_id = :id AND location_id = :loc`, { replacements: { id: itemId, loc: locA } });
    expect(parseFloat(sblA.quantity_on_hand)).toBe(48);
    const [[sblB]] = await sequelize.query(`SELECT quantity_on_hand FROM stock_by_location WHERE item_id = :id AND location_id = :loc`, { replacements: { id: itemId, loc: locB } });
    expect(parseFloat(sblB.quantity_on_hand)).toBe(30); // untouched
  });

  test('a whole-item count with no location still sets the total directly (no per-location breakdown to preserve)', async () => {
    const itemId = await makeItem(`INVTEST-ADJ2-${Date.now()}`);
    await sequelize.query(`UPDATE inventory_items SET quantity_on_hand = 10 WHERE id = :id`, { replacements: { id: itemId } });

    const adjId = uuid();
    await sequelize.query(
      `INSERT INTO inventory_adjustments (id, clinic_id, adjustment_number, item_id, location_id, system_quantity, physical_count, variance, approval_status)
       VALUES (:id, :c, :num, :itemId, NULL, 10, 7, -3, 'pending')`,
      { replacements: { id: adjId, c: TEST_CLINIC_ID, num: `INVTEST-ADJ2-${Date.now()}`, itemId } }
    );

    const res = mockRes();
    await withTenant(() => handlers.approveAdjustment(req({ params: { id: adjId }, body: {} }), res));
    expect(res.statusCode).toBe(200);

    const [[item]] = await sequelize.query(`SELECT quantity_on_hand FROM inventory_items WHERE id = :id`, { replacements: { id: itemId } });
    expect(parseFloat(item.quantity_on_hand)).toBe(7);
  });
});

describe('Inventory transfers cannot create stock out of thin air', () => {
  test('rejects a transfer that exceeds the source location\'s actual stock', async () => {
    const itemId = await makeItem(`INVTEST-XFER-${Date.now()}`);
    const locA = await makeLocation(`INVTEST-XA-${Date.now()}`);
    const locB = await makeLocation(`INVTEST-XB-${Date.now()}`);
    await setStock(itemId, locA, 5);
    await setStock(itemId, locB, 0);

    const res = mockRes();
    await withTenant(() => handlers.createTransaction(req({
      body: { item_id: itemId, transaction_type: 'transfer', quantity_change: -20, from_location_id: locA, to_location_id: locB },
    }), res));
    expect(res.statusCode).toBe(409);

    const [[sblA]] = await sequelize.query(`SELECT quantity_on_hand FROM stock_by_location WHERE item_id = :id AND location_id = :loc`, { replacements: { id: itemId, loc: locA } });
    expect(parseFloat(sblA.quantity_on_hand)).toBe(5); // untouched
    const [[sblB]] = await sequelize.query(`SELECT quantity_on_hand FROM stock_by_location WHERE item_id = :id AND location_id = :loc`, { replacements: { id: itemId, loc: locB } });
    expect(parseFloat(sblB.quantity_on_hand)).toBe(0); // untouched — no stock conjured
  });

  test('a transfer within the available amount moves stock correctly, 1:1', async () => {
    const itemId = await makeItem(`INVTEST-XFER2-${Date.now()}`);
    const locA = await makeLocation(`INVTEST-XA2-${Date.now()}`);
    const locB = await makeLocation(`INVTEST-XB2-${Date.now()}`);
    await setStock(itemId, locA, 10);
    await setStock(itemId, locB, 0);

    const res = mockRes();
    await withTenant(() => handlers.createTransaction(req({
      body: { item_id: itemId, transaction_type: 'transfer', quantity_change: -6, from_location_id: locA, to_location_id: locB },
    }), res));
    expect(res.statusCode).toBe(201);

    const [[sblA]] = await sequelize.query(`SELECT quantity_on_hand FROM stock_by_location WHERE item_id = :id AND location_id = :loc`, { replacements: { id: itemId, loc: locA } });
    expect(parseFloat(sblA.quantity_on_hand)).toBe(4);
    const [[sblB]] = await sequelize.query(`SELECT quantity_on_hand FROM stock_by_location WHERE item_id = :id AND location_id = :loc`, { replacements: { id: itemId, loc: locB } });
    expect(parseFloat(sblB.quantity_on_hand)).toBe(6);
  });
});
