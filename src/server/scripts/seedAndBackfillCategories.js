#!/usr/bin/env node
/**
 * Phase 2 of the central Categories feature (see docs/accounting-map/REPORT.md
 * and the approved plan). Two jobs, in order:
 *
 *   1. SEED — create one `categories` row per clinic for every entry in the
 *      five hard-coded lists this feature replaces (ItemMaster.tsx's
 *      CATEGORIES, Services.tsx's serviceCategories + the 5 regex-bucket
 *      pseudo-categories, DailyExpenses.tsx's EXPENSE_CATEGORIES), with each
 *      category's accounts set to EXACTLY what today's three independent
 *      resolution engines already produce for that category — see the
 *      SEED_* tables below, each comment citing the exact file:line the
 *      mapping was read from. This is a refactor of WHERE an account comes
 *      from, not WHICH account is used — Phase 3 (AccountResolver.js) is
 *      what actually switches the read path over.
 *
 *   2. BACKFILL — for inventory_items.item_category, services.category, and
 *      daily_expenses.category, match the existing free-text value
 *      (case-insensitive, trimmed) against a just-seeded category of the
 *      right type and set category_id. Never guesses: an unmatched value is
 *      reported, not forced onto the nearest-looking category.
 *
 * Two confirmed decisions baked in here (asked and answered before writing
 * this script):
 *   - Item categories 'equipment' and 'general' seed with NO cogs_account_id
 *     (today, a bill line for one of these is silently skipped by
 *     pharmacyCogsOnBill.js — CATEGORY_ACCOUNTS has no entry for either —
 *     so leaving it null is what's actually day-one identical; the
 *     inventory_account_id still seeds to 1300, matching GRN's real
 *     fallback, procurement.js:1953-1958).
 *   - Service category 'Examination' seeds with revenue_account_id = 4100
 *     (Patient Services Revenue), matching its ACTUAL current behavior —
 *     the regex engine only matches literal radio/imaging/xray/scan
 *     substrings and "examination" contains none of them, even though
 *     radiology.js treats it as a radiology-flavored category functionally.
 *
 * --dry-run (default): prints what WOULD happen, writes nothing.
 * --apply: actually writes.
 *
 * Usage:
 *   node src/server/scripts/seedAndBackfillCategories.js --schema tenant_demo
 *   node src/server/scripts/seedAndBackfillCategories.js --schema tenant_demo --apply
 *   node src/server/scripts/seedAndBackfillCategories.js --all-tenants --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

// Snapshotted before any other require touches ../models/config/database.js,
// same reasoning as leanChartOfAccounts.js's own comment on this.
const DB_ENV = {
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  ssl: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase()),
};

function slug(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Item categories — src/pages/inventory/ItemMaster.tsx:62 ───────────────
// revenueCode is 4120 for EVERY item category, not just drugs — see
// resolveRevenueAccount.js:72-73: any inventory_items match (by id or name)
// forces category 'pharmacy' regardless of item_category, which resolves to
// 4120 via resolveRevenueAccount.js:14. cogsCode/invCode from
// pharmacyCogsOnBill.js:77-83's CATEGORY_ACCOUNTS map; equipment/general are
// absent from that map today (confirmed: a line for either is silently
// skipped, pharmacyCogsOnBill.js:150 `if (!accts) continue;`) — seeded with
// cogsCode: null to match. invCode for equipment/general taken from
// procurement.js:1953-1958's GRN fallback (binary: drugs→1310, else 1300).
const SEED_ITEM = [
  { name: 'Drugs', cogsCode: '5210', invCode: '1310', revenueCode: '4120' },
  { name: 'Reagents', cogsCode: '5220', invCode: '1300', revenueCode: '4120' },
  { name: 'Consumables', cogsCode: '5200', invCode: '1300', revenueCode: '4120' },
  { name: 'Supplies', cogsCode: '5200', invCode: '1300', revenueCode: '4120' },
  { name: 'Surgical', cogsCode: '5200', invCode: '1300', revenueCode: '4120' },
  { name: 'Equipment', cogsCode: null, invCode: '1300', revenueCode: '4120' },
  { name: 'General', cogsCode: null, invCode: '1300', revenueCode: '4120' },
];

// ── Service categories — src/pages/setup/Services.tsx:111-121 (9) plus the
// 5 regex-bucket pseudo-categories resolveRevenueAccount.js's callers
// actually use (revenueCategory strings / lab_tests-match / radiology.js's
// category filter) that have no entry in Services.tsx's own dropdown.
// revenueCode traced by applying resolveRevenueAccount.js:13-18's regex to
// the category name itself (first match wins, order matters) — see the
// per-row comment for which branch matched.
const SEED_SERVICE = [
  { name: 'Consultation', revenueCode: '4105' },   // /consult/ → consult branch
  { name: 'Procedure', revenueCode: '4140' },       // /proced/ → procedure branch
  { name: 'Nursing', revenueCode: '4100' },         // no match ('nursing care' required, not bare 'nursing') → default
  { name: 'Surgery', revenueCode: '4140' },         // /surgery/ → procedure branch
  { name: 'Diagnostic', revenueCode: '4110' },      // /diagnostic/ → lab branch
  { name: 'Examination', revenueCode: '4100' },     // confirmed decision — matches actual current behavior, not 4130
  { name: 'Therapy', revenueCode: '4100' },         // no match → default
  { name: 'Emergency', revenueCode: '4100' },       // no match → default
  { name: 'Other', revenueCode: '4100' },           // no match → default
  { name: 'Laboratory', revenueCode: '4110' },      // /laboratory/ → lab branch
  { name: 'Radiology', revenueCode: '4130' },       // /radio/ → radiology branch
  { name: 'Pharmacy', revenueCode: '4120' },        // /pharma/ → pharmacy branch
  { name: 'Inpatient', revenueCode: '4150' },       // /inpatient/ → inpatient branch
  { name: 'Theatre', revenueCode: '4140' },         // /theatre/ → procedure branch
];

// ── Expense categories — src/pages/procurement/DailyExpenses.tsx:48,
// mapped 1:1 from daily-expenses.js:45-64's CATEGORY_EXPENSE_CODE
// (DEFAULT_EXPENSE_CODE 5900 for 'Other', which has no explicit map entry).
const SEED_EXPENSE = [
  { name: 'Doctor Fees', expenseCode: '5110' },
  { name: 'Allowance', expenseCode: '5120' },
  { name: 'Office Supplies', expenseCode: '5400' },
  { name: 'Administrative Expenses', expenseCode: '5440' },
  { name: 'Utilities', expenseCode: '5310' },
  { name: 'Maintenance', expenseCode: '5330' },
  { name: 'Transport', expenseCode: '5800' },
  { name: 'Catering', expenseCode: '5440' },
  { name: 'Medical Supplies', expenseCode: '5200' },
  { name: 'Cleaning', expenseCode: '5440' },
  { name: 'Security', expenseCode: '5440' },
  { name: 'Other', expenseCode: '5900' },
];

// ── Category → department (for "Income Statement by Department") ─────────
// Each seeded category is linked to the first of these department names the
// clinic actually has (case-insensitive). Only fills an EMPTY department_id —
// anything already set, by hand in Setup › Categories, is left alone. A
// category with no match stays unassigned and reports as "General".
const DEPT_CANDIDATES = {
  'item:Drugs': ['Pharmacy'],
  'item:Reagents': ['Laboratory', 'Lab'],
  'service:Consultation': ['OPD', 'Outpatient Department', 'Outpatient', 'Consultation'],
  'service:Procedure': ['Theatre', 'Surgery', 'Procedures', 'Procedure Room'],
  'service:Surgery': ['Surgery', 'Theatre'],
  'service:Theatre': ['Theatre', 'Surgery'],
  'service:Nursing': ['Nursing', 'Inpatient Department', 'Inpatient'],
  'service:Diagnostic': ['Laboratory', 'Lab'],
  'service:Laboratory': ['Laboratory', 'Lab'],
  'service:Examination': ['Radiology', 'Imaging'],
  'service:Radiology': ['Radiology', 'Imaging'],
  'service:Pharmacy': ['Pharmacy'],
  'service:Inpatient': ['Inpatient Department', 'Inpatient', 'IPD', 'Ward'],
  'service:Emergency': ['Emergency Department', 'Emergency', 'ER', 'Casualty'],
  'service:Therapy': ['Physiotherapy', 'Therapy'],
  'expense:Doctor Fees': ['Doctors', 'OPD'],
};

async function assignDepartments(db, schema, clinicId) {
  const { rows: depts } = await db.query(
    `SELECT id, department_name FROM "${schema}".departments WHERE (clinic_id = $1 OR clinic_id IS NULL) ORDER BY COALESCE(is_active, true) DESC, created_at`,
    [clinicId]
  );
  const byName = new Map();
  for (const d of depts) { const k = String(d.department_name).trim().toLowerCase(); if (!byName.has(k)) byName.set(k, d); }
  const done = [];
  for (const [key, names] of Object.entries(DEPT_CANDIDATES)) {
    const [type, name] = key.split(':');
    const dept = names.map((n) => byName.get(n.toLowerCase())).find(Boolean);
    if (!dept) continue;
    const { rows } = await db.query(
      `SELECT id FROM "${schema}".categories WHERE clinic_id = $1 AND type = $2 AND name = $3 AND department_id IS NULL`,
      [clinicId, type, name]
    );
    if (!rows.length) continue;
    if (APPLY) await db.query(`UPDATE "${schema}".categories SET department_id = $1, updated_at = NOW() WHERE id = $2`, [dept.id, rows[0].id]);
    done.push(`${type}/${name} → ${dept.department_name}`);
  }
  return done;
}

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

async function accountIdByCode(db, schema, clinicId, code) {
  if (!code) return null;
  const { rows } = await db.query(
    `SELECT id FROM "${schema}".chart_of_accounts WHERE clinic_id = $1 AND account_code = $2 AND is_active = true LIMIT 1`,
    [clinicId, code]
  );
  return rows[0]?.id || null;
}

async function seedOneType(db, schema, clinicId, type, defs, accountFields) {
  let created = 0, skipped = 0;
  const missingAccounts = [];
  for (const def of defs) {
    const { rows: existingRows } = await db.query(
      `SELECT id FROM "${schema}".categories WHERE clinic_id = $1 AND type = $2 AND name = $3 LIMIT 1`,
      [clinicId, type, def.name]
    );
    if (existingRows.length > 0) { skipped++; continue; }

    const accountIds = {};
    for (const field of accountFields) {
      const code = def[field.codeKey];
      const id = await accountIdByCode(db, schema, clinicId, code);
      if (code && !id) missingAccounts.push(`${type}/${def.name}: account code ${code} (${field.column}) not found/active for clinic ${clinicId}`);
      accountIds[field.column] = id;
    }

    if (!APPLY) { created++; continue; }
    await db.query(
      `INSERT INTO "${schema}".categories
         (id, clinic_id, name, code, type, revenue_account_id, cogs_account_id, inventory_account_id, expense_account_id, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)`,
      [uuidv4(), clinicId, def.name, slug(def.name), type,
       accountIds.revenue_account_id || null, accountIds.cogs_account_id || null,
       accountIds.inventory_account_id || null, accountIds.expense_account_id || null,
       defs.indexOf(def)]
    );
    created++;
  }
  return { created, skipped, missingAccounts };
}

// Whether a free-text value is RECOGNIZED is checked against the in-memory
// seed list (`seedNames`), not the live `categories` table — if this ran as
// part of the same --apply invocation as seeding, the row exists by the
// time this runs (seeding happens first, below); in a --dry-run, nothing
// was actually written yet, so checking the live table would make every
// single value look "unmatched" on a tenant's very first dry run, which is
// not an honest preview of what --apply would actually do. The live table
// is still the source of truth for the actual category id once writing.
async function backfillOneTable(db, schema, table, textColumn, type, seedNames) {
  const seedNameSet = new Set(seedNames.map((n) => n.toLowerCase()));
  const { rows } = await db.query(
    `SELECT DISTINCT ${textColumn} AS val FROM "${schema}".${table} WHERE ${textColumn} IS NOT NULL AND category_id IS NULL`
  );
  const matched = [];
  const unmatched = [];
  for (const { val } of rows) {
    if (!val || !String(val).trim()) continue;
    if (!seedNameSet.has(String(val).trim().toLowerCase())) { unmatched.push(val); continue; }

    if (!APPLY) {
      const { rows: countRows } = await db.query(
        `SELECT COUNT(*) AS c FROM "${schema}".${table} WHERE ${textColumn} = $1 AND category_id IS NULL`,
        [val]
      );
      matched.push({ value: val, rows: parseInt(countRows[0].c, 10) });
      continue;
    }

    // One category per (clinic_id, type, name) — update rows scoped to the
    // matching clinic so a multi-clinic schema never cross-wires categories.
    const { rows: catRows } = await db.query(
      `SELECT id, clinic_id FROM "${schema}".categories WHERE type = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))`,
      [type, val]
    );
    // Some production tenants' tables (e.g. services) have no clinic_id
    // column — one clinic per schema there. Match by clinic only when the
    // column exists; otherwise only when exactly one clinic has the category.
    const { rows: [hasClinic] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'clinic_id'`,
      [schema, table]
    );
    if (!hasClinic.n && catRows.length !== 1) { unmatched.push(`${val} (several clinics — needs a manual decision)`); continue; }
    for (const cat of catRows) {
      const { rowCount } = hasClinic.n
        ? await db.query(`UPDATE "${schema}".${table} SET category_id = $1 WHERE clinic_id = $2 AND ${textColumn} = $3 AND category_id IS NULL`, [cat.id, cat.clinic_id, val])
        : await db.query(`UPDATE "${schema}".${table} SET category_id = $1 WHERE ${textColumn} = $2 AND category_id IS NULL`, [cat.id, val]);
      matched.push({ value: val, rows: rowCount });
    }
  }
  return { matched, unmatched };
}

async function runOne(db, schema) {
  console.log(`\n── ${schema} ──`);
  const { rows: clinics } = await db.query(`SELECT DISTINCT clinic_id FROM "${schema}".chart_of_accounts`);
  const clinicIds = clinics.map((c) => c.clinic_id).length ? clinics.map((c) => c.clinic_id) : [1];

  const ITEM_FIELDS = [
    { codeKey: 'invCode', column: 'inventory_account_id' },
    { codeKey: 'cogsCode', column: 'cogs_account_id' },
    { codeKey: 'revenueCode', column: 'revenue_account_id' },
  ];
  const SERVICE_FIELDS = [{ codeKey: 'revenueCode', column: 'revenue_account_id' }];
  const EXPENSE_FIELDS = [{ codeKey: 'expenseCode', column: 'expense_account_id' }];

  for (const clinicId of clinicIds) {
    console.log(`  clinic ${clinicId}:`);
    const itemResult = await seedOneType(db, schema, clinicId, 'item', SEED_ITEM, ITEM_FIELDS);
    console.log(`    item categories      — created ${itemResult.created}, already existed ${itemResult.skipped}`);
    itemResult.missingAccounts.forEach((m) => console.log(`      ⚠ ${m}`));

    const serviceResult = await seedOneType(db, schema, clinicId, 'service', SEED_SERVICE, SERVICE_FIELDS);
    console.log(`    service categories   — created ${serviceResult.created}, already existed ${serviceResult.skipped}`);
    serviceResult.missingAccounts.forEach((m) => console.log(`      ⚠ ${m}`));

    const expenseResult = await seedOneType(db, schema, clinicId, 'expense', SEED_EXPENSE, EXPENSE_FIELDS);
    console.log(`    expense categories   — created ${expenseResult.created}, already existed ${expenseResult.skipped}`);
    expenseResult.missingAccounts.forEach((m) => console.log(`      ⚠ ${m}`));

    const linked = await assignDepartments(db, schema, clinicId);
    console.log(`    departments          — ${linked.length} categor${linked.length === 1 ? 'y' : 'ies'} ${APPLY ? 'linked' : 'would be linked'}${linked.length ? `: ${linked.join('; ')}` : ''}`);
  }

  // Backfill runs after seeding so this same invocation's newly-created
  // categories are immediately available to match against.
  const backfills = [
    ['inventory_items', 'item_category', 'item', SEED_ITEM.map((d) => d.name)],
    ['services', 'category', 'service', SEED_SERVICE.map((d) => d.name)],
    ['daily_expenses', 'category', 'expense', SEED_EXPENSE.map((d) => d.name)],
  ];
  for (const [table, column, type, seedNames] of backfills) {
    const { matched, unmatched } = await backfillOneTable(db, schema, table, column, type, seedNames);
    const totalRows = matched.reduce((s, m) => s + m.rows, 0);
    console.log(`  backfill ${table}.category_id — matched ${matched.length} distinct value(s), ${totalRows} row(s) ${APPLY ? 'updated' : 'would update'}`);
    if (unmatched.length) {
      console.log(`    ⚠ UNMATCHED (not touched, needs a manual decision): ${unmatched.map((u) => `"${u}"`).join(', ')}`);
    }
  }
}

async function main() {
  if (!ALL && (!ONE || !validSchema(ONE))) {
    console.error('Usage: seedAndBackfillCategories.js (--schema <tenant_schema> | --all-tenants) [--apply]');
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
      await runOne(db, s);
    }
    if (!APPLY) console.log('\nRe-run with --apply to write.');
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
