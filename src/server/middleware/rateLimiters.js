const rateLimit = require('express-rate-limit');

/**
 * Who a limit applies to.
 *
 * Keying on IP alone is wrong for this product. A clinic's staff all sit behind
 * one internet connection, so they share one IP: ten wrong passwords at the
 * reception desk would lock the pharmacy, the lab and the doctors out of the
 * system for fifteen minutes. Keying on the account being targeted instead
 * bounds an attack on any single login while leaving colleagues unaffected.
 *
 * The tenant code is part of the key because the same email can exist in more
 * than one tenant and they are separate accounts.
 *
 * Requests with no account in them (a malformed body) fall back to the IP, so
 * the surface is still bounded rather than unlimited.
 */
function accountKey(req) {
  const code = String(req.body?.code || '').trim().toLowerCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email) return `acct:${code}:${email}`;
  return `ip:${req.ip}`;
}

// Credential-guessing surfaces (login, password verification/change). Bcrypt
// already slows brute force per-attempt; this stops scripted guessing from
// reaching bcrypt at volume.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: accountKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts for this account. Please try again in a few minutes.' },
});

// A second, looser ceiling on the source itself, so one client cannot spray
// attempts across many accounts and stay under the per-account limit above.
const authSourceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts from this device. Please try again later.' },
});

// Password-reset / email-enumeration surfaces. Looser than login since a
// legitimate user may retry a typo'd email, but still bounded to stop mass
// token generation or account-existence probing.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: accountKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
});

module.exports = { authLimiter, authSourceLimiter, passwordResetLimiter };
