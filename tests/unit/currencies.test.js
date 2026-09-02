const { query, scalar, tableExists, columnExists, getColumns, closeConnection } = require('../setup/testDb');
const { cleanupTestData, ensureBaseCurrencies, createTestExchangeRate, TEST_CLINIC_ID } = require('../setup/testData');

beforeAll(async () => {
  await ensureBaseCurrencies();
});

afterAll(async () => {
  await cleanupTestData();
  await closeConnection();
});

describe('Currency & Exchange Rate Module – Unit Tests', () => {
  // ─── Currencies Table ────────────────────────────────────
  describe('Currencies Table', () => {
    test('currencies table exists', async () => {
      expect(await tableExists('currencies')).toBe(true);
    });

    test('currencies has required columns', async () => {
      for (const col of ['id', 'code', 'name', 'symbol', 'is_base_currency', 'decimal_places', 'is_active']) {
        expect(await columnExists('currencies', col)).toBe(true);
      }
    });

    test('SSP is seeded as base currency', async () => {
      const rows = await query(`SELECT * FROM currencies WHERE code = 'SSP'`);
      expect(rows.length).toBe(1);
      expect(rows[0].is_base_currency).toBeTruthy();
    });

    test('USD is seeded as non-base currency', async () => {
      const rows = await query(`SELECT * FROM currencies WHERE code = 'USD'`);
      expect(rows.length).toBe(1);
      expect(rows[0].is_base_currency).toBeFalsy();
    });

    test('exactly one base currency exists', async () => {
      const count = await scalar(`SELECT COUNT(*) FROM currencies WHERE is_base_currency = 1`);
      expect(parseInt(count)).toBe(1);
    });

    test('currency codes are unique', async () => {
      const total = await scalar(`SELECT COUNT(*) FROM currencies`);
      const distinct = await scalar(`SELECT COUNT(DISTINCT code) FROM currencies`);
      expect(parseInt(total)).toBe(parseInt(distinct));
    });
  });

  // ─── Exchange Rates Table ────────────────────────────────
  describe('Exchange Rates Table', () => {
    test('exchange_rates table exists', async () => {
      expect(await tableExists('exchange_rates')).toBe(true);
    });

    test('exchange_rates has buy/sell/spot columns', async () => {
      expect(await columnExists('exchange_rates', 'buy_rate')).toBe(true);
      expect(await columnExists('exchange_rates', 'sell_rate')).toBe(true);
      expect(await columnExists('exchange_rates', 'spot_rate')).toBe(true);
    });

    test('exchange_rates has notes column', async () => {
      expect(await columnExists('exchange_rates', 'notes')).toBe(true);
    });
  });

  // ─── Exchange Rate CRUD ──────────────────────────────────
  describe('Exchange Rate CRUD', () => {
    test('can create an exchange rate', async () => {
      const rate = await createTestExchangeRate();
      const row = await query(`SELECT * FROM exchange_rates WHERE id = :id`, { id: rate.id });
      expect(row.length).toBe(1);
      expect(parseFloat(row[0].rate)).toBe(5700);
    });

    test('can store buy/sell rates', async () => {
      const rate = await createTestExchangeRate({ buy_rate: 5680, sell_rate: 5720 });
      const row = await query(`SELECT buy_rate, sell_rate FROM exchange_rates WHERE id = :id`, { id: rate.id });
      expect(parseFloat(row[0].buy_rate)).toBe(5680);
      expect(parseFloat(row[0].sell_rate)).toBe(5720);
    });

    test('can store spot rate', async () => {
      const rate = await createTestExchangeRate({ spot_rate: 5695 });
      const row = await query(`SELECT spot_rate FROM exchange_rates WHERE id = :id`, { id: rate.id });
      expect(parseFloat(row[0].spot_rate)).toBe(5695);
    });

    test('rates are stored with correct currency pair', async () => {
      const rate = await createTestExchangeRate({ from_currency: 'USD', to_currency: 'SSP' });
      const row = await query(`SELECT from_currency, to_currency FROM exchange_rates WHERE id = :id`, { id: rate.id });
      expect(row[0].from_currency).toBe('USD');
      expect(row[0].to_currency).toBe('SSP');
    });

    test('can deactivate a rate', async () => {
      const rate = await createTestExchangeRate({ is_active: 1 });
      await query(`UPDATE exchange_rates SET is_active = 0 WHERE id = :id`, { id: rate.id });
      const row = await query(`SELECT is_active FROM exchange_rates WHERE id = :id`, { id: rate.id });
      expect(row[0].is_active).toBeFalsy();
    });

    test('can query active rates only', async () => {
      const r1 = await createTestExchangeRate({ is_active: 1 });
      const r2 = await createTestExchangeRate({ is_active: 0 });
      const active = await query(
        `SELECT * FROM exchange_rates WHERE id IN (:id1, :id2) AND is_active = 1`,
        { id1: r1.id, id2: r2.id }
      );
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(r1.id);
    });

    test('effective date is stored correctly', async () => {
      const today = new Date().toISOString().split('T')[0];
      const rate = await createTestExchangeRate({ effective_date: today });
      const row = await query(`SELECT effective_date FROM exchange_rates WHERE id = :id`, { id: rate.id });
      expect(new Date(row[0].effective_date).toISOString().split('T')[0]).toBe(today);
    });
  });

  // ─── Supporting Tables ───────────────────────────────────
  describe('Supporting Tables', () => {
    test('exchange_adjustments table exists', async () => {
      expect(await tableExists('exchange_adjustments')).toBe(true);
    });

    test('currency_conversion_log table exists', async () => {
      expect(await tableExists('currency_conversion_log')).toBe(true);
    });

    test('account_currency_balances table exists', async () => {
      expect(await tableExists('account_currency_balances')).toBe(true);
    });

    test('multicurrency_report_settings table exists', async () => {
      expect(await tableExists('multicurrency_report_settings')).toBe(true);
    });
  });

  // ─── Multi-Currency Columns on Existing Tables ───────────
  describe('Multi-Currency Columns', () => {
    test('chart_of_accounts has currency_code column', async () => {
      expect(await columnExists('chart_of_accounts', 'currency_code')).toBe(true);
    });

    test('chart_of_accounts has is_multicurrency column', async () => {
      expect(await columnExists('chart_of_accounts', 'is_multicurrency')).toBe(true);
    });

    test('gl_line_items has currency columns', async () => {
      for (const col of ['currency_code', 'amount_in_currency', 'exchange_rate', 'exchange_gain_loss']) {
        expect(await columnExists('gl_line_items', col)).toBe(true);
      }
    });

    test('journal_entry_lines has currency columns', async () => {
      for (const col of ['currency_code', 'amount_in_currency', 'exchange_rate']) {
        expect(await columnExists('journal_entry_lines', col)).toBe(true);
      }
    });

    test('invoices has exchange_rate and amount_in_base_currency', async () => {
      expect(await columnExists('invoices', 'exchange_rate')).toBe(true);
      expect(await columnExists('invoices', 'amount_in_base_currency')).toBe(true);
    });
  });
});
