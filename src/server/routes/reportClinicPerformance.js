// ─── Clinic / Department Performance Report (v2) ──────────────────────────
//
// Rewritten as a self-contained v2 report. Part of the same effort as reportLaboratory.js
// and reportPatients.js. Self-contained, does not
// touch reports.js or index.js — meant to be mounted separately, e.g.:
//
//   app.use('/api/reports-v2/clinic-performance', require('./routes/reportClinicPerformance'));
//
// Auth: relies on the global `app.use('/api', authenticateToken)` +
// `branchAccessControl` middleware already applied ahead of route mounting
// in index.js — req.user is expected to be populated by the time requests
// reach this router.
//
// ── Two dimensions, deliberately unbalanced ─────────────────────────────
// Live data has exactly 2 rows in `clinic_names` ("Outpatient" id=1,
// "General" id=6), and in practice every visit/receipt/bill currently on
// file is clinic_id=1. A "by clinic" breakdown is real but thin. The far
// richer, more actionable dimension is department/service-category
// performance, using the `services` catalog's `category` column
// (Consultation / Diagnostic / Test / Other, per live data — re-verify with
// `SELECT category, COUNT(*) FROM services GROUP BY category` since this
// can change). So: "By Clinic" is a lightweight 2-row section, "By
// Category" is the main content.
//
// ── Cross-clinic scope, unlike other reports-v2 routers ────────────────
// reportLaboratory.js / reportPatients.js accept a `clinic_id` query param
// (default req.user.clinicId || 1) and scope ALL of their data to a single
// clinic. This report intentionally does NOT do that: its entire purpose is
// comparing clinics/categories against each other (the "Top-performing
// clinic" tile needs all clinics' figures in hand simultaneously), so every
// query here is unfiltered by clinic — it aggregates system-wide for the
// selected date range. `branchAccessControl` (a separate, unrelated
// multi-branch scoping concept) still applies upstream in index.js.
//
// ── The hard part: mapping a bill line item to a department/category ────
// Exactly the same problem reportLaboratory.js solved for lab tests, reused
// here verbatim: `patient_bills.services` is a JSON array of line items with
// inconsistent field names (serviceName/name/service_name, totalPrice/
// total_price, unitPrice/unit_price/price), and there is NO foreign key from
// a line item to a `services` catalog row. We identify a line item's
// category by matching its NORMALIZED name (lowercase, strip "(...)"
// suffixes, strip punctuation, collapse whitespace — identical normalizeName
// logic to reportLaboratory.js) against `services.service_name`, also
// normalized.
//
// Verified against live data that this match is FAR from complete: the
// `services` catalog only has 6 rows total, and several distinct billed
// names never coincide with a catalog entry even after normalization —
// e.g. bills contain "Complete Blood Count" and "Liver Function Test (LFT)"
// as line items, but the catalog's matching rows are named "CBC" and
// "Liver Profile" respectively (different words entirely, not just
// different punctuation/case, so normalization can't bridge them). Bills
// also contain pharmacy/drug line items (e.g. "Panadol Extra", "Arthegate")
// that were never in the `services` catalog to begin with. Rather than
// silently dropping this revenue or guessing a category via fuzzy matching
// (which reportLaboratory.js deliberately avoided too), every line item that
// doesn't resolve to an exact normalized-name match is bucketed into an
// explicit "Uncategorized" category so totals still reconcile to 100% of
// billed line items and the gap is visible, not hidden. The API reports
// `uncategorizedShare` so the frontend can disclose how much of the picture
// is actually attributed vs. unattributed.
//
// ── Root fix, applied going forward ──────────────────────────────────────
// Every place a bill line item is actually created from a catalog pick —
// BillDetails.tsx's Add Item panel, DispensingWorkflow.tsx's prescription/
// direct-sale billing, clinical.js's lab-request auto-bill, TheatreService
// .js's item-usage billing — now stamps the line item with its real
// `category` at creation time, since the category is known with certainty
// right there (the user just picked the catalog row). The matching logic
// below checks `item.category` first and only falls back to the normalized-
// name approximation above for line items that predate this fix. This
// shrinks `uncategorizedShare` for new activity automatically; it does
// nothing for historical bills, which never had a category captured and
// have no reliable way to get one now short of a flagged, approximate
// backfill (not done here — see the Analytics Assistant's analyticsFunctions
// .js header for why that was deliberately left as a separate decision).
//
// ── Billed vs. Collected ────────────────────────────────────────────────
// Identical estimation logic/priority order to reportLaboratory.js:
//   1. Per-item `paid: true/false` flag or `status: 'paid'` on the line item
//      itself, if present — exact.
//   2. Otherwise, the bill's overall status: 'paid' → full item amount
//      collected; 'pending' → 0 collected; otherwise (partial/overdue/
//      active) → item amount prorated by the bill's paid_amount/total_amount
//      ratio. This is an ESTIMATE, not a measurement, for any bill lacking
//      per-item payment tracking. `collectionMethod` in the response reports
//      how many matched items fell into each bucket.
//
// ── By-clinic revenue ────────────────────────────────────────────────────
// "Revenue collected" per clinic comes from `receipts.payment_amount`
// (status = 'active', excluding voided/refunded receipts), grouped by
// `receipts.clinic_id`, joined against `clinic_names`. Visit volume comes
// from `visits.clinic_id`. These are two independent group-bys merged in
// JS against the full `clinic_names` list, so a clinic with zero activity
// in the period still appears with zeroes rather than being omitted.

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
const AccountingService = require('../services/AccountingService');

// ── Helpers ──────────────────────────────────────────────────────────────

/** YYYY-MM-DD for `daysAgo` days before today (local server date). */
function isoDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

/** Validates a YYYY-MM-DD string; returns null if invalid/missing. */
function asDateStr(v) {
  if (!v || typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** lowercase, strip "(...)" suffixes, strip punctuation, collapse whitespace */
function normalizeName(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best-effort numeric coercion, defaulting to 0. */
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Non-admin users only see rows from their own branch; admins see everything.
// This report is deliberately cross-CLINIC (see header note above), but branch
// isolation is a separate, orthogonal concept (branchAccessControl/
// branchFilter.js) that still applies — a branch-assigned user should not see
// another branch's visits/revenue/bills just because the report spans clinics.
// Written inline with named replacements (not branchFilter.js's
// getBranchConditionSQL, which uses positional `?` placeholders that can't
// mix with the named :params this file uses in the same query) — same
// convention as branchScope() in routes/hr.js.
function branchScope(req, replacements) {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  return ' AND branch_id = :branchId';
}

const UNCATEGORIZED = 'Uncategorized';

// A bill line item's REAL price is not always what its own unitPrice/totalPrice
// says — insurance/credit-priced items use one of two representations elsewhere
// in this app (BillDetails.tsx / DispensingWorkflow.tsx's re-pricing logic),
// both of which previously left this report attributing $0 (or the wrong
// currency) to insurance/credit-billed line items:
//   1. The whole bill is scheme-mode (bill.scheme_id set) — unitPrice/totalPrice
//      ARE the real charge, just denominated in the scheme's own currency
//      (bill.bill_currency), which is frequently not the base currency.
//   2. An individually-insured item on an otherwise-cash bill — unitPrice/
//      totalPrice are deliberately zeroed (nothing owed in SSP for it) and the
//      real price is stashed in schemePrice/schemeCurrency instead.
// Resolves either representation to a base-currency (SSP) amount, tagged as
// insurance so callers can report it separately from genuine cash revenue.
async function resolveItemAmount(item, bill, rateCache, clinicId) {
  const qty = num(item.quantity) || 1;
  const cashAmount =
    item.totalPrice != null ? num(item.totalPrice)
    : item.total_price != null ? num(item.total_price)
    : num(item.unitPrice ?? item.unit_price ?? item.price) * qty;

  const isSchemeBill = !!bill.schemeId;
  const isIndividuallyInsured = item.schemePrice != null && cashAmount === 0;
  if (!isSchemeBill && !isIndividuallyInsured) {
    return { amount: cashAmount, isInsurance: false };
  }

  // Converted into the tenant's base currency (USD for some tenants), never assumed SSP.

  if (!rateCache.has('__base')) rateCache.set('__base', await getBaseCurrencyCode());

  const base = rateCache.get('__base');

  const rawAmount = isSchemeBill ? cashAmount : num(item.schemePrice);
  const currency = (isSchemeBill ? bill.billCurrency : item.schemeCurrency) || base;
  if (currency === base || rawAmount === 0) {
    return { amount: rawAmount, isInsurance: true };
  }

  const asOfDate = bill.billDate || new Date();
  const cacheKey = `${currency}|${asOfDate}`;
  let rate = rateCache.get(cacheKey);
  if (rate === undefined) {
    try {
      rate = await AccountingService.getExchangeRate(clinicId, currency, base, asOfDate);
    } catch {
      rate = null;
    }
    rateCache.set(cacheKey, rate);
  }
  const amount = rate != null ? AccountingService.convertAmount(rawAmount, rate) : rawAmount;
  return { amount, isInsurance: true, unconverted: rate == null };
}

// ── GET / ────────────────────────────────────────────────────────────────
// Query params:
//   dateFrom, dateTo — YYYY-MM-DD, default to the last 30 days
// (No clinic_id param — this report is intentionally cross-clinic, see
// header note.)
router.get('/', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = req.user?.clinicId || 1; // only used for exchange-rate lookups — report itself stays cross-clinic

    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl);

    // ── 1. Clinics master list ──────────────────────────────────────────
    const clinics = await sequelize.query(
      `SELECT id, name FROM clinic_names ORDER BY id`,
      { type: QueryTypes.SELECT }
    );

    // ── 2. Visit volume by clinic ────────────────────────────────────────
    const visitRows = await sequelize.query(
      `SELECT clinic_id AS "clinicId", COUNT(*) AS "visitCount"
       FROM visits
       WHERE visit_date BETWEEN :fromTs AND :toTs ${branchSql}
       GROUP BY clinic_id`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // ── 3. Revenue collected by clinic (active receipts only) ───────────
    const revenueRows = await sequelize.query(
      `SELECT clinic_id AS "clinicId", SUM(payment_amount) AS revenue
       FROM receipts
       WHERE payment_date BETWEEN :fromTs AND :toTs AND status = 'active' ${branchSql}
       GROUP BY clinic_id`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const visitByClinic = new Map(visitRows.map(r => [r.clinicId, parseInt(r.visitCount, 10) || 0]));
    const revenueByClinic = new Map(revenueRows.map(r => [r.clinicId, num(r.revenue)]));

    const byClinic = clinics.map(c => ({
      clinicId: c.id,
      name: c.name,
      visitCount: visitByClinic.get(c.id) || 0,
      revenueCollected: revenueByClinic.get(c.id) || 0,
    }));
    // Also include any clinic_id present in the data but missing from
    // clinic_names (orphaned/legacy ids) so revenue is never silently
    // dropped from the totals.
    const knownIds = new Set(clinics.map(c => c.id));
    const orphanIds = new Set([...visitByClinic.keys(), ...revenueByClinic.keys()].filter(id => !knownIds.has(id)));
    for (const id of orphanIds) {
      byClinic.push({
        clinicId: id,
        name: `Clinic #${id} (unregistered)`,
        visitCount: visitByClinic.get(id) || 0,
        revenueCollected: revenueByClinic.get(id) || 0,
      });
    }

    const totalVisits = byClinic.reduce((s, c) => s + c.visitCount, 0);

    // ── 4. Category catalog: normalized service_name -> category ────────
    const services = await sequelize.query(
      `SELECT service_name AS "serviceName", category FROM services`,
      { type: QueryTypes.SELECT }
    );
    const nameToCategory = new Map();
    for (const s of services) {
      const n = normalizeName(s.serviceName);
      if (n) nameToCategory.set(n, s.category || UNCATEGORIZED);
    }

    // Most of "Uncategorized" is pharmacy/drug line items — they were never
    // in the `services` catalog to begin with (see header note), but they ARE
    // in the inventory catalog. A second, same-convention exact-normalized-
    // name match against active inventory_items recovers those specifically,
    // labeled "Pharmacy / Inventory" rather than left anonymous. Anything
    // matching neither catalog still falls to Uncategorized.
    const PHARMACY_LABEL = 'Pharmacy / Inventory';
    const inventoryItems = await sequelize.query(
      `SELECT item_name AS "itemName" FROM inventory_items WHERE is_active = true`,
      { type: QueryTypes.SELECT }
    );
    const pharmacyNames = new Set();
    for (const it of inventoryItems) {
      const n = normalizeName(it.itemName);
      if (n) pharmacyNames.add(n);
    }

    // ── 5. Bills in period (all clinics — see header note) ──────────────
    const bills = await sequelize.query(
      `SELECT id, total_amount AS "totalAmount", paid_amount AS "paidAmount", status, bill_date AS "billDate", services,
              scheme_id AS "schemeId", bill_currency AS "billCurrency"
       FROM patient_bills
       WHERE bill_date BETWEEN :fromTs AND :toTs ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const byCategoryMap = new Map(); // category -> { volume, totalBilled, totalCollected, cashBilled, cashCollected, insuranceBilled, insuranceCollected }
    let explicitPaidFlagItems = 0;
    let estimatedFromBillStatusItems = 0;
    let matchedItemCount = 0;
    let unmatchedItemCount = 0;
    let totalBilledAllItems = 0;
    const rateCache = new Map();

    for (const bill of bills) {
      let items = [];
      try {
        const parsed = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        continue; // malformed JSON on this bill — skip it, don't crash the report
      }

      const billTotal = num(bill.totalAmount);
      const billPaid = num(bill.paidAmount);
      const billPaidRatio = billTotal > 0 ? Math.min(billPaid / billTotal, 1) : 0;

      for (const item of items) {
        const rawName = item?.serviceName || item?.name || item?.service_name;
        const n = normalizeName(rawName);
        if (!n && !item?.category) continue; // no usable name or category on this line item at all — skip

        // Lines added since the category-capture fix (BillDetails.tsx, DispensingWorkflow
        // .tsx, clinical.js's lab auto-bill, TheatreService.js) carry their real category
        // directly — captured at the moment the catalog item was picked, not guessed later.
        // Trust that first; only fall back to normalized-name matching (the old, admittedly
        // incomplete approximation — see header note) for line items that predate the fix.
        const category = item?.category || nameToCategory.get(n) || (pharmacyNames.has(n) ? PHARMACY_LABEL : UNCATEGORIZED);
        if (category === UNCATEGORIZED) unmatchedItemCount++; else matchedItemCount++;

        const { amount: itemTotal, isInsurance } = await resolveItemAmount(item, bill, rateCache, clinicId);

        let collected;
        if (item.isVoided) {
          // A voided line never counts as collected, regardless of a stale
          // `paid` flag left over from before it was voided.
          collected = 0;
          explicitPaidFlagItems++;
        } else if (typeof item.paid === 'boolean') {
          collected = item.paid ? itemTotal : 0;
          explicitPaidFlagItems++;
        } else if (item.status === 'paid') {
          collected = itemTotal;
          explicitPaidFlagItems++;
        } else if (bill.status === 'paid') {
          collected = itemTotal;
          estimatedFromBillStatusItems++;
        } else if (bill.status === 'pending') {
          collected = 0;
          estimatedFromBillStatusItems++;
        } else {
          collected = itemTotal * billPaidRatio;
          estimatedFromBillStatusItems++;
        }

        totalBilledAllItems += itemTotal;

        const row = byCategoryMap.get(category) || {
          category, volume: 0, totalBilled: 0, totalCollected: 0,
          cashBilled: 0, cashCollected: 0, insuranceBilled: 0, insuranceCollected: 0,
        };
        row.volume += 1;
        row.totalBilled += itemTotal;
        row.totalCollected += collected;
        if (isInsurance) {
          row.insuranceBilled += itemTotal;
          row.insuranceCollected += collected;
        } else {
          row.cashBilled += itemTotal;
          row.cashCollected += collected;
        }
        byCategoryMap.set(category, row);
      }
    }

    const byCategory = Array.from(byCategoryMap.values()).sort((a, b) => b.totalCollected - a.totalCollected);

    const totalBilled = byCategory.reduce((s, c) => s + c.totalBilled, 0);
    const totalCollected = byCategory.reduce((s, c) => s + c.totalCollected, 0);
    const uncategorizedRow = byCategoryMap.get(UNCATEGORIZED);
    const uncategorizedShare = totalBilledAllItems > 0
      ? (uncategorizedRow ? uncategorizedRow.totalBilled / totalBilledAllItems : 0)
      : 0;

    // ── 6. Top performers ────────────────────────────────────────────────
    const topCategory = byCategory.find(c => c.category !== UNCATEGORIZED) || byCategory[0] || null;
    const topClinic = byClinic.slice().sort((a, b) => b.revenueCollected - a.revenueCollected)[0] || null;

    res.json({
      period: { dateFrom, dateTo },
      summary: {
        totalRevenueCollected: totalCollected,
        totalRevenueBilled: totalBilled,
        totalVisits,
        topCategory: topCategory ? { category: topCategory.category, totalCollected: topCategory.totalCollected } : null,
        topClinic: topClinic ? { clinicId: topClinic.clinicId, name: topClinic.name, revenueCollected: topClinic.revenueCollected } : null,
      },
      byClinic,
      byCategory,
      collectionMethod: {
        exactItems: explicitPaidFlagItems,
        estimatedItems: estimatedFromBillStatusItems,
      },
      categorization: {
        matchedItems: matchedItemCount,
        unmatchedItems: unmatchedItemCount,
        uncategorizedShare,
        note:
          'Category is assigned by matching a bill line item\'s normalized name exactly against the `services` catalog\'s service_name (same approach as the Laboratory report). Items that don\'t match the services catalog are checked a second time against the active inventory catalog and labeled "Pharmacy / Inventory" when found there — this is where most previously-"Uncategorized" revenue comes from (dispensed drugs were never in the `services` catalog to begin with). Anything matching neither catalog (e.g. a clinical item whose billed name differs from the catalog entry, such as "Complete Blood Count" vs. catalog "CBC") is grouped under "Uncategorized" rather than dropped or fuzzy-matched, so revenue totals still reconcile to 100% of billed line items.',
      },
    });
  } catch (err) {
    console.error('Clinic performance report error:', err);
    res.status(500).json({ error: 'Failed to generate clinic performance report' });
  }
});

module.exports = router;
