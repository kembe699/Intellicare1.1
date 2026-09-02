/**
 * Redis-backed response cache middleware.
 *
 * Cache key = tenant schemaName | userId | branchId | full URL (path + query string)
 * Only caches successful GET responses (status 200).
 * POST / PUT / DELETE / PATCH bypass the cache entirely.
 *
 * Usage:
 *   app.use(redisCacheMiddleware);          // 60-second default
 *   router.get('/heavy', redisCacheMiddleware(600), handler);  // 10 min
 */

const redisCache = require('../services/RedisCache');

// Checked against req.originalUrl (which includes the /api mount prefix), not
// req.path — this middleware is mounted as app.use('/api', ...), so req.path
// inside it is already relative and never starts with '/api'.
const NOCACHE_PREFIXES = ['/api/auth', '/api/status', '/health', '/api/platform'];
const DEFAULT_TTL = 60; // seconds

function redisCacheMiddleware(ttlSeconds = DEFAULT_TTL) {
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (NOCACHE_PREFIXES.some(p => req.originalUrl.startsWith(p))) return next();

    // schemaName scopes the key to this tenant's own database — without it, two
    // different tenants whose user/branch ids happen to coincide (e.g. every
    // freshly-provisioned tenant's first admin/branch, which nearly always
    // land on the same small auto-increment values) would silently share
    // cached responses across tenants.
    const schemaName   = req.tenantSchema || 'default';
    const userId   = req.user?.id   || 'anon';
    const branchId = req.branchContext?.branchId || req.user?.branchId || 'none';
    const key = `ic|${schemaName}|${userId}|${branchId}|${req.originalUrl}`;

    const cached = await redisCache.get(key);
    if (cached !== null) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    res.set('X-Cache', 'MISS');

    const originalJson = res.json.bind(res);
    res.json = async (data) => {
      if (res.statusCode === 200 && data != null) {
        await redisCache.set(key, data, ttlSeconds);
      }
      return originalJson(data);
    };

    next();
  };
}

module.exports = redisCacheMiddleware;
