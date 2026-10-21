/**
 * The Analytics Assistant's intent catalog — one entry per supported
 * question type. Adding a new phrasing to an existing intent, or a whole
 * new intent, means editing this array; nothing else in the NLU pipeline
 * needs to change (see intentClassifier.js, which just scores these
 * patterns against the question).
 *
 * `requiresPermission`, when set, is a privilege key checked against the
 * requesting user (in addition to the base pages.analytics_assistant.view
 * gate every chatbot request already passes) — e.g. a revenue question is
 * refused for a role with no accounting.read, even though that role can
 * still ask about registrations or visits.
 *
 * `supported: false` intents are matched deliberately, not to answer them,
 * but to give an honest "this isn't reliably trackable yet" response
 * instead of silently falling through to "I didn't understand" (confidence
 * handling: a question the assistant understood but can't answer safely is
 * a different case from one it didn't understand at all). doctor_revenue is
 * the one remaining case — see analyticsFunctions.js's header comment for
 * why: patient_bills has no doctor_id/visit_id at all, so there's no single
 * point to capture it the way department_breakdown now does.
 *
 * ── On "understand anything" ─────────────────────────────────────────────
 * This file's patterns are inherently a FINITE list — no amount of adding
 * synonyms here turns keyword matching into genuine open-ended language
 * understanding (that needs an actual model, which the "no external API"
 * requirement and this architecture's clean intent-classifier boundary both
 * deliberately leave room for — a local model via Ollama — without having
 * been wired in). What IS achievable here, and is what the patterns below
 * are broadened for: covering many more natural phrasings of the SAME
 * underlying questions this assistant already answers, plus two new
 * meta-intents (date_range_query, help) that make the assistant feel aware
 * of its own conversation and its own scope, rather than a fixed list of
 * magic phrases the user has to guess.
 */
// Order matters: intentClassifier.js keeps the FIRST intent it meets on a
// tied score, so the more specific intents below (a revenue question that
// happens to mention "doctor" or "department") must be listed before the
// more general ones they'd otherwise also match.
const INTENTS = [
  {
    // A meta-question about the conversation itself, not a new data
    // question — chatbotEngine.js special-cases this key to answer
    // straight from the PRIOR turn's stored params rather than running any
    // analytics function, and then keeps that prior turn's own intent
    // "live" for whatever follow-up comes next (see chatbotEngine.js).
    key: 'date_range_query',
    requiresPermission: null,
    supported: true,
    patterns: [
      /\bdate range\b/, /\bwhat('?s| is| was)? the (date range|time range|period|range)\b/,
      /\bwhich dates?\b/, /\bwhat dates?\b/, /\bfor what (period|dates?|range)\b/,
      /\bwhat time (period|range) (was|is) that\b/, /\bgive me the (date range|dates?|period)\b/,
    ],
  },
  {
    key: 'help',
    requiresPermission: null,
    supported: true,
    patterns: [
      /\bwhat can (you|i) (do|ask)\b/, /\bwhat (questions|things) can i ask\b/,
      /\bhow do(es)? (this|you) work\b/, /\bcapabilities\b/, /\bwhat do you (know|support)\b/,
      /^\s*help\s*$/, /\bcan you help\b/, /\bneed help\b/,
    ],
  },
  {
    key: 'doctor_revenue',
    requiresPermission: 'accounting.read',
    supported: false,
    patterns: [/\bdoctor.*\b(revenue|earn|generat(e|ed)|collect)/, /\b(revenue|earnings?)\b.*\bdoctor/],
  },
  {
    key: 'department_breakdown',
    requiresPermission: 'accounting.read',
    supported: true,
    patterns: [
      /\bdepartment/, /\bbusiest (department|clinic)\b/, /\bby department\b/,
      /\bby category\b/, /\brevenue by category\b/, /\btop category\b/, /\btop service\b/,
      /\bclinic breakdown\b/, /\bcategory breakdown\b/,
    ],
  },
  {
    key: 'revenue',
    requiresPermission: 'accounting.read',
    supported: true,
    patterns: [
      /\brevenue\b/, /\bcollect(ed|ion)\b/, /\bincome\b/,
      /\bhow much (money|was collected|did we (make|collect|earn)|came in)\b/,
      /\bearnings?\b/, /\btakings?\b/, /\bcash collected\b/, /\bpayments? received\b/,
      /\btotal collected\b/, /\bsales\b/, /\bturnover\b/, /\bmoney (collected|came in|made)\b/,
    ],
  },
  {
    key: 'doctor_activity',
    requiresPermission: null,
    supported: true,
    patterns: [
      /\bwhich doctor\b/, /\beach doctor\b/, /\bdoctor performance\b/,
      /\bdoctor.*\b(most|attend|handle[d]?|patients?)\b/,
      /\bhow many patients did\b.*\bdoctor\b/,
      /\b(busiest|most active) doctor\b/, /\bdoctor workload\b/, /\bdoctor caseload\b/,
      /\bconsultations? per doctor\b/, /\bdoctors?'? (performance|activity|caseload)\b/,
    ],
  },
  {
    // "How many patients are there (in total/in the system)?" — a current-
    // moment snapshot, distinct from "registrations" below (new patients IN
    // A PERIOD). Listed first since it's the more specific phrasing;
    // "registrations" below would otherwise swallow "how many patients ...".
    key: 'total_patients',
    requiresPermission: null,
    supported: true,
    patterns: [
      /\bhow many patients? (are there|do we have|in (the )?(system|hospital|database))\b/,
      /\btotal (number of )?patients\b/, /\ball patients\b/, /\bpatient count\b/,
      /\bhow many patients? (in )?total\b/,
    ],
  },
  {
    key: 'registrations',
    requiresPermission: null,
    supported: true,
    patterns: [
      /\bregist(er|ration|ered)/, /\bnew patients?\b/,
      /\bpatients? (were |was |)registered\b/, /\bsign(ed)?[\s-]?up\b/,
      /\bwalk-?ins?\b/, /\benrolled\b/, /\bnew (entries|patients)\b/,
      /\badded to the system\b/, /\bregistration count\b/,
    ],
  },
  {
    key: 'visits',
    requiresPermission: null,
    supported: true,
    patterns: [
      /\bvisits?\b/, /\bpatients? visited\b/, /\boutpatient\b/,
      /\bencounters?\b/, /\bpatients? (came|attended)\b/,
      /\bconsultations?\b/, /\bappointments?\b/, /\bpeople (seen|visited)\b/,
      /\bfootfall\b/, /\bclinic visits?\b/, /\bhow many (people|patients) (came in|showed up)\b/,
    ],
  },
  {
    key: 'summary',
    requiresPermission: null,
    supported: true,
    patterns: [
      /\bsummary\b/, /\bkey statistics\b/, /\boverview\b/,
      /\bhow (is|was) (the )?hospital\b/, /\bwhat'?s happening\b/,
      /\btoday'?s (hospital )?activity\b/, /\bhospital (activity|stats)\b/,
      /\bdaily report\b/, /\bquick overview\b/, /\bhow'?s the hospital doing\b/,
      /\bstate of the hospital\b/, /\bbriefing\b/, /\bgeneral update\b/,
    ],
  },
];

module.exports = { INTENTS };
