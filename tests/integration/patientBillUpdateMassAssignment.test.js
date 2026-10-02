/**
 * Security audit finding: PUT /:billId passed req.body to
 * currentBill.update() nearly verbatim — only branch_id was reset for
 * non-admins. A caller holding only bills.financial_action could set
 * paid_amount/status directly with no receipt ever created (fabricating a
 * "paid" bill for free), or silently reassign clinic_id/patient_id/
 * patient_name/scheme_id/bill_number/visit_id/invoice_id. No frontend caller
 * of this bare route exists anywhere in src/pages — every page that edits a
 * bill goes through add-services/payments/void-item instead — so there was
 * no legitimate use case requiring those fields stay settable here.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let PatientBill;
let updateHandler;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function makeBill(billNumber) {
  return withTenant(() => PatientBill.create({
    clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'MassAssign Test Patient',
    bill_number: billNumber, total_amount: 10000, paid_amount: 0, balance_amount: 10000,
    status: 'pending', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP',
    services: [{ serviceName: 'Consultation', quantity: 1, unitPrice: 10000, totalPrice: 10000 }],
  }));
}

function req(billId, body) {
  return {
    params: { billId },
    body,
    user: { id: 1, displayName: 'Mass Assign Tester', role: 'accountant' },
    branchContext: { isAdmin: false },
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  PatientBill = testConn.models.PatientBill;

  const billsRouter = require('../../src/server/routes/patientBills');
  const layer = billsRouter.stack.find((l) => l.route && l.route.path === '/:billId' && l.route.methods.put);
  updateHandler = layer.route.stack[layer.route.stack.length - 1].handle;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'MASSASSIGN-%'`);
  } catch (e) { console.warn('patientBillUpdateMassAssignment cleanup failed (non-fatal):', e.message); }
});

describe('PUT /:billId only updates a safe field whitelist', () => {
  test('cannot fabricate paid_amount/status directly with no receipt', async () => {
    const bill = await makeBill(`MASSASSIGN-${Date.now()}`);
    const res = mockRes();
    await withTenant(() => updateHandler(req(bill.id, { paid_amount: 10000, status: 'paid' }), res));
    expect(res.statusCode).toBe(200);

    const reloaded = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(parseFloat(reloaded.paid_amount)).toBe(0);
    expect(reloaded.status).toBe('pending');
  });

  test('cannot reassign clinic_id, patient_id, patient_name, or bill_number', async () => {
    const bill = await makeBill(`MASSASSIGN-${Date.now()}`);
    const otherPatientId = uuid();
    const res = mockRes();
    await withTenant(() => updateHandler(req(bill.id, {
      clinic_id: 999, patient_id: otherPatientId, patient_name: 'Someone Else', bill_number: 'HIJACKED-0001',
    }), res));
    expect(res.statusCode).toBe(200);

    const reloaded = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(reloaded.clinic_id).toBe(TEST_CLINIC_ID);
    expect(reloaded.patient_id).not.toBe(otherPatientId);
    expect(reloaded.patient_name).toBe('MassAssign Test Patient');
    expect(reloaded.bill_number).not.toBe('HIJACKED-0001');
  });

  test('legitimate fields (total_amount, services, notes) still update, with balance/status correctly recomputed from the bill\'s own paid_amount', async () => {
    const bill = await makeBill(`MASSASSIGN-${Date.now()}`);
    const res = mockRes();
    await withTenant(() => updateHandler(req(bill.id, {
      total_amount: 15000,
      services: [{ serviceName: 'Consultation', quantity: 1, unitPrice: 15000, totalPrice: 15000 }],
      notes: 'corrected total',
    }), res));
    expect(res.statusCode).toBe(200);

    const reloaded = await withTenant(() => PatientBill.findByPk(bill.id));
    expect(parseFloat(reloaded.total_amount)).toBe(15000);
    expect(parseFloat(reloaded.balance_amount)).toBe(15000);
    expect(reloaded.status).toBe('pending');
    expect(reloaded.notes).toBe('corrected total');
  });
});
