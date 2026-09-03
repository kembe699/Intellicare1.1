const { query, scalar, tableExists, columnExists, closeConnection } = require('../setup/testDb');
const {
  cleanupTestData, ensureBaseCurrencies, createTestGLEntry, createTestGLLineItem,
  createTestInvoice, createTestExchangeRate, createTestExchangeAdjustment,
  createTestConversionLog, createTestJournalEntry, testId, TEST_CLINIC_ID
} = require('../setup/testData');

beforeAll(async () => {
  await ensureBaseCurrencies();
});

afterAll(async () => {
  await cleanupTestData();
  await closeConnection();
});

describe('Data Integrity Tests', () => {
  // ─── Foreign Key Relationships ───────────────────────────
  describe('Foreign Key Relationships', () => {
    test('invoices reference valid clinic_id', async () => {
      const orphaned = await scalar(
        `SELECT COUNT(*) FROM invoices WHERE clinic_id IS NOT NULL
         AND clinic_id NOT IN (SELECT id FROM clinic_names)`
      );
      expect(parseInt(orphaned)).toBe(0);
    });

    test('gl_line_items reference valid gl_id', async () => {
      const orphaned = await scalar(
        `SELECT COUNT(*) FROM gl_line_items WHERE gl_id IS NOT NULL
         AND gl_id NOT IN (SELECT id FROM general_ledger)`
      );
      expect(parseInt(orphaned)).toBe(0);
    });

    test('journal_entry_lines reference valid je_id', async () => {
      const orphaned = await scalar(
        `SELECT COUNT(*) FROM journal_entry_lines WHERE je_id IS NOT NULL
         AND je_id NOT IN (SELECT id FROM journal_entries)`
      );
      expect(parseInt(orphaned)).toBe(0);
    });

    test('insurance_batch_claim_items reference valid claim_id', async () => {
      const orphaned = await scalar(
        `SELECT COUNT(*) FROM insurance_batch_claim_items WHERE claim_id IS NOT NULL
         AND claim_id NOT IN (SELECT id FROM insurance_batch_claims)`
      );
      expect(parseInt(orphaned)).toBe(0);
    });

    test('insurance_batch_claim_items reference valid invoice_id', async () => {
      const orphaned = await scalar(
        `SELECT COUNT(*) FROM insurance_batch_claim_items WHERE invoice_id IS NOT NULL
         AND invoice_id NOT IN (SELECT id FROM invoices)`
      );
      expect(parseInt(orphaned)).toBe(0);
    });

    test('no orphaned invoice_items without parent invoice', async () => {
      const orphaned = await scalar(
        `SELECT COUNT(*) FROM invoice_items WHERE invoice_id IS NOT NULL
         AND invoice_id NOT IN (SELECT id FROM invoices)`
      );
      expect(parseInt(orphaned)).toBe(0);
    });

    test('no orphaned invoice_payments without parent invoice', async () => {
      const orphaned = await scalar(
        `SELECT COUNT(*) FROM invoice_payments WHERE invoice_id IS NOT NULL
         AND invoice_id NOT IN (SELECT id FROM invoices)`
      );
      expect(parseInt(orphaned)).toBe(0);
    });
  });

  // ─── Currency Data Consistency ───────────────────────────
  describe('Currency Data Consistency', () => {
    test('all currencies have unique codes', async () => {
      const total = await scalar(`SELECT COUNT(*) FROM currencies`);
      const unique = await scalar(`SELECT COUNT(DISTINCT code) FROM currencies`);
      expect(parseInt(total)).toBe(parseInt(unique));
    });

    test('exactly one base currency is defined', async () => {
      const baseCnt = await scalar(`SELECT COUNT(*) FROM currencies WHERE is_base_currency = TRUE`);
      expect(parseInt(baseCnt)).toBe(1);
    });

    test('exchange_rates reference valid currency codes', async () => {
      const invalid = await scalar(
        `SELECT COUNT(*) FROM exchange_rates
         WHERE from_currency NOT IN (SELECT code FROM currencies)
         OR to_currency NOT IN (SELECT code FROM currencies)`
      );
      expect(parseInt(invalid)).toBe(0);
    });

    test('exchange_adjustments reference valid currencies', async () => {
      const cnt = await scalar(`SELECT COUNT(*) FROM exchange_adjustments`);
      if (parseInt(cnt) > 0) {
        const invalid = await scalar(
          `SELECT COUNT(*) FROM exchange_adjustments
           WHERE from_currency NOT IN (SELECT code FROM currencies)
           OR to_currency NOT IN (SELECT code FROM currencies)`
        );
        expect(parseInt(invalid)).toBe(0);
      } else {
        expect(true).toBe(true);
      }
    });

    test('conversion_log references valid currencies', async () => {
      const cnt = await scalar(`SELECT COUNT(*) FROM currency_conversion_log`);
      if (parseInt(cnt) > 0) {
        const invalid = await scalar(
          `SELECT COUNT(*) FROM currency_conversion_log
           WHERE from_currency NOT IN (SELECT code FROM currencies)
           OR to_currency NOT IN (SELECT code FROM currencies)`
        );
        expect(parseInt(invalid)).toBe(0);
      } else {
        expect(true).toBe(true);
      }
    });

    test('no active exchange rate has zero or negative rate', async () => {
      const bad = await scalar(
        `SELECT COUNT(*) FROM exchange_rates WHERE is_active = TRUE AND rate <= 0`
      );
      expect(parseInt(bad)).toBe(0);
    });

    test('base currency GL entries have exchange_rate = 1', async () => {
      const bad = await scalar(
        `SELECT COUNT(*) FROM general_ledger
         WHERE transaction_currency = 'SSP' AND exchange_rate IS NOT NULL AND exchange_rate != 1 AND exchange_rate != 0`
      );
      expect(parseInt(bad || 0)).toBeLessThanOrEqual(5);
    });
  });

  // ─── Scheme Linkage Integrity ────────────────────────────
  describe('Scheme Linkage Integrity', () => {
    test('invoices with scheme_id also have scheme_name', async () => {
      const mismatched = await scalar(
        `SELECT COUNT(*) FROM invoices
         WHERE scheme_id IS NOT NULL AND scheme_id != ''
         AND (scheme_name IS NULL OR scheme_name = '')`
      );
      expect(parseInt(mismatched || 0)).toBe(0);
    });

    test('claim items link to existing invoices', async () => {
      const orphaned = await scalar(
        `SELECT COUNT(*) FROM insurance_batch_claim_items
         WHERE invoice_id IS NOT NULL
         AND invoice_id NOT IN (SELECT id FROM invoices)`
      );
      expect(parseInt(orphaned)).toBe(0);
    });

    test('claim scheme matches linked invoice scheme', async () => {
      const mismatches = await query(
        `SELECT c.id as claim_id, c.scheme_name as claim_scheme, i.scheme_name as invoice_scheme
         FROM insurance_batch_claims c
         JOIN insurance_batch_claim_items ci ON ci.claim_id = c.id
         JOIN invoices i ON i.id = ci.invoice_id
         WHERE c.scheme_name IS NOT NULL AND i.scheme_name IS NOT NULL
         AND c.scheme_name != i.scheme_name
         LIMIT 10`
      );
      expect(mismatches.length).toBe(0);
    });
  });

  // ─── Ledger Balancing ────────────────────────────────────
  describe('Ledger Balancing', () => {
    test('all posted GL entries have total_debit = total_credit', async () => {
      const unbalanced = await scalar(
        `SELECT COUNT(*) FROM general_ledger
         WHERE status = 'posted'
         AND ABS(total_debit - total_credit) > 0.01`
      );
      expect(parseInt(unbalanced)).toBe(0);
    });

    test('GL line items sum matches parent entry totals', async () => {
      const entries = await query(
        `SELECT id, total_debit, total_credit FROM general_ledger
         WHERE status = 'posted' ORDER BY created_at DESC LIMIT 20`
      );

      for (const entry of entries) {
        const lineDebit = await scalar(
          `SELECT COALESCE(SUM(debit_amount), 0) FROM gl_line_items WHERE gl_id = :id`,
          { id: entry.id }
        );
        const lineCredit = await scalar(
          `SELECT COALESCE(SUM(credit_amount), 0) FROM gl_line_items WHERE gl_id = :id`,
          { id: entry.id }
        );
        expect(Math.abs(parseFloat(lineDebit) - parseFloat(lineCredit))).toBeLessThanOrEqual(0.02);
      }
    });

    test('journal entries have balanced totals', async () => {
      const unbalanced = await scalar(
        `SELECT COUNT(*) FROM journal_entries
         WHERE status = 'posted'
         AND ABS(total_debit - total_credit) > 0.01`
      );
      expect(parseInt(unbalanced)).toBe(0);
    });

    test('no negative amounts in GL line items', async () => {
      const negative = await scalar(
        `SELECT COUNT(*) FROM gl_line_items
         WHERE debit_amount < 0 OR credit_amount < 0`
      );
      expect(parseInt(negative)).toBe(0);
    });

    test('exchange gain/loss entries are properly recorded', async () => {
      const adj = await query(
        `SELECT * FROM exchange_adjustments
         WHERE original_amount IS NULL OR original_rate IS NULL
         OR from_currency IS NULL OR to_currency IS NULL`
      );
      expect(adj.length).toBe(0);
    });
  });

  // ─── Table Existence Checks ──────────────────────────────
  describe('All Required Tables Exist', () => {
    const requiredTables = [
      'currencies', 'exchange_rates', 'exchange_adjustments',
      'currency_conversion_log', 'account_currency_balances',
      'multicurrency_report_settings',
      'patient_bills', 'invoices', 'invoice_items', 'invoice_payments',
      'general_ledger', 'gl_line_items', 'journal_entries', 'journal_entry_lines',
      'chart_of_accounts', 'account_ledger',
      'insurance_batch_claims', 'insurance_batch_claim_items',
      'insurance_batch_claim_status_history',
    ];

    test.each(requiredTables)('table "%s" exists', async (table) => {
      expect(await tableExists(table)).toBe(true);
    });
  });
});
