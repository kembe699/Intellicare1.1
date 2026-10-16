// Links a storage location to the work station/department it serves, and
// lets a lab test optionally be tied to the consumable(s) it draws from
// (e.g. a CBC reagent box good for 200 tests, or a malaria RDT kit good for
// 1) so that performing the test automatically depletes that stock, and a
// test whose linked consumable has run out can be flagged unavailable when
// staff go to bill it.
const { sequelize } = require('../models');

async function migrateLabConsumables() {
  console.log('\n=== Lab Consumables Migration ===\n');

  await sequelize.query(`ALTER TABLE stock_locations ADD COLUMN IF NOT EXISTS department_id VARCHAR(36) REFERENCES departments(id)`);
  console.log('  stock_locations.department_id ready');

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS lab_test_consumables (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL DEFAULT 1,
      lab_test_id VARCHAR(36) NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
      inventory_item_id VARCHAR(36) NOT NULL REFERENCES inventory_items(id),
      location_id VARCHAR(36) REFERENCES stock_locations(id),
      tests_per_unit NUMERIC NOT NULL CHECK (tests_per_unit > 0),
      is_active BOOLEAN DEFAULT TRUE,
      notes TEXT,
      created_by VARCHAR(36),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_lab_test_consumable UNIQUE (lab_test_id, inventory_item_id)
    )
  `);
  console.log('  lab_test_consumables table ready');

  for (const [idxName, idxSql] of [
    ['idx_ltc_test', 'CREATE INDEX idx_ltc_test ON lab_test_consumables(lab_test_id)'],
    ['idx_ltc_item', 'CREATE INDEX idx_ltc_item ON lab_test_consumables(inventory_item_id)'],
  ]) {
    try {
      const [[check]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'lab_test_consumables' AND indexname = :idxName`,
        { replacements: { idxName } }
      );
      if (!check.cnt) await sequelize.query(idxSql);
    } catch (e) { console.log(`  Note: could not create index ${idxName}: ${e.message}`); }
  }
  console.log('  indexes ready');

  // Ledger of each deduction, same spirit as pharmacy dispensing's
  // inventory_transactions entries — lets "why did this drop" be answered.
  await sequelize.query(`ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS lab_test_consumable_id VARCHAR(36)`);
  console.log('  inventory_transactions.lab_test_consumable_id ready');

  // quantity_change was INTEGER — a reagent box good for 200 tests deducts
  // 0.005 units per test, which would silently round to 0 and leave the
  // audit trail blank on every single deduction.
  await sequelize.query(`ALTER TABLE inventory_transactions ALTER COLUMN quantity_change TYPE NUMERIC`);
  console.log('  inventory_transactions.quantity_change widened to NUMERIC');

  console.log('\n=== Lab Consumables Migration Complete ===\n');
}

if (require.main === module) {
  migrateLabConsumables()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { migrateLabConsumables };
