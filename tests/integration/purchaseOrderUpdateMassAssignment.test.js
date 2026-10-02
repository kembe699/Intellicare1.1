/**
 * Security audit finding: PUT /:id spread req.body into order.update()
 * near-verbatim, and when both `status` and `signature` were present it
 * dynamically wrote `${status}_signature`/`${status}_signed_by`/
 * `${status}_signed_at` from client-supplied values. A caller holding only
 * procurement.purchase_orders.write — the same privilege every procurement
 * clerk has — could set status: 'approved' with a forged signedBy name,
 * completely bypassing the real, properly-gated approval chain
 * (POST /purchase-orders/:id/status in procurement.js, which requires the
 * specific po_check/po_approve/po_authorize grant for each step).
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let PurchaseOrder;
let updateHandler;
let poId;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function req(body) {
  return {
    params: { id: poId },
    body,
    user: { id: 1, displayName: 'PO Mass Assign Tester', role: 'procurement' },
    branchContext: { isAdmin: false },
  };
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  PurchaseOrder = testConn.models.PurchaseOrder;

  const poRouter = require('../../src/server/routes/purchase-orders');
  const layer = poRouter.stack.find((l) => l.route && l.route.path === '/:id' && l.route.methods.put);
  updateHandler = layer.route.stack[layer.route.stack.length - 1].handle;

  const order = await withTenant(() => PurchaseOrder.create({
    po_number: `POMASSASSIGN-${Date.now()}`, supplier_id: 1, order_date: new Date(),
    total_amount: 5000, status: 'draft', clinic_id: TEST_CLINIC_ID,
  }));
  poId = order.id;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM purchase_orders WHERE po_number LIKE 'POMASSASSIGN-%'`);
  } catch (e) { console.warn('purchaseOrderUpdateMassAssignment cleanup failed (non-fatal):', e.message); }
});

describe('PUT /purchase-orders/:id only updates a safe field whitelist', () => {
  test('cannot self-approve by setting status + a forged signature directly', async () => {
    const res = mockRes();
    await withTenant(() => updateHandler(req({
      status: 'approved', signature: 'data:image/png;base64,fake', signedBy: 'Forged Approver', signedAt: new Date().toISOString(),
    }), res));
    expect(res.statusCode).toBe(200);

    const reloaded = await withTenant(() => PurchaseOrder.findByPk(poId));
    expect(reloaded.status).toBe('draft');
    expect(reloaded.approved_signed_by).toBeFalsy();
    expect(reloaded.approved_signature).toBeFalsy();
  });

  test('cannot set check/authorized signature fields directly either', async () => {
    const res = mockRes();
    await withTenant(() => updateHandler(req({
      check_signed_by: 'Forged Checker', check_signature: 'fake', authorized_signed_by: 'Forged Authorizer',
    }), res));
    expect(res.statusCode).toBe(200);

    const reloaded = await withTenant(() => PurchaseOrder.findByPk(poId));
    expect(reloaded.check_signed_by).toBeFalsy();
    expect(reloaded.authorized_signed_by).toBeFalsy();
  });

  test('legitimate fields (supplier_id, notes) still update', async () => {
    const res = mockRes();
    await withTenant(() => updateHandler(req({
      notes: 'urgent order', supplier_id: 2,
    }), res));
    expect(res.statusCode).toBe(200);

    const reloaded = await withTenant(() => PurchaseOrder.findByPk(poId));
    expect(reloaded.notes).toBe('urgent order');
    expect(reloaded.supplier_id).toBe(2);
  });
});
