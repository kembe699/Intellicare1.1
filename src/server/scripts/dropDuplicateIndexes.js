#!/usr/bin/env node
/**
 * Drop indexes that duplicate another index on the same table and columns.
 *
 * Two route handlers called Model.sync() on every request. Sequelize creates a
 * model's declared indexes when it thinks they are missing, and it names them
 * automatically — so each call added another copy: account_ledger ended up with
 * five identical (clinic_id, account_id, transaction_date) indexes and
 * general_ledger with thirteen duplicates in total. Every insert and update on
 * those tables maintained all of them.
 *
 * The sync() calls are gone. This removes what they left behind.
 *
 * Only exact duplicates go: same table, same column list, same uniqueness. The
 * oldest of each set is kept, since that is the one anything else may reference,
 * and a constraint-backed index is never dropped — dropping those would drop the
 * constraint with them.
 *
 * Dry-run by default.
 *
 *   node src/server/scripts/dropDuplicateIndexes.js --all
 *   node src/server/scripts/dropDuplicateIndexes.js --all --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

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
const ALL = args.includes('--all');
const si = args.indexOf('--schema');
const ONE = si !== -1 ? args[si + 1] : null;
if (!ALL && !ONE) {
  console.error('Usage: dropDuplicateIndexes.js (--schema <tenant> | --all) [--apply]');
  process.exit(1);
}

const FIND = `
  SELECT n.nspname AS schema, c.relname AS tbl, ic.relname AS idx,
         pg_relation_size(i.indexrelid) AS bytes
    FROM (
      SELECT indrelid, indexrelid, indisunique,
             ROW_NUMBER() OVER (
               PARTITION BY indrelid, indkey::text, indisunique, COALESCE(indpred::text, '')
               ORDER BY indexrelid
             ) AS rn
        FROM pg_index
    ) i
    JOIN pg_class c  ON c.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE i.rn > 1
     AND n.nspname = $1
     -- Never touch an index that backs a constraint: dropping it drops the
     -- constraint, and a primary or unique key is not a duplicate to clean up.
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid
     )
   ORDER BY 2, 3`;

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (no writes)\n');
  try {
    let schemas = [ONE];
    if (ALL) {
      const { rows } = await db.query(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%' ORDER BY 1`);
      schemas = rows.map((r) => r.nspname);
    }
    let total = 0, bytes = 0;
    for (const schema of schemas) {
      const { rows } = await db.query(FIND, [schema]);
      if (rows.length === 0) { console.log(`  ${schema}: none`); continue; }
      const size = rows.reduce((s, r) => s + Number(r.bytes), 0);
      console.log(`  ${schema}: ${rows.length} duplicate index(es), ${(size / 1024).toFixed(0)} kB`);
      total += rows.length; bytes += size;
      if (!APPLY) continue;
      for (const r of rows) {
        try {
          await db.query(`DROP INDEX IF EXISTS "${schema}"."${r.idx}"`);
        } catch (e) {
          console.error(`    could not drop ${r.idx}: ${e.message}`);
        }
      }
    }
    console.log(`\n${APPLY ? 'Dropped' : 'Would drop'} ${total} index(es), ${(bytes / 1024).toFixed(0)} kB.`);
    if (!APPLY) console.log('Re-run with --apply to write.');
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
