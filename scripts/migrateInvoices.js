const { sequelize } = require('../models');

async function migrateInvoiceTables() {
  console.log('\n=== Invoice Tables Migration ===\n');

  // 1. invoices table
  console.log('1. Creating invoices table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id CHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        branch_id INT NULL,
        bill_id CHAR(36) NULL,
        patient_id VARCHAR(255) NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        invoice_number VARCHAR(50) UNIQUE NOT NULL,
        amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
        amount_paid DECIMAL(15, 2) NOT NULL DEFAULT 0,
        balance_due DECIMAL(15, 2) NOT NULL DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'SSP',
        payment_terms INT DEFAULT 30,
        due_date DATE NOT NULL,
        status ENUM('unpaid', 'partial', 'paid', 'overdue', 'cancelled') DEFAULT 'unpaid',
        notes TEXT NULL,
        created_by CHAR(36) NULL,
        updated_by CHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('  invoices table ready');
  } catch (err) {
    if (err.message?.includes('already exists')) {
      console.log('  Table invoices already exists');
    } else {
      console.error('  Error creating invoices:', err.message);
    }
  }

  // 2. invoice_items table
  console.log('2. Creating invoice_items table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id CHAR(36) PRIMARY KEY,
        invoice_id CHAR(36) NOT NULL,
        service_id CHAR(36) NULL,
        description VARCHAR(255) NOT NULL,
        quantity INT DEFAULT 1,
        unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
        amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'SSP',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_invoice_items_invoice (invoice_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('  invoice_items table ready');
  } catch (err) {
    if (err.message?.includes('already exists')) {
      console.log('  Table invoice_items already exists');
    } else {
      console.error('  Error creating invoice_items:', err.message);
    }
  }

  // 3. invoice_payments table
  console.log('3. Creating invoice_payments table...');
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS invoice_payments (
        id CHAR(36) PRIMARY KEY,
        invoice_id CHAR(36) NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        payment_date DATE NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'cash',
        reference_number VARCHAR(100) NULL,
        notes TEXT NULL,
        recorded_by CHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_invoice_payments_invoice (invoice_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('  invoice_payments table ready');
  } catch (err) {
    if (err.message?.includes('already exists')) {
      console.log('  Table invoice_payments already exists');
    } else {
      console.error('  Error creating invoice_payments:', err.message);
    }
  }

  // 4. Add invoice-related columns to patient_bills if not exist
  console.log('4. Adding invoice columns to patient_bills...');
  try {
    const [cols] = await sequelize.query("SHOW COLUMNS FROM patient_bills LIKE 'invoice_id'");
    if (cols.length === 0) {
      await sequelize.query("ALTER TABLE patient_bills ADD COLUMN invoice_id CHAR(36) NULL");
      await sequelize.query("ALTER TABLE patient_bills ADD COLUMN billing_type ENUM('cash','credit','insurance') DEFAULT 'cash'");
      console.log('  Added invoice_id and billing_type to patient_bills');
    } else {
      console.log('  patient_bills already has invoice columns');
    }
  } catch (err) {
    console.log('  Note:', err.message);
  }

  // 5. Add scheme columns to invoices if not exist
  console.log('5. Adding scheme columns to invoices...');
  try {
    const [cols] = await sequelize.query("SHOW COLUMNS FROM invoices LIKE 'scheme_id'");
    if (cols.length === 0) {
      await sequelize.query("ALTER TABLE invoices ADD COLUMN scheme_id VARCHAR(36) NULL");
      await sequelize.query("ALTER TABLE invoices ADD COLUMN scheme_name VARCHAR(255) NULL");
      await sequelize.query("ALTER TABLE invoices ADD INDEX idx_invoices_scheme (scheme_id)");
      console.log('  Added scheme_id and scheme_name to invoices');
    } else {
      console.log('  invoices already has scheme columns');
    }
  } catch (err) {
    console.log('  Note:', err.message);
  }

  console.log('\n=== Invoice Tables Migration Complete ===\n');
}

module.exports = { migrateInvoiceTables };
