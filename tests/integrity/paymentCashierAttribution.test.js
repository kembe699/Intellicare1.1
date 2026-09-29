/**
 * B4: POST /:billId/payments used to take cashier_id/cashier_name straight
 * from the request body (req.body.cashierId / req.body.cashierName) when
 * building the receipt, the audit log entry, and the response — even though
 * the route already independently verifies an open CashierShift for the
 * AUTHENTICATED user (req.user.id) just above. That gap meant whoever is
 * actually logged in and holding the open shift could submit a payment that
 * records a completely different person as having taken it, breaking
 * cashier reconciliation and the audit trail for whoever it's wrongly
 * attributed to.
 *
 * This app has no HTTP-level test harness (no supertest run against a real
 * app instance) — matching the convention already used for patientReferrals
 * .test.js, the fix is verified by reading the route source directly: the
 * payment handler must never read cashier identity from req.body, and must
 * always source it from req.user (the same identity the CashierShift check
 * itself trusts) or the pre-resolved `userId` local it's assigned to.
 */
const fs = require('fs');
const path = require('path');

const routeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../src/server/routes/patientBills.js'),
  'utf8'
);

function paymentsHandlerSource() {
  const start = routeSrc.indexOf("router.post('/:billId/payments'");
  expect(start).toBeGreaterThan(-1); // route must still exist under this exact path
  // Up to the next top-level route registration, so this doesn't accidentally
  // also match cashier-identity code belonging to a different endpoint.
  const nextRouteOffset = routeSrc.indexOf("\nrouter.", start + 1);
  return routeSrc.slice(start, nextRouteOffset === -1 ? routeSrc.length : nextRouteOffset);
}

describe('B4: payment cashier attribution comes from the authenticated session, not the request body', () => {
  const handlerSrc = paymentsHandlerSource();

  test('the handler still validates against an authenticated user (req.user.id) before anything else', () => {
    expect(handlerSrc).toMatch(/const userId = req\.user\?\.id/);
    expect(handlerSrc).toMatch(/cashier_id:\s*userId/);
  });

  test('cashier_id is never read from the request body anywhere in this handler', () => {
    expect(handlerSrc).not.toMatch(/req\.body\.cashierId/);
    expect(handlerSrc).not.toMatch(/req\.body\.cashier_id/);
    expect(handlerSrc).not.toMatch(/paymentData\.cashier_id\b/);
  });

  test('cashier_name is sourced from req.user, never from the request body', () => {
    expect(handlerSrc).not.toMatch(/req\.body\.cashierName/);
    expect(handlerSrc).not.toMatch(/req\.body\.cashier_name/);
    expect(handlerSrc).not.toMatch(/paymentData\.cashier_name\b/);
    // Every cashier_name assignment in this handler must resolve through req.user.
    const cashierNameAssignments = handlerSrc.match(/cashier_name:\s*[^,\n]+/g) || [];
    expect(cashierNameAssignments.length).toBeGreaterThan(0);
    for (const assignment of cashierNameAssignments) {
      expect(assignment).toMatch(/req\.user/);
    }
  });

  test('the audit log entry for a payment attributes user_id/user_name to req.user, not the body', () => {
    const auditCallIdx = handlerSrc.indexOf("action: 'PAYMENT_RECORDED'");
    expect(auditCallIdx).toBeGreaterThan(-1);
    const auditCallSrc = handlerSrc.slice(Math.max(0, auditCallIdx - 300), auditCallIdx);
    expect(auditCallSrc).toMatch(/user_id:\s*userId/);
    expect(auditCallSrc).toMatch(/user_name:\s*req\.user/);
  });
});
