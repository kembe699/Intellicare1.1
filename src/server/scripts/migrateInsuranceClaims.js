const { sequelize } = require('../models');

async function migrateInsuranceBatchClaims() {
  console.log('\n=== Insurance Batch Claims Migration ===\n');

  // 1. insurance_batch_claims
  console.log('1. Creating insurance_batch_claims table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS insurance_batch_claims (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INT NOT NULL DEFAULT 1,
      branch_id INT NULL,
      claim_number VARCHAR(50) UNIQUE NOT NULL,
      scheme_id VARCHAR(36) NOT NULL,
      scheme_name VARCHAR(255),
      scheme_code VARCHAR(50),
      claim_amount DECIMAL(15,2) DEFAULT 0,
      invoice_count INT DEFAULT 0,
      status VARCHAR(50) DEFAULT 'draft',
      priority VARCHAR(50) DEFAULT 'normal',
      date_from DATE,
      date_to DATE,
      notes TEXT,
      contact_person VARCHAR(255),
      contact_email VARCHAR(255),
      contact_phone VARCHAR(50),
      submitted_at TIMESTAMP NULL,
      accepted_at TIMESTAMP NULL,
      paid_at TIMESTAMP NULL,
      paid_amount DECIMAL(15,2) DEFAULT 0,
      rejected_reason TEXT,
      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  insurance_batch_claims table ready');

  // Claims are batched per-scheme, and a scheme's price list can be in any currency (e.g.
  // an insurance scheme priced in USD while the clinic's cash catalog is SSP) — without this
  // column, claim_amount was a bare number that every UI assumed was the clinic's base
  // currency, so a $2.00 claim displayed as "SSP 2.00".
  // Found while setting up U6's CI pipeline against a genuinely fresh
  // database: COUNT(*) comes back over the wire as the STRING "0" (Postgres
  // BIGINT, which node-postgres never coerces to a JS number), and `!"0"` is
  // `false` — the opposite of what this check needs. On every fresh
  // database this silently skipped adding the column in exactly the case it
  // exists to handle, and the UPDATE below then failed outright with
  // "column bc.currency does not exist" instead of ever backfilling it.
  const [claimCurrencyCol] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'insurance_batch_claims' AND column_name = 'currency'`
  );
  if (parseInt(claimCurrencyCol[0].cnt, 10) === 0) {
    await sequelize.query(`ALTER TABLE insurance_batch_claims ADD COLUMN currency VARCHAR(3) NULL`);
    console.log('  insurance_batch_claims.currency added');
  }

  // 2. insurance_batch_claim_items (link table to invoices)
  console.log('2. Creating insurance_batch_claim_items table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS insurance_batch_claim_items (
      id VARCHAR(36) PRIMARY KEY,
      claim_id VARCHAR(36) NOT NULL,
      invoice_id VARCHAR(36) NOT NULL,
      bill_id VARCHAR(36),
      patient_id VARCHAR(36),
      patient_name VARCHAR(255),
      invoice_number VARCHAR(50),
      invoice_date DATE,
      amount DECIMAL(15,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  insurance_batch_claim_items table ready');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ibci_claim_id ON insurance_batch_claim_items(claim_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ibci_invoice_id ON insurance_batch_claim_items(invoice_id)`); } catch(e){}

  // Backfill claims created before the currency column existed, from their linked
  // invoices' actual currency (idempotent — only touches rows still missing it).
  // Moved here, after insurance_batch_claim_items exists — this used to run between
  // steps 1 and 2 and reference a table that didn't exist yet, which the (now-fixed)
  // COUNT/!cnt bug above had been masking: it never actually reached this UPDATE on a
  // fresh database, because it always skipped adding the currency column first.
  await sequelize.query(`
    UPDATE insurance_batch_claims bc
    SET currency = (
      SELECT i.currency FROM insurance_batch_claim_items bci
      JOIN invoices i ON bci.invoice_id = i.id
      WHERE bci.claim_id = bc.id
      LIMIT 1
    )
    WHERE bc.currency IS NULL
      AND EXISTS (
        SELECT 1 FROM insurance_batch_claim_items bci
        JOIN invoices i ON bci.invoice_id = i.id
        WHERE bci.claim_id = bc.id
      )
  `);

  // 3. insurance_batch_claim_status_history
  console.log('3. Creating insurance_batch_claim_status_history table...');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS insurance_batch_claim_status_history (
      id VARCHAR(36) PRIMARY KEY,
      claim_id VARCHAR(36) NOT NULL,
      old_status VARCHAR(50),
      new_status VARCHAR(50),
      notes TEXT,
      created_by VARCHAR(36),
      created_by_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  insurance_batch_claim_status_history table ready');
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ibcsh_claim_id ON insurance_batch_claim_status_history(claim_id)`); } catch(e){}

  console.log('\n=== Insurance Batch Claims Migration Complete ===\n');
}

module.exports = migrateInsuranceBatchClaims;

if (require.main === module) {
  migrateInsuranceBatchClaims()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
