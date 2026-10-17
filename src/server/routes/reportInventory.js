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
const { QueryTypes } = require('sequelize');
const { getBranchConditionSQL } = require('../middleware/branchFilter');

// ═══════════════════════════════════════════════════
// INVENTORY REPORT — current-state stock listing + valuation
// Plain PostgreSQL SQL.
//
// GET /  (mounted e.g. at /api/reports-v2/inventory)
// Query params:
//   clinic_id     (optional, defaults to 1)
//   is_active     (optional, 'true'|'false', defaults to 'true')
//   dateFrom      (optional, YYYY-MM-DD) — when paired with dateTo, restricts the
//                 listing to items that received stock (a batch receipt) in that
//                 window. The report itself is a current-state snapshot, so this
//                 is an opt-in narrowing filter, not the primary mode.
//   dateTo        (optional, YYYY-MM-DD)
// ═══════════════════════════════════════════════════

// Mirrors the stockStatus() thresholds in src/pages/inventory/ItemMaster.tsx
// exactly, so this report's Low/Out/Over/Normal counts always agree with the
// Item Master screen.
function stockStatus(item) {
  const qty = Number(item.quantity_on_hand) || 0;
  const min = Number(item.minimum_stock_level) || 0;
  const max = Number(item.maximum_stock_level) || 0;
  if (qty === 0) return 'Out of Stock';
  if (min > 0 && qty <= min) return 'Low Stock';
  if (max > 0 && qty >= max) return 'Over Stock';
  return 'Normal';
}

router.get('/', async (req, res) => {
  try {
    const { clinic_id, is_active, dateFrom, dateTo } = req.query;

    const conditions = [];
    const replacements = {};

    conditions.push('i.clinic_id = :clinic_id');
    replacements.clinic_id = parseInt(clinic_id, 10) || 1;

    const activeOnly = is_active === undefined ? true : is_active === 'true';
    conditions.push('i.is_active = :is_active');
    replacements.is_active = activeOnly;

    // Branch isolation — same helper used across the inventory module.
    const { sql: branchSQL, params: branchParams } = getBranchConditionSQL(req, 'i');
    if (branchSQL && branchParams && branchParams.length > 0) {
      conditions.push('i.branch_id = :branchId');
      replacements.branchId = branchParams[0];
    }

    // Optional narrowing: only items that received a batch in [dateFrom, dateTo].
    if (dateFrom && dateTo) {
      conditions.push(`EXISTS (
        SELECT 1 FROM inventory_batches b
        WHERE b.item_id = i.id
          AND b.receipt_date >= :dateFrom
          AND b.receipt_date <= :dateTo
      )`);
      replacements.dateFrom = dateFrom;
      replacements.dateTo = dateTo;
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Items are costed in different currencies (cost_currency), so stock value must be
    // normalized to the base currency before summing — otherwise a USD-costed item and an
    // SSP-costed item get added as if they were the same unit. Load the base currency and
    // the latest active rate per foreign currency, same convention as CurrencyContext.tsx.
    const clinicIdForFx = parseInt(clinic_id, 10) || 1;
    const [[baseCurrencyRow]] = await sequelize.query(
      `SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`
    );
    const baseCurrency = baseCurrencyRow?.code || 'SSP';

    const [rateRows] = await sequelize.query(
      `SELECT from_currency, to_currency, rate FROM exchange_rates
       WHERE clinic_id = :clinicId AND to_currency = :baseCurrency AND is_active = true
       ORDER BY effective_date DESC`,
      { replacements: { clinicId: clinicIdForFx, baseCurrency } }
    );
    const rateToBase = new Map(); // from_currency -> rate (multiply to get base currency)
    for (const r of rateRows) {
      if (!rateToBase.has(r.from_currency)) rateToBase.set(r.from_currency, Number(r.rate));
    }
    rateToBase.set(baseCurrency, 1);

    const [rows] = await sequelize.query(`
      SELECT
        i.id,
        i.item_code,
        i.item_name,
        i.item_category,
        i.item_type,
        i.unit_of_measure,
        i.quantity_on_hand,
        i.reserved_quantity,
        (i.quantity_on_hand - i.reserved_quantity) AS available_quantity,
        i.minimum_stock_level,
        i.maximum_stock_level,
        i.average_unit_cost,
        i.current_unit_cost,
        i.selling_price,
        i.cost_currency,
        (i.quantity_on_hand * i.average_unit_cost) AS stock_value,
        lr.last_received_date
      FROM inventory_items i
      LEFT JOIN (
        SELECT item_id, MAX(receipt_date) AS last_received_date
        FROM inventory_batches
        GROUP BY item_id
      ) lr ON lr.item_id = i.id
      ${where}
      ORDER BY i.item_name ASC
    `, { replacements });

    // Compute status + summary tiles in JS from the same rows the table renders,
    // so the tiles and the table can never disagree.
    let totalStockValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let unconvertedCount = 0;
    const categoryMap = new Map();

    const items = rows.map(row => {
      const qty = Number(row.quantity_on_hand) || 0;
      const avgCost = Number(row.average_unit_cost) || 0;
      const stockValue = Number(row.stock_value ?? qty * avgCost) || 0;
      const currency = row.cost_currency || baseCurrency;
      const rate = rateToBase.get(currency);
      const hasRate = rate !== undefined;
      if (!hasRate) unconvertedCount++;
      // Fall back to a 1:1 rate (flagged via unconvertedCount) rather than dropping the
      // item's value from the total silently.
      const stockValueBase = stockValue * (hasRate ? rate : 1);
      const status = stockStatus(row);

      totalStockValue += stockValueBase;
      if (status === 'Low Stock') lowStockCount++;
      if (status === 'Out of Stock') outOfStockCount++;

      const category = row.item_category || 'general';
      const cat = categoryMap.get(category) || { item_category: category, item_count: 0, total_quantity: 0, total_value: 0 };
      cat.item_count += 1;
      cat.total_quantity += qty;
      cat.total_value += stockValueBase;
      categoryMap.set(category, cat);

      return {
        id: row.id,
        item_code: row.item_code,
        item_name: row.item_name,
        item_category: category,
        item_type: row.item_type,
        unit_of_measure: row.unit_of_measure,
        quantity_on_hand: qty,
        reserved_quantity: Number(row.reserved_quantity) || 0,
        available_quantity: Number(row.available_quantity) || 0,
        minimum_stock_level: Number(row.minimum_stock_level) || 0,
        maximum_stock_level: Number(row.maximum_stock_level) || 0,
        average_unit_cost: avgCost,
        current_unit_cost: Number(row.current_unit_cost) || 0,
        selling_price: Number(row.selling_price) || 0,
        cost_currency: currency,
        stock_value: stockValue,
        stock_value_base: stockValueBase,
        fx_rate_to_base: hasRate ? rate : null,
        last_received_date: row.last_received_date,
        status,
      };
    });

    const categoryBreakdown = Array.from(categoryMap.values())
      .sort((a, b) => b.total_value - a.total_value);

    res.json({
      baseCurrency,
      summary: {
        total_items: items.length,
        total_stock_value: totalStockValue,
        low_stock_count: lowStockCount,
        out_of_stock_count: outOfStockCount,
        unconverted_currency_count: unconvertedCount,
      },
      items,
      categoryBreakdown,
    });
  } catch (error) {
    console.error('Error building inventory report:', error);
    res.status(500).json({ error: 'Failed to build inventory report' });
  }
});

// ═══════════════════════════════════════════════════
// Inventory Reports — the dropdown-driven register reports below, same
// pattern as Revenue/Clinical Reports. GET / above (the original endpoint)
// stays as-is — its `items`/`categoryBreakdown` back the "Stock Analysis"
// and "Stock Analysis Grouped by Category" dropdown options directly.
//
// `inventory_transactions.branch_id` exists directly on the table (added
// via the generic branch-isolation backfill, not the original migration
// file) — branch scoping below filters it directly, no join needed.
// ═══════════════════════════════════════════════════

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

// ── GET /stock-movement-detail ───────────────────────────────────────────
// Row-level inventory_transactions. locationId/itemId optionally narrow to
// the "(By Storage Location)"/"(By Item)" dropdown variants.
router.get('/stock-movement-detail', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, 't', allBranches);
    const locationSql = req.query.locationId ? ' AND (t.from_location_id = :locationId OR t.to_location_id = :locationId)' : '';
    if (req.query.locationId) repl.locationId = req.query.locationId;
    const itemSql = req.query.itemId ? ' AND t.item_id = :itemId' : '';
    if (req.query.itemId) repl.itemId = req.query.itemId;

    const rows = await sequelize.query(
      `SELECT t.id, t.transaction_number AS "transactionNumber", t.transaction_type AS "transactionType",
              t.transaction_date AS "transactionDate", t.quantity_change AS "quantityChange",
              t.unit_cost AS "unitCost", t.total_cost AS "totalCost", t.cost_currency AS "costCurrency",
              i.item_name AS "itemName", i.item_code AS "itemCode",
              fl.location_name AS "fromLocation", tl.location_name AS "toLocation",
              b.name AS "branchName", t.notes, u.display_name AS "userName"
       FROM inventory_transactions t
       LEFT JOIN inventory_items i ON i.id = t.item_id
       LEFT JOIN stock_locations fl ON fl.id = t.from_location_id
       LEFT JOIN stock_locations tl ON tl.id = t.to_location_id
       LEFT JOIN branches b ON b.id = t.branch_id
       LEFT JOIN users u ON u.id::text = t.created_by
       WHERE t.clinic_id = :clinicId AND t.transaction_date BETWEEN :dateFrom AND :dateTo ${branchSql}${locationSql}${itemSql}
       ORDER BY t.transaction_date DESC, t.created_at DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    // unit_cost/total_cost are numeric columns — node-pg returns those as
    // strings, and the frontend's sortable "Value" column does a raw `<`
    // comparison with no numeric coercion, so without parseFloat here rows
    // sort lexicographically ("4000.00" before "500.00") instead of by value.
    res.json({
      period: { dateFrom, dateTo },
      rows: rows.map(r => ({ ...r, unitCost: parseFloat(r.unitCost) || 0, totalCost: parseFloat(r.totalCost) || 0 })),
    });
  } catch (err) {
    console.error('Inventory stock-movement-detail error:', err);
    res.status(500).json({ error: 'Failed to generate stock movement detail' });
  }
});

// ── GET /stock-movement-summary ──────────────────────────────────────────
// groupBy=branch|location — aggregated quantity/value moved.
router.get('/stock-movement-summary', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const groupBy = req.query.groupBy === 'location' ? 'location' : 'branch';
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, 't', allBranches);

    const rows = groupBy === 'branch'
      ? await sequelize.query(
          `SELECT COALESCE(b.name, 'Unassigned') AS "groupLabel",
                  COUNT(*) AS "transactionCount",
                  SUM(ABS(t.quantity_change)) AS "totalQuantity",
                  SUM(ABS(t.total_cost)) AS "totalValue"
           FROM inventory_transactions t
           LEFT JOIN branches b ON b.id = t.branch_id
           WHERE t.clinic_id = :clinicId AND t.transaction_date BETWEEN :dateFrom AND :dateTo ${branchSql}
           GROUP BY b.name ORDER BY "totalValue" DESC`,
          { replacements: repl, type: QueryTypes.SELECT }
        )
      : await sequelize.query(
          // A transfer transaction carries BOTH from_location_id and
          // to_location_id on one row (confirmed in inventory.js's
          // transaction-creation handler — no second row is written for the
          // destination); COALESCE(from, to) always resolved to the FROM
          // side whenever both were set, so the TO location's inbound
          // movement never appeared anywhere in this report. Splitting into
          // two legs via UNION ALL credits both sides of a transfer; a
          // non-transfer row (only one of the two set) still appears once.
          `SELECT COALESCE(sl.location_name, 'Unassigned') AS "groupLabel",
                  COUNT(*) AS "transactionCount",
                  SUM(ABS(t.quantity_change)) AS "totalQuantity",
                  SUM(ABS(t.total_cost)) AS "totalValue"
           FROM (
             SELECT from_location_id AS location_id, quantity_change, total_cost, branch_id, transaction_date, clinic_id
             FROM inventory_transactions WHERE from_location_id IS NOT NULL
             UNION ALL
             SELECT to_location_id AS location_id, quantity_change, total_cost, branch_id, transaction_date, clinic_id
             FROM inventory_transactions WHERE to_location_id IS NOT NULL
           ) t
           LEFT JOIN stock_locations sl ON sl.id = t.location_id
           WHERE t.clinic_id = :clinicId AND t.transaction_date BETWEEN :dateFrom AND :dateTo ${branchSql}
           GROUP BY sl.location_name ORDER BY "totalValue" DESC`,
          { replacements: repl, type: QueryTypes.SELECT }
        );

    res.json({
      period: { dateFrom, dateTo }, groupBy,
      rows: rows.map(r => ({ ...r, transactionCount: parseInt(r.transactionCount, 10) || 0, totalQuantity: parseInt(r.totalQuantity, 10) || 0, totalValue: parseFloat(r.totalValue) || 0 })),
    });
  } catch (err) {
    console.error('Inventory stock-movement-summary error:', err);
    res.status(500).json({ error: 'Failed to generate stock movement summary' });
  }
});

// ── GET /stock-card ───────────────────────────────────────────────────────
// A classic "bin card" / item ledger: every movement for one item (optionally
// narrowed to one storage location), in order, with who recorded it, what it
// was for, and the running stock balance immediately after each row. The
// balance is anchored to the item's current known-correct quantity_on_hand
// (or, when a location is given, that location's stock_by_location row) and
// walked backwards from there — robust regardless of any stock the item
// started with before its first ever logged transaction, and independent of
// the dateFrom/dateTo window, which only narrows what's *displayed*.
router.get('/stock-card', async (req, res) => {
  try {
    const itemId = req.query.itemId;
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    const locationId = req.query.locationId || null;
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = clinicIdFor(req);

    const items = await sequelize.query(
      `SELECT id, item_name, item_code, unit_of_measure, quantity_on_hand FROM inventory_items WHERE id = :itemId AND clinic_id = :clinicId`,
      { replacements: { itemId, clinicId }, type: QueryTypes.SELECT }
    );
    const item = items[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });

    let currentBalance = parseFloat(item.quantity_on_hand) || 0;
    let locationName = null;
    if (locationId) {
      const sbl = await sequelize.query(
        `SELECT sbl.quantity_on_hand, sl.location_name FROM stock_by_location sbl
         LEFT JOIN stock_locations sl ON sl.id = sbl.location_id
         WHERE sbl.item_id = :itemId AND sbl.location_id = :locationId`,
        { replacements: { itemId, locationId }, type: QueryTypes.SELECT }
      );
      currentBalance = parseFloat(sbl[0]?.quantity_on_hand) || 0;
      locationName = sbl[0]?.location_name || null;
    }

    const locationFilterSql = locationId
      ? ` AND (t.from_location_id = :locationId OR t.to_location_id = :locationId)`
      : '';

    // delta: this row's net effect on the balance being tracked (clinic-wide
    // or this one location) — mirrors exactly how routes/inventory.js's
    // POST /transactions (and utils/labConsumables.js) apply these same rows
    // live: a transfer nets to zero clinic-wide but debits/credits whichever
    // single location is in view; a receipt/positive adjustment only counts
    // clinic-wide; everything else (dispense/usage/waste/damage/
    // return_to_supplier/lab_test_consumption/negative adjustment) already
    // carries a negative quantity_change and applies as-is either way.
    const deltaSql = locationId
      ? `CASE
           WHEN t.transaction_type = 'transfer' AND t.to_location_id = :locationId THEN t.quantity_change
           WHEN t.transaction_type = 'transfer' AND t.from_location_id = :locationId THEN -t.quantity_change
           ELSE t.quantity_change
         END`
      : `CASE
           WHEN t.transaction_type IN ('receipt','adjustment') AND t.quantity_change > 0 THEN t.quantity_change
           WHEN t.transaction_type = 'transfer' THEN 0
           ELSE t.quantity_change
         END`;

    const rows = await sequelize.query(`
      WITH deltas AS (
        SELECT t.id, t.transaction_number, t.transaction_type, t.transaction_date, t.created_at,
               t.quantity_change, t.from_location_id, t.to_location_id, t.notes, t.created_by,
               ${deltaSql} AS delta
        FROM inventory_transactions t
        WHERE t.item_id = :itemId AND t.clinic_id = :clinicId ${locationFilterSql}
      ),
      balanced AS (
        SELECT d.*,
          COALESCE(SUM(d.delta) OVER (
            ORDER BY d.transaction_date DESC, d.created_at DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS cum_after
        FROM deltas d
      )
      SELECT b.*, (:currentBalance - b.cum_after) AS running_balance,
        fl.location_name AS from_location_name, tl.location_name AS to_location_name,
        u.display_name AS created_by_name
      FROM balanced b
      LEFT JOIN stock_locations fl ON fl.id = b.from_location_id
      LEFT JOIN stock_locations tl ON tl.id = b.to_location_id
      LEFT JOIN users u ON u.id::text = b.created_by
      WHERE b.transaction_date BETWEEN :dateFrom AND :dateTo
      ORDER BY b.transaction_date ASC, b.created_at ASC
    `, { replacements: { itemId, clinicId, locationId, currentBalance, dateFrom, dateTo }, type: QueryTypes.SELECT });

    res.json({
      item: { id: item.id, name: item.item_name, code: item.item_code, uom: item.unit_of_measure },
      location: locationId ? { id: locationId, name: locationName } : null,
      currentBalance,
      period: { dateFrom, dateTo },
      rows: rows.map(r => ({
        ...r,
        quantity_change: parseFloat(r.quantity_change) || 0,
        delta: parseFloat(r.delta) || 0,
        running_balance: parseFloat(r.running_balance) || 0,
      })),
    });
  } catch (err) {
    console.error('Inventory stock-card error:', err);
    res.status(500).json({ error: 'Failed to generate stock card' });
  }
});

// ── GET /fast-moving & /slow-moving ──────────────────────────────────────
// Ranked by total quantity moved out (dispense/usage) in the period.
// fast = top 20 (highest volume); slow = every active item, ascending
// (items that never moved at all sort first — that IS the slowest case).
function movingItemsQuery(direction) {
  return `
    SELECT i.id, i.item_code AS "itemCode", i.item_name AS "itemName", i.item_category AS "itemCategory",
           COALESCE(SUM(ABS(t.quantity_change)), 0) AS "totalMoved",
           COALESCE(COUNT(t.id), 0) AS "transactionCount"
    FROM inventory_items i
    LEFT JOIN inventory_transactions t
      ON t.item_id = i.id AND t.transaction_type IN ('dispense', 'usage')
      AND t.transaction_date BETWEEN :dateFrom AND :dateTo
    WHERE i.clinic_id = :clinicId AND i.is_active = true __BRANCH__
    GROUP BY i.id, i.item_code, i.item_name, i.item_category
    ORDER BY "totalMoved" ${direction === 'fast' ? 'DESC' : 'ASC'}
    ${direction === 'fast' ? 'LIMIT 20' : ''}
  `;
}

router.get('/fast-moving', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, 'i', allBranches);
    const rows = await sequelize.query(movingItemsQuery('fast').replace('__BRANCH__', branchSql), { replacements: repl, type: QueryTypes.SELECT });
    res.json({ period: { dateFrom, dateTo }, rows: rows.map(r => ({ ...r, totalMoved: parseInt(r.totalMoved, 10) || 0, transactionCount: parseInt(r.transactionCount, 10) || 0 })) });
  } catch (err) {
    console.error('Inventory fast-moving error:', err);
    res.status(500).json({ error: 'Failed to generate fast-moving items report' });
  }
});

router.get('/slow-moving', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, 'i', allBranches);
    const rows = await sequelize.query(movingItemsQuery('slow').replace('__BRANCH__', branchSql), { replacements: repl, type: QueryTypes.SELECT });
    res.json({ period: { dateFrom, dateTo }, rows: rows.map(r => ({ ...r, totalMoved: parseInt(r.totalMoved, 10) || 0, transactionCount: parseInt(r.transactionCount, 10) || 0 })) });
  } catch (err) {
    console.error('Inventory slow-moving error:', err);
    res.status(500).json({ error: 'Failed to generate slow-moving items report' });
  }
});

// ── GET /retired-batches ─────────────────────────────────────────────────
router.get('/retired-batches', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'bt', allBranches);

    const rows = await sequelize.query(
      `SELECT bt.id, bt.batch_number AS "batchNumber", bt.quantity_received AS "quantityReceived",
              bt.quantity_used AS "quantityUsed", bt.expiry_date AS "expiryDate", bt.receipt_date AS "receiptDate",
              i.item_name AS "itemName", i.item_code AS "itemCode",
              b.name AS "branchName"
       FROM inventory_batches bt
       LEFT JOIN inventory_items i ON i.id = bt.item_id
       LEFT JOIN branches b ON b.id = bt.branch_id
       WHERE bt.clinic_id = :clinicId AND bt.status = 'retired' ${branchSql}
       ORDER BY bt.updated_at DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ rows });
  } catch (err) {
    console.error('Inventory retired-batches error:', err);
    res.status(500).json({ error: 'Failed to generate retired batches report' });
  }
});

// ── GET /near-expiry & /stock-expiry ─────────────────────────────────────
// near-expiry: not yet expired, expiring within `days` (default 90).
// stock-expiry: already past expiry_date (or flagged is_expired).
router.get('/near-expiry', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const days = parseInt(req.query.days, 10) || 90;
    const repl = { clinicId, days };
    const branchSql = branchScope(req, repl, 'bt', allBranches);

    const rows = await sequelize.query(
      `SELECT bt.id, bt.batch_number AS "batchNumber", bt.quantity_received AS "quantityReceived",
              bt.quantity_used AS "quantityUsed", (bt.quantity_received - bt.quantity_used) AS "quantityRemaining",
              bt.expiry_date AS "expiryDate", (bt.expiry_date - CURRENT_DATE) AS "daysToExpiry",
              i.item_name AS "itemName", i.item_code AS "itemCode",
              b.name AS "branchName"
       FROM inventory_batches bt
       LEFT JOIN inventory_items i ON i.id = bt.item_id
       LEFT JOIN branches b ON b.id = bt.branch_id
       WHERE bt.clinic_id = :clinicId AND bt.status IN ('active', 'partial_use')
         AND bt.is_expired IS NOT TRUE AND bt.expiry_date IS NOT NULL
         AND bt.expiry_date >= CURRENT_DATE AND bt.expiry_date <= CURRENT_DATE + (:days || ' days')::interval
         ${branchSql}
       ORDER BY bt.expiry_date ASC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ days, rows });
  } catch (err) {
    console.error('Inventory near-expiry error:', err);
    res.status(500).json({ error: 'Failed to generate near-expiry report' });
  }
});

router.get('/stock-expiry', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'bt', allBranches);

    const rows = await sequelize.query(
      `SELECT bt.id, bt.batch_number AS "batchNumber", bt.quantity_received AS "quantityReceived",
              bt.quantity_used AS "quantityUsed", (bt.quantity_received - bt.quantity_used) AS "quantityRemaining",
              bt.expiry_date AS "expiryDate",
              i.item_name AS "itemName", i.item_code AS "itemCode",
              b.name AS "branchName"
       FROM inventory_batches bt
       LEFT JOIN inventory_items i ON i.id = bt.item_id
       LEFT JOIN branches b ON b.id = bt.branch_id
       WHERE bt.clinic_id = :clinicId AND (bt.is_expired = true OR bt.expiry_date < CURRENT_DATE) ${branchSql}
       ORDER BY bt.expiry_date DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ rows });
  } catch (err) {
    console.error('Inventory stock-expiry error:', err);
    res.status(500).json({ error: 'Failed to generate stock expiry report' });
  }
});

// ── GET /stock-valuation-by-location ─────────────────────────────────────
// Stock Valuation (All) reuses GET / 's `items` directly (same weighted-
// average logic) — this is only the (By Storage Location) breakdown.
router.get('/stock-valuation-by-location', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'i', allBranches);

    const rows = await sequelize.query(
      `SELECT sl.id AS "locationId", sl.location_name AS "locationName",
              i.item_name AS "itemName", i.item_code AS "itemCode",
              sbl.quantity_on_hand AS "quantityOnHand", i.average_unit_cost AS "averageUnitCost",
              (sbl.quantity_on_hand * i.average_unit_cost) AS "stockValue", i.cost_currency AS "costCurrency",
              b.name AS "branchName"
       FROM stock_by_location sbl
       JOIN inventory_items i ON i.id = sbl.item_id
       LEFT JOIN stock_locations sl ON sl.id = sbl.location_id
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE i.clinic_id = :clinicId AND sbl.quantity_on_hand > 0 ${branchSql}
       ORDER BY "stockValue" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ rows: rows.map(r => ({ ...r, quantityOnHand: parseInt(r.quantityOnHand, 10) || 0, stockValue: parseFloat(r.stockValue) || 0 })) });
  } catch (err) {
    console.error('Inventory stock-valuation-by-location error:', err);
    res.status(500).json({ error: 'Failed to generate stock valuation by location' });
  }
});

// ── GET /out-of-stock ─────────────────────────────────────────────────────
router.get('/out-of-stock', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'i', allBranches);

    const rows = await sequelize.query(
      `SELECT i.id, i.item_code AS "itemCode", i.item_name AS "itemName", i.item_category AS "itemCategory",
              i.minimum_stock_level AS "minimumStockLevel", b.name AS "branchName"
       FROM inventory_items i
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE i.clinic_id = :clinicId AND i.is_active = true AND i.quantity_on_hand = 0 ${branchSql}
       ORDER BY i.item_name ASC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ rows });
  } catch (err) {
    console.error('Inventory out-of-stock error:', err);
    res.status(500).json({ error: 'Failed to generate out-of-stock report' });
  }
});

// ── GET /below-reorder-level ─────────────────────────────────────────────
// This app's reorder trigger is `minimum_stock_level` — there is no column
// literally named "reorder_level" (confirmed against the real schema).
router.get('/below-reorder-level', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'i', allBranches);

    const rows = await sequelize.query(
      `SELECT i.id, i.item_code AS "itemCode", i.item_name AS "itemName", i.item_category AS "itemCategory",
              i.quantity_on_hand AS "quantityOnHand", i.minimum_stock_level AS "minimumStockLevel",
              i.reorder_quantity AS "reorderQuantity", b.name AS "branchName"
       FROM inventory_items i
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE i.clinic_id = :clinicId AND i.is_active = true
         AND i.minimum_stock_level > 0 AND i.quantity_on_hand <= i.minimum_stock_level ${branchSql}
       ORDER BY (i.quantity_on_hand - i.minimum_stock_level) ASC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({ rows: rows.map(r => ({ ...r, quantityOnHand: parseInt(r.quantityOnHand, 10) || 0, minimumStockLevel: parseInt(r.minimumStockLevel, 10) || 0 })) });
  } catch (err) {
    console.error('Inventory below-reorder-level error:', err);
    res.status(500).json({ error: 'Failed to generate below-reorder-level report' });
  }
});

// ── GET /material-consumption ────────────────────────────────────────────
// "Not Committed" = stock actually deducted (dispense/usage/waste/damage
// transactions — the same 4 types inventory.js's own COGS monthly summary
// and Usage History report use for "stock actually deducted", and the only
// 4 types the transaction-creation handler deducts quantity_on_hand for)
// — real data. "Committed" (reserved but not yet deducted)
// has no live data behind it: `inventory_items.reserved_quantity` and the
// whole `inventory_reservations` table exist in schema but are never
// written to anywhere in this codebase (confirmed) — the frontend shows a
// message for that variant instead of calling this endpoint.
router.get('/material-consumption', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const repl = { clinicId, dateFrom, dateTo };
    const branchSql = branchScope(req, repl, 't', allBranches);

    const rows = await sequelize.query(
      `SELECT i.item_name AS "itemName", i.item_code AS "itemCode", i.item_category AS "itemCategory",
              SUM(ABS(t.quantity_change)) AS "quantityConsumed", SUM(ABS(t.total_cost)) AS "totalValue",
              COUNT(*) AS "transactionCount"
       FROM inventory_transactions t
       JOIN inventory_items i ON i.id = t.item_id
       WHERE t.clinic_id = :clinicId AND t.transaction_type IN ('dispense', 'usage', 'waste', 'damage')
         AND t.transaction_date BETWEEN :dateFrom AND :dateTo ${branchSql}
       GROUP BY i.item_name, i.item_code, i.item_category
       ORDER BY "totalValue" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    res.json({
      period: { dateFrom, dateTo },
      rows: rows.map(r => ({ ...r, quantityConsumed: parseInt(r.quantityConsumed, 10) || 0, totalValue: parseFloat(r.totalValue) || 0, transactionCount: parseInt(r.transactionCount, 10) || 0 })),
    });
  } catch (err) {
    console.error('Inventory material-consumption error:', err);
    res.status(500).json({ error: 'Failed to generate material consumption report' });
  }
});

// ── GET /lab-test-consumables ────────────────────────────────────────────
// Current-state snapshot of every test<->reagent/kit link: the yield, the
// stock it's drawing from, how many tests that stock can still cover, and
// whether the test is currently available to bill — plus, if dateFrom/dateTo
// are given, how many tests were actually performed (and how much was
// consumed) against that link in the window, from the
// lab_test_consumption inventory_transactions rows the deduction hook writes.
router.get('/lab-test-consumables', async (req, res) => {
  try {
    const allBranches = boolParam(req.query.allBranches);
    const clinicId = clinicIdFor(req);
    const dateFrom = asDateStr(req.query.dateFrom);
    const dateTo = asDateStr(req.query.dateTo);
    const repl = { clinicId };
    const branchSql = branchScope(req, repl, 'ii', allBranches);

    const rows = await sequelize.query(
      `SELECT
         ltc.id,
         lt.test_name AS "testName", lt.test_code AS "testCode",
         ii.item_code AS "itemCode", ii.item_name AS "itemName", ii.unit_of_measure AS "unitOfMeasure",
         sl.location_name AS "locationName",
         ii.quantity_on_hand AS "quantityOnHand",
         ltc.tests_per_unit AS "testsPerUnit",
         FLOOR(ii.quantity_on_hand * ltc.tests_per_unit) AS "testsRemaining",
         ltc.is_active AS "isActive",
         b.name AS "branchName"
       FROM lab_test_consumables ltc
       JOIN lab_tests lt ON lt.id = ltc.lab_test_id
       JOIN inventory_items ii ON ii.id = ltc.inventory_item_id
       LEFT JOIN stock_locations sl ON sl.id = ltc.location_id
       LEFT JOIN branches b ON b.id = ii.branch_id
       WHERE ltc.clinic_id = :clinicId ${branchSql}
       ORDER BY lt.test_name ASC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const byLink = new Map();
    if (dateFrom && dateTo) {
      const usageRepl = { clinicId, dateFrom, dateTo: `${dateTo} 23:59:59` };
      const usage = await sequelize.query(
        `SELECT lab_test_consumable_id AS "linkId",
                COUNT(*) AS "testsPerformed",
                SUM(ABS(quantity_change)) AS "quantityConsumed"
         FROM inventory_transactions
         WHERE clinic_id = :clinicId AND transaction_type = 'lab_test_consumption'
           AND lab_test_consumable_id IS NOT NULL
           AND created_at BETWEEN :dateFrom AND :dateTo
         GROUP BY lab_test_consumable_id`,
        { replacements: usageRepl, type: QueryTypes.SELECT }
      );
      for (const u of usage) byLink.set(u.linkId, u);
    }

    res.json({
      period: dateFrom && dateTo ? { dateFrom, dateTo } : null,
      rows: rows.map(r => {
        const usage = byLink.get(r.id);
        const quantityOnHand = parseFloat(r.quantityOnHand) || 0;
        const testsRemaining = parseInt(r.testsRemaining, 10) || 0;
        return {
          ...r,
          quantityOnHand,
          testsPerUnit: parseFloat(r.testsPerUnit) || 0,
          testsRemaining,
          status: !r.isActive ? 'Inactive' : testsRemaining < 1 ? 'Unavailable' : 'Available',
          testsPerformed: dateFrom && dateTo ? parseInt(usage?.testsPerformed, 10) || 0 : null,
          quantityConsumed: dateFrom && dateTo ? parseFloat(usage?.quantityConsumed) || 0 : null,
        };
      }),
    });
  } catch (err) {
    console.error('Inventory lab-test-consumables error:', err);
    res.status(500).json({ error: 'Failed to generate lab test consumables report' });
  }
});

module.exports = router;
