#!/usr/bin/env node
/**
 * Dispense drugs that were sold on a bill and paid for, but never left stock.
 *
 * Drugs added straight onto a bill are dispensed when the bill is paid — but
 * only since that was built, and a few payments since were lost to a race on
 * the dispensing number. Those sales have no dispensing record and their stock
 * was never reduced. (scripts/dispensePaidBacklog.js caught up prescriptions;
 * this does the same for bill products.)
 *
 * A line qualifies when it is paid, not voided, names an inventory item by id,
 * carries no dispensing number, and the patient has no dispensing record for
 * that item since the bill. Left out, and listed for a person to decide:
 *   - pharmacy direct-sale bills (dispensed through their prescription);
 *   - items whose stock was adjusted after the sale (the adjustment may already
 *     account for it);
 *   - a bill where the dispense would also pick up lines not selected here.
 *
 * Uses the app's own dispenseBilledProducts — same stock, batch, store and
 * history writes as a payment taken today; records are dated today and noted
 * as a backlog catch-up. DRY RUN BY DEFAULT.
 *
 *   node src/server/scripts/dispenseBilledBacklog.js --schema tenant_nation [--since 2026-09-01]
 *   node src/server/scripts/dispenseBilledBacklog.js --schema tenant_nation --apply
 * Uses DATABASE_URL if set, else DB_* from src/server/.env / production.env.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });
const { Sequelize } = require('sequelize');
const { dispenseBilledProducts } = require('../services/autoDispense');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const SCHEMA = arg('--schema');
const SINCE = arg('--since') || '2026-09-01';
if (!SCHEMA || !/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  console.error('Usage: dispenseBilledBacklog.js --schema <tenant_schema> [--since YYYY-MM-DD] [--apply]');
  process.exit(1);
}
const DIRECT_SALE_NOTE = 'Auto-generated from pharmacy direct sale';

function connect() {
  const hooks = { async afterConnect(conn) { await conn.query(`SET search_path TO "${SCHEMA}", public`); } };
  if (process.env.DATABASE_URL) {
    const local = ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname);
    return new Sequelize(process.env.DATABASE_URL, { dialect: 'postgres', logging: false, hooks,
      dialectOptions: local ? {} : { ssl: { require: true, rejectUnauthorized: false } }, pool: { max: 4 } });
  }
  return new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD || '', {
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
    port: parseInt(process.env.DB_PORT || '5432', 10), dialect: 'postgres', logging: false, hooks,
    dialectOptions: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase()) ? { ssl: { require: true, rejectUnauthorized: false } } : {},
    pool: { max: 4 },
  });
}

async function main() {
  const sequelize = connect();
  console.log(`\n  schema: ${SCHEMA}   since: ${SINCE}   mode: ${APPLY ? 'APPLY (stock will move)' : 'dry run (no writes)'}\n`);

  // Every paid, unstamped product line that names an inventory item, with what blocks it (if anything).
  const [lines] = await sequelize.query(`
    SELECT b.id AS bill_id, b.bill_number, b.patient_id, b.patient_name, b.created_at, (x.ord - 1)::int AS idx,
           x.s->>'serviceName' AS name, ii.id AS item_id, ii.item_name, ii.quantity_on_hand::float AS stock,
           COALESCE(NULLIF(x.s->>'packQuantity', '')::numeric, NULLIF(x.s->>'quantity', '')::numeric, 1)::float AS packs,
           (COALESCE(b.notes, '') = :direct) AS direct_sale,
           EXISTS (SELECT 1 FROM dispensing_records dr WHERE dr.inventory_item_id::text = ii.id::text
                     AND dr.patient_id::text = b.patient_id::text AND dr.created_at >= b.created_at - interval '1 day') AS has_record,
           EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.item_id::text = ii.id::text
                     AND t.transaction_type IN ('adjustment', 'count', 'physical_count') AND t.created_at > b.created_at) AS adjusted_after
      FROM patient_bills b
      CROSS JOIN LATERAL jsonb_array_elements(b.services::jsonb) WITH ORDINALITY AS x(s, ord)
      JOIN inventory_items ii ON ii.id::text = x.s->>'serviceId'
     WHERE b.created_at >= :since AND b.status <> 'cancelled'
       AND COALESCE((x.s->>'isVoided')::boolean, false) = false
       AND (COALESCE((x.s->>'paid')::boolean, false) OR lower(COALESCE(x.s->>'status', '')) = 'paid')
       AND x.s->>'dispensingNumber' IS NULL
     ORDER BY b.created_at, x.ord`, { replacements: { since: SINCE, direct: DIRECT_SALE_NOTE } });

  const candidates = lines.filter((l) => !l.has_record);
  const byReason = { direct_sale: [], adjusted_after: [] };
  const todo = new Map(); // bill_id -> lines
  for (const l of candidates) {
    if (l.direct_sale) { byReason.direct_sale.push(l); continue; }
    if (l.adjusted_after) { byReason.adjusted_after.push(l); continue; }
    if (!todo.has(l.bill_id)) todo.set(l.bill_id, []);
    todo.get(l.bill_id).push(l);
  }

  // Lines the dispense would ALSO act on (already flagged, paid, unstamped, but not selected here).
  const [extras] = await sequelize.query(`
    SELECT b.id AS bill_id, (x.ord - 1)::int AS idx
      FROM patient_bills b CROSS JOIN LATERAL jsonb_array_elements(b.services::jsonb) WITH ORDINALITY AS x(s, ord)
     WHERE b.id::text IN (:ids) AND x.s->>'dispenseOnPayment' = 'true' AND x.s->>'dispensingNumber' IS NULL
       AND COALESCE((x.s->>'isVoided')::boolean, false) = false
       AND (COALESCE((x.s->>'paid')::boolean, false) OR lower(COALESCE(x.s->>'status', '')) = 'paid')`,
    { replacements: { ids: todo.size ? [...todo.keys()].map(String) : ['-'] } });
  const blocked = [];
  for (const e of extras) {
    const mine = todo.get(e.bill_id);
    if (mine && !mine.some((l) => l.idx === e.idx)) { blocked.push(e.bill_id); }
  }
  for (const id of new Set(blocked)) todo.delete(id);

  const total = [...todo.values()].flat();
  const short = total.filter((l) => l.stock < l.packs - 1e-9);
  console.log(`  paid product lines with no dispensing: ${candidates.length}`);
  console.log(`    to dispense now: ${total.length} line(s) on ${todo.size} bill(s), ${new Set(total.map((l) => l.item_id)).size} item(s)` +
    (short.length ? ` — ${short.length} will be skipped for lack of stock` : ''));
  console.log(`    left for review — direct-sale bills: ${byReason.direct_sale.length}, stock adjusted after the sale: ${byReason.adjusted_after.length}, bills with other pending lines: ${new Set(blocked).size}`);
  const perItem = new Map();
  for (const l of total) { const r = perItem.get(l.item_id) || { name: l.item_name, packs: 0, stock: l.stock }; r.packs += l.packs; perItem.set(l.item_id, r); }
  console.log('\n  stock that will come off, per item (top 25):');
  for (const r of [...perItem.values()].sort((a, b) => b.packs - a.packs).slice(0, 25)) {
    console.log(`    ${r.name.slice(0, 44).padEnd(44)} −${String(r.packs).padStart(5)}   (now ${r.stock})`);
  }
  if (byReason.adjusted_after.length) {
    console.log('\n  review — stock was adjusted after these sales:');
    for (const l of byReason.adjusted_after) console.log(`    ${l.bill_number} ${String(l.created_at).slice(4, 15)} ${l.item_name.slice(0, 40)} ×${l.packs}`);
  }

  if (!APPLY) { console.log('\n  Dry run — nothing written. Re-run with --apply.\n'); await sequelize.close(); return; }

  let dispensed = 0; let skipped = 0;
  for (const [billId, mine] of todo) {
    // Flag the selected lines for dispensing, then let the app's own routine dispense them.
    const [[bill]] = await sequelize.query('SELECT services FROM patient_bills WHERE id = :id', { replacements: { id: billId } });
    const services = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
    for (const l of mine) services[l.idx].dispenseOnPayment = true;
    await sequelize.query('UPDATE patient_bills SET services = :s WHERE id = :id', { replacements: { s: JSON.stringify(services), id: billId } });
    const result = await dispenseBilledProducts(sequelize, billId, null);
    dispensed += result.dispensed.length; skipped += result.skipped.length;
    const numbers = result.dispensed.map((d) => d.dispensingNumber);
    if (numbers.length) {
      await sequelize.query(
        `UPDATE dispensing_records SET dispensing_notes = :note WHERE dispensing_number IN (:numbers)`,
        { replacements: { note: `Backlog: sold and paid on ${mine[0].bill_number} (${String(mine[0].created_at).slice(4, 15)}) but stock was never reduced — dispensed by catch-up`, numbers } });
    }
    for (const s of result.skipped) console.log(`    skipped ${mine[0].bill_number} ${s.drug}: ${s.reason} (needed ${s.needed}, stock ${s.stock})`);
  }
  console.log(`\n  APPLIED: ${dispensed} line(s) dispensed, ${skipped} skipped.\n`);
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
