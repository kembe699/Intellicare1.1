/**
 * Inventory Management Module - Database Migration
 * Creates all inventory tables for complete inventory management
 * with accounting & procurement integration
 */
const { sequelize } = require('../models');

async function migrateInventoryTables() {
  console.log('=== Starting Inventory Tables Migration ===');

  // Helper: safe column add
  async function addColumnIfNotExists(table, column, definition) {
    try {
      const [cols] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${column}'`);
      if (cols.length === 0) {
        await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        console.log(`  Added column ${column} to ${table}`);
      }
    } catch (e) {
      console.log(`  Note: Could not add ${column} to ${table}: ${e.message}`);
    }
  }

  // ── 1. Inventory Item Master ──
  try {
    console.log('\n1. Creating inventory_items table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        item_code VARCHAR(100) NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        item_description TEXT NULL,
        item_category VARCHAR(100) NULL DEFAULT 'general',
        item_type VARCHAR(50) NULL DEFAULT 'consumable',
        unit_of_measure VARCHAR(50) NULL DEFAULT 'Each',
        reorder_unit VARCHAR(50) NULL DEFAULT 'Each',
        conversion_factor INT DEFAULT 1,

        quantity_on_hand INT DEFAULT 0,
        reserved_quantity INT DEFAULT 0,

        minimum_stock_level INT DEFAULT 0,
        maximum_stock_level INT DEFAULT 0,
        reorder_quantity INT DEFAULT 0,
        lead_time_days INT DEFAULT 7,

        inventory_valuation_method VARCHAR(20) DEFAULT 'weighted_average',
        current_unit_cost DECIMAL(15,4) DEFAULT 0,
        average_unit_cost DECIMAL(15,4) DEFAULT 0,
        selling_price DECIMAL(15,4) DEFAULT 0,
        cost_currency VARCHAR(3) DEFAULT 'SSP',

        inventory_account_id VARCHAR(36) NULL,
        cogs_account_id VARCHAR(36) NULL,
        usage_account_id VARCHAR(36) NULL,

        requires_batch_tracking BOOLEAN DEFAULT false,
        requires_expiry_tracking BOOLEAN DEFAULT false,
        requires_serial_number BOOLEAN DEFAULT false,
        is_controlled_substance BOOLEAN DEFAULT false,

        is_active BOOLEAN DEFAULT true,
        discontinued_date DATE NULL,
        notes TEXT NULL,

        preferred_supplier_id INT NULL,
        drug_inventory_id VARCHAR(36) NULL,

        created_by VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_clinic_code (clinic_id, item_code),
        INDEX idx_clinic_category (clinic_id, item_category),
        INDEX idx_clinic_active (clinic_id, is_active),
        INDEX idx_reorder (clinic_id, quantity_on_hand, minimum_stock_level)
      )
    `);
    console.log('  inventory_items table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 2. Item Pricing History ──
  try {
    console.log('\n2. Creating item_pricing_history table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS item_pricing_history (
        id VARCHAR(36) PRIMARY KEY,
        item_id VARCHAR(36) NOT NULL,
        supplier_id INT NULL,
        unit_cost DECIMAL(15,4) NULL,
        cost_currency VARCHAR(3) DEFAULT 'SSP',
        effective_from DATE NULL,
        effective_to DATE NULL,
        source VARCHAR(50) NULL DEFAULT 'manual',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_item_date (item_id, effective_from)
      )
    `);
    console.log('  item_pricing_history table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 3. Stock Locations ──
  try {
    console.log('\n3. Creating stock_locations table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS stock_locations (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        location_code VARCHAR(50) NOT NULL,
        location_name VARCHAR(255) NOT NULL,
        location_type VARCHAR(50) DEFAULT 'warehouse',
        address TEXT NULL,
        manager_user_id VARCHAR(36) NULL,
        is_active BOOLEAN DEFAULT true,
        capacity_description TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_clinic_location (clinic_id, location_code),
        INDEX idx_clinic (clinic_id)
      )
    `);
    console.log('  stock_locations table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 4. Stock by Location ──
  try {
    console.log('\n4. Creating stock_by_location table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS stock_by_location (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        item_id VARCHAR(36) NOT NULL,
        location_id VARCHAR(36) NOT NULL,
        quantity_on_hand INT DEFAULT 0,
        reserved_quantity INT DEFAULT 0,
        last_counted DATE NULL,
        last_counted_by VARCHAR(36) NULL,
        recount_required BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_item_location (item_id, location_id),
        INDEX idx_clinic_item (clinic_id, item_id)
      )
    `);
    console.log('  stock_by_location table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 5. Inventory Batches ──
  try {
    console.log('\n5. Creating inventory_batches table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS inventory_batches (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        item_id VARCHAR(36) NOT NULL,
        batch_number VARCHAR(100) NOT NULL,
        serial_number VARCHAR(100) NULL,
        location_id VARCHAR(36) NULL,

        po_id INT NULL,
        grn_id VARCHAR(36) NULL,
        supplier_id INT NULL,
        receipt_date DATE NOT NULL,

        quantity_received INT NOT NULL DEFAULT 0,
        quantity_used INT DEFAULT 0,
        unit_cost DECIMAL(15,4) DEFAULT 0,
        cost_currency VARCHAR(3) DEFAULT 'SSP',
        batch_total_cost DECIMAL(15,2) DEFAULT 0,

        manufacture_date DATE NULL,
        expiry_date DATE NULL,
        is_expired BOOLEAN DEFAULT false,

        status VARCHAR(20) DEFAULT 'active',
        notes TEXT NULL,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_clinic_expiry (clinic_id, expiry_date),
        INDEX idx_item_location (item_id, location_id),
        INDEX idx_status (status)
      )
    `);
    console.log('  inventory_batches table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 6. Batch Usage History ──
  try {
    console.log('\n6. Creating batch_usage_history table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS batch_usage_history (
        id VARCHAR(36) PRIMARY KEY,
        batch_id VARCHAR(36) NOT NULL,
        usage_date DATE NULL,
        quantity_used INT DEFAULT 0,
        usage_type VARCHAR(50) DEFAULT 'clinical_use',
        reference_id VARCHAR(100) NULL,
        reference_type VARCHAR(50) NULL,
        used_by VARCHAR(36) NULL,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_batch_date (batch_id, usage_date)
      )
    `);
    console.log('  batch_usage_history table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 7. Inventory Transactions ──
  try {
    console.log('\n7. Creating inventory_transactions table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        transaction_number VARCHAR(100) NOT NULL UNIQUE,
        item_id VARCHAR(36) NOT NULL,
        transaction_type VARCHAR(30) NOT NULL,
        quantity_change INT NOT NULL,
        from_location_id VARCHAR(36) NULL,
        to_location_id VARCHAR(36) NULL,
        batch_id VARCHAR(36) NULL,

        unit_cost DECIMAL(15,4) DEFAULT 0,
        total_cost DECIMAL(15,2) DEFAULT 0,
        cost_currency VARCHAR(3) DEFAULT 'SSP',
        exchange_rate DECIMAL(15,6) DEFAULT 1,

        gl_entry_id VARCHAR(36) NULL,
        gl_entry_created BOOLEAN DEFAULT false,
        gl_entry_posted BOOLEAN DEFAULT false,

        reference_type VARCHAR(50) NULL,
        reference_id VARCHAR(100) NULL,

        transaction_date DATE NOT NULL,
        transaction_time TIME NULL,
        notes TEXT NULL,
        approval_required BOOLEAN DEFAULT false,
        approved_by VARCHAR(36) NULL,
        approval_date TIMESTAMP NULL,

        created_by VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_clinic_date (clinic_id, transaction_date),
        INDEX idx_item_type (item_id, transaction_type),
        INDEX idx_reference (reference_type, reference_id)
      )
    `);
    console.log('  inventory_transactions table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 8. Inventory Valuation ──
  try {
    console.log('\n8. Creating inventory_valuation table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS inventory_valuation (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        item_id VARCHAR(36) NOT NULL,
        valuation_date DATE NOT NULL,
        quantity_on_hand INT DEFAULT 0,
        quantity_reserved INT DEFAULT 0,
        fifo_value DECIMAL(15,2) DEFAULT 0,
        lifo_value DECIMAL(15,2) DEFAULT 0,
        weighted_average_value DECIMAL(15,2) DEFAULT 0,
        selected_method VARCHAR(20) DEFAULT 'weighted_average',
        inventory_value DECIMAL(15,2) DEFAULT 0,
        gl_entry_id VARCHAR(36) NULL,
        gl_posting_date DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_clinic_date (clinic_id, valuation_date),
        UNIQUE KEY unique_item_date (item_id, valuation_date)
      )
    `);
    console.log('  inventory_valuation table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 9. COGS Posting Log ──
  try {
    console.log('\n9. Creating cogs_posting_log table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS cogs_posting_log (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        posting_period DATE NULL,
        item_id VARCHAR(36) NULL,
        quantity_used INT DEFAULT 0,
        quantity_dispensed INT DEFAULT 0,
        quantity_wasted INT DEFAULT 0,
        total_quantity_out INT DEFAULT 0,
        total_cost_of_goods DECIMAL(15,2) DEFAULT 0,
        cogs_method VARCHAR(20) DEFAULT 'weighted_average',
        average_cost_per_unit DECIMAL(15,4) DEFAULT 0,
        gl_entry_id VARCHAR(36) NULL,
        gl_account_id VARCHAR(36) NULL,
        posted_by VARCHAR(36) NULL,
        posting_date TIMESTAMP NULL,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_clinic_period (clinic_id, posting_period)
      )
    `);
    console.log('  cogs_posting_log table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 10. Inventory Adjustments ──
  try {
    console.log('\n10. Creating inventory_adjustments table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        adjustment_number VARCHAR(100) NOT NULL UNIQUE,
        item_id VARCHAR(36) NOT NULL,
        location_id VARCHAR(36) NULL,
        system_quantity INT DEFAULT 0,
        physical_count INT DEFAULT 0,
        variance INT DEFAULT 0,
        variance_reason VARCHAR(50) NULL,
        variance_value DECIMAL(15,2) DEFAULT 0,
        counted_by VARCHAR(36) NULL,
        count_date DATE NULL,
        reviewed_by VARCHAR(36) NULL,
        review_date DATE NULL,
        approved_by VARCHAR(36) NULL,
        approval_date DATE NULL,
        approval_status VARCHAR(20) DEFAULT 'pending',
        gl_entry_id VARCHAR(36) NULL,
        adjustment_account_id VARCHAR(36) NULL,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_clinic_status (clinic_id, approval_status)
      )
    `);
    console.log('  inventory_adjustments table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 11. Physical Inventory Counts ──
  try {
    console.log('\n11. Creating physical_inventory_counts table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS physical_inventory_counts (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        count_number VARCHAR(100) NOT NULL UNIQUE,
        count_date DATE NULL,
        count_type VARCHAR(20) DEFAULT 'full_count',
        location_id VARCHAR(36) NULL,
        total_items_counted INT DEFAULT 0,
        total_items_system INT DEFAULT 0,
        variance_count INT DEFAULT 0,
        variance_percentage DECIMAL(5,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'in_progress',
        completed_by VARCHAR(36) NULL,
        completed_date DATE NULL,
        created_by VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_clinic_date (clinic_id, count_date)
      )
    `);
    console.log('  physical_inventory_counts table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 12. Physical Count Lines ──
  try {
    console.log('\n12. Creating physical_count_lines table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS physical_count_lines (
        id VARCHAR(36) PRIMARY KEY,
        count_id VARCHAR(36) NOT NULL,
        item_id VARCHAR(36) NOT NULL,
        location_id VARCHAR(36) NULL,
        batch_id VARCHAR(36) NULL,
        system_quantity INT DEFAULT 0,
        counted_quantity INT DEFAULT 0,
        variance INT DEFAULT 0,
        counted_by VARCHAR(36) NULL,
        count_time TIME NULL,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_count (count_id)
      )
    `);
    console.log('  physical_count_lines table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 13. Inventory Reservations ──
  try {
    console.log('\n13. Creating inventory_reservations table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS inventory_reservations (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        item_id VARCHAR(36) NOT NULL,
        location_id VARCHAR(36) NULL,
        reservation_type VARCHAR(50) DEFAULT 'prescription',
        quantity_reserved INT DEFAULT 0,
        reserve_date DATE NULL,
        required_date DATE NULL,
        reference_id VARCHAR(100) NULL,
        reference_type VARCHAR(50) NULL,
        status VARCHAR(20) DEFAULT 'reserved',
        fulfilled_date DATE NULL,
        reserved_by VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_clinic_item (clinic_id, item_id),
        INDEX idx_required_date (required_date),
        INDEX idx_status (status)
      )
    `);
    console.log('  inventory_reservations table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 14. Inventory Settings ──
  try {
    console.log('\n14. Creating inventory_settings table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS inventory_settings (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL UNIQUE,
        default_valuation_method VARCHAR(20) DEFAULT 'weighted_average',
        auto_create_po_at_min_stock BOOLEAN DEFAULT false,
        min_stock_alert_threshold INT DEFAULT 0,
        warn_expiry_days INT DEFAULT 30,
        auto_flag_expired BOOLEAN DEFAULT true,
        require_batch_entry_for_all BOOLEAN DEFAULT false,
        auto_post_cogs_monthly BOOLEAN DEFAULT true,
        cogs_posting_day INT DEFAULT 25,
        track_by_location BOOLEAN DEFAULT true,
        default_location_id VARCHAR(36) NULL,
        inventory_account_id VARCHAR(36) NULL,
        cogs_account_id VARCHAR(36) NULL,
        usage_account_id VARCHAR(36) NULL,
        adjustment_account_id VARCHAR(36) NULL,
        allow_negative_stock BOOLEAN DEFAULT false,
        require_approval_for_adjustments_above DECIMAL(15,2) DEFAULT 10000,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('  inventory_settings table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 15. Enhance GRN line items with inventory batch link ──
  try {
    console.log('\n15. Enhancing grn_line_items with inventory link...');
    await addColumnIfNotExists('grn_line_items', 'inventory_item_id', 'VARCHAR(36) NULL');
    await addColumnIfNotExists('grn_line_items', 'inventory_batch_id', 'VARCHAR(36) NULL');
    await addColumnIfNotExists('grn_line_items', 'unit_cost', 'DECIMAL(15,4) DEFAULT 0');
    console.log('  grn_line_items enhanced.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 16. Enhance PO line items with inventory item link ──
  try {
    console.log('\n16. Enhancing purchase_order_items with inventory link...');
    await addColumnIfNotExists('purchase_order_items', 'inventory_item_id', 'VARCHAR(36) NULL');
    await addColumnIfNotExists('purchase_order_items', 'inventory_location_id', 'VARCHAR(36) NULL');
    console.log('  purchase_order_items enhanced.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 17. Enhance drug_inventory with inventory_item link ──
  try {
    console.log('\n17. Enhancing drug_inventory with inventory_items link...');
    await addColumnIfNotExists('drug_inventory', 'inventory_item_id', 'VARCHAR(36) NULL');
    console.log('  drug_inventory enhanced.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  console.log('\n=== Inventory Tables Migration Complete ===');
}

// Run if called directly
if (require.main === module) {
  migrateInventoryTables()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { migrateInventoryTables };
