/**
 * C1: receipts.js's reversePaymentGL used to hardcode 'SSP'/exchange_rate 1.0
 * for every reversal — voiding a USD payment reversed only the raw USD
 * number as if it were that many SSP, silently wrong by the exchange rate
 * (e.g. a $100 payment, meant to reverse ~450,000 SSP, reversed as if it
 * were 100 SSP). It now looks up the ORIGINAL journal entry by this
 * receipt's own RCP-<id> reference and reverses at THAT entry's currency and
 * rate — not today's, which may have moved since the payment was taken.
 *
 * Runs against tenant_test, never a real tenant.
 */
const { v4: uuidv4 } = require('uuid');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const ORIGINAL_RATE = 4500; // the rate the ORIGINAL payment was posted at
const TODAY_RATE = 4700; // a DIFFERENT rate "in effect" now — the reversal must NOT use this

let sequelize;
let testConn;
let reversePaymentGL;
let cashAccountId;
let receivableAccountId;
let originalRateId;
let todayRateId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  ({ reversePaymentGL } = require('../../src/server/routes/receipts'));

  const [[cash]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1100'`, { replacements: { c: TEST_CLINIC_ID } });
  const [[receivable]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1200'`, { replacements: { c: TEST_CLINIC_ID } });
  cashAccountId = cash.id;
  receivableAccountId = receivable.id;

  // Two DIFFERENT USD->SSP rates in effect on two different dates — the
  // reversal must pick up the ORIGINAL entry's rate (4500), never "today's"
  // (4700), regardless of which one a fresh lookup would currently return.
  originalRateId = uuidv4();
  todayRateId = uuidv4();
  await sequelize.query(
    `INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active)
     VALUES (:id, :c, 'USD', 'SSP', :rate, '2025-01-01', true)`,
    { replacements: { id: originalRateId, c: TEST_CLINIC_ID, rate: ORIGINAL_RATE } }
  );
  await sequelize.query(
    `INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active)
     VALUES (:id, :c, 'USD', 'SSP', :rate, '2026-01-01', true)`,
    { replacements: { id: todayRateId, c: TEST_CLINIC_ID, rate: TODAY_RATE } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM journal_entry_lines WHERE je_id IN (SELECT id FROM journal_entries WHERE description LIKE 'RRCTEST-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE description LIKE 'RRCTEST-%'`);
    await sequelize.query(`DELETE FROM journal_entries WHERE description LIKE 'RRCTEST-%'`);
    await sequelize.query(`DELETE FROM exchange_rates WHERE id IN (:a, :b)`, { replacements: { a: originalRateId, b: todayRateId } });
  } catch (e) { console.warn('receiptReversalCurrency cleanup failed (non-fatal):', e.message); }
});

describe('C1: reversePaymentGL reverses at the ORIGINAL entry\'s currency and rate', () => {
  test('a USD payment is reversed using its own recorded rate, not today\'s', async () => {
    const receiptRef = `RCP-RRCTEST-${Date.now()}`;
    const usdAmount = 100;

    const originalJeId = await withTenant(async () => {
      const t = await sequelize.transaction();
      // Simulate the ORIGINAL payment posting: 100 USD at 4500, base 450000 SSP.
      const { postJournalEntry } = require('../../src/server/services/JournalPostingService');
      const je = await postJournalEntry({
        clinicId: TEST_CLINIC_ID, transaction: t, entryDate: '2025-06-01', currency: 'USD',
        description: 'RRCTEST-original-payment', reference: receiptRef,
        lines: [
          { accountId: cashAccountId, debit: usdAmount, description: 'RRCTEST original debit' },
          { accountId: receivableAccountId, credit: usdAmount, description: 'RRCTEST original credit' },
        ],
        userId: 'test-system',
      });
      await t.commit();
      return je.id;
    });

    const [[originalJe]] = await sequelize.query(`SELECT exchange_rate, base_total_debit FROM journal_entries WHERE id = :id`, { replacements: { id: originalJeId } });
    expect(parseFloat(originalJe.exchange_rate)).toBe(ORIGINAL_RATE); // sanity: picked up the rate in effect on 2025-06-01, not 2026's

    const reversalJe = await withTenant(async () => {
      const t = await sequelize.transaction();
      const reversal = await reversePaymentGL({
        clinicId: TEST_CLINIC_ID, billId: null, amount: usdAmount, paymentMethod: 'cash',
        reference: receiptRef, description: 'RRCTEST-reversal', userId: 'test-system', transaction: t,
      });
      await t.commit();
      return reversal;
    });

    // The whole point of C1: reversed at the ORIGINAL rate (4500), not
    // today's (4700) — and definitely not 1:1.
    expect(reversalJe.transaction_currency).toBe('USD');
    expect(parseFloat(reversalJe.exchange_rate)).toBe(ORIGINAL_RATE);
    expect(parseFloat(reversalJe.base_total_debit)).toBe(parseFloat(originalJe.base_total_debit));
    expect(parseFloat(reversalJe.base_total_debit)).toBe(usdAmount * ORIGINAL_RATE);
    expect(parseFloat(reversalJe.base_total_debit)).not.toBe(usdAmount); // not the old 1:1 bug
    expect(parseFloat(reversalJe.base_total_debit)).not.toBe(usdAmount * TODAY_RATE); // not today's rate either
  });
});
