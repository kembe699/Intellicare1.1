// Fixed Assets — register, categories, depreciation, disposal, revaluation
// and finance-facing reports. GL postings go through AssetService, which
// shares one transaction between an asset's own row and its ledger entry
// (see AssetService.js's docstring) the same way patient billing does.
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const AssetService = require('../services/AssetService');

// Same inline named-parameter branch-scoping convention as accounting.js/
// hr.js/reportOccupancy.js — admins see every branch unless the X-Branch-ID
// header put them into a specific one; everyone else is locked to their own.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

function getCreateBranchId(req) {
  if (!req.user) return null;
  return req.branchContext?.branchId || req.user.branchId || null;
}

// ── Categories ──────────────────────────────────────────────────────────

router.get('/categories', authorize('assets.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const [rows] = await sequelize.query(
      `SELECT ac.*, a1.account_name AS asset_account_name, a2.account_name AS accumulated_depreciation_account_name, a3.account_name AS depreciation_expense_account_name
       FROM asset_categories ac
       LEFT JOIN chart_of_accounts a1 ON a1.id = ac.asset_account_id
       LEFT JOIN chart_of_accounts a2 ON a2.id = ac.accumulated_depreciation_account_id
       LEFT JOIN chart_of_accounts a3 ON a3.id = ac.depreciation_expense_account_id
       WHERE ac.clinic_id = :clinicId ORDER BY ac.name ASC`,
      { replacements: { clinicId } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing asset categories:', error);
    res.status(500).json({ error: 'Failed to list asset categories' });
  }
});

router.post('/categories', authorize('assets.write'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
  const { name, nature, default_depreciation_method: method, default_useful_life_years: life,
    default_salvage_percent: salvagePercent, asset_account_id: assetAccountId,
    accumulated_depreciation_account_id: accumAccountId, depreciation_expense_account_id: expenseAccountId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (!['depreciating', 'appreciating', 'non_depreciating'].includes(nature)) return res.status(400).json({ error: 'nature must be depreciating, appreciating, or non_depreciating' });
  if (!assetAccountId) return res.status(400).json({ error: 'asset_account_id is required' });
  if (nature === 'depreciating' && (!accumAccountId || !expenseAccountId)) {
    return res.status(400).json({ error: 'A depreciating category needs both an accumulated-depreciation account and a depreciation-expense account' });
  }
  try {
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO asset_categories (id, clinic_id, name, nature, default_depreciation_method, default_useful_life_years, default_salvage_percent, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id)
       VALUES (:id, :clinicId, :name, :nature, :method, :life, :salvagePercent, :assetAccountId, :accumAccountId, :expenseAccountId)`,
      { replacements: { id, clinicId, name: name.trim(), nature, method: nature === 'depreciating' ? (method || 'straight_line') : 'none', life: life || null, salvagePercent: salvagePercent || 0, assetAccountId, accumAccountId: accumAccountId || null, expenseAccountId: expenseAccountId || null } }
    );
    const [[created]] = await sequelize.query(`SELECT * FROM asset_categories WHERE id = :id`, { replacements: { id } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating asset category:', error);
    res.status(500).json({ error: error.message || 'Failed to create asset category' });
  }
});

router.put('/categories/:id', authorize('assets.write'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
  const { name, default_depreciation_method: method, default_useful_life_years: life,
    default_salvage_percent: salvagePercent, asset_account_id: assetAccountId,
    accumulated_depreciation_account_id: accumAccountId, depreciation_expense_account_id: expenseAccountId, is_active: isActive } = req.body;
  try {
    const [[existing]] = await sequelize.query(`SELECT id FROM asset_categories WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id: req.params.id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    await sequelize.query(
      `UPDATE asset_categories SET
         name = COALESCE(:name, name), default_depreciation_method = COALESCE(:method, default_depreciation_method),
         default_useful_life_years = COALESCE(:life, default_useful_life_years), default_salvage_percent = COALESCE(:salvagePercent, default_salvage_percent),
         asset_account_id = COALESCE(:assetAccountId, asset_account_id), accumulated_depreciation_account_id = COALESCE(:accumAccountId, accumulated_depreciation_account_id),
         depreciation_expense_account_id = COALESCE(:expenseAccountId, depreciation_expense_account_id), is_active = COALESCE(:isActive, is_active), updated_at = NOW()
       WHERE id = :id`,
      { replacements: { id: req.params.id, name: name || null, method: method || null, life: life || null, salvagePercent: salvagePercent != null ? salvagePercent : null, assetAccountId: assetAccountId || null, accumAccountId: accumAccountId || null, expenseAccountId: expenseAccountId || null, isActive: isActive != null ? isActive : null } }
    );
    const [[updated]] = await sequelize.query(`SELECT * FROM asset_categories WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating asset category:', error);
    res.status(500).json({ error: 'Failed to update asset category' });
  }
});

// ── Assets ──────────────────────────────────────────────────────────────

router.get('/', authorize('assets.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const replacements = { clinicId };
    const branchSql = branchScope(req, replacements, 'fa');
    let sql = `
      SELECT fa.*, ac.name AS category_name, ac.nature AS category_nature,
             e.first_name AS assignee_first_name, e.last_name AS assignee_last_name
      FROM fixed_assets fa
      JOIN asset_categories ac ON ac.id = fa.category_id
      LEFT JOIN employees e ON e.id = fa.assigned_to_employee_id
      WHERE fa.clinic_id = :clinicId ${branchSql}`;
    if (req.query.status) { sql += ' AND fa.status = :status'; replacements.status = req.query.status; }
    if (req.query.category_id) { sql += ' AND fa.category_id = :categoryId'; replacements.categoryId = req.query.category_id; }
    if (req.query.nature) { sql += ' AND fa.nature = :nature'; replacements.nature = req.query.nature; }
    if (req.query.q) { sql += ' AND (fa.name ILIKE :q OR fa.asset_code ILIKE :q OR fa.serial_number ILIKE :q OR fa.location ILIKE :q)'; replacements.q = `%${req.query.q}%`; }
    sql += ' ORDER BY fa.created_at DESC';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing fixed assets:', error);
    res.status(500).json({ error: 'Failed to list fixed assets' });
  }
});

router.get('/:id', authorize('assets.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const replacements = { id: req.params.id, clinicId };
    const branchSql = branchScope(req, replacements, 'fa');
    const [[asset]] = await sequelize.query(
      `SELECT fa.*, ac.name AS category_name, ac.nature AS category_nature,
              e.first_name AS assignee_first_name, e.last_name AS assignee_last_name
       FROM fixed_assets fa
       JOIN asset_categories ac ON ac.id = fa.category_id
       LEFT JOIN employees e ON e.id = fa.assigned_to_employee_id
       WHERE fa.id = :id AND fa.clinic_id = :clinicId ${branchSql}`,
      { replacements }
    );
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    const [depreciationHistory] = await sequelize.query(
      `SELECT * FROM asset_depreciation_entries WHERE asset_id = :id ORDER BY period DESC`,
      { replacements: { id: req.params.id } }
    );
    res.json({ ...asset, depreciationHistory });
  } catch (error) {
    console.error('Error fetching fixed asset:', error);
    res.status(500).json({ error: 'Failed to fetch fixed asset' });
  }
});

router.post('/', authorize('assets.write'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const asset = await AssetService.createAsset(
      { ...req.body, clinic_id: clinicId, branch_id: req.body.branch_id || getCreateBranchId(req) },
      req.user?.id
    );

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Fixed Assets', action: 'ASSET_CREATED', entity_type: 'FixedAsset', entity_id: asset.id,
        description: `Registered asset ${asset.asset_code} — ${asset.name} (${asset.acquisition_cost})`,
        new_values: { asset_code: asset.asset_code, name: asset.name, acquisition_cost: asset.acquisition_cost },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.status(201).json(asset);
  } catch (error) {
    console.error('Error creating fixed asset:', error);
    res.status(400).json({ error: error.message || 'Failed to create fixed asset' });
  }
});

// Only the descriptive/administrative fields — never the financial ones
// (cost, salvage, useful life) once posted, which would silently desync the
// asset from the ledger entry already made for it. A genuine value change
// goes through /revalue (appreciating/non-depreciating assets) or the normal
// depreciation run (depreciating ones), both of which post their own entry.
router.put('/:id', authorize('assets.write'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
  const { name, description, serial_number: serialNumber, location, assigned_to_employee_id: assignedTo, branch_id: branchId, notes } = req.body;
  try {
    const replacements = { id: req.params.id, clinicId };
    const branchSql = branchScope(req, replacements, 'fa');
    const [[existing]] = await sequelize.query(`SELECT id FROM fixed_assets fa WHERE fa.id = :id AND fa.clinic_id = :clinicId ${branchSql}`, { replacements });
    if (!existing) return res.status(404).json({ error: 'Asset not found' });
    await sequelize.query(
      `UPDATE fixed_assets SET
         name = COALESCE(:name, name), description = COALESCE(:description, description),
         serial_number = COALESCE(:serialNumber, serial_number), location = COALESCE(:location, location),
         assigned_to_employee_id = :assignedTo, branch_id = COALESCE(:branchId, branch_id),
         notes = COALESCE(:notes, notes), updated_at = NOW()
       WHERE id = :id`,
      { replacements: { id: req.params.id, name: name || null, description: description != null ? description : null, serialNumber: serialNumber || null, location: location || null, assignedTo: assignedTo || null, branchId: branchId || null, notes: notes != null ? notes : null } }
    );
    const [[updated]] = await sequelize.query(`SELECT * FROM fixed_assets WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating fixed asset:', error);
    res.status(500).json({ error: 'Failed to update fixed asset' });
  }
});

router.post('/:id/dispose', authorize('assets.dispose'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const result = await AssetService.disposeAsset(clinicId, req.params.id, req.body, req.user?.id);

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Fixed Assets', action: 'ASSET_DISPOSED', entity_type: 'FixedAsset', entity_id: req.params.id,
        description: `Disposed asset — book value ${result.bookValue}, ${result.gainOrLoss >= 0 ? 'gain' : 'loss'} ${Math.abs(result.gainOrLoss)}`,
        new_values: result, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json(result);
  } catch (error) {
    console.error('Error disposing fixed asset:', error);
    res.status(400).json({ error: error.message || 'Failed to dispose of asset' });
  }
});

router.post('/:id/revalue', authorize('assets.write'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const result = await AssetService.revalueAsset(clinicId, req.params.id, req.body, req.user?.id);

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Fixed Assets', action: 'ASSET_REVALUED', entity_type: 'FixedAsset', entity_id: req.params.id,
        description: `Revalued asset from ${result.oldValue} to ${result.newValue} (${result.delta >= 0 ? '+' : ''}${result.delta})`,
        new_values: result, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json(result);
  } catch (error) {
    console.error('Error revaluing fixed asset:', error);
    res.status(400).json({ error: error.message || 'Failed to revalue asset' });
  }
});

// ── Depreciation ────────────────────────────────────────────────────────

router.post('/depreciation/run', authorize('assets.write'), async (req, res) => {
  try {
    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const branchId = req.user?.role === 'admin' ? (req.body.branch_id || null) : getCreateBranchId(req);
    const result = await AssetService.runDepreciation(clinicId, req.body.period, req.user?.id, branchId);

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Fixed Assets', action: 'DEPRECIATION_RUN', entity_type: 'AssetDepreciationRun', entity_id: result.glEntryId || req.body.period,
        description: `Depreciation run for ${result.period} — ${result.assetsDepreciated} asset(s), total ${result.totalDepreciation}`,
        new_values: result, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json(result);
  } catch (error) {
    console.error('Error running depreciation:', error);
    res.status(400).json({ error: error.message || 'Failed to run depreciation' });
  }
});

router.get('/depreciation/history', authorize('assets.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const [rows] = await sequelize.query(
      `SELECT d.period, COUNT(*)::int AS asset_count, SUM(d.depreciation_amount) AS total_depreciation, d.gl_entry_id, MAX(d.posted_at) AS posted_at
       FROM asset_depreciation_entries d
       WHERE d.clinic_id = :clinicId
       GROUP BY d.period, d.gl_entry_id
       ORDER BY d.period DESC`,
      { replacements: { clinicId } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing depreciation history:', error);
    res.status(500).json({ error: 'Failed to list depreciation history' });
  }
});

// ── Reports ─────────────────────────────────────────────────────────────

// Full register — every asset with its current book value, for finance to
// review or export.
router.get('/reports/register', authorize('assets.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const replacements = { clinicId };
    const branchSql = branchScope(req, replacements, 'fa');
    const [rows] = await sequelize.query(
      `SELECT fa.asset_code, fa.name, ac.name AS category_name, fa.nature, fa.status, fa.location, fa.branch_id,
              e.first_name AS assignee_first_name, e.last_name AS assignee_last_name,
              fa.acquisition_date, fa.acquisition_cost, fa.accumulated_depreciation, fa.current_value
       FROM fixed_assets fa
       JOIN asset_categories ac ON ac.id = fa.category_id
       LEFT JOIN employees e ON e.id = fa.assigned_to_employee_id
       WHERE fa.clinic_id = :clinicId ${branchSql}
       ORDER BY ac.name, fa.asset_code`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error building asset register report:', error);
    res.status(500).json({ error: 'Failed to build asset register report' });
  }
});

// Net book value summary — by category, split by depreciating/appreciating/
// non-depreciating, active assets only (disposed assets carry zero value by
// design — see AssetService.disposeAsset).
router.get('/reports/net-book-value', authorize('assets.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  try {
    const replacements = { clinicId };
    const branchSql = branchScope(req, replacements, 'fa');
    const [byCategory] = await sequelize.query(
      `SELECT ac.name AS category_name, ac.nature, COUNT(fa.id)::int AS asset_count,
              SUM(fa.acquisition_cost) AS total_cost, SUM(fa.accumulated_depreciation) AS total_accumulated_depreciation,
              SUM(fa.current_value) AS total_book_value
       FROM fixed_assets fa
       JOIN asset_categories ac ON ac.id = fa.category_id
       WHERE fa.clinic_id = :clinicId AND fa.status = 'active' ${branchSql}
       GROUP BY ac.name, ac.nature
       ORDER BY ac.name`,
      { replacements }
    );
    const [[overall]] = await sequelize.query(
      `SELECT COUNT(fa.id)::int AS asset_count, COALESCE(SUM(fa.acquisition_cost), 0) AS total_cost,
              COALESCE(SUM(fa.accumulated_depreciation), 0) AS total_accumulated_depreciation, COALESCE(SUM(fa.current_value), 0) AS total_book_value
       FROM fixed_assets fa WHERE fa.clinic_id = :clinicId AND fa.status = 'active' ${branchSql}`,
      { replacements }
    );
    res.json({ byCategory, overall });
  } catch (error) {
    console.error('Error building net book value report:', error);
    res.status(500).json({ error: 'Failed to build net book value report' });
  }
});

// Forward-looking depreciation schedule: what each active depreciating
// asset is still due to depreciate, month by month, until fully written
// down to salvage value — lets finance project next year's expense.
router.get('/reports/depreciation-schedule', authorize('assets.view'), async (req, res) => {
  const { sequelize } = req.models;
  const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
  const monthsAhead = Math.min(parseInt(req.query.months, 10) || 12, 60);
  try {
    const replacements = { clinicId };
    const branchSql = branchScope(req, replacements, 'fa');
    const [assets] = await sequelize.query(
      `SELECT fa.id, fa.asset_code, fa.name, fa.acquisition_cost, fa.salvage_value, fa.useful_life_years, fa.accumulated_depreciation
       FROM fixed_assets fa
       WHERE fa.clinic_id = :clinicId AND fa.status = 'active' AND fa.nature = 'depreciating' ${branchSql}`,
      { replacements }
    );
    const now = new Date();
    const schedule = [];
    for (const asset of assets) {
      const cost = parseFloat(asset.acquisition_cost);
      const salvage = parseFloat(asset.salvage_value);
      const depreciableBase = cost - salvage;
      const monthly = asset.useful_life_years > 0 ? Number((depreciableBase / asset.useful_life_years / 12).toFixed(2)) : 0;
      let remaining = Number((depreciableBase - parseFloat(asset.accumulated_depreciation)).toFixed(2));
      for (let i = 0; i < monthsAhead && remaining > 0.01; i++) {
        const amount = Math.min(monthly, remaining);
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        schedule.push({
          asset_code: asset.asset_code, name: asset.name,
          period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          amount,
        });
        remaining = Number((remaining - amount).toFixed(2));
      }
    }
    res.json(schedule.sort((a, b) => a.period.localeCompare(b.period)));
  } catch (error) {
    console.error('Error building depreciation schedule report:', error);
    res.status(500).json({ error: 'Failed to build depreciation schedule report' });
  }
});

module.exports = router;
