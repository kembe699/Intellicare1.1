#!/usr/bin/env node
/**
 * Restore patient_bills.total_amount for bills corrupted by the
 * billingEnhanced.js `recalculateBillTotals` bug — NOT a GL reversal.
 *
 * That function (invoked from the unused `/bills/:billId/line-items` routes
 * in billingEnhanced.js) sums `bill_line_items` and overwrites a bill's
 * total/balance/status unconditionally, including when the query matches
 * zero rows. Bills created the normal way (POST /patient-bills) store their
 * charges in patient_bills.services (JSON) and never populate
 * bill_line_items at all — nothing in the app copies one into the other —
 * so hitting that route zeroed total_amount for a bill whose real charges
 * were still sitting untouched in `services`, with the GL left fully posted
 * at the original amount (that function never syncs to the ledger).
 *
 * Found on nation via accountingHealthCheck.js's "each bill's revenue
 * matches the bill" check: 3 bills posted at their full original GL revenue
 * but showing total_amount = 0, with no bill_item_void/bill_revenue_adjustment
 * entry for any of them (i.e. nobody ever actually voided or reversed
 * anything — the GL is correct, total_amount is the corrupted field).
 *
 * This script tells that apart from a genuine orphaned-GL mismatch (where
 * the bill's own total agrees with its services but still disagrees with
 * what's posted — a real case reconcileBillRevenue.js already handles) by
 * recomputing each mismatched bill's worth directly from `services`, the
 * same formula patientBills.js's void-item handler uses:
 *
 *   services.filter(s => !s.isVoided).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0)
 *
 * - If that recomputed total matches what's POSTED (not what's stored) —
 *   this is the recalculateBillTotals corruption. Restore total_amount /
 *   balance_amount / status from `services`. No GL writes; the ledger was
 *   already right.
 * - Otherwise, leave it alone and say so — that bill needs
 *   reconcileBillRevenue.js's actual reversal/top-up logic instead, which
 *   this script does not attempt (one script, one failure mode, matching
 *   this repo's existing convention of separate scripts per repair kind).
 *
 * root-cause fix: routes/billingEnhanced.js's recalculateBillTotals now
 * bails out when bill_line_items has zero rows for the bill, so this cannot
 * recur through that path.
 *
 * Idempotent: once restored, a bill's total matches its services, so a
 * second run finds nothing to do for it (it either now matches `posted`
 * exactly, or if it still doesn't, this script correctly leaves it for
 * reconcileBillRevenue.js rather than guessing).
 *
 *   node src/server/scripts/restoreBillTotalsFromServices.js --schema tenant_nation
 *   node src/server/scripts/restoreBillTotalsFromServices.js --schema tenant_nation --apply
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
if (!SCHEMA || !/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  console.error('Usage: restoreBillTotalsFromServices.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

const round2 = (n) => Math.round(n * 100) / 100;

function servicesWorth(servicesRaw) {
  let services;
  try { services = JSON.parse(servicesRaw || '[]'); } catch { return null; }
  if (!Array.isArray(services)) return null;
  return round2(services.filter((s) => !s.isVoided).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0));
}

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database}  schema ${SCHEMA}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (no writes)\n');

  try {
    await db.query(`SET search_path TO "${SCHEMA}"`);

    // Same CTE accountingHealthCheck.js / reconcileBillRevenue.js use.
    const { rows: bills } = await db.query(`
      WITH posted AS (
        SELECT gl.reference_id AS bill_id,
               SUM(al.credit_amount) - SUM(al.debit_amount) AS revenue
          FROM account_ledger al
          JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
          JOIN general_ledger gl ON gl.id = al.transaction_id
         WHERE gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')
         GROUP BY 1)
      SELECT b.id, b.bill_number, b.services, b.paid_amount::float AS paid_amount,
             b.total_amount::float AS total_amount, b.status,
             COALESCE(p.revenue, 0)::float AS posted_revenue,
             COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount)::float AS bill_total
        FROM patient_bills b
        LEFT JOIN posted p ON p.bill_id = b.id
       WHERE ABS(COALESCE(p.revenue, 0) - COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount)) > 0.01
       ORDER BY b.bill_number`);

    if (bills.length === 0) { console.log("Nothing to do — every bill's posted revenue matches its total."); return; }

    const restorable = [];
    const needsReconciliation = [];
    for (const b of bills) {
      const worth = servicesWorth(b.services);
      if (worth !== null && Math.abs(worth - b.posted_revenue) < 0.01 && Math.abs(worth - b.bill_total) > 0.01) {
        restorable.push({ ...b, servicesTotal: worth });
      } else {
        needsReconciliation.push(b);
      }
    }

    if (restorable.length) {
      console.log(`${APPLY ? 'Restoring' : 'Would restore'} ${restorable.length} bill(s) whose total was zeroed by the recalculateBillTotals bug (GL already correct, no GL writes):`);
      for (const b of restorable) {
        console.log(`  ${b.bill_number.padEnd(20)} stored total ${b.total_amount.toFixed(2).padStart(12)}  ->  restored ${b.servicesTotal.toFixed(2).padStart(12)}  (posted revenue ${b.posted_revenue.toFixed(2)})`);
      }
    }
    if (needsReconciliation.length) {
      console.log(`\n${needsReconciliation.length} bill(s) have a posted/total mismatch that is NOT this corruption signature — leaving untouched. Run reconcileBillRevenue.js for these:`);
      for (const b of needsReconciliation) {
        console.log(`  ${b.bill_number.padEnd(20)} posted ${b.posted_revenue.toFixed(2).padStart(12)}  bill ${b.bill_total.toFixed(2).padStart(12)}`);
      }
    }

    if (!APPLY) { console.log(restorable.length ? '\nRe-run with --apply to write.' : ''); return; }
    if (!restorable.length) return;

    let done = 0, skipped = 0;
    for (const b of restorable) {
      const paidAmount = b.paid_amount || 0;
      const newBalance = round2(Math.max(0, b.servicesTotal - paidAmount));
      const newStatus = newBalance <= 0 && b.servicesTotal > 0 ? 'paid' : (paidAmount > 0 ? 'partial' : b.status);
      await db.query('BEGIN');
      try {
        await db.query(
          `UPDATE patient_bills SET total_amount = $1, balance_amount = $2, status = $3, updated_at = NOW() WHERE id = $4`,
          [b.servicesTotal, newBalance, newStatus, b.id]
        );
        await db.query('COMMIT');
        done++;
      } catch (e) {
        await db.query('ROLLBACK');
        console.error(`  FAILED ${b.bill_number}: ${e.message}`);
        skipped++;
      }
    }
    console.log(`\nRestored ${done} bill(s)${skipped ? `, ${skipped} failed` : ''}.`);
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
