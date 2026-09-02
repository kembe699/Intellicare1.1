const { query, scalar, tableExists, columnExists, closeConnection } = require('../setup/testDb');
const {
  cleanupTestData, ensureBaseCurrencies, createTestGLEntry, createTestGLLineItem,
  createTestJournalEntry, testId, TEST_CLINIC_ID
} = require('../setup/testData');

beforeAll(async () => {
  await ensureBaseCurrencies();
});

afterAll(async () => {
  await cleanupTestData();
  await closeConnection();
});

describe('Ledger Integration Tests', () => {
  // ─── GL Entry Structure ──────────────────────────────────
  describe('GL Entry Structure', () => {
    test('general_ledger table exists', async () => {
      expect(await tableExists('general_ledger')).toBe(true);
    });

    test('gl_line_items table exists', async () => {
      expect(await tableExists('gl_line_items')).toBe(true);
    });

    test('general_ledger has currency columns', async () => {
      expect(await columnExists('general_ledger', 'transaction_currency')).toBe(true);
      expect(await columnExists('general_ledger', 'exchange_rate')).toBe(true);
    });

    test('gl_line_items has multi-currency columns', async () => {
      for (const col of ['currency_code', 'amount_in_currency', 'exchange_rate', 'exchange_gain_loss']) {
        expect(await columnExists('gl_line_items', col)).toBe(true);
      }
    });
  });

  // ─── Posting in Original Currency ────────────────────────
  describe('Posting in Original Currency', () => {
    test('GL entry stores currency code', async () => {
      const gl = await createTestGLEntry({ transaction_currency: 'USD', exchange_rate: 5700 });
      const row = await query(`SELECT transaction_currency, exchange_rate FROM general_ledger WHERE id = :id`, { id: gl.id });
      expect(row[0].transaction_currency).toBe('USD');
      expect(parseFloat(row[0].exchange_rate)).toBe(5700);
    });

    test('GL line items store amount in original currency', async () => {
      const gl = await createTestGLEntry({ transaction_currency: 'USD', exchange_rate: 5700, total_debit: 570000, total_credit: 570000 });
      const line = await createTestGLLineItem(gl.id, {
        debit_amount: 570000, credit_amount: 0,
        currency_code: 'USD', amount_in_currency: 100, exchange_rate: 5700,
      });
      const row = await query(`SELECT currency_code, amount_in_currency, exchange_rate, debit_amount FROM gl_line_items WHERE id = :id`, { id: line.id });
      expect(row[0].currency_code).toBe('USD');
      expect(parseFloat(row[0].amount_in_currency)).toBe(100);
      expect(parseFloat(row[0].exchange_rate)).toBe(5700);
      expect(parseFloat(row[0].debit_amount)).toBe(570000);
    });

    test('base currency entries have exchange_rate = 1', async () => {
      const gl = await createTestGLEntry({ transaction_currency: 'SSP', exchange_rate: 1 });
      const line = await createTestGLLineItem(gl.id, {
        debit_amount: 5000, currency_code: 'SSP', amount_in_currency: 5000, exchange_rate: 1,
      });
      const row = await query(`SELECT exchange_rate FROM gl_line_items WHERE id = :id`, { id: line.id });
      expect(parseFloat(row[0].exchange_rate)).toBe(1);
    });
  });

  // ─── Conversion to Base Currency ─────────────────────────
  describe('Conversion to Base Currency', () => {
    test('debit_amount stores base currency equivalent', async () => {
      const amountUSD = 200;
      const rate = 5700;
      const baseAmount = amountUSD * rate;

      const gl = await createTestGLEntry({ transaction_currency: 'USD', exchange_rate: rate, total_debit: baseAmount, total_credit: baseAmount });
      const line = await createTestGLLineItem(gl.id, {
        debit_amount: baseAmount, currency_code: 'USD', amount_in_currency: amountUSD, exchange_rate: rate,
      });
      const row = await query(`SELECT debit_amount, amount_in_currency, exchange_rate FROM gl_line_items WHERE id = :id`, { id: line.id });
      expect(parseFloat(row[0].debit_amount)).toBe(parseFloat(row[0].amount_in_currency) * parseFloat(row[0].exchange_rate));
    });

    test('multiple lines sum to GL entry totals', async () => {
      const gl = await createTestGLEntry({ total_debit: 10000, total_credit: 10000 });
      await createTestGLLineItem(gl.id, { debit_amount: 6000, credit_amount: 0 });
      await createTestGLLineItem(gl.id, { debit_amount: 4000, credit_amount: 0 });
      await createTestGLLineItem(gl.id, { debit_amount: 0, credit_amount: 10000 });

      const debitSum = await scalar(
        `SELECT SUM(debit_amount) FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
        { glId: gl.id }
      );
      const creditSum = await scalar(
        `SELECT SUM(credit_amount) FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
        { glId: gl.id }
      );
      expect(parseFloat(debitSum)).toBe(10000);
      expect(parseFloat(creditSum)).toBe(10000);
    });
  });

  // ─── Exchange Rate Tracking ──────────────────────────────
  describe('Exchange Rate Tracking on Entries', () => {
    test('each GL line tracks the rate used at posting time', async () => {
      const gl = await createTestGLEntry({ transaction_currency: 'USD', exchange_rate: 5700 });
      await createTestGLLineItem(gl.id, { exchange_rate: 5700, currency_code: 'USD' });
      await createTestGLLineItem(gl.id, { exchange_rate: 5700, currency_code: 'USD' });

      const rows = await query(
        `SELECT exchange_rate FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
        { glId: gl.id }
      );
      for (const row of rows) {
        expect(parseFloat(row.exchange_rate)).toBe(5700);
      }
    });

    test('journal entries track currency and rate', async () => {
      const je = await createTestJournalEntry({ transaction_currency: 'USD', exchange_rate: 5700 });
      const row = await query(`SELECT transaction_currency, exchange_rate FROM journal_entries WHERE id = :id`, { id: je.id });
      expect(row[0].transaction_currency).toBe('USD');
      expect(parseFloat(row[0].exchange_rate)).toBe(5700);
    });
  });

  // ─── Exchange Gain/Loss on Lines ─────────────────────────
  describe('Exchange Gain/Loss on Lines', () => {
    test('exchange_gain_loss column stores value', async () => {
      const gl = await createTestGLEntry();
      const line = await createTestGLLineItem(gl.id, { exchange_gain_loss: 150.50 });
      const row = await query(`SELECT exchange_gain_loss FROM gl_line_items WHERE id = :id`, { id: line.id });
      expect(parseFloat(row[0].exchange_gain_loss)).toBeCloseTo(150.50, 2);
    });

    test('negative exchange gain/loss (loss) is stored', async () => {
      const gl = await createTestGLEntry();
      const line = await createTestGLLineItem(gl.id, { exchange_gain_loss: -200 });
      const row = await query(`SELECT exchange_gain_loss FROM gl_line_items WHERE id = :id`, { id: line.id });
      expect(parseFloat(row[0].exchange_gain_loss)).toBe(-200);
    });

    test('can sum exchange gain/loss across entries', async () => {
      const gl = await createTestGLEntry();
      await createTestGLLineItem(gl.id, { exchange_gain_loss: 500 });
      await createTestGLLineItem(gl.id, { exchange_gain_loss: -300 });

      const total = await scalar(
        `SELECT SUM(exchange_gain_loss) FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
        { glId: gl.id }
      );
      expect(parseFloat(total)).toBe(200);
    });
  });

  // ─── Double-Entry Balancing ──────────────────────────────
  describe('Double-Entry Balancing', () => {
    test('GL entry debits equal credits', async () => {
      const gl = await createTestGLEntry({ total_debit: 25000, total_credit: 25000 });
      const row = await query(`SELECT total_debit, total_credit FROM general_ledger WHERE id = :id`, { id: gl.id });
      expect(parseFloat(row[0].total_debit)).toBe(parseFloat(row[0].total_credit));
    });

    test('line items debit sum equals credit sum for balanced entry', async () => {
      const gl = await createTestGLEntry({ total_debit: 8000, total_credit: 8000 });
      await createTestGLLineItem(gl.id, { debit_amount: 5000, credit_amount: 0 });
      await createTestGLLineItem(gl.id, { debit_amount: 3000, credit_amount: 0 });
      await createTestGLLineItem(gl.id, { debit_amount: 0, credit_amount: 8000 });

      const debitSum = await scalar(
        `SELECT SUM(debit_amount) FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
        { glId: gl.id }
      );
      const creditSum = await scalar(
        `SELECT SUM(credit_amount) FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
        { glId: gl.id }
      );
      expect(parseFloat(debitSum)).toBe(parseFloat(creditSum));
    });
  });
});
