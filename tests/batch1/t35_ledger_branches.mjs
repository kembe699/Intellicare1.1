// Every posting path stamps the ledger rows with a branch, so branch-scoped reports see them:
// dispensing, a manual journal entry when posted, and an insurer's claim payment (from the claim's
// bills when the claim itself has none). The backfill script gives old branch-less rows their
// document's branch.
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { AFTER, call, q, done, newPatient, newBill, serviceByName, line, ensureShift, pay, check, summary, today } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const branchesOf = async (where, params) => (await q(`SELECT DISTINCT al.branch_id FROM account_ledger al JOIN general_ledger gl ON gl.id = al.transaction_id WHERE ${where}`, params)).map((r) => r.branch_id);
const consult = await serviceByName('Consultation - General Practitioner');
const [item] = await q("SELECT id, item_name, quantity_on_hand FROM inventory_items WHERE is_active = true ORDER BY item_name LIMIT 1");
await ensureShift(AFTER);

// 1. Dispensing (counter, not billed): revenue and COGS entries carry a branch.
{
  const pt = await newPatient(AFTER, 'T35');
  await q('UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + 10, current_unit_cost = GREATEST(COALESCE(current_unit_cost, 0), 100) WHERE id = $1', [item.id]);
  const d = await call(AFTER, 'POST', '/pharmacy-module/dispensing', { clinic_id: 1, patient_id: pt.id, drug_id: item.id, pharmacist_id: 1, quantity_dispensed: 1, unit_price: 500 });
  const [rec] = await q('SELECT id FROM dispensing_records WHERE patient_id::text = $1', [String(pt.id)]);
  const b = await branchesOf(`gl.reference_id = $1`, [String(rec?.id)]);
  check('dispensing: its ledger rows have a branch', d.ok && b.length > 0 && b.every((x) => x != null), JSON.stringify({ s: d.status, b }));
}

// 2. Manual journal entry, posted: its ledger rows carry the entry's branch.
{
  const [cash] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1100' AND clinic_id = 1");
  const [bank] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1110' AND clinic_id = 1");
  const je = (await call(AFTER, 'POST', '/accounting/journal-entries', { clinic_id: 1, entry_date: today, description: 'T35 manual', reference: 'T35',
    lines: [{ account_id: bank.id, debit_amount: 1, credit_amount: 0 }, { account_id: cash.id, debit_amount: 0, credit_amount: 1 }] })).body;
  for (const step of ['submit', 'approve', 'post']) await call(AFTER, 'POST', `/accounting/journal-entries/${je.id}/${step}`, {});
  const b = await branchesOf(`gl.reference_module = 'journal_entry' AND gl.reference_id = $1`, [String(je.id)]);
  check('manual journal entry: posted rows have a branch', b.length > 0 && b.every((x) => x != null), JSON.stringify(b));
}

// 3. Claim with no branch of its own: the payment takes its bill's branch.
{
  const code = `T35${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T35 ${code}`, scheme_type: 'corporate', is_insurance: true, currency: 'SSP', is_credit_allowed: true });
  const schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;
  await call(AFTER, 'POST', `/schemes/${schemeId}/service-pricing`, { clinic_id: 1, service_id: consult.id, scheme_price: 20000, scheme_currency: 'SSP', effective_from: today });
  const pt = await newPatient(AFTER, 'T35');
  await call(AFTER, 'POST', `/schemes/patient-schemes/${pt.id}`, { scheme_id: schemeId, clinic_id: 1, member_number: 'T35-1' });
  const bill = (await call(AFTER, 'POST', '/patient-bills', { patient_id: pt.id, patient_name: 'T35', clinic_id: 1, created_by: 'T35', bill_date: today, status: 'pending', paid_amount: 0, scheme_id: schemeId, total_amount: 1, services: [line(consult)] })).body;
  const [b] = await q('SELECT * FROM patient_bills WHERE id = $1', [bill.id]);
  const inv = await call(AFTER, 'POST', '/invoices', { bill_id: b.id, patient_id: b.patient_id, patient_name: b.patient_name, clinic_id: 1, amount: Number(b.balance_amount), currency: b.bill_currency || 'SSP',
    payment_terms: 30, services: typeof b.services === 'string' ? JSON.parse(b.services) : b.services, scheme_id: schemeId });
  const cl = await call(AFTER, 'POST', '/insurance-claims', { scheme_id: schemeId, date_from: today, date_to: today, invoice_ids: [inv.body.data?.id || inv.body.id], claim_amount: Number(b.total_amount) });
  const claimId = cl.body.data?.id || cl.body.id;
  await q('UPDATE insurance_batch_claims SET branch_id = NULL WHERE id = $1', [claimId]);
  for (const status of ['submitted', 'accepted']) await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status });
  const bank = ((await call(AFTER, 'GET', `/insurance-claims/${claimId}/deposit-accounts`)).body.data || []).find((x) => x.account_code === '1110');
  const paid = await call(AFTER, 'PUT', `/insurance-claims/${claimId}/status`, { status: 'paid', paid_amount: Number(b.total_amount), deposit_account_id: bank?.id });
  const got = await branchesOf(`gl.reference_module = 'insurance_claims' AND gl.reference_id = $1`, [String(claimId)]);
  check("claim with no branch: payment rows take the bill's branch", paid.ok && got.length === 1 && String(got[0]) === String(b.branch_id), JSON.stringify({ s: paid.status, got, bill: b.branch_id }));
}

// 4. Backfill: a bill's rows stripped of their branch get the bill's branch back.
{
  const bill = await newBill(AFTER, await newPatient(AFTER, 'T35'), [line(consult)]);
  const [b] = await q('SELECT branch_id FROM patient_bills WHERE id = $1', [bill.id]);
  await q(`UPDATE account_ledger SET branch_id = NULL WHERE transaction_id IN (SELECT id FROM general_ledger WHERE reference_id = $1)`, [String(bill.id)]);
  const env = { ...process.env, DATABASE_URL: 'postgres://preview:preview_pass@localhost:5435/intellicare_preview' };
  const dry = execFileSync('node', ['src/server/scripts/backfillLedgerBranches.js', '--schema', 'tenant_preview'], { cwd: ROOT, env, encoding: 'utf8' });
  const stillNull = (await branchesOf('gl.reference_id = $1', [String(bill.id)])).every((x) => x == null);
  check('backfill dry run reports the rows and changes nothing', /patient_billing/.test(dry) && /Dry run/.test(dry) && stillNull, dry.split('\n').find((l) => /tenant_preview/.test(l)));
  execFileSync('node', ['src/server/scripts/backfillLedgerBranches.js', '--schema', 'tenant_preview', '--apply'], { cwd: ROOT, env, encoding: 'utf8' });
  const after = await branchesOf('gl.reference_id = $1', [String(bill.id)]);
  check("backfill --apply: rows get the bill's branch", after.length === 1 && String(after[0]) === String(b.branch_id), JSON.stringify({ after, bill: b.branch_id }));
}

await q("DELETE FROM journal_entry_lines WHERE je_id IN (SELECT id FROM journal_entries WHERE reference = 'T35')");
await done();
process.exit(summary() ? 1 : 0);
