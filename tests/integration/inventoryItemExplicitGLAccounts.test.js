/**
 * Item Master (/inventory/items) can now link an item directly to its own
 * Inventory/Cost Of Sale/Income GL sub-accounts (inventory_items.
 * inventory_account_id / cogs_account_id / revenue_account_id — the last
 * one newly added this change). Previously pharmacyCogsOnBill.js and
 * resolveRevenueAccountForLine only ever inferred accounts from
 * item_category, with no way to override a specific item — exactly the
 * client's ask: "add option to add or link the item to Cost Of Sale
 * account directly ... so that it shows the cost of good sold properly".
 *
 * Proves: an item with explicit accounts set uses THOSE accounts (not the
 * item_category default), and an item with none set still falls back to
 * category inference unchanged.
 *
 * Calls the real functions directly against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const SUFFIX = `GLACCT${Date.now()}`;

let sequelize;
let testConn;
let explicitItemId;
let fallbackItemId;
let expenseAcctId;
let assetAcctId;
let revenueAcctId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const [[expenseAcct]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = 1 AND account_type = 'expense' AND account_code != '5210' AND is_active = true LIMIT 1`);
  const [[assetAcct]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = 1 AND account_type = 'asset' AND account_code != '1310' AND is_active = true LIMIT 1`);
  const [[revenueAcct]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = 1 AND account_type = 'revenue' AND is_active = true LIMIT 1`);
  expenseAcctId = expenseAcct.id;
  assetAcctId = assetAcct.id;
  revenueAcctId = revenueAcct.id;

  explicitItemId = uuid();
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, item_category, quantity_on_hand, current_unit_cost, average_unit_cost, is_active, cogs_account_id, inventory_account_id, revenue_account_id)
     VALUES (:id, 1, :code, :name, 'drugs', 100, 250, 250, true, :cogsId, :invId, :revId)`,
    { replacements: { id: explicitItemId, code: `${SUFFIX}-EXPLICIT`, name: `${SUFFIX} Explicit Drug`, cogsId: expenseAcctId, invId: assetAcctId, revId: revenueAcctId } }
  );

  fallbackItemId = uuid();
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, item_category, quantity_on_hand, current_unit_cost, average_unit_cost, is_active)
     VALUES (:id, 1, :code, :name, 'drugs', 100, 250, 250, true)`,
    { replacements: { id: fallbackItemId, code: `${SUFFIX}-FALLBACK`, name: `${SUFFIX} Fallback Drug` } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM inventory_items WHERE id IN (:a, :b)`, { replacements: { a: explicitItemId, b: fallbackItemId } });
  } catch (e) { console.warn('inventoryItemExplicitGLAccounts cleanup failed (non-fatal):', e.message); }
});

describe('Item Master GL account linking overrides category inference', () => {
  test('pharmacyCogsOnBill.js uses the item\'s own cogs/inventory accounts when set', async () => {
    const { postPharmacyCogsForBill } = require('../../src/server/utils/pharmacyCogsOnBill');
    const [[expenseAcct]] = await sequelize.query(`SELECT account_code FROM chart_of_accounts WHERE id = :id`, { replacements: { id: expenseAcctId } });
    const [[assetAcct]] = await sequelize.query(`SELECT account_code FROM chart_of_accounts WHERE id = :id`, { replacements: { id: assetAcctId } });

    const result = await withTenant(() => postPharmacyCogsForBill(sequelize, {
      clinicId: 1, branchId: null, billId: `${SUFFIX}-BILL1`, billDate: '2026-01-01', billNotes: null,
      services: [{ serviceName: `${SUFFIX} Explicit Drug`, quantity: 2, totalPrice: 1000 }],
      userId: 'test', accountCache: new Map(), dryRun: true,
    }));

    expect(result.previewed[0].cogsAccount).toBe(expenseAcct.account_code);
    expect(result.previewed[0].invAccount).toBe(assetAcct.account_code);
    expect(result.previewed[0].cogsAccount).not.toBe('5210'); // the drugs-category default
  });

  test('pharmacyCogsOnBill.js still falls back to category defaults when no explicit link is set', async () => {
    const { postPharmacyCogsForBill } = require('../../src/server/utils/pharmacyCogsOnBill');
    const result = await withTenant(() => postPharmacyCogsForBill(sequelize, {
      clinicId: 1, branchId: null, billId: `${SUFFIX}-BILL2`, billDate: '2026-01-01', billNotes: null,
      services: [{ serviceName: `${SUFFIX} Fallback Drug`, quantity: 1, totalPrice: 250 }],
      userId: 'test', accountCache: new Map(), dryRun: true,
    }));

    expect(result.previewed[0].cogsAccount).toBe('5210');
    expect(result.previewed[0].invAccount).toBe('1310');
  });

  test('resolveRevenueAccountForLine uses the item\'s own revenue_account_id when set', async () => {
    const { resolveRevenueAccountForLine } = require('../../src/server/utils/resolveRevenueAccount');
    const resolved = await withTenant(() => resolveRevenueAccountForLine({ serviceName: `${SUFFIX} Explicit Drug` }, 1));
    expect(resolved).toBe(revenueAcctId);
  });

  test('resolveRevenueAccountForLine falls back to pharmacy-category inference when unset', async () => {
    const { resolveRevenueAccountForLine } = require('../../src/server/utils/resolveRevenueAccount');
    const resolved = await withTenant(() => resolveRevenueAccountForLine({ serviceName: `${SUFFIX} Fallback Drug` }, 1));
    const [[pharmacyAcct]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = 1 AND account_code = '4120' LIMIT 1`);
    expect(pharmacyAcct).toBeTruthy(); // 4120 Pharmacy/Drug Revenue — the account this chart seeds for the 'pharma' category match
    expect(resolved).toBe(pharmacyAcct.id);
    expect(resolved).not.toBe(revenueAcctId);
  });
});
