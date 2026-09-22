// ─── Pharmacy Report (v2) ──────────────────────────────────────────────────
//
// Rewritten as a self-contained v2 report. Part of the same effort as reportPatients.js /
// reportLaboratory.js: the old src/server/routes/reports.js was full of
// Postgres-only SQL that silently returns zeros on MySQL. This router is
// self-contained PostgreSQL SQL, and does not touch reports.js or
// index.js — it is meant to be mounted separately, e.g.:
//
//   const reportPharmacyRouter = require('./routes/reportPharmacy');
//   app.use('/api/reports-v2/pharmacy', reportPharmacyRouter);
//
// Auth: relies on the global `app.use('/api', authenticateToken)` +
// `branchAccessControl` middleware already applied ahead of route mounting
// in index.js — req.user is expected to be populated by the time requests
// reach this router.
//
// ── Data model recap / investigation findings ──────────────────────────────
//
// The task brief pointed at `pharmacy_dispensing` as "the core dispensing
// event table". Verified against live data: `pharmacy_dispensing` has ZERO
// rows, and a full grep of src/server/routes for `INSERT INTO
// pharmacy_dispensing` turns up nothing — no live code path writes to it.
// It (and its old reader, src/server/routes/reports.js's pharmacy section,
// plus a `drug_inventory` table it joins against for pricing) is dead
// legacy schema. `drug_inventory` and `drugs` are ALSO empty (0 rows) in
// live data — more dead legacy tables.
//
// The table that is actually live and written to by the currently-routed
// dispensing UI (App.tsx routes `/pharmacy-dispensing` -> DispensingWorkflow,
// which POSTs to `/api/pharmacy-module/dispensing` in
// src/server/routes/pharmacyModule.js) is `dispensing_records`. That INSERT
// (pharmacyModule.js ~line 1087) stores the resolved inventory item id in
// BOTH `drug_id` and `inventory_item_id` — i.e. `dispensing_records.drug_id`
// is a real FK to `inventory_items.id` (the live drug/consumable catalog,
// which has selling_price). `dispensing_records` also carries `unit_price`
// and `total_price` captured AT THE TIME of dispensing, which is the most
// accurate "dispensing value" figure (not a re-derived price that may have
// since changed).
//
// So this report uses `dispensing_records` (NOT `pharmacy_dispensing`) for
// volume, and `inventory_items` (NOT `drug_inventory`/`drugs`, both empty)
// for drug names/pricing — the union of `drugs`/`drug_inventory` is still
// included defensively below in case they get populated later, exactly
// mirroring the same defensive pattern used in reportLaboratory.js.
//
// ── The hard part: cash value ───────────────────────────────────────────
// `dispensing_records` has `bill_id`, `bill_item_id`, `is_billed`,
// `amount_charged` columns that LOOK like a direct link to billing — but
// verified against live data they are never populated (both live rows have
// bill_id = NULL, is_billed = 0). The auto-billing code in
// pharmacyModule.js's POST /dispensing handler attempts to insert into a
// `bill_line_items` table (source_module = 'pharmacy_dispensing', source_id
// = the dispensing_records.id) — but `bill_line_items` is COMPLETELY EMPTY
// (0 rows total, not just for pharmacy) in live data, meaning that
// auto-billing path has never successfully completed for any dispensing
// event, for any module. It is broken/dead, not a valid revenue source.
//
// Cash value that DOES exist lives, like lab tests, in the generic
// `patient_bills.services` JSON column, via a SEPARATE, uncoordinated write
// path (the legacy Pharmacy.tsx dispense flow and DispensingWorkflow's own
// `billForSale`/PrescriptionManagement billing calls POST directly to
// `/api/patient-bills` / `/add-services`, independent of the
// `dispensing_records` insert). There is NO foreign key between a
// `patient_bills` line item and a `dispensing_records` row. We identify a
// bill line item as pharmacy-related the same way reportLaboratory.js
// identifies lab items: by normalized-name match against a drug-name
// catalog (inventory_items ∪ drugs ∪ drug_inventory).
//
// Verified by hand against live data (9 patient_bills rows): exactly one
// drug line item exists across all bills — "Arthegate" (qty 1, unitPrice
// 50, totalPrice 50) — appearing on two separate paid bills, for the same
// two patients and same drug/price as the two live `dispensing_records`
// rows (both for inventory_items "Arthegate", unit_price 50). The bill
// dates are within hours of the dispensing dates for the same patients,
// strongly suggesting these are the same two real-world dispensing events
// recorded twice through the two uncoordinated write paths described above
// — but this is circumstantial (matched by name/price/patient, not by any
// DB constraint), not a structural guarantee that dispensing volume and
// billed pharmacy revenue will always reconcile. Because there is no
// reliable link, this report surfaces BOTH figures as separate, clearly
// labeled headline tiles rather than forcing one number:
//   - "Dispensing Value" = SUM(dispensing_records.total_price) — volume-side,
//     drug price × qty at time of dispensing, regardless of whether it was
//     ever billed.
//   - "Billed" / "Collected" = derived from patient_bills line items matched
//     by drug name, same Billed-vs-Collected estimation logic as
//     reportLaboratory.js (see below).
//
// ── Billed vs. Collected ────────────────────────────────────────────────
// "Billed" = the line item's total price, unconditionally, for bills dated
// in the period.
// "Collected" is an ESTIMATE, in this priority order:
//   1. If the line item itself carries `paid: true/false` (per-item payment
//      tracking added earlier), use that — exact.
//   2. Otherwise, fall back to the bill's overall status: status='paid' →
//      full item amount collected; status='pending' → 0 collected;
//      otherwise (partial/overdue/active) → the item amount is prorated by
//      the bill's paid_amount/total_amount ratio. Most live bills have no
//      per-item paid flag, so most "Collected" figures are prorated
//      estimates, not exact collections. The API reports how many matched
//      items fell into each method (`collectionMethod`) so the caller can
//      see how much of "Collected" is exact vs. estimated.
//
// ── Clinic scoping ──────────────────────────────────────────────────────
// `dispensing_records.clinic_id`, `inventory_items.clinic_id` and
// `patient_bills.clinic_id` are all reliable, populated int columns in live
// data — all three are filtered by the resolved clinic id.

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

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
// Written inline with named replacements (not branchFilter.js's
// getBranchConditionSQL, which uses positional `?` placeholders that can't
// mix with the named :params this file uses in the same query) — same
// convention as branchScope() in routes/hr.js. NOT applied to `drugs` or
// `drug_inventory` below — `drugs` is a deliberately shared/unscoped catalog
// table (per the branch-isolation initiative's exclusion list) and
// `drug_inventory` has no branch_id column at all.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

// ── GET / ────────────────────────────────────────────────────────────────
// Query params:
//   dateFrom, dateTo  — YYYY-MM-DD, default to the last 30 days
//   clinic_id         — defaults to the authenticated user's clinic
router.get('/', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = parseInt(req.query.clinic_id, 10) || req.user?.clinicId || 1;

    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { clinicId, dateFrom, dateTo, fromTs, toTs };
    const branchSqlDr = branchScope(req, repl, 'dr');
    // branchScope() above already stamped `branchId` into `repl` (or left it
    // absent for an admin) — reuse it for the unaliased queries below.
    const branchSqlNoAlias = repl.branchId ? ' AND branch_id = :branchId' : '';

    // ── 1. Dispensing volume by drug, from dispensing_records (the live
    //      table — see header note). dispensing_date is a plain DATE column.
    const volumeRows = await sequelize.query(
      `SELECT dr.drug_id AS "drugId",
              COALESCE(ii.item_name, 'Unknown / deleted item') AS "drugName",
              COUNT(*) AS events,
              COALESCE(SUM(dr.quantity_dispensed), 0) AS qty,
              COALESCE(SUM(dr.total_price), 0) AS "dispensingValue"
       FROM dispensing_records dr
       LEFT JOIN inventory_items ii ON ii.id = dr.drug_id
       WHERE dr.clinic_id = :clinicId AND dr.dispensing_date BETWEEN :dateFrom AND :dateTo ${branchSqlDr}
       GROUP BY dr.drug_id, ii.item_name
       ORDER BY qty DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // ── 2. Overall dispensing summary.
    const [summaryRow] = await sequelize.query(
      `SELECT COUNT(*) AS "totalEvents",
              COUNT(DISTINCT patient_id) AS "distinctPatients",
              COALESCE(SUM(quantity_dispensed), 0) AS "totalQty",
              COALESCE(SUM(total_price), 0) AS "totalDispensingValue"
       FROM dispensing_records
       WHERE clinic_id = :clinicId AND dispensing_date BETWEEN :dateFrom AND :dateTo ${branchSqlNoAlias}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // ── 3. Status breakdown (dispensed / returned / etc).
    const statusRows = await sequelize.query(
      `SELECT status, COUNT(*) AS count
       FROM dispensing_records
       WHERE clinic_id = :clinicId AND dispensing_date BETWEEN :dateFrom AND :dateTo ${branchSqlNoAlias}
       GROUP BY status
       ORDER BY count DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // ── 4. Catalogs used to identify pharmacy-related bill line items.
    //      inventory_items is the live catalog (its id is also the FK used
    //      by dispensing_records.drug_id, so matches here merge cleanly
    //      with the volume rows above). drugs / drug_inventory are dead
    //      legacy tables in live data (0 rows each) but are included
    //      defensively in case they are populated in future/other envs.
    const inventoryItems = await sequelize.query(
      `SELECT id, item_name AS name FROM inventory_items WHERE clinic_id = :clinicId ${branchSqlNoAlias}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const drugsCatalog = await sequelize.query(
      `SELECT id, drug_name AS name FROM drugs WHERE clinic_id = :clinicId`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const drugInventoryCatalog = await sequelize.query(
      `SELECT id, drug_name AS name FROM drug_inventory WHERE clinic_id = :clinicId`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const nameToItem = new Map(); // normalized name -> { id, name } (inventory_items — merges with volume)
    for (const it of inventoryItems) {
      const n = normalizeName(it.name);
      if (n) nameToItem.set(n, { id: it.id, name: it.name });
    }
    const nameToOtherDrug = new Map(); // normalized name -> { id, name, source } (fallback catalogs only)
    for (const d of drugsCatalog) {
      const n = normalizeName(d.name);
      if (n && !nameToItem.has(n)) nameToOtherDrug.set(n, { id: d.id, name: d.name, source: 'drugs' });
    }
    for (const d of drugInventoryCatalog) {
      const n = normalizeName(d.name);
      if (n && !nameToItem.has(n) && !nameToOtherDrug.has(n)) nameToOtherDrug.set(n, { id: d.id, name: d.name, source: 'drug_inventory' });
    }

    function classifyLineItem(rawName) {
      const n = normalizeName(rawName);
      if (!n) return null;
      if (nameToItem.has(n)) {
        const it = nameToItem.get(n);
        return { key: `item:${it.id}`, drugId: it.id, label: it.name };
      }
      if (nameToOtherDrug.has(n)) {
        const d = nameToOtherDrug.get(n);
        return { key: `${d.source}:${n}`, drugId: null, label: d.name };
      }
      return null;
    }

    // ── 5. Pull raw bills in the period (clinic-scoped) and parse the JSON
    //      `services` line-item array in JS (mysql2/Sequelize returns JSON
    //      columns as raw strings via raw sequelize.query, not pre-parsed).
    const bills = await sequelize.query(
      `SELECT id, total_amount AS "totalAmount", paid_amount AS "paidAmount", status, bill_date AS "billDate", services
       FROM patient_bills
       WHERE clinic_id = :clinicId AND bill_date BETWEEN :fromTs AND :toTs ${branchSqlNoAlias}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const cashByKey = new Map(); // key -> { label, drugId, totalBilled, totalCollected }
    let explicitPaidFlagItems = 0;
    let estimatedFromBillStatusItems = 0;

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
        const match = classifyLineItem(rawName);
        if (!match) continue;

        const qty = num(item.quantity) || 1;
        const itemTotal =
          item.totalPrice != null ? num(item.totalPrice)
          : item.total_price != null ? num(item.total_price)
          : num(item.unitPrice ?? item.unit_price ?? item.price) * qty;

        let collected;
        if (typeof item.paid === 'boolean') {
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

        const row = cashByKey.get(match.key) || {
          label: match.label,
          drugId: match.drugId,
          totalBilled: 0,
          totalCollected: 0,
        };
        row.totalBilled += itemTotal;
        row.totalCollected += collected;
        cashByKey.set(match.key, row);
      }
    }

    // ── 6. Merge dispensing-side volume with bill-side cash into one
    //      "by drug" table.
    const byDrugMap = new Map(); // key -> row

    for (const r of volumeRows) {
      byDrugMap.set(`item:${r.drugId}`, {
        drugId: r.drugId,
        drugName: r.drugName,
        events: parseInt(r.events, 10) || 0,
        qty: parseInt(r.qty, 10) || 0,
        dispensingValue: num(r.dispensingValue),
        totalBilled: 0,
        totalCollected: 0,
      });
    }
    for (const [key, cash] of cashByKey.entries()) {
      const existing = byDrugMap.get(key);
      if (existing) {
        existing.totalBilled = cash.totalBilled;
        existing.totalCollected = cash.totalCollected;
      } else {
        byDrugMap.set(key, {
          drugId: cash.drugId,
          drugName: cash.label,
          events: null,
          qty: null, // billed under this name but no matching dispensing_records row in period
          dispensingValue: 0,
          totalBilled: cash.totalBilled,
          totalCollected: cash.totalCollected,
        });
      }
    }

    const byDrug = Array.from(byDrugMap.values())
      .sort((a, b) => (b.dispensingValue - a.dispensingValue) || (b.totalBilled - a.totalBilled) || ((b.qty || 0) - (a.qty || 0)));

    const totalBilled = byDrug.reduce((sum, r) => sum + r.totalBilled, 0);
    const totalCollected = byDrug.reduce((sum, r) => sum + r.totalCollected, 0);

    // ── 7. Fast/slow moving items — ranked by quantity dispensed in the period,
    //      against the FULL active inventory catalog (not just byDrug above, which
    //      only lists items with dispensing OR billing activity). Items never
    //      dispensed in the period show qtyDispensed = 0 and surface at the top of
    //      "slow moving" — that is the correct, honest signal for dead stock.
    const branchSqlIi = repl.branchId ? ' AND ii.branch_id = :branchId' : '';
    const movementRows = await sequelize.query(
      `SELECT ii.id AS "itemId", ii.item_name AS "itemName", ii.quantity_on_hand AS "quantityOnHand",
              COALESCE(SUM(dr.quantity_dispensed), 0) AS "qtyDispensed",
              COALESCE(SUM(dr.total_price), 0) AS "dispensingValue"
       FROM inventory_items ii
       LEFT JOIN dispensing_records dr
         ON dr.drug_id = ii.id AND dr.clinic_id = :clinicId AND dr.dispensing_date BETWEEN :dateFrom AND :dateTo ${branchSqlDr}
       WHERE ii.clinic_id = :clinicId AND ii.is_active = true ${branchSqlIi}
       GROUP BY ii.id, ii.item_name, ii.quantity_on_hand`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const movementItems = movementRows.map(r => ({
      itemId: r.itemId,
      itemName: r.itemName,
      quantityOnHand: parseInt(r.quantityOnHand, 10) || 0,
      qtyDispensed: parseInt(r.qtyDispensed, 10) || 0,
      dispensingValue: num(r.dispensingValue),
    }));
    const fastMoving = movementItems.filter(r => r.qtyDispensed > 0).sort((a, b) => b.qtyDispensed - a.qtyDispensed).slice(0, 10);
    const slowMoving = [...movementItems].sort((a, b) => a.qtyDispensed - b.qtyDispensed).slice(0, 10);

    res.json({
      period: { dateFrom, dateTo },
      clinicId,
      dispensingVolume: {
        totalEvents: parseInt(summaryRow?.totalEvents, 10) || 0,
        distinctPatients: parseInt(summaryRow?.distinctPatients, 10) || 0,
        totalQty: parseInt(summaryRow?.totalQty, 10) || 0,
        totalDispensingValue: num(summaryRow?.totalDispensingValue),
      },
      cashSummary: {
        totalBilled,
        totalCollected,
        collectionMethod: {
          exactItems: explicitPaidFlagItems,
          estimatedItems: estimatedFromBillStatusItems,
          note:
            estimatedFromBillStatusItems > 0
              ? 'Some "Collected" figures are estimated by prorating bill-level payment status/ratio to line items, because most bills do not carry a per-item paid flag. See collectionMethod counts.'
              : 'All matched line items carried an explicit per-item paid flag or status.',
        },
      },
      byDrug,
      statusBreakdown: statusRows.map(r => ({ status: r.status, count: parseInt(r.count, 10) || 0 })),
      movement: { fastMoving, slowMoving },
    });
  } catch (err) {
    console.error('Pharmacy report error:', err);
    res.status(500).json({ error: 'Failed to generate pharmacy report' });
  }
});

module.exports = router;
