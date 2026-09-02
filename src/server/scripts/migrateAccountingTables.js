const { sequelize } = require('../models');
const { initializeAllClinics } = require('./initializeChartOfAccounts');

/**
 * Create all accounting tables with proper structure and relationships
 */
async function createAccountingTables() {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('Creating accounting tables...');

    // 1. Chart of Accounts
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS chart_of_accounts (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        account_code VARCHAR(50) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        account_type VARCHAR(20) NOT NULL,
        sub_account_type VARCHAR(50),
        balance_type VARCHAR(10) NOT NULL,
        opening_balance DECIMAL(15,2) DEFAULT 0,
        opening_balance_date DATE,
        is_active BOOLEAN DEFAULT true,
        is_bank_account BOOLEAN DEFAULT false,
        is_customer_account BOOLEAN DEFAULT false,
        is_supplier_account BOOLEAN DEFAULT false,
        description TEXT,
        created_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_clinic_account_code UNIQUE (clinic_id, account_code)
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coa_account_type ON chart_of_accounts(account_type)`); } catch(e){}
    console.log('✅ Chart of Accounts table created');

    // 2. General Ledger
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS general_ledger (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        gl_number VARCHAR(100) UNIQUE NOT NULL,
        transaction_date DATE NOT NULL,
        posting_date DATE,
        transaction_type VARCHAR(50),
        description TEXT NOT NULL,
        reference_id VARCHAR(100),
        reference_module VARCHAR(50),
        total_debit DECIMAL(15,2) DEFAULT 0,
        total_credit DECIMAL(15,2) DEFAULT 0,
        is_balanced BOOLEAN DEFAULT false,
        is_posted BOOLEAN DEFAULT false,
        posted_by VARCHAR(36),
        posted_date TIMESTAMP,
        status VARCHAR(20) DEFAULT 'draft',
        approval_by VARCHAR(36),
        approval_date TIMESTAMP,
        created_by VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_gl_clinic_date ON general_ledger(clinic_id, transaction_date, status)`); } catch(e){}
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_gl_reference ON general_ledger(reference_module, reference_id)`); } catch(e){}
    console.log('✅ General Ledger table created');

    // 3. GL Line Items
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS gl_line_items (
        id VARCHAR(36) PRIMARY KEY,
        gl_id VARCHAR(36) NOT NULL,
        account_id VARCHAR(36) NOT NULL,
        debit_amount DECIMAL(15,2) DEFAULT 0,
        credit_amount DECIMAL(15,2) DEFAULT 0,
        line_description TEXT,
        cost_center_id VARCHAR(36),
        department_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_glli_gl_account ON gl_line_items(gl_id, account_id)`); } catch(e){}
    console.log('✅ GL Line Items table created');

    // 4. Account Ledger
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS account_ledger (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        account_id VARCHAR(36) NOT NULL,
        transaction_id VARCHAR(36),
        transaction_date DATE NOT NULL,
        debit_amount DECIMAL(15,2) DEFAULT 0,
        credit_amount DECIMAL(15,2) DEFAULT 0,
        reference_number VARCHAR(100),
        description TEXT,
        posted_by VARCHAR(36),
        posted_date TIMESTAMP,
        is_posted BOOLEAN DEFAULT false,
        source_module VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_al_clinic_account ON account_ledger(clinic_id, account_id, transaction_date)`); } catch(e){}
    console.log('✅ Account Ledger table created');

    // 5. Journal Entries
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        je_number VARCHAR(100) UNIQUE NOT NULL,
        entry_date DATE NOT NULL,
        description TEXT NOT NULL,
        narration TEXT,
        reference VARCHAR(100),
        total_debit DECIMAL(15,2),
        total_credit DECIMAL(15,2),
        status VARCHAR(20) DEFAULT 'draft',
        created_by VARCHAR(36) NOT NULL,
        approved_by VARCHAR(36),
        approved_date TIMESTAMP,
        posted_by VARCHAR(36),
        posted_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_je_clinic_date ON journal_entries(clinic_id, entry_date, status)`); } catch(e){}
    console.log('✅ Journal Entries table created');

    // 6. Journal Entry Lines
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id VARCHAR(36) PRIMARY KEY,
        je_id VARCHAR(36) NOT NULL,
        account_id VARCHAR(36) NOT NULL,
        debit_amount DECIMAL(15,2) DEFAULT 0,
        credit_amount DECIMAL(15,2) DEFAULT 0,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_jel_je_account ON journal_entry_lines(je_id, account_id)`); } catch(e){}
    console.log('✅ Journal Entry Lines table created');

    // 7. Patient Receivables
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS patient_receivables (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        patient_id VARCHAR(255) NOT NULL,
        bill_id VARCHAR(36) NOT NULL,
        bill_number VARCHAR(255),
        service_date DATE,
        bill_date DATE,
        due_date DATE,
        service_description TEXT,
        service_amount DECIMAL(15,2),
        amount_due DECIMAL(15,2),
        amount_paid DECIMAL(15,2) DEFAULT 0,
        amount_adjusted DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        days_overdue INT DEFAULT 0,
        last_payment_date DATE,
        gl_entry_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pr_clinic_status ON patient_receivables(clinic_id, status)`); } catch(e){}
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pr_bill_id ON patient_receivables(bill_id)`); } catch(e){}
    console.log('✅ Patient Receivables table created');

    // 8. Accounting Suppliers (separate from existing suppliers table)
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS accounting_suppliers (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        supplier_name VARCHAR(255) NOT NULL,
        supplier_code VARCHAR(50),
        contact_person VARCHAR(255),
        phone VARCHAR(20),
        email VARCHAR(255),
        address TEXT,
        tax_id VARCHAR(50),
        payment_terms VARCHAR(50),
        opening_balance DECIMAL(15,2) DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'KES',
        is_active BOOLEAN DEFAULT true,
        account_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_clinic_supplier_code UNIQUE (clinic_id, supplier_code)
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_as_supplier_name ON accounting_suppliers(supplier_name)`); } catch(e){}
    console.log('✅ Accounting Suppliers table created');

    // 9. Expense Invoices
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS expense_invoices (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        supplier_id VARCHAR(36) NOT NULL,
        invoice_number VARCHAR(100) NOT NULL,
        invoice_date DATE NOT NULL,
        due_date DATE,
        received_date DATE,
        total_amount DECIMAL(15,2),
        tax_amount DECIMAL(15,2) DEFAULT 0,
        gross_amount DECIMAL(15,2),
        amount_paid DECIMAL(15,2) DEFAULT 0,
        amount_due DECIMAL(15,2),
        status VARCHAR(20) DEFAULT 'received',
        expense_category VARCHAR(100),
        reference_po VARCHAR(100),
        notes TEXT,
        verified_by VARCHAR(36),
        verified_date DATE,
        approved_by VARCHAR(36),
        approved_date DATE,
        gl_entry_id VARCHAR(36),
        created_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ei_clinic_status ON expense_invoices(clinic_id, status)`); } catch(e){}
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ei_supplier ON expense_invoices(supplier_id)`); } catch(e){}
    console.log('✅ Expense Invoices table created');

    // 10. Expense Invoice Lines
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS expense_invoice_lines (
        id VARCHAR(36) PRIMARY KEY,
        expense_invoice_id VARCHAR(36) NOT NULL,
        account_id VARCHAR(36),
        item_description VARCHAR(255),
        quantity INT,
        unit_price DECIMAL(15,2),
        line_amount DECIMAL(15,2),
        tax_amount DECIMAL(15,2) DEFAULT 0,
        cost_center_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_eil_expense_invoice ON expense_invoice_lines(expense_invoice_id)`); } catch(e){}
    console.log('✅ Expense Invoice Lines table created');

    // 11. Cost Centers
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS cost_centers (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        cost_center_code VARCHAR(50) UNIQUE NOT NULL,
        cost_center_name VARCHAR(255) NOT NULL,
        description TEXT,
        responsible_person_id VARCHAR(36),
        budget_amount DECIMAL(15,2),
        budget_period VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cc_clinic_id ON cost_centers(clinic_id)`); } catch(e){}
    console.log('✅ Cost Centers table created');

    // 12. Exchange Rates
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        from_currency VARCHAR(3) NOT NULL,
        to_currency VARCHAR(3) NOT NULL,
        rate DECIMAL(18,6) NOT NULL,
        effective_date DATE NOT NULL,
        expiry_date DATE,
        source VARCHAR(50) DEFAULT 'manual',
        is_active BOOLEAN DEFAULT true,
        created_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, { transaction });
    try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_er_clinic_currency ON exchange_rates(clinic_id, from_currency, to_currency, effective_date)`); } catch(e){}
    console.log('✅ Exchange Rates table created');

    await transaction.commit();
    console.log('🎉 All accounting tables created successfully');
    
    return { success: true, message: 'All accounting tables created successfully' };
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error creating accounting tables:', error);
    throw error;
  }
}

/**
 * Add multi-currency columns to existing accounting tables
 */
async function addMultiCurrencyColumns() {
  console.log('Adding multi-currency columns to accounting tables...');
  
  const alterations = [
    // General Ledger
    { table: 'general_ledger', column: 'transaction_currency', sql: "ALTER TABLE general_ledger ADD COLUMN transaction_currency VARCHAR(3) NOT NULL DEFAULT 'SSP'" },
    { table: 'general_ledger', column: 'base_currency', sql: "ALTER TABLE general_ledger ADD COLUMN base_currency VARCHAR(3) NOT NULL DEFAULT 'SSP'" },
    { table: 'general_ledger', column: 'exchange_rate', sql: "ALTER TABLE general_ledger ADD COLUMN exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1.000000" },
    { table: 'general_ledger', column: 'base_total_debit', sql: "ALTER TABLE general_ledger ADD COLUMN base_total_debit DECIMAL(15,2) DEFAULT 0" },
    { table: 'general_ledger', column: 'base_total_credit', sql: "ALTER TABLE general_ledger ADD COLUMN base_total_credit DECIMAL(15,2) DEFAULT 0" },
    // Journal Entries
    { table: 'journal_entries', column: 'transaction_currency', sql: "ALTER TABLE journal_entries ADD COLUMN transaction_currency VARCHAR(3) NOT NULL DEFAULT 'SSP'" },
    { table: 'journal_entries', column: 'base_currency', sql: "ALTER TABLE journal_entries ADD COLUMN base_currency VARCHAR(3) NOT NULL DEFAULT 'SSP'" },
    { table: 'journal_entries', column: 'exchange_rate', sql: "ALTER TABLE journal_entries ADD COLUMN exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1.000000" },
    { table: 'journal_entries', column: 'base_total_debit', sql: "ALTER TABLE journal_entries ADD COLUMN base_total_debit DECIMAL(15,2) DEFAULT 0" },
    { table: 'journal_entries', column: 'base_total_credit', sql: "ALTER TABLE journal_entries ADD COLUMN base_total_credit DECIMAL(15,2) DEFAULT 0" },
    // GL Line Items
    { table: 'gl_line_items', column: 'base_debit_amount', sql: "ALTER TABLE gl_line_items ADD COLUMN base_debit_amount DECIMAL(15,2) DEFAULT 0" },
    { table: 'gl_line_items', column: 'base_credit_amount', sql: "ALTER TABLE gl_line_items ADD COLUMN base_credit_amount DECIMAL(15,2) DEFAULT 0" },
    // Journal Entry Lines
    { table: 'journal_entry_lines', column: 'base_debit_amount', sql: "ALTER TABLE journal_entry_lines ADD COLUMN base_debit_amount DECIMAL(15,2) DEFAULT 0" },
    { table: 'journal_entry_lines', column: 'base_credit_amount', sql: "ALTER TABLE journal_entry_lines ADD COLUMN base_credit_amount DECIMAL(15,2) DEFAULT 0" },
  ];

  for (const alt of alterations) {
    try {
      await sequelize.query(alt.sql);
      console.log(`  ✅ Added ${alt.column} to ${alt.table}`);
    } catch (error) {
      if (error.message?.includes('already exists') || error.original?.code === '42701') {
        console.log(`  ℹ️ ${alt.column} already exists in ${alt.table}`);
      } else {
        console.log(`  ⚠️ Could not add ${alt.column} to ${alt.table}: ${error.message}`);
      }
    }
  }

  // Backfill existing rows: set base amounts = transaction amounts where base columns are 0
  try {
    await sequelize.query("UPDATE general_ledger SET base_total_debit = total_debit, base_total_credit = total_credit WHERE base_total_debit = 0 AND total_debit > 0");
    await sequelize.query("UPDATE journal_entries SET base_total_debit = total_debit, base_total_credit = total_credit WHERE base_total_debit = 0 AND total_debit > 0");
    await sequelize.query("UPDATE gl_line_items SET base_debit_amount = debit_amount, base_credit_amount = credit_amount WHERE base_debit_amount = 0 AND debit_amount > 0");
    await sequelize.query("UPDATE journal_entry_lines SET base_debit_amount = debit_amount, base_credit_amount = credit_amount WHERE base_debit_amount = 0 AND debit_amount > 0");
    console.log('  ✅ Backfilled base currency amounts for existing records');
  } catch (error) {
    console.log('  ⚠️ Could not backfill base amounts:', error.message);
  }

  console.log('Multi-currency columns migration complete.');
}

/**
 * Run the complete accounting module setup
 */
async function setupAccountingModule() {
  try {
    console.log('🚀 Starting accounting module setup...');
    
    // Step 1: Create all tables
    await createAccountingTables();
    
    // Step 1.5: Add multi-currency columns (safe for existing tables)
    await addMultiCurrencyColumns();
    
    // Step 2: Initialize Chart of Accounts for all clinics
    console.log('📊 Initializing Chart of Accounts for all clinics...');
    const initResults = await initializeAllClinics();
    
    console.log('📋 Initialization results:');
    initResults.forEach(result => {
      console.log(`  Clinic ${result.clinic_id}: ${result.success ? '✅' : '❌'} ${result.message}`);
    });
    
    console.log('🎉 Accounting module setup completed successfully!');
    
    return {
      success: true,
      tables_created: true,
      clinics_initialized: initResults.length,
      results: initResults
    };
    
  } catch (error) {
    console.error('❌ Error setting up accounting module:', error);
    throw error;
  }
}

// Run setup if called directly
if (require.main === module) {
  setupAccountingModule()
    .then(result => {
      console.log('Setup completed:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Setup failed:', error);
      process.exit(1);
    });
}

module.exports = {
  createAccountingTables,
  addMultiCurrencyColumns,
  setupAccountingModule
};
