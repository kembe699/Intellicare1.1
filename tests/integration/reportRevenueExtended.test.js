/**
 * Revenue Report — the new report types added behind the dropdown selector:
 * payment-mode / item breakdowns, the patient-bills family (branch/scheme/
 * status groupings with an outpatient/inpatient/discharged filter), the
 * generic transaction-level detail view, weekly/monthly trend, service cost
 * analysis, and patient register by scheme.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;
// Far-future, synthetic date — avoids colliding with other test files'
// fixed-date fixtures on the shared tenant_test tables (see
// incomeStatementDailyAndSections.test.js for the same reasoning).
const TEST_DATE = '2031-04-12';
const DISCHARGE_TEST_DATE = '2031-04-20'; // bill raised after a discharge

let sequelize;
let testConn;
let revenueRouter;
let schemeId;
let branchId;
let admissionIds = [];
let billIds = [];
let receiptIds = [];
let accountIds = [];

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

function req(query) {
  return {
    params: {}, body: {}, query,
    user: { id: 1, displayName: 'Revenue Report Extended Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
  };
}

async function ensureAccount(code, name, type, balanceType, subAccountType) {
  const [[existing]] = await sequelize.query(
    `SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = :code`,
    { replacements: { clinicId: TEST_CLINIC_ID, code } }
  );
  if (existing) {
    await sequelize.query(
      `UPDATE chart_of_accounts SET is_active = true, sub_account_type = :subAccountType WHERE id = :id`,
      { replacements: { id: existing.id, subAccountType: subAccountType || null } }
    );
    return existing.id;
  }
  const id = uuid();
  await sequelize.query(
    `INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, balance_type, sub_account_type, is_active)
     VALUES (:id, :clinicId, :code, :name, :type, :balanceType, :subAccountType, true)`,
    { replacements: { id, clinicId: TEST_CLINIC_ID, code, name, type, balanceType, subAccountType: subAccountType || null } }
  );
  return id;
}

async function insertBill({ id, patientId, patientName, date, schemeId: sid, branchId: bid, services, totalAmount, paidAmount, balanceAmount, status }) {
  billIds.push(id);
  await sequelize.query(
    `INSERT INTO patient_bills (id, bill_number, patient_id, patient_name, clinic_id, bill_date, scheme_id, branch_id, services, total_amount, paid_amount, balance_amount, status, created_by, created_at, updated_at)
     VALUES (:id, :billNumber, :patientId, :patientName, :clinicId, :date, :schemeId, :branchId, :services, :totalAmount, :paidAmount, :balanceAmount, :status, 'test', NOW(), NOW())`,
    { replacements: { id, billNumber: `BILL-REVEXT-${id.slice(0, 8)}`, patientId, patientName, clinicId: TEST_CLINIC_ID, date, schemeId: sid || null, branchId: bid || null, services: JSON.stringify(services || []), totalAmount, paidAmount, balanceAmount, status: status || 'paid' } }
  );
}

async function insertReceipt({ id, billId, branchId: bid, amount, paymentMethod, date }) {
  receiptIds.push(id);
  await sequelize.query(
    `INSERT INTO receipts (id, receipt_number, clinic_id, bill_id, branch_id, payment_date, payment_amount, payment_method, status, from_lease, created_at, updated_at)
     VALUES (:id, :receiptNumber, :clinicId, :billId, :branchId, :date, :amount, :paymentMethod, 'active', false, NOW(), NOW())`,
    { replacements: { id, receiptNumber: `RCP-REVEXT-${id.slice(0, 8)}`, clinicId: TEST_CLINIC_ID, billId, branchId: bid || null, date, amount, paymentMethod: paymentMethod || 'cash' } }
  );
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  revenueRouter = require('../../src/server/routes/reportRevenue');

  const [branches] = await sequelize.query(`SELECT id FROM branches ORDER BY id LIMIT 1`);
  branchId = branches[0]?.id ?? null;

  schemeId = uuid();
  await sequelize.query(
    `INSERT INTO patient_schemes (id, clinic_id, scheme_code, scheme_name, is_active) VALUES (:id, :clinicId, :code, :name, true)`,
    { replacements: { id: schemeId, clinicId: TEST_CLINIC_ID, code: `REVEXT-${Date.now()}`, name: 'RevExt Insurance Co' } }
  );

  // Three patients covering the three patient-type buckets.
  const outpatientId = uuid();   // no admission at all
  const inpatientId = uuid();    // admitted, still in hospital on TEST_DATE
  const dischargedId = uuid();   // discharged before DISCHARGE_TEST_DATE's bill

  const inpatientAdmissionId = uuid();
  admissionIds.push(inpatientAdmissionId);
  await sequelize.query(
    `INSERT INTO inpatient_admissions (id, clinic_id, patient_id, admission_date, bed_id, room_id, ward_id, admission_reason, admitted_by_user_id, status, created_at, updated_at)
     VALUES (:id, :clinicId, :patientId, :admissionDate, :bedId, :roomId, :wardId, 'Test admission', :userId, 'active', NOW(), NOW())`,
    { replacements: { id: inpatientAdmissionId, clinicId: String(TEST_CLINIC_ID), patientId: inpatientId, admissionDate: `${TEST_DATE} 08:00:00`, bedId: uuid(), roomId: uuid(), wardId: uuid(), userId: 1 } }
  );

  const dischargedAdmissionId = uuid();
  admissionIds.push(dischargedAdmissionId);
  await sequelize.query(
    `INSERT INTO inpatient_admissions (id, clinic_id, patient_id, admission_date, discharge_date, bed_id, room_id, ward_id, admission_reason, admitted_by_user_id, status, created_at, updated_at)
     VALUES (:id, :clinicId, :patientId, :admissionDate, :dischargeDate, :bedId, :roomId, :wardId, 'Test admission (discharged)', :userId, 'discharged', NOW(), NOW())`,
    { replacements: { id: dischargedAdmissionId, clinicId: String(TEST_CLINIC_ID), patientId: dischargedId, admissionDate: `${TEST_DATE} 08:00:00`, dischargeDate: `${TEST_DATE} 18:00:00`, bedId: uuid(), roomId: uuid(), wardId: uuid(), userId: 1 } }
  );

  // Outpatient bill — cash, item-level services for the item/payment-mode/detail tests.
  const outBillId = uuid();
  await insertBill({
    id: outBillId, patientId: outpatientId, patientName: 'RevExt Outpatient',
    date: TEST_DATE, schemeId: null, branchId,
    services: [{ serviceName: 'GP - Consultation', totalPrice: 5000 }, { serviceName: 'Panadol Extra', totalPrice: 2000 }],
    totalAmount: 7000, paidAmount: 7000, balanceAmount: 0, status: 'paid',
  });
  await insertReceipt({ id: uuid(), billId: outBillId, branchId, amount: 4000, paymentMethod: 'cash', date: TEST_DATE });
  await insertReceipt({ id: uuid(), billId: outBillId, branchId, amount: 3000, paymentMethod: 'card', date: TEST_DATE });

  // Inpatient bill, scheme-billed.
  const inBillId = uuid();
  await insertBill({
    id: inBillId, patientId: inpatientId, patientName: 'RevExt Inpatient',
    date: TEST_DATE, schemeId, branchId,
    services: [{ serviceName: 'Ward Admission Fee', totalPrice: 20000 }],
    totalAmount: 20000, paidAmount: 20000, balanceAmount: 0, status: 'paid',
  });
  await insertReceipt({ id: uuid(), billId: inBillId, branchId, amount: 20000, paymentMethod: 'bank_transfer', date: TEST_DATE });

  // Discharged-patient bill — raised AFTER the discharge_date above.
  const dischargedBillId = uuid();
  await insertBill({
    id: dischargedBillId, patientId: dischargedId, patientName: 'RevExt Discharged',
    date: DISCHARGE_TEST_DATE, schemeId: null, branchId,
    services: [{ serviceName: 'Final Settlement Fee', totalPrice: 9000 }],
    totalAmount: 9000, paidAmount: 5000, balanceAmount: 4000, status: 'partial',
  });
  await insertReceipt({ id: uuid(), billId: dischargedBillId, branchId, amount: 5000, paymentMethod: 'cash', date: DISCHARGE_TEST_DATE });

  // services.service_name is globally UNIQUE — ensure rather than insert
  // outright, so this doesn't collide with a row another test file seeded.
  // tenant_test otherwise has an empty catalog, which would leave every
  // service-cost-analysis category "Uncategorized" (the correct behavior,
  // but not what this suite wants to verify).
  const [[existingConsult]] = await sequelize.query(`SELECT id FROM services WHERE service_name = 'GP - Consultation'`);
  if (!existingConsult) {
    await sequelize.query(
      `INSERT INTO services (id, service_name, category, price, is_active) VALUES (:id, 'GP - Consultation', 'Consultation', 5000, true)`,
      { replacements: { id: uuid() } }
    );
  }

  // 'Panadol Extra' (billed above, not in the services catalog) IS in the
  // inventory catalog — proves service-cost-analysis labels it "Pharmacy /
  // Inventory" instead of leaving it in "Uncategorized".
  const [[existingDrug]] = await sequelize.query(`SELECT id FROM inventory_items WHERE item_name = 'Panadol Extra' LIMIT 1`);
  if (!existingDrug) {
    await sequelize.query(
      `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, item_category, is_active, created_at, updated_at)
       VALUES (:id, :clinicId, :code, 'Panadol Extra', 'drugs', true, NOW(), NOW())`,
      { replacements: { id: uuid(), clinicId: TEST_CLINIC_ID, code: `REVEXT-PANADOL-${Date.now()}` } }
    );
  }

  // Chart of accounts for the service-cost-analysis COGS figure.
  await ensureAccount('5210', 'Pharmaceutical Cost of Sales', 'expense', 'debit', 'cost_of_sales');
  const cogsEntryId = uuid();
  await sequelize.query(
    `INSERT INTO account_ledger (id, clinic_id, account_id, transaction_date, debit_amount, credit_amount, source_module, created_at, updated_at)
     VALUES (:id, :clinicId, :accountId, :date, :debit, 0, 'test', NOW(), NOW())`,
    { replacements: { id: cogsEntryId, clinicId: TEST_CLINIC_ID, accountId: await (async () => {
        const [[row]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :c AND account_code = '5210'`, { replacements: { c: TEST_CLINIC_ID } });
        accountIds.push(row.id);
        return row.id;
      })(), date: TEST_DATE, debit: 1500 } }
  );
}, 30000);

afterAll(async () => {
  try {
    if (receiptIds.length > 0) await sequelize.query(`DELETE FROM receipts WHERE id IN (:ids)`, { replacements: { ids: receiptIds } });
    if (billIds.length > 0) await sequelize.query(`DELETE FROM patient_bills WHERE id IN (:ids)`, { replacements: { ids: billIds } });
    if (admissionIds.length > 0) await sequelize.query(`DELETE FROM inpatient_admissions WHERE id IN (:ids)`, { replacements: { ids: admissionIds } });
    await sequelize.query(`DELETE FROM account_ledger WHERE clinic_id = :c AND source_module = 'test' AND transaction_date = :d`, { replacements: { c: TEST_CLINIC_ID, d: TEST_DATE } });
    await sequelize.query(`DELETE FROM patient_schemes WHERE id = :id`, { replacements: { id: schemeId } });
    await sequelize.query(`DELETE FROM inventory_items WHERE item_name = 'Panadol Extra' AND item_code LIKE 'REVEXT-PANADOL-%'`);
  } catch (e) { console.warn('reportRevenueExtended cleanup failed (non-fatal):', e.message); }
});

describe('GET /api/reports-v2/revenue?groupBy=payment_mode', () => {
  test('groups collected revenue by payment method', async () => {
    const handler = handlerFor(revenueRouter, '/', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, groupBy: 'payment_mode' }), res));
    expect(res.statusCode).toBe(200);
    const cash = res.body.rows.find(r => r.key === 'cash');
    const card = res.body.rows.find(r => r.key === 'card');
    expect(cash.totalCollected).toBeGreaterThanOrEqual(4000);
    expect(card.totalCollected).toBeGreaterThanOrEqual(3000);
  });
});

describe('GET /api/reports-v2/revenue?groupBy=item', () => {
  test('groups billed/collected revenue by the raw billed item name', async () => {
    const handler = handlerFor(revenueRouter, '/', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, groupBy: 'item' }), res));
    expect(res.statusCode).toBe(200);
    const panadol = res.body.rows.find(r => r.label === 'Panadol Extra');
    const consult = res.body.rows.find(r => r.label === 'GP - Consultation');
    expect(panadol).toBeTruthy();
    expect(consult).toBeTruthy();
    expect(panadol.totalCollected).toBeGreaterThan(0);
  });
});

describe('GET /api/reports-v2/revenue/bills', () => {
  test('groups invoiced amounts by branch, patientType=all', async () => {
    const handler = handlerFor(revenueRouter, '/bills', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, groupBy: 'branch', patientType: 'all' }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.totals.totalBilled).toBeGreaterThanOrEqual(27000); // outpatient 7000 + inpatient 20000
  });

  test('patientType=inpatient includes the admitted patient bill and excludes the outpatient one', async () => {
    const handler = handlerFor(revenueRouter, '/bills', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, groupBy: 'scheme', patientType: 'inpatient' }), res));
    expect(res.statusCode).toBe(200);
    const schemeRow = res.body.rows.find(r => r.label === 'RevExt Insurance Co');
    expect(schemeRow).toBeTruthy();
    expect(schemeRow.totalBilled).toBe(20000);
    expect(res.body.note).toBeTruthy();
  });

  test('patientType=outpatient excludes the admitted patient bill', async () => {
    const handler = handlerFor(revenueRouter, '/bills', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, groupBy: 'branch', patientType: 'outpatient' }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.totals.totalBilled).toBe(7000);
  });

  test('patientType=discharged finds the bill raised after the admission\'s discharge_date', async () => {
    const handler = handlerFor(revenueRouter, '/bills', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: DISCHARGE_TEST_DATE, dateTo: DISCHARGE_TEST_DATE, groupBy: 'branch', patientType: 'discharged' }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.totals.totalBilled).toBe(9000);
  });

  test('groupBy=status buckets by the bill\'s own status', async () => {
    const handler = handlerFor(revenueRouter, '/bills', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: DISCHARGE_TEST_DATE, dateTo: DISCHARGE_TEST_DATE, groupBy: 'status', patientType: 'all' }), res));
    expect(res.statusCode).toBe(200);
    const partialRow = res.body.rows.find(r => r.key === 'partial');
    expect(partialRow.totalBalance).toBe(4000);
  });
});

describe('GET /api/reports-v2/revenue/detail', () => {
  test('source=receipts returns a flat transaction-level list with dimension columns', async () => {
    const handler = handlerFor(revenueRouter, '/detail', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, source: 'receipts' }), res));
    expect(res.statusCode).toBe(200);
    const row = res.body.rows.find(r => r.paymentMethod === 'bank_transfer');
    expect(row).toBeTruthy();
    expect(row.amount).toBe(20000);
    expect(row.scheme).toBe('RevExt Insurance Co');
  });

  test('source=bills classifies patient type per row and respects an optional patientType filter', async () => {
    const handler = handlerFor(revenueRouter, '/detail', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, source: 'bills' }), res));
    expect(res.statusCode).toBe(200);
    const inpatientRow = res.body.rows.find(r => r.patientName === 'RevExt Inpatient');
    expect(inpatientRow.patientType).toBe('Inpatient');
    const outpatientRow = res.body.rows.find(r => r.patientName === 'RevExt Outpatient');
    expect(outpatientRow.patientType).toBe('Outpatient');

    const filtered = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, source: 'bills', patientType: 'inpatient' }), filtered));
    expect(filtered.body.rows.every(r => r.patientType === 'Inpatient')).toBe(true);
  });
});

describe('GET /api/reports-v2/revenue/trend', () => {
  test('interval=week buckets collected revenue by week', async () => {
    const handler = handlerFor(revenueRouter, '/trend', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, interval: 'week' }), res));
    expect(res.statusCode).toBe(200);
    const total = res.body.rows.reduce((s, r) => s + r.totalCollected, 0);
    expect(total).toBeGreaterThanOrEqual(27000);
  });
});

describe('GET /api/reports-v2/revenue/service-cost-analysis', () => {
  test('reports revenue by category alongside tracked Cost of Goods Sold and gross margin', async () => {
    const handler = handlerFor(revenueRouter, '/service-cost-analysis', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, clinic_id: String(TEST_CLINIC_ID) }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.summary.totalCOGS).toBeGreaterThanOrEqual(1500);
    expect(res.body.summary.grossMargin).toBe(res.body.summary.totalRevenue - res.body.summary.totalCOGS);
    const consultRow = res.body.byCategory.find(c => c.category === 'Consultation');
    expect(consultRow).toBeTruthy();
  });

  test('a line item matching the inventory catalog (not the services catalog) is labeled "Pharmacy / Inventory", not left in "Uncategorized"', async () => {
    const handler = handlerFor(revenueRouter, '/service-cost-analysis', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE, clinic_id: String(TEST_CLINIC_ID) }), res));
    expect(res.statusCode).toBe(200);
    const pharmacyRow = res.body.byCategory.find(c => c.category === 'Pharmacy / Inventory');
    expect(pharmacyRow).toBeTruthy();
    expect(pharmacyRow.totalBilled).toBeGreaterThanOrEqual(2000);
  });
});

describe('GET /api/reports-v2/revenue/patient-register', () => {
  test('lists per-patient totals sorted by scheme', async () => {
    const handler = handlerFor(revenueRouter, '/patient-register', 'get');
    const res = mockRes();
    await withTenant(() => handler(req({ dateFrom: TEST_DATE, dateTo: TEST_DATE }), res));
    expect(res.statusCode).toBe(200);
    const schemeRow = res.body.rows.find(r => r.patientName === 'RevExt Inpatient');
    expect(schemeRow.schemeName).toBe('RevExt Insurance Co');
    expect(schemeRow.totalBilled).toBe(20000);
  });
});
