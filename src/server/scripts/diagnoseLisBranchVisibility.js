/**
 * Read-only diagnostic — no writes. Run this when a non-admin user can't
 * see an LIS request that an admin on "All Branches" can.
 *
 * backfillLisBranchId.js's dry run on tenant_nation came back "0 of 207
 * without a branch" — so the earlier NULL-branch_id bug is not what's
 * happening here; every row already has SOME branch_id. This script checks
 * the next most likely explanation: the branch_id on these rows doesn't
 * match the branch a non-admin user is actually scoped to (e.g. a stale/
 * duplicate/inactive branch row, or a user whose own branch assignment
 * points somewhere unexpected) — anything that would make
 * `WHERE branch_id = :theUsersBranchId` exclude rows that genuinely exist.
 *
 *   node src/server/scripts/diagnoseLisBranchVisibility.js --schema tenant_nation
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

const args = process.argv.slice(2);
const si = args.indexOf('--schema');
const SCHEMA = si >= 0 ? args[si + 1] : null;

if (!SCHEMA) {
  console.error('Usage: diagnoseLisBranchVisibility.js --schema <tenant_schema>');
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

  console.log(`\n  schema: ${SCHEMA}\n`);

  console.log('  == branches (ALL, including inactive) ==');
  const { rows: branches } = await db.query(
    `SELECT id, name, is_active, is_main_branch FROM branches ORDER BY id`
  );
  for (const b of branches) {
    console.log(`    id=${b.id}  active=${b.is_active}  main=${b.is_main_branch}  "${b.name}"`);
  }

  console.log('\n  == distinct branch_id values actually on lis_test_orders ==');
  const { rows: orderBranches } = await db.query(
    `SELECT branch_id, COUNT(*) AS cnt FROM lis_test_orders GROUP BY branch_id ORDER BY cnt DESC`
  );
  for (const r of orderBranches) {
    const known = branches.some((b) => String(b.id) === String(r.branch_id));
    console.log(`    branch_id=${r.branch_id}  ${r.cnt} order(s)  ${known ? '' : '  <-- NOT a row in branches at all'}`);
  }

  console.log('\n  == distinct branch_id values actually on lis_specimens ==');
  const { rows: specimenBranches } = await db.query(
    `SELECT branch_id, COUNT(*) AS cnt FROM lis_specimens GROUP BY branch_id ORDER BY cnt DESC`
  );
  for (const r of specimenBranches) {
    const known = branches.some((b) => String(b.id) === String(r.branch_id));
    console.log(`    branch_id=${r.branch_id}  ${r.cnt} specimen(s)  ${known ? '' : '  <-- NOT a row in branches at all'}`);
  }

  console.log('\n  == which branch each user actually resolves to ==');
  console.log('  (users.branch_id = their default/home branch; user_branches = extra branches granted)');
  const { rows: users } = await db.query(`
    SELECT u.id, u.display_name, u.role, u.branch_id AS home_branch_id,
           array_agg(DISTINCT ub.branch_id) FILTER (WHERE ub.branch_id IS NOT NULL) AS extra_branch_ids
    FROM users u
    LEFT JOIN user_branches ub ON ub.user_id = u.id
    WHERE u.is_active IS NOT FALSE
    GROUP BY u.id, u.display_name, u.role, u.branch_id
    ORDER BY u.role, u.display_name
  `);
  for (const u of users) {
    const flag = u.role !== 'admin' && !u.home_branch_id && (!u.extra_branch_ids || u.extra_branch_ids.length === 0) ? '  <-- NO branch assigned at all' : '';
    console.log(`    [${u.role}] ${u.display_name} (id=${u.id})  home_branch_id=${u.home_branch_id}  extra=${u.extra_branch_ids || '[]'}${flag}`);
  }

  console.log('\n  == 10 most recent lis_test_orders (what a "new request" actually looks like) ==');
  const { rows: recent } = await db.query(`
    SELECT o.id, o.branch_id, o.status, o.created_at, p.first_name, p.last_name
    FROM lis_test_orders o LEFT JOIN lis_participants p ON p.id = o.participant_id
    ORDER BY o.created_at DESC LIMIT 10
  `);
  for (const r of recent) {
    console.log(`    ${r.created_at ? new Date(r.created_at).toISOString() : '(no date)'}  branch_id=${r.branch_id}  status=${r.status}  ${r.first_name || ''} ${r.last_name || ''} (order ${r.id})`);
  }

  console.log('');
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
