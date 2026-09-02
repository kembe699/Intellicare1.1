const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');

/**
 * Multi-Currency Accounting System Migration
 * Creates: currencies, exchange_adjustments, currency_conversion_log,
 *          account_currency_balances, multicurrency_report_settings
 * Updates: exchange_rates (add buy/sell/spot columns),
 *          chart_of_accounts (add currency fields),
 *          gl_line_items (add currency fields)
 */

async function addColumnSafe(table, column, definition) {
  try {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  ✅ Added ${column} to ${table}`);
  } catch (e) {
    if (e.original?.code === 'ER_DUP_FIELDNAME' || e.message?.includes('Duplicate column')) {
      console.log(`  ℹ️  ${column} already exists in ${table}`);
    } else {
      console.log(`  ⚠️  Could not add ${column} to ${table}: ${e.message}`);
    }
  }
}

async function migrateMultiCurrency() {
  console.log('\n=== Multi-Currency Accounting Migration ===\n');

  // ──────────────────────────────────────────
  // 1. Currencies master table
  // ──────────────────────────────────────────
  console.log('1. Creating currencies table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS currencies (
      id SERIAL PRIMARY KEY,
      code VARCHAR(3) NOT NULL,
      name VARCHAR(100) NOT NULL,
      symbol VARCHAR(5) DEFAULT '',
      is_base_currency BOOLEAN DEFAULT FALSE,
      decimal_places INT DEFAULT 2,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_code UNIQUE (code)
    )
  `);
  console.log('  currencies table ready');

  // Seed default currencies: SSP (base) and USD
  const [existing] = await sequelize.query(`SELECT COUNT(*) as cnt FROM currencies`);
  if (existing[0].cnt === 0) {
    console.log('  Seeding default currencies (SSP as base, USD)...');
    await sequelize.query(`
      INSERT INTO currencies (code, name, symbol, is_base_currency, decimal_places) VALUES
        ('SSP', 'South Sudanese Pound', 'SSP', TRUE, 2),
        ('USD', 'US Dollar', '$', FALSE, 2)
    `);
    console.log('  ✅ Default currencies seeded');
  } else {
    console.log('  ℹ️  Currencies already seeded');
  }

  // ──────────────────────────────────────────
  // 2. Enhance existing exchange_rates table
  // ──────────────────────────────────────────
  console.log('2. Enhancing exchange_rates table...');
  await addColumnSafe('exchange_rates', 'buy_rate', 'DECIMAL(18,6) DEFAULT NULL AFTER rate');
  await addColumnSafe('exchange_rates', 'sell_rate', 'DECIMAL(18,6) DEFAULT NULL AFTER buy_rate');
  await addColumnSafe('exchange_rates', 'spot_rate', 'DECIMAL(18,6) DEFAULT NULL AFTER sell_rate');
  await addColumnSafe('exchange_rates', 'notes', 'TEXT DEFAULT NULL');
  console.log('  exchange_rates table enhanced');

  // ──────────────────────────────────────────
  // 3. Exchange adjustments (gain/loss tracking)
  // ──────────────────────────────────────────
  console.log('3. Creating exchange_adjustments table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS exchange_adjustments (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INT NOT NULL,
      transaction_date DATE NOT NULL,
      from_currency VARCHAR(3) NOT NULL,
      to_currency VARCHAR(3) NOT NULL,
      original_amount DECIMAL(15,2),
      original_rate DECIMAL(18,6),
      original_base_amount DECIMAL(15,2),
      settlement_date DATE,
      settlement_rate DECIMAL(18,6),
      settlement_base_amount DECIMAL(15,2),
      realized_gain_loss DECIMAL(15,2) DEFAULT 0,
      current_rate DECIMAL(18,6),
      current_base_amount DECIMAL(15,2),
      unrealized_gain_loss DECIMAL(15,2) DEFAULT 0,
      adjustment_type VARCHAR(50) DEFAULT 'receivable',
      adjustment_status VARCHAR(50) DEFAULT 'pending',
      reference_id VARCHAR(100),
      reference_type VARCHAR(50),
      notes TEXT,
      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  exchange_adjustments table ready');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ea_transaction_date ON exchange_adjustments(transaction_date)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ea_reference ON exchange_adjustments(reference_type, reference_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ea_status ON exchange_adjustments(adjustment_status)`); } catch(e){}

  // ──────────────────────────────────────────
  // 4. Currency conversion log (audit trail)
  // ──────────────────────────────────────────
  console.log('4. Creating currency_conversion_log table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS currency_conversion_log (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INT NOT NULL,
      source_transaction_id VARCHAR(100),
      source_transaction_type VARCHAR(50),
      from_currency VARCHAR(3) NOT NULL,
      to_currency VARCHAR(3) NOT NULL,
      amount_source DECIMAL(15,2),
      rate_used DECIMAL(18,6),
      amount_converted DECIMAL(15,2),
      conversion_method VARCHAR(50) DEFAULT 'automatic',
      conversion_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      approved_by VARCHAR(36),
      approval_status VARCHAR(50) DEFAULT 'approved',
      approval_date TIMESTAMP NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  currency_conversion_log table ready');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ccl_conversion_date ON currency_conversion_log(conversion_date)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ccl_source ON currency_conversion_log(source_transaction_type, source_transaction_id)`); } catch(e){}

  // ──────────────────────────────────────────
  // 5. Account currency balances
  // ──────────────────────────────────────────
  console.log('5. Creating account_currency_balances table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS account_currency_balances (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INT NOT NULL,
      account_id VARCHAR(36) NOT NULL,
      currency_code VARCHAR(3) NOT NULL,

      balance_in_currency DECIMAL(15,2) DEFAULT 0,
      balance_in_base_currency DECIMAL(15,2) DEFAULT 0,

      last_conversion_rate DECIMAL(18,6),
      last_conversion_date TIMESTAMP NULL,
      unrealized_gain_loss DECIMAL(15,2) DEFAULT 0,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_account_currency UNIQUE (clinic_id, account_id, currency_code)
    )
  `);
  console.log('  account_currency_balances table ready');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_acb_account ON account_currency_balances(account_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_acb_currency ON account_currency_balances(currency_code)`); } catch(e){}

  // ──────────────────────────────────────────
  // 6. Multi-currency report settings
  // ──────────────────────────────────────────
  console.log('6. Creating multicurrency_report_settings table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS multicurrency_report_settings (
      id SERIAL PRIMARY KEY,
      clinic_id INT NOT NULL,
      base_currency_code VARCHAR(3) NOT NULL DEFAULT 'SSP',
      secondary_currencies TEXT,
      show_individual_currencies BOOLEAN DEFAULT TRUE,
      show_base_currency_conversion BOOLEAN DEFAULT TRUE,
      show_exchange_gains_losses BOOLEAN DEFAULT TRUE,
      date_for_rates DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_clinic UNIQUE (clinic_id)
    )
  `);
  console.log('  multicurrency_report_settings table ready');

  try {
    await sequelize.query(`
      INSERT INTO multicurrency_report_settings (clinic_id, base_currency_code, secondary_currencies)
      VALUES (1, 'SSP', '["USD"]')
    `);
  } catch (e) { /* ignore */ }

  // ──────────────────────────────────────────
  // 7. Add currency columns to chart_of_accounts
  // ──────────────────────────────────────────
  console.log('7. Adding currency fields to chart_of_accounts...');
  await addColumnSafe('chart_of_accounts', 'currency_code', "VARCHAR(3) DEFAULT NULL");
  await addColumnSafe('chart_of_accounts', 'is_multicurrency', 'BOOLEAN DEFAULT FALSE');

  // ──────────────────────────────────────────
  // 8. Add currency columns to gl_line_items
  // ──────────────────────────────────────────
  console.log('8. Adding currency fields to gl_line_items...');
  await addColumnSafe('gl_line_items', 'currency_code', "VARCHAR(3) DEFAULT NULL");
  await addColumnSafe('gl_line_items', 'amount_in_currency', 'DECIMAL(15,2) DEFAULT NULL');
  await addColumnSafe('gl_line_items', 'exchange_rate', 'DECIMAL(18,6) DEFAULT NULL');
  await addColumnSafe('gl_line_items', 'exchange_gain_loss', 'DECIMAL(15,2) DEFAULT 0');

  // ──────────────────────────────────────────
  // 9. Add currency columns to journal_entry_lines
  // ──────────────────────────────────────────
  console.log('9. Adding currency fields to journal_entry_lines...');
  await addColumnSafe('journal_entry_lines', 'currency_code', "VARCHAR(3) DEFAULT NULL");
  await addColumnSafe('journal_entry_lines', 'amount_in_currency', 'DECIMAL(15,2) DEFAULT NULL');
  await addColumnSafe('journal_entry_lines', 'exchange_rate', 'DECIMAL(18,6) DEFAULT NULL');

  // ──────────────────────────────────────────
  // 10. Add currency columns to invoices
  // ──────────────────────────────────────────
  console.log('10. Adding base currency fields to invoices...');
  await addColumnSafe('invoices', 'exchange_rate', 'DECIMAL(18,6) DEFAULT NULL');
  await addColumnSafe('invoices', 'amount_in_base_currency', 'DECIMAL(15,2) DEFAULT NULL');

  console.log('\n=== Multi-Currency Accounting Migration Complete ===\n');
}

module.exports = { migrateMultiCurrency };
