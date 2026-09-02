const { query, scalar, timed, closeConnection } = require('../setup/testDb');
const {
  cleanupTestData, ensureBaseCurrencies, createTestInvoice, createTestGLEntry,
  createTestGLLineItem, createTestExchangeRate, createTestConversionLog,
  testId, TEST_CLINIC_ID
} = require('../setup/testData');

beforeAll(async () => {
  await ensureBaseCurrencies();
});

afterAll(async () => {
  await cleanupTestData();
  await closeConnection();
});

describe('Performance Tests', () => {
  // ─── Query Performance ───────────────────────────────────
  describe('Query Performance', () => {
    test('unpaid invoices query completes in < 500ms', async () => {
      const [rows, elapsed] = await timed(() =>
        query(`SELECT i.*, p.first_name, p.last_name
               FROM invoices i
               LEFT JOIN patients p ON p.id = i.patient_id
               WHERE i.status = 'unpaid' AND i.balance_due > 0
               AND i.clinic_id = :cid
               ORDER BY i.due_date DESC
               LIMIT 100`, { cid: TEST_CLINIC_ID })
      );
      console.log(`  ⏱ Unpaid invoices query: ${elapsed}ms (${rows.length} rows)`);
      expect(elapsed).toBeLessThan(500);
    });

    test('balance by currency query completes in < 500ms', async () => {
      const [rows, elapsed] = await timed(() =>
        query(`SELECT currency_code, SUM(balance_in_currency) as total_balance,
                      SUM(balance_in_base_currency) as total_base
               FROM account_currency_balances
               WHERE clinic_id = :cid
               GROUP BY currency_code`, { cid: TEST_CLINIC_ID })
      );
      console.log(`  ⏱ Balance by currency query: ${elapsed}ms (${rows.length} rows)`);
      expect(elapsed).toBeLessThan(500);
    });

    test('ledger totals calculation completes in < 500ms', async () => {
      const [rows, elapsed] = await timed(() =>
        query(`SELECT
                 SUM(total_debit) as total_debits,
                 SUM(total_credit) as total_credits,
                 COUNT(*) as entry_count
               FROM general_ledger
               WHERE clinic_id = :cid AND status = 'posted'`, { cid: TEST_CLINIC_ID })
      );
      console.log(`  ⏱ Ledger totals query: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(500);
    });

    test('exchange rate lookup completes in < 100ms', async () => {
      const [rows, elapsed] = await timed(() =>
        query(`SELECT * FROM exchange_rates
               WHERE from_currency = 'USD' AND to_currency = 'SSP'
               AND is_active = 1
               ORDER BY effective_date DESC
               LIMIT 1`)
      );
      console.log(`  ⏱ Exchange rate lookup: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(100);
    });

    test('chart of accounts listing completes in < 200ms', async () => {
      const [rows, elapsed] = await timed(() =>
        query(`SELECT * FROM chart_of_accounts
               WHERE clinic_id = :cid AND is_active = 1
               ORDER BY account_code`, { cid: TEST_CLINIC_ID })
      );
      console.log(`  ⏱ Chart of accounts listing: ${elapsed}ms (${rows.length} rows)`);
      expect(elapsed).toBeLessThan(200);
    });

    test('insurance claims listing completes in < 500ms', async () => {
      const [rows, elapsed] = await timed(() =>
        query(`SELECT c.*, COUNT(ci.id) as item_count
               FROM insurance_batch_claims c
               LEFT JOIN insurance_batch_claim_items ci ON ci.claim_id = c.id
               WHERE c.clinic_id = :cid
               GROUP BY c.id
               ORDER BY c.created_at DESC
               LIMIT 50`, { cid: TEST_CLINIC_ID })
      );
      console.log(`  ⏱ Insurance claims listing: ${elapsed}ms (${rows.length} rows)`);
      expect(elapsed).toBeLessThan(500);
    });

    test('conversion log query completes in < 200ms', async () => {
      const [rows, elapsed] = await timed(() =>
        query(`SELECT * FROM currency_conversion_log
               WHERE clinic_id = :cid
               ORDER BY conversion_date DESC
               LIMIT 100`, { cid: TEST_CLINIC_ID })
      );
      console.log(`  ⏱ Conversion log query: ${elapsed}ms (${rows.length} rows)`);
      expect(elapsed).toBeLessThan(200);
    });

    test('exchange adjustments summary completes in < 200ms', async () => {
      const [rows, elapsed] = await timed(() =>
        query(`SELECT
                 SUM(realized_gain_loss) as total_realized,
                 SUM(unrealized_gain_loss) as total_unrealized,
                 COUNT(*) as total_count
               FROM exchange_adjustments
               WHERE clinic_id = :cid`, { cid: TEST_CLINIC_ID })
      );
      console.log(`  ⏱ Exchange adjustments summary: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(200);
    });
  });

  // ─── Bulk Operations ─────────────────────────────────────
  describe('Bulk Operations', () => {
    test('bulk insert 100 invoices in < 10s', async () => {
      const [_, elapsed] = await timed(async () => {
        for (let i = 0; i < 100; i++) {
          await createTestInvoice({
            invoice_number: `TPERF-${Date.now()}-${i}`,
            total_amount: Math.round(Math.random() * 50000),
            status: i % 3 === 0 ? 'paid' : 'unpaid',
          });
        }
      });
      console.log(`  ⏱ Bulk insert 100 invoices: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(10000);
    });

    test('bulk insert 50 GL entries with lines in < 10s', async () => {
      const [_, elapsed] = await timed(async () => {
        for (let i = 0; i < 50; i++) {
          const amount = Math.round(Math.random() * 100000);
          const gl = await createTestGLEntry({
            total_debit: amount, total_credit: amount,
            description: `Perf test entry ${i}`,
          });
          await createTestGLLineItem(gl.id, { debit_amount: amount });
          await createTestGLLineItem(gl.id, { credit_amount: amount });
        }
      });
      console.log(`  ⏱ Bulk insert 50 GL entries + lines: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(10000);
    });

    test('bulk insert 50 exchange rates in < 5s', async () => {
      const [_, elapsed] = await timed(async () => {
        for (let i = 0; i < 50; i++) {
          await createTestExchangeRate({
            rate: 5500 + Math.round(Math.random() * 500),
            effective_date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
            is_active: i === 49 ? 1 : 0, // only latest active
          });
        }
      });
      console.log(`  ⏱ Bulk insert 50 exchange rates: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(5000);
    });

    test('bulk conversion logging (100 entries) in < 5s', async () => {
      const [_, elapsed] = await timed(async () => {
        for (let i = 0; i < 100; i++) {
          await createTestConversionLog({
            amount_source: Math.round(Math.random() * 1000),
            rate_used: 5700,
            amount_converted: Math.round(Math.random() * 5700000),
          });
        }
      });
      console.log(`  ⏱ Bulk insert 100 conversion logs: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ─── Aggregate Query Performance ─────────────────────────
  describe('Aggregate Query Performance', () => {
    test('multi-currency dashboard aggregation in < 1s', async () => {
      const [_, elapsed] = await timed(async () => {
        await query(`SELECT currency, COUNT(*) as cnt, SUM(balance_due) as total
                     FROM invoices WHERE clinic_id = :cid GROUP BY currency`, { cid: TEST_CLINIC_ID });
        await query(`SELECT from_currency, to_currency, rate, effective_date
                     FROM exchange_rates WHERE is_active = 1 AND clinic_id = :cid
                     ORDER BY effective_date DESC`, { cid: TEST_CLINIC_ID });
        await query(`SELECT currency_code, SUM(balance_in_currency) as total
                     FROM account_currency_balances WHERE clinic_id = :cid
                     GROUP BY currency_code`, { cid: TEST_CLINIC_ID });
      });
      console.log(`  ⏱ Dashboard aggregation (3 queries): ${elapsed}ms`);
      expect(elapsed).toBeLessThan(1000);
    });

    test('financial report generation query in < 2s', async () => {
      const [_, elapsed] = await timed(async () => {
        // P&L style query
        await query(`SELECT ca.account_type, ca.account_code, ca.account_name,
                       COALESCE(SUM(gli.debit_amount), 0) as total_debit,
                       COALESCE(SUM(gli.credit_amount), 0) as total_credit
                     FROM chart_of_accounts ca
                     LEFT JOIN gl_line_items gli ON gli.account_id = ca.id
                     LEFT JOIN general_ledger gl ON gl.id = gli.gl_id AND gl.status = 'posted'
                     WHERE ca.clinic_id = :cid AND ca.is_active = 1
                     GROUP BY ca.account_type, ca.account_code, ca.account_name
                     ORDER BY ca.account_code`, { cid: TEST_CLINIC_ID });
      });
      console.log(`  ⏱ Financial report query: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
