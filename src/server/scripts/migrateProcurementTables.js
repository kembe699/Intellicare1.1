/**
 * Procurement Module - Database Migration
 * Creates all procurement tables for the enterprise procurement workflow
 */
const { sequelize } = require('../models');

async function migrateProcurementTables() {
  console.log('=== Starting Procurement Tables Migration ===');

  // Helper: safe column add
  async function addColumnIfNotExists(table, column, definition) {
    try {
      await sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
      console.log(`  Added column ${column} to ${table}`);
    } catch (e) {
      console.log(`  Note: Could not add ${column} to ${table}: ${e.message}`);
    }
  }

  // ── 1. Enhance existing suppliers table with procurement fields ──
  try {
    console.log('\n1. Enhancing suppliers table...');
    if (true) {
      await addColumnIfNotExists('suppliers', 'clinic_id', 'INTEGER NULL');
      await addColumnIfNotExists('suppliers', 'supplier_code', "VARCHAR(50) NULL");
      await addColumnIfNotExists('suppliers', 'supplier_type', "VARCHAR(50) DEFAULT 'general'");
      await addColumnIfNotExists('suppliers', 'tax_id', 'VARCHAR(50) NULL');
      await addColumnIfNotExists('suppliers', 'bank_account_name', 'VARCHAR(255) NULL');
      await addColumnIfNotExists('suppliers', 'bank_account_number', 'VARCHAR(50) NULL');
      await addColumnIfNotExists('suppliers', 'bank_name', 'VARCHAR(255) NULL');
      await addColumnIfNotExists('suppliers', 'payment_terms', "VARCHAR(50) DEFAULT 'Net30'");
      await addColumnIfNotExists('suppliers', 'credit_limit', 'DECIMAL(15,2) DEFAULT 0');
      await addColumnIfNotExists('suppliers', 'currency', "VARCHAR(3) DEFAULT 'SSP'");
      await addColumnIfNotExists('suppliers', 'is_preferred', 'BOOLEAN DEFAULT false');
      await addColumnIfNotExists('suppliers', 'on_hold', 'BOOLEAN DEFAULT false');
      await addColumnIfNotExists('suppliers', 'hold_reason', 'TEXT NULL');
      await addColumnIfNotExists('suppliers', 'performance_rating', 'DECIMAL(3,1) DEFAULT 0');
      await addColumnIfNotExists('suppliers', 'total_purchases', 'DECIMAL(15,2) DEFAULT 0');
      await addColumnIfNotExists('suppliers', 'total_paid', 'DECIMAL(15,2) DEFAULT 0');
      await addColumnIfNotExists('suppliers', 'country', "VARCHAR(100) DEFAULT 'South Sudan'");
      console.log('  Suppliers table enhanced.');
    }
  } catch (e) {
    console.log('  Note: suppliers enhancement skipped:', e.message);
  }

  // ── 2. Enhance existing purchase_orders table ──
  try {
    console.log('\n2. Enhancing purchase_orders table...');
    if (true) {
      await addColumnIfNotExists('purchase_orders', 'clinic_id', 'INTEGER NULL');
      await addColumnIfNotExists('purchase_orders', 'pr_id', 'VARCHAR(36) NULL');
      await addColumnIfNotExists('purchase_orders', 'po_type', "VARCHAR(20) DEFAULT 'standard'");
      await addColumnIfNotExists('purchase_orders', 'delivery_address', 'TEXT NULL');
      await addColumnIfNotExists('purchase_orders', 'requested_delivery_date', 'DATE NULL');
      await addColumnIfNotExists('purchase_orders', 'expected_delivery_date', 'DATE NULL');
      await addColumnIfNotExists('purchase_orders', 'delivery_date_actual', 'DATE NULL');
      await addColumnIfNotExists('purchase_orders', 'subtotal', 'DECIMAL(15,2) DEFAULT 0');
      await addColumnIfNotExists('purchase_orders', 'tax_amount', 'DECIMAL(15,2) DEFAULT 0');
      await addColumnIfNotExists('purchase_orders', 'tax_rate', 'DECIMAL(5,2) DEFAULT 0');
      await addColumnIfNotExists('purchase_orders', 'shipping_cost', 'DECIMAL(15,2) DEFAULT 0');
      await addColumnIfNotExists('purchase_orders', 'po_currency', "VARCHAR(3) DEFAULT 'SSP'");
      await addColumnIfNotExists('purchase_orders', 'exchange_rate', 'DECIMAL(15,6) DEFAULT 1');
      await addColumnIfNotExists('purchase_orders', 'base_currency_total', 'DECIMAL(15,2) DEFAULT 0');
      await addColumnIfNotExists('purchase_orders', 'payment_terms', "VARCHAR(50) DEFAULT 'Net30'");
      await addColumnIfNotExists('purchase_orders', 'terms_conditions', 'TEXT NULL');
      await addColumnIfNotExists('purchase_orders', 'created_by', 'VARCHAR(36) NULL');
      console.log('  Purchase orders table enhanced.');
    }
  } catch (e) {
    console.log('  Note: purchase_orders enhancement skipped:', e.message);
  }

  // ── 3. Enhance purchase_order_items table ──
  try {
    console.log('\n3. Enhancing purchase_order_items table...');
    if (true) {
      await addColumnIfNotExists('purchase_order_items', 'line_number', 'INT DEFAULT 0');
      await addColumnIfNotExists('purchase_order_items', 'quantity_received', 'INT DEFAULT 0');
      await addColumnIfNotExists('purchase_order_items', 'quantity_invoiced', 'INT DEFAULT 0');
      await addColumnIfNotExists('purchase_order_items', 'tax_amount', 'DECIMAL(15,2) DEFAULT 0');
      await addColumnIfNotExists('purchase_order_items', 'cost_center_id', 'VARCHAR(36) NULL');
      await addColumnIfNotExists('purchase_order_items', 'gl_account_id', 'VARCHAR(36) NULL');
      await addColumnIfNotExists('purchase_order_items', 'status', "VARCHAR(20) DEFAULT 'pending'");
      console.log('  Purchase order items table enhanced.');
    }
  } catch (e) {
    console.log('  Note: purchase_order_items enhancement skipped:', e.message);
  }

  // ── 4. Purchase Requisitions ──
  try {
    console.log('\n4. Creating purchase_requisitions table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        pr_number VARCHAR(100) NOT NULL UNIQUE,
        requisition_date DATE NOT NULL,
        requested_by VARCHAR(36) NOT NULL,
        department VARCHAR(100) NULL,
        cost_center_id VARCHAR(36) NULL,
        requisition_type VARCHAR(20) DEFAULT 'routine',
        delivery_date_required DATE NULL,
        total_amount DECIMAL(15,2) DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'SSP',
        status VARCHAR(20) DEFAULT 'draft',
        approved_by VARCHAR(36) NULL,
        approval_date DATE NULL,
        rejection_reason TEXT NULL,
        notes TEXT NULL,
        created_by VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pr_clinic_status ON purchase_requisitions(clinic_id, status)`); } catch(e){}
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pr_clinic_date ON purchase_requisitions(clinic_id, requisition_date)`); } catch(e){}
    console.log('  purchase_requisitions table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 5. PR Line Items ──
  try {
    console.log('\n5. Creating pr_line_items table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS pr_line_items (
        id VARCHAR(36) PRIMARY KEY,
        pr_id VARCHAR(36) NOT NULL,
        line_number INT DEFAULT 0,
        item_code VARCHAR(100) NULL,
        item_description VARCHAR(255) NOT NULL,
        item_specification TEXT NULL,
        quantity_required INT NOT NULL DEFAULT 1,
        unit_of_measure VARCHAR(20) DEFAULT 'pcs',
        estimated_unit_price DECIMAL(10,2) DEFAULT 0,
        estimated_line_total DECIMAL(15,2) DEFAULT 0,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_prli_pr ON pr_line_items(pr_id)`); } catch(e){}
    console.log('  pr_line_items table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 6. Goods Receipt Notes ──
  try {
    console.log('\n6. Creating goods_receipt_notes table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS goods_receipt_notes (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        grn_number VARCHAR(100) NOT NULL UNIQUE,
        po_id INT NOT NULL,
        supplier_id INT NOT NULL,
        receipt_date DATE NOT NULL,
        received_by VARCHAR(36) NOT NULL,
        received_location VARCHAR(255) NULL,
        received_condition VARCHAR(50) DEFAULT 'good',
        total_items_received INT DEFAULT 0,
        notes TEXT NULL,
        status VARCHAR(30) DEFAULT 'pending_inspection',
        inspected_by VARCHAR(36) NULL,
        inspection_date DATE NULL,
        inspection_notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_grn_clinic_po ON goods_receipt_notes(clinic_id, po_id)`); } catch(e){}
    console.log('  goods_receipt_notes table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 7. GRN Line Items ──
  try {
    console.log('\n7. Creating grn_line_items table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS grn_line_items (
        id VARCHAR(36) PRIMARY KEY,
        grn_id VARCHAR(36) NOT NULL,
        po_line_item_id INT NULL,
        item_code VARCHAR(100) NULL,
        item_description VARCHAR(255) NULL,
        quantity_expected INT DEFAULT 0,
        quantity_received INT NOT NULL DEFAULT 0,
        unit_of_measure VARCHAR(20) NULL,
        item_condition VARCHAR(50) DEFAULT 'good',
        batch_number VARCHAR(100) NULL,
        expiry_date DATE NULL,
        serial_number VARCHAR(100) NULL,
        inspection_status VARCHAR(20) DEFAULT 'pass',
        inspection_notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_grnli_grn ON grn_line_items(grn_id)`); } catch(e){}
    console.log('  grn_line_items table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 8. Procurement Settings ──
  try {
    console.log('\n8. Creating procurement_settings table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS procurement_settings (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL UNIQUE,
        pr_approval_threshold DECIMAL(15,2) DEFAULT 10000,
        po_approval_threshold_level1 DECIMAL(15,2) DEFAULT 5000,
        po_approval_threshold_level2 DECIMAL(15,2) DEFAULT 25000,
        po_approval_threshold_level3 DECIMAL(15,2) DEFAULT 100000,
        require_grn_before_invoice BOOLEAN DEFAULT true,
        require_3way_matching BOOLEAN DEFAULT true,
        allow_over_receipt_percentage DECIMAL(5,2) DEFAULT 5,
        allow_price_variance_percentage DECIMAL(5,2) DEFAULT 2,
        require_quotes_for_amount_above DECIMAL(15,2) DEFAULT 50000,
        min_suppliers_for_quotes INT DEFAULT 3,
        enforce_budget_before_po BOOLEAN DEFAULT true,
        default_lead_days INT DEFAULT 7,
        default_payment_terms VARCHAR(50) DEFAULT 'Net30',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  procurement_settings table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  // ── 9. Supplier Performance ──
  try {
    console.log('\n9. Creating supplier_performance table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS supplier_performance (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        supplier_id INT NOT NULL,
        evaluation_date DATE NOT NULL,
        delivery_timeliness INT DEFAULT 3,
        quality_of_goods INT DEFAULT 3,
        communication INT DEFAULT 3,
        pricing_competitiveness INT DEFAULT 3,
        overall_rating DECIMAL(3,1) DEFAULT 3.0,
        comments TEXT NULL,
        evaluator_id VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sp_clinic_supplier ON supplier_performance(clinic_id, supplier_id)`); } catch(e){}
    console.log('  supplier_performance table created/verified.');
  } catch (e) {
    console.log('  Note:', e.message);
  }

  console.log('\n=== Procurement Tables Migration Complete ===');
}

// Run if called directly
if (require.main === module) {
  migrateProcurementTables()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { migrateProcurementTables };
