/**
 * C6: AccountingService.createGLEntry converted each line independently,
 * so base debits and base credits could differ by a cent or two even though
 * the transaction-currency amounts balanced exactly (rounding several lines
 * independently does not generally sum to the same total as rounding the
 * sum once). The last line on each side now absorbs that remainder, so
 * gl_line_items always foot to the entry's own base_total_debit/
 * base_total_credit exactly. See JournalPostingService's identical fix
 * (journalPosting.test.js) for the hand-built-JE side of the same defect.
 *
 * Runs against tenant_test, never a real tenant.
 */
const { v4: uuidv4 } = require('uuid');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const UGX_RATE = 4507.777; // deliberately not round, to force per-line rounding drift

let sequelize;
let testConn;
let AccountingService;
let cashAccountId;
let receivableAccountId;
let ugxRateId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  AccountingService = require('../../src/server/services/AccountingService');

  const [[cash]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1100'`, { replacements: { c: TEST_CLINIC_ID } });
  const [[receivable]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1200'`, { replacements: { c: TEST_CLINIC_ID } });
  cashAccountId = cash.id;
  receivableAccountId = receivable.id;

  const [[existing]] = await sequelize.query(`SELECT id FROM exchange_rates WHERE clinic_id = :c AND from_currency = 'UGX' AND to_currency = 'SSP' AND is_active = true`, { replacements: { c: TEST_CLINIC_ID } });
  if (existing) {
    ugxRateId = null; // already present (e.g. journalPosting.test.js ran first and left it — shouldn't happen given its own afterAll, but don't fight over it if it does)
  } else {
    ugxRateId = uuidv4();
    await sequelize.query(
      `INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active)
       VALUES (:id, :c, 'UGX', 'SSP', :rate, '2025-01-01', true)`,
      { replacements: { id: ugxRateId, c: TEST_CLINIC_ID, rate: UGX_RATE } }
    );
  }
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE 'GLROUND-TEST-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE description LIKE 'GLROUND-TEST-%'`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE 'GLROUND-TEST-%'`);
    if (ugxRateId) await sequelize.query(`DELETE FROM exchange_rates WHERE id = :id`, { replacements: { id: ugxRateId } });
  } catch (e) { console.warn('glEntryRounding cleanup failed (non-fatal):', e.message); }
});

describe('C6: createGLEntry rounding absorption', () => {
  test('multiple lines converted at a non-round rate still foot exactly to the entry totals', async () => {
    const glEntry = await withTenant(() => AccountingService.createGLEntry(
      {
        clinic_id: TEST_CLINIC_ID,
        transaction_date: '2026-01-01',
        transaction_type: 'test',
        description: 'GLROUND-TEST-rounding',
        transaction_currency: 'UGX',
      },
      [
        // Three debit lines that do NOT divide evenly — independent per-line
        // rounding at UGX_RATE would very likely drift from the summed total.
        { account_id: cashAccountId, debit_amount: 33.33, credit_amount: 0, description: 'GLROUND-TEST line 1' },
        { account_id: cashAccountId, debit_amount: 33.33, credit_amount: 0, description: 'GLROUND-TEST line 2' },
        { account_id: cashAccountId, debit_amount: 33.34, credit_amount: 0, description: 'GLROUND-TEST line 3' },
        { account_id: receivableAccountId, debit_amount: 0, credit_amount: 100.00, description: 'GLROUND-TEST credit' },
      ],
      'test-system'
    ));

    const [lines] = await sequelize.query(
      `SELECT base_debit_amount, base_credit_amount FROM gl_line_items WHERE gl_id = :id`,
      { replacements: { id: glEntry.id } }
    );
    const sumBaseDebit = lines.reduce((s, l) => s + parseFloat(l.base_debit_amount), 0);
    const sumBaseCredit = lines.reduce((s, l) => s + parseFloat(l.base_credit_amount), 0);

    expect(Math.round(sumBaseDebit * 100) / 100).toBe(parseFloat(glEntry.base_total_debit));
    expect(Math.round(sumBaseCredit * 100) / 100).toBe(parseFloat(glEntry.base_total_credit));
    expect(parseFloat(glEntry.base_total_debit)).toBe(parseFloat(glEntry.base_total_credit));

    const [ledgerRows] = await sequelize.query(`SELECT debit_amount, credit_amount FROM account_ledger WHERE transaction_id = :id`, { replacements: { id: glEntry.id } });
    const ledgerDebit = ledgerRows.reduce((s, r) => s + parseFloat(r.debit_amount), 0);
    const ledgerCredit = ledgerRows.reduce((s, r) => s + parseFloat(r.credit_amount), 0);
    expect(Math.round(ledgerDebit * 100) / 100).toBe(parseFloat(glEntry.base_total_debit));
    expect(Math.round(ledgerCredit * 100) / 100).toBe(parseFloat(glEntry.base_total_credit));
  });
});
