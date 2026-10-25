// A foreign-currency bill paid at the counter clears its receivable exactly — for the WHOLE bill,
// items added after it was raised included — and only a real rate difference goes to FX (5610).
// It used to clear only the share booked when the bill was created, leaving the rest open and
// posting it as an FX loss.
import { AFTER, call, q, done, newPatient, serviceByName, line, ensureShift, ledgerFor, check, summary, today } from './lib.mjs';

const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const BOOKED = 2700, TODAY = 2799.37;
await q("DELETE FROM exchange_rates WHERE notes = 't30'"); // left by an earlier run that crashed
const rates = await q(`INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, is_active, notes, created_at, updated_at)
  VALUES (gen_random_uuid(), 1, 'USD', 'SSP', $1, $2, true, 't30', NOW(), NOW()), (gen_random_uuid(), 1, 'USD', 'SSP', $3, $4, true, 't30', NOW(), NOW()) RETURNING id`,
  [BOOKED, yesterday, TODAY, today]);
const svc = { consult: await serviceByName('Consultation - General Practitioner'), lab: await serviceByName('Complete Blood Count') };
const USD = { consult: 7.35, lab: 5.15 };
const net = (rows, code) => rows.find((r) => r.code === code)?.net || 0;
const near = (a, b, tol = 0.011) => Math.abs(a - b) < tol;
const payUSD = (billId, amount) => call(AFTER, 'POST', `/patient-bills/${billId}/payments`, { amount, payment_method: 'cash', payment_date: today, received_by: 'T30', currency: 'USD' });

const code = `T30${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
try {
  await ensureShift(AFTER);
  const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T30 ${code}`, scheme_type: 'corporate', is_insurance: true,
    currency: 'USD', is_credit_allowed: true, payment_terms: 'net_30', has_copay: false, default_copay_percentage: 0 });
  const schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
  for (const [k, s] of Object.entries(svc)) {
    const r = await call(AFTER, 'POST', `/schemes/${schemeId}/service-pricing`, { clinic_id: 1, service_id: s.id, scheme_price: USD[k], scheme_currency: 'USD', effective_from: yesterday });
    if (!r.ok) throw new Error('pricing: ' + JSON.stringify(r.body));
  }
  // A USD bill raised on `billDate` with the consultation, the lab test added afterwards.
  const usdBill = async (billDate) => {
    const pt = await newPatient(AFTER, 'T30');
    await call(AFTER, 'POST', `/schemes/patient-schemes/${pt.id}`, { scheme_id: schemeId, clinic_id: 1, member_number: 'T30-1' });
    const r = await call(AFTER, 'POST', '/patient-bills', { patient_id: pt.id, patient_name: `${pt.first_name} ${pt.last_name}`, clinic_id: 1, created_by: 'T30',
      bill_date: billDate, services: [line(svc.consult)], total_amount: Number(svc.consult.price), paid_amount: 0, status: 'pending', scheme_id: schemeId });
    if (!r.ok) throw new Error('bill: ' + JSON.stringify(r.body));
    const a = await call(AFTER, 'PUT', `/patient-bills/${r.body.id}/add-services`, { services: [line(svc.lab)], scheme_id: schemeId });
    if (!a.ok) throw new Error('add-services: ' + JSON.stringify(a.body));
    return r.body.id;
  };
  const total = USD.consult + USD.lab;

  // 1. Booked and paid at today's rate, in two payments: clears exactly, no FX.
  {
    const id = await usdBill(today);
    const p1 = await payUSD(id, 5); const p2 = await payUSD(id, Math.round((total - 5) * 100) / 100);
    const l = await ledgerFor([id]);
    check('USD bill + added item paid in USD (two payments): payments accepted', p1.ok && p2.ok, JSON.stringify({ p1: p1.status, p2: p2.status, e: p2.body?.error || p1.body?.error }));
    check('…receivable 1210 clears to exactly 0', net(l, '1210') === 0, JSON.stringify(l));
    check('…no FX posted (same rate)', net(l, '5610') === 0);
    check('…cash received = total × rate', near(net(l, '1100') + net(l, '1105'), Math.round(total * TODAY * 100) / 100), JSON.stringify(l));
  }

  // 2. Booked yesterday at 2,700, added to, paid today at 2,799.37: receivable clears, FX = the real difference.
  {
    const id = await usdBill(yesterday);
    const [b] = await q('SELECT exchange_rate::float r, base_currency_total::float b FROM patient_bills WHERE id = $1', [id]);
    check('bill raised yesterday: booked at yesterday\'s rate, added item too', b.r === BOOKED && near(b.b, total * BOOKED), JSON.stringify(b));
    const p = await payUSD(id, total);
    const l = await ledgerFor([id]);
    const gain = Math.round(total * (TODAY - BOOKED) * 100) / 100;
    check('…paid in full today: payment accepted', p.ok, JSON.stringify({ s: p.status, e: p.body?.error }));
    check('…receivable 1210 clears to exactly 0', net(l, '1210') === 0, JSON.stringify(l));
    check(`…FX gain on 5610 = ${total} × (${TODAY} − ${BOOKED}) = ${gain}`, near(-net(l, '5610'), gain), JSON.stringify(l));
  }

  // 3. SSP bill with an added item, paid in SSP: unchanged behaviour.
  {
    const pt = await newPatient(AFTER, 'T30');
    const r = await call(AFTER, 'POST', '/patient-bills', { patient_id: pt.id, patient_name: 'T30 cash', clinic_id: 1, created_by: 'T30', bill_date: today,
      services: [line(svc.consult)], total_amount: Number(svc.consult.price), paid_amount: 0, status: 'pending' });
    await call(AFTER, 'PUT', `/patient-bills/${r.body.id}/add-services`, { services: [line(svc.lab)] });
    const sspTotal = Number(svc.consult.price) + Number(svc.lab.price);
    const p = await call(AFTER, 'POST', `/patient-bills/${r.body.id}/payments`, { amount: sspTotal, payment_method: 'cash', payment_date: today, received_by: 'T30', currency: 'SSP' });
    const l = await ledgerFor([r.body.id]);
    check('SSP bill + added item paid in SSP: receivable 1200 clears to 0, no FX', p.ok && net(l, '1200') === 0 && net(l, '5610') === 0, JSON.stringify({ s: p.status, l }));
  }
} finally {
  await q('DELETE FROM exchange_rates WHERE id = ANY($1)', [rates.map((r) => r.id)]);
}
await done();
process.exit(summary() ? 1 : 0);
