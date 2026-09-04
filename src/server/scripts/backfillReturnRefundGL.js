#!/usr/bin/env node
/**
 * Post the general-ledger entry for pharmacy refunds that were never posted.
 *
 * Returning a dispensed drug reversed the inventory and recorded the refund on
 * dispensing_returns, but touched no account: revenue stayed recognised in full
 * and cash on hand read high by the refunded amount. routes/pharmacyModule.js
 * now posts the entry as part of processing a return; this is for the refunds
 * already sitting on the books unposted.
 *
 * The entry is the reverse of the sale, dated to the day the refund actually
 * happened rather than today, so it lands in the period it belongs to:
 *
 *   Dr  4120 Pharmacy Sales Revenue   (falling back to 4100)   amount_refunded
 *     Cr  1105 Cash at Hand           (falling back to 1100)   amount_refunded
 *
 * Idempotent: a return whose revenue_reversal_gl_id is already set is skipped,
 * so re-running cannot double-post.
 *
 * Dry-run by default.
 *
 *   node src/server/scripts/backfillReturnRefundGL.js --schema tenant_demo
 *   node src/server/scripts/backfillReturnRefundGL.js --schema tenant_demo --apply
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
if (!SCHEMA || /^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA) === false) {
  console.error('Usage: backfillReturnRefundGL.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

async function accountByCode(db, clinicId, codes) {
  for (const code of codes) {
    const { rows } = await db.query(
      `SELECT id, account_code, account_name FROM chart_of_accounts
        WHERE clinic_id = $1 AND account_code = $2 AND is_active = TRUE LIMIT 1`,
      [clinicId, code],
    );
    if (rows.length) return rows[0];
  }
  return null;
}

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  // Print the resolved target: dotenv override has silently repointed a script
  // at the wrong database before.
  console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database} schema ${SCHEMA}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (no writes)\n');

  try {
    await db.query(`SET search_path TO "${SCHEMA}"`);

    const { rows: pending } = await db.query(`
      SELECT dr.id, dr.clinic_id, dr.return_number, dr.return_date, dr.amount_refunded,
             dr.quantity_returned, dr.return_reason
        FROM dispensing_returns dr
       WHERE dr.revenue_reversal_gl_id IS NULL
         AND COALESCE(dr.amount_refunded, 0) > 0
       ORDER BY dr.return_date, dr.return_number
    `);

    if (pending.length === 0) {
      console.log('Nothing to post — every refund already has a GL entry.');
      return;
    }

    let posted = 0, total = 0;
    for (const r of pending) {
      const amount = Number(r.amount_refunded);
      const revenue = await accountByCode(db, r.clinic_id, ['4120', '4100']);
      const cash = await accountByCode(db, r.clinic_id, ['1105', '1100']);
      if (!revenue || !cash) {
        console.log(`  SKIP ${r.return_number}: missing account (revenue ${!!revenue}, cash ${!!cash}) for clinic ${r.clinic_id}`);
        continue;
      }

      const date = r.return_date.toISOString ? r.return_date.toISOString().split('T')[0] : String(r.return_date);
      const description = `Pharmacy refund ${r.return_number} — ${r.quantity_returned} unit(s) returned (${r.return_reason || 'unused'})`;
      console.log(`  ${APPLY ? 'POST' : 'would post'} ${r.return_number} ${date}  ${amount.toFixed(2)}  Dr ${revenue.account_code} / Cr ${cash.account_code}`);
      total += amount;
      posted++;

      if (!APPLY) continue;

      await db.query('BEGIN');
      try {
        const glId = uuidv4();
        const glNumber = `GL-RET-${r.return_number}`;
        await db.query(`
          INSERT INTO general_ledger (id, clinic_id, gl_number, transaction_date, transaction_type,
            description, reference_id, reference_module, transaction_currency, base_currency,
            exchange_rate, total_debit, total_credit, base_total_debit, base_total_credit,
            is_balanced, status, is_posted, created_by, posted_by, posted_date)
          VALUES ($1,$2,$3,$4,'pharmacy_return_refund',$5,$6,'pharmacy_return','SSP','SSP',
            1.0,$7,$7,$7,$7,TRUE,'posted',TRUE,'system','system',NOW())
        `, [glId, r.clinic_id, glNumber, date, description, r.return_number, amount]);

        for (const [acct, dr, cr, note] of [
          [revenue, amount, 0, `Reverse pharmacy revenue on return ${r.return_number}`],
          [cash, 0, amount, `Cash refunded to patient for return ${r.return_number}`],
        ]) {
          await db.query(`
            INSERT INTO gl_line_items (id, gl_id, account_id, debit_amount, credit_amount,
              base_debit_amount, base_credit_amount, line_description)
            VALUES ($1,$2,$3,$4,$5,$4,$5,$6)
          `, [uuidv4(), glId, acct.id, dr, cr, note]);

          // id is varchar with no database default here — the Sequelize model
          // generates it, so a raw insert has to supply one.
          await db.query(`
            INSERT INTO account_ledger (id, clinic_id, account_id, transaction_id, transaction_date,
              debit_amount, credit_amount, reference_number, description, source_module,
              posted_by, is_posted, posted_date)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pharmacy_return','system',TRUE,NOW())
          `, [uuidv4(), r.clinic_id, acct.id, glId, date, dr, cr, r.return_number, note]);
        }

        await db.query('UPDATE dispensing_returns SET revenue_reversal_gl_id = $1 WHERE id = $2', [glId, r.id]);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        console.error(`  FAILED ${r.return_number}: ${e.message}`);
        posted--;
        total -= amount;
      }
    }

    console.log(`\n${APPLY ? 'Posted' : 'Would post'} ${posted} refund(s), ${total.toFixed(2)} total.`);
    if (!APPLY) console.log('Re-run with --apply to write.');
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
