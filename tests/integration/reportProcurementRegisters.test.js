/**
 * Procurement / Accounts Payable Reports' endpoints — proves each pulls
 * from the right table/columns against real seeded data (pending vs. fully
 * paid bills, computed due dates from payment_terms, A/P aging buckets,
 * consultant bill status, purchases grouping), not just that the SQL
 * doesn't throw.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const SUFFIX = `PROCREG-${Date.now()}`;

let sequelize;
let testConn;
let router;
let branchId;
let supplierId;
let employeeId;
let po1Id; // unpaid, 100 days old -> aging bucket 90+
let po2Id; // partial, 10 days old -> aging bucket current
let po3Id; // fully paid -> must NOT appear in pending/aging
let cbId;
let pbillId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function handlerFor(routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(query) {
  return { query, user: { id: 1, role: 'admin', clinicId: 1 }, branchContext: { isAdmin: true } };
}

async function run(path, query) {
  const handler = handlerFor(path, 'get');
  const res = mockRes();
  await withTenant(() => handler(req(query), res));
  return res;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  router = require('../../src/server/routes/reportProcurement');

  const [[branch]] = await sequelize.query(`INSERT INTO branches (facility_id, name, is_active) VALUES (1, :name, true) RETURNING id`, { replacements: { name: `${SUFFIX} Branch` } });
  branchId = branch.id;
  const [[supplier]] = await sequelize.query(`INSERT INTO suppliers (name, supplier_code, clinic_id, created_at, updated_at) VALUES (:name, :code, 1, NOW(), NOW()) RETURNING id`, { replacements: { name: `${SUFFIX} Supplier`, code: `${SUFFIX}-SUP` } });
  supplierId = supplier.id;
  const [[employee]] = await sequelize.query(`INSERT INTO employees (id, clinic_id, employee_number, first_name, last_name) VALUES (:id, 1, :empNum, :suffix, 'Consultant') RETURNING id`, { replacements: { id: uuid(), empNum: `${SUFFIX}-EMP`, suffix: SUFFIX } });
  employeeId = employee.id;

  const [[po1]] = await sequelize.query(
    `INSERT INTO purchase_orders (po_number, supplier_id, order_date, total_amount, status, payment_status, paid_amount, payment_terms, clinic_id, branch_id, created_at, updated_at)
     VALUES (:pn, :supplierId, CURRENT_DATE - 100, 10000, 'received', 'unpaid', 0, 'Net30', 1, :branchId, NOW(), NOW()) RETURNING id`,
    { replacements: { pn: `${SUFFIX}-PO1`, supplierId, branchId } }
  );
  po1Id = po1.id;
  await sequelize.query(`INSERT INTO purchase_order_items (purchase_order_id, item_name, quantity, unit_price, total_price, branch_id, created_at, updated_at) VALUES (:poId, :name, 10, 1000, 10000, :branchId, NOW(), NOW())`, { replacements: { poId: po1Id, name: `${SUFFIX} Item A`, branchId } });

  const [[po2]] = await sequelize.query(
    `INSERT INTO purchase_orders (po_number, supplier_id, order_date, total_amount, status, payment_status, paid_amount, payment_terms, clinic_id, branch_id, created_at, updated_at)
     VALUES (:pn, :supplierId, CURRENT_DATE - 10, 5000, 'approved', 'partial', 2000, 'Net15', 1, :branchId, NOW(), NOW()) RETURNING id`,
    { replacements: { pn: `${SUFFIX}-PO2`, supplierId, branchId } }
  );
  po2Id = po2.id;
  await sequelize.query(`INSERT INTO purchase_order_items (purchase_order_id, item_name, quantity, unit_price, total_price, branch_id, created_at, updated_at) VALUES (:poId, :name, 5, 1000, 5000, :branchId, NOW(), NOW())`, { replacements: { poId: po2Id, name: `${SUFFIX} Item B`, branchId } });
  await sequelize.query(
    `INSERT INTO supplier_bill_payments (id, po_id, po_number, supplier_name, payment_date, amount_paid, payment_method, payment_voucher_number, clinic_id, branch_id)
     VALUES (:id, :poId, :pn, :sn, CURRENT_DATE, 2000, 'cash', :voucher, 1, :branchId)`,
    { replacements: { id: uuid(), poId: String(po2Id), pn: `${SUFFIX}-PO2`, sn: `${SUFFIX} Supplier`, voucher: `${SUFFIX}-VOUCHER`, branchId } }
  );

  const [[po3]] = await sequelize.query(
    `INSERT INTO purchase_orders (po_number, supplier_id, order_date, total_amount, status, payment_status, paid_amount, clinic_id, branch_id, created_at, updated_at)
     VALUES (:pn, :supplierId, CURRENT_DATE - 5, 3000, 'received', 'paid', 3000, 1, :branchId, NOW(), NOW()) RETURNING id`,
    { replacements: { pn: `${SUFFIX}-PO3`, supplierId, branchId } }
  );
  po3Id = po3.id;

  cbId = uuid();
  await sequelize.query(
    `INSERT INTO consultant_bills (id, clinic_id, branch_id, consultant_id, bill_number, period_from, period_to, bill_amount, currency, status)
     VALUES (:id, 1, :branchId, :empId, :bn, CURRENT_DATE - 30, CURRENT_DATE, 1500, 'SSP', 'unpaid')`,
    { replacements: { id: cbId, branchId, empId: employeeId, bn: `${SUFFIX}-CB` } }
  );
  const [[pbill]] = await sequelize.query(
    `INSERT INTO patient_bills (id, clinic_id, patient_id, patient_name, bill_number, total_amount, paid_amount, balance_amount, status, bill_date, created_by, bill_currency, created_at, updated_at)
     VALUES (:id, 1, :pid, :pname, :bn, 1500, 1500, 0, 'paid', CURRENT_DATE, 'test', 'SSP', NOW(), NOW()) RETURNING id`,
    { replacements: { id: uuid(), pid: uuid(), pname: `${SUFFIX} Patient`, bn: `${SUFFIX}-BILL` } }
  );
  pbillId = pbill.id;
  await sequelize.query(
    `INSERT INTO consultant_bill_items (id, consultant_bill_id, consultant_id, patient_bill_id, visit_date, currency, amount)
     VALUES (:id, :cbId, :empId, :pbillId, CURRENT_DATE, 'SSP', 1500)`,
    { replacements: { id: uuid(), cbId, empId: employeeId, pbillId } }
  );
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM consultant_bill_items WHERE consultant_bill_id = :cbId`, { replacements: { cbId } });
    await sequelize.query(`DELETE FROM consultant_bills WHERE id = :cbId`, { replacements: { cbId } });
    await sequelize.query(`DELETE FROM patient_bills WHERE id = :pbillId`, { replacements: { pbillId } });
    await sequelize.query(`DELETE FROM supplier_bill_payments WHERE po_number LIKE :pfx`, { replacements: { pfx: `${SUFFIX}%` } });
    await sequelize.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (:po1Id, :po2Id, :po3Id)`, { replacements: { po1Id, po2Id, po3Id } });
    await sequelize.query(`DELETE FROM purchase_orders WHERE id IN (:po1Id, :po2Id, :po3Id)`, { replacements: { po1Id, po2Id, po3Id } });
    await sequelize.query(`DELETE FROM employees WHERE id = :employeeId`, { replacements: { employeeId } });
    await sequelize.query(`DELETE FROM suppliers WHERE id = :supplierId`, { replacements: { supplierId } });
    await sequelize.query(`DELETE FROM branches WHERE id = :branchId`, { replacements: { branchId } });
  } catch (e) { console.warn('reportProcurementRegisters cleanup failed (non-fatal):', e.message); }
});

const range = { dateFrom: '2020-01-01', dateTo: '2030-01-01', allBranches: 'true', clinic_id: '1' };

describe('Procurement/A-P register reports pull from the right records', () => {
  test('pending-bills includes the unpaid and partial POs, excludes the fully-paid one', async () => {
    const res = await run('/pending-bills', range);
    const poNumbers = res.body.rows.map((r) => r.poNumber);
    expect(poNumbers).toContain(`${SUFFIX}-PO1`);
    expect(poNumbers).toContain(`${SUFFIX}-PO2`);
    expect(poNumbers).not.toContain(`${SUFFIX}-PO3`);
    const po2Row = res.body.rows.find((r) => r.poNumber === `${SUFFIX}-PO2`);
    expect(po2Row.balanceAmount).toBe(3000);
  });

  test('bills-due-payment computes due date from payment_terms (Net30/Net15)', async () => {
    const res = await run('/bills-due-payment', range);
    const po1Row = res.body.rows.find((r) => r.poNumber === `${SUFFIX}-PO1`);
    const po2Row = res.body.rows.find((r) => r.poNumber === `${SUFFIX}-PO2`);
    expect(po1Row.dueDate.slice(5)).toBe(
      new Date(new Date(po1Row.orderDate).getTime() + 30 * 86400000).toISOString().slice(5, 10)
    );
    expect(po2Row.dueDate.slice(5)).toBe(
      new Date(new Date(po2Row.orderDate).getTime() + 15 * 86400000).toISOString().slice(5, 10)
    );
  });

  test('payments returns the recorded supplier_bill_payments row with its voucher number', async () => {
    const res = await run('/payments', range);
    const row = res.body.rows.find((r) => r.voucherNumber === `${SUFFIX}-VOUCHER`);
    expect(row).toBeTruthy();
    expect(row.amountPaid).toBe(2000);
  });

  test('ap-aging-detailed buckets the 100-day-old bill as 90+ and the 10-day-old bill as current', async () => {
    const res = await run('/ap-aging-detailed', range);
    const po1Row = res.body.rows.find((r) => r.poNumber === `${SUFFIX}-PO1`);
    const po2Row = res.body.rows.find((r) => r.poNumber === `${SUFFIX}-PO2`);
    expect(po1Row.bucket).toBe('d90_plus');
    expect(po2Row.bucket).toBe('current');
  });

  test('ap-aging-summary by branch totals balances into the right buckets', async () => {
    const res = await run('/ap-aging-summary', { ...range, groupBy: 'branch' });
    const row = res.body.rows.find((r) => r.groupLabel === `${SUFFIX} Branch`);
    expect(row.current).toBe(3000);
    expect(row.d90_plus).toBe(10000);
    expect(row.total).toBe(13000);
  });

  test('consultant-bill-items (unpaid) resolves consultant and patient names, excludes paid bills', async () => {
    const unpaid = await run('/consultant-bill-items', { ...range, status: 'unpaid' });
    const row = unpaid.body.rows.find((r) => r.billNumber === `${SUFFIX}-CB`);
    expect(row.consultantName).toBe(`${SUFFIX} Consultant`);
    expect(row.patientName).toBe(`${SUFFIX} Patient`);

    const paid = await run('/consultant-bill-items', { ...range, status: 'paid' });
    expect(paid.body.rows.some((r) => r.billNumber === `${SUFFIX}-CB`)).toBe(false);
  });

  test('purchases by branch and by item total correctly, excluding the bill with no line items', async () => {
    const byBranch = await run('/purchases', { ...range, groupBy: 'branch' });
    const branchRow = byBranch.body.rows.find((r) => r.groupLabel === `${SUFFIX} Branch`);
    expect(branchRow.orderCount).toBe(2);
    expect(branchRow.totalAmount).toBe(15000);

    const byItem = await run('/purchases', { ...range, groupBy: 'item' });
    const itemA = byItem.body.rows.find((r) => r.groupLabel === `${SUFFIX} Item A`);
    const itemB = byItem.body.rows.find((r) => r.groupLabel === `${SUFFIX} Item B`);
    expect(itemA.totalQuantity).toBe(10);
    expect(itemA.totalAmount).toBe(10000);
    expect(itemB.totalQuantity).toBe(5);
    expect(itemB.totalAmount).toBe(5000);
  });
});
