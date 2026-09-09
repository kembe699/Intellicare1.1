/**
 * The invariants that keep the financial reports truthful.
 *
 * Each of these has been violated in production at least once, and in every
 * case the symptom was the same: the reports looked plausible, disagreed with
 * the cashier, and nothing errored. They are asserted here so a regression
 * fails the build rather than the month-end.
 *
 *   1. Automatic entries are posted. Reports count posted rows only, so an
 *      unposted entry is money that exists but is invisible.
 *   2. Every GL entry balances, and so does the ledger as a whole.
 *   3. A posted entry's ledger rows are posted too — the entry header and the
 *      rows reports actually read must not disagree.
 *   4. A bill's posted revenue equals what the bill is worth. Voiding an item,
 *      editing a bill or a failed top-up each used to break this silently.
 *   5. Revenue lands on a service line, not all in the catch-all.
 */
const { query, scalar, tableExists, closeConnection } = require('../setup/testDb');

afterAll(async () => { await closeConnection(); });

// Modules the application posts by itself. A draft here is a bug; a draft on a
// manual journal entry is somebody mid-way through typing one.
const AUTOMATIC_MODULES = [
  'patient_billing', 'payment_receipt', 'bill_item_void', 'bill_revenue_adjustment',
  'pharmacy_return', 'daily_expense', 'supplier_bill_payment', 'procurement_grn',
  'bill_write_off', 'insurance_claims',
];

describe('Accounting invariants', () => {
  test('the ledger as a whole balances', async () => {
    if (!(await tableExists('account_ledger'))) return;
    const out = await scalar(
      'SELECT COALESCE(SUM(debit_amount) - SUM(credit_amount), 0) FROM account_ledger');
    expect(Math.abs(parseFloat(out) || 0)).toBeLessThan(0.01);
  });

  test('every GL entry balances', async () => {
    if (!(await tableExists('gl_line_items'))) return;
    const rows = await query(`
      SELECT gl.gl_number,
             SUM(li.debit_amount)  AS dr,
             SUM(li.credit_amount) AS cr
        FROM general_ledger gl
        JOIN gl_line_items li ON li.gl_id = gl.id
       GROUP BY gl.id, gl.gl_number
      HAVING ABS(SUM(li.debit_amount) - SUM(li.credit_amount)) > 0.01`);
    expect(rows.map((r) => `${r.gl_number}: ${r.dr} vs ${r.cr}`)).toEqual([]);
  });

  test('entries the application posts by itself are never left as drafts', async () => {
    if (!(await tableExists('general_ledger'))) return;
    const list = AUTOMATIC_MODULES.map((m) => `'${m}'`).join(', ');
    const rows = await query(
      `SELECT gl_number, reference_module, status
         FROM general_ledger
        WHERE reference_module IN (${list})
          AND (is_posted IS NOT TRUE OR status <> 'posted')`);
    expect(rows.map((r) => `${r.gl_number} (${r.reference_module}) is ${r.status}`)).toEqual([]);
  });

  test("a posted entry's ledger rows are posted too", async () => {
    if (!(await tableExists('account_ledger'))) return;
    const rows = await query(`
      SELECT gl.gl_number
        FROM account_ledger al
        JOIN general_ledger gl ON gl.id = al.transaction_id
       WHERE gl.is_posted IS TRUE AND al.is_posted IS NOT TRUE
       LIMIT 20`);
    expect(rows.map((r) => r.gl_number)).toEqual([]);
  });

  test("each bill's posted revenue equals what the bill is worth", async () => {
    if (!(await tableExists('patient_bills'))) return;
    const rows = await query(`
      WITH posted AS (
        SELECT gl.reference_id AS bill_id,
               SUM(al.credit_amount) - SUM(al.debit_amount) AS revenue
          FROM account_ledger al
          JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
          JOIN general_ledger gl ON gl.id = al.transaction_id
         WHERE gl.reference_module IN ('patient_billing','bill_item_void','bill_revenue_adjustment')
         GROUP BY 1)
      SELECT b.bill_number, p.revenue, COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount) AS worth
        FROM posted p JOIN patient_bills b ON b.id = p.bill_id
       WHERE ABS(p.revenue - COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount)) > 0.01
       LIMIT 20`);
    expect(rows.map((r) => `${r.bill_number}: posted ${r.revenue} vs bill ${r.worth}`)).toEqual([]);
  });

  test('a receipt that took money has a ledger entry behind it', async () => {
    if (!(await tableExists('receipts'))) return;
    const rows = await query(`
      SELECT r.receipt_number
        FROM receipts r
       WHERE COALESCE(r.is_voided, FALSE) = FALSE
         AND COALESCE(r.payment_amount, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM account_ledger al
            WHERE al.description LIKE '%' || r.receipt_number || '%')
       LIMIT 20`);
    expect(rows.map((r) => r.receipt_number)).toEqual([]);
  });
});

describe('Revenue is attributed to a service line', () => {
  test('the catch-all does not hold the majority of revenue', async () => {
    if (!(await tableExists('account_ledger'))) return;
    const rows = await query(`
      SELECT c.account_code,
             SUM(al.credit_amount) - SUM(al.debit_amount) AS net
        FROM account_ledger al
        JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
       GROUP BY 1`);
    const total = rows.reduce((s, r) => s + (parseFloat(r.net) || 0), 0);
    if (total <= 0) return;   // nothing billed in this database yet
    const catchAll = parseFloat(rows.find((r) => r.account_code === '4100')?.net || 0);
    // 4100 stays legitimate for anything genuinely unidentifiable, but it being
    // the bulk of revenue is what "everything lumped together" looked like.
    expect(catchAll / total).toBeLessThan(0.5);
  });
});
