#!/usr/bin/env node
/**
 * Post the patient-billing GL entries that were never posted.
 *
 * AccountingService.createGLEntry writes an entry as a draft, with its
 * account_ledger rows flagged is_posted = false, and only postGLEntry flips
 * them. The three billing paths in that service created entries and never
 * called it, so every bill raised through them sat as a draft for ever.
 *
 * The income statement, trial balance and balance sheet all count posted rows
 * only, so they showed a fraction of what had actually been billed while the
 * cashier's own screen — which reads receipts directly — showed the real money.
 * That is the discrepancy this repairs.
 *
 * Only entries that balance are posted: an entry whose debits and credits
 * disagree is a genuine problem that must be looked at rather than quietly
 * promoted into the financial statements. Anything a person deliberately left
 * as a draft in another module is untouched, because this is restricted to the
 * reference_module the faulty paths write.
 *
 * Idempotent — an already-posted entry is not selected.
 *
 *   node src/server/scripts/postUnpostedBillEntries.js --schema tenant_nation
 *   node src/server/scripts/postUnpostedBillEntries.js --schema tenant_nation --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

const DB_ENV = {
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  ssl: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase()),
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const si = args.indexOf('--schema');
const SCHEMA = si !== -1 ? args[si + 1] : null;
const MODULES = ['patient_billing', 'payment_receipt'];
if (!SCHEMA || !/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  console.error('Usage: postUnpostedBillEntries.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database}  schema ${SCHEMA}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (no writes)\n');

  try {
    await db.query(`SET search_path TO "${SCHEMA}"`);

    const { rows: candidates } = await db.query(`
      SELECT gl.id, gl.gl_number, gl.reference_module, gl.transaction_date,
             COALESCE(SUM(al.debit_amount), 0)  AS dr,
             COALESCE(SUM(al.credit_amount), 0) AS cr,
             COUNT(al.id) AS ledger_rows
        FROM general_ledger gl
        LEFT JOIN account_ledger al ON al.transaction_id = gl.id
       WHERE gl.reference_module = ANY($1)
         AND (gl.is_posted IS NOT TRUE OR gl.status <> 'posted')
       GROUP BY gl.id, gl.gl_number, gl.reference_module, gl.transaction_date
       ORDER BY gl.transaction_date
    `, [MODULES]);

    if (candidates.length === 0) {
      console.log('Nothing to post — every billing entry is already posted.');
      return;
    }

    const balanced = candidates.filter(r => Number(r.ledger_rows) > 0 && Math.abs(Number(r.dr) - Number(r.cr)) < 0.01);
    const skipped  = candidates.filter(r => !(Number(r.ledger_rows) > 0 && Math.abs(Number(r.dr) - Number(r.cr)) < 0.01));

    for (const r of skipped) {
      console.log(`  SKIP ${r.gl_number}: ${r.ledger_rows} ledger row(s), debits ${Number(r.dr).toFixed(2)} vs credits ${Number(r.cr).toFixed(2)} — not balanced, needs a look`);
    }

    const total = balanced.reduce((s, r) => s + Number(r.cr), 0);
    console.log(`\n${APPLY ? 'Posting' : 'Would post'} ${balanced.length} entr${balanced.length === 1 ? 'y' : 'ies'}, ${total.toFixed(2)} in credits.`);
    if (skipped.length) console.log(`${skipped.length} left alone (see above).`);

    if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

    const ids = balanced.map(r => r.id);
    await db.query('BEGIN');
    try {
      const led = await db.query(
        `UPDATE account_ledger SET is_posted = TRUE, posted_date = NOW()
          WHERE transaction_id = ANY($1) AND is_posted IS NOT TRUE`, [ids]);
      const gle = await db.query(
        `UPDATE general_ledger SET status = 'posted', is_posted = TRUE,
                posted_date = COALESCE(posted_date, NOW()),
                posted_by = COALESCE(posted_by, 'system')
          WHERE id = ANY($1)`, [ids]);
      await db.query('COMMIT');
      console.log(`\nPosted ${gle.rowCount} GL entr${gle.rowCount === 1 ? 'y' : 'ies'} and ${led.rowCount} ledger row(s).`);
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
