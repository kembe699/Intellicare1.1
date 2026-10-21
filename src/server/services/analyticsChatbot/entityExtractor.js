/** lowercase, strip "dr"/"dr." titles and punctuation, collapse whitespace. */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\bdr\.?\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cheap edit distance, capped — only used for short name tokens, never whole sentences. */
function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99; // short-circuit: definitely not a near-match
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Looks for one of `doctors` (each `{ id, display_name }`, already scoped to
 * this tenant/branch by the caller — see analyticsFunctions.js's
 * listDoctors) named anywhere in `question`. Exact normalized-substring
 * match first; a per-token Levenshtein distance of 1 as a typo-tolerance
 * fallback (spec section 3: "tolerance for minor spelling differences"),
 * never more than that — a distance-2+ fallback starts matching unrelated
 * short names and would misattribute data to the wrong doctor, which is
 * worse than not matching at all.
 */
function extractDoctor(question, doctors) {
  const q = normalize(question);
  if (!q || !Array.isArray(doctors) || doctors.length === 0) return null;

  for (const doc of doctors) {
    const name = normalize(doc.display_name);
    if (name && q.includes(name)) return doc;
  }

  const qTokens = q.split(' ').filter((t) => t.length >= 3);
  for (const doc of doctors) {
    const nameTokens = normalize(doc.display_name).split(' ').filter((t) => t.length >= 3);
    for (const nt of nameTokens) {
      if (qTokens.some((qt) => levenshtein(qt, nt) <= 1)) return doc;
    }
  }

  return null;
}

module.exports = { extractDoctor, normalize };
