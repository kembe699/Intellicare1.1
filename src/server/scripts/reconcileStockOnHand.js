/**
 * Bring an item's on-hand quantity back in line with the stock recorded against it.
 *
 * Receiving stock writes a batch and raises the item's quantity_on_hand together.
 * Stock loaded straight into the database — a migration, a bulk import — writes the
 * batches and leaves the item untouched, and nothing notices: the batch rows look
 * healthy, the item quietly reads zero, and the first sign of trouble is a
 * pharmacist told a drug is out of stock while the shelf in front of them is full.
 *
 * That is what happened on nation. Every dispensing gate reads quantity_on_hand,
 * so items holding real stock in batches could not be dispensed or billed at all.
 *
 * Only understatement is corrected. An item whose on-hand exceeds its batches is
 * left alone and reported: that direction means stock left without a batch to
 * account for it, which is a counting question for a human, not something to
 * silently write down.
 *
 *   node src/server/scripts/reconcileStockOnHand.js --schema tenant_nation
 *   node src/server/scripts/reconcileStockOnHand.js --schema tenant_nation --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const si = args.indexOf('--schema');
const SCHEMA = si >= 0 ? args[si + 1] : null;

if (!SCHEMA) {
  console.error('Usage: reconcileStockOnHand.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

const DB = {
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  ssl: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase())
    ? { rejectUnauthorized: false } : false,
};

async function main() {
  const db = new Client(DB);
  await db.connect();
  await db.query(`SET search_path TO "${SCHEMA}", public`);

  console.log(`\n  schema: ${SCHEMA}`);
  console.log(`  mode:   ${APPLY ? 'APPLY (stock will change)' : 'dry run (no writes)'}\n`);

  const { rows } = await db.query(`
    WITH batch_stock AS (
      SELECT item_id, SUM(quantity_received - COALESCE(quantity_used, 0)) AS held
        FROM inventory_batches
       WHERE COALESCE(status, 'active') <> 'retired'
       GROUP BY item_id
    )
    SELECT ii.id, ii.item_code, ii.item_name,
           ii.quantity_on_hand AS on_hand,
           COALESCE(b.held, 0)  AS in_batches
      FROM inventory_items ii
      LEFT JOIN batch_stock b ON b.item_id = ii.id
     WHERE ii.quantity_on_hand <> COALESCE(b.held, 0)
     ORDER BY (COALESCE(b.held, 0) - ii.quantity_on_hand) DESC
  `);

  const understated = rows.filter((r) => Number(r.in_batches) > Number(r.on_hand));
  const overstated = rows.filter((r) => Number(r.in_batches) < Number(r.on_hand));

  if (understated.length === 0 && overstated.length === 0) {
    console.log('  Every item agrees with its batches. Nothing to reconcile.\n');
    await db.end();
    return;
  }

  let restored = 0;
  if (understated.length) {
    console.log('  code        item                                         on hand   batches   restoring');
    console.log('  ' + '-'.repeat(88));
    for (const r of understated) {
      const gain = Number(r.in_batches) - Number(r.on_hand);
      restored += gain;
      console.log(
        `  ${String(r.item_code || '').padEnd(11)} ${String(r.item_name || '').slice(0, 42).padEnd(44)}` +
        `${String(r.on_hand).padStart(7)}   ${String(r.in_batches).padStart(7)}   ${String('+' + gain).padStart(9)}`
      );
      if (APPLY) {
        await db.query('UPDATE inventory_items SET quantity_on_hand = $1 WHERE id = $2', [r.in_batches, r.id]);
      }
    }
  }

  console.log('');
  console.log(`  ${understated.length} item(s) ${APPLY ? 'restored' : 'would be restored'}, ${restored} unit(s) in total.`);

  if (overstated.length) {
    console.log(`\n  ${overstated.length} item(s) hold more on hand than their batches account for. Left alone —`);
    console.log('  stock without a batch behind it needs counting, not overwriting:');
    for (const r of overstated.slice(0, 10)) {
      console.log(`    ${String(r.item_code || '').padEnd(11)} ${String(r.item_name || '').slice(0, 40).padEnd(42)} on hand ${r.on_hand}, batches ${r.in_batches}`);
    }
  }

  if (!APPLY) console.log('\n  Re-run with --apply to write.\n');
  else console.log('');

  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
