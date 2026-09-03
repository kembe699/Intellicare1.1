#!/usr/bin/env node
/**
 * Reduce a tenant's chart of accounts to the essential working set.
 *
 * The seeded catalogue is a full healthcare CoA (55 accounts) covering payroll
 * liabilities, fixed assets, depreciation and so on. A clinic actually posts to
 * a dozen of them; the rest are noise in every account picker.
 *
 * Accounts are DEACTIVATED, never deleted. Deleting would break foreign keys
 * from account_ledger / gl_line_items and silently rewrite financial history.
 * Deactivating hides them — ChartOfAccounts.tsx filters on is_active and offers
 * a "show inactive" checkbox — while leaving every posted entry intact, and any
 * account can be switched back on if a clinic grows into it.
 *
 * Two safety rules, both enforced rather than assumed:
 *   1. An account carrying ANY ledger or GL activity is never deactivated, even
 *      if it is not on the essential list.
 *   2. Every code in ESSENTIAL that the application posts to programmatically
 *      stays active, so no posting path can lose its target.
 *
 *   node src/server/scripts/leanChartOfAccounts.js --schema tenant_demo
 *   node src/server/scripts/leanChartOfAccounts.js --schema tenant_demo --apply
 *   node src/server/scripts/leanChartOfAccounts.js --all-tenants --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');
// Canonical account definitions, so a missing essential account is recreated
// with the same code/type/balance side the seeder would have given it.
const { healthcareChartOfAccounts: CATALOGUE } = require('./initializeChartOfAccounts');

// The working set. Each entry is here because the application posts to it, or
// because a clinic's day-to-day bookkeeping needs it.
const ESSENTIAL = {
  '1100': 'Cash — referenced by receipts//deposits posting',
  '1105': 'Cash at Hand — cashier collections, the busiest account',
  '1110': 'Bank Account - Main — bankings and transfers',
  '1200': 'Accounts Receivable - Patients — every unpaid bill posts here',
  '1210': 'Insurance Receivables — scheme/insurance bills post here',
  '1300': 'Medical Supplies Inventory — procurement receipts',
  '2100': 'Accounts Payable - Suppliers — supplier invoices',
  '2150': 'Patient Deposits Held — patient deposit liability',
  '3200': "Retained Earnings — required for a meaningful balance sheet",
  '4100': 'Patient Services Revenue — default revenue line for all billing',
  '5400': 'Office Supplies Expense — daily expenses',
  '5610': 'Foreign Exchange Gain/Loss — multi-currency settlement',
  '5700': 'Bad Debt Expense — write-offs',
  '5900': 'Miscellaneous Expenses — catch-all for daily expenses',
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all-tenants');
const si = args.indexOf('--schema');
const ONE = si !== -1 ? args[si + 1] : null;

const validSchema = (s) => /^[a-z_][a-z0-9_]{0,62}$/.test(s);

function connConfig() {
  const sslOn = ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase());
  return {
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    ...(sslOn ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

async function leanOne(db, schema) {
  const { rows } = await db.query(
    `SELECT coa.id, coa.account_code, coa.account_name, coa.is_active, coa.clinic_id,
            (SELECT count(*) FROM "${schema}".account_ledger al WHERE al.account_id = coa.id)
          + (SELECT count(*) FROM "${schema}".gl_line_items gl WHERE gl.account_id = coa.id) AS activity
       FROM "${schema}".chart_of_accounts coa
      ORDER BY coa.account_code`
  );

  const keep = [], disable = [], keptForActivity = [];
  for (const r of rows) {
    const essential = Object.hasOwn(ESSENTIAL, r.account_code);
    const used = Number(r.activity) > 0;
    if (essential) keep.push(r);
    else if (used) keptForActivity.push(r);          // safety rule 1
    else if (r.is_active) disable.push(r);
  }

  console.log(`\n── ${schema}: ${rows.length} accounts`);
  console.log(`   keep (essential):        ${keep.length}`);
  console.log(`   keep (has activity):     ${keptForActivity.length}`);
  console.log(`   deactivate:              ${disable.length}`);
  for (const r of keptForActivity) {
    console.log(`     • ${r.account_code} ${r.account_name} — kept, ${r.activity} posted entr(ies)`);
  }

  // An essential code missing from this tenant means a posting path has no
  // target. Create it from the canonical catalogue rather than only warning —
  // a tenant without, say, 5610 fails FX settlement at transaction time with no
  // clue why. (5610 went missing from every tenant provisioned after the
  // PostgreSQL move, because the boot-time repair that used to create it ran
  // MySQL's UUID() and its catch only warned.)
  const present = new Set(rows.map((r) => r.account_code));
  const clinicIds = [...new Set(rows.map((r) => r.clinic_id))];
  for (const code of Object.keys(ESSENTIAL)) {
    if (present.has(code)) continue;
    const def = CATALOGUE.find((a) => a.account_code === code);
    if (!def) { console.log(`     ⚠ MISSING ${code} and absent from the catalogue — cannot create`); continue; }
    if (!APPLY) { console.log(`     ⚠ MISSING essential account ${code} (${def.account_name}) — would create`); continue; }
    for (const cid of clinicIds.length ? clinicIds : [1]) {
      await db.query(
        `INSERT INTO "${schema}".chart_of_accounts
           (id, clinic_id, account_code, account_name, account_type, sub_account_type,
            balance_type, opening_balance, is_active, description, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, 0, TRUE, $7, NOW(), NOW())`,
        [cid, def.account_code, def.account_name, def.account_type,
         def.sub_account_type || null, def.balance_type, def.description || null]
      );
    }
    console.log(`     ✚ created missing essential account ${code} (${def.account_name})`);
  }

  if (APPLY && disable.length) {
    await db.query(
      `UPDATE "${schema}".chart_of_accounts SET is_active = false WHERE id = ANY($1::text[])`,
      [disable.map((r) => r.id)]
    );
    // Essential accounts are force-enabled: a tenant where one was switched off
    // by hand would otherwise keep failing to post with no visible reason.
    await db.query(
      `UPDATE "${schema}".chart_of_accounts SET is_active = true WHERE account_code = ANY($1::text[])`,
      [Object.keys(ESSENTIAL)]
    );
    console.log(`   ✅ applied — ${disable.length} deactivated, ${keep.length} essential confirmed active`);
  }
  return disable.length;
}

async function main() {
  if (!ALL && (!ONE || !validSchema(ONE))) {
    console.error('Usage: leanChartOfAccounts.js (--schema <tenant_schema> | --all-tenants) [--apply]');
    process.exit(1);
  }
  const db = new Client(connConfig());
  await db.connect();
  try {
    let schemas = [ONE];
    if (ALL) {
      const { rows } = await db.query(
        `SELECT nspname FROM pg_namespace
          WHERE nspname LIKE 'tenant\\_%' AND nspname <> 'tenant_test' ORDER BY nspname`
      );
      schemas = rows.map((r) => r.nspname);
    }
    if (!APPLY) console.log('[dry run — nothing written]');
    for (const s of schemas) {
      if (!validSchema(s)) continue;
      await leanOne(db, s);
    }
    if (!APPLY) console.log('\nRe-run with --apply to write.');
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
