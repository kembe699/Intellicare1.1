/**
 * The Analytics Assistant's allowlisted query layer. Every function here is
 * a fixed, parameterized SELECT — no user text is ever concatenated into
 * SQL, only validated dates/ids passed as named replacements, matching the
 * read-only requirement in full. There is no free-form query path; an
 * intent that isn't one of the functions below simply cannot be asked.
 *
 * ── Department breakdown: exact category only, never the fuzzy fallback ──
 * `patient_bills.services` line items didn't used to carry a department/
 * category at all — reportClinicPerformance.js approximates one after the
 * fact via normalized-name string matching against the `services` catalog,
 * which that report's own comments say is "far from complete" (the catalog
 * only had 6 rows; many billed names never match it; pharmacy/drug items
 * were never in it to begin with). That's been fixed at the ROOT instead:
 * every place a line item is created from an actual catalog pick
 * (BillDetails.tsx, DispensingWorkflow.tsx, clinical.js's lab auto-bill,
 * TheatreService.js) now stamps a real `category` on the line item at
 * creation time — see each file's own comment for exactly where. getDepartment
 * BreakdownTotals below reads ONLY that exact, captured field — never the
 * fuzzy name-matching reportClinicPerformance.js still falls back to for
 * line items that predate this fix — and openly reports what share of
 * billed revenue in the period actually had a category captured, so the
 * answer never implies more certainty than the data supports.
 *
 * ── Why per-doctor revenue still isn't here ──────────────────────────────
 * `patient_bills` has no `doctor_id`/`visit_id` column at all (confirmed by
 * reading reportDoctorPerformance.js) — unlike department, there was no
 * single "stamp it at creation time" fix available, because nothing at
 * billing time reliably knows which doctor the charge belongs to (a bill is
 * created from LIS test orders, pharmacy dispenses, and theatre usage, any
 * of which can span or follow more than one doctor's involvement with the
 * same patient). reportDoctorPerformance.js's own revenue attribution is an
 * explicitly-disclosed, same-day-billing heuristic for exactly this reason.
 * Reusing it here as a confident chatbot answer would still violate the
 * spec's "never fabricate" requirement, so this question is routed (see
 * responseTemplates.js) to a limitation message pointing at that report
 * instead. Visit/registration counts and doctor *activity* (not revenue)
 * have real foreign keys and are computed exactly, below.
 *
 * ── Revenue definition ───────────────────────────────────────────────────
 * Cash-basis, matching reportIncomeStatement.js's own documented default
 * and receipts.js's /clinic/:clinicId/stats endpoint: counts a receipt when
 * the patient paid (receipts.status = 'active', payment_date in range), not
 * when a bill was raised. Voided/refunded receipts are excluded by the same
 * status filter, so refunds are never double-counted as revenue.
 *
 * ── "Visit" means lis_test_orders, not the legacy `visits` table ────────
 * Confirmed against reportDoctorPerformance.js's own header comment (and
 * reproduced here against the live preview DB): the `visits` table is
 * barely-used legacy data, and its `doctor_id` is stamped with whichever
 * account was logged in when the row was created — never a real
 * role='doctor' user (it's also DataTypes.UUID there, which doesn't even
 * type-match users.id, an INTEGER — joining the two throws a Postgres
 * "operator does not exist: integer = uuid" error, caught while verifying
 * this feature live). The real unit of clinical encounter this system
 * actually uses is a `lis_test_orders` row (created per visit via POST
 * /lis/orders), whose `doctor_id` DOES correctly resolve to real doctor
 * accounts. Visit counts and doctor activity below both query
 * lis_test_orders, same as reportDoctorPerformance.js and reportPatients.js
 * already do. `lis_test_orders.clinic_id` is a separate, unreliable
 * (UUID, often-null) column unrelated to the numeric facility clinic_id —
 * per the same existing reports, it is deliberately NOT filtered on here;
 * branch scoping still applies via branch_id, which is reliable.
 */

/** Same role==='admin'-bypass / branchContext.branchId-else-user.branchId rule as dashboard.js's branchScope(). */
function branchScope(req, replacements, column = 'branch_id') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId || null;
  if (!branchId) return '';
  replacements.branchId = branchId;
  return ` AND ${column} = :branchId`;
}

async function getRegistrationsCount(sequelize, { req, start, end }) {
  const replacements = { start, end };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM lis_participants WHERE created_at >= :start AND created_at < :end${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10) };
}

/**
 * All-time patient count — a current-moment snapshot, not scoped to any
 * period (same metric and same reasoning as dashboard.js's totalPatients:
 * "how many patients were registered this week" and "how many patients are
 * there in total" are two different questions with two different answers).
 */
async function getTotalPatientsCount(sequelize, { req }) {
  const replacements = {};
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM lis_participants WHERE 1=1${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10) };
}

async function getVisitsCount(sequelize, { req, start, end }) {
  const replacements = { start, end };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM lis_test_orders WHERE created_at >= :start AND created_at < :end${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10) };
}

async function getRevenueTotal(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COALESCE(SUM(payment_amount), 0) AS total, COUNT(*) AS cnt
       FROM receipts
      WHERE clinic_id = :clinicId AND status = 'active'
        AND payment_date >= :start AND payment_date < :end${branchSQL}`,
    { replacements },
  );
  return { total: parseFloat(row?.total || 0), count: parseInt(row?.cnt || 0, 10) };
}

/** Doctors visible to this tenant/branch — used both for entity extraction and the full ranking. */
async function listDoctors(sequelize, { req, clinicId }) {
  const replacements = { clinicId };
  const branchSQL = branchScope(req, replacements);
  const [rows] = await sequelize.query(
    `SELECT id, display_name FROM users WHERE role = 'doctor' AND is_active = true AND clinic_id = :clinicId${branchSQL}
     ORDER BY display_name`,
    { replacements },
  );
  return rows;
}

/**
 * Visit counts per doctor, via lis_test_orders.doctor_id -> users (role=
 * 'doctor') — the verified-correct join (see header comment above; the
 * same one reportDoctorPerformance.js already uses). `doctorId` narrows to
 * a single doctor (named-doctor follow-up); omitted, returns the full
 * ranking.
 */
async function getDoctorActivity(sequelize, { req, start, end, doctorId }) {
  const replacements = { start, end };
  const branchSQL = branchScope(req, replacements, 'o.branch_id');
  const doctorSQL = doctorId ? ' AND u.id = :doctorId' : '';
  if (doctorId) replacements.doctorId = doctorId;
  const [rows] = await sequelize.query(
    `SELECT u.id, u.display_name AS "displayName", COUNT(o.id) AS visits
       FROM lis_test_orders o
       JOIN users u ON u.id = o.doctor_id AND u.role = 'doctor'
      WHERE o.created_at >= :start AND o.created_at < :end${branchSQL}${doctorSQL}
      GROUP BY u.id, u.display_name
      ORDER BY visits DESC
      LIMIT 10`,
    { replacements },
  );
  return rows.map((r) => ({ id: r.id, displayName: r.displayName, visits: parseInt(r.visits, 10) }));
}

/**
 * Billed revenue by category, counting only line items that carry the exact
 * `category` field captured at creation time (see header comment) — a line
 * item with no category is still counted in `totalBilled` (so the total
 * always reconciles) but excluded from `rows`/`categorizedBilled`, and the
 * gap between the two is reported rather than hidden. Deliberately BILLED,
 * not collected: a line item's own totalPrice is an exact, stored number,
 * while "collected" would mean re-deriving an estimate per item (the same
 * prorated-by-bill-status approximation reportClinicPerformance.js already
 * does) — stacking one estimate (which category) on top of another
 * (how much of it was actually paid) is exactly the kind of compounded
 * guess the spec's anti-fabrication requirement rules out.
 */
async function getDepartmentBreakdown(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements);
  const [bills] = await sequelize.query(
    `SELECT services FROM patient_bills
      WHERE clinic_id = :clinicId AND bill_date >= :start AND bill_date < :end${branchSQL}`,
    { replacements },
  );

  const byCategory = new Map();
  let totalBilled = 0;
  let categorizedBilled = 0;

  for (const bill of bills) {
    let items = [];
    try {
      const parsed = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      continue; // malformed JSON on this bill — skip it, don't crash the request
    }
    for (const item of items) {
      const amount = parseFloat(item?.totalPrice ?? item?.total_price ?? 0) || 0;
      totalBilled += amount;
      if (item?.category) {
        categorizedBilled += amount;
        byCategory.set(item.category, (byCategory.get(item.category) || 0) + amount);
      }
    }
  }

  const rows = [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { rows, totalBilled, categorizedBilled };
}

/**
 * Cash-basis, same spirit as getRevenueTotal above: counts an expense when
 * it was actually PAID OUT (status='paid', paid_at in range), not when it
 * was logged/submitted for approval (a 'pending_approval'/'approved' row
 * hasn't left the bank yet). This is deliberately the `daily_expenses`
 * table only — the manually-logged operational expense voucher log — NOT
 * the full general-ledger expense-account view reportIncomeStatement.js's
 * accrual mode computes (payroll, depreciation, COGS postings, etc. are a
 * broader, different number — see reportAccounting.js's own comment on
 * this exact distinction). For the same colloquial "how much did we
 * spend" question this chatbot's revenue/visits/registrations answers are
 * already scoped to, this is the right match in kind, not just the
 * cheapest query.
 */
async function getExpensesTotal(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
       FROM daily_expenses
      WHERE clinic_id = :clinicId AND status = 'paid'
        AND paid_at >= :start AND paid_at < :end${branchSQL}`,
    { replacements },
  );
  return { total: parseFloat(row?.total || 0), count: parseInt(row?.cnt || 0, 10) };
}

/**
 * Current-moment snapshot (not period-scoped — "how many items are low on
 * stock right now" has no date range, same reasoning as getTotalPatientsCount
 * above), mirroring dashboard.js's own lowStockAlerts query exactly.
 * Deliberately NOT a total inventory VALUE figure: inventory_items.
 * cost_currency varies per item, and summing quantity*cost across mixed
 * currencies without converting to a base currency first (the way
 * reportInventory.js carefully does) would silently produce a meaningless
 * number — exactly the kind of fabricated-looking-precise figure this
 * assistant is built to avoid. A count is safe; a value total is not,
 * without importing that conversion logic.
 */
async function getLowStockCount(sequelize, { req, clinicId }) {
  const replacements = { clinicId };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM inventory_items
      WHERE clinic_id = :clinicId AND is_active = true
        AND quantity_on_hand <= minimum_stock_level${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10) };
}

// Items with zero stock on hand right now — a current snapshot, same
// WHERE clause as reportInventory.js's own GET /out-of-stock.
async function getOutOfStockCount(sequelize, { req, clinicId }) {
  const replacements = { clinicId };
  const branchSQL = branchScope(req, replacements, 'i.branch_id');
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM inventory_items i
      WHERE i.clinic_id = :clinicId AND i.is_active = true
        AND i.quantity_on_hand = 0${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10) };
}

// Batches expiring within `days` (default 90) — expiry lives on
// inventory_batches, not inventory_items itself (confirmed against
// reportInventory.js's own GET /near-expiry, same WHERE clause: not yet
// expired, still active/partially used stock, expiry within the window).
async function getExpiringStockCount(sequelize, { req, clinicId, days = 90 }) {
  const replacements = { clinicId, days };
  const branchSQL = branchScope(req, replacements, 'bt.branch_id');
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM inventory_batches bt
      WHERE bt.clinic_id = :clinicId
        AND bt.status IN ('active', 'partial_use')
        AND bt.is_expired IS NOT TRUE
        AND bt.expiry_date IS NOT NULL
        AND bt.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + (:days || ' days')::interval${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10), days };
}

// Purchase orders by status in a period — reportDate on order_date, matching
// the Procurement module's own status workflow (draft -> check -> approved
// -> authorized -> received, or cancelled). Deliberately counts/sums only —
// see purchase-orders.js's own model comment: payment_terms/paid_amount
// exist on the real table but aren't on the Sequelize model, so a "how much
// is still unpaid on POs" figure isn't safely derivable here without
// querying those raw columns specifically, which this function doesn't need
// for a status/value overview.
async function getPurchaseOrdersSummary(sequelize, { req, clinicId, start, end, status }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements);
  const statusSQL = status ? ' AND status = :status' : '';
  if (status) replacements.status = status;
  const [[totals]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total
       FROM purchase_orders
      WHERE clinic_id = :clinicId AND order_date >= :start AND order_date < :end${statusSQL}${branchSQL}`,
    { replacements },
  );
  const byStatusReplacements = { clinicId, start, end };
  const byStatusBranchSQL = branchScope(req, byStatusReplacements);
  const [byStatus] = await sequelize.query(
    `SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total
       FROM purchase_orders
      WHERE clinic_id = :clinicId AND order_date >= :start AND order_date < :end${byStatusBranchSQL}
      GROUP BY status
      ORDER BY cnt DESC`,
    { replacements: byStatusReplacements },
  );
  return {
    count: parseInt(totals?.cnt || 0, 10),
    totalValue: parseFloat(totals?.total || 0),
    byStatus: byStatus.map((r) => ({ status: r.status, count: parseInt(r.cnt, 10), total: parseFloat(r.total) })),
  };
}

// Pharmacy dispensing volume/value in a period — dispensing_records is the
// real, live table (drugs/drug_inventory/pharmacy_dispensing are confirmed
// dead/empty — see reportPharmacy.js's own header comment). status='dispensed'
// excludes fully/partially returned lines from the headline total, matching
// pharmacyModule.js's own "today's dispensing" stat; returns are still
// reported separately so a return rate is visible, never silently dropped.
async function getPharmacyDispensingTotal(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements, 'dr.branch_id');
  const [[row]] = await sequelize.query(
    `SELECT
        COUNT(*) FILTER (WHERE dr.status = 'dispensed') AS dispensed_cnt,
        COALESCE(SUM(dr.quantity_dispensed) FILTER (WHERE dr.status = 'dispensed'), 0) AS dispensed_qty,
        COALESCE(SUM(dr.total_price) FILTER (WHERE dr.status = 'dispensed'), 0) AS dispensed_value,
        COUNT(*) FILTER (WHERE dr.status IN ('returned', 'partially_returned')) AS returned_cnt,
        COUNT(DISTINCT dr.patient_id) FILTER (WHERE dr.status = 'dispensed') AS patient_cnt
       FROM dispensing_records dr
      WHERE dr.clinic_id = :clinicId
        AND dr.dispensing_date >= :start AND dr.dispensing_date < :end${branchSQL}`,
    { replacements },
  );
  return {
    dispensedCount: parseInt(row?.dispensed_cnt || 0, 10),
    dispensedQuantity: parseFloat(row?.dispensed_qty || 0),
    dispensedValue: parseFloat(row?.dispensed_value || 0),
    returnedCount: parseInt(row?.returned_cnt || 0, 10),
    patientCount: parseInt(row?.patient_cnt || 0, 10),
  };
}

// Lab (LIS) activity overview — mirrors lab-dashboard's own status buckets
// exactly (lisModule.js GET /lis/lab-dashboard): outstanding = specimens
// not yet approved (pending_collection + routed + received + analyzed),
// completed = status='approved'. Manager-review backlog is a separate,
// already-live number (lis_results.status='pending_manager_review',
// the exact source LISManagerReview.tsx itself reads). Not clinic_id
// scoped — lis_test_orders/lis_specimens.clinic_id is a separate, often-
// null, unreliable column (see this file's header comment); branch_id is
// the reliable scope here, same as every other LIS-backed function above.
async function getLabRegistryOverview(sequelize, { req, start, end }) {
  const statusReplacements = { start, end };
  const statusBranchSQL = branchScope(req, statusReplacements, 's.branch_id');
  const [byStatus] = await sequelize.query(
    `SELECT s.status, COUNT(*) AS cnt
       FROM lis_specimens s
      WHERE s.created_at >= :start AND s.created_at < :end${statusBranchSQL}
      GROUP BY s.status`,
    { replacements: statusReplacements },
  );
  const byStatusMap = Object.fromEntries(byStatus.map((r) => [r.status, parseInt(r.cnt, 10)]));
  const outstanding = (byStatusMap.pending_collection || 0) + (byStatusMap.routed || 0) + (byStatusMap.received || 0) + (byStatusMap.analyzed || 0);
  const completed = byStatusMap.approved || 0;

  const backlogReplacements = {};
  const backlogBranchSQL = branchScope(req, backlogReplacements, 'r.branch_id');
  const [[backlogRow]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM lis_results r WHERE r.status = 'pending_manager_review'${backlogBranchSQL}`,
    { replacements: backlogReplacements },
  );

  return {
    ordersOutstanding: outstanding,
    ordersCompleted: completed,
    ordersTotal: outstanding + completed,
    managerReviewBacklog: parseInt(backlogRow?.cnt || 0, 10),
    byStatus: byStatusMap,
  };
}

// Real, chart-of-accounts-backed income statement — reuses
// reportIncomeStatement.js's own computation functions directly (not a
// second implementation of the waterfall-allocation logic) so this always
// matches the Reports page exactly. basis='cash' (default, matches that
// route's own default) recognizes revenue when collected; basis='accrual'
// recognizes it when billed. Expenses are always the full GL expense-
// account view (payroll, depreciation, COGS, etc.) — a materially larger,
// different number from getExpensesTotal above, which is only the manual
// daily_expenses voucher log.
async function getFullIncomeStatement(sequelize, { req, clinicId, start, end }, basis = 'cash') {
  const reportIncomeStatement = require('../../routes/reportIncomeStatement');
  const toDateStr = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const dateFrom = toDateStr(start);
  // `end` here is exclusive (the day after the last included day, per
  // dateParser.js) — the report's own dateFrom/dateTo are inclusive, so the
  // inclusive dateTo is one day before it.
  const dateTo = toDateStr(new Date(end.getTime() - 24 * 60 * 60 * 1000));

  const [revenue, expenses] = await Promise.all([
    basis === 'accrual'
      ? reportIncomeStatement.fetchSection(clinicId, 'revenue', dateFrom, dateTo, req)
      : reportIncomeStatement.fetchCashRevenue(clinicId, dateFrom, dateTo, req),
    reportIncomeStatement.fetchSection(clinicId, 'expense', dateFrom, dateTo, req),
  ]);
  const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const expenseSections = reportIncomeStatement.splitExpenseSections(expenses);

  return {
    basis,
    period: { dateFrom, dateTo },
    revenueByAccount: revenue,
    expensesByAccount: expenses,
    expenseSections,
    totalRevenue,
    totalExpenses,
    netIncome: totalRevenue - totalExpenses,
  };
}

module.exports = {
  getRegistrationsCount,
  getTotalPatientsCount,
  getVisitsCount,
  getRevenueTotal,
  getExpensesTotal,
  getLowStockCount,
  getOutOfStockCount,
  getExpiringStockCount,
  getPurchaseOrdersSummary,
  getPharmacyDispensingTotal,
  getLabRegistryOverview,
  getFullIncomeStatement,
  getDoctorActivity,
  getDepartmentBreakdown,
  listDoctors,
};
