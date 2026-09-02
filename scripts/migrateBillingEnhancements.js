const { sequelize } = require('../models');

async function migrateBillingEnhancements() {
  console.log('=== Starting Billing Enhancements Migration ===\n');

  // Helper: add column if not exists
  async function addColumnIfNotExists(table, column, definition) {
    try {
      const [cols] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
      if (cols.length === 0) {
        await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`  Added ${table}.${column}`);
      }
    } catch (e) {
      if (e.original && e.original.code === 'ER_NO_SUCH_TABLE') {
        console.log(`  Table ${table} does not exist yet, skipping column ${column}`);
      } else {
        console.log(`  Note: Could not add ${table}.${column}: ${e.message}`);
      }
    }
  }

  // 1. Enhance patient_bills table
  console.log('1. Enhancing patient_bills table...');
  const billColumns = [
    ['scheme_id', 'VARCHAR(36) NULL'],
    ['scheme_name', 'VARCHAR(255) NULL'],
    ['scheme_pricing_applied', 'BOOLEAN DEFAULT FALSE'],
    ['bill_currency', "VARCHAR(3) DEFAULT 'SSP'"],
    ['exchange_rate', 'DECIMAL(15,6) DEFAULT 1.000000'],
    ['base_currency_total', 'DECIMAL(15,2) DEFAULT 0'],
    ['clinical_total', 'DECIMAL(15,2) DEFAULT 0'],
    ['lab_total', 'DECIMAL(15,2) DEFAULT 0'],
    ['pharmacy_total', 'DECIMAL(15,2) DEFAULT 0'],
    ['supply_total', 'DECIMAL(15,2) DEFAULT 0'],
    ['procedure_total', 'DECIMAL(15,2) DEFAULT 0'],
    ['accommodation_total', 'DECIMAL(15,2) DEFAULT 0'],
    ['other_total', 'DECIMAL(15,2) DEFAULT 0'],
    ['discount_amount', 'DECIMAL(15,2) DEFAULT 0'],
    ['discount_type', "VARCHAR(50)"],
    ['discount_reason', 'TEXT'],
    ['discount_approved_by', 'VARCHAR(36)'],
    ['discount_approval_date', 'TIMESTAMP NULL'],
    ['adjustment_amount', 'DECIMAL(15,2) DEFAULT 0'],
    ['adjustment_reason', 'TEXT'],
    ['insurance_type', 'VARCHAR(100)'],
    ['insurance_member_id', 'VARCHAR(255)'],
    ['insurance_copay', 'DECIMAL(15,2) DEFAULT 0'],
    ['insurance_coverage_amount', 'DECIMAL(15,2) DEFAULT 0'],
    ['insurance_claim_submitted', 'BOOLEAN DEFAULT false'],
    ['insurance_claim_date', 'DATE NULL'],
    ['insurance_approval_code', 'VARCHAR(100)'],
    ['payment_terms', "VARCHAR(50) DEFAULT 'immediate'"],
    ['original_due_date', 'DATE NULL'],
    ['extended_due_date', 'DATE NULL'],
    ['days_overdue', 'INT DEFAULT 0'],
    ['is_overdue', 'BOOLEAN DEFAULT false'],
    ['is_credit_bill', 'BOOLEAN DEFAULT false'],
    ['credit_approved_by', 'VARCHAR(36)'],
    ['credit_approval_date', 'TIMESTAMP NULL'],
    ['credit_limit_used', 'DECIMAL(15,2) DEFAULT 0'],
    ['main_gl_entry_id', 'VARCHAR(36)'],
    ['aging_category', "VARCHAR(20) DEFAULT 'current'"],
    ['last_payment_date', 'DATE NULL'],
    ['requires_follow_up', 'BOOLEAN DEFAULT false'],
    ['follow_up_date', 'DATE NULL'],
    ['follow_up_notes', 'TEXT']
  ];
  for (const [col, def] of billColumns) {
    await addColumnIfNotExists('patient_bills', col, def);
  }
  console.log('  patient_bills enhanced.\n');

  // 2. Create bill_line_items table
  console.log('2. Creating bill_line_items table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS bill_line_items (
        id VARCHAR(36) PRIMARY KEY,
        bill_id VARCHAR(36) NOT NULL,
        line_number INT,
        service_category VARCHAR(50) DEFAULT 'other',
        service_code VARCHAR(100),
        service_name VARCHAR(255) NOT NULL,
        source_module VARCHAR(50),
        source_id VARCHAR(36),
        quantity INT DEFAULT 1,
        unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
        line_currency VARCHAR(3) DEFAULT 'SSP',
        exchange_rate DECIMAL(15,6) DEFAULT 1.000000,
        base_currency_unit_price DECIMAL(15,2) DEFAULT 0,
        line_total DECIMAL(15,2) DEFAULT 0,
        base_currency_total DECIMAL(15,2) DEFAULT 0,
        paid_amount DECIMAL(15,2) DEFAULT 0,
        balance_amount DECIMAL(15,2) DEFAULT 0,
        item_status VARCHAR(20) DEFAULT 'pending',
        patient_copay DECIMAL(15,2) DEFAULT 0,
        insurance_coverage DECIMAL(15,2) DEFAULT 0,
        item_discount DECIMAL(15,2) DEFAULT 0,
        discount_percentage DECIMAL(5,2) DEFAULT 0,
        revenue_account_id VARCHAR(36),
        gl_entry_id VARCHAR(36),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bill (bill_id),
        INDEX idx_source (source_module, source_id),
        INDEX idx_category (service_category),
        INDEX idx_status (item_status)
      )
    `);
    console.log('  bill_line_items table created/verified.\n');
  } catch (e) {
    console.log('  Note: bill_line_items:', e.message, '\n');
  }

  // 3. Enhance receipts table
  console.log('3. Enhancing receipts table...');
  const receiptColumns = [
    ['receipt_currency', "VARCHAR(3) DEFAULT 'SSP'"],
    ['exchange_rate', 'DECIMAL(15,6) DEFAULT 1.000000'],
    ['base_currency_amount', 'DECIMAL(15,2) DEFAULT 0'],
    ['payment_description', 'TEXT'],
    ['reference_number', 'VARCHAR(100)'],
    ['insurance_payment', 'BOOLEAN DEFAULT false'],
    ['insurance_claim_ref', 'VARCHAR(100)'],
    ['cash_gl_entry_id', 'VARCHAR(36)'],
    ['receivables_gl_entry_id', 'VARCHAR(36)'],
    ['is_voided', 'BOOLEAN DEFAULT false'],
    ['is_refunded', 'BOOLEAN DEFAULT false'],
    ['refund_amount', 'DECIMAL(15,2) DEFAULT 0'],
    ['refund_date', 'DATE NULL'],
    ['refund_reason', 'TEXT'],
    ['reversal_gl_entry_id', 'VARCHAR(36)'],
    ['bank_transaction_id', 'VARCHAR(36)'],
    ['is_reconciled', 'BOOLEAN DEFAULT false'],
    ['reconciliation_date', 'DATE NULL']
  ];
  for (const [col, def] of receiptColumns) {
    await addColumnIfNotExists('receipts', col, def);
  }
  console.log('  receipts enhanced.\n');

  // 4. Enhance services table
  console.log('4. Enhancing services table...');
  const serviceColumns = [
    ['service_category', "VARCHAR(50) DEFAULT 'other'"],
    ['service_code', 'VARCHAR(100)'],
    ['price_kes', 'DECIMAL(15,2)'],
    ['price_usd', 'DECIMAL(15,2)'],
    ['price_ssp', 'DECIMAL(15,2)'],
    ['revenue_account_id', 'VARCHAR(36)'],
    ['nhif_approved', 'BOOLEAN DEFAULT false'],
    ['nhif_rate', 'DECIMAL(15,2)'],
    ['patient_copay_amount', 'DECIMAL(15,2) DEFAULT 0'],
    ['is_consumable', 'BOOLEAN DEFAULT false'],
    ['inventory_item_id', 'VARCHAR(36)'],
    ['requires_quantity', 'BOOLEAN DEFAULT true'],
    ['unit_of_measure', 'VARCHAR(20)']
  ];
  for (const [col, def] of serviceColumns) {
    await addColumnIfNotExists('services', col, def);
  }
  console.log('  services enhanced.\n');

  // 5. Create bill_discounts table
  console.log('5. Creating bill_discounts table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS bill_discounts (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        bill_id VARCHAR(36) NOT NULL,
        discount_number VARCHAR(100) UNIQUE NOT NULL,
        discount_type VARCHAR(50) DEFAULT 'fixed_amount',
        discount_amount DECIMAL(15,2) DEFAULT 0,
        discount_percentage DECIMAL(5,2) DEFAULT 0,
        reason TEXT,
        approved_by VARCHAR(36),
        approval_date TIMESTAMP NULL,
        approval_notes TEXT,
        discount_gl_entry_id VARCHAR(36),
        created_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bill (bill_id),
        INDEX idx_clinic (clinic_id)
      )
    `);
    console.log('  bill_discounts table created/verified.\n');
  } catch (e) {
    console.log('  Note: bill_discounts:', e.message, '\n');
  }

  // 6. Create credit_notes table
  console.log('6. Creating credit_notes table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS credit_notes (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        credit_note_number VARCHAR(100) UNIQUE NOT NULL,
        original_bill_id VARCHAR(36) NOT NULL,
        patient_id VARCHAR(255) NOT NULL,
        patient_name VARCHAR(255),
        credit_date DATE,
        credit_amount DECIMAL(15,2) DEFAULT 0,
        credit_currency VARCHAR(3) DEFAULT 'SSP',
        reason VARCHAR(50),
        reason_details TEXT,
        approved_by VARCHAR(36),
        approval_date TIMESTAMP NULL,
        applied_to_bill_id VARCHAR(36),
        applied_date DATE NULL,
        applied_amount DECIMAL(15,2) DEFAULT 0,
        credit_gl_entry_id VARCHAR(36),
        reversal_gl_entry_id VARCHAR(36),
        application_gl_entry_id VARCHAR(36),
        status VARCHAR(20) DEFAULT 'created',
        created_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bill (original_bill_id),
        INDEX idx_patient (patient_id),
        INDEX idx_status (status)
      )
    `);
    console.log('  credit_notes table created/verified.\n');
  } catch (e) {
    console.log('  Note: credit_notes:', e.message, '\n');
  }

  // 7. Create patient_insurance table
  console.log('7. Creating patient_insurance table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS patient_insurance (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        patient_id VARCHAR(255) NOT NULL,
        insurance_type VARCHAR(50) DEFAULT 'nhif',
        insurance_provider VARCHAR(255),
        member_id VARCHAR(255),
        member_name VARCHAR(255),
        nhif_member_number VARCHAR(50),
        nhif_status VARCHAR(20) DEFAULT 'active',
        nhif_card_number VARCHAR(50),
        effective_from DATE NULL,
        effective_to DATE NULL,
        is_active BOOLEAN DEFAULT true,
        copay_percentage DECIMAL(5,2) DEFAULT 0,
        copay_max_per_visit DECIMAL(15,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_patient (patient_id, is_active),
        INDEX idx_clinic (clinic_id)
      )
    `);
    console.log('  patient_insurance table created/verified.\n');
  } catch (e) {
    console.log('  Note: patient_insurance:', e.message, '\n');
  }

  // 8. Create billing_settings table
  console.log('8. Creating billing_settings table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS billing_settings (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        default_currency VARCHAR(3) DEFAULT 'SSP',
        default_revenue_account_id VARCHAR(36),
        default_payment_terms VARCHAR(50) DEFAULT 'immediate',
        default_due_date_days INT DEFAULT 30,
        allow_discounts BOOLEAN DEFAULT true,
        discount_approval_required_above DECIMAL(15,2) DEFAULT 0,
        nhif_enabled BOOLEAN DEFAULT false,
        nhif_copay_percentage DECIMAL(5,2) DEFAULT 10,
        auto_apply_insurance_copay BOOLEAN DEFAULT true,
        multi_currency_enabled BOOLEAN DEFAULT false,
        accepted_currencies JSON,
        auto_bill_on_service BOOLEAN DEFAULT true,
        auto_bill_pharmacy_dispensing BOOLEAN DEFAULT true,
        auto_bill_lab_tests BOOLEAN DEFAULT true,
        auto_bill_clinical_visits BOOLEAN DEFAULT true,
        auto_post_to_gl BOOLEAN DEFAULT true,
        post_immediately BOOLEAN DEFAULT true,
        auto_calculate_aging BOOLEAN DEFAULT true,
        send_overdue_notices BOOLEAN DEFAULT false,
        overdue_notice_days INT DEFAULT 30,
        write_off_after_days INT DEFAULT 180,
        auto_write_off BOOLEAN DEFAULT false,
        allow_refunds BOOLEAN DEFAULT true,
        refund_approval_required BOOLEAN DEFAULT true,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_clinic (clinic_id)
      )
    `);
    console.log('  billing_settings table created/verified.\n');
  } catch (e) {
    console.log('  Note: billing_settings:', e.message, '\n');
  }

  // 9. Create insurance_claims table
  console.log('9. Creating insurance_claims table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS insurance_claims (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        claim_number VARCHAR(100) UNIQUE NOT NULL,
        bill_id VARCHAR(36) NOT NULL,
        patient_id VARCHAR(255) NOT NULL,
        patient_name VARCHAR(255),
        insurance_provider VARCHAR(255),
        insurance_type VARCHAR(50),
        member_id VARCHAR(255),
        claim_amount DECIMAL(15,2) DEFAULT 0,
        claim_currency VARCHAR(3) DEFAULT 'SSP',
        claim_date DATE,
        submission_date DATE NULL,
        approval_code VARCHAR(100),
        approval_date DATE NULL,
        approved_amount DECIMAL(15,2) DEFAULT 0,
        paid_amount DECIMAL(15,2) DEFAULT 0,
        payment_date DATE NULL,
        payment_reference VARCHAR(255),
        rejection_reason TEXT,
        gl_entry_id VARCHAR(36),
        payment_gl_entry_id VARCHAR(36),
        status VARCHAR(20) DEFAULT 'draft',
        notes TEXT,
        created_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bill (bill_id),
        INDEX idx_patient (patient_id),
        INDEX idx_status (status),
        INDEX idx_clinic (clinic_id)
      )
    `);
    console.log('  insurance_claims table created/verified.\n');
  } catch (e) {
    console.log('  Note: insurance_claims:', e.message, '\n');
  }

  // 10. Create billing_follow_ups table
  console.log('10. Creating billing_follow_ups table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS billing_follow_ups (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        bill_id VARCHAR(36) NOT NULL,
        patient_id VARCHAR(255) NOT NULL,
        follow_up_date DATE NOT NULL,
        follow_up_type VARCHAR(50) DEFAULT 'phone',
        follow_up_notes TEXT,
        outcome VARCHAR(50),
        next_follow_up_date DATE NULL,
        performed_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bill (bill_id),
        INDEX idx_date (follow_up_date)
      )
    `);
    console.log('  billing_follow_ups table created/verified.\n');
  } catch (e) {
    console.log('  Note: billing_follow_ups:', e.message, '\n');
  }

  console.log('=== Billing Enhancements Migration Complete ===');
}

module.exports = { migrateBillingEnhancements };
