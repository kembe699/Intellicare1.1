/**
 * SMS notification hook for the HR attendance/portal feature (spec 6B:
 * "if an SMS or email service already exists in the codebase, also send
 * through it; if none exists, do not add one - just leave a hook and tell
 * me"). Confirmed via repo-wide search: no SMS provider (Twilio,
 * Africa's Talking, etc.) exists anywhere in this codebase — this is
 * genuinely new ground, not an integration gap.
 *
 * This is intentionally a no-op today. Call sendSms(...) from the same
 * places that already call notifyUser/notifyRole/notifyEmployee
 * (routes/leave.js, routes/salaryAdvances.js, routes/employeePortal.js)
 * once a real provider is wired in below — the call sites don't need to
 * change, only this function's body.
 */
async function sendSms({ to, message }) {
  if (!to || !message) return;
  // No SMS provider configured. Logging only, so this hook's call sites
  // are exercised (and visible in logs) without silently doing nothing.
  console.log(`[sms-hook] Would send to ${to}: ${message}`);
}

module.exports = { sendSms };
