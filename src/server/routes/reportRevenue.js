// ══════════════════════════════════════════════════════════════════════════
// Revenue Report — one engine behind the Revenue Report page's report-type
// dropdown, covering every variant requested (by user/department/scheme/
// branch/payment-mode/doctor/item, patient-bill breakdowns by branch/scheme/
// status with an outpatient/inpatient/discharged filter, a chronological
// revenue journal, weekly/monthly trends, service cost analysis, and a
// patient register by scheme).
//
// Two underlying metrics, never mixed in one query:
//   - "receipts"  — CASH COLLECTED (receipts.payment_amount, status='active')
//   - "invoices"  — BILLED AMOUNTS (patient_bills.total_amount/paid_amount/
//                   balance_amount) — what the "Patient Bills" family reports
//
// By-user (cashier), by-department/category, and by-doctor are intentionally
// NOT reimplemented here — they already exist and work
// (reportBillingByUser.js, reportClinicPerformance.js,
// reportDoctorPerformance.js); the frontend calls those directly. Likewise
// "Cancelled Receipts"/"Cancelled Invoices" reuse reportCancelledTransactions.js
// unchanged. This file only adds what didn't already exist: payment-mode and
// item-level revenue breakdowns, the patient-bills family, a generic
// transaction-level "Detail" view (one dataset, works for every "by X"
// summary above it — it's the single source for the dropdown's Detail mode
// AND for "Revenue Journal"/"Total Invoices Breakdown (All Branches)"),
// weekly/monthly trends, service cost analysis, and patient register.
//
// ── Outpatient / Inpatient / Discharged — a disclosed heuristic ─────────
// patient_bills has no visit-type column (confirmed: no is_outpatient /
// visit_type / admission_id). The only real signal is `inpatient_admissions`
// (patient_id, admission_date, discharge_date) with NO FK from patient_bills.
// We classify a bill by whether an admission for the same patient overlaps
// the bill's date:
//   Inpatient   — admission_date <= bill_date AND (discharge_date IS NULL
//                 OR discharge_date >= bill_date)
//   Discharged  — an admission whose discharge_date < bill_date (the bill
//                 was raised after that stay ended, e.g. a final settlement)
//   Outpatient  — neither of the above
// This is the same same-period/EXISTS-join honesty pattern already used for
// doctor attribution in reportDoctorPerformance.js — not a stored field, a
// best-effort classification, disclosed via a `note` in the response.
//
// Mount as:
//   app.use('/api/reports-v2/revenue', require('./routes/reportRevenue'));
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
// Every reports-v2 route carries financial/clinical data and was previously
// gated only on the frontend's requiredPrivilege="pages.reports.view" check
// (src/App.tsx) -- any authenticated user of any role could call these
// endpoints directly (devtools/Postman/a future UI surface) and get the
// data with no server-side check at all. Mirrors reportDhis2.js, the one
// report file that already did this correctly.
router.use(authorize('pages.reports.view'));

const { sequelize } = require('../models');
const { getBaseCurrencyCode } = require('../utils/baseCurrency');
const { QueryTypes } = require('sequelize');
const { getBranchConditionSQL } = require('../middleware/branchFilter');

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** lowercase, strip "(...)" suffixes, strip punctuation, collapse whitespace — same normalization reportClinicPerformance.js/reportDoctorPerformance.js use. */
function normalizeName(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Same insurance/scheme-currency resolution as reportClinicPerformance.js /
// reportDoctorPerformance.js — duplicated rather than shared, matching this
// codebase's existing convention of each reports-v2 file being self-contained.
async function resolveItemAmount(item, bill, rateCache, clinicId) {
  const AccountingService = require('../services/AccountingService');
  const qty = num(item.quantity) || 1;
  const cashAmount = item.totalPrice != null ? num(item.totalPrice)
    : item.total_price != null ? num(item.total_price)
    : num(item.unitPrice ?? item.unit_price ?? item.price) * qty;
  const isSchemeBill = !!bill.schemeId;
  const isIndividuallyInsured = item.schemePrice != null && cashAmount === 0;
  if (!isSchemeBill && !isIndividuallyInsured) return { amount: cashAmount, isInsurance: false };
  // Converted into the tenant's base currency (USD for some tenants), never assumed SSP.
  if (!rateCache.has('__base')) rateCache.set('__base', await getBaseCurrencyCode());
  const base = rateCache.get('__base');
  const rawAmount = isSchemeBill ? cashAmount : num(item.schemePrice);
  const currency = (isSchemeBill ? bill.billCurrency : item.schemeCurrency) || base;
  if (currency === base || rawAmount === 0) return { amount: rawAmount, isInsurance: true };
  const asOfDate = bill.billDay || new Date();
  const cacheKey = `${currency}|${asOfDate}`;
  let rate = rateCache.get(cacheKey);
  if (rate === undefined) {
    try { rate = await AccountingService.getExchangeRate(clinicId, currency, base, asOfDate); } catch { rate = null; }
    rateCache.set(cacheKey, rate);
  }
  const amount = rate != null ? AccountingService.convertAmount(rawAmount, rate) : rawAmount;
  return { amount, isInsurance: true, unconverted: rate == null };
}

function collectedForItem(item, bill, itemTotal, billPaidRatio) {
  // A voided line never counts as collected, regardless of a stale `paid`
  // flag left over from before it was voided (void-item intentionally keeps
  // paid:true on a voided line as a historical marker — see patientBills.js's
  // /void-item route) or from a receipt reversal that predates R1's fix.
  if (item.isVoided) return 0;
  if (typeof item.paid === 'boolean') return item.paid ? itemTotal : 0;
  if (item.status === 'paid') return itemTotal;
  if (bill.status === 'paid') return itemTotal;
  if (bill.status === 'pending') return 0;
  return itemTotal * billPaidRatio;
}

/**
 * EXISTS/NOT EXISTS fragment classifying `pb` (alias for patient_bills) by
 * patient type. Returns '' for 'all'. Every comparison is by CALENDAR DAY
 * (DATE(...)), not exact timestamp — admission_date carries a real
 * time-of-day (e.g. admitted at 08:00) while bill_date is typically stored
 * at midnight, so a same-day bill would otherwise compare as "before" the
 * admission and be misclassified as Outpatient.
 */
function patientTypeConditionSQL(patientType) {
  if (patientType === 'outpatient') {
    return ` AND NOT EXISTS (
      SELECT 1 FROM inpatient_admissions ia
      WHERE ia.patient_id = pb.patient_id AND DATE(ia.admission_date) <= DATE(pb.bill_date)
    )`;
  }
  if (patientType === 'inpatient') {
    return ` AND EXISTS (
      SELECT 1 FROM inpatient_admissions ia
      WHERE ia.patient_id = pb.patient_id AND DATE(ia.admission_date) <= DATE(pb.bill_date)
        AND (ia.discharge_date IS NULL OR DATE(ia.discharge_date) >= DATE(pb.bill_date))
    )`;
  }
  if (patientType === 'discharged') {
    return ` AND EXISTS (
      SELECT 1 FROM inpatient_admissions ia
      WHERE ia.patient_id = pb.patient_id AND ia.discharge_date IS NOT NULL AND DATE(ia.discharge_date) < DATE(pb.bill_date)
    )`;
  }
  return '';
}

const PATIENT_TYPE_NOTE = 'Outpatient / Inpatient / Discharged is inferred from whether an inpatient_admissions record for the same patient overlaps the bill date — patient_bills has no stored visit-type column, so this is a best-effort classification rather than a verified field.';

// ── GET /  — groupBy=scheme|branch|payment_mode|item (receipts-based "Revenue by ...") ──
router.get('/', async (req, res) => {
  try {
    const groupBy = ['scheme', 'branch', 'payment_mode', 'item'].includes(req.query.groupBy) ? req.query.groupBy : 'scheme';
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null;
    const clinicSQL = clinicId ? ' AND r.clinic_id = ?' : '';
    const clinicParams = clinicId ? [clinicId] : [];
    const branch = getBranchConditionSQL(req, 'r');

    let rows;
    if (groupBy === 'branch') {
      [rows] = await sequelize.query(
        `SELECT COALESCE(r.branch_id::text, 'none') AS group_key, r.branch_id,
                COALESCE(b.name, CASE WHEN r.branch_id IS NULL THEN 'No Branch Assigned' ELSE 'Branch ' || r.branch_id END) AS group_label,
                COUNT(*) AS transaction_count, COALESCE(SUM(r.payment_amount), 0) AS total_collected
         FROM receipts r LEFT JOIN branches b ON b.id = r.branch_id
         WHERE r.status = 'active' AND DATE(r.payment_date) BETWEEN ? AND ? ${clinicSQL} ${branch.sql}
         GROUP BY r.branch_id, b.name ORDER BY total_collected DESC`,
        { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params] }
      );
    } else if (groupBy === 'payment_mode') {
      [rows] = await sequelize.query(
        `SELECT COALESCE(r.payment_method, 'unknown') AS group_key, COALESCE(INITCAP(r.payment_method), 'Unknown') AS group_label,
                COUNT(*) AS transaction_count, COALESCE(SUM(r.payment_amount), 0) AS total_collected
         FROM receipts r
         WHERE r.status = 'active' AND DATE(r.payment_date) BETWEEN ? AND ? ${clinicSQL} ${branch.sql}
         GROUP BY r.payment_method ORDER BY total_collected DESC`,
        { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params] }
      );
    } else if (groupBy === 'item') {
      // No per-item FK to a catalog here (unlike reportClinicPerformance.js's
      // category rollup) — grouped directly on the billed item's own name, so
      // every line item counts, catalog match or not.
      const branchBills = getBranchConditionSQL(req);
      const clinicBillSQL = clinicId ? ' AND clinic_id = ?' : '';
      const [bills] = await sequelize.query(
        `SELECT id, total_amount, paid_amount, status, bill_date, services, scheme_id, bill_currency
         FROM patient_bills
         WHERE DATE(bill_date) BETWEEN ? AND ? ${clinicBillSQL} ${branchBills.sql}`,
        { replacements: [dateFrom, dateTo, ...clinicParams, ...branchBills.params] }
      );
      const byItem = new Map();
      const rateCache = new Map();
      for (const bill of bills) {
        let items = [];
        try {
          const parsed = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
          if (Array.isArray(parsed)) items = parsed;
        } catch { continue; }
        const billTotal = num(bill.total_amount);
        const billPaid = num(bill.paid_amount);
        const billPaidRatio = billTotal > 0 ? Math.min(billPaid / billTotal, 1) : 0;
        const billForResolve = { schemeId: bill.scheme_id, billCurrency: bill.bill_currency, billDay: bill.bill_date, status: bill.status };
        for (const item of items) {
          const rawName = (item?.serviceName || item?.name || item?.service_name || '').trim();
          if (!rawName) continue;
          const { amount: itemTotal } = await resolveItemAmount(item, billForResolve, rateCache, clinicId || 1);
          const collected = collectedForItem(item, billForResolve, itemTotal, billPaidRatio);
          const row = byItem.get(rawName) || { label: rawName, transactionCount: 0, totalCollected: 0, totalBilled: 0 };
          row.transactionCount += 1;
          row.totalBilled += itemTotal;
          row.totalCollected += collected;
          byItem.set(rawName, row);
        }
      }
      rows = Array.from(byItem.values())
        .sort((a, b) => b.totalCollected - a.totalCollected)
        .map(r => ({ group_key: r.label, group_label: r.label, transaction_count: r.transactionCount, total_collected: r.totalCollected }));
    } else {
      [rows] = await sequelize.query(
        `SELECT COALESCE(pb.scheme_id, 'none') AS group_key, pb.scheme_id,
                COALESCE(ps.scheme_name, 'Cash / No Scheme') AS group_label,
                COUNT(*) AS transaction_count, COALESCE(SUM(r.payment_amount), 0) AS total_collected
         FROM receipts r
         LEFT JOIN patient_bills pb ON pb.id = r.bill_id
         LEFT JOIN patient_schemes ps ON ps.id = pb.scheme_id
         WHERE r.status = 'active' AND DATE(r.payment_date) BETWEEN ? AND ? ${clinicSQL} ${branch.sql}
         GROUP BY pb.scheme_id, ps.scheme_name ORDER BY total_collected DESC`,
        { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params] }
      );
    }

    const totalCollected = rows.reduce((sum, r) => sum + (parseFloat(r.total_collected) || 0), 0);
    res.json({
      groupBy, period: { dateFrom, dateTo },
      rows: rows.map((r) => ({
        key: r.group_key, id: r.branch_id ?? r.scheme_id ?? r.group_key, label: r.group_label,
        transactionCount: parseInt(r.transaction_count, 10) || 0, totalCollected: parseFloat(r.total_collected) || 0,
      })),
      totals: { totalCollected },
    });
  } catch (err) {
    console.error('Revenue report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /bills  — patient-bills family: groupBy=branch|scheme|status, patientType=all|outpatient|inpatient|discharged ──
router.get('/bills', async (req, res) => {
  try {
    const groupBy = ['branch', 'scheme', 'status'].includes(req.query.groupBy) ? req.query.groupBy : 'branch';
    const patientType = ['outpatient', 'inpatient', 'discharged'].includes(req.query.patientType) ? req.query.patientType : 'all';
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null;
    const clinicSQL = clinicId ? ' AND pb.clinic_id = ?' : '';
    const clinicParams = clinicId ? [clinicId] : [];
    const branch = getBranchConditionSQL(req, 'pb');
    const typeSQL = patientTypeConditionSQL(patientType);

    let selectDim, joinDim, groupDim, orderBy = 'total_billed DESC';
    if (groupBy === 'branch') {
      selectDim = `COALESCE(pb.branch_id::text, 'none') AS group_key, COALESCE(b.name, CASE WHEN pb.branch_id IS NULL THEN 'No Branch Assigned' ELSE 'Branch ' || pb.branch_id END) AS group_label`;
      joinDim = 'LEFT JOIN branches b ON b.id = pb.branch_id';
      groupDim = 'pb.branch_id, b.name';
    } else if (groupBy === 'scheme') {
      selectDim = `COALESCE(pb.scheme_id, 'none') AS group_key, COALESCE(ps.scheme_name, 'Cash / No Scheme') AS group_label`;
      joinDim = 'LEFT JOIN patient_schemes ps ON ps.id = pb.scheme_id';
      groupDim = 'pb.scheme_id, ps.scheme_name';
    } else {
      selectDim = `pb.status AS group_key, INITCAP(pb.status) AS group_label`;
      joinDim = '';
      groupDim = 'pb.status';
    }

    const [rows] = await sequelize.query(
      `SELECT ${selectDim}, COUNT(*) AS bill_count,
              COALESCE(SUM(pb.total_amount), 0) AS total_billed,
              COALESCE(SUM(pb.paid_amount), 0) AS total_paid,
              COALESCE(SUM(pb.balance_amount), 0) AS total_balance
       FROM patient_bills pb ${joinDim}
       WHERE DATE(pb.bill_date) BETWEEN ? AND ? ${clinicSQL} ${branch.sql} ${typeSQL}
       GROUP BY ${groupDim} ORDER BY ${orderBy}`,
      { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params] }
    );

    const totals = rows.reduce((acc, r) => ({
      billCount: acc.billCount + (parseInt(r.bill_count, 10) || 0),
      totalBilled: acc.totalBilled + (parseFloat(r.total_billed) || 0),
      totalPaid: acc.totalPaid + (parseFloat(r.total_paid) || 0),
      totalBalance: acc.totalBalance + (parseFloat(r.total_balance) || 0),
    }), { billCount: 0, totalBilled: 0, totalPaid: 0, totalBalance: 0 });

    res.json({
      groupBy, patientType, period: { dateFrom, dateTo },
      rows: rows.map(r => ({
        key: r.group_key, label: r.group_label, billCount: parseInt(r.bill_count, 10) || 0,
        totalBilled: parseFloat(r.total_billed) || 0, totalPaid: parseFloat(r.total_paid) || 0, totalBalance: parseFloat(r.total_balance) || 0,
      })),
      totals,
      note: patientType !== 'all' ? PATIENT_TYPE_NOTE : null,
    });
  } catch (err) {
    console.error('Patient bills report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /detail  — flat transaction-level rows (source=receipts|bills). Powers both the "Detail" view of every summary above, and Revenue Journal / Total Invoices Breakdown. ──
router.get('/detail', async (req, res) => {
  try {
    const source = req.query.source === 'bills' ? 'bills' : 'receipts';
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 2000, 5000);

    if (source === 'bills') {
      const clinicSQL = clinicId ? ' AND pb.clinic_id = ?' : '';
      const clinicParams = clinicId ? [clinicId] : [];
      const branch = getBranchConditionSQL(req, 'pb');
      const patientType = ['outpatient', 'inpatient', 'discharged'].includes(req.query.patientType) ? req.query.patientType : 'all';
      const typeSQL = patientTypeConditionSQL(patientType);
      const [rows] = await sequelize.query(
        `SELECT pb.id, pb.bill_number, pb.bill_date, pb.patient_name, pb.status,
                pb.total_amount, pb.paid_amount, pb.balance_amount,
                COALESCE(b.name, 'No Branch') AS branch_name,
                COALESCE(ps.scheme_name, 'Cash / No Scheme') AS scheme_name,
                CASE
                  WHEN EXISTS (SELECT 1 FROM inpatient_admissions ia WHERE ia.patient_id = pb.patient_id AND ia.discharge_date IS NOT NULL AND DATE(ia.discharge_date) < DATE(pb.bill_date)) THEN 'Discharged'
                  WHEN EXISTS (SELECT 1 FROM inpatient_admissions ia WHERE ia.patient_id = pb.patient_id AND DATE(ia.admission_date) <= DATE(pb.bill_date) AND (ia.discharge_date IS NULL OR DATE(ia.discharge_date) >= DATE(pb.bill_date))) THEN 'Inpatient'
                  ELSE 'Outpatient'
                END AS patient_type
         FROM patient_bills pb
         LEFT JOIN branches b ON b.id = pb.branch_id
         LEFT JOIN patient_schemes ps ON ps.id = pb.scheme_id
         WHERE DATE(pb.bill_date) BETWEEN ? AND ? ${clinicSQL} ${branch.sql} ${typeSQL}
         ORDER BY pb.bill_date DESC LIMIT ?`,
        { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params, limit] }
      );
      return res.json({
        source, period: { dateFrom, dateTo }, note: PATIENT_TYPE_NOTE,
        rows: rows.map(r => ({
          id: r.id, billNumber: r.bill_number, date: r.bill_date, patientName: r.patient_name, status: r.status,
          branch: r.branch_name, scheme: r.scheme_name, patientType: r.patient_type,
          totalAmount: parseFloat(r.total_amount) || 0, paidAmount: parseFloat(r.paid_amount) || 0, balanceAmount: parseFloat(r.balance_amount) || 0,
        })),
      });
    }

    const clinicSQL = clinicId ? ' AND r.clinic_id = ?' : '';
    const clinicParams = clinicId ? [clinicId] : [];
    const branch = getBranchConditionSQL(req, 'r');
    const [rows] = await sequelize.query(
      `SELECT r.id, r.receipt_number, r.payment_date, r.patient_name, r.payment_amount, r.payment_method,
              COALESCE(u.display_name, r.cashier_name, 'Unknown') AS cashier_name,
              COALESCE(b.name, 'No Branch') AS branch_name,
              COALESCE(ps.scheme_name, 'Cash / No Scheme') AS scheme_name
       FROM receipts r
       LEFT JOIN users u ON u.id = r.cashier_id
       LEFT JOIN branches b ON b.id = r.branch_id
       LEFT JOIN patient_bills pb ON pb.id = r.bill_id
       LEFT JOIN patient_schemes ps ON ps.id = pb.scheme_id
       WHERE r.status = 'active' AND DATE(r.payment_date) BETWEEN ? AND ? ${clinicSQL} ${branch.sql}
       ORDER BY r.payment_date DESC LIMIT ?`,
      { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params, limit] }
    );
    res.json({
      source, period: { dateFrom, dateTo },
      rows: rows.map(r => ({
        id: r.id, receiptNumber: r.receipt_number, date: r.payment_date, patientName: r.patient_name,
        amount: parseFloat(r.payment_amount) || 0, paymentMethod: r.payment_method, cashierName: r.cashier_name,
        branch: r.branch_name, scheme: r.scheme_name,
      })),
    });
  } catch (err) {
    console.error('Revenue detail report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /trend  — interval=week|month, receipts collected per bucket ──
router.get('/trend', async (req, res) => {
  try {
    const interval = req.query.interval === 'month' ? 'month' : 'week';
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null;
    const repl = { dateFrom, dateTo, interval };
    let clinicSQL = '';
    if (clinicId) { repl.clinicId = clinicId; clinicSQL = ' AND r.clinic_id = :clinicId'; }
    // date_trunc's first arg needs a named :param, which getBranchConditionSQL's
    // positional `?` style can't mix into the same query — same branchScope()
    // pattern reportClinicPerformance.js/reportDoctorPerformance.js use instead.
    let branchSQL = '';
    if (req.user && !(req.user.role === 'admin' && !req.branchContext?.adminScoped)) {
      const branchId = req.branchContext?.branchId || req.user.branchId || null;
      if (branchId) { repl.branchId = branchId; branchSQL = ' AND r.branch_id = :branchId'; }
    }

    const [rows] = await sequelize.query(
      `SELECT date_trunc(:interval, r.payment_date) AS bucket, COUNT(*) AS transaction_count, COALESCE(SUM(r.payment_amount), 0) AS total_collected
       FROM receipts r
       WHERE r.status = 'active' AND DATE(r.payment_date) BETWEEN :dateFrom AND :dateTo ${clinicSQL} ${branchSQL}
       GROUP BY bucket ORDER BY bucket ASC`,
      { replacements: repl }
    );

    const maxCollected = rows.reduce((m, r) => Math.max(m, parseFloat(r.total_collected) || 0), 0);
    res.json({
      interval, period: { dateFrom, dateTo },
      rows: rows.map(r => ({
        bucket: r.bucket, transactionCount: parseInt(r.transaction_count, 10) || 0,
        totalCollected: parseFloat(r.total_collected) || 0,
        share: maxCollected > 0 ? (parseFloat(r.total_collected) || 0) / maxCollected : 0,
      })),
    });
  } catch (err) {
    console.error('Revenue trend report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /service-cost-analysis  — revenue by category vs. tracked Cost of Goods Sold ──
router.get('/service-cost-analysis', async (req, res) => {
  try {
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = parseInt(req.query.clinic_id, 10) || req.user?.clinicId || 1;
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;

    // Revenue by category — identical fuzzy-match-against-catalog approach as
    // reportClinicPerformance.js's byCategory (see that file's header for why
    // this is the honest option). A second pass against the active inventory
    // catalog recovers pharmacy/drug lines specifically (labeled "Pharmacy /
    // Inventory") since they were never in the `services` catalog to begin
    // with — anything matching neither catalog still falls to "Uncategorized".
    const services = await sequelize.query(`SELECT service_name AS "serviceName", category FROM services`, { type: QueryTypes.SELECT });
    const nameToCategory = new Map();
    for (const s of services) { const n = normalizeName(s.serviceName); if (n) nameToCategory.set(n, s.category || 'Uncategorized'); }
    const PHARMACY_LABEL = 'Pharmacy / Inventory';
    const inventoryItems = await sequelize.query(`SELECT item_name AS "itemName" FROM inventory_items WHERE is_active = true`, { type: QueryTypes.SELECT });
    const pharmacyNames = new Set();
    for (const it of inventoryItems) { const n = normalizeName(it.itemName); if (n) pharmacyNames.add(n); }

    const bills = await sequelize.query(
      `SELECT total_amount AS "totalAmount", paid_amount AS "paidAmount", status, bill_date AS "billDay", services, scheme_id AS "schemeId", bill_currency AS "billCurrency"
       FROM patient_bills WHERE clinic_id = :clinicId AND bill_date BETWEEN :fromTs AND :toTs`,
      { replacements: { clinicId, fromTs, toTs }, type: QueryTypes.SELECT }
    );
    const byCategory = new Map();
    const rateCache = new Map();
    for (const bill of bills) {
      let items = [];
      try { const parsed = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services; if (Array.isArray(parsed)) items = parsed; } catch { continue; }
      const billTotal = num(bill.totalAmount), billPaid = num(bill.paidAmount);
      const billPaidRatio = billTotal > 0 ? Math.min(billPaid / billTotal, 1) : 0;
      for (const item of items) {
        const n = normalizeName(item?.serviceName || item?.name || item?.service_name);
        if (!n) continue;
        const category = nameToCategory.get(n) || (pharmacyNames.has(n) ? PHARMACY_LABEL : 'Uncategorized');
        const { amount: itemTotal } = await resolveItemAmount(item, bill, rateCache, clinicId);
        const collected = collectedForItem(item, bill, itemTotal, billPaidRatio);
        const row = byCategory.get(category) || { category, totalBilled: 0, totalCollected: 0 };
        row.totalBilled += itemTotal; row.totalCollected += collected;
        byCategory.set(category, row);
      }
    }
    const categoryRows = Array.from(byCategory.values()).sort((a, b) => b.totalCollected - a.totalCollected);
    const totalRevenue = categoryRows.reduce((s, c) => s + c.totalCollected, 0);

    // Tracked Cost of Goods Sold — every chart_of_accounts row flagged
    // sub_account_type = 'cost_of_sales' (same column the Income Statement's
    // COGS section already groups on), summed in aggregate for the period.
    // Not broken out per service category: as of this build only
    // Pharmaceutical Cost of Sales (5210) exists in the chart of accounts —
    // there is no "Services/Lab/Clinical Cost of Sales" account yet, so a
    // per-category cost figure would be fabricated. Disclosed via `note`
    // rather than invented.
    const [cogsRows] = await sequelize.query(
      `SELECT coa.account_name, COALESCE(SUM(al.debit_amount - al.credit_amount), 0) AS amount
       FROM account_ledger al
       JOIN chart_of_accounts coa ON coa.id = al.account_id
       WHERE al.clinic_id = ? AND coa.sub_account_type = 'cost_of_sales' AND al.transaction_date BETWEEN ? AND ?
       GROUP BY coa.account_name ORDER BY amount DESC`,
      { replacements: [clinicId, dateFrom, dateTo] }
    );
    const totalCOGS = cogsRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const grossMargin = totalRevenue - totalCOGS;

    res.json({
      period: { dateFrom, dateTo }, clinicId,
      byCategory: categoryRows,
      cogsByAccount: cogsRows.map(r => ({ accountName: r.account_name, amount: parseFloat(r.amount) || 0 })),
      summary: { totalRevenue, totalCOGS, grossMargin, grossMarginPct: totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : 0 },
      note: 'Cost of Goods Sold is tracked in aggregate from the chart of accounts (currently just Pharmaceutical Cost of Sales) — not yet broken out per service category above, since no per-category COGS account exists yet. Revenue-by-category uses the same two-catalog match as the Revenue by Department report (services catalog, then the inventory catalog for "Pharmacy / Inventory"); anything matching neither still falls under "Uncategorized".',
    });
  } catch (err) {
    console.error('Service cost analysis report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /patient-register  — per-patient totals, grouped (sortable) by scheme ──
router.get('/patient-register', async (req, res) => {
  try {
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null;
    const clinicSQL = clinicId ? ' AND pb.clinic_id = ?' : '';
    const clinicParams = clinicId ? [clinicId] : [];
    const branch = getBranchConditionSQL(req, 'pb');
    // schemeId='cash' is the explicit "Cash / No Scheme" bucket (pb.scheme_id
    // IS NULL) — a real scheme's id filters to bills raised under that scheme.
    const schemeId = req.query.schemeId || null;
    let schemeSQL = '';
    const schemeParams = [];
    if (schemeId === 'cash') {
      schemeSQL = ' AND pb.scheme_id IS NULL';
    } else if (schemeId) {
      schemeSQL = ' AND pb.scheme_id = ?';
      schemeParams.push(schemeId);
    }

    const [rows] = await sequelize.query(
      `SELECT pb.patient_id, pb.patient_name, COALESCE(ps.scheme_name, 'Cash / No Scheme') AS scheme_name,
              COUNT(*) AS bill_count, COALESCE(SUM(pb.total_amount), 0) AS total_billed,
              COALESCE(SUM(pb.paid_amount), 0) AS total_paid, COALESCE(SUM(pb.balance_amount), 0) AS total_balance
       FROM patient_bills pb
       LEFT JOIN patient_schemes ps ON ps.id = pb.scheme_id
       WHERE DATE(pb.bill_date) BETWEEN ? AND ? ${clinicSQL} ${branch.sql} ${schemeSQL}
       GROUP BY pb.patient_id, pb.patient_name, ps.scheme_name
       ORDER BY scheme_name, pb.patient_name`,
      { replacements: [dateFrom, dateTo, ...clinicParams, ...branch.params, ...schemeParams] }
    );

    res.json({
      period: { dateFrom, dateTo },
      rows: rows.map(r => ({
        patientId: r.patient_id, patientName: r.patient_name, schemeName: r.scheme_name,
        billCount: parseInt(r.bill_count, 10) || 0, totalBilled: parseFloat(r.total_billed) || 0,
        totalPaid: parseFloat(r.total_paid) || 0, totalBalance: parseFloat(r.total_balance) || 0,
      })),
    });
  } catch (err) {
    console.error('Patient register report error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
