/**
 * The pack-vs-dose-unit bug: a drug stocked as a "Strip" (10 tablets) had no
 * way to record that a strip IS 10 tablets — calculateQuantity() correctly
 * computes a dose-unit count (e.g. 20 tablets for "2 BID x 5 days"), but
 * that number was deducted/priced 1:1 against pack-tracked stock, so
 * dispensing 20 tablets wiped out 20 whole strips instead of 2.
 *
 * Calls the real POST /api/pharmacy-module/dispensing handler directly
 * (handlerFor pattern, see lisBranchIdOnCreation.test.js), against
 * tenant_test, with a real inventory_items row.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const CLINIC_A = 961301;

let sequelize;
let testConn;
let dispenseHandler;

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

async function makeItem({ unitsPerPack, quantityOnHand, sellingPrice = 100 }) {
  const id = uuid();
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, unit_of_measure, units_per_pack,
       dose_unit_label, quantity_on_hand, selling_price, cost_currency, is_active)
     VALUES (:id, :cid, :code, :name, 'Strip', :upp, 'Tablet', :qoh, :price, 'SSP', true)`,
    { replacements: { id, cid: CLINIC_A, code: `PACKTEST-${id.slice(0, 8)}`, name: 'PackSizeTest Drug', upp: unitsPerPack, qoh: quantityOnHand, price: sellingPrice } }
  );
  return id;
}

async function dispense(itemId, quantityDispensed) {
  const req = { models: { sequelize }, user: { role: 'admin', id: uuid() }, body: { inventory_item_id: itemId, quantity_dispensed: quantityDispensed, clinic_id: CLINIC_A } };
  const res = mockRes();
  await dispenseHandler(req, res);
  return res;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const pharmacyRouter = require('../../src/server/routes/pharmacyModule');
  dispenseHandler = handlerFor(pharmacyRouter, '/dispensing', 'post');
});

afterAll(async () => {
  await sequelize.query(`DELETE FROM dispensing_records WHERE drug_id IN (SELECT id FROM inventory_items WHERE clinic_id = :cid)`, { replacements: { cid: CLINIC_A } });
  await sequelize.query(`DELETE FROM inventory_transactions WHERE item_id IN (SELECT id FROM inventory_items WHERE clinic_id = :cid)`, { replacements: { cid: CLINIC_A } });
  await sequelize.query(`DELETE FROM pharmacy_charges WHERE dispensing_record_id IN (SELECT id FROM dispensing_records WHERE drug_id IN (SELECT id FROM inventory_items WHERE clinic_id = :cid))`, { replacements: { cid: CLINIC_A } }).catch(() => {});
  await sequelize.query(`DELETE FROM inventory_items WHERE clinic_id = :cid`, { replacements: { cid: CLINIC_A } });
});

test('units_per_pack=1 (default, unconfigured item) dispenses 1:1, exactly like before this fix', async () => {
  const itemId = await withTenant(() => makeItem({ unitsPerPack: 1, quantityOnHand: 50 }));
  const res = await withTenant(() => dispense(itemId, 20));
  expect(res.statusCode).toBe(201);

  const [[item]] = await withTenant(() => sequelize.query('SELECT quantity_on_hand FROM inventory_items WHERE id = :id', { replacements: { id: itemId } }));
  expect(parseFloat(item.quantity_on_hand)).toBe(30); // 50 - 20, unchanged behavior
});

test('units_per_pack=10: dispensing 20 tablets deducts 2 strips, not 20', async () => {
  const itemId = await withTenant(() => makeItem({ unitsPerPack: 10, quantityOnHand: 10 }));
  const res = await withTenant(() => dispense(itemId, 20));
  expect(res.statusCode).toBe(201);

  const [[item]] = await withTenant(() => sequelize.query('SELECT quantity_on_hand FROM inventory_items WHERE id = :id', { replacements: { id: itemId } }));
  expect(parseFloat(item.quantity_on_hand)).toBe(8); // 10 strips - (20 tablets / 10 per strip) = 8, not 10-20=-10 clamped to 0
});

test('partial-pack (loose) dispensing deducts a fractional pack, tracked exactly', async () => {
  const itemId = await withTenant(() => makeItem({ unitsPerPack: 10, quantityOnHand: 5 }));
  const res = await withTenant(() => dispense(itemId, 15)); // 1.5 strips
  expect(res.statusCode).toBe(201);

  const [[item]] = await withTenant(() => sequelize.query('SELECT quantity_on_hand FROM inventory_items WHERE id = :id', { replacements: { id: itemId } }));
  expect(parseFloat(item.quantity_on_hand)).toBe(3.5); // 5 - 1.5
});

test('dispensing_records.quantity_dispensed stays in dose units (tablets), never converted', async () => {
  const itemId = await withTenant(() => makeItem({ unitsPerPack: 10, quantityOnHand: 10 }));
  const res = await withTenant(() => dispense(itemId, 20));
  expect(res.statusCode).toBe(201);

  const [[record]] = await withTenant(() => sequelize.query('SELECT quantity_dispensed FROM dispensing_records WHERE drug_id = :itemId', { replacements: { itemId } }));
  expect(parseFloat(record.quantity_dispensed)).toBe(20);
});

test('billed by the pack-equivalent price, not the raw dose count (no 10x overcharge)', async () => {
  const itemId = await withTenant(() => makeItem({ unitsPerPack: 10, quantityOnHand: 10, sellingPrice: 100 }));
  const res = await withTenant(() => dispense(itemId, 20));
  expect(res.statusCode).toBe(201);

  const [[charge]] = await withTenant(() => sequelize.query(
    `SELECT pc.charge_amount FROM pharmacy_charges pc
     JOIN dispensing_records dr ON dr.id = pc.dispensing_record_id
     WHERE dr.drug_id = :itemId`,
    { replacements: { itemId } }
  ));
  // 100 (price per strip) x 2 (strip-equivalent of 20 tablets) = 200, not 100 x 20 = 2000
  expect(parseFloat(charge.charge_amount)).toBe(200);
});

test('insufficient stock is correctly checked in pack-equivalent terms, not raw dose count', async () => {
  // 3 strips on hand (30 tablets worth) — asking for 25 tablets (2.5 strips) should succeed,
  // asking for 35 tablets (3.5 strips) should fail even though 35 < some much larger pack number.
  const itemId = await withTenant(() => makeItem({ unitsPerPack: 10, quantityOnHand: 3 }));
  const okRes = await withTenant(() => dispense(itemId, 25));
  expect(okRes.statusCode).toBe(201);

  const itemId2 = await withTenant(() => makeItem({ unitsPerPack: 10, quantityOnHand: 3 }));
  const failRes = await withTenant(() => dispense(itemId2, 35));
  expect(failRes.statusCode).toBe(400);
  expect(failRes.body.error).toMatch(/insufficient stock/i);
});
