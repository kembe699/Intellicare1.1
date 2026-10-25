const express = require('express');
const { getBaseCurrencyCode } = require('../utils/baseCurrency');
const router = express.Router();
const { sequelize } = require('../models');
const CurrencyService = require('../services/CurrencyService');
const { v4: uuidv4 } = require('uuid');
const { getBranchConditionSQL } = require('../middleware/branchFilter');
const redisCache = require('../services/RedisCache');
const { authorize } = require('../middleware/authorize');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const AccountingService = require('../services/AccountingService');
const { findInsufficientStockLine } = require('../utils/checkDrugStock');
const { resolveDashboardDateRange } = require('../utils/dashboardDateRange');

// This entire file had no authorize() calls at all — every route (including controlled-
// substance dispensing, price edits, and drug-interaction deletes) was reachable by any
// authenticated user regardless of role. Roles mirror what App.tsx already enforces
// client-side per /pharmacy-* page: ['admin','pharmacy'] for DispensingWorkflow/
// PharmacyReturns, ['admin','pharmacy','doctor'] for PrescriptionManagement.
// Controlled-substance stock/audit visibility — narrower than general pharmacy read
// (no doctor access), matching how sensitive this data is everywhere else in healthcare software.
// Was `redisCache.delPattern('|pharmacy')`/`delPattern('|inventory')`, and
// never actually called anywhere in this file. delPattern does a plain
// substring/glob match against the real cache key
// (`ic|${schemaName}|${userId}|${branchId}|${req.originalUrl}` — see
// redisCacheMiddleware.js), and that key's URL segment is
// "/api/pharmacy-module/..." / "/api/inventory/..." — neither ever contains
// the literal substring "|pharmacy" or "|inventory", so this deleted nothing
// even when called. A GET made right after a write (prescribing, dispensing,
// a stock adjustment) kept serving the pre-write response for up to the 60s
// TTL. Fixed to the one pattern already proven to work elsewhere
// (clinical.js's own `ic|${schemaName}|` call) — a whole-tenant cache flush,
// broader than strictly necessary but guaranteed to match the real key
// prefix, same tradeoff that existing call already makes.
function bustPharmacyCache(req) { try { redisCache.delPattern(`ic|${req.tenantSchema}|`); } catch(e) {} }

// Safe schema migration: allow NULL patient_id for walk-in/OTC dispensing.
//
// `ALTER COLUMN ... DROP NOT NULL` is Postgres syntax — this is a MySQL database (see
// src/server/config/database.js), where it's a syntax error every single startup, silently
// swallowed by the catch block below. dispensing_records.patient_id only ended up nullable
// because it was declared that way in its CREATE TABLE; pharmacy_charges and receipts never
// actually got the nullable migration despite the code clearly intending it — walk-in/OTC
// dispensing was broken end-to-end (confirmed: a real dispense with no patient_id 500s on
// the pharmacy_charges insert). Fixed with the correct MySQL MODIFY COLUMN syntax.
(async () => {
  try {
    await sequelize.query("ALTER TABLE dispensing_records MODIFY COLUMN patient_id VARCHAR(36) NULL");
  } catch (e) { /* table may not exist yet */ }
  try {
    await sequelize.query("ALTER TABLE pharmacy_charges MODIFY COLUMN patient_id VARCHAR(36) NULL");
  } catch (e) { /* ignore */ }
  try {
    await sequelize.query("ALTER TABLE receipts MODIFY COLUMN bill_id VARCHAR(36) NULL");
    await sequelize.query("ALTER TABLE receipts MODIFY COLUMN patient_id VARCHAR(255) NULL");
    await sequelize.query("ALTER TABLE receipts MODIFY COLUMN patient_name VARCHAR(255) NULL");
  } catch (e) { /* ignore */ }
})();

// ═══════════════════════════════════════════════════
// PHARMACY ITEMS (from Inventory)
// ═══════════════════════════════════════════════════

// List all inventory items for pharmacy use
router.get('/drugs', authorize('pharmacy.read'), async (req, res) => {
  try {
    const { is_active, category, search, item_category, location_id } = req.query;
    let where = 'WHERE i.clinic_id = :cid';
    const replacements = { cid: BranchQueryFilter.resolveClinicId(req) };

    if (is_active !== undefined) { where += ' AND i.is_active = :active'; replacements.active = is_active === 'true'; }
    if (category || item_category) { where += ' AND i.item_category = :cat'; replacements.cat = category || item_category; }
    if (search) { where += ' AND (i.item_name LIKE :s OR i.item_code LIKE :s OR i.item_description LIKE :s)'; replacements.s = `%${search}%`; }
    const { sql: drugsBranchSQL, params: drugsBranchParams } = getBranchConditionSQL(req, 'i');
    if (drugsBranchSQL) { where += ' AND i.branch_id = :drugsBranchId'; replacements.drugsBranchId = drugsBranchParams[0]; }

    // When a store is picked, report that store's own stock instead of the
    // clinic-wide total — a LEFT JOIN so an item with no stock_by_location
    // row there correctly shows 0 (not stocked at that location) rather
    // than being silently dropped from the list.
    const locationJoin = location_id ? 'LEFT JOIN stock_by_location sbl ON sbl.item_id = i.id AND sbl.location_id = :locationId' : '';
    if (location_id) replacements.locationId = location_id;
    // stocked_only: just what that store holds — the selling-store pickers
    // list only items kept in the store being sold from.
    if (location_id && req.query.stocked_only === 'true') where += ' AND sbl.item_id IS NOT NULL';
    const stockOnHandExpr = location_id ? 'COALESCE(sbl.quantity_on_hand, 0)' : 'i.quantity_on_hand';
    const availableExpr = location_id
      ? 'COALESCE(sbl.quantity_on_hand, 0) - COALESCE(sbl.reserved_quantity, 0)'
      : '(i.quantity_on_hand - i.reserved_quantity)';

    const [rows] = await sequelize.query(`
      SELECT i.id, i.id AS drug_id, i.item_code AS drug_code, i.item_name AS drug_name,
        i.item_description AS drug_description, i.item_category AS therapeutic_category,
        i.unit_of_measure, i.units_per_pack, i.dose_unit_label, i.selling_price, i.current_unit_cost, i.cost_currency,
        ${stockOnHandExpr} AS stock_on_hand, i.minimum_stock_level,
        i.is_active, i.is_controlled_substance, i.item_type,
        i.requires_batch_tracking, i.requires_expiry_tracking,
        i.cogs_account_id, i.inventory_account_id, i.usage_account_id,
        i.id AS inventory_item_id, i.item_name AS inventory_item_name,
        i.notes,
        ${availableExpr} AS available_quantity,
        d.strength, d.dosage_form, d.generic_name,
        d.requires_prescription, d.max_quantity_per_prescription,
        d.drug_allergy_keywords, d.major_drug_interactions,
        d.revenue_account_id AS drug_revenue_account_id
      FROM inventory_items i
      LEFT JOIN drugs d ON d.inventory_item_id = i.id
      ${locationJoin}
      ${where}
      ORDER BY i.item_name
    `, { replacements });

    res.json(rows);
  } catch (error) {
    console.error('Error listing inventory items for pharmacy:', error);
    res.status(500).json({ error: 'Failed to list items' });
  }
});

// Lightweight store list for prescribing/dispensing pickers — same access
// gate as /drugs (pharmacy.read) rather than inventory.read, since a doctor
// who can already see the drug catalog needs to see which stores to pick
// from without being granted broader inventory-management access.
router.get('/locations', authorize('pharmacy.read'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    let where = 'WHERE sl.clinic_id = :cid AND sl.is_active = true';
    const replacements = { cid };
    const { sql: locBranchSQL, params: locBranchParams } = getBranchConditionSQL(req, 'sl');
    if (locBranchSQL) { where += ' AND sl.branch_id = :locBranchId'; replacements.locBranchId = locBranchParams[0]; }

    // is_default lets the Visit Summary's Rx location picker default to
    // whichever location pharmacy_settings.default_pharmacy_location_id
    // names, without a second, more restrictively-gated call to
    // GET /pharmacy-module/settings (pharmacy.admin — most prescribers
    // calling THIS endpoint won't have that).
    const [rows] = await sequelize.query(`
      SELECT sl.id, sl.location_name AS name, sl.location_type AS type, sl.location_code,
             (sl.id = ps.default_pharmacy_location_id) AS is_default
      FROM stock_locations sl
      LEFT JOIN pharmacy_settings ps ON ps.clinic_id = sl.clinic_id
      ${where}
      ORDER BY sl.location_name
    `, { replacements });

    res.json(rows);
  } catch (error) {
    console.error('Error listing pharmacy stock locations:', error);
    res.status(500).json({ error: 'Failed to list locations' });
  }
});

// Get single inventory item for pharmacy
router.get('/drugs/:id', authorize('pharmacy.read'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    const [rows] = await sequelize.query(`
      SELECT i.id, i.id AS drug_id, i.item_code AS drug_code, i.item_name AS drug_name,
        i.item_description AS drug_description, i.item_category AS therapeutic_category,
        i.unit_of_measure, i.units_per_pack, i.dose_unit_label, i.selling_price, i.current_unit_cost, i.cost_currency,
        i.quantity_on_hand AS stock_on_hand, i.minimum_stock_level AS reorder_level,
        i.reorder_quantity, i.is_active, i.is_controlled_substance, i.item_type,
        i.cogs_account_id, i.inventory_account_id,
        i.id AS inventory_item_id, i.item_name AS inventory_item_name,
        i.branch_id,
        i.notes,
        d.strength, d.dosage_form, d.generic_name,
        d.requires_prescription, d.max_quantity_per_prescription,
        d.drug_allergy_keywords, d.major_drug_interactions,
        d.revenue_account_id AS drug_revenue_account_id
      FROM inventory_items i
      LEFT JOIN drugs d ON d.inventory_item_id = i.id
      WHERE i.id = :id AND i.clinic_id = :cid
    `, { replacements: { id: req.params.id, cid } });
    if (rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    // The `drugs` table itself carries no branch_id — this row's branch
    // scope comes from the inventory_items row it's 1:1 with (see
    // inventory.js's GET /items/:id, which applies the same check).
    if (!BranchQueryFilter.canAccessRecord(rows[0], req.branchContext)) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error getting item:', error);
    res.status(500).json({ error: 'Failed to get item' });
  }
});

// Save pharmacy metadata for an inventory item (upsert into drugs table)
router.post('/drugs', authorize('pharmacy.write'), async (req, res) => {
  try {
    const {
      inventory_item_id, clinic_id, strength, dosage_form, generic_name,
      requires_prescription, max_quantity_per_prescription,
      drug_allergy_keywords, major_drug_interactions, revenue_account_id
    } = req.body;

    if (!inventory_item_id) return res.status(400).json({ error: 'inventory_item_id is required. Items must be added from Inventory module.' });

    // Get inventory item info
    const [item] = await sequelize.query('SELECT id, item_code, item_name FROM inventory_items WHERE id = :id', { replacements: { id: inventory_item_id } });
    if (item.length === 0) return res.status(404).json({ error: 'Inventory item not found' });

    // Check if pharmacy metadata already exists
    const [existing] = await sequelize.query('SELECT id FROM drugs WHERE inventory_item_id = :iid', { replacements: { iid: inventory_item_id } });

    if (existing.length > 0) {
      // Update existing
      const fields = [];
      const repl = { id: existing[0].id };
      if (strength !== undefined) { fields.push('strength = :strength'); repl.strength = strength; }
      if (dosage_form !== undefined) { fields.push('dosage_form = :dosage_form'); repl.dosage_form = dosage_form; }
      if (generic_name !== undefined) { fields.push('generic_name = :generic_name'); repl.generic_name = generic_name; }
      if (requires_prescription !== undefined) { fields.push('requires_prescription = :requires_prescription'); repl.requires_prescription = requires_prescription; }
      if (max_quantity_per_prescription !== undefined) { fields.push('max_quantity_per_prescription = :max_qty'); repl.max_qty = max_quantity_per_prescription; }
      if (revenue_account_id !== undefined) { fields.push('revenue_account_id = :rev_acct'); repl.rev_acct = revenue_account_id; }
      if (drug_allergy_keywords !== undefined) { fields.push('drug_allergy_keywords = :allergies'); repl.allergies = JSON.stringify(drug_allergy_keywords); }
      if (major_drug_interactions !== undefined) { fields.push('major_drug_interactions = :interactions'); repl.interactions = JSON.stringify(major_drug_interactions); }
      if (fields.length > 0) await sequelize.query(`UPDATE drugs SET ${fields.join(', ')} WHERE id = :id`, { replacements: repl });
      res.json({ id: existing[0].id, message: 'Pharmacy metadata updated' });
    } else {
      // Create new pharmacy metadata
      const id = uuidv4();
      await sequelize.query(`
        INSERT INTO drugs (id, clinic_id, drug_code, drug_name, inventory_item_id,
          strength, dosage_form, generic_name, requires_prescription,
          max_quantity_per_prescription, revenue_account_id,
          drug_allergy_keywords, major_drug_interactions)
        VALUES (:id, :cid, :code, :name, :iid, :strength, :form, :gname, :rx, :maxqty,
          :rev_acct, :allergies, :interactions)
      `, {
        replacements: {
          id, cid: clinic_id || 1, code: item[0].item_code, name: item[0].item_name,
          iid: inventory_item_id, strength: strength || null, form: dosage_form || null,
          gname: generic_name || null, rx: requires_prescription !== false,
          maxqty: max_quantity_per_prescription || 100,
          rev_acct: revenue_account_id || null,
          allergies: drug_allergy_keywords ? JSON.stringify(drug_allergy_keywords) : null,
          interactions: major_drug_interactions ? JSON.stringify(major_drug_interactions) : null
        }
      });
      res.status(201).json({ id, message: 'Pharmacy metadata saved' });
    }
  } catch (error) {
    console.error('Error saving pharmacy metadata:', error);
    res.status(500).json({ error: 'Failed to save pharmacy metadata' });
  }
});

// Update drug
router.put('/drugs/:id', authorize('pharmacy.write'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);

    // `drugs` carries no branch_id of its own — its branch scope is the
    // inventory_items row it's 1:1 with (via inventory_item_id), same as
    // GET /drugs/:id above.
    const [existingDrugs] = await sequelize.query(
      `SELECT d.id, i.branch_id FROM drugs d LEFT JOIN inventory_items i ON i.id = d.inventory_item_id WHERE d.id = :id AND d.clinic_id = :cid`,
      { replacements: { id: req.params.id, cid } }
    );
    if (existingDrugs.length === 0) return res.status(404).json({ error: 'Drug not found' });
    if (!BranchQueryFilter.canAccessRecord(existingDrugs[0], req.branchContext)) {
      return res.status(404).json({ error: 'Drug not found' });
    }

    const fields = [];
    const replacements = { id: req.params.id, cid };
    const allowed = [
      'drug_name', 'generic_name', 'drug_description', 'inventory_item_id',
      'strength', 'unit_of_measure', 'dosage_form', 'therapeutic_category', 'atc_code',
      'is_controlled_substance', 'is_scheduled', 'price_kes', 'price_usd', 'price_ssp',
      'default_currency', 'revenue_account_id', 'cogs_account_id',
      'requires_prescription', 'max_quantity_per_prescription', 'shelf_life_days',
      'requires_cold_storage', 'notes', 'is_active', 'discontinued_date'
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`\`${key}\` = :${key}`);
        replacements[key] = req.body[key];
      }
    }
    // Handle JSON fields
    if (req.body.drug_allergy_keywords !== undefined) {
      fields.push('drug_allergy_keywords = :allergies');
      replacements.allergies = JSON.stringify(req.body.drug_allergy_keywords);
    }
    if (req.body.major_drug_interactions !== undefined) {
      fields.push('major_drug_interactions = :interactions');
      replacements.interactions = JSON.stringify(req.body.major_drug_interactions);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    await sequelize.query(`UPDATE drugs SET ${fields.join(', ')} WHERE id = :id AND clinic_id = :cid`, { replacements });
    res.json({ message: 'Drug updated' });
  } catch (error) {
    console.error('Error updating drug:', error);
    res.status(500).json({ error: 'Failed to update drug' });
  }
});

// Get stock level for an inventory item (used by pharmacy)
router.get('/drugs/:id/stock-level', authorize('pharmacy.read'), async (req, res) => {
  try {
    const itemId = req.params.id;

    const [stock] = await sequelize.query(`
      SELECT ii.quantity_on_hand, ii.selling_price, ii.cost_currency,
        sbl.location_id, sl.location_name, sbl.quantity_on_hand AS location_qty
      FROM inventory_items ii
      LEFT JOIN stock_by_location sbl ON ii.id = sbl.item_id
      LEFT JOIN stock_locations sl ON sbl.location_id = sl.id
      WHERE ii.id = :iid
    `, { replacements: { iid: itemId } });

    if (stock.length === 0) return res.json({ total_stock: 0, batches: [], selling_price: 0 });

    const [batches] = await sequelize.query(`
      SELECT id, batch_number, (quantity_received - quantity_used) AS quantity_remaining, expiry_date, unit_cost,
        ((expiry_date)::date - (CURRENT_DATE)::date) AS days_to_expiry,
        status
      FROM inventory_batches
      WHERE item_id = :iid AND status = 'active' AND (quantity_received - quantity_used) > 0
      ORDER BY expiry_date ASC
    `, { replacements: { iid: itemId } });

    res.json({
      total_stock: stock[0].quantity_on_hand || 0,
      selling_price: stock[0].selling_price || 0,
      cost_currency: stock[0].cost_currency || (await getBaseCurrencyCode()),
      locations: stock,
      batches
    });
  } catch (error) {
    console.error('Error getting stock level:', error);
    res.status(500).json({ error: 'Failed to get stock level' });
  }
});

// Update drug price
router.post('/drugs/:id/update-price', authorize('pharmacy.write'), async (req, res) => {
  try {
    const { price_currency, price_amount, reason, changed_by } = req.body;
    const drugId = req.params.id;
    const col = price_currency === 'USD' ? 'price_usd' : price_currency === 'SSP' ? 'price_ssp' : 'price_kes';

    // Get old price
    const [old] = await sequelize.query(`SELECT ${col} AS old_price FROM drugs WHERE id = :id`, { replacements: { id: drugId } });

    // Update price
    await sequelize.query(`UPDATE drugs SET ${col} = :price WHERE id = :id`, { replacements: { price: price_amount, id: drugId } });

    // Record history
    const fallbackCurrency = price_currency || (await CurrencyService.getBaseCurrency()).code;
    await sequelize.query(`
      INSERT INTO drug_pricing_history (id, drug_id, price_currency, price_amount, effective_from, reason_for_change, changed_by)
      VALUES (:id, :did, :curr, :amt, CURRENT_DATE, :reason, :by)
    `, {
      replacements: { id: uuidv4(), did: drugId, curr: fallbackCurrency, amt: price_amount, reason: reason || null, by: changed_by || null }
    });

    res.json({ message: 'Price updated', old_price: old[0]?.old_price, new_price: price_amount });
  } catch (error) {
    console.error('Error updating price:', error);
    res.status(500).json({ error: 'Failed to update price' });
  }
});

// Get drug pricing history
router.get('/drugs/:id/pricing-history', authorize('pharmacy.read'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT dph.*, u.display_name AS changed_by_name
      FROM drug_pricing_history dph
      LEFT JOIN users u ON dph.changed_by = u.id
      WHERE dph.drug_id = :id ORDER BY dph.effective_from DESC
    `, { replacements: { id: req.params.id } });
    res.json(rows);
  } catch (error) {
    console.error('Error getting pricing history:', error);
    res.status(500).json({ error: 'Failed to get pricing history' });
  }
});

// Get drug interactions for a drug
router.get('/drugs/:id/interactions', authorize('pharmacy.read'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT di.*,
        d1.drug_name AS drug1_name, d2.drug_name AS drug2_name
      FROM drug_interactions di
      LEFT JOIN drugs d1 ON di.drug1_id = d1.id
      LEFT JOIN drugs d2 ON di.drug2_id = d2.id
      WHERE (di.drug1_id = :id OR di.drug2_id = :id) AND di.is_active = true
    `, { replacements: { id: req.params.id } });
    res.json(rows);
  } catch (error) {
    console.error('Error getting interactions:', error);
    res.status(500).json({ error: 'Failed to get interactions' });
  }
});

// ═══════════════════════════════════════════════════
// DRUG INTERACTIONS - CRUD
// ═══════════════════════════════════════════════════

router.get('/drug-interactions', authorize('pharmacy.read'), async (req, res) => {
  try {
    const { severity } = req.query;
    let where = 'WHERE di.is_active = true';
    const replacements = {};
    if (severity) { where += ' AND di.interaction_type = :sev'; replacements.sev = severity; }

    const [rows] = await sequelize.query(`
      SELECT di.*, d1.drug_name AS drug1_name, d2.drug_name AS drug2_name
      FROM drug_interactions di
      LEFT JOIN drugs d1 ON di.drug1_id = d1.id
      LEFT JOIN drugs d2 ON di.drug2_id = d2.id
      ${where} ORDER BY di.interaction_type, d1.drug_name
    `, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing interactions:', error);
    res.status(500).json({ error: 'Failed to list interactions' });
  }
});

router.post('/drug-interactions', authorize('pharmacy.write'), async (req, res) => {
  try {
    const id = uuidv4();
    const { drug1_id, drug2_id, interaction_type, interaction_description, management_notes } = req.body;
    await sequelize.query(`
      INSERT INTO drug_interactions (id, drug1_id, drug2_id, interaction_type, interaction_description, management_notes)
      VALUES (:id, :d1, :d2, :type, :desc, :mgmt)
    `, { replacements: { id, d1: drug1_id, d2: drug2_id, type: interaction_type || 'moderate', desc: interaction_description || null, mgmt: management_notes || null } });
    res.status(201).json({ id, message: 'Interaction created' });
  } catch (error) {
    console.error('Error creating interaction:', error);
    res.status(500).json({ error: 'Failed to create interaction' });
  }
});

router.put('/drug-interactions/:id', authorize('pharmacy.write'), async (req, res) => {
  try {
    const fields = [];
    const replacements = { id: req.params.id };
    for (const key of ['interaction_type', 'interaction_description', 'management_notes', 'is_active']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = :${key}`); replacements[key] = req.body[key]; }
    }
    if (fields.length > 0) await sequelize.query(`UPDATE drug_interactions SET ${fields.join(', ')} WHERE id = :id`, { replacements });
    res.json({ message: 'Interaction updated' });
  } catch (error) {
    console.error('Error updating interaction:', error);
    res.status(500).json({ error: 'Failed to update interaction' });
  }
});

router.delete('/drug-interactions/:id', authorize('pharmacy.write'), async (req, res) => {
  try {
    await sequelize.query('UPDATE drug_interactions SET is_active = false WHERE id = :id', { replacements: { id: req.params.id } });
    res.json({ message: 'Interaction deactivated' });
  } catch (error) {
    console.error('Error deleting interaction:', error);
    res.status(500).json({ error: 'Failed to delete interaction' });
  }
});

// ═══════════════════════════════════════════════════
// PATIENT DRUG ALLERGIES
// ═══════════════════════════════════════════════════

router.get('/patient-allergies/:patientId', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT da.*, d.drug_name
      FROM drug_allergies da
      LEFT JOIN drugs d ON da.drug_id = d.id
      WHERE da.patient_id = :pid ORDER BY da.created_at DESC
    `, { replacements: { pid: req.params.patientId } });
    res.json(rows);
  } catch (error) {
    console.error('Error getting allergies:', error);
    res.status(500).json({ error: 'Failed to get allergies' });
  }
});

router.post('/patient-allergies', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const id = uuidv4();
    const { patient_id, drug_id, drug_class, allergy_description, severity, reaction_description, verified_by } = req.body;
    await sequelize.query(`
      INSERT INTO drug_allergies (id, clinic_id, patient_id, drug_id, drug_class, allergy_description, severity, reaction_description, verified_date, verified_by)
      VALUES (:id, :cid, :pid, :did, :dc, :desc, :sev, :react, CURRENT_DATE, :vby)
    `, {
      replacements: {
        id, cid: BranchQueryFilter.resolveClinicId(req), pid: patient_id, did: drug_id || null,
        dc: drug_class || null, desc: allergy_description || null,
        sev: severity || 'moderate', react: reaction_description || null, vby: verified_by || null
      }
    });
    res.status(201).json({ id, message: 'Allergy recorded' });
  } catch (error) {
    console.error('Error recording allergy:', error);
    res.status(500).json({ error: 'Failed to record allergy' });
  }
});

router.put('/patient-allergies/:id', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const fields = [];
    const replacements = { id: req.params.id };
    for (const key of ['drug_id', 'drug_class', 'allergy_description', 'severity', 'reaction_description', 'verified_by']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = :${key}`); replacements[key] = req.body[key]; }
    }
    if (fields.length > 0) await sequelize.query(`UPDATE drug_allergies SET ${fields.join(', ')} WHERE id = :id`, { replacements });
    res.json({ message: 'Allergy updated' });
  } catch (error) {
    console.error('Error updating allergy:', error);
    res.status(500).json({ error: 'Failed to update allergy' });
  }
});

router.delete('/patient-allergies/:id', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    await sequelize.query('DELETE FROM drug_allergies WHERE id = :id', { replacements: { id: req.params.id } });
    res.json({ message: 'Allergy removed' });
  } catch (error) {
    console.error('Error deleting allergy:', error);
    res.status(500).json({ error: 'Failed to delete allergy' });
  }
});

// ═══════════════════════════════════════════════════
// PRESCRIPTIONS
// ═══════════════════════════════════════════════════

// List clinical (doctor) prescriptions from the prescriptions table
router.get('/clinical-prescriptions', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const { status, patient_id, from_date, to_date } = req.query;
    let where = 'WHERE v.clinic_id = :cid';
    const replacements = { cid: BranchQueryFilter.resolveClinicId(req) };

    if (status === 'active') { where += " AND pr.status = 'active'"; }
    else if (status === 'completed') { where += " AND pr.status = 'completed'"; }
    else if (status === 'cancelled') { where += " AND pr.status = 'cancelled'"; }
    if (patient_id) { where += ' AND pr.patient_id = :pid'; replacements.pid = patient_id; }
    if (from_date) { where += ' AND pr.prescribed_at >= :fd'; replacements.fd = `${from_date} 00:00:00`; }
    if (to_date) { where += ' AND pr.prescribed_at <= :td'; replacements.td = `${to_date} 23:59:59`; }
    // Branch isolation via visits table (prescriptions has no branch_id column)
    const { sql: branchSQL, params: branchParams } = getBranchConditionSQL(req, 'v');
    if (branchSQL) { where += ' AND v.branch_id = :branchId'; replacements.branchId = branchParams[0]; }

    const [rows] = await sequelize.query(`
      SELECT pr.*, (p.first_name || ' ' || p.last_name) AS patient_name_joined,
        v.chief_complaint, v.visit_date, v.doctor_name
      FROM prescriptions pr
      LEFT JOIN patients p ON pr.patient_id = p.id
      LEFT JOIN visits v ON pr.visit_id = v.id
      ${where}
      ORDER BY pr.prescribed_at DESC
    `, { replacements });

    // Group by visit_id to create prescription groups
    const grouped = {};
    for (const row of rows) {
      const vid = row.visit_id || row.id;
      if (!grouped[vid]) {
        grouped[vid] = {
          id: vid,
          source: 'clinical',
          visit_id: row.visit_id,
          patient_id: row.patient_id,
          patient_name: row.patient_name || row.patient_name_joined || 'Unknown',
          doctor_name: row.prescribed_by || row.doctor_name || '—',
          prescription_date: row.prescribed_at,
          visit_date: row.visit_date,
          chief_complaints: row.chief_complaint,
          status: row.status,
          line_count: 0,
          dispensed_count: 0,
          medications: [],
        };
      }
      grouped[vid].line_count++;
      if (row.status === 'completed') grouped[vid].dispensed_count++;
      grouped[vid].medications.push({
        id: row.id,
        medication_name: row.medication_name,
        take_instructions: row.take_instructions,
        frequency: row.frequency,
        duration: row.duration,
        quantity: row.quantity,
        instructions: row.instructions,
        status: row.status,
      });
    }

    res.json(Object.values(grouped));
  } catch (error) {
    console.error('Error listing clinical prescriptions:', error);
    res.status(500).json({ error: 'Failed to list clinical prescriptions' });
  }
});

// List prescriptions
router.get('/prescriptions', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const { status, patient_id, from_date, to_date } = req.query;
    let where = 'WHERE pp.clinic_id = :cid';
    const replacements = { cid: BranchQueryFilter.resolveClinicId(req) };

    if (status && status !== 'all') {
      // Comma-separated so callers (e.g. the dispensing queue) can ask for
      // both 'pending' and 'partial_dispensed' prescriptions in one request —
      // a partially-dispensed prescription still has pending lines to dispense.
      const statusList = status.split(',').map(s => s.trim()).filter(Boolean);
      where += ' AND pp.status IN (:statusList)';
      replacements.statusList = statusList;
    }
    if (patient_id) { where += ' AND pp.patient_id = :pid'; replacements.pid = patient_id; }
    if (from_date) { where += ' AND pp.prescription_date >= :fd'; replacements.fd = from_date; }
    if (to_date) { where += ' AND pp.prescription_date <= :td'; replacements.td = to_date; }
    const { sql: rxBranchSQL, params: rxBranchParams } = getBranchConditionSQL(req, 'pp');
    if (rxBranchSQL) { where += ' AND pp.branch_id = :rxBranchId'; replacements.rxBranchId = rxBranchParams[0]; }

    const [rows] = await sequelize.query(`
      SELECT pp.*,
        COALESCE((p.first_name || ' ' || p.last_name), (lp.first_name || ' ' || lp.last_name)) AS patient_name,
        u.display_name AS doctor_name,
        (SELECT COUNT(*) FROM prescription_lines pl WHERE pl.prescription_id = pp.id) AS line_count,
        (SELECT COUNT(*) FROM prescription_lines pl WHERE pl.prescription_id = pp.id AND pl.status = 'dispensed') AS dispensed_count
      FROM pharmacy_prescriptions pp
      LEFT JOIN patients p ON pp.patient_id = p.id
      LEFT JOIN lis_participants lp ON pp.patient_id = lp.id
      LEFT JOIN users u ON pp.doctor_id = u.id
      ${where}
      ORDER BY pp.prescription_date DESC, pp.created_at DESC
    `, { replacements });

    res.json(rows);
  } catch (error) {
    console.error('Error listing prescriptions:', error);
    res.status(500).json({ error: 'Failed to list prescriptions' });
  }
});

// Get prescription with lines
router.get('/prescriptions/:id', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    const rxReplacements = { id: req.params.id, cid };
    let rxWhere = 'WHERE pp.id = :id AND pp.clinic_id = :cid';
    const { sql: rxBranchSQL, params: rxBranchParams } = getBranchConditionSQL(req, 'pp');
    if (rxBranchSQL) { rxWhere += ' AND pp.branch_id = :rxBranchId'; rxReplacements.rxBranchId = rxBranchParams[0]; }
    const [rx] = await sequelize.query(`
      SELECT pp.*,
        COALESCE((p.first_name || ' ' || p.last_name), (lp.first_name || ' ' || lp.last_name)) AS patient_name,
        lp.participant_number AS patient_number,
        u.display_name AS doctor_name
      FROM pharmacy_prescriptions pp
      LEFT JOIN patients p ON pp.patient_id = p.id
      LEFT JOIN lis_participants lp ON pp.patient_id = lp.id
      LEFT JOIN users u ON pp.doctor_id = u.id
      ${rxWhere}
    `, { replacements: rxReplacements });
    if (rx.length === 0) return res.status(404).json({ error: 'Prescription not found' });

    const [lines] = await sequelize.query(`
      SELECT pl.*, COALESCE(ii.item_name, pl.external_drug_name) AS drug_name, ii.item_code AS drug_code,
        ii.selling_price, ii.cost_currency,
        ii.quantity_on_hand AS stock_on_hand,
        ii.units_per_pack, ii.dose_unit_label, ii.unit_of_measure AS pack_unit_of_measure,
        ii.id AS inventory_item_id,
        d.generic_name, d.strength, d.dosage_form
      FROM prescription_lines pl
      LEFT JOIN inventory_items ii ON pl.drug_id = ii.id
      LEFT JOIN drugs d ON d.inventory_item_id = pl.drug_id
      WHERE pl.prescription_id = :id ORDER BY pl.line_number
    `, { replacements: { id: req.params.id } });

    res.json({ ...rx[0], lines });
  } catch (error) {
    console.error('Error getting prescription:', error);
    res.status(500).json({ error: 'Failed to get prescription' });
  }
});

// Create prescription
router.post('/prescriptions', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const id = uuidv4();
    const {
      clinic_id, visit_id, patient_id, doctor_id, prescription_date,
      prescribed_by_name, prescription_notes, special_instructions,
      valid_for_days, number_of_refills_allowed, lines
    } = req.body;

    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });

    if (lines && lines.length > 0) {
      const insufficient = await findInsufficientStockLine(sequelize, lines.map((l) => ({
        drugId: l.drug_id, quantity: l.quantity_prescribed, isExternal: !!l.is_external || (!l.drug_id && !!l.external_drug_name),
        locationId: l.location_id || null,
      })));
      if (insufficient) {
        return res.status(400).json({
          error: `Only ${insufficient.available} ${insufficient.drugName ? `of ${insufficient.drugName} ` : ''}in stock — reduce the quantity, or mark it as bought from an outside pharmacy.`,
        });
      }
    }

    // Generate RX number
    const now = new Date();
    const prefix = `RX-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [countResult] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM pharmacy_prescriptions WHERE prescription_number LIKE :prefix",
      { replacements: { prefix: `${prefix}%` } }
    );
    const seq = (countResult[0]?.cnt || 0) + 1;
    const rxNumber = `${prefix}-${String(seq).padStart(4, '0')}`;

    const rxDate = prescription_date || now.toISOString().split('T')[0];
    const validDays = valid_for_days || 30;
    const expiresDate = new Date(new Date(rxDate).getTime() + validDays * 86400000).toISOString().split('T')[0];

    await sequelize.query(`
      INSERT INTO pharmacy_prescriptions (id, clinic_id, branch_id, prescription_number, visit_id, patient_id, doctor_id,
        prescription_date, prescribed_by_name, prescription_notes, special_instructions,
        status, expires_date, valid_for_days, number_of_refills_allowed)
      VALUES (:id, :cid, :branchId, :rxn, :vid, :pid, :did, :rxdate, :pname, :notes, :instr,
        'pending', :exp, :vdays, :refills)
    `, {
      replacements: {
        id, cid: clinic_id || 1,
        // Stamp the branch. Reads filter on it, so a row left NULL is invisible
        // to everyone except an admin, who bypasses the filter — which is why
        // this looked like "pharmacy sees nothing" rather than a missing column.
        branchId: req.branchContext?.branchId || req.user?.branchId || null,
        rxn: rxNumber, vid: visit_id || null,
        pid: patient_id, did: doctor_id || null, rxdate: rxDate,
        pname: prescribed_by_name || null, notes: prescription_notes || null,
        instr: special_instructions || null, exp: expiresDate,
        vdays: validDays, refills: number_of_refills_allowed || 0
      }
    });

    // Add lines if provided
    if (lines && lines.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // An external line is a drug this pharmacy does not stock: it carries a
        // typed name instead of a drug_id, and is_external is what keeps it out
        // of the dispensing queue while still appearing on the printed script.
        const isExternal = !!line.is_external || (!line.drug_id && !!line.external_drug_name);
        await sequelize.query(`
          INSERT INTO prescription_lines (id, prescription_id, line_number, drug_id,
            quantity_prescribed, unit_of_measure, dose_strength, frequency, duration_days,
            allow_generic_substitution, notes, is_external, external_drug_name, dose_amount,
            location_id, location_name)
          VALUES (:id, :rxid, :ln, :did, :qty, :uom, :ds, :freq, :dur, :gen, :notes, :ext, :extname, :doseamt,
            :locationId, :locationName)
        `, {
          replacements: {
            id: uuidv4(), rxid: id, ln: i + 1, did: isExternal ? null : (line.drug_id || null),
            ext: isExternal, extname: isExternal ? (line.external_drug_name || line.drug_name || null) : null,
            doseamt: line.dose_amount != null && line.dose_amount !== '' ? Number(line.dose_amount) : null,
            qty: line.quantity_prescribed || 1, uom: line.unit_of_measure || 'tablet',
            ds: line.dose_strength || null, freq: line.frequency || null,
            dur: line.duration_days || null, gen: line.allow_generic_substitution !== false,
            notes: line.notes || null,
            locationId: isExternal ? null : (line.location_id || null),
            locationName: isExternal ? null : (line.location_name || null),
          }
        });
      }
    }

    bustPharmacyCache(req);
    res.status(201).json({ id, prescription_number: rxNumber, message: 'Prescription created' });
  } catch (error) {
    console.error('Error creating prescription:', error);
    res.status(500).json({ error: 'Failed to create prescription' });
  }
});

// Update prescription
router.put('/prescriptions/:id', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const fields = [];
    const replacements = { id: req.params.id };
    for (const key of ['prescription_notes', 'special_instructions', 'status', 'cancelled_date', 'cancellation_reason']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = :${key}`); replacements[key] = req.body[key]; }
    }
    if (fields.length > 0) await sequelize.query(`UPDATE pharmacy_prescriptions SET ${fields.join(', ')} WHERE id = :id`, { replacements });
    res.json({ message: 'Prescription updated' });
  } catch (error) {
    console.error('Error updating prescription:', error);
    res.status(500).json({ error: 'Failed to update prescription' });
  }
});

// Cancel prescription
router.post('/prescriptions/:id/cancel', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const { reason } = req.body;
    await sequelize.query(
      "UPDATE pharmacy_prescriptions SET status = 'cancelled', cancelled_date = CURRENT_DATE, cancellation_reason = :reason WHERE id = :id",
      { replacements: { id: req.params.id, reason: reason || null } }
    );
    // Cancel all pending lines
    await sequelize.query(
      "UPDATE prescription_lines SET status = 'cancelled' WHERE prescription_id = :id AND status = 'pending'",
      { replacements: { id: req.params.id } }
    );

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Pharmacy', action: 'PRESCRIPTION_CANCELLED', entity_type: 'Prescription', entity_id: req.params.id,
        description: `Prescription cancelled${reason ? ` — ${reason}` : ''}`,
        new_values: { reason: reason || null }, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ message: 'Prescription cancelled' });
  } catch (error) {
    console.error('Error cancelling prescription:', error);
    res.status(500).json({ error: 'Failed to cancel prescription' });
  }
});

// Allergy check for prescription
router.post('/prescriptions/:id/allergy-check', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const { checked_by } = req.body;
    // Get prescription lines (drug_id now references inventory_items)
    const [lines] = await sequelize.query(`
      SELECT pl.drug_id, ii.item_name AS drug_name, d.drug_allergy_keywords
      FROM prescription_lines pl
      JOIN inventory_items ii ON pl.drug_id = ii.id
      LEFT JOIN drugs d ON d.inventory_item_id = ii.id
      WHERE pl.prescription_id = :id AND pl.status != 'cancelled'
    `, { replacements: { id: req.params.id } });

    // Get patient
    const [rx] = await sequelize.query('SELECT patient_id FROM pharmacy_prescriptions WHERE id = :id', { replacements: { id: req.params.id } });
    if (rx.length === 0) return res.status(404).json({ error: 'Prescription not found' });

    // Get patient allergies
    const [allergies] = await sequelize.query('SELECT * FROM drug_allergies WHERE patient_id = :pid', { replacements: { pid: rx[0].patient_id } });

    const warnings = [];
    for (const line of lines) {
      for (const allergy of allergies) {
        // Check direct drug match
        if (allergy.drug_id && allergy.drug_id === line.drug_id) {
          warnings.push({ drug: line.drug_name, allergy: allergy.allergy_description, severity: allergy.severity, type: 'DIRECT_MATCH' });
        }
        // Check drug class match
        if (allergy.drug_class && line.drug_allergy_keywords) {
          try {
            const keywords = typeof line.drug_allergy_keywords === 'string' ? JSON.parse(line.drug_allergy_keywords) : line.drug_allergy_keywords;
            if (Array.isArray(keywords) && keywords.some(k => k.toLowerCase() === allergy.drug_class.toLowerCase())) {
              warnings.push({ drug: line.drug_name, allergy_class: allergy.drug_class, severity: allergy.severity, type: 'CLASS_MATCH' });
            }
          } catch (e) { /* ignore parse errors */ }
        }
      }
    }

    // Update prescription
    await sequelize.query(`
      UPDATE pharmacy_prescriptions SET allergy_check_done = true, allergy_check_date = CURRENT_DATE,
        allergy_check_by_id = :by, allergy_warnings = :warnings WHERE id = :id
    `, { replacements: { by: checked_by || null, warnings: JSON.stringify(warnings), id: req.params.id } });

    res.json({ warnings, allergy_check_done: true });
  } catch (error) {
    console.error('Error checking allergies:', error);
    res.status(500).json({ error: 'Failed to check allergies' });
  }
});

// Interaction check for prescription
router.post('/prescriptions/:id/interaction-check', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    // Get prescription items (drug_id now references inventory_items)
    const [lines] = await sequelize.query(`
      SELECT pl.drug_id, ii.item_name AS drug_name FROM prescription_lines pl
      JOIN inventory_items ii ON pl.drug_id = ii.id
      WHERE pl.prescription_id = :id AND pl.status != 'cancelled'
    `, { replacements: { id: req.params.id } });

    const drugIds = lines.map(l => l.drug_id);
    const warnings = [];

    // Check pairwise interactions
    for (let i = 0; i < drugIds.length; i++) {
      for (let j = i + 1; j < drugIds.length; j++) {
        const [interactions] = await sequelize.query(`
          SELECT * FROM drug_interactions
          WHERE is_active = true
            AND ((drug1_id = :d1 AND drug2_id = :d2) OR (drug1_id = :d2 AND drug2_id = :d1))
        `, { replacements: { d1: drugIds[i], d2: drugIds[j] } });

        for (const inter of interactions) {
          warnings.push({
            drug1: lines[i].drug_name, drug2: lines[j].drug_name,
            severity: inter.interaction_type, description: inter.interaction_description,
            management: inter.management_notes
          });
        }
      }
    }

    await sequelize.query(`
      UPDATE pharmacy_prescriptions SET interaction_check_done = true, interaction_check_date = CURRENT_DATE,
        interaction_warnings = :warnings WHERE id = :id
    `, { replacements: { warnings: JSON.stringify(warnings), id: req.params.id } });

    res.json({ warnings, interaction_check_done: true });
  } catch (error) {
    console.error('Error checking interactions:', error);
    res.status(500).json({ error: 'Failed to check interactions' });
  }
});

// Add prescription line
router.post('/prescriptions/:id/lines', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const lineId = uuidv4();
    const { drug_id, quantity_prescribed, unit_of_measure, dose_strength, frequency, duration_days, notes, location_id, location_name } = req.body;

    const [maxLine] = await sequelize.query('SELECT COALESCE(MAX(line_number), 0) AS mx FROM prescription_lines WHERE prescription_id = :id', { replacements: { id: req.params.id } });
    const lineNum = (maxLine[0]?.mx || 0) + 1;

    await sequelize.query(`
      INSERT INTO prescription_lines (id, prescription_id, line_number, drug_id, quantity_prescribed,
        unit_of_measure, dose_strength, frequency, duration_days, notes, location_id, location_name)
      VALUES (:id, :rxid, :ln, :did, :qty, :uom, :ds, :freq, :dur, :notes, :locationId, :locationName)
    `, {
      replacements: {
        id: lineId, rxid: req.params.id, ln: lineNum, did: drug_id,
        qty: quantity_prescribed || 1, uom: unit_of_measure || 'tablet',
        ds: dose_strength || null, freq: frequency || null, dur: duration_days || null,
        notes: notes || null,
        // The store it is dispensed from (the screen's selling store).
        locationId: location_id || null, locationName: location_name || null,
      }
    });

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Pharmacy', action: 'PRESCRIPTION_LINE_ADDED', entity_type: 'Prescription', entity_id: req.params.id,
        description: `Drug added to prescription — qty ${quantity_prescribed || 1}`,
        new_values: { drug_id, quantity_prescribed: quantity_prescribed || 1 }, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.status(201).json({ id: lineId, line_number: lineNum, message: 'Line added' });
  } catch (error) {
    console.error('Error adding prescription line:', error);
    res.status(500).json({ error: 'Failed to add line' });
  }
});

// Remove a prescription line before it's dispensed — lets a pharmacist correct an
// order (wrong drug, out of stock, etc.) before payment, rather than dispensing the
// whole prescription as originally written or cancelling it entirely. Also reconciles
// the patient's still-unpaid bill so the removed item isn't charged for.
router.delete('/prescriptions/:id/lines/:lineId', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const { id, lineId } = req.params;
    const [lines] = await sequelize.query(
      `SELECT pl.status, pl.total_quantity_dispensed, pl.quantity_prescribed, ii.item_name AS drug_name, pp.patient_id, pp.clinic_id
       FROM prescription_lines pl
       JOIN pharmacy_prescriptions pp ON pp.id = pl.prescription_id
       LEFT JOIN inventory_items ii ON pl.drug_id = ii.id
       WHERE pl.id = :lineId AND pl.prescription_id = :id`,
      { replacements: { lineId, id } }
    );
    if (lines.length === 0) return res.status(404).json({ error: 'Line not found' });
    const line = lines[0];
    if (line.status === 'cancelled') return res.status(400).json({ error: 'This item was already removed' });
    if ((line.total_quantity_dispensed || 0) > 0) {
      return res.status(400).json({ error: 'Cannot remove — this item has already been dispensed' });
    }

    await sequelize.query("UPDATE prescription_lines SET status = 'cancelled' WHERE id = :lineId", { replacements: { lineId } });

    // Best-effort: drop the matching unpaid charge from the patient's active bill.
    // Never blocks the line removal itself if this can't be reconciled cleanly.
    let billAdjusted = false;
    try {
      const [bills] = await sequelize.query(
        `SELECT id, services, total_amount, paid_amount FROM patient_bills
         WHERE patient_id = :pid AND clinic_id = :cid AND status != 'cancelled'
         ORDER BY created_at DESC LIMIT 1`,
        { replacements: { pid: line.patient_id, cid: line.clinic_id } }
      );
      if (bills.length > 0 && line.drug_name) {
        const bill = bills[0];
        let services = typeof bill.services === 'string' ? JSON.parse(bill.services) : (bill.services || []);
        if (typeof services === 'string') services = JSON.parse(services); // guard against double-stringified rows
        const idx = services.findIndex(s =>
          !s.isVoided && !s.paid &&
          String(s.serviceName || '').toLowerCase() === String(line.drug_name).toLowerCase() &&
          Number(s.quantity) === Number(line.quantity_prescribed)
        );
        if (idx !== -1) {
          services.splice(idx, 1);
          const newTotal = services.filter(s => !s.isVoided).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0);
          const paidAmount = parseFloat(bill.paid_amount) || 0;
          const newBalance = Math.max(0, newTotal - paidAmount);
          const newStatus = newBalance <= 0.01 ? (paidAmount > 0 ? 'paid' : 'pending') : (paidAmount > 0 ? 'partial' : 'pending');
          await sequelize.query(
            'UPDATE patient_bills SET services = :services, total_amount = :total, balance_amount = :balance, status = :status, updated_at = NOW() WHERE id = :billId',
            { replacements: { services: JSON.stringify(services), total: newTotal, balance: newBalance, status: newStatus, billId: bill.id } }
          );
          await require('../services/AccountingService').stampBillBaseCurrency(bill.id);
          billAdjusted = true;
        }
      }
    } catch (billError) {
      console.error('Error reconciling bill after removing prescription line:', billError);
    }

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: line.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Pharmacy', action: 'PRESCRIPTION_LINE_REMOVED', entity_type: 'Prescription', entity_id: id,
        description: `Removed "${line.drug_name || 'item'}" from prescription before dispensing${billAdjusted ? ' (bill adjusted)' : ''}`,
        old_values: { drug_name: line.drug_name, quantity_prescribed: line.quantity_prescribed }, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ message: 'Line removed', billAdjusted });
  } catch (error) {
    console.error('Error removing prescription line:', error);
    res.status(500).json({ error: 'Failed to remove line' });
  }
});

// Adjust the ordered quantity on a not-yet-dispensed line — lets a pharmacist correct
// an order size before it's paid for/dispensed, without having to remove and re-add the
// whole line. Mirrors the bill-reconciliation approach used by the DELETE handler above:
// finds the matching still-unpaid charge by name+old quantity and rewrites its
// quantity/total instead of leaving the bill silently out of sync with the order.
router.put('/prescriptions/:id/lines/:lineId', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const { id, lineId } = req.params;
    const newQty = parseInt(req.body.quantity_prescribed, 10);
    if (!newQty || newQty <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero' });

    const [lines] = await sequelize.query(
      `SELECT pl.status, pl.total_quantity_dispensed, pl.quantity_prescribed, pl.unit_of_measure,
              ii.item_name AS drug_name, ii.selling_price, pp.patient_id, pp.clinic_id
       FROM prescription_lines pl
       JOIN pharmacy_prescriptions pp ON pp.id = pl.prescription_id
       LEFT JOIN inventory_items ii ON pl.drug_id = ii.id
       WHERE pl.id = :lineId AND pl.prescription_id = :id`,
      { replacements: { lineId, id } }
    );
    if (lines.length === 0) return res.status(404).json({ error: 'Line not found' });
    const line = lines[0];
    if (line.status === 'cancelled') return res.status(400).json({ error: 'This item was removed' });
    if ((line.total_quantity_dispensed || 0) > 0) {
      return res.status(400).json({ error: 'Cannot change quantity — this item has already been dispensed' });
    }

    await sequelize.query('UPDATE prescription_lines SET quantity_prescribed = :qty WHERE id = :lineId', { replacements: { qty: newQty, lineId } });

    // Best-effort: keep the matching unpaid bill line item's quantity/total in sync.
    let billAdjusted = false;
    try {
      const [bills] = await sequelize.query(
        `SELECT id, services, paid_amount FROM patient_bills
         WHERE patient_id = :pid AND clinic_id = :cid AND status != 'cancelled'
         ORDER BY created_at DESC LIMIT 1`,
        { replacements: { pid: line.patient_id, cid: line.clinic_id } }
      );
      if (bills.length > 0 && line.drug_name) {
        const bill = bills[0];
        let services = typeof bill.services === 'string' ? JSON.parse(bill.services) : (bill.services || []);
        if (typeof services === 'string') services = JSON.parse(services);
        const idx = services.findIndex(s =>
          !s.isVoided && !s.paid &&
          String(s.serviceName || '').toLowerCase() === String(line.drug_name).toLowerCase() &&
          Number(s.quantity) === Number(line.quantity_prescribed)
        );
        if (idx !== -1) {
          const unitPrice = parseFloat(services[idx].unitPrice) || 0;
          services[idx].quantity = newQty;
          services[idx].totalPrice = parseFloat((unitPrice * newQty).toFixed(2));
          const newTotal = services.filter(s => !s.isVoided).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0);
          const paidAmount = parseFloat(bill.paid_amount) || 0;
          const newBalance = Math.max(0, newTotal - paidAmount);
          const newStatus = newBalance <= 0.01 ? (paidAmount > 0 ? 'paid' : 'pending') : (paidAmount > 0 ? 'partial' : 'pending');
          await sequelize.query(
            'UPDATE patient_bills SET services = :services, total_amount = :total, balance_amount = :balance, status = :status, updated_at = NOW() WHERE id = :billId',
            { replacements: { services: JSON.stringify(services), total: newTotal, balance: newBalance, status: newStatus, billId: bill.id } }
          );
          await require('../services/AccountingService').stampBillBaseCurrency(bill.id);
          billAdjusted = true;
        }
      }
    } catch (billError) {
      console.error('Error reconciling bill after changing prescription line quantity:', billError);
    }

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: line.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Pharmacy', action: 'PRESCRIPTION_LINE_QTY_CHANGED', entity_type: 'Prescription', entity_id: id,
        description: `Changed "${line.drug_name || 'item'}" quantity from ${line.quantity_prescribed} to ${newQty}${billAdjusted ? ' (bill adjusted)' : ''}`,
        old_values: { quantity_prescribed: line.quantity_prescribed }, new_values: { quantity_prescribed: newQty }, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ message: 'Quantity updated', billAdjusted });
  } catch (error) {
    console.error('Error updating prescription line quantity:', error);
    res.status(500).json({ error: 'Failed to update quantity' });
  }
});

// Re-price a not-yet-dispensed line to a patient's scheme/insurance rate — prescriptions
// are always billed at the plain cash catalog price when they're written (the ward and
// pharmacy prescription forms have no scheme awareness), so a patient with an active
// membership still gets billed cash unless a pharmacist catches it and applies the scheme
// rate here before payment. Only rewrites the matching unpaid bill line item's price —
// never touches inventory_items.selling_price, which is the shared catalog price every
// other patient is billed at.
router.put('/prescriptions/:id/lines/:lineId/reprice', authorize('pharmacy.prescribe'), async (req, res) => {
  try {
    const { id, lineId } = req.params;
    const unitPrice = parseFloat(req.body.unit_price);
    if (isNaN(unitPrice) || unitPrice < 0) return res.status(400).json({ error: 'A valid unit price is required' });
    // Optional — stashed on the bill line purely so other pages (Bill Details) can show what
    // an insurer is actually being charged for a line billed at 0 SSP. Never enters the SSP
    // total/balance math below, which only ever reads unitPrice/totalPrice.
    const hasSchemeInfo = req.body.scheme_price !== undefined;
    const schemePrice = hasSchemeInfo ? parseFloat(req.body.scheme_price) : null;
    const schemeCurrency = hasSchemeInfo ? (req.body.scheme_currency || null) : null;

    const [lines] = await sequelize.query(
      `SELECT pl.status, pl.total_quantity_dispensed, pl.quantity_prescribed,
              ii.item_name AS drug_name, pp.patient_id, pp.clinic_id
       FROM prescription_lines pl
       JOIN pharmacy_prescriptions pp ON pp.id = pl.prescription_id
       LEFT JOIN inventory_items ii ON pl.drug_id = ii.id
       WHERE pl.id = :lineId AND pl.prescription_id = :id`,
      { replacements: { lineId, id } }
    );
    if (lines.length === 0) return res.status(404).json({ error: 'Line not found' });
    const line = lines[0];
    if (line.status === 'cancelled') return res.status(400).json({ error: 'This item was removed' });
    if ((line.total_quantity_dispensed || 0) > 0) {
      return res.status(400).json({ error: 'Cannot reprice — this item has already been dispensed' });
    }

    let billAdjusted = false;
    try {
      const [bills] = await sequelize.query(
        `SELECT id, services, paid_amount FROM patient_bills
         WHERE patient_id = :pid AND clinic_id = :cid AND status != 'cancelled'
         ORDER BY created_at DESC LIMIT 1`,
        { replacements: { pid: line.patient_id, cid: line.clinic_id } }
      );
      if (bills.length === 0) return res.status(404).json({ error: 'No active bill found for this patient' });
      const bill = bills[0];
      let services = typeof bill.services === 'string' ? JSON.parse(bill.services) : (bill.services || []);
      if (typeof services === 'string') services = JSON.parse(services);
      const idx = services.findIndex(s =>
        !s.isVoided && !s.paid &&
        String(s.serviceName || '').toLowerCase() === String(line.drug_name).toLowerCase() &&
        Number(s.quantity) === Number(line.quantity_prescribed)
      );
      if (idx === -1) return res.status(404).json({ error: 'Matching bill line item not found — it may already be paid' });

      services[idx].unitPrice = unitPrice;
      services[idx].totalPrice = parseFloat((unitPrice * line.quantity_prescribed).toFixed(2));
      if (hasSchemeInfo) {
        if (schemePrice !== null && !isNaN(schemePrice)) {
          services[idx].schemePrice = schemePrice;
          services[idx].schemeCurrency = schemeCurrency;
        } else {
          delete services[idx].schemePrice;
          delete services[idx].schemeCurrency;
        }
      }
      const newTotal = services.filter(s => !s.isVoided).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0);
      const paidAmount = parseFloat(bill.paid_amount) || 0;
      const newBalance = Math.max(0, newTotal - paidAmount);
      const newStatus = newBalance <= 0.01 ? (paidAmount > 0 ? 'paid' : 'pending') : (paidAmount > 0 ? 'partial' : 'pending');
      await sequelize.query(
        'UPDATE patient_bills SET services = :services, total_amount = :total, balance_amount = :balance, status = :status, updated_at = NOW() WHERE id = :billId',
        { replacements: { services: JSON.stringify(services), total: newTotal, balance: newBalance, status: newStatus, billId: bill.id } }
      );
      await require('../services/AccountingService').stampBillBaseCurrency(bill.id);
      billAdjusted = true;
    } catch (billError) {
      console.error('Error reconciling bill after repricing prescription line:', billError);
      return res.status(500).json({ error: 'Failed to update the bill' });
    }

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: line.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Pharmacy', action: 'PRESCRIPTION_LINE_REPRICED', entity_type: 'Prescription', entity_id: id,
        description: `Repriced "${line.drug_name || 'item'}" to ${unitPrice}/unit (scheme rate)`,
        new_values: { unit_price: unitPrice }, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ message: 'Price updated', billAdjusted });
  } catch (error) {
    console.error('Error repricing prescription line:', error);
    res.status(500).json({ error: 'Failed to update price' });
  }
});

// ═══════════════════════════════════════════════════
// DISPENSING
// ═══════════════════════════════════════════════════

// List dispensing records
router.get('/dispensing', authorize('pharmacy.read'), async (req, res) => {
  try {
    // Check if dispensing_records table exists
    const [tableCheck] = await sequelize.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'dispensing_records'
      ) AS exists_flag
    `);

    if (!tableCheck[0].exists_flag) {
      console.log('dispensing_records table does not exist yet');
      return res.json([]);
    }

    const { patient_id, from_date, to_date, status } = req.query;
    let where = 'WHERE dr.clinic_id = :cid';
    const replacements = { cid: BranchQueryFilter.resolveClinicId(req) };

    if (patient_id) { where += ' AND dr.patient_id = :pid'; replacements.pid = patient_id; }
    if (from_date) { where += ' AND dr.dispensing_date >= :fd'; replacements.fd = from_date; }
    if (to_date) { where += ' AND dr.dispensing_date <= :td'; replacements.td = to_date; }
    if (status && status !== 'all') {
      // Comma-separated so callers (e.g. the returns picker) can ask for
      // both 'dispensed' and 'partially_returned' records in one request.
      const statusList = status.split(',').map(s => s.trim()).filter(Boolean);
      where += ` AND dr.status IN (:statusList)`;
      replacements.statusList = statusList;
    }

    try {
      const { sql: branchSQL, params: branchParams } = getBranchConditionSQL(req, 'dr');
      if (branchSQL) { where += ' AND dr.branch_id = :branchId'; replacements.branchId = branchParams[0]; }
    } catch (branchError) {
      console.log('Branch filter not applied:', branchError.message);
    }

    const [rows] = await sequelize.query(`
      SELECT dr.*, ii.item_name AS drug_name, ii.item_code AS drug_code,
        d.generic_name, d.strength,
        COALESCE((p.first_name || ' ' || p.last_name), (lp.first_name || ' ' || lp.last_name)) AS patient_name,
        u.display_name AS pharmacist_name,
        ib.batch_number, ib.expiry_date,
        pc.payment_status,
        COALESCE((SELECT SUM(quantity_returned) FROM dispensing_returns WHERE dispensing_record_id = dr.id), 0) AS quantity_returned_total
      FROM dispensing_records dr
      LEFT JOIN inventory_items ii ON dr.inventory_item_id = ii.id
      LEFT JOIN drugs d ON d.inventory_item_id = dr.inventory_item_id
      LEFT JOIN patients p ON p.id = dr.patient_id
      LEFT JOIN lis_participants lp ON lp.id = dr.patient_id
      LEFT JOIN users u ON u.id = dr.pharmacist_id
      LEFT JOIN inventory_batches ib ON dr.batch_id = ib.id
      LEFT JOIN pharmacy_charges pc ON pc.dispensing_record_id = dr.id
      ${where}
      ORDER BY dr.dispensing_date DESC, dr.created_at DESC
    `, { replacements });

    res.json(rows);
  } catch (error) {
    console.error('Error listing dispensing records:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to list dispensing records', details: error.message });
  }
});

// Get dispensing record detail
router.get('/dispensing/:id', authorize('pharmacy.read'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    const [rows] = await sequelize.query(`
      SELECT dr.*, ii.item_name AS drug_name, ii.item_code AS drug_code,
        d.generic_name, d.strength, d.dosage_form,
        (p.first_name || ' ' || p.last_name) AS patient_name, u.display_name AS pharmacist_name,
        ib.batch_number, ib.expiry_date, ib.unit_cost AS batch_unit_cost,
        sl.location_name
      FROM dispensing_records dr
      LEFT JOIN inventory_items ii ON dr.inventory_item_id = ii.id
      LEFT JOIN drugs d ON d.inventory_item_id = dr.inventory_item_id
      LEFT JOIN patients p ON p.id = dr.patient_id
      LEFT JOIN users u ON u.id = dr.pharmacist_id
      LEFT JOIN inventory_batches ib ON dr.batch_id = ib.id
      LEFT JOIN stock_locations sl ON dr.from_location_id = sl.id
      WHERE dr.id = :id AND dr.clinic_id = :cid
    `, { replacements: { id: req.params.id, cid } });
    if (rows.length === 0) return res.status(404).json({ error: 'Dispensing record not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error getting dispensing record:', error);
    res.status(500).json({ error: 'Failed to get dispensing record' });
  }
});

// DISPENSE - Main dispensing endpoint with full integration
router.post('/dispensing', authorize('pharmacy.write'), async (req, res) => {
  
  console.log('=== DISPENSING POST REQUEST START ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('User:', req.user?.id, req.user?.email);
  
  let t;
  try {
    console.log('Checking if required tables exist...');
    
    // Check if required tables exist
    const [tableCheck] = await sequelize.query(`
      SELECT
        (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispensing_records')) AS dispensing_exists,
        (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_items')) AS inventory_exists
    `);
    
    console.log('Table check result:', tableCheck[0]);
    
    if (!tableCheck[0].dispensing_exists || !tableCheck[0].inventory_exists) {
      console.log('❌ Required tables do not exist yet for dispensing');
      return res.status(503).json({ 
        error: 'Dispensing system not fully initialized', 
        details: 'Required database tables are being created. Please try again in a moment.',
        tableStatus: tableCheck[0]
      });
    }
    
    console.log('✅ Tables exist, proceeding with dispensing...');

    t = await sequelize.transaction();
    
    // Helper function to convert empty strings to null
    const emptyToNull = (val) => (val === '' || val === undefined) ? null : val;
    
    const {
      clinic_id, prescription_id, prescription_line_id,
      clinical_prescription_id, visit_id,
      patient_id, drug_id, inventory_item_id: reqItemId, pharmacist_id,
      batch_id, from_location_id,
      quantity_dispensed, unit_of_measure,
      unit_price, currency_code,
      dispensing_notes, patient_counselling_provided, counselling_notes
    } = req.body;

    // Convert empty strings to null for all ID fields
    const cleanPrescriptionId = emptyToNull(prescription_id);
    const cleanPrescriptionLineId = emptyToNull(prescription_line_id);
    const cleanClinicalPrescriptionId = emptyToNull(clinical_prescription_id);
    const cleanVisitId = emptyToNull(visit_id);
    const cleanPatientId = emptyToNull(patient_id);
    const cleanPharmacistId = emptyToNull(pharmacist_id);
    const cleanBatchId = emptyToNull(batch_id);
    const cleanFromLocationId = emptyToNull(from_location_id);
    

    // Accept inventory_item_id or drug_id (both point to inventory_items now)
    const inventoryItemId = reqItemId || drug_id;
    if (!inventoryItemId || !quantity_dispensed) {
      await t.rollback();
      return res.status(400).json({ error: 'inventory_item_id (or drug_id) and quantity_dispensed are required' });
    }

    const cid = clinic_id || 1;

    // Billing gate: the frontend already blocks dispensing on an outstanding
    // balance, but that check is client-side only and bypassable via a direct
    // API call — enforce it here too. Sum balance_amount across every
    // non-cancelled, non-scheme bill for this patient at this clinic (not just
    // the most recent one), so an older unpaid bill can't be dispensed around
    // either. Scheme/insurance bills (pb.scheme_id set) are excluded — that
    // balance is owed by the insurer via an invoice raised later, not cash the
    // patient must pay before dispensing.
    if (cleanPatientId) {
      const branchId = req.branchContext?.branchId || req.user?.branchId || null;
      const isAdmin = req.user?.role === 'admin';
      const branchSql = (!isAdmin && branchId) ? 'AND pb.branch_id = :branchId' : '';
      const [[balanceRow]] = await sequelize.query(
        `SELECT COALESCE(SUM(pb.balance_amount), 0) AS total_balance
         FROM patient_bills pb
         WHERE pb.patient_id = :pid AND pb.clinic_id = :cid AND pb.status != 'cancelled' AND pb.scheme_id IS NULL ${branchSql}`,
        { replacements: { pid: cleanPatientId, cid, branchId }, transaction: t }
      );
      const outstandingBalance = parseFloat(balanceRow?.total_balance) || 0;
      if (outstandingBalance > 0.01) {
        await t.rollback();
        return res.status(402).json({ error: `This patient has an outstanding balance of ${outstandingBalance.toFixed(2)} — dispensing is blocked until payment is collected.` });
      }
    }

    // Never dispense a prescription line beyond what was prescribed. Paying a
    // bill auto-dispenses its paid lines (services/autoDispense.js), and the
    // counter screen still had its Dispense button armed for the same line, so
    // one hand-off became two dispensing records and twice the stock out (demo:
    // 16 prescribed, 32 dispensed). The line row is locked so the two paths
    // can't both read "still outstanding" at the same moment.
    if (cleanPrescriptionLineId) {
      const [[lineRow]] = await sequelize.query(
        `SELECT quantity_prescribed, COALESCE(total_quantity_dispensed, 0) AS dispensed
           FROM prescription_lines WHERE id = :id FOR UPDATE`,
        { replacements: { id: cleanPrescriptionLineId }, transaction: t }
      );
      if (lineRow) {
        const outstanding = Number(lineRow.quantity_prescribed) - Number(lineRow.dispensed);
        if (outstanding <= 1e-6) {
          const [[prev]] = await sequelize.query(
            `SELECT dispensing_number, created_at FROM dispensing_records
              WHERE prescription_line_id = :id ORDER BY created_at DESC LIMIT 1`,
            { replacements: { id: cleanPrescriptionLineId }, transaction: t }
          );
          await t.rollback();
          return res.status(409).json({
            already_dispensed: true,
            dispensing_number: prev?.dispensing_number || null,
            error: `Already dispensed${prev?.dispensing_number ? ` (${prev.dispensing_number})` : ''} — nothing left to dispense on this line.`,
          });
        }
        if (Number(quantity_dispensed) > outstanding + 1e-6) {
          await t.rollback();
          return res.status(400).json({ error: `Only ${outstanding} left to dispense on this line (${lineRow.dispensed} of ${lineRow.quantity_prescribed} already dispensed).` });
        }
      }
    }

    // 1. Get inventory item info
    console.log('Step 1: Fetching inventory item info for ID:', inventoryItemId);
    let itemRows;
    try {
      [itemRows] = await sequelize.query(
        'SELECT i.*, d.strength, d.dosage_form, d.generic_name, d.is_controlled_substance AS drug_controlled, d.revenue_account_id AS drug_revenue_account_id FROM inventory_items i LEFT JOIN drugs d ON d.inventory_item_id = i.id WHERE i.id = :id',
        { replacements: { id: inventoryItemId }, transaction: t }
      );
    } catch (step1Error) {
      console.error('❌❌❌ STEP 1 INVENTORY FETCH FAILED ❌❌❌');
      console.error('Error:', step1Error.message);
      console.error('Original:', step1Error.original?.message);
      console.error('Detail:', step1Error.original?.detail);
      throw step1Error;
    }
    
    if (itemRows.length === 0) { 
      console.log('❌ Inventory item not found');
      await t.rollback(); 
      return res.status(404).json({ error: 'Inventory item not found' }); 
    }
    const item = itemRows[0];
    console.log('✅ Step 1 complete: Item found:', item.item_name);
    // Build a drug-compatible object for downstream code
    const drug = {
      drug_name: item.item_name,
      drug_code: item.item_code,
      unit_of_measure: item.unit_of_measure,
      is_controlled_substance: item.is_controlled_substance || item.drug_controlled,
      inventory_item_id: item.id,
      revenue_account_id: item.drug_revenue_account_id,
      cogs_account_id: item.cogs_account_id
    };

    // quantity_dispensed is always a dose-unit count (tablets/mL — what
    // calculateQuantity() on the prescribing side computes, and what's
    // recorded on dispensing_records/prescription_lines). Stock, however, is
    // tracked in the item's own pack unit (a "Strip" of units_per_pack
    // tablets) — units_per_pack defaults to 1, so packQty === quantity_dispensed
    // for every item that hasn't had a real pack size configured, preserving
    // today's behavior exactly until an admin sets one (Setup > Item Master).
    const unitsPerPack = parseFloat(item.units_per_pack) || 1;
    const packQty = parseFloat(quantity_dispensed) / unitsPerPack;

    // 2. Check stock
    console.log('Step 2: Checking stock for item:', inventoryItemId);
    let selectedBatch = null;
    {
      const [stockCheck] = await sequelize.query(
        'SELECT quantity_on_hand FROM inventory_items WHERE id = :id',
        { replacements: { id: inventoryItemId }, transaction: t }
      );
      if (stockCheck.length > 0 && stockCheck[0].quantity_on_hand < packQty) {
        console.log('❌ Insufficient stock');
        await t.rollback();
        return res.status(400).json({ error: 'Insufficient stock', available: stockCheck[0].quantity_on_hand, requested: packQty });
      }
      console.log('✅ Step 2 complete: Stock available:', stockCheck[0]?.quantity_on_hand);

      // A location-scoped dispense must also fit what that specific store
      // actually has — the clinic-wide check above can pass even when the
      // chosen store itself is empty (stock_by_location has no row for an
      // item until someone has explicitly stocked it there).
      if (cleanFromLocationId) {
        const [locStockCheck] = await sequelize.query(
          'SELECT COALESCE(quantity_on_hand, 0) AS quantity_on_hand FROM stock_by_location WHERE item_id = :itemId AND location_id = :locationId',
          { replacements: { itemId: inventoryItemId, locationId: cleanFromLocationId }, transaction: t }
        );
        const locAvailable = locStockCheck.length > 0 ? locStockCheck[0].quantity_on_hand : 0;
        if (locAvailable < packQty) {
          console.log('❌ Insufficient stock at selected location');
          await t.rollback();
          return res.status(400).json({ error: 'Insufficient stock at selected location', available: locAvailable, requested: packQty });
        }
      }

      // Select batch (FIFO - earliest expiry first). quantity_received/
      // quantity_used are pack-tracked too (a batch is received as "80
      // Strips"), so compared against packQty, not the raw dose count.
      if (batch_id) {
        const [batchRows] = await sequelize.query(
          'SELECT *, (quantity_received - quantity_used) AS quantity_remaining FROM inventory_batches WHERE id = :id AND (quantity_received - quantity_used) >= :qty',
          { replacements: { id: batch_id, qty: packQty }, transaction: t }
        );
        if (batchRows.length > 0) selectedBatch = batchRows[0];
      }
      if (!selectedBatch) {
        const [autoBatch] = await sequelize.query(`
          SELECT *, (quantity_received - quantity_used) AS quantity_remaining FROM inventory_batches
          WHERE item_id = :iid AND status = 'active' AND (quantity_received - quantity_used) >= :qty
            AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
          ORDER BY expiry_date ASC LIMIT 1
        `, { replacements: { iid: inventoryItemId, qty: packQty }, transaction: t });
        if (autoBatch.length > 0) selectedBatch = autoBatch[0];
      }
    }

    // 3. Generate dispensing number
    console.log('Step 3: Generating dispensing number');
    const now = new Date();
    const dispPrefix = `DISP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Highest issued, not how many exist — a gap in the sequence otherwise puts
    // this on a number already taken, and the dispense fails on the unique
    // transaction_number of the inventory movement it writes.
    const [dispCount] = await sequelize.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(dispensing_number, '^.*-', ''), '')::int), 0) AS cnt
         FROM dispensing_records
        WHERE dispensing_number LIKE :prefix
          AND dispensing_number ~ '-[0-9]+$'`,
      { replacements: { prefix: `${dispPrefix}%` }, transaction: t }
    );
    const dispSeq = (parseInt(dispCount[0]?.cnt, 10) || 0) + 1;
    const dispensingNumber = `${dispPrefix}-${String(dispSeq).padStart(4, '0')}`;
    console.log('✅ Step 3 complete: Dispensing number:', dispensingNumber);

    // 4. Calculate pricing from inventory selling_price + accounting exchange rate
    const curr = currency_code || item.cost_currency || (await getBaseCurrencyCode());
    let price = unit_price !== undefined ? unit_price : (item.selling_price || 0);
    // If currency differs from item cost_currency, try to get exchange rate from accounting
    if (unit_price === undefined && curr !== (item.cost_currency || (await getBaseCurrencyCode()))) {
      try {
        const AccountingService = require('../services/AccountingService');
        const rate = await AccountingService.requireExchangeRate(cid, item.cost_currency || (await getBaseCurrencyCode()), curr, new Date(), `price ${item.item_name || 'this item'} in ${curr}`);
        price = (item.selling_price || 0) * rate;
      } catch (rateErr) {
        // Charging the unconverted price in another currency is the same silent 1:1 bug.
        if (t && !t.finished) await t.rollback().catch(() => {});
        return res.status(400).json({ error: rateErr.message });
      }
    }
    // selling_price (and any unit_price override) has always meant "price per
    // unit_of_measure pack" — the item form has never had a separate per-
    // dose-unit price. Priced by packQty, not the raw dose count, for the
    // same reason stock is deducted by packQty: billing 20 tablets at the
    // per-strip price would overcharge 10x once quantity_dispensed correctly
    // means tablets instead of strips.
    const totalPrice = price * packQty;
    console.log('✅ Step 4 complete: Price calculated:', price, 'Total:', totalPrice);

    // 5. Create dispensing record
    console.log('Step 5: Creating dispensing record');
    console.log('Dispensing record values:', {
      cleanPrescriptionId, cleanPrescriptionLineId, cleanPatientId, 
      cleanPharmacistId, cleanBatchId, cleanFromLocationId
    });
    const dispId = uuidv4();
    const dispDate = now.toISOString().split('T')[0];
    const dispTime = now.toTimeString().split(' ')[0];

    try {
      await sequelize.query(`
        INSERT INTO dispensing_records (id, clinic_id, branch_id, dispensing_number, prescription_id, prescription_line_id,
          patient_id, drug_id, pharmacist_id, inventory_item_id, batch_id, from_location_id,
          dispensing_date, dispensing_time, quantity_dispensed, unit_of_measure,
          unit_price, currency_code, exchange_rate, total_price, total_price_base,
          dispensing_notes, patient_counselling_provided, counselling_notes,
          status)
        VALUES (:id, :cid, :branchId, :dn, :rxid, :rxlid,
          :pid, :did, :phid, :iid, :bid, :flid,
          :ddate, :dtime, :qty, :uom,
          :price, :curr, 1, :total, :total,
          :notes, :counsel, :cnotes,
          'dispensed')
      `, {
        replacements: {
          id: dispId, cid,
          branchId: req.branchContext?.branchId || req.user?.branchId || null,
          dn: dispensingNumber,
          rxid: cleanPrescriptionId, rxlid: cleanPrescriptionLineId,
          pid: cleanPatientId, did: inventoryItemId, phid: cleanPharmacistId,
          iid: inventoryItemId, bid: selectedBatch?.id || cleanBatchId,
          flid: cleanFromLocationId,
          ddate: dispDate, dtime: dispTime,
          qty: quantity_dispensed, uom: unit_of_measure || drug.unit_of_measure || 'tablet',
          price, curr, total: totalPrice,
          notes: dispensing_notes || null,
          counsel: patient_counselling_provided || false, cnotes: counselling_notes || null
        },
        transaction: t
      });
      console.log('✅ Step 5 complete: Dispensing record created:', dispId);
    } catch (dispInsertError) {
      console.error('❌❌❌ DISPENSING RECORD INSERT FAILED ❌❌❌');
      console.error('Error:', dispInsertError.message);
      console.error('Original error:', dispInsertError.original?.message);
      console.error('Detail:', dispInsertError.original?.detail);
      throw dispInsertError;
    }

    // 6. Reduce inventory stock
    console.log('Step 6: Reducing inventory stock');
    let invTxnId = null;
    {
      invTxnId = uuidv4();
      const txnNumber = `TXN-DISP-${dispensingNumber}`;

      // quantity_change (and every column it feeds below) is pack-tracked,
      // same as quantity_on_hand — logged/deducted by packQty, not the raw
      // dose-unit quantity_dispensed. unit_cost is likewise "cost per pack"
      // (what a GRN paid per Strip/Bottle/etc.), so total_cost follows packQty too.
      await sequelize.query(`
        INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
          quantity_change, from_location_id, batch_id, unit_cost, total_cost,
          reference_type, reference_id, transaction_date, notes, created_by)
        VALUES (:id, :cid, :txn, :iid, 'dispense', :qty, :flid, :bid, :cost, :total,
          'dispensing', :ref, CURRENT_DATE, :notes, :by)
      `, {
        replacements: {
          id: invTxnId, cid, txn: txnNumber, iid: inventoryItemId,
          qty: -packQty, flid: cleanFromLocationId,
          bid: selectedBatch?.id || cleanBatchId,
          cost: selectedBatch?.unit_cost || 0,
          total: (selectedBatch?.unit_cost || 0) * packQty,
          ref: dispensingNumber, notes: `Dispensed to patient`, by: cleanPharmacistId
        },
        transaction: t
      });

      // Update item stock
      await sequelize.query(
        'UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE id = :id',
        { replacements: { qty: packQty, id: inventoryItemId }, transaction: t }
      );

      // Update batch
      if (selectedBatch) {
        await sequelize.query(
          'UPDATE inventory_batches SET quantity_used = quantity_used + :qty WHERE id = :id',
          { replacements: { qty: packQty, id: selectedBatch.id }, transaction: t }
        );
      }

      // Update stock by location
      if (from_location_id) {
        await sequelize.query(
          'UPDATE stock_by_location SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE item_id = :iid AND location_id = :lid',
          { replacements: { qty: packQty, iid: inventoryItemId, lid: from_location_id }, transaction: t }
        );
      } else {
        // No store chosen (the counter screen never sends one): an item kept
        // in a single store comes off that store, so store stock and the
        // item total don't drift apart.
        const { deductSingleStore } = require('../services/autoDispense');
        await deductSingleStore(sequelize, inventoryItemId, packQty, t);
      }

      // Link inventory transaction to dispensing
      await sequelize.query(
        'UPDATE dispensing_records SET inventory_transaction_id = :txnId WHERE id = :id',
        { replacements: { txnId: invTxnId, id: dispId }, transaction: t }
      );
      console.log('✅ Step 6 complete: Inventory reduced');
    }

    // 7. Update prescription line status
    if (cleanPrescriptionLineId) {
      try {
        await sequelize.query(
          'UPDATE prescription_lines SET total_quantity_dispensed = total_quantity_dispensed + :qty WHERE id = :id',
          { replacements: { qty: quantity_dispensed, id: cleanPrescriptionLineId }, transaction: t }
        );
        // Check if fully dispensed
        const [lineCheck] = await sequelize.query(
          'SELECT quantity_prescribed, total_quantity_dispensed + :qty AS total_disp FROM prescription_lines WHERE id = :id',
          { replacements: { qty: quantity_dispensed, id: cleanPrescriptionLineId }, transaction: t }
        );
        if (lineCheck.length > 0) {
          const newStatus = lineCheck[0].total_disp >= lineCheck[0].quantity_prescribed ? 'dispensed' : 'partial';
          await sequelize.query('UPDATE prescription_lines SET status = :st WHERE id = :id', { replacements: { st: newStatus, id: cleanPrescriptionLineId }, transaction: t });
        }
        console.log('✅ Prescription line updated:', cleanPrescriptionLineId);
      } catch (prescLineError) {
        console.error('⚠️ Prescription line update failed (non-blocking):', prescLineError.message);
      }
    }

    // 8. Update prescription status
    if (cleanPrescriptionId) {
      try {
        const [pendingLines] = await sequelize.query(
          "SELECT COUNT(*) AS cnt FROM prescription_lines WHERE prescription_id = :id AND status IN ('pending', 'partial')",
          { replacements: { id: cleanPrescriptionId }, transaction: t }
        );
        // COUNT(*) comes back from Postgres as the string "0", not the number 0 —
        // "0" === 0 is false, so this always fell into the else branch and a
        // prescription with every line dispensed stayed "partial_dispensed" forever.
        const rxStatus = parseInt(pendingLines[0]?.cnt, 10) === 0 ? 'dispensed' : 'partial_dispensed';
        await sequelize.query('UPDATE pharmacy_prescriptions SET status = :st WHERE id = :id', { replacements: { st: rxStatus, id: cleanPrescriptionId }, transaction: t });
        console.log('✅ Prescription status updated:', cleanPrescriptionId, rxStatus);
      } catch (prescError) {
        console.error('⚠️ Prescription status update failed (non-blocking):', prescError.message);
      }
    }

    // 8b. Update clinical prescription status (prescriptions table from doctor Rx)
    if (cleanClinicalPrescriptionId) {
      try {
        await sequelize.query(
          "UPDATE prescriptions SET status = 'completed' WHERE id = :id",
          { replacements: { id: cleanClinicalPrescriptionId }, transaction: t }
        );
        console.log('✅ Clinical prescription status updated:', cleanClinicalPrescriptionId);
      } catch (clinicalPrescError) {
        console.error('⚠️ Clinical prescription update failed (non-blocking):', clinicalPrescError.message);
      }
    }

    // 9. Auto-create billing charge
    console.log('Step 9: Creating billing charge');
    let chargeId = null;
    if (totalPrice > 0) {
      chargeId = uuidv4();
      const chargeNum = `CHG-${dispensingNumber}`;
      await sequelize.query(`
        INSERT INTO pharmacy_charges (id, clinic_id, charge_number, patient_id, dispensing_record_id,
          charge_date, drug_name, quantity_dispensed, unit_price, charge_amount, currency_code,
          is_billed, payment_status, applied_price_type)
        VALUES (:id, :cid, :cn, :pid, :did, CURRENT_DATE, :dname, :qty, :up, :amt, :curr,
          false, 'pending', 'cash')
      `, {
        replacements: {
          id: chargeId, cid, cn: chargeNum, pid: cleanPatientId, did: dispId,
          dname: drug.drug_name, qty: quantity_dispensed, up: price,
          amt: totalPrice, curr
        },
        transaction: t
      });

      // Update dispensing with charge info
      await sequelize.query(
        'UPDATE dispensing_records SET amount_charged = :amt, is_billed = false WHERE id = :id',
        { replacements: { amt: totalPrice, id: dispId }, transaction: t }
      );
      console.log('✅ Step 9 complete: Billing charge created:', chargeId);
    }

    // 10. Create GL entries (Revenue & COGS)
    // Posted through general_ledger/account_ledger (AccountingService.createGLEntry +
    // postGLEntry) — the same ledger every other module in this app posts to and the one
    // the Income Statement / General Ledger reports actually read from. This used to write
    // straight to journal_entries/journal_entry_lines instead, a second, parallel ledger
    // table that no report ever queries — every dispensed drug's revenue AND cost of sale
    // was silently posted somewhere nothing ever reads back, which is why Pharmacy Sales
    // Revenue (4120) and Pharmaceutical Cost of Sales (5210) always showed SSP 0.00 on the
    // Income Statement regardless of real dispensing activity.
    console.log('Step 10: Creating GL entries');
    let revenueJE = null;
    let cogsJE = null;
    try {
      const AccountingService = require('../services/AccountingService');
      const AccountResolver = require('../services/AccountResolver');

      // Get pharmacy settings for GL accounts
      const [settings] = await sequelize.query(
        'SELECT * FROM pharmacy_settings WHERE clinic_id = :cid LIMIT 1',
        { replacements: { cid }, transaction: t }
      );
      const cfg = settings.length > 0 ? settings[0] : null;

      // AccountResolver: item's/drug's own override -> its category's
      // account -> clinic default (pharmacy_settings) -> suspense +
      // accounting_exceptions row. Previously, a missing revenueAcct
      // silently skipped the whole revenue entry with no trace at all, and
      // a missing cogsAcct fell back to hard-coded 5210 with no exception
      // logged either — both now always resolve to a real (possibly
      // suspense) account, so the entry still posts, balanced and visible.
      const resolvedAccounts = await AccountResolver.resolveItemAccounts(
        { ...item, revenue_account_id: drug.revenue_account_id, cogs_account_id: drug.cogs_account_id },
        { clinicId: cid, branchId: item.branch_id, need: ['revenue', 'cogs', 'inventory'], sourceModule: 'pharmacyModule.dispensing', referenceId: dispId, amount: totalPrice, currency: curr }
      );
      const revenueAcct = resolvedAccounts.revenue;
      const cogsAcct = resolvedAccounts.cogs;
      const receivablesAcct = cfg?.pharmacy_receivables_account_id;

      // Revenue GL entry
      if (totalPrice > 0) {
        const glEntry = await AccountingService.createGLEntry({
          clinic_id: cid,
          transaction_date: new Date(),
          transaction_type: 'pharmacy_dispensing',
          description: `Pharmacy revenue: ${drug.drug_name} x${quantity_dispensed}`,
          reference_id: dispId,
          reference_module: 'pharmacy_dispensing',
          transaction_currency: curr,
        }, [
          // Debit: Cash/Receivables
          { account_id: receivablesAcct || revenueAcct, debit_amount: totalPrice, credit_amount: 0, description: `Pharmacy receivable: ${drug.drug_name}` },
          // Credit: Revenue
          { account_id: revenueAcct, debit_amount: 0, credit_amount: totalPrice, description: `Revenue: ${drug.drug_name}` },
        ], pharmacist_id || 'system');
        await AccountingService.postGLEntry(glEntry.id, pharmacist_id || 'system');

        revenueJE = glEntry.gl_number;
        await sequelize.query('UPDATE dispensing_records SET revenue_gl_entry_id = :je WHERE id = :id', { replacements: { je: glEntry.id, id: dispId }, transaction: t });
      }

      // COGS GL entry — cost per unit prefers the actual dispensed batch's own
      // recorded cost, but a batch bought/received without ever having its
      // cost entered (common when a GRN was accepted in a hurry) falls back to
      // the item's own average/current cost rather than skipping COGS
      // entirely. Whichever source is used, the amount is still the dispensed
      // item's real cost, never its selling price.
      const unitCost = (selectedBatch?.unit_cost > 0) ? parseFloat(selectedBatch.unit_cost)
        : (drug.average_unit_cost > 0) ? parseFloat(drug.average_unit_cost)
        : (drug.current_unit_cost > 0) ? parseFloat(drug.current_unit_cost)
        : 0;

      // Billing may already have posted this drug's cost of sale: the bill line
      // is stamped cogsPosted / cogsGlEntryId by utils/pharmacyCogsOnBill.js. An
      // insurance prescription is billed first and dispensed here afterwards, so
      // posting again doubled COGS. Doses on the patient's cogs-posted bill lines
      // for this drug, less doses already dispensed without their own COGS (e.g.
      // dispensed on payment by autoDispense), are already costed — when this
      // dispense fits inside that, nothing more is posted. Otherwise COGS posts as
      // before, so the books are never left under-costed.
      let billCoveredCost = false;
      if (cleanPatientId) {
        const [[cover]] = await sequelize.query(`
          WITH billed AS (
            SELECT COALESCE(SUM(
                     CASE WHEN s->>'quantity' ~ '^[0-9]+(\\.[0-9]+)?$' THEN
                       (s->>'quantity')::numeric * CASE WHEN s->>'packQuantity' IS NOT NULL THEN 1 ELSE :upp END
                     ELSE 0 END), 0) AS doses
              FROM patient_bills b, LATERAL jsonb_array_elements(b.services::jsonb) s
             WHERE b.patient_id::text = :pid AND b.status <> 'cancelled'
               AND s->>'serviceId' = :iid
               AND COALESCE((s->>'isVoided')::boolean, false) = false
               AND COALESCE((s->>'cogsPosted')::boolean, false) = true
          ), used AS (
            SELECT COALESCE(SUM(d.quantity_dispensed), 0) AS doses
              FROM dispensing_records d
             WHERE d.patient_id::text = :pid AND d.inventory_item_id::text = :iid AND d.id <> :dispId
               AND d.cogs_gl_entry_id IS NULL
          )
          SELECT (billed.doses - used.doses)::float AS available FROM billed, used`,
          { replacements: { pid: String(cleanPatientId), iid: String(inventoryItemId), dispId, upp: unitsPerPack }, transaction: t });
        billCoveredCost = (parseFloat(cover?.available) || 0) >= parseFloat(quantity_dispensed) - 1e-9;
      }

      if (billCoveredCost) {
        console.log(`Dispensing ${dispId}: COGS not posted — already posted when ${drug.drug_name} was billed.`);
      } else if (unitCost > 0) {
        // unitCost (batch cost, or item average/current cost) is "cost per
        // pack" same as selling_price — costed by the pack-equivalent of
        // quantity_dispensed, not the raw dose count, same fix as totalPrice above.
        const cogsAmount = unitCost * packQty;
        const invAcct = resolvedAccounts.inventory;

        const glEntry = await AccountingService.createGLEntry({
          clinic_id: cid,
          transaction_date: new Date(),
          transaction_type: 'pharmacy_dispensing_cogs',
          description: selectedBatch?.unit_cost > 0
            ? `COGS: ${drug.drug_name} x${quantity_dispensed} (Batch ${selectedBatch.batch_number})`
            : `COGS: ${drug.drug_name} x${quantity_dispensed} (item average/current cost — dispensed batch has no recorded cost)`,
          reference_id: dispId,
          reference_module: 'pharmacy_dispensing',
          // COGS is costed in the batch's own cost currency, not the item's selling
          // currency (curr) — they can legitimately differ (e.g. sold in SSP, bought in USD).
          // Falls back to the item's selling currency when costed off the item-level
          // average/current cost instead of a specific batch.
          transaction_currency: selectedBatch?.cost_currency || curr,
        }, [
          // Debit: COGS
          { account_id: cogsAcct, debit_amount: cogsAmount, credit_amount: 0, description: `COGS: ${drug.drug_name}` },
          // Credit: Inventory
          { account_id: invAcct, debit_amount: 0, credit_amount: cogsAmount, description: `Inventory issued: ${drug.drug_name}` },
        ], pharmacist_id || 'system');
        await AccountingService.postGLEntry(glEntry.id, pharmacist_id || 'system');

        cogsJE = glEntry.gl_number;
        await sequelize.query('UPDATE dispensing_records SET cogs_gl_entry_id = :je WHERE id = :id', { replacements: { je: glEntry.id, id: dispId }, transaction: t });
      } else {
        console.warn(`Dispensing ${dispId}: COGS not posted — dispensed batch has no unit_cost, and item ${drug.id} has no average_unit_cost/current_unit_cost recorded either.`);
      }
    } catch (glError) {
      console.error('GL entry creation warning (non-blocking):', glError.message);
    }
    console.log('✅ Step 10 complete: GL entries created');

    // Step 11 used to auto-bill patient_bills again here, on every dispense —
    // but PrescriptionManagement.tsx's billForPrescription() and
    // DispensingWorkflow.tsx's billForSale() already bill the full prescribed
    // quantity once, at prescription/sale creation time, by design (see the
    // comment on billForPrescription: "Dispensing is pure fulfillment and does
    // not bill again"). This block contradicted that and double-billed the
    // patient — once at prescription time for the full quantity, again here
    // for whatever quantity was actually dispensed, both landing in the same
    // day's bill. Removed rather than reconciled, since the documented design
    // already puts billing at prescribe-time; dispensing intentionally does
    // not touch patient_bills.

    // 11. Controlled substance logging
    if (drug.is_controlled_substance) {
      const [balBefore] = await sequelize.query(
        'SELECT quantity_on_hand FROM inventory_items WHERE id = :id',
        { replacements: { id: inventoryItemId }, transaction: t }
      );
      await sequelize.query(`
        INSERT INTO controlled_substance_log (id, clinic_id, drug_id, dispensing_record_id,
          quantity_dispensed, patient_id, dispensed_by, dispensing_date,
          balance_before, balance_after)
        VALUES (:id, :cid, :did, :drid, :qty, :pid, :by, CURRENT_DATE, :before, :after)
      `, {
        replacements: {
          id: uuidv4(), cid, did: drug_id, drid: dispId,
          qty: quantity_dispensed, pid: cleanPatientId, by: cleanPharmacistId,
          before: (balBefore[0]?.quantity_on_hand || 0) + quantity_dispensed,
          after: balBefore[0]?.quantity_on_hand || 0
        },
        transaction: t
      });
      console.log('✅ Step 11 complete: Controlled substance logged');
    }

    // 12. Audit log
    console.log('Step 12: Creating audit log');
    await sequelize.query(`
      INSERT INTO pharmacy_audit_log (id, clinic_id, action_type, reference_id, action_by, action_details)
      VALUES (:id, :cid, 'dispensed', :ref, :by, :details)
    `, {
      replacements: {
        id: uuidv4(), cid, ref: dispensingNumber, by: cleanPharmacistId,
        details: JSON.stringify({ drug: drug.drug_name, qty: quantity_dispensed, price: totalPrice, batch: selectedBatch?.batch_number })
      },
      transaction: t
    });

    await t.commit();
    // Dispensing changes both the prescription/line's status and the item's
    // (and, if from_location_id was given, that location's) stock — both are
    // read back through cached GETs (prescriptions list, drugs list),
    // previously never invalidated. See bustPharmacyCache's own comment.
    bustPharmacyCache(req);

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: cid, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Pharmacy', action: 'DRUG_DISPENSED', entity_type: 'DispensingRecord', entity_id: dispId,
        description: `Dispensed ${quantity_dispensed} × ${drug.drug_name} (${dispensingNumber}) — ${totalPrice}${selectedBatch?.batch_number ? `, batch ${selectedBatch.batch_number}` : ''}`,
        new_values: { drug: drug.drug_name, quantity: quantity_dispensed, total_price: totalPrice, patient_id: cleanPatientId },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.status(201).json({
      id: dispId,
      dispensing_number: dispensingNumber,
      quantity_dispensed,
      unit_price: price,
      total_price: totalPrice,
      batch: selectedBatch?.batch_number || null,
      inventory_transaction_id: invTxnId,
      charge_id: chargeId,
      revenue_gl: revenueJE,
      cogs_gl: cogsJE,
      message: 'Drug dispensed successfully'
    });
  } catch (error) {
    if (t) {
      try {
        await t.rollback();
      } catch (rollbackError) {
        console.error('Transaction rollback error:', rollbackError.message);
      }
    }
    console.error('❌❌❌ ERROR DISPENSING DRUG ❌❌❌');
    console.error('Error dispensing drug:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    if (error.original) {
      console.error('Original error:', error.original);
      console.error('Original error message:', error.original.message);
    }

    res.status(500).json({ error: 'Failed to dispense drug', details: error.message });
  }
});

// ═══════════════════════════════════════════════════
// DISPENSING RETURNS
// ═══════════════════════════════════════════════════

router.get('/returns', authorize('pharmacy.read'), async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    let where = 'WHERE dr2.clinic_id = :cid';
    const replacements = { cid: BranchQueryFilter.resolveClinicId(req) };
    if (from_date) { where += ' AND dr2.return_date >= :fd'; replacements.fd = from_date; }
    if (to_date) { where += ' AND dr2.return_date <= :td'; replacements.td = to_date; }
    const { sql: retBranchSQL, params: retBranchParams } = getBranchConditionSQL(req, 'ii');
    if (retBranchSQL) { where += ' AND ii.branch_id = :retBranchId'; replacements.retBranchId = retBranchParams[0]; }

    const [rows] = await sequelize.query(`
      SELECT dr2.*, dr.dispensing_number, dr.inventory_item_id,
        ii.item_name AS drug_name, ii.item_code AS drug_code,
        COALESCE((p.first_name || ' ' || p.last_name), (lp.first_name || ' ' || lp.last_name)) AS patient_name,
        u.display_name AS processed_by_name
      FROM dispensing_returns dr2
      LEFT JOIN dispensing_records dr ON dr2.dispensing_record_id = dr.id
      LEFT JOIN inventory_items ii ON dr.inventory_item_id = ii.id
      LEFT JOIN patients p ON p.id = dr.patient_id
      LEFT JOIN lis_participants lp ON lp.id = dr.patient_id
      LEFT JOIN users u ON u.id = dr2.processed_by
      ${where}
      ORDER BY dr2.return_date DESC
    `, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing returns:', error);
    res.status(500).json({ error: 'Failed to list returns' });
  }
});

// Process return
router.post('/returns', authorize('pharmacy.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { dispensing_record_id, return_reason, quantity_returned, processed_by, notes } = req.body;
    const cid = BranchQueryFilter.resolveClinicId(req);

    // Get dispensing record
    const [disp] = await sequelize.query('SELECT * FROM dispensing_records WHERE id = :id AND clinic_id = :cid', { replacements: { id: dispensing_record_id, cid }, transaction: t });
    if (disp.length === 0) { await t.rollback(); return res.status(404).json({ error: 'Dispensing record not found' }); }
    const record = disp[0];

    // A dispensing record can be returned in more than one visit (patient
    // returns 2 of 10 tablets today, more later) — this used to always mark
    // the whole record 'returned' after any return and remove it from the
    // "dispensed" picker, permanently blocking further partial returns.
    const [[returnedSoFarRow]] = await sequelize.query(
      'SELECT COALESCE(SUM(quantity_returned), 0) AS total FROM dispensing_returns WHERE dispensing_record_id = :id',
      { replacements: { id: dispensing_record_id }, transaction: t }
    );
    const alreadyReturned = parseFloat(returnedSoFarRow.total || 0);
    const remaining = parseFloat(record.quantity_dispensed) - alreadyReturned;
    const qty = quantity_returned || remaining;
    if (qty <= 0 || qty > remaining + 0.001) {
      await t.rollback();
      return res.status(400).json({ error: `Cannot return ${qty}; only ${remaining} of ${record.quantity_dispensed} dispensed remain un-returned` });
    }

    // Generate return number
    const retNum = `RET-${record.dispensing_number}`;
    const retId = uuidv4();
    const refundAmount = (record.unit_price || 0) * qty;

    await sequelize.query(`
      INSERT INTO dispensing_returns (id, clinic_id, return_number, dispensing_record_id,
        return_date, return_reason, quantity_returned, amount_refunded, refund_method, processed_by, notes)
      VALUES (:id, :cid, :rn, :drid, CURRENT_DATE, :reason, :qty, :amt, 'cash', :by, :notes)
    `, {
      replacements: {
        id: retId, cid, rn: retNum, drid: dispensing_record_id,
        reason: return_reason || 'unused', qty, amt: refundAmount,
        by: processed_by || null, notes: notes || null
      },
      transaction: t
    });

    // Reverse inventory
    if (record.inventory_item_id) {
      const invTxnId = uuidv4();
      await sequelize.query(`
        INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
          quantity_change, from_location_id, batch_id, unit_cost, total_cost,
          reference_type, reference_id, transaction_date, notes, created_by)
        VALUES (:id, :cid, :txn, :iid, 'return_from_patient', :qty, :flid, :bid, :cost, :total,
          'return', :ref, CURRENT_DATE, :notes, :by)
      `, {
        replacements: {
          id: invTxnId, cid, txn: `TXN-RET-${record.dispensing_number}`,
          iid: record.inventory_item_id, qty: qty, flid: record.from_location_id || null,
          bid: record.batch_id || null, cost: 0, total: 0,
          ref: retNum, notes: `Return: ${return_reason || 'unused'}`, by: processed_by || null
        },
        transaction: t
      });

      // Restore stock
      await sequelize.query('UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + :qty WHERE id = :id',
        { replacements: { qty, id: record.inventory_item_id }, transaction: t });
      if (record.batch_id) {
        await sequelize.query('UPDATE inventory_batches SET quantity_used = GREATEST(0, quantity_used - :qty) WHERE id = :id',
          { replacements: { qty, id: record.batch_id }, transaction: t });
      }

      await sequelize.query('UPDATE dispensing_returns SET inventory_reversal_done = true, inventory_transaction_id = :tid WHERE id = :id',
        { replacements: { tid: invTxnId, id: retId }, transaction: t });
    }

    // Only flip to fully 'returned' once every dispensed unit has come back;
    // otherwise 'partially_returned' keeps it selectable for the remainder.
    const nowFullyReturned = (alreadyReturned + qty) >= parseFloat(record.quantity_dispensed) - 0.001;
    await sequelize.query(
      "UPDATE dispensing_records SET status = :status, return_date = CURRENT_DATE, return_reason = :reason WHERE id = :id",
      { replacements: { status: nowFullyReturned ? 'returned' : 'partially_returned', reason: return_reason || 'unused', id: dispensing_record_id }, transaction: t });

    // Audit log
    await sequelize.query(`
      INSERT INTO pharmacy_audit_log (id, clinic_id, action_type, reference_id, action_by, action_details)
      VALUES (:id, :cid, 'returned', :ref, :by, :details)
    `, {
      replacements: {
        id: uuidv4(), cid, ref: retNum, by: processed_by || null,
        details: JSON.stringify({ dispensing: record.dispensing_number, qty, refund: refundAmount })
      },
      transaction: t
    });

    await t.commit();

    // Put the refunded cash on the books.
    //
    // Returning stock used to reverse the inventory and nothing else: the money
    // handed back to the patient touched no account anywhere, so revenue stayed
    // recognised in full, cash on hand read high by the refunded amount, and the
    // refund appeared in no financial report at all — only as a row in
    // dispensing_returns that nothing reads.
    //
    // The entry is the reverse of the sale: debit the revenue that is no longer
    // earned, credit the cash that has left the drawer. Posted after commit and
    // non-blocking, matching every other GL posting in the app — the return
    // itself (stock, audit trail) has already succeeded and must not be undone
    // by an accounting problem, but a failure is logged loudly enough to be
    // reconciled rather than swallowed.
    if (refundAmount > 0) {
      try {
        // 4120 is where pharmacy sales land once revenue is split by service
        // line; 4100 is the pre-split catch-all that older tenants still use.
        const revenueAccount = (await AccountingService.getAccountByCode(cid, '4120'))
          || (await AccountingService.getAccountByCode(cid, '4100'));
        // refund_method is recorded as 'cash' above, so the credit goes to the
        // cash account collections actually land in — 1100 (Cash), matching the
        // preference used everywhere else cash moves (patientBills.js,
        // patientDeposits.js, cashier.js, receipts.js) — not the bank. 1105 (Cash
        // at Hand) is the fallback for tenants that never got 1100 set up.
        const cashAccount = (await AccountingService.getAccountByCode(cid, '1100'))
          || (await AccountingService.getAccountByCode(cid, '1105'));

        if (revenueAccount && cashAccount) {
          const description = `Pharmacy refund ${retNum} — ${qty} unit(s) returned from ${record.dispensing_number} (${return_reason || 'unused'})`;
          const glEntry = await AccountingService.createGLEntry({
            clinic_id: cid,
            transaction_date: new Date().toISOString().split('T')[0],
            transaction_type: 'pharmacy_return_refund',
            description,
            reference_id: retNum,
            reference_module: 'pharmacy_return',
          }, [
            { account_id: revenueAccount.id, debit_amount: refundAmount, credit_amount: 0, description: `Reverse pharmacy revenue on return ${retNum}` },
            { account_id: cashAccount.id, debit_amount: 0, credit_amount: refundAmount, description: `Cash refunded to patient for return ${retNum}` },
          ], req.user?.id || 'system');
          await AccountingService.postGLEntry(glEntry.id, req.user?.id || 'system');
          // revenue_reversal_gl_id already existed on this table — the schema
          // anticipated this posting, only the code never did it.
          await sequelize.query('UPDATE dispensing_returns SET revenue_reversal_gl_id = :gid WHERE id = :id',
            { replacements: { gid: glEntry.id, id: retId } });
        } else {
          console.error(`Pharmacy return ${retNum}: refund of ${refundAmount} NOT posted to the GL — missing account (revenue 4120/4100: ${!!revenueAccount}, cash 1100/1105: ${!!cashAccount}) for clinic ${cid}`);
        }
      } catch (glErr) {
        console.error(`Pharmacy return ${retNum}: refund of ${refundAmount} failed to post to the GL —`, glErr.message);
      }
    }

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: cid, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Pharmacy', action: 'DRUG_RETURNED', entity_type: 'DispensingRecord', entity_id: dispensing_record_id,
        description: `Returned ${qty} × ${record.dispensing_number} (${return_reason || 'unused'}) — refund ${refundAmount}`,
        new_values: { quantity_returned: qty, refund: refundAmount, reason: return_reason || 'unused' },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.status(201).json({ id: retId, return_number: retNum, quantity_returned: qty, amount_refunded: refundAmount, message: 'Return processed' });
  } catch (error) {
    await t.rollback();
    console.error('Error processing return:', error);
    res.status(500).json({ error: 'Failed to process return' });
  }
});

// ═══════════════════════════════════════════════════
// PHARMACY CHARGES
// ═══════════════════════════════════════════════════

router.get('/charges', authorize('pharmacy.read'), async (req, res) => {
  try {
    const { patient_id, is_billed, payment_status } = req.query;
    let where = 'WHERE pc.clinic_id = :cid';
    const replacements = { cid: BranchQueryFilter.resolveClinicId(req) };
    if (patient_id) { where += ' AND pc.patient_id = :pid'; replacements.pid = patient_id; }
    if (is_billed !== undefined) { where += ' AND pc.is_billed = :billed'; replacements.billed = is_billed === 'true' ? 1 : 0; }
    if (payment_status && payment_status !== 'all') { where += ' AND pc.payment_status = :ps'; replacements.ps = payment_status; }
    const { sql: chgBranchSQL, params: chgBranchParams } = getBranchConditionSQL(req, 'pc');
    if (chgBranchSQL) { where += ' AND pc.branch_id = :chgBranchId'; replacements.chgBranchId = chgBranchParams[0]; }

    const [rows] = await sequelize.query(`
      SELECT pc.*, (p.first_name || ' ' || p.last_name) AS patient_name
      FROM pharmacy_charges pc
      LEFT JOIN patients p ON p.id = pc.patient_id
      ${where}
      ORDER BY pc.charge_date DESC
    `, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing charges:', error);
    res.status(500).json({ error: 'Failed to list charges' });
  }
});

// Mark charge as billed
router.post('/charges/:id/bill', authorize('pharmacy.write'), async (req, res) => {
  try {
    const { bill_id, bill_item_id } = req.body;
    await sequelize.query(
      'UPDATE pharmacy_charges SET is_billed = true, billing_date = CURRENT_DATE, bill_id = :bid, bill_item_id = :biid WHERE id = :id',
      { replacements: { bid: bill_id || null, biid: bill_item_id || null, id: req.params.id } }
    );
    res.json({ message: 'Charge marked as billed' });
  } catch (error) {
    console.error('Error billing charge:', error);
    res.status(500).json({ error: 'Failed to bill charge' });
  }
});

// Bulk update charge payment status by dispensing numbers
router.post('/charges/update-payment-status', authorize('pharmacy.write'), async (req, res) => {
  try {
    const { dispensing_numbers, payment_status, receipt_id } = req.body;
    if (!dispensing_numbers || !Array.isArray(dispensing_numbers) || dispensing_numbers.length === 0) {
      return res.status(400).json({ error: 'dispensing_numbers array required' });
    }
    const validStatuses = ['paid', 'invoiced', 'pending', 'partial'];
    const status = validStatuses.includes(payment_status) ? payment_status : 'paid';

    // pharmacy_charges.charge_number = 'CHG-{dispensing_number}'
    const chargeNumbers = dispensing_numbers.map(dn => `CHG-${dn}`);
    const placeholders = chargeNumbers.map((_, i) => `:cn${i}`).join(',');
    const replacements = {};
    chargeNumbers.forEach((cn, i) => { replacements[`cn${i}`] = cn; });
    replacements.status = status;

    await sequelize.query(
      `UPDATE pharmacy_charges SET is_billed = true, billing_date = CURRENT_DATE, payment_status = :status WHERE charge_number IN (${placeholders})`,
      { replacements }
    );

    // Also update dispensing_records is_billed
    const dnPlaceholders = dispensing_numbers.map((_, i) => `:dn${i}`).join(',');
    dispensing_numbers.forEach((dn, i) => { replacements[`dn${i}`] = dn; });
    await sequelize.query(
      `UPDATE dispensing_records SET is_billed = true WHERE dispensing_number IN (${dnPlaceholders})`,
      { replacements }
    );

    console.log(`✅ Updated ${chargeNumbers.length} charge(s) to ${status}`);
    res.json({ message: `Charges updated to ${status}`, count: chargeNumbers.length });
  } catch (error) {
    console.error('Error updating charge payment status:', error.message);
    res.status(500).json({ error: 'Failed to update charge status' });
  }
});

// ═══════════════════════════════════════════════════
// INSURANCE PRICING
// ═══════════════════════════════════════════════════

router.get('/insurance-pricing/:drugId', authorize('pharmacy.read'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(
      'SELECT * FROM pharmacy_insurance_pricing WHERE drug_id = :did ORDER BY insurance_type',
      { replacements: { did: req.params.drugId } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error getting insurance pricing:', error);
    res.status(500).json({ error: 'Failed to get insurance pricing' });
  }
});

router.post('/insurance-pricing', authorize('pharmacy.write'), async (req, res) => {
  try {
    const id = uuidv4();
    const { drug_id, insurance_type, unit_price, currency_code, patient_copay, insurance_covers, effective_from, effective_to } = req.body;
    const fallbackCurrency = currency_code || (await CurrencyService.getBaseCurrency()).code;
    await sequelize.query(`
      INSERT INTO pharmacy_insurance_pricing (id, clinic_id, drug_id, insurance_type, unit_price, currency_code, patient_copay, insurance_covers, effective_from, effective_to)
      VALUES (:id, :cid, :did, :type, :price, :curr, :copay, :covers, :from, :to)
    `, {
      replacements: {
        id, cid: BranchQueryFilter.resolveClinicId(req), did: drug_id, type: insurance_type || 'general',
        price: unit_price || 0, curr: fallbackCurrency,
        copay: patient_copay || 0, covers: insurance_covers || 0,
        from: effective_from || null, to: effective_to || null
      }
    });
    res.status(201).json({ id, message: 'Insurance pricing created' });
  } catch (error) {
    console.error('Error creating insurance pricing:', error);
    res.status(500).json({ error: 'Failed to create insurance pricing' });
  }
});

// ═══════════════════════════════════════════════════
// PHARMACY REPORTS
// ═══════════════════════════════════════════════════

// Dashboard stats
router.get('/dashboard-stats', authorize('pharmacy.read'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    // dispensing_records/dispensing_returns/pharmacy_charges/pharmacy_prescriptions/
    // inventory_items/inventory_batches all carry their own branch_id — resolve the
    // branch param once (getBranchConditionSQL with no alias, so only its `params`
    // are used) and apply it against each table's own alias below.
    const { sql: dsBranchSQL, params: dsBranchParams } = getBranchConditionSQL(req);
    const branchId = dsBranchSQL ? dsBranchParams[0] : null;
    const branchClause = (alias) => (branchId ? ` AND ${alias}.branch_id = :branchId` : '');
    const reps = { cid, branchId };

    const [pending] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM pharmacy_prescriptions WHERE clinic_id = :cid AND status = 'pending'${branchClause('pharmacy_prescriptions')}`, { replacements: reps });
    const [todayDisp] = await sequelize.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_price), 0) AS revenue FROM dispensing_records WHERE clinic_id = :cid AND dispensing_date = CURRENT_DATE AND status = 'dispensed'${branchClause('dispensing_records')}`, { replacements: reps });
    const [todayReturns] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM dispensing_returns WHERE clinic_id = :cid AND return_date = CURRENT_DATE${branchClause('dispensing_returns')}`, { replacements: reps });
    const [pendingCharges] = await sequelize.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(charge_amount), 0) AS total FROM pharmacy_charges WHERE clinic_id = :cid AND is_billed = false${branchClause('pharmacy_charges')}`, { replacements: reps });
    const [lowStock] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM inventory_items ii
      WHERE ii.clinic_id = :cid AND ii.is_active = true AND ii.quantity_on_hand <= ii.minimum_stock_level AND ii.minimum_stock_level > 0${branchClause('ii')}
    `, { replacements: reps });
    const [expiringBatches] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM inventory_batches ib
      JOIN inventory_items ii ON ib.item_id = ii.id
      WHERE ii.clinic_id = :cid AND ib.status = 'active'
        AND ib.expiry_date IS NOT NULL AND ib.expiry_date <= CURRENT_DATE + INTERVAL '30 days'${branchClause('ii')}
    `, { replacements: reps });

    // Recent dispensing
    const [recentDisp] = await sequelize.query(`
      SELECT dr.dispensing_number, dr.dispensing_date, dr.quantity_dispensed, dr.total_price,
        ii.item_name AS drug_name, (p.first_name || ' ' || p.last_name) AS patient_name
      FROM dispensing_records dr
      LEFT JOIN inventory_items ii ON dr.inventory_item_id = ii.id
      LEFT JOIN patients p ON p.id = dr.patient_id
      WHERE dr.clinic_id = :cid AND dr.status = 'dispensed'${branchClause('dr')}
      ORDER BY dr.created_at DESC LIMIT 10
    `, { replacements: reps });

    // Top drugs dispensed (last 30 days)
    const [topDrugs] = await sequelize.query(`
      SELECT ii.item_name AS drug_name, SUM(dr.quantity_dispensed) AS total_qty, COUNT(*) AS dispense_count,
        SUM(dr.total_price) AS total_revenue
      FROM dispensing_records dr
      JOIN inventory_items ii ON dr.inventory_item_id = ii.id
      WHERE dr.clinic_id = :cid AND dr.dispensing_date >= CURRENT_DATE - INTERVAL '30 days' AND dr.status = 'dispensed'${branchClause('dr')}
      GROUP BY ii.id, ii.item_name
      ORDER BY total_qty DESC LIMIT 10
    `, { replacements: reps });

    res.json({
      pending_prescriptions: pending[0]?.cnt || 0,
      today_dispensed: todayDisp[0]?.cnt || 0,
      today_revenue: todayDisp[0]?.revenue || 0,
      today_returns: todayReturns[0]?.cnt || 0,
      pending_charges: pendingCharges[0]?.cnt || 0,
      pending_charge_amount: pendingCharges[0]?.total || 0,
      low_stock_drugs: lowStock[0]?.cnt || 0,
      expiring_batches: expiringBatches[0]?.cnt || 0,
      recent_dispensing: recentDisp,
      top_drugs: topDrugs
    });
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

// Dispensing summary report
router.get('/reports/dispensing-summary', authorize('pharmacy.read'), async (req, res) => {
  try {
    const { from_date, to_date, group_by } = req.query;
    const cid = BranchQueryFilter.resolveClinicId(req);
    const fd = from_date || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const td = to_date || new Date().toISOString().split('T')[0];

    const replacements = { cid, fd, td };
    let branchWhere = '';
    const { sql: dsBranchSQL, params: dsBranchParams } = getBranchConditionSQL(req, 'dr');
    if (dsBranchSQL) { branchWhere = ' AND dr.branch_id = :dsBranchId'; replacements.dsBranchId = dsBranchParams[0]; }

    const groupCol = group_by === 'drug' ? 'ii.item_name' : 'dr.dispensing_date';
    const [rows] = await sequelize.query(`
      SELECT ${groupCol} AS group_key, COUNT(*) AS dispense_count,
        SUM(dr.quantity_dispensed) AS total_quantity,
        SUM(dr.total_price) AS total_revenue
      FROM dispensing_records dr
      LEFT JOIN inventory_items ii ON dr.inventory_item_id = ii.id
      WHERE dr.clinic_id = :cid AND dr.dispensing_date BETWEEN :fd AND :td AND dr.status = 'dispensed'${branchWhere}
      GROUP BY ${groupCol}
      ORDER BY ${group_by === 'drug' ? 'total_revenue DESC' : 'group_key DESC'}
    `, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error getting dispensing summary:', error);
    res.status(500).json({ error: 'Failed to get dispensing summary' });
  }
});

// Revenue report
router.get('/reports/revenue', authorize('pharmacy.read'), async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const cid = BranchQueryFilter.resolveClinicId(req);
    const fd = from_date || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const td = to_date || new Date().toISOString().split('T')[0];

    const replacements = { cid, fd, td };
    let branchWhere = '';
    const { sql: revBranchSQL, params: revBranchParams } = getBranchConditionSQL(req);
    if (revBranchSQL) { branchWhere = ' AND branch_id = :revBranchId'; replacements.revBranchId = revBranchParams[0]; }

    const [daily] = await sequelize.query(`
      SELECT dispensing_date, COUNT(*) AS dispense_count,
        SUM(total_price) AS revenue, SUM(quantity_dispensed) AS qty
      FROM dispensing_records
      WHERE clinic_id = :cid AND dispensing_date BETWEEN :fd AND :td AND status = 'dispensed'${branchWhere}
      GROUP BY dispensing_date ORDER BY dispensing_date
    `, { replacements });

    const [totals] = await sequelize.query(`
      SELECT COUNT(*) AS total_dispenses, SUM(total_price) AS total_revenue,
        SUM(quantity_dispensed) AS total_qty, AVG(total_price) AS avg_per_dispense
      FROM dispensing_records
      WHERE clinic_id = :cid AND dispensing_date BETWEEN :fd AND :td AND status = 'dispensed'${branchWhere}
    `, { replacements });

    res.json({ daily, totals: totals[0] });
  } catch (error) {
    console.error('Error getting revenue report:', error);
    res.status(500).json({ error: 'Failed to get revenue report' });
  }
});

// Top drugs
router.get('/reports/top-drugs', authorize('pharmacy.read'), async (req, res) => {
  try {
    const { from_date, to_date, limit: lim } = req.query;
    const cid = BranchQueryFilter.resolveClinicId(req);
    const fd = from_date || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const td = to_date || new Date().toISOString().split('T')[0];

    const replacements = { cid, fd, td, lim: parseInt(lim) || 20 };
    let branchWhere = '';
    const { sql: tdBranchSQL, params: tdBranchParams } = getBranchConditionSQL(req, 'dr');
    if (tdBranchSQL) { branchWhere = ' AND dr.branch_id = :tdBranchId'; replacements.tdBranchId = tdBranchParams[0]; }

    const [rows] = await sequelize.query(`
      SELECT ii.item_name AS drug_name, d.generic_name, ii.item_category AS therapeutic_category,
        SUM(dr.quantity_dispensed) AS total_qty, COUNT(*) AS dispense_count,
        SUM(dr.total_price) AS total_revenue
      FROM dispensing_records dr
      JOIN inventory_items ii ON dr.inventory_item_id = ii.id
      LEFT JOIN drugs d ON d.inventory_item_id = ii.id
      WHERE dr.clinic_id = :cid AND dr.dispensing_date BETWEEN :fd AND :td AND dr.status = 'dispensed'${branchWhere}
      GROUP BY ii.id, ii.item_name, d.generic_name, ii.item_category
      ORDER BY total_qty DESC
      LIMIT :lim
    `, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error getting top drugs:', error);
    res.status(500).json({ error: 'Failed to get top drugs' });
  }
});

// Stock usage report
router.get('/reports/stock-usage', authorize('pharmacy.read'), async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const cid = BranchQueryFilter.resolveClinicId(req);
    const fd = from_date || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const td = to_date || new Date().toISOString().split('T')[0];

    const replacements = { cid, fd, td };
    let branchWhere = '';
    const { sql: suBranchSQL, params: suBranchParams } = getBranchConditionSQL(req, 'ii');
    if (suBranchSQL) { branchWhere = ' AND ii.branch_id = :suBranchId'; replacements.suBranchId = suBranchParams[0]; }

    const [rows] = await sequelize.query(`
      SELECT ii.item_name AS drug_name, ii.item_code AS drug_code,
        ii.quantity_on_hand AS current_stock,
        ii.minimum_stock_level AS reorder_level,
        COALESCE(SUM(dr.quantity_dispensed), 0) AS dispensed_qty,
        -- Day span, and every division kept in numeric.
        --
        -- This read (:DATE(td) - :DATE(fd)), a mangled DATEDIFF conversion:
        -- the :DATE part parses as a named bind parameter, so the statement
        -- failed with "syntax error at or near :". Subtracting two dates
        -- already yields an integer number of days. The ::numeric casts matter
        -- too — integer division would floor an average like 1.6 to 1, and
        -- ROUND(double precision, int) has no PostgreSQL overload.
        ROUND(COALESCE(SUM(dr.quantity_dispensed), 0)::numeric
              / GREATEST((:td::date - :fd::date), 1), 2) AS avg_daily_usage,
        CASE WHEN COALESCE(SUM(dr.quantity_dispensed), 0) > 0
          THEN ROUND(ii.quantity_on_hand::numeric
               / (SUM(dr.quantity_dispensed)::numeric / GREATEST((:td::date - :fd::date), 1)), 1)
          ELSE 999 END AS days_of_stock
      FROM inventory_items ii
      LEFT JOIN dispensing_records dr ON dr.inventory_item_id = ii.id
        AND dr.dispensing_date BETWEEN :fd AND :td AND dr.status = 'dispensed'
      WHERE ii.clinic_id = :cid AND ii.is_active = true${branchWhere}
      GROUP BY ii.id, ii.item_name, ii.item_code, ii.quantity_on_hand, ii.minimum_stock_level
      ORDER BY days_of_stock ASC
    `, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error getting stock usage:', error);
    res.status(500).json({ error: 'Failed to get stock usage' });
  }
});

// Billing status report
router.get('/reports/billing-status', authorize('pharmacy.read'), async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const cid = BranchQueryFilter.resolveClinicId(req);
    const fd = from_date || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const td = to_date || new Date().toISOString().split('T')[0];

    const summaryReps = { cid, fd, td };
    let summaryBranchWhere = '';
    const { sql: bsBranchSQL, params: bsBranchParams } = getBranchConditionSQL(req);
    if (bsBranchSQL) { summaryBranchWhere = ' AND branch_id = :bsBranchId'; summaryReps.bsBranchId = bsBranchParams[0]; }

    const [summary] = await sequelize.query(`
      SELECT payment_status, COUNT(*) AS count, SUM(charge_amount) AS total
      FROM pharmacy_charges
      WHERE clinic_id = :cid AND charge_date BETWEEN :fd AND :td${summaryBranchWhere}
      GROUP BY payment_status
    `, { replacements: summaryReps });

    const unbilledReps = { cid };
    let unbilledBranchWhere = '';
    const { sql: ubBranchSQL, params: ubBranchParams } = getBranchConditionSQL(req, 'pc');
    if (ubBranchSQL) { unbilledBranchWhere = ' AND pc.branch_id = :ubBranchId'; unbilledReps.ubBranchId = ubBranchParams[0]; }

    const [unbilled] = await sequelize.query(`
      SELECT pc.*, (p.first_name || ' ' || p.last_name) AS patient_name
      FROM pharmacy_charges pc
      LEFT JOIN patients p ON p.id = pc.patient_id
      WHERE pc.clinic_id = :cid AND pc.is_billed = false${unbilledBranchWhere}
      ORDER BY pc.charge_date DESC LIMIT 50
    `, { replacements: unbilledReps });

    res.json({ summary, unbilled });
  } catch (error) {
    console.error('Error getting billing status:', error);
    res.status(500).json({ error: 'Failed to get billing status' });
  }
});

// ═══════════════════════════════════════════════════
// PHARMACY SETTINGS
// ═══════════════════════════════════════════════════

router.get('/settings', authorize('pharmacy.admin'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    const [rows] = await sequelize.query('SELECT * FROM pharmacy_settings WHERE clinic_id = :cid LIMIT 1', { replacements: { cid } });
    res.json(rows.length > 0 ? rows[0] : {});
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

router.put('/settings', authorize('pharmacy.admin'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    const [existing] = await sequelize.query('SELECT id FROM pharmacy_settings WHERE clinic_id = :cid', { replacements: { cid } });

    if (existing.length === 0) {
      await sequelize.query(`
        INSERT INTO pharmacy_settings (id, clinic_id) VALUES (:id, :cid)
      `, { replacements: { id: uuidv4(), cid } });
    }

    const fields = [];
    const replacements = { cid };
    const allowed = [
      'allow_partial_dispensing', 'require_allergy_check', 'require_interaction_check',
      'require_patient_counselling', 'auto_check_stock_before_dispensing', 'warn_if_stock_below_days',
      'auto_reserve_stock_on_prescription', 'default_pharmacy_location_id',
      'default_markup_percentage', 'round_to_nearest', 'include_tax_in_price', 'default_tax_rate',
      'default_dispensing_currency', 'accept_usd_payments', 'accept_ssp_payments',
      'auto_create_bill_on_dispensing', 'auto_charge_amount', 'bill_immediately',
      'require_bill_approval_above', 'allow_returns', 'return_window_days',
      'auto_reverse_inventory_on_return',
      'pharmacy_revenue_account_id', 'pharmacy_cogs_account_id',
      'pharmacy_discount_account_id', 'pharmacy_receivables_account_id'
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = :${key}`); replacements[key] = req.body[key]; }
    }
    if (fields.length > 0) {
      await sequelize.query(`UPDATE pharmacy_settings SET ${fields.join(', ')} WHERE clinic_id = :cid`, { replacements });
    }

    res.json({ message: 'Settings saved' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ═══════════════════════════════════════════════════
// CONTROLLED SUBSTANCES
// ═══════════════════════════════════════════════════

router.get('/controlled-substances', authorize('pharmacy.controlled_substances.read'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    const replacements = { cid };
    let where = 'WHERE ii.clinic_id = :cid AND ii.is_controlled_substance = true AND ii.is_active = true';
    const { sql: csBranchSQL, params: csBranchParams } = getBranchConditionSQL(req, 'ii');
    if (csBranchSQL) { where += ' AND ii.branch_id = :csBranchId'; replacements.csBranchId = csBranchParams[0]; }
    const [rows] = await sequelize.query(`
      SELECT ii.id, ii.item_code AS drug_code, ii.item_name AS drug_name,
        ii.quantity_on_hand AS current_stock, ii.is_controlled_substance,
        d.strength, d.dosage_form, d.generic_name
      FROM inventory_items ii
      LEFT JOIN drugs d ON d.inventory_item_id = ii.id
      ${where}
      ORDER BY ii.item_name
    `, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing controlled substances:', error);
    res.status(500).json({ error: 'Failed to list controlled substances' });
  }
});

// controlled_substance_log has no branch_id column of its own (only
// clinic_id) — branch (and clinic) isolation is enforced by joining to the
// drug's own inventory_items row, same as the list route above.
router.get('/controlled-substances/:drugId/audit-log', authorize('pharmacy.controlled_substances.read'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    const replacements = { did: req.params.drugId, cid };
    let where = 'WHERE csl.drug_id = :did AND ii.clinic_id = :cid';
    const { sql: auditBranchSQL, params: auditBranchParams } = getBranchConditionSQL(req, 'ii');
    if (auditBranchSQL) { where += ' AND ii.branch_id = :auditBranchId'; replacements.auditBranchId = auditBranchParams[0]; }
    const [rows] = await sequelize.query(`
      SELECT csl.*, (p.first_name || ' ' || p.last_name) AS patient_name, u.display_name AS dispensed_by_name
      FROM controlled_substance_log csl
      JOIN inventory_items ii ON ii.id = csl.drug_id
      LEFT JOIN patients p ON p.id = csl.patient_id
      LEFT JOIN users u ON u.id = csl.dispensed_by
      ${where}
      ORDER BY csl.dispensing_date DESC, csl.created_at DESC
    `, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error getting audit log:', error);
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

// ═══════════════════════════════════════════════════
// ACCOUNTING CURRENCY (read from accounting system)
// ═══════════════════════════════════════════════════

router.get('/currency-settings', authorize('pharmacy.read'), async (req, res) => {
  try {
    const cid = BranchQueryFilter.resolveClinicId(req);
    // Fetch base currency dynamically from CurrencyService
    const baseCurrencyData = await CurrencyService.getBaseCurrency();
    const baseCurrency = baseCurrencyData.code;

    // Get exchange rates from accounting
    const [rates] = await sequelize.query(`
      SELECT from_currency, to_currency, rate, effective_date
      FROM exchange_rates
      WHERE clinic_id = :cid AND is_active = true
      ORDER BY effective_date DESC
    `, { replacements: { cid } });

    // Get all active currencies
    const currencies = await CurrencyService.getCurrencies();
    const currencyCodes = currencies.map(c => c.code);

    res.json({
      base_currency: baseCurrency,
      supported_currencies: currencyCodes.length ? currencyCodes : [baseCurrency],
      exchange_rates: rates
    });
  } catch (error) {
    console.error('Error getting currency settings:', error);
    // A real DB failure here has no honest answer for "which currencies does
    // this tenant support" — asserting a fixed list (previously SSP/USD/KES)
    // would just be a guess dressed up as data, and a wrong one for any tenant
    // not actually using those three. Empty means "unknown", not "none exist".
    res.status(503).json({ base_currency: null, supported_currencies: [], exchange_rates: [], error: 'Could not load currency settings' });
  }
});

// ═══════════════════════════════════════════════════
// PHARMACY DISPENSING RECEIPTS
// ═══════════════════════════════════════════════════

router.post('/dispensing-receipt', authorize('pharmacy.write'), async (req, res) => {
  try {
    const data = req.body;
    console.log('=== Creating pharmacy dispensing receipt ===');

    const receiptNumber = `PHARM-${Date.now().toString().slice(-8)}`;
    const receiptId = uuidv4();

    // Sanitize every field defensively
    const billId = data.bill_id || null;
    const patientId = data.patient_id || null;
    const patientName = data.patient_name || 'Walk-in Patient';
    const clinicId = parseInt(data.clinic_id) || 1;
    const paymentAmount = parseFloat(data.payment_amount) || 0;
    // Ensure payment_method is a valid enum value
    const validMethods = ['cash', 'card', 'check', 'lease', 'insurance'];
    const paymentMethod = validMethods.includes(data.payment_method) ? data.payment_method : 'cash';
    const paymentDate = data.payment_date ? new Date(data.payment_date) : new Date();
    const paidServices = typeof data.paid_services === 'string' ? data.paid_services : JSON.stringify(data.paid_services || []);
    const serviceDetails = typeof data.service_details === 'string' ? data.service_details : JSON.stringify(data.service_details || []);
    const notes = data.notes || null;
    const cashierName = data.cashier_name || req.user?.displayName || req.user?.name || req.user?.email || 'Pharmacist';
    const cashierId = data.cashier_id || req.user?.userId || null;

    // Get branch_id from middleware or body
    let branchId = null;
    try {
      const { getCreateBranchId } = require('../middleware/branchFilter');
      branchId = getCreateBranchId(req);
    } catch (e) { /* middleware not available */ }
    if (!branchId && data.branch_id) branchId = data.branch_id;

    console.log('Receipt fields:', { receiptId, receiptNumber, billId, patientId, patientName, clinicId, paymentAmount, paymentMethod, branchId });

    await sequelize.query(`
      INSERT INTO receipts (id, receipt_number, bill_id, patient_id, patient_name, clinic_id,
        total_amount, amount_paid, payment_amount, payment_method, payment_date, paid_services, service_details,
        notes, from_lease, cashier_name, cashier_id, branch_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
    `, {
      replacements: [
        receiptId, receiptNumber, billId, patientId, patientName, clinicId,
        paymentAmount, paymentAmount, paymentAmount, paymentMethod, paymentDate, paidServices, serviceDetails,
        notes, false, cashierName, cashierId, branchId
      ]
    });

    console.log('✅ Pharmacy dispensing receipt created:', receiptNumber);

    res.json({
      message: 'Receipt created',
      receipt: {
        id: receiptId,
        receipt_number: receiptNumber,
        patient_name: patientName,
        payment_amount: paymentAmount,
        payment_method: paymentMethod,
        status: 'active',
      }
    });
  } catch (error) {
    console.error('❌ Error creating pharmacy dispensing receipt:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Failed to create receipt', details: error.message });
  }
});


/**
 * Stock movement for the pharmacy dashboard.
 *
 * A pharmacy user's dashboard has no use for takings and receivables — what
 * matters on their shift is what is moving, what is sitting still, and what
 * just left the shelf. This serves both panels the pharmacy dashboard shows in
 * place of the billing ones.
 *
 * Items are bucketed by quantity dispensed over the period:
 *
 *   fast     the top third of items that actually moved
 *   average  the middle third
 *   slow     the bottom third, plus everything that never moved at all
 *
 * Terciles rather than fixed thresholds, because "fast" only means anything
 * relative to the rest of this pharmacy's catalogue — a busy clinic and a small
 * one would need different absolute cut-offs. Items never dispensed are folded
 * into slow deliberately: dead stock is the signal a pharmacist most needs.
 */
router.get('/stock-movement', authorize('pharmacy.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    // The dashboard's Today/This Week/This Month/custom-range filter (period
    // or startDate+endDate) takes priority when present; `days` is the
    // original rolling-window param, kept as the fallback for any caller
    // that doesn't send the dashboard's filter params.
    let dateFrom, dateTo, days, periodLabel;
    if (req.query.period || (req.query.startDate && req.query.endDate)) {
      const { start, end, label } = resolveDashboardDateRange(req.query);
      // resolveDashboardDateRange builds LOCAL-midnight Date objects (same
      // server-local convention as the rest of the dashboard filter) —
      // toISOString() converts to UTC first, which silently shows the day
      // BEFORE the real local calendar date on a server east of UTC. Format
      // off the local getters instead, same fix as the Analytics Assistant's
      // responseTemplates.js dateRangeQuery.
      const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dateFrom = localDateStr(start);
      dateTo = localDateStr(new Date(end.getTime() - 86400000));
      days = null;
      periodLabel = label;
    } else {
      days = Math.min(parseInt(req.query.days, 10) || 30, 365);
      dateFrom = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
      dateTo = new Date().toISOString().split('T')[0];
    }
    const repl = { clinicId, dateFrom, dateTo };

    const [rows] = await sequelize.query(`
      SELECT ii.id AS "itemId", ii.item_name AS "itemName",
             ii.quantity_on_hand AS "quantityOnHand",
             ii.minimum_stock_level AS "reorderLevel",
             COALESCE(SUM(dr.quantity_dispensed), 0) AS "qtyDispensed",
             COALESCE(SUM(dr.total_price), 0) AS "dispensingValue"
        FROM inventory_items ii
        LEFT JOIN dispensing_records dr
          ON dr.inventory_item_id = ii.id
         AND dr.clinic_id = :clinicId
         AND dr.dispensing_date BETWEEN :dateFrom AND :dateTo
       WHERE ii.clinic_id = :clinicId AND ii.is_active = true
       GROUP BY ii.id, ii.item_name, ii.quantity_on_hand, ii.minimum_stock_level
    `, { replacements: repl });

    const items = rows.map(r => ({
      itemId: r.itemId,
      itemName: r.itemName,
      quantityOnHand: parseInt(r.quantityOnHand, 10) || 0,
      reorderLevel: parseInt(r.reorderLevel, 10) || 0,
      qtyDispensed: parseInt(r.qtyDispensed, 10) || 0,
      dispensingValue: parseFloat(r.dispensingValue) || 0,
    }));

    const moved = items.filter(i => i.qtyDispensed > 0).sort((a, b) => b.qtyDispensed - a.qtyDispensed);
    const never = items.filter(i => i.qtyDispensed === 0);
    const third = Math.ceil(moved.length / 3);

    const fast = moved.slice(0, third);
    const average = moved.slice(third, third * 2);
    const slow = [...moved.slice(third * 2), ...never];

    // The shelf's own recent history, which is what replaces the payments feed.
    const [recent] = await sequelize.query(`
      SELECT t.id, t.transaction_number AS "reference", t.transaction_type AS "type",
             t.quantity_change AS "quantityChange", t.created_at AS "at",
             ii.item_name AS "itemName", ii.unit_of_measure AS "unit"
        FROM inventory_transactions t
        LEFT JOIN inventory_items ii ON ii.id = t.item_id
       WHERE t.clinic_id = :clinicId
       ORDER BY t.created_at DESC
       LIMIT 15
    `, { replacements: { clinicId } });

    res.json({
      period: { dateFrom, dateTo, days, label: periodLabel || `last ${days} days` },
      totals: {
        items: items.length,
        movedItems: moved.length,
        neverMoved: never.length,
        unitsDispensed: items.reduce((s, i) => s + i.qtyDispensed, 0),
        dispensingValue: items.reduce((s, i) => s + i.dispensingValue, 0),
      },
      movement: { fast, average, slow: slow.slice(0, 25) },
      recentMovements: recent.map(r => ({
        id: r.id,
        reference: r.reference,
        type: r.type,
        quantityChange: parseInt(r.quantityChange, 10) || 0,
        itemName: r.itemName || 'Unknown item',
        unit: r.unit || '',
        at: r.at,
      })),
    });
  } catch (error) {
    console.error('Error building stock movement:', error);
    res.status(500).json({ error: 'Failed to build stock movement' });
  }
});

module.exports = router;
