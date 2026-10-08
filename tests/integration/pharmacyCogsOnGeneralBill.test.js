/**
 * Cost of Goods Sold now posts for a billed item that matches the pharmacy/
 * inventory catalog even when it was billed through the ordinary billing
 * screens (POST /api/patient-bills, PUT /:billId/add-services) rather than
 * the Pharmacy module's own /dispensing endpoint.
 *
 * Found by auditing a real tenant: drug sales there essentially never went
 * through /dispensing at all — they were billed as plain line items (or
 * bundled into a consultation bill auto-created on queueing), so COGS never
 * posted no matter how correct /dispensing's own logic was. See
 * src/server/utils/pharmacyCogsOnBill.js for the full design/scope notes.
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
let postHandler;
let addServicesHandler;
let inventoryItemIds = [];
let billIds = [];

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

function req(body, overrides) {
  return {
    params: {}, body,
    user: { id: 1, displayName: 'Pharmacy COGS Tester', role: 'admin' },
    branchContext: { isAdmin: true },
    ...overrides,
  };
}

async function ensureAccount(code, name, type, balanceType, subAccountType) {
  const [[existing]] = await sequelize.query(
    `SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = :code`,
    { replacements: { clinicId: TEST_CLINIC_ID, code } }
  );
  if (existing) {
    await sequelize.query(`UPDATE chart_of_accounts SET is_active = true, sub_account_type = :subAccountType WHERE id = :id`,
      { replacements: { id: existing.id, subAccountType: subAccountType || null } });
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

async function ensureInventoryItem(name, category, averageCost) {
  const id = uuid();
  inventoryItemIds.push(id);
  await sequelize.query(
    `INSERT INTO inventory_items (id, clinic_id, item_code, item_name, item_category, average_unit_cost, is_active, created_at, updated_at)
     VALUES (:id, :clinicId, :code, :name, :category, :cost, true, NOW(), NOW())`,
    { replacements: { id, clinicId: TEST_CLINIC_ID, code: `PHARMCOGS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, category, cost: averageCost } }
  );
  return id;
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const billsRouter = require('../../src/server/routes/patientBills');
  postHandler = handlerFor(billsRouter, '/', 'post');
  addServicesHandler = handlerFor(billsRouter, '/:billId/add-services', 'put');

  await ensureAccount('5210', 'Pharmaceutical Cost of Sales', 'expense', 'debit', 'cost_of_sales');
  await ensureAccount('1310', 'Pharmaceutical Inventory', 'asset', 'debit', 'current_asset');
}, 30000);

afterAll(async () => {
  try {
    if (billIds.length > 0) {
      const [gl] = await sequelize.query(`SELECT id FROM general_ledger WHERE reference_id IN (:ids) AND reference_module = 'pharmacy_bill_cogs'`, { replacements: { ids: billIds } });
      const glIds = gl.map(g => g.id);
      if (glIds.length > 0) {
        await sequelize.query(`DELETE FROM gl_line_items WHERE gl_id IN (:ids)`, { replacements: { ids: glIds } });
        await sequelize.query(`DELETE FROM account_ledger WHERE transaction_id IN (:ids)`, { replacements: { ids: glIds } });
        await sequelize.query(`DELETE FROM general_ledger WHERE id IN (:ids)`, { replacements: { ids: glIds } });
      }
      await sequelize.query(`DELETE FROM patient_bills WHERE id IN (:ids)`, { replacements: { ids: billIds } });
    }
    if (inventoryItemIds.length > 0) await sequelize.query(`DELETE FROM inventory_items WHERE id IN (:ids)`, { replacements: { ids: inventoryItemIds } });
  } catch (e) { console.warn('pharmacyCogsOnGeneralBill cleanup failed (non-fatal):', e.message); }
});

describe('POST /api/patient-bills — pharmacy COGS on a plain billed line item', () => {
  test('a billed item matching the inventory catalog posts a real COGS entry (debit 5210, credit 1310)', async () => {
    const itemName = `PharmCogs Test Amoxicillin ${Date.now()}`;
    await ensureInventoryItem(itemName, 'drugs', 150);

    const res = mockRes();
    await withTenant(() => postHandler(req({
      patient_id: uuid(), patient_name: 'Pharm Cogs Patient', clinic_id: TEST_CLINIC_ID, created_by: 'test',
      total_amount: 1500, paid_amount: 0, status: 'pending', bill_date: new Date().toISOString(),
      services: [{ serviceName: itemName, quantity: 10, unitPrice: 150, totalPrice: 1500 }],
    }), res));
    expect(res.statusCode).toBe(200);
    billIds.push(res.body.id);

    const [[ledgerDebit]] = await sequelize.query(
      `SELECT al.debit_amount FROM account_ledger al JOIN chart_of_accounts coa ON coa.id = al.account_id
       WHERE coa.account_code = '5210' AND al.transaction_id IN (SELECT id FROM general_ledger WHERE reference_id = :billId AND reference_module = 'pharmacy_bill_cogs')`,
      { replacements: { billId: res.body.id } }
    );
    expect(ledgerDebit).toBeTruthy();
    expect(parseFloat(ledgerDebit.debit_amount)).toBe(1500); // 150 unit cost * 10 qty

    const [[reloaded]] = await sequelize.query(`SELECT services FROM patient_bills WHERE id = :id`, { replacements: { id: res.body.id } });
    const services = typeof reloaded.services === 'string' ? JSON.parse(reloaded.services) : reloaded.services;
    expect(services[0].cogsPosted).toBe(true);
  });

  test('an item with no cost recorded anywhere posts nothing (never fabricates a cost)', async () => {
    const itemName = `PharmCogs No Cost Item ${Date.now()}`;
    await ensureInventoryItem(itemName, 'drugs', 0);

    const res = mockRes();
    await withTenant(() => postHandler(req({
      patient_id: uuid(), patient_name: 'No Cost Patient', clinic_id: TEST_CLINIC_ID, created_by: 'test',
      total_amount: 500, paid_amount: 0, status: 'pending', bill_date: new Date().toISOString(),
      services: [{ serviceName: itemName, quantity: 1, unitPrice: 500, totalPrice: 500 }],
    }), res));
    expect(res.statusCode).toBe(200);
    billIds.push(res.body.id);

    const [[reloaded]] = await sequelize.query(`SELECT services FROM patient_bills WHERE id = :id`, { replacements: { id: res.body.id } });
    const services = typeof reloaded.services === 'string' ? JSON.parse(reloaded.services) : reloaded.services;
    expect(services[0].cogsPosted).toBeFalsy();
  });

  test('a bill carrying the Pharmacy-direct-sale marker is skipped entirely, even though its item matches the catalog', async () => {
    const itemName = `PharmCogs Direct Sale Item ${Date.now()}`;
    await ensureInventoryItem(itemName, 'drugs', 200);

    const res = mockRes();
    await withTenant(() => postHandler(req({
      patient_id: uuid(), patient_name: 'Direct Sale Patient', clinic_id: TEST_CLINIC_ID, created_by: 'test',
      total_amount: 200, paid_amount: 0, status: 'pending', bill_date: new Date().toISOString(),
      notes: 'Auto-generated from pharmacy direct sale',
      services: [{ serviceName: itemName, quantity: 1, unitPrice: 200, totalPrice: 200 }],
    }), res));
    expect(res.statusCode).toBe(200);
    billIds.push(res.body.id);

    const [[reloaded]] = await sequelize.query(`SELECT services FROM patient_bills WHERE id = :id`, { replacements: { id: res.body.id } });
    const services = typeof reloaded.services === 'string' ? JSON.parse(reloaded.services) : reloaded.services;
    expect(services[0].cogsPosted).toBeFalsy();
  });
});

describe('PUT /:billId/add-services — idempotency', () => {
  test('calling add-services again never double-posts COGS for an already-flagged line', async () => {
    const itemName = `PharmCogs Idempotent Item ${Date.now()}`;
    await ensureInventoryItem(itemName, 'drugs', 100);

    const createRes = mockRes();
    await withTenant(() => postHandler(req({
      patient_id: uuid(), patient_name: 'Idempotent Patient', clinic_id: TEST_CLINIC_ID, created_by: 'test',
      total_amount: 100, paid_amount: 0, status: 'pending', bill_date: new Date().toISOString(),
      services: [{ serviceName: itemName, quantity: 1, unitPrice: 100, totalPrice: 100 }],
    }), createRes));
    expect(createRes.statusCode).toBe(200);
    const billId = createRes.body.id;
    billIds.push(billId);

    // Add an unrelated second service — this re-runs the COGS hook over the
    // bill's full current services, including the already-posted first item.
    const addRes = mockRes();
    await withTenant(() => addServicesHandler(req(
      { services: [{ serviceName: 'Unrelated Consultation', quantity: 1, unitPrice: 5000, totalPrice: 5000 }] },
      { params: { billId } }
    ), addRes));
    expect(addRes.statusCode).toBe(200);

    const [glRows] = await sequelize.query(
      `SELECT id FROM general_ledger WHERE reference_id = :billId AND reference_module = 'pharmacy_bill_cogs'`,
      { replacements: { billId } }
    );
    expect(glRows.length).toBe(1); // still just the one GL entry from bill creation, not a second one
  });
});
