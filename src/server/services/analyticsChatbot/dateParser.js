/**
 * Converts the date expression inside a chatbot question ("today",
 * "yesterday", "this week", "last 7 days", "between 2026-10-01 and
 * 2026-10-15", ...) into an exact [start, end) range.
 *
 * Hospital-local timezone: IntelliCare has no facility/tenant timezone
 * setting anywhere in the codebase today (every existing report — see
 * reportCancelledTransactions.js's todayISO(), dashboard.js's today/
 * tomorrow — just uses the server's own local time for "today"). This
 * parser does the same, deliberately, so the chatbot's "today" always
 * agrees with the Dashboard's "Today" filter and every report's "today"
 * rather than inventing a second, inconsistent definition. If IntelliCare
 * ever gains a real per-facility timezone setting, this is the one place
 * that needs to start reading it.
 *
 * "This week"/"this month" deliberately match src/server/utils/
 * dashboardDateRange.js's rolling-window definition (now-7-days / first of
 * calendar month), not an ISO calendar week — so a chatbot answer never
 * disagrees with what the Dashboard's own Today/This Week/This Month pills
 * already show for the same question.
 */

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const N_DAYS_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30, ninety: 90 };

/**
 * Finds a date expression anywhere in `text` and resolves it against `now`.
 * Always returns a usable range — `matched: false` means no explicit phrase
 * was found and the range defaults to "today", so a caller can distinguish
 * "the user said nothing about dates" (worth inheriting a prior turn's
 * range for) from "the user explicitly asked about today".
 */
function resolveDateExpression(text, now = new Date()) {
  const lower = String(text || '').toLowerCase();
  const today0 = startOfDay(now);
  const tomorrow0 = addDays(today0, 1);

  // Order matters: check the more specific phrases ("last week") before the
  // more general ones ("week") would also match.
  const between = lower.match(/\bbetween\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})\b/)
    || lower.match(/\bfrom\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\b/);
  if (between) {
    const start = new Date(`${between[1]}T00:00:00`);
    const end = addDays(new Date(`${between[2]}T00:00:00`), 1);
    return { matched: true, start, end, label: `${between[1]} to ${between[2]}` };
  }

  if (/\byesterday\b/.test(lower)) {
    return { matched: true, start: addDays(today0, -1), end: today0, label: 'Yesterday' };
  }
  if (/\blast\s+week\b/.test(lower)) {
    return { matched: true, start: addDays(today0, -14), end: addDays(today0, -7), label: 'Last Week' };
  }
  if (/\bthis\s+week\b/.test(lower)) {
    return { matched: true, start: addDays(today0, -7), end: tomorrow0, label: 'This Week' };
  }
  if (/\blast\s+month\b/.test(lower)) {
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { matched: true, start: firstOfLastMonth, end: firstOfThisMonth, label: 'Last Month' };
  }
  if (/\bthis\s+month\b/.test(lower)) {
    return { matched: true, start: new Date(now.getFullYear(), now.getMonth(), 1), end: tomorrow0, label: 'This Month' };
  }
  if (/\bthis\s+year\b/.test(lower)) {
    return { matched: true, start: new Date(now.getFullYear(), 0, 1), end: tomorrow0, label: 'This Year' };
  }
  const lastNDays = lower.match(/\blast\s+(\d+|one|two|three|four|five|six|seven|ten|fourteen|thirty|ninety)\s+days?\b/);
  if (lastNDays) {
    const n = Number.isFinite(Number(lastNDays[1])) ? parseInt(lastNDays[1], 10) : N_DAYS_WORDS[lastNDays[1]];
    if (n && n > 0 && n <= 366) {
      return { matched: true, start: addDays(today0, -n), end: tomorrow0, label: `Last ${n} Days` };
    }
  }
  if (/\btoday\b/.test(lower)) {
    return { matched: true, start: today0, end: tomorrow0, label: 'Today' };
  }

  // No explicit date phrase found — default to today, but say so via `matched: false`.
  return { matched: false, start: today0, end: tomorrow0, label: 'Today' };
}

/**
 * Splits a comparison question ("compare today's revenue with yesterday's")
 * into its two clauses so each can be date-parsed independently. Returns
 * null when there's only one clause to find (e.g. "compare today's
 * revenue") — the caller then falls back to `priorPeriodOf()` below for the
 * implicit second period.
 */
function splitComparisonClauses(text) {
  const str = String(text || '');

  // "vs"/"versus"/"compared to" are unambiguous connectors wherever they
  // appear — safe to split on directly.
  const direct = str.split(/\b(?:vs\.?|versus|compared to)\b/i);
  if (direct.length >= 2) return [direct[0], direct.slice(1).join(' ')];

  // "compare X with Y" / "compare X to Y" — the connector here is just the
  // bare word "with"/"to" somewhere later in the sentence, not glued to
  // "compare" itself ("Compare today's visits WITH yesterday's"). Only look
  // for it once "compare"/"compared" has actually been said — otherwise an
  // unrelated question like "patients registered up to today" would get
  // mis-split on its own, innocent "to".
  if (/\bcompare[d]?\b/i.test(str)) {
    const withIdx = str.search(/\bwith\b/i);
    if (withIdx !== -1) return [str.slice(0, withIdx), str.slice(withIdx + 4)];
    const toIdx = str.search(/\bto\b/i);
    if (toIdx !== -1) return [str.slice(0, toIdx), str.slice(toIdx + 2)];
  }

  return null;
}

/**
 * The "other side" of an implicit comparison — today's natural prior period
 * is yesterday, this week's is last week, etc. Falls back to shifting the
 * same-length window directly before `resolved.start` for anything else
 * (e.g. a custom range), so "compare with the previous period" always has a
 * sensible answer even for ranges with no named sibling.
 */
function priorPeriodOf(resolved) {
  const byLabel = {
    Today: () => resolveDateExpression('yesterday'),
    'This Week': () => resolveDateExpression('last week'),
    'This Month': () => resolveDateExpression('last month'),
  };
  if (byLabel[resolved.label]) return byLabel[resolved.label]();
  const spanMs = resolved.end.getTime() - resolved.start.getTime();
  const start = new Date(resolved.start.getTime() - spanMs);
  const end = new Date(resolved.start.getTime());
  return { matched: true, start, end, label: `Previous ${resolved.label}` };
}

module.exports = { resolveDateExpression, splitComparisonClauses, priorPeriodOf };
