const { query, scalar, tableExists, columnExists, closeConnection } = require('../setup/testDb');
const {
  cleanupTestData, ensureBaseCurrencies, createTestInvoice, createTestClaim,
  testId, TEST_CLINIC_ID
} = require('../setup/testData');

beforeAll(async () => {
  await ensureBaseCurrencies();
});

afterAll(async () => {
  await cleanupTestData();
  await closeConnection();
});

describe('Insurance Claims Integration Tests', () => {
  // ─── Table Structure ─────────────────────────────────────
  describe('Table Structure', () => {
    test('insurance_batch_claims table exists', async () => {
      expect(await tableExists('insurance_batch_claims')).toBe(true);
    });

    test('insurance_batch_claim_items table exists', async () => {
      expect(await tableExists('insurance_batch_claim_items')).toBe(true);
    });

    test('insurance_batch_claim_status_history table exists', async () => {
      expect(await tableExists('insurance_batch_claim_status_history')).toBe(true);
    });

    test('claims table has required columns', async () => {
      for (const col of ['id', 'clinic_id', 'claim_number', 'scheme_id', 'scheme_name', 'claim_amount', 'status']) {
        expect(await columnExists('insurance_batch_claims', col)).toBe(true);
      }
    });
  });

  // ─── Claim Creation ──────────────────────────────────────
  describe('Claim Creation', () => {
    test('can create a claim with scheme info', async () => {
      const claim = await createTestClaim({ scheme_name: 'NHIF', claim_amount: 50000 });
      const row = await query(`SELECT * FROM insurance_batch_claims WHERE id = :id`, { id: claim.id });
      expect(row.length).toBe(1);
      expect(row[0].scheme_name).toBe('NHIF');
      expect(parseFloat(row[0].claim_amount)).toBe(50000);
    });

    test('claim starts in draft status', async () => {
      const claim = await createTestClaim();
      const row = await query(`SELECT status FROM insurance_batch_claims WHERE id = :id`, { id: claim.id });
      expect(row[0].status).toBe('draft');
    });

    test('claim has unique claim number', async () => {
      const c1 = await createTestClaim();
      const c2 = await createTestClaim();
      expect(c1.claim_number).not.toBe(c2.claim_number);
    });
  });

  // ─── Invoice-Claim Linkage ───────────────────────────────
  describe('Invoice-Claim Linkage', () => {
    test('can link invoices to a claim via claim_items', async () => {
      const claim = await createTestClaim();
      const inv = await createTestInvoice({ status: 'unpaid', balance_due: 5000 });
      const itemId = testId();

      await query(
        `INSERT INTO insurance_batch_claim_items (id, claim_id, invoice_id, amount)
         VALUES (:id, :claimId, :invId, :amount)`,
        { id: itemId, claimId: claim.id, invId: inv.id, amount: 5000 }
      );

      const items = await query(
        `SELECT * FROM insurance_batch_claim_items WHERE claim_id = :claimId`,
        { claimId: claim.id }
      );
      expect(items.length).toBe(1);
      expect(items[0].invoice_id).toBe(inv.id);
    });

    test('can link multiple invoices to one claim', async () => {
      const claim = await createTestClaim({ claim_amount: 15000 });
      const inv1 = await createTestInvoice({ balance_due: 5000 });
      const inv2 = await createTestInvoice({ balance_due: 10000 });

      for (const inv of [inv1, inv2]) {
        await query(
          `INSERT INTO insurance_batch_claim_items (id, claim_id, invoice_id, amount)
           VALUES (:id, :claimId, :invId, :amount)`,
          { id: testId(), claimId: claim.id, invId: inv.id, amount: inv.balance_due }
        );
      }

      const items = await query(
        `SELECT * FROM insurance_batch_claim_items WHERE claim_id = :claimId`,
        { claimId: claim.id }
      );
      expect(items.length).toBe(2);
      const totalLinked = items.reduce((s, i) => s + parseFloat(i.amount), 0);
      expect(totalLinked).toBe(15000);
    });

    test('claim total matches sum of linked invoice amounts', async () => {
      const claim = await createTestClaim({ claim_amount: 8000 });
      const inv1 = await createTestInvoice({ balance_due: 3000 });
      const inv2 = await createTestInvoice({ balance_due: 5000 });

      for (const inv of [inv1, inv2]) {
        await query(
          `INSERT INTO insurance_batch_claim_items (id, claim_id, invoice_id, amount)
           VALUES (:id, :claimId, :invId, :amount)`,
          { id: testId(), claimId: claim.id, invId: inv.id, amount: inv.balance_due }
        );
      }

      const sum = await scalar(
        `SELECT SUM(amount) FROM insurance_batch_claim_items WHERE claim_id = :claimId`,
        { claimId: claim.id }
      );
      expect(parseFloat(sum)).toBe(parseFloat(claim.claim_amount));
    });
  });

  // ─── Invoice Filtering for Claims ────────────────────────
  describe('Invoice Filtering for Claims', () => {
    test('filters unpaid invoices only', async () => {
      const unpaid = await createTestInvoice({ status: 'unpaid', balance_due: 5000 });
      const paid = await createTestInvoice({ status: 'paid', balance_due: 0 });

      const rows = await query(
        `SELECT * FROM invoices WHERE status = 'unpaid' AND balance_due > 0 AND id IN (:id1, :id2)`,
        { id1: unpaid.id, id2: paid.id }
      );
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(unpaid.id);
    });

    test('filters invoices by date range', async () => {
      const inv1 = await createTestInvoice({ due_date: '2025-01-15', status: 'unpaid' });
      const inv2 = await createTestInvoice({ due_date: '2025-06-15', status: 'unpaid' });

      const rows = await query(
        `SELECT * FROM invoices WHERE due_date BETWEEN '2025-01-01' AND '2025-03-31' AND id IN (:id1, :id2)`,
        { id1: inv1.id, id2: inv2.id }
      );
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(inv1.id);
    });

    test('filters invoices by scheme', async () => {
      const inv1 = await createTestInvoice({ scheme_name: 'NHIF', status: 'unpaid' });
      const inv2 = await createTestInvoice({ scheme_name: 'AAR', status: 'unpaid' });

      const rows = await query(
        `SELECT * FROM invoices WHERE scheme_name = 'NHIF' AND id IN (:id1, :id2)`,
        { id1: inv1.id, id2: inv2.id }
      );
      expect(rows.length).toBe(1);
      expect(rows[0].scheme_name).toBe('NHIF');
    });

    test('excludes already-claimed invoices', async () => {
      const claim = await createTestClaim();
      const inv1 = await createTestInvoice({ status: 'unpaid', balance_due: 5000 });
      const inv2 = await createTestInvoice({ status: 'unpaid', balance_due: 3000 });

      // Link inv1 to claim
      await query(
        `INSERT INTO insurance_batch_claim_items (id, claim_id, invoice_id, amount)
         VALUES (:id, :claimId, :invId, :amount)`,
        { id: testId(), claimId: claim.id, invId: inv1.id, amount: 5000 }
      );

      // Find invoices NOT already in any claim
      const available = await query(
        `SELECT i.* FROM invoices i
         WHERE i.status = 'unpaid' AND i.balance_due > 0
         AND i.id IN (:id1, :id2)
         AND i.id NOT IN (SELECT invoice_id FROM insurance_batch_claim_items WHERE invoice_id IS NOT NULL)`,
        { id1: inv1.id, id2: inv2.id }
      );
      expect(available.length).toBe(1);
      expect(available[0].id).toBe(inv2.id);
    });
  });

  // ─── Payment Tracking ────────────────────────────────────
  describe('Payment Tracking', () => {
    test('claim status can be updated to submitted', async () => {
      const claim = await createTestClaim({ status: 'draft' });
      await query(`UPDATE insurance_batch_claims SET status = 'submitted' WHERE id = :id`, { id: claim.id });
      const row = await query(`SELECT status FROM insurance_batch_claims WHERE id = :id`, { id: claim.id });
      expect(row[0].status).toBe('submitted');
    });

    test('claim status transitions are tracked in history', async () => {
      const claim = await createTestClaim();
      const histId = testId();
      await query(
        `INSERT INTO insurance_batch_claim_status_history (id, claim_id, old_status, new_status, created_by, notes)
         VALUES (:id, :claimId, 'draft', 'submitted', 'test-user', 'Submitted for review')`,
        { id: histId, claimId: claim.id }
      );
      const hist = await query(
        `SELECT * FROM insurance_batch_claim_status_history WHERE claim_id = :claimId`,
        { claimId: claim.id }
      );
      expect(hist.length).toBeGreaterThanOrEqual(1);
      expect(hist[0].old_status).toBe('draft');
      expect(hist[0].new_status).toBe('submitted');
    });
  });
});
