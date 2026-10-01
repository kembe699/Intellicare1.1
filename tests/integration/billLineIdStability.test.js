/**
 * B1: proves the actual bug — voiding an unpaid line removes it from the
 * services array (services.splice), shifting every later line's array
 * position. A page that fetched the bill a moment earlier and lets the user
 * pay "the item that was at index 2" would, on stale array-position alone,
 * end up marking the WRONG line as paid once that void has landed first.
 *
 * The fix identifies lines by their own line_id (assigned by ensureLineIds at
 * bill creation and never regenerated) instead of trusting array position.
 * This test builds the exact scenario: create a 3-line bill, note the id of
 * the line at index 2, void the line at index 0 (shifting index 2's line down
 * to index 1), then resolve "pay the line whose id we noted" against the
 * POST-void array — proving it lands on the same line, not on whatever now
 * happens to sit at the stale index 2.
 *
 * Runs against tenant_test, never a real tenant.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');
const { ensureLineIds, normalizeServices } = require('../../src/server/utils/normalizeServices');

const TEST_CLINIC_ID = 1;
const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

let sequelize;
let testConn;
let PatientBill;

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  PatientBill = testConn.models.PatientBill;
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM patient_bills WHERE bill_number LIKE 'LINEID-%'`);
  } catch (e) { console.warn('billLineIdStability cleanup failed (non-fatal):', e.message); }
});

describe('B1: line_id survives an array-shifting void, array position does not', () => {
  test('a line targeted by id before a void is still found correctly after it', async () => {
    const billNumber = `LINEID-${Date.now()}`;
    const services = ensureLineIds([
      { serviceName: 'Consultation', totalPrice: 5000, quantity: 1, unitPrice: 5000 },
      { serviceName: 'Registration', totalPrice: 2000, quantity: 1, unitPrice: 2000 },
      { serviceName: 'Malaria Test', totalPrice: 8000, quantity: 1, unitPrice: 8000 },
    ]);

    const bill = await withTenant(() => PatientBill.create({
      clinic_id: TEST_CLINIC_ID, patient_id: uuid(), patient_name: 'LineId Test Patient',
      bill_number: billNumber, total_amount: 15000, paid_amount: 0, balance_amount: 15000,
      status: 'pending', bill_date: '2026-01-01', created_by: 'test-system', bill_currency: 'SSP',
      services,
    }));

    // The frontend fetches the bill and the user picks "Malaria Test" — at
    // this moment it sits at index 2. Its line_id is captured here, exactly
    // as bill.services[idx]?.line_id is captured in BillDetails.tsx/
    // PatientsBill.tsx before the payment/void request is sent.
    const fetchedServices = normalizeServices((await PatientBill.findByPk(bill.id)).services);
    const targetLineId = fetchedServices[2].line_id;
    expect(fetchedServices[2].serviceName).toBe('Malaria Test');

    // Meanwhile — before that request lands — an unpaid line (index 0,
    // "Consultation") is voided by someone else. void-item's real behavior
    // for an unpaid line is services.splice(index, 1), which is reproduced
    // directly here rather than through the HTTP route (see voidItemCurrency
    // .test.js/receiptReversalCurrency.test.js for why this phase's tests
    // replicate inline route logic rather than go through supertest).
    const afterVoid = normalizeServices((await PatientBill.findByPk(bill.id)).services);
    afterVoid.splice(0, 1);
    await PatientBill.update(
      { services: afterVoid, total_amount: 10000, balance_amount: 10000 },
      { where: { id: bill.id } }
    );

    // "Malaria Test" is now at index 1, not index 2 — the stale index the
    // frontend originally captured no longer points at the same line.
    const postVoidServices = normalizeServices((await PatientBill.findByPk(bill.id)).services);
    expect(postVoidServices).toHaveLength(2);
    expect(postVoidServices[2]).toBeUndefined();
    expect(postVoidServices[1].serviceName).toBe('Malaria Test');

    // This is exactly what patientBills.js's payment/void-item handlers now
    // do: resolve by id against the array read fresh under the row lock,
    // never by trusting whatever index the client also sent.
    const resolvedIndex = postVoidServices.findIndex((s) => s.line_id === targetLineId);
    expect(resolvedIndex).toBe(1); // not the stale 2, and not -1 (lost)
    expect(postVoidServices[resolvedIndex].serviceName).toBe('Malaria Test');

    // The old, buggy behavior (trust the stale index 2 as-is) would have
    // resolved to nothing at all — proving this is a real, not hypothetical, gap.
    expect(postVoidServices[2]).toBeUndefined();
  });
});
