/**
 * C5: the void-item GL reversal in patientBills.js (POST /:billId/void-item)
 * called AccountingService.createGLEntry with no transaction_currency, so a
 * USD bill's voided item was reversed as if it were that many SSP. The fix
 * looks up the ORIGINAL bill-creation entry (AccountingService.
 * createGLFromPatientBill posts with reference_id: billId,
 * reference_module: 'patient_billing') and reuses its currency and rate —
 * this test proves that lookup+reuse mechanism directly, using the same
 * GeneralLedger model and createGLEntry call the route itself makes.
 *
 * Runs against tenant_test, never a real tenant — see
 * billCreationAtomicity.test.js's own header comment for the
 * getTenantConnection-vs-testDb.js rationale.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const BILL_RATE = 4500;

let sequelize;
let testConn;
let AccountingService;
let PatientBill;
let GeneralLedger;
let billedRateId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  PatientBill = testConn.models.PatientBill;
  GeneralLedger = testConn.models.GeneralLedger;
  AccountingService = require('../../src/server/services/AccountingService');

  billedRateId = uuid();
  await sequelize.query(
    `INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active)
     VALUES (:id, :c, 'USD', 'SSP', :rate, '2025-01-01', true)`,
    { replacements: { id: billedRateId, c: TEST_CLINIC_ID, rate: BILL_RATE } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'VOIDCURR-%'`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%VOIDCURR-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%VOIDCURR-%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%VOIDCURR-%'`);
    await sequelize.query(`DELETE FROM exchange_rates WHERE id = :id`, { replacements: { id: billedRateId } });
  } catch (e) { console.warn('voidItemCurrency cleanup failed (non-fatal):', e.message); }
});

describe('C5: void-item reversal reuses the original bill\'s currency and rate', () => {
  test('a USD bill\'s original GL entry is found by reference_id/reference_module and its rate reused for the reversal', async () => {
    const billNumber = `VOIDCURR-${Date.now()}`;
    const usdItemPrice = 80;

    const { billId, originalGL } = await withTenant(async () => {
      const txn = await sequelize.transaction();
      const bill = await PatientBill.create({
        clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'VOIDCURR Test Patient',
        bill_number: billNumber, total_amount: usdItemPrice, paid_amount: 0, balance_amount: usdItemPrice,
        status: 'pending', bill_date: '2025-06-01', created_by: 'test-system', bill_currency: 'USD',
        services: [{ serviceName: 'VOIDCURR Test Service', totalPrice: usdItemPrice }],
      }, { transaction: txn });
      await AccountingService.createGLFromPatientBill(bill.toJSON(), 'test-system', txn);
      await txn.commit();

      // Exactly the lookup the void-item route now makes.
      const gl = await GeneralLedger.findOne({
        where: { clinic_id: TEST_CLINIC_ID, reference_id: bill.id, reference_module: 'patient_billing' },
        order: [['created_at', 'ASC']],
      });
      return { billId: bill.id, originalGL: gl };
    });

    expect(originalGL).not.toBeNull();
    expect(originalGL.transaction_currency).toBe('USD');
    expect(parseFloat(originalGL.exchange_rate)).toBe(BILL_RATE);

    // Now replicate the void-item block's reversal call, exactly as
    // patientBills.js does after the fix: transaction_currency + exchange_rate
    // sourced from originalGL, not omitted (which would default to base/1:1).
    const [[receivable]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1200'`, { replacements: { c: TEST_CLINIC_ID } });
    const [[revenue]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '4100'`, { replacements: { c: TEST_CLINIC_ID } });

    const reversalGL = await withTenant(() => AccountingService.createGLEntry(
      {
        clinic_id: TEST_CLINIC_ID, transaction_date: '2025-06-02', transaction_type: 'bill_item_void',
        description: `VOIDCURR-reversal on ${billNumber}`, reference_id: billId, reference_module: 'bill_item_void',
        transaction_currency: originalGL.transaction_currency, exchange_rate: parseFloat(originalGL.exchange_rate),
      },
      [
        { account_id: revenue.id, debit_amount: usdItemPrice, credit_amount: 0, description: 'VOIDCURR reversal debit' },
        { account_id: receivable.id, debit_amount: 0, credit_amount: usdItemPrice, description: 'VOIDCURR reversal credit' },
      ],
      'test-system'
    ));

    // The reversal must match the ORIGINAL entry's base amount exactly — not
    // a bare 80 (the old 1:1-default bug), and not some other rate.
    expect(reversalGL.transaction_currency).toBe('USD');
    expect(parseFloat(reversalGL.exchange_rate)).toBe(BILL_RATE);
    expect(parseFloat(reversalGL.base_total_debit)).toBe(usdItemPrice * BILL_RATE);
    expect(parseFloat(reversalGL.base_total_debit)).toBe(parseFloat(originalGL.base_total_debit));
  });
});
