#!/usr/bin/env node
/**
 * Provision a new tenant as a PostgreSQL SCHEMA in the shared database.
 *
 * Mirrors how davinscs does it: control rows live in `public`, each tenant gets
 * its own schema, and isolation comes from search_path. Creating a schema needs
 * no elevated privilege, so this works on managed Postgres (Render, Neon,
 * Supabase) where the app's role cannot CREATE DATABASE — which is exactly what
 * blocked the previous database-per-tenant design from provisioning there.
 *
 * Structure is cloned from a template schema rather than re-derived from the
 * Sequelize models, because the models cover only a fraction of the ~200 tables
 * this app actually uses.
 *
 * Invoked as a child process by routes/platform/clients.js:
 *   node provisionTenant.js '{"schemaName":"...","facilityName":"...", ...}'
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const fs = require('fs');
const { Client } = require('pg');
const { assertValidSchema } = require('../config/dbConnectionOptions');

const TEMPLATE_SCHEMA = process.env.TENANT_TEMPLATE_SCHEMA || 'tenant_template';
const DEFAULT_CLINIC_ID = 1;

// Reference data every tenant starts with. These are catalogues and lookup
// tables, not anyone's records — and several are the target of foreign keys
// (patients.clinic_id -> clinic_names, role_privileges -> roles/privileges), so
// a tenant without them can't accept writes at all.
//
// Rows are copied from the template, which makes the template the single source
// of truth for "what a new instance starts with": adding another catalogue later
// means inserting it there, with no code change here.
const SEED_TABLES = (process.env.TENANT_SEED_TABLES ||
  'clinic_names,currencies,roles,privileges,role_privileges,lab_test_categories,chief_complaints'
).split(',').map((t) => t.trim()).filter(Boolean);

function connectionConfig() {
  const rawHost = process.env.DB_HOST || '127.0.0.1';
  const sslOn = ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase());
  return {
    host: rawHost === 'localhost' ? '127.0.0.1' : rawHost,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    ...(sslOn ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

/**
 * Copy every table from the template schema, then re-create the foreign keys.
 *
 * `LIKE ... INCLUDING ALL` brings across columns, defaults, identity/sequences,
 * check constraints, indexes and primary keys — but deliberately NOT foreign
 * keys, so those are replayed from pg_constraint in a second pass once all the
 * tables exist and can reference each other in any order.
 */
async function cloneSchema(db, template, target) {
  const { rows: tables } = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
    [template],
  );
  if (tables.length === 0) {
    throw new Error(`Template schema "${template}" has no tables — nothing to clone`);
  }

  for (const { tablename } of tables) {
    await db.query(
      `CREATE TABLE "${target}"."${tablename}" (LIKE "${template}"."${tablename}" INCLUDING ALL)`,
    );
  }

  const { rows: fks } = await db.query(
    `SELECT c.conrelid::regclass::text AS tbl, pg_get_constraintdef(c.oid) AS def, c.conname
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 AND c.contype = 'f'`,
    [template],
  );
  for (const fk of fks) {
    const table = fk.tbl.split('.').pop().replace(/"/g, '');
    // pg_get_constraintdef qualifies the referenced table with the template
    // schema when it isn't on the search_path; rewrite it to the new schema so
    // the copy references its own tables rather than the template's.
    const def = fk.def.replace(new RegExp(`"?${template}"?\\.`, 'g'), `"${target}".`);
    try {
      await db.query(`ALTER TABLE "${target}"."${table}" ADD CONSTRAINT "${fk.conname}" ${def}`);
    } catch (err) {
      // A foreign key that can't be replayed shouldn't abort provisioning —
      // report it and continue, so the tenant is usable and the gap is visible.
      console.error(`  ⚠ foreign key ${fk.conname} on ${table}: ${err.message}`);
    }
  }
  return tables.length;
}

/** Copy reference rows from the template into the freshly-created schema. */
async function seedReferenceData(db, template, target) {
  let copied = 0;
  for (const table of SEED_TABLES) {
    const { rows } = await db.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2`, [template, table],
    );
    if (rows.length === 0) continue;
    const res = await db.query(
      `INSERT INTO "${target}"."${table}" SELECT * FROM "${template}"."${table}"`,
    );
    copied += res.rowCount || 0;
  }
  return copied;
}

/**
 * Install the schema-level triggers a tenant needs.
 *
 * `LIKE ... INCLUDING ALL` in cloneSchema copies columns, defaults, indexes and
 * check constraints, but NOT triggers, and functions are schema objects that a
 * table clone never sees at all. So anything enforced by a trigger has to be
 * replayed here explicitly or a newly-provisioned tenant silently loses it —
 * which is exactly how a prescription header could drift from its lines.
 */
async function installTriggers(db, target) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../scripts/prescription_status_rollup.sql'), 'utf8',
  );
  await db.query(`SET search_path TO "${target}"`);
  await db.query(sql);
}

async function main() {
  const argJson = process.argv[2];
  if (!argJson) throw new Error('Usage: provisionTenant.js <jsonArgs>');
  const { schemaName, facilityName, adminName, adminEmail, adminPasswordHash } = JSON.parse(argJson);
  if (!schemaName || !facilityName || !adminName || !adminEmail || !adminPasswordHash) {
    throw new Error('schemaName, facilityName, adminName, adminEmail and adminPasswordHash are all required');
  }
  assertValidSchema(schemaName);
  assertValidSchema(TEMPLATE_SCHEMA);

  const db = new Client(connectionConfig());
  await db.connect();
  try {
    const { rows: existing } = await db.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [schemaName],
    );
    if (existing.length > 0) {
      throw new Error(`Schema "${schemaName}" already exists`);
    }

    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA "${schemaName}"`);
    const tableCount = await cloneSchema(db, TEMPLATE_SCHEMA, schemaName);
    const seededRows = await seedReferenceData(db, TEMPLATE_SCHEMA, schemaName);
    await installTriggers(db, schemaName);

    // Seed the minimum a usable instance needs: one facility, its main branch,
    // and the first admin who can sign in.
    await db.query(`SET search_path TO "${schemaName}", public`);

    // address/phone/email are NOT NULL with no default, so they're seeded with
    // blanks for the admin to fill in later. Note there is no .catch() on any
    // statement inside this transaction: in Postgres a failed statement aborts
    // the whole transaction, so swallowing the JS error only turns a clear
    // failure into "current transaction is aborted" on the next statement.
    await db.query(
      `INSERT INTO facilities (id, name, address, phone, email, created_at, updated_at)
       VALUES ($1, $2, '', '', '', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_CLINIC_ID, facilityName],
    );

    const branch = await db.query(
      // is_active must be set explicitly: the column defaults to FALSE, so a
      // main branch created without it is inactive, and every lookup that asks
      // for an active branch finds none. New users then get no branch at all
      // and sign in to "your account has not been assigned to a branch".
      `INSERT INTO branches (facility_id, name, is_main_branch, is_active, created_at, updated_at)
       VALUES ($1, $2, TRUE, TRUE, NOW(), NOW()) RETURNING id`,
      [DEFAULT_CLINIC_ID, `${facilityName} — Main Branch`],
    );
    const branchId = branch.rows[0].id;

    const user = await db.query(
      `INSERT INTO users (email, password_hash, display_name, role, clinic_id, branch_id, status, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 'admin', $4, $5, 'active', TRUE, NOW(), NOW()) RETURNING id`,
      [adminEmail.toLowerCase(), adminPasswordHash, adminName, DEFAULT_CLINIC_ID, branchId],
    );
    const userId = user.rows[0].id;

    await db.query(
      `INSERT INTO user_branches (user_id, branch_id, is_primary, created_at, updated_at)
       VALUES ($1, $2, TRUE, NOW(), NOW())`,
      [userId, branchId],
    );

    await db.query('COMMIT');

    // Chart of accounts is seeded after COMMIT: it's a large, non-essential
    // bootstrap, and a failure there shouldn't roll back a tenant that is
    // otherwise complete and loginable.
    try {
      const { initializeChartOfAccounts } = require('./initializeChartOfAccounts');
      const tenantContext = require('../tenantContext');
      const { buildSequelize } = require('../config/dbConnectionOptions');
      const { createModels } = require('../models');
      const tenantSequelize = buildSequelize(schemaName);
      try {
        const models = createModels(tenantSequelize);
        await tenantContext.run({ sequelize: tenantSequelize, models }, async () => {
          await initializeChartOfAccounts(DEFAULT_CLINIC_ID, String(userId));
        });
      } finally {
        await tenantSequelize.close();
      }
    } catch (coaErr) {
      console.error(`  ⚠ chart of accounts not seeded: ${coaErr.message}`);
    }

    console.log(JSON.stringify({ ok: true, schemaName, tables: tableCount, seededRows, userId }));
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    // The schema is created inside the transaction, so ROLLBACK removes it —
    // but drop defensively in case it was committed before a later failure.
    await db.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {});
    throw err;
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
