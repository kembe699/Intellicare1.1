const { sequelize } = require('../models');

async function migrateSchemes() {
  console.log('=== Starting Patient Schemes Migration ===\n');

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

  // Helper: create table if not exists
  async function createTableIfNotExists(name, sql) {
    try {
      const [tables] = await sequelize.query(`SHOW TABLES LIKE '${name}'`);
      if (tables.length === 0) {
        await sequelize.query(sql);
        console.log(`  Created table ${name}`);
      } else {
        console.log(`  Table ${name} already exists`);
      }
    } catch (e) {
      console.log(`  Note: ${name}: ${e.message}`);
    }
  }

  // ── 1. patient_schemes ──
  console.log('1. Creating patient_schemes table...');
  await createTableIfNotExists('patient_schemes', `
    CREATE TABLE patient_schemes (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      scheme_code VARCHAR(100) NOT NULL,
      scheme_name VARCHAR(255) NOT NULL,
      scheme_description TEXT,

      scheme_type ENUM(
        'insurance','corporate','individual','govt','ngo',
        'military','vip','student','senior_citizen','subsidized','other'
      ) NOT NULL DEFAULT 'individual',

      is_default BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      requires_verification BOOLEAN DEFAULT false,
      requires_approval BOOLEAN DEFAULT false,

      pricing_strategy ENUM('fixed','percentage','formula','tiered') DEFAULT 'fixed',
      base_markup_percentage DECIMAL(5,2) DEFAULT 0,
      base_discount_percentage DECIMAL(5,2) DEFAULT 0,

      is_insurance BOOLEAN DEFAULT false,
      insurance_provider_name VARCHAR(255),
      insurance_provider_code VARCHAR(100),
      requires_authorization BOOLEAN DEFAULT false,
      has_copay BOOLEAN DEFAULT true,
      default_copay_percentage DECIMAL(5,2) DEFAULT 10,
      copay_cap_per_visit DECIMAL(15,2),

      payment_terms VARCHAR(50) DEFAULT 'immediate',
      is_credit_allowed BOOLEAN DEFAULT false,
      credit_limit DECIMAL(15,2) DEFAULT 0,
      requires_deposit BOOLEAN DEFAULT false,
      deposit_amount DECIMAL(15,2),

      revenue_account_id CHAR(36),
      discount_account_id CHAR(36),

      approval_required_above DECIMAL(15,2),
      allows_negotiation BOOLEAN DEFAULT false,

      contact_person VARCHAR(255),
      contact_phone VARCHAR(20),
      contact_email VARCHAR(255),
      website VARCHAR(255),
      notes TEXT,

      created_by CHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      UNIQUE KEY uk_clinic_scheme_code (clinic_id, scheme_code),
      INDEX idx_clinic_active (clinic_id, is_active),
      INDEX idx_scheme_type (scheme_type)
    )
  `);

  // Add currency column if not exists
  await addColumnIfNotExists('patient_schemes', 'currency', "VARCHAR(3) DEFAULT 'SSP'");

  // ── 2. scheme_membership ──
  console.log('2. Creating scheme_membership table...');
  await createTableIfNotExists('scheme_membership', `
    CREATE TABLE scheme_membership (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      scheme_id CHAR(36) NOT NULL,
      patient_id VARCHAR(255) NOT NULL,

      member_number VARCHAR(100),
      effective_from DATE NOT NULL,
      effective_to DATE,
      is_active BOOLEAN DEFAULT true,

      verified BOOLEAN DEFAULT false,
      verified_by CHAR(36),
      verified_date DATE,
      verification_document_path VARCHAR(500),

      relationship_to_member VARCHAR(100) DEFAULT 'self',
      notes TEXT,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      UNIQUE KEY uk_patient_scheme (patient_id, scheme_id),
      INDEX idx_clinic_scheme (clinic_id, scheme_id),
      INDEX idx_patient_active (patient_id, is_active)
    )
  `);

  // ── 3. scheme_changes_history ──
  console.log('3. Creating scheme_changes_history table...');
  await createTableIfNotExists('scheme_changes_history', `
    CREATE TABLE scheme_changes_history (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      scheme_id CHAR(36) NOT NULL,

      change_type VARCHAR(100),
      field_changed VARCHAR(255),
      old_value TEXT,
      new_value TEXT,
      change_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      changed_by CHAR(36),
      reason TEXT,

      INDEX idx_scheme_date (scheme_id, change_date)
    )
  `);

  // ── 4. scheme_service_pricing ──
  console.log('4. Creating scheme_service_pricing table...');
  await createTableIfNotExists('scheme_service_pricing', `
    CREATE TABLE scheme_service_pricing (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      scheme_id CHAR(36) NOT NULL,
      service_id CHAR(36) NOT NULL,

      scheme_price DECIMAL(15,2),
      scheme_currency VARCHAR(3) DEFAULT 'SSP',

      markup_percentage DECIMAL(5,2) DEFAULT 0,
      discount_percentage DECIMAL(5,2) DEFAULT 0,

      insurance_copay DECIMAL(15,2),
      insurance_copay_percentage DECIMAL(5,2),
      insurance_coverage_amount DECIMAL(15,2),

      effective_from DATE,
      effective_to DATE,
      is_active BOOLEAN DEFAULT true,

      notes TEXT,
      revenue_account_id CHAR(36),

      created_by CHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      UNIQUE KEY uk_scheme_service_date (scheme_id, service_id, effective_from),
      INDEX idx_clinic_scheme (clinic_id, scheme_id),
      INDEX idx_service_active (service_id, is_active)
    )
  `);

  // ── 5. scheme_service_pricing_history ──
  console.log('5. Creating scheme_service_pricing_history table...');
  await createTableIfNotExists('scheme_service_pricing_history', `
    CREATE TABLE scheme_service_pricing_history (
      id CHAR(36) PRIMARY KEY,
      scheme_id CHAR(36) NOT NULL,
      service_id CHAR(36) NOT NULL,

      old_price DECIMAL(15,2),
      new_price DECIMAL(15,2),
      old_copay DECIMAL(15,2),
      new_copay DECIMAL(15,2),
      price_change_reason TEXT,
      effective_date DATE,
      changed_by CHAR(36),
      change_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      INDEX idx_scheme_service (scheme_id, service_id)
    )
  `);

  // ── 6. scheme_product_pricing ──
  console.log('6. Creating scheme_product_pricing table...');
  await createTableIfNotExists('scheme_product_pricing', `
    CREATE TABLE scheme_product_pricing (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      scheme_id CHAR(36) NOT NULL,
      product_id CHAR(36) NOT NULL,
      product_type ENUM('drug','supply','equipment','other') DEFAULT 'drug',

      scheme_price DECIMAL(15,2),
      scheme_currency VARCHAR(3) DEFAULT 'SSP',

      markup_percentage DECIMAL(5,2) DEFAULT 0,
      discount_percentage DECIMAL(5,2) DEFAULT 0,

      insurance_copay DECIMAL(15,2),
      insurance_copay_percentage DECIMAL(5,2),
      insurance_coverage_amount DECIMAL(15,2),

      min_quantity INT,
      max_quantity INT,

      effective_from DATE,
      effective_to DATE,
      is_active BOOLEAN DEFAULT true,

      notes TEXT,

      created_by CHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      UNIQUE KEY uk_scheme_product_date (scheme_id, product_id, product_type, effective_from),
      INDEX idx_clinic_scheme (clinic_id, scheme_id),
      INDEX idx_product_pricing (product_id, product_type)
    )
  `);

  // ── 7. scheme_product_pricing_history ──
  console.log('7. Creating scheme_product_pricing_history table...');
  await createTableIfNotExists('scheme_product_pricing_history', `
    CREATE TABLE scheme_product_pricing_history (
      id CHAR(36) PRIMARY KEY,
      scheme_id CHAR(36) NOT NULL,
      product_id CHAR(36) NOT NULL,
      product_type VARCHAR(50),

      old_price DECIMAL(15,2),
      new_price DECIMAL(15,2),
      old_copay DECIMAL(15,2),
      new_copay DECIMAL(15,2),
      price_change_reason TEXT,
      effective_date DATE,
      changed_by CHAR(36),
      change_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      INDEX idx_scheme_product (scheme_id, product_id)
    )
  `);

  // ── 8. scheme_tiered_pricing ──
  console.log('8. Creating scheme_tiered_pricing table...');
  await createTableIfNotExists('scheme_tiered_pricing', `
    CREATE TABLE scheme_tiered_pricing (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      scheme_id CHAR(36) NOT NULL,
      service_id CHAR(36),
      product_id CHAR(36),
      product_type VARCHAR(50),

      tier_level INT,
      tier_name VARCHAR(100),

      min_quantity INT,
      max_quantity INT,

      tier_price DECIMAL(15,2),
      tier_currency VARCHAR(3) DEFAULT 'SSP',
      tier_discount_percentage DECIMAL(5,2) DEFAULT 0,

      tier_copay DECIMAL(15,2),

      effective_from DATE,
      effective_to DATE,
      is_active BOOLEAN DEFAULT true,

      created_by CHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      INDEX idx_scheme_tier (scheme_id, tier_level)
    )
  `);

  // ── 9. scheme_discounts ──
  console.log('9. Creating scheme_discounts table...');
  await createTableIfNotExists('scheme_discounts', `
    CREATE TABLE scheme_discounts (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      scheme_id CHAR(36) NOT NULL,

      discount_code VARCHAR(100) NOT NULL,
      discount_type ENUM('percentage','fixed_amount','bundle','loyalty') DEFAULT 'percentage',
      discount_name VARCHAR(255),
      discount_value DECIMAL(15,2),

      applies_to ENUM('all_services','selected_services','all_products','selected_products','all') DEFAULT 'all',
      service_ids JSON,
      product_ids JSON,

      min_bill_amount DECIMAL(15,2),
      min_items_qty INT,

      effective_from DATE,
      effective_to DATE,
      is_active BOOLEAN DEFAULT true,

      requires_approval BOOLEAN DEFAULT false,
      approval_by_roles JSON,

      notes TEXT,

      created_by CHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      UNIQUE KEY uk_discount_code (clinic_id, discount_code),
      INDEX idx_clinic_scheme (clinic_id, scheme_id)
    )
  `);

  // ── 10. scheme_negotiated_prices ──
  console.log('10. Creating scheme_negotiated_prices table...');
  await createTableIfNotExists('scheme_negotiated_prices', `
    CREATE TABLE scheme_negotiated_prices (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      scheme_id CHAR(36) NOT NULL,

      negotiation_number VARCHAR(100) NOT NULL,
      negotiation_date DATE,
      negotiated_by_user_id CHAR(36),

      applies_to VARCHAR(100),
      reference_id CHAR(36),
      negotiation_type ENUM('bulk_purchase','annual_contract','special_event','custom') DEFAULT 'custom',

      negotiated_price DECIMAL(15,2),
      original_price DECIMAL(15,2),
      discount_amount DECIMAL(15,2),
      discount_percentage DECIMAL(5,2),

      valid_from DATE,
      valid_to DATE,
      quantity_limit INT,
      quantity_used INT DEFAULT 0,

      approved_by CHAR(36),
      approval_date TIMESTAMP NULL,
      approval_notes TEXT,

      status ENUM('proposed','approved','active','expired','cancelled') DEFAULT 'proposed',

      notes TEXT,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      UNIQUE KEY uk_neg_number (clinic_id, negotiation_number),
      INDEX idx_clinic_scheme (clinic_id, scheme_id),
      INDEX idx_status (status)
    )
  `);

  // ── 11. scheme_price_rules ──
  console.log('11. Creating scheme_price_rules table...');
  await createTableIfNotExists('scheme_price_rules', `
    CREATE TABLE scheme_price_rules (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      scheme_id CHAR(36) NOT NULL,

      rule_name VARCHAR(255),
      rule_description TEXT,

      condition_type ENUM('service_category','product_category','amount_range','quantity_range','custom') DEFAULT 'service_category',
      condition_value VARCHAR(255),

      action_type ENUM('apply_markup','apply_discount','fixed_price','formula') DEFAULT 'apply_discount',
      action_value DECIMAL(15,2),

      formula TEXT,

      priority INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,

      created_by CHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      INDEX idx_scheme_rules (scheme_id, is_active)
    )
  `);

  // ── 12. ALTER patients table ──
  console.log('12. Adding default_scheme_id to patients table...');
  await addColumnIfNotExists('patients', 'default_scheme_id', 'CHAR(36)');

  // ── 13. ALTER patient_insurance (if exists) ──
  console.log('13. Adding scheme_id to patient_insurance table...');
  await addColumnIfNotExists('patient_insurance', 'scheme_id', 'CHAR(36)');

  // ── 14. Seed default schemes ──
  console.log('14. Seeding default schemes...');
  try {
    const [existing] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM patient_schemes`);
    if (existing[0].cnt === 0) {
      const { v4: uuidv4 } = require('uuid');
      const defaults = [
        { code: 'INDIVIDUAL', name: 'Individual / Self-Paying', type: 'individual', isDefault: true, isInsurance: false, copay: 0 },
        { code: 'NHIF', name: 'National Health Insurance Fund', type: 'insurance', isDefault: false, isInsurance: true, copay: 10 },
        { code: 'PRIVATE_INS', name: 'Private Insurance', type: 'insurance', isDefault: false, isInsurance: true, copay: 20 },
        { code: 'CORPORATE', name: 'Corporate / Employer', type: 'corporate', isDefault: false, isInsurance: false, copay: 0 },
        { code: 'NGO', name: 'NGO / Charity', type: 'ngo', isDefault: false, isInsurance: false, copay: 0 },
        { code: 'GOVT', name: 'Government / Public', type: 'govt', isDefault: false, isInsurance: false, copay: 0 },
        { code: 'VIP', name: 'VIP / Premium', type: 'vip', isDefault: false, isInsurance: false, copay: 0 },
        { code: 'STUDENT', name: 'Student / Educational', type: 'student', isDefault: false, isInsurance: false, copay: 0 },
      ];
      for (const s of defaults) {
        await sequelize.query(`
          INSERT INTO patient_schemes (id, clinic_id, scheme_code, scheme_name, scheme_type,
            is_default, is_active, is_insurance, default_copay_percentage, pricing_strategy)
          VALUES (:id, 1, :code, :name, :type, :isDefault, true, :isIns, :copay, 'fixed')
        `, {
          replacements: {
            id: uuidv4(), code: s.code, name: s.name, type: s.type,
            isDefault: s.isDefault, isIns: s.isInsurance, copay: s.copay
          }
        });
      }
      console.log('  Seeded 8 default schemes');
    } else {
      console.log('  Schemes already exist, skipping seed');
    }
  } catch (e) {
    console.log('  Note: Seeding skipped:', e.message);
  }

  console.log('\n=== Patient Schemes Migration Complete ===');
}

module.exports = { migrateSchemes };
