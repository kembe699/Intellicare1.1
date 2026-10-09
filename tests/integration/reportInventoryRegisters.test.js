/**
 * Inventory Reports' new register endpoints (Stock Movement, Fast/Slow
 * Moving, Retired Batches, Near/Stock Expiry, Stock Valuation by Location,
 * Out of Stock, Below Reorder Level, Material Consumption) — proves each
 * pulls from the right table/columns against real seeded data, not just
 * that the SQL doesn't throw.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const SUFFIX = `INVREG-${Date.now()}`;

let sequelize;
let testConn;
let router;
let branchId;
let item1; // fast-moving, below reorder (qty 2, min 10)
let item2; // slow-moving, well-stocked, has a stock_by_location row
let locId;
let locId2;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function handlerFor(routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(query) {
  return { query, user: { id: 1, role: 'admin', clinicId: 1 }, branchContext: { isAdmin: true } };
}

async function run(path, query) {
  const handler = handlerFor(path, 'get');
  const res = mockRes();
  await withTenant(() => handler(req(query), res));
  return res;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  router = require('../../src/server/routes/reportInventory');

  const [[branch]] = await sequelize.query(`INSERT INTO branches (facility_id, name, is_active) VALUES (1, :name, true) RETURNING id`, { replacements: { name: `${SUFFIX} Branch` } });
  branchId = branch.id;

  item1 = uuid();
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, item_category, quantity_on_hand, minimum_stock_level, average_unit_cost, is_active, branch_id)
     VALUES (:id, 1, :code, :name, 'drugs', 2, 10, 500, true, :branchId)`,
    { replacements: { id: item1, code: `${SUFFIX}-FM`, name: `${SUFFIX} Fast Mover`, branchId } }
  );
  item2 = uuid();
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, item_category, quantity_on_hand, minimum_stock_level, average_unit_cost, is_active, branch_id)
     VALUES (:id, 1, :code, :name, 'supplies', 100, 10, 50, true, :branchId)`,
    { replacements: { id: item2, code: `${SUFFIX}-SM`, name: `${SUFFIX} Slow Mover`, branchId } }
  );

  await sequelize.query(
    `INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type, quantity_change, unit_cost, total_cost, cost_currency, transaction_date, branch_id)
     VALUES (:id, 1, :tn, :itemId, 'dispense', -8, 500, 4000, 'SSP', CURRENT_DATE, :branchId)`,
    { replacements: { id: uuid(), tn: `${SUFFIX}-TX1`, itemId: item1, branchId } }
  );
  await sequelize.query(
    `INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type, quantity_change, unit_cost, total_cost, cost_currency, transaction_date, branch_id)
     VALUES (:id, 1, :tn, :itemId, 'damage', -5, 500, 2500, 'SSP', CURRENT_DATE, :branchId)`,
    { replacements: { id: uuid(), tn: `${SUFFIX}-TXDAMAGE`, itemId: item1, branchId } }
  );

  const [[loc]] = await sequelize.query(`INSERT INTO stock_locations (id, clinic_id, location_code, location_name, branch_id) VALUES (:id, 1, :code, :name, :branchId) RETURNING id`, { replacements: { id: uuid(), code: `${SUFFIX}-LOC`, name: `${SUFFIX} Store`, branchId } });
  locId = loc.id;
  const [[loc2]] = await sequelize.query(`INSERT INTO stock_locations (id, clinic_id, location_code, location_name, branch_id) VALUES (:id, 1, :code, :name, :branchId) RETURNING id`, { replacements: { id: uuid(), code: `${SUFFIX}-LOC2`, name: `${SUFFIX} Store 2`, branchId } });
  locId2 = loc2.id;
  await sequelize.query(`INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand) VALUES (:id, 1, :itemId, :locId, 50)`, { replacements: { id: uuid(), itemId: item2, locId } });
  await sequelize.query(
    `INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type, quantity_change, from_location_id, to_location_id, unit_cost, total_cost, cost_currency, transaction_date, branch_id)
     VALUES (:id, 1, :tn, :itemId, 'transfer', 10, :locId, :locId2, 50, 500, 'SSP', CURRENT_DATE, :branchId)`,
    { replacements: { id: uuid(), tn: `${SUFFIX}-TX2`, itemId: item2, locId, locId2, branchId } }
  );

  await sequelize.query(
    `INSERT INTO inventory_batches (id, clinic_id, item_id, batch_number, receipt_date, quantity_received, quantity_used, status, branch_id)
     VALUES (:id, 1, :itemId, :bn, CURRENT_DATE - 60, 100, 100, 'retired', :branchId)`,
    { replacements: { id: uuid(), itemId: item1, bn: `${SUFFIX}-RETIRED`, branchId } }
  );
  await sequelize.query(
    `INSERT INTO inventory_batches (id, clinic_id, item_id, batch_number, receipt_date, quantity_received, quantity_used, expiry_date, status, branch_id)
     VALUES (:id, 1, :itemId, :bn, CURRENT_DATE - 10, 50, 10, CURRENT_DATE + 20, 'active', :branchId)`,
    { replacements: { id: uuid(), itemId: item1, bn: `${SUFFIX}-NEAREXP`, branchId } }
  );
  await sequelize.query(
    `INSERT INTO inventory_batches (id, clinic_id, item_id, batch_number, receipt_date, quantity_received, quantity_used, expiry_date, is_expired, status, branch_id)
     VALUES (:id, 1, :itemId, :bn, CURRENT_DATE - 100, 30, 5, CURRENT_DATE - 5, true, 'active', :branchId)`,
    { replacements: { id: uuid(), itemId: item1, bn: `${SUFFIX}-EXPIRED`, branchId } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM stock_by_location WHERE item_id IN (:item1, :item2)`, { replacements: { item1, item2 } });
    await sequelize.query(`DELETE FROM inventory_transactions WHERE item_id IN (:item1, :item2)`, { replacements: { item1, item2 } });
    await sequelize.query(`DELETE FROM inventory_batches WHERE item_id IN (:item1, :item2)`, { replacements: { item1, item2 } });
    await sequelize.query(`DELETE FROM inventory_items WHERE id IN (:item1, :item2)`, { replacements: { item1, item2 } });
    await sequelize.query(`DELETE FROM stock_locations WHERE id IN (:locId, :locId2)`, { replacements: { locId, locId2 } });
    await sequelize.query(`DELETE FROM branches WHERE id = :branchId`, { replacements: { branchId } });
  } catch (e) { console.warn('reportInventoryRegisters cleanup failed (non-fatal):', e.message); }
});

const range = { dateFrom: '2020-01-01', dateTo: '2030-01-01', allBranches: 'true', clinic_id: '1' };

describe('Inventory register reports pull from the right records', () => {
  test('fast-moving ranks the dispensed item by quantity moved', async () => {
    const res = await run('/fast-moving', range);
    const row = res.body.rows.find((r) => r.id === item1);
    expect(row.totalMoved).toBe(8);
  });

  test('slow-moving includes the never-dispensed item at zero movement', async () => {
    const res = await run('/slow-moving', range);
    const row = res.body.rows.find((r) => r.id === item2);
    expect(row.totalMoved).toBe(0);
  });

  test('below-reorder-level includes the item at qty 2 / min 10, excludes the well-stocked item', async () => {
    const res = await run('/below-reorder-level', range);
    expect(res.body.rows.some((r) => r.id === item1)).toBe(true);
    expect(res.body.rows.some((r) => r.id === item2)).toBe(false);
  });

  test('retired-batches only returns the status=retired batch', async () => {
    const res = await run('/retired-batches', range);
    expect(res.body.rows.some((r) => r.batchNumber === `${SUFFIX}-RETIRED`)).toBe(true);
  });

  test('near-expiry excludes the already-expired batch', async () => {
    const res = await run('/near-expiry', { ...range, days: '90' });
    expect(res.body.rows.some((r) => r.batchNumber === `${SUFFIX}-NEAREXP`)).toBe(true);
    expect(res.body.rows.some((r) => r.batchNumber === `${SUFFIX}-EXPIRED`)).toBe(false);
  });

  test('stock-expiry only returns the already-expired batch', async () => {
    const res = await run('/stock-expiry', range);
    expect(res.body.rows.some((r) => r.batchNumber === `${SUFFIX}-EXPIRED`)).toBe(true);
    expect(res.body.rows.some((r) => r.batchNumber === `${SUFFIX}-NEAREXP`)).toBe(false);
  });

  test('stock-valuation-by-location computes qty * avg cost at the right location', async () => {
    const res = await run('/stock-valuation-by-location', range);
    const row = res.body.rows.find((r) => r.itemName === `${SUFFIX} Slow Mover`);
    expect(row.locationName).toBe(`${SUFFIX} Store`);
    expect(row.quantityOnHand).toBe(50);
    expect(row.stockValue).toBe(2500);
  });

  test('stock-movement-summary by branch totals all transactions correctly', async () => {
    const res = await run('/stock-movement-summary', { ...range, groupBy: 'branch' });
    const row = res.body.rows.find((r) => r.groupLabel === `${SUFFIX} Branch`);
    expect(row.transactionCount).toBe(3); // dispense + damage + transfer
    expect(row.totalQuantity).toBe(23); // 8 + 5 + 10
    expect(row.totalValue).toBe(7000); // 4000 + 2500 + 500
  });

  test('stock-movement-summary by location credits BOTH sides of a transfer, not just the FROM location', async () => {
    // Real bug this covers: COALESCE(from_location_id, to_location_id) always
    // resolved to the FROM side whenever both were set (every transfer), so
    // the TO location's inbound movement never showed up in this report at
    // all. The TX2 fixture transfers 10 units / 500 value from locId to locId2.
    const res = await run('/stock-movement-summary', { ...range, groupBy: 'location' });
    const fromRow = res.body.rows.find((r) => r.groupLabel === `${SUFFIX} Store`);
    const toRow = res.body.rows.find((r) => r.groupLabel === `${SUFFIX} Store 2`);
    expect(fromRow).toBeTruthy();
    expect(toRow).toBeTruthy();
    expect(fromRow.totalQuantity).toBe(10);
    expect(fromRow.totalValue).toBe(500);
    expect(toRow.totalQuantity).toBe(10);
    expect(toRow.totalValue).toBe(500);
  });

  test('material-consumption counts dispense AND damage (not just dispense/usage/waste)', async () => {
    // Real bug this covers: the old transaction_type filter omitted 'damage',
    // inconsistent with every other "stock actually deducted" computation in
    // this codebase (inventory.js's COGS summary, Usage History report, and
    // the transaction-creation handler itself all treat damage like waste).
    const res = await run('/material-consumption', range);
    const row = res.body.rows.find((r) => r.itemCode === `${SUFFIX}-FM`);
    expect(row.quantityConsumed).toBe(13); // 8 (dispense) + 5 (damage)
    expect(row.totalValue).toBe(6500); // 4000 + 2500
  });

  test('stock-movement-detail returns unitCost/totalCost as numbers, not numeric strings', async () => {
    // Real bug this covers: node-pg returns numeric columns as strings;
    // without parseFloat, the frontend's sortable "Value" column sorted
    // lexicographically instead of numerically.
    const res = await run('/stock-movement-detail', range);
    const row = res.body.rows.find((r) => r.transactionNumber === `${SUFFIX}-TXDAMAGE`);
    expect(typeof row.unitCost).toBe('number');
    expect(typeof row.totalCost).toBe('number');
    expect(row.totalCost).toBe(2500);
  });
});
