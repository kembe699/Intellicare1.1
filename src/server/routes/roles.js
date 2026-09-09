const express = require('express');
const router = express.Router();
const { sequelize: defaultSequelize } = require('../models'); // boot-time schema-ensure only — request handlers use req.models below
const { authorize } = require('../middleware/authorize');
const { APPROVAL_TYPES } = require('../middleware/requireApprovalPermission');

// ─── Privilege catalog ──────────────────────────────────────────────────
// "Page access" privileges — one per top-level navigable route in the app
// (src/App.tsx's <Route allowedRoles=...> list), plus the existing fine-
// grained approval actions (APPROVAL_TYPES) folded in as their own module —
// together this is the full catalog of things a role can be granted.
const PAGE_PRIVILEGES = [
  { key: 'page_dashboard', name: 'Can Access Dashboard', module: 'Dashboard' },
  { key: 'page_visits_history', name: 'Can Access Patient Visits History', module: 'Clinical' },

  { key: 'page_patients_bill', name: 'Can Access Patient Bills', module: 'Billing' },
  { key: 'page_billing_management', name: 'Can Access Billing Management', module: 'Billing' },
  { key: 'page_proforma_invoices', name: 'Can Access Proforma Invoices', module: 'Billing' },
  { key: 'page_receipts', name: 'Can Access Receipts', module: 'Billing' },
  { key: 'page_invoices', name: 'Can Access Invoices', module: 'Billing' },
  { key: 'page_scheme_management', name: 'Can Access Scheme Management', module: 'Billing' },
  { key: 'page_cashier_shift', name: 'Can Access Cashier Shift', module: 'Billing' },

  { key: 'page_lis_registration', name: 'Can Access Patient Registration', module: 'Laboratory' },
  { key: 'page_lis_queue', name: 'Can Access LIS Queue', module: 'Laboratory' },
  { key: 'page_triage', name: 'Can Access Triage', module: 'Laboratory' },
  { key: 'page_lis_orders', name: 'Can Access Test Orders', module: 'Laboratory' },
  { key: 'page_lis_collection', name: 'Can Access Specimen Collection', module: 'Laboratory' },
  { key: 'page_lis_qc', name: 'Can Access Lab Reception QC', module: 'Laboratory' },
  { key: 'page_lis_results_entry', name: 'Can Access Results Entry', module: 'Laboratory' },
  { key: 'page_lis_review', name: 'Can Access Manager Review', module: 'Laboratory' },

  { key: 'page_pharmacy_prescriptions', name: 'Can Access Prescriptions', module: 'Pharmacy' },
  { key: 'page_pharmacy_dispensing', name: 'Can Access Dispensing', module: 'Pharmacy' },
  { key: 'page_pharmacy_returns', name: 'Can Access Pharmacy Returns', module: 'Pharmacy' },

  { key: 'page_reports', name: 'Can Access Reports', module: 'Reports' },
  { key: 'page_reports_dashboard', name: 'Can Access Reports Dashboard', module: 'Reports' },

  { key: 'page_setup_lab_tests', name: 'Can Access Lab Tests Setup', module: 'Setup' },
  { key: 'page_setup_services', name: 'Can Access Services Setup', module: 'Setup' },
  { key: 'page_setup_departments', name: 'Can Access Departments Setup', module: 'Setup' },
  { key: 'page_setup_clinics', name: 'Can Access Clinics Setup', module: 'Setup' },
  { key: 'page_setup_api_configurations', name: 'Can Access API Configurations', module: 'Setup' },
  { key: 'page_setup_facility', name: 'Can Access Facility Setup', module: 'Setup' },
  { key: 'page_setup_security', name: 'Can Access Security & User Management', module: 'Setup' },
  { key: 'page_setup_approvals', name: 'Can Access Approvals Setup', module: 'Setup' },
  { key: 'page_setup_wards', name: 'Can Access Wards Setup', module: 'Setup' },
  { key: 'page_setup_rooms', name: 'Can Access Rooms Setup', module: 'Setup' },

  { key: 'page_procurement_suppliers', name: 'Can Access Suppliers', module: 'Procurement' },
  { key: 'page_procurement_requisitions', name: 'Can Access Purchase Requisitions', module: 'Procurement' },
  { key: 'page_procurement_purchase_orders', name: 'Can Access Purchase Orders', module: 'Procurement' },
  { key: 'page_procurement_goods_receipt', name: 'Can Access Goods Receipt', module: 'Procurement' },
  { key: 'page_procurement_daily_expenses', name: 'Can Access Daily Expenses', module: 'Procurement' },
  { key: 'page_procurement_reports', name: 'Can Access Procurement Reports', module: 'Procurement' },

  { key: 'page_accounting_cash_transfer', name: 'Can Access Cash Transfer', module: 'Accounting' },
  { key: 'page_accounting_chart_of_accounts', name: 'Can Access Chart of Accounts', module: 'Accounting' },
  { key: 'page_accounting_general_ledger', name: 'Can Access General Ledger', module: 'Accounting' },
  { key: 'page_accounting_journal_entries', name: 'Can Access Journal Entries', module: 'Accounting' },
  { key: 'page_accounting_receivables', name: 'Can Access Receivables', module: 'Accounting' },
  { key: 'page_accounting_reports', name: 'Can Access Financial Reports', module: 'Accounting' },
  { key: 'page_accounting_exchange_rates', name: 'Can Access Exchange Rates', module: 'Accounting' },

  { key: 'page_inventory_items', name: 'Can Access Item Master', module: 'Inventory' },
  { key: 'page_inventory_locations', name: 'Can Access Stock Locations', module: 'Inventory' },
  { key: 'page_inventory_transactions', name: 'Can Access Stock Transactions', module: 'Inventory' },
  { key: 'page_inventory_batches', name: 'Can Access Batch Tracking', module: 'Inventory' },
  { key: 'page_inventory_physical_counts', name: 'Can Access Physical Counts', module: 'Inventory' },
  { key: 'page_inventory_valuation', name: 'Can Access Valuation & COGS', module: 'Inventory' },

  { key: 'page_inpatient_admissions', name: 'Can Access Admissions', module: 'Inpatient' },
  { key: 'page_inpatient_patients', name: 'Can Access Admitted Patients', module: 'Inpatient' },
];

const APPROVAL_PRIVILEGES = Object.entries(APPROVAL_TYPES).map(([key, v]) => ({
  key: `approval_${key}`,
  name: `Can ${v.label}`,
  module: v.module || 'Approvals',
  description: v.description || '',
}));

const ALL_PRIVILEGES = [...PAGE_PRIVILEGES, ...APPROVAL_PRIVILEGES];

// System roles already in live use via users.role — seeded so they show up
// with their real assignable name/description from day one, instead of the
// Roles tab starting out disconnected from the roles actually on user records.
const SYSTEM_ROLES = [
  { key: 'admin', name: 'Administrator', description: 'Full system access' },
  { key: 'reception', name: 'Reception', description: 'Front-desk registration and patient bills' },
  { key: 'doctor', name: 'Doctor', description: 'Clinical documentation and orders' },
  { key: 'lab', name: 'Laboratory', description: 'Lab specimen and results workflow' },
  { key: 'pharmacy', name: 'Pharmacy', description: 'Prescriptions and dispensing' },
  { key: 'reports', name: 'Reports', description: 'Reporting access' },
  { key: 'accountant', name: 'Accountant', description: 'Accounting and billing operations' },
  { key: 'finance_manager', name: 'Finance Manager', description: 'Accounting, billing, and financial reports' },
  { key: 'auditor', name: 'Auditor', description: 'Read-focused financial oversight' },
  { key: 'procurement', name: 'Procurement', description: 'Suppliers, purchasing, and goods receipt' },
  { key: 'nurse', name: 'Nurse', description: 'Inpatient nursing workflow' },
  { key: 'cashier', name: 'Cashier', description: 'Cashier shift, cash transfers, and daily expenses' },
];

// One-time backfill: which roles currently have access to each page, per the
// live route guards in src/App.tsx (<ProtectedRoute allowedRoles=...>) at the
// time this was written. Only ever applied once, when role_privileges is
// completely empty (see the seeding IIFE below) — after that, whatever an
// admin does in the Roles tab (including intentionally revoking something
// listed here) is the source of truth, not this snapshot.
// admin is omitted here — it's granted every privilege separately, since
// admin bypasses all role/approval checks in this app regardless of any
// explicit grant.
const DEFAULT_ROLE_PRIVILEGES = {
  page_dashboard: ['reception', 'doctor', 'lab', 'pharmacy', 'reports', 'accountant', 'finance_manager', 'auditor', 'nurse'],
  page_visits_history: ['doctor'],
  page_patients_bill: ['reception', 'doctor'],
  page_billing_management: ['reception', 'finance_manager', 'accountant'],
  page_proforma_invoices: ['reception', 'doctor'],
  page_scheme_management: ['finance_manager', 'accountant'],
  page_receipts: ['reception', 'doctor', 'pharmacy'],
  page_invoices: ['reception', 'finance_manager', 'accountant'],
  page_lis_registration: ['reception', 'lab'],
  page_lis_queue: ['admin', 'reception', 'doctor', 'lab', 'pharmacy', 'reports', 'accountant', 'finance_manager', 'auditor', 'procurement', 'nurse', 'cashier'],
  page_triage: ['nurse'],
  page_lis_orders: ['doctor', 'lab', 'reception'],
  page_lis_collection: ['lab', 'doctor'],
  page_lis_qc: ['lab'],
  page_lis_results_entry: ['lab'],
  page_lis_review: ['lab'],
  page_pharmacy_prescriptions: ['pharmacy', 'doctor'],
  page_pharmacy_dispensing: ['pharmacy'],
  page_pharmacy_returns: ['pharmacy'],
  page_reports: ['reports', 'finance_manager', 'accountant', 'auditor'],
  page_reports_dashboard: ['reports', 'finance_manager', 'accountant', 'auditor'],
  page_setup_lab_tests: ['doctor', 'lab'],
  page_setup_services: ['doctor', 'lab'],
  page_setup_departments: ['doctor'],
  page_setup_clinics: [],
  page_setup_api_configurations: [],
  page_setup_facility: [],
  page_setup_security: [],
  page_setup_approvals: [],
  page_setup_wards: [],
  page_setup_rooms: [],
  page_accounting_cash_transfer: ['accountant', 'finance_manager', 'reception', 'pharmacy', 'cashier'],
  page_cashier_shift: ['reception', 'pharmacy', 'cashier'],
  page_procurement_suppliers: ['finance_manager', 'accountant', 'procurement'],
  page_procurement_requisitions: ['finance_manager', 'accountant', 'doctor', 'pharmacy', 'procurement'],
  page_procurement_purchase_orders: ['procurement'],
  page_procurement_goods_receipt: ['finance_manager', 'accountant', 'pharmacy', 'procurement'],
  page_procurement_daily_expenses: ['cashier', 'procurement'],
  page_procurement_reports: ['finance_manager', 'accountant', 'procurement'],
  page_accounting_chart_of_accounts: ['accountant', 'finance_manager'],
  page_accounting_general_ledger: ['accountant', 'finance_manager', 'auditor'],
  page_accounting_journal_entries: ['accountant', 'finance_manager'],
  page_accounting_receivables: ['accountant', 'finance_manager'],
  page_accounting_reports: ['accountant', 'finance_manager', 'auditor'],
  page_accounting_exchange_rates: ['accountant', 'finance_manager'],
  page_inventory_items: ['pharmacy', 'finance_manager', 'accountant', 'procurement'],
  page_inventory_locations: ['pharmacy', 'finance_manager', 'procurement'],
  page_inventory_transactions: ['pharmacy', 'finance_manager', 'accountant', 'procurement'],
  page_inventory_batches: ['pharmacy', 'procurement'],
  page_inventory_physical_counts: ['pharmacy', 'finance_manager', 'procurement'],
  page_inventory_valuation: ['finance_manager', 'accountant', 'procurement'],
  page_inpatient_admissions: ['doctor', 'reception'],
  page_inpatient_patients: ['doctor', 'reception'],
};

// Ensure roles/privileges tables exist and are seeded on startup (self-
// migrating, matches the CREATE TABLE IF NOT EXISTS convention used
// throughout this codebase, e.g. src/server/routes/approvals.js).
(async () => {
  // defaultSequelize, not sequelize: the import above aliases it, so the bare
  // name was undefined and this whole block threw on the first statement —
  // the privileges, roles and role_privileges tables were never ensured or
  // seeded at boot, and the only sign was one swallowed line in the log.
  try {
    await defaultSequelize.query(`
      CREATE TABLE IF NOT EXISTS privileges (
        id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        privilege_key VARCHAR(150) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        module VARCHAR(100),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await defaultSequelize.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        role_key VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        is_system BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await defaultSequelize.query(`
      CREATE TABLE IF NOT EXISTS role_privileges (
        role_id INT NOT NULL,
        privilege_id INT NOT NULL,
        PRIMARY KEY (role_id, privilege_id),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        FOREIGN KEY (privilege_id) REFERENCES privileges(id) ON DELETE CASCADE
      )
    `);

    for (const p of ALL_PRIVILEGES) {
      await defaultSequelize.query(
        `INSERT INTO privileges (privilege_key, name, module, description)
         VALUES (:key, :name, :module, :description)
         ON CONFLICT (privilege_key) DO UPDATE SET
             name = EXCLUDED.name, module = EXCLUDED.module, description = EXCLUDED.description`,
        { replacements: { key: p.key, name: p.name, module: p.module || null, description: p.description || null } }
      );
    }
    for (const r of SYSTEM_ROLES) {
      await defaultSequelize.query(
        `INSERT INTO roles (role_key, name, description, is_system)
         VALUES (:key, :name, :description, TRUE)
         ON CONFLICT (role_key) DO UPDATE SET name = EXCLUDED.name`,
        { replacements: { key: r.key, name: r.name, description: r.description || null } }
      );
    }

    // One-time backfill of DEFAULT_ROLE_PRIVILEGES — only runs while
    // role_privileges is completely empty, so it never overwrites anything
    // an admin has since changed (including deliberately revoking a default).
    const [[{ cnt }]] = await defaultSequelize.query('SELECT COUNT(*) AS cnt FROM role_privileges');
    if (parseInt(cnt, 10) === 0) {
      const [roleRows] = await defaultSequelize.query('SELECT id, role_key FROM roles');
      const [privRows] = await defaultSequelize.query('SELECT id, privilege_key FROM privileges');
      const roleIdByKey = Object.fromEntries(roleRows.map(r => [r.role_key, r.id]));
      const privIdByKey = Object.fromEntries(privRows.map(p => [p.privilege_key, p.id]));

      const pairs = [];
      // admin implicitly bypasses every role/approval check in this app, so it
      // gets every privilege rather than just the page_* subset other roles do.
      const adminId = roleIdByKey['admin'];
      if (adminId) {
        for (const p of ALL_PRIVILEGES) {
          if (privIdByKey[p.key]) pairs.push([adminId, privIdByKey[p.key]]);
        }
      }
      for (const [privilegeKey, roleKeys] of Object.entries(DEFAULT_ROLE_PRIVILEGES)) {
        const privilegeId = privIdByKey[privilegeKey];
        if (!privilegeId) continue;
        for (const roleKey of roleKeys) {
          const roleId = roleIdByKey[roleKey];
          if (roleId) pairs.push([roleId, privilegeId]);
        }
      }
      for (const [roleId, privilegeId] of pairs) {
        await defaultSequelize.query(
          'INSERT INTO role_privileges (role_id, privilege_id) VALUES (:roleId, :privilegeId)',
          { replacements: { roleId, privilegeId } }
        );
      }
      console.log(`✅ role_privileges backfilled (${pairs.length} grants) from current route access`);
    }

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
    res.json({ message: 'Role privileges updated', count: privilege_ids.length });
  } catch (error) {
    await t.rollback();
    console.error('Error updating role privileges:', error);
    res.status(500).json({ error: 'Failed to update role privileges' });
  }
});

module.exports = router;
