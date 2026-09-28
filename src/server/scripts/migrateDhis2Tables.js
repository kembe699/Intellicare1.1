const { sequelize } = require('../models');

// DHIS2 Monthly HMIS Facility Report — table definitions.
//
// dhis2_monthly_reports: one row per branch+period. branch_id is NOT NULL —
// a report is always for one specific facility ("All branches" in the UI is
// view/export only, never a saveable report).
//
// dhis2_stock_snapshots: closing stock per branch+item+period, written when
// a report is saved/finalized. Section G's opening balance reads the PREVIOUS
// period's closing snapshot instead of reconstructing it backward from
// inventory_items.quantity_on_hand — confirmed live that batches/:id/use,
// batches/retire-bulk, and item create/bulk-upload all mutate
// quantity_on_hand directly (with a GREATEST(0, ...) clamp) without writing
// inventory_transactions, so a backward-derived number would silently be
// wrong for any item that ever went through one of those paths.
async function migrateDhis2Tables(db = sequelize) {
  console.log('\n=== DHIS2 Report Module Migration ===\n');

  const tables = [
    {
      name: 'dhis2_monthly_reports',
      sql: `CREATE TABLE IF NOT EXISTS dhis2_monthly_reports (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36),
        branch_id INTEGER NOT NULL,
        period CHAR(7) NOT NULL,
        status VARCHAR(20) DEFAULT 'draft',
        computed_values JSONB,
        overrides JSONB,
        header JSONB,
        signoff JSONB,
        created_by VARCHAR(36),
        finalized_by VARCHAR(36),
        finalized_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_dhis2_report_branch_period UNIQUE (branch_id, period)
      )`,
    },
    {
      name: 'dhis2_branch_settings',
      sql: `CREATE TABLE IF NOT EXISTS dhis2_branch_settings (
        id CHAR(36) PRIMARY KEY,
        branch_id INTEGER NOT NULL UNIQUE,
        state VARCHAR(255),
        county VARCHAR(255),
        payam VARCHAR(255),
        facility_code VARCHAR(100),
        facility_type VARCHAR(100),
        catchment_population INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    },
    {
      name: 'dhis2_mappings',
      sql: `CREATE TABLE IF NOT EXISTS dhis2_mappings (
        id CHAR(36) PRIMARY KEY,
        clinic_id VARCHAR(36),
        branch_id INTEGER,
        mapping_type VARCHAR(50) NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    },
    {
      name: 'dhis2_stock_snapshots',
      sql: `CREATE TABLE IF NOT EXISTS dhis2_stock_snapshots (
        id CHAR(36) PRIMARY KEY,
        branch_id INTEGER NOT NULL,
        item_id VARCHAR(36) NOT NULL,
        period CHAR(7) NOT NULL,
        closing_qty NUMERIC(15,2) NOT NULL DEFAULT 0,
        estimated BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_dhis2_stock_snapshot UNIQUE (branch_id, item_id, period)
      )`,
    },
  ];

  for (const table of tables) {
    try {
      await db.query(table.sql);
      console.log(`  ✅ ${table.name} table ready`);
    } catch (err) {
      console.error(`  ❌ Error creating ${table.name}:`, err.message);
    }
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_dhis2_reports_branch_period ON dhis2_monthly_reports(branch_id, period)',
    'CREATE INDEX IF NOT EXISTS idx_dhis2_reports_status ON dhis2_monthly_reports(status)',
    'CREATE INDEX IF NOT EXISTS idx_dhis2_stock_snapshots_lookup ON dhis2_stock_snapshots(branch_id, item_id, period)',
    // branch_id is nullable on dhis2_mappings (a clinic-wide default mapping
    // has no branch_id) — COALESCE to a sentinel so the uniqueness rule
    // ("one mapping of a given type per branch, or one clinic-wide default")
    // still holds with a NULL branch_id, which a plain UNIQUE constraint
    // would otherwise never enforce (NULL never equals NULL).
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_dhis2_mapping_scope ON dhis2_mappings (COALESCE(branch_id, -1), mapping_type)',
  ];
  for (const idx of indexes) {
    try { await db.query(idx); } catch (err) { /* ignore duplicate index errors */ }
  }
  console.log('  ✅ Indexes created');

  console.log('\n=== DHIS2 Report Module Migration Complete ===\n');
}

module.exports = { migrateDhis2Tables };
