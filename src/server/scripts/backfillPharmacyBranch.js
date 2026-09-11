/**
 * Give prescriptions and dispensing records the branch they were created at.
 *
 * Reads filter on branch_id and an admin bypasses that filter, so a row left NULL
 * is visible to admins and to nobody else. The pharmacist who dispensed a drug
 * could not find it in History, and the prescriptions list was empty for the very
 * role the page exists for — while an admin looking at the same screen saw
 * everything and could not reproduce the complaint.
 *
 * The branch is taken from the patient's own bill where there is one, since that
 * is where the charge was raised, and otherwise from the facility's only branch.
 * A tenant with more than one branch and no bill to go on is left alone and
 * reported: guessing which site a drug was handed over at is not a repair.
 *
 *   node src/server/scripts/backfillPharmacyBranch.js --schema tenant_nation
 *   node src/server/scripts/backfillPharmacyBranch.js --schema tenant_nation --apply
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
  console.error('Usage: backfillPharmacyBranch.js --schema <tenant_schema> [--apply]');
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
    console.log('  More than one branch — only rows whose patient has a bill can be placed.\n');
  }

  const report = async (label, table) => {
    const { rows: [r] } = await db.query(`
      SELECT COUNT(*) FILTER (WHERE branch_id IS NULL) AS missing, COUNT(*) AS total FROM ${table}
    `);
    console.log(`  ${label.padEnd(20)} ${r.missing} of ${r.total} without a branch`);
    return parseInt(r.missing, 10);
  };

  const before = {
    rx: await report('prescriptions', 'pharmacy_prescriptions'),
    disp: await report('dispensing records', 'dispensing_records'),
  };

  if (before.rx === 0 && before.disp === 0) {
    console.log('\n  Nothing to place.\n');
    await db.end();
    return;
  }

  if (APPLY) {
    // The patient's own bill first: that is where the charge was actually raised.
    await db.query(`
      UPDATE pharmacy_prescriptions p SET branch_id = b.branch_id
        FROM (SELECT DISTINCT ON (patient_id) patient_id, branch_id
                FROM patient_bills WHERE branch_id IS NOT NULL
               ORDER BY patient_id, created_at DESC) b
       WHERE p.branch_id IS NULL AND b.patient_id = p.patient_id
    `);
    if (soleBranch) {
      await db.query('UPDATE pharmacy_prescriptions SET branch_id = $1 WHERE branch_id IS NULL', [soleBranch.id]);
    }

    // A dispensing record belongs wherever its prescription does.
    await db.query(`
      UPDATE dispensing_records d SET branch_id = p.branch_id
        FROM pharmacy_prescriptions p
       WHERE d.branch_id IS NULL AND p.id = d.prescription_id AND p.branch_id IS NOT NULL
    `);
    if (soleBranch) {
      await db.query('UPDATE dispensing_records SET branch_id = $1 WHERE branch_id IS NULL', [soleBranch.id]);
    }

    console.log('');
    await report('prescriptions', 'pharmacy_prescriptions');
    await report('dispensing records', 'dispensing_records');
  }

  console.log(APPLY ? '' : '\n  Re-run with --apply to write.\n');
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
