const { query, scalar, closeConnection } = require('../setup/testDb');
const {
  cleanupTestData, ensureBaseCurrencies, createTestBill, createTestInvoice,
  createTestClaim, createTestGLEntry, createTestGLLineItem, createTestExchangeRate,
  createTestExchangeAdjustment, createTestConversionLog, testId, TEST_CLINIC_ID
} = require('../setup/testData');

beforeAll(async () => {
  await ensureBaseCurrencies();
});

afterAll(async () => {
  await cleanupTestData();
  await closeConnection();
});

describe('E2E Workflow 1: Bill → Invoice → Claim → Payment', () => {
  let billId, invoiceId, claimId, patientId;

  test('Step 1: Create a patient bill', async () => {
    patientId = testId();
    const bill = await createTestBill({
      patient_id: patientId,
      total_amount: 15000,
      paid_amount: 0,
      balance_amount: 15000,
      status: 'pending',
    });
    billId = bill.id;

    const row = await query(`SELECT * FROM patient_bills WHERE id = :id`, { id: billId });
    expect(row.length).toBe(1);
    expect(parseFloat(row[0].total_amount)).toBe(15000);
    expect(row[0].status).toBe('pending');
  });

  test('Step 2: Create invoice from bill with scheme info', async () => {
    const invoice = await createTestInvoice({
      patient_id: patientId,
      bill_id: billId,
      scheme_id: 'scheme-nhif',
      scheme_name: 'NHIF',
      amount: 15000,
      amount_paid: 0,
      balance_due: 15000,
      status: 'unpaid',
      currency_code: 'SSP',
      exchange_rate: 1,
      amount_in_base_currency: 15000,
    });
    invoiceId = invoice.id;

    const row = await query(`SELECT * FROM invoices WHERE id = :id`, { id: invoiceId });
    expect(row.length).toBe(1);
    expect(row[0].bill_id).toBe(billId);
    expect(row[0].scheme_name).toBe('NHIF');
    expect(row[0].currency).toBe('SSP');
  });

  test('Step 3: Verify invoice is linked to bill', async () => {
    const inv = await query(`SELECT bill_id, scheme_id, scheme_name FROM invoices WHERE id = :id`, { id: invoiceId });
    expect(inv[0].bill_id).toBe(billId);
    expect(inv[0].scheme_id).toBe('scheme-nhif');
    expect(inv[0].scheme_name).toBe('NHIF');
  });

  test('Step 4: Create insurance claim and link invoice', async () => {
    const claim = await createTestClaim({
      scheme_id: 'scheme-nhif',
      scheme_name: 'NHIF',
      claim_amount: 15000,
      status: 'draft',
    });
    claimId = claim.id;

    // Link invoice to claim
    await query(
      `INSERT INTO insurance_batch_claim_items (id, claim_id, invoice_id, amount)
       VALUES (:id, :claimId, :invId, :amount)`,
      { id: testId(), claimId, invId: invoiceId, amount: 15000 }
    );

    const items = await query(
      `SELECT * FROM insurance_batch_claim_items WHERE claim_id = :claimId`,
      { claimId }
    );
    expect(items.length).toBe(1);
    expect(items[0].invoice_id).toBe(invoiceId);
  });

  test('Step 5: Submit claim', async () => {
    await query(`UPDATE insurance_batch_claims SET status = 'submitted' WHERE id = :id`, { id: claimId });
    const histId = testId();
    await query(
      `INSERT INTO insurance_batch_claim_status_history (id, claim_id, old_status, new_status, created_by, notes)
       VALUES (:id, :claimId, 'draft', 'submitted', 'test-user', 'Submitted to NHIF')`,
      { id: histId, claimId }
    );

    const row = await query(`SELECT status FROM insurance_batch_claims WHERE id = :id`, { id: claimId });
    expect(row[0].status).toBe('submitted');
  });

  test('Step 6: Record payment – update invoice and bill', async () => {
    // Mark invoice as paid
    await query(
      `UPDATE invoices SET amount_paid = amount, balance_due = 0, status = 'paid' WHERE id = :id`,
      { id: invoiceId }
    );
    // Mark bill as paid
    await query(
      `UPDATE patient_bills SET paid_amount = total_amount, balance_amount = 0, status = 'paid' WHERE id = :id`,
      { id: billId }
    );

    const inv = await query(`SELECT status, balance_due FROM invoices WHERE id = :id`, { id: invoiceId });
    expect(inv[0].status).toBe('paid');
    expect(parseFloat(inv[0].balance_due)).toBe(0);

    const bill = await query(`SELECT status, balance_amount FROM patient_bills WHERE id = :id`, { id: billId });
    expect(bill[0].status).toBe('paid');
    expect(parseFloat(bill[0].balance_amount)).toBe(0);
  });

  test('Step 7: Verify complete data chain integrity', async () => {
    // Bill → Invoice → Claim Item → Claim
    const inv = await query(`SELECT bill_id, scheme_name FROM invoices WHERE id = :id`, { id: invoiceId });
    expect(inv[0].bill_id).toBe(billId);

    const claimItem = await query(
      `SELECT claim_id FROM insurance_batch_claim_items WHERE invoice_id = :invId AND id LIKE 't-%'`,
      { invId: invoiceId }
    );
    expect(claimItem.length).toBe(1);
    expect(claimItem[0].claim_id).toBe(claimId);

    const claim = await query(`SELECT scheme_name FROM insurance_batch_claims WHERE id = :id`, { id: claimId });
    expect(claim[0].scheme_name).toBe(inv[0].scheme_name);
  });
});

describe('E2E Workflow 2: Multi-Currency Procurement', () => {
  let glEntryId, rateId;

  test('Step 1: Set exchange rate for USD/SSP', async () => {
    const rate = await createTestExchangeRate({
      from_currency: 'USD', to_currency: 'SSP', rate: 5700,
      buy_rate: 5680, sell_rate: 5720,
    });
    rateId = rate.id;

    const row = await query(`SELECT rate FROM exchange_rates WHERE id = :id`, { id: rateId });
    expect(parseFloat(row[0].rate)).toBe(5700);
  });

  test('Step 2: Create PO in USD – post GL in base currency', async () => {
    const amountUSD = 500;
    const rate = 5700;
    const baseAmount = amountUSD * rate; // 2,850,000 SSP

    const gl = await createTestGLEntry({
      transaction_currency: 'USD', exchange_rate: rate,
      total_debit: baseAmount, total_credit: baseAmount,
      base_total_debit: baseAmount, base_total_credit: baseAmount,
      description: 'PO-001 – Procurement in USD',
      reference_module: 'purchase_order',
    });
    glEntryId = gl.id;

    // Debit Inventory (asset)
    await createTestGLLineItem(gl.id, {
      debit_amount: baseAmount, credit_amount: 0,
      currency_code: 'USD', amount_in_currency: amountUSD, exchange_rate: rate,
    });

    // Credit Accounts Payable – USD
    await createTestGLLineItem(gl.id, {
      debit_amount: 0, credit_amount: baseAmount,
      currency_code: 'USD', amount_in_currency: amountUSD, exchange_rate: rate,
    });

    // Verify balanced
    const debitSum = await scalar(
      `SELECT SUM(debit_amount) FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
      { glId: gl.id }
    );
    const creditSum = await scalar(
      `SELECT SUM(credit_amount) FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
      { glId: gl.id }
    );
    expect(parseFloat(debitSum)).toBe(parseFloat(creditSum));
    expect(parseFloat(debitSum)).toBe(baseAmount);
  });

  test('Step 3: Payment at different rate – calculate exchange loss', async () => {
    const origRate = 5700;
    const payRate = 5800;
    const amountUSD = 500;
    const origBase = amountUSD * origRate;
    const payBase = amountUSD * payRate;
    const exchangeLoss = payBase - origBase;

    await createTestConversionLog({
      from_currency: 'USD', to_currency: 'SSP',
      amount_source: amountUSD, rate_used: payRate, amount_converted: payBase,
      conversion_method: 'manual', source_transaction_type: 'payment',
    });

    const adj = await createTestExchangeAdjustment({
      from_currency: 'USD', to_currency: 'SSP',
      original_amount: amountUSD, original_rate: origRate, original_base_amount: origBase,
      settlement_rate: payRate, settlement_base_amount: payBase,
      realized_gain_loss: -exchangeLoss,
      adjustment_type: 'receivable', adjustment_status: 'realized',
      reference_type: 'payment', notes: 'Exchange loss on PO payment',
    });

    const row = await query(`SELECT realized_gain_loss FROM exchange_adjustments WHERE id = :id`, { id: adj.id });
    expect(parseFloat(row[0].realized_gain_loss)).toBe(-50000);
  });

  test('Step 4: Post exchange loss to GL', async () => {
    const exchangeLoss = 50000;

    const gl = await createTestGLEntry({
      transaction_currency: 'SSP', exchange_rate: 1,
      total_debit: exchangeLoss, total_credit: exchangeLoss,
      description: 'Exchange loss on PO payment',
      reference_module: 'exchange_adjustment',
    });

    await createTestGLLineItem(gl.id, {
      debit_amount: exchangeLoss, credit_amount: 0,
      currency_code: 'SSP', amount_in_currency: exchangeLoss, exchange_rate: 1,
      exchange_gain_loss: -exchangeLoss,
    });

    await createTestGLLineItem(gl.id, {
      debit_amount: 0, credit_amount: exchangeLoss,
      currency_code: 'SSP', amount_in_currency: exchangeLoss, exchange_rate: 1,
    });

    const debitSum = await scalar(
      `SELECT SUM(debit_amount) FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
      { glId: gl.id }
    );
    const creditSum = await scalar(
      `SELECT SUM(credit_amount) FROM gl_line_items WHERE gl_id = :glId AND id LIKE 't-%'`,
      { glId: gl.id }
    );
    expect(parseFloat(debitSum)).toBe(parseFloat(creditSum));
    expect(parseFloat(debitSum)).toBe(exchangeLoss);
  });

  test('Step 5: Verify full audit trail', async () => {
    const convLogs = await query(
      `SELECT * FROM currency_conversion_log WHERE source_transaction_type = 'payment' AND id LIKE 't-%'`
    );
    expect(convLogs.length).toBeGreaterThanOrEqual(1);

    const adjs = await query(
      `SELECT * FROM exchange_adjustments WHERE reference_type = 'payment' AND id LIKE 't-%'`
    );
    expect(adjs.length).toBeGreaterThanOrEqual(1);
    expect(parseFloat(adjs[0].realized_gain_loss)).toBeLessThan(0);
  });
});
