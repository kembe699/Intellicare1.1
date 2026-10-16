// Inter-store stock transfer requests: any department can request items
// from another storage location, someone with fulfill-rights at the
// source location approves + fulfills it, and stock actually moves between
// the two stock_by_location rows (the clinic-wide inventory_items total is
// untouched — this mirrors the already-working 'transfer' transaction_type
// in routes/inventory.js's POST /transactions, lines ~1136-1254).
//
// location_access grants a user request/fulfill rights at a specific
// storage location — mirrors user_branches' shape (models/index.js
// ~1174-1191) rather than role_privileges/approval_permissions, neither of
// which has any resource-instance scoping column.
const { sequelize } = require('../models');

async function migrateStockTransfers() {
  console.log('\n=== Stock Transfer Requests Migration ===\n');

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS location_access (
      id SERIAL PRIMARY KEY,
      clinic_id INTEGER NOT NULL DEFAULT 1,
      user_id INTEGER NOT NULL REFERENCES users(id),
      location_id VARCHAR(36) NOT NULL REFERENCES stock_locations(id),
      can_request BOOLEAN DEFAULT TRUE,
      can_fulfill BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_location_access UNIQUE (user_id, location_id)
    )
  `);
  console.log('  location_access table ready');

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS stock_transfer_requests (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL DEFAULT 1,
      transfer_number VARCHAR(50) UNIQUE NOT NULL,
      from_location_id VARCHAR(36) NOT NULL REFERENCES stock_locations(id),
      to_location_id VARCHAR(36) NOT NULL REFERENCES stock_locations(id),
      requested_by INTEGER REFERENCES users(id),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      notes TEXT,
      approved_by INTEGER REFERENCES users(id),
      approval_date TIMESTAMPTZ,
      rejection_reason TEXT,
      fulfilled_by INTEGER REFERENCES users(id),
      fulfilled_date TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      branch_id INTEGER
    )
  `);
  console.log('  stock_transfer_requests table ready');

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS stock_transfer_request_items (
      id VARCHAR(36) PRIMARY KEY,
      transfer_request_id VARCHAR(36) NOT NULL REFERENCES stock_transfer_requests(id) ON DELETE CASCADE,
      inventory_item_id VARCHAR(36) NOT NULL REFERENCES inventory_items(id),
      quantity_requested NUMERIC NOT NULL,
      quantity_fulfilled NUMERIC DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('  stock_transfer_request_items table ready');

  for (const [idxName, idxSql] of [
    ['idx_str_from_location', 'CREATE INDEX idx_str_from_location ON stock_transfer_requests(from_location_id)'],
    ['idx_str_to_location', 'CREATE INDEX idx_str_to_location ON stock_transfer_requests(to_location_id)'],
    ['idx_str_status', 'CREATE INDEX idx_str_status ON stock_transfer_requests(status)'],
    ['idx_str_requested_by', 'CREATE INDEX idx_str_requested_by ON stock_transfer_requests(requested_by)'],
    ['idx_stri_transfer', 'CREATE INDEX idx_stri_transfer ON stock_transfer_request_items(transfer_request_id)'],
    ['idx_location_access_user', 'CREATE INDEX idx_location_access_user ON location_access(user_id)'],
    ['idx_location_access_location', 'CREATE INDEX idx_location_access_location ON location_access(location_id)'],
  ]) {
    try {
      const [[check]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :idxName`,
        { replacements: { idxName } }
      );
      if (!check.cnt) await sequelize.query(idxSql);
    } catch (e) { console.log(`  Note: could not create index ${idxName}: ${e.message}`); }
  }
  console.log('  indexes ready');

  console.log('\n=== Stock Transfer Requests Migration Complete ===\n');
}

if (require.main === module) {
  migrateStockTransfers()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { migrateStockTransfers };
