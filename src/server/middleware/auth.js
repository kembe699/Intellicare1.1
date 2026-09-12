const jwt = require('jsonwebtoken');
const { getTenantConnection } = require('../tenantDb');
const tenantContext = require('../tenantContext');
const { userAuthCache } = require('../cache');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}

// Public routes that don't require authentication
// Note: paths are relative to the /api mount point (req.path strips the /api prefix)
// /platform is excluded entirely — it's authenticated separately by
// middleware/platformAuth.js against the platform-admin JWT, which carries no
// schemaName/tenant context at all and must never be checked against tenant data.
const publicPaths = [
  '/auth/login',
  '/auth/setup-password',
  '/auth/logout',
  '/status',
  '/lab-integration/receive',
  '/platform'
];

// Middleware to verify JWT token, resolve which tenant database it belongs to,
// and attach both req.user and req.models (that tenant's bound model set —
// every route handler should read models from here, not from a static
// top-level require('../models'), since which database to query is only known
// per-request now).
const authenticateToken = (req, res, next) => {
  // Skip authentication for public routes
  if (publicPaths.some(path => req.path === path || req.path.startsWith(path))) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (!decoded.schemaName) {
      // Token predates multi-tenant login (or is malformed) — there's no safe
      // database to resolve it against, so reject rather than guessing.
      return res.status(401).json({ error: 'Session is out of date, please log in again' });
    }

    let tenantConnection;
    try {
      tenantConnection = await getTenantConnection(decoded.schemaName);
    } catch (connErr) {
      console.error('Tenant connection error:', connErr);
      return res.status(503).json({ error: 'Could not connect to your instance, please try again shortly' });
    }
    req.models = tenantConnection.models;
    req.tenantSchema = decoded.schemaName;

    // Cached by schemaName+userId, not userId alone — user ids are only unique
    // within a single tenant's own database (each tenant's `users` table has
    // its own independent auto-increment sequence), so a cache keyed on
    // userId alone would serve one tenant's cached role to another tenant's
    // same-numbered user id.
    const cacheKey = `${decoded.schemaName}:${decoded.userId}`;
    const cached = userAuthCache.get(cacheKey);
    if (cached) {
      req.user = {
        id: decoded.userId,
        userId: decoded.userId,
        email: decoded.email,
        role: cached.role,
        additionalRoles: cached.additionalRoles || [],
        clinicId: decoded.clinicId,
        branchId: decoded.branchId || null,
        schemaName: decoded.schemaName,
        isAdmin: cached.role === 'admin'
      };
      // Everything downstream — remaining middleware, the route handler, and
      // any async work they kick off — runs inside this tenant's context, so
      // every existing route file's require('../models') transparently
      // resolves to this tenant's database without needing req.models.
      return tenantContext.run(tenantConnection, () => next());
    }

    // Cache miss — fetch from this tenant's own database
    try {
      const [[dbUser]] = await tenantConnection.sequelize.query(
        'SELECT role, is_active FROM users WHERE id = ? LIMIT 1',
        { replacements: [decoded.userId] }
      );
      if (!dbUser || !dbUser.is_active) {
        return res.status(401).json({ error: 'Account inactive or not found' });
      }
      // Extra roles granted on top of the primary one (routes/users.js,
      // user_additional_roles) — effective permissions are the union, see
      // authorize.js. Table may not exist yet on a tenant that hasn't been
      // touched since this shipped; treat that the same as "no additional
      // roles" rather than failing the whole login.
      let additionalRoles = [];
      try {
        const [rows] = await tenantConnection.sequelize.query(
          'SELECT role_key FROM user_additional_roles WHERE user_id = ?',
          { replacements: [decoded.userId] }
        );
        additionalRoles = rows.map((r) => r.role_key);
      } catch (_e) { /* table not ensured yet on this tenant — treat as none */ }
      userAuthCache.set(cacheKey, { role: dbUser.role, is_active: dbUser.is_active, additionalRoles });
      req.user = {
        id: decoded.userId,
        userId: decoded.userId,
        email: decoded.email,
        role: dbUser.role,
        additionalRoles,
        clinicId: decoded.clinicId,
        branchId: decoded.branchId || null,
        schemaName: decoded.schemaName,
        isAdmin: dbUser.role === 'admin'
      };
    } catch (dbErr) {
      // Fallback to JWT role if DB lookup fails
      req.user = {
        id: decoded.userId,
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        additionalRoles: [],
        clinicId: decoded.clinicId,
        branchId: decoded.branchId || null,
        schemaName: decoded.schemaName,
        isAdmin: decoded.role === 'admin'
      };
    }
    tenantContext.run(tenantConnection, () => next());
  });
};

module.exports = { authenticateToken };
