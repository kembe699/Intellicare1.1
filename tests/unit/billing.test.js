const { query, scalar, tableExists, columnExists, closeConnection } = require('../setup/testDb');
const { cleanupTestData, ensureBaseCurrencies, createTestBill, testId, TEST_CLINIC_ID } = require('../setup/testData');

afterAll(async () => {
  await cleanupTestData();
  await closeConnection();
});

describe('Billing Module – Unit Tests', () => {
  // ─── Table Structure ─────────────────────────────────────
  describe('Table Structure', () => {
    test('patient_bills table exists', async () => {
      expect(await tableExists('patient_bills')).toBe(true);
    });

    test('patient_bills has required columns', async () => {
      const cols = ['id', 'clinic_id', 'patient_id', 'bill_number', 'total_amount', 'paid_amount', 'balance_amount', 'status'];
      for (const col of cols) {
        expect(await columnExists('patient_bills', col)).toBe(true);
      }
    });

    test('patient_bills has invoice-related columns', async () => {
      // These may have been added by invoice migration
      const hasBillingType = await columnExists('patient_bills', 'billing_type');
      const hasInvoiceId = await columnExists('patient_bills', 'invoice_id');
      // At minimum one should exist from invoice migration
      expect(hasBillingType || hasInvoiceId).toBe(true);
    });
  });

  // ─── Bill Creation ────────────────────────────────────────
  describe('Bill Creation', () => {
    test('can create a bill with required fields', async () => {
      const bill = await createTestBill();
      const row = await query(`SELECT * FROM patient_bills WHERE id = :id`, { id: bill.id });
      expect(row.length).toBe(1);
      expect(parseFloat(row[0].total_amount)).toBe(5000);
      expect(row[0].status).toBe('pending');
    });

    test('bill balance equals total minus paid', async () => {
      const bill = await createTestBill({ total_amount: 10000, paid_amount: 3000, balance_amount: 7000 });
      const row = await query(`SELECT * FROM patient_bills WHERE id = :id`, { id: bill.id });
      expect(parseFloat(row[0].balance_amount)).toBe(
        parseFloat(row[0].total_amount) - parseFloat(row[0].paid_amount)
      );
    });

    test('bill with zero amount is valid', async () => {
      const bill = await createTestBill({ total_amount: 0, paid_amount: 0, balance_amount: 0, status: 'paid' });
      const row = await query(`SELECT * FROM patient_bills WHERE id = :id`, { id: bill.id });
      expect(row.length).toBe(1);
      expect(parseFloat(row[0].total_amount)).toBe(0);
    });

    test('bill statuses are correctly stored', async () => {
      for (const status of ['pending', 'partial', 'paid']) {
        const bill = await createTestBill({ status });
        const row = await query(`SELECT status FROM patient_bills WHERE id = :id`, { id: bill.id });
        expect(row[0].status).toBe(status);
      }
    });
  });

  // ─── Bill Querying ────────────────────────────────────────
  describe('Bill Querying', () => {
    test('can filter bills by status', async () => {
      await createTestBill({ status: 'pending' });
      await createTestBill({ status: 'paid' });
      const pending = await query(
        `SELECT COUNT(*) as cnt FROM patient_bills WHERE status = 'pending' AND id LIKE 't-%'`
      );
      expect(parseInt(pending[0].cnt)).toBeGreaterThanOrEqual(1);
    });

    test('can filter bills by clinic_id', async () => {
      const bill = await createTestBill({ clinic_id: TEST_CLINIC_ID });
      const rows = await query(
        `SELECT * FROM patient_bills WHERE clinic_id = :cid AND id = :id`,
        { cid: TEST_CLINIC_ID, id: bill.id }
      );
      expect(rows.length).toBe(1);
    });

    test('can calculate total outstanding balance', async () => {
      const b1 = await createTestBill({ balance_amount: 1000 });
      const b2 = await createTestBill({ balance_amount: 2000 });
      const total = await scalar(
        `SELECT SUM(balance_amount) FROM patient_bills WHERE id IN (:id1, :id2)`,
        { id1: b1.id, id2: b2.id }
      );
      expect(parseFloat(total)).toBe(3000);
    });
  });
});
