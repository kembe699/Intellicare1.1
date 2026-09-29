/**
 * N2/N3: JournalPostingService.postJournalEntry is the one shared place that
 * now creates a hand-built (non-GL) journal entry — patientDeposits.js
 * (postDepositGL), receipts.js (reversePaymentGL, reverseDepositUsageGL),
 * patientBills.js's payment-posting block, invoices.js, cashier.js and
 * cash-transfers.js all route through it. These prove:
 *   - it REQUIRES an open transaction and refuses to open its own (N2 — the
 *     whole point is that it commits/rolls back with whatever record it
 *     belongs to, not as an afterthought)
 *   - an unbalanced entry, or an entry missing accounts, throws rather than
 *     silently posting nothing
 *   - a failure inside it rolls back a SIBLING insert made in the same
 *     transaction, proving real atomicity (not just "this function has a
 *     transaction parameter")
 *   - currency conversion to base currency works (SSP base + USD transaction)
 *
 * Runs against tenant_test, never a real tenant.
 */
const { v4: uuidv4 } = require('uuid');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let postJournalEntry;
let cashAccountId;
let receivableAccountId;
let insertedRateId = null;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  ({ postJournalEntry } = require('../../src/server/services/JournalPostingService'));

  const [[cash]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1100'`, { replacements: { c: TEST_CLINIC_ID } });
  const [[receivable]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1200'`, { replacements: { c: TEST_CLINIC_ID } });
  cashAccountId = cash.id;
  receivableAccountId = receivable.id;

  const [[existingRate]] = await sequelize.query(
    `SELECT id FROM exchange_rates WHERE clinic_id = :c AND from_currency = 'USD' AND to_currency = 'SSP' AND is_active = true`,
    { replacements: { c: TEST_CLINIC_ID } }
  );
  if (!existingRate) {
    insertedRateId = uuidv4();
    await sequelize.query(
      `INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active)
       VALUES (:id, :c, 'USD', 'SSP', 4500, '2025-01-01', true)`,
      { replacements: { id: insertedRateId, c: TEST_CLINIC_ID } }
    );
  }
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM journal_entry_lines WHERE je_id IN (SELECT id FROM journal_entries WHERE description LIKE 'JPTEST-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE description LIKE 'JPTEST-%'`);
    await sequelize.query(`DELETE FROM journal_entries WHERE description LIKE 'JPTEST-%'`);
    if (insertedRateId) await sequelize.query(`DELETE FROM exchange_rates WHERE id = :id`, { replacements: { id: insertedRateId } });
  } catch (e) { console.warn('journalPosting cleanup failed (non-fatal):', e.message); }
});

describe('postJournalEntry — contract', () => {
  test('throws without an open transaction', async () => {
    await expect(postJournalEntry({
      clinicId: TEST_CLINIC_ID, entryDate: '2026-01-01', description: 'JPTEST-no-txn',
      lines: [{ accountId: cashAccountId, debit: 10 }, { accountId: receivableAccountId, credit: 10 }],
    })).rejects.toThrow(/requires an open transaction/);
  });

  test('throws on an unbalanced entry', async () => {
    await withTenant(async () => {
      const t = await sequelize.transaction();
      await expect(postJournalEntry({
        clinicId: TEST_CLINIC_ID, transaction: t, entryDate: '2026-01-01', description: 'JPTEST-unbalanced',
        lines: [{ accountId: cashAccountId, debit: 10 }, { accountId: receivableAccountId, credit: 9 }],
      })).rejects.toThrow(/not balanced/);
      await t.rollback();
    });
  });

  test('throws when a line has no resolved account', async () => {
    await withTenant(async () => {
      const t = await sequelize.transaction();
      await expect(postJournalEntry({
        clinicId: TEST_CLINIC_ID, transaction: t, entryDate: '2026-01-01', description: 'JPTEST-no-account',
        lines: [{ accountId: null, debit: 10 }, { accountId: receivableAccountId, credit: 10 }],
      })).rejects.toThrow(/resolved accountId/);
      await t.rollback();
    });
  });
});

describe('postJournalEntry — atomicity (N2)', () => {
  test('a posting failure rolls back a sibling insert made in the same transaction', async () => {
    const markerId = `JPTEST-ATOMIC-${Date.now()}`;
    await expect(withTenant(async () => {
      const t = await sequelize.transaction();
      try {
        // Simulate "create the primary record" (a receipt, a deposit, a bill payment...)
        await sequelize.query(
          `INSERT INTO receipts (id, receipt_number, receipt_type, clinic_id, total_amount, amount_paid, payment_amount, payment_method, payment_date, status, from_lease, created_at, updated_at)
           VALUES (:id, :id, 'payment', :clinicId, 10, 10, 10, 'cash', NOW(), 'active', false, NOW(), NOW())`,
          { replacements: { id: markerId, clinicId: TEST_CLINIC_ID }, transaction: t }
        );
        // Then the posting — deliberately unbalanced, so it throws.
        await postJournalEntry({
          clinicId: TEST_CLINIC_ID, transaction: t, entryDate: '2026-01-01', description: 'JPTEST-atomic-fail',
          lines: [{ accountId: cashAccountId, debit: 10 }, { accountId: receivableAccountId, credit: 5 }],
        });
        await t.commit();
      } catch (e) {
        await t.rollback();
        throw e;
      }
    })).rejects.toThrow(/not balanced/);

    const [rows] = await sequelize.query(`SELECT id FROM receipts WHERE id = :id`, { replacements: { id: markerId } });
    expect(rows).toHaveLength(0); // the "sibling" receipt insert was rolled back too
  });

  test('the happy path commits the entry with base-currency conversion (SSP base + USD transaction)', async () => {
    const je = await withTenant(async () => {
      const t = await sequelize.transaction();
      const created = await postJournalEntry({
        clinicId: TEST_CLINIC_ID, transaction: t, entryDate: '2026-01-01', currency: 'USD',
        description: 'JPTEST-usd-happy', reference: 'JPTEST-REF-1',
        lines: [
          { accountId: cashAccountId, debit: 100, description: 'JPTEST cash in' },
          { accountId: receivableAccountId, credit: 100, description: 'JPTEST receivable cleared' },
        ],
        userId: 'test-system',
      });
      await t.commit();
      return created;
    });

    expect(je.transaction_currency).toBe('USD');
    expect(je.base_currency).toBe('SSP');
    expect(parseFloat(je.exchange_rate)).toBeGreaterThan(1); // USD -> SSP is never 1:1
    expect(parseFloat(je.total_debit)).toBe(100);
    expect(parseFloat(je.base_total_debit)).toBe(Math.round(100 * parseFloat(je.exchange_rate) * 100) / 100);
    expect(parseFloat(je.base_total_debit)).toBe(parseFloat(je.base_total_credit)); // debits equal credits in base currency too

    const [lines] = await sequelize.query(`SELECT debit_amount, base_debit_amount, credit_amount, base_credit_amount FROM journal_entry_lines WHERE je_id = :id`, { replacements: { id: je.id } });
    const debitLine = lines.find((l) => parseFloat(l.debit_amount) > 0);
    const creditLine = lines.find((l) => parseFloat(l.credit_amount) > 0);
    expect(parseFloat(debitLine.base_debit_amount)).toBe(parseFloat(je.base_total_debit));
    expect(parseFloat(creditLine.base_credit_amount)).toBe(parseFloat(je.base_total_credit));

    const [ledgerRows] = await sequelize.query(`SELECT debit_amount, credit_amount FROM account_ledger WHERE reference_number = :n`, { replacements: { n: je.je_number } });
    expect(ledgerRows).toHaveLength(2);
    // account_ledger is always base-currency — never the raw USD 100.
    const totalDebit = ledgerRows.reduce((s, r) => s + parseFloat(r.debit_amount), 0);
    expect(totalDebit).toBe(parseFloat(je.base_total_debit));
  });
});
