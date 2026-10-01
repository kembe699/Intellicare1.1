/**
 * C3: a USD (or other foreign-currency) bill's receivable is booked at
 * whatever exchange rate applies on the bill date (AccountingService.
 * createGLFromPatientBill). The payment that later clears it is collected at
 * TODAY's rate, which is almost never the same rate. Before this fix,
 * patientBills.js's payment posting re-converted the payment amount at
 * today's rate and credited the receivable for that number — the receivable
 * for that bill would then never net to exactly zero, with the drift
 * silently absorbed into 1200/1210 forever.
 *
 * The fix (POST /:billId/payments in patientBills.js) now clears the
 * receivable for exactly its ORIGINAL booked base-currency share, converts
 * the actual cash received at today's rate, and posts the realized
 * difference to account 5610 (Foreign Exchange Gain/Loss) — a gain is
 * credited (reduces the expense account), a loss is debited. This test
 * replicates that exact computation and AccountingService.createGLEntry
 * call the route makes (mirrors voidItemCurrency.test.js's approach for C5,
 * since this logic lives inline in the route rather than an exported
 * function), proving debits equal credits and that both a gain and a loss
 * post to the right side of 5610 with a base-currency amount that clears
 * the receivable exactly (SSP base + USD transaction).
 *
 * Runs against tenant_test, never a real tenant.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const BOOKED_RATE = 4500;

let sequelize;
let testConn;
let AccountingService;
let PatientBill;
let ChartOfAccounts;
let cashAccountId;
let receivableAccountId;
let fxAccountId;
let insertedFxAccount = false;
let bookedRateId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  PatientBill = testConn.models.PatientBill;
  ChartOfAccounts = testConn.models.ChartOfAccounts;
  AccountingService = require('../../src/server/services/AccountingService');

  const [[cash]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1100'`, { replacements: { c: TEST_CLINIC_ID } });
  const [[receivable]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '1200'`, { replacements: { c: TEST_CLINIC_ID } });
  cashAccountId = cash.id;
  receivableAccountId = receivable.id;

  const [[existingFx]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '5610'`, { replacements: { c: TEST_CLINIC_ID } });
  if (existingFx) {
    fxAccountId = existingFx.id;
  } else {
    insertedFxAccount = true;
    const [[created]] = await sequelize.query(
      `INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, sub_account_type, balance_type, opening_balance, is_active, description, created_at, updated_at)
       VALUES (gen_random_uuid()::text, :c, '5610', 'Foreign Exchange Gain/Loss', 'expense', NULL, 'debit', 0, TRUE, 'test-seeded', NOW(), NOW()) RETURNING id`,
      { replacements: { c: TEST_CLINIC_ID } }
    );
    fxAccountId = created.id;
  }

  bookedRateId = uuid();
  await sequelize.query(
    `INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active)
     VALUES (:id, :c, 'USD', 'SSP', :rate, '2025-01-01', true)`,
    { replacements: { id: bookedRateId, c: TEST_CLINIC_ID, rate: BOOKED_RATE } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'FXPAY-%'`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%FXPAY-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%FXPAY-%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%FXPAY-%'`);
    await sequelize.query(`DELETE FROM exchange_rates WHERE id = :id`, { replacements: { id: bookedRateId } });
    if (insertedFxAccount) await sequelize.query(`DELETE FROM chart_of_accounts WHERE id = :id`, { replacements: { id: fxAccountId } });
  } catch (e) { console.warn('paymentFxGainLossCurrency cleanup failed (non-fatal):', e.message); }
});

async function createUsdBill(billNumber, usdAmount) {
  return withTenant(async () => {
    const txn = await sequelize.transaction();
    const bill = await PatientBill.create({
      clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'FXPAY Test Patient',
      bill_number: billNumber, total_amount: usdAmount, paid_amount: 0, balance_amount: usdAmount,
      status: 'pending', bill_date: '2025-06-01', created_by: 'test-system', bill_currency: 'USD',
      services: [{ serviceName: 'FXPAY Test Service', totalPrice: usdAmount }],
    }, { transaction: txn });
    await AccountingService.createGLFromPatientBill(bill.toJSON(), 'test-system', txn);
    await txn.commit();
    return bill;
  });
}

// Exactly the computation + createGLEntry call patientBills.js's
// POST /:billId/payments now makes for a foreign-currency bill.
async function postFxAwarePayment({ billId, totalBillAmount, payAmt, todaysRate }) {
  return withTenant(async () => {
    const { GeneralLedger } = testConn.models;
    const originalBillGL = await GeneralLedger.findOne({
      where: { clinic_id: TEST_CLINIC_ID, reference_id: billId, reference_module: 'patient_billing' },
      order: [['created_at', 'ASC']],
    });

    const bookedRate = parseFloat(originalBillGL.exchange_rate);
    const bookedBase = parseFloat(originalBillGL.base_total_debit);
    const bookedShare = Math.round(bookedBase * (payAmt / totalBillAmount) * 100) / 100;

    const paymentBaseAmount = AccountingService.convertAmount(payAmt, todaysRate);
    const fxDelta = Math.round((paymentBaseAmount - bookedShare) * 100) / 100;

    const lineItems = [
      { account_id: cashAccountId, debit_amount: paymentBaseAmount, credit_amount: 0, description: `Payment received (cash) — USD ${payAmt} @ ${todaysRate}` },
      { account_id: receivableAccountId, debit_amount: 0, credit_amount: bookedShare, description: `Receivable cleared - bill ${billId} (booked @ ${bookedRate})` },
    ];
    if (Math.abs(fxDelta) > 0.01) {
      lineItems.push(fxDelta > 0
        ? { account_id: fxAccountId, debit_amount: 0, credit_amount: fxDelta, description: `FX gain — bill ${billId} payment` }
        : { account_id: fxAccountId, debit_amount: -fxDelta, credit_amount: 0, description: `FX loss — bill ${billId} payment` });
    }

    const gl = await AccountingService.createGLEntry({
      clinic_id: TEST_CLINIC_ID,
      transaction_date: '2025-07-01',
      transaction_type: 'patient_bill_payment',
      description: `Payment: Bill ${billId} (cash) FXPAY-test`,
      reference_id: String(billId),
      reference_module: 'patient_bill_payment',
    }, lineItems, 'test-system');

    return { gl, bookedShare, paymentBaseAmount, fxDelta };
  });
}

describe('C3: realized FX gain/loss on patient bill payments', () => {
  test('currency appreciates since booking → a gain is CREDITED to 5610, receivable still clears to its booked share exactly', async () => {
    const billNumber = `FXPAY-GAIN-${Date.now()}`;
    const usdAmount = 100;
    const bill = await createUsdBill(billNumber, usdAmount);

    const todaysRate = 4700; // stronger than the 4500 booking rate
    const { gl, bookedShare, paymentBaseAmount, fxDelta } = await postFxAwarePayment({
      billId: bill.id, totalBillAmount: usdAmount, payAmt: usdAmount, todaysRate,
    });

    expect(bookedShare).toBe(usdAmount * BOOKED_RATE); // 450000 — the ORIGINAL booked base amount, not re-derived from today's rate
    expect(paymentBaseAmount).toBe(usdAmount * todaysRate); // 470000 — actual cash received today
    expect(fxDelta).toBe(paymentBaseAmount - bookedShare); // 20000 gain
    expect(fxDelta).toBeGreaterThan(0);

    // Debits equal credits (base currency).
    expect(parseFloat(gl.base_total_debit)).toBe(parseFloat(gl.base_total_credit));
    expect(parseFloat(gl.base_total_debit)).toBe(paymentBaseAmount);

    const [lines] = await sequelize.query(
      `SELECT account_id, base_debit_amount, base_credit_amount FROM gl_line_items WHERE gl_id = :id`,
      { replacements: { id: gl.id } }
    );
    const cashLine = lines.find((l) => l.account_id === cashAccountId);
    const receivableLine = lines.find((l) => l.account_id === receivableAccountId);
    const fxLine = lines.find((l) => l.account_id === fxAccountId);

    expect(parseFloat(cashLine.base_debit_amount)).toBe(paymentBaseAmount);
    // The receivable clears for exactly the amount originally booked — not a
    // fresh conversion at today's rate (the pre-fix bug).
    expect(parseFloat(receivableLine.base_credit_amount)).toBe(bookedShare);
    expect(fxLine).toBeDefined();
    expect(parseFloat(fxLine.base_credit_amount)).toBe(fxDelta);
    expect(parseFloat(fxLine.base_debit_amount)).toBe(0);
  });

  test('currency depreciates since booking → a loss is DEBITED to 5610, and the entry still balances', async () => {
    const billNumber = `FXPAY-LOSS-${Date.now()}`;
    const usdAmount = 200;
    const bill = await createUsdBill(billNumber, usdAmount);

    const todaysRate = 4300; // weaker than the 4500 booking rate
    const { gl, bookedShare, paymentBaseAmount, fxDelta } = await postFxAwarePayment({
      billId: bill.id, totalBillAmount: usdAmount, payAmt: usdAmount, todaysRate,
    });

    expect(bookedShare).toBe(usdAmount * BOOKED_RATE); // 900000
    expect(paymentBaseAmount).toBe(usdAmount * todaysRate); // 860000
    expect(fxDelta).toBeLessThan(0); // 40000 loss

    expect(parseFloat(gl.base_total_debit)).toBe(parseFloat(gl.base_total_credit));
    expect(parseFloat(gl.base_total_credit)).toBe(bookedShare);

    const [lines] = await sequelize.query(
      `SELECT account_id, base_debit_amount, base_credit_amount FROM gl_line_items WHERE gl_id = :id`,
      { replacements: { id: gl.id } }
    );
    const fxLine = lines.find((l) => l.account_id === fxAccountId);
    expect(fxLine).toBeDefined();
    expect(parseFloat(fxLine.base_debit_amount)).toBe(Math.abs(fxDelta));
    expect(parseFloat(fxLine.base_credit_amount)).toBe(0);
  });

  test('an unchanged rate posts no FX line at all and the receivable still clears exactly', async () => {
    const billNumber = `FXPAY-FLAT-${Date.now()}`;
    const usdAmount = 80;
    const bill = await createUsdBill(billNumber, usdAmount);

    const { gl, bookedShare, paymentBaseAmount, fxDelta } = await postFxAwarePayment({
      billId: bill.id, totalBillAmount: usdAmount, payAmt: usdAmount, todaysRate: BOOKED_RATE,
    });

    expect(fxDelta).toBe(0);
    expect(bookedShare).toBe(paymentBaseAmount);

    const [lines] = await sequelize.query(`SELECT account_id FROM gl_line_items WHERE gl_id = :id`, { replacements: { id: gl.id } });
    expect(lines).toHaveLength(2); // no FX line at all
  });
});
