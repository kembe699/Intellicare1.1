/**
 * Sales tax (Accounting › Taxes), per tenant.
 *
 *   tax_rates                          — the tax types: name, rate %, the
 *                                        liability account the tax is owed on
 *   categories.tax_rate_id             — the tax every item in a category gets
 *   services / inventory_items /
 *   lab_tests .tax_rate_id, .tax_exempt — a single item's override: its own
 *                                        rate, or exempt; neither = inherit
 *
 * Additive only (new table, new nullable columns), so nothing about an
 * existing bill or item changes until someone sets a tax up.
 */
async function ensureTaxTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tax_rates (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL DEFAULT 1,
      name VARCHAR(100) NOT NULL,
      code VARCHAR(30),
      rate NUMERIC(7,3) NOT NULL DEFAULT 0,
      account_id VARCHAR(36),
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by VARCHAR(100),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);

  const has = async (table) => {
    const [[r]] = await db.query(`SELECT to_regclass(current_schema() || '.' || :t) IS NOT NULL AS ok`, { replacements: { t: table } });
    return !!r?.ok;
  };
  if (await has('categories')) {
    await db.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS tax_rate_id VARCHAR(36)`);
  }
  for (const table of ['services', 'inventory_items', 'lab_tests']) {
    if (!(await has(table))) continue;
    await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tax_rate_id VARCHAR(36)`);
    await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN NOT NULL DEFAULT FALSE`);
  }
}

module.exports = { ensureTaxTables };
