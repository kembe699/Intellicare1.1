#!/usr/bin/env node
/**
 * Repair patient_bills.services rows that were "exploded" character-by-character.
 *
 * Cause (already fixed in utils/normalizeServices.js): a services array that had
 * accumulated an extra layer of JSON encoding read back as a *string*, and a
 * caller spread it — `[...aString]` spreads characters, so each character of the
 * original JSON became its own array element. A voided line then landed as
 * `{"0":"[","isVoided":true}` (an object spread over a single character).
 *
 * Rows written before that fix cannot self-heal, because normalizeServices sees a
 * genuine array and has nothing to unwrap. They are recoverable, though: the
 * elements still spell out the original JSON text, so concatenating them and
 * re-parsing reconstructs the line items (sometimes through two layers, for rows
 * that were exploded twice).
 *
 * Safety: dry-run by default. With --apply it writes back ONLY rows whose
 * reconstruction reconciles against money already recorded on the bill — the
 * recovered line total must equal total_amount or paid_amount. A row that does
 * not reconcile has genuinely lost line items and is reported for a human to
 * settle; overwriting it would replace incomplete data with different incomplete
 * data and move the bill's total.
 *
 *   node src/server/scripts/repairCorruptedBillServices.js --schema tenant_demo
 *   node src/server/scripts/repairCorruptedBillServices.js --schema tenant_demo --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const schemaArg = args.indexOf('--schema');
const SCHEMA = schemaArg !== -1 ? args[schemaArg + 1] : null;

if (!SCHEMA || !/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  console.error('Usage: repairCorruptedBillServices.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

/** Characters of an exploded array, including the spread-mangled first element. */
function charsOf(arr) {
  const out = [];
  for (const el of arr) {
    if (typeof el === 'string') out.push(el);
    else if (el && typeof el === 'object' && typeof el['0'] === 'string') out.push(el['0']);
  }
  return out.join('');
}

/** Does this array look like exploded text rather than real line items? */
function looksExploded(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const sample = arr.slice(0, 20);
  return sample.every((x) => (typeof x === 'string' && x.length <= 2)
    || (x && typeof x === 'object' && typeof x['0'] === 'string'));
}

/** Peel however many explosion layers a row accumulated. */
function reconstruct(arr) {
  let current = arr;
  for (let depth = 0; depth < 4; depth++) {
    if (!looksExploded(current)) break;
    const text = charsOf(current);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Trailing bytes from an appended void marker: take the valid prefix.
      const end = text.lastIndexOf(']');
      if (end === -1) return null;
      try { parsed = JSON.parse(text.slice(0, end + 1)); } catch { return null; }
    }
    if (!Array.isArray(parsed)) return null;
    current = parsed;
  }
  return current.every((x) => x && typeof x === 'object' && !Array.isArray(x)) ? current : null;
}

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function main() {
  const sslOn = ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase());
  const db = new Client({
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    ...(sslOn ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await db.connect();

  try {
    const { rows } = await db.query(
      `SELECT id, bill_number, services, total_amount, paid_amount
         FROM "${SCHEMA}".patient_bills
        WHERE services IS NOT NULL AND services LIKE '[{"0":%'`
    );

    console.log(`${SCHEMA}: ${rows.length} corrupted bill(s)${APPLY ? '' : '  [dry run]'}\n`);
    let repaired = 0, skipped = 0;

    for (const row of rows) {
      let arr;
      try { arr = JSON.parse(row.services); } catch { arr = null; }
      const recovered = Array.isArray(arr) ? reconstruct(arr) : null;

      if (!recovered) {
        console.log(`  ✗ ${row.bill_number}: unrecoverable`);
        skipped++; continue;
      }

      const lineTotal = money(recovered.reduce(
        (s, x) => s + (x.isVoided ? 0 : (parseFloat(x.totalPrice) || 0)), 0));
      const total = money(row.total_amount);
      const paid = money(row.paid_amount);
      const reconciles = lineTotal === total || lineTotal === paid;

      const names = recovered.map((x) => x.serviceName || '?').join(', ');
      console.log(`  ${reconciles ? '✓' : '⚠'} ${row.bill_number}: ${recovered.length} line(s) [${names}]`);
      console.log(`      recovered ${lineTotal}  vs total ${total} / paid ${paid}`);

      if (!reconciles) {
        console.log('      SKIPPED — does not reconcile; line items were lost, needs a human');
        skipped++; continue;
      }

      if (APPLY) {
        await db.query(
          `UPDATE "${SCHEMA}".patient_bills SET services = $1 WHERE id = $2`,
          [JSON.stringify(recovered), row.id]
        );
        console.log('      written');
      }
      repaired++;
    }

    console.log(`\n${APPLY ? 'repaired' : 'repairable'}: ${repaired}   needs review: ${skipped}`);
    if (!APPLY && repaired > 0) console.log('Re-run with --apply to write these back.');
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
