#!/usr/bin/env node
/**
 * Check the books of a live tenant against the invariants that keep reports true.
 *
 * Read-only. Every check here corresponds to a fault that has actually occurred,
 * and in each case the reports looked plausible while disagreeing with the
 * cashier. Run it after a deploy, or whenever a figure looks wrong, to get a
 * straight answer about which invariant is broken rather than adding up a day
 * by hand.
 *
 * Exits non-zero if anything fails, so it can gate a release.
 *
 *   node src/server/scripts/accountingHealthCheck.js --schema tenant_nation
 *   node src/server/scripts/accountingHealthCheck.js --all
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
const ALL = args.includes('--all');
const si = args.indexOf('--schema');
const ONE = si !== -1 ? args[si + 1] : null;
if (!ALL && !ONE) {
  console.error('Usage: accountingHealthCheck.js (--schema <tenant> | --all)');
  process.exit(1);
}

const AUTOMATIC_MODULES = `'patient_billing','payment_receipt','bill_item_void',
  'bill_revenue_adjustment','pharmacy_return','daily_expense','supplier_bill_payment',
  'procurement_grn','bill_write_off','insurance_claims'`;

/** Each check returns rows; empty means healthy. */
const CHECKS = [
  {
    name: 'ledger balances',
    sql: `SELECT COALESCE(SUM(debit_amount) - SUM(credit_amount), 0) AS out_by
            FROM account_ledger
           HAVING ABS(COALESCE(SUM(debit_amount) - SUM(credit_amount), 0)) > 0.01`,
    describe: (r) => `ledger is out by ${r.out_by}`,
  },
  {
    name: 'every GL entry balances',
    sql: `SELECT gl.gl_number, SUM(li.debit_amount) AS dr, SUM(li.credit_amount) AS cr
            FROM general_ledger gl JOIN gl_line_items li ON li.gl_id = gl.id
           GROUP BY gl.id, gl.gl_number
          HAVING ABS(SUM(li.debit_amount) - SUM(li.credit_amount)) > 0.01`,
    describe: (r) => `${r.gl_number}: debits ${r.dr} vs credits ${r.cr}`,
  },
  {
    name: 'automatic entries are posted',
    sql: `SELECT gl_number, reference_module, status FROM general_ledger
           WHERE reference_module IN (${AUTOMATIC_MODULES})
             AND (is_posted IS NOT TRUE OR status <> 'posted')`,
    describe: (r) => `${r.gl_number} (${r.reference_module}) is ${r.status}`,
  },
  {
    name: 'posted entries have posted ledger rows',
    sql: `SELECT DISTINCT gl.gl_number FROM account_ledger al
            JOIN general_ledger gl ON gl.id = al.transaction_id
           WHERE gl.is_posted IS TRUE AND al.is_posted IS NOT TRUE`,
    describe: (r) => `${r.gl_number} has unposted ledger rows`,
  },
  {
    name: "each bill's revenue matches the bill",
    sql: `WITH posted AS (
            SELECT gl.reference_id AS bill_id, SUM(al.credit_amount) - SUM(al.debit_amount) AS revenue
              FROM account_ledger al
              JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
              JOIN general_ledger gl ON gl.id = al.transaction_id
             WHERE gl.reference_module IN ('patient_billing','bill_item_void','bill_revenue_adjustment')
             GROUP BY 1)
          SELECT b.bill_number, p.revenue, COALESCE(NULLIF(b.base_currency_total,0), b.total_amount) AS worth
            FROM posted p JOIN patient_bills b ON b.id = p.bill_id
           WHERE ABS(p.revenue - COALESCE(NULLIF(b.base_currency_total,0), b.total_amount)) > 0.01`,
    describe: (r) => `${r.bill_number}: posted ${r.revenue} vs bill ${r.worth}`,
  },
  {
    name: 'bills that were never posted at all',
    sql: `SELECT b.bill_number, b.total_amount FROM patient_bills b
           WHERE COALESCE(b.total_amount, 0) > 0
             AND NOT EXISTS (SELECT 1 FROM general_ledger gl WHERE gl.reference_id = b.id)`,
    describe: (r) => `${r.bill_number} (${r.total_amount}) has no ledger entry`,
  },
  {
    name: 'receipts reached the ledger',
    sql: `SELECT r.receipt_number, r.payment_amount FROM receipts r
           WHERE COALESCE(r.is_voided, FALSE) = FALSE AND COALESCE(r.payment_amount, 0) > 0
             AND NOT EXISTS (SELECT 1 FROM account_ledger al
                              WHERE al.description LIKE '%' || r.receipt_number || '%')`,
    describe: (r) => `${r.receipt_number} (${r.payment_amount}) is not in the ledger`,
  },
  {
    name: 'revenue is split by service line',
    sql: `WITH rev AS (
            SELECT c.account_code, SUM(al.credit_amount) - SUM(al.debit_amount) AS net
              FROM account_ledger al
              JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
             GROUP BY 1)
          SELECT (SELECT COALESCE(net,0) FROM rev WHERE account_code='4100') AS catch_all,
                 (SELECT COALESCE(SUM(net),0) FROM rev) AS total
            FROM rev LIMIT 1`,
    check: (rows) => {
      const r = rows[0];
      if (!r || Number(r.total) <= 0) return [];
      const ratio = Number(r.catch_all) / Number(r.total);
      return ratio >= 0.5
        ? [`${(ratio * 100).toFixed(0)}% of revenue is still in 4100 (${r.catch_all} of ${r.total})`]
        : [];
    },
  },
];

async function runFor(db, schema) {
  await db.query(`SET search_path TO "${schema}"`);
  let failures = 0;
  console.log(`\n── ${schema}`);
  for (const c of CHECKS) {
    let problems = [];
    try {
      const { rows } = await db.query(c.sql);
      problems = c.check ? c.check(rows) : rows.map(c.describe);
    } catch (e) {
      // A tenant without a table simply has nothing to check there.
      if (!/does not exist/i.test(e.message)) problems = [`check failed: ${e.message}`];
    }
    if (problems.length === 0) {
      console.log(`   ok    ${c.name}`);
    } else {
      failures++;
      console.log(`   FAIL  ${c.name} — ${problems.length} problem(s)`);
      problems.slice(0, 5).forEach((p) => console.log(`           ${p}`));
      if (problems.length > 5) console.log(`           ... and ${problems.length - 5} more`);
    }
  }
  return failures;
}

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database}`);
  try {
    let schemas = [ONE];
    if (ALL) {
      const { rows } = await db.query(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%' ORDER BY 1`);
      schemas = rows.map((r) => r.nspname);
    }
    let total = 0;
    for (const s of schemas) total += await runFor(db, s);
    console.log(total === 0 ? '\nAll checks passed.' : `\n${total} check(s) failed.`);
    process.exitCode = total === 0 ? 0 : 1;
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
