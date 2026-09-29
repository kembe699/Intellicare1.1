/**
 * The bill row and its accounting entry are one atomic transaction — a real
 * ACID operation, not "create the bill, then best-effort post the ledger
 * afterward". The old two-step version let a bill commit while its GL
 * posting failed for any reason, leaving a bill that fully exists with
 * nothing posted for it in the ledger: the income statement then fell short
 * of the cashier's own totals with nothing on screen looking wrong (see
 * ledgerSweeper.js's docstring for the real production incident this class
 * of bug caused).
 *
 * These tests exercise the exact flow patientBills.js's attemptCreateOrMerge
 * now uses — a single transaction shared between the bill write and
 * AccountingService.createGLFromPatientBill/createGLTopUpForPatientBill —
 * against tenant_test (never a real tenant), proving both that a genuine
 * failure rolls back the bill along with the ledger, and that the happy path
 * still produces a bill, a posted GL entry and a receivables row together.
 */
// NOTE: this file deliberately does NOT use tests/setup/testDb.js's own
// getSequelize() for anything that touches Sequelize MODELS (as opposed to
// raw SQL). The repo has two separate `sequelize` package installs — the
// root one and one nested under src/server/node_modules — and testDb.js
// (outside src/server) resolves the root copy while every model file
// (inside src/server) resolves the nested one. Building a connection from
// one copy and handing it to createModels() (which calls .define() using
// the OTHER copy's DataTypes) breaks Sequelize's internal identity checks
// for special sentinels like DataTypes.UUIDV4 — confirmed by reproducing it
// directly: every UUID primary key defaulted to a literal `{}` instead of a
// real UUID, so a bill's second GL line item collided with its first on the
// primary key. getTenantConnection (used here) builds the connection AND
// the models from inside src/server, so both come from the same copy, the
// same way every real request already does.
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const NO_ACCOUNTS_CLINIC_ID = 900201; // deliberately has no chart_of_accounts rows
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let AccountingService;
let BillingIntegrationService;
let PatientBill;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  // getTenantConnection also kicks off several best-effort, fire-and-forget
  // maintenance queries (ensurePrivilegesCatalog, ensureBranchIsolationColumns,
  // etc. — the same ones a real first request to a tenant triggers) that can
  // still be logging query text well after this file's afterAll has already
  // torn things down, which Jest treats as a suite failure ("Cannot log after
  // tests are done") even though every actual assertion passed. Silencing
  // this connection's query logging avoids that without touching the
  // maintenance behavior itself.
  sequelize.options.logging = false;
  PatientBill = testConn.models.PatientBill;
  // Required after testConn exists — these services resolve `require('../models')`
  // to the tenant-aware Proxy, which only sees this test connection from inside
  // tenantContext.run(); requiring them here (outside any run() call) is fine
  // since they don't touch the DB at require-time, only when their methods run.
  AccountingService = require('../../src/server/services/AccountingService');
  BillingIntegrationService = require('../../src/server/services/BillingIntegrationService');
}, 30000);

afterAll(async () => {
  // Cleanup runs on the SAME connection everything else in this file used
  // (testConn.sequelize, from getTenantConnection) rather than opening a
  // second, independent pool via testDb.js's own getSequelize() — opening
  // that second pool this late reliably raced against getTenantConnection's
  // own still-in-flight background maintenance queries (ensurePrivilegesCatalog,
  // ensureBranchIsolationColumns, etc. — the same ones a real first request to
  // a tenant triggers) and failed with an unhelpful empty error. Each
  // statement is independently best-effort: these are hygiene deletes for
  // hand-picked bill_number/description patterns, not part of what the tests
  // above actually assert, so a a flaky teardown query must never fail the
  // suite when every real assertion already passed.
  const replacements = { a: TEST_CLINIC_ID, b: NO_ACCOUNTS_CLINIC_ID };
  const cleanup = [
    () => sequelize.query(`DELETE FROM patient_bills WHERE clinic_id IN (:a, :b) AND bill_number LIKE 'ATOMIC-%'`, { replacements }),
    () => sequelize.query(`DELETE FROM patient_receivables WHERE bill_number LIKE 'ATOMIC-%'`),
    // account_ledger/gl_line_items rows don't carry the "ATOMIC-" bill number
    // in their own description (they use the patient name instead) — they
    // must be matched via general_ledger's id, not their own description text,
    // or they're never deleted and block deleting their general_ledger parent
    // on the foreign key.
    () => sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (SELECT id FROM general_ledger WHERE description LIKE '%ATOMIC-%')`),
    () => sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (SELECT id FROM general_ledger WHERE description LIKE '%ATOMIC-%')`),
    () => sequelize.query(`DELETE FROM general_ledger WHERE description LIKE '%ATOMIC-%'`),
  ];
  for (const step of cleanup) {
    try { await step(); } catch (e) { console.warn('billCreationAtomicity cleanup step failed (non-fatal):', e.message); }
  }
});

describe('createGLFromPatientBill(billData, userId, externalTransaction) — new bill', () => {
  test('a genuine posting failure (no chart of accounts for this clinic) rolls back the bill row too', async () => {
    const billNumber = `ATOMIC-FAIL-${Date.now()}`;
    const billData = {
      clinic_id: NO_ACCOUNTS_CLINIC_ID,
      patient_id: uuid(),
      patient_name: 'Atomicity Test Patient',
      bill_number: billNumber,
      total_amount: 1000,
      paid_amount: 0,
      balance_amount: 1000,
      status: 'pending',
      bill_date: new Date().toISOString().split('T')[0],
      created_by: 'test-system',
      services: [],
    };

    await expect(withTenant(async () => {
      const txn = await sequelize.transaction();
      try {
        const bill = await PatientBill.create(billData, { transaction: txn });
        // Same call patientBills.js's attemptCreateOrMerge makes for a new bill.
        await BillingIntegrationService.handleBillCreation(bill.toJSON(), 'test-system', txn);
        await txn.commit();
      } catch (e) {
        await txn.rollback();
        throw e;
      }
    })).rejects.toThrow(/Required accounts not found/);

    const [rows] = await sequelize.query('SELECT id FROM patient_bills WHERE bill_number = :bn', { replacements: { bn: billNumber } });
    expect(rows).toHaveLength(0);
  });

  test('the happy path commits the bill, a posted GL entry, and a receivables row together', async () => {
    const billNumber = `ATOMIC-OK-${Date.now()}`;
    const billData = {
      clinic_id: TEST_CLINIC_ID,
      patient_id: uuid(),
      patient_name: 'Atomicity Test Patient OK',
      bill_number: billNumber,
      total_amount: 2500,
      paid_amount: 0,
      balance_amount: 2500,
      status: 'pending',
      bill_date: new Date().toISOString().split('T')[0],
      created_by: 'test-system',
      services: [],
    };

    const billId = await withTenant(async () => {
      const txn = await sequelize.transaction();
      try {
        const bill = await PatientBill.create(billData, { transaction: txn });
        await BillingIntegrationService.handleBillCreation(bill.toJSON(), 'test-system', txn);
        await txn.commit();
        return bill.id;
      } catch (e) {
        await txn.rollback();
        throw e;
      }
    });

    const [[bill]] = await sequelize.query('SELECT id FROM patient_bills WHERE id = :id', { replacements: { id: billId } });
    expect(bill).toBeDefined();

    const [[gl]] = await sequelize.query(
      `SELECT id, is_posted, status FROM general_ledger WHERE reference_id = :id AND reference_module = 'patient_billing'`,
      { replacements: { id: billId } }
    );
    expect(gl).toBeDefined();
    expect(gl.is_posted).toBe(true);
    expect(gl.status).toBe('posted');

    const [ledgerRows] = await sequelize.query('SELECT is_posted FROM account_ledger WHERE transaction_id = :id', { replacements: { id: gl.id } });
    expect(ledgerRows.length).toBeGreaterThan(0);
    expect(ledgerRows.every((r) => r.is_posted === true)).toBe(true);

    const [[receivable]] = await sequelize.query('SELECT amount_due FROM patient_receivables WHERE bill_id = :id', { replacements: { id: billId } });
    expect(receivable).toBeDefined();
    expect(parseFloat(receivable.amount_due)).toBe(2500);
  });
});

describe('createGLTopUpForPatientBill(bill, ..., externalTransaction) — merge into existing bill', () => {
  test('a genuine posting failure rolls back the bill total update too', async () => {
    const billNumber = `ATOMIC-TOPUP-FAIL-${Date.now()}`;
    const bill = await withTenant(() => PatientBill.create({
      clinic_id: NO_ACCOUNTS_CLINIC_ID,
      patient_id: uuid(),
      patient_name: 'Atomicity Topup Test',
      bill_number: billNumber,
      total_amount: 1000,
      paid_amount: 0,
      balance_amount: 1000,
      status: 'pending',
      bill_date: new Date().toISOString().split('T')[0],
      created_by: 'test-system',
      services: [],
    }));

    await expect(withTenant(async () => {
      const txn = await sequelize.transaction();
      try {
        await bill.update({ total_amount: 1500, balance_amount: 1500 }, { transaction: txn });
        await AccountingService.createGLTopUpForPatientBill(
          { id: bill.id, clinic_id: NO_ACCOUNTS_CLINIC_ID, scheme_id: null, bill_number: billNumber, patient_name: bill.patient_name, bill_currency: 'SSP' },
          [{ serviceName: 'Extra item', totalPrice: 500 }],
          500,
          'test-system',
          txn,
        );
        await txn.commit();
      } catch (e) {
        await txn.rollback();
        throw e;
      }
    })).rejects.toThrow();

    const [[row]] = await sequelize.query('SELECT total_amount FROM patient_bills WHERE id = :id', { replacements: { id: bill.id } });
    // Rolled back to its original total — the merge attempt left no trace.
    expect(parseFloat(row.total_amount)).toBe(1000);
  });
});
