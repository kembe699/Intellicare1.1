#!/usr/bin/env node
/**
 * Post the payments that never reached the ledger.
 *
 * routes/patientBills.js chose the cash account with `like 'cash at hand'` and
 * a `like '%cash%'` fallback. MySQL's LIKE ignores case; PostgreSQL's does not,
 * so after the move to Postgres neither matched the account actually called
 * "Cash at Hand". debitAccount came back null, the posting block was skipped,
 * and because that block is wrapped in a best-effort try/catch it failed
 * silently. Cash kept being collected and receipts kept being written, but no
 * cash account was debited and no receivable was cleared — the cashier's screen
 * showed the money and every report built on the ledger did not.
 *
 * This posts the entries those receipts should have produced, using the same
 * accounts and the same shape as the (now fixed) runtime path:
 *
 *   Dr  cash / bank / deposits-held, by payment method
 *     Cr  1210 for a scheme-priced bill, else 1200
 *
 * Idempotent: a receipt whose number already appears in a posted ledger row is
 * skipped, so this can be re-run safely.
 *
 *   node src/server/scripts/postMissingReceiptEntries.js --schema tenant_nation
 *   node src/server/scripts/postMissingReceiptEntries.js --schema tenant_nation --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

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
if (!SCHEMA || !/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  console.error('Usage: postMissingReceiptEntries.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

const round2 = (n) => Math.round(n * 100) / 100;

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database}  schema ${SCHEMA}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (no writes)\n');

  try {
    await db.query(`SET search_path TO "${SCHEMA}"`);

    const acct = async (where, params) => {
      const { rows } = await db.query(
        `SELECT id, account_code, account_name FROM chart_of_accounts WHERE is_active AND ${where} LIMIT 1`, params);
      return rows[0] || null;
    };
    // ILIKE here for the same reason the application now uses iLike.
    const cashAcct    = await acct(`account_name ILIKE 'cash at hand'`, []) || await acct(`account_code = '1105'`, []) || await acct(`account_code = '1100'`, []);
    const bankAcct    = await acct(`is_bank_account = TRUE`, []) || await acct(`account_code = '1110'`, []);
    const depositAcct = await acct(`account_code = '2150'`, []);
    const ar          = await acct(`account_code = '1200'`, []);
    const arScheme    = await acct(`account_code = '1210'`, []) || ar;

    if (!cashAcct || !ar) {
      console.error(`Cannot post: cash account ${cashAcct ? 'ok' : 'MISSING'}, receivable ${ar ? 'ok' : 'MISSING'}`);
      process.exit(1);
    }
    console.log(`  cash -> ${cashAcct.account_code} ${cashAcct.account_name}`);
    console.log(`  bank -> ${bankAcct ? bankAcct.account_code + ' ' + bankAcct.account_name : '(none)'}`);
    console.log(`  AR   -> ${ar.account_code} / scheme ${arScheme.account_code}\n`);

    const { rows: receipts } = await db.query(`
      SELECT r.id, r.receipt_number, r.payment_amount, r.payment_method, r.clinic_id,
             -- base_currency_amount defaults to 0 rather than NULL, so COALESCE
             -- alone silently valued every receipt at nothing.
             CASE WHEN COALESCE(r.base_currency_amount, 0) > 0
                  THEN r.base_currency_amount ELSE r.payment_amount END AS base_amount,
             r.created_at::date AS posted_on, b.scheme_id, b.id AS bill_id
        FROM receipts r
        LEFT JOIN patient_bills b ON b.id = r.bill_id
       WHERE COALESCE(r.is_voided, FALSE) = FALSE
         AND COALESCE(r.payment_amount, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM account_ledger al
            WHERE al.source_module = 'billing'
              AND al.description LIKE '%' || r.receipt_number || '%')
       ORDER BY r.created_at`);

    if (receipts.length === 0) { console.log('Nothing to post — every receipt is already on the ledger.'); return; }

    const totals = {};
    for (const r of receipts) {
      const m = (r.payment_method || 'cash').toLowerCase();
      totals[m] = (totals[m] || 0) + Number(r.base_amount);
    }
    for (const [m, amt] of Object.entries(totals)) {
      console.log(`  ${APPLY ? 'posting' : 'would post'} ${m.padEnd(14)} ${amt.toFixed(2)}`);
    }
    console.log(`\n${receipts.length} receipt(s), ${Object.values(totals).reduce((a, b) => a + b, 0).toFixed(2)} total.`);
    if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

    let posted = 0, skipped = 0;
    for (const r of receipts) {
      const method = (r.payment_method || 'cash').toLowerCase();
      const debit = method === 'deposit' ? depositAcct
                  : (method === 'card' || method === 'mobile_money' || method === 'bank_transfer') ? (bankAcct || cashAcct)
                  : cashAcct;
      const credit = r.scheme_id ? arScheme : ar;
      if (!debit) { console.log(`  SKIP ${r.receipt_number}: no account for method '${method}'`); skipped++; continue; }

      const amount = round2(Number(r.base_amount));
      await db.query('BEGIN');
      try {
        const jeId = uuidv4();
        const jeNumber = `JE-RCP-${r.receipt_number}`;
        const description = `Payment received (${method}) - ${r.receipt_number}`;
        await db.query(`
          INSERT INTO journal_entries (id, clinic_id, je_number, entry_date, description, narration,
            reference, transaction_currency, base_currency, exchange_rate,
            total_debit, total_credit, base_total_debit, base_total_credit,
            status, created_by, posted_by, posted_date, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'SSP','SSP',1.0,$8,$8,$8,$8,'posted','system','system',NOW(),NOW(),NOW())
        `, [jeId, r.clinic_id, jeNumber, r.posted_on, description, `Receipt ${r.receipt_number}`, `RCP-${r.id}`, amount]);

        for (const [account, dr, cr, note] of [
          [debit,  amount, 0, description],
          [credit, 0, amount, `Receivable cleared - bill ${r.bill_id} - ${r.receipt_number}`],
        ]) {
          await db.query(`
            INSERT INTO journal_entry_lines (id, je_id, account_id, debit_amount, credit_amount,
              base_debit_amount, base_credit_amount, description, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$4,$5,$6,NOW(),NOW())`,
            [uuidv4(), jeId, account.id, dr, cr, note]);

          await db.query(`
            INSERT INTO account_ledger (id, clinic_id, account_id, transaction_date,
              debit_amount, credit_amount, reference_number, description, source_module,
              posted_by, is_posted, posted_date, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'billing','system',TRUE,NOW(),NOW(),NOW())`,
            [uuidv4(), r.clinic_id, account.id, r.posted_on, dr, cr, jeNumber, note]);
        }
        await db.query('COMMIT');
        posted++;
      } catch (e) {
        await db.query('ROLLBACK');
        console.error(`  FAILED ${r.receipt_number}: ${e.message}`);
        skipped++;
      }
    }
    console.log(`\nPosted ${posted} receipt(s)${skipped ? `, ${skipped} skipped/failed` : ''}.`);
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
