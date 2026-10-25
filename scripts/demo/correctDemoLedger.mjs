// One-off corrections to the demo tenant's books, through the app's own API (journal entries:
// accountant drafts, submits and posts, admin approves; a cash transfer). They undo what code
// bugs (since fixed) posted while the demo was seeded, so a fresh seed does not need them.
// Dry run by default — prints what it would post. --apply to post. Re-runnable: done steps skip.
//
//   DEMO_ADMIN_PASSWORD=… node scripts/demo/correctDemoLedger.mjs [--apply]
import { api, login, state, save, done, mark, log, step, TAG, CLINIC_ID } from './lib.mjs';

const APPLY = process.argv.includes('--apply');
const ADMIN = process.env.DEMO_ADMIN_EMAIL || 'demo@nilehc.tech';
const ACCOUNTANT = 'accountant@intellicare-demo.ss';
const DAY = '2026-10-25'; // the demo day the wrong entries were posted on

const CORRECTIONS = [
  {
    key: 'fixDoubleCogs',
    description: 'Reverse duplicate cost of sale — Achol Ayen Deng, RX-202610-0011',
    narration: 'Amoxicillin and Paracetamol on the CIC bill were costed at billing (GL-202610-0014/0015) and again when dispensed '
      + `(GL-202610-0016/0017). This reverses the dispensing pair: 9,000 + 3,600. ${TAG}`,
    lines: [['1310', 12600, 0, 'Inventory back: costed twice'], ['5210', 0, 12600, 'Duplicate COGS reversed']],
  },
  {
    key: 'fixRdtKitCogs',
    description: 'Reverse Malaria RDT kit cost posted against the lab test — BILL-2026-281492',
    narration: 'The "Malaria RDT" lab-test line was matched by name to the "Malaria RDT kits" stock item and costed '
      + `(GL-202610-0005), but no kit left stock. Reversed so 1300 agrees with the stock valuation. ${TAG}`,
    lines: [['1300', 2500, 0, 'Kit never issued'], ['5200', 0, 2500, 'Kit COGS reversed']],
  },
];

async function main() {
  await login(ADMIN, process.env.DEMO_ADMIN_PASSWORD || (() => { throw new Error('set DEMO_ADMIN_PASSWORD'); })());
  await login(ACCOUNTANT, 'Demo#Accounts1');
  const coa = (await api(ACCOUNTANT, 'GET', `/accounting/chart-of-accounts?clinic_id=${CLINIC_ID}`)).body;
  const acct = (code) => { const a = (Array.isArray(coa) ? coa : coa.data || []).find((x) => x.account_code === code); if (!a) throw new Error(`account ${code} not found`); return a; };
  state.corrections = state.corrections || {};

  for (const c of CORRECTIONS) {
    step(c.description);
    if (done(c.key)) { log(`already posted: ${state.corrections[c.key]}`); continue; }
    for (const [code, dr, cr] of c.lines) log(`  ${code} ${acct(code).account_name.padEnd(32)} Dr ${String(dr).padStart(7)}  Cr ${String(cr).padStart(7)}`);
    if (!APPLY) continue;
    const je = (await api(ACCOUNTANT, 'POST', '/accounting/journal-entries', {
      clinic_id: CLINIC_ID, entry_date: DAY, description: c.description, narration: c.narration, reference: `DEMO-${c.key}`,
      lines: c.lines.map(([code, debit_amount, credit_amount, description]) => ({ account_id: acct(code).id, debit_amount, credit_amount, description })),
    })).body;
    await api(ACCOUNTANT, 'POST', `/accounting/journal-entries/${je.id}/submit`, {});
    await api(ADMIN, 'POST', `/accounting/journal-entries/${je.id}/approve`, {});
    const posted = (await api(ACCOUNTANT, 'POST', `/accounting/journal-entries/${je.id}/post`, {})).body;
    state.corrections[c.key] = `${je.je_number} → ${posted.gl_number || posted.glEntry?.gl_number || posted.data?.gl_number || 'posted'}`; save();
    mark(c.key); log(`posted ${state.corrections[c.key]}`);
  }

  step('Transfer 35,000 from 1100 Cash to 1105 Cash at Hand');
  if (done('fixPettyCash')) { log(`already done: ${state.corrections.fixPettyCash}`); }
  else {
    log('  the stationery expense was paid from 1105, the cashier\'s takings sit in 1100');
    if (APPLY) {
      const r = (await api(ACCOUNTANT, 'POST', '/cash-transfers', { from_account_id: acct('1100').id, to_account_id: acct('1105').id, amount: 35000,
        notes: `Float to Cash at Hand for the office stationery paid from it — ${TAG}` })).body;
      state.corrections.fixPettyCash = r.transfer_number || r.data?.transfer_number || r.id || 'done'; save();
      mark('fixPettyCash'); log(`transferred: ${state.corrections.fixPettyCash}`);
    }
  }
  if (!APPLY) log('\nDry run — nothing posted. Re-run with --apply.');
}
main().catch((e) => { console.error('FAILED:', e.message, e.body ? JSON.stringify(e.body) : ''); process.exit(1); });
