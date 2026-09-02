const { query, scalar, tableExists, columnExists, closeConnection } = require('../setup/testDb');
const { cleanupTestData, createTestInvoice, createTestBill, testId, TEST_CLINIC_ID } = require('../setup/testData');

afterAll(async () => {
  await cleanupTestData();
  await closeConnection();
});

describe('Invoice Module – Unit Tests', () => {
  // ─── Table Structure ─────────────────────────────────────
  describe('Table Structure', () => {
    test('invoices table exists', async () => {
      expect(await tableExists('invoices')).toBe(true);
    });

    test('invoice_items table exists', async () => {
      expect(await tableExists('invoice_items')).toBe(true);
    });

    test('invoice_payments table exists', async () => {
      expect(await tableExists('invoice_payments')).toBe(true);
    });

    test('invoices has currency columns', async () => {
      expect(await columnExists('invoices', 'currency')).toBe(true);
      expect(await columnExists('invoices', 'exchange_rate')).toBe(true);
      expect(await columnExists('invoices', 'amount_in_base_currency')).toBe(true);
    });

    test('invoices has scheme columns', async () => {
      expect(await columnExists('invoices', 'scheme_id')).toBe(true);
      expect(await columnExists('invoices', 'scheme_name')).toBe(true);
    });
  });

  // ─── Invoice Creation ────────────────────────────────────
  describe('Invoice Creation', () => {
    test('can create an invoice with all fields', async () => {
      const inv = await createTestInvoice();
      const row = await query(`SELECT * FROM invoices WHERE id = :id`, { id: inv.id });
      expect(row.length).toBe(1);
      expect(row[0].invoice_number).toBe(inv.invoice_number);
      expect(parseFloat(row[0].amount)).toBe(5000);
    });

    test('invoice with scheme data persists correctly', async () => {
      const inv = await createTestInvoice({
        scheme_id: 'scheme-123',
        scheme_name: 'NHIF',
      });
      const row = await query(`SELECT scheme_id, scheme_name FROM invoices WHERE id = :id`, { id: inv.id });
      expect(row[0].scheme_id).toBe('scheme-123');
      expect(row[0].scheme_name).toBe('NHIF');
    });

    test('invoice tracks currency correctly', async () => {
      const inv = await createTestInvoice({
        currency_code: 'USD',
        exchange_rate: 5700,
        amount_in_base_currency: 28500000,
        amount: 5000,
      });
      const row = await query(`SELECT currency, exchange_rate, amount_in_base_currency FROM invoices WHERE id = :id`, { id: inv.id });
      expect(row[0].currency).toBe('USD');
      expect(parseFloat(row[0].exchange_rate)).toBe(5700);
      expect(parseFloat(row[0].amount_in_base_currency)).toBe(28500000);
    });

    test('invoice calculates base currency amount correctly', async () => {
      const amt = 100;
      const rate = 5700;
      const inv = await createTestInvoice({
        currency_code: 'USD',
        exchange_rate: rate,
        amount: amt,
        amount_in_base_currency: amt * rate,
      });
      const row = await query(`SELECT amount, exchange_rate, amount_in_base_currency FROM invoices WHERE id = :id`, { id: inv.id });
      const calcBase = parseFloat(row[0].amount) * parseFloat(row[0].exchange_rate);
      expect(parseFloat(row[0].amount_in_base_currency)).toBe(calcBase);
    });

    test('invoice dates are valid', async () => {
      const inv = await createTestInvoice();
      const row = await query(`SELECT created_at, due_date FROM invoices WHERE id = :id`, { id: inv.id });
      const createdDate = new Date(row[0].created_at);
      const dueDate = new Date(row[0].due_date);
      expect(dueDate.getTime()).toBeGreaterThanOrEqual(createdDate.getTime() - 86400000);
    });
  });

  // ─── Invoice Querying ────────────────────────────────────
  describe('Invoice Querying', () => {
    test('can filter unpaid invoices', async () => {
      await createTestInvoice({ status: 'unpaid', balance_due: 5000 });
      await createTestInvoice({ status: 'paid', balance_due: 0 });
      const unpaid = await query(
        `SELECT COUNT(*) as cnt FROM invoices WHERE status = 'unpaid' AND id LIKE 't-%'`
      );
      expect(parseInt(unpaid[0].cnt)).toBeGreaterThanOrEqual(1);
    });

    test('can filter invoices by scheme', async () => {
      await createTestInvoice({ scheme_name: 'TestSchemeA' });
      await createTestInvoice({ scheme_name: 'TestSchemeB' });
      const rows = await query(
        `SELECT * FROM invoices WHERE scheme_name = 'TestSchemeA' AND id LIKE 't-%'`
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].scheme_name).toBe('TestSchemeA');
    });

    test('can filter invoices by date range', async () => {
      const today = new Date().toISOString().split('T')[0];
      await createTestInvoice({ due_date: today });
      const rows = await query(
        `SELECT * FROM invoices WHERE due_date = :d AND id LIKE 't-%'`,
        { d: today }
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    test('can sum invoice balances by currency', async () => {
      const inv1 = await createTestInvoice({ currency_code: 'USD', balance_due: 100 });
      const inv2 = await createTestInvoice({ currency_code: 'USD', balance_due: 200 });
      const total = await scalar(
        `SELECT SUM(balance_due) FROM invoices WHERE currency = 'USD' AND id IN (:id1, :id2)`,
        { id1: inv1.id, id2: inv2.id }
      );
      expect(parseFloat(total)).toBe(300);
    });
  });
});
