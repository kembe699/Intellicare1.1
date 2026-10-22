const { sequelize } = require('../models');

async function migratePharmacyTables() {
  console.log('=== Starting Pharmacy Tables Migration ===\n');

  // 1. Drugs Master
  console.log('1. Creating drugs table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS drugs (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      drug_code VARCHAR(100) NOT NULL,
      drug_name VARCHAR(255) NOT NULL,
      generic_name VARCHAR(255),
      drug_description TEXT,

      inventory_item_id VARCHAR(36),

      strength VARCHAR(100),
      unit_of_measure VARCHAR(20) DEFAULT 'tablet',
      dosage_form VARCHAR(50) DEFAULT 'tablet',

      therapeutic_category VARCHAR(100),
      atc_code VARCHAR(50),
      is_controlled_substance BOOLEAN DEFAULT false,
      is_scheduled BOOLEAN DEFAULT false,

      price_kes DECIMAL(10,2) DEFAULT 0,
      price_usd DECIMAL(10,2) DEFAULT 0,
      price_ssp DECIMAL(10,2) DEFAULT 0,
      default_currency VARCHAR(3) DEFAULT 'KES',

      revenue_account_id VARCHAR(36),
      cogs_account_id VARCHAR(36),

      requires_prescription BOOLEAN DEFAULT true,
      max_quantity_per_prescription INT DEFAULT 100,
      shelf_life_days INT DEFAULT 365,
      requires_cold_storage BOOLEAN DEFAULT false,

      drug_allergy_keywords JSON,
      major_drug_interactions JSON,

      is_active BOOLEAN DEFAULT true,
      discontinued_date DATE,
      notes TEXT,

      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  drugs table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_drugs_clinic_code ON drugs(clinic_id, drug_code)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_drugs_inventory ON drugs(inventory_item_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_drugs_category ON drugs(therapeutic_category)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_drugs_active ON drugs(is_active)`); } catch(e){}

  // 2. Drug Pricing History
  console.log('2. Creating drug_pricing_history table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS drug_pricing_history (
      id VARCHAR(36) PRIMARY KEY,
      drug_id VARCHAR(36) NOT NULL,
      price_currency VARCHAR(3) DEFAULT 'KES',
      price_amount DECIMAL(10,2),
      effective_from DATE,
      effective_to DATE,
      reason_for_change VARCHAR(255),
      changed_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  drug_pricing_history table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_dph_drug_date ON drug_pricing_history(drug_id, effective_from)`); } catch(e){}

  // 3. Drug Interactions
  console.log('3. Creating drug_interactions table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS drug_interactions (
      id VARCHAR(36) PRIMARY KEY,
      drug1_id VARCHAR(36) NOT NULL,
      drug2_id VARCHAR(36) NOT NULL,
      interaction_type VARCHAR(20) DEFAULT 'moderate',
      interaction_description TEXT,
      management_notes TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_interaction UNIQUE (drug1_id, drug2_id)
    )
  `);
  console.log('  drug_interactions table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_di_drug1 ON drug_interactions(drug1_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_di_drug2 ON drug_interactions(drug2_id)`); } catch(e){}

  // 4. Drug Allergies
  console.log('4. Creating drug_allergies table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS drug_allergies (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      patient_id VARCHAR(36) NOT NULL,
      drug_id VARCHAR(36),
      drug_class VARCHAR(100),
      allergy_description TEXT,
      severity VARCHAR(20) DEFAULT 'moderate',
      reaction_description TEXT,
      verified_date DATE,
      verified_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  drug_allergies table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_da_patient ON drug_allergies(patient_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_da_drug ON drug_allergies(drug_id)`); } catch(e){}

  // 5. Prescriptions
  console.log('5. Creating pharmacy_prescriptions table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_prescriptions (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      prescription_number VARCHAR(100) NOT NULL,
      visit_id VARCHAR(36),
      patient_id VARCHAR(36) NOT NULL,
      doctor_id VARCHAR(36),

      prescription_date DATE NOT NULL,
      prescribed_by_name VARCHAR(255),
      prescription_notes TEXT,
      special_instructions TEXT,

      status VARCHAR(30) DEFAULT 'pending',
      cancelled_date DATE,
      cancellation_reason TEXT,
      expires_date DATE,

      valid_for_days INT DEFAULT 30,
      number_of_refills_allowed INT DEFAULT 0,

      allergy_check_done BOOLEAN DEFAULT false,
      allergy_check_date DATE,
      allergy_check_by_id VARCHAR(36),
      allergy_warnings JSON,

      interaction_check_done BOOLEAN DEFAULT false,
      interaction_check_date DATE,
      interaction_warnings JSON,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  pharmacy_prescriptions table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pp_clinic_status ON pharmacy_prescriptions(clinic_id, status)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pp_patient_date ON pharmacy_prescriptions(patient_id, prescription_date)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pp_visit ON pharmacy_prescriptions(visit_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pp_rx_number ON pharmacy_prescriptions(prescription_number)`); } catch(e){}

  // 6. Prescription Lines
  console.log('6. Creating prescription_lines table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS prescription_lines (
      id VARCHAR(36) PRIMARY KEY,
      prescription_id VARCHAR(36) NOT NULL,
      line_number INT DEFAULT 1,
      drug_id VARCHAR(36) NOT NULL,

      quantity_prescribed INT DEFAULT 1,
      unit_of_measure VARCHAR(20) DEFAULT 'tablet',
      dose_strength VARCHAR(100),
      frequency VARCHAR(100),
      duration_days INT,

      allow_generic_substitution BOOLEAN DEFAULT true,
      allow_brand_substitution BOOLEAN DEFAULT false,
      preferred_generic VARCHAR(255),
      preferred_brand VARCHAR(255),

      status VARCHAR(30) DEFAULT 'pending',
      total_quantity_dispensed INT DEFAULT 0,

      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  prescription_lines table created/verified.');
  // A drug the hospital doesn't stock, which the patient buys outside.
  //
  // drug_id has to become nullable for this: an external item has no
  // inventory_items row to point at, and that is exactly what distinguishes it.
  // The name is then carried as text, and is_external is what the pharmacy and
  // the printed prescription key off — so an out-of-stock item is never
  // mistaken for something waiting to be dispensed here.
  try { await sequelize.query(`ALTER TABLE prescription_lines ALTER COLUMN drug_id DROP NOT NULL`); } catch(e){}
  try { await sequelize.query(`ALTER TABLE prescription_lines ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT false`); } catch(e){}
  try { await sequelize.query(`ALTER TABLE prescription_lines ADD COLUMN IF NOT EXISTS external_drug_name VARCHAR(255)`); } catch(e){}
  // Dose amount per administration, kept apart from dose_strength ("500mg"),
  // because the quantity arithmetic needs a number: qty = dose x perDay x days.
  try { await sequelize.query(`ALTER TABLE prescription_lines ADD COLUMN IF NOT EXISTS dose_amount NUMERIC(10,2)`); } catch(e){}
  // Which stock_locations row this line is meant to be dispensed from —
  // purely informational/validation at prescribing time (actual stock
  // deduction still only happens at the separate dispensing step); lets
  // POST /prescriptions check stock_by_location for this location instead
  // of the global pool, and shows staff where a line is expected to come
  // from right on the Visit Summary.
  try { await sequelize.query(`ALTER TABLE prescription_lines ADD COLUMN IF NOT EXISTS location_id VARCHAR(36)`); } catch(e){}
  try { await sequelize.query(`ALTER TABLE prescription_lines ADD COLUMN IF NOT EXISTS location_name VARCHAR(255)`); } catch(e){}

  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pl_prescription ON prescription_lines(prescription_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pl_drug ON prescription_lines(drug_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pl_status ON prescription_lines(status)`); } catch(e){}

  // 7. Dispensing Records
  console.log('7. Creating dispensing_records table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS dispensing_records (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      dispensing_number VARCHAR(100) NOT NULL,
      prescription_id VARCHAR(36),
      prescription_line_id VARCHAR(36),

      patient_id VARCHAR(36),
      drug_id VARCHAR(36) NOT NULL,
      pharmacist_id VARCHAR(36),

      inventory_item_id VARCHAR(36),
      batch_id VARCHAR(36),
      from_location_id VARCHAR(36),

      dispensing_date DATE NOT NULL,
      dispensing_time TIME,
      quantity_dispensed INT NOT NULL DEFAULT 1,
      unit_of_measure VARCHAR(20) DEFAULT 'tablet',

      unit_price DECIMAL(10,2) DEFAULT 0,
      currency_code VARCHAR(3) DEFAULT 'KES',
      exchange_rate DECIMAL(15,6) DEFAULT 1,
      total_price DECIMAL(15,2) DEFAULT 0,
      total_price_base DECIMAL(15,2) DEFAULT 0,

      inventory_transaction_id VARCHAR(36),
      batch_usage_record_id VARCHAR(36),

      dispensing_notes TEXT,
      patient_counselling_provided BOOLEAN DEFAULT false,
      counselling_notes TEXT,
      counselled_by_id VARCHAR(36),

      bill_id VARCHAR(36),
      bill_item_id VARCHAR(36),
      amount_charged DECIMAL(15,2) DEFAULT 0,
      is_billed BOOLEAN DEFAULT false,
      billing_date DATE,

      gl_entry_id VARCHAR(36),
      cogs_gl_entry_id VARCHAR(36),
      revenue_gl_entry_id VARCHAR(36),

      status VARCHAR(20) DEFAULT 'dispensed',
      return_date DATE,
      return_reason TEXT,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  dispensing_records table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_dr_clinic_date ON dispensing_records(clinic_id, dispensing_date)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_dr_patient ON dispensing_records(patient_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_dr_status ON dispensing_records(status)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_dr_prescription ON dispensing_records(prescription_id)`); } catch(e){}

  // 8. Dispensing Returns
  console.log('8. Creating dispensing_returns table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS dispensing_returns (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      return_number VARCHAR(100) NOT NULL,
      dispensing_record_id VARCHAR(36) NOT NULL,

      return_date DATE,
      return_reason VARCHAR(50) DEFAULT 'unused',
      quantity_returned INT DEFAULT 0,

      inventory_reversal_done BOOLEAN DEFAULT false,
      inventory_transaction_id VARCHAR(36),

      credit_note_id VARCHAR(36),
      amount_refunded DECIMAL(15,2) DEFAULT 0,
      refund_method VARCHAR(20) DEFAULT 'cash',

      gl_reversal_entry_id VARCHAR(36),
      revenue_reversal_gl_id VARCHAR(36),
      cogs_reversal_gl_id VARCHAR(36),

      processed_by VARCHAR(36),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  dispensing_returns table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_dret_dispensing ON dispensing_returns(dispensing_record_id)`); } catch(e){}

  // 9. Pharmacy Charges
  console.log('9. Creating pharmacy_charges table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_charges (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      charge_number VARCHAR(100) NOT NULL,

      patient_id VARCHAR(36) NOT NULL,
      dispensing_record_id VARCHAR(36) NOT NULL,
      bill_id VARCHAR(36),
      bill_item_id VARCHAR(36),

      charge_date DATE,
      drug_name VARCHAR(255),
      quantity_dispensed INT DEFAULT 0,
      unit_price DECIMAL(10,2) DEFAULT 0,
      charge_amount DECIMAL(15,2) DEFAULT 0,
      currency_code VARCHAR(3) DEFAULT 'KES',

      insurance_type VARCHAR(100),
      patient_copay DECIMAL(10,2) DEFAULT 0,
      insurance_portion DECIMAL(10,2) DEFAULT 0,
      applied_price_type VARCHAR(20) DEFAULT 'cash',

      is_billed BOOLEAN DEFAULT false,
      billing_date DATE,
      payment_status VARCHAR(20) DEFAULT 'pending',

      revenue_gl_entry_id VARCHAR(36),
      cogs_gl_entry_id VARCHAR(36),
      receivables_gl_entry_id VARCHAR(36),

      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  pharmacy_charges table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pc_patient_date ON pharmacy_charges(patient_id, charge_date)`); } catch(e){}

  // 10. Pharmacy Insurance Pricing
  console.log('10. Creating pharmacy_insurance_pricing table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_insurance_pricing (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      drug_id VARCHAR(36) NOT NULL,
      insurance_type VARCHAR(100),

      unit_price DECIMAL(10,2) DEFAULT 0,
      currency_code VARCHAR(3) DEFAULT 'KES',
      patient_copay DECIMAL(10,2) DEFAULT 0,
      insurance_covers DECIMAL(10,2) DEFAULT 0,

      effective_from DATE,
      effective_to DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  pharmacy_insurance_pricing table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pip_clinic ON pharmacy_insurance_pricing(clinic_id, insurance_type)`); } catch(e){}

  // 11. Pharmacy Settings
  console.log('11. Creating pharmacy_settings table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_settings (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,

      allow_partial_dispensing BOOLEAN DEFAULT true,
      require_allergy_check BOOLEAN DEFAULT true,
      require_interaction_check BOOLEAN DEFAULT true,
      require_patient_counselling BOOLEAN DEFAULT true,

      auto_check_stock_before_dispensing BOOLEAN DEFAULT true,
      warn_if_stock_below_days INT DEFAULT 7,
      auto_reserve_stock_on_prescription BOOLEAN DEFAULT true,
      default_pharmacy_location_id VARCHAR(36),

      default_markup_percentage DECIMAL(5,2) DEFAULT 20,
      round_to_nearest INT DEFAULT 0,
      include_tax_in_price BOOLEAN DEFAULT false,
      default_tax_rate DECIMAL(5,2) DEFAULT 16,

      default_dispensing_currency VARCHAR(3) DEFAULT 'KES',
      accept_usd_payments BOOLEAN DEFAULT true,
      accept_ssp_payments BOOLEAN DEFAULT false,

      auto_create_bill_on_dispensing BOOLEAN DEFAULT true,
      auto_charge_amount BOOLEAN DEFAULT true,
      bill_immediately BOOLEAN DEFAULT false,
      require_bill_approval_above DECIMAL(15,2),

      allow_returns BOOLEAN DEFAULT true,
      return_window_days INT DEFAULT 7,
      auto_reverse_inventory_on_return BOOLEAN DEFAULT true,

      pharmacy_revenue_account_id VARCHAR(36),
      pharmacy_cogs_account_id VARCHAR(36),
      pharmacy_discount_account_id VARCHAR(36),
      pharmacy_receivables_account_id VARCHAR(36),

      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uk_pharm_clinic UNIQUE (clinic_id)
    )
  `);
  console.log('  pharmacy_settings table created/verified.');

  // 12. Pharmacy Audit Log
  console.log('12. Creating pharmacy_audit_log table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_audit_log (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      action_type VARCHAR(100),
      reference_id VARCHAR(100),
      action_by VARCHAR(36),
      action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      action_details JSON,
      reason_for_action TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  pharmacy_audit_log table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pal_clinic_date ON pharmacy_audit_log(clinic_id, action_date)`); } catch(e){}

  // 13. Controlled Substance Log
  console.log('13. Creating controlled_substance_log table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS controlled_substance_log (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      drug_id VARCHAR(36) NOT NULL,
      dispensing_record_id VARCHAR(36),
      quantity_dispensed INT DEFAULT 0,
      patient_id VARCHAR(36),
      dispensed_by VARCHAR(36),
      dispensing_date DATE,
      balance_before INT DEFAULT 0,
      balance_after INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  controlled_substance_log table created/verified.');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_csl_clinic_date ON controlled_substance_log(clinic_id, dispensing_date)`); } catch(e){}

  console.log('\n=== Pharmacy Tables Migration Complete ===');
}

module.exports = { migratePharmacyTables };
