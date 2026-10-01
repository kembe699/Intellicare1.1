/**
 * Daily Expenses posts each category to a specific chart-of-accounts code
 * (CATEGORY_EXPENSE_CODE in routes/daily-expenses.js), but getAccountByCode
 * only returns ACTIVE accounts — a tenant where one of those codes was never
 * marked essential (or, for 5440 Administrative Expenses, never existed at
 * all before it was added) silently fails to post that category's expenses
 * to GL. ensureDailyExpenseAccounts creates-if-missing and activates every
 * code daily-expenses.js's category map can target, the same self-heal
 * pattern used for the 5610 FX account.
 *
 * Uses getTenantConnection directly (not tests/setup/testDb.js's own
 * connection) — same reasoning as billCreationAtomicity.test.js: this repo
 * has two separate `sequelize` installs, and ensureDailyExpenseAccounts is
 * exercised here exactly as runBackgroundMigrations calls it in production
 * (a real tenant connection's sequelize instance).
 */
const { getTenantConnection } = require('../../src/server/tenantDb');
const { ensureDailyExpenseAccounts } = require('../../src/server/scripts/ensureDailyExpenseAccounts');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const REQUIRED_CODES = ['5200', '5310', '5330', '5440', '5800'];

let sequelize;

beforeAll(async () => {
  const testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
}, 30000);

describe('ensureDailyExpenseAccounts', () => {
  test('every code routes/daily-expenses.js can post to ends up active for clinic 1', async () => {
    // Start from a known-bad state: deactivate (or remove) whatever is there,
    // so the test actually exercises both the insert and the activate path.
    await sequelize.query(
      `UPDATE chart_of_accounts SET is_active = false WHERE clinic_id = 1 AND account_code IN (:codes)`,
      { replacements: { codes: REQUIRED_CODES } }
    );
    await sequelize.query(`DELETE FROM chart_of_accounts WHERE clinic_id = 1 AND account_code = '5440'`);

    await ensureDailyExpenseAccounts(sequelize);

    const [rows] = await sequelize.query(
      `SELECT account_code, account_name, account_type, is_active FROM chart_of_accounts WHERE clinic_id = 1 AND account_code IN (:codes)`,
      { replacements: { codes: REQUIRED_CODES } }
    );
    expect(rows.length).toBe(REQUIRED_CODES.length);
    for (const row of rows) {
      expect(row.is_active).toBe(true);
      expect(row.account_type).toBe('expense');
    }
    const code5440 = rows.find((r) => r.account_code === '5440');
    expect(code5440.account_name).toBe('Administrative Expenses');
  });

  test('is idempotent — a second run leaves one row per code, still active', async () => {
    await ensureDailyExpenseAccounts(sequelize);
    const [rows] = await sequelize.query(
      `SELECT account_code FROM chart_of_accounts WHERE clinic_id = 1 AND account_code IN (:codes)`,
      { replacements: { codes: REQUIRED_CODES } }
    );
    expect(rows.length).toBe(REQUIRED_CODES.length);
  });
});
