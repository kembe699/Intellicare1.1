// #9 Discounts, write-offs, insurance claim payments and credit notes post inside the same
// transaction as the business change: when the posting can't be made, nothing changes.
// Each scenario makes a required account unavailable (restored in finally).
import { BEFORE, AFTER, call, q, done, newPatient, serviceByName, newBill, line, ensureShift, check, summary } from './lib.mjs';

const consult = await serviceByName('Consultation - General Practitioner');
const setActive = (codes, on) => q('UPDATE chart_of_accounts SET is_active = $2 WHERE account_code = ANY($1)', [codes, on]);
const bill = async (id) => (await q('SELECT total_amount::float t, balance_amount::float b, paid_amount::float p, status::text s FROM patient_bills WHERE id = $1', [id]))[0];
const glCount = async (module, refIds) => (await q('SELECT COUNT(*)::int n FROM general_ledger WHERE reference_module = $1 AND reference_id::text = ANY($2)', [module, refIds]))[0].n;

async function freshBill(base) {
  await ensureShift(base);
  return newBill(base, await newPatient(base, 'T09'), [line(consult)]);
}

async function scheme(base) {
  const code = `T09${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  const r = await call(base, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T09 Insurer ${code}`, scheme_type: 'corporate', is_insurance: true, currency: 'SSP' });
  if (!r.ok) throw new Error('scheme ' + JSON.stringify(r.body));
  return r.body.id || r.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
}

async function scenario(base) {
  const o = {};
  // Discount with no receivable account
  const b1 = await freshBill(base);
  await setActive(['1200', '1210'], false);
  try {
    const r = await call(base, 'POST', `/billing/bills/${b1.id}/discounts`, { discount_type: 'fixed_amount', discount_amount: 2000, reason: 'T09' });
    o.discount = { status: r.status, error: r.body.error, bill: await bill(b1.id), rows: (await q('SELECT COUNT(*)::int n FROM bill_discounts WHERE bill_id::text = $1', [b1.id]))[0].n };
  } finally { await setActive(['1200', '1210'], true); }

  // Write-off with no bad-debt account
  const b2 = await freshBill(base);
  await setActive(['5700'], false);
  try {
    const r = await call(base, 'POST', `/billing/bills/${b2.id}/write-off`, { reason: 'T09' });
    const [wo] = await q('SELECT id FROM bill_write_offs WHERE bill_id::text = $1', [b2.id]);
    o.writeOff = { status: r.status, error: r.body.error, bill: await bill(b2.id), gl: wo ? await glCount('bill_write_off', [wo.id]) : 0, rows: wo ? 1 : 0 };
  } finally { await setActive(['5700'], true); }

  // Credit note with no receivable account
  const b3 = await freshBill(base);
  const cn = await call(base, 'POST', '/billing/credit-notes', { original_bill_id: b3.id, credit_amount: 5000, credit_currency: 'SSP', reason: 'adjustment' });
  await call(base, 'PUT', `/billing/credit-notes/${cn.body.id}/approve`, {});
  await setActive(['1200', '1210'], false);
  try {
    const r = await call(base, 'PUT', `/billing/credit-notes/${cn.body.id}/apply`, {});
    o.creditNote = { status: r.status, error: r.body.error, bill: await bill(b3.id), gl: await glCount('credit_note', [cn.body.id]), noteStatus: (await q('SELECT status FROM credit_notes WHERE id = $1', [cn.body.id]))[0].status };
  } finally { await setActive(['1200', '1210'], true); }

  // Insurance claim payment with no bank/cash account
  const schemeId = await scheme(base);
  const pt = await newPatient(base, 'T09');
  const inv = await call(base, 'POST', '/invoices', { patient_id: pt.id, patient_name: `${pt.first_name} ${pt.last_name}`, clinic_id: 1, amount: 30000, currency: 'SSP', scheme_id: schemeId, scheme_name: 'T09' });
  const claim = await call(base, 'POST', '/insurance-claims', { scheme_id: schemeId, invoice_ids: [inv.body.data.id], claim_amount: 30000 });
  const claimId = claim.body.data?.id || claim.body.id;
  for (const st of ['submitted', 'accepted']) await call(base, 'PUT', `/insurance-claims/${claimId}/status`, { status: st });
  // The payment names the account it landed in (required since claim payments ask for it).
  const bankId = (await q("SELECT id FROM chart_of_accounts WHERE account_code = '1110'"))[0].id;
  await setActive(['1110', '1100'], false);
  try {
    const r = await call(base, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: 30000, deposit_account_id: bankId });
    o.claim = { status: r.status, error: r.body.error, claimStatus: (await q('SELECT status FROM insurance_batch_claims WHERE id = $1', [claimId]))[0].status,
      invoice: (await q('SELECT status, amount_paid::float p FROM invoices WHERE id = $1', [inv.body.data.id]))[0], gl: await glCount('insurance_claims', [claimId]) };
  } finally { await setActive(['1110', '1100'], true); }

  // With accounts available, the same actions post normally
  const b4 = await freshBill(base);
  const okDisc = await call(base, 'POST', `/billing/bills/${b4.id}/discounts`, { discount_type: 'fixed_amount', discount_amount: 2000, reason: 'T09 ok' });
  o.okDiscount = { status: okDisc.status, gl: await glCount('billing_discount', [okDisc.body.id || '']), bill: await bill(b4.id) };
  const okClaim = await call(base, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: 30000, deposit_account_id: bankId });
  o.okClaim = { status: okClaim.status, gl: await glCount('insurance_claims', [claimId]) };
  return o;
}

const before = await scenario(BEFORE);
console.log('BEFORE', JSON.stringify(before));
check('before: discount applied to the bill with no ledger posting', before.discount.status === 200 && before.discount.bill.b === 18000, JSON.stringify(before.discount));
check('before: write-off recorded with no ledger posting', before.writeOff.rows === 1 && before.writeOff.gl === 0, JSON.stringify(before.writeOff));
check('before: claim marked paid (invoice paid) with no ledger posting', before.claim.claimStatus === 'paid' && before.claim.gl === 0, JSON.stringify(before.claim));

const after = await scenario(AFTER);
console.log('AFTER ', JSON.stringify(after));
check('after: discount refused (422) with a clear message, bill and discount rows unchanged',
  after.discount.status === 422 && /Discount not applied/.test(after.discount.error) && after.discount.bill.b === 20000 && after.discount.rows === 0, after.discount.error);
check('after: write-off refused (422), bill still open, no write-off row',
  after.writeOff.status === 422 && after.writeOff.rows === 0 && after.writeOff.bill.b === 20000 && after.writeOff.bill.s !== 'written_off', after.writeOff.error);
check('after: credit note refused (422), bill unchanged, note still approved (not applied)',
  after.creditNote.status === 422 && after.creditNote.bill.t === 20000 && after.creditNote.noteStatus === 'approved' && after.creditNote.gl === 0, after.creditNote.error);
check('after: claim payment refused (inactive bank account), claim not paid, invoice untouched',
  [400, 422].includes(after.claim.status) && after.claim.claimStatus !== 'paid' && after.claim.invoice.p === 0 && after.claim.gl === 0, after.claim.error);
check('after: with accounts available, discount posts in the same step', after.okDiscount.status === 200 && after.okDiscount.gl === 1 && after.okDiscount.bill.b === 18000, JSON.stringify(after.okDiscount));
check('after: with accounts available, claim payment posts', after.okClaim.status === 200 && after.okClaim.gl === 1, JSON.stringify(after.okClaim));

await done();
process.exit(summary() ? 1 : 0);
