/**
 * The tool surface Claude is given in llmEngine.js — this IS the allowlist.
 * Claude can only ever retrieve data by calling one of the functions below,
 * each a thin wrapper around the exact same read-only, parameterized
 * analyticsFunctions.js queries the deterministic keyword engine
 * (chatbotEngine.js) already uses. Claude never sees a connection string,
 * never writes SQL, never gets raw table access — it picks a tool and
 * arguments, this file runs the real query, and only the structured JSON
 * result (never Claude's own guess) is what the final answer can state a
 * number from. Permission checks (accounting.read for anything financial)
 * happen HERE, server-side, before the query ever runs — a denial comes
 * back to Claude as ordinary tool-result data ({error: 'permission_denied'})
 * for it to relay honestly, never as something Claude could route around.
 */
const analytics = require('./analyticsFunctions');
const { resolveNamedPeriod } = require('./dateParser');
const { extractDoctor } = require('./entityExtractor');
const CurrencyService = require('../CurrencyService');
// No cycle: chatbotEngine.js requires nothing from this file.
const { hasPrivilege } = require('./chatbotEngine');

const PERIOD_SCHEMA = {
  type: 'object',
  description: 'The time period to report on. Prefer named_period for ordinary phrasing ("today", "this month", ...); use start_date/end_date for an explicit custom range the user gave; use last_n_days for "last N days" phrasing.',
  properties: {
    named_period: {
      type: 'string',
      enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year'],
      description: '"this_week" is a rolling 7-day window ending today, "this_month" is the 1st of the current month through today — matching the Dashboard\'s own Today/This Week/This Month filters exactly, not an ISO calendar week.',
    },
    last_n_days: { type: 'integer', description: 'Use instead of named_period for "last N days" style questions.' },
    start_date: { type: 'string', description: 'YYYY-MM-DD. Use together with end_date for an explicit custom range instead of named_period.' },
    end_date: { type: 'string', description: 'YYYY-MM-DD, inclusive. Use together with start_date.' },
  },
};

const TOOLS = [
  {
    name: 'get_patient_registrations',
    description: 'Count of new patient registrations in a period.',
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_patient_visits',
    description: 'Count of patient visits / clinical encounters in a period.',
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_revenue',
    description: "Total cash revenue actually COLLECTED (from payment receipts, not amounts billed) in a period. Requires the user to have financial access — the result will say so if they don't; relay that honestly rather than guessing a figure.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_doctor_activity',
    description: "Ranked visit counts per doctor in a period (based on real doctor-attributed clinical orders — reliable data). Omit doctor_name for the full ranking; pass it to look up one doctor specifically.",
    input_schema: {
      type: 'object',
      properties: {
        period: PERIOD_SCHEMA,
        doctor_name: { type: 'string', description: "A doctor's name, if the user asked about one specifically — fuzzy-matched against real staff records server-side." },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_department_breakdown',
    description: "Billed revenue by category/department in a period — ONLY for bill line items that have a category captured at billing time; older bills predate that and are excluded (coveragePercent in the result says how much of the period's billing this actually represents). Requires financial access. There is deliberately NO equivalent tool for revenue per doctor — patient bills have no doctor attribution at all, so if asked, say plainly that isn't reliably trackable rather than estimating.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_hospital_summary',
    description: 'A combined summary for a period: registrations, visits, revenue (if the user is authorized), and the busiest doctor.',
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
];

async function executeTool(name, input, { sequelize, req, clinicId }) {
  const periodResolved = resolveNamedPeriod(input?.period || {});
  const ctx = { req, clinicId, start: periodResolved.start, end: periodResolved.end };
  const period = periodResolved.label;

  switch (name) {
    case 'get_patient_registrations': {
      const data = await analytics.getRegistrationsCount(sequelize, ctx);
      return { period, count: data.count };
    }
    case 'get_patient_visits': {
      const data = await analytics.getVisitsCount(sequelize, ctx);
      return { period, count: data.count };
    }
    case 'get_revenue': {
      if (!(await hasPrivilege(req, 'accounting.read'))) {
        return { error: 'permission_denied', message: 'This user does not have financial/accounting access.' };
      }
      const baseCurrency = await CurrencyService.getBaseCurrency();
      const data = await analytics.getRevenueTotal(sequelize, ctx);
      return { period, total: data.total, currency: baseCurrency.code, receiptCount: data.count };
    }
    case 'get_doctor_activity': {
      const doctors = await analytics.listDoctors(sequelize, { req, clinicId });
      const doctorEntity = input?.doctor_name ? extractDoctor(input.doctor_name, doctors) : null;
      if (input?.doctor_name && !doctorEntity) {
        return { period, error: 'doctor_not_found', message: `No doctor matching "${input.doctor_name}" was found.` };
      }
      const rows = await analytics.getDoctorActivity(sequelize, { ...ctx, doctorId: doctorEntity?.id });
      return { period, doctors: rows };
    }
    case 'get_department_breakdown': {
      if (!(await hasPrivilege(req, 'accounting.read'))) {
        return { error: 'permission_denied', message: 'This user does not have financial/accounting access.' };
      }
      const baseCurrency = await CurrencyService.getBaseCurrency();
      const data = await analytics.getDepartmentBreakdown(sequelize, ctx);
      return {
        period,
        currency: baseCurrency.code,
        categories: data.rows,
        totalBilled: data.totalBilled,
        categorizedBilled: data.categorizedBilled,
        coveragePercent: data.totalBilled > 0 ? Math.round((data.categorizedBilled / data.totalBilled) * 100) : null,
        note: 'Only line items with a category captured at billing time are included in `categories` — older bills predate category tracking, which is why coveragePercent may be below 100. Mention the coverage if it is materially incomplete.',
      };
    }
    case 'get_hospital_summary': {
      const canSeeRevenue = await hasPrivilege(req, 'accounting.read');
      const [reg, vis, doctors] = await Promise.all([
        analytics.getRegistrationsCount(sequelize, ctx),
        analytics.getVisitsCount(sequelize, ctx),
        analytics.getDoctorActivity(sequelize, ctx),
      ]);
      let revenue = null;
      if (canSeeRevenue) {
        const baseCurrency = await CurrencyService.getBaseCurrency();
        const data = await analytics.getRevenueTotal(sequelize, ctx);
        revenue = { total: data.total, currency: baseCurrency.code, receiptCount: data.count };
      }
      return {
        period,
        registrations: reg.count,
        visits: vis.count,
        revenue: revenue || { error: 'permission_denied' },
        topDoctor: doctors[0] || null,
      };
    }
    default:
      return { error: 'unknown_tool', message: `No such tool: ${name}` };
  }
}

module.exports = { TOOLS, executeTool };
