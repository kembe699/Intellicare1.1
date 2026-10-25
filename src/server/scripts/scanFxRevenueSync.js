#!/usr/bin/env node
/**
 * Find bills whose revenue the old bill-revenue sync cut wrongly. READ-ONLY.
 *
 * Before the fix, syncBillRevenueToGL compared a foreign-currency bill's own
 * total (USD 23.55) with its base-currency ledger (SSP 183,690) and posted a
 * "Revenue brought in line" entry reversing nearly all of it — on every
 * add-services, bill edit, item void and every 10-minute ledger sweep.
 *
 * For each tenant this lists every bill in a currency other than the tenant's
 * base that carries a bill_revenue_adjustment entry, or whose posted revenue
 * differs from its worth in base currency (total × the rate it was booked at):
 * the bill, its date, the wrong adjustments (date and accounts), and how much
 * revenue is missing in base currency. Totals per tenant.
 *
 * Runs inside a READ ONLY transaction: the database refuses any write.
 *
 *   DATABASE_URL=postgres://… node src/server/scripts/scanFxRevenueSync.js --all
 *   node src/server/scripts/scanFxRevenueSync.js --schema tenant_demo [--json out.json]
 * Without DATABASE_URL it uses DB_* from src/server/.env / production.env.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });
const fs = require('fs');
const { Client } = require('pg');
const { REVENUE_OR_TAX_ACCOUNT_SQL } = require('../utils/billTax');

const BILL_MODULES = `'patient_billing', 'bill_item_void', 'bill_revenue_adjustment'`;
// A foreign bill converted per account can be a cent out per account.
const TOLERANCE = 0.05;

function clientConfig() {
  if (process.env.DATABASE_URL) {
    const local = ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname);
    return { connectionString: process.env.DATABASE_URL, ssl: local ? undefined : { rejectUnauthorized: false } };
  }
  return {
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD || '',
    ssl: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase()) ? { rejectUnauthorized: false } : undefined,
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Scan one tenant schema on an open client. Returns { schema, base, bills, cancelled, totals }. */
async function scanTenant(c, schema) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error(`invalid schema ${schema}`);
  await c.query('BEGIN TRANSACTION READ ONLY');
  try {
    await c.query(`SET LOCAL search_path TO "${schema}", public`);
    const [{ code: base } = {}] = (await c.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`)).rows;
    if (!base) return { schema, base: null, bills: [], cancelled: [], totals: { bills: 0, missing: 0 } };

    const bills = (await c.query(`
      SELECT b.id, b.bill_number, b.bill_date, b.bill_currency, b.total_amount::float AS total, b.status,
             (SELECT gl.exchange_rate::float FROM general_ledger gl
               WHERE gl.reference_id = b.id::text AND gl.reference_module = 'patient_billing' AND gl.exchange_rate > 0
               ORDER BY gl.created_at ASC LIMIT 1) AS rate,
             COALESCE((SELECT SUM(al.credit_amount) - SUM(al.debit_amount)
                         FROM account_ledger al
                         JOIN chart_of_accounts c ON c.id = al.account_id AND ${REVENUE_OR_TAX_ACCOUNT_SQL}
                         JOIN general_ledger gl ON gl.id = al.transaction_id
                        WHERE gl.reference_id = b.id::text AND gl.reference_module IN (${BILL_MODULES})), 0)::float AS posted
        FROM patient_bills b
       WHERE b.bill_currency IS NOT NULL AND b.bill_currency <> $1
       ORDER BY b.bill_date, b.bill_number`, [base])).rows;
    if (!bills.length) return { schema, base, bills: [], cancelled: [], totals: { bills: 0, missing: 0 } };

    // Every revenue adjustment on those bills, per account, in base currency.
    const adj = (await c.query(`
      SELECT gl.reference_id AS bill_id, gl.gl_number, gl.transaction_date::date::text AS date, gl.created_at,
             c.account_code, c.account_name, (SUM(al.credit_amount) - SUM(al.debit_amount))::float AS revenue_change
        FROM general_ledger gl
        JOIN account_ledger al ON al.transaction_id = gl.id
        JOIN chart_of_accounts c ON c.id = al.account_id AND ${REVENUE_OR_TAX_ACCOUNT_SQL}
       WHERE gl.reference_module = 'bill_revenue_adjustment' AND gl.reference_id = ANY($1)
       GROUP BY 1, 2, 3, 4, 5, 6
       ORDER BY gl.created_at`, [bills.map((b) => String(b.id))])).rows;
    const adjByBill = new Map();
    for (const a of adj) {
      if (!adjByBill.has(a.bill_id)) adjByBill.set(a.bill_id, new Map());
      const byGl = adjByBill.get(a.bill_id);
      if (!byGl.has(a.gl_number)) byGl.set(a.gl_number, { gl_number: a.gl_number, date: a.date, accounts: [] });
      byGl.get(a.gl_number).accounts.push({ code: a.account_code, name: a.account_name, change: round2(a.revenue_change) });
    }

    const out = []; const cancelled = [];
    for (const b of bills) {
      const adjustments = [...(adjByBill.get(String(b.id))?.values() || [])];
      const adjusted = round2(adjustments.reduce((s, g) => s + g.accounts.reduce((t, x) => t + x.change, 0), 0));
      const worth = b.rate ? round2(b.total * b.rate) : null;
      const missing = worth == null ? null : round2(worth - b.posted);
      if (!adjustments.length && (missing == null || Math.abs(missing) < TOLERANCE)) continue;
      const row = {
        bill_id: b.id, bill_number: b.bill_number, bill_date: b.bill_date ? new Date(b.bill_date).toISOString().slice(0, 10) : null,
        status: b.status, currency: b.bill_currency, total: b.total, booked_rate: b.rate,
        worth_base: worth, posted_base: round2(b.posted), adjusted_base: adjusted, missing_base: missing, adjustments,
        needs_repair: missing != null && Math.abs(missing) >= TOLERANCE,
        note: b.rate ? undefined : 'no billing entry with a rate — worth unknown, review by hand',
      };
      (b.status === 'cancelled' ? cancelled : out).push(row);
    }
    const missingTotal = round2(out.reduce((s, r) => s + (r.missing_base || 0), 0));
    const byAccount = {};
    for (const r of out) for (const g of r.adjustments) for (const a of g.accounts) byAccount[a.code] = round2((byAccount[a.code] || 0) + a.change);
    return { schema, base, bills: out, cancelled, totals: { bills: out.length, needs_repair: out.filter((r) => r.needs_repair).length, missing: missingTotal, adjusted_by_account: byAccount } };
  } finally {
    await c.query('ROLLBACK').catch(() => {});
  }
}

async function listTenantSchemas(c) {
  return (await c.query(`SELECT schema_name FROM information_schema.schemata
                          WHERE schema_name LIKE 'tenant\\_%' AND schema_name <> 'tenant_template' ORDER BY 1`)).rows.map((r) => r.schema_name);
}

function printTenant(r) {
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  console.log(`\n■ ${r.schema}  (base ${r.base || '?'})  — ${r.totals.bills} bill(s), ${r.totals.needs_repair} need repair, revenue missing ${r.base || ''} ${fmt(r.totals.missing)}`);
  for (const b of r.bills) {
    console.log(`  ${b.bill_number}  ${b.bill_date}  ${b.currency} ${fmt(b.total)} @ ${b.booked_rate ?? '?'} = ${r.base} ${fmt(b.worth_base)} | posted ${fmt(b.posted_base)} | missing ${fmt(b.missing_base)}  [${b.needs_repair ? 'NEEDS REPAIR' : 'already right'}]${b.note ? '  ⚠ ' + b.note : ''}`);
    for (const g of b.adjustments) console.log(`      ${g.gl_number} ${g.date}: ${g.accounts.map((a) => `${a.code} ${fmt(a.change)}`).join(', ')}`);
  }
  if (r.cancelled.length) console.log(`  cancelled bills with adjustments (not totalled, review by hand): ${r.cancelled.map((b) => b.bill_number).join(', ')}`);
  if (r.totals.bills) console.log(`  revenue changed by those adjustments, per account: ${Object.entries(r.totals.adjusted_by_account).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}`);
}

async function main() {
  const args = process.argv.slice(2);
  const si = args.indexOf('--schema'); const ji = args.indexOf('--json');
  const one = si !== -1 ? args[si + 1] : null;
  if (!one && !args.includes('--all')) { console.error('Usage: scanFxRevenueSync.js (--schema <tenant> | --all) [--json file]'); process.exit(1); }
  const c = new Client({ ...clientConfig(), query_timeout: 120000 });
  await c.connect();
  try {
    const schemas = one ? [one] : await listTenantSchemas(c);
    const results = [];
    for (const s of schemas) {
      try { results.push(await scanTenant(c, s)); } catch (e) { results.push({ schema: s, error: e.message }); console.error(`✗ ${s}: ${e.message}`); }
    }
    for (const r of results) if (!r.error && (r.bills.length || r.cancelled.length)) printTenant(r);
    const clean = results.filter((r) => !r.error && !r.bills.length && !r.cancelled.length).map((r) => r.schema);
    console.log(`\nNo affected bills: ${clean.length ? clean.join(', ') : '—'}`);
    if (ji !== -1) fs.writeFileSync(args[ji + 1], JSON.stringify(results, null, 2));
  } finally { await c.end(); }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { scanTenant, listTenantSchemas, clientConfig };
