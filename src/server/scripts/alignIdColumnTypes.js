#!/usr/bin/env node
/**
 * Convert varchar/char foreign-key columns that hold numeric ids to integer.
 *
 * MySQL happily compared '70' to 70; PostgreSQL does not, so any join between
 * one of these columns and an integer primary key fails outright with
 * "operator does not exist: character varying = integer" — a 500, not a wrong
 * answer. The pharmacy prescriptions list was one of these.
 *
 * The conversion was originally done by hand on the development database and
 * never captured anywhere, so production kept the varchar types and the two
 * environments silently diverged: the same query worked locally and 500'd
 * live. This script is that missing migration, written down and repeatable.
 *
 * Columns holding display names or emails (patient_bills.created_by,
 * general_ledger.created_by, daily_expenses.created_by, ...) are deliberately
 * NOT in this list — they are varchar on purpose.
 *
 * Safety: every column is checked before it is touched. A column is converted
 * only if every non-blank value matches ^[0-9]+$ once trimmed; anything else is
 * reported and skipped, so a column that has since acquired a name or an email
 * can never be destroyed by this running again. Blank strings become NULL,
 * which is what they always meant. Idempotent — an already-integer column is
 * skipped.
 *
 *   node src/server/scripts/alignIdColumnTypes.js --all-tenants
 *   node src/server/scripts/alignIdColumnTypes.js --all-tenants --apply
 *   node src/server/scripts/alignIdColumnTypes.js --schema tenant_demo --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

// Snapshotted before any require that might reload dotenv with override:true.
const DB_ENV = {
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  ssl: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase()),
};

// table -> columns that reference an integer primary key.
const TARGETS = {
  admission_requests: ['clinic_id', 'requested_by'],
  audit_logs: ['user_id'],
  beds: ['clinic_id'],
  daily_expense_approvals: ['user_id'],
  doctor_notes: ['clinic_id', 'doctor_id'],
  drug_administrations: ['clinic_id', 'nurse_id'],
  goods_receipt_notes: ['inspected_by', 'received_by'],
  inpatient_admissions: ['admitted_by_user_id', 'attending_doctor_id', 'clinic_id'],
  inpatient_lab_requests: ['clinic_id', 'doctor_id'],
  inpatient_prescriptions: ['clinic_id', 'doctor_id'],
  inpatient_radiology_requests: ['clinic_id', 'doctor_id'],
  lab_results: ['performed_by'],
  lis_results: ['recorded_by'],
  nursing_notes: ['clinic_id', 'nurse_id'],
  password_reset_tokens: ['user_id'],
  pharmacy_audit_log: ['action_by'],
  pharmacy_prescriptions: ['doctor_id'],
  purchase_orders: ['created_by'],
  purchase_requisitions: ['approved_by', 'created_by', 'requested_by'],
  rooms: ['clinic_id'],
  supplier_bill_approvals: ['user_id'],
  user_branches: ['user_id'],
  wards: ['clinic_id'],
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

async function alignSchema(db, schema) {
  let converted = 0, skipped = 0, already = 0;

  for (const [table, columns] of Object.entries(TARGETS)) {
    const { rows: [tbl] } = await db.query(
      `SELECT 1 AS ok FROM pg_tables WHERE schemaname=$1 AND tablename=$2`, [schema, table]
    );
    if (!tbl) continue;

    for (const column of columns) {
      const { rows: [col] } = await db.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
        [schema, table, column]
      );
      if (!col) continue;
      if (!['character varying', 'character', 'text'].includes(col.data_type)) { already++; continue; }

      // Refuse to touch a column holding anything that is not an id.
      const { rows: [chk] } = await db.query(
        `SELECT count(*) FILTER (WHERE "${column}" IS NOT NULL
                                   AND btrim("${column}") <> ''
                                   AND btrim("${column}") !~ '^[0-9]+$') AS bad,
                (SELECT btrim("${column}") FROM "${schema}"."${table}"
                  WHERE "${column}" IS NOT NULL AND btrim("${column}") <> ''
                    AND btrim("${column}") !~ '^[0-9]+$' LIMIT 1) AS sample
           FROM "${schema}"."${table}"`
      );
      if (Number(chk.bad) > 0) {
        console.log(`   ⚠ ${table}.${column}: SKIPPED — ${chk.bad} non-numeric value(s), e.g. ${JSON.stringify(chk.sample)}`);
        skipped++;
        continue;
      }

      if (!APPLY) {
        console.log(`   · ${table}.${column}: ${col.data_type} → integer`);
        converted++;
        continue;
      }

      try {
        // A string DEFAULT (often '') cannot be cast to integer and makes
        // ALTER ... TYPE fail outright, so it is dropped first. These columns
        // are plain foreign keys — NULL is the right absence value, and the
        // old '' default only ever meant "unset".
        await db.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" DROP DEFAULT`);
        // btrim first: CHAR(n) values are blank-padded, and '70   '::integer
        // throws. NULLIF turns the empty string back into the NULL it meant.
        await db.query(
          `ALTER TABLE "${schema}"."${table}"
             ALTER COLUMN "${column}" TYPE integer
             USING NULLIF(btrim("${column}"), '')::integer`
        );
        console.log(`   ✓ ${table}.${column}: ${col.data_type} → integer`);
        converted++;
      } catch (err) {
        console.log(`   ✗ ${table}.${column}: ${err.message}`);
        skipped++;
      }
    }
  }
  return { converted, skipped, already };
}

async function main() {
  if (!ALL && (!ONE || !validSchema(ONE))) {
    console.error('Usage: alignIdColumnTypes.js (--schema <tenant_schema> | --all-tenants) [--apply]');
    process.exit(1);
  }
  const db = new Client(connConfig());
  await db.connect();
  try {
    console.log(`target: ${DB_ENV.user}@${DB_ENV.host}:${DB_ENV.port}/${DB_ENV.database}${DB_ENV.ssl ? ' (ssl)' : ''}`);
    if (!APPLY) console.log('[dry run — nothing written]');

    let schemas = [ONE];
    if (ALL) {
      const { rows } = await db.query(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\\_%' ORDER BY nspname`
      );
      schemas = rows.map((r) => r.nspname);
    }

    let total = 0;
    for (const s of schemas) {
      if (!validSchema(s)) continue;
      console.log(`\n── ${s}`);
      const { converted, skipped, already } = await alignSchema(db, s);
      console.log(`   ${APPLY ? 'converted' : 'would convert'}: ${converted} | skipped: ${skipped} | already integer: ${already}`);
      total += converted;
    }
    console.log(`\n${APPLY ? 'converted' : 'would convert'}: ${total} column(s)`);
    if (!APPLY && total) console.log('Re-run with --apply to write.');
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
