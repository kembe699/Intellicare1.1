#!/usr/bin/env node
/**
 * Re-point every identity/serial sequence at max(id) + 1.
 *
 * After the MySQL -> PostgreSQL migration every one of these sat at 1 while its
 * table already held rows, so the next INSERT collided with an existing primary
 * key: "duplicate key value violates unique constraint". It surfaced as
 * password reset failing, but it applied to 56 tables in the migrated tenant —
 * users, branches, daily_expenses, purchase_orders, cashier_shifts,
 * login_attempts — i.e. most things a hospital creates during a normal day.
 *
 * Rows loaded from the dump carry explicit ids, which does not advance a
 * sequence; only the converter's setval step does, and it did not survive into
 * the tenant schemas (the data was loaded into `public`, which was then renamed).
 *
 * Idempotent and safe to run repeatedly — it only ever moves a sequence forward
 * to match data that already exists, never backwards, and never touches rows.
 * Called at boot from index.js so a restored or newly-cloned schema cannot
 * silently carry the fault.
 *
 *   node src/server/scripts/resyncSequences.js                 # all tenant schemas + public
 *   node src/server/scripts/resyncSequences.js --schema tenant_demo
 *   node src/server/scripts/resyncSequences.js --dry-run
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

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

/**
 * @returns {Promise<number>} how many sequences were behind (and, unless
 *          dryRun, have now been corrected).
 */
async function resyncSchema(db, schema, { dryRun = false, quiet = false } = {}) {
  if (!validSchema(schema)) throw new Error(`Unsafe schema name: ${schema}`);

  const { rows: cols } = await db.query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN pg_tables t ON t.schemaname = c.table_schema AND t.tablename = c.table_name
      WHERE c.table_schema = $1
        AND (c.is_identity = 'YES' OR c.column_default LIKE 'nextval(%')`,
    [schema]
  );

  let fixed = 0;
  for (const { table_name, column_name } of cols) {
    const { rows: [seqRow] } = await db.query(
      `SELECT pg_get_serial_sequence($1, $2) AS seq`,
      [`"${schema}"."${table_name}"`, column_name]
    );
    const seq = seqRow?.seq;
    if (!seq) continue;

    const { rows: [{ mx }] } = await db.query(
      `SELECT max("${column_name}") AS mx FROM "${schema}"."${table_name}"`
    );
    if (mx === null) continue; // empty table — a sequence at 1 is correct

    const { rows: [{ last_value, is_called }] } = await db.query(`SELECT last_value, is_called FROM ${seq}`);
    const nextWouldBe = is_called ? BigInt(last_value) + 1n : BigInt(last_value);
    if (nextWouldBe > BigInt(mx)) continue; // already ahead of the data

    fixed++;
    if (!quiet) {
      console.log(`   ${dryRun ? '·' : '✓'} ${schema}.${table_name}.${column_name}: next ${nextWouldBe} → ${BigInt(mx) + 1n}`);
    }
    if (!dryRun) {
      // setval(..., max, true) means "max is used", so the next value is max+1.
      await db.query(`SELECT setval($1, $2, true)`, [seq, String(mx)]);
    }
  }
  return fixed;
}

async function resyncAll(opts = {}) {
  const db = new Client(connConfig());
  await db.connect();
  try {
    const { rows } = await db.query(
      `SELECT nspname FROM pg_namespace
        WHERE nspname = 'public' OR nspname LIKE 'tenant\\_%'
        ORDER BY nspname`
    );
    let total = 0;
    for (const { nspname } of rows) {
      if (!validSchema(nspname)) continue;
      total += await resyncSchema(db, nspname, opts);
    }
    return total;
  } finally {
    await db.end().catch(() => {});
  }
}

module.exports = { resyncSchema, resyncAll };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const si = args.indexOf('--schema');
  (async () => {
    if (si !== -1) {
      const db = new Client(connConfig());
      await db.connect();
      try {
        const n = await resyncSchema(db, args[si + 1], { dryRun });
        console.log(`\n${dryRun ? 'would fix' : 'fixed'}: ${n}`);
      } finally { await db.end().catch(() => {}); }
    } else {
      const n = await resyncAll({ dryRun });
      console.log(`\n${dryRun ? 'would fix' : 'fixed'}: ${n} sequence(s)`);
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
