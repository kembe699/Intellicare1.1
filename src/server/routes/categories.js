// ─── Categories (central Categories module) ────────────────────────────────
// CRUD for the `categories` table — see docs/accounting-map/REPORT.md and
// AccountResolver.js. Mirrors fixedAssets.js's asset_categories routes
// (the one existing correct example this feature generalizes), with one
// deliberate difference: asset_categories BLOCKS changing an account once
// any asset uses it; this module instead ALLOWS it (per the approved plan:
// "changing a category's accounts affects FUTURE postings only") and lets
// the frontend show that as a warning, not a hard stop — a category's
// whole point is to be editable as a business's chart of accounts matures.
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');

const ACCOUNT_FIELD_TYPE = {
  revenue_account_id: 'revenue',
  cogs_account_id: 'expense',
  inventory_account_id: 'asset',
  expense_account_id: 'expense',
};
const FIELDS_BY_TYPE = {
  item: ['inventory_account_id', 'cogs_account_id', 'revenue_account_id'],
  service: ['revenue_account_id'],
  expense: ['expense_account_id'],
};
// inventory_account_id/revenue_account_id are required for every item
// category; cogs_account_id is NOT hard-required — 'Equipment'/'General'
// have no COGS account configured today by confirmed decision (see
// seedAndBackfillCategories.js's own comment), and forcing one here would
// make the already-seeded state impossible to re-save from the UI.
const REQUIRED_FIELDS_BY_TYPE = {
  item: ['inventory_account_id', 'revenue_account_id'],
  service: ['revenue_account_id'],
  expense: ['expense_account_id'],
};

async function validateAccounts(sequelize, clinicId, type, fields) {
  // An account picked here that is switched off (e.g. 1310 Pharmaceutical
  // Inventory, off in four tenants' charts) is switched on once everything
  // else checks out — the picker lists it and choosing it is deliberate;
  // refusing with "account is not active" left no way to finish the form.
  const toActivate = [];
  for (const field of Object.keys(ACCOUNT_FIELD_TYPE)) {
    const value = fields[field];
    if (value === undefined || value === null || value === '') continue;
    if (!(FIELDS_BY_TYPE[type] || []).includes(field)) {
      return `${field} does not apply to a ${type} category`;
    }
    const [[acct]] = await sequelize.query(
      `SELECT account_type, is_active FROM chart_of_accounts WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: value, clinicId } }
    );
    if (!acct) return `${field}: account not found`;
    if (!acct.is_active) toActivate.push(value);
    if (acct.account_type !== ACCOUNT_FIELD_TYPE[field]) {
      return `${field} must be a ${ACCOUNT_FIELD_TYPE[field]}-type account (got ${acct.account_type})`;
    }
  }
  const required = REQUIRED_FIELDS_BY_TYPE[type] || [];
  const missing = required.filter((f) => !fields[f]);
  if (missing.length) return `${type} category requires: ${missing.join(', ')}`;
  for (const id of toActivate) {
    await sequelize.query(`UPDATE chart_of_accounts SET is_active = true WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id, clinicId } });
  }
  return null;
}

// ── GET / ───────────────────────────────────────────────────────────────
router.get('/', authorize('categories.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const replacements = { clinicId };
    let sql = `
      SELECT c.*, p.name AS parent_name, d.department_name,
             ra.account_code AS revenue_account_code, ra.account_name AS revenue_account_name,
             ca.account_code AS cogs_account_code, ca.account_name AS cogs_account_name,
             ia.account_code AS inventory_account_code, ia.account_name AS inventory_account_name,
             ea.account_code AS expense_account_code, ea.account_name AS expense_account_name,
             (SELECT COUNT(*) FROM inventory_items WHERE category_id = c.id) AS item_count,
             (SELECT COUNT(*) FROM services WHERE category_id = c.id) AS service_count,
             (SELECT COUNT(*) FROM daily_expenses WHERE category_id = c.id) AS expense_count
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      LEFT JOIN departments d ON d.id = c.department_id
      LEFT JOIN chart_of_accounts ra ON ra.id = c.revenue_account_id
      LEFT JOIN chart_of_accounts ca ON ca.id = c.cogs_account_id
      LEFT JOIN chart_of_accounts ia ON ia.id = c.inventory_account_id
      LEFT JOIN chart_of_accounts ea ON ea.id = c.expense_account_id
      WHERE c.clinic_id = :clinicId`;
    if (req.query.type) { sql += ' AND c.type = :type'; replacements.type = req.query.type; }
    if (req.query.is_active !== undefined) { sql += ' AND c.is_active = :isActive'; replacements.isActive = req.query.is_active === 'true'; }
    else if (!req.query.include_inactive) { sql += ' AND c.is_active = true'; }
    sql += ' ORDER BY c.type, c.sort_order, c.name';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows.map((r) => ({
      ...r,
      item_count: parseInt(r.item_count, 10) || 0,
      service_count: parseInt(r.service_count, 10) || 0,
      expense_count: parseInt(r.expense_count, 10) || 0,
    })));
  } catch (error) {
    console.error('Error listing categories:', error);
    res.status(500).json({ error: 'Failed to list categories' });
  }
});

// ── POST / ──────────────────────────────────────────────────────────────
router.post('/', authorize('categories.manage'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
  const { name, code, type, parent_id: parentId, department_id: departmentId, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (!['item', 'service', 'expense'].includes(type)) return res.status(400).json({ error: "type must be 'item', 'service', or 'expense'" });

  const fields = {
    revenue_account_id: req.body.revenue_account_id || null,
    cogs_account_id: req.body.cogs_account_id || null,
    inventory_account_id: req.body.inventory_account_id || null,
    expense_account_id: req.body.expense_account_id || null,
  };
  const validationError = await validateAccounts(sequelize, clinicId, type, fields);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const id = uuidv4();
    const codeValue = (code && code.trim()) || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    await sequelize.query(
      `INSERT INTO categories (id, clinic_id, name, code, type, parent_id, department_id,
         revenue_account_id, cogs_account_id, inventory_account_id, expense_account_id,
         description, created_by, is_active)
       VALUES (:id, :clinicId, :name, :code, :type, :parentId, :departmentId,
         :revenueAccountId, :cogsAccountId, :inventoryAccountId, :expenseAccountId,
         :description, :createdBy, true)`,
      {
        replacements: {
          id, clinicId, name: name.trim(), code: codeValue, type,
          parentId: parentId || null, departmentId: departmentId || null,
          revenueAccountId: fields.revenue_account_id, cogsAccountId: fields.cogs_account_id,
          inventoryAccountId: fields.inventory_account_id, expenseAccountId: fields.expense_account_id,
          description: description || null, createdBy: req.user?.id || null,
        },
      }
    );
    const [[created]] = await sequelize.query(`SELECT * FROM categories WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    if (error.original?.code === '23505' || /unique/i.test(error.message || '')) {
      return res.status(400).json({ error: 'A category with this name or code already exists for this type' });
    }
    console.error('Error creating category:', error);
    res.status(500).json({ error: error.message || 'Failed to create category' });
  }
});

// ── PUT /:id ────────────────────────────────────────────────────────────
router.put('/:id', authorize('categories.manage'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
  try {
    const [[existing]] = await sequelize.query(`SELECT * FROM categories WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id: req.params.id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const type = existing.type;
    const fields = {
      revenue_account_id: req.body.revenue_account_id !== undefined ? req.body.revenue_account_id : existing.revenue_account_id,
      cogs_account_id: req.body.cogs_account_id !== undefined ? req.body.cogs_account_id : existing.cogs_account_id,
      inventory_account_id: req.body.inventory_account_id !== undefined ? req.body.inventory_account_id : existing.inventory_account_id,
      expense_account_id: req.body.expense_account_id !== undefined ? req.body.expense_account_id : existing.expense_account_id,
    };
    const validationError = await validateAccounts(sequelize, clinicId, type, fields);
    if (validationError) return res.status(400).json({ error: validationError });

    await sequelize.query(
      `UPDATE categories SET
         name = COALESCE(:name, name),
         parent_id = CASE WHEN :parentIdProvided THEN :parentId ELSE parent_id END,
         department_id = CASE WHEN :departmentIdProvided THEN :departmentId ELSE department_id END,
         revenue_account_id = :revenueAccountId, cogs_account_id = :cogsAccountId,
         inventory_account_id = :inventoryAccountId, expense_account_id = :expenseAccountId,
         description = COALESCE(:description, description),
         is_active = COALESCE(:isActive, is_active),
         sort_order = COALESCE(:sortOrder, sort_order),
         updated_by = :updatedBy, updated_at = NOW()
       WHERE id = :id`,
      {
        replacements: {
          id: req.params.id, name: req.body.name?.trim() || null,
          parentIdProvided: req.body.parent_id !== undefined, parentId: req.body.parent_id || null,
          departmentIdProvided: req.body.department_id !== undefined, departmentId: req.body.department_id || null,
          revenueAccountId: fields.revenue_account_id, cogsAccountId: fields.cogs_account_id,
          inventoryAccountId: fields.inventory_account_id, expenseAccountId: fields.expense_account_id,
          description: req.body.description !== undefined ? req.body.description : null,
          isActive: req.body.is_active !== undefined ? req.body.is_active : null,
          sortOrder: req.body.sort_order !== undefined ? req.body.sort_order : null,
          updatedBy: req.user?.id || null,
        },
      }
    );
    const [[updated]] = await sequelize.query(`SELECT * FROM categories WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: error.message || 'Failed to update category' });
  }
});

// ── DELETE /:id — only when unused; deactivate otherwise ────────────────
router.delete('/:id', authorize('categories.manage'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const [[existing]] = await sequelize.query(`SELECT id, type FROM categories WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id: req.params.id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    const [[{ childCount }]] = await sequelize.query(`SELECT COUNT(*)::int AS "childCount" FROM categories WHERE parent_id = :id`, { replacements: { id: req.params.id } });
    if (childCount > 0) return res.status(400).json({ error: `${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'} still point at this one — reassign or remove them first.` });
    const [[{ itemCount }]] = await sequelize.query(`SELECT COUNT(*)::int AS "itemCount" FROM inventory_items WHERE category_id = :id`, { replacements: { id: req.params.id } });
    const [[{ serviceCount }]] = await sequelize.query(`SELECT COUNT(*)::int AS "serviceCount" FROM services WHERE category_id = :id`, { replacements: { id: req.params.id } });
    const [[{ expenseCount }]] = await sequelize.query(`SELECT COUNT(*)::int AS "expenseCount" FROM daily_expenses WHERE category_id = :id`, { replacements: { id: req.params.id } });
    const inUse = itemCount + serviceCount + expenseCount;
    if (inUse > 0) {
      return res.status(400).json({ error: `${inUse} record${inUse === 1 ? '' : 's'} still use this category — deactivate it instead, or reassign ${inUse === 1 ? 'that record' : 'those records'} first.` });
    }
    await sequelize.query(`DELETE FROM categories WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ── POST /bulk-assign — bulk "Change category" action ────────────────────
router.post('/bulk-assign', authorize('categories.manage'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
  const { table, ids, category_id: categoryId } = req.body;
  const TABLES = { inventory_items: 'item', services: 'service', daily_expenses: 'expense' };
  if (!TABLES[table]) return res.status(400).json({ error: 'table must be inventory_items, services, or daily_expenses' });
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array' });
  if (!categoryId) return res.status(400).json({ error: 'category_id is required' });
  try {
    const [[cat]] = await sequelize.query(`SELECT id, type FROM categories WHERE id = :id AND clinic_id = :clinicId AND is_active = true`, { replacements: { id: categoryId, clinicId } });
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    if (cat.type !== TABLES[table]) return res.status(400).json({ error: `This category is type '${cat.type}', not '${TABLES[table]}'` });
    const [, meta] = await sequelize.query(
      `UPDATE ${table} SET category_id = :categoryId WHERE id = ANY(:ids)`,
      { replacements: { categoryId, ids } }
    );
    res.json({ success: true, updated: meta.rowCount });
  } catch (error) {
    console.error('Error bulk-assigning category:', error);
    res.status(500).json({ error: error.message || 'Failed to bulk-assign category' });
  }
});

module.exports = router;
