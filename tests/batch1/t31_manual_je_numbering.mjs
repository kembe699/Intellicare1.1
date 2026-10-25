// A manual journal entry takes its number from the same allocator as the automatic ones (cash
// payments, transfers). It used to take "highest existing + 1", leaving the allocator behind, so
// the next cash payment was handed a number already in use and failed on the unique index.
import { AFTER, call, q, done, newPatient, newBill, serviceByName, line, ensureShift, pay, check, summary, today } from './lib.mjs';

const [cash] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1100' AND clinic_id = 1");
const [bank] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1110' AND clinic_id = 1");
const svc = await serviceByName('Consultation - General Practitioner');
await ensureShift(AFTER);

const numbers = [];
for (let i = 0; i < 2; i++) {
  const je = await call(AFTER, 'POST', '/accounting/journal-entries', { clinic_id: 1, entry_date: today, description: `T31 manual ${i}`, reference: 'T31',
    lines: [{ account_id: bank.id, debit_amount: 1, credit_amount: 0, description: 'T31' }, { account_id: cash.id, debit_amount: 0, credit_amount: 1, description: 'T31' }] });
  check(`manual journal entry ${i + 1} created`, je.status === 201, JSON.stringify({ s: je.status, e: je.body?.error }));
  numbers.push(je.body.je_number);
}
const pt = await newPatient(AFTER, 'T31');
const bill = await newBill(AFTER, pt, [line(svc)]);
const p = await pay(AFTER, bill.id, Number(svc.price));
check('a cash payment right after manual entries posts (no number clash)', p.ok, JSON.stringify({ s: p.status, e: p.body?.error }));
const [paid] = await q(`SELECT je_number FROM journal_entries WHERE description LIKE $1 ORDER BY created_at DESC LIMIT 1`, [`%${bill.id}%`]);
numbers.push(paid?.je_number);
check('all three numbers distinct and in sequence', new Set(numbers).size === 3 && numbers.every(Boolean)
  && numbers.map((n) => +n.split('-')[2]).every((n, i, a) => i === 0 || n === a[i - 1] + 1), JSON.stringify(numbers));

await q("DELETE FROM journal_entry_lines WHERE je_id IN (SELECT id FROM journal_entries WHERE reference = 'T31')");
await q("DELETE FROM journal_entries WHERE reference = 'T31'");
await done();
process.exit(summary() ? 1 : 0);
