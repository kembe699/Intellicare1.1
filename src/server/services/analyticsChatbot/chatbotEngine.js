const { classifyIntent } = require('./intentClassifier');
const { resolveDateExpression, splitComparisonClauses, priorPeriodOf } = require('./dateParser');
const { extractDoctor } = require('./entityExtractor');
const { INTENTS } = require('./intentPatterns');
const analytics = require('./analyticsFunctions');
const templates = require('./responseTemplates');
const { getRolePrivileges } = require('../../middleware/authorize');
const CurrencyService = require('../CurrencyService');

const INTENTS_BY_KEY = Object.fromEntries(INTENTS.map((i) => [i.key, i]));
const COMPARABLE_INTENTS = new Set(['registrations', 'visits', 'revenue']);

/** Same admin-bypass / role+additionalRoles check authorize.js's middleware does, as a plain async predicate. */
async function hasPrivilege(req, privilegeKey) {
  if (!privilegeKey) return true;
  if (req.user?.role === 'admin') return true;
  const roles = [req.user?.role, ...(req.user?.additionalRoles || [])];
  const grants = await getRolePrivileges(req.models.sequelize, req.tenantSchema);
  return roles.some((r) => grants.get(r)?.has(privilegeKey));
}

async function runIntent(sequelize, req, intentKey, dateRange, { clinicId, doctorEntity }) {
  const ctx = { req, clinicId, start: dateRange.start, end: dateRange.end };
  switch (intentKey) {
    case 'registrations': {
      const data = await analytics.getRegistrationsCount(sequelize, ctx);
      return templates.registrations(data, dateRange.label);
    }
    case 'visits': {
      const data = await analytics.getVisitsCount(sequelize, ctx);
      return templates.visits(data, dateRange.label);
    }
    case 'revenue': {
      const baseCurrency = await CurrencyService.getBaseCurrency();
      const data = await analytics.getRevenueTotal(sequelize, ctx);
      return templates.revenue(data, dateRange.label, baseCurrency.code);
    }
    case 'doctor_activity': {
      const rows = await analytics.getDoctorActivity(sequelize, { ...ctx, doctorId: doctorEntity?.id });
      return templates.doctorActivity(rows, dateRange.label, doctorEntity);
    }
    case 'summary': {
      const canSeeRevenue = await hasPrivilege(req, 'accounting.read');
      const [reg, vis, doctors] = await Promise.all([
        analytics.getRegistrationsCount(sequelize, ctx),
        analytics.getVisitsCount(sequelize, ctx),
        analytics.getDoctorActivity(sequelize, ctx),
      ]);
      let rev = null;
      let currencyCode = null;
      if (canSeeRevenue) {
        rev = await analytics.getRevenueTotal(sequelize, ctx);
        currencyCode = (await CurrencyService.getBaseCurrency()).code;
      }
      return templates.summary({ registrations: reg, visits: vis, revenue: rev, topDoctor: doctors[0] || null }, dateRange.label, currencyCode, canSeeRevenue);
    }
    case 'department_breakdown': {
      const baseCurrency = await CurrencyService.getBaseCurrency();
      const data = await analytics.getDepartmentBreakdown(sequelize, ctx);
      return templates.departmentBreakdown(data, dateRange.label, baseCurrency.code);
    }
    case 'doctor_revenue':
      return templates.limitation(intentKey);
    default:
      return templates.clarifying();
  }
}

async function runComparison(sequelize, req, intentKey, question, { clinicId }) {
  const clauses = splitComparisonClauses(question);
  const dateA = resolveDateExpression(clauses ? clauses[0] : question);
  const dateB = clauses ? resolveDateExpression(clauses[1]) : priorPeriodOf(dateA);

  const ctxFor = (d) => ({ req, clinicId, start: d.start, end: d.end });
  let valueA;
  let valueB;
  let currencyCode = null;
  let metricLabel;

  if (intentKey === 'revenue') {
    [valueA, valueB] = await Promise.all([
      analytics.getRevenueTotal(sequelize, ctxFor(dateA)),
      analytics.getRevenueTotal(sequelize, ctxFor(dateB)),
    ]);
    currencyCode = (await CurrencyService.getBaseCurrency()).code;
    valueA = valueA.total;
    valueB = valueB.total;
    metricLabel = 'Revenue';
  } else if (intentKey === 'visits') {
    [valueA, valueB] = await Promise.all([
      analytics.getVisitsCount(sequelize, ctxFor(dateA)),
      analytics.getVisitsCount(sequelize, ctxFor(dateB)),
    ]);
    valueA = valueA.count;
    valueB = valueB.count;
    metricLabel = 'Visits';
  } else {
    [valueA, valueB] = await Promise.all([
      analytics.getRegistrationsCount(sequelize, ctxFor(dateA)),
      analytics.getRegistrationsCount(sequelize, ctxFor(dateB)),
    ]);
    valueA = valueA.count;
    valueB = valueB.count;
    metricLabel = 'Registrations';
  }

  return {
    ...templates.compare(metricLabel, valueA, valueB, dateA.label, dateB.label, currencyCode),
    dateRange: dateA,
  };
}

/**
 * The single entry point the route calls. `priorTurn` is the previous
 * assistant message's stored `{ intent, params }` for this conversation (or
 * null for a fresh conversation) — see routes/analyticsChatbot.js for where
 * it's loaded. Conversational context NEVER grants additional permissions:
 * every call re-checks `hasPrivilege` against the CURRENT request's user,
 * regardless of what a prior turn in the same conversation was allowed to
 * see.
 */
async function answerQuestion({ sequelize, req, question, priorTurn }) {
  const clinicId = parseInt(req.user?.clinicId, 10) || 1;
  const classification = classifyIntent(question);
  const dateResolved = resolveDateExpression(question);

  // Follow-up inheritance: only the pieces the new question didn't specify
  // are carried over from the prior turn — a new intent or new date phrase
  // in THIS question always wins.
  let intentKey = classification.matched ? classification.intent : priorTurn?.intent;
  const dateRange = dateResolved.matched || !priorTurn?.params?.start
    ? dateResolved
    : { start: new Date(priorTurn.params.start), end: new Date(priorTurn.params.end), label: priorTurn.params.label };

  if (!intentKey) {
    return { ...templates.clarifying(), intentKey: null, supported: false, dateRange: dateResolved };
  }

  const intentDef = INTENTS_BY_KEY[intentKey];
  const requiresPermission = classification.matched ? classification.requiresPermission : intentDef?.requiresPermission;
  const supported = classification.matched ? classification.supported : intentDef?.supported;

  if (requiresPermission && !(await hasPrivilege(req, requiresPermission))) {
    return { ...templates.accessDenied(), intentKey, supported, dateRange, accessDenied: true };
  }

  if (classification.isCompare && COMPARABLE_INTENTS.has(intentKey)) {
    // Stored intentKey stays the plain base key (e.g. 'revenue', not
    // 'revenue_compare') — it's what a FOLLOW-UP turn looks up in
    // INTENTS_BY_KEY to inherit permission/supported flags (see above). A
    // synthetic suffixed key would miss that lookup entirely and silently
    // fall through to the generic "can't answer that" response instead of
    // correctly continuing the conversation.
    const result = await runComparison(sequelize, req, intentKey, question, { clinicId });
    return { ...result, intentKey, supported: true };
  }

  if (!supported) {
    return { ...templates.limitation(intentKey), intentKey, supported: false, dateRange };
  }

  let doctorEntity = null;
  if (intentKey === 'doctor_activity') {
    const doctors = await analytics.listDoctors(sequelize, { req, clinicId });
    doctorEntity = extractDoctor(question, doctors);
  }

  const result = await runIntent(sequelize, req, intentKey, dateRange, { clinicId, doctorEntity });
  return { ...result, intentKey, supported: true, dateRange, doctorEntity };
}

module.exports = { answerQuestion, hasPrivilege };
