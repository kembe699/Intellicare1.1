// #5 Reports and defaults use the tenant's base currency, not a hard-coded SSP.
// Switches the preview tenant's base to USD for the duration of the test (restored in finally).
import { randomUUID } from 'crypto';
import { BEFORE, AFTER, call, q, done, newPatient, check, summary } from './lib.mjs';

const day = `20${31 + Math.floor(Math.random() * 60)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
const [patient] = await q('SELECT id, first_name, last_name FROM patients LIMIT 1');
const billId = randomUUID();

async function revenueByItem(base) {
  const r = await call(base, 'GET', `/reports-v2/revenue?groupBy=item&dateFrom=${day}&dateTo=${day}&clinic_id=1`);
  const rows = r.body?.rows || r.body?.data || r.body?.groups || [];
  const row = rows.find((x) => (x.group_label || x.label) === 'T05 Scheme Item');
  return row ? Number(row.total_collected ?? row.totalCollected) : null;
}

async function depositCurrency(base) {
  const p = await newPatient(base, 'T05');
  const r = await call(base, 'POST', '/patient-deposits', { patient_id: p.id, patient_name: `${p.first_name} ${p.last_name}`, amount: 50, payment_method: 'cash', clinic_id: 1 });
  const [row] = await q('SELECT currency FROM patient_deposits WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 1', [p.id]);
  return { status: r.status, error: r.body?.error, currency: row?.currency };
}

try {
  await q(`INSERT INTO patient_bills (id, bill_number, patient_id, patient_name, clinic_id, total_amount, paid_amount, balance_amount,
             status, bill_date, due_date, services, scheme_id, bill_currency, created_by, branch_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 1, 280000, 280000, 0, 'paid', $5, $5, $6, $7, 'SSP', 'T05 fixture', 1, NOW(), NOW())`,
    [billId, `T05-${billId.slice(0, 8)}`, patient.id, `${patient.first_name} ${patient.last_name}`, day,
     JSON.stringify([{ serviceName: 'T05 Scheme Item', quantity: 1, unitPrice: 280000, totalPrice: 280000 }]), randomUUID()]);
  await q("UPDATE currencies SET is_base_currency = (code = 'USD')");

  const beforeRev = await revenueByItem(BEFORE);
  const afterRev = await revenueByItem(AFTER);
  console.log('revenue by item for an SSP 280,000 scheme bill, base = USD:', { beforeRev, afterRev });
  check('before: SSP 280,000 reported as 280,000 in a USD-base report (treated SSP as base)', beforeRev === 280000, String(beforeRev));
  check('after: converted to the USD base at 2,800 → 100.00', afterRev === 100, String(afterRev));

  const beforeDep = await depositCurrency(BEFORE);
  const afterDep = await depositCurrency(AFTER);
  console.log('deposit with no currency given, base = USD:', { beforeDep, afterDep });
  check('before: deposit with no currency recorded as SSP', beforeDep.currency === 'SSP', JSON.stringify(beforeDep));
  check('after: deposit with no currency recorded in the base currency (USD)', afterDep.status < 300 && afterDep.currency === 'USD', JSON.stringify(afterDep));
} finally {
  await q("UPDATE currencies SET is_base_currency = (code = 'SSP')");
  await q('DELETE FROM patient_bills WHERE id = $1', [billId]);
}

await done();
process.exit(summary() ? 1 : 0);
