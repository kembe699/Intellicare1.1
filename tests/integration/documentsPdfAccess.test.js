/**
 * Security audit finding: none of the three PDF routes in documents.js had
 * any authorize() call or branch check — any authenticated user, in any
 * branch, could fetch any invoice/bill/receipt PDF (patient name, amounts,
 * payment method) just by knowing or guessing the record's id. Fixed by
 * adding the same authorize('bills.read') + BranchQueryFilter.canAccessRecord
 * pattern patientBills.js's own GET /:billId route already uses.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let handlers = {};
let branchAId, branchBId;
let billId, invoiceId, receiptId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.send = (body) => { res.sent = body; return res; };
  return res;
}

function handlerFor(router, routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(overrides) {
  return {
    params: {}, body: {}, query: {},
    user: { id: 1, displayName: 'Doc PDF Tester', role: 'doctor', clinicId: TEST_CLINIC_ID },
    branchContext: {},
    ...overrides,
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const documentsRouter = require('../../src/server/routes/documents');
  handlers = {
    invoicePdf: handlerFor(documentsRouter, '/invoice/:id/pdf', 'get'),
    billPdf: handlerFor(documentsRouter, '/bill/:id/pdf', 'get'),
    receiptPdf: handlerFor(documentsRouter, '/receipt/:id/pdf', 'get'),
  };

  const [[a]] = await sequelize.query(`INSERT INTO branches (name, is_active) VALUES ('DocPdfTest Branch A', true) RETURNING id`);
  const [[b]] = await sequelize.query(`INSERT INTO branches (name, is_active) VALUES ('DocPdfTest Branch B', true) RETURNING id`);
  branchAId = a.id; branchBId = b.id;

  billId = uuid();
  await sequelize.query(
    `INSERT INTO patient_bills (id, clinic_id, branch_id, patient_id, patient_name, bill_number, total_amount, paid_amount, balance_amount, status, bill_date, created_by, bill_currency, services, created_at, updated_at)
     VALUES (:id, :c, :b, :p, 'DocPdfTest Patient', :bn, 1000, 1000, 0, 'paid', CURRENT_DATE, 'test', 'SSP', '[]', NOW(), NOW())`,
    { replacements: { id: billId, c: TEST_CLINIC_ID, b: branchAId, p: uuid(), bn: `DOCPDF-${Date.now()}` } }
  );

  invoiceId = uuid();
  await sequelize.query(
    `INSERT INTO invoices (id, clinic_id, branch_id, patient_id, patient_name, invoice_number, amount, amount_paid, balance_due, currency, status, due_date, created_at, updated_at)
     VALUES (:id, :c, :b, :p, 'DocPdfTest Patient', :num, 1000, 0, 1000, 'SSP', 'unpaid', CURRENT_DATE, NOW(), NOW())`,
    { replacements: { id: invoiceId, c: TEST_CLINIC_ID, b: branchAId, p: uuid(), num: `DOCPDF-INV-${Date.now()}` } }
  );

  receiptId = uuid();
  await sequelize.query(
    `INSERT INTO receipts (id, bill_id, patient_id, clinic_id, branch_id, receipt_number, payment_amount, payment_method, payment_date, cashier_name, from_lease, created_at, updated_at)
     VALUES (:id, :billId, :p, :c, :b, :num, 1000, 'cash', CURRENT_DATE, 'Test Cashier', false, NOW(), NOW())`,
    { replacements: { id: receiptId, billId, p: uuid(), c: TEST_CLINIC_ID, b: branchAId, num: `DOCPDF-RCP-${Date.now()}` } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM receipts WHERE id = :id`, { replacements: { id: receiptId } });
    await sequelize.query(`DELETE FROM invoices WHERE id = :id`, { replacements: { id: invoiceId } });
    await sequelize.query(`DELETE FROM patient_bills WHERE id = :id`, { replacements: { id: billId } });
    await sequelize.query(`DELETE FROM branches WHERE id IN (:a, :b)`, { replacements: { a: branchAId, b: branchBId } });
  } catch (e) { console.warn('documentsPdfAccess cleanup failed (non-fatal):', e.message); }
});

describe('Document PDF routes require a privilege and enforce branch access', () => {
  // authorize() is Express middleware — handlerFor() (like every other test
  // in this suite) extracts only the final route handler, bypassing it, so
  // privilege enforcement itself is verified by source inspection instead
  // (same convention tests/integrity/lisCollectionVisibility.test.js uses).
  test('all three PDF routes require authorize(\'bills.read\') — none were previously gated at all', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/server/routes/documents.js'), 'utf8');
    expect(src).toMatch(/router\.get\('\/invoice\/:id\/pdf',\s*authorize\('bills\.read'\)/);
    expect(src).toMatch(/router\.get\('\/bill\/:id\/pdf',\s*authorize\('bills\.read'\)/);
    expect(src).toMatch(/router\.get\('\/receipt\/:id\/pdf',\s*authorize\('bills\.read'\)/);
  });

  test('a branch-scoped user CANNOT fetch another branch\'s bill PDF', async () => {
    const res = mockRes();
    await withTenant(() => handlers.billPdf(req({
      params: { id: billId },
      user: { id: 3, role: 'doctor', clinicId: TEST_CLINIC_ID, branchId: branchBId },
      branchContext: { branchId: branchBId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(403);
  });

  test('a branch-scoped user CAN fetch their own branch\'s bill PDF', async () => {
    const res = mockRes();
    await withTenant(() => handlers.billPdf(req({
      params: { id: billId },
      user: { id: 4, role: 'doctor', clinicId: TEST_CLINIC_ID, branchId: branchAId },
      branchContext: { branchId: branchAId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(200);
  });

  test('a branch-scoped user CANNOT fetch another branch\'s invoice PDF', async () => {
    const res = mockRes();
    await withTenant(() => handlers.invoicePdf(req({
      params: { id: invoiceId },
      user: { id: 5, role: 'doctor', clinicId: TEST_CLINIC_ID, branchId: branchBId },
      branchContext: { branchId: branchBId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(403);
  });

  test('a branch-scoped user CANNOT fetch another branch\'s receipt PDF', async () => {
    const res = mockRes();
    await withTenant(() => handlers.receiptPdf(req({
      params: { id: receiptId },
      user: { id: 6, role: 'doctor', clinicId: TEST_CLINIC_ID, branchId: branchBId },
      branchContext: { branchId: branchBId, isAdmin: false },
    }), res));
    expect(res.statusCode).toBe(403);
  });
});
