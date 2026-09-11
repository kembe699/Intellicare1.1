/**
 * Bring a tenant's roles/privileges/role_privileges tables in line with the
 * real permission matrix in src/server/config/permissionsCatalog.js.
 *
 * Read-only by default. What it does, in order:
 *   1. Ensures the three tables exist.
 *   2. Upserts SYSTEM_ROLES (matches by role_key — a stray role row with the
 *      same key, e.g. a custom "pharmacy" role created via the UI before this
 *      ran, gets its name/description reconciled in place rather than
 *      colliding on the unique constraint).
 *   3. Upserts PRIVILEGES the same way.
 *   4. Deletes every privilege_key starting with 'page_' or 'approval_' — the
 *      old, pre-this-migration catalog, confirmed never enforced by anything
 *      (cascades to role_privileges, so this is safe even if a role had one
 *      of these "granted").
 *   5. For every catalog key that did NOT already exist in this schema
 *      before this run, seeds its DEFAULT_ROLE_PRIVILEGES grants. A key that
 *      already existed (i.e. a second run of this script after the initial
 *      rollout) is left alone — an admin may have deliberately customized it
 *      since, and this script must never silently revert that.
 *   6. Fixes the roles/privileges id sequences (provisionTenant.js copies
 *      rows with explicit ids without advancing the new schema's sequence —
 *      latent until the first real insert, which would otherwise collide).
 *
 *   node src/server/scripts/reconcileRolePrivileges.js --schema tenant_nation
 *   node src/server/scripts/reconcileRolePrivileges.js --schema tenant_nation --apply
 *   node src/server/scripts/reconcileRolePrivileges.js --all --apply
 *
 * Also importable as a module (see reconcileOnConnection) — used by
 * tests/integration/rolePrivileges.test.js against an already-open
 * connection, so the test suite exercises the exact same logic the CLI runs
 * in production rather than a re-implementation of it.
 */
const path = require('path');
const { ensureRolesTables } = require('../config/ensureRolesTables');
const { SYSTEM_ROLES, PRIVILEGES, DEFAULT_ROLE_PRIVILEGES } = require('../config/permissionsCatalog');

const ALL_TENANTS = ['tenant_nation', 'tenant_demo', 'tenant_gudele', 'tenant_template'];

/**
 * Runs the full reconcile against an already-open Sequelize connection whose
 * search_path is already pinned to the target schema. Never opens or closes
 * a connection itself — that's the caller's job (buildSequelize below for
 * the CLI, testDb.js's shared connection for the test suite).
 */
async function reconcileOnConnection(sequelize, { apply = false, label = '' } = {}) {
  console.log(`\n── ${label} ${apply ? '(apply)' : '(dry run)'} ──`);

  await ensureRolesTables(sequelize);

  const [existingPrivRows] = await sequelize.query('SELECT privilege_key FROM privileges');
  const existingKeysBefore = new Set(existingPrivRows.map(r => r.privilege_key));

  const t = apply ? await sequelize.transaction() : null;
  const opts = t ? { transaction: t } : {};

  try {
    let rolesUpserted = 0;
    for (const r of SYSTEM_ROLES) {
      if (apply) {
        await sequelize.query(
          `INSERT INTO roles (role_key, name, description, is_system)
           VALUES (:key, :name, :description, TRUE)
           ON CONFLICT (role_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = TRUE`,
          { replacements: { key: r.role_key, name: r.name, description: r.description || null }, ...opts }
        );
      }
      rolesUpserted++;
    }

    let privsUpserted = 0;
    for (const p of PRIVILEGES) {
      if (apply) {
        await sequelize.query(
          `INSERT INTO privileges (privilege_key, name, module, description)
           VALUES (:key, :name, :module, :description)
           ON CONFLICT (privilege_key) DO UPDATE SET
               name = EXCLUDED.name, module = EXCLUDED.module, description = EXCLUDED.description`,
          { replacements: { key: p.privilege_key, name: p.name, module: p.module || null, description: p.description || null }, ...opts }
        );
      }
      privsUpserted++;
    }

    const [oldRows] = await sequelize.query(
      `SELECT privilege_key FROM privileges WHERE privilege_key LIKE 'page\\_%' OR privilege_key LIKE 'approval\\_%'`
    );
    if (apply && oldRows.length > 0) {
      await sequelize.query(
        `DELETE FROM privileges WHERE privilege_key LIKE 'page\\_%' OR privilege_key LIKE 'approval\\_%'`,
        opts
      );
    }

    const newKeys = PRIVILEGES.map(p => p.privilege_key).filter(k => !existingKeysBefore.has(k));
    let grantsInserted = 0;
    for (const key of newKeys) {
      const roleKeys = DEFAULT_ROLE_PRIVILEGES[key] || [];
      if (roleKeys.length === 0) continue;
      if (apply) {
        const [[priv]] = await sequelize.query('SELECT id FROM privileges WHERE privilege_key = :key', { replacements: { key }, ...opts });
        if (!priv) continue;
        for (const roleKey of roleKeys) {
          const [[role]] = await sequelize.query('SELECT id FROM roles WHERE role_key = :roleKey', { replacements: { roleKey }, ...opts });
          if (!role) continue;
          await sequelize.query(
            'INSERT INTO role_privileges (role_id, privilege_id) VALUES (:roleId, :privilegeId) ON CONFLICT DO NOTHING',
            { replacements: { roleId: role.id, privilegeId: priv.id }, ...opts }
          );
          grantsInserted++;
        }
      } else {
        grantsInserted += roleKeys.length;
      }
    }

    if (apply) {
      for (const table of ['roles', 'privileges']) {
        await sequelize.query(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
          opts
        );
      }
      await t.commit();
    }

    const summary = { rolesUpserted, privsUpserted, oldRemoved: oldRows.length, newKeys: newKeys.length, grantsInserted };
    console.log(`  roles upserted:            ${rolesUpserted}`);
    console.log(`  privileges upserted:       ${privsUpserted}`);
    console.log(`  old page_*/approval_* removed: ${oldRows.length}`);
    console.log(`  new catalog keys this run: ${newKeys.length}`);
    console.log(`  grants ${apply ? 'inserted' : 'would insert'}:      ${grantsInserted}`);
    if (newKeys.length !== PRIVILEGES.length) {
      console.log(`  (${PRIVILEGES.length - newKeys.length} catalog key(s) already existed — their role_privileges were left untouched)`);
    }
    return summary;
  } catch (err) {
    if (t) await t.rollback();
    throw err;
  }
}

function buildSequelize(schema) {
  const { Sequelize } = require('sequelize');
  return new Sequelize(
    process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD || '',
    {
      host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
      port: parseInt(process.env.DB_PORT || '5432', 10),
      dialect: 'postgres',
      logging: false,
      dialectOptions: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase())
        ? { ssl: { require: true, rejectUnauthorized: false } } : {},
      hooks: { async afterConnect(conn) { await conn.query(`SET search_path TO "${schema}", public`); } },
      pool: { max: 4, min: 0, acquire: 30000, idle: 10000 },
    }
  );
}

async function reconcileSchema(schema, apply) {
  const sequelize = buildSequelize(schema);
  try {
    return await reconcileOnConnection(sequelize, { apply, label: schema });
  } finally {
    await sequelize.close();
  }
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const si = args.indexOf('--schema');
  const one = si !== -1 ? args[si + 1] : null;

  if (!all && !one) {
    console.error('Usage: reconcileRolePrivileges.js (--schema <tenant> | --all) [--apply]');
    process.exit(1);
  }

  const schemas = all ? ALL_TENANTS : [one];
  for (const schema of schemas) {
    await reconcileSchema(schema, apply);
  }
  if (!apply) console.log('\nRe-run with --apply to write.\n');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { reconcileOnConnection, reconcileSchema, ALL_TENANTS };
