const express = require('express');
const router = express.Router();
const { sequelize: defaultSequelize } = require('../models'); // boot-time table-ensure only — request handlers use req.models below
const { authorize } = require('../middleware/authorize');
const { rolePrivilegesCache } = require('../cache');
const { ensureRolesTables } = require('../config/ensureRolesTables');

// The actual catalog — one privilege per real backend enforcement point,
// seeded per-tenant by src/server/scripts/reconcileRolePrivileges.js, not by
// this file. See src/server/config/permissionsCatalog.js for the source of
// truth; this route file only serves/mutates whatever's in the DB.

// Ensure roles/privileges/role_privileges exist on the default connection
// (harmless no-op once created; real per-tenant seeding is the reconcile
// script's job — this never actually reached a real tenant schema anyway,
// since every request-handling route below uses req.models, not this
// default connection).
(async () => {
  try {
    await ensureRolesTables(defaultSequelize);
    console.log('✅ roles/privileges tables ready');
  } catch (error) {
    console.error('Error creating roles/privileges tables:', error.message);
  }
})();

// GET /api/roles — list all roles
router.get('/', async (req, res) => {
  const { sequelize } = req.models;
  try {
    const [rows] = await sequelize.query(
      `SELECT r.*, (SELECT COUNT(*) FROM role_privileges rp WHERE rp.role_id = r.id) AS privilege_count
       FROM roles r ORDER BY r.is_system DESC, r.name ASC`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing roles:', error);
    res.status(500).json({ error: 'Failed to list roles' });
  }
});

// POST /api/roles — create a new custom role
router.post('/', authorize(['admin']), async (req, res) => {
  const { sequelize } = req.models;
  try {
    const { role_key, name, description } = req.body;
    if (!role_key || !name) {
      return res.status(400).json({ error: 'role_key and name are required' });
    }
    const cleanKey = String(role_key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!cleanKey) return res.status(400).json({ error: 'role_key must contain at least one letter or number' });
    const [existing] = await sequelize.query('SELECT id FROM roles WHERE role_key = :cleanKey', { replacements: { cleanKey } });
    if (existing.length > 0) return res.status(409).json({ error: `A role with key "${cleanKey}" already exists` });

    await sequelize.query(
      `INSERT INTO roles (role_key, name, description, is_system) VALUES (:cleanKey, :name, :description, FALSE)`,
      { replacements: { cleanKey, name: name.trim(), description: description || null } }
    );
    const [[created]] = await sequelize.query('SELECT * FROM roles WHERE role_key = :cleanKey', { replacements: { cleanKey } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PUT /api/roles/:id — update a role's name/description (role_key is stable)
router.put('/:id', authorize(['admin']), async (req, res) => {
  const { sequelize } = req.models;
  try {
    const { name, description } = req.body;
    await sequelize.query(
      `UPDATE roles SET name = COALESCE(:name, name), description = :description WHERE id = :id`,
      { replacements: { id: req.params.id, name: name || null, description: description ?? null } }
    );
    const [[updated]] = await sequelize.query('SELECT * FROM roles WHERE id = :id', { replacements: { id: req.params.id } });
    if (!updated) return res.status(404).json({ error: 'Role not found' });
    res.json(updated);
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /api/roles/:id — remove a custom role (system roles are protected,
// since users.role rows already point at them).
router.delete('/:id', authorize(['admin']), async (req, res) => {
  const { sequelize } = req.models;
  try {
    const [[role]] = await sequelize.query('SELECT * FROM roles WHERE id = :id', { replacements: { id: req.params.id } });
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(400).json({ error: 'System roles cannot be deleted' });
    const [[inUse]] = await sequelize.query('SELECT COUNT(*) AS cnt FROM users WHERE role = :key', { replacements: { key: role.role_key } });
    if (parseInt(inUse.cnt, 10) > 0) {
      return res.status(400).json({ error: `${inUse.cnt} user(s) still have this role — reassign them first` });
    }
    await sequelize.query('DELETE FROM roles WHERE id = :id', { replacements: { id: req.params.id } });
    rolePrivilegesCache.del(req.tenantSchema);
    res.json({ message: 'Role deleted' });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

// GET /api/roles/privileges/all — the full privilege catalog
router.get('/privileges/all', async (req, res) => {
  const { sequelize } = req.models;
  try {
    const [rows] = await sequelize.query('SELECT * FROM privileges ORDER BY module ASC, name ASC');
    res.json(rows);
  } catch (error) {
    console.error('Error listing privileges:', error);
    res.status(500).json({ error: 'Failed to list privileges' });
  }
});

// POST /api/roles/privileges/all — add a custom privilege to the catalog
router.post('/privileges/all', authorize(['admin']), async (req, res) => {
  const { sequelize } = req.models;
  try {
    const { name, module, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    const key = `custom_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_${Date.now().toString(36)}`;
    await sequelize.query(
      `INSERT INTO privileges (privilege_key, name, module, description) VALUES (:key, :name, :module, :description)`,
      { replacements: { key, name: name.trim(), module: module || 'Custom', description: description || null } }
    );
    const [[created]] = await sequelize.query('SELECT * FROM privileges WHERE privilege_key = :key', { replacements: { key } });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating privilege:', error);
    res.status(500).json({ error: 'Failed to create privilege' });
  }
});

// GET /api/roles/:id/privileges — privilege IDs currently assigned to a role
router.get('/:id/privileges', async (req, res) => {
  const { sequelize } = req.models;
  try {
    const [rows] = await sequelize.query(
      'SELECT privilege_id FROM role_privileges WHERE role_id = :id',
      { replacements: { id: req.params.id } }
    );
    res.json(rows.map(r => r.privilege_id));
  } catch (error) {
    console.error('Error fetching role privileges:', error);
    res.status(500).json({ error: 'Failed to fetch role privileges' });
  }
});

// PUT /api/roles/:id/privileges — replace the full set of privileges
// assigned to a role. Body: { privilege_ids: number[] }
router.put('/:id/privileges', authorize(['admin']), async (req, res) => {
  const { sequelize } = req.models;
  const { privilege_ids } = req.body;
  if (!Array.isArray(privilege_ids)) return res.status(400).json({ error: 'privilege_ids must be an array' });
  const t = await sequelize.transaction();
  try {
    await sequelize.query('DELETE FROM role_privileges WHERE role_id = :id', { replacements: { id: req.params.id }, transaction: t });
    for (const privilegeId of privilege_ids) {
      await sequelize.query(
        'INSERT INTO role_privileges (role_id, privilege_id) VALUES (:roleId, :privilegeId)',
        { replacements: { roleId: req.params.id, privilegeId }, transaction: t }
      );
    }
    await t.commit();
    rolePrivilegesCache.del(req.tenantSchema); // so this takes effect immediately, not after the cache TTL
    res.json({ message: 'Role privileges updated', count: privilege_ids.length });
  } catch (error) {
    await t.rollback();
    console.error('Error updating role privileges:', error);
    res.status(500).json({ error: 'Failed to update role privileges' });
  }
});

module.exports = router;
