const { sequelize } = require('../models');

/**
 * Central Categories module (see docs/accounting-map/REPORT.md for the
 * problem this solves: five separate hard-coded category arrays —
 * ItemMaster.tsx, Services.tsx, LabTests.tsx, DailyExpenses.tsx — and three
 * independent, inconsistent account-resolution engines, none of them backed
 * by a real table. `asset_categories` (fixedAssets.js) was the one correct
 * example — a real table, a real FK, real account columns — this is the
 * same pattern generalized to item/service/expense categories.
 *
 * `type` deliberately excludes 'asset' — Fixed Asset categories stay on
 * their own existing `asset_categories` table/routes (per the approved
 * plan: "keep asset_categories as is; just surface it as a tab").
 *
 * Column types: `id`/`parent_id` are native Postgres UUID, matching the
 * one column this feature reuses as-is — the pre-existing, already-real
 * `lab_tests.category_id UUID` (confirmed against both the Sequelize model
 * and the live schema — it predates this feature and was never dropped or
 * retyped). Every OTHER id-shaped column in this codebase (chart_of_accounts.id,
 * departments.id, inventory_items.id, etc.) is VARCHAR(36), not native uuid —
 * so the four account FK columns and department_id stay VARCHAR(36) to match
 * what they actually point at, while id/parent_id/the new category_id
 * columns added below to inventory_items/services/daily_expenses are all
 * UUID to match `categories.id` and the pre-existing lab_tests.category_id.
 * Mixed id types within one table is unusual but deliberate here — matching
 * each column's actual foreign table, not a single blanket convention.
 */
async function ensureCategoriesTable(db = sequelize) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id INTEGER NOT NULL,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(50) NOT NULL,
      type VARCHAR(20) NOT NULL,
      parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
      department_id VARCHAR(36),
      revenue_account_id VARCHAR(36) REFERENCES chart_of_accounts(id),
      cogs_account_id VARCHAR(36) REFERENCES chart_of_accounts(id),
      inventory_account_id VARCHAR(36) REFERENCES chart_of_accounts(id),
      expense_account_id VARCHAR(36) REFERENCES chart_of_accounts(id),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_categories_type CHECK (type IN ('item', 'service', 'expense')),
      CONSTRAINT uq_categories_clinic_type_name UNIQUE (clinic_id, type, name),
      CONSTRAINT uq_categories_clinic_type_code UNIQUE (clinic_id, type, code)
    )
  `);

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_categories_clinic_type ON categories (clinic_id, type, is_active)',
    'CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_categories_department ON categories (department_id)',
  ];
  for (const idx of indexes) {
    try { await db.query(idx); } catch (err) { console.error('categories index creation failed:', err.message); }
  }

  // One row per time AccountResolver.js (Part 3) could not find ANY account
  // — not an override, not the category's, not a clinic default — so the
  // posting went to the 9999 Suspense account instead of being silently
  // skipped the way several call sites used to (see REPORT.md §7, gap #12).
  // Surfaced in Accounting > Exceptions with a count badge.
  await db.query(`
    CREATE TABLE IF NOT EXISTS accounting_exceptions (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      source_module VARCHAR(100) NOT NULL,
      reference_type VARCHAR(100),
      reference_id VARCHAR(100),
      description TEXT NOT NULL,
      amount NUMERIC(15,2),
      currency VARCHAR(10),
      missing_account_type VARCHAR(20),
      suspense_account_id VARCHAR(36) REFERENCES chart_of_accounts(id),
      gl_entry_id VARCHAR(36),
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      resolved_by INTEGER,
      resolution_notes TEXT,
      CONSTRAINT chk_accounting_exceptions_status CHECK (status IN ('open', 'resolved'))
    )
  `);
  try { await db.query('CREATE INDEX IF NOT EXISTS idx_accounting_exceptions_clinic_status ON accounting_exceptions (clinic_id, status)'); } catch (err) { console.error('accounting_exceptions index creation failed:', err.message); }

  // Nullable category_id FK columns — the OLD free-text category columns
  // (inventory_items.item_category, services.category, daily_expenses.category)
  // are kept as-is (deprecated, not dropped — kept in sync on save by the
  // routes, not removed). lab_tests already has a real, unused
  // `category_id UUID` column from an earlier attempt at this same idea —
  // reused as-is, no ALTER needed there.
  const columnAdds = [
    ['inventory_items', 'category_id', 'UUID REFERENCES categories(id)'],
    ['services', 'category_id', 'UUID REFERENCES categories(id)'],
    ['daily_expenses', 'category_id', 'UUID REFERENCES categories(id)'],
    // lab_tests never had its own revenue account column at all — its
    // revenue previously came only from a forced 'laboratory' regex bucket
    // (resolveRevenueAccountForLine's lab_tests name-match branch). Adding
    // the override column here too so it follows the exact same
    // category-with-optional-override pattern as items/services, per the
    // approved plan's 4B section ("Same behaviour... Lab Tests").
    ['lab_tests', 'revenue_account_id', 'VARCHAR(36) REFERENCES chart_of_accounts(id)'],
  ];
  for (const [table, column, ddl] of columnAdds) {
    try { await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`); } catch (err) { console.error(`Could not add ${table}.${column}:`, err.message); }
  }
  try { await db.query('CREATE INDEX IF NOT EXISTS idx_inventory_items_category_id ON inventory_items (category_id)'); } catch (err) { console.error('inventory_items.category_id index creation failed:', err.message); }
  try { await db.query('CREATE INDEX IF NOT EXISTS idx_services_category_id ON services (category_id)'); } catch (err) { console.error('services.category_id index creation failed:', err.message); }
  try { await db.query('CREATE INDEX IF NOT EXISTS idx_daily_expenses_category_id ON daily_expenses (category_id)'); } catch (err) { console.error('daily_expenses.category_id index creation failed:', err.message); }
}

module.exports = { ensureCategoriesTable };
