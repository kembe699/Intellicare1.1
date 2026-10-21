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
 * a different case from one it didn't understand at all). See
 * analyticsFunctions.js's header comment for exactly why department-level
 * and per-doctor revenue aren't computed: IntelliCare's data model has no
 * reliable foreign key for either (department revenue would mean reusing
 * reportClinicPerformance.js's fuzzy, admittedly-incomplete line-item
 * matching; per-doctor revenue has no doctor_id on patient_bills at all).
 */
// Order matters: intentClassifier.js keeps the FIRST intent it meets on a
// tied score, so the more specific intents below (a revenue question that
// happens to mention "doctor" or "department") must be listed before the
// more general ones they'd otherwise also match.
const INTENTS = [
  {
    key: 'doctor_revenue',
    requiresPermission: 'accounting.read',
    supported: false,
    patterns: [/\bdoctor.*\b(revenue|earn|generat(e|ed)|collect)/, /\b(revenue|earnings?)\b.*\bdoctor/],
  },
  {
    key: 'department_breakdown',
    requiresPermission: 'accounting.read',
    supported: false,
    patterns: [/\bdepartment/, /\bbusiest (department|clinic)\b/, /\bby department\b/],
  },
  {
    key: 'revenue',
    requiresPermission: 'accounting.read',
    supported: true,
    patterns: [
      /\brevenue\b/, /\bcollect(ed|ion)\b/, /\bincome\b/,
      /\bhow much (money|was collected|did we (make|collect|earn))\b/,
      /\bearnings?\b/, /\btakings?\b/,
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
    ],
  },
  {
    key: 'registrations',
    requiresPermission: null,
    supported: true,
    patterns: [
      /\bregist(er|ration|ered)/, /\bnew patients?\b/,
      /\bpatients? (were |was |)registered\b/, /\bsign(ed)?[\s-]?up\b/,
    ],
  },
  {
    key: 'visits',
    requiresPermission: null,
    supported: true,
    patterns: [
      /\bvisits?\b/, /\bpatients? visited\b/, /\boutpatient\b/,
      /\bencounters?\b/, /\bpatients? (came|attended)\b/,
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
    ],
  },
];

module.exports = { INTENTS };
