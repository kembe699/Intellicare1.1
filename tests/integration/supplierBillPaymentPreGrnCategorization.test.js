/**
 * A supplier bill paid before its Goods Receipt Note is accepted has no
 * per-line inventory_item_id yet, so the whole payment used to post 100% to
 * Miscellaneous Expenses (5900) — the single biggest known source of large,
 * unexplained Miscellaneous balances on the Income Statement (a real client
 * complaint: "yesterday's income statement is showing miscellaneous of over
 * 3 million SSP that's not entered yesterday"). daily-expenses.js's
 * inferExpenseAccountFromPOItems now fuzzy-matches the PO's own line item
 * names against the inventory catalog to recover a real expense/COGS
 * account before falling back to Miscellaneous — this is the business logic
 * under test here, not the GL mechanics themselves (already covered by
 * accountingInvariants.test.js).
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;

let sequelize;
let testConn;
let payHandler;
let cashAccountId;
let drugsAccountId;
let suppliesAccountId;
let miscAccountId;
let poIds = [];

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function handlerFor(router, routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(body) {
  return {
    params: {}, body, query: {},
    user: { id: 1, displayName: 'Pre-GRN Categorization Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
  };
}

// Idempotent — ensures this clinic's chart of accounts has the handful of
// accounts this test (and the real feature) needs, without touching or
// deleting whatever chart of accounts another test/tenant state already has.
// Chart-of-accounts rows aren't tenant-bootstrapped the way most of this
// app's tables are (see ensureXxxTable.js files) — a clinic only gets one
// once an admin runs Setup's "Initialize Chart of Accounts" — so tenant_test
// starts with none at all.
async function ensureAccount(code, name, type, balanceType) {
  const [[existing]] = await sequelize.query(
    `SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = :code`,
    { replacements: { clinicId: TEST_CLINIC_ID, code } }
  );
  if (existing) {
    // Another test file (covering the "leaned chart deactivates 5210" case
    // the daily-expenses.js fix's own comment flags) can leave this clinic's
    // chart_of_accounts row for this code deactivated — reactivate it so
    // this test exercises the code path it's actually named for, rather
    // than silently inheriting whatever state a previous file left behind.
    await sequelize.query(`UPDATE chart_of_accounts SET is_active = true WHERE id = :id`, { replacements: { id: existing.id } });
    return existing.id;
  }
  const id = uuid();
  await sequelize.query(
    `INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, balance_type, is_active)
     VALUES (:id, :clinicId, :code, :name, :type, :balanceType, true)`,
    { replacements: { id, clinicId: TEST_CLINIC_ID, code, name, type, balanceType } }
  );
  return id;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/daily-expenses');
  payHandler = handlerFor(router, '/supplier-bill-payment', 'post');

  cashAccountId = await ensureAccount('1100', 'Cash on Hand', 'asset', 'debit');
  await ensureAccount('2100', 'Accounts Payable', 'liability', 'credit');
  drugsAccountId = await ensureAccount('5210', 'Pharmaceutical Cost of Sales', 'expense', 'debit');
  suppliesAccountId = await ensureAccount('5200', 'Medical Supplies Expense', 'expense', 'debit');
  miscAccountId = await ensureAccount('5900', 'Miscellaneous Expenses', 'expense', 'debit');

  // A catalog item the PO line items below will fuzzy-match against by name.
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, item_category, unit_of_measure, is_active)
     VALUES (:id, :clinicId, :code, :name, 'drugs', 'Tab', true)`,
    { replacements: { id: uuid(), clinicId: TEST_CLINIC_ID, code: `PREGRN-DRUG-${Date.now()}`, name: `PreGrnTest Paracetamol 500mg ${Date.now()}` } }
  );
}, 30000);

afterAll(async () => {
  try {
    if (poIds.length > 0) {
      await sequelize.query(`DELETE FROM supplier_bill_payments WHERE po_id IN (:poIds)`, { replacements: { poIds: poIds.map(String) } });
      await sequelize.query(`DELETE FROM supplier_bill_approvals WHERE po_id IN (:poIds)`, { replacements: { poIds: poIds.map(String) } });
      await sequelize.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (:poIds)`, { replacements: { poIds } });
      const [glEntries] = await sequelize.query(`SELECT id FROM general_ledger WHERE reference_module = 'supplier_bill_payment' AND description LIKE 'Supplier bill payment — PO PREGRN-%'`);
      if (glEntries.length > 0) {
        const glIds = glEntries.map((g) => g.id);
        await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (:glIds)`, { replacements: { glIds } });
        await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (:glIds)`, { replacements: { glIds } });
        await sequelize.query(`DELETE FROM general_ledger WHERE id IN (:glIds)`, { replacements: { glIds } });
      }
      await sequelize.query(`DELETE FROM purchase_orders WHERE id IN (:poIds)`, { replacements: { poIds } });
    }
    await sequelize.query(`DELETE FROM inventory_items WHERE item_name LIKE 'PreGrnTest %'`);
  } catch (e) { console.warn('supplierBillPaymentPreGrnCategorization cleanup failed (non-fatal):', e.message); }
});

async function createPO(poNumber, lineItemName) {
  const [[po]] = await sequelize.query(
    `INSERT INTO purchase_orders (po_number, supplier_id, order_date, total_amount, status, clinic_id, po_currency, ap_base_currency_amount, paid_amount, payment_status, created_at, updated_at)
     VALUES (:poNumber, 1, NOW(), 10000, 'approved', :clinicId, 'SSP', 0, 0, 'unpaid', NOW(), NOW()) RETURNING id`,
    { replacements: { poNumber, clinicId: TEST_CLINIC_ID } }
  );
  const poId = po.id;
  poIds.push(poId);
  await sequelize.query(
    `INSERT INTO purchase_order_items (purchase_order_id, item_name, quantity, unit_price, total_price, unit_of_measure, created_at, updated_at)
     VALUES (:poId, :itemName, 1, 10000, 10000, 'Each', NOW(), NOW())`,
    { replacements: { poId, itemName: lineItemName } }
  );
  for (let level = 1; level <= 3; level++) {
    await sequelize.query(
      `INSERT INTO supplier_bill_approvals (id, po_id, user_id, approval_level, approved_by, approved_at)
       VALUES (:id, :poId, 1, :level, 'Test Approver', NOW())`,
      { replacements: { id: uuid(), poId: String(poId), level } }
    );
  }
  return poId;
}

describe('POST /api/daily-expenses/supplier-bill-payment — pre-GRN categorization', () => {
  test('a PO whose line item matches a catalog drug posts to Pharmaceutical Cost of Sales, not Miscellaneous', async () => {
    const poId = await createPO(`PREGRN-MATCH-${Date.now()}`, 'PreGrnTest Paracetamol 500mg');
    const res = mockRes();
    await withTenant(() => payHandler(req({ po_id: poId, amount_paid: 10000, account_id: cashAccountId, payment_method: 'cash' }), res));
    expect(res.statusCode).toBe(201);

    const [[entry]] = await sequelize.query(
      `SELECT al.account_id FROM account_ledger al
       JOIN general_ledger gl ON gl.id = al.transaction_id
       WHERE gl.reference_module = 'supplier_bill_payment' AND gl.reference_id = :ref AND al.debit_amount > 0`,
      { replacements: { ref: String(res.body.id) } }
    );
    expect(entry.account_id).toBe(drugsAccountId);
  });

  test('a PO with no catalog match still falls back to Miscellaneous, exactly as before', async () => {
    const poId = await createPO(`PREGRN-NOMATCH-${Date.now()}`, 'Totally Unrecognizable Line Item Name XYZ');
    const res = mockRes();
    await withTenant(() => payHandler(req({ po_id: poId, amount_paid: 10000, account_id: cashAccountId, payment_method: 'cash' }), res));
    expect(res.statusCode).toBe(201);

    const [[entry]] = await sequelize.query(
      `SELECT al.account_id FROM account_ledger al
       JOIN general_ledger gl ON gl.id = al.transaction_id
       WHERE gl.reference_module = 'supplier_bill_payment' AND gl.reference_id = :ref AND al.debit_amount > 0`,
      { replacements: { ref: String(res.body.id) } }
    );
    expect(entry.account_id).toBe(miscAccountId);
  });
});
