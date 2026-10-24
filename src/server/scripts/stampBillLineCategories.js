#!/usr/bin/env node
/**
 * Stamps a category on every OLD bill line that predates category stamping.
 *
 * New bill lines carry `category` from the moment they are created
 * (BillDetails.tsx, DispensingWorkflow.tsx, clinical.js, TheatreService.js);
 * lines billed before that have none, so anything reporting "by department"
 * from bill lines (the Analytics Assistant) only saw a fraction of billing.
 *
 * For each line without a category this resolves, in order:
 *   1. its serviceId → services row      → category = services.category
 *   2. its serviceId → inventory_items   → category = 'Pharmacy / Inventory'
 *   3. its serviceId → lab_tests         → category = 'Laboratory'
 *   4. the same three by exact (case-insensitive, trimmed) name
 * and adds `category`, `categoryId` (the central Categories row, so the
 * department can be read live from Setup › Categories) and
 * `categorySource: 'backfill'`. Lines that already have a category only get
 * a missing `categoryId` filled in. Nothing else on a line changes — never
 * amounts, ids, paid/void flags or revenue accounts (account resolution
 * reads serviceId/name, not `category`, so later voids/payments post exactly
 * as before).
 *
 * Safety: dry run unless --apply; one transaction for the whole run; each
 * bill is only written if its stored lines are unchanged since they were
 * read (a bill being edited at that moment is skipped and reported).
 *
 *   node src/server/scripts/stampBillLineCategories.js --schema tenant_nation
 *   node src/server/scripts/stampBillLineCategories.js --schema tenant_nation --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const si = args.indexOf('--schema');
const SCHEMA = si !== -1 ? args[si + 1] : null;
if (!SCHEMA || !/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  console.error('Usage: stampBillLineCategories.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

const norm = (v) => String(v ?? '').trim().toLowerCase();

async function main() {
  const db = new Client({
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    ...(['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase()) ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await db.connect();
  const S = `"${SCHEMA}"`;
  try {
    const hasCatCol = async (t) => (await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'category_id'`, [SCHEMA, t])).rowCount > 0;
    const { rows: services } = await db.query(`SELECT id::text id, service_name, category, ${await hasCatCol('services') ? 'category_id::text' : 'NULL'} category_id FROM ${S}.services`);
    const { rows: items } = await db.query(`SELECT id::text id, item_name, ${await hasCatCol('inventory_items') ? 'category_id::text' : 'NULL'} category_id FROM ${S}.inventory_items`);
    const { rows: labs } = await db.query(`SELECT id::text id, test_name, category_id::text category_id FROM ${S}.lab_tests`).catch(() => ({ rows: [] }));
    const { rows: cats } = await db.query(`SELECT id::text id, type, name FROM ${S}.categories`).catch(() => ({ rows: [] }));
    const serviceCatByName = new Map(cats.filter((c) => c.type === 'service').map((c) => [norm(c.name), c.id]));

    const byId = new Map();
    const byName = new Map();
    const add = (id, name, v) => { if (id) byId.set(id, v); if (name && !byName.has(norm(name))) byName.set(norm(name), v); };
    // Name precedence matches AccountResolver.resolveLineAccounts: services, then lab tests, then items.
    for (const i of items) add(i.id, null, { category: 'Pharmacy / Inventory', categoryId: i.category_id || null });
    for (const l of labs) add(l.id, null, { category: 'Laboratory', categoryId: l.category_id || serviceCatByName.get('laboratory') || null });
    for (const s of services) add(s.id, null, { category: s.category || 'Other', categoryId: s.category_id || serviceCatByName.get(norm(s.category)) || null });
    for (const s of services) add(null, s.service_name, { category: s.category || 'Other', categoryId: s.category_id || serviceCatByName.get(norm(s.category)) || null });
    for (const l of labs) add(null, l.test_name, { category: 'Laboratory', categoryId: l.category_id || serviceCatByName.get('laboratory') || null });
    for (const i of items) add(null, i.item_name, { category: 'Pharmacy / Inventory', categoryId: i.category_id || null });

    const { rows: bills } = await db.query(`SELECT id::text id, services FROM ${S}.patient_bills`);
    let billsChanged = 0, linesStamped = 0, idsFilled = 0, unmatched = 0, skippedBusy = 0, amountStamped = 0;
    const unmatchedNames = new Map();
    const byCategory = new Map();

    if (APPLY) await db.query('BEGIN');
    for (const b of bills) {
      let lines;
      try { lines = JSON.parse(b.services || '[]'); } catch { continue; }
      if (!Array.isArray(lines)) continue;
      let changed = false;
      for (const line of lines) {
        if (!line || typeof line !== 'object') continue;
        const hit = byId.get(String(line.serviceId ?? line.service_id ?? '')) || byName.get(norm(line.serviceName ?? line.service_name ?? line.name));
        if (!line.category) {
          if (!hit) {
            unmatched++;
            const n = String(line.serviceName ?? line.name ?? '(no name)');
            unmatchedNames.set(n, (unmatchedNames.get(n) || 0) + 1);
            continue;
          }
          line.category = hit.category;
          if (hit.categoryId) line.categoryId = hit.categoryId;
          line.categorySource = 'backfill';
          linesStamped++;
          const amt = parseFloat(line.totalPrice ?? line.total_price ?? 0) || 0;
          amountStamped += amt;
          byCategory.set(hit.category, (byCategory.get(hit.category) || 0) + amt);
          changed = true;
        } else if (!line.categoryId) {
          const id = hit?.categoryId || serviceCatByName.get(norm(line.category)) || null;
          if (id) { line.categoryId = id; idsFilled++; changed = true; }
        }
      }
      if (!changed) continue;
      billsChanged++;
      if (APPLY) {
        const r = await db.query(`UPDATE ${S}.patient_bills SET services = $1 WHERE id::text = $2 AND services IS NOT DISTINCT FROM $3`, [JSON.stringify(lines), b.id, b.services]);
        if (r.rowCount === 0) { skippedBusy++; billsChanged--; }
      }
    }
    if (APPLY) await db.query('COMMIT');

    console.log(`── ${SCHEMA} ${APPLY ? '(APPLIED)' : '(dry run — nothing written)'}`);
    console.log(`  bills ${APPLY ? 'updated' : 'to update'}: ${billsChanged}${skippedBusy ? ` (skipped ${skippedBusy} edited during the run — re-run to catch them)` : ''}`);
    console.log(`  lines given a category: ${linesStamped} (SSP-equivalent ${amountStamped.toLocaleString()})`);
    console.log(`  lines that already had one, given its categoryId: ${idsFilled}`);
    console.log('  by category:', Object.fromEntries([...byCategory].map(([k, v]) => [k, Math.round(v)])));
    console.log(`  unmatched lines (left as they are): ${unmatched}`);
    if (unmatchedNames.size) console.log('   ', [...unmatchedNames].slice(0, 30).map(([n, c]) => `${n} ×${c}`).join('; '));
  } catch (e) {
    if (APPLY) await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
