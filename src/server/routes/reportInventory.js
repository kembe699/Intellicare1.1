const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { getBranchConditionSQL } = require('../middleware/branchFilter');

// ═══════════════════════════════════════════════════
// INVENTORY REPORT — current-state stock listing + valuation
// Plain MySQL-native SQL only (no Postgres syntax).
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

module.exports = router;
