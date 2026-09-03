const { query, scalar, tableExists, closeConnection } = require('../setup/testDb');
const {
  cleanupTestData, ensureBaseCurrencies, createTestExchangeRate,
  createTestConversionLog, createTestExchangeAdjustment, testId, TEST_CLINIC_ID
} = require('../setup/testData');

beforeAll(async () => {
  await ensureBaseCurrencies();
});

afterAll(async () => {
  await cleanupTestData();
  await closeConnection();
});

describe('Multi-Currency Integration Tests', () => {
  // ─── Exchange Rate Storage & Retrieval ───────────────────
  describe('Exchange Rate Storage & Retrieval', () => {
    test('stores exchange rates with correct pair', async () => {
      const rate = await createTestExchangeRate({ from_currency: 'USD', to_currency: 'SSP', rate: 5700 });
      const row = await query(`SELECT * FROM exchange_rates WHERE id = :id`, { id: rate.id });
      expect(row[0].from_currency).toBe('USD');
      expect(row[0].to_currency).toBe('SSP');
      expect(parseFloat(row[0].rate)).toBe(5700);
    });

    test('can store multiple rate types (buy/sell/spot)', async () => {
      const rate = await createTestExchangeRate({
        rate: 5700, buy_rate: 5680, sell_rate: 5720, spot_rate: 5695,
      });
      const row = await query(`SELECT rate, buy_rate, sell_rate, spot_rate FROM exchange_rates WHERE id = :id`, { id: rate.id });
      expect(parseFloat(row[0].rate)).toBe(5700);
      expect(parseFloat(row[0].buy_rate)).toBe(5680);
      expect(parseFloat(row[0].sell_rate)).toBe(5720);
      expect(parseFloat(row[0].spot_rate)).toBe(5695);
    });

    test('tracks rates by date', async () => {
      const r1 = await createTestExchangeRate({ effective_date: '2025-01-01', rate: 5500 });
      const r2 = await createTestExchangeRate({ effective_date: '2025-06-01', rate: 5700 });
      const r3 = await createTestExchangeRate({ effective_date: '2025-12-01', rate: 5900 });

      const rows = await query(
        `SELECT rate, effective_date FROM exchange_rates
         WHERE id IN (:id1, :id2, :id3) ORDER BY effective_date ASC`,
        { id1: r1.id, id2: r2.id, id3: r3.id }
      );
      expect(rows.length).toBe(3);
      expect(parseFloat(rows[0].rate)).toBe(5500);
      expect(parseFloat(rows[2].rate)).toBe(5900);
    });

    test('can find latest active rate for a currency pair', async () => {
      const today = new Date().toISOString().split('T')[0];
      // Deactivate any old test rates first
      const r1 = await createTestExchangeRate({ effective_date: '2024-01-01', rate: 5000, is_active: false });
      const r2 = await createTestExchangeRate({ effective_date: today, rate: 5700, is_active: true });

      const latest = await query(
        `SELECT * FROM exchange_rates
         WHERE from_currency = 'USD' AND to_currency = 'SSP' AND is_active = TRUE AND source = 'test'
         ORDER BY effective_date DESC LIMIT 1`
      );
      expect(latest.length).toBeGreaterThanOrEqual(1);
      expect(parseFloat(latest[0].rate)).toBeGreaterThanOrEqual(5700);
    });

    test('handles multiple currency pairs', async () => {
      // Simulate EUR/SSP pair
      const usdRate = await createTestExchangeRate({ from_currency: 'USD', to_currency: 'SSP', rate: 5700 });
      // Use same table for another pair
      const eurId = testId();
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await query(
        `INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, source, is_active, created_at, updated_at)
         VALUES (:id, :cid, 'EUR', 'SSP', 6200, :ed, 'test', TRUE, :now, :now)`,
        { id: eurId, cid: TEST_CLINIC_ID, ed: new Date().toISOString().split('T')[0], now }
      );

      const usd = await query(`SELECT rate FROM exchange_rates WHERE id = :id`, { id: usdRate.id });
      const eur = await query(`SELECT rate FROM exchange_rates WHERE id = :id`, { id: eurId });
      expect(parseFloat(usd[0].rate)).toBe(5700);
      expect(parseFloat(eur[0].rate)).toBe(6200);
    });

    test('bid/ask spread is correctly stored', async () => {
      const rate = await createTestExchangeRate({ buy_rate: 5680, sell_rate: 5720 });
      const row = await query(`SELECT buy_rate, sell_rate FROM exchange_rates WHERE id = :id`, { id: rate.id });
      const spread = parseFloat(row[0].sell_rate) - parseFloat(row[0].buy_rate);
      expect(spread).toBe(40);
    });
  });

  // ─── Currency Conversion ─────────────────────────────────
  describe('Currency Conversion', () => {
    test('conversion log stores all fields', async () => {
      const log = await createTestConversionLog({
        from_currency: 'USD', to_currency: 'SSP',
        amount_source: 100, rate_used: 5700, amount_converted: 570000,
      });
      const row = await query(`SELECT * FROM currency_conversion_log WHERE id = :id`, { id: log.id });
      expect(row.length).toBe(1);
      expect(parseFloat(row[0].amount_source)).toBe(100);
      expect(parseFloat(row[0].rate_used)).toBe(5700);
      expect(parseFloat(row[0].amount_converted)).toBe(570000);
    });

    test('conversion math is accurate (amount × rate = converted)', async () => {
      const amount = 250;
      const rate = 5700;
      const converted = amount * rate;
      const log = await createTestConversionLog({
        amount_source: amount, rate_used: rate, amount_converted: converted,
      });
      const row = await query(`SELECT amount_source, rate_used, amount_converted FROM currency_conversion_log WHERE id = :id`, { id: log.id });
      expect(parseFloat(row[0].amount_source) * parseFloat(row[0].rate_used))
        .toBe(parseFloat(row[0].amount_converted));
    });

    test('can query conversion history by date', async () => {
      const today = new Date().toISOString().split('T')[0];
      await createTestConversionLog({ conversion_date: today });
      const rows = await query(
        `SELECT * FROM currency_conversion_log WHERE conversion_date = :d AND id LIKE 't-%'`,
        { d: today }
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    test('conversion log tracks source transaction', async () => {
      const log = await createTestConversionLog({
        source_transaction_type: 'invoice',
        source_transaction_id: 'inv-123',
      });
      const row = await query(`SELECT source_transaction_type, source_transaction_id FROM currency_conversion_log WHERE id = :id`, { id: log.id });
      expect(row[0].source_transaction_type).toBe('invoice');
      expect(row[0].source_transaction_id).toBe('inv-123');
    });
  });

  // ─── Exchange Adjustments ────────────────────────────────
  describe('Exchange Adjustments (Gain/Loss)', () => {
    test('can record realized exchange gain', async () => {
      const adj = await createTestExchangeAdjustment({
        original_rate: 5700, settlement_rate: 5750,
        original_amount: 100, original_base_amount: 570000,
        settlement_base_amount: 575000, realized_gain_loss: 5000,
        adjustment_type: 'receivable', adjustment_status: 'realized',
      });
      const row = await query(`SELECT * FROM exchange_adjustments WHERE id = :id`, { id: adj.id });
      expect(parseFloat(row[0].realized_gain_loss)).toBe(5000);
      expect(row[0].adjustment_type).toBe('receivable');
    });

    test('can record exchange loss (negative gain)', async () => {
      const adj = await createTestExchangeAdjustment({
        original_rate: 5700, settlement_rate: 5650,
        original_amount: 100, original_base_amount: 570000,
        settlement_base_amount: 565000, realized_gain_loss: -5000,
      });
      const row = await query(`SELECT realized_gain_loss FROM exchange_adjustments WHERE id = :id`, { id: adj.id });
      expect(parseFloat(row[0].realized_gain_loss)).toBe(-5000);
    });

    test('can record unrealized gain/loss', async () => {
      const adj = await createTestExchangeAdjustment({
        unrealized_gain_loss: 3000, realized_gain_loss: 0,
        adjustment_type: 'receivable', adjustment_status: 'pending',
      });
      const row = await query(`SELECT unrealized_gain_loss, adjustment_status FROM exchange_adjustments WHERE id = :id`, { id: adj.id });
      expect(parseFloat(row[0].unrealized_gain_loss)).toBe(3000);
      expect(row[0].adjustment_status).toBe('pending');
    });

    test('gain/loss calculation is correct: (settlement_rate - original_rate) × amount', async () => {
      const origRate = 5700;
      const settleRate = 5800;
      const amount = 100;
      const expectedGL = (settleRate - origRate) * amount;

      const adj = await createTestExchangeAdjustment({
        original_rate: origRate, settlement_rate: settleRate,
        original_amount: amount, realized_gain_loss: expectedGL,
      });
      const row = await query(`SELECT original_rate, settlement_rate, original_amount, realized_gain_loss FROM exchange_adjustments WHERE id = :id`, { id: adj.id });
      const calc = (parseFloat(row[0].settlement_rate) - parseFloat(row[0].original_rate)) * parseFloat(row[0].original_amount);
      expect(calc).toBe(parseFloat(row[0].realized_gain_loss));
    });

    test('can sum total realized gains/losses', async () => {
      const a1 = await createTestExchangeAdjustment({ realized_gain_loss: 5000 });
      const a2 = await createTestExchangeAdjustment({ realized_gain_loss: -3000 });
      const total = await scalar(
        `SELECT SUM(realized_gain_loss) FROM exchange_adjustments WHERE id IN (:id1, :id2)`,
        { id1: a1.id, id2: a2.id }
      );
      expect(parseFloat(total)).toBe(2000);
    });
  });
});
