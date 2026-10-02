#!/usr/bin/env node
/**
 * Repairs bills already stuck in the inconsistent state fixed going forward
 * in patientBills.js's POST /:billId/payments (see that file's comment on
 * the new safety-net block): the bill's own balance_amount is already 0
 * (status shows "paid"), but one or more of its service lines never got
 * their own `paid` flag set — a lump, unitemized payment that settled the
 * whole bill updated the aggregate paid_amount/balance_amount/status but
 * never touched the per-line flags. Reported case: a bill showed
 * Status: paid / Balance: SSP 0.00 while its "Appendectomy" line still
 * showed Status: Unpaid in the Bill Items table.
 *
 * This ONLY touches each affected line's paid/status/paidAt — it does NOT
 * recompute total_amount/paid_amount/balance_amount/status, which are
 * already correct in this specific broken state (that's exactly what makes
 * it detectable: balance_amount <= 0 but a payable line is still unpaid).
 *
 * Idempotent: only ever flips `paid: false/undefined` to `true` on a line
 * that qualifies — a line already marked paid, voided, invoiced, or an
 * unbilled-insurance placeholder (schemePrice set, unitPrice 0) is left
 * untouched, so running this twice changes nothing the second time.
 *
 * Safety: dry-run by default. Never run with --apply against production
 * without reviewing the dry-run output first.
 *
 *   node src/server/scripts/repairBillPaymentLineSync.js --schema tenant_demo
 *   node src/server/scripts/repairBillPaymentLineSync.js --schema tenant_demo --apply
 *   node src/server/scripts/repairBillPaymentLineSync.js --all-tenants --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

// Snapshotted before anything else is required — see leanChartOfAccounts.js's
// identical comment for why (requiring ../models here would silently
// re-point this at the developer's own .env database via dotenv's override).
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

/** Mirrors normalizeServices.js — unwraps however many layers of JSON
 * encoding a row has accumulated, without depending on requiring that file
 * (which would pull in ../models). */
function normalize(value) {
  let v = value;
  let guard = 0;
  while (typeof v === 'string' && guard < 8) {
    try { v = JSON.parse(v); } catch { return null; }
    guard++;
  }
  return Array.isArray(v) ? v : null;
}

// A real line-item object, not one of the stray non-object entries a
// corrupted `services` array can carry (see normalizeServices.js's own
// comment on the double-stringify bug that spreads a string into one
// "garbage" array element per character) — those must never be touched or
// counted as a straggling unpaid line.
function isRealLine(s) {
  return !!s && typeof s === 'object' && !Array.isArray(s)
    && (typeof s.serviceName === 'string' || typeof s.name === 'string' || typeof s.service_name === 'string');
}

function isUnbilledInsuranceLine(line) {
  return line.schemePrice != null && (parseFloat(line.unitPrice) || 0) === 0;
}

function isStragglingUnpaidLine(s) {
  return isRealLine(s) && !s.paid && !s.isVoided && !s.invoiced && !isUnbilledInsuranceLine(s);
}

async function repairOne(db, schema) {
  // status = 'paid' specifically (not just a zero balance) — a bill can
  // legitimately reach a zero balance for reasons that are NOT "collected
  // in cash" (written off, cancelled), and those must never have their
  // still-unpaid lines stamped paid:true. Also excludes anything billed to
  // a scheme/insurer as a whole (billing_type 'credit', or already
  // converted to an invoice) — those are settled through a completely
  // separate flow this script has no business touching.
  const { rows } = await db.query(
    `SELECT id, bill_number, services FROM "${schema}".patient_bills
     WHERE services IS NOT NULL AND status = 'paid'
       AND invoice_id IS NULL AND COALESCE(billing_type, 'cash') <> 'credit'`
  );

  let affectedBills = 0, affectedLines = 0, unparseable = 0;

  for (const row of rows) {
    const services = normalize(row.services);
    if (!services) { unparseable++; continue; }

    const straggling = services.filter(isStragglingUnpaidLine);
    if (straggling.length === 0) continue;

    affectedBills++;
    affectedLines += straggling.length;
    if (affectedBills <= 20) {
      console.log(`  ${row.bill_number}: ${straggling.length} line(s) still unpaid on a "paid" bill — ${straggling.map((s) => s.serviceName || s.name || s.service_name).join(', ')}`);
    }

    if (APPLY) {
      const now = new Date().toISOString();
      const repaired = services.map((s) => (
        isStragglingUnpaidLine(s)
          ? { ...s, paid: true, status: 'paid', paidAt: s.paidAt || now }
          : s
      ));
      await db.query(
        `UPDATE "${schema}".patient_bills SET services = $1 WHERE id = $2`,
        [JSON.stringify(repaired), row.id]
      );
    }
  }
  if (affectedBills > 20) console.log(`  ... and ${affectedBills - 20} more bill(s)`);

  console.log(`\n── ${schema}: ${rows.length} bill(s) marked "paid" (cash, not invoiced)`);
  console.log(`   ${APPLY ? 'repaired' : 'would repair'}: ${affectedBills} bill(s), ${affectedLines} line(s)`);
  if (unparseable > 0) console.log(`   ⚠ unparseable (leave to repairCorruptedBillServices.js first): ${unparseable}`);
  return affectedBills;
}

async function main() {
  if (!ALL && (!ONE || !validSchema(ONE))) {
    console.error('Usage: repairBillPaymentLineSync.js (--schema <tenant_schema> | --all-tenants) [--apply]');
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
      await repairOne(db, s);
    }
    if (!APPLY) console.log('\nRe-run with --apply to write.');
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
