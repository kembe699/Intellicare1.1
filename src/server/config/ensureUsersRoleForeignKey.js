/**
 * users.role had a hardcoded CHECK constraint (users_role_check) restricting it to
 * the 11 original system roles — so a custom role created via POST /api/roles (e.g.
 * "Branch Manager") could never actually be set as a user's primary role: Security.tsx's
 * role dropdown is fed live from GET /api/roles, which lists custom roles right
 * alongside system ones, so picking one there always failed with "new row for relation
 * users violates check constraint users_role_check" the moment PUT /api/users/:id tried
 * to save it. (A parallel bug — Sequelize's User model separately declared `role` as
 * DataTypes.ENUM with the same fixed list, validating client-side before the query was
 * even sent — is fixed alongside this in models/index.js.)
 *
 * Replaces the hardcoded CHECK with a proper FOREIGN KEY to roles(role_key): any role
 * that actually exists in this tenant's own roles table is valid, system or custom,
 * with no list to keep in sync by hand as roles are added. roles.js's own DELETE
 * /api/roles/:id already refuses to delete a role while any user still holds it as
 * their primary role (an app-level check, done first) — this FK is a correctness
 * backstop under that, not a new restriction.
 *
 * Same idempotent, per-tenant self-migration shape as the other ensureXxx.js files —
 * see tenantDb.js's buildTenantConnection for why this runs per tenant connection.
 * Existing role values are checked against this tenant's roles table before adding the
 * FK — a legacy value with no matching row would make the ALTER fail outright; this is
 * logged as a warning and skipped for that tenant rather than crashing its connection.
 */
async function ensureUsersRoleForeignKey(sequelize, label = 'database') {
  try {
    const [[tableCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'users'`
    );
    if (Number(tableCheck.cnt) === 0) return;
    const [[rolesTableCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'roles'`
    );
    if (Number(rolesTableCheck.cnt) === 0) return; // roles table not ensured yet — retried on next connection build

    const [[fkCheck]] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND contype = 'f' AND conname = 'users_role_fkey'
    `);
    if (Number(fkCheck.cnt) > 0) return; // already done

    const [orphans] = await sequelize.query(`
      SELECT u.id, u.role FROM users u WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.role_key = u.role)
    `);
    if (orphans.length > 0) {
      console.warn(
        `⚠️  [${label}] Skipping users.role → roles.role_key foreign key — ${orphans.length} user(s) hold a role ` +
        `with no matching row in roles (e.g. user ${orphans[0].id}, role "${orphans[0].role}"). Fix those users' roles manually, then this will apply on the next connection.`
      );
      return;
    }

    const [[checkConstraint]] = await sequelize.query(`
      SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c' AND conname = 'users_role_check'
    `);
    if (checkConstraint) {
      await sequelize.query(`ALTER TABLE users DROP CONSTRAINT "users_role_check"`);
    }
    await sequelize.query(`ALTER TABLE users ADD CONSTRAINT users_role_fkey FOREIGN KEY (role) REFERENCES roles(role_key)`);
    console.log(`✅ [${label}] users.role now references roles(role_key) — custom roles work as a primary role`);
  } catch (e) {
    console.warn(`[${label}] users.role foreign key migration warning:`, e.message);
  }
}

module.exports = { ensureUsersRoleForeignKey };
