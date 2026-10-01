/**
 * Fixed Assets — DB-backed behavior against tenant_test (never a real
 * tenant — see tests/setup/testDb.js). Uses getTenantConnection (not
 * testDb.js's own getSequelize()) for anything that touches Sequelize
 * models or AssetService/AccountingService — see
 * billCreationAtomicity.test.js's comment for why: this repo has two
 * separate `sequelize` package installs, and mixing a connection built
 * from one with model definitions from the other breaks Sequelize's
 * internal identity checks for DataTypes.UUIDV4.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');
const { migrateFixedAssetsTables } = require('../../src/server/scripts/migrateFixedAssetsTables');

const CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let AssetService;
let categories;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false; // see billCreationAtomicity.test.js for why
  await migrateFixedAssetsTables(sequelize);
  AssetService = require('../../src/server/services/AssetService');

  const [rows] = await sequelize.query(`SELECT id, name, nature FROM asset_categories WHERE clinic_id = :clinicId`, { replacements: { clinicId: CLINIC_ID } });
  categories = Object.fromEntries(rows.map((r) => [r.name, r]));
}, 30000);

afterAll(async () => {
  const cleanup = [
    () => sequelize.query(`DELETE FROM asset_depreciation_entries WHERE asset_id IN (SELECT id FROM fixed_assets WHERE clinic_id = :clinicId AND name LIKE 'AssetTest%')`, { replacements: { clinicId: CLINIC_ID } }),
    () => sequelize.query(`DELETE FROM fixed_assets WHERE clinic_id = :clinicId AND name LIKE 'AssetTest%'`, { replacements: { clinicId: CLINIC_ID } }),
    () => sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%AssetTest%')`),
    () => sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%AssetTest%')`),
    () => sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%AssetTest%'`),
  ];
  for (const step of cleanup) {
    try { await step(); } catch (e) { console.warn('assetService cleanup step failed (non-fatal):', e.message); }
  }
});

describe('AssetService.createAsset', () => {
  test('registers a depreciating asset and posts a balanced GL entry when a payment account is given', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Ultrasound', category_id: categories['Medical Equipment'].id,
      location: 'Radiology', acquisition_date: '2025-01-01', acquisition_cost: 12000, useful_life_years: 8,
      payment_account_code: '1100',
    }, 'test-system'));

    expect(asset.asset_code).toMatch(/^FA-\d{4}-\d{4}$/);
    expect(parseFloat(asset.current_value)).toBe(12000);
    expect(asset.acquisition_gl_entry_id).toBeTruthy();

    const [[gl]] = await sequelize.query('SELECT total_debit, total_credit, is_posted FROM general_ledger WHERE id = :id', { replacements: { id: asset.acquisition_gl_entry_id } });
    expect(parseFloat(gl.total_debit)).toBe(12000);
    expect(parseFloat(gl.total_credit)).toBe(12000);
    expect(gl.is_posted).toBe(true);
  });

  test('F1 (Phase 6): registers a legacy asset (no payment account) with an opening-balance GL entry, not no entry at all', async () => {
    // Used to post NOTHING when no payment account was given — the asset
    // register and the general ledger silently disagreed from day one. Now
    // posts Dr Asset / Cr Retained Earnings for the asset's opening value —
    // see fixedAssets.test.js's own F1 describe block for the fuller proof
    // (including the opening-accumulated-depreciation split).
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Opening Balance Chair', category_id: categories['Office Equipment'].id,
      acquisition_date: '2019-01-01', acquisition_cost: 300, useful_life_years: 5,
    }, 'test-system'));
    expect(asset.acquisition_gl_entry_id).toBeTruthy();

    const [[gl]] = await sequelize.query('SELECT total_debit, total_credit FROM general_ledger WHERE id = :id', { replacements: { id: asset.acquisition_gl_entry_id } });
    expect(parseFloat(gl.total_debit)).toBe(300);
    expect(parseFloat(gl.total_credit)).toBe(300);
  });

  test('a genuine posting failure (bad payment account) rolls back the asset row too', async () => {
    await expect(withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Should Not Exist', category_id: categories['Office Equipment'].id,
      acquisition_date: '2025-01-01', acquisition_cost: 500, useful_life_years: 3,
      payment_account_code: '9999', // does not exist
    }, 'test-system'))).rejects.toThrow(/Payment account 9999 not found/);

    const [rows] = await sequelize.query(`SELECT id FROM fixed_assets WHERE name = 'AssetTest Should Not Exist'`);
    expect(rows).toHaveLength(0);
  });

  test('rejects a depreciating asset with no useful life (none given, none on the category)', async () => {
    // The seeded categories all carry a sensible default useful life, so
    // this exercises a custom category that doesn't — a real admin-created
    // category before they've filled that field in.
    const bareCategoryId = uuid();
    const [[{ asset_account_id: assetAccountId }]] = await sequelize.query(
      `SELECT asset_account_id FROM asset_categories WHERE id = :id`, { replacements: { id: categories['Medical Equipment'].id } }
    );
    await sequelize.query(
      `INSERT INTO asset_categories (id, clinic_id, name, nature, default_depreciation_method, asset_account_id)
       VALUES (:id, :clinicId, 'AssetTest Bare Category', 'depreciating', 'straight_line', :assetAccountId)`,
      { replacements: { id: bareCategoryId, clinicId: CLINIC_ID, assetAccountId } }
    );
    await expect(withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest No Life', category_id: bareCategoryId,
      acquisition_date: '2025-01-01', acquisition_cost: 1000,
    }, 'test-system'))).rejects.toThrow(/useful_life_years/);
    await sequelize.query(`DELETE FROM asset_categories WHERE id = :id`, { replacements: { id: bareCategoryId } });
  });
});

describe('AssetService.runDepreciation', () => {
  let asset;

  beforeAll(async () => {
    asset = await withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Depreciation Laptop', category_id: categories['Office Equipment'].id,
      acquisition_date: '2020-01-01', acquisition_cost: 1200, salvage_value: 0, useful_life_years: 5,
    }, 'test-system'));
  });

  test('computes straight-line monthly depreciation and posts a consolidated, balanced GL entry', async () => {
    // 1200 / 5 years / 12 months = 20/month. F5 (Phase 6) now rejects a
    // future-dated period, so this runs a period shortly after acquisition
    // (2020-01-01) rather than the far-future placeholder date this test
    // used to use to avoid colliding with other fixtures.
    const result = await withTenant(() => AssetService.runDepreciation(CLINIC_ID, '2020-02', 'test-system'));
    expect(result.assetsDepreciated).toBeGreaterThanOrEqual(1);

    const [[row]] = await sequelize.query('SELECT accumulated_depreciation, current_value FROM fixed_assets WHERE id = :id', { replacements: { id: asset.id } });
    expect(parseFloat(row.accumulated_depreciation)).toBe(20);
    expect(parseFloat(row.current_value)).toBe(1180);

    const [[gl]] = await sequelize.query('SELECT total_debit, total_credit FROM general_ledger WHERE id = :id', { replacements: { id: result.glEntryId } });
    expect(parseFloat(gl.total_debit)).toBe(parseFloat(gl.total_credit));
  });

  test('running the same period again is a no-op (idempotent)', async () => {
    const again = await withTenant(() => AssetService.runDepreciation(CLINIC_ID, '2020-02', 'test-system'));
    const [[row]] = await sequelize.query('SELECT accumulated_depreciation FROM fixed_assets WHERE id = :id', { replacements: { id: asset.id } });
    expect(parseFloat(row.accumulated_depreciation)).toBe(20); // unchanged — not 40
    expect(again.assetsDepreciated + 0).toBeLessThanOrEqual(1); // this asset specifically is not re-counted
  });

  test('never depreciates past the salvage value', async () => {
    // Fast-forward: manually set accumulated depreciation to 1 cent below full
    // depreciable base, then run one more period — it must cap, not overshoot.
    await sequelize.query(`UPDATE fixed_assets SET accumulated_depreciation = 1195, current_value = 5 WHERE id = :id`, { replacements: { id: asset.id } });
    await withTenant(() => AssetService.runDepreciation(CLINIC_ID, '2020-03', 'test-system'));
    const [[row]] = await sequelize.query('SELECT accumulated_depreciation, current_value FROM fixed_assets WHERE id = :id', { replacements: { id: asset.id } });
    expect(parseFloat(row.accumulated_depreciation)).toBe(1200); // capped at cost - salvage, not 1215
    expect(parseFloat(row.current_value)).toBe(0);
  });
});

describe('AssetService.disposeAsset', () => {
  test('recognizes a loss when proceeds are below book value, GL entry balances', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Dispose Loss', category_id: categories['Office Equipment'].id,
      acquisition_date: '2020-01-01', acquisition_cost: 1000, salvage_value: 0, useful_life_years: 5,
    }, 'test-system'));

    // F5 (Phase 6) now rejects a future-dated disposal — was '2031-01-01'.
    const result = await withTenant(() => AssetService.disposeAsset(CLINIC_ID, asset.id, { disposal_date: '2024-01-01', proceeds: 300, payment_account_code: '1100', reason: 'Sold' }, 'test-system'));
    expect(result.bookValue).toBe(1000); // no depreciation run yet
    expect(result.gainOrLoss).toBe(-700);

    const [[gl]] = await sequelize.query('SELECT total_debit, total_credit FROM general_ledger WHERE id = :id', { replacements: { id: result.glEntryId } });
    expect(parseFloat(gl.total_debit)).toBe(parseFloat(gl.total_credit));

    const [[row]] = await sequelize.query('SELECT status, current_value FROM fixed_assets WHERE id = :id', { replacements: { id: asset.id } });
    expect(row.status).toBe('disposed');
    expect(parseFloat(row.current_value)).toBe(0);
  });

  test('recognizes a gain when proceeds exceed book value', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Dispose Gain', category_id: categories['Office Equipment'].id,
      acquisition_date: '2020-01-01', acquisition_cost: 500, salvage_value: 0, useful_life_years: 5,
    }, 'test-system'));
    const result = await withTenant(() => AssetService.disposeAsset(CLINIC_ID, asset.id, { proceeds: 800, payment_account_code: '1100' }, 'test-system'));
    expect(result.gainOrLoss).toBe(300);
    const [[gl]] = await sequelize.query('SELECT total_debit, total_credit FROM general_ledger WHERE id = :id', { replacements: { id: result.glEntryId } });
    expect(parseFloat(gl.total_debit)).toBe(parseFloat(gl.total_credit));
  });

  test('rejects disposing an already-disposed asset', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Double Dispose', category_id: categories['Office Equipment'].id,
      acquisition_date: '2020-01-01', acquisition_cost: 200, useful_life_years: 5,
    }, 'test-system'));
    await withTenant(() => AssetService.disposeAsset(CLINIC_ID, asset.id, { proceeds: 0 }, 'test-system'));
    await expect(withTenant(() => AssetService.disposeAsset(CLINIC_ID, asset.id, { proceeds: 0 }, 'test-system')))
      .rejects.toThrow(/already been disposed/);
  });
});

describe('AssetService.revalueAsset', () => {
  test('an upward revaluation posts Dr Asset / Cr Revaluation Reserve', async () => {
    const land = await withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Land Plot', category_id: categories['Land'].id,
      acquisition_date: '2015-01-01', acquisition_cost: 50000,
    }, 'test-system'));

    const result = await withTenant(() => AssetService.revalueAsset(CLINIC_ID, land.id, { new_value: 65000, reason: 'Market appreciation' }, 'test-system'));
    expect(result.delta).toBe(15000);

    const [[gl]] = await sequelize.query('SELECT total_debit, total_credit FROM general_ledger WHERE id = :id', { replacements: { id: result.glEntryId } });
    expect(parseFloat(gl.total_debit)).toBe(15000);
    expect(parseFloat(gl.total_credit)).toBe(15000);

    const [[row]] = await sequelize.query('SELECT current_value FROM fixed_assets WHERE id = :id', { replacements: { id: land.id } });
    expect(parseFloat(row.current_value)).toBe(65000);
  });

  test('a downward revaluation posts the reverse', async () => {
    const land = await withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Land Plot Down', category_id: categories['Land'].id,
      acquisition_date: '2015-01-01', acquisition_cost: 50000,
    }, 'test-system'));
    const result = await withTenant(() => AssetService.revalueAsset(CLINIC_ID, land.id, { new_value: 40000 }, 'test-system'));
    expect(result.delta).toBe(-10000);
    const [[row]] = await sequelize.query('SELECT current_value FROM fixed_assets WHERE id = :id', { replacements: { id: land.id } });
    expect(parseFloat(row.current_value)).toBe(40000);
  });

  test('rejects revaluing a depreciating asset', async () => {
    const asset = await withTenant(() => AssetService.createAsset({
      clinic_id: CLINIC_ID, name: 'AssetTest Depreciating Cannot Revalue', category_id: categories['Office Equipment'].id,
      acquisition_date: '2020-01-01', acquisition_cost: 400, useful_life_years: 4,
    }, 'test-system'));
    await expect(withTenant(() => AssetService.revalueAsset(CLINIC_ID, asset.id, { new_value: 500 }, 'test-system')))
      .rejects.toThrow(/not revalued manually/);
  });
});
