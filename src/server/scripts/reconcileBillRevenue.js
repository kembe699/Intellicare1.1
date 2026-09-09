#!/usr/bin/env node
/**
 * Make each bill's posted revenue equal what the bill is actually worth.
 *
 * Creating a bill posts Dr Receivable / Cr Revenue for every line. Voiding a
 * line (POST /patient-bills/:id/void-item) removed it from the bill and dropped
 * the bill's total, but posted nothing — so the revenue and the receivable it
 * raised both stayed. A day's income statement could therefore report more than
 * the till had billed: on nation, one 78,000 line voided a minute after it was
 * raised sat in the accounts for the rest of the day.
 *
 * routes/patientBills.js now posts that reversal as part of voiding. Revenue can
 * also be short of the bill, where a top-up posting failed or was skipped, so
 * this reconciles in both directions rather than only writing money off.
 *
 * It works by reconciliation rather than by replaying void events. For each
 * bill it compares the revenue actually posted against what the bill now says
 * it is worth, and reverses only the excess. Replaying the audit log instead
 * would over-reverse wherever an item was voided before its revenue was ever
 * posted — on one tenant that would have written off 13.2M against bills whose
 * revenue had never reached the ledger at all.
 *
 * The excess is split across the revenue accounts the bill actually credited,
 * in proportion, so each service line is reduced where it was recognised.
 *
 * Entries are dated to when the void happened (or the bill's own date), never to
 * the day the repair runs — dating them "today" would drag months of corrections
 * into the current period and make today's figures nonsense.
 *
 * Idempotent: once reconciled, a bill shows no difference.
 *
 *   node src/server/scripts/reconcileBillRevenue.js --schema tenant_nation
 *   node src/server/scripts/reconcileBillRevenue.js --schema tenant_nation --apply
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
  console.error('Usage: reverseVoidedBillRevenue.js --schema <tenant_schema> [--apply]');
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

    const { rows: bills } = await db.query(`
      WITH posted AS (
        SELECT gl.reference_id AS bill_id,
               SUM(al.credit_amount) - SUM(al.debit_amount) AS revenue
          FROM account_ledger al
          JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
          JOIN general_ledger gl ON gl.id = al.transaction_id
         WHERE gl.reference_module IN ('patient_billing', 'bill_item_void')
         GROUP BY 1)
      SELECT b.id, b.bill_number, b.clinic_id, b.scheme_id,
             COALESCE(p.revenue, 0)::float AS posted_revenue,
             COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount)::float AS bill_total,
             -- Dated to the void, else the bill. Never "today": dating months of
             -- corrections into the current period makes today's report nonsense.
             COALESCE(
               (SELECT MAX(a.created_at)::date FROM audit_logs a
                 WHERE a.action = 'BILL_ITEM_VOIDED' AND a.entity_id = b.id),
               b.bill_date::date, CURRENT_DATE) AS entry_date
        FROM patient_bills b
        -- LEFT JOIN, not JOIN: a bill whose posting failed outright has no rows
        -- in the posted CTE at all, and an inner join quietly excluded exactly
        -- the bills that were most wrong -- the ones missing from the ledger.
        LEFT JOIN posted p ON p.bill_id = b.id
       WHERE ABS(COALESCE(p.revenue, 0) - COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount)) > 0.01
       ORDER BY ABS(COALESCE(p.revenue, 0) - COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount)) DESC`);

    if (bills.length === 0) { console.log("Nothing to do — every bill's posted revenue matches its total."); return; }

    const over = bills.filter(b => b.posted_revenue > b.bill_total);
    const under = bills.filter(b => b.posted_revenue < b.bill_total);
    for (const b of bills.slice(0, 15)) {
      const delta = b.bill_total - b.posted_revenue;
      console.log(`  ${b.bill_number.padEnd(20)} posted ${b.posted_revenue.toFixed(2).padStart(12)}  bill ${b.bill_total.toFixed(2).padStart(12)}  ${delta > 0 ? 'add    ' : 'reverse'} ${Math.abs(delta).toFixed(2).padStart(12)}`);
    }
    if (bills.length > 15) console.log(`  ... and ${bills.length - 15} more`);
    console.log(`\n${APPLY ? 'Adjusting' : 'Would adjust'} ${bills.length} bill(s): `
      + `${over.length} over-posted by ${over.reduce((s, b) => s + b.posted_revenue - b.bill_total, 0).toFixed(2)}, `
      + `${under.length} short by ${under.reduce((s, b) => s + b.bill_total - b.posted_revenue, 0).toFixed(2)}.`);
    if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }

    let done = 0, skipped = 0;
    for (const b of bills) {
      const delta = round2(b.bill_total - b.posted_revenue);   // >0 add revenue, <0 reverse
      if (Math.abs(delta) < 0.01) continue;
      const magnitude = Math.abs(delta);

      // Where this bill's revenue currently sits, so an adjustment lands on the
      // same lines the revenue was recognised on.
      const { rows: byAccount } = await db.query(`
        SELECT al.account_id, SUM(al.credit_amount) - SUM(al.debit_amount) AS amount
          FROM account_ledger al
          JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
          JOIN general_ledger gl ON gl.id = al.transaction_id
         WHERE gl.reference_id = $1 AND gl.reference_module IN ('patient_billing','bill_item_void')
         GROUP BY 1
        -- Any account this bill has touched, not only those still carrying a
        -- positive balance. A bill voided for more than was ever posted ends up
        -- net negative on every line, and requiring a positive balance left it
        -- with nowhere to put the correction, so it was skipped and stayed wrong.
        HAVING SUM(ABS(al.credit_amount)) + SUM(ABS(al.debit_amount)) > 0`, [b.id]);

      const { rows: arRows } = await db.query(
        `SELECT id FROM chart_of_accounts WHERE clinic_id = $1 AND account_code = $2 AND is_active LIMIT 1`,
        [b.clinic_id, b.scheme_id ? '1210' : '1200']);
      const arId = arRows[0]?.id
        || (await db.query(`SELECT id FROM chart_of_accounts WHERE clinic_id=$1 AND account_code='1200' LIMIT 1`, [b.clinic_id])).rows[0]?.id;

      let allocationTargets = byAccount;
      if (allocationTargets.length === 0) {
        // Nothing posted for this bill yet: fall back to the catch-all so the
        // money at least reaches the ledger, where the revenue-split repair can
        // then attribute it properly.
        const { rows: fb } = await db.query(
          `SELECT id AS account_id, 1 AS amount FROM chart_of_accounts
            WHERE clinic_id = $1 AND account_code = '4100' AND is_active LIMIT 1`, [b.clinic_id]);
        allocationTargets = fb;
      }
      if (!allocationTargets.length || !arId) {
        console.log(`  SKIP ${b.bill_number}: revenue accounts ${allocationTargets.length}, receivable ${arId ? 'ok' : 'missing'}`);
        skipped++; continue;
      }

      // Weight by magnitude: a net-negative line still tells us where this bill's
      // revenue was recognised, and a zero-sum weighting would divide by zero.
      const weights = allocationTargets.map(r => Math.abs(Number(r.amount)) || 1);
      const available = weights.reduce((s, w) => s + w, 0);
      const lines = [];
      let allocated = 0;
      allocationTargets.forEach((r, i) => {
        const share = i === allocationTargets.length - 1
          ? round2(magnitude - allocated)
          : round2((weights[i] / available) * magnitude);
        allocated = round2(allocated + share);
        if (share > 0) lines.push({ account_id: r.account_id, amount: share });
      });

      const adding = delta > 0;
      await db.query('BEGIN');
      try {
        const glId = uuidv4();
        const glNumber = `GL-ADJ-${b.bill_number}`;
        const description = adding
          ? `Revenue adjustment (under-posted) - ${b.bill_number}`
          : `Reversal of voided items - ${b.bill_number}`;
        await db.query(`
          INSERT INTO general_ledger (id, clinic_id, gl_number, transaction_date, transaction_type,
            description, reference_id, reference_module, transaction_currency, base_currency,
            exchange_rate, total_debit, total_credit, base_total_debit, base_total_credit,
            is_balanced, status, is_posted, created_by, posted_by, posted_date)
          VALUES ($1,$2,$3,$4,'bill_revenue_adjustment',$5,$6,'bill_item_void','SSP','SSP',
            1.0,$7,$7,$7,$7,TRUE,'posted',TRUE,'system','system',NOW())
        `, [glId, b.clinic_id, glNumber, b.entry_date, description, b.id, magnitude]);

        // Revenue side: credited when adding, debited when reversing.
        for (const l of lines) {
          const dr = adding ? 0 : l.amount;
          const cr = adding ? l.amount : 0;
          await db.query(`
            INSERT INTO gl_line_items (id, gl_id, account_id, debit_amount, credit_amount,
              base_debit_amount, base_credit_amount, line_description)
            VALUES ($1,$2,$3,$4,$5,$4,$5,$6)`, [uuidv4(), glId, l.account_id, dr, cr, description]);
          await db.query(`
            INSERT INTO account_ledger (id, clinic_id, account_id, transaction_id, transaction_date,
              debit_amount, credit_amount, reference_number, description, source_module,
              posted_by, is_posted, posted_date)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'patient_billing','system',TRUE,NOW())`,
            [uuidv4(), b.clinic_id, l.account_id, glId, b.entry_date, dr, cr, glNumber, description]);
        }
        // Receivable side, once, mirroring the revenue side.
        const arDr = adding ? magnitude : 0;
        const arCr = adding ? 0 : magnitude;
        await db.query(`
          INSERT INTO gl_line_items (id, gl_id, account_id, debit_amount, credit_amount,
            base_debit_amount, base_credit_amount, line_description)
          VALUES ($1,$2,$3,$4,$5,$4,$5,$6)`, [uuidv4(), glId, arId, arDr, arCr, description]);
        await db.query(`
          INSERT INTO account_ledger (id, clinic_id, account_id, transaction_id, transaction_date,
            debit_amount, credit_amount, reference_number, description, source_module,
            posted_by, is_posted, posted_date)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'patient_billing','system',TRUE,NOW())`,
          [uuidv4(), b.clinic_id, arId, glId, b.entry_date, arDr, arCr, glNumber, description]);

        await db.query('COMMIT');
        done++;
      } catch (e) {
        await db.query('ROLLBACK');
        console.error(`  FAILED ${b.bill_number}: ${e.message}`);
        skipped++;
      }
    }
    console.log(`\nAdjusted ${done} bill(s)${skipped ? `, ${skipped} skipped/failed` : ''}.`);
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
