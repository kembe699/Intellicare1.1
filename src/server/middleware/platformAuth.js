const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Verifies the platform-admin JWT (routes/platform/auth.js). Deliberately
// separate from middleware/auth.js's authenticateToken — a platform-admin
// token carries no dbName/tenant context at all, so it can never be used to
// reach any tenant's hospital data, and a tenant-user token can never pass
// this check to reach the platform admin panel.
function authenticatePlatformAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || !decoded.isPlatformAdmin) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.platformAdmin = { id: decoded.adminId, email: decoded.email, name: decoded.name };
    next();
  });
}

module.exports = { authenticatePlatformAdmin };
