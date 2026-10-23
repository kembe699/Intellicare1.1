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

async function getRegistrationsCount(sequelize, { req, start, end, includeList }) {
  const replacements = { start, end };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM lis_participants WHERE created_at >= :start AND created_at < :end${branchSQL}`,
    { replacements },
  );
  const result = { count: parseInt(row?.cnt || 0, 10) };
  if (!includeList) return result;

  const listReplacements = { start, end };
  const listBranchSQL = branchScope(req, listReplacements);
  const [patients] = await sequelize.query(
    `SELECT id, participant_number, first_name, last_name, created_at
       FROM lis_participants
      WHERE created_at >= :start AND created_at < :end${listBranchSQL}
      ORDER BY created_at DESC LIMIT 50`,
    { replacements: listReplacements },
  );

  // patient_bills.patient_id shares lis_participants' id space (same join
  // used by inpatient.js's billing context and getDepartmentBreakdown
  // above) — summed here so "what did they pay for" can at least answer
  // "how much", not itemized (that's get_patient_visit_summary's job for a
  // single named patient).
  let billedByPatient = {};
  if (patients.length > 0) {
    const billReplacements = { patientIds: patients.map((p) => p.id) };
    const billBranchSQL = branchScope(req, billReplacements);
    const [billRows] = await sequelize.query(
      `SELECT patient_id, SUM(total_amount) AS total
         FROM patient_bills
        WHERE patient_id IN (:patientIds)${billBranchSQL}
        GROUP BY patient_id`,
      { replacements: billReplacements },
    );
    billedByPatient = Object.fromEntries(billRows.map((r) => [r.patient_id, parseFloat(r.total) || 0]));
  }

  result.patients = patients.map((p) => ({
    id: p.id,
    participantNumber: p.participant_number,
    name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    registeredAt: p.created_at,
    totalBilled: billedByPatient[p.id] ?? 0,
  }));
  return result;
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
async function getExpensesTotal(sequelize, { req, clinicId, start, end, includeList }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
       FROM daily_expenses
      WHERE clinic_id = :clinicId AND status = 'paid'
        AND paid_at >= :start AND paid_at < :end${branchSQL}`,
    { replacements },
  );
  const result = { total: parseFloat(row?.total || 0), count: parseInt(row?.cnt || 0, 10) };
  if (!includeList) return result;

  const listReplacements = { clinicId, start, end };
  const listBranchSQL = branchScope(req, listReplacements);
  const [vouchers] = await sequelize.query(
    `SELECT expense_date, description, category, amount, payment_method, voucher_number
       FROM daily_expenses
      WHERE clinic_id = :clinicId AND status = 'paid'
        AND paid_at >= :start AND paid_at < :end${listBranchSQL}
      ORDER BY paid_at DESC LIMIT 50`,
    { replacements: listReplacements },
  );
  result.vouchers = vouchers.map((r) => ({
    expenseDate: r.expense_date,
    description: r.description,
    category: r.category || 'Uncategorized',
    amount: parseFloat(r.amount) || 0,
    paymentMethod: r.payment_method,
    voucherNumber: r.voucher_number,
  }));
  return result;
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
// A PO's "approval level" isn't a separate table — it's the status enum
// itself plus per-stage signer columns right on purchase_orders (confirmed
// against the real schema: check_signed_by/approved_signed_by/
// authorized_signed_by, no separate approvals-history table exists). This
// turns that into the one-line answer a chat reply actually wants.
function describePoApprovalStage(row) {
  switch (row.status) {
    case 'draft': return 'Draft — not yet submitted for checking';
    case 'check': return row.check_signed_by ? `Checked by ${row.check_signed_by}, awaiting approval` : 'Awaiting check';
    case 'approved': return row.approved_signed_by ? `Approved by ${row.approved_signed_by}, awaiting authorization` : 'Awaiting approval';
    case 'authorized': return row.authorized_signed_by ? `Authorized by ${row.authorized_signed_by}, awaiting receipt` : 'Awaiting authorization';
    case 'received': return 'Received';
    case 'cancelled': return 'Cancelled';
    default: return row.status || 'Unknown';
  }
}

async function getPurchaseOrdersSummary(sequelize, { req, clinicId, start, end, status, includeList }) {
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
  const result = {
    count: parseInt(totals?.cnt || 0, 10),
    totalValue: parseFloat(totals?.total || 0),
    byStatus: byStatus.map((r) => ({ status: r.status, count: parseInt(r.cnt, 10), total: parseFloat(r.total) })),
  };
  if (!includeList) return result;

  const listReplacements = { clinicId, start, end };
  const listStatusSQL = status ? ' AND po.status = :status' : '';
  if (status) listReplacements.status = status;
  const listBranchSQL = branchScope(req, listReplacements, 'po.branch_id');
  const [pos] = await sequelize.query(
    `SELECT po.po_number, po.status, po.total_amount, po.po_currency, po.order_date,
            po.check_signed_by, po.approved_signed_by, po.authorized_signed_by, s.name AS supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.clinic_id = :clinicId AND po.order_date >= :start AND po.order_date < :end${listStatusSQL}${listBranchSQL}
      ORDER BY po.order_date DESC LIMIT 50`,
    { replacements: listReplacements },
  );
  const [[baseRow]] = await sequelize.query('SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1');
  const baseCurrency = baseRow?.code || 'SSP';
  result.pos = pos.map((r) => ({
    poNumber: r.po_number,
    supplierName: r.supplier_name || 'Unknown supplier',
    status: r.status,
    approvalStage: describePoApprovalStage(r),
    totalAmount: parseFloat(r.total_amount) || 0,
    currency: r.po_currency || baseCurrency,
    orderDate: r.order_date,
  }));
  return result;
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
//
// Known gap in the read-only-role defense-in-depth layer (see
// ensureAnalyticsReadOnlyRole.js / tenantDb.js's getReadOnlyTenantConnection):
// the `sequelize` parameter here is accepted for signature consistency
// with every other function in this file, but reportIncomeStatement.js's
// fetchSection/fetchCashRevenue don't use it — they resolve their own
// connection via tenantContext (AsyncLocalStorage), same as every other
// route in this app. That means this one tool's queries still run on the
// normal full-access tenant connection even when the Analytics Assistant's
// read-only connection is in use for everything else. Not a regression —
// application-level permission checks (accounting.read, see llmTools.js)
// are still the primary protection here — but worth knowing if the
// read-only layer is ever treated as a complete guarantee rather than a
// second layer. Fixing it would mean threading an injectable connection
// through reportIncomeStatement.js itself, which this change deliberately
// doesn't touch — that route is relied on by the real Income Statement
// report page and isn't something to risk destabilizing for this.
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

// Bills raised in a period, grouped by patient_bills.status (the real enum:
// pending/partial/paid/overdue/active/written_off — confirmed from the live
// ALTER in billingEnhanced.js, not guessed). count + billed total per status.
async function getBillsByStatus(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements);
  const [rows] = await sequelize.query(
    `SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total
       FROM patient_bills
      WHERE clinic_id = :clinicId AND bill_date >= :start AND bill_date < :end${branchSQL}
      GROUP BY status
      ORDER BY cnt DESC`,
    { replacements },
  );
  return rows.map((r) => ({ status: r.status, count: parseInt(r.cnt, 10), total: parseFloat(r.total) }));
}

// Current outstanding balance — a snapshot, not period-scoped (an unpaid
// bill from any date is still outstanding today). Same filter as the real
// receivables list/aging report (billingEnhanced.js): balance_amount > 0
// AND status != 'paid'. That real route applies no branch scoping at all
// (a gap in the existing code) — this tool still scopes by branch properly
// rather than copying that gap.
async function getOutstandingBalance(sequelize, { req, clinicId }) {
  const replacements = { clinicId };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(balance_amount), 0) AS total
       FROM patient_bills
      WHERE clinic_id = :clinicId AND balance_amount > 0 AND status != 'paid'${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10), total: parseFloat(row?.total || 0) };
}

// Active staff headcount — mirrors hr.js's own "how many active staff"
// query exactly (employees.employment_type='staff' excludes consultants;
// employment_status='active' excludes terminated/on_leave; is_active=true
// is the soft-delete flag). Distinct from `users` (system login accounts)
// — see getStaffAccountsCount below for that.
async function getActiveStaffCount(sequelize, { req, clinicId }) {
  const replacements = { clinicId };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM employees
      WHERE clinic_id = :clinicId AND employment_type = 'staff' AND employment_status = 'active' AND is_active = true${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10) };
}

// Radiology requests by status in a period — mirrors radiology.js's own
// real status literals (pending -> in_progress -> completed; no cancelled
// status exists for this table). Branch scoping here is deliberately the
// NULL-inclusive form radiology.js itself uses (its own comment: legacy/
// catalog rows with no branch_id must stay visible everywhere) rather than
// this file's stricter default branchScope, so a branch-scoped user sees
// the same count the real Radiology page would show them.
async function getRadiologyOverview(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  let branchSQL = '';
  if (!(req.user?.role === 'admin' && !req.branchContext?.adminScoped)) {
    const branchId = req.branchContext?.branchId || req.user?.branchId;
    if (branchId) {
      replacements.branchId = branchId;
      branchSQL = ' AND (branch_id = :branchId OR branch_id IS NULL)';
    }
  }
  const [[row]] = await sequelize.query(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_cnt,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_cnt,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_cnt,
        COUNT(*) AS total_cnt
       FROM radiology_requests
      WHERE clinic_id = :clinicId AND request_date >= :start AND request_date < :end${branchSQL}`,
    { replacements },
  );
  return {
    pending: parseInt(row?.pending_cnt || 0, 10),
    inProgress: parseInt(row?.in_progress_cnt || 0, 10),
    completed: parseInt(row?.completed_cnt || 0, 10),
    total: parseInt(row?.total_cnt || 0, 10),
  };
}

// Theatre/OR operations in a period — the same aggregation
// reportTheatre.js's own summary computes (status counts, deaths via
// outcome='death', revenue only for billed operations, average duration).
// reportTheatre.js is a router file with no exported function to call
// directly (unlike reportIncomeStatement.js), so this is a verified
// inline copy of its real query, same precedent as the LIS/pharmacy/
// purchase-order functions above.
async function getTheatreOverview(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements, 'o');
  const [[row]] = await sequelize.query(
    `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE o.status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
        COUNT(*) FILTER (WHERE o.outcome = 'death') AS deaths,
        COALESCE(SUM(o.procedure_fee) FILTER (WHERE o.bill_id IS NOT NULL), 0) AS total_revenue,
        AVG(o.duration_minutes) FILTER (WHERE o.duration_minutes IS NOT NULL) AS avg_duration_minutes
       FROM theatre_operations o
      WHERE o.clinic_id = :clinicId AND o.scheduled_at >= :start AND o.scheduled_at < :end${branchSQL}`,
    { replacements },
  );
  return {
    total: parseInt(row?.total || 0, 10),
    completed: parseInt(row?.completed || 0, 10),
    cancelled: parseInt(row?.cancelled || 0, 10),
    deaths: parseInt(row?.deaths || 0, 10),
    totalRevenue: parseFloat(row?.total_revenue || 0),
    avgDurationMinutes: row?.avg_duration_minutes != null ? parseFloat(row.avg_duration_minutes) : null,
  };
}

// Current inpatient occupancy — a snapshot (not period-scoped), reusing
// inpatient.js's own GET /inpatient/stats query verbatim (same table/
// column/status literals: beds.status, inpatient_admissions.status).
// dischargedToday/admittedToday are always "today" in this real query,
// same as the page itself — not affected by any period the caller passes.
async function getInpatientOccupancy(sequelize, { req, clinicId }) {
  const scoped = (extraReplacements = {}) => {
    const replacements = { clinicId, ...extraReplacements };
    const branchSQL = branchScope(req, replacements);
    return { replacements, branchSQL };
  };

  const activeQ = scoped();
  const [[active]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM inpatient_admissions WHERE clinic_id = :clinicId AND status = 'active'${activeQ.branchSQL}`,
    { replacements: activeQ.replacements },
  );
  const totalBedsQ = scoped();
  const [[totalBeds]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM beds WHERE clinic_id = :clinicId AND is_active = true${totalBedsQ.branchSQL}`,
    { replacements: totalBedsQ.replacements },
  );
  const availableBedsQ = scoped();
  const [[availableBeds]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM beds WHERE clinic_id = :clinicId AND is_active = true AND status = 'available'${availableBedsQ.branchSQL}`,
    { replacements: availableBedsQ.replacements },
  );
  const wardsQ = scoped();
  const [[wards]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM wards WHERE clinic_id = :clinicId AND is_active = true${wardsQ.branchSQL}`,
    { replacements: wardsQ.replacements },
  );
  const dischargedQ = scoped();
  const [[dischargedToday]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM inpatient_admissions WHERE clinic_id = :clinicId AND status = 'discharged' AND DATE(discharge_date) = CURRENT_DATE${dischargedQ.branchSQL}`,
    { replacements: dischargedQ.replacements },
  );
  const admittedQ = scoped();
  const [[admittedToday]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM inpatient_admissions WHERE clinic_id = :clinicId AND DATE(admission_date) = CURRENT_DATE${admittedQ.branchSQL}`,
    { replacements: admittedQ.replacements },
  );

  const totalBedsN = parseInt(totalBeds?.cnt || 0, 10);
  const availableBedsN = parseInt(availableBeds?.cnt || 0, 10);

  return {
    activeAdmissions: parseInt(active?.cnt || 0, 10),
    totalBeds: totalBedsN,
    availableBeds: availableBedsN,
    totalWards: parseInt(wards?.cnt || 0, 10),
    dischargedToday: parseInt(dischargedToday?.cnt || 0, 10),
    admittedToday: parseInt(admittedToday?.cnt || 0, 10),
    occupancyRatePercent: totalBedsN > 0 ? Math.round(((totalBedsN - availableBedsN) / totalBedsN) * 100) : null,
  };
}

// System login accounts (`users` — distinct from `employees`/HR records
// above), active only. Never selects password_hash/signature — this file
// only ever runs COUNT(*), nothing resembling users.js's own explicit
// safe-column list is even needed here.
async function getStaffAccountsCount(sequelize, { req, role }) {
  const replacements = {};
  const branchSQL = branchScope(req, replacements);
  const roleSQL = role ? ' AND role = :role' : '';
  if (role) replacements.role = role;
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM users WHERE is_active = true${roleSQL}${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10) };
}

// Facility configuration counts — branches (physical locations) and
// clinics (service catalog) are genuinely different concepts in this
// schema, reported separately rather than picking one. Mirrors clinics.js's
// own fallback (count dr_clinics; if empty, count clinic_names instead)
// since a real tenant might only have rows in the fallback table. Neither
// table is branch-scoped — branches/clinics are facility-wide config
// lists, same as facilities.js's own unscoped branch listing.
async function getFacilityCounts(sequelize) {
  const [[branchRow]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM branches WHERE is_active = true`);
  const [[drClinicsRow]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM dr_clinics WHERE is_active = true`);
  let clinicsCount = parseInt(drClinicsRow?.cnt || 0, 10);
  if (clinicsCount === 0) {
    try {
      const [[fallbackRow]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM clinic_names`);
      clinicsCount = parseInt(fallbackRow?.cnt || 0, 10);
    } catch {
      // clinic_names doesn't exist in every tenant's schema — dr_clinics
      // being genuinely empty (0) is a perfectly valid real answer too.
    }
  }
  return { branches: parseInt(branchRow?.cnt || 0, 10), clinics: clinicsCount };
}

// Appointments scheduled in a period, by status. Real status enum
// (appointments.js): 'scheduled' (default) -> 'queued' (converted into a
// visit) or 'cancelled' — confirmed from the route's own update validation
// (`status must be scheduled or cancelled`) plus the explicit 'queued'
// transition.
async function getAppointmentsByStatus(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements, 'a.branch_id');
  const [rows] = await sequelize.query(
    `SELECT a.status, COUNT(*) AS cnt
       FROM appointments a
      WHERE a.clinic_id = :clinicId AND a.scheduled_date >= :start AND a.scheduled_date < :end${branchSQL}
      GROUP BY a.status
      ORDER BY cnt DESC`,
    { replacements },
  );
  return rows.map((r) => ({ status: r.status, count: parseInt(r.cnt, 10) }));
}

// Inter-branch patient referrals in a period, by status. Real status enum
// (patientReferrals.js's own decide() helper): pending -> accepted/
// rejected, or cancelled by the requester.
async function getReferralsByStatus(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  // patient_referrals has both from_branch_id and to_branch_id — scope on
  // whichever branch this user belongs to being either side of the
  // referral, so a branch-scoped user sees referrals they sent OR received.
  let branchSQL = '';
  if (!(req.user?.role === 'admin' && !req.branchContext?.adminScoped)) {
    const branchId = req.branchContext?.branchId || req.user?.branchId;
    if (branchId) {
      replacements.branchId = branchId;
      branchSQL = ' AND (from_branch_id = :branchId OR to_branch_id = :branchId)';
    }
  }
  const [rows] = await sequelize.query(
    `SELECT status, COUNT(*) AS cnt
       FROM patient_referrals
      WHERE clinic_id = :clinicId AND created_at >= :start AND created_at < :end${branchSQL}
      GROUP BY status
      ORDER BY cnt DESC`,
    { replacements },
  );
  return rows.map((r) => ({ status: r.status, count: parseInt(r.cnt, 10) }));
}

// Unified stock-movement feed — inventory_transactions already logs every
// kind of movement (receipt, dispense, adjustment, transfer, waste, damage,
// return_to_supplier) as its own transaction_type row; mirrors the exact
// "recent history" query pharmacyModule.js's own /stock-movement endpoint
// already runs (pharmacyModule.js:2833-2842), just with a date range and a
// higher LIMIT instead of a fixed 15. inventory_transactions has no
// branch_id column (confirmed against the live schema) — clinic_id is the
// only scope available on this table, same as the route it mirrors.
async function getStockMovements(sequelize, { clinicId, start, end, limit = 50 }) {
  const [rows] = await sequelize.query(
    `SELECT t.transaction_number AS "reference", t.transaction_type AS "type",
            t.quantity_change AS "quantityChange", t.transaction_date AS "date",
            ii.item_name AS "itemName", ii.unit_of_measure AS "unit"
       FROM inventory_transactions t
       LEFT JOIN inventory_items ii ON ii.id = t.item_id
      WHERE t.clinic_id = :clinicId AND t.transaction_date >= :start AND t.transaction_date < :end
      ORDER BY t.created_at DESC
      LIMIT :limit`,
    { replacements: { clinicId, start, end, limit } },
  );
  const movements = rows.map((r) => ({
    reference: r.reference,
    type: r.type,
    quantityChange: parseInt(r.quantityChange, 10) || 0,
    itemName: r.itemName || 'Unknown item',
    unit: r.unit || '',
    date: r.date,
  }));
  return {
    count: movements.length,
    movements,
    table: {
      columns: ['Date', 'Item', 'Type', 'Qty change', 'Reference'],
      rows: movements.map((m) => [String(m.date), m.itemName, m.type, m.quantityChange, m.reference]),
    },
  };
}

// Currency configuration + most-recent rate per from/to pair — a snapshot,
// not period-scoped (same reasoning as getFacilityCounts: "what currency
// are we using" has no date range). CurrencyService.getCurrencies() already
// exists and is reused here rather than re-querying the same table.
async function getCurrencyInfo(sequelize, { clinicId }) {
  const CurrencyService = require('../CurrencyService');
  const currencies = await CurrencyService.getCurrencies();
  const [rates] = await sequelize.query(
    `SELECT DISTINCT ON (from_currency, to_currency) from_currency, to_currency, rate, effective_date
       FROM exchange_rates
      WHERE clinic_id = :clinicId AND is_active = true
      ORDER BY from_currency, to_currency, effective_date DESC`,
    { replacements: { clinicId } },
  );
  const currencyList = currencies.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, isBaseCurrency: !!c.is_base_currency }));
  const exchangeRates = rates.map((r) => ({ from: r.from_currency, to: r.to_currency, rate: parseFloat(r.rate), effectiveDate: r.effective_date }));
  return {
    currencies: currencyList,
    exchangeRates,
    table: {
      columns: ['Currency', 'Symbol', 'Base?'],
      rows: currencyList.map((c) => [c.code, c.symbol, c.isBaseCurrency ? 'Yes' : 'No']),
    },
  };
}

// A single patient's most recent visit — same join shape as the real
// GET /api/lis/visit-summaries (lisModule.js:1016), trimmed to what a chat
// answer needs: who, when, chief complaint, tests ordered, what was billed.
// patientQuery matches either an exact participant_number or a fuzzy name;
// more than one name match is returned as `candidates` for the caller to
// ask the user to pick one, rather than guessing which patient they meant.
async function getPatientVisitSummary(sequelize, { req, patientQuery, canSeeRevenue }) {
  const candReplacements = { q: patientQuery, qLike: `%${patientQuery}%` };
  const candBranchSQL = branchScope(req, candReplacements);
  const [candidates] = await sequelize.query(
    `SELECT id, participant_number, first_name, last_name
       FROM lis_participants
      WHERE (participant_number = :q OR (first_name || ' ' || last_name) ILIKE :qLike)${candBranchSQL}
      ORDER BY (participant_number = :q) DESC
      LIMIT 5`,
    { replacements: candReplacements },
  );
  if (candidates.length === 0) {
    return { error: 'patient_not_found', message: `No patient matching "${patientQuery}" was found.` };
  }
  const exact = candidates.find((c) => c.participant_number === patientQuery);
  if (!exact && candidates.length > 1) {
    return {
      error: 'ambiguous_patient',
      candidates: candidates.map((c) => ({ participantNumber: c.participant_number, name: `${c.first_name} ${c.last_name}` })),
      message: `More than one patient matches "${patientQuery}" — ask which one.`,
    };
  }
  const participant = exact || candidates[0];

  const orderReplacements = { participantId: participant.id };
  const orderBranchSQL = branchScope(req, orderReplacements, 'o.branch_id');
  const [[order]] = await sequelize.query(
    `SELECT o.id, o.status, o.vitals, o.created_at, COALESCE(u.display_name, 'Unassigned') AS doctor_name
       FROM lis_test_orders o
       LEFT JOIN users u ON u.id = o.doctor_id
      WHERE o.participant_id = :participantId${orderBranchSQL}
      ORDER BY o.created_at DESC LIMIT 1`,
    { replacements: orderReplacements },
  );
  const participantSummary = { participantNumber: participant.participant_number, name: `${participant.first_name} ${participant.last_name}` };
  if (!order) {
    return { participant: participantSummary, message: 'This patient has no recorded visit yet.' };
  }

  const [tests] = await sequelize.query(
    `SELECT test_name, status FROM lis_specimens WHERE order_id = :orderId`,
    { replacements: { orderId: order.id } },
  );

  let billedItems = [];
  let totalBilled = null;
  if (canSeeRevenue) {
    const [[bill]] = await sequelize.query(
      `SELECT services, total_amount FROM patient_bills WHERE visit_id = :orderId LIMIT 1`,
      { replacements: { orderId: order.id } },
    );
    if (bill) {
      totalBilled = parseFloat(bill.total_amount) || 0;
      try {
        const services = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services || [];
        billedItems = services.map((s) => ({
          name: s.name || s.serviceName || s.testName || 'Item',
          amount: parseFloat(s.totalPrice ?? s.price ?? 0) || 0,
        }));
      } catch { billedItems = []; }
    }
  }

  let chiefComplaints = [];
  try {
    const vitals = typeof order.vitals === 'string' ? JSON.parse(order.vitals) : order.vitals;
    chiefComplaints = vitals?.chief_complaints || [];
  } catch { chiefComplaints = []; }

  const tableRows = [
    ...tests.map((t) => [t.test_name, 'Test', t.status]),
    ...billedItems.map((b) => [b.name, 'Billed', b.amount.toFixed(2)]),
  ];

  return {
    participant: participantSummary,
    visitDate: order.created_at,
    doctorName: order.doctor_name,
    status: order.status,
    chiefComplaints,
    testsOrdered: tests.map((t) => ({ name: t.test_name, status: t.status })),
    totalBilled,
    note: canSeeRevenue ? undefined : 'Billed amounts require financial access.',
    table: tableRows.length > 0 ? { columns: ['Item', 'Kind', 'Status / amount'], rows: tableRows } : null,
  };
}

// Currently-admitted patients + their accumulated bill, plus how many were
// discharged in the given period. Distinct from getInpatientOccupancy above
// (a bed/ward snapshot) — this answers "who's admitted, what do they owe,
// how many discharged [this month]". A bill's visit_id IS the admission's
// own id while the admission is active (no separate bill_id column exists
// on inpatient_admissions — confirmed via billingResolver.js and
// patient_bills' own unique index on visit_id), so joining on that is the
// real, live mechanism. patient_id can resolve through EITHER `patients` or
// `lis_participants` depending on how the admission was created — mirrors
// inpatient.js's own COALESCE(p.col, lp.col) pattern (inpatient.js:518-530)
// exactly rather than picking one and silently dropping the other.
async function getInpatientReport(sequelize, { req, clinicId, start, end, canSeeRevenue }) {
  // inpatient_admissions.clinic_id is varchar (not integer, unlike almost
  // every other table in this file) and patients.id is a true uuid (while
  // inpatient_admissions.patient_id is varchar) — confirmed against the
  // live schema; both are reproducible Postgres type errors without an
  // explicit cast ("operator does not exist: character varying = integer" /
  // "... uuid = character varying"), so both are cast explicitly below
  // rather than copying the uncast literal comparisons used elsewhere.
  const admittedReplacements = { clinicId };
  const admittedBranchSQL = branchScope(req, admittedReplacements, 'a.branch_id');
  const [admitted] = await sequelize.query(
    `SELECT a.id, a.admission_date, w.name AS ward_name, pb.total_amount AS bill_total,
            COALESCE(p.first_name, lp.first_name, '') AS first_name,
            COALESCE(p.last_name, lp.last_name, '') AS last_name
       FROM inpatient_admissions a
       LEFT JOIN wards w ON w.id = a.ward_id
       LEFT JOIN patients p ON p.id::text = a.patient_id
       LEFT JOIN lis_participants lp ON lp.id = a.patient_id
       LEFT JOIN patient_bills pb ON pb.visit_id = a.id
      WHERE a.clinic_id = :clinicId::text AND a.status = 'active'${admittedBranchSQL}
      ORDER BY a.admission_date ASC LIMIT 50`,
    { replacements: admittedReplacements },
  );

  const dischargedReplacements = { clinicId, start, end };
  const dischargedBranchSQL = branchScope(req, dischargedReplacements, 'a.branch_id');
  const [[discharged]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt
       FROM inpatient_admissions a
      WHERE a.clinic_id = :clinicId::text AND a.status = 'discharged'
        AND a.discharge_date >= :start AND a.discharge_date < :end${dischargedBranchSQL}`,
    { replacements: dischargedReplacements },
  );

  const admittedPatients = admitted.map((r) => ({
    name: `${r.first_name} ${r.last_name}`.trim() || 'Unknown',
    wardName: r.ward_name || 'Unassigned',
    admissionDate: r.admission_date,
    accumulatedBill: canSeeRevenue ? (parseFloat(r.bill_total) || 0) : undefined,
  }));

  return {
    admittedCount: admittedPatients.length,
    admittedPatients,
    dischargedInPeriod: parseInt(discharged?.cnt || 0, 10),
    table: {
      columns: canSeeRevenue ? ['Patient', 'Ward', 'Admitted', 'Bill so far'] : ['Patient', 'Ward', 'Admitted'],
      rows: admittedPatients.map((p) => {
        const admDate = new Date(p.admissionDate).toISOString().split('T')[0];
        return canSeeRevenue ? [p.name, p.wardName, admDate, (p.accumulatedBill || 0).toFixed(2)] : [p.name, p.wardName, admDate];
      }),
    },
  };
}

// Procurement supplier catalog — a snapshot, no period. Real table is the
// plain `suppliers` (clinic_id only, no branch_id — confirmed against the
// live schema), not the separate `accounting_suppliers` Sequelize model
// used elsewhere in the Accounting module. There is no is_active column on
// this table (confirmed against the live schema) — "active" here means not
// on hold, the closest real equivalent.
async function getSuppliers(sequelize, { clinicId, activeOnly = true }) {
  const activeSQL = activeOnly ? ' AND on_hold IS NOT TRUE' : '';
  const [rows] = await sequelize.query(
    `SELECT name, supplier_code, contact_person, phone, is_preferred, on_hold, currency
       FROM suppliers
      WHERE clinic_id = :clinicId${activeSQL}
      ORDER BY name LIMIT 100`,
    { replacements: { clinicId } },
  );
  const suppliers = rows.map((r) => ({
    name: r.name,
    code: r.supplier_code,
    contactPerson: r.contact_person,
    phone: r.phone,
    isPreferred: r.is_preferred,
    onHold: r.on_hold,
    currency: r.currency,
  }));
  return {
    count: suppliers.length,
    suppliers,
    table: {
      columns: ['Supplier', 'Code', 'Contact', 'Phone', 'On hold'],
      rows: suppliers.map((s) => [s.name, s.code || '', s.contactPerson || '', s.phone || '', s.onHold ? 'Yes' : 'No']),
    },
  };
}

// Goods receipt notes in a period — the real, distinct GRN table (not a
// status flag on purchase_orders); a PO only reaches status='received' as a
// side effect of GRN acceptance (procurement.js's own status-transition
// endpoint deliberately excludes a manual 'receive' step — see its own
// comment), so GRNs are the real record of what's actually arrived.
async function getGrnSummary(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements, 'grn.branch_id');
  const [rows] = await sequelize.query(
    `SELECT grn.grn_number, grn.status, grn.receipt_date, grn.total_items_received,
            po.po_number, s.name AS supplier_name
       FROM goods_receipt_notes grn
       LEFT JOIN purchase_orders po ON po.id = grn.po_id
       LEFT JOIN suppliers s ON s.id = grn.supplier_id
      WHERE grn.clinic_id = :clinicId AND grn.receipt_date >= :start AND grn.receipt_date < :end${branchSQL}
      ORDER BY grn.receipt_date DESC LIMIT 50`,
    { replacements },
  );
  const grns = rows.map((r) => ({
    grnNumber: r.grn_number,
    poNumber: r.po_number,
    supplierName: r.supplier_name || 'Unknown supplier',
    status: r.status,
    receiptDate: r.receipt_date,
    itemsReceived: parseInt(r.total_items_received, 10) || 0,
  }));
  return {
    count: grns.length,
    grns,
    table: {
      columns: ['GRN #', 'PO #', 'Supplier', 'Status', 'Items', 'Date'],
      rows: grns.map((g) => [g.grnNumber, g.poNumber || '', g.supplierName, g.status, g.itemsReceived, new Date(g.receiptDate).toISOString().split('T')[0]]),
    },
  };
}

// Requisitions grouped by department in a period — purchase_requisitions is
// the live, actively-written table; `procurement_requisitions`, referenced
// only inside reports.js's own try/catch (silently no-ops if missing), is
// legacy/possibly-nonexistent and deliberately not used here. `department`
// is a plain free-text column, no FK to a departments table.
async function getRequisitionsByDepartment(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements);
  const [rows] = await sequelize.query(
    `SELECT COALESCE(department, 'Unspecified') AS department, COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total
       FROM purchase_requisitions
      WHERE clinic_id = :clinicId AND requisition_date >= :start AND requisition_date < :end${branchSQL}
      GROUP BY department
      ORDER BY cnt DESC`,
    { replacements },
  );
  const byDepartment = rows.map((r) => ({ department: r.department, count: parseInt(r.cnt, 10), total: parseFloat(r.total) || 0 }));
  return {
    byDepartment,
    table: {
      columns: ['Department', 'Requisitions', 'Total value'],
      rows: byDepartment.map((d) => [d.department, d.count, d.total.toFixed(2)]),
    },
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
  getBillsByStatus,
  getOutstandingBalance,
  getActiveStaffCount,
  getRadiologyOverview,
  getTheatreOverview,
  getInpatientOccupancy,
  getStaffAccountsCount,
  getFacilityCounts,
  getAppointmentsByStatus,
  getReferralsByStatus,
  getDoctorActivity,
  getDepartmentBreakdown,
  listDoctors,
  getStockMovements,
  getCurrencyInfo,
  getPatientVisitSummary,
  getInpatientReport,
  getSuppliers,
  getGrnSummary,
  getRequisitionsByDepartment,
};
