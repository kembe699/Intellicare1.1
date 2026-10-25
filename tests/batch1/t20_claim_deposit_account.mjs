// Recording an insurer's claim payment asks which cash/bank account the money landed in:
// that account is debited and the insurance receivable credited.
import { AFTER, call, q, done, newPatient, check, summary } from './lib.mjs';

const acct = async (code) => (await q('SELECT id FROM chart_of_accounts WHERE account_code = $1', [code]))[0].id;
const lines = (claimId) => q(`
  SELECT coa.account_code code, li.debit_amount::float dr, li.credit_amount::float cr
  FROM gl_line_items li JOIN general_ledger gl ON gl.id = li.gl_id JOIN chart_of_accounts coa ON coa.id = li.account_id
  WHERE gl.reference_module = 'insurance_claims' AND gl.reference_id::text = $1 ORDER BY gl.created_at, li.debit_amount DESC`, [claimId]);
const claimRow = async (id) => (await q('SELECT status, paid_amount::float p FROM insurance_batch_claims WHERE id = $1', [id]))[0];

const code = `T20${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
const s = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T20 Insurer ${code}`, scheme_type: 'corporate', is_insurance: true, currency: 'SSP' });
const schemeId = s.body.id || s.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
const pt = await newPatient(AFTER, 'T20');
const inv = await call(AFTER, 'POST', '/invoices', { patient_id: pt.id, patient_name: `${pt.first_name} ${pt.last_name}`, clinic_id: 1, amount: 30000, currency: 'SSP', scheme_id: schemeId, scheme_name: 'T20' });
const claim = await call(AFTER, 'POST', '/insurance-claims', { scheme_id: schemeId, invoice_ids: [inv.body.data.id], claim_amount: 30000 });
const claimId = claim.body.data?.id || claim.body.id;
for (const st of ['submitted', 'accepted']) await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status: st });

const list = await call(AFTER, 'GET', `/insurance-claims/${claimId}/deposit-accounts`);
const codes = (list.body.data || []).map((a) => a.account_code);
check('deposit accounts: cash and bank listed, receivables not', list.ok && codes.includes('1110') && codes.includes('1105') && !codes.some((c) => c.startsWith('12')), codes.join(','));

const none = await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: 10000 });
check('no account chosen: refused, claim unchanged', none.status === 400 && (await claimRow(claimId)).status === 'accepted' && (await lines(claimId)).length === 0, `${none.status} ${none.body.error}`);

const bad = await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: 10000, deposit_account_id: await acct('1210') });
check('receivable chosen as the deposit account: refused', bad.status === 400 && (await claimRow(claimId)).status === 'accepted', `${bad.status} ${bad.body.error}`);

const part = await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: 10000, deposit_account_id: await acct('1105') });
const l1 = await lines(claimId);
check('part payment into Cash at Hand: Dr 1105 10,000 / Cr 1210 10,000, claim partially paid',
  part.ok && (await claimRow(claimId)).status === 'partially_paid'
  && l1.some((l) => l.code === '1105' && l.dr === 10000) && l1.some((l) => l.code === '1210' && l.cr === 10000) && !l1.some((l) => l.code === '1110'),
  JSON.stringify({ s: part.status, e: part.body.error, l1 }));

const rest = await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: 20000, deposit_account_id: await acct('1110') });
const l2 = await lines(claimId);
check('balance into the main bank: Dr 1110 20,000, claim paid', rest.ok && (await claimRow(claimId)).status === 'paid' && l2.some((l) => l.code === '1110' && l.dr === 20000), JSON.stringify({ s: rest.status, e: rest.body.error, l2 }));

await done();
process.exit(summary() ? 1 : 0);
