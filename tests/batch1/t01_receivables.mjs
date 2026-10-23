// #1 patient_receivables retired: payments/top-ups no longer write it; endpoints gone.
import { BEFORE, AFTER, call, q, done, newPatient, serviceByName, newBill, line, ensureShift, pay, check, summary } from './lib.mjs';

const consult = await serviceByName('Consultation - General Practitioner');
const lab = await serviceByName('Complete Blood Count');

async function scenario(base) {
  await ensureShift(base);
  const p = await newPatient(base, 'T01');
  const bill = await newBill(base, p, [line(consult)]);
  const add = await call(base, 'PUT', `/patient-bills/${bill.id}/add-services`, { services: [line(lab)] });
  const payment = await pay(base, bill.id, 20000);
  const [b] = await q('SELECT total_amount::float, paid_amount::float, balance_amount::float FROM patient_bills WHERE id = $1', [bill.id]);
  const rr = await q('SELECT amount_due::float, amount_paid::float, status::text FROM patient_receivables WHERE bill_id::text = $1', [bill.id]);
  const endpoint = await call(base, 'GET', '/accounting/patient-receivables?clinic_id=1');
  const aging = await call(base, 'GET', '/accounting/patient-receivables/aging?clinic_id=1');
  return { addOk: add.ok, payOk: payment.ok, bill: b, rr, endpoint: endpoint.status, aging: aging.status };
}

const before = await scenario(BEFORE);
console.log('BEFORE', JSON.stringify(before));
check('before: bill paid 20,000 but patient_receivables still shows amount_paid 0 (sync failed)',
  before.rr.length === 1 && before.rr[0].amount_paid === 0 && before.bill.paid_amount === 20000,
  JSON.stringify(before.rr[0]));

const after = await scenario(AFTER);
console.log('AFTER ', JSON.stringify(after));
check('after: add-services and payment still succeed', after.addOk && after.payOk);
check('after: no patient_receivables row written for the new bill', after.rr.length === 0);
check('after: bill totals correct (45,000 billed, 20,000 paid, 25,000 open)',
  after.bill.total_amount === 45000 && after.bill.paid_amount === 20000 && after.bill.balance_amount === 25000);
check('after: /accounting/patient-receivables removed', after.endpoint === 404, `status ${after.endpoint}`);
check('after: /accounting/patient-receivables/aging removed', after.aging === 404, `status ${after.aging}`);
const kept = await q("SELECT to_regclass('tenant_preview.patient_receivables') IS NOT NULL AS exists");
check('table kept (not dropped)', kept[0].exists);

await done();
process.exit(summary() ? 1 : 0);
