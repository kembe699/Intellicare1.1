/**
 * Accounting › Taxes — tax types and where they apply.
 *
 *   GET    /              tax types (with the account each posts to)
 *   POST   /              add a tax type            (accounting.write)
 *   PUT    /:id           edit one                  (accounting.write)
 *   DELETE /:id           remove, or deactivate if a bill already used it
 *   GET    /accounts      liability accounts a tax can post to
 *   GET    /assignments   categories and items with their tax setting
 *   PUT    /assign        set a category's tax, or an item's override
 *
 * Tax is added on top of the price at billing time (utils/billTax.js) and
 * posted to the tax's own liability account (2300 VAT Payable by default).
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');

const clinicOf = (req) => parseInt(req.query.clinic_id || req.body?.clinic_id) || req.user?.clinicId || 1;

async function audit(req, action, entityId, description, newValues) {
  try {
    const rr = require('./reports');
    await rr.logAudit({ req, clinic_id: clinicOf(req), user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
      module: 'Accounting', action, entity_type: 'TaxRate', entity_id: String(entityId || ''), description, new_values: newValues, ip_address: req.ip, status: 'success' });
  } catch { /* audit is best-effort */ }
}

/** The account a tax posts to: the one chosen, else 2300 VAT Payable — switched on if it was off. */
async function taxAccount(db, clinicId, accountId) {
  if (accountId) {
    const [[a]] = await db.query(`SELECT id, account_type, is_active FROM chart_of_accounts WHERE id::text = :id AND clinic_id = :clinicId`, { replacements: { id: String(accountId), clinicId } });
    if (!a) throw Object.assign(new Error('That account was not found.'), { status: 400 });
    if (a.account_type !== 'liability') throw Object.assign(new Error('Tax must post to a liability account (e.g. 2300 VAT Payable).'), { status: 400 });
    if (!a.is_active) await db.query(`UPDATE chart_of_accounts SET is_active = true WHERE id = :id`, { replacements: { id: a.id } });
    return a.id;
  }
  const [[vat]] = await db.query(`SELECT id, is_active FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = '2300' LIMIT 1`, { replacements: { clinicId } });
  if (!vat) throw Object.assign(new Error('No account chosen and 2300 VAT Payable does not exist — pick a liability account.'), { status: 400 });
  if (!vat.is_active) await db.query(`UPDATE chart_of_accounts SET is_active = true WHERE id = :id`, { replacements: { id: vat.id } });
  return vat.id;
}

function validRate(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

router.get('/', async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [rows] = await db.query(`
      SELECT t.*, a.account_code, a.account_name
        FROM tax_rates t LEFT JOIN chart_of_accounts a ON a.id::text = t.account_id::text
       WHERE t.clinic_id = :clinicId
       ORDER BY t.is_active DESC, t.name`, { replacements: { clinicId: clinicOf(req) } });
    res.json(rows.map((r) => ({ ...r, rate: Number(r.rate) })));
  } catch (e) {
    console.error('List tax rates:', e);
    res.status(500).json({ error: 'Failed to load tax rates' });
  }
});

router.get('/accounts', authorize('accounting.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const [rows] = await db.query(`
      SELECT id, account_code, account_name, is_active FROM chart_of_accounts
       WHERE clinic_id = :clinicId AND account_type = 'liability' AND (is_active = true OR account_code = '2300')
       ORDER BY account_code`, { replacements: { clinicId: clinicOf(req) } });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load accounts' });
  }
});

router.post('/', authorize('accounting.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = clinicOf(req);
    const { name, code, description } = req.body || {};
    const rate = validRate(req.body?.rate);
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Give the tax a name (e.g. VAT).' });
    if (rate == null) return res.status(400).json({ error: 'Rate must be a percentage between 0 and 100.' });
    const accountId = await taxAccount(db, clinicId, req.body?.account_id);
    const id = uuidv4();
    await db.query(`
      INSERT INTO tax_rates (id, clinic_id, name, code, rate, account_id, description, is_active, created_by)
      VALUES (:id, :clinicId, :name, :code, :rate, :accountId, :description, true, :by)`,
      { replacements: { id, clinicId, name: String(name).trim(), code: code ? String(code).trim() : null, rate, accountId, description: description || null, by: req.user?.displayName || req.user?.email || null } });
    await audit(req, 'TAX_RATE_CREATED', id, `Added tax ${name} (${rate}%)`, { name, rate, account_id: accountId });
    res.status(201).json({ id });
  } catch (e) {
    console.error('Create tax rate:', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to add tax' });
  }
});

// Before PUT /:id, which would otherwise take "assign" as an id.
router.put('/assign', authorize('accounting.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { kind, id } = req.body || {};
    const table = KINDS[kind];
    if (!table || !id) return res.status(400).json({ error: 'kind and id are required' });
    const taxRateId = req.body.tax_rate_id || null;
    if (taxRateId) {
      const [[t]] = await db.query(`SELECT id FROM tax_rates WHERE id = :id`, { replacements: { id: taxRateId } });
      if (!t) return res.status(400).json({ error: 'That tax was not found.' });
    }
    if (kind === 'category') {
      await db.query(`UPDATE categories SET tax_rate_id = :t WHERE id::text = :id`, { replacements: { t: taxRateId, id: String(id) } });
    } else {
      await db.query(`UPDATE ${table} SET tax_rate_id = :t, tax_exempt = :ex WHERE id::text = :id`,
        { replacements: { t: req.body.tax_exempt ? null : taxRateId, ex: !!req.body.tax_exempt, id: String(id) } });
    }
    await audit(req, 'TAX_ASSIGNED', id, `Tax setting changed on ${kind}`, { tax_rate_id: taxRateId, tax_exempt: !!req.body.tax_exempt });
    res.json({ success: true });
  } catch (e) {
    console.error('Assign tax:', e);
    res.status(500).json({ error: 'Failed to save tax setting' });
  }
});

router.put('/:id', authorize('accounting.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = clinicOf(req);
    const [[cur]] = await db.query(`SELECT * FROM tax_rates WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id: req.params.id, clinicId } });
    if (!cur) return res.status(404).json({ error: 'Tax not found' });
    const b = req.body || {};
    const rate = b.rate !== undefined ? validRate(b.rate) : Number(cur.rate);
    if (rate == null) return res.status(400).json({ error: 'Rate must be a percentage between 0 and 100.' });
    const name = b.name !== undefined ? String(b.name).trim() : cur.name;
    if (!name) return res.status(400).json({ error: 'Give the tax a name.' });
    const accountId = b.account_id !== undefined ? await taxAccount(db, clinicId, b.account_id) : cur.account_id;
    await db.query(`
      UPDATE tax_rates SET name = :name, code = :code, rate = :rate, account_id = :accountId, description = :description,
             is_active = :active, updated_at = NOW()
       WHERE id = :id`,
      { replacements: { id: cur.id, name, code: b.code !== undefined ? (b.code || null) : cur.code, rate, accountId,
        description: b.description !== undefined ? (b.description || null) : cur.description,
        active: b.is_active !== undefined ? !!b.is_active : cur.is_active } });
    await audit(req, 'TAX_RATE_UPDATED', cur.id, `Updated tax ${name}`, { name, rate, is_active: b.is_active });
    res.json({ success: true });
  } catch (e) {
    console.error('Update tax rate:', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to update tax' });
  }
});

router.delete('/:id', authorize('accounting.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const clinicId = clinicOf(req);
    const [[cur]] = await db.query(`SELECT * FROM tax_rates WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id: req.params.id, clinicId } });
    if (!cur) return res.status(404).json({ error: 'Tax not found' });
    const [[used]] = await db.query(
      `SELECT EXISTS (SELECT 1 FROM patient_bills WHERE services::text LIKE :needle) AS used`,
      { replacements: { needle: `%"taxRateId":"${cur.id}"%` } });
    // Bills that already carry it keep their tax lines; a deactivated tax just stops applying.
    if (used?.used) {
      await db.query(`UPDATE tax_rates SET is_active = false, updated_at = NOW() WHERE id = :id`, { replacements: { id: cur.id } });
      await audit(req, 'TAX_RATE_DEACTIVATED', cur.id, `Deactivated tax ${cur.name} (already on bills)`);
      return res.json({ success: true, deactivated: true });
    }
    for (const table of ['categories', 'services', 'inventory_items', 'lab_tests']) {
      await db.query(`UPDATE ${table} SET tax_rate_id = NULL WHERE tax_rate_id = :id`, { replacements: { id: cur.id } }).catch(() => {});
    }
    await db.query(`DELETE FROM tax_rates WHERE id = :id`, { replacements: { id: cur.id } });
    await audit(req, 'TAX_RATE_DELETED', cur.id, `Deleted tax ${cur.name}`);
    res.json({ success: true });
  } catch (e) {
    console.error('Delete tax rate:', e);
    res.status(500).json({ error: 'Failed to delete tax' });
  }
});

const KINDS = {
  category: 'categories',
  service: 'services',
  item: 'inventory_items',
  lab_test: 'lab_tests',
};

router.get('/assignments', authorize('accounting.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    // Sales tax only — expense categories are what the hospital buys, not sells.
    const [categories] = await db.query(`SELECT id::text id, name, type, tax_rate_id FROM categories WHERE COALESCE(is_active, true) = true AND COALESCE(type, '') <> 'expense' ORDER BY type, name`).catch(() => [[]]);
    const items = [];
    const pull = async (kind, sql) => {
      const [rows] = await db.query(sql).catch(() => [[]]);
      for (const r of rows) items.push({ kind, ...r });
    };
    await pull('service', `SELECT s.id::text id, s.service_name AS name, c.name AS category_name, c.tax_rate_id AS category_tax_rate_id, s.tax_rate_id, s.tax_exempt
                             FROM services s LEFT JOIN categories c ON c.id::text = s.category_id::text WHERE COALESCE(s.is_active, true) = true`);
    await pull('item', `SELECT i.id::text id, i.item_name AS name, c.name AS category_name, c.tax_rate_id AS category_tax_rate_id, i.tax_rate_id, i.tax_exempt
                          FROM inventory_items i LEFT JOIN categories c ON c.id::text = i.category_id::text WHERE COALESCE(i.is_active, true) = true`);
    await pull('lab_test', `SELECT l.id::text id, l.test_name AS name, c.name AS category_name, c.tax_rate_id AS category_tax_rate_id, l.tax_rate_id, l.tax_exempt
                              FROM lab_tests l LEFT JOIN categories c ON c.id::text = l.category_id::text WHERE COALESCE(l.is_active, true) = true`);
    items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json({ categories, items });
  } catch (e) {
    console.error('Tax assignments:', e);
    res.status(500).json({ error: 'Failed to load tax settings' });
  }
});

module.exports = router;
