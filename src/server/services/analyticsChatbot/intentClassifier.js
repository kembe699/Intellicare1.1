const { INTENTS } = require('./intentPatterns');

const COMPARE_RE = /\b(compare|vs\.?|versus|compared to)\b/i;

/**
 * Walks intentPatterns.js's INTENTS in order and returns the FIRST one with
 * at least one matching pattern — not the one with the most matches. This
 * is deliberate, not an approximation of "best match": a narrow, specific
 * intent (e.g. doctor_revenue's "doctor ... generated ... revenue") must
 * win over a broad one it happens to overlap with (doctor_activity's
 * "doctor ... most", which also fires on that same question purely because
 * "most" appears in it) regardless of which one racks up more individual
 * pattern hits. See intentPatterns.js's header for why order encodes that
 * specificity, and keep the narrower intents listed first when adding new
 * ones.
 *
 * Returns `{ matched: false }` when nothing matches at all, so the caller
 * can fall back to conversation context or a clarifying response instead of
 * guessing (never silently default to some intent the question didn't
 * actually ask for).
 */
function classifyIntent(question) {
  const lower = String(question || '').toLowerCase().trim();
  if (!lower) return { matched: false };

  for (const intent of INTENTS) {
    const score = intent.patterns.filter((p) => p.test(lower)).length;
    if (score > 0) {
      return {
        matched: true,
        intent: intent.key,
        requiresPermission: intent.requiresPermission,
        supported: intent.supported,
        confidence: score,
        isCompare: COMPARE_RE.test(lower),
      };
    }
  }

  return { matched: false };
}

module.exports = { classifyIntent };
