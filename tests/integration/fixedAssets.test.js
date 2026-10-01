/**
 * Phase 6 (Fixed Assets): F1 (opening-balance entry for a legacy asset), F2
 * (disposal uses the asset's actual carrying amount, not a stale recompute),
 * F3 (salvage-value currency conversion), F4 (block changing a category's GL
 * accounts once assets exist under it), F5 (block a future-dated
 * depreciation run or disposal), F6 (clear, specific disposal error
 * messages instead of a dropped line item), F7 (branch checks + audit
 * logging on asset edits/dispose/revalue), F8 (block backdating a disposal
 * before acquisition or before depreciation already posted).
 *
 * Calls the REAL route handlers directly where the fix is route-level (see
 * receiptStatusTerminal.test.js for why — no HTTP test harness in this app);
 * calls AssetService directly for the service-level fixes.
 *
 * Runs against tenant_test, never a real tenant.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let AssetService;
let fixedAssetsRouter;
let branchAId, branchBId;
let categoryDepId; // depreciating category, with accumulated-depreciation account
let categoryNoDepId; // depreciating category missing its accumulated-depreciation account (F6)
let categoryNonDepId; // non-depreciating (revaluable) category

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
  const layer = fixedAssetsRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(overrides) {
  return {
    params: {}, body: {}, query: {},
    user: { id: 1, displayName: 'Assets Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
    ip: '127.0.0.1',
    ...overrides,
  };
}

async function getAccountId(code) {
  const [[row]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = :code`, { replacements: { c: TEST_CLINIC_ID, code } });
  return row.id;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  AssetService = require('../../src/server/services/AssetService');
  fixedAssetsRouter = require('../../src/server/routes/fixedAssets');

  const [[a]] = await sequelize.query(`INSERT INTO branches (name, is_active) VALUES ('t-Assets Branch A', true) RETURNING id`);
  const [[b]] = await sequelize.query(`INSERT INTO branches (name, is_active) VALUES ('t-Assets Branch B', true) RETURNING id`);
  branchAId = a.id; branchBId = b.id;

  const cashId = await getAccountId('1100');
  const assetAccountId = cashId; // reusing an existing active asset account for simplicity — the test never posts real cash movements against it
  const accumId = await getAccountId('4900'); // borrowed purely as "some other real account" to stand in for accumulated depreciation

  categoryDepId = uuid();
  await sequelize.query(
    `INSERT INTO asset_categories (id, clinic_id, name, nature, default_useful_life_years, default_salvage_percent, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id)
     VALUES (:id, :c, 'FATEST Depreciating', 'depreciating', 5, 10, :assetAcct, :accumAcct, :expAcct)`,
    { replacements: { id: categoryDepId, c: TEST_CLINIC_ID, assetAcct: assetAccountId, accumAcct: accumId, expAcct: accumId } }
  );

  categoryNoDepId = uuid();
  await sequelize.query(
    `INSERT INTO asset_categories (id, clinic_id, name, nature, default_useful_life_years, default_salvage_percent, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id)
     VALUES (:id, :c, 'FATEST No AccumAccount', 'depreciating', 5, 0, :assetAcct, NULL, :expAcct)`,
    { replacements: { id: categoryNoDepId, c: TEST_CLINIC_ID, assetAcct: assetAccountId, expAcct: accumId } }
  );

  categoryNonDepId = uuid();
  await sequelize.query(
    `INSERT INTO asset_categories (id, clinic_id, name, nature, asset_account_id)
     VALUES (:id, :c, 'FATEST Land', 'non_depreciating', :assetAcct)`,
    { replacements: { id: categoryNonDepId, c: TEST_CLINIC_ID, assetAcct: assetAccountId } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM asset_depreciation_entries WHERE asset_id IN (SELECT id FROM fixed_assets WHERE name LIKE 'FATEST-%')`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%FATEST-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%FATEST-%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%FATEST-%'`);
    await sequelize.query(`DELETE FROM fixed_assets WHERE name LIKE 'FATEST-%'`);
    await sequelize.query(`DELETE FROM asset_categories WHERE id IN (:a, :b, :c)`, { replacements: { a: categoryDepId, b: categoryNoDepId, c: categoryNonDepId } });
    await sequelize.query(`DELETE FROM branches WHERE id IN (:a, :b)`, { replacements: { a: branchAId, b: branchBId } });
  } catch (e) { console.warn('fixedAssets cleanup failed (non-fatal):', e.message); }
});

describe('F1: opening-balance entry for a legacy asset (no payment_account_code)', () => {
  test('posts Dr Asset / Cr Retained Earnings for the full cost when nothing is already depreciated', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: TEST_CLINIC_ID, name: 'FATEST-Legacy-1', category_id: categoryDepId,
      acquisition_date: '2020-01-01', acquisition_cost: 100000, useful_life_years: 5,
    }, 'test-system'));

    expect(asset.acquisition_gl_entry_id).toBeTruthy();
    const [lines] = await sequelize.query(`SELECT account_id, base_debit_amount, base_credit_amount FROM gl_line_items WHERE gl_id = :id`, { replacements: { id: asset.acquisition_gl_entry_id } });
    const totalDebit = lines.reduce((s, l) => s + parseFloat(l.base_debit_amount), 0);
    const totalCredit = lines.reduce((s, l) => s + parseFloat(l.base_credit_amount), 0);
    expect(totalDebit).toBe(totalCredit); // debits equal credits
    expect(totalDebit).toBe(100000);

    const retainedEarningsId = await getAccountId('3200');
    const equityLine = lines.find((l) => l.account_id === retainedEarningsId);
    expect(equityLine).toBeDefined();
    expect(parseFloat(equityLine.base_credit_amount)).toBe(100000);
  });

  test('a legacy asset already partway depreciated splits the opening entry between accumulated depreciation and equity', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: TEST_CLINIC_ID, name: 'FATEST-Legacy-2', category_id: categoryDepId,
      acquisition_date: '2018-01-01', acquisition_cost: 100000, useful_life_years: 5,
      opening_accumulated_depreciation: 40000,
    }, 'test-system'));

    expect(parseFloat(asset.accumulated_depreciation)).toBe(40000);
    expect(parseFloat(asset.current_value)).toBe(60000);

    const [lines] = await sequelize.query(`SELECT account_id, base_debit_amount, base_credit_amount FROM gl_line_items WHERE gl_id = :id`, { replacements: { id: asset.acquisition_gl_entry_id } });
    const totalDebit = lines.reduce((s, l) => s + parseFloat(l.base_debit_amount), 0);
    const totalCredit = lines.reduce((s, l) => s + parseFloat(l.base_credit_amount), 0);
    expect(totalDebit).toBe(totalCredit);

    const retainedEarningsId = await getAccountId('3200');
    const equityLine = lines.find((l) => l.account_id === retainedEarningsId);
    expect(parseFloat(equityLine.base_credit_amount)).toBe(60000); // net book value only, not the gross cost
  });
});

describe('F3: salvage_value is converted to base currency, same as acquisition_cost', () => {
  test('a USD asset\'s USD salvage_value is stored converted, not raw', async () => {
    const bookedRateId = uuid();
    await sequelize.query(
      `INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active) VALUES (:id, :c, 'USD', 'SSP', 4500, '2024-01-01', true)`,
      { replacements: { id: bookedRateId, c: TEST_CLINIC_ID } }
    );
    try {
      const asset = await withTenant(() => AssetService.createAsset({
        clinic_id: TEST_CLINIC_ID, name: 'FATEST-USD-Salvage', category_id: categoryDepId,
        acquisition_date: '2024-06-01', acquisition_cost: 1000, acquisition_currency: 'USD',
        salvage_value: 100, useful_life_years: 5,
      }, 'test-system'));

      expect(parseFloat(asset.acquisition_cost)).toBe(4500000); // 1000 * 4500
      expect(parseFloat(asset.salvage_value)).toBe(450000); // 100 * 4500 — NOT the raw 100
    } finally {
      await sequelize.query(`DELETE FROM exchange_rates WHERE id = :id`, { replacements: { id: bookedRateId } });
    }
  });
});

describe('F4: a category\'s GL accounts cannot change once assets exist under it', () => {
  test('rejects changing asset_account_id when the category already has an asset', async () => {
    await withTenant(() => AssetService.createAsset({
      clinic_id: TEST_CLINIC_ID, name: 'FATEST-F4-Asset', category_id: categoryNonDepId,
      acquisition_date: '2024-01-01', acquisition_cost: 5000,
    }, 'test-system'));

    const handler = handlerFor('/categories/:id', 'put');
    const res = mockRes();
    const newAccountId = await getAccountId('4900');
    await withTenant(() => handler(req({ params: { id: categoryNonDepId }, body: { asset_account_id: newAccountId } }), res));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/already use this category/);
  });

  test('renaming a category with existing assets is still allowed', async () => {
    const handler = handlerFor('/categories/:id', 'put');
    const res = mockRes();
    await withTenant(() => handler(req({ params: { id: categoryNonDepId }, body: { name: 'FATEST Land (renamed)' } }), res));
    expect(res.statusCode).toBe(200);
  });
});

describe('F5: a depreciation run or disposal cannot be dated in the future', () => {
  test('runDepreciation rejects a period that has not happened yet', async () => {
    const farFuture = `${new Date().getFullYear() + 5}-01`;
    await expect(withTenant(() => AssetService.runDepreciation(TEST_CLINIC_ID, farFuture, 'test-system'))).rejects.toThrow(/hasn't happened yet/);
  });

  test('disposeAsset rejects a future disposal_date', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: TEST_CLINIC_ID, name: 'FATEST-F5-Dispose', category_id: categoryNonDepId,
      acquisition_date: '2024-01-01', acquisition_cost: 3000,
    }, 'test-system'));
    const farFuture = `${new Date().getFullYear() + 5}-01-01`;
    await expect(withTenant(() => AssetService.disposeAsset(TEST_CLINIC_ID, asset.id, { disposal_date: farFuture }, 'test-system'))).rejects.toThrow(/cannot be in the future/);
  });
});

describe('F8: a disposal cannot be backdated before acquisition or before posted depreciation', () => {
  test('rejects a disposal_date before acquisition_date', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: TEST_CLINIC_ID, name: 'FATEST-F8-Early', category_id: categoryNonDepId,
      acquisition_date: '2024-06-01', acquisition_cost: 2000,
    }, 'test-system'));
    await expect(withTenant(() => AssetService.disposeAsset(TEST_CLINIC_ID, asset.id, { disposal_date: '2024-01-01' }, 'test-system')))
      .rejects.toThrow(/cannot be before this asset's acquisition_date/);
  });

  test('rejects a disposal_date before the last posted depreciation period', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: TEST_CLINIC_ID, name: 'FATEST-F8-Depreciated', category_id: categoryDepId,
      acquisition_date: '2020-01-01', acquisition_cost: 120000, useful_life_years: 5,
    }, 'test-system'));

    const pastPeriod = '2020-02';
    await withTenant(() => AssetService.runDepreciation(TEST_CLINIC_ID, pastPeriod, 'test-system'));

    await expect(withTenant(() => AssetService.disposeAsset(TEST_CLINIC_ID, asset.id, { disposal_date: '2020-01-15' }, 'test-system')))
      .rejects.toThrow(/depreciation has already been posted/);
  });
});

describe('F2: disposal uses the asset\'s actual carrying amount (current_value), not a stale recompute', () => {
  test('a revalued asset disposes against its revalued current_value, not acquisition_cost', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: TEST_CLINIC_ID, name: 'FATEST-F2-Revalued', category_id: categoryNonDepId,
      acquisition_date: '2023-01-01', acquisition_cost: 50000,
    }, 'test-system'));

    await withTenant(() => AssetService.revalueAsset(TEST_CLINIC_ID, asset.id, { new_value: 80000, reason: 'market appreciation' }, 'test-system'));

    const result = await withTenant(() => AssetService.disposeAsset(TEST_CLINIC_ID, asset.id, { disposal_date: '2024-01-01', proceeds: 90000, payment_account_code: '1100' }, 'test-system'));

    // Book value at disposal must be the REVALUED figure (80000), not the
    // original acquisition cost (50000) the old recompute would have used.
    expect(result.bookValue).toBe(80000);
    expect(result.gainOrLoss).toBe(10000); // 90000 proceeds - 80000 revalued book value

    const [lines] = await sequelize.query(`SELECT account_id, base_debit_amount, base_credit_amount FROM gl_line_items WHERE gl_id = :id`, { replacements: { id: result.glEntryId } });
    const totalDebit = lines.reduce((s, l) => s + parseFloat(l.base_debit_amount), 0);
    const totalCredit = lines.reduce((s, l) => s + parseFloat(l.base_credit_amount), 0);
    expect(totalDebit).toBe(totalCredit); // still perfectly balanced
  });
});

describe('F6: clear, specific disposal error messages instead of a silently dropped line item', () => {
  test('disposing an asset whose category has no accumulated-depreciation account gives a specific error', async () => {
    // Simulates a category whose accumulated-depreciation account was
    // configured when the asset was created (so createAsset's own opening-
    // balance validation passed) but later removed/misconfigured before
    // disposal — inserted directly rather than through createAsset, which
    // would (correctly, per F1) refuse to create this exact combination
    // itself.
    const assetId = uuid();
    await sequelize.query(
      `INSERT INTO fixed_assets (id, clinic_id, asset_code, name, category_id, nature, acquisition_date, acquisition_cost, acquisition_currency, salvage_value, useful_life_years, depreciation_method, accumulated_depreciation, current_value, status)
       VALUES (:id, :c, :assetCode, 'FATEST-F6-NoAccum', :categoryId, 'depreciating', '2024-01-01', 60000, 'SSP', 0, 5, 'straight_line', 10000, 50000, 'active')`,
      { replacements: { id: assetId, c: TEST_CLINIC_ID, assetCode: `FATEST-${Date.now()}`, categoryId: categoryNoDepId } }
    );

    await expect(withTenant(() => AssetService.disposeAsset(TEST_CLINIC_ID, assetId, { disposal_date: '2024-06-01' }, 'test-system')))
      .rejects.toThrow(/no accumulated-depreciation GL account configured/);
  });
});

describe('F7: branch isolation and audit logging on asset edits/dispose/revalue', () => {
  test('a branch-scoped user cannot dispose of another branch\'s asset', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: TEST_CLINIC_ID, branch_id: branchAId, name: 'FATEST-F7-Branch', category_id: categoryNonDepId,
      acquisition_date: '2024-01-01', acquisition_cost: 4000,
    }, 'test-system'));

    const handler = handlerFor('/:id/dispose', 'post');
    const res = mockRes();
    await withTenant(() => handler(req({
      params: { id: asset.id }, body: { disposal_date: '2024-06-01' },
      user: { id: 2, role: 'nurse', branchId: branchBId }, branchContext: { branchId: branchBId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(403);
  });

  test('updating an asset writes an audit log entry', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: TEST_CLINIC_ID, name: 'FATEST-F7-Audit', category_id: categoryNonDepId,
      acquisition_date: '2024-01-01', acquisition_cost: 7000,
    }, 'test-system'));

    const handler = handlerFor('/:id', 'put');
    const res = mockRes();
    await withTenant(() => handler(req({ params: { id: asset.id }, body: { location: 'New Wing' } }), res));
    expect(res.statusCode).toBe(200);

    const [[log]] = await sequelize.query(
      `SELECT id FROM audit_logs WHERE entity_type = 'FixedAsset' AND entity_id = :id AND action = 'ASSET_UPDATED' ORDER BY created_at DESC LIMIT 1`,
      { replacements: { id: asset.id } }
    );
    expect(log).toBeDefined();
  });
});
