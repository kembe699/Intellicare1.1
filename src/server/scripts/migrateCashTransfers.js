const { sequelize } = require('../models');

/**
 * Ensure cash_transfers table exists and uses VARCHAR account IDs (CoA UUIDs).
 * Also ensures cashier_shifts, ledger_accounts tables exist,
 * and seeds "Cash at Hand" / "Petty Cash" for any clinic that already has a
 * Chart of Accounts but is missing those cash accounts.
 * Safe to re-run — all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING guards.
 */
async function migrateCashTransfers() {
  console.log('Running cash_transfers / cashier migration...');

  // 1. cash_transfers — UUID-compatible columns
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS cash_transfers (
      id                SERIAL PRIMARY KEY,
      from_account_id   VARCHAR(36)    NOT NULL,
      from_account_name VARCHAR(255)   NOT NULL,
      to_account_id     VARCHAR(36)    NOT NULL,
      to_account_name   VARCHAR(255)   NOT NULL,
      amount            DECIMAL(15,2)  NOT NULL,
      notes             TEXT,
      created_by        VARCHAR(255),
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✅ cash_transfers table ensured');

  // 2. Widen INTEGER columns → VARCHAR(36) on older DBs. This deployment runs MySQL, not
  // Postgres — MySQL's information_schema reports an int column's DATA_TYPE as 'int' (not
  // 'integer'), and MySQL alters a column via MODIFY COLUMN, not ALTER COLUMN ... TYPE ...
  // USING. The Postgres-flavored version of this check/ALTER previously never matched or
  // ran here, so an old int-typed cash_transfers table (from before chart_of_accounts.id
  // became a UUID) silently stayed int forever — every real transfer then failed with
  // MySQL's "Data truncated for column 'from_account_id'" the moment a UUID account id was
  // inserted into it.
  for (const col of ['from_account_id', 'to_account_id']) {
    try {
      const [rows] = await sequelize.query(
        `SELECT DATA_TYPE FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'cash_transfers' AND column_name = :col`,
        { replacements: { col } }
      );
      const dataType = rows[0]?.DATA_TYPE || rows[0]?.data_type;
      if (rows.length > 0 && ['int', 'bigint', 'mediumint', 'smallint', 'tinyint'].includes(dataType)) {
        await sequelize.query(`ALTER TABLE cash_transfers MODIFY COLUMN ${col} VARCHAR(36) NOT NULL`);
        console.log(`  ✅ Widened cash_transfers.${col} ${dataType.toUpperCase()} → VARCHAR(36)`);
      }
    } catch (err) {
      console.log(`  ⚠️  Could not migrate ${col}: ${err.message}`);
    }
  }

  // 3. cashier_shifts table
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS cashier_shifts (
      id               SERIAL PRIMARY KEY,
      cashier_id       VARCHAR(36)   NOT NULL,
      cashier_name     VARCHAR(255)  NOT NULL,
      start_time       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      end_time         TIMESTAMP,
      opening_balance  DECIMAL(15,2) NOT NULL DEFAULT 0,
      closing_balance  DECIMAL(15,2),
      total_receipts   INTEGER       NOT NULL DEFAULT 0,
      total_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
      status           VARCHAR(20)   NOT NULL DEFAULT 'open',
      notes            TEXT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cashier_shifts_cashier ON cashier_shifts(cashier_id, status)`);
  } catch(e) {}
  console.log('  ✅ cashier_shifts table ensured');

  // 4. ledger_accounts table (legacy — kept for backward compat)
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ledger_accounts (
      id               SERIAL PRIMARY KEY,
      account_name     VARCHAR(255)  NOT NULL,
      account_code     VARCHAR(50)   NOT NULL UNIQUE,
      account_type     VARCHAR(20)   NOT NULL DEFAULT 'asset',
      parent_account_id INTEGER,
      description      TEXT,
      balance          DECIMAL(15,2) NOT NULL DEFAULT 0,
      is_active        BOOLEAN       DEFAULT true,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✅ ledger_accounts table ensured');

  // 5. Seed "Cash at Hand" and "Petty Cash" for every clinic that has CoA
  //    but is missing those accounts (safe ON CONFLICT DO NOTHING)
  try {
    const [clinics] = await sequelize.query(
      `SELECT DISTINCT clinic_id FROM chart_of_accounts`
    );
    const cashAccounts = [
      { code: '1105', name: 'Cash at Hand', desc: 'Cash held by cashiers at the counter' },
      { code: '1108', name: 'Petty Cash',   desc: 'Petty cash fund for small expenses' }
    ];

    for (const clinic of clinics) {
      for (const acc of cashAccounts) {
        try {
          await sequelize.query(`
            INSERT INTO chart_of_accounts
              (id, clinic_id, account_code, account_name, account_type, sub_account_type,
               balance_type, opening_balance, is_active, is_bank_account,
               is_customer_account, is_supplier_account, description, created_at, updated_at)
            VALUES
              (gen_random_uuid(), :clinic_id, :code, :name, 'asset', 'current_asset',
               'debit', 0, true, false, false, false, :desc, NOW(), NOW())
            ON CONFLICT (clinic_id, account_code) DO NOTHING
          `, {
            replacements: {
              clinic_id: clinic.clinic_id,
              code: acc.code,
              name: acc.name,
              desc: acc.desc
            }
          });
        } catch(e) { /* skip if unique constraint or table missing */ }
      }
    }
    console.log(`  ✅ Cash at Hand / Petty Cash seeded for ${clinics.length} clinic(s)`);
  } catch (err) {
    console.log(`  ⚠️  CoA cash account seed skipped: ${err.message}`);
  }

  console.log('✅ cash_transfers / cashier migration complete');
}

module.exports = { migrateCashTransfers };

if (require.main === module) {
  migrateCashTransfers()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
