// An item the patient's scheme doesn't price: the rejection names it (code NOT_PRICED_UNDER_SCHEME),
// and billing it as cash puts it on a separate cash bill at the normal price — the insurance bill
// is untouched, a second cash item reuses that cash bill, and /active finds each bill by mode.
import { AFTER, call, q, done, newPatient, serviceByName, check, summary } from './lib.mjs';

const covered = await serviceByName('Consultation - General Practitioner');
const [uncovered] = await q("SELECT id, service_name, price FROM services WHERE id <> $1 AND COALESCE(is_active, true) AND price > 0 ORDER BY service_name LIMIT 1", [covered.id]);
const code = `T24${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T24 Insurer ${code}`, scheme_type: 'corporate', is_insurance: true, currency: 'SSP' });
const schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
await q("INSERT INTO scheme_service_pricing (id, clinic_id, scheme_id, service_id, scheme_price, scheme_currency, is_active, effective_from) VALUES (gen_random_uuid()::text, 1, $1, $2, 15000, 'SSP', true, CURRENT_DATE)", [schemeId, covered.id]);
const pt = await newPatient(AFTER, 'T24');
await q('UPDATE patients SET default_scheme_id = $2 WHERE id = $1', [pt.id, schemeId]);
const name = `${pt.first_name} ${pt.last_name}`;
const line = (s, p) => ({ serviceId: s.id, serviceName: s.service_name, quantity: 1, unitPrice: p, totalPrice: p });
const post = (body) => call(AFTER, 'POST', '/patient-bills', { patient_id: pt.id, patient_name: name, clinic_id: 1, bill_date: new Date().toISOString(), status: 'pending', paid_amount: 0, created_by: 'T24', ...body });

const schemeBill = await post({ services: [line(covered, 20000)], total_amount: 20000, scheme_id: schemeId });
check('scheme bill created at the scheme price', schemeBill.ok && Number(schemeBill.body.total_amount) === 15000, JSON.stringify({ s: schemeBill.status, t: schemeBill.body.total_amount, e: schemeBill.body.error }));

const rej = await call(AFTER, 'PUT', `/patient-bills/${schemeBill.body.id}/add-services`, { services: [line(uncovered, Number(uncovered.price))] });
check('uncovered item rejected with NOT_PRICED_UNDER_SCHEME naming it', rej.status === 400 && rej.body.code === 'NOT_PRICED_UNDER_SCHEME' && rej.body.unpriced_items?.includes(uncovered.service_name), JSON.stringify(rej.body));

const cash = await post({ services: [line(uncovered, Number(uncovered.price))], total_amount: Number(uncovered.price), bill_as_cash: true });
const [sb] = await q('SELECT total_amount::float t, scheme_id FROM patient_bills WHERE id = $1', [schemeBill.body.id]);
check('billed as cash: a separate cash bill at the normal price; insurance bill untouched',
  cash.ok && cash.body.id !== schemeBill.body.id && !cash.body.scheme_id && Number(cash.body.total_amount) === Number(uncovered.price) && sb.t === 15000,
  JSON.stringify({ s: cash.status, e: cash.body.error, id: cash.body.id, scheme: cash.body.scheme_id, t: cash.body.total_amount, schemeTotal: sb.t }));

const cash2 = await post({ services: [line(uncovered, Number(uncovered.price))], total_amount: Number(uncovered.price), bill_as_cash: true });
check('a second cash item goes on the same cash bill', cash2.ok && cash2.body.id === cash.body.id, JSON.stringify({ first: cash.body.id, second: cash2.body.id }));

const aScheme = await call(AFTER, 'GET', `/patient-bills/active/${pt.id}/1?scheme_id=${schemeId}`);
const aCash = await call(AFTER, 'GET', `/patient-bills/active/${pt.id}/1?mode=cash`);
check('/active finds the insurance bill by scheme and the cash bill by mode', aScheme.body.id === schemeBill.body.id && aCash.body.id === cash.body.id, JSON.stringify({ scheme: aScheme.body.id, cash: aCash.body.id }));

await done();
process.exit(summary() ? 1 : 0);
