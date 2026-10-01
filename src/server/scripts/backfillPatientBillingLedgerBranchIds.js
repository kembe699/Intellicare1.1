#!/usr/bin/env node
/**
 * B7: account_ledger rows for patient billing (bill creation, add-services
 * top-ups, item voids, and the C3 FX-aware payment path) used to post with no
 * branch_id at all — AccountingService.createGLEntry's AccountLedger.create()
 * call never set it, regardless of what the caller resolved. This matters
 * because reportIncomeStatement.js's branch-scoped income statement filters
 * directly on account_ledger.branch_id (see its branchScope() helper) — a
 * branch user querying their own income statement never saw their own
 * patient billing revenue at all, admin/all-branches view was unaffected
 * (no branch filter applied there).
 *
 * general_ledger and gl_line_items have NO branch_id column at all in this
 * schema and are not queried with branch filtering anywhere in this codebase
 * today, so this script only backfills account_ledger — the table branch
 * scoping actually reads from. journal_entries/journal_entry_lines (the
 * payment/deposit/transfer JE path via JournalPostingService) already
 * resolved and wrote branch_id correctly from the start of that service's
 * existence (Phase 2) and are not touched here.
 *
 * branch_id is taken from the associated patient_bills row (joined via
 * general_ledger.reference_id for reference_module IN ('patient_billing',
 * 'bill_item_void', 'patient_bill_payment', 'bill_revenue_adjustment')) — the
 * same source AccountingService now stamps at posting time going forward.
 * 'bill_revenue_adjustment' rows come from reconcileBillRevenue.js, which
 * writes account_ledger directly (bypassing createGLEntry) and has
 * separately been given the same branch_id fix — included here so those
 * rows get backfilled too rather than needing a second script. A bill with
 * no branch_id of its own (pre-dates branch isolation entirely) leaves its
 * ledger rows NULL, same as before — there is nothing to backfill FROM.
 *
 * Idempotent: only ever updates a row that is currently NULL — a row already
 * backfilled (or written correctly after this fix shipped) is left alone.
 *
 * Safety: dry-run by default. Never run with --apply against production
 * without reviewing the dry-run output first.
 *
 *   node src/server/scripts/backfillPatientBillingLedgerBranchIds.js --schema tenant_demo
 *   node src/server/scripts/backfillPatientBillingLedgerBranchIds.js --schema tenant_demo --apply
 *   node src/server/scripts/backfillPatientBillingLedgerBranchIds.js --all-tenants --apply
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
const ALL = args.includes('--all-tenants');
const si = args.indexOf('--schema');
const ONE = si !== -1 ? args[si + 1] : null;

const validSchema = (s) => /^[a-z_][a-z0-9_]{0,62}$/.test(s);

function connConfig() {
  const { ssl, ...rest } = DB_ENV;
  return { ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) };
}

const REFERENCE_MODULES = ['patient_billing', 'bill_item_void', 'patient_bill_payment', 'bill_revenue_adjustment'];

async function backfillOne(db, schema) {
  const { rows: preview } = await db.query(
    `SELECT count(*) AS n
       FROM "${schema}".account_ledger al
       JOIN "${schema}".general_ledger gl ON gl.id = al.transaction_id
       JOIN "${schema}".patient_bills pb ON pb.id::text = gl.reference_id
      WHERE al.branch_id IS NULL
        AND pb.branch_id IS NOT NULL
        AND gl.reference_module = ANY($1::text[])`,
    [REFERENCE_MODULES]
  );
  const n = parseInt(preview[0].n, 10);

  console.log(`\n── ${schema}: ${n} account_ledger row(s) ${APPLY ? 'to backfill' : 'would be backfilled'}`);

  if (n === 0) return 0;

  if (APPLY) {
    const { rowCount } = await db.query(
      `UPDATE "${schema}".account_ledger al
          SET branch_id = pb.branch_id
         FROM "${schema}".general_ledger gl
         JOIN "${schema}".patient_bills pb ON pb.id::text = gl.reference_id
        WHERE al.transaction_id = gl.id
          AND al.branch_id IS NULL
          AND pb.branch_id IS NOT NULL
          AND gl.reference_module = ANY($1::text[])`,
      [REFERENCE_MODULES]
    );
    console.log(`   ✅ backfilled ${rowCount} row(s)`);
  }
  return n;
}

async function main() {
  if (!ALL && (!ONE || !validSchema(ONE))) {
    console.error('Usage: backfillPatientBillingLedgerBranchIds.js (--schema <tenant_schema> | --all-tenants) [--apply]');
    process.exit(1);
  }
  const db = new Client(connConfig());
  await db.connect();
  try {
    let schemas = [ONE];
    if (ALL) {
      const { rows } = await db.query(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\\_%' AND nspname <> 'tenant_test' ORDER BY nspname`
      );
      schemas = rows.map((r) => r.nspname);
    }
    console.log(`target: ${DB_ENV.user}@${DB_ENV.host}:${DB_ENV.port}/${DB_ENV.database}${DB_ENV.ssl ? ' (ssl)' : ''}`);
    if (!APPLY) console.log('[dry run — nothing written]');
    for (const s of schemas) {
      if (!validSchema(s)) continue;
      await backfillOne(db, s);
    }
    if (!APPLY) console.log('\nRe-run with --apply to write.');
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
