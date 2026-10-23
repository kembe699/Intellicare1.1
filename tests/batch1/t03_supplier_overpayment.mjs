// #3 Supplier bill payments above the outstanding balance are refused.
import { BEFORE, AFTER, call, q, done, today, check, summary } from './lib.mjs';

const [supplier] = await q("SELECT id FROM suppliers WHERE name = 'Juba Medical Supplies Ltd' LIMIT 1");
const [cash] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1105' LIMIT 1");

async function approvedBill(base, amount) {
  const r = await call(base, 'POST', '/procurement/purchase-orders/quick-bill', { supplier_id: supplier.id, amount, description: 'T03 test bill', currency: 'SSP' });
  if (!r.ok) throw new Error('quick bill ' + JSON.stringify(r.body));
  const poId = r.body.id;
  for (let i = 0; i < 3; i++) await call(base, 'POST', `/daily-expenses/supplier-bills/${poId}/approve`, { approved_by_title: 'Admin', notes: 'ok' });
  return poId;
}
const payBill = (base, poId, amount) => call(base, 'POST', '/daily-expenses/supplier-bill-payment', {
  po_id: poId, amount_paid: amount, account_id: cash.id, payment_date: today, payment_method: 'cash', supplier_name: 'Juba Medical Supplies Ltd',
});
const paid = async (poId) => (await q('SELECT paid_amount::float AS p FROM purchase_orders WHERE id = $1', [poId]))[0].p;

const b1 = await approvedBill(BEFORE, 1000);
const over = await payBill(BEFORE, b1, 1500);
check('before: paying 1,500 against a 1,000 bill is accepted', over.ok && (await paid(b1)) === 1500, `status ${over.status}, paid_amount ${await paid(b1)}`);

const b2 = await approvedBill(AFTER, 1000);
const r1 = await payBill(AFTER, b2, 1500);
check('after: 1,500 against a 1,000 bill refused (400) with a clear message', r1.status === 400 && /more than the SSP 1,000.00 still outstanding/.test(r1.body.error), r1.body.error);
check('after: nothing was recorded for the refused payment', (await paid(b2)) === 0);
const r2 = await payBill(AFTER, b2, 600);
check('after: part-payment of 600 accepted', r2.ok && (await paid(b2)) === 600);
const r3 = await payBill(AFTER, b2, 500);
check('after: 500 refused when only 400 is outstanding', r3.status === 400 && r3.body.outstanding === 400, r3.body.error);
const r4 = await payBill(AFTER, b2, 400);
check('after: exact remaining 400 accepted, bill fully paid', r4.ok && (await paid(b2)) === 1000);
const r5 = await payBill(AFTER, b2, 1);
check('after: further payment on a fully paid bill refused', r5.status === 400 && /already fully paid/.test(r5.body.error), r5.body.error);

await done();
process.exit(summary() ? 1 : 0);
