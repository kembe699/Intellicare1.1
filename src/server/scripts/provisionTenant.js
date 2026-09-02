#!/usr/bin/env node
// Provisions a brand-new tenant database for a newly-created client.
//
// Run as a standalone child process (spawned by routes/platform/clients.js),
// never in-process on the running server — that keeps each provisioning run
// fully isolated (its own env-driven DB connection, nothing shared with the
// server's tenant connection cache) and naturally serializes concurrent
// requests at the OS process level instead of needing app-level locking.
//
// Structure is cloned from the app's own current database (DB_NAME) via
// SHOW CREATE TABLE rather than replayed from the migration script list —
// that database's schema *is* the definition of "what a tenant looks like"
// (some tables here, e.g. branches/user_branches, were never captured by any
// of the individual migration scripts), so cloning it directly can never drift
// out of sync with what the running app actually expects. Zero rows are
// copied — only table/index/FK structure (plus clinic_names' data, see step 2b).
//
// Deliberately does this with plain SQL over the same mysql2 connections used
// everywhere else in this script, not by shelling out to the mysqldump/mysql
// CLI binaries — some managed hosting environments (Hostinger's Node.js app
// runner observed running from /opt/alt/alt-nodejs20/...) give spawned child
// processes an environment where those external binaries can't be found or
// run reliably, and a failure there produced no usable error output at all
// (the child died silently rather than through a catchable JS error). This
// works identically regardless of what's installed/spawnable on the host.
//
// Usage: node provisionTenant.js '<jsonArgs>'
// jsonArgs: { dbName, facilityName, adminName, adminEmail, adminPasswordHash }

const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: true });
try {
  if (os.userInfo().username !== 'levi96') {
    require('dotenv').config({ path: path.resolve(__dirname, '../production.env'), override: true });
  }
} catch (e) {
  require('dotenv').config({ path: path.resolve(__dirname, '../production.env'), override: true });
}

const mysql2 = require('mysql2/promise');

async function main() {
  const argJson = process.argv[2];
  if (!argJson) throw new Error('Usage: provisionTenant.js <jsonArgs>');
  const { dbName, facilityName, adminName, adminEmail, adminPasswordHash, dbUser, dbPassword } = JSON.parse(argJson);
  if (!dbName || !facilityName || !adminName || !adminEmail || !adminPasswordHash) {
    throw new Error('dbName, facilityName, adminName, adminEmail, adminPasswordHash are all required');
  }

  const rawHost = process.env.DB_HOST || '127.0.0.1';
  const host = rawHost === 'localhost' ? '127.0.0.1' : rawHost;
  const port = process.env.DB_PORT || '3306';
  // Source side: the app's own template database (DB_NAME), read via the
  // shared DB_USER — unrelated to the new tenant.
  const user = process.env.DB_USER;
  const pass = process.env.DB_PASSWORD || '';
  const templateDb = process.env.DB_NAME;
  // Target side: the new tenant's own database. On hosts where every
  // database has its own dedicated user with no cross-database grant (e.g.
  // Hostinger shared hosting), this must be that database's own user —
  // falls back to the shared DB_USER/DB_PASSWORD on hosts where one user
  // already has access to everything (matches tenantDb.js's resolution).
  const targetUser = dbUser || user;
  const targetPass = dbPassword ?? pass;

  // 1. Claim the pre-created, empty database — this script never runs
  // CREATE DATABASE itself. On hosts like Hostinger shared hosting, the
  // app's own DB user only has privileges scoped to databases it's already
  // been granted (via the host's own control panel), never the server-level
  // privilege CREATE DATABASE needs; provisioning a brand-new database has
  // to happen there first. See routes/platform/clients.js, which checks the
  // database exists (and returns a clear "create this first" error if not)
  // before ever invoking this script.
  const admin = await mysql2.createConnection({ host, port, user: targetUser, password: targetPass });
  try {
    const [schemaRows] = await admin.query(
      'SELECT 1 FROM information_schema.schemata WHERE schema_name = ?',
      [dbName]
    );
    if (schemaRows.length === 0) {
      throw new Error(`Database "${dbName}" doesn't exist yet — create it first, then retry`);
    }
    const [tableRows] = await admin.query(
      'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ?',
      [dbName]
    );
    if (tableRows[0].cnt > 0) {
      throw new Error(`Database "${dbName}" already has ${tableRows[0].cnt} table(s) — refusing to provision into a non-empty database`);
    }
  } finally {
    await admin.end();
  }

  // 2. Clone the template database's structure into it, table by table via
  // SHOW CREATE TABLE. FOREIGN_KEY_CHECKS=0 while creating — same technique
  // mysqldump itself uses — lets tables be created in any order regardless
  // of which ones reference each other, since InnoDB normally requires a
  // referenced table to already exist.
  const source = await mysql2.createConnection({ host, port, user, password: pass, database: templateDb });
  const target = await mysql2.createConnection({ host, port, user: targetUser, password: targetPass, database: dbName });
  try {
    const [tables] = await source.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
      [templateDb]
    );

    await target.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name: tableName } of tables) {
      const [[createRow]] = await source.query(`SHOW CREATE TABLE \`${tableName}\``);
      await target.query(createRow['Create Table']);
    }
    await target.query('SET FOREIGN_KEY_CHECKS = 1');

    // 2b. Clone clinic_names' DATA (not just structure) from the template
    // too. It's a tiny reference/lookup table, not tenant business data —
    // but a handful of routes across the app hardcode a fallback of
    // clinic_id 6 ("General", assuming the template's own setup), so every
    // new tenant needs the exact same rows for those fallbacks to resolve
    // instead of failing on a missing foreign key.
    const [clinicNameRows] = await source.query('SELECT * FROM clinic_names');
    if (clinicNameRows.length > 0) {
      const columns = Object.keys(clinicNameRows[0]);
      const columnList = columns.map((c) => `\`${c}\``).join(', ');
      const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
      const values = clinicNameRows.flatMap((row) => columns.map((col) => row[col]));
      await target.query(
        `INSERT INTO clinic_names (${columnList}) VALUES ${clinicNameRows.map(() => rowPlaceholder).join(', ')}`,
        values
      );
    }
  } finally {
    await source.end();
    await target.end();
  }

  // 3. Seed the client's first facility, main branch, and admin user.
  // clinic_id 6 ("General") matches the same hardcoded default used across
  // the app's route fallbacks (e.g. patients.js), not the new facility's own
  // id — so this tenant's records line up with those assumptions from day one.
  const DEFAULT_CLINIC_ID = 6;
  const tenant = await mysql2.createConnection({ host, port, user: targetUser, password: targetPass, database: dbName });
  try {
    const [facilityResult] = await tenant.query(
      `INSERT INTO facilities (name, type, address, phone, email, country, is_active, created_at, updated_at)
       VALUES (?, 'Hospital', 'Not set', 'Not set', ?, 'South Sudan', 1, NOW(), NOW())`,
      [facilityName, adminEmail]
    );
    const facilityId = facilityResult.insertId;

    const [branchResult] = await tenant.query(
      `INSERT INTO branches (facility_id, name, is_main_branch, is_active, created_at, updated_at)
       VALUES (?, 'Main Branch', 1, 1, NOW(), NOW())`,
      [facilityId]
    );
    const branchId = branchResult.insertId;

    const [userResult] = await tenant.query(
      `INSERT INTO users (email, password_hash, display_name, role, clinic_id, branch_id, status, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, ?, 'active', 1, NOW(), NOW())`,
      [adminEmail, adminPasswordHash, adminName, DEFAULT_CLINIC_ID, branchId]
    );
    const userId = userResult.insertId;

    await tenant.query(
      `INSERT INTO user_branches (user_id, branch_id, is_primary, created_at, updated_at)
       VALUES (?, ?, 1, NOW(), NOW())`,
      [String(userId), branchId]
    );

    // 4. Seed the standard healthcare chart of accounts for that same
    // default clinic — reuses the app's own existing "new clinic setup"
    // script rather than re-deriving the account list, run inside a tenant
    // context (see tenantContext.js) so its internal require('../models')
    // resolves to this brand-new database instead of the app's default one.
    const { buildSequelize } = require('../config/dbConnectionOptions');
    const { createModels } = require('../models');
    const tenantContext = require('../tenantContext');
    const { initializeChartOfAccounts } = require('./initializeChartOfAccounts');

    const tenantSequelize = buildSequelize(dbName, { user: targetUser, password: targetPass });
    try {
      const models = createModels(tenantSequelize);
      await tenantContext.run({ sequelize: tenantSequelize, models }, async () => {
        await initializeChartOfAccounts(DEFAULT_CLINIC_ID, String(userId));
      });
    } finally {
      await tenantSequelize.close();
    }
  } finally {
    await tenant.end();
  }

  console.log(JSON.stringify({ ok: true }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
