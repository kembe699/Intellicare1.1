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

// Public, unauthenticated payroll-signing surface (routes/publicPayroll.js)
// — an employee's own phone hitting it a handful of times while they read
// their payslip and sign is normal; scripted probing of tokens or employee
// numbers is not. Keyed on the token in the URL (the actual "account" this
// surface protects, since each token is scoped to exactly one payroll
// line) with a source-IP fallback for the initial GET where no token has
// been resolved from a body.
function payrollSignKey(req) {
  const token = String(req.params?.token || '').trim();
  return token ? `token:${token}` : `ip:${req.ip}`;
}

const payrollSignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: payrollSignKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes or contact HR.' },
});

// Clinical Insights calls out to a paid LLM API per request, so this bounds
// runaway cost/spam per doctor rather than guarding a credential-guessing
// surface — keyed on the authenticated user (this route always runs after
// authenticateToken, so req.user is set), IP as a fallback only.
function userKey(req) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
}

const clinicalInsightsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Clinical Insights requests this hour. Please try again later.' },
});

// Analytics Assistant chatbot — a bounded ceiling per user against
// unbounded query load from a chat box, same reasoning as authLimiter.
// Applies regardless of which engine answers (deterministic keyword match
// or the LLM below) — the free local engine still deserves a ceiling.
const chatbotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many questions in a short time. Please wait a few minutes and try again.' },
});

// A second, tighter limit stacked on top of chatbotLimiter above — once the
// Analytics Assistant's LLM mode is enabled (ANALYTICS_CHATBOT_LLM_ENABLED),
// each question can call a paid external API, same cost concern as
// clinicalInsightsLimiter. Always applied (harmless when LLM mode is off,
// since the free local engine never calls it tight enough to matter).
const chatbotLlmLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many questions to the Analytics Assistant this hour. Please try again later.' },
});

// Public, unauthenticated "Book a Demo" page (routes/publicBookDemo.js). A
// real visitor hits availability a few times while browsing the calendar
// then submits once; this bounds scripted slot-grabbing/spam per source IP.
// Availability reads get the looser limit (just browsing); the actual
// booking POST uses the tighter one.
const bookDemoAvailabilityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
});

const bookDemoSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking attempts from this device. Please try again later.' },
});

// Employee-portal login (routes/employeePortal.js) — same per-account
// reasoning as accountKey/authLimiter above, keyed on tenant code + employee
// number rather than email, since that's this surface's actual credential
// pair. A shared clinic IP must not lock out every employee's attempts.
function portalAccountKey(req) {
  const code = String(req.body?.code || '').trim().toLowerCase();
  const employeeNumber = String(req.body?.employee_number || '').trim().toLowerCase();
  if (employeeNumber) return `portal:${code}:${employeeNumber}`;
  return `ip:${req.ip}`;
}

const portalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: portalAccountKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts for this account. Please try again in a few minutes.' },
});

// Employee-portal clock in/out — always runs after employeePortalAuth, so
// req.employee is set. Bounds scripted/rapid clock attempts (e.g. replaying
// a captured QR) per employee rather than per IP, since several employees
// legitimately clock in from the same site/IP in quick succession.
function employeeKey(req) {
  return req.employee?.id ? `employee:${req.employee.id}` : `ip:${req.ip}`;
}

const portalClockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: employeeKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many clock in/out attempts. Please wait a few minutes and try again.' },
});

module.exports = {
  authLimiter,
  authSourceLimiter,
  passwordResetLimiter,
  payrollSignLimiter,
  clinicalInsightsLimiter,
  chatbotLimiter,
  chatbotLlmLimiter,
  bookDemoAvailabilityLimiter,
  bookDemoSubmitLimiter,
  portalLoginLimiter,
  portalClockLimiter,
};
