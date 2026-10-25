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
      enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'all_time'],
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
    description: 'Count of new patient registrations in a period. Set include_list to also get each patient\'s name, patient number, and (if the user has financial access) total billed amount for the period — use that for "list the patients registered today" / "what did they pay for" style questions, not just the count.',
    input_schema: {
      type: 'object',
      properties: {
        period: PERIOD_SCHEMA,
        include_list: { type: 'boolean', description: 'true to also return up to 50 individual patients (name, patient number, registration time, total billed), not just the count.' },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_total_patients',
    description: 'The ALL-TIME total number of patients in the system right now — a current snapshot, not scoped to any period. Use this for "how many patients are there / do we have / in total", NOT for "how many patients were registered this week" (that is get_patient_registrations).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_patient_visits',
    description: 'Count of patient visits / clinical encounters in a period.',
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_revenue',
    description: "Total revenue actually RECEIVED in a period (not amounts billed): counter receipts, invoice payments and insurer claim payments, in base currency, tax excluded. Requires the user to have financial access — the result will say so if they don't; relay that honestly rather than guessing a figure.",
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
    description: "Billed revenue by DEPARTMENT in a period (rows[].department), worked out from each bill line's category and the department that category is linked to in Setup › Categories; voided lines excluded. coveragePercent says how much of the period's billing could be traced to a department. Requires financial access. There is deliberately NO equivalent tool for revenue per doctor — patient bills have no doctor attribution at all, so if asked, say plainly that isn't reliably trackable rather than estimating.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_hospital_summary',
    description: "A broad overview across every module for a period in one call: registrations, visits, revenue (if authorized), the busiest doctor, lab orders outstanding/completed and the manager-review backlog, pharmacy dispensing, purchase orders, and inventory out-of-stock/expiring counts. Use this for 'overview', 'what's happening', 'all activities', 'how's the hospital doing' — anything asking broadly rather than about one specific module.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_doctor_directory',
    description: 'The full roster of doctors currently registered in the system (just names), with no date scope at all. Use this for "who are the doctors" / "list all doctors" style questions, NOT for visit/activity counts (use get_doctor_activity for those).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_low_stock',
    description: 'The current count of inventory items at or below their reorder level right now — a current snapshot, not scoped to any period. There is deliberately no tool for total inventory VALUE (cost * quantity), since items can be costed in different currencies and summing across them without conversion would be misleading.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_expenses',
    description: "Total cash expenses actually PAID OUT (from the daily expense voucher log, status='paid' only — not pending/unapproved requests, and not the full general-ledger expense view) in a period. Set include_list to also get each individual payment voucher (date, description, category, amount, payment method, voucher number) — use that for 'what was paid today and what for' / 'payment vouchers' rather than just the total. Requires financial access.",
    input_schema: {
      type: 'object',
      properties: {
        period: PERIOD_SCHEMA,
        include_list: { type: 'boolean', description: 'true to also return up to 50 individual paid expense vouchers, not just the total.' },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_income_statement',
    description: "The real income statement (Profit & Loss) for a period, from the actual chart-of-accounts / general ledger — the same figures the Reports page's Income Statement shows, not an approximation. basis='cash' (default) recognizes revenue when collected, matching the cashier and the Dashboard; basis='accrual' recognizes it when billed, matching the receivable balance. Expenses are always the full general-ledger expense view (payroll, depreciation, cost of sales, etc. — a materially larger figure than get_expenses below, which is only the manual expense-voucher log). Requires financial access. Use this for 'income statement', 'profit and loss', 'net income', or 'revenue and expenses together'.",
    input_schema: {
      type: 'object',
      properties: {
        period: PERIOD_SCHEMA,
        basis: { type: 'string', enum: ['cash', 'accrual'], description: "'cash' (default) = recognized when collected/paid; 'accrual' = recognized when billed/incurred. Only set this if the user specifically asks for billed-not-collected or an accrual view." },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_purchase_orders',
    description: "Purchase orders in a period, by status (draft, check, approved, authorized, received, cancelled) — count and total value, overall and broken down per status. Set include_list to also get each individual PO (number, supplier, status, approval stage/who signed it, amount) — use that for 'show me the POs done today, with their approval level/status' rather than just the aggregate. Use for 'any POs', 'purchase orders', 'pending purchase orders', procurement questions.",
    input_schema: {
      type: 'object',
      properties: {
        period: PERIOD_SCHEMA,
        status: { type: 'string', enum: ['draft', 'check', 'approved', 'authorized', 'received', 'cancelled'], description: 'Filter to just this status — omit for all statuses (the result still includes a full per-status breakdown either way).' },
        include_list: { type: 'boolean', description: 'true to also return up to 50 individual purchase orders with their approval stage, not just the aggregate.' },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_pharmacy_dispensing',
    description: "Pharmacy dispensing activity in a period: count, quantity, and value of medications actually dispensed, plus how many of those were later returned/partially returned, and how many distinct patients were served. This IS the dispensing report (matches the Pharmacy Report page's own numbers). Use for 'pharmacy dispensing report', 'what was dispensed', 'pharmacy activity'.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_inventory_status',
    description: "Current inventory health snapshot: items out of stock right now, and stock batches expiring within a window (default 90 days). Not scoped to any period (these are current-moment facts). Deliberately no inventory VALUE total here either, same reasoning as get_low_stock — see that tool. Use for 'what's going on with inventory', 'out of stock', 'expiring stock'.",
    input_schema: {
      type: 'object',
      properties: {
        expiring_within_days: { type: 'integer', description: 'How many days ahead to check for expiring batches. Defaults to 90 if omitted.' },
      },
      required: [],
    },
  },
  {
    name: 'get_lab_registry',
    description: "Lab (LIS) activity overview in a period: orders outstanding (not yet approved: pending collection, routed, received, or analyzed), orders completed (approved), total, and the manager-review backlog (results awaiting a manager's sign-off right now, a current snapshot regardless of the period given). Matches the LIS dashboard and the manager-review queue exactly. Use for 'lab registry', 'lis overview', 'how's the lab doing', 'pending reviews'.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_bills_by_status',
    description: "Patient bills raised in a period, grouped by status (pending, partial, paid, overdue, active, written_off) — count and billed total per status. Requires financial access. Use for 'bills by status', 'how many bills are overdue', 'billing breakdown'.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_outstanding_balance',
    description: "Total outstanding (unpaid) balance across all patient bills right now — a current snapshot, not scoped to any period. Requires financial access. Use for 'outstanding balance', 'how much is owed to us', 'receivables', 'unpaid bills'.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_staff_count',
    description: "Active staff headcount right now (employees with employment_type='staff', excludes consultants and anyone terminated/on leave) — a current snapshot. No special permission needed (payroll figures are a separate concern this tool does not expose). Use for 'how many staff do we have', 'staff count', 'headcount'.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_radiology_overview',
    description: "Radiology requests in a period, by status: pending, in progress, completed, and the total. Use for 'radiology', 'imaging requests', 'how's radiology doing'.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_theatre_overview',
    description: "Theatre/OR operations in a period: total, completed, cancelled, deaths, and average procedure duration in minutes. Revenue from billed operations is included only if the user has financial access (omitted, not guessed, otherwise). Use for 'theatre', 'operating room', 'surgeries', 'operations'.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_inpatient_occupancy',
    description: "Current inpatient/ward status — a snapshot, not scoped to any period: active admissions, total beds, available beds, total wards, occupancy rate (%), plus admissions and discharges specifically TODAY (always today, regardless of any period mentioned — this mirrors the real Inpatient dashboard's own figures exactly). Use for 'inpatient', 'admissions', 'bed occupancy', 'ward status', 'how full are we'.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_system_counts',
    description: "Basic system configuration counts, never passwords or tokens: active user accounts (optionally filtered to one role), configured branches, and configured clinics. Use for 'how many staff accounts', 'how many branches', 'how many clinics do we have set up'.",
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['admin', 'reception', 'doctor', 'lab', 'pharmacy', 'reports', 'accountant', 'finance_manager', 'auditor', 'procurement', 'nurse', 'cashier'], description: 'Filter the account count to just this role — omit for all active accounts.' },
      },
      required: [],
    },
  },
  {
    name: 'get_appointments',
    description: "Appointments scheduled in a period, by status (scheduled, queued once converted into a visit, or cancelled). Use for 'appointments', 'how many appointments today', 'scheduled visits'.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_referrals',
    description: "Inter-branch patient referrals in a period, by status (pending, accepted, rejected, cancelled). Use for 'referrals', 'patient referrals', 'how many patients were referred'.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_stock_movements',
    description: "A table of individual stock movements in a period — every receipt, dispense, adjustment, transfer, waste, and damage event, each as its own row with item, quantity change, and reference. Use for 'stock movement', 'what moved in the pharmacy/store today', 'inventory transactions'. This is the detailed movement feed; use get_pharmacy_dispensing instead for just the aggregate dispensing total/value. Requires pharmacy access.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_currency_info',
    description: "The currencies configured in this system (code, symbol, which one is the base currency) and the most recent exchange rate for each currency pair on record. A snapshot, not scoped to any period. Use for 'what currency are we using', 'what's the exchange rate', 'what's the base currency'. Requires financial rates access.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_patient_visit_summary',
    description: "A single patient's most recent visit: chief complaint, tests ordered (with status), and what was billed (if the user has financial access) — the same information the Visit Summary screen shows. patient_query can be a patient/participant number (exact) or a name (fuzzy-matched). If more than one patient matches the name, the result comes back as a list of candidates to ask the user to pick from — don't guess which one. Use for 'visit summary for <name/number>', 'what happened on this patient's visit'.",
    input_schema: {
      type: 'object',
      properties: { patient_query: { type: 'string', description: "A patient's name or participant/patient number." } },
      required: ['patient_query'],
    },
  },
  {
    name: 'get_inpatient_report',
    description: "Currently-admitted inpatients (name, ward, admission date, and — if the user has financial access — their accumulated bill so far), plus how many patients were discharged in the given period. Distinct from get_inpatient_occupancy (a bed/ward capacity snapshot) — use THIS tool for 'how many patients are currently admitted and what do they owe', 'discharges last month', 'inpatients report for a date range'.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_suppliers',
    description: "The procurement supplier catalog (name, code, contact, phone, preferred/on-hold status, currency) — a current snapshot, not scoped to any period. active_only (default true) excludes suppliers on hold. Use for 'show me our suppliers', 'list of suppliers'. Requires procurement access.",
    input_schema: {
      type: 'object',
      properties: { active_only: { type: 'boolean', description: 'Defaults to true (excludes on-hold suppliers). Set false to include every supplier.' } },
      required: [],
    },
  },
  {
    name: 'get_grn_summary',
    description: "Goods Receipt Notes (GRNs) in a period — each one's GRN number, the PO it came from, supplier, status (pending_inspection/inspected/accepted/rejected), items received, and date. This is the real record of what procurement actually received, distinct from a PO's own status. Use for 'GRNs done today', 'what did we receive from suppliers'. Requires procurement access.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
  {
    name: 'get_requisitions_by_department',
    description: "Purchase requisitions in a period, grouped by requesting department: count and total value per department, ranked by count. Use for 'which department requisitions the most', 'consumption by department', 'procurement requests by department'. Requires procurement access.",
    input_schema: { type: 'object', properties: { period: PERIOD_SCHEMA }, required: ['period'] },
  },
];

async function executeTool(name, input, { sequelize, req, clinicId }) {
  const periodResolved = resolveNamedPeriod(input?.period || {});
  const ctx = { req, clinicId, start: periodResolved.start, end: periodResolved.end };
  const period = periodResolved.label;

  switch (name) {
    case 'get_patient_registrations': {
      const data = await analytics.getRegistrationsCount(sequelize, { ...ctx, includeList: !!input?.include_list });
      const result = { period, count: data.count };
      if (data.patients) {
        const canSeeRevenue = await hasPrivilege(req, 'accounting.read');
        result.patients = canSeeRevenue
          ? data.patients
          : data.patients.map(({ totalBilled, ...rest }) => rest);
        result.table = {
          columns: canSeeRevenue ? ['Patient', 'Patient #', 'Registered', 'Total billed'] : ['Patient', 'Patient #', 'Registered'],
          rows: result.patients.map((p) => {
            const row = [p.name, p.participantNumber, new Date(p.registeredAt).toISOString().split('T')[0]];
            if (canSeeRevenue) row.push((p.totalBilled || 0).toFixed(2));
            return row;
          }),
        };
      }
      return result;
    }
    case 'get_total_patients': {
      const data = await analytics.getTotalPatientsCount(sequelize, { req });
      return { count: data.count, note: 'All-time snapshot — not scoped to any period.' };
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
      return { period, total: data.total, taxCollected: data.tax, currency: baseCurrency.code, paymentCount: data.count };
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
      const [reg, vis, doctors, lab, dispensing, purchaseOrders, outOfStock, expiring] = await Promise.all([
        analytics.getRegistrationsCount(sequelize, ctx),
        analytics.getVisitsCount(sequelize, ctx),
        analytics.getDoctorActivity(sequelize, ctx),
        analytics.getLabRegistryOverview(sequelize, ctx),
        analytics.getPharmacyDispensingTotal(sequelize, ctx),
        analytics.getPurchaseOrdersSummary(sequelize, ctx),
        analytics.getOutOfStockCount(sequelize, { req, clinicId }),
        analytics.getExpiringStockCount(sequelize, { req, clinicId }),
      ]);
      let revenue = null;
      if (canSeeRevenue) {
        const baseCurrency = await CurrencyService.getBaseCurrency();
        const data = await analytics.getRevenueTotal(sequelize, ctx);
        revenue = { total: data.total, currency: baseCurrency.code, paymentCount: data.count };
      }
      return {
        period,
        registrations: reg.count,
        visits: vis.count,
        revenue: revenue || { error: 'permission_denied' },
        topDoctor: doctors[0] || null,
        lab: { ordersOutstanding: lab.ordersOutstanding, ordersCompleted: lab.ordersCompleted, managerReviewBacklog: lab.managerReviewBacklog },
        pharmacy: { dispensedCount: dispensing.dispensedCount, dispensedValue: dispensing.dispensedValue },
        purchaseOrders: { count: purchaseOrders.count, totalValue: purchaseOrders.totalValue },
        inventory: { outOfStockCount: outOfStock.count, expiringCount: expiring.count },
      };
    }
    case 'get_doctor_directory': {
      const doctors = await analytics.listDoctors(sequelize, { req, clinicId });
      return { doctors: doctors.map((d) => ({ id: d.id, name: d.display_name })) };
    }
    case 'get_low_stock': {
      const data = await analytics.getLowStockCount(sequelize, { req, clinicId });
      return { count: data.count, note: 'Current snapshot — not scoped to any period.' };
    }
    case 'get_expenses': {
      if (!(await hasPrivilege(req, 'accounting.read'))) {
        return { error: 'permission_denied', message: 'This user does not have financial/accounting access.' };
      }
      const baseCurrency = await CurrencyService.getBaseCurrency();
      const data = await analytics.getExpensesTotal(sequelize, { ...ctx, includeList: !!input?.include_list });
      const result = { period, total: data.total, currency: baseCurrency.code, voucherCount: data.count };
      if (data.vouchers) {
        result.vouchers = data.vouchers;
        result.table = {
          columns: ['Date', 'Description', 'Category', 'Amount', 'Voucher #'],
          rows: data.vouchers.map((v) => [new Date(v.expenseDate).toISOString().split('T')[0], v.description, v.category, v.amount.toFixed(2), v.voucherNumber || '']),
        };
      }
      return result;
    }
    case 'get_income_statement': {
      if (!(await hasPrivilege(req, 'accounting.read'))) {
        return { error: 'permission_denied', message: 'This user does not have financial/accounting access.' };
      }
      const basis = input?.basis === 'accrual' ? 'accrual' : 'cash';
      const baseCurrency = await CurrencyService.getBaseCurrency();
      const data = await analytics.getFullIncomeStatement(sequelize, ctx, basis);
      return {
        period,
        basis,
        currency: baseCurrency.code,
        revenue: data.totalRevenue,
        expenses: data.totalExpenses,
        netIncome: data.netIncome,
        expensesByCategory: data.expenseSections,
        note: `From the general ledger (chart of accounts), basis=${basis} — the same figures the Reports page's Income Statement shows.`,
      };
    }
    case 'get_purchase_orders': {
      const data = await analytics.getPurchaseOrdersSummary(sequelize, { ...ctx, status: input?.status, includeList: !!input?.include_list });
      const result = { period, count: data.count, totalValue: data.totalValue, byStatus: data.byStatus };
      if (data.pos) {
        result.pos = data.pos;
        result.table = {
          columns: ['PO #', 'Supplier', 'Approval stage', 'Amount', 'Date'],
          rows: data.pos.map((p) => [p.poNumber, p.supplierName, p.approvalStage, `${p.totalAmount.toFixed(2)} ${p.currency}`, new Date(p.orderDate).toISOString().split('T')[0]]),
        };
      }
      return result;
    }
    case 'get_pharmacy_dispensing': {
      const data = await analytics.getPharmacyDispensingTotal(sequelize, ctx);
      return {
        period,
        dispensedCount: data.dispensedCount,
        dispensedQuantity: data.dispensedQuantity,
        dispensedValue: data.dispensedValue,
        returnedCount: data.returnedCount,
        patientCount: data.patientCount,
      };
    }
    case 'get_inventory_status': {
      const days = Number.isFinite(input?.expiring_within_days) ? input.expiring_within_days : 90;
      const [outOfStock, expiring] = await Promise.all([
        analytics.getOutOfStockCount(sequelize, { req, clinicId }),
        analytics.getExpiringStockCount(sequelize, { req, clinicId, days }),
      ]);
      return { outOfStockCount: outOfStock.count, expiringCount: expiring.count, expiringWithinDays: days, note: 'Current snapshot — not scoped to any period.' };
    }
    case 'get_lab_registry': {
      const data = await analytics.getLabRegistryOverview(sequelize, ctx);
      return {
        period,
        ordersOutstanding: data.ordersOutstanding,
        ordersCompleted: data.ordersCompleted,
        ordersTotal: data.ordersTotal,
        managerReviewBacklog: data.managerReviewBacklog,
        note: 'managerReviewBacklog is a current snapshot regardless of the period given; the order counts above are scoped to the period.',
      };
    }
    case 'get_bills_by_status': {
      if (!(await hasPrivilege(req, 'accounting.read'))) {
        return { error: 'permission_denied', message: 'This user does not have financial/accounting access.' };
      }
      const baseCurrency = await CurrencyService.getBaseCurrency();
      const rows = await analytics.getBillsByStatus(sequelize, ctx);
      return { period, currency: baseCurrency.code, byStatus: rows };
    }
    case 'get_outstanding_balance': {
      if (!(await hasPrivilege(req, 'accounting.read'))) {
        return { error: 'permission_denied', message: 'This user does not have financial/accounting access.' };
      }
      const baseCurrency = await CurrencyService.getBaseCurrency();
      const data = await analytics.getOutstandingBalance(sequelize, { req, clinicId });
      return { count: data.count, total: data.total, currency: baseCurrency.code, note: 'Current snapshot — not scoped to any period.' };
    }
    case 'get_staff_count': {
      const data = await analytics.getActiveStaffCount(sequelize, { req, clinicId });
      return { count: data.count, note: 'Current snapshot — not scoped to any period. Excludes consultants and anyone terminated/on leave.' };
    }
    case 'get_radiology_overview': {
      const data = await analytics.getRadiologyOverview(sequelize, ctx);
      return { period, pending: data.pending, inProgress: data.inProgress, completed: data.completed, total: data.total };
    }
    case 'get_theatre_overview': {
      const canSeeRevenue = await hasPrivilege(req, 'accounting.read');
      const data = await analytics.getTheatreOverview(sequelize, ctx);
      const result = {
        period,
        total: data.total,
        completed: data.completed,
        cancelled: data.cancelled,
        deaths: data.deaths,
        avgDurationMinutes: data.avgDurationMinutes,
      };
      if (canSeeRevenue) {
        const baseCurrency = await CurrencyService.getBaseCurrency();
        result.totalRevenue = data.totalRevenue;
        result.currency = baseCurrency.code;
      }
      return result;
    }
    case 'get_inpatient_occupancy': {
      const data = await analytics.getInpatientOccupancy(sequelize, { req, clinicId });
      return { ...data, note: 'Current snapshot — not scoped to any period. admittedToday/dischargedToday are always today.' };
    }
    case 'get_system_counts': {
      const [accounts, facilities] = await Promise.all([
        analytics.getStaffAccountsCount(sequelize, { req, role: input?.role }),
        analytics.getFacilityCounts(sequelize),
      ]);
      return { staffAccounts: accounts.count, role: input?.role || null, branches: facilities.branches, clinics: facilities.clinics };
    }
    case 'get_appointments': {
      const rows = await analytics.getAppointmentsByStatus(sequelize, ctx);
      return { period, byStatus: rows };
    }
    case 'get_referrals': {
      const rows = await analytics.getReferralsByStatus(sequelize, ctx);
      return { period, byStatus: rows };
    }
    case 'get_stock_movements': {
      if (!(await hasPrivilege(req, 'pharmacy.read'))) {
        return { error: 'permission_denied', message: 'This user does not have pharmacy access.' };
      }
      const data = await analytics.getStockMovements(sequelize, { clinicId, start: periodResolved.start, end: periodResolved.end });
      return { period, count: data.count, movements: data.movements, table: data.table };
    }
    case 'get_currency_info': {
      if (!(await hasPrivilege(req, 'accounting.rates.read'))) {
        return { error: 'permission_denied', message: 'This user does not have access to currency/exchange rate configuration.' };
      }
      const data = await analytics.getCurrencyInfo(sequelize, { clinicId });
      return { currencies: data.currencies, exchangeRates: data.exchangeRates, table: data.table, note: 'Current configuration — not scoped to any period.' };
    }
    case 'get_patient_visit_summary': {
      if (!(await hasPrivilege(req, 'lis.clinical.read'))) {
        return { error: 'permission_denied', message: 'This user does not have clinical access.' };
      }
      const canSeeRevenue = await hasPrivilege(req, 'accounting.read');
      const data = await analytics.getPatientVisitSummary(sequelize, { req, patientQuery: String(input?.patient_query || ''), canSeeRevenue });
      return data;
    }
    case 'get_inpatient_report': {
      const canSeeRevenue = await hasPrivilege(req, 'accounting.read');
      const data = await analytics.getInpatientReport(sequelize, { req, clinicId, start: periodResolved.start, end: periodResolved.end, canSeeRevenue });
      return { period, ...data, note: 'admittedPatients is a current snapshot (not scoped to the period); dischargedInPeriod is scoped to the given period.' };
    }
    case 'get_suppliers': {
      if (!(await hasPrivilege(req, 'procurement.read'))) {
        return { error: 'permission_denied', message: 'This user does not have procurement access.' };
      }
      const data = await analytics.getSuppliers(sequelize, { clinicId, activeOnly: input?.active_only !== false });
      return data;
    }
    case 'get_grn_summary': {
      if (!(await hasPrivilege(req, 'procurement.read'))) {
        return { error: 'permission_denied', message: 'This user does not have procurement access.' };
      }
      const data = await analytics.getGrnSummary(sequelize, { req, clinicId, start: periodResolved.start, end: periodResolved.end });
      return { period, ...data };
    }
    case 'get_requisitions_by_department': {
      if (!(await hasPrivilege(req, 'procurement.read'))) {
        return { error: 'permission_denied', message: 'This user does not have procurement access.' };
      }
      const data = await analytics.getRequisitionsByDepartment(sequelize, { req, clinicId, start: periodResolved.start, end: periodResolved.end });
      return { period, ...data };
    }
    default:
      return { error: 'unknown_tool', message: `No such tool: ${name}` };
  }
}

module.exports = { TOOLS, executeTool };
