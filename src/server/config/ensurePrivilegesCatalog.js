/**
 * Keeps a tenant's privileges/roles/role_privileges rows in line with
 * src/server/config/permissionsCatalog.js automatically, on every tenant
 * connection build — so adding a privilege to the catalog (e.g. the HR
 * module keys) actually reaches production on the next deploy/restart
 * instead of silently sitting unseeded until someone remembers to run
 * scripts/reconcileRolePrivileges.js by hand against that tenant.
 *
 * Deliberately a *safe subset* of what that script does, not a wrapper
 * around it, because one part of the full reconcile is NOT safe to run
 * unattended and repeatedly: it upserts (INSERT ... ON CONFLICT DO UPDATE)
 * every SYSTEM_ROLES row's name/description on every run, but PUT
 * /api/roles/:id lets an admin rename ANY role, system roles included —
 * so doing that automatically would silently revert a deliberate rename
 * back to the catalog default the next time this tenant's connection is
 * rebuilt (e.g. after a server restart). This version only INSERTs a
 * missing role (ON CONFLICT DO NOTHING) and never touches one that
 * already exists.
 *
 * The rest carries no such risk and is safe to repeat indefinitely:
 *  - privilege name/module/description are upserted — nothing in the app
 *    lets an admin edit an existing catalog privilege's metadata (only
 *    ever add a brand new custom one), so there's nothing to overwrite.
 *  - default role_privileges grants are seeded ONLY for a privilege_key
 *    that did not exist in this schema before this run — exactly
 *    reconcileRolePrivileges.js's own rule, so a key an admin has since
 *    customized (checked/unchecked per role) is never touched again.
 *  - the confirmed-dead legacy "page_" and "approval_" prefixed privilege
 *    rows are removed (a no-op once they're already gone).
 *
 * An admin who genuinely wants every tenant's system role names forced
 * back to the catalog defaults still has reconcileRolePrivileges.js
 * --apply for that, run deliberately, reviewed via its dry-run output
 * first.
 */
const { SYSTEM_ROLES, PRIVILEGES, DEFAULT_ROLE_PRIVILEGES } = require('./permissionsCatalog');

async function ensurePrivilegesCatalog(sequelize) {
  const [existingPrivRows] = await sequelize.query('SELECT privilege_key FROM privileges');
  const existingKeysBefore = new Set(existingPrivRows.map((r) => r.privilege_key));

  for (const r of SYSTEM_ROLES) {
    await sequelize.query(
      `INSERT INTO roles (role_key, name, description, is_system)
       VALUES (:key, :name, :description, TRUE)
       ON CONFLICT (role_key) DO NOTHING`,
      { replacements: { key: r.role_key, name: r.name, description: r.description || null } }
    );
  }

  for (const p of PRIVILEGES) {
    await sequelize.query(
      `INSERT INTO privileges (privilege_key, name, module, description)
       VALUES (:key, :name, :module, :description)
       ON CONFLICT (privilege_key) DO UPDATE SET
           name = EXCLUDED.name, module = EXCLUDED.module, description = EXCLUDED.description`,
      { replacements: { key: p.privilege_key, name: p.name, module: p.module || null, description: p.description || null } }
    );
  }

  await sequelize.query(
    `DELETE FROM privileges WHERE privilege_key LIKE 'page\\_%' OR privilege_key LIKE 'approval\\_%'`
  );

  const newKeys = PRIVILEGES.map((p) => p.privilege_key).filter((k) => !existingKeysBefore.has(k));
  for (const key of newKeys) {
    const roleKeys = DEFAULT_ROLE_PRIVILEGES[key] || [];
    if (roleKeys.length === 0) continue;
    const [[priv]] = await sequelize.query('SELECT id FROM privileges WHERE privilege_key = :key', { replacements: { key } });
    if (!priv) continue;
    for (const roleKey of roleKeys) {
      const [[role]] = await sequelize.query('SELECT id FROM roles WHERE role_key = :roleKey', { replacements: { roleKey } });
      if (!role) continue;
      await sequelize.query(
        'INSERT INTO role_privileges (role_id, privilege_id) VALUES (:roleId, :privilegeId) ON CONFLICT DO NOTHING',
        { replacements: { roleId: role.id, privilegeId: priv.id } }
      );
    }
  }

  // New privileges split out of existing ones keep working for the same roles.
  const { ensurePrivilegeGrantCopies } = require('./ensurePrivilegeGrantCopies');
  await ensurePrivilegeGrantCopies(sequelize);
}

module.exports = { ensurePrivilegesCatalog };
