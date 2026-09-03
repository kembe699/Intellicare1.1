#!/usr/bin/env node
/**
 * Find users who are scoped to a clinic or branch their tenant has no data in.
 *
 * Every query in this app is filtered by clinic_id, and most by branch_id too.
 * A user pointed at the wrong one does not get an error — they log in normally
 * and every screen is simply empty, which reads as "the data did not migrate"
 * rather than "this account is looking in the wrong place". That is precisely
 * how a pharmacy user in a freshly-migrated tenant saw an empty dispensing
 * screen while 558 inventory items sat in the schema.
 *
 * Reports by default; --fix repoints the offending users at the clinic and
 * branch the tenant's own records actually use.
 *
 *   node src/server/scripts/checkTenantScoping.js
 *   node src/server/scripts/checkTenantScoping.js --schema tenant_nation --fix
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
const FIX = args.includes('--fix');
const si = args.indexOf('--schema');
const ONE = si !== -1 ? args[si + 1] : null;
const valid = (s) => /^[a-z_][a-z0-9_]{0,62}$/.test(s);

/**
 * The clinic a tenant's records are actually filed under.
 *
 * Taken from the data rather than from a facilities row, because it is the data
 * that every screen filters against. Tables are weighted by row count so one
 * stray record cannot outvote a thousand real ones.
 */
async function dominantClinicId(db, schema) {
  const { rows } = await db.query(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN pg_tables t ON t.schemaname = $1 AND t.tablename = c.table_name
      WHERE c.table_schema = $1 AND c.column_name = 'clinic_id'
        AND c.data_type IN ('integer','bigint','smallint')
        AND c.table_name <> 'users'`,
    [schema]
  );
  const tally = new Map();
  for (const { table_name } of rows) {
    try {
      const { rows: counts } = await db.query(
        `SELECT clinic_id, count(*)::int AS n FROM "${schema}"."${table_name}"
          WHERE clinic_id IS NOT NULL GROUP BY clinic_id`
      );
      for (const c of counts) tally.set(c.clinic_id, (tally.get(c.clinic_id) || 0) + c.n);
    } catch { /* table not readable — skip */ }
  }
  if (tally.size === 0) return null;
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function checkSchema(db, schema) {
  const clinicId = await dominantClinicId(db, schema);
  const { rows: [mainBranch] } = await db.query(
    `SELECT id FROM "${schema}".branches WHERE is_active IS NOT FALSE
      ORDER BY is_main_branch DESC, id ASC LIMIT 1`
  ).catch(() => ({ rows: [] }));

  const { rows: users } = await db.query(
    `SELECT u.id, u.email, u.role, u.clinic_id, u.branch_id,
            (SELECT count(*) FROM "${schema}".branches b WHERE b.id = u.branch_id)::int AS branch_ok
       FROM "${schema}".users u ORDER BY u.id`
  );

  const wrongClinic = clinicId == null ? [] : users.filter((u) => u.clinic_id !== clinicId);
  const wrongBranch = users.filter((u) => u.branch_id != null && u.branch_ok === 0);

  console.log(`\n── ${schema}`);
  console.log(`   data sits under clinic_id: ${clinicId ?? '(no data yet)'}   main branch: ${mainBranch?.id ?? 'none'}`);
  if (!wrongClinic.length && !wrongBranch.length) {
    console.log('   ✓ every user is scoped to data that exists');
    return 0;
  }
  for (const u of wrongClinic) {
    console.log(`   ⚠ ${u.email} (${u.role}) is on clinic_id ${u.clinic_id} — this tenant's data is under ${clinicId}; every screen will be empty`);
  }
  for (const u of wrongBranch) {
    console.log(`   ⚠ ${u.email} (${u.role}) points at branch ${u.branch_id}, which does not exist`);
  }

  if (!FIX) return wrongClinic.length + wrongBranch.length;

  for (const u of wrongClinic) {
    await db.query(`UPDATE "${schema}".users SET clinic_id = $1 WHERE id = $2`, [clinicId, u.id]);
  }
  if (mainBranch) {
    for (const u of wrongBranch) {
      await db.query(`UPDATE "${schema}".users SET branch_id = $1 WHERE id = $2`, [mainBranch.id, u.id]);
      await db.query(
        `INSERT INTO "${schema}".user_branches (user_id, branch_id, is_primary, created_at, updated_at)
         VALUES ($1, $2, TRUE, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, mainBranch.id]
      );
    }
  }
  console.log(`   ✅ repaired ${wrongClinic.length + wrongBranch.length} user(s)`);
  return 0;
}

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  try {
    console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database}${FIX ? '' : '   [report only]'}`);
    let schemas = [ONE];
    if (!ONE) {
      const { rows } = await db.query(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\\_%' AND nspname <> 'tenant_test' ORDER BY 1`
      );
      schemas = rows.map((r) => r.nspname);
    }
    let problems = 0;
    for (const s of schemas) {
      if (!valid(s)) continue;
      problems += await checkSchema(db, s);
    }
    if (problems && !FIX) console.log(`\n${problems} problem(s). Re-run with --fix to repair.`);
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
