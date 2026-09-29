const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');

// Fixed Assets module — asset register, depreciation, and GL integration.
//
// asset_categories: how a group of assets behaves and posts — its nature
// (depreciating / appreciating / non_depreciating), default depreciation
// terms, and which chart-of-accounts rows it posts to (asset, accumulated
// depreciation, depreciation expense). Per clinic, like chart_of_accounts
// itself.
//
// fixed_assets: one row per physical asset — value, location, optional
// assigned custodian, and running book value/accumulated depreciation.
// Branch-scoped like every other clinical/operational table.
//
// asset_depreciation_entries: one row per asset per depreciation run,
// linked to the single consolidated GL entry that run posted.
async function migrateFixedAssetsTables(db = sequelize) {
  console.log('\n=== Fixed Assets Module Migration ===\n');

  await db.query(`
    CREATE TABLE IF NOT EXISTS asset_categories (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      name VARCHAR(150) NOT NULL,
      nature VARCHAR(20) NOT NULL DEFAULT 'depreciating',
      default_depreciation_method VARCHAR(20) NOT NULL DEFAULT 'straight_line',
      default_useful_life_years INTEGER,
      default_salvage_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      asset_account_id CHAR(36),
      accumulated_depreciation_account_id CHAR(36),
      depreciation_expense_account_id CHAR(36),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_asset_category_nature CHECK (nature IN ('depreciating', 'appreciating', 'non_depreciating')),
      CONSTRAINT chk_asset_category_method CHECK (default_depreciation_method IN ('straight_line', 'none'))
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS fixed_assets (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      asset_code VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL,
      category_id CHAR(36) NOT NULL,
      description TEXT,
      serial_number VARCHAR(150),
      location VARCHAR(255),
      assigned_to_employee_id CHAR(36),
      nature VARCHAR(20) NOT NULL DEFAULT 'depreciating',
      acquisition_date DATE NOT NULL,
      acquisition_cost NUMERIC(15,2) NOT NULL,
      salvage_value NUMERIC(15,2) NOT NULL DEFAULT 0,
      useful_life_years INTEGER,
      depreciation_method VARCHAR(20) NOT NULL DEFAULT 'straight_line',
      accumulated_depreciation NUMERIC(15,2) NOT NULL DEFAULT 0,
      current_value NUMERIC(15,2) NOT NULL,
      last_revalued_at DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      disposal_date DATE,
      disposal_proceeds NUMERIC(15,2),
      disposal_reason TEXT,
      acquisition_gl_entry_id CHAR(36),
      notes TEXT,
      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_fixed_asset_code UNIQUE (clinic_id, asset_code),
      CONSTRAINT chk_fixed_asset_nature CHECK (nature IN ('depreciating', 'appreciating', 'non_depreciating')),
      CONSTRAINT chk_fixed_asset_status CHECK (status IN ('active', 'under_maintenance', 'disposed', 'written_off'))
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS asset_depreciation_entries (
      id CHAR(36) PRIMARY KEY,
      asset_id CHAR(36) NOT NULL,
      clinic_id INTEGER NOT NULL,
      period CHAR(7) NOT NULL,
      depreciation_amount NUMERIC(15,2) NOT NULL,
      accumulated_depreciation_after NUMERIC(15,2) NOT NULL,
      book_value_after NUMERIC(15,2) NOT NULL,
      gl_entry_id CHAR(36),
      posted_by VARCHAR(36),
      posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_asset_depreciation_period UNIQUE (asset_id, period)
    )
  `);

  // acquisition_cost/salvage_value/current_value/accumulated_depreciation stay in the
  // clinic's base currency (consistent with chart_of_accounts/general_ledger, which are
  // base-currency only) — acquisition_currency + acquisition_cost_original just record
  // what was actually entered, for display, the same way patient bills keep bill_currency
  // alongside a base-currency total.
  const currencyColumns = [
    ['acquisition_currency', "ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS acquisition_currency VARCHAR(10)"],
    ['acquisition_cost_original', "ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS acquisition_cost_original NUMERIC(15,2)"],
    ['acquisition_exchange_rate', "ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS acquisition_exchange_rate NUMERIC(18,6)"],
  ];
  for (const [label, sql] of currencyColumns) {
    try { await db.query(sql); } catch (err) { console.error(`Could not add column ${label}:`, err.message); }
  }
  // Backfill existing rows so old assets still display a currency instead of blank.
  await db.query(`
    UPDATE fixed_assets SET acquisition_currency = COALESCE(acquisition_currency, (SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1), 'USD'),
                             acquisition_cost_original = COALESCE(acquisition_cost_original, acquisition_cost),
                             acquisition_exchange_rate = COALESCE(acquisition_exchange_rate, 1)
    WHERE acquisition_currency IS NULL
  `).catch((err) => console.error('Could not backfill acquisition currency columns:', err.message));

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_asset_categories_clinic ON asset_categories (clinic_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixed_assets_clinic ON fixed_assets (clinic_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixed_assets_branch ON fixed_assets (branch_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixed_assets_category ON fixed_assets (category_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON fixed_assets (status)',
    'CREATE INDEX IF NOT EXISTS idx_fixed_assets_assignee ON fixed_assets (assigned_to_employee_id)',
    'CREATE INDEX IF NOT EXISTS idx_asset_depreciation_asset ON asset_depreciation_entries (asset_id)',
    'CREATE INDEX IF NOT EXISTS idx_asset_depreciation_period ON asset_depreciation_entries (period)',
  ];
  for (const idx of indexes) {
    try { await db.query(idx); } catch (err) { console.error('Index creation failed:', err.message); }
  }

  // Extra chart-of-accounts rows this module needs that initializeChartOfAccounts.js
  // didn't already seed: Land (appreciating/non-depreciating assets), a dedicated
  // disposal loss account (so a loss on disposal doesn't get buried in Miscellaneous
  // Expenses), and a Revaluation Reserve equity account for writing up an
  // appreciating asset without ever touching income-statement revenue for something
  // that was never sold. Added per clinic that already has a chart of accounts —
  // ON CONFLICT DO NOTHING so re-running this (or running it on a tenant that
  // already has these rows) is a no-op.
  const [clinics] = await db.query(`SELECT DISTINCT clinic_id FROM chart_of_accounts`);
  const extraAccounts = [
    { code: '1540', name: 'Land', type: 'asset', sub: 'fixed_asset', balance: 'debit', desc: 'Land owned by the facility — not depreciated' },
    { code: '3200', name: 'Revaluation Reserve', type: 'equity', sub: 'reserve', balance: 'credit', desc: 'Cumulative upward revaluation of appreciating fixed assets' },
    { code: '5910', name: 'Loss on Disposal of Assets', type: 'expense', sub: 'operating_expense', balance: 'debit', desc: 'Loss recognized when a fixed asset is disposed of below its book value' },
  ];
  for (const { clinic_id } of clinics) {
    for (const acc of extraAccounts) {
      try {
        await db.query(
          `INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, sub_account_type, balance_type, opening_balance, is_active, description)
           VALUES (:id, :clinicId, :code, :name, :type, :sub, :balance, 0, true, :desc)
           ON CONFLICT (clinic_id, account_code) DO NOTHING`,
          { replacements: { id: uuidv4(), clinicId: clinic_id, code: acc.code, name: acc.name, type: acc.type, sub: acc.sub, balance: acc.balance, desc: acc.desc } }
        );
      } catch (err) {
        console.error(`Could not seed account ${acc.code} for clinic ${clinic_id}:`, err.message);
      }
    }
  }

  console.log('  ✅ asset_categories / fixed_assets / asset_depreciation_entries tables ready');
  console.log(`  ✅ Land / Revaluation Reserve / Loss on Disposal accounts checked for ${clinics.length} clinic(s)`);

  // Default categories, wired to the accounts every clinic already has (either
  // from initializeChartOfAccounts.js or the extra ones just seeded above).
  // Only added if missing by name — never overwrites a category someone has
  // already customized (e.g. re-pointed to a different account).
  const defaultCategories = [
    { name: 'Medical Equipment', nature: 'depreciating', life: 8, assetCode: '1500', accumCode: '1590', expenseCode: '5500' },
    { name: 'Laboratory Equipment', nature: 'depreciating', life: 8, assetCode: '1510', accumCode: '1590', expenseCode: '5500' },
    { name: 'Office Equipment', nature: 'depreciating', life: 5, assetCode: '1520', accumCode: '1590', expenseCode: '5500' },
    { name: 'Building and Improvements', nature: 'depreciating', life: 25, assetCode: '1530', accumCode: '1590', expenseCode: '5500' },
    { name: 'Land', nature: 'non_depreciating', life: null, assetCode: '1540', accumCode: null, expenseCode: null },
  ];
  for (const { clinic_id } of clinics) {
    const [accountRows] = await db.query(
      `SELECT account_code, id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code IN ('1500','1510','1520','1530','1540','1590','5500')`,
      { replacements: { clinicId: clinic_id } }
    );
    const accountIdByCode = Object.fromEntries(accountRows.map((r) => [r.account_code, r.id]));

    for (const cat of defaultCategories) {
      const assetAccountId = accountIdByCode[cat.assetCode];
      if (!assetAccountId) continue; // this clinic's chart doesn't have the account yet — skip, don't guess
      const [[existing]] = await db.query(
        `SELECT id FROM asset_categories WHERE clinic_id = :clinicId AND name = :name`,
        { replacements: { clinicId: clinic_id, name: cat.name } }
      );
      if (existing) continue;
      try {
        await db.query(
          `INSERT INTO asset_categories (id, clinic_id, name, nature, default_depreciation_method, default_useful_life_years, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id)
           VALUES (:id, :clinicId, :name, :nature, :method, :life, :assetAccountId, :accumAccountId, :expenseAccountId)`,
          {
            replacements: {
              id: uuidv4(), clinicId: clinic_id, name: cat.name, nature: cat.nature,
              method: cat.nature === 'depreciating' ? 'straight_line' : 'none', life: cat.life,
              assetAccountId, accumAccountId: accountIdByCode[cat.accumCode] || null, expenseAccountId: accountIdByCode[cat.expenseCode] || null,
            },
          }
        );
      } catch (err) {
        console.error(`Could not seed asset category "${cat.name}" for clinic ${clinic_id}:`, err.message);
      }
    }
  }
  console.log('  ✅ Default asset categories seeded (where missing)');
  console.log('\n=== Fixed Assets Migration Complete ===\n');
}

module.exports = { migrateFixedAssetsTables };
