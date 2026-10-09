// ─── Procurement / Accounts Payable Reports (v2) ──────────────────────────
//
// Self-contained router, matching the convention established this session
// by reportPatients.js / reportInventory.js / reportClinical.js / reportARAging.js.
//
// Mount e.g.: app.use('/api/reports-v2/procurement', require('./routes/reportProcurement'));
//
// Auth: relies on the global authenticateToken + branchAccessControl
// middleware already applied ahead of route mounting in index.js.
//
// IMPORTANT — there is no separate `supplier_bills` table. A "supplier
// bill" is a `purchase_orders` row that has progressed past draft
// (status IN 'received'/'approved'/'authorized') — `payment_status`
// ('unpaid'/'partial'/'paid', set by the actual payment-recording route in
// daily-expenses.js) tracks how much of it has been paid, independent of
// the PO workflow `status`. "Payment Voucher" is not a separate document
// either — it's the same `supplier_bill_payments` row (voucher_number is
// just a text column on it).
//
// purchase_orders has no real `due_date` column — payment_terms is free
// text like "Net30". computeDueDate() below parses the number of days out
// of it (defaulting to 30 when unparseable) — this is a best-effort
// estimate, not an authoritative due date, since none is actually recorded.

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

function isoDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}
function asDateStr(v) {
  if (!v || typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function boolParam(v) { return v === 'true' || v === '1' || v === true; }

// Same convention as reportARAging.js/reportClinical.js's branchScope.
function branchScope(req, replacements, alias = '', skip = false) {
  if (skip) return '';
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}
function clinicIdFor(req) {
  return parseInt(req.query.clinic_id, 10) || req.user?.clinicId || 1;
}

// Purchase orders aren't all in one currency (po.po_currency/po.exchange_rate
// vary per PO), so any report that sums across multiple POs — "Purchases By
// X", "A/P Aging Summary" — would otherwise add e.g. a USD total straight
// onto an SSP total and present the result as one meaningful number. Every
// such query below multiplies by po.exchange_rate to convert into this
// deployment's single base currency before summing (same convention
// procurement.js already uses when computing purchase_orders.base_currency_total).
let _baseCurrencyCache = null;
async function getBaseCurrency() {
  if (_baseCurrencyCache) return _baseCurrencyCache;
  try {
    const [row] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = TRUE LIMIT 1`, { type: QueryTypes.SELECT });
    _baseCurrencyCache = row?.code || 'USD';
  } catch {
    _baseCurrencyCache = 'USD';
  }
  return _baseCurrencyCache;
}

// Same bucket boundaries/labels as reportARAging.js, for consistency across
// the app's two aging reports (AR for patients, AP for suppliers).
const BUCKETS = ['current', 'd31_60', 'd61_90', 'd90_plus'];
const BUCKET_META = {
  current: { label: 'Current (0-30 days)' },
  d31_60: { label: '31-60 Days' },
  d61_90: { label: '61-90 Days' },
  d90_plus: { label: '90+ Days' },
};
function bucketFor(daysOverdue) {
  const d = Number(daysOverdue) || 0;
  if (d <= 30) return 'current';
  if (d <= 60) return 'd31_60';
  if (d <= 90) return 'd61_90';
  return 'd90_plus';
}

function computeDueDate(orderDate, paymentTerms) {
  const terms = String(paymentTerms || '');
  // "Net30" alone matches /(\d+)/ fine, but compound terms like "2/10 Net 30"
  // (2% discount if paid within 10 days, otherwise net 30) have an earlier,
  // smaller number that isn't the due date — a plain first-number match took
  // "2" as the due-in-days instead of "30". Prefer the number after "Net".
  const netMatch = terms.match(/net\s*(\d+)/i);
  const anyMatch = terms.match(/(\d+)/);
  const days = netMatch ? parseInt(netMatch[1], 10) : anyMatch ? parseInt(anyMatch[1], 10) : 30;
  const d = new Date(orderDate);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const PENDING_BILL_SQL = `
  po.id, po.po_number AS "poNumber", po.order_date AS "orderDate", po.payment_terms AS "paymentTerms",
  po.total_amount AS "totalAmount", po.paid_amount AS "paidAmount",
  (po.total_amount - COALESCE(po.paid_amount, 0)) AS "balanceAmount",
  po.payment_status AS "paymentStatus", po.po_currency AS "currency",
  s.name AS "supplierName", s.id AS "supplierId", b.name AS "branchName"
`;

// ── GET /pending-bills ───────────────────────────────────────────────────
// sortBy=date|supplier — "(By Supplier)" is the same listing, sorted/
// grouped by supplier name instead of date, matching how Patient Register's
// own dropdown variants only change sort/scope, not the underlying data.
router.get('/pending-bills', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const sortBy = req.query.sortBy === 'supplier' ? 'supplier' : 'date';
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'po', allBranches);

    const rows = await sequelize.query(
      `SELECT ${PENDING_BILL_SQL}
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN branches b ON b.id = po.branch_id
       WHERE po.clinic_id = :clinicId
         AND po.status IN ('received', 'approved', 'authorized')
         AND COALESCE(po.payment_status, 'unpaid') IN ('unpaid', 'partial')
         AND (po.total_amount - COALESCE(po.paid_amount, 0)) > 0
         ${branchSql}
       ORDER BY ${sortBy === 'supplier' ? 's.name ASC, po.order_date DESC' : 'po.order_date DESC'}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ rows: rows.map(r => ({ ...r, totalAmount: parseFloat(r.totalAmount) || 0, paidAmount: parseFloat(r.paidAmount) || 0, balanceAmount: parseFloat(r.balanceAmount) || 0 })) });
  } catch (err) {
    console.error('Procurement pending-bills error:', err);
    res.status(500).json({ error: 'Failed to generate pending supplier bills report' });
  }
});

// ── GET /bills-due-payment ───────────────────────────────────────────────
router.get('/bills-due-payment', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'po', allBranches);

    const rows = await sequelize.query(
      `SELECT ${PENDING_BILL_SQL}
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN branches b ON b.id = po.branch_id
       WHERE po.clinic_id = :clinicId
         AND po.status IN ('received', 'approved', 'authorized')
         AND COALESCE(po.payment_status, 'unpaid') IN ('unpaid', 'partial')
         AND (po.total_amount - COALESCE(po.paid_amount, 0)) > 0
         ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const withDueDate = rows
      .map(r => ({ ...r, totalAmount: parseFloat(r.totalAmount) || 0, paidAmount: parseFloat(r.paidAmount) || 0, balanceAmount: parseFloat(r.balanceAmount) || 0, dueDate: computeDueDate(r.orderDate, r.paymentTerms) }))
      .sort((a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime());
    res.json({ rows: withDueDate });
  } catch (err) {
    console.error('Procurement bills-due-payment error:', err);
    res.status(500).json({ error: 'Failed to generate bills due payment report' });
  }
});

// ── GET /payments ────────────────────────────────────────────────────────
// Backs BOTH "Supplier Bills Payments Detail" and "Payment Voucher Report"
// — they're the same underlying rows (supplier_bill_payments); the
// frontend just emphasizes different columns for each.
router.get('/payments', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, 'p', allBranches);

    const rows = await sequelize.query(
      `SELECT p.id, p.payment_date AS "paymentDate", p.po_number AS "poNumber",
              p.supplier_name AS "supplierName", p.amount_paid AS "amountPaid",
              p.payment_method AS "paymentMethod", p.account_name AS "accountName",
              p.reference_number AS "referenceNumber", p.payment_voucher_number AS "voucherNumber",
              p.paid_by AS "paidBy", p.approved_by AS "approvedBy",
              b.name AS "branchName"
       FROM supplier_bill_payments p
       LEFT JOIN branches b ON b.id = p.branch_id
       WHERE p.clinic_id = :clinicId AND p.payment_date BETWEEN :dateFrom AND :dateTo ${branchSql}
       ORDER BY p.payment_date DESC, p.created_at DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ period: { dateFrom, dateTo }, rows: rows.map(r => ({ ...r, amountPaid: parseFloat(r.amountPaid) || 0 })) });
  } catch (err) {
    console.error('Procurement payments error:', err);
    res.status(500).json({ error: 'Failed to generate supplier payments report' });
  }
});

// ── GET /ap-aging-detailed ───────────────────────────────────────────────
// Ages off order_date (no real due_date column exists on purchase_orders),
// same as the dead reference implementation in reports.js — same bucket
// boundaries/labels as reportARAging.js for consistency.
router.get('/ap-aging-detailed', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'po', allBranches);

    const rows = await sequelize.query(
      `SELECT ${PENDING_BILL_SQL}, ((CURRENT_DATE)::date - (po.order_date)::date) AS "daysOverdue"
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN branches b ON b.id = po.branch_id
       WHERE po.clinic_id = :clinicId
         AND po.status IN ('received', 'approved', 'authorized')
         AND COALESCE(po.payment_status, 'unpaid') IN ('unpaid', 'partial')
         AND (po.total_amount - COALESCE(po.paid_amount, 0)) > 0
         ${branchSql}
       ORDER BY "daysOverdue" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({
      rows: rows.map(r => {
        const daysOverdue = parseInt(r.daysOverdue, 10) || 0;
        return { ...r, totalAmount: parseFloat(r.totalAmount) || 0, paidAmount: parseFloat(r.paidAmount) || 0, balanceAmount: parseFloat(r.balanceAmount) || 0, daysOverdue, bucket: bucketFor(daysOverdue), bucketLabel: BUCKET_META[bucketFor(daysOverdue)].label };
      }),
    });
  } catch (err) {
    console.error('Procurement ap-aging-detailed error:', err);
    res.status(500).json({ error: 'Failed to generate A/P aging detail' });
  }
});

// ── GET /ap-aging-summary ────────────────────────────────────────────────
router.get('/ap-aging-summary', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const groupBy = req.query.groupBy === 'supplier' ? 'supplier' : 'branch';
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'po', allBranches);

    const bills = await sequelize.query(
      `SELECT ((po.total_amount - COALESCE(po.paid_amount, 0)) * COALESCE(po.exchange_rate, 1)) AS "balanceAmount",
              ((CURRENT_DATE)::date - (po.order_date)::date) AS "daysOverdue",
              s.name AS "supplierName", b.name AS "branchName"
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN branches b ON b.id = po.branch_id
       WHERE po.clinic_id = :clinicId
         AND po.status IN ('received', 'approved', 'authorized')
         AND COALESCE(po.payment_status, 'unpaid') IN ('unpaid', 'partial')
         AND (po.total_amount - COALESCE(po.paid_amount, 0)) > 0
         ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const groups = new Map(); // groupLabel -> { groupLabel, current, d31_60, d61_90, d90_plus, total }
    for (const bill of bills) {
      const label = (groupBy === 'supplier' ? bill.supplierName : bill.branchName) || 'Unassigned';
      const row = groups.get(label) || { groupLabel: label, current: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
      // Balances are already converted to the deployment's base currency above
      // (bills can be in different po_currency values — see getBaseCurrency()).
      const balance = parseFloat(bill.balanceAmount) || 0;
      const bucket = bucketFor(parseInt(bill.daysOverdue, 10) || 0);
      row[bucket] += balance;
      row.total += balance;
      groups.set(label, row);
    }

    const baseCurrency = await getBaseCurrency();
    res.json({ currency: baseCurrency, rows: [...groups.values()].sort((a, b) => b.total - a.total) });
  } catch (err) {
    console.error('Procurement ap-aging-summary error:', err);
    res.status(500).json({ error: 'Failed to generate A/P aging summary' });
  }
});

// ── GET /consultant-bill-items ───────────────────────────────────────────
// status=unpaid|paid — "Pending"/"Unsettled" and "Cleared"/"Settled" in the
// dropdown are the same two real states (consultant_bills.status), just
// worded differently per report-name pair — confirmed only 'unpaid'/'paid'
// are ever actually written.
router.get('/consultant-bill-items', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const status = req.query.status === 'paid' ? 'paid' : 'unpaid';
    const repl = { clinicId, status };
    const branchSql = branchScope(req, repl, 'cb', allBranches);

    const rows = await sequelize.query(
      `SELECT cbi.id, cbi.visit_date AS "visitDate", cbi.amount, cbi.currency,
              COALESCE(e.first_name || ' ' || e.last_name, 'Unknown') AS "consultantName",
              COALESCE(pb.patient_name, 'Unknown') AS "patientName",
              cb.bill_number AS "billNumber", b.name AS "branchName"
       FROM consultant_bill_items cbi
       JOIN consultant_bills cb ON cb.id = cbi.consultant_bill_id
       LEFT JOIN employees e ON e.id = cbi.consultant_id
       LEFT JOIN patient_bills pb ON pb.id = cbi.patient_bill_id
       LEFT JOIN branches b ON b.id = cb.branch_id
       WHERE cb.clinic_id = :clinicId AND cb.status = :status ${branchSql}
       ORDER BY cbi.visit_date DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ status, rows: rows.map(r => ({ ...r, amount: parseFloat(r.amount) || 0 })) });
  } catch (err) {
    console.error('Procurement consultant-bill-items error:', err);
    res.status(500).json({ error: 'Failed to generate consultant bill items report' });
  }
});

// ── GET /consultant-bills ────────────────────────────────────────────────
router.get('/consultant-bills', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const status = req.query.status === 'paid' ? 'paid' : 'unpaid';
    const repl = { clinicId, status };
    const branchSql = branchScope(req, repl, 'cb', allBranches);

    const rows = await sequelize.query(
      `SELECT cb.id, cb.bill_number AS "billNumber", cb.period_from AS "periodFrom", cb.period_to AS "periodTo",
              cb.bill_amount AS "billAmount", cb.currency, cb.paid_at AS "paidAt",
              COALESCE(e.first_name || ' ' || e.last_name, 'Unknown') AS "consultantName",
              b.name AS "branchName"
       FROM consultant_bills cb
       LEFT JOIN employees e ON e.id = cb.consultant_id
       LEFT JOIN branches b ON b.id = cb.branch_id
       WHERE cb.clinic_id = :clinicId AND cb.status = :status ${branchSql}
       ORDER BY cb.period_to DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ status, rows: rows.map(r => ({ ...r, billAmount: parseFloat(r.billAmount) || 0 })) });
  } catch (err) {
    console.error('Procurement consultant-bills error:', err);
    res.status(500).json({ error: 'Failed to generate consultant bills report' });
  }
});

// ── GET /purchases ───────────────────────────────────────────────────────
// groupBy=branch|supplier|item|location. "location" follows the real,
// populated join path (purchase_order_items -> grn_line_items ->
// inventory_batches -> stock_locations) rather than
// purchase_order_items.inventory_location_id, which isn't reliably set.
router.get('/purchases', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const groupBy = ['supplier', 'item', 'location'].includes(req.query.groupBy) ? req.query.groupBy : 'branch';
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, 'po', allBranches);

    // poi.total_price / gli.unit_cost are in the PO's own po_currency, which
    // varies per PO — multiplying by po.exchange_rate before SUM() converts
    // every row to the deployment's base currency first, so POs placed in
    // different currencies don't get added together as if they were one.
    let rows;
    if (groupBy === 'branch') {
      rows = await sequelize.query(
        `SELECT COALESCE(b.name, 'Unassigned') AS "groupLabel", COUNT(DISTINCT po.id) AS "orderCount",
                SUM(poi.total_price * COALESCE(po.exchange_rate, 1)) AS "totalAmount"
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.purchase_order_id
         LEFT JOIN branches b ON b.id = po.branch_id
         WHERE po.clinic_id = :clinicId AND po.order_date BETWEEN :dateFrom AND :dateTo
           AND po.status IN ('received', 'approved', 'authorized') ${branchSql}
         GROUP BY b.name ORDER BY "totalAmount" DESC`,
        { replacements: repl, type: QueryTypes.SELECT }
      );
    } else if (groupBy === 'supplier') {
      rows = await sequelize.query(
        `SELECT COALESCE(s.name, 'Unassigned') AS "groupLabel", COUNT(DISTINCT po.id) AS "orderCount",
                SUM(poi.total_price * COALESCE(po.exchange_rate, 1)) AS "totalAmount"
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.purchase_order_id
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.clinic_id = :clinicId AND po.order_date BETWEEN :dateFrom AND :dateTo
           AND po.status IN ('received', 'approved', 'authorized') ${branchSql}
         GROUP BY s.name ORDER BY "totalAmount" DESC`,
        { replacements: repl, type: QueryTypes.SELECT }
      );
    } else if (groupBy === 'item') {
      rows = await sequelize.query(
        `SELECT poi.item_name AS "groupLabel", SUM(poi.quantity) AS "totalQuantity",
                COUNT(DISTINCT po.id) AS "orderCount", SUM(poi.total_price * COALESCE(po.exchange_rate, 1)) AS "totalAmount"
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.purchase_order_id
         WHERE po.clinic_id = :clinicId AND po.order_date BETWEEN :dateFrom AND :dateTo
           AND po.status IN ('received', 'approved', 'authorized') ${branchSql}
         GROUP BY poi.item_name ORDER BY "totalAmount" DESC`,
        { replacements: repl, type: QueryTypes.SELECT }
      );
    } else {
      rows = await sequelize.query(
        `SELECT COALESCE(sl.location_name, 'Unassigned') AS "groupLabel", COUNT(DISTINCT po.id) AS "orderCount",
                SUM(gli.quantity_received * COALESCE(gli.unit_cost, poi.unit_price) * COALESCE(po.exchange_rate, 1)) AS "totalAmount"
         FROM grn_line_items gli
         JOIN purchase_order_items poi ON poi.id = gli.po_line_item_id
         JOIN purchase_orders po ON po.id = poi.purchase_order_id
         LEFT JOIN inventory_batches ib ON ib.id = gli.inventory_batch_id
         LEFT JOIN stock_locations sl ON sl.id = ib.location_id
         WHERE po.clinic_id = :clinicId AND po.order_date BETWEEN :dateFrom AND :dateTo
           AND po.status IN ('received', 'approved', 'authorized') ${branchSql}
         GROUP BY sl.location_name ORDER BY "totalAmount" DESC`,
        { replacements: repl, type: QueryTypes.SELECT }
      );
    }

    const baseCurrency = await getBaseCurrency();
    res.json({
      period: { dateFrom, dateTo }, groupBy, currency: baseCurrency,
      rows: rows.map(r => ({ ...r, orderCount: parseInt(r.orderCount, 10) || 0, totalQuantity: r.totalQuantity != null ? parseInt(r.totalQuantity, 10) || 0 : undefined, totalAmount: parseFloat(r.totalAmount) || 0 })),
    });
  } catch (err) {
    console.error('Procurement purchases error:', err);
    res.status(500).json({ error: 'Failed to generate purchases report' });
  }
});

module.exports = router;
