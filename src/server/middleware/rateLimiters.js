const rateLimit = require('express-rate-limit');

// Credential-guessing surfaces (login, password verification/change). Bcrypt
// already slows brute force per-attempt, but a request-count ceiling stops
// distributed/scripted guessing from ever reaching bcrypt at volume.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

// Password-reset / email-enumeration surfaces. Looser than login since a
// legitimate user may retry a typo'd email, but still bounded to stop
// mass token generation or account-existence probing.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
});

module.exports = { authLimiter, passwordResetLimiter };
