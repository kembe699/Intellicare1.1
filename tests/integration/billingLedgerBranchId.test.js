/**
 * B7: AccountingService.createGLEntry's AccountLedger.create() call never set
 * branch_id, regardless of what the caller resolved — every patient bill's
 * revenue, top-up, void reversal and FX-aware payment entry posted to
 * account_ledger with branch_id always NULL. This matters concretely because
 * reportIncomeStatement.js's branch-scoped income statement filters directly
 * on account_ledger.branch_id (its branchScope() helper) — a branch user's
 * own income statement never showed their own patient billing revenue at
 * all. general_ledger/gl_line_items have no branch_id column in this schema
 * at all and aren't branch-filtered anywhere, so this test (matching the
 * scope of the actual fix) only asserts against account_ledger.
 *
 * Runs against tenant_test, never a real tenant.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_BRANCH_ID = 909001;

let sequelize;
let testConn;
let AccountingService;
let PatientBill;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  PatientBill = testConn.models.PatientBill;
  AccountingService = require('../../src/server/services/AccountingService');
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'BRANCHGL-%'`);
    await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%BRANCHGL-%')`);
    await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%BRANCHGL-%')`);
    await sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%BRANCHGL-%'`);
  } catch (e) { console.warn('billingLedgerBranchId cleanup failed (non-fatal):', e.message); }
});

test('B7: a patient bill\'s revenue posts to account_ledger with the bill\'s own branch_id', async () => {
  const billNumber = `BRANCHGL-${Date.now()}`;
  const { billId, glEntryId } = await withTenant(async () => {
    const txn = await sequelize.transaction();
    const bill = await PatientBill.create({
      clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'BranchGL Test Patient',
      bill_number: billNumber, total_amount: 4000, paid_amount: 0, balance_amount: 4000,
      status: 'pending', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP',
      branch_id: TEST_BRANCH_ID,
      services: [{ serviceName: 'BRANCHGL Test Service', totalPrice: 4000 }],
    }, { transaction: txn });
    const gl = await AccountingService.createGLFromPatientBill(bill.toJSON(), 'test-system', txn);
    await txn.commit();
    return { billId: bill.id, glEntryId: gl.id };
  });

  const [ledgerRows] = await sequelize.query(
    `SELECT branch_id FROM account_ledger WHERE transaction_id = :id`,
    { replacements: { id: glEntryId } }
  );
  expect(ledgerRows.length).toBeGreaterThan(0);
  expect(ledgerRows.every((r) => r.branch_id === TEST_BRANCH_ID)).toBe(true);
});

test('B7: a bill with no branch_id of its own still posts (NULL, not an error)', async () => {
  const billNumber = `BRANCHGL-NOBRANCH-${Date.now()}`;
  const glEntryId = await withTenant(async () => {
    const txn = await sequelize.transaction();
    const bill = await PatientBill.create({
      clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'BranchGL No-Branch Patient',
      bill_number: billNumber, total_amount: 1000, paid_amount: 0, balance_amount: 1000,
      status: 'pending', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP',
      services: [{ serviceName: 'BRANCHGL Test Service', totalPrice: 1000 }],
    }, { transaction: txn });
    const gl = await AccountingService.createGLFromPatientBill(bill.toJSON(), 'test-system', txn);
    await txn.commit();
    return gl.id;
  });

  const [ledgerRows] = await sequelize.query(
    `SELECT branch_id FROM account_ledger WHERE transaction_id = :id`,
    { replacements: { id: glEntryId } }
  );
  expect(ledgerRows.length).toBeGreaterThan(0);
  expect(ledgerRows.every((r) => r.branch_id === null)).toBe(true);
});

// syncBillRevenueToGL is the ONE place that actually posts GL for every
// addLineItemsToBill caller (inpatient lab/radiology/bed charges, Theatre's
// drug/consumable/procedure billing — none of those post GL themselves,
// relying entirely on this function via ledgerSweeper.js's periodic
// reconciliation). Its own SELECT of the bill never fetched branch_id at
// all, so every one of those revenue categories posted to account_ledger
// with branch_id always NULL regardless of the B7 fix above — defeating
// branch-scoped income statements for exactly the categories this session's
// branch-isolation work was meant to cover. Found via a follow-up accounting
// audit.
test('B7 follow-up: syncBillRevenueToGL (the sweeper\'s own posting path) also carries the bill\'s branch_id', async () => {
  const billNumber = `BRANCHGL-SYNC-${Date.now()}`;
  const billId = await withTenant(async () => {
    const bill = await PatientBill.create({
      clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'BranchGL Sync Test Patient',
      bill_number: billNumber, total_amount: 2500, paid_amount: 0, balance_amount: 2500,
      status: 'pending', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP',
      branch_id: TEST_BRANCH_ID,
      services: [{ serviceName: 'BRANCHGL Sync Test Service', totalPrice: 2500 }],
    });
    return bill.id;
  });

  // No GL entry exists yet for this bill at all — syncBillRevenueToGL sees
  // the full amount as "out of sync" and posts a correcting entry, exactly
  // the path ledgerSweeper.js drives on its own periodic sweep.
  await withTenant(() => AccountingService.syncBillRevenueToGL(billId, 'test-system'));

  const [ledgerRows] = await sequelize.query(
    `SELECT al.branch_id FROM account_ledger al
       JOIN general_ledger gl ON gl.id = al.transaction_id
      WHERE gl.reference_id = :billId AND gl.reference_module = 'bill_revenue_adjustment'`,
    { replacements: { billId } }
  );
  expect(ledgerRows.length).toBeGreaterThan(0);
  expect(ledgerRows.every((r) => r.branch_id === TEST_BRANCH_ID)).toBe(true);
});
