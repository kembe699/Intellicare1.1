#!/usr/bin/env node
/**
 * Backfill account_ledger.branch_id for rows posted before this was fixed.
 *
 * AccountingService.createGLEntry's AccountLedger.create() call never included
 * branch_id — not because callers lacked it, but because the object literal
 * that builds each ledger row simply never read glData.branch_id. Every
 * account_ledger row ever posted through it (patient bill revenue, bill
 * voids/top-ups, daily expense payments, supplier bill payments, consultant
 * bill payments, FX settlements, asset postings — effectively the entire
 * double-entry ledger) has branch_id = NULL.
 *
 * Every branch-scoped read of account_ledger (both Income Statement reports,
 * trial balance, balance sheet — anywhere branchScope() filters `al.branch_id
 * = :branchId`) therefore returns nothing for a non-unscoped-admin viewer,
 * while receipts (which DO carry branch_id correctly) keep showing real
 * totals — exactly the "dashboard shows real numbers, income statement shows
 * 0" symptom reported on nation. An unscoped admin (the default — see
 * branch_isolation_initiative notes on the TopBar switcher) never hits this,
 * which is why it went unnoticed until someone viewed a report scoped to a
 * specific branch.
 *
 * The code path is now fixed (AccountingService.js, patientBills.js,
 * daily-expenses.js, reconcileBillRevenue.js all now pass branch_id through)
 * — this script repairs rows posted before that fix shipped, by looking up
 * each row's branch_id from the record general_ledger.reference_id actually
 * points to, keyed by reference_module:
 *
 *   patient_billing / bill_item_void / bill_revenue_adjustment -> patient_bills.branch_id
 *   daily_expense                                              -> daily_expenses.branch_id
 *   supplier_bill_payment                                      -> supplier_bill_payments.branch_id
 *
 * Any other reference_module (e.g. consultant_bill, which has no branch_id
 * column at all today) is reported, not guessed at, and left NULL.
 *
 * Idempotent: only ever touches rows where branch_id IS NULL.
 *
 *   node src/server/scripts/backfillAccountLedgerBranchId.js --schema tenant_nation
 *   node src/server/scripts/backfillAccountLedgerBranchId.js --schema tenant_nation --apply
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
  console.error('Usage: backfillAccountLedgerBranchId.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

// One entry per handled reference_module: a SELECT count and the matching
// UPDATE, written out explicitly rather than generically assembled — the
// three source tables join on different column shapes (char(36) id, integer
// id cast to text, varchar id) and string-building one JOIN clause to serve
// both a SELECT and an UPDATE was fragile enough to not be worth it.
const SOURCES = [
  {
    label: 'patient_bills',
    modules: ['patient_billing', 'bill_item_void', 'bill_revenue_adjustment'],
    countSql: `
      SELECT COUNT(*) AS count
        FROM account_ledger al
        JOIN general_ledger gl ON gl.id = al.transaction_id
        JOIN patient_bills src ON src.id = gl.reference_id
       WHERE al.branch_id IS NULL AND gl.reference_module = ANY($1::text[]) AND src.branch_id IS NOT NULL`,
    updateSql: `
      UPDATE account_ledger al SET branch_id = src.branch_id
        FROM general_ledger gl JOIN patient_bills src ON src.id = gl.reference_id
       WHERE al.transaction_id = gl.id AND al.branch_id IS NULL
         AND gl.reference_module = ANY($1::text[]) AND src.branch_id IS NOT NULL`,
  },
  {
    label: 'daily_expenses',
    modules: ['daily_expense'],
    countSql: `
      SELECT COUNT(*) AS count
        FROM account_ledger al
        JOIN general_ledger gl ON gl.id = al.transaction_id
        JOIN daily_expenses src ON src.id::text = gl.reference_id
       WHERE al.branch_id IS NULL AND gl.reference_module = ANY($1::text[]) AND src.branch_id IS NOT NULL`,
    updateSql: `
      UPDATE account_ledger al SET branch_id = src.branch_id
        FROM general_ledger gl JOIN daily_expenses src ON src.id::text = gl.reference_id
       WHERE al.transaction_id = gl.id AND al.branch_id IS NULL
         AND gl.reference_module = ANY($1::text[]) AND src.branch_id IS NOT NULL`,
  },
  {
    label: 'supplier_bill_payments',
    modules: ['supplier_bill_payment'],
    countSql: `
      SELECT COUNT(*) AS count
        FROM account_ledger al
        JOIN general_ledger gl ON gl.id = al.transaction_id
        JOIN supplier_bill_payments src ON src.id::text = gl.reference_id
       WHERE al.branch_id IS NULL AND gl.reference_module = ANY($1::text[]) AND src.branch_id IS NOT NULL`,
    updateSql: `
      UPDATE account_ledger al SET branch_id = src.branch_id
        FROM general_ledger gl JOIN supplier_bill_payments src ON src.id::text = gl.reference_id
       WHERE al.transaction_id = gl.id AND al.branch_id IS NULL
         AND gl.reference_module = ANY($1::text[]) AND src.branch_id IS NOT NULL`,
  },
];

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database}  schema ${SCHEMA}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (no writes)\n');

  try {
    await db.query(`SET search_path TO "${SCHEMA}"`);

    let totalFixable = 0;
    for (const source of SOURCES) {
      const { rows: [{ count }] } = await db.query(source.countSql, [source.modules]);
      const n = parseInt(count, 10);
      console.log(`  ${source.label.padEnd(24)} ${n} row(s) ${APPLY ? 'to backfill' : 'would backfill'}`);
      totalFixable += n;
      if (APPLY && n > 0) await db.query(source.updateSql, [source.modules]);
    }

    const allModules = SOURCES.flatMap((s) => s.modules);
    const { rows: unhandled } = await db.query(
      `SELECT gl.reference_module, COUNT(*) AS count
         FROM account_ledger al
         JOIN general_ledger gl ON gl.id = al.transaction_id
        WHERE al.branch_id IS NULL
          AND (gl.reference_module IS NULL OR NOT (gl.reference_module = ANY($1::text[])))
        GROUP BY gl.reference_module
        ORDER BY count DESC`,
      [allModules]
    );
    if (unhandled.length) {
      console.log(`\nNot handled by this script (no branch_id source wired up for this reference_module):`);
      for (const r of unhandled) console.log(`  ${(r.reference_module || '(null)').padEnd(24)} ${r.count} row(s) left NULL`);
    }

    console.log(`\n${APPLY ? 'Backfilled' : 'Would backfill'} ${totalFixable} row(s) total.`);
    if (!APPLY && totalFixable > 0) console.log('Re-run with --apply to write.');
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
