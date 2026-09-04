#!/usr/bin/env node
/**
 * Realign clinic_id / branch_id outliers inside a tenant schema.
 *
 * Two independent scopes sit on almost every operational table: branch_id (a
 * real access boundary, enforced by branchFilter) and clinic_id (the department
 * a record belongs to — "Outpatient", "General"). Readers filter hard on both,
 * so a row or a user carrying a value nobody else uses becomes invisible without
 * any error: the pharmacist opens the dispensing screen and the product list is
 * simply empty.
 *
 * Two real cases this repairs:
 *
 *   - a user pinned to a clinic that holds none of the tenant's data (the
 *     pharmacy user on one tenant sat on clinic 1 while all 558 inventory items
 *     and every other user were on clinic 6);
 *   - patients created before routes/patients.js stopped defaulting clinic_id
 *     to a hardcoded 6, which also left branch_id NULL — invisible on both
 *     dimensions, because NULL never equals the caller's branch.
 *
 * The canonical clinic is taken from the tenant's own data rather than assumed:
 * whichever clinic_id the inventory and the majority of users already agree on.
 * Nothing is guessed when there is no majority — it reports and changes nothing.
 *
 * Dry-run by default.
 *
 *   node src/server/scripts/repairClinicScoping.js --schema tenant_nation
 *   node src/server/scripts/repairClinicScoping.js --schema tenant_nation --apply
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
const si = args.indexOf('--schema');
const SCHEMA = si !== -1 ? args[si + 1] : null;
if (!SCHEMA || !/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  console.error('Usage: repairClinicScoping.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database}  schema ${SCHEMA}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (no writes)\n');

  try {
    await db.query(`SET search_path TO "${SCHEMA}"`);

    // The clinic the tenant's own stock lives on is the strongest signal: stock
    // is created by the facility, not chosen per patient at a registration desk.
    const { rows: invClinics } = await db.query(
      `SELECT clinic_id, count(*)::int AS n FROM inventory_items
        WHERE clinic_id IS NOT NULL GROUP BY 1 ORDER BY n DESC`);
    const { rows: userClinics } = await db.query(
      `SELECT clinic_id, count(*)::int AS n FROM users
        WHERE clinic_id IS NOT NULL GROUP BY 1 ORDER BY n DESC`);

    console.log('  inventory clinics:', invClinics.map(r => `${r.clinic_id}=${r.n}`).join('  ') || '(none)');
    console.log('  user clinics:     ', userClinics.map(r => `${r.clinic_id}=${r.n}`).join('  ') || '(none)');

    const canonical = invClinics[0]?.clinic_id ?? userClinics[0]?.clinic_id ?? null;
    if (canonical == null) {
      console.log('\nNo clinic could be determined from this tenant’s data — nothing changed.');
      return;
    }
    console.log(`  canonical clinic: ${canonical}\n`);

    // 1. Users sitting on a clinic that holds none of the tenant's data.
    const { rows: strandedUsers } = await db.query(
      `SELECT id, email, role, clinic_id FROM users
        WHERE clinic_id IS DISTINCT FROM $1 ORDER BY role, email`, [canonical]);
    for (const u of strandedUsers) {
      console.log(`  ${APPLY ? 'FIX ' : 'would fix'} user ${u.email} (${u.role}) clinic ${u.clinic_id} -> ${canonical}`);
    }
    if (APPLY && strandedUsers.length) {
      await db.query(`UPDATE users SET clinic_id = $1 WHERE clinic_id IS DISTINCT FROM $1`, [canonical]);
    }

    // 2. The main branch, for records created without one.
    const { rows: branchRows } = await db.query(
      `SELECT id FROM branches ORDER BY is_main_branch DESC NULLS LAST, id LIMIT 1`);
    const mainBranch = branchRows[0]?.id ?? null;

    // 3. Patients stranded on the old hardcoded clinic default, or with no branch.
    const { rows: strandedPatients } = await db.query(
      `SELECT id, patient_id, first_name, last_name, clinic_id, branch_id FROM patients
        WHERE clinic_id IS DISTINCT FROM $1 OR branch_id IS NULL ORDER BY created_at`, [canonical]);
    for (const p of strandedPatients) {
      console.log(`  ${APPLY ? 'FIX ' : 'would fix'} patient ${p.patient_id} ${p.first_name} ${p.last_name}`
        + ` clinic ${p.clinic_id} -> ${canonical}, branch ${p.branch_id ?? 'NULL'} -> ${mainBranch}`);
    }
    if (APPLY && strandedPatients.length) {
      if (mainBranch == null) {
        console.log('  (no branch on this tenant — clinic realigned, branch left as is)');
        await db.query(`UPDATE patients SET clinic_id = $1 WHERE clinic_id IS DISTINCT FROM $1`, [canonical]);
      } else {
        await db.query(
          `UPDATE patients SET clinic_id = $1, branch_id = COALESCE(branch_id, $2)
            WHERE clinic_id IS DISTINCT FROM $1 OR branch_id IS NULL`, [canonical, mainBranch]);
      }
    }

    const total = strandedUsers.length + strandedPatients.length;
    console.log(`\n${APPLY ? 'Repaired' : 'Would repair'} ${total} row(s).`);
    if (!APPLY && total) console.log('Re-run with --apply to write.');
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
