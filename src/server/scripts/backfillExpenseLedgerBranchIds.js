#!/usr/bin/env node
/**
 * Backfill account_ledger.branch_id for expense-side GL postings made before
 * AccountingService.createGLEntry's branch_id fix shipped.
 *
 * Same root cause as B7 (backfillPatientBillingLedgerBranchIds.js):
 * createGLEntry's AccountLedger.create() call never read glData.branch_id,
 * so every account_ledger row it ever posted had branch_id = NULL regardless
 * of what the caller resolved. B7 fixed and backfilled the patient-billing
 * side (patient_billing / bill_item_void / patient_bill_payment /
 * bill_revenue_adjustment). This script covers the two expense-side
 * reference_modules B7 didn't touch — daily-expenses.js's own GL postings:
 *
 *   daily_expense          -> daily_expenses.branch_id
 *   supplier_bill_payment  -> supplier_bill_payments.branch_id
 *
 * Any other reference_module with branch_id still NULL (e.g.
 * consultant_bill, which has no branch_id column at all today, or
 * fixed-asset postings, which are a separate, larger gap) is reported, not
 * guessed at, and left NULL — run backfillPatientBillingLedgerBranchIds.js
 * separately for the patient-billing side.
 *
 * Idempotent: only ever touches rows where branch_id IS NULL.
 *
 *   node src/server/scripts/backfillExpenseLedgerBranchIds.js --schema tenant_nation
 *   node src/server/scripts/backfillExpenseLedgerBranchIds.js --schema tenant_nation --apply
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
  console.error('Usage: backfillExpenseLedgerBranchIds.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

// One entry per handled reference_module — a SELECT count and the matching
// UPDATE, written out explicitly rather than generically assembled, since
// the two source tables join on different id column shapes.
const SOURCES = [
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
      console.log(`\nNot handled by this script (patient-billing rows: use backfillPatientBillingLedgerBranchIds.js; everything else below has no branch_id source wired up yet):`);
      for (const r of unhandled) console.log(`  ${(r.reference_module || '(null)').padEnd(24)} ${r.count} row(s) left NULL`);
    }

    console.log(`\n${APPLY ? 'Backfilled' : 'Would backfill'} ${totalFixable} row(s) total.`);
    if (!APPLY && totalFixable > 0) console.log('Re-run with --apply to write.');
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
