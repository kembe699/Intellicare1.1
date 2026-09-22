const express = require('express');
const router = express.Router();
const { sequelize, AccountLedger } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');
const redisCache = require('../services/RedisCache');
const { getAdjustmentMultiplier } = require('../utils/priceAdjustment');
const { authorize } = require('../middleware/authorize');
const BranchQueryFilter = require('../services/BranchQueryFilter');

// Mirrors the allowedRoles already enforced client-side per /inventory/* page in
// App.tsx — that was only ever a UI-hiding mechanism; every route below was reachable
// by any authenticated user via a direct API call regardless of role, since `authorize`
// was imported but only ever used on one route (DELETE /items/clear-all) in this file.
// Approving/rejecting a stock adjustment posts directly to the GL — kept narrower than
// general write access, matching how financial approvals are gated elsewhere in the app.

// Startup: ensure indexes + branch_id column exist.
// Each statement gets its own try/catch — this MySQL version doesn't support
// "CREATE INDEX ... IF NOT EXISTS" (throws once the index already exists from a prior
// run), and a shared try block would let that abort everything after it, including the
// branch_id backfill below, silently (caught by an empty catch further down).
(async () => {
  const { sequelize: sq } = require('../models');
  try { await sq.query('ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS branch_id INTEGER NULL'); } catch(e) { /* ignore */ }
  try { await sq.query('CREATE INDEX IF NOT EXISTS idx_inv_items_branch   ON inventory_items(branch_id)'); } catch(e) { /* ignore */ }
  try { await sq.query('CREATE INDEX IF NOT EXISTS idx_inv_items_clinic   ON inventory_items(clinic_id)'); } catch(e) { /* ignore */ }
  try { await sq.query('CREATE INDEX IF NOT EXISTS idx_inv_items_active   ON inventory_items(is_active)'); } catch(e) { /* ignore */ }
  try { await sq.query('CREATE INDEX IF NOT EXISTS idx_inv_items_name     ON inventory_items(item_name)'); } catch(e) { /* ignore */ }
  try { await sq.query('CREATE INDEX IF NOT EXISTS idx_inv_batches_item   ON inventory_batches(item_id, status)'); } catch(e) { /* ignore */ }

  // One-time backfill for the default/demo database — see utils/inventoryMaintenance.js
  // for the full explanation and the per-tenant equivalent (tenantDb.js runs the same
  // repair for every other tenant's own database, since this boot IIFE only ever
  // touches this one static connection).
  const { backfillInventoryBranchIds } = require('../utils/inventoryMaintenance');
  await backfillInventoryBranchIds(sq, 'default');
})();

// Bust all inventory cache entries for a user/branch after any mutation
function bustInventoryCache(req) {
  try { redisCache.delPattern('|inventory'); } catch(e) { /* ignore */ }
}

// ═══════════════════════════════════════════════════
// INVENTORY ITEMS - CRUD
// ═══════════════════════════════════════════════════

// List all inventory items
router.get('/items', authorize('inventory.read'), async (req, res) => {
  try {
    const { category, item_type, is_active, search, low_stock, expiring_soon } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['i.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (category) { conditions.push('i.item_category = :category'); replacements.category = category; }
    if (item_type) { conditions.push('i.item_type = :item_type'); replacements.item_type = item_type; }
    if (is_active !== undefined) { conditions.push('i.is_active = :is_active'); replacements.is_active = is_active === 'true'; }
    if (search) { conditions.push('(i.item_name LIKE :search OR i.item_code LIKE :search OR i.barcode LIKE :search OR i.item_description LIKE :search)'); replacements.search = `%${search}%`; }
    if (low_stock === 'true') { conditions.push('i.quantity_on_hand <= i.minimum_stock_level AND i.minimum_stock_level > 0'); }

    // Restrict to what is actually held at one store location.
    //
    // The quantity shown then has to come from that location too, not from the
    // item's catalogue-wide quantity_on_hand — otherwise a store showing 3 boxes
    // would display the 300 held across the whole clinic, which is worse than
    // showing nothing.
    const locationId = req.query.location_id;
    if (locationId) {
      conditions.push(`EXISTS (SELECT 1 FROM stock_by_location sbl0
                                WHERE sbl0.item_id = i.id AND sbl0.location_id = :location_id)`);
      replacements.location_id = locationId;
    }

    // Branch isolation: non-admin users only see their own branch's items
    const { sql: branchSQL, params: branchParams } = getBranchConditionSQL(req, 'i');
    if (branchSQL && branchParams && branchParams.length > 0) {
      conditions.push('i.branch_id = :branchId');
      replacements.branchId = branchParams[0];
    } else if (req.user && req.user.role !== 'admin' && req.user.branchId) {
      // Fallback: if getBranchConditionSQL doesn't return proper filter, apply manually
      conditions.push('i.branch_id = :branchId');
      replacements.branchId = req.user.branchId;
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const [items] = await sequelize.query(`
      SELECT i.*,
        NULL AS preferred_supplier_name,
        ${locationId ? `
        -- Quantities for the selected location, overriding the catalogue-wide
        -- figures so every number on the page refers to the same shelf.
        COALESCE(loc.quantity_on_hand, 0) AS quantity_on_hand,
        COALESCE(loc.reserved_quantity, 0) AS reserved_quantity,
        (COALESCE(loc.quantity_on_hand, 0) - COALESCE(loc.reserved_quantity, 0)) AS available_quantity,
        loc.location_id AS location_id,` : `
        (i.quantity_on_hand - i.reserved_quantity) AS available_quantity,`}
        COALESCE(ba.active_batches, 0)  AS active_batches,
        ba.nearest_expiry               AS nearest_expiry
      FROM inventory_items i
      LEFT JOIN (
        SELECT item_id,
               SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)                        AS active_batches,
               MIN(CASE WHEN status = 'active' AND expiry_date IS NOT NULL THEN expiry_date END) AS nearest_expiry
        FROM inventory_batches
        GROUP BY item_id
      ) ba ON ba.item_id = i.id
      ${locationId ? `
      LEFT JOIN stock_by_location loc ON loc.item_id = i.id AND loc.location_id = :location_id` : ''}
      ${where}
      ORDER BY i.item_name ASC
    `, { replacements });

    res.json(items);
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    res.status(500).json({ error: 'Failed to fetch inventory items' });
  }
});

// Get single item with details
router.get('/items/:id', authorize('inventory.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [items] = await sequelize.query(`
      SELECT i.*,
        NULL AS preferred_supplier_name,
        (i.quantity_on_hand - i.reserved_quantity) AS available_quantity
      FROM inventory_items i
      WHERE i.id = :id AND i.clinic_id = :clinicId
    `, { replacements: { id: req.params.id, clinicId } });

    if (items.length === 0) return res.status(404).json({ error: 'Item not found' });

    const item = items[0];
    if (!BranchQueryFilter.canAccessRecord(item, req.branchContext)) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Get batches
    try {
      const [batches] = await sequelize.query(`
        SELECT * FROM inventory_batches WHERE item_id = :id AND status IN ('active','partial_use') ORDER BY expiry_date ASC
      `, { replacements: { id: req.params.id } });
      item.batches = batches;
      // Same definition the /items list endpoint uses (status = 'active' only,
      // batches already sorted by expiry_date ASC above) — this endpoint was
      // missing the field entirely, so a page that opened an item via its
      // detail view (which re-fetches from here) rather than straight off a
      // list row silently lost the item's nearest expiry.
      item.nearest_expiry = batches.find(b => b.status === 'active' && b.expiry_date)?.expiry_date || null;
    } catch (e) { item.batches = []; item.nearest_expiry = null; }

    // Get recent transactions
    try {
      const [transactions] = await sequelize.query(`
        SELECT t.*, sl1.location_name AS from_location_name, sl2.location_name AS to_location_name
        FROM inventory_transactions t
        LEFT JOIN stock_locations sl1 ON t.from_location_id = sl1.id
        LEFT JOIN stock_locations sl2 ON t.to_location_id = sl2.id
        WHERE t.item_id = :id ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT 20
      `, { replacements: { id: req.params.id } });
      item.recent_transactions = transactions;
    } catch (e) { item.recent_transactions = []; }

    // Get stock by location
    try {
      const [stockByLocation] = await sequelize.query(`
        SELECT sbl.*, sl.location_name, sl.location_code, sl.location_type
        FROM stock_by_location sbl
        JOIN stock_locations sl ON sbl.location_id = sl.id
        WHERE sbl.item_id = :id
      `, { replacements: { id: req.params.id } });
      item.stock_by_location = stockByLocation;
    } catch (e) { item.stock_by_location = []; }

    // Get pricing history
    try {
      const [pricing] = await sequelize.query(`
        SELECT ph.*
        FROM item_pricing_history ph
        WHERE ph.item_id = :id ORDER BY ph.effective_from DESC LIMIT 10
      `, { replacements: { id: req.params.id } });
      item.pricing_history = pricing;
    } catch (e) { item.pricing_history = []; }

    res.json(item);
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ error: 'Failed to fetch item details' });
  }
});

// Create inventory item
router.post('/items', authorize('inventory.write'), async (req, res) => {
  try {
    const id = uuidv4();
    const {
      item_code, barcode, item_name, item_description, item_category, item_type,
      unit_of_measure, reorder_unit, conversion_factor,
      minimum_stock_level, maximum_stock_level, reorder_quantity, lead_time_days,
      inventory_valuation_method, current_unit_cost, selling_price, cost_currency,
      inventory_account_id, cogs_account_id, usage_account_id,
      requires_batch_tracking, requires_expiry_tracking, requires_serial_number,
      is_controlled_substance, notes, preferred_supplier_id, created_by
    } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    if (!item_code || !item_name) return res.status(400).json({ error: 'item_code and item_name are required' });

    await sequelize.query(`
      INSERT INTO inventory_items (id, clinic_id, branch_id, item_code, barcode, item_name, item_description, item_category, item_type,
        unit_of_measure, reorder_unit, conversion_factor,
        minimum_stock_level, maximum_stock_level, reorder_quantity, lead_time_days,
        inventory_valuation_method, current_unit_cost, average_unit_cost, selling_price, cost_currency,
        inventory_account_id, cogs_account_id, usage_account_id,
        requires_batch_tracking, requires_expiry_tracking, requires_serial_number,
        is_controlled_substance, notes, preferred_supplier_id, created_by)
      VALUES (:id, :clinic_id, :branch_id, :item_code, :barcode, :item_name, :item_description, :item_category, :item_type,
        :unit_of_measure, :reorder_unit, :conversion_factor,
        :minimum_stock_level, :maximum_stock_level, :reorder_quantity, :lead_time_days,
        :inventory_valuation_method, :current_unit_cost, :current_unit_cost, :selling_price, :cost_currency,
        :inventory_account_id, :cogs_account_id, :usage_account_id,
        :requires_batch_tracking, :requires_expiry_tracking, :requires_serial_number,
        :is_controlled_substance, :notes, :preferred_supplier_id, :created_by)
    `, {
      replacements: {
        id, clinic_id, branch_id: getCreateBranchId(req), item_code,
        barcode: barcode || null, item_name,
        item_description: item_description || null,
        item_category: item_category || 'general', item_type: item_type || 'consumable',
        unit_of_measure: unit_of_measure || 'Each', reorder_unit: reorder_unit || unit_of_measure || 'Each',
        conversion_factor: conversion_factor || 1,
        minimum_stock_level: minimum_stock_level || 0, maximum_stock_level: maximum_stock_level || 0,
        reorder_quantity: reorder_quantity || 0, lead_time_days: lead_time_days || 7,
        inventory_valuation_method: inventory_valuation_method || 'weighted_average',
        current_unit_cost: current_unit_cost || 0, selling_price: selling_price || 0,
        cost_currency: cost_currency || 'SSP',
        inventory_account_id: inventory_account_id || null, cogs_account_id: cogs_account_id || null,
        usage_account_id: usage_account_id || null,
        requires_batch_tracking: !!requires_batch_tracking,
        requires_expiry_tracking: !!requires_expiry_tracking,
        requires_serial_number: !!requires_serial_number,
        is_controlled_substance: !!is_controlled_substance,
        notes: notes || null, preferred_supplier_id: preferred_supplier_id || null,
        created_by: created_by || null
      }
    });

    if (req.body.location_id) {
      await sequelize.query(`
        INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand)
        VALUES (:sbl_id, :clinic_id, :item_id, :location_id, 0)
      `, { replacements: { sbl_id: uuidv4(), clinic_id, item_id: id, location_id: req.body.location_id } });
    }

    bustInventoryCache(req);
    res.status(201).json({ id, item_code, item_name, message: 'Item created' });
  } catch (error) {
    console.error('Error creating item:', error);
    if (error.message?.includes('Duplicate')) {
      return res.status(409).json({ error: 'Item code already exists for this clinic' });
    }
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// Bulk upload items from CSV
// A plain `line.split(',')` breaks on any quoted field containing a comma (e.g. an
// item_description like "Pain relief, fever reducer") — every column after it shifts
// by one and silently corrupts the row instead of erroring. This respects RFC 4180
// quoting: "..." fields, with "" as an escaped quote inside one.
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

router.post('/items/bulk-upload', authorize('inventory.write'), async (req, res) => {
  try {
    // Get CSV data from request body
    let csvData = req.body.csvData;
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    console.log('=== BULK UPLOAD DEBUG ===');
    console.log('CSV Data length:', csvData?.length);
    console.log('Clinic ID:', clinicId);

    if (!csvData) {
      return res.status(400).json({ error: 'No CSV data provided' });
    }

    const lines = csvData.split('\n').filter(line => line.trim());
    console.log('Total lines:', lines.length);
    console.log('First line (headers):', lines[0]);

    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV file is empty or invalid' });
    }

    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    console.log('Parsed headers:', headers);
    const rows = lines.slice(1);
    console.log('Data rows count:', rows.length);

    let created = 0;
    let skipped = 0;
    let errors = [];
    const branchId = getCreateBranchId(req);
    console.log('Bulk upload - Branch ID:', branchId, 'User:', req.user?.email, 'Role:', req.user?.role);

    if (!branchId && req.user?.role !== 'admin') {
      return res.status(400).json({ error: 'Branch ID is required for non-admin users' });
    }

    for (let i = 0; i < rows.length; i++) {
      // Each row's item + initial batch are inserted atomically — a failure partway
      // through (e.g. the batch insert) used to leave an orphaned item row behind with
      // "created" not counting it, so a re-run of the same file hit a duplicate
      // item_code and every retry attempt failed until someone found and deleted the
      // orphan by hand.
      const rowTransaction = await sequelize.transaction();
      try {
        const values = parseCsvLine(rows[i]).map(v => v.trim());
        const row = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });

        console.log(`Row ${i + 1} parsed:`, JSON.stringify(row));

        // Skip empty rows
        if (!row.item_code || !row.item_name) {
          console.log(`Row ${i + 1} skipped - missing item_code or item_name`);
          await rowTransaction.rollback();
          skipped++;
          continue;
        }

        const id = uuidv4();
        const initialQty = parseInt(row.initial_quantity) || 0;

        await sequelize.query(`
          INSERT INTO inventory_items (
            id, clinic_id, branch_id, item_code, item_name, item_description, 
            item_category, item_type, unit_of_measure, minimum_stock_level, 
            maximum_stock_level, reorder_quantity, lead_time_days, 
            inventory_valuation_method, current_unit_cost, average_unit_cost, 
            selling_price, cost_currency, requires_batch_tracking, 
            requires_expiry_tracking, is_controlled_substance, notes, is_active,
            quantity_on_hand
          ) VALUES (
            :id, :clinic_id, :branch_id, :item_code, :item_name, :item_description,
            :item_category, :item_type, :unit_of_measure, :minimum_stock_level,
            :maximum_stock_level, :reorder_quantity, :lead_time_days,
            :inventory_valuation_method, :current_unit_cost, :current_unit_cost,
            :selling_price, :cost_currency, :requires_batch_tracking,
            :requires_expiry_tracking, :is_controlled_substance, :notes, true,
            :quantity_on_hand
          )
        `, {
          replacements: {
            id,
            clinic_id: clinicId,
            branch_id: branchId,
            item_code: row.item_code,
            item_name: row.item_name,
            item_description: row.item_description || null,
            item_category: row.item_category || 'general',
            item_type: row.item_type || 'consumable',
            unit_of_measure: row.unit_of_measure || 'Each',
            minimum_stock_level: parseInt(row.minimum_stock_level) || 0,
            maximum_stock_level: parseInt(row.maximum_stock_level) || 0,
            reorder_quantity: parseInt(row.reorder_quantity) || 0,
            lead_time_days: parseInt(row.lead_time_days) || 7,
            inventory_valuation_method: row.inventory_valuation_method || 'weighted_average',
            current_unit_cost: parseFloat(row.current_unit_cost) || 0,
            selling_price: parseFloat(row.selling_price) || 0,
            cost_currency: row.cost_currency || 'SSP',
            requires_batch_tracking: row.requires_batch_tracking === 'true',
            requires_expiry_tracking: row.requires_expiry_tracking === 'true',
            is_controlled_substance: row.is_controlled_substance === 'true',
            notes: row.notes || null,
            quantity_on_hand: initialQty
          },
          transaction: rowTransaction
        });

        // If initial_quantity is provided, create initial batch for tracking
        if (initialQty > 0) {
          const batchId = uuidv4();
          const unitCost = parseFloat(row.current_unit_cost) || 0;

          const expiryDate = row.expiry_date && row.expiry_date.trim() ? row.expiry_date.trim() : null;

          await sequelize.query(`
            INSERT INTO inventory_batches (
              id, item_id, batch_number, quantity_received, quantity_used,
              unit_cost, receipt_date, expiry_date, status, clinic_id, branch_id
            ) VALUES (
              :id, :item_id, :batch_number, :qty, 0, :unit_cost, NOW(), :expiry_date, 'active', :clinic_id, :branch_id
            )
          `, {
            replacements: {
              id: batchId,
              item_id: id,
              batch_number: `INIT-${row.item_code}`,
              qty: initialQty,
              unit_cost: unitCost,
              expiry_date: expiryDate,
              clinic_id: clinicId,
              branch_id: branchId
            },
            transaction: rowTransaction
          });
        }

        await rowTransaction.commit();

        console.log(`Row ${i + 1} successfully created with ID: ${id}`);
        created++;
      } catch (rowError) {
        try { await rowTransaction.rollback(); } catch (e) { /* already rolled back / committed */ }
        console.error(`Error processing row ${i + 2}:`, rowError);
        errors.push(`Row ${i + 2}: ${rowError.message}`);
      }
    }

    console.log('=== UPLOAD SUMMARY ===');
    console.log('Created:', created);
    console.log('Skipped:', skipped);
    console.log('Errors:', errors.length);

    bustInventoryCache(req);
    
    res.json({
      message: 'Bulk upload completed',
      created,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
      total: rows.length
    });
  } catch (error) {
    console.error('Error in bulk upload:', error);
    res.status(500).json({ error: 'Failed to process bulk upload', details: error.message });
  }
});

// Bulk price adjustment — raises or lowers selling_price by a percentage across every
// matching item in one action, instead of editing items one at a time. Only
// selling_price moves; current_unit_cost is left alone since it's meant to reflect
// actual purchase cost, not a markup decision. Scoped to the clinic (and optionally a
// category/type) so this can't silently touch another clinic's catalog.
router.post('/items/bulk-price-adjustment', authorize('inventory.write'), async (req, res) => {
  try {
    const { mode, percentage, direction, new_rate, category, item_type, clinic_id } = req.body;

    let multiplier, currentRate, newRate;
    try {
      ({ multiplier, currentRate, newRate } = await getAdjustmentMultiplier({ sequelize, mode, percentage, direction, new_rate }));
    } catch (e) {
      if (e.isValidation) return res.status(400).json({ error: e.message });
      throw e;
    }

    const clinicId = parseInt(clinic_id) || req.user?.clinicId || 1;

    const conditions = ['clinic_id = :clinicId', 'is_active = true'];
    const replacements = { clinicId, multiplier };
    if (category) { conditions.push('item_category = :category'); replacements.category = category; }
    if (item_type) { conditions.push('item_type = :item_type'); replacements.item_type = item_type; }

    const isAdmin = req.user?.role === 'admin';
    const branchId = req.branchContext?.branchId || req.user?.branchId || null;
    if (!isAdmin && branchId) { conditions.push('branch_id = :branchId'); replacements.branchId = branchId; }

    const where = conditions.join(' AND ');

    const [[before]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt, COALESCE(AVG(selling_price), 0) AS avg_price FROM inventory_items WHERE ${where} AND selling_price > 0`,
      { replacements }
    );
    const affectedCount = parseInt(before.cnt, 10) || 0;
    if (affectedCount === 0) {
      return res.status(404).json({ error: 'No matching priced items found for this filter' });
    }

    // Never let a large decrease push a price below zero.
    await sequelize.query(
      `UPDATE inventory_items SET selling_price = GREATEST(0, ROUND(selling_price * :multiplier, 2)) WHERE ${where} AND selling_price > 0`,
      { replacements }
    );

    bustInventoryCache(req);

    const description = mode === 'rate'
      ? `Selling price rebased from USD/SSP rate ${currentRate} to ${newRate} on ${affectedCount} item(s)${category ? ` (category: ${category})` : ''}${item_type ? ` (type: ${item_type})` : ''}`
      : `Selling price ${direction}d by ${percentage}% on ${affectedCount} item(s)${category ? ` (category: ${category})` : ''}${item_type ? ` (type: ${item_type})` : ''}`;

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Inventory', action: 'BULK_PRICE_ADJUSTMENT', entity_type: 'InventoryItem', entity_id: null,
        description,
        old_values: { avg_price_before: parseFloat(before.avg_price) || 0 },
        new_values: { mode: mode || 'percentage', direction, percentage, currentRate, newRate, affected_count: affectedCount, category: category || null, item_type: item_type || null },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({
      message: `Adjusted selling price on ${affectedCount} item(s)`,
      affected_count: affectedCount,
      mode: mode || 'percentage',
      direction,
      percentage,
      currentRate,
      newRate,
    });
  } catch (error) {
    console.error('Error applying bulk price adjustment:', error);
    res.status(500).json({ error: 'Failed to apply bulk price adjustment' });
  }
});

// Update inventory item
router.put('/items/:id', authorize('inventory.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    const [existingItems] = await sequelize.query(
      `SELECT id, branch_id FROM inventory_items WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (existingItems.length === 0) return res.status(404).json({ error: 'Item not found' });
    if (!BranchQueryFilter.canAccessRecord(existingItems[0], req.branchContext)) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const fields = [];
    const replacements = { id: req.params.id, clinicId };
    const allowed = [
      'barcode', 'item_name', 'item_description', 'item_category', 'item_type', 'unit_of_measure',
      'reorder_unit', 'conversion_factor', 'minimum_stock_level', 'maximum_stock_level',
      'reorder_quantity', 'lead_time_days', 'inventory_valuation_method', 'current_unit_cost',
      'selling_price', 'cost_currency', 'inventory_account_id', 'cogs_account_id', 'usage_account_id',
      'requires_batch_tracking', 'requires_expiry_tracking', 'requires_serial_number',
      'is_controlled_substance', 'is_active', 'notes', 'preferred_supplier_id'
    ];

    const intFields = new Set([
      'minimum_stock_level', 'maximum_stock_level', 'reorder_quantity',
      'lead_time_days', 'conversion_factor', 'preferred_supplier_id'
    ]);
    const numericFields = new Set(['current_unit_cost', 'selling_price']);

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        let val = req.body[key];
        if (val === '' || val === null) {
          val = null;
        } else if (intFields.has(key)) {
          val = parseInt(val, 10);
          if (isNaN(val)) val = null;
        } else if (numericFields.has(key)) {
          val = parseFloat(val);
          if (isNaN(val)) val = null;
        }
        fields.push(`${key} = :${key}`);
        replacements[key] = val;
      }
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    const [, itemMeta] = await sequelize.query(`UPDATE inventory_items SET ${fields.join(', ')} WHERE id = :id AND clinic_id = :clinicId`, { replacements });
    if (itemMeta.rowCount === 0) return res.status(404).json({ error: 'Item not found' });

    if (req.body.location_id) {
      const [existing] = await sequelize.query(
        'SELECT id FROM stock_by_location WHERE item_id = :item_id AND location_id = :location_id',
        { replacements: { item_id: req.params.id, location_id: req.body.location_id } }
      );
      if (existing.length === 0) {
        await sequelize.query(`
          INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand)
          VALUES (:sbl_id, :clinic_id, :item_id, :location_id, 0)
        `, { replacements: { sbl_id: uuidv4(), clinic_id: clinicId, item_id: req.params.id, location_id: req.body.location_id } });
      }
    }

    bustInventoryCache(req);
    res.json({ message: 'Item updated' });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Delete all inventory items for a clinic
// Wipes an entire clinic's inventory catalog in one irreversible call — previously
// reachable by any authenticated user regardless of role, with no audit trail at all.
// Now admin-only, and the items being deleted are captured before the DELETE so the audit
// log entry is actually useful for investigation/recovery, not just "something happened".
router.delete('/items/clear-all', authorize(['admin']), async (req, res) => {
  try {
    const { clinic_id } = req.query;
    if (!clinic_id) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }

    const [itemsBeingDeleted] = await sequelize.query(
      'SELECT id, item_code, item_name, quantity_on_hand FROM inventory_items WHERE clinic_id = :clinic_id',
      { replacements: { clinic_id: parseInt(clinic_id) } }
    );

    await sequelize.query(
      'DELETE FROM inventory_items WHERE clinic_id = :clinic_id',
      { replacements: { clinic_id: parseInt(clinic_id) } }
    );

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: parseInt(clinic_id), user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Inventory', action: 'INVENTORY_CLEARED', entity_type: 'InventoryItem', entity_id: null,
        description: `Cleared all ${itemsBeingDeleted.length} inventory item(s) for clinic ${clinic_id}`,
        old_values: { items: itemsBeingDeleted },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    bustInventoryCache(req);
    res.json({
      message: 'All inventory items cleared successfully',
      // Read off the pre-delete SELECT above rather than the DELETE's own result:
      // `const [result] = await sequelize.query('DELETE ...')` destructures the
      // *rows* Sequelize returns (empty for a DELETE with no RETURNING), not the
      // metadata object that actually carries the row count — result.affectedRows
      // was reading a MySQL-only property off the wrong element entirely, so this
      // was always undefined and always reported 0 regardless of what was deleted.
      rowsDeleted: itemsBeingDeleted.length
    });
  } catch (error) {
    console.error('Error clearing inventory items:', error);
    res.status(500).json({ error: 'Failed to clear inventory items' });
  }
});

// Items below reorder level
router.get('/items-reorder-list', authorize('inventory.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { sql: branchSQL, params: branchParams } = getBranchConditionSQL(req, 'i');
    const [items] = await sequelize.query(`
      SELECT i.*, NULL AS preferred_supplier_name,
        (i.quantity_on_hand - i.reserved_quantity) AS available_quantity
      FROM inventory_items i
      WHERE i.quantity_on_hand <= i.minimum_stock_level
        AND i.minimum_stock_level > 0 AND i.is_active = true
        AND i.clinic_id = :clinic_id
        ${branchSQL ? 'AND i.branch_id = :branchId' : ''}
      ORDER BY (i.quantity_on_hand / GREATEST(i.minimum_stock_level, 1)) ASC
    `, { replacements: { clinic_id: clinicId, ...(branchSQL ? { branchId: branchParams[0] } : {}) } });
    res.json(items);
  } catch (error) {
    console.error('Error fetching reorder list:', error);
    res.status(500).json({ error: 'Failed to fetch reorder list' });
  }
});

// Items expiring soon
router.get('/items-expiry-alert', authorize('inventory.read'), async (req, res) => {
  try {
    const { days } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const warnDays = parseInt(days) || 30;
    const [batches] = await sequelize.query(`
      SELECT b.*, i.item_name, i.item_code, i.unit_of_measure, sl.location_name,
        ((b.expiry_date)::date - (CURRENT_DATE)::date) AS days_to_expiry
      FROM inventory_batches b
      JOIN inventory_items i ON b.item_id = i.id
      LEFT JOIN stock_locations sl ON b.location_id = sl.id
      WHERE b.status IN ('active','partial_use') AND b.expiry_date IS NOT NULL
        AND ((b.expiry_date)::date - (CURRENT_DATE)::date) <= :warnDays
        AND b.clinic_id = :clinic_id
        ${(() => { const { sql: bSQL } = getBranchConditionSQL(req, 'i'); return bSQL ? 'AND i.branch_id = :branchId' : ''; })()}
      ORDER BY b.expiry_date ASC
    `, { replacements: { warnDays, clinic_id: clinicId, ...(() => { const { sql, params } = getBranchConditionSQL(req, 'i'); return sql ? { branchId: params[0] } : {}; })() } });
    res.json(batches);
  } catch (error) {
    console.error('Error fetching expiry alerts:', error);
    res.status(500).json({ error: 'Failed to fetch expiry alerts' });
  }
});

// ═══════════════════════════════════════════════════
// STOCK LOCATIONS
// ═══════════════════════════════════════════════════

router.get('/locations', authorize('inventory.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchFilter = getBranchConditionSQL(req, 'sl');
    const [locations] = await sequelize.query(`
      SELECT sl.*,
        (SELECT COUNT(DISTINCT sbl.item_id) FROM stock_by_location sbl WHERE sbl.location_id = sl.id AND sbl.quantity_on_hand > 0) AS item_count,
        (SELECT COALESCE(SUM(sbl2.quantity_on_hand), 0) FROM stock_by_location sbl2 WHERE sbl2.location_id = sl.id) AS total_stock,
        -- Value of what is standing in this location, so the list answers
        -- "how much is sitting here" without opening each one in turn.
        -- Valued at the item's current unit cost, falling back to its moving
        -- average — the same basis the inventory valuation report uses.
        (SELECT COALESCE(SUM(sbl3.quantity_on_hand * COALESCE(NULLIF(ii.current_unit_cost, 0), ii.average_unit_cost, 0)), 0)
           FROM stock_by_location sbl3
           JOIN inventory_items ii ON ii.id = sbl3.item_id
          WHERE sbl3.location_id = sl.id) AS stock_value
      FROM stock_locations sl
      WHERE sl.clinic_id = ?${branchFilter.sql}
      ORDER BY sl.location_name ASC
    `, { replacements: [clinicId, ...branchFilter.params] });
    res.json(locations);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

router.post('/locations', authorize('inventory.write'), async (req, res) => {
  try {
    const id = uuidv4();
    const { location_code, location_name, location_type, address, manager_user_id, capacity_description } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);
    if (!location_code || !location_name) return res.status(400).json({ error: 'location_code and location_name required' });

    await sequelize.query(`
      INSERT INTO stock_locations (id, clinic_id, branch_id, location_code, location_name, location_type, address, manager_user_id, capacity_description)
      VALUES (:id, :clinic_id, :branch_id, :location_code, :location_name, :location_type, :address, :manager_user_id, :capacity_description)
    `, {
      replacements: {
        id, clinic_id, branch_id: getCreateBranchId(req), location_code, location_name,
        location_type: location_type || 'warehouse', address: address || null,
        manager_user_id: manager_user_id || null, capacity_description: capacity_description || null
      }
    });
    res.status(201).json({ id, location_code, location_name, message: 'Location created' });
  } catch (error) {
    console.error('Error creating location:', error);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

router.put('/locations/:id', authorize('inventory.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    const [existingLocations] = await sequelize.query(
      'SELECT id, branch_id FROM stock_locations WHERE id = :id AND clinic_id = :clinicId',
      { replacements: { id: req.params.id, clinicId } }
    );
    if (existingLocations.length === 0) return res.status(404).json({ error: 'Location not found' });
    if (!BranchQueryFilter.canAccessRecord(existingLocations[0], req.branchContext)) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const fields = [];
    const replacements = { id: req.params.id, clinicId };
    const allowed = ['location_name', 'location_type', 'address', 'manager_user_id', 'is_active', 'capacity_description'];
    for (const key of allowed) {
      // No backticks — this is Postgres, not MySQL. Backtick-quoted identifiers
      // aren't valid syntax here at all, so this UPDATE threw a syntax error and
      // 500'd on every single call that actually had a field to update (the
      // affectedRows check just below never even had a chance to matter).
      if (req.body[key] !== undefined) { fields.push(`${key} = :${key}`); replacements[key] = req.body[key]; }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    const [, locMeta] = await sequelize.query(`UPDATE stock_locations SET ${fields.join(', ')} WHERE id = :id AND clinic_id = :clinicId`, { replacements });
    if (locMeta.rowCount === 0) return res.status(404).json({ error: 'Location not found' });
    res.json({ message: 'Location updated' });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Get stock at a specific location
router.get('/locations/:id/stock', authorize('inventory.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    const [locations] = await sequelize.query(
      'SELECT id, branch_id FROM stock_locations WHERE id = :id AND clinic_id = :clinicId',
      { replacements: { id: req.params.id, clinicId } }
    );
    if (locations.length === 0) return res.status(404).json({ error: 'Location not found' });
    if (!BranchQueryFilter.canAccessRecord(locations[0], req.branchContext)) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const [stock] = await sequelize.query(`
      SELECT sbl.*, i.item_name, i.item_code, i.item_category, i.unit_of_measure,
        i.current_unit_cost, i.average_unit_cost,
        (sbl.quantity_on_hand * i.average_unit_cost) AS stock_value
      FROM stock_by_location sbl
      JOIN inventory_items i ON sbl.item_id = i.id
      WHERE sbl.location_id = :location_id AND sbl.quantity_on_hand > 0 AND sbl.clinic_id = :clinicId
      ORDER BY i.item_name ASC
    `, { replacements: { location_id: req.params.id, clinicId } });
    res.json(stock);
  } catch (error) {
    console.error('Error fetching location stock:', error);
    res.status(500).json({ error: 'Failed to fetch location stock' });
  }
});

// ═══════════════════════════════════════════════════
// INVENTORY BATCHES
// ═══════════════════════════════════════════════════

router.get('/batches', authorize('inventory.read'), async (req, res) => {
  try {
    const { item_id, status, expired, location_id } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['b.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (item_id) { conditions.push('b.item_id = :item_id'); replacements.item_id = item_id; }
    if (status) { conditions.push('b.status = :status'); replacements.status = status; }
    if (location_id) { conditions.push('b.location_id = :location_id'); replacements.location_id = location_id; }
    if (expired === 'true') { conditions.push('b.expiry_date < CURRENT_DATE'); }
    if (expired === 'false') { conditions.push('(b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)'); }
    const { sql: bBranchSQL, params: bBranchParams } = getBranchConditionSQL(req, 'i');
    if (bBranchSQL) { conditions.push('i.branch_id = :batchBranchId'); replacements.batchBranchId = bBranchParams[0]; }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const [batches] = await sequelize.query(`
      SELECT b.*, i.item_name, i.item_code, i.unit_of_measure,
        sl.location_name, NULL AS supplier_name,
        (b.quantity_received - b.quantity_used) AS quantity_available,
        ((b.expiry_date)::date - (CURRENT_DATE)::date) AS days_to_expiry
      FROM inventory_batches b
      JOIN inventory_items i ON b.item_id = i.id
      LEFT JOIN stock_locations sl ON b.location_id = sl.id
            ${where}
      ORDER BY b.expiry_date ASC
    `, { replacements });

    res.json(batches);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// Create batch (usually from GRN)
router.post('/batches', authorize('inventory.write'), async (req, res) => {
  try {
    const id = uuidv4();
    const {
      item_id, batch_number, serial_number, location_id,
      po_id, grn_id, supplier_id, receipt_date,
      quantity_received, unit_cost, cost_currency,
      manufacture_date, expiry_date, notes
    } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    if (!item_id || !batch_number || !quantity_received) {
      return res.status(400).json({ error: 'item_id, batch_number, and quantity_received are required' });
    }

    const batchTotalCost = (quantity_received || 0) * (unit_cost || 0);

    await sequelize.query(`
      INSERT INTO inventory_batches (id, clinic_id, branch_id, item_id, batch_number, serial_number, location_id,
        po_id, grn_id, supplier_id, receipt_date,
        quantity_received, unit_cost, cost_currency, batch_total_cost,
        manufacture_date, expiry_date, notes)
      VALUES (:id, :clinic_id, :branch_id, :item_id, :batch_number, :serial_number, :location_id,
        :po_id, :grn_id, :supplier_id, :receipt_date,
        :quantity_received, :unit_cost, :cost_currency, :batch_total_cost,
        :manufacture_date, :expiry_date, :notes)
    `, {
      replacements: {
        id, clinic_id, branch_id: getCreateBranchId(req), item_id, batch_number,
        serial_number: serial_number || null, location_id: location_id || null,
        po_id: po_id || null, grn_id: grn_id || null, supplier_id: supplier_id || null,
        receipt_date: receipt_date || new Date().toISOString().split('T')[0],
        quantity_received, unit_cost: unit_cost || 0, cost_currency: cost_currency || 'SSP',
        batch_total_cost: batchTotalCost,
        manufacture_date: manufacture_date || null, expiry_date: expiry_date || null,
        notes: notes || null
      }
    });

    // Update item stock
    await sequelize.query(`
      UPDATE inventory_items SET
        quantity_on_hand = quantity_on_hand + :qty,
        average_unit_cost = CASE
          WHEN quantity_on_hand = 0 THEN :unit_cost
          ELSE ((average_unit_cost * quantity_on_hand) + (:unit_cost * :qty)) / (quantity_on_hand + :qty)
        END,
        current_unit_cost = :unit_cost
      WHERE id = :item_id
    `, { replacements: { qty: quantity_received, unit_cost: unit_cost || 0, item_id } });

    // Update stock_by_location
    if (location_id) {
      const [existing] = await sequelize.query(
        'SELECT id FROM stock_by_location WHERE item_id = :item_id AND location_id = :location_id',
        { replacements: { item_id, location_id } }
      );
      if (existing.length > 0) {
        await sequelize.query(
          'UPDATE stock_by_location SET quantity_on_hand = quantity_on_hand + :qty WHERE item_id = :item_id AND location_id = :location_id',
          { replacements: { qty: quantity_received, item_id, location_id } }
        );
      } else {
        await sequelize.query(`
          INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand)
          VALUES (:sbl_id, :clinic_id, :item_id, :location_id, :qty)
        `, { replacements: { sbl_id: uuidv4(), clinic_id, item_id, location_id, qty: quantity_received } });
      }
    }

    res.status(201).json({ id, batch_number, message: 'Batch created and stock updated' });
  } catch (error) {
    console.error('Error creating batch:', error);
    res.status(500).json({ error: 'Failed to create batch' });
  }
});

// Record batch usage
router.post('/batches/:id/use', authorize('inventory.write'), async (req, res) => {
  try {
    const { quantity_used, usage_type, reference_id, reference_type, used_by, notes } = req.body;
    if (!quantity_used || quantity_used <= 0) return res.status(400).json({ error: 'quantity_used must be > 0' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    // Check available
    const [batches] = await sequelize.query(
      'SELECT *, (quantity_received - quantity_used) AS available FROM inventory_batches WHERE id = :id AND clinic_id = :clinicId',
      { replacements: { id: req.params.id, clinicId } }
    );
    if (batches.length === 0) return res.status(404).json({ error: 'Batch not found' });
    const batch = batches[0];
    if (batch.available < quantity_used) return res.status(400).json({ error: 'Insufficient batch quantity' });

    // Update batch
    const newUsed = batch.quantity_used + quantity_used;
    const newStatus = newUsed >= batch.quantity_received ? 'exhausted' : 'partial_use';
    await sequelize.query(
      'UPDATE inventory_batches SET quantity_used = :newUsed, status = :status WHERE id = :id',
      { replacements: { newUsed, status: newStatus, id: req.params.id } }
    );

    // Log usage
    await sequelize.query(`
      INSERT INTO batch_usage_history (id, batch_id, usage_date, quantity_used, usage_type, reference_id, reference_type, used_by, notes)
      VALUES (:id, :batch_id, CURRENT_DATE, :quantity_used, :usage_type, :reference_id, :reference_type, :used_by, :notes)
    `, {
      replacements: {
        id: uuidv4(), batch_id: req.params.id, quantity_used,
        usage_type: usage_type || 'clinical_use', reference_id: reference_id || null,
        reference_type: reference_type || null, used_by: used_by || null, notes: notes || null
      }
    });

    // Update item stock
    await sequelize.query(
      'UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE id = :item_id',
      { replacements: { qty: quantity_used, item_id: batch.item_id } }
    );

    // Update stock_by_location
    if (batch.location_id) {
      await sequelize.query(
        'UPDATE stock_by_location SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE item_id = :item_id AND location_id = :loc_id',
        { replacements: { qty: quantity_used, item_id: batch.item_id, loc_id: batch.location_id } }
      );
    }

    res.json({ message: 'Batch usage recorded', remaining: batch.available - quantity_used });
  } catch (error) {
    console.error('Error recording batch usage:', error);
    res.status(500).json({ error: 'Failed to record batch usage' });
  }
});

// Retire batches in bulk (write-off expired/damaged stock)
router.post('/batches/retire-bulk', authorize('inventory.write'), async (req, res) => {
  try {
    const { batch_ids, reason, retired_by } = req.body;
    if (!Array.isArray(batch_ids) || batch_ids.length === 0) {
      return res.status(400).json({ error: 'batch_ids array is required' });
    }
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    let totalRetired = 0;
    const results = [];

    for (const batchId of batch_ids) {
      try {
        const [rows] = await sequelize.query(
          'SELECT *, (quantity_received - quantity_used) AS available FROM inventory_batches WHERE id = :id AND clinic_id = :clinicId',
          { replacements: { id: batchId, clinicId } }
        );
        if (rows.length === 0) continue;
        const batch = rows[0];
        const available = Number(batch.available) || 0;
        if (available <= 0) continue;

        // Mark batch as retired — set quantity_used = quantity_received so available = 0
        await sequelize.query(
          `UPDATE inventory_batches SET status = 'retired', quantity_used = quantity_received,
            notes = (COALESCE(notes, '') || :noteAppend) WHERE id = :id`,
          { replacements: { id: batchId, noteAppend: ` | Retired: ${reason || 'expired stock write-off'}` } }
        );

        // Subtract from item total stock
        await sequelize.query(
          'UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE id = :item_id',
          { replacements: { qty: available, item_id: batch.item_id } }
        );

        // Subtract from stock_by_location
        if (batch.location_id) {
          await sequelize.query(
            'UPDATE stock_by_location SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE item_id = :item_id AND location_id = :loc_id',
            { replacements: { qty: available, item_id: batch.item_id, loc_id: batch.location_id } }
          );
        }

        totalRetired += available;
        results.push({ batch_id: batchId, batch_number: batch.batch_number, qty_removed: available });
      } catch (batchErr) {
        console.error(`Error retiring batch ${batchId}:`, batchErr.message);
      }
    }

    res.json({ message: `${results.length} batch(es) retired, ${totalRetired} units removed from stock`, results });
  } catch (error) {
    console.error('Error retiring batches:', error);
    res.status(500).json({ error: 'Failed to retire batches' });
  }
});

// ═══════════════════════════════════════════════════
// INVENTORY TRANSACTIONS
// ═══════════════════════════════════════════════════

router.get('/transactions', authorize('inventory.read'), async (req, res) => {
  try {
    const { item_id, transaction_type, date_from, date_to, limit: lim } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['t.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (item_id) { conditions.push('t.item_id = :item_id'); replacements.item_id = item_id; }
    if (transaction_type) { conditions.push('t.transaction_type = :transaction_type'); replacements.transaction_type = transaction_type; }
    if (date_from) { conditions.push('t.transaction_date >= :date_from'); replacements.date_from = date_from; }
    if (date_to) { conditions.push('t.transaction_date <= :date_to'); replacements.date_to = date_to; }
    const { sql: tBranchSQL, params: tBranchParams } = getBranchConditionSQL(req, 'i');
    if (tBranchSQL) { conditions.push('i.branch_id = :txnBranchId'); replacements.txnBranchId = tBranchParams[0]; }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    // A tenant with more transactions than the cap than a caller happened to
    // request (this page's own default was 200, against 468 real rows for one
    // branch in nation) silently truncated to "whatever fit" with no sign
    // anything was missing — the newest transactions all looked present, only
    // the tail quietly wasn't there. Same fix as LIS_PARTICIPANT_LIMIT: raise
    // the ceiling well past today's real counts rather than the number that
    // happened to be enough when this was first written.
    const queryLimit = Math.min(parseInt(lim) || 200, parseInt(process.env.INVENTORY_TXN_LIMIT || '5000', 10));

    const [transactions] = await sequelize.query(`
      SELECT t.*, i.item_name, i.item_code, i.unit_of_measure,
        sl1.location_name AS from_location_name, sl2.location_name AS to_location_name
      FROM inventory_transactions t
      JOIN inventory_items i ON t.item_id = i.id
      LEFT JOIN stock_locations sl1 ON t.from_location_id = sl1.id
      LEFT JOIN stock_locations sl2 ON t.to_location_id = sl2.id
      ${where}
      ORDER BY t.transaction_date DESC, t.created_at DESC
      LIMIT ${queryLimit}
    `, { replacements });

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Create inventory transaction
router.post('/transactions', authorize('inventory.write'), async (req, res) => {
  try {
    const id = uuidv4();
    const {
      item_id, transaction_type, quantity_change,
      from_location_id, to_location_id, batch_id,
      unit_cost, cost_currency, exchange_rate,
      reference_type, reference_id,
      transaction_date, notes, created_by
    } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    if (!item_id || !transaction_type || !quantity_change) {
      return res.status(400).json({ error: 'item_id, transaction_type, and quantity_change required' });
    }

    // Generate transaction number
    const txDate = transaction_date || new Date().toISOString().split('T')[0];
    const [countResult] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM inventory_transactions WHERE DATE(created_at) = CURRENT_DATE"
    );
    const seq = (countResult[0]?.cnt || 0) + 1;
    const transaction_number = `TXN-${txDate.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;

    const totalCost = Math.abs(quantity_change) * (unit_cost || 0);

    await sequelize.query(`
      INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
        quantity_change, from_location_id, to_location_id, batch_id,
        unit_cost, total_cost, cost_currency, exchange_rate,
        reference_type, reference_id, transaction_date, notes, created_by)
      VALUES (:id, :clinic_id, :transaction_number, :item_id, :transaction_type,
        :quantity_change, :from_location_id, :to_location_id, :batch_id,
        :unit_cost, :total_cost, :cost_currency, :exchange_rate,
        :reference_type, :reference_id, :transaction_date, :notes, :created_by)
    `, {
      replacements: {
        id, clinic_id, branch_id: getCreateBranchId(req), transaction_number, item_id, transaction_type,
        quantity_change, from_location_id: from_location_id || null,
        to_location_id: to_location_id || null, batch_id: batch_id || null,
        unit_cost: unit_cost || 0, total_cost: totalCost,
        cost_currency: cost_currency || 'SSP', exchange_rate: exchange_rate || 1,
        reference_type: reference_type || null, reference_id: reference_id || null,
        transaction_date: txDate, notes: notes || null, created_by: created_by || null
      }
    });

    // Update item stock based on transaction type
    if (['receipt', 'adjustment'].includes(transaction_type) && quantity_change > 0) {
      await sequelize.query(
        'UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + :qty WHERE id = :item_id',
        { replacements: { qty: quantity_change, item_id } }
      );
    } else if (['dispense', 'usage', 'waste', 'damage', 'return_to_supplier'].includes(transaction_type) || quantity_change < 0) {
      await sequelize.query(
        'UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand + :qty) WHERE id = :item_id',
        { replacements: { qty: quantity_change, item_id } }
      );
    }

    // Update stock by location for transfers
    if (transaction_type === 'transfer' && from_location_id && to_location_id) {
      const absQty = Math.abs(quantity_change);
      // Decrease from source
      await sequelize.query(
        'UPDATE stock_by_location SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE item_id = :item_id AND location_id = :loc_id',
        { replacements: { qty: absQty, item_id, loc_id: from_location_id } }
      );
      // Increase at destination
      const [existing] = await sequelize.query(
        'SELECT id FROM stock_by_location WHERE item_id = :item_id AND location_id = :loc_id',
        { replacements: { item_id, loc_id: to_location_id } }
      );
      if (existing.length > 0) {
        await sequelize.query(
          'UPDATE stock_by_location SET quantity_on_hand = quantity_on_hand + :qty WHERE item_id = :item_id AND location_id = :loc_id',
          { replacements: { qty: absQty, item_id, loc_id: to_location_id } }
        );
      } else {
        await sequelize.query(`
          INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand)
          VALUES (:sbl_id, :clinic_id, :item_id, :loc_id, :qty)
        `, { replacements: { sbl_id: uuidv4(), clinic_id, item_id, loc_id: to_location_id, qty: absQty } });
      }
    }

    // Auto-create GL entry if settings are configured — cost_currency/exchange_rate
    // passed through so a non-base-currency transaction doesn't post to the GL as if
    // it were already base-currency 1:1 (see createInventoryGLEntry below).
    const txnData = {
      id, transaction_number, transaction_type, quantity_change,
      total_cost: totalCost, notes, item_id,
      cost_currency: cost_currency || 'SSP', exchange_rate: exchange_rate || null,
    };
    const jeNumber = await createInventoryGLEntry(clinic_id, txnData, created_by);
    if (jeNumber) {
      await sequelize.query(
        'UPDATE inventory_transactions SET gl_entry_id = :je WHERE id = :id',
        { replacements: { je: jeNumber, id } }
      );
    }

    res.status(201).json({ id, transaction_number, gl_entry: jeNumber || null, message: 'Transaction recorded' });
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// ═══════════════════════════════════════════════════
// INVENTORY ADJUSTMENTS
// ═══════════════════════════════════════════════════

router.get('/adjustments', authorize('inventory.read'), async (req, res) => {
  try {
    const { approval_status } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['a.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };
    if (approval_status) { conditions.push('a.approval_status = :approval_status'); replacements.approval_status = approval_status; }
    const { sql: aBranchSQL, params: aBranchParams } = getBranchConditionSQL(req, 'i');
    if (aBranchSQL) { conditions.push('i.branch_id = :adjBranchId'); replacements.adjBranchId = aBranchParams[0]; }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const [adjustments] = await sequelize.query(`
      SELECT a.*, i.item_name, i.item_code, sl.location_name
      FROM inventory_adjustments a
      JOIN inventory_items i ON a.item_id = i.id
      LEFT JOIN stock_locations sl ON a.location_id = sl.id
      ${where}
      ORDER BY a.created_at DESC
    `, { replacements });
    res.json(adjustments);
  } catch (error) {
    console.error('Error fetching adjustments:', error);
    res.status(500).json({ error: 'Failed to fetch adjustments' });
  }
});

router.post('/adjustments', authorize('inventory.write'), async (req, res) => {
  try {
    const id = uuidv4();
    const { item_id, location_id, system_quantity, physical_count, variance_reason, counted_by, notes } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    const variance = (physical_count || 0) - (system_quantity || 0);

    // Get item for cost calculation
    const [items] = await sequelize.query('SELECT average_unit_cost FROM inventory_items WHERE id = :item_id', { replacements: { item_id } });
    const varianceValue = Math.abs(variance) * (items[0]?.average_unit_cost || 0);

    // Generate number
    const [countResult] = await sequelize.query("SELECT COUNT(*) AS cnt FROM inventory_adjustments WHERE DATE(created_at) = CURRENT_DATE");
    const seq = (countResult[0]?.cnt || 0) + 1;
    const adjustment_number = `ADJ-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;

    await sequelize.query(`
      INSERT INTO inventory_adjustments (id, clinic_id, adjustment_number, item_id, location_id,
        system_quantity, physical_count, variance, variance_reason, variance_value,
        counted_by, count_date, notes)
      VALUES (:id, :clinic_id, :adjustment_number, :item_id, :location_id,
        :system_quantity, :physical_count, :variance, :variance_reason, :variance_value,
        :counted_by, CURRENT_DATE, :notes)
    `, {
      replacements: {
        id, clinic_id, branch_id: getCreateBranchId(req), adjustment_number, item_id,
        location_id: location_id || null, system_quantity: system_quantity || 0,
        physical_count: physical_count || 0, variance, variance_reason: variance_reason || null,
        variance_value: varianceValue, counted_by: counted_by || null, notes: notes || null
      }
    });

    res.status(201).json({ id, adjustment_number, variance, variance_value: varianceValue, message: 'Adjustment created' });
  } catch (error) {
    console.error('Error creating adjustment:', error);
    res.status(500).json({ error: 'Failed to create adjustment' });
  }
});

// Approve adjustment
router.post('/adjustments/:id/approve', authorize('inventory.adjustments.approve'), async (req, res) => {
  try {
    const { approved_by } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    // Get adjustment
    const [adjs] = await sequelize.query('SELECT * FROM inventory_adjustments WHERE id = :id AND clinic_id = :clinicId', { replacements: { id: req.params.id, clinicId } });
    if (adjs.length === 0) return res.status(404).json({ error: 'Adjustment not found' });
    const adj = adjs[0];

    if (adj.approval_status !== 'pending') return res.status(400).json({ error: 'Adjustment not pending' });

    // Apply stock change
    await sequelize.query(
      'UPDATE inventory_items SET quantity_on_hand = :physical_count WHERE id = :item_id',
      { replacements: { physical_count: adj.physical_count, item_id: adj.item_id } }
    );

    // Update stock by location
    if (adj.location_id) {
      await sequelize.query(
        'UPDATE stock_by_location SET quantity_on_hand = :physical_count WHERE item_id = :item_id AND location_id = :loc_id',
        { replacements: { physical_count: adj.physical_count, item_id: adj.item_id, loc_id: adj.location_id } }
      );
    }

    // Create transaction record
    await sequelize.query(`
      INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
        quantity_change, unit_cost, total_cost, reference_type, reference_id, transaction_date, notes, created_by)
      VALUES (:id, :clinic_id, :txn, :item_id, 'adjustment', :qty, :cost, :total, 'adjustment', :adj_id, CURRENT_DATE, :notes, :created_by)
    `, {
      replacements: {
        id: uuidv4(), clinic_id: adj.clinic_id,
        txn: `TXN-ADJ-${adj.adjustment_number}`, item_id: adj.item_id,
        qty: adj.variance, cost: 0, total: adj.variance_value,
        adj_id: adj.id, notes: `Adjustment: ${adj.variance_reason || 'approved'}`,
        created_by: approved_by || null
      }
    });

    // Update adjustment status
    await sequelize.query(
      'UPDATE inventory_adjustments SET approval_status = :status, approved_by = :by, approval_date = NOW() WHERE id = :id',
      { replacements: { status: 'approved', by: approved_by || null, id: req.params.id } }
    );

    // Auto-create GL entry for the adjustment
    const glTxnData = {
      id: adj.id, transaction_number: `TXN-ADJ-${adj.adjustment_number}`,
      transaction_type: 'adjustment', quantity_change: adj.variance,
      total_cost: Math.abs(adj.variance_value || 0),
      notes: `Adjustment: ${adj.variance_reason || 'approved'}`
    };
    const jeNumber = await createInventoryGLEntry(adj.clinic_id, glTxnData, approved_by);
    if (jeNumber) {
      await sequelize.query(
        'UPDATE inventory_adjustments SET gl_entry_id = :je WHERE id = :id',
        { replacements: { je: jeNumber, id: req.params.id } }
      );
    }

    res.json({ message: 'Adjustment approved and stock updated', gl_entry: jeNumber || null });
  } catch (error) {
    console.error('Error approving adjustment:', error);
    res.status(500).json({ error: 'Failed to approve adjustment' });
  }
});

router.post('/adjustments/:id/reject', authorize('inventory.adjustments.approve'), async (req, res) => {
  try {
    const { reviewed_by, notes } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, rejectMeta] = await sequelize.query(
      'UPDATE inventory_adjustments SET approval_status = :status, reviewed_by = :by, review_date = NOW(), notes = (COALESCE(notes, \'\') || :notes) WHERE id = :id AND clinic_id = :clinicId',
      { replacements: { status: 'rejected', by: reviewed_by || null, notes: notes ? `\nRejection: ${notes}` : '', id: req.params.id, clinicId } }
    );
    if (rejectMeta.rowCount === 0) return res.status(404).json({ error: 'Adjustment not found' });
    res.json({ message: 'Adjustment rejected' });
  } catch (error) {
    console.error('Error rejecting adjustment:', error);
    res.status(500).json({ error: 'Failed to reject adjustment' });
  }
});

// ═══════════════════════════════════════════════════
// PHYSICAL INVENTORY COUNTS
// ═══════════════════════════════════════════════════

router.get('/physical-counts', authorize('inventory.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { sql: pcBranchSQL, params: pcBranchParams } = getBranchConditionSQL(req, 'pc');
    const [counts] = await sequelize.query(`
      SELECT pc.*, sl.location_name
      FROM physical_inventory_counts pc
      LEFT JOIN stock_locations sl ON pc.location_id = sl.id
      WHERE pc.clinic_id = :clinic_id
        ${pcBranchSQL ? 'AND pc.branch_id = :pcBranchId' : ''}
      ORDER BY pc.created_at DESC
    `, { replacements: { clinic_id: clinicId, ...(pcBranchSQL ? { pcBranchId: pcBranchParams[0] } : {}) } });
    res.json(counts);
  } catch (error) {
    console.error('Error fetching physical counts:', error);
    res.status(500).json({ error: 'Failed to fetch physical counts' });
  }
});

router.post('/physical-counts', authorize('inventory.write'), async (req, res) => {
  try {
    const id = uuidv4();
    const { count_type, location_id, created_by } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    const [countResult] = await sequelize.query("SELECT COUNT(*) AS cnt FROM physical_inventory_counts WHERE DATE(created_at) = CURRENT_DATE");
    const seq = (countResult[0]?.cnt || 0) + 1;
    const count_number = `PC-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;

    await sequelize.query(`
      INSERT INTO physical_inventory_counts (id, clinic_id, branch_id, count_number, count_date, count_type, location_id, created_by)
      VALUES (:id, :clinic_id, :branch_id, :count_number, CURRENT_DATE, :count_type, :location_id, :created_by)
    `, {
      replacements: {
        id, clinic_id, branch_id: getCreateBranchId(req), count_number,
        count_type: count_type || 'full_count', location_id: location_id || null,
        created_by: created_by || null
      }
    });

    res.status(201).json({ id, count_number, message: 'Physical count started' });
  } catch (error) {
    console.error('Error creating physical count:', error);
    res.status(500).json({ error: 'Failed to create physical count' });
  }
});

// Get count detail with lines
router.get('/physical-counts/:id', authorize('inventory.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [counts] = await sequelize.query(
      'SELECT pc.*, sl.location_name FROM physical_inventory_counts pc LEFT JOIN stock_locations sl ON pc.location_id = sl.id WHERE pc.id = :id AND pc.clinic_id = :clinicId',
      { replacements: { id: req.params.id, clinicId } }
    );
    if (counts.length === 0) return res.status(404).json({ error: 'Count not found' });

    const count = counts[0];
    const [lines] = await sequelize.query(`
      SELECT pcl.*, i.item_name, i.item_code, i.unit_of_measure
      FROM physical_count_lines pcl
      JOIN inventory_items i ON pcl.item_id = i.id
      WHERE pcl.count_id = :count_id
      ORDER BY i.item_name ASC
    `, { replacements: { count_id: req.params.id } });

    count.lines = lines;
    res.json(count);
  } catch (error) {
    console.error('Error fetching count details:', error);
    res.status(500).json({ error: 'Failed to fetch count details' });
  }
});

// Add count line
router.post('/physical-counts/:id/add-line', authorize('inventory.write'), async (req, res) => {
  try {
    const { item_id, location_id, counted_quantity, counted_by, notes } = req.body;

    // Get system quantity
    const [items] = await sequelize.query('SELECT quantity_on_hand FROM inventory_items WHERE id = :item_id', { replacements: { item_id } });
    const systemQty = items[0]?.quantity_on_hand || 0;
    const variance = (counted_quantity || 0) - systemQty;

    const lineId = uuidv4();
    await sequelize.query(`
      INSERT INTO physical_count_lines (id, count_id, item_id, location_id, system_quantity, counted_quantity, variance, counted_by, count_time, notes)
      VALUES (:id, :count_id, :item_id, :location_id, :system_quantity, :counted_quantity, :variance, :counted_by, LOCALTIME, :notes)
    `, {
      replacements: {
        id: lineId, count_id: req.params.id, item_id,
        location_id: location_id || null, system_quantity: systemQty,
        counted_quantity: counted_quantity || 0, variance,
        counted_by: counted_by || null, notes: notes || null
      }
    });

    // Update count totals
    const [totals] = await sequelize.query(`
      SELECT COUNT(*) AS total_counted, SUM(ABS(variance)) AS total_variance
      FROM physical_count_lines WHERE count_id = :count_id
    `, { replacements: { count_id: req.params.id } });

    await sequelize.query(`
      UPDATE physical_inventory_counts SET total_items_counted = :cnt, variance_count = :var_cnt WHERE id = :id
    `, { replacements: { cnt: totals[0]?.total_counted || 0, var_cnt: totals[0]?.total_variance || 0, id: req.params.id } });

    res.status(201).json({ id: lineId, system_quantity: systemQty, counted_quantity, variance, message: 'Count line added' });
  } catch (error) {
    console.error('Error adding count line:', error);
    res.status(500).json({ error: 'Failed to add count line' });
  }
});

// Complete count
router.put('/physical-counts/:id/complete', authorize('inventory.write'), async (req, res) => {
  try {
    const { completed_by } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [, completeMeta] = await sequelize.query(
      'UPDATE physical_inventory_counts SET status = :status, completed_by = :by, completed_date = CURRENT_DATE WHERE id = :id AND clinic_id = :clinicId',
      { replacements: { status: 'completed', by: completed_by || null, id: req.params.id, clinicId } }
    );
    if (completeMeta.rowCount === 0) return res.status(404).json({ error: 'Physical count not found' });
    res.json({ message: 'Physical count completed' });
  } catch (error) {
    console.error('Error completing count:', error);
    res.status(500).json({ error: 'Failed to complete count' });
  }
});

// Reconcile count - create adjustments for variances
router.post('/physical-counts/:id/reconcile', authorize('inventory.write'), async (req, res) => {
  try {
    const { approved_by } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    const [countRows] = await sequelize.query(
      'SELECT id FROM physical_inventory_counts WHERE id = :count_id AND clinic_id = :clinic_id',
      { replacements: { count_id: req.params.id, clinic_id } }
    );
    if (countRows.length === 0) return res.status(404).json({ error: 'Physical count not found' });

    const [lines] = await sequelize.query(
      'SELECT * FROM physical_count_lines WHERE count_id = :count_id AND variance != 0',
      { replacements: { count_id: req.params.id } }
    );

    let adjustmentsCreated = 0;
    for (const line of lines) {
      const adjId = uuidv4();
      const [countResult] = await sequelize.query("SELECT COUNT(*) AS cnt FROM inventory_adjustments");
      const seq = (countResult[0]?.cnt || 0) + 1;
      const adjNum = `ADJ-PC-${String(seq).padStart(4, '0')}`;

      const [items] = await sequelize.query('SELECT average_unit_cost FROM inventory_items WHERE id = :id', { replacements: { id: line.item_id } });
      const varianceValue = Math.abs(line.variance) * (items[0]?.average_unit_cost || 0);

      await sequelize.query(`
        INSERT INTO inventory_adjustments (id, clinic_id, adjustment_number, item_id, location_id,
          system_quantity, physical_count, variance, variance_reason, variance_value,
          counted_by, count_date, approval_status, notes)
        VALUES (:id, :clinic_id, :adj_num, :item_id, :location_id,
          :sys_qty, :phys_qty, :variance, 'recount_error', :var_value,
          :counted_by, CURRENT_DATE, 'pending', :notes)
      `, {
        replacements: {
          id: adjId, clinic_id, adj_num: adjNum, item_id: line.item_id,
          location_id: line.location_id, sys_qty: line.system_quantity,
          phys_qty: line.counted_quantity, variance: line.variance,
          var_value: varianceValue, counted_by: line.counted_by,
          notes: `From physical count ${req.params.id}`
        }
      });
      adjustmentsCreated++;
    }

    await sequelize.query(
      'UPDATE physical_inventory_counts SET status = :status WHERE id = :id',
      { replacements: { status: 'reconciled', id: req.params.id } }
    );

    res.json({ message: `Reconciled: ${adjustmentsCreated} adjustments created`, adjustments_created: adjustmentsCreated });
  } catch (error) {
    console.error('Error reconciling count:', error);
    res.status(500).json({ error: 'Failed to reconcile count' });
  }
});

// ═══════════════════════════════════════════════════
// INVENTORY VALUATION & COGS
// ═══════════════════════════════════════════════════

router.get('/valuation', authorize('inventory.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { sql: valBranchSQL, params: valBranchParams } = getBranchConditionSQL(req, 'i');
    const [items] = await sequelize.query(`
      SELECT i.id, i.item_code, i.item_name, i.item_category, i.unit_of_measure,
        i.quantity_on_hand, i.reserved_quantity,
        (i.quantity_on_hand - i.reserved_quantity) AS available_quantity,
        i.average_unit_cost, i.current_unit_cost, i.cost_currency,
        (i.quantity_on_hand * i.average_unit_cost) AS weighted_average_value,
        i.inventory_valuation_method
      FROM inventory_items i
      WHERE i.is_active = true AND i.quantity_on_hand > 0
        AND i.clinic_id = :clinic_id
        ${valBranchSQL ? 'AND i.branch_id = :valBranchId' : ''}
      ORDER BY (i.quantity_on_hand * i.average_unit_cost) DESC
    `, { replacements: { clinic_id: clinicId, ...(valBranchSQL ? { valBranchId: valBranchParams[0] } : {}) } });

    // Items are costed in different currencies (cost_currency) — summing
    // weighted_average_value directly blended a USD-costed item and an
    // SSP-costed item as if they were the same unit. Normalize to base
    // currency for the total, same convention as reportInventory.js.
    const clinicIdForFx = clinicId;
    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'SSP';
    const [rateRows] = await sequelize.query(
      `SELECT from_currency, rate FROM exchange_rates
       WHERE clinic_id = :clinicId AND to_currency = :baseCurrency AND is_active = true
       ORDER BY effective_date DESC`,
      { replacements: { clinicId: clinicIdForFx, baseCurrency } }
    );
    const rateToBase = new Map();
    for (const r of rateRows) if (!rateToBase.has(r.from_currency)) rateToBase.set(r.from_currency, Number(r.rate));
    rateToBase.set(baseCurrency, 1);

    // The per-item Valuation Method (FIFO/LIFO/Weighted Average) was purely
    // decorative — every item was valued at average_unit_cost regardless of
    // what was selected. Compute real FIFO/LIFO layer valuations for items
    // that ask for them: value remaining quantity_on_hand by walking batch
    // receipt layers oldest-first (LIFO — the newest stock is assumed sold,
    // so what remains is the old layers) or newest-first (FIFO — the oldest
    // stock is assumed sold, so what remains is the new layers), a standard
    // periodic FIFO/LIFO valuation convention that doesn't require knowing
    // which physical batch a given dispense actually drew from.
    const fifoLifoItemIds = items.filter(i => i.inventory_valuation_method === 'fifo' || i.inventory_valuation_method === 'lifo').map(i => i.id);
    const batchesByItem = new Map();
    if (fifoLifoItemIds.length > 0) {
      const [batchRows] = await sequelize.query(`
        SELECT item_id, receipt_date, unit_cost, cost_currency,
          GREATEST(0, quantity_received - COALESCE(quantity_used, 0)) AS quantity_available
        FROM inventory_batches
        WHERE item_id IN (:itemIds) AND status != 'expired'
        ORDER BY item_id, receipt_date ASC
      `, { replacements: { itemIds: fifoLifoItemIds } });
      for (const b of batchRows) {
        if (parseFloat(b.quantity_available) <= 0) continue;
        if (!batchesByItem.has(b.item_id)) batchesByItem.set(b.item_id, []);
        batchesByItem.get(b.item_id).push(b);
      }
    }

    function layeredValue(itemId, qtyOnHand, method) {
      const layers = batchesByItem.get(itemId) || [];
      const ordered = method === 'fifo' ? [...layers].reverse() : layers; // FIFO remaining = newest layers first; LIFO remaining = oldest layers first
      let remaining = qtyOnHand;
      let value = 0;
      for (const layer of ordered) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, parseFloat(layer.quantity_available));
        value += take * parseFloat(layer.unit_cost || 0);
        remaining -= take;
      }
      // Any quantity not covered by known batch layers (e.g. opening stock
      // entered without a batch) falls back to average cost for that portion.
      return { value, uncoveredQty: Math.max(0, remaining) };
    }

    let totalValue = 0;
    let unconvertedCount = 0;
    for (const item of items) {
      const currency = item.cost_currency || baseCurrency;
      const rate = rateToBase.get(currency);
      if (rate === undefined) unconvertedCount++;

      let value = parseFloat(item.weighted_average_value) || 0;
      if (item.inventory_valuation_method === 'fifo' || item.inventory_valuation_method === 'lifo') {
        const { value: layeredVal, uncoveredQty } = layeredValue(item.id, parseFloat(item.quantity_on_hand), item.inventory_valuation_method);
        value = layeredVal + uncoveredQty * (parseFloat(item.average_unit_cost) || 0);
        item.weighted_average_value = Math.round(value * 100) / 100; // reflect the method actually applied
      }
      totalValue += value * (rate ?? 1);
    }

    res.json({ items, total_inventory_value: Math.round(totalValue * 100) / 100, item_count: items.length, base_currency: baseCurrency, unconverted_item_count: unconvertedCount });
  } catch (error) {
    console.error('Error fetching valuation:', error);
    res.status(500).json({ error: 'Failed to fetch valuation' });
  }
});

// COGS monthly summary
router.get('/cogs/monthly/:period', authorize('inventory.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const period = req.params.period; // YYYY-MM

    // total_cost is denominated per-transaction in cost_currency, so summing it
    // raw blends currencies exactly like the valuation report used to. Each
    // transaction already stores the exchange_rate that was in effect when it
    // happened, so total_cost * exchange_rate gives its base-currency value
    // without needing today's rate (more historically accurate for COGS anyway).
    const [cogs] = await sequelize.query(`
      SELECT t.item_id, i.item_name, i.item_code,
        SUM(CASE WHEN t.transaction_type IN ('dispense','usage') THEN ABS(t.quantity_change) ELSE 0 END) AS quantity_used,
        SUM(CASE WHEN t.transaction_type = 'waste' THEN ABS(t.quantity_change) ELSE 0 END) AS quantity_wasted,
        SUM(ABS(t.total_cost)) AS total_cost,
        SUM(ABS(t.total_cost) * COALESCE(t.exchange_rate, 1)) AS total_cost_base
      FROM inventory_transactions t
      JOIN inventory_items i ON t.item_id = i.id
      WHERE to_char(t.transaction_date, 'YYYY-MM') = :period
        AND t.transaction_type IN ('dispense', 'usage', 'waste', 'damage')
        AND t.clinic_id = :clinic_id
      GROUP BY t.item_id, i.item_name, i.item_code
      ORDER BY total_cost_base DESC
    `, { replacements: { period, clinic_id: clinicId } });

    const totalCOGS = cogs.reduce((s, c) => s + (parseFloat(c.total_cost_base) || 0), 0);
    res.json({ period, items: cogs, total_cogs: Math.round(totalCOGS * 100) / 100 });
  } catch (error) {
    console.error('Error fetching COGS:', error);
    res.status(500).json({ error: 'Failed to fetch COGS' });
  }
});

// ═══════════════════════════════════════════════════
// INVENTORY REPORTS / DASHBOARD STATS
// ═══════════════════════════════════════════════════

router.get('/dashboard-stats', authorize('inventory.read'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);

    const [[totalItems]] = await sequelize.query(
      'SELECT COUNT(*) AS cnt FROM inventory_items WHERE is_active = true AND clinic_id = :cid', { replacements: { cid } }
    );
    const [[totalValue]] = await sequelize.query(
      'SELECT COALESCE(SUM(quantity_on_hand * average_unit_cost), 0) AS val FROM inventory_items WHERE is_active = true AND clinic_id = :cid', { replacements: { cid } }
    );
    const [[lowStock]] = await sequelize.query(
      'SELECT COUNT(*) AS cnt FROM inventory_items WHERE is_active = true AND quantity_on_hand <= minimum_stock_level AND minimum_stock_level > 0 AND clinic_id = :cid', { replacements: { cid } }
    );
    const [[expiringBatches]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM inventory_batches WHERE status IN ('active','partial_use') AND expiry_date IS NOT NULL AND ((expiry_date)::date - (CURRENT_DATE)::date) <= 30 AND clinic_id = :cid", { replacements: { cid } }
    );
    const [[outOfStock]] = await sequelize.query(
      'SELECT COUNT(*) AS cnt FROM inventory_items WHERE is_active = true AND quantity_on_hand = 0 AND clinic_id = :cid', { replacements: { cid } }
    );
    const [[totalLocations]] = await sequelize.query(
      'SELECT COUNT(*) AS cnt FROM stock_locations WHERE is_active = true AND clinic_id = :cid', { replacements: { cid } }
    );
    const [[pendingAdj]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM inventory_adjustments WHERE approval_status = 'pending' AND clinic_id = :cid", { replacements: { cid } }
    );

    // Recent transactions
    const [recentTx] = await sequelize.query(`
      SELECT t.*, i.item_name, i.item_code
      FROM inventory_transactions t
      JOIN inventory_items i ON t.item_id = i.id
      WHERE t.clinic_id = :cid
      ORDER BY t.created_at DESC LIMIT 10
    `, { replacements: { cid } });

    // Top items by value
    const [topItems] = await sequelize.query(`
      SELECT item_code, item_name, quantity_on_hand, average_unit_cost,
        (quantity_on_hand * average_unit_cost) AS stock_value
      FROM inventory_items WHERE is_active = true AND clinic_id = :cid AND quantity_on_hand > 0
      ORDER BY stock_value DESC LIMIT 10
    `, { replacements: { cid } });

    // Category breakdown
    const [categories] = await sequelize.query(`
      SELECT item_category, COUNT(*) AS item_count,
        COALESCE(SUM(quantity_on_hand * average_unit_cost), 0) AS category_value
      FROM inventory_items WHERE is_active = true AND clinic_id = :cid
      GROUP BY item_category ORDER BY category_value DESC
    `, { replacements: { cid } });

    res.json({
      total_items: totalItems?.cnt || 0,
      total_inventory_value: parseFloat(totalValue?.val || 0),
      low_stock_items: lowStock?.cnt || 0,
      expiring_soon: expiringBatches?.cnt || 0,
      out_of_stock: outOfStock?.cnt || 0,
      total_locations: totalLocations?.cnt || 0,
      pending_adjustments: pendingAdj?.cnt || 0,
      recent_transactions: recentTx,
      top_items_by_value: topItems,
      category_breakdown: categories
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// Stock summary report
router.get('/reports/stock-summary', authorize('inventory.read'), async (req, res) => {
  try {
    const { category } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['i.is_active = true', 'i.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };
    if (category) { conditions.push('i.item_category = :category'); replacements.category = category; }
    const where = 'WHERE ' + conditions.join(' AND ');

    const [items] = await sequelize.query(`
      SELECT i.item_code, i.item_name, i.item_category, i.item_type, i.unit_of_measure,
        i.quantity_on_hand, i.reserved_quantity, (i.quantity_on_hand - i.reserved_quantity) AS available,
        i.minimum_stock_level, i.maximum_stock_level, i.reorder_quantity,
        i.average_unit_cost, (i.quantity_on_hand * i.average_unit_cost) AS stock_value,
        CASE
          WHEN i.quantity_on_hand = 0 THEN 'out_of_stock'
          WHEN i.quantity_on_hand <= i.minimum_stock_level THEN 'low_stock'
          WHEN i.quantity_on_hand >= i.maximum_stock_level AND i.maximum_stock_level > 0 THEN 'over_stock'
          ELSE 'normal'
        END AS stock_status
      FROM inventory_items i
      ${where}
      ORDER BY i.item_name ASC
    `, { replacements });

    res.json(items);
  } catch (error) {
    console.error('Error fetching stock summary:', error);
    res.status(500).json({ error: 'Failed to fetch stock summary' });
  }
});

// Usage history report
router.get('/reports/usage-history', authorize('inventory.read'), async (req, res) => {
  try {
    const { item_id, date_from, date_to } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ["t.transaction_type IN ('dispense','usage','waste','damage')", 't.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };
    if (item_id) { conditions.push('t.item_id = :item_id'); replacements.item_id = item_id; }
    if (date_from) { conditions.push('t.transaction_date >= :date_from'); replacements.date_from = date_from; }
    if (date_to) { conditions.push('t.transaction_date <= :date_to'); replacements.date_to = date_to; }
    const where = 'WHERE ' + conditions.join(' AND ');

    const [usage] = await sequelize.query(`
      SELECT to_char(t.transaction_date, 'YYYY-MM') AS period,
        i.item_name, i.item_code, t.transaction_type,
        SUM(ABS(t.quantity_change)) AS total_quantity,
        SUM(ABS(t.total_cost)) AS total_cost
      FROM inventory_transactions t
      JOIN inventory_items i ON t.item_id = i.id
      ${where}
      GROUP BY period, i.item_name, i.item_code, t.transaction_type
      ORDER BY period DESC, total_cost DESC
    `, { replacements });

    res.json(usage);
  } catch (error) {
    console.error('Error fetching usage history:', error);
    res.status(500).json({ error: 'Failed to fetch usage history' });
  }
});

// ═══════════════════════════════════════════════════
// INVENTORY SETTINGS
// ═══════════════════════════════════════════════════

router.get('/settings/:clinicId', authorize('inventory.read'), async (req, res) => {
  try {
    // Path param, not query/body — a non-admin could otherwise read any other
    // clinic's inventory settings just by changing the URL.
    if (req.user?.role !== 'admin' && String(req.params.clinicId) !== String(req.user?.clinicId)) {
      return res.status(403).json({ error: 'Access denied to this clinic\'s settings' });
    }
    const [settings] = await sequelize.query(
      'SELECT * FROM inventory_settings WHERE clinic_id = :clinic_id',
      { replacements: { clinic_id: parseInt(req.params.clinicId) } }
    );
    if (settings.length === 0) {
      // Return defaults
      return res.json({
        clinic_id: parseInt(req.params.clinicId),
        default_valuation_method: 'weighted_average', warn_expiry_days: 30,
        auto_flag_expired: true, track_by_location: true,
        allow_negative_stock: false, require_approval_for_adjustments_above: 10000
      });
    }
    res.json(settings[0]);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/settings/:clinicId', authorize('inventory.write'), async (req, res) => {
  try {
    if (req.user?.role !== 'admin' && String(req.params.clinicId) !== String(req.user?.clinicId)) {
      return res.status(403).json({ error: 'Access denied to this clinic\'s settings' });
    }
    const clinicId = parseInt(req.params.clinicId);
    const [existing] = await sequelize.query('SELECT id FROM inventory_settings WHERE clinic_id = :cid', { replacements: { cid: clinicId } });

    if (existing.length === 0) {
      // Insert
      await sequelize.query(`
        INSERT INTO inventory_settings (id, clinic_id, default_valuation_method, warn_expiry_days, auto_flag_expired,
          track_by_location, allow_negative_stock, require_approval_for_adjustments_above,
          default_location_id, inventory_account_id, cogs_account_id, usage_account_id, adjustment_account_id)
        VALUES (:id, :cid, :dvm, :wed, :afe, :tbl, :ans, :rafa, :dli, :iai, :cai, :uai, :aai)
      `, {
        replacements: {
          id: uuidv4(), cid: clinicId,
          dvm: req.body.default_valuation_method || 'weighted_average',
          wed: req.body.warn_expiry_days || 30, afe: !!req.body.auto_flag_expired,
          tbl: !!req.body.track_by_location, ans: !!req.body.allow_negative_stock,
          rafa: req.body.require_approval_for_adjustments_above || 10000,
          dli: req.body.default_location_id || null,
          iai: req.body.inventory_account_id || null, cai: req.body.cogs_account_id || null,
          uai: req.body.usage_account_id || null, aai: req.body.adjustment_account_id || null
        }
      });
    } else {
      // Update
      const fields = [];
      const replacements = { cid: clinicId };
      const allowed = ['default_valuation_method', 'warn_expiry_days', 'auto_flag_expired',
        'track_by_location', 'allow_negative_stock', 'require_approval_for_adjustments_above',
        'default_location_id', 'inventory_account_id', 'cogs_account_id', 'usage_account_id', 'adjustment_account_id'];
      for (const key of allowed) {
        // No backticks — see the same fix in PUT /locations/:id above. This UPDATE
        // threw a Postgres syntax error on every save that touched a real field,
        // so inventory settings could never actually be changed once created.
        if (req.body[key] !== undefined) { fields.push(`${key} = :${key}`); replacements[key] = req.body[key]; }
      }
      if (fields.length > 0) {
        await sequelize.query(`UPDATE inventory_settings SET ${fields.join(', ')} WHERE clinic_id = :cid`, { replacements });
      }
    }

    res.json({ message: 'Settings saved' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ═══════════════════════════════════════════════════
// INVENTORY → ACCOUNTING GL INTEGRATION
// ═══════════════════════════════════════════════════

// Helper: create a journal entry from an inventory transaction
async function createInventoryGLEntry(clinicId, transaction, createdBy) {
  try {
    // Get inventory settings to find linked GL accounts
    const [settings] = await sequelize.query(
      'SELECT * FROM inventory_settings WHERE clinic_id = :cid LIMIT 1',
      { replacements: { cid: clinicId } }
    );

    if (!settings || settings.length === 0) {
      console.log('No inventory settings found for clinic', clinicId, '— skipping GL entry');
      return null;
    }

    const cfg = settings[0];
    const inventoryAccountId = cfg.inventory_account_id;
    const cogsAccountId = cfg.cogs_account_id;
    const usageAccountId = cfg.usage_account_id;
    const adjustmentAccountId = cfg.adjustment_account_id;

    if (!inventoryAccountId) {
      console.log('No inventory GL account configured — skipping GL entry');
      return null;
    }

    const totalCost = Math.abs(parseFloat(transaction.total_cost) || 0);
    if (totalCost === 0) return null;

    let debitAccountId = null;
    let creditAccountId = null;
    let description = '';

    const txType = transaction.transaction_type;

    if (txType === 'receipt') {
      // Receipt: Debit Inventory, Credit AP/Cash
      debitAccountId = inventoryAccountId;
      creditAccountId = cogsAccountId || inventoryAccountId; // fallback
      description = `Inventory receipt: ${transaction.notes || transaction.transaction_number || ''}`;
    } else if (txType === 'dispense' || txType === 'usage') {
      // Usage/Dispense: Debit COGS/Usage, Credit Inventory
      debitAccountId = usageAccountId || cogsAccountId || inventoryAccountId;
      creditAccountId = inventoryAccountId;
      description = `Inventory ${txType}: ${transaction.notes || transaction.transaction_number || ''}`;
    } else if (txType === 'waste' || txType === 'damage') {
      // Waste/Damage: Debit Adjustment/Expense, Credit Inventory
      debitAccountId = adjustmentAccountId || cogsAccountId || inventoryAccountId;
      creditAccountId = inventoryAccountId;
      description = `Inventory ${txType}: ${transaction.notes || transaction.transaction_number || ''}`;
    } else if (txType === 'adjustment') {
      // Adjustment: depends on direction
      if (parseFloat(transaction.quantity_change) > 0) {
        debitAccountId = inventoryAccountId;
        creditAccountId = adjustmentAccountId || inventoryAccountId;
      } else {
        debitAccountId = adjustmentAccountId || inventoryAccountId;
        creditAccountId = inventoryAccountId;
      }
      description = `Inventory adjustment: ${transaction.notes || transaction.transaction_number || ''}`;
    } else if (txType === 'return_to_supplier') {
      // Return: Debit AP/Cash, Credit Inventory
      debitAccountId = cogsAccountId || inventoryAccountId;
      creditAccountId = inventoryAccountId;
      description = `Inventory return: ${transaction.notes || transaction.transaction_number || ''}`;
    } else {
      // Transfer or unknown — no GL impact
      return null;
    }

    if (!debitAccountId || !creditAccountId) return null;

    // Previously hardcoded 'SSP'/'SSP'/1.0 below regardless of the transaction's actual
    // currency — a non-base-currency inventory transaction (e.g. a USD-costed batch use)
    // posted its raw foreign-currency number straight into the GL as if it were already
    // base-currency 1:1. Resolve the real base currency and, if the transaction is in a
    // different currency, the real exchange rate, same pattern used for GL posting
    // elsewhere in the app (see AccountingService.createGLEntry).
    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'SSP';
    const txnCurrency = transaction.cost_currency || baseCurrency;
    let rate = 1;
    if (txnCurrency !== baseCurrency) {
      rate = parseFloat(transaction.exchange_rate) || 0;
      if (!rate) {
        try {
          const AccountingService = require('../services/AccountingService');
          rate = await AccountingService.getExchangeRate(clinicId, txnCurrency, baseCurrency, new Date());
        } catch (rateErr) {
          console.warn(`No ${txnCurrency}->${baseCurrency} rate available for inventory GL entry, posting at 1:1 — base-currency total will be understated:`, rateErr.message);
          rate = 1;
        }
      }
    }
    const baseTotalCost = Math.round(totalCost * rate * 100) / 100;

    // Verify both accounts exist
    const [debitAcct] = await sequelize.query(
      'SELECT id FROM chart_of_accounts WHERE id = :id', { replacements: { id: debitAccountId } }
    );
    const [creditAcct] = await sequelize.query(
      'SELECT id FROM chart_of_accounts WHERE id = :id', { replacements: { id: creditAccountId } }
    );
    if (debitAcct.length === 0 || creditAcct.length === 0) {
      console.log('GL account not found, skipping GL entry');
      return null;
    }

    // Generate JE number
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const [seqResult] = await sequelize.query(
      "SELECT COUNT(*) as cnt FROM journal_entries WHERE je_number LIKE :prefix",
      { replacements: { prefix: `JE-INV-${year}${month}%` } }
    );
    const seq = (seqResult[0]?.cnt || 0) + 1;
    const jeNumber = `JE-INV-${year}${month}-${String(seq).padStart(4, '0')}`;

    const jeId = uuidv4();

    // Create journal entry
    await sequelize.query(`
      INSERT INTO journal_entries (id, clinic_id, je_number, entry_date, description, narration,
        reference, transaction_currency, base_currency, exchange_rate,
        total_debit, total_credit, base_total_debit, base_total_credit,
        status, created_by, created_at, updated_at)
      VALUES (:id, :cid, :je, CURRENT_DATE, :desc, :narr,
        :ref, :txnCurrency, :baseCurrency, :rate,
        :amount, :amount, :baseAmount, :baseAmount,
        'posted', :created_by, NOW(), NOW())
    `, {
      replacements: {
        id: jeId, cid: clinicId, je: jeNumber,
        desc: description, narr: description,
        ref: transaction.transaction_number || transaction.id,
        txnCurrency, baseCurrency, rate,
        amount: totalCost, baseAmount: baseTotalCost,
        created_by: createdBy || 'system'
      }
    });

    // Create debit line
    await sequelize.query(`
      INSERT INTO journal_entry_lines (id, je_id, account_id, debit_amount, credit_amount,
        base_debit_amount, base_credit_amount, description, created_at, updated_at)
      VALUES (:id, :jeId, :acctId, :amount, 0, :baseAmount, 0, :desc, NOW(), NOW())
    `, {
      replacements: {
        id: uuidv4(), jeId, acctId: debitAccountId, amount: totalCost, baseAmount: baseTotalCost, desc: description
      }
    });

    // Create credit line
    await sequelize.query(`
      INSERT INTO journal_entry_lines (id, je_id, account_id, debit_amount, credit_amount,
        base_debit_amount, base_credit_amount, description, created_at, updated_at)
      VALUES (:id, :jeId, :acctId, 0, :amount, 0, :baseAmount, :desc, NOW(), NOW())
    `, {
      replacements: {
        id: uuidv4(), jeId, acctId: creditAccountId, amount: totalCost, baseAmount: baseTotalCost, desc: description
      }
    });

    // This journal_entries/journal_entry_lines pair is invisible to the General Ledger/
    // trial-balance report on its own — that report reads from account_ledger, which
    // nothing here was ever writing to. Every other GL-posting path in this app (billing,
    // accounting, procurement) mirrors its lines into account_ledger; this one didn't.
    try {
      await AccountLedger.bulkCreate([
        { clinic_id: clinicId, account_id: debitAccountId, transaction_date: new Date(), debit_amount: baseTotalCost, credit_amount: 0, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'inventory' },
        { clinic_id: clinicId, account_id: creditAccountId, transaction_date: new Date(), debit_amount: 0, credit_amount: baseTotalCost, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'inventory' },
      ]);
    } catch (ledgerErr) {
      console.error(`Inventory GL entry ${jeNumber} posted to journal_entries but failed to sync to account_ledger — it won't appear on the General Ledger report until reconciled:`, ledgerErr.message);
    }

    console.log(`GL entry ${jeNumber} created for inventory ${txType} (${totalCost} ${txnCurrency} / ${baseTotalCost} ${baseCurrency})`);
    return jeNumber;
  } catch (error) {
    console.error('Error creating inventory GL entry:', error);
    return null; // Non-blocking — don't fail the inventory transaction
  }
}

// POST /gl-entry - manually trigger GL entry for an inventory transaction
router.post('/gl-entry', authorize('inventory.write'), async (req, res) => {
  try {
    const { transaction_id } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    const [txns] = await sequelize.query(
      'SELECT * FROM inventory_transactions WHERE id = :id AND clinic_id = :clinic_id',
      { replacements: { id: transaction_id, clinic_id } }
    );
    if (txns.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    const jeNumber = await createInventoryGLEntry(clinic_id, txns[0], req.body.created_by);
    if (jeNumber) {
      // Link the GL entry back to the transaction
      await sequelize.query(
        'UPDATE inventory_transactions SET gl_entry_id = :je WHERE id = :id',
        { replacements: { je: jeNumber, id: transaction_id } }
      );
      res.json({ message: 'GL entry created', je_number: jeNumber });
    } else {
      res.json({ message: 'No GL entry created — check settings or transaction type' });
    }
  } catch (error) {
    console.error('Error creating GL entry:', error);
    res.status(500).json({ error: 'Failed to create GL entry' });
  }
});

// Make the helper available for use by other route files
router.createInventoryGLEntry = createInventoryGLEntry;

module.exports = router;
