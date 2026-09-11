const { rolePrivilegesCache } = require('../cache');

// Loads { role_key -> Set(privilege_key) } for one tenant schema, cached —
// see src/server/config/permissionsCatalog.js for what a privilege key means
// and reconcileRolePrivileges.js for how role_privileges gets populated.
async function getRolePrivileges(sequelize, schema) {
  const cached = rolePrivilegesCache.get(schema);
  if (cached) return cached;

  const [rows] = await sequelize.query(`
    SELECT r.role_key, p.privilege_key
      FROM role_privileges rp
      JOIN roles r ON r.id = rp.role_id
      JOIN privileges p ON p.id = rp.privilege_id
  `);
  const map = new Map();
  for (const { role_key, privilege_key } of rows) {
    if (!map.has(role_key)) map.set(role_key, new Set());
    map.get(role_key).add(privilege_key);
  }
  rolePrivilegesCache.set(schema, map);
  return map;
}

// Role-based authorization middleware.
//
// Two call shapes, both supported at once so route files can be migrated one
// at a time with no window of inconsistent behavior:
//   authorize(['admin', 'accountant'])   — old shape: a literal role array,
//     checked exactly as before, no DB involved. Used for the handful of
//     gates that stay permanently hardcoded (roles.js's own mutation routes,
//     users.js create/delete, inventory's clear-all — see permissionsCatalog.js).
//   authorize('billing.write')           — new shape: a privilege key,
//     resolved against this tenant's role_privileges table (cached).
//
// admin always passes, unconditionally, before either path runs — matches
// the bypass already used everywhere else in this app (branchAccessControl,
// requireApprovalPermission) and guarantees an admin can never be locked out
// by a misconfigured or empty role_privileges table.
const authorize = (required) => async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role === 'admin') return next();

  if (Array.isArray(required)) {
    if (!required.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required,
        current: req.user.role,
      });
    }
    return next();
  }

  try {
    const sequelize = req.models?.sequelize;
    if (!sequelize || !req.tenantSchema) {
      // Should never happen — authenticateToken always sets both before any
      // authorize() middleware runs. Fail closed rather than guess.
      return res.status(503).json({ error: 'Could not verify permissions, please try again' });
    }
    const grants = await getRolePrivileges(sequelize, req.tenantSchema);
    if (!grants.get(req.user.role)?.has(required)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required,
        current: req.user.role,
      });
    }
    return next();
  } catch (err) {
    console.error(`authorize('${required}') lookup failed for schema ${req.tenantSchema}:`, err.message);
    return res.status(503).json({ error: 'Could not verify permissions, please try again' });
  }
};

module.exports = { authorize, getRolePrivileges };
