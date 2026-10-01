#!/usr/bin/env node
/**
 * B1: give every existing patient_bills.services line item a stable line_id.
 *
 * void-item and payment posting used to identify "which line" purely by array
 * position — voiding an unpaid line does services.splice(index, 1), which
 * shifts every later index, and a payment page that fetched the bill a moment
 * before someone else voided/added a line could then mark the WRONG line as
 * paid because "index 3" no longer meant the same item. The fix
 * (patientBills.js, normalizeServices.js's ensureLineIds) assigns a line_id at
 * bill creation and add-services time going forward, and self-heals any bill
 * it next writes to — but a bill nobody touches again (fully paid, closed out)
 * would otherwise sit with no line_id forever, so this backfills every
 * existing row once, up front, rather than relying on organic self-heal alone.
 *
 * Idempotent: only ever ADDS a line_id to elements missing one — a line that
 * already has one (already-migrated, or self-healed since this was last run)
 * is left untouched, so running this twice changes nothing the second time.
 *
 * Safety: dry-run by default. Never run with --apply against production
 * without reviewing the dry-run output first.
 *
 *   node src/server/scripts/backfillBillLineIds.js --schema tenant_demo
 *   node src/server/scripts/backfillBillLineIds.js --schema tenant_demo --apply
 *   node src/server/scripts/backfillBillLineIds.js --all-tenants --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');
const { randomUUID } = require('crypto');

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

async function backfillOne(db, schema) {
  const { rows } = await db.query(
    `SELECT id, bill_number, services FROM "${schema}".patient_bills WHERE services IS NOT NULL`
  );

  let needsBackfill = 0, alreadyDone = 0, unparseable = 0, linesAdded = 0;

  for (const row of rows) {
    const services = normalize(row.services);
    if (!services) { unparseable++; continue; } // repairCorruptedBillServices.js's problem, not this script's
    if (services.length === 0) { alreadyDone++; continue; }

    const missing = services.filter((s) => !s || !s.line_id).length;
    if (missing === 0) { alreadyDone++; continue; }

    needsBackfill++;
    linesAdded += missing;
    if (needsBackfill <= 20) {
      console.log(`  ${row.bill_number}: ${missing}/${services.length} line(s) missing line_id`);
    }

    if (APPLY) {
      const withIds = services.map((s) => (s && s.line_id) ? s : { ...s, line_id: randomUUID() });
      await db.query(
        `UPDATE "${schema}".patient_bills SET services = $1 WHERE id = $2`,
        [JSON.stringify(withIds), row.id]
      );
    }
  }
  if (needsBackfill > 20) console.log(`  ... and ${needsBackfill - 20} more bill(s)`);

  console.log(`\n── ${schema}: ${rows.length} bill(s) with services`);
  console.log(`   already had line_id on every line: ${alreadyDone}`);
  console.log(`   ${APPLY ? 'backfilled' : 'would backfill'}: ${needsBackfill} bill(s), ${linesAdded} line(s)`);
  if (unparseable > 0) console.log(`   ⚠ unparseable (leave to repairCorruptedBillServices.js first): ${unparseable}`);
  return needsBackfill;
}

async function main() {
  if (!ALL && (!ONE || !validSchema(ONE))) {
    console.error('Usage: backfillBillLineIds.js (--schema <tenant_schema> | --all-tenants) [--apply]');
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
