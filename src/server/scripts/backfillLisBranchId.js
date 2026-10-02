/**
 * Give lis_test_orders/lis_specimens rows the branch they were created at.
 *
 * GET /specimens/pending and /specimens/history (the queries behind
 * /lis/collection) filter non-admins on a strict `branch_id = :branchId`,
 * and an admin bypasses that filter — a row left NULL is visible to admins
 * and to nobody else. Reported live against tenant "nation" (one branch,
 * "Main"): the admin on "All Branches" could see a new lab request, no
 * other user could. Root cause (see routes/patientBills.js's
 * createLisOrderForLabServices and routes/inpatient.js's
 * mirrorLabRequestToLis, both now fixed) was two creation paths that never
 * stamped branch_id at all.
 *
 * This script only repairs rows already stuck at NULL from before that
 * fix — it does nothing for new rows going forward.
 *
 * The branch is taken from the patient's own bill where one exists (that is
 * where the charge was actually raised, matched on participant_id =
 * patient_id — true for every row either broken path could have created),
 * and otherwise from the facility's only branch. A tenant with more than
 * one branch and no matching bill is left alone and reported: guessing
 * which site a sample was collected at is not a repair. Every
 * lis_specimens row inherits whatever its own order ends up with.
 *
 *   node src/server/scripts/backfillLisBranchId.js --schema tenant_nation
 *   node src/server/scripts/backfillLisBranchId.js --schema tenant_nation --apply
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
  console.error('Usage: backfillLisBranchId.js --schema <tenant_schema> [--apply]');
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
  console.log(`  mode:   ${APPLY ? 'APPLY (writing)' : 'dry run (no writes)'}\n`);

  const { rows: branches } = await db.query(
    `SELECT id, name FROM branches WHERE COALESCE(is_active, true) ORDER BY is_main_branch DESC NULLS LAST, id`
  );
  const soleBranch = branches.length === 1 ? branches[0] : null;

  console.log(`  ${branches.length} active branch(es): ${branches.map((b) => `${b.id} ${b.name}`).join(', ') || 'none'}`);
  if (!soleBranch) {
    console.log('  More than one branch — only orders whose patient has a bill can be placed.\n');
  }

  const report = async (label, table) => {
    const { rows: [r] } = await db.query(`
      SELECT COUNT(*) FILTER (WHERE branch_id IS NULL) AS missing, COUNT(*) AS total FROM ${table}
    `);
    console.log(`  ${label.padEnd(20)} ${r.missing} of ${r.total} without a branch`);
    return parseInt(r.missing, 10);
  };

  const before = {
    orders: await report('lis_test_orders', 'lis_test_orders'),
    specimens: await report('lis_specimens', 'lis_specimens'),
  };

  if (before.orders === 0 && before.specimens === 0) {
    console.log('\n  Nothing to place.\n');
    await db.end();
    return;
  }

  if (APPLY) {
    // The patient's own bill first: that is where the charge was actually
    // raised, and the two broken paths both insert with
    // participant_id = (the same) billData.patient_id / patient_id.
    await db.query(`
      UPDATE lis_test_orders o SET branch_id = b.branch_id
        FROM (SELECT DISTINCT ON (patient_id) patient_id, branch_id
                FROM patient_bills WHERE branch_id IS NOT NULL
               ORDER BY patient_id, created_at DESC) b
       WHERE o.branch_id IS NULL AND b.patient_id = o.participant_id
    `);
    if (soleBranch) {
      await db.query('UPDATE lis_test_orders SET branch_id = $1 WHERE branch_id IS NULL', [soleBranch.id]);
    }

    // A specimen belongs wherever its own order does.
    await db.query(`
      UPDATE lis_specimens s SET branch_id = o.branch_id
        FROM lis_test_orders o
       WHERE s.branch_id IS NULL AND o.id = s.order_id AND o.branch_id IS NOT NULL
    `);
    if (soleBranch) {
      await db.query('UPDATE lis_specimens SET branch_id = $1 WHERE branch_id IS NULL', [soleBranch.id]);
    }

    console.log('');
    await report('lis_test_orders', 'lis_test_orders');
    await report('lis_specimens', 'lis_specimens');
  }

  console.log(APPLY ? '' : '\n  Re-run with --apply to write.\n');
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
