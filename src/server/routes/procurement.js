const express = require('express');
const { getBaseCurrencyCode, BASE_CURRENCY_SQL } = require('../utils/baseCurrency');
const { isUniqueViolation, isDuplicateColumn } = require('../utils/dbErrors');
const { reportSchemaGuardFailure } = require('../utils/legacyDDL');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { sequelize, PurchaseOrder, PurchaseOrderItem, ChartOfAccounts, AccountLedger, GeneralLedger, GLLineItems, CostCenters } = require('../models');
const { v4: uuidv4 } = require('uuid');
const AccountingService = require('../services/AccountingService');
const { requireApprovalPermission, userHasApprovalPermission, getUserAllowedActions, APPROVAL_TYPES } = require('../middleware/requireApprovalPermission');
const { authorize } = require('../middleware/authorize');
const { getCreateBranchId, getBranchCondition } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');

// Named-replacement raw-SQL branch filter — this file uses named `:params` throughout
// (never positional `?`), same convention as accounting.js's branchScope. Applied
// alongside the existing BranchQueryFilter.resolveClinicId(req) clinic filtering, never
// replacing it — admins still see every branch within their clinic scope.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

// Branch-level access check for a fetch-by-ID record, same fetch-then-check pattern as
// accounting.js's assertBranchAccess — used where a route loads a row via raw SQL (so
// there's no Sequelize `where` clause to fold the filter into) rather than listing rows.
function assertBranchAccess(record, req, res, label) {
  const branchContext = req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' };
  if (!BranchQueryFilter.canAccessRecord(record, branchContext)) {
    res.status(403).json({ error: `Access denied to this ${label}` });
    return false;
  }
  return true;
}

// Quotation/invoice attachments (PO + GRN) — stored on local disk, one file per row in
// procurement_attachments (see self-migration below). Optional everywhere they're used:
// nothing here blocks PO/GRN creation, uploads happen as a best-effort follow-up call.
const ATTACHMENTS_DIR = path.join(__dirname, '..', 'uploads', 'procurement');
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
const ATTACHMENT_ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ATTACHMENTS_DIR),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).slice(0, 10)}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!ATTACHMENT_ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only PDF and image files (JPEG, PNG, GIF, WEBP) are allowed'));
    }
    cb(null, true);
  },
});
const ATTACHMENT_ENTITY_TABLES = {
  'purchase-order': { table: 'purchase_orders', idIsNumeric: true },
  'goods-receipt-note': { table: 'goods_receipt_notes', idIsNumeric: false },
};

// The approve/reject/inspect/accept endpoints already use requireApprovalPermission
// (a purpose-built approval-workflow gate, not touched here). Everything else gets the
// same authorize([...]) role gate used across the rest of the app, matching the
// Procurement sidebar section's own role groupings.
// The sidebar restricts the Purchase Orders screen itself to admin (and now the dedicated
// procurement role) — narrower than Suppliers/Requisitions/Goods Receipt — so PO
// creation/modification follows suit; reads stay open to finance/accountant since they
// need PO visibility to reconcile receipts.
const PO_WRITE = ['admin', 'procurement'];

// Ensure procurement tables and required columns exist on startup
(async () => {
  try {
    // Ensure extra supplier columns exist (needed before any supplier POST)
    const supplierCols = [
      ["supplier_code",       "VARCHAR(50) NULL"],
      ["supplier_type",       "VARCHAR(50) DEFAULT 'general'"],
      ["country",             "VARCHAR(100) DEFAULT 'South Sudan'"],
      ["payment_terms",       "VARCHAR(50) DEFAULT 'Net30'"],
      ["credit_limit",        "DECIMAL(15,2) DEFAULT 0"],
      ["currency",            "VARCHAR(3) DEFAULT 'SSP'"],
      ["is_preferred",        "BOOLEAN DEFAULT false"],
      ["on_hold",             "BOOLEAN DEFAULT false"],
      ["hold_reason",         "TEXT NULL"],
      ["tax_id",              "VARCHAR(50) NULL"],
      ["bank_account_name",   "VARCHAR(255) NULL"],
      ["bank_account_number", "VARCHAR(50) NULL"],
      ["bank_name",           "VARCHAR(255) NULL"],
      ["clinic_id",           "INTEGER NULL"],
      ["performance_rating",  "DECIMAL(3,1) DEFAULT 0"],
      ["total_purchases",     "DECIMAL(15,2) DEFAULT 0"],
      ["total_paid",          "DECIMAL(15,2) DEFAULT 0"],
    ];
    for (const [col, def] of supplierCols) {
      // MySQL (unlike Postgres) does not support "ADD COLUMN IF NOT EXISTS" —
      // issue a bare ALTER TABLE and swallow only the "column already exists" error.
      await sequelize.query(`ALTER TABLE suppliers ADD COLUMN ${col} ${def}`).catch((err) => {
        if (!isDuplicateColumn(err)) {
          console.warn(`Could not add suppliers.${col}:`, err.message);
        }
      });
    }

    // Ensure purchase_order_items has the columns the GRN routes below depend on for
    // tracking partial/complete receipt against a PO line (missing entirely on this table
    // otherwise, which made GRN creation against any po_line_item_id fail with a SQL error).
    const poItemCols = [
      ["quantity_received", "INT DEFAULT 0"],
      ["status",            "VARCHAR(20) DEFAULT 'pending'"],
    ];
    for (const [col, def] of poItemCols) {
      await sequelize.query(`ALTER TABLE purchase_order_items ADD COLUMN ${col} ${def}`).catch((err) => {
        if (!isDuplicateColumn(err)) {
          console.warn(`Could not add purchase_order_items.${col}:`, err.message);
        }
      });
    }

    // Ensure grn_line_items has the batch/item linkage columns the GRN accept route writes back
    // to after creating the inventory batch (missing entirely otherwise, which made GRN acceptance
    // fail on every line with a SQL "Unknown column" error).
    const grnLineCols = [
      ["inventory_batch_id", "VARCHAR(36) NULL"],
      ["inventory_item_id",  "VARCHAR(36) NULL"],
    ];
    for (const [col, def] of grnLineCols) {
      await sequelize.query(`ALTER TABLE grn_line_items ADD COLUMN ${col} ${def}`).catch((err) => {
        if (!isDuplicateColumn(err)) {
          console.warn(`Could not add grn_line_items.${col}:`, err.message);
        }
      });
    }

    // Invoice Number — optional field on the goods receipt form (supplier's invoice
    // reference), separate from the GRN's own grn_number.
    await sequelize.query(`ALTER TABLE goods_receipt_notes ADD COLUMN invoice_number VARCHAR(100) NULL`).catch((err) => {
      if (!isDuplicateColumn(err)) {
        console.warn('Could not add goods_receipt_notes.invoice_number:', err.message);
      }
    });

    // Quotation/invoice attachments for POs and GRNs — one row per uploaded file,
    // entity_type/entity_id point at the owning purchase_orders or goods_receipt_notes row.
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS procurement_attachments (
        id VARCHAR(36) PRIMARY KEY,
        entity_type VARCHAR(30) NOT NULL,
        entity_id VARCHAR(36) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        stored_filename VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_size INT NOT NULL DEFAULT 0,
        uploaded_by VARCHAR(36),
        clinic_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_proc_attach_entity ON procurement_attachments(entity_type, entity_id)`).catch(() => {});

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        pr_number VARCHAR(100) NOT NULL UNIQUE,
        requisition_date DATE NOT NULL,
        requested_by VARCHAR(36),
        department VARCHAR(100),
        cost_center_id VARCHAR(36),
        requisition_type VARCHAR(20) DEFAULT 'routine',
        delivery_date_required DATE,
        total_amount DECIMAL(15,2) DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'SSP',
        status VARCHAR(20) DEFAULT 'draft',
        approved_by VARCHAR(36),
        approval_date DATE,
        rejection_reason TEXT,
        notes TEXT,
        created_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pr_clinic_status ON purchase_requisitions(clinic_id, status)`).catch(() => {});
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS pr_line_items (
        id VARCHAR(36) PRIMARY KEY,
        pr_id VARCHAR(36) NOT NULL,
        line_number INT DEFAULT 0,
        item_code VARCHAR(100),
        item_description VARCHAR(255) NOT NULL,
        item_specification TEXT,
        quantity_required INT NOT NULL DEFAULT 1,
        unit_of_measure VARCHAR(20) DEFAULT 'pcs',
        estimated_unit_price DECIMAL(10,2) DEFAULT 0,
        estimated_line_total DECIMAL(15,2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_prli_pr ON pr_line_items(pr_id)`).catch(() => {});
    console.log('✅ Procurement tables ensured');
  } catch (e) {
    console.warn('Procurement table init warning:', e.message);
  }
})();

// ═══════════════════════════════════════════════════
// SUPPLIERS - Enhanced CRUD
// ═══════════════════════════════════════════════════

// List all suppliers (with filters)
router.get('/suppliers', authorize('procurement.read'), async (req, res) => {
  try {
    const { is_active, supplier_type, search, on_hold } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    let where = '';
    const replacements = {};

    // clinic_id is always applied, never optional — an omitted/other-clinic value in
    // the query string used to mean "return every clinic's suppliers".
    const conditions = ['clinic_id = :clinic_id'];
    replacements.clinic_id = clinicId;
    if (is_active !== undefined) { conditions.push('is_active = :is_active'); replacements.is_active = is_active === 'true' ? 1 : 0; }
    if (supplier_type) { conditions.push('supplier_type = :supplier_type'); replacements.supplier_type = supplier_type; }
    if (on_hold !== undefined) { conditions.push('on_hold = :on_hold'); replacements.on_hold = on_hold === 'true' ? 1 : 0; }
    if (search) { conditions.push('(name LIKE :search OR supplier_code LIKE :search OR contact_person LIKE :search)'); replacements.search = `%${search}%`; }

    if (conditions.length > 0) where = 'WHERE ' + conditions.join(' AND ');

    const [suppliers] = await sequelize.query(
      `SELECT * FROM suppliers ${where} ORDER BY name ASC`,
      { replacements }
    );
    res.json(suppliers);
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

// Get single supplier with stats
router.get('/suppliers/:id', authorize('procurement.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [suppliers] = await sequelize.query(
      'SELECT * FROM suppliers WHERE id = :id AND clinic_id = :clinicId',
      { replacements: { id: req.params.id, clinicId } }
    );
    if (suppliers.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const supplier = suppliers[0];

    // Order counts are currency-agnostic, so still one row. total_po_amount is
    // not: summing a USD PO and an SSP PO into one number and labeling it with
    // whatever the base currency happens to be silently blends two different
    // currencies together as though they were the same money. Broken out by
    // po_currency instead — the frontend renders one line per currency actually
    // used, same fix already applied to Procurement Reports' Total Spend tile.
    const supplierStatsReplacements = { id: req.params.id };
    const supplierStatsBranchScope = branchScope(req, supplierStatsReplacements);
    const [poCounts] = await sequelize.query(`
      SELECT
        COUNT(*) as total_pos,
        SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as completed_pos,
        SUM(CASE WHEN status IN ('draft','check','approved','authorized') THEN 1 ELSE 0 END) as open_pos
      FROM purchase_orders WHERE supplier_id = :id ${supplierStatsBranchScope}
    `, { replacements: supplierStatsReplacements });

    const [spendByCurrency] = await sequelize.query(`
      SELECT po_currency AS currency, COALESCE(SUM(total_amount), 0) as total_amount
      FROM purchase_orders WHERE supplier_id = :id ${supplierStatsBranchScope}
      GROUP BY po_currency
      ORDER BY total_amount DESC
    `, { replacements: supplierStatsReplacements });

    // Get performance ratings
    const [ratings] = await sequelize.query(`
      SELECT AVG(overall_rating) as avg_rating, COUNT(*) as total_reviews
      FROM supplier_performance WHERE supplier_id = :id
    `, { replacements: { id: req.params.id } });

    res.json({
      ...supplier,
      stats: { ...(poCounts[0] || {}), spend_by_currency: spendByCurrency },
      performance: ratings[0] || {}
    });
  } catch (error) {
    console.error('Error fetching supplier:', error);
    res.status(500).json({ error: 'Failed to fetch supplier' });
  }
});

// Create supplier
router.post('/suppliers', authorize('procurement.write'), async (req, res) => {
  try {
    const { name, contact_person, phone, email, address, town, country,
      supplier_type, tax_id, bank_account_name, bank_account_number, bank_name,
      payment_terms, credit_limit, currency, is_preferred } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    // Auto-generate supplier code
    const [countResult] = await sequelize.query('SELECT COUNT(*) as cnt FROM suppliers');
    const code = `SUP-${String(parseInt(countResult[0].cnt || 0, 10) + 1).padStart(4, '0')}`;

    const id = uuidv4 ? undefined : null; // Let auto-increment handle it for existing INT PK

    const [result] = await sequelize.query(`
      INSERT INTO suppliers (name, contact_person, phone, email, address, town, country,
        supplier_code, supplier_type, tax_id, bank_account_name, bank_account_number, bank_name,
        payment_terms, credit_limit, currency, is_preferred, is_active, clinic_id, created_at, updated_at)
      VALUES (:name, :contact_person, :phone, :email, :address, :town, :country,
        :supplier_code, :supplier_type, :tax_id, :bank_account_name, :bank_account_number, :bank_name,
        :payment_terms, :credit_limit, :currency, :is_preferred, true, :clinic_id, NOW(), NOW())
    `, {
      replacements: {
        name, contact_person: contact_person || null, phone: phone || null, email: email || null,
        address: address || null, town: town || null, country: country || 'South Sudan',
        supplier_code: code, supplier_type: supplier_type || 'general',
        tax_id: tax_id || null, bank_account_name: bank_account_name || null,
        bank_account_number: bank_account_number || null, bank_name: bank_name || null,
        payment_terms: payment_terms || 'Net30', credit_limit: credit_limit || 0,
        currency: currency || (await getBaseCurrencyCode()), is_preferred: is_preferred || false,
        clinic_id: clinic_id || null
      }
    });

    const [newSupplier] = await sequelize.query(
      'SELECT * FROM suppliers WHERE supplier_code = :code ORDER BY id DESC LIMIT 1',
      { replacements: { code } }
    );
    res.status(201).json(newSupplier[0]);
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(500).json({ error: 'Failed to create supplier' });
  }
});

// Update supplier
router.put('/suppliers/:id', authorize('procurement.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const fields = [];
    const replacements = { id: req.params.id, clinicId };
    // clinic_id deliberately excluded — updating it would let a supplier record be
    // reassigned to a different clinic entirely, rather than just edited.
    const allowedFields = ['name', 'contact_person', 'phone', 'email', 'address', 'town', 'country',
      'supplier_type', 'tax_id', 'bank_account_name', 'bank_account_number', 'bank_name',
      'payment_terms', 'credit_limit', 'currency', 'is_preferred', 'is_active', 'on_hold', 'hold_reason'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields.push(`${field} = :${field}`);
        replacements[field] = req.body[field];
      }
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    const [, meta] = await sequelize.query(
      `UPDATE suppliers SET ${fields.join(', ')}, updated_at = NOW() WHERE id = :id AND clinic_id = :clinicId`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Supplier not found' });

    const [updated] = await sequelize.query('SELECT * FROM suppliers WHERE id = :id', { replacements: { id: req.params.id } });
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
});

// Toggle supplier hold
router.put('/suppliers/:id/hold', authorize('procurement.write'), async (req, res) => {
  try {
    const { on_hold, hold_reason } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    // suppliers.on_hold is a real Postgres boolean column, not MySQL's lenient
    // tinyint — sending 1/0 threw "column is of type boolean but expression is
    // of type integer" outright, on every single call regardless of whether
    // the supplier existed (confirmed live: even a nonexistent id 500'd here
    // instead of ever reaching the 404 check below).
    const [, holdMeta] = await sequelize.query(
      'UPDATE suppliers SET on_hold = :on_hold, hold_reason = :hold_reason, updated_at = NOW() WHERE id = :id AND clinic_id = :clinicId',
      { replacements: { id: req.params.id, clinicId, on_hold: !!on_hold, hold_reason: hold_reason || null } }
    );
    if (holdMeta.rowCount === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ message: on_hold ? 'Supplier placed on hold' : 'Supplier hold released' });
  } catch (error) {
    console.error('Error toggling supplier hold:', error);
    res.status(500).json({ error: 'Failed to update supplier hold status' });
  }
});

// Rate supplier performance
router.post('/suppliers/:id/performance', authorize('procurement.write'), async (req, res) => {
  try {
    const { delivery_timeliness, quality_of_goods, communication, pricing_competitiveness, comments, evaluator_id } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);
    const overall = ((delivery_timeliness || 3) + (quality_of_goods || 3) + (communication || 3) + (pricing_competitiveness || 3)) / 4;
    const id = uuidv4();

    await sequelize.query(`
      INSERT INTO supplier_performance (id, clinic_id, supplier_id, evaluation_date, delivery_timeliness,
        quality_of_goods, communication, pricing_competitiveness, overall_rating, comments, evaluator_id, created_at)
      VALUES (:id, :clinic_id, :supplier_id, CURRENT_DATE, :delivery_timeliness, :quality_of_goods,
        :communication, :pricing_competitiveness, :overall_rating, :comments, :evaluator_id, NOW())
    `, {
      replacements: {
        id, clinic_id, supplier_id: req.params.id,
        delivery_timeliness: delivery_timeliness || 3, quality_of_goods: quality_of_goods || 3,
        communication: communication || 3, pricing_competitiveness: pricing_competitiveness || 3,
        overall_rating: overall.toFixed(1), comments: comments || null, evaluator_id: evaluator_id || null
      }
    });

    // Update supplier's average rating
    await sequelize.query(`
      UPDATE suppliers SET performance_rating = (
        SELECT AVG(overall_rating) FROM supplier_performance WHERE supplier_id = :sid
      ), updated_at = NOW() WHERE id = :sid
    `, { replacements: { sid: req.params.id } });

    res.status(201).json({ message: 'Performance rating saved' });
  } catch (error) {
    console.error('Error rating supplier:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

// Get supplier performance history
router.get('/suppliers/:id/performance', authorize('procurement.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [ratings] = await sequelize.query(`
      SELECT sp.*, u.display_name as evaluator_name
      FROM supplier_performance sp
      LEFT JOIN users u ON u.id = sp.evaluator_id
      WHERE sp.supplier_id = :id AND sp.clinic_id = :clinicId
      ORDER BY sp.evaluation_date DESC
    `, { replacements: { id: req.params.id, clinicId } });
    res.json(ratings);
  } catch (error) {
    console.error('Error fetching performance:', error);
    res.status(500).json({ error: 'Failed to fetch performance ratings' });
  }
});

// ═══════════════════════════════════════════════════
// PURCHASE REQUISITIONS
// ═══════════════════════════════════════════════════

// List PRs
router.get('/purchase-requisitions', authorize('procurement.read'), async (req, res) => {
  try {
    const { status, requested_by } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['pr.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (status) { conditions.push('pr.status = :status'); replacements.status = status; }
    if (requested_by) { conditions.push('pr.requested_by = :requested_by'); replacements.requested_by = requested_by; }

    const where = 'WHERE ' + conditions.join(' AND ') + branchScope(req, replacements, 'pr');

    const [prs] = await sequelize.query(`
      SELECT pr.*, u.display_name as requester_name, a.display_name as approver_name,
        (SELECT COUNT(*) FROM pr_line_items WHERE pr_id = pr.id) as line_count
      FROM purchase_requisitions pr
      LEFT JOIN users u ON u.id = pr.requested_by
      LEFT JOIN users a ON a.id = pr.approved_by
      ${where}
      ORDER BY pr.created_at DESC
    `, { replacements });

    res.json(prs);
  } catch (error) {
    console.error('Error fetching PRs:', error);
    res.status(500).json({ error: 'Failed to fetch purchase requisitions' });
  }
});

// Get single PR with lines
router.get('/purchase-requisitions/:id', authorize('procurement.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const prByIdReplacements = { id: req.params.id, clinicId };
    const prByIdBranchScope = branchScope(req, prByIdReplacements, 'pr');
    const [prs] = await sequelize.query(`
      SELECT pr.*, u.display_name as requester_name, a.display_name as approver_name
      FROM purchase_requisitions pr
      LEFT JOIN users u ON u.id = pr.requested_by
      LEFT JOIN users a ON a.id = pr.approved_by
      WHERE pr.id = :id AND pr.clinic_id = :clinicId ${prByIdBranchScope}
    `, { replacements: prByIdReplacements });

    if (prs.length === 0) return res.status(404).json({ error: 'PR not found' });

    const [lines] = await sequelize.query(
      'SELECT * FROM pr_line_items WHERE pr_id = :id ORDER BY line_number',
      { replacements: { id: req.params.id } }
    );

    res.json({ ...prs[0], lines });
  } catch (error) {
    console.error('Error fetching PR:', error);
    res.status(500).json({ error: 'Failed to fetch purchase requisition' });
  }
});

// Create PR
router.post('/purchase-requisitions', authorize('procurement.write'), async (req, res) => {
  try {
    const { requested_by, department, cost_center_id, requisition_type,
      delivery_date_required, currency, notes, lines } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    if (!requested_by) {
      return res.status(400).json({ error: 'requested_by is required' });
    }

    // Generate PR number
    const [countResult] = await sequelize.query(
      'SELECT COUNT(*) as cnt FROM purchase_requisitions WHERE clinic_id = :clinic_id',
      { replacements: { clinic_id: parseInt(clinic_id) } }
    );
    const prNumber = `PR-${new Date().getFullYear()}-${String((countResult[0].cnt || 0) + 1).padStart(4, '0')}`;

    const prId = uuidv4();
    let totalAmount = 0;
    const prBranchId = getCreateBranchId(req);

    // Insert PR
    await sequelize.query(`
      INSERT INTO purchase_requisitions (id, clinic_id, pr_number, requisition_date, requested_by,
        department, cost_center_id, requisition_type, delivery_date_required, total_amount, currency,
        status, notes, created_by, created_at, updated_at, branch_id)
      VALUES (:id, :clinic_id, :pr_number, CURRENT_DATE, :requested_by, :department, :cost_center_id,
        :requisition_type, :delivery_date_required, 0, :currency, 'draft', :notes, :created_by, NOW(), NOW(), :branch_id)
    `, {
      replacements: {
        id: prId, clinic_id: parseInt(clinic_id), pr_number: prNumber,
        requested_by: requested_by || null,
        department: department || null, cost_center_id: cost_center_id || null,
        requisition_type: requisition_type || 'routine',
        delivery_date_required: delivery_date_required || null,
        currency: currency || (await getBaseCurrencyCode()), notes: notes || null,
        created_by: requested_by || null,
        branch_id: prBranchId
      }
    });

    // Insert line items
    if (lines && lines.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineTotal = (line.quantity_required || 1) * (line.estimated_unit_price || 0);
        totalAmount += lineTotal;
        const lineId = uuidv4();

        await sequelize.query(`
          INSERT INTO pr_line_items (id, pr_id, line_number, item_code, item_description,
            item_specification, quantity_required, unit_of_measure, estimated_unit_price,
            estimated_line_total, notes, created_at, updated_at, branch_id)
          VALUES (:id, :pr_id, :line_number, :item_code, :item_description, :item_specification,
            :quantity_required, :unit_of_measure, :estimated_unit_price, :estimated_line_total, :notes, NOW(), NOW(), :branch_id)
        `, {
          replacements: {
            id: lineId, pr_id: prId, line_number: i + 1,
            item_code: line.item_code || null, item_description: line.item_description,
            item_specification: line.item_specification || null,
            quantity_required: line.quantity_required || 1,
            unit_of_measure: line.unit_of_measure || 'pcs',
            estimated_unit_price: line.estimated_unit_price || 0,
            estimated_line_total: lineTotal, notes: line.notes || null,
            branch_id: prBranchId
          }
        });
      }

      // Update total
      await sequelize.query(
        'UPDATE purchase_requisitions SET total_amount = :total WHERE id = :id',
        { replacements: { total: totalAmount, id: prId } }
      );
    }

    const [newPR] = await sequelize.query('SELECT * FROM purchase_requisitions WHERE id = :id', { replacements: { id: prId } });
    res.status(201).json(newPR[0]);
  } catch (error) {
    console.error('Error creating PR:', error);
    res.status(500).json({ error: 'Failed to create purchase requisition' });
  }
});

// Update PR (draft only)
router.put('/purchase-requisitions/:id', authorize('procurement.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const updatePrReplacements = { id: req.params.id, clinicId };
    const updatePrBranchScope = branchScope(req, updatePrReplacements);
    const [pr] = await sequelize.query(`SELECT * FROM purchase_requisitions WHERE id = :id AND clinic_id = :clinicId ${updatePrBranchScope}`, { replacements: updatePrReplacements });
    if (pr.length === 0) return res.status(404).json({ error: 'PR not found' });
    if (pr[0].status !== 'draft') return res.status(400).json({ error: 'Only draft PRs can be edited' });

    const { department, cost_center_id, requisition_type, delivery_date_required, currency, notes, lines } = req.body;

    await sequelize.query(`
      UPDATE purchase_requisitions SET department = :department, cost_center_id = :cost_center_id,
        requisition_type = :requisition_type, delivery_date_required = :delivery_date_required,
        currency = :currency, notes = :notes, updated_at = NOW()
      WHERE id = :id
    `, {
      replacements: {
        id: req.params.id, department: department || pr[0].department,
        cost_center_id: cost_center_id || pr[0].cost_center_id,
        requisition_type: requisition_type || pr[0].requisition_type,
        delivery_date_required: delivery_date_required || pr[0].delivery_date_required,
        currency: currency || pr[0].currency, notes: notes !== undefined ? notes : pr[0].notes
      }
    });

    // Replace lines if provided
    if (lines) {
      await sequelize.query('DELETE FROM pr_line_items WHERE pr_id = :id', { replacements: { id: req.params.id } });
      let totalAmount = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineTotal = (line.quantity_required || 1) * (line.estimated_unit_price || 0);
        totalAmount += lineTotal;
        await sequelize.query(`
          INSERT INTO pr_line_items (id, pr_id, line_number, item_code, item_description,
            item_specification, quantity_required, unit_of_measure, estimated_unit_price,
            estimated_line_total, notes, created_at, updated_at, branch_id)
          VALUES (:id, :pr_id, :ln, :ic, :desc, :spec, :qty, :uom, :up, :lt, :notes, NOW(), NOW(), :branch_id)
        `, {
          replacements: {
            id: uuidv4(), pr_id: req.params.id, ln: i + 1, ic: line.item_code || null,
            desc: line.item_description, spec: line.item_specification || null,
            qty: line.quantity_required || 1, uom: line.unit_of_measure || 'pcs',
            up: line.estimated_unit_price || 0, lt: lineTotal, notes: line.notes || null,
            branch_id: pr[0].branch_id ?? getCreateBranchId(req)
          }
        });
      }
      await sequelize.query('UPDATE purchase_requisitions SET total_amount = :total, updated_at = NOW() WHERE id = :id',
        { replacements: { total: totalAmount, id: req.params.id } });
    }

    const [updated] = await sequelize.query('SELECT * FROM purchase_requisitions WHERE id = :id', { replacements: { id: req.params.id } });
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating PR:', error);
    res.status(500).json({ error: 'Failed to update purchase requisition' });
  }
});

// Submit PR for approval
router.post('/purchase-requisitions/:id/submit', authorize('procurement.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const submitPrReplacements = { id: req.params.id, clinicId };
    const submitPrBranchScope = branchScope(req, submitPrReplacements);
    const [pr] = await sequelize.query(`SELECT * FROM purchase_requisitions WHERE id = :id AND clinic_id = :clinicId ${submitPrBranchScope}`, { replacements: submitPrReplacements });
    if (pr.length === 0) return res.status(404).json({ error: 'PR not found' });
    if (pr[0].status !== 'draft') return res.status(400).json({ error: 'Only draft PRs can be submitted' });

    // Check at least 1 line item
    const [lineCount] = await sequelize.query('SELECT COUNT(*) as cnt FROM pr_line_items WHERE pr_id = :id', { replacements: { id: req.params.id } });
    if (lineCount[0].cnt === 0) return res.status(400).json({ error: 'PR must have at least one line item' });

    await sequelize.query(
      "UPDATE purchase_requisitions SET status = 'submitted', updated_at = NOW() WHERE id = :id",
      { replacements: { id: req.params.id } }
    );
    res.json({ message: 'PR submitted for approval' });
  } catch (error) {
    console.error('Error submitting PR:', error);
    res.status(500).json({ error: 'Failed to submit PR' });
  }
});

// Approve PR
router.post('/purchase-requisitions/:id/approve', requireApprovalPermission('pr_approve'), async (req, res) => {
  try {
    const { approved_by } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const approvePrReplacements = { id: req.params.id, clinicId };
    const approvePrBranchScope = branchScope(req, approvePrReplacements);
    const [pr] = await sequelize.query(`SELECT * FROM purchase_requisitions WHERE id = :id AND clinic_id = :clinicId ${approvePrBranchScope}`, { replacements: approvePrReplacements });
    if (pr.length === 0) return res.status(404).json({ error: 'PR not found' });
    if (pr[0].status !== 'submitted') return res.status(400).json({ error: 'Only submitted PRs can be approved' });

    await sequelize.query(
      "UPDATE purchase_requisitions SET status = 'approved', approved_by = :approved_by, approval_date = CURRENT_DATE, updated_at = NOW() WHERE id = :id",
      { replacements: { id: req.params.id, approved_by } }
    );
    res.json({ message: 'PR approved' });
  } catch (error) {
    console.error('Error approving PR:', error);
    res.status(500).json({ error: 'Failed to approve PR' });
  }
});

// Reject PR
// Rejecting is the same decision-authority as approving — was previously
// unguarded while approve required 'pr_approve', letting anyone reject a
// requisition an authorized approver hadn't acted on yet.
router.post('/purchase-requisitions/:id/reject', requireApprovalPermission('pr_approve'), async (req, res) => {
  try {
    const { approved_by, rejection_reason } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const rejectPrReplacements = { id: req.params.id, clinicId };
    const rejectPrBranchScope = branchScope(req, rejectPrReplacements);
    const [pr] = await sequelize.query(`SELECT * FROM purchase_requisitions WHERE id = :id AND clinic_id = :clinicId ${rejectPrBranchScope}`, { replacements: rejectPrReplacements });
    if (pr.length === 0) return res.status(404).json({ error: 'PR not found' });
    if (pr[0].status !== 'submitted') return res.status(400).json({ error: 'Only submitted PRs can be rejected' });

    await sequelize.query(
      "UPDATE purchase_requisitions SET status = 'rejected', approved_by = :approved_by, approval_date = CURRENT_DATE, rejection_reason = :reason, updated_at = NOW() WHERE id = :id",
      { replacements: { id: req.params.id, approved_by, reason: rejection_reason || '' } }
    );
    res.json({ message: 'PR rejected' });
  } catch (error) {
    console.error('Error rejecting PR:', error);
    res.status(500).json({ error: 'Failed to reject PR' });
  }
});

// Cancel PR — was previously unguarded (any authenticated user could cancel
// any PR, not just their own). A cancel isn't an approval decision, so it
// doesn't need pr_approve; instead it's limited to the PR's own requester,
// an approver, or an admin.
router.post('/purchase-requisitions/:id/cancel', authorize('procurement.write'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const cancelPrReplacements = { id: req.params.id, clinicId };
    const cancelPrBranchScope = branchScope(req, cancelPrReplacements);
    const [pr] = await sequelize.query(`SELECT status, requested_by, branch_id FROM purchase_requisitions WHERE id = :id AND clinic_id = :clinicId ${cancelPrBranchScope}`, { replacements: cancelPrReplacements });
    if (pr.length === 0) return res.status(404).json({ error: 'PR not found' });

    const isOwner = pr[0].requested_by && pr[0].requested_by === String(req.user?.id);
    if (!isOwner && req.user?.role !== 'admin') {
      const canApprove = await userHasApprovalPermission(req, 'pr_approve');
      if (!canApprove) return res.status(403).json({ error: 'You can only cancel your own requisitions' });
    }

    if (!['draft', 'submitted'].includes(pr[0].status)) {
      return res.status(400).json({ error: `Cannot cancel a PR with status '${pr[0].status}'. Only draft or submitted PRs can be cancelled.` });
    }

    await sequelize.query(
      "UPDATE purchase_requisitions SET status = 'cancelled', updated_at = NOW() WHERE id = :id AND status IN ('draft','submitted')",
      { replacements: { id: req.params.id } }
    );
    res.json({ message: 'PR cancelled' });
  } catch (error) {
    console.error('Error cancelling PR:', error);
    res.status(500).json({ error: 'Failed to cancel PR' });
  }
});


// ═══════════════════════════════════════════════════
// PURCHASE ORDERS - Enhanced
// ═══════════════════════════════════════════════════

// Self-healing schema fix: the purchase_orders.status column was created as
// ENUM('pending','approved','received','cancelled') while every route below
// (and the Sequelize PurchaseOrder model) uses the full workflow
// ('draft','check','approved','authorized','received','cancelled'). Under
// MySQL's STRICT_TRANS_TABLES (the default here), inserting/updating a value
// not in the ENUM throws "Data truncated for column 'status'" — this was
// making PO creation and every status transition fail with a 500. Widen the
// ENUM to match the model. MODIFY COLUMN is idempotent so it's safe to run
// on every server start.
(async () => {
  try {
    await sequelize.query(`
      ALTER TABLE purchase_orders
      MODIFY COLUMN status ENUM('draft','check','approved','authorized','received','cancelled') DEFAULT 'draft'
    `);
  } catch (e) {
    reportSchemaGuardFailure('purchase_orders.status enum', e);
  }
})();

// Tracks the base-currency (SSP) equivalent of the Accounts Payable liability actually
// booked to the GL when a foreign-currency (e.g. USD) PO's goods are accepted — captured
// at the exchange rate on that receipt date. Settlement (POST /supplier-bill-payment in
// daily-expenses.js) compares this fixed booked amount against the SSP-equivalent of the
// payment at *its own* (likely different) exchange rate to compute realized FX gain/loss,
// instead of either figure silently overwriting the other.
(async () => {
  try {
    const [cols] = await sequelize.query(
      `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'purchase_orders' AND column_name = 'ap_base_currency_amount'`
    );
    if (cols.length === 0) {
      await sequelize.query(`ALTER TABLE purchase_orders ADD COLUMN ap_base_currency_amount DECIMAL(15,2) DEFAULT 0`);
      console.log('✅ Added ap_base_currency_amount to purchase_orders');
    }
  } catch (e) {
    console.warn('Could not add purchase_orders.ap_base_currency_amount:', e.message);
  }
})();

// Backfill ap_base_currency_amount for any PO whose GRN was accepted before this column
// existed, so future payments against these older POs still get correct FX gain/loss —
// computed retroactively at the exchange rate on each PO's own (first) receipt date.
// Deliberately does NOT touch the GL entries these older GRNs already posted (some of
// which understated the true SSP value of foreign-currency POs by the full exchange rate,
// e.g. a USD PO posted as if the number were already SSP) — rewriting posted ledger
// entries needs explicit sign-off, not a silent migration; this only seeds the new
// tracking column so settlement math is correct from here on.
(async () => {
  try {
    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'SSP';
    const [candidates] = await sequelize.query(`
      SELECT po.id AS po_id, po.po_currency, po.total_amount, po.clinic_id,
             MIN(grn.receipt_date) AS first_receipt_date
      FROM purchase_orders po
      JOIN goods_receipt_notes grn ON grn.po_id = po.id AND grn.status = 'accepted'
      WHERE COALESCE(po.ap_base_currency_amount, 0) = 0 AND po.po_currency IS NOT NULL
      GROUP BY po.id, po.po_currency, po.total_amount, po.clinic_id
    `);
    for (const c of candidates) {
      try {
        const rate = await AccountingService.getExchangeRate(c.clinic_id, c.po_currency, baseCurrency, c.first_receipt_date);
        const baseAmount = AccountingService.convertAmount(c.total_amount, rate);
        await sequelize.query('UPDATE purchase_orders SET ap_base_currency_amount = :amt WHERE id = :id', { replacements: { amt: baseAmount, id: c.po_id } });
        console.log(`✅ Backfilled ap_base_currency_amount for PO ${c.po_id}: ${c.po_currency} ${c.total_amount} -> ${baseCurrency} ${baseAmount}`);
      } catch (e) {
        console.warn(`Could not backfill ap_base_currency_amount for PO ${c.po_id}:`, e.message);
      }
    }
  } catch (e) {
    console.warn('ap_base_currency_amount backfill failed:', e.message);
  }
})();

// List POs with filters
router.get('/purchase-orders', authorize('procurement.read'), async (req, res) => {
  try {
    const { status, supplier_id } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['po.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (status && status !== 'undefined' && status !== 'null') { conditions.push('po.status = :status'); replacements.status = status; }
    if (supplier_id && supplier_id !== 'undefined' && supplier_id !== 'null' && !isNaN(parseInt(supplier_id))) { conditions.push('po.supplier_id = :supplier_id'); replacements.supplier_id = parseInt(supplier_id); }

    const where = 'WHERE ' + conditions.join(' AND ') + branchScope(req, replacements, 'po');

    const [pos] = await sequelize.query(`
      SELECT po.*, s.name as supplier_name, s.supplier_code,
        (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      ${where}
      ORDER BY po.created_at DESC
    `, { replacements });

    res.json(pos);
  } catch (error) {
    console.error('Error fetching POs:', error);
    res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
});

// Get single PO with items
router.get('/purchase-orders/:id', authorize('procurement.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const poByIdReplacements = { id: req.params.id, clinicId };
    const poByIdBranchScope = branchScope(req, poByIdReplacements, 'po');
    const [pos] = await sequelize.query(`
      SELECT po.*, s.name as supplier_name, s.supplier_code, s.payment_terms as supplier_payment_terms,
        u.display_name as created_by_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN users u ON u.id = po.created_by
      WHERE po.id = :id AND po.clinic_id = :clinicId ${poByIdBranchScope}
    `, { replacements: poByIdReplacements });

    if (pos.length === 0) return res.status(404).json({ error: 'PO not found' });

    // Note: purchase_order_items has no line_number column (neither the actual
    // table nor the Sequelize model define one) — order by id (insertion order).
    const [items] = await sequelize.query(
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = :id ORDER BY id',
      { replacements: { id: req.params.id } }
    );

    // Get linked GRNs
    const [grns] = await sequelize.query(
      'SELECT id, grn_number, receipt_date, status, total_items_received FROM goods_receipt_notes WHERE po_id = :id ORDER BY receipt_date DESC',
      { replacements: { id: req.params.id } }
    );

    res.json({ ...pos[0], items, grns });
  } catch (error) {
    console.error('Error fetching PO:', error);
    res.status(500).json({ error: 'Failed to fetch purchase order' });
  }
});

// Create PO (from scratch or from approved PR)
router.post('/purchase-orders', authorize('procurement.purchase_orders.write'), async (req, res) => {
  try {
    // Validate before writing, so a missing supplier reads as a bad request
    // rather than a server error.
    if (!req.body?.supplier_id) {
      return res.status(400).json({ error: 'supplier_id is required' });
    }
    const { supplier_id, pr_id, po_type, order_date, delivery_address,
      requested_delivery_date, payment_terms, terms_conditions, po_currency,
      exchange_rate, notes, items, created_by } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    // Generate PO number from the highest one issued this year, not how many
    // exist — COUNT(*) assumes no gaps (a deleted draft leaves one), and worse,
    // the pg driver returns COUNT(*) as a string, so `cnt + 1` was string
    // concatenation ("2" + 1 = "21") rather than arithmetic. Either way it can
    // land on a number already taken and die on purchase_orders_po_number_idx.
    // Same fix as dispensing_number in autoDispense.js.
    const poYear = new Date().getFullYear();
    const [[poSeqRow]] = await sequelize.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(po_number, '^.*-', ''), '')::int), 0) AS last
         FROM purchase_orders
        WHERE po_number LIKE :prefix AND po_number ~ '-[0-9]+$'`,
      { replacements: { prefix: `PO-${poYear}-%` } }
    );
    const poNumber = `PO-${poYear}-${String((parseInt(poSeqRow?.last, 10) || 0) + 1).padStart(4, '0')}`;

    // Calculate totals
    let subtotal = 0;
    if (items && items.length > 0) {
      subtotal = items.reduce((sum, item) => sum + ((item.quantity || 1) * (item.unit_price || 0)), 0);
    }
    const taxRate = req.body.tax_rate || 0;
    const taxAmount = subtotal * (taxRate / 100);
    const shippingCost = req.body.shipping_cost || 0;
    const totalAmount = subtotal + taxAmount + shippingCost;

    // Resolve the currency to use if the caller didn't send one, instead of
    // hardcoding a literal (the base currency isn't always SSP — it's whatever
    // is flagged is_base_currency in the currencies table for this deployment).
    const [[baseCurrencyRow]] = await sequelize.query(
      `SELECT code FROM currencies WHERE is_base_currency = TRUE LIMIT 1`
    );
    const baseCurrency = baseCurrencyRow?.code || 'USD';
    let resolvedCurrency = po_currency || baseCurrency;

    // The frontend always sent exchange_rate: 1 regardless of which currency
    // was actually selected — base_currency_total was therefore wrong for
    // every non-base-currency PO. Look the real rate up server-side instead
    // of trusting a client-supplied exchange rate for a financial total.
    let xRate = 1;
    if (resolvedCurrency !== baseCurrency) {
      try {
        const AccountingService = require('../services/AccountingService');
        xRate = await AccountingService.getExchangeRate(clinic_id, resolvedCurrency, baseCurrency, order_date ? new Date(order_date) : new Date());
      } catch (rateErr) {
        // An explicit rate typed on the PO is a deliberate choice, not a silent
        // fallback; with neither, refuse rather than total the PO at 1:1.
        if (parseFloat(exchange_rate) > 0) {
          xRate = parseFloat(exchange_rate);
        } else {
          return res.status(400).json({ error: `Cannot create this ${resolvedCurrency} purchase order — there is no ${resolvedCurrency}→${baseCurrency} exchange rate for ${order_date || new Date().toISOString().split('T')[0]}. Add it in Accounting › Exchange Rates (or enter the rate on the PO), then try again.` });
        }
      }
    }
    const baseCurrencyTotal = Math.round(totalAmount * xRate * 100) / 100;
    const poBranchId = getCreateBranchId(req);

    const [result] = await sequelize.query(`
      INSERT INTO purchase_orders (po_number, supplier_id, order_date, total_amount, status, notes,
        clinic_id, pr_id, po_type, delivery_address, requested_delivery_date,
        subtotal, tax_amount, tax_rate, shipping_cost, po_currency, exchange_rate,
        base_currency_total, payment_terms, terms_conditions, created_by, created_at, updated_at, branch_id)
      VALUES (:po_number, :supplier_id, :order_date, :total_amount, 'draft', :notes,
        :clinic_id, :pr_id, :po_type, :delivery_address, :requested_delivery_date,
        :subtotal, :tax_amount, :tax_rate, :shipping_cost, :po_currency, :exchange_rate,
        :base_currency_total, :payment_terms, :terms_conditions, :created_by, NOW(), NOW(), :branch_id)
    `, {
      replacements: {
        po_number: poNumber, supplier_id: parseInt(supplier_id),
        order_date: order_date || new Date().toISOString().split('T')[0],
        total_amount: totalAmount, notes: notes || null,
        clinic_id: clinic_id || null, pr_id: pr_id || null,
        po_type: po_type || 'standard', delivery_address: delivery_address || null,
        requested_delivery_date: requested_delivery_date || null,
        subtotal, tax_amount: taxAmount, tax_rate: taxRate,
        shipping_cost: shippingCost, po_currency: resolvedCurrency,
        exchange_rate: xRate, base_currency_total: baseCurrencyTotal,
        payment_terms: payment_terms || 'Net30', terms_conditions: terms_conditions || null,
        created_by: created_by || null, branch_id: poBranchId
      }
    });

    // Get the new PO id
    const [newPO] = await sequelize.query(
      'SELECT * FROM purchase_orders WHERE po_number = :po_number',
      { replacements: { po_number: poNumber } }
    );
    const poId = newPO[0].id;

    // Insert line items (purchase_order_items has no line_number/status
    // columns — neither the actual table nor the Sequelize model define
    // them; insertion order via auto-increment id is the line order).
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const lineTotal = (item.quantity || 1) * (item.unit_price || 0);
        await sequelize.query(`
          INSERT INTO purchase_order_items (purchase_order_id, item_name, description, quantity,
            unit_price, total_price, unit_of_measure, created_at, updated_at, branch_id)
          VALUES (:po_id, :item_name, :description, :quantity, :unit_price, :total_price,
            :unit_of_measure, NOW(), NOW(), :branch_id)
        `, {
          replacements: {
            po_id: poId, item_name: item.item_name || item.item_description,
            description: item.description || item.item_specification || null,
            quantity: item.quantity || 1, unit_price: item.unit_price || 0,
            total_price: lineTotal, unit_of_measure: item.unit_of_measure || 'Each',
            branch_id: poBranchId
          }
        });
      }
    }

    res.status(201).json(newPO[0]);
  } catch (error) {
    console.error('Error creating PO:', error);
    res.status(500).json({ error: 'Failed to create purchase order' });
  }
});

// Records a straight "we owe this supplier X for Y" liability without going
// through the item-by-item PO builder — reception/procurement staff often
// just need to record a bill amount and what it's for (a repair, a one-off
// service, a bill that arrived with no itemized breakdown), not draft a full
// purchase order line-by-line. Reuses purchase_orders so it plugs straight
// into the existing supplier-bills payment/outstanding tracking (GET
// /supplier-bills, POST /supplier-bill-payment) rather than inventing a
// parallel record type; it's created directly as 'authorized' — skipping
// draft — since there's nothing to draft when there are no items to add.
router.post('/purchase-orders/quick-bill', authorize('procurement.purchase_orders.write'), async (req, res) => {
  try {
    const { supplier_id, amount, description, currency } = req.body;
    if (!supplier_id) return res.status(400).json({ error: 'supplier_id is required' });
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'A positive amount is required' });
    if (!description || !description.trim()) return res.status(400).json({ error: 'A description of what this bill is for is required' });

    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    const [[supplierRow]] = await sequelize.query(
      `SELECT currency, payment_terms FROM suppliers WHERE id = :id AND clinic_id = :clinic_id`,
      { replacements: { id: parseInt(supplier_id), clinic_id: clinic_id || null } }
    );
    if (!supplierRow) return res.status(404).json({ error: 'Supplier not found' });

    // Defaults to the supplier's own currency (most bills from them arrive in it),
    // but reception can pick a different one for a one-off bill in another
    // currency — validated against the real currencies table rather than trusting
    // an arbitrary client-supplied string into a financial record.
    let poCurrency = supplierRow.currency;
    if (currency) {
      const [[currencyRow]] = await sequelize.query(
        `SELECT code FROM currencies WHERE code = :code`,
        { replacements: { code: currency } }
      );
      if (!currencyRow) return res.status(400).json({ error: `Unknown currency: ${currency}` });
      poCurrency = currencyRow.code;
    }

    const poYear = new Date().getFullYear();
    const [[poSeqRow]] = await sequelize.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(po_number, '^.*-', ''), '')::int), 0) AS last
         FROM purchase_orders
        WHERE po_number LIKE :prefix AND po_number ~ '-[0-9]+$'`,
      { replacements: { prefix: `PO-${poYear}-%` } }
    );
    const poNumber = `PO-${poYear}-${String((parseInt(poSeqRow?.last, 10) || 0) + 1).padStart(4, '0')}`;

    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = TRUE LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'USD';
    poCurrency = poCurrency || baseCurrency;

    let xRate = 1;
    if (poCurrency !== baseCurrency) {
      try {
        xRate = await AccountingService.requireExchangeRate(clinic_id, poCurrency, baseCurrency, new Date(), `record this ${poCurrency} supplier bill`);
      } catch (rateErr) {
        return res.status(400).json({ error: rateErr.message });
      }
    }
    const baseCurrencyTotal = Math.round(amt * xRate * 100) / 100;

    await sequelize.query(`
      INSERT INTO purchase_orders (po_number, supplier_id, order_date, total_amount, status, notes,
        clinic_id, po_type, subtotal, tax_amount, tax_rate, shipping_cost, po_currency, exchange_rate,
        base_currency_total, payment_terms, created_by, created_at, updated_at, branch_id)
      VALUES (:po_number, :supplier_id, NOW(), :amount, 'authorized', :notes,
        :clinic_id, 'standard', :amount, 0, 0, 0, :po_currency, :exchange_rate,
        :base_currency_total, :payment_terms, :created_by, NOW(), NOW(), :branch_id)
    `, {
      replacements: {
        po_number: poNumber, supplier_id: parseInt(supplier_id), amount: amt, notes: description.trim(),
        clinic_id: clinic_id || null, po_currency: poCurrency, exchange_rate: xRate,
        base_currency_total: baseCurrencyTotal, payment_terms: supplierRow.payment_terms || 'Net30',
        created_by: req.user?.id || null, branch_id: getCreateBranchId(req),
      }
    });

    const [newPO] = await sequelize.query('SELECT * FROM purchase_orders WHERE po_number = :po_number', { replacements: { po_number: poNumber } });
    res.status(201).json(newPO[0]);
  } catch (error) {
    console.error('Error creating quick supplier bill:', error);
    res.status(500).json({ error: 'Failed to create supplier bill' });
  }
});

// Every PO issued to one supplier, with what's owed vs paid on each — the
// supplier profile view's "how much does this supplier want from us" answer.
// Unlike GET /supplier-bills (only authorized/received, for the payables
// worklist), this returns every status so a supplier's full history is
// visible, and lets the frontend decide what counts as "outstanding".
router.get('/suppliers/:id/purchase-orders', authorize('procurement.read'), async (req, res) => {
  try {
    const supplierPOReplacements = { id: req.params.id };
    const supplierPOBranchScope = branchScope(req, supplierPOReplacements);
    const [pos] = await sequelize.query(`
      SELECT id, po_number, order_date, status, total_amount, po_currency, notes,
        COALESCE(paid_amount, 0) AS paid_amount,
        COALESCE(payment_status, 'unpaid') AS payment_status,
        (total_amount - COALESCE(paid_amount, 0)) AS balance_due
      FROM purchase_orders
      WHERE supplier_id = :id ${supplierPOBranchScope}
      ORDER BY order_date DESC, id DESC
    `, { replacements: supplierPOReplacements });

    // Broken out per currency — summing a USD bill and an SSP bill into one
    // "outstanding" figure would blend two different currencies together as
    // though they were the same money. by_currency carries one row per
    // po_currency actually used; the flat totals are kept too but are only
    // meaningful for a supplier that has ever used a single currency.
    const byCurrency = {};
    for (const po of pos) {
      const cur = po.po_currency;
      if (!byCurrency[cur]) byCurrency[cur] = { currency: cur, total_billed: 0, total_paid: 0, total_outstanding: 0 };
      const total = parseFloat(po.total_amount) || 0;
      const paid = parseFloat(po.paid_amount) || 0;
      byCurrency[cur].total_billed += total;
      byCurrency[cur].total_paid += paid;
      // A draft or cancelled PO isn't a real liability yet/anymore — matches
      // the same status filter GET /supplier-bills already uses for "what's
      // actually owed" rather than everything ever entered.
      if (po.status === 'authorized' || po.status === 'received') {
        byCurrency[cur].total_outstanding += Math.max(0, total - paid);
      }
    }
    const by_currency = Object.values(byCurrency).sort((a, b) => b.total_billed - a.total_billed);
    const summary = by_currency.reduce((acc, c) => ({
      total_billed: acc.total_billed + c.total_billed,
      total_paid: acc.total_paid + c.total_paid,
      total_outstanding: acc.total_outstanding + c.total_outstanding,
    }), { total_billed: 0, total_paid: 0, total_outstanding: 0 });

    res.json({ purchase_orders: pos, summary, by_currency });
  } catch (error) {
    console.error('Error fetching supplier purchase orders:', error);
    res.status(500).json({ error: 'Failed to fetch supplier purchase orders' });
  }
});

// Add a line item to an existing (draft) PO and recompute totals.
// The frontend previously called the unrelated, dead /api/purchase-orders/:id/items
// router (a legacy Sequelize-model router mounted separately) — that endpoint
// never recalculated tax/shipping into total_amount and lived outside the
// /api/procurement namespace this page otherwise uses exclusively. This keeps
// item creation consistent with how the PO's totals (subtotal/tax/shipping/
// base_currency_total) are computed everywhere else in this file.
/**
 * Recompute a purchase order's money columns from the lines it currently has.
 *
 * subtotal/tax/total are stored on the header but derived from the items, so
 * every path that adds, edits or removes a line has to put them back in step —
 * otherwise the order shows a total that its own lines contradict. Kept in one
 * place so the three item routes cannot drift apart.
 */
async function recomputePOTotals(poId, po) {
  // Alias is lower-case deliberately. PostgreSQL folds an unquoted alias to
  // lower case, so `AS newSubtotal` comes back as `newsubtotal` and
  // destructuring `{ newSubtotal }` yielded undefined -> 0. That is why a
  // purchase order could show a total of 0.00 above lines that plainly summed
  // to millions: every recompute silently wrote zero. MySQL returns the alias
  // exactly as written, so a lower-case name is correct on both.
  const [[row]] = await sequelize.query(
    'SELECT COALESCE(SUM(total_price), 0) AS newsubtotal FROM purchase_order_items WHERE purchase_order_id = :id',
    { replacements: { id: poId } }
  );
  const subtotal = parseFloat(row?.newsubtotal) || 0;
  const taxRate = parseFloat(po.tax_rate) || 0;
  const shippingCost = parseFloat(po.shipping_cost) || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount + shippingCost;
  const exchangeRate = parseFloat(po.exchange_rate) || 1;

  await sequelize.query(`
    UPDATE purchase_orders SET subtotal = :subtotal, tax_amount = :tax_amount,
      total_amount = :total_amount, base_currency_total = :base_currency_total, updated_at = NOW()
    WHERE id = :id
  `, {
    replacements: {
      subtotal, tax_amount: taxAmount, total_amount: total,
      base_currency_total: total * exchangeRate, id: poId
    }
  });

  return { subtotal, taxAmount, total };
}

/**
 * Load a PO the caller is allowed to touch, and refuse anything past draft.
 *
 * Once an order leaves draft its figures are what an approver signed against,
 * so they stop being editable — the same rule the add-item route already
 * applies, shared so edit and delete cannot disagree with it.
 */
async function loadEditableP0(req) {
  const clinicId = BranchQueryFilter.resolveClinicId(req);
  const editablePOReplacements = { id: req.params.id, clinicId };
  const editablePOBranchScope = branchScope(req, editablePOReplacements);
  const [pos] = await sequelize.query(
    `SELECT * FROM purchase_orders WHERE id = :id AND clinic_id = :clinicId ${editablePOBranchScope}`,
    { replacements: editablePOReplacements }
  );
  if (pos.length === 0) return { error: { code: 404, body: { error: 'PO not found' } } };
  if (pos[0].status !== 'draft') {
    return { error: { code: 400, body: { error: 'Items can only be changed while the PO is in draft status' } } };
  }
  return { po: pos[0] };
}

// Order-level field edits on a draft PO — currently just po_currency (the
// Purchase Order Details modal's own Currency field). Deliberately NOT
// converting existing line item prices when the currency changes: this is
// a draft, not-yet-submitted order, so changing currency here is treated
// as correcting a mislabeled order, not re-pricing it into a new currency.
router.put('/purchase-orders/:id', authorize('procurement.purchase_orders.write'), async (req, res) => {
  try {
    const { po, error } = await loadEditableP0(req);
    if (error) return res.status(error.code).json(error.body);

    if (req.body.po_currency === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const poCurrency = String(req.body.po_currency || '').trim().toUpperCase();
    if (!poCurrency) {
      return res.status(400).json({ error: 'Currency is required' });
    }

    await sequelize.query(
      'UPDATE purchase_orders SET po_currency = :po_currency, updated_at = NOW() WHERE id = :id',
      { replacements: { po_currency: poCurrency, id: req.params.id } }
    );

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: po.clinic_id, user_id: req.user?.id, user_name: req.user?.display_name || req.user?.displayName,
        user_role: req.user?.role, module: 'Procurement', action: 'PO_UPDATED',
        entity_type: 'PurchaseOrder', entity_id: String(req.params.id),
        description: `PO ${po.po_number}: currency changed`,
        old_values: { po_currency: po.po_currency }, new_values: { po_currency: poCurrency },
        ip_address: req.ip, status: 'success'
      });
    } catch (e) { /* audit must never block the edit */ }

    const [[updated]] = await sequelize.query('SELECT * FROM purchase_orders WHERE id = :id', { replacements: { id: req.params.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating purchase order:', error);
    res.status(500).json({ error: 'Failed to update purchase order' });
  }
});

router.post('/purchase-orders/:id/items', authorize('procurement.purchase_orders.write'), async (req, res) => {
  try {
    const { item_name, description, quantity, unit_price, unit_of_measure } = req.body;
    if (!item_name || !quantity || unit_price === undefined || unit_price === null) {
      return res.status(400).json({ error: 'item_name, quantity and unit_price are required' });
    }

    const clinicIdForItems = BranchQueryFilter.resolveClinicId(req);
    const itemsPOReplacements = { id: req.params.id, clinicId: clinicIdForItems };
    const itemsPOBranchScope = branchScope(req, itemsPOReplacements);
    const [pos] = await sequelize.query(`SELECT * FROM purchase_orders WHERE id = :id AND clinic_id = :clinicId ${itemsPOBranchScope}`, { replacements: itemsPOReplacements });
    if (pos.length === 0) return res.status(404).json({ error: 'PO not found' });
    const po = pos[0];
    if (po.status !== 'draft') {
      return res.status(400).json({ error: 'Items can only be added while the PO is in draft status' });
    }

    const totalPrice = (parseFloat(quantity) || 0) * (parseFloat(unit_price) || 0);
    await sequelize.query(`
      INSERT INTO purchase_order_items (purchase_order_id, item_name, description, quantity,
        unit_price, total_price, unit_of_measure, created_at, updated_at, branch_id)
      VALUES (:po_id, :item_name, :description, :quantity, :unit_price, :total_price, :unit_of_measure, NOW(), NOW(), :branch_id)
    `, {
      replacements: {
        po_id: req.params.id, item_name, description: description || null,
        quantity: parseInt(quantity) || 1, unit_price: parseFloat(unit_price) || 0,
        total_price: totalPrice, unit_of_measure: unit_of_measure || 'Each',
        branch_id: po.branch_id ?? getCreateBranchId(req)
      }
    });

    // Shared with the edit and delete routes so the three cannot drift apart.
    const totals = await recomputePOTotals(req.params.id, po);

    const [items] = await sequelize.query(
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = :id ORDER BY id',
      { replacements: { id: req.params.id } }
    );

    res.status(201).json({ items, total_amount: totals.total, subtotal: totals.subtotal, tax_amount: totals.taxAmount });
  } catch (error) {
    console.error('Error adding PO item:', error);
    res.status(500).json({ error: 'Failed to add item to purchase order' });
  }
});

// Edit a line on a draft PO
router.put('/purchase-orders/:id/items/:itemId', authorize('procurement.purchase_orders.write'), async (req, res) => {
  try {
    const { po, error } = await loadEditableP0(req);
    if (error) return res.status(error.code).json(error.body);

    const [existing] = await sequelize.query(
      'SELECT * FROM purchase_order_items WHERE id = :itemId AND purchase_order_id = :poId',
      { replacements: { itemId: req.params.itemId, poId: req.params.id } }
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Item not found on this purchase order' });

    // Only the three fields the draft editor exposes; item_name stays as picked
    // from the catalogue so a line cannot be silently repointed at a different
    // product while keeping its history.
    const quantity = req.body.quantity !== undefined ? parseInt(req.body.quantity, 10) : parseInt(existing[0].quantity, 10);
    const unitPrice = req.body.unit_price !== undefined ? parseFloat(req.body.unit_price) : parseFloat(existing[0].unit_price);
    const description = req.body.description !== undefined ? (req.body.description || null) : existing[0].description;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a whole number greater than zero' });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({ error: 'Unit price cannot be negative' });
    }

    await sequelize.query(`
      UPDATE purchase_order_items
         SET quantity = :quantity, unit_price = :unit_price, total_price = :total_price,
             description = :description, updated_at = NOW()
       WHERE id = :itemId AND purchase_order_id = :poId
    `, {
      replacements: {
        quantity, unit_price: unitPrice, total_price: quantity * unitPrice,
        description, itemId: req.params.itemId, poId: req.params.id
      }
    });

    const totals = await recomputePOTotals(req.params.id, po);
    const [items] = await sequelize.query(
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = :id ORDER BY id',
      { replacements: { id: req.params.id } }
    );

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: po.clinic_id, user_id: req.user?.id, user_name: req.user?.display_name || req.user?.displayName,
        user_role: req.user?.role, module: 'Procurement', action: 'PO_ITEM_UPDATED',
        entity_type: 'PurchaseOrderItem', entity_id: String(req.params.itemId),
        description: `PO ${po.po_number}: ${existing[0].item_name} changed`,
        old_values: { quantity: existing[0].quantity, unit_price: existing[0].unit_price },
        new_values: { quantity, unit_price: unitPrice },
        ip_address: req.ip, status: 'success'
      });
    } catch (e) { /* audit must never block the edit */ }

    res.json({ items, total_amount: totals.total, subtotal: totals.subtotal, tax_amount: totals.taxAmount });
  } catch (error) {
    console.error('Error updating PO item:', error);
    res.status(500).json({ error: 'Failed to update purchase order item' });
  }
});

// Remove a line from a draft PO
router.delete('/purchase-orders/:id/items/:itemId', authorize('procurement.purchase_orders.write'), async (req, res) => {
  try {
    const { po, error } = await loadEditableP0(req);
    if (error) return res.status(error.code).json(error.body);

    const [existing] = await sequelize.query(
      'SELECT * FROM purchase_order_items WHERE id = :itemId AND purchase_order_id = :poId',
      { replacements: { itemId: req.params.itemId, poId: req.params.id } }
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Item not found on this purchase order' });

    await sequelize.query(
      'DELETE FROM purchase_order_items WHERE id = :itemId AND purchase_order_id = :poId',
      { replacements: { itemId: req.params.itemId, poId: req.params.id } }
    );

    const totals = await recomputePOTotals(req.params.id, po);
    const [items] = await sequelize.query(
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = :id ORDER BY id',
      { replacements: { id: req.params.id } }
    );

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: po.clinic_id, user_id: req.user?.id, user_name: req.user?.display_name || req.user?.displayName,
        user_role: req.user?.role, module: 'Procurement', action: 'PO_ITEM_REMOVED',
        entity_type: 'PurchaseOrderItem', entity_id: String(req.params.itemId),
        description: `PO ${po.po_number}: ${existing[0].item_name} removed`,
        old_values: { item_name: existing[0].item_name, quantity: existing[0].quantity, unit_price: existing[0].unit_price },
        ip_address: req.ip, status: 'success'
      });
    } catch (e) { /* audit must never block the removal */ }

    res.json({ items, total_amount: totals.total, subtotal: totals.subtotal, tax_amount: totals.taxAmount });
  } catch (error) {
    console.error('Error deleting PO item:', error);
    res.status(500).json({ error: 'Failed to delete purchase order item' });
  }
});

// Delete a whole draft PO — only while nothing has been signed off yet
// (loadEditableP0 enforces draft-only + branch scoping), and only with a
// stated reason, so there's a record of why it never went anywhere.
router.delete('/purchase-orders/:id', authorize('procurement.purchase_orders.write'), async (req, res) => {
  try {
    const { po, error } = await loadEditableP0(req);
    if (error) return res.status(error.code).json(error.body);

    const reason = (req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to delete a purchase order' });

    await sequelize.query('DELETE FROM purchase_order_items WHERE purchase_order_id = :id', { replacements: { id: req.params.id } });
    await sequelize.query('DELETE FROM purchase_orders WHERE id = :id', { replacements: { id: req.params.id } });

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: po.clinic_id, user_id: req.user?.id, user_name: req.user?.display_name || req.user?.displayName,
        user_role: req.user?.role, module: 'Procurement', action: 'PO_DELETED',
        entity_type: 'PurchaseOrder', entity_id: String(po.id),
        description: `PO ${po.po_number} deleted while in draft — reason: ${reason}`,
        old_values: { po_number: po.po_number, status: po.status, reason },
        ip_address: req.ip, status: 'success'
      });
    } catch (e) { /* audit must never block the deletion */ }

    res.json({ message: 'Purchase order deleted successfully' });
  } catch (error) {
    console.error('Error deleting purchase order:', error);
    res.status(500).json({ error: 'Failed to delete purchase order' });
  }
});

// Update PO status (approve, send, cancel)
router.post('/purchase-orders/:id/status', authorize('procurement.purchase_orders.write'), async (req, res) => {
  try {
    const { action, user_id, user_name, signature } = req.body;

    // This single endpoint handles 3 distinct approval gates (check/approve/authorize)
    // selected via req.body.action, so the approval_type must be resolved dynamically
    // before checking permission rather than via a single static middleware call.
    const ACTION_APPROVAL_TYPE = { check: 'po_check', approve: 'po_approve', authorize: 'po_authorize' };
    const approvalType = ACTION_APPROVAL_TYPE[action];
    if (approvalType) {
      const allowed = await userHasApprovalPermission(req, approvalType);
      if (!allowed) {
        const allowedActions = await getUserAllowedActions(req);
        const label = APPROVAL_TYPES[approvalType]?.label || approvalType;
        return res.status(403).json({
          error: `You are not authorized to perform this action (${label}).`,
          allowedActions,
        });
      }
    }

    const clinicIdForStatus = BranchQueryFilter.resolveClinicId(req);
    const statusPOReplacements = { id: req.params.id, clinicId: clinicIdForStatus };
    const statusPOBranchScope = branchScope(req, statusPOReplacements);
    const [po] = await sequelize.query(`SELECT * FROM purchase_orders WHERE id = :id AND clinic_id = :clinicId ${statusPOBranchScope}`, { replacements: statusPOReplacements });
    if (po.length === 0) return res.status(404).json({ error: 'PO not found' });

    const currentStatus = po[0].status;
    let newStatus = currentStatus;
    let extraFields = '';
    const replacements = { id: req.params.id };

    switch (action) {
      case 'check':
        if (currentStatus !== 'draft') return res.status(400).json({ error: 'Only draft POs can be checked' });
        newStatus = 'check';
        extraFields = ', check_signed_by = :user_name, check_signed_at = NOW()';
        if (signature) extraFields += ', check_signature = :signature';
        replacements.user_name = user_name; replacements.signature = signature || null;
        break;
      case 'approve':
        if (currentStatus !== 'check') return res.status(400).json({ error: 'Only checked POs can be approved' });
        newStatus = 'approved';
        extraFields = ', approved_signed_by = :user_name, approved_signed_at = NOW()';
        if (signature) extraFields += ', approved_signature = :signature';
        replacements.user_name = user_name; replacements.signature = signature || null;
        break;
      case 'authorize':
        if (currentStatus !== 'approved') return res.status(400).json({ error: 'Only approved POs can be authorized' });
        newStatus = 'authorized';
        extraFields = ', authorized_signed_by = :user_name, authorized_signed_at = NOW()';
        if (signature) extraFields += ', authorized_signature = :signature';
        replacements.user_name = user_name; replacements.signature = signature || null;
        break;
      case 'send':
        if (!['approved', 'authorized'].includes(currentStatus)) return res.status(400).json({ error: 'PO must be approved/authorized to send' });
        newStatus = 'authorized'; // Keep as authorized but mark sent date
        extraFields = ', expected_delivery_date = :expected_delivery_date';
        replacements.expected_delivery_date = req.body.expected_delivery_date || null;
        break;
      // 'receive' was removed deliberately: marking a PO received here set the
      // status with no check that anything was actually delivered. Goods
      // Receipt Notes now own that transition exclusively (see
      // POST /goods-receipt-notes below), driven by real received quantities.
      case 'cancel':
        if (['received', 'cancelled'].includes(currentStatus)) return res.status(400).json({ error: 'Cannot cancel this PO' });
        newStatus = 'cancelled';
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    replacements.status = newStatus;
    await sequelize.query(
      `UPDATE purchase_orders SET status = :status ${extraFields}, updated_at = NOW() WHERE id = :id`,
      { replacements }
    );

    res.json({ message: `PO ${action} successful`, status: newStatus });
  } catch (error) {
    console.error('Error updating PO status:', error);
    res.status(500).json({ error: 'Failed to update PO status' });
  }
});


// ═══════════════════════════════════════════════════
// GOODS RECEIPT NOTES
// ═══════════════════════════════════════════════════

// List GRNs
router.get('/goods-receipt-notes', authorize('procurement.read'), async (req, res) => {
  try {
    const { status, po_id } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const conditions = ['grn.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (status) { conditions.push('grn.status = :status'); replacements.status = status; }
    if (po_id) { conditions.push('grn.po_id = :po_id'); replacements.po_id = po_id; }

    const where = 'WHERE ' + conditions.join(' AND ') + branchScope(req, replacements, 'grn');

    const [grns] = await sequelize.query(`
      SELECT grn.*, po.po_number, s.name as supplier_name,
        u.display_name as received_by_name,
        (SELECT COUNT(*) FROM grn_line_items WHERE grn_id = grn.id) as line_count
      FROM goods_receipt_notes grn
      LEFT JOIN purchase_orders po ON grn.po_id = po.id
      LEFT JOIN suppliers s ON grn.supplier_id = s.id
      LEFT JOIN users u ON u.id = grn.received_by
      ${where}
      ORDER BY grn.created_at DESC
    `, { replacements });

    res.json(grns);
  } catch (error) {
    console.error('Error fetching GRNs:', error);
    res.status(500).json({ error: 'Failed to fetch goods receipt notes' });
  }
});

// Get single GRN with lines
router.get('/goods-receipt-notes/:id', authorize('procurement.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const grnByIdReplacements = { id: req.params.id, clinicId };
    const grnByIdBranchScope = branchScope(req, grnByIdReplacements, 'grn');
    const [grns] = await sequelize.query(`
      SELECT grn.*, po.po_number, s.name as supplier_name,
        u.display_name as received_by_name, ins.display_name as inspected_by_name
      FROM goods_receipt_notes grn
      LEFT JOIN purchase_orders po ON grn.po_id = po.id
      LEFT JOIN suppliers s ON grn.supplier_id = s.id
      LEFT JOIN users u ON u.id = grn.received_by
      LEFT JOIN users ins ON ins.id = grn.inspected_by
      WHERE grn.id = :id AND grn.clinic_id = :clinicId ${grnByIdBranchScope}
    `, { replacements: grnByIdReplacements });

    if (grns.length === 0) return res.status(404).json({ error: 'GRN not found' });

    const [lines] = await sequelize.query(
      'SELECT * FROM grn_line_items WHERE grn_id = :id ORDER BY id',
      { replacements: { id: req.params.id } }
    );

    res.json({ ...grns[0], lines });
  } catch (error) {
    console.error('Error fetching GRN:', error);
    res.status(500).json({ error: 'Failed to fetch goods receipt note' });
  }
});

// Create GRN from PO
router.post('/goods-receipt-notes', authorize('procurement.write'), async (req, res) => {
  try {
    const { po_id, received_by, received_location, received_condition, notes, invoice_number, lines } = req.body;
    const clinic_id = BranchQueryFilter.resolveClinicId(req);

    // Get the PO details — scoped so a GRN can't be created against another clinic's PO.
    const poLookupReplacements = { po_id, clinic_id };
    const poLookupBranchScope = branchScope(req, poLookupReplacements);
    const [po] = await sequelize.query(
      `SELECT * FROM purchase_orders WHERE id = :po_id AND clinic_id = :clinic_id ${poLookupBranchScope}`,
      { replacements: poLookupReplacements }
    );
    if (po.length === 0) return res.status(404).json({ error: 'Purchase order not found' });

    // Generate GRN number
    const [countResult] = await sequelize.query('SELECT COUNT(*) as cnt FROM goods_receipt_notes');
    const grnNumber = `GRN-${new Date().getFullYear()}-${String((countResult[0].cnt || 0) + 1).padStart(4, '0')}`;

    const grnId = uuidv4();
    let totalItemsReceived = 0;
    const grnBranchId = po[0].branch_id ?? getCreateBranchId(req);

    await sequelize.query(`
      INSERT INTO goods_receipt_notes (id, clinic_id, grn_number, po_id, supplier_id, receipt_date,
        received_by, received_location, received_condition, total_items_received, notes, invoice_number, status, created_at, updated_at, branch_id)
      VALUES (:id, :clinic_id, :grn_number, :po_id, :supplier_id, CURRENT_DATE, :received_by,
        :received_location, :received_condition, 0, :notes, :invoice_number, 'pending_inspection', NOW(), NOW(), :branch_id)
    `, {
      replacements: {
        id: grnId, clinic_id: clinic_id || po[0].clinic_id || 1,
        grn_number: grnNumber, po_id, supplier_id: po[0].supplier_id,
        received_by, received_location: received_location || null,
        received_condition: received_condition || 'good', notes: notes || null,
        invoice_number: invoice_number || null, branch_id: grnBranchId
      }
    });

    // Insert line items
    if (lines && lines.length > 0) {
      for (const line of lines) {
        const lineId = uuidv4();
        totalItemsReceived += (line.quantity_received || 0);

        await sequelize.query(`
          INSERT INTO grn_line_items (id, grn_id, po_line_item_id, item_code, item_description,
            quantity_expected, quantity_received, unit_of_measure, item_condition,
            batch_number, expiry_date, serial_number, inspection_status, inspection_notes, created_at, branch_id)
          VALUES (:id, :grn_id, :po_line_item_id, :item_code, :item_description,
            :quantity_expected, :quantity_received, :unit_of_measure, :item_condition,
            :batch_number, :expiry_date, :serial_number, 'pass', :inspection_notes, NOW(), :branch_id)
        `, {
          replacements: {
            id: lineId, grn_id: grnId,
            po_line_item_id: line.po_line_item_id || null,
            item_code: line.item_code || null,
            item_description: line.item_description || line.item_name || '',
            quantity_expected: line.quantity_expected || line.quantity_ordered || 0,
            quantity_received: line.quantity_received || 0,
            unit_of_measure: line.unit_of_measure || 'Each',
            item_condition: line.item_condition || 'good',
            batch_number: line.batch_number || null,
            expiry_date: line.expiry_date || null,
            serial_number: line.serial_number || null,
            inspection_notes: line.inspection_notes || null,
            branch_id: grnBranchId
          }
        });

        // Update PO line item received quantity
        if (line.po_line_item_id) {
          await sequelize.query(`
            UPDATE purchase_order_items SET
              quantity_received = COALESCE(quantity_received, 0) + :qty,
              status = CASE WHEN COALESCE(quantity_received, 0) + :qty >= quantity THEN 'complete' ELSE 'partial' END,
              updated_at = NOW()
            WHERE id = :line_id
          `, { replacements: { qty: line.quantity_received || 0, line_id: line.po_line_item_id } });
        }
      }

      // Update total items received
      await sequelize.query(
        'UPDATE goods_receipt_notes SET total_items_received = :total WHERE id = :id',
        { replacements: { total: totalItemsReceived, id: grnId } }
      );
    }

    // Update PO status to partial_received or received
    const [poItems] = await sequelize.query(
      'SELECT SUM(quantity) as total_ordered, SUM(COALESCE(quantity_received, 0)) as total_received FROM purchase_order_items WHERE purchase_order_id = :po_id',
      { replacements: { po_id } }
    );
    if (poItems[0]) {
      const allReceived = poItems[0].total_received >= poItems[0].total_ordered;
      const newStatus = allReceived ? 'received' : po[0].status;
      if (newStatus !== po[0].status) {
        await sequelize.query('UPDATE purchase_orders SET status = :status, updated_at = NOW() WHERE id = :po_id',
          { replacements: { status: newStatus, po_id } });
      }
    }

    const [newGRN] = await sequelize.query('SELECT * FROM goods_receipt_notes WHERE id = :id', { replacements: { id: grnId } });
    res.status(201).json(newGRN[0]);
  } catch (error) {
    console.error('Error creating GRN:', error);
    res.status(500).json({ error: 'Failed to create goods receipt note' });
  }
});

// Update GRN inspection status
router.post('/goods-receipt-notes/:id/inspect', requireApprovalPermission('grn_inspect'), async (req, res) => {
  try {
    const { inspected_by, inspection_notes, status, line_updates } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const inspectReplacements = {
      id: req.params.id, clinicId, status: status || 'inspected',
      inspected_by: inspected_by || null, inspection_notes: inspection_notes || null
    };
    const inspectBranchScope = branchScope(req, inspectReplacements);

    const [, inspectMeta] = await sequelize.query(`
      UPDATE goods_receipt_notes SET status = :status, inspected_by = :inspected_by,
        inspection_date = CURRENT_DATE, inspection_notes = :inspection_notes, updated_at = NOW()
      WHERE id = :id AND clinic_id = :clinicId ${inspectBranchScope}
    `, {
      replacements: inspectReplacements
    });
    if (inspectMeta.rowCount === 0) return res.status(404).json({ error: 'GRN not found' });

    // Update individual line inspection statuses
    if (line_updates && line_updates.length > 0) {
      for (const update of line_updates) {
        await sequelize.query(`
          UPDATE grn_line_items SET inspection_status = :status, inspection_notes = :notes
          WHERE id = :id
        `, { replacements: { id: update.id, status: update.inspection_status || 'pass', notes: update.inspection_notes || null } });
      }
    }

    res.json({ message: 'GRN inspection updated' });
  } catch (error) {
    console.error('Error updating GRN inspection:', error);
    res.status(500).json({ error: 'Failed to update inspection' });
  }
});

// Accept GRN — also creates inventory batches and stock transactions
router.post('/goods-receipt-notes/:id/accept', requireApprovalPermission('grn_accept'), async (req, res) => {
  let t;
  try {
    // Status check, inventory item resolution/creation, batch creation, stock increments,
    // and the grn_line_items link-back all used to run as a sequence of unguarded
    // individual queries — no transaction at all. That meant: (1) the double-accept guard
    // below was itself a check-then-act race (two concurrent Accept clicks could both pass
    // the status check before either updated it, each creating its own duplicate batches/
    // stock/GL entries — exactly what the guard's own comment says it exists to prevent),
    // and (2) a failure partway through the line-items loop left the GRN marked accepted
    // with only some items actually received into stock, with no way to tell which.
    // Wrapping the whole thing in one transaction (committed just before the GL posting,
    // which stays its own separate best-effort step — see the comment further down) fixes
    // both: concurrent accepts now serialize on the locked GRN row, and a mid-loop failure
    // rolls back every batch/stock/transaction change made so far instead of leaving a
    // half-received GRN.
    t = await sequelize.transaction();

    // Get GRN details — locked so a concurrent accept on the same GRN blocks here instead
    // of both readers seeing 'pending_inspection' and both proceeding.
    const clinicIdForAccept = BranchQueryFilter.resolveClinicId(req);
    const acceptGrnReplacements = { id: req.params.id, clinicId: clinicIdForAccept };
    const acceptGrnBranchScope = branchScope(req, acceptGrnReplacements);
    const [grns] = await sequelize.query(
      `SELECT * FROM goods_receipt_notes WHERE id = :id AND clinic_id = :clinicId ${acceptGrnBranchScope} FOR UPDATE`,
      { replacements: acceptGrnReplacements, transaction: t }
    );
    if (grns.length === 0) {
      await t.rollback();
      return res.status(404).json({ error: 'GRN not found' });
    }
    const grn = grns[0];
    // Guard against double-accepting (e.g. a double-click or retried request) — without this,
    // re-running acceptance would create duplicate inventory batches/stock and duplicate GL entries.
    if (!['pending_inspection', 'inspected'].includes(grn.status)) {
      await t.rollback();
      return res.status(400).json({ error: `Cannot accept a GRN with status '${grn.status}'` });
    }

    // Update GRN status
    await sequelize.query(
      "UPDATE goods_receipt_notes SET status = 'accepted', updated_at = NOW() WHERE id = :id",
      { replacements: { id: req.params.id }, transaction: t }
    );

    // Batches/inventory transactions record cost in the PO's own currency (POs in this
    // system are frequently USD) — previously hardcoded to 'SSP' below regardless of the
    // actual PO currency, which silently mislabeled every foreign-currency receipt's cost
    // basis and cascaded into wrong average/current unit cost, wrong inventory valuation,
    // and wrong COGS on every later dispensing of that batch (the GL posting further down
    // already read the real po_currency correctly — this was the one place that didn't).
    const [poCurrencyRows] = await sequelize.query(
      'SELECT po_currency FROM purchase_orders WHERE id = :id',
      { replacements: { id: grn.po_id }, transaction: t }
    );
    const grnCostCurrency = poCurrencyRows[0]?.po_currency || (await getBaseCurrencyCode());

    // Resolve storage location_id from received_location name
    let locationId = null;
    if (grn.received_location) {
      const [locs] = await sequelize.query(
        'SELECT id FROM stock_locations WHERE location_name LIKE :name AND clinic_id = :cid LIMIT 1',
        { replacements: { name: grn.received_location, cid: grn.clinic_id }, transaction: t }
      );
      if (locs.length > 0) locationId = locs[0].id;
    }

    // Get GRN line items
    const [lines] = await sequelize.query(
      'SELECT * FROM grn_line_items WHERE grn_id = :grn_id',
      { replacements: { grn_id: req.params.id }, transaction: t }
    );

    let batchesCreated = 0;
    // Accumulate received value per inventory account code (1300 Medical Supplies vs 1310 Pharmaceutical)
    // so we can post a single balanced GL entry (Debit inventory / Credit Accounts Payable) after the loop.
    const glValueByAccountCode = {};

    for (const line of lines) {
      if (!line.quantity_received || line.quantity_received <= 0) continue;

      // 1. Try to find matching inventory item by inventory_item_id or item_code
      let inventoryItemId = line.inventory_item_id || null;

      if (!inventoryItemId && line.item_code) {
        const [items] = await sequelize.query(
          'SELECT id FROM inventory_items WHERE item_code = :code AND clinic_id = :cid LIMIT 1',
          { replacements: { code: line.item_code, cid: grn.clinic_id }, transaction: t }
        );
        if (items.length > 0) inventoryItemId = items[0].id;
      }

      // 2. Fallback: match by item name
      if (!inventoryItemId && line.item_description) {
        const [items] = await sequelize.query(
          'SELECT id FROM inventory_items WHERE item_name LIKE :name AND clinic_id = :cid LIMIT 1',
          { replacements: { name: line.item_description, cid: grn.clinic_id }, transaction: t }
        );
        if (items.length > 0) inventoryItemId = items[0].id;
      }

      // 3. Auto-create item in inventory_items if still not found
      if (!inventoryItemId) {
        inventoryItemId = uuidv4();
        const autoCode = line.item_code || `GRN-${grn.grn_number}-${String(batchesCreated + 1).padStart(3, '0')}`;
        // branch_id must be stamped here — GET /api/inventory/items filters non-admin,
        // branch-scoped users by i.branch_id = :branchId, and NULL never matches that
        // condition, so an item auto-created without a branch_id silently disappears
        // from Item Master (while still showing up in per-location stock views, which
        // don't filter by branch) for every non-admin user.
        //
        // Deliberately NOT an ON CONFLICT (clinic_id, item_code) upsert: inventory_items'
        // own unique constraint on item_code has changed shape across tenants over time
        // — ensureInventoryItemCodeUniqueness.js widens it from (clinic_id, item_code)
        // to (clinic_id, branch_id, item_code) per tenant, and that migration is
        // fire-and-forget on first connection (tenantDb.js), so which shape is live on
        // any given tenant isn't guaranteed. Naming either shape here throws "no unique
        // or exclusion constraint matching the ON CONFLICT specification" on whichever
        // tenants are on the OTHER shape — confirmed live: this was the actual cause of
        // GRN acceptance failing outright with a 500 whenever a line item needed a new
        // inventory_items row auto-created. A plain INSERT has no such requirement —
        // Postgres enforces whichever unique constraint actually exists regardless, so
        // this works unconditionally; only a genuine race (two concurrent accepts
        // creating the same new code at once) needs the catch below.
        try {
          await sequelize.query(`
            INSERT INTO inventory_items (id, clinic_id, branch_id, item_code, item_name, unit_of_measure,
              quantity_on_hand, current_unit_cost, average_unit_cost, created_at, updated_at)
            VALUES (:id, :clinic_id, :branch_id, :item_code, :item_name, :uom, 0, 0, 0, NOW(), NOW())
          `, {
            replacements: {
              id: inventoryItemId, clinic_id: grn.clinic_id, branch_id: getCreateBranchId(req),
              item_code: autoCode, item_name: line.item_description,
              uom: line.unit_of_measure || 'Each'
            },
            transaction: t
          });
        } catch (insertErr) {
          if (insertErr.original?.code !== '23505') throw insertErr; // only swallow a genuine uniqueness race
          await sequelize.query(
            'UPDATE inventory_items SET item_name = :item_name WHERE clinic_id = :cid AND item_code = :code',
            { replacements: { item_name: line.item_description, cid: grn.clinic_id, code: autoCode }, transaction: t }
          );
        }
        // Re-fetch — either the row just inserted, or the one a concurrent request/race already created.
        const [created] = await sequelize.query(
          'SELECT id FROM inventory_items WHERE item_code = :code AND clinic_id = :cid LIMIT 1',
          { replacements: { code: autoCode, cid: grn.clinic_id }, transaction: t }
        );
        if (created.length > 0) inventoryItemId = created[0].id;
      }

      if (!inventoryItemId) continue;

      const batchId = uuidv4();
      const batchNumber = line.batch_number || `GRN-${grn.grn_number}-${String(batchesCreated + 1).padStart(2, '0')}`;

      // grn_line_items has no unit_cost column — resolve the real received unit price from the
      // originating PO line item (purchase_order_items.unit_price) so batch cost / GL value aren't always 0.
      let unitCost = parseFloat(line.unit_cost) || 0;
      if (!unitCost && line.po_line_item_id) {
        const [poLineRows] = await sequelize.query(
          'SELECT unit_price FROM purchase_order_items WHERE id = :id',
          { replacements: { id: line.po_line_item_id }, transaction: t }
        );
        if (poLineRows.length > 0) unitCost = parseFloat(poLineRows[0].unit_price) || 0;
      }

      // Classify the item for GL posting via AccountResolver: the item's own
      // override -> its category's inventory account -> clinic default
      // (inventory_settings) -> suspense + accounting_exceptions row —
      // replacing this route's own drugs-vs-everything-else binary
      // (1310/1300) fallback. For an already-categorized item (Phase 2's
      // seed gives every item category an inventory account matching that
      // exact binary split), this resolves to the identical account.
      const [itemRows] = await sequelize.query(
        'SELECT id, item_category, category_id, inventory_account_id FROM inventory_items WHERE id = :id',
        { replacements: { id: inventoryItemId }, transaction: t }
      );
      const AccountResolver = require('../services/AccountResolver');
      const resolvedGrnAccounts = await AccountResolver.resolveItemAccounts(itemRows[0] || { id: inventoryItemId }, {
        clinicId: grn.clinic_id, branchId: grn.branch_id, need: ['inventory'],
        sourceModule: 'procurement.grnAccept', referenceId: grn.id,
      });
      const glAccountId = resolvedGrnAccounts.inventory;

      // inventory_items.average_unit_cost/current_unit_cost/cost_currency
      // are cross-batch blended figures — every reader (the valuation
      // report, stock transfers, etc.) treats cost_currency as the single
      // currency the whole item is costed in and never converts on its
      // own, so these three columns must always agree. Writing the GRN's
      // raw, native-PO-currency unitCost straight into them while leaving
      // cost_currency at whatever it already was (the column defaults to
      // 'SSP', and a freshly auto-created item's INSERT above never sets
      // it) silently mislabeled AND left unconverted every foreign-
      // currency receipt — confirmed live: a $950 USD laptop showed as
      // "SSP 950.00" in the Storage Stock view. Always normalize to the
      // tenant's base currency here — "the system is using SSP" is the
      // whole point of a base currency, and every other cross-batch/
      // cross-PO aggregate in this codebase (purchase_orders.
      // base_currency_total, general_ledger's base_total_debit/credit)
      // already follows the same convention.
      const [[baseCurrencyRowForItem]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`, { transaction: t });
      const itemBaseCurrency = baseCurrencyRowForItem?.code || 'SSP';
      let itemUnitCost = unitCost;
      if (itemBaseCurrency !== grnCostCurrency) {
        const fxRate = await AccountingService.requireExchangeRate(grn.clinic_id, grnCostCurrency, itemBaseCurrency, grn.receipt_date || new Date(), `accept ${grn.grn_number}`);
        itemUnitCost = AccountingService.convertAmount(unitCost, fxRate);
      }
      const lineValue = (line.quantity_received || 0) * unitCost;
      if (lineValue > 0) {
        const glKey = `id:${glAccountId}`;
        if (!glValueByAccountCode[glKey]) glValueByAccountCode[glKey] = 0;
        glValueByAccountCode[glKey] += lineValue;
      }

      // Create inventory batch (now with location_id)
      await sequelize.query(`
        INSERT INTO inventory_batches (id, clinic_id, item_id, batch_number, location_id,
          po_id, grn_id, supplier_id, receipt_date,
          quantity_received, unit_cost, cost_currency, batch_total_cost,
          expiry_date, status)
        VALUES (:id, :clinic_id, :item_id, :batch_number, :location_id,
          :po_id, :grn_id, :supplier_id, CURRENT_DATE,
          :qty, :unit_cost, :cost_currency, :batch_total,
          :expiry_date, 'active')
      `, {
        replacements: {
          id: batchId, clinic_id: grn.clinic_id, item_id: inventoryItemId,
          batch_number: batchNumber, location_id: locationId,
          po_id: grn.po_id, grn_id: grn.id, supplier_id: grn.supplier_id,
          qty: line.quantity_received, unit_cost: unitCost, cost_currency: grnCostCurrency,
          batch_total: line.quantity_received * unitCost,
          expiry_date: line.expiry_date || null
        },
        transaction: t
      });

      // Update global inventory item stock and weighted average cost — in
      // itemBaseCurrency (see above), not the GRN's raw native unitCost,
      // and cost_currency is set explicitly on every GRN so it can never
      // again drift out of sync with what average_unit_cost/
      // current_unit_cost actually mean.
      await sequelize.query(`
        UPDATE inventory_items SET
          quantity_on_hand = quantity_on_hand + :qty,
          average_unit_cost = CASE
            WHEN quantity_on_hand = 0 THEN :unit_cost
            ELSE ((average_unit_cost * quantity_on_hand) + (:unit_cost * :qty)) / (quantity_on_hand + :qty)
          END,
          current_unit_cost = :unit_cost,
          cost_currency = :cost_currency,
          updated_at = NOW()
        WHERE id = :item_id
      `, { replacements: { qty: line.quantity_received, unit_cost: itemUnitCost, cost_currency: itemBaseCurrency, item_id: inventoryItemId }, transaction: t });

      // Upsert stock_by_location for the received storage location
      if (locationId) {
        await sequelize.query(`
          INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand, updated_at)
          VALUES (:id, :clinic_id, :item_id, :location_id, :qty, NOW())
          ON CONFLICT (item_id, location_id) DO UPDATE SET
            -- Qualified: an unqualified quantity_on_hand here is ambiguous between
            -- the existing row and the one being inserted.
            quantity_on_hand = stock_by_location.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = NOW()
        `, {
          replacements: {
            id: uuidv4(), clinic_id: grn.clinic_id,
            item_id: inventoryItemId, location_id: locationId,
            qty: line.quantity_received
          },
          transaction: t
        });
      }

      // Create inventory transaction
      const txId = uuidv4();
      const [txCount] = await sequelize.query("SELECT COUNT(*) AS cnt FROM inventory_transactions WHERE DATE(created_at) = CURRENT_DATE", { transaction: t });
      const txSeq = (txCount[0]?.cnt || 0) + 1;
      const txNum = `TXN-GRN-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${String(txSeq).padStart(4, '0')}`;

      await sequelize.query(`
        INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
          quantity_change, batch_id, unit_cost, total_cost, cost_currency,
          reference_type, reference_id, transaction_date, notes, created_by)
        VALUES (:id, :clinic_id, :txn, :item_id, 'receipt',
          :qty, :batch_id, :unit_cost, :total_cost, :cost_currency,
          'grn', :grn_id, CURRENT_DATE, :notes, :created_by)
      `, {
        replacements: {
          id: txId, clinic_id: grn.clinic_id, txn: txNum,
          item_id: inventoryItemId, qty: line.quantity_received,
          batch_id: batchId, unit_cost: unitCost, cost_currency: grnCostCurrency,
          total_cost: line.quantity_received * unitCost,
          grn_id: grn.id, notes: `GRN ${grn.grn_number} accepted`,
          created_by: grn.received_by || null
        },
        transaction: t
      });

      // Update GRN line with batch and item link
      await sequelize.query(
        'UPDATE grn_line_items SET inventory_batch_id = :batch_id, inventory_item_id = :item_id WHERE id = :line_id',
        { replacements: { batch_id: batchId, item_id: inventoryItemId, line_id: line.id }, transaction: t }
      );

      batchesCreated++;
    }

    await t.commit();

    // Post to the general ledger: Debit inventory (Medical Supplies / Pharmaceutical), Credit Accounts
    // Payable - Suppliers for the total received value. This mirrors the standard point in the procurement
    // workflow where a liability to the supplier is recognized. Never let a GL failure block GRN acceptance —
    // same non-blocking pattern as BillingIntegrationService.handleBillCreation. Deliberately outside the
    // transaction above: the inventory/batch/stock effects must stay committed even if this fails.
    try {
      const totalValue = Object.values(glValueByAccountCode).reduce((s, v) => s + v, 0);
      if (totalValue > 0) {
        const apAccount = await AccountingService.getAccountByCode(grn.clinic_id, '2100');
        const debitLineItems = [];
        for (const [key, amount] of Object.entries(glValueByAccountCode)) {
          let acct = null;
          if (key.startsWith('id:')) {
            acct = await ChartOfAccounts.findByPk(key.slice(3));
          } else {
            acct = await AccountingService.getAccountByCode(grn.clinic_id, key.slice(5));
          }
          if (!acct) continue;
          debitLineItems.push({
            account_id: acct.id,
            debit_amount: amount,
            credit_amount: 0,
            description: `Inventory received - GRN ${grn.grn_number}`
          });
        }

        if (apAccount && debitLineItems.length > 0) {
          const balancedDebitTotal = debitLineItems.reduce((s, li) => s + li.debit_amount, 0);
          const lineItems = [
            ...debitLineItems,
            {
              account_id: apAccount.id,
              debit_amount: 0,
              credit_amount: balancedDebitTotal,
              description: `Accounts payable - GRN ${grn.grn_number}`
            }
          ];

          // debitLineItems/balancedDebitTotal are in the PO's own currency (unitCost comes
          // straight from purchase_order_items.unit_price, unconverted) — mostly USD in this
          // system. Telling createGLEntry the real transaction_currency lets its existing,
          // already-correct multi-currency machinery convert to the SSP base at today's rate
          // instead of the amount being posted to the ledger as if it were already SSP (was
          // silently understating USD GRNs by ~6000x — the live PO-2026-0001 entry is a real
          // example of this, left uncorrected pending explicit sign-off, see chat).
          const [poRows] = await sequelize.query('SELECT po_currency FROM purchase_orders WHERE id = :id', { replacements: { id: grn.po_id } });
          const poCurrency = poRows[0]?.po_currency || (await getBaseCurrencyCode());

          const glData = {
            clinic_id: grn.clinic_id,
            transaction_date: grn.receipt_date || new Date(),
            transaction_type: 'goods_receipt',
            description: `Goods Receipt Note ${grn.grn_number} accepted`,
            reference_id: grn.id,
            reference_module: 'procurement_grn',
            transaction_currency: poCurrency,
          };

          const glEntry = await AccountingService.createGLEntry(glData, lineItems, grn.received_by);
          await AccountingService.postGLEntry(glEntry.id, grn.received_by);
          console.log(`GL entry ${glEntry.gl_number} created and posted for GRN ${grn.grn_number} (${poCurrency} ${balancedDebitTotal} -> SSP ${glEntry.base_total_credit})`);

          // Remember the SSP-equivalent liability actually booked for this PO (accumulated
          // across however many GRNs it takes to fully receive it) so settlement can compare
          // it against the SSP-equivalent of what's actually paid and post any FX difference —
          // see POST /supplier-bill-payment in daily-expenses.js.
          if (grn.po_id) {
            await sequelize.query(
              'UPDATE purchase_orders SET ap_base_currency_amount = COALESCE(ap_base_currency_amount, 0) + :amt WHERE id = :id',
              { replacements: { amt: glEntry.base_total_credit, id: grn.po_id } }
            );
          }
        } else if (!apAccount) {
          console.warn(`GL posting skipped for GRN ${grn.grn_number}: Accounts Payable account (2100) not found for clinic ${grn.clinic_id}`);
        }
      }
    } catch (glError) {
      console.error('Error posting GL entry for GRN acceptance:', glError);
      // Don't throw — GL posting failure must never block GRN acceptance
    }

    res.json({ message: 'GRN accepted', batches_created: batchesCreated, location_id: locationId });
  } catch (error) {
    if (t && !t.finished) await t.rollback().catch(() => {});
    console.error('Error accepting GRN:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Failed to accept GRN' });
  }
});

// Reject GRN — same decision authority as accepting, so it needs the same gate.
router.post('/goods-receipt-notes/:id/reject', requireApprovalPermission('grn_accept'), async (req, res) => {
  try {
    const { inspection_notes } = req.body;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const rejectGrnReplacements = { id: req.params.id, clinicId };
    const rejectGrnBranchScope = branchScope(req, rejectGrnReplacements);
    const [grns] = await sequelize.query(`SELECT status FROM goods_receipt_notes WHERE id = :id AND clinic_id = :clinicId ${rejectGrnBranchScope}`, { replacements: rejectGrnReplacements });
    if (grns.length === 0) return res.status(404).json({ error: 'GRN not found' });
    if (grns[0].status === 'accepted') {
      return res.status(400).json({ error: 'Cannot reject a GRN that has already been accepted' });
    }

    await sequelize.query(
      "UPDATE goods_receipt_notes SET status = 'rejected', inspection_notes = :notes, updated_at = NOW() WHERE id = :id",
      { replacements: { id: req.params.id, notes: inspection_notes || '' } }
    );
    res.json({ message: 'GRN rejected' });
  } catch (error) {
    console.error('Error rejecting GRN:', error);
    res.status(500).json({ error: 'Failed to reject GRN' });
  }
});


// ═══════════════════════════════════════════════════
// PROCUREMENT DASHBOARD STATS
// ═══════════════════════════════════════════════════

router.get('/dashboard/stats', authorize('procurement.read'), async (req, res) => {
  try {
    // Always resolved from the session (falls back to the client-supplied clinic_id
    // only for an admin) — never left null, which used to mean "every clinic's stats".
    const cid = BranchQueryFilter.resolveClinicId(req);
    // Table-qualified clinic filters — several joined tables (e.g. users) also
    // carry a clinic_id column, so an unqualified "AND clinic_id = X" is
    // ambiguous in any query that joins them. Always qualify by alias.
    const cf = (alias) => `AND ${alias}.clinic_id = ${cid}`;
    const cw = (alias) => `WHERE ${alias}.clinic_id = ${cid}`;
    // Branch scoping alongside the clinic filters above — admins (branchId null) see
    // every branch within the clinic, same rule as branchScope() elsewhere in this file,
    // unless they've explicitly picked one via the TopBar switcher (adminScoped).
    const dashboardBranchId = (req.user?.role === 'admin' && !req.branchContext?.adminScoped)
      ? null
      : (req.branchContext?.branchId || req.user?.branchId || null);
    const bf = (alias) => dashboardBranchId ? `AND ${alias}.branch_id = ${parseInt(dashboardBranchId, 10)}` : '';

    // Requisition stats — real enum: draft, submitted, approved, rejected, cancelled
    const [prStats] = await sequelize.query(`
      SELECT
        COUNT(*) as total_prs,
        COALESCE(SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END), 0) as pending_approval,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) as approved,
        COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) as drafts,
        COALESCE(SUM(CASE WHEN status = 'submitted' THEN total_amount ELSE 0 END), 0) as pending_value
      FROM purchase_requisitions pr WHERE 1=1 ${cf('pr')} ${bf('pr')}
    `);

    // Purchase order stats — real enum: draft, check, approved, authorized,
    // received, cancelled (a multi-step sign-off workflow — see the
    // /purchase-orders/:id/status route for the draft→check→approved→
    // authorized→received transitions). "Open" = not yet received/cancelled,
    // expressed as NOT IN so it stays correct if intermediate statuses
    // change. "Awaiting approval" = 'check' (checked, next action is
    // 'approve') — the direct analog of a requisition's 'submitted' status.
    const [poStats] = await sequelize.query(`
      SELECT
        COUNT(*) as total_pos,
        COALESCE(SUM(CASE WHEN status = 'check' THEN 1 ELSE 0 END), 0) as pending_approval,
        COALESCE(SUM(CASE WHEN status NOT IN ('received','cancelled') THEN 1 ELSE 0 END), 0) as open_pos,
        COALESCE(SUM(CASE WHEN status NOT IN ('received','cancelled') THEN total_amount ELSE 0 END), 0) as open_value,
        COALESCE(SUM(CASE WHEN status IN ('approved','authorized') THEN total_amount ELSE 0 END), 0) as committed_amount,
        COALESCE(SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END), 0) as received,
        COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled,
        COALESCE(SUM(total_amount), 0) as total_value
      FROM purchase_orders po ${cw('po')} ${bf('po')}
    `);

    // GRN stats — real enum: pending_inspection, inspected, accepted, rejected, partial
    const [grnStats] = await sequelize.query(`
      SELECT
        COUNT(*) as total_grns,
        COALESCE(SUM(CASE WHEN status = 'pending_inspection' THEN 1 ELSE 0 END), 0) as pending_inspection,
        COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) as accepted,
        COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) as rejected
      FROM goods_receipt_notes grn WHERE 1=1 ${cf('grn')} ${bf('grn')}
    `);

    // Supplier bills (expense_invoices) — real enum: received, verified, approved,
    // partial_paid, paid, cancelled. "Awaiting approval" = received/verified,
    // i.e. logged but not yet signed off for payment.
    const [billStats] = await sequelize.query(`
      SELECT
        COUNT(*) as total_bills,
        COALESCE(SUM(CASE WHEN status IN ('received','verified') THEN 1 ELSE 0 END), 0) as pending_approval,
        COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled') THEN amount_due ELSE 0 END), 0) as outstanding_amount
      FROM expense_invoices ei WHERE 1=1 ${cf('ei')} ${bf('ei')}
    `);

    // Supplier stats — "active" = is_active AND NOT on_hold (a supplier can be
    // flagged active but still on hold, which should not count as usable).
    const [supplierStats] = await sequelize.query(`
      SELECT
        COUNT(*) as total_suppliers,
        COALESCE(SUM(CASE WHEN is_active = true AND on_hold = false THEN 1 ELSE 0 END), 0) as active_suppliers,
        COALESCE(SUM(CASE WHEN on_hold = true THEN 1 ELSE 0 END), 0) as on_hold,
        COALESCE(AVG(performance_rating), 0) as avg_rating
      FROM suppliers s WHERE 1=1 ${cf('s')}
    `);

    // Spend summary — value of POs that had at least one GRN accepted (goods
    // actually received into stock) in the last 30 days. goods_receipt_notes
    // itself carries no monetary value, so spend is derived via its PO.
    // Deduplicated per PO so a PO received across multiple GRNs isn't double counted.
    const [spendStats] = await sequelize.query(`
      SELECT COALESCE(SUM(po.total_amount), 0) as spend_30d, COUNT(DISTINCT po.id) as po_count
      FROM purchase_orders po
      WHERE po.id IN (
        SELECT DISTINCT grn.po_id FROM goods_receipt_notes grn
        WHERE grn.status = 'accepted' AND grn.receipt_date >= ((CURRENT_DATE) - INTERVAL '30 day')
      )
      ${cid !== null ? `AND po.clinic_id = ${cid}` : ''} ${bf('po')}
    `);

    // The card totals above (open_value, committed_amount, total_value,
    // spend_30d) all SUM(po.total_amount) across every PO regardless of
    // po_currency — a facility running both SSP and USD POs would have those
    // silently added together as if the same unit. Group by currency too, so
    // the frontend can show each currency's own total instead of one blended
    // number.
    const [poByCurrency] = await sequelize.query(`
      SELECT
        COALESCE(po_currency, ${BASE_CURRENCY_SQL}) as currency,
        COALESCE(SUM(CASE WHEN status NOT IN ('received','cancelled') THEN total_amount ELSE 0 END), 0) as open_value,
        COALESCE(SUM(CASE WHEN status IN ('approved','authorized') THEN total_amount ELSE 0 END), 0) as committed_amount,
        COALESCE(SUM(total_amount), 0) as total_value
      FROM purchase_orders po ${cw('po')} ${bf('po')}
      GROUP BY COALESCE(po_currency, ${BASE_CURRENCY_SQL})
    `);
    const [spendByCurrency] = await sequelize.query(`
      SELECT COALESCE(po.po_currency, ${BASE_CURRENCY_SQL}) as currency, COALESCE(SUM(po.total_amount), 0) as spend_30d
      FROM purchase_orders po
      WHERE po.id IN (
        SELECT DISTINCT grn.po_id FROM goods_receipt_notes grn
        WHERE grn.status = 'accepted' AND grn.receipt_date >= ((CURRENT_DATE) - INTERVAL '30 day')
      )
      ${cid !== null ? `AND po.clinic_id = ${cid}` : ''} ${bf('po')}
      GROUP BY COALESCE(po.po_currency, ${BASE_CURRENCY_SQL})
    `);

    // Actual cash paid to suppliers in the last 30 days — shown alongside
    // spend_30d for context (received value vs. cash actually disbursed).
    const [paidStats] = await sequelize.query(`
      SELECT COALESCE(SUM(sbp.amount_paid), 0) as paid_30d, COUNT(*) as payment_count
      FROM supplier_bill_payments sbp
      WHERE sbp.payment_date >= ((CURRENT_DATE) - INTERVAL '30 day') ${cf('sbp')} ${bf('sbp')}
    `);

    // Recent POs
    const [recentPOs] = await sequelize.query(`
      SELECT po.id, po.po_number, po.order_date, po.total_amount, COALESCE(po.po_currency, ${BASE_CURRENCY_SQL}) as po_currency, po.status, s.name as supplier_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      ${cw('po')} ${bf('po')}
      ORDER BY po.created_at DESC LIMIT 5
    `);

    // Overdue deliveries — orders still open (not received/cancelled) past
    // their requested delivery date.
    const [overdue] = await sequelize.query(`
      SELECT po.id, po.po_number, po.requested_delivery_date, po.total_amount, COALESCE(po.po_currency, ${BASE_CURRENCY_SQL}) as po_currency, s.name as supplier_name,
        ((CURRENT_DATE)::date - (po.requested_delivery_date)::date) as days_overdue
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.status NOT IN ('received','cancelled')
        AND po.requested_delivery_date IS NOT NULL
        AND po.requested_delivery_date < CURRENT_DATE
        ${cid !== null ? `AND po.clinic_id = ${cid}` : ''} ${bf('po')}
      ORDER BY po.requested_delivery_date ASC LIMIT 5
    `);

    // Top suppliers by spend — po is joined in (not the shared suppliers row itself)
    // so order_count/total_spend reflect only this branch's own purchase activity.
    const [topSuppliers] = await sequelize.query(`
      SELECT s.id, s.name, s.supplier_code, s.performance_rating,
        COUNT(po.id) as order_count,
        COALESCE(SUM(po.total_amount), 0) as total_spend
      FROM suppliers s
      LEFT JOIN purchase_orders po ON s.id = po.supplier_id AND po.status != 'cancelled' ${bf('po')}
      WHERE 1=1 ${cf('s')}
      GROUP BY s.id, s.name, s.supplier_code, s.performance_rating
      ORDER BY total_spend DESC LIMIT 5
    `);

    // Recent activity — built strictly from real created_at timestamps across
    // requisitions, purchase orders, goods receipts and new suppliers. No
    // synthetic/fabricated audit log.
    const [recentActivity] = await sequelize.query(`
      SELECT * FROM (
        SELECT 'requisition' AS type, pr.pr_number AS reference, pr.status AS status,
               pr.total_amount AS amount, pr.created_at AS ts, u1.display_name AS actor
        FROM purchase_requisitions pr
        LEFT JOIN users u1 ON u1.id = pr.created_by
        WHERE 1=1 ${cf('pr')} ${bf('pr')}
        UNION ALL
        SELECT 'purchase_order', po.po_number, po.status, po.total_amount, po.created_at, u2.display_name
        FROM purchase_orders po
        LEFT JOIN users u2 ON u2.id = po.created_by
        ${cw('po')} ${bf('po')}
        UNION ALL
        SELECT 'goods_receipt', grn.grn_number, grn.status, NULL, grn.created_at, u3.display_name
        FROM goods_receipt_notes grn
        LEFT JOIN users u3 ON u3.id = grn.received_by
        WHERE 1=1 ${cf('grn')} ${bf('grn')}
        UNION ALL
        SELECT 'supplier', s.name, CASE WHEN s.on_hold = true THEN 'on_hold' ELSE 'active' END, NULL, s.created_at, NULL
        FROM suppliers s WHERE 1=1 ${cf('s')}
      ) combined
      ORDER BY ts DESC
      LIMIT 10
    `);

    const pendingApprovals = {
      requisitions: parseInt(prStats[0]?.pending_approval || 0, 10),
      purchaseOrders: parseInt(poStats[0]?.pending_approval || 0, 10),
      supplierBills: parseInt(billStats[0]?.pending_approval || 0, 10),
    };
    pendingApprovals.total = pendingApprovals.requisitions + pendingApprovals.purchaseOrders + pendingApprovals.supplierBills;

    res.json({
      pr: prStats[0] || {},
      po: poStats[0] || {},
      poByCurrency,
      grn: grnStats[0] || {},
      bills: billStats[0] || {},
      suppliers: supplierStats[0] || {},
      spend: { ...(spendStats[0] || {}), ...(paidStats[0] || {}) },
      spendByCurrency,
      pendingApprovals,
      recentPOs,
      overdue,
      topSuppliers,
      recentActivity
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});


// ═══════════════════════════════════════════════════
// PROCUREMENT SETTINGS
// ═══════════════════════════════════════════════════

router.get('/settings/:clinicId', authorize('procurement.read'), async (req, res) => {
  try {
    const [settings] = await sequelize.query(
      'SELECT * FROM procurement_settings WHERE clinic_id = :clinic_id',
      { replacements: { clinic_id: parseInt(req.params.clinicId) } }
    );

    if (settings.length === 0) {
      // Return defaults
      return res.json({
        clinic_id: parseInt(req.params.clinicId),
        pr_approval_threshold: 10000,
        po_approval_threshold_level1: 5000,
        po_approval_threshold_level2: 25000,
        po_approval_threshold_level3: 100000,
        require_grn_before_invoice: true,
        require_3way_matching: true,
        allow_over_receipt_percentage: 5,
        allow_price_variance_percentage: 2,
        require_quotes_for_amount_above: 50000,
        min_suppliers_for_quotes: 3,
        enforce_budget_before_po: true,
        default_lead_days: 7,
        default_payment_terms: 'Net30'
      });
    }

    res.json(settings[0]);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/settings/:clinicId', authorize('procurement.settings.manage'), async (req, res) => {
  try {
    const clinicId = parseInt(req.params.clinicId);
    const [existing] = await sequelize.query(
      'SELECT * FROM procurement_settings WHERE clinic_id = :clinic_id',
      { replacements: { clinic_id: clinicId } }
    );

    const fields = req.body;
    if (existing.length === 0) {
      // Insert
      const id = uuidv4();
      await sequelize.query(`
        INSERT INTO procurement_settings (id, clinic_id, pr_approval_threshold,
          po_approval_threshold_level1, po_approval_threshold_level2, po_approval_threshold_level3,
          require_grn_before_invoice, require_3way_matching, allow_over_receipt_percentage,
          allow_price_variance_percentage, require_quotes_for_amount_above, min_suppliers_for_quotes,
          enforce_budget_before_po, default_lead_days, default_payment_terms, updated_at)
        VALUES (:id, :clinic_id, :pr_approval_threshold, :l1, :l2, :l3,
          :require_grn, :require_3way, :over_receipt, :price_var, :quotes_above, :min_suppliers,
          :enforce_budget, :lead_days, :payment_terms, NOW())
      `, {
        replacements: {
          id, clinic_id: clinicId,
          pr_approval_threshold: fields.pr_approval_threshold || 10000,
          l1: fields.po_approval_threshold_level1 || 5000,
          l2: fields.po_approval_threshold_level2 || 25000,
          l3: fields.po_approval_threshold_level3 || 100000,
          require_grn: fields.require_grn_before_invoice !== false ? 1 : 0,
          require_3way: fields.require_3way_matching !== false ? 1 : 0,
          over_receipt: fields.allow_over_receipt_percentage || 5,
          price_var: fields.allow_price_variance_percentage || 2,
          quotes_above: fields.require_quotes_for_amount_above || 50000,
          min_suppliers: fields.min_suppliers_for_quotes || 3,
          enforce_budget: fields.enforce_budget_before_po !== false ? 1 : 0,
          lead_days: fields.default_lead_days || 7,
          payment_terms: fields.default_payment_terms || 'Net30'
        }
      });
    } else {
      // Update
      const updateFields = [];
      const replacements = { clinic_id: clinicId };
      const allowedFields = ['pr_approval_threshold', 'po_approval_threshold_level1',
        'po_approval_threshold_level2', 'po_approval_threshold_level3',
        'require_grn_before_invoice', 'require_3way_matching',
        'allow_over_receipt_percentage', 'allow_price_variance_percentage',
        'require_quotes_for_amount_above', 'min_suppliers_for_quotes',
        'enforce_budget_before_po', 'default_lead_days', 'default_payment_terms'];

      for (const f of allowedFields) {
        if (fields[f] !== undefined) {
          updateFields.push(`${f} = :${f}`);
          replacements[f] = fields[f];
        }
      }

      if (updateFields.length > 0) {
        await sequelize.query(
          `UPDATE procurement_settings SET ${updateFields.join(', ')}, updated_at = NOW() WHERE clinic_id = :clinic_id`,
          { replacements }
        );
      }
    }

    const [updated] = await sequelize.query(
      'SELECT * FROM procurement_settings WHERE clinic_id = :clinic_id',
      { replacements: { clinic_id: clinicId } }
    );
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});


// ═══════════════════════════════════════════════════
// PROCUREMENT REPORTS
// ═══════════════════════════════════════════════════

// Purchase summary report
router.get('/reports/purchase-summary', authorize('procurement.read'), async (req, res) => {
  try {
    const { start_date, end_date, supplier_id, currency } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    // Build a shared WHERE clause (all queries use the `po` alias, so no
    // fragile string-replacement is needed like the previous version had).
    const conditions = [`po.status != 'cancelled'`, 'po.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (start_date && end_date) {
      // order_date is a DATETIME column. Comparing it with BETWEEN against
      // date-only strings (e.g. '2026-07-13') excludes any order placed
      // after midnight on the end date. Use a half-open range instead.
      conditions.push("po.order_date >= :start_date AND po.order_date < ((:end_date)::date + INTERVAL '1 day')");
      replacements.start_date = start_date;
      replacements.end_date = end_date;
    }
    if (supplier_id && supplier_id !== 'all' && supplier_id !== 'undefined' && supplier_id !== 'null') {
      conditions.push('po.supplier_id = :supplier_id');
      replacements.supplier_id = parseInt(supplier_id);
    }
    if (currency && currency !== 'all' && currency !== 'undefined' && currency !== 'null') {
      conditions.push('po.po_currency = :currency');
      replacements.currency = currency;
    }
    const whereClause = (conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '') + branchScope(req, replacements, 'po');

    // POs are raised in different currencies (mostly SSP and USD in this system) — summing
    // po.total_amount across currencies without converting would silently blend, e.g., a
    // 200,130 USD order into the same total as a 4,360 SSP order. Every breakdown below
    // groups by po_currency too instead of pretending it's all one currency; a dedicated
    // byCurrency summary (below) gives the clean "Total Spend: SSP X / USD Y" headline
    // figures rather than one misleading combined number.
    const [byCurrency] = await sequelize.query(`
      SELECT po.po_currency as currency, COUNT(*) as order_count, COALESCE(SUM(po.total_amount), 0) as total_amount
      FROM purchase_orders po
      ${whereClause}
      GROUP BY po.po_currency
      ORDER BY total_amount DESC
    `, { replacements });

    const [bySupplier] = await sequelize.query(`
      SELECT s.name as supplier_name, s.supplier_code, po.po_currency as currency,
        COUNT(po.id) as order_count,
        COALESCE(SUM(po.total_amount), 0) as total_amount,
        AVG(po.total_amount) as avg_order_value
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      ${whereClause}
      GROUP BY s.id, s.name, s.supplier_code, po.po_currency
      ORDER BY total_amount DESC
    `, { replacements });

    const [byStatus] = await sequelize.query(`
      SELECT po.status as status, po.po_currency as currency, COUNT(*) as count, COALESCE(SUM(po.total_amount), 0) as total_amount
      FROM purchase_orders po
      ${whereClause}
      GROUP BY po.status, po.po_currency
    `, { replacements });

    const [monthlyTrend] = await sequelize.query(`
      SELECT to_char(po.order_date, 'YYYY-MM') as month, po.po_currency as currency,
        COUNT(*) as order_count,
        COALESCE(SUM(po.total_amount), 0) as total_amount
      FROM purchase_orders po
      ${whereClause}
      GROUP BY to_char(po.order_date, 'YYYY-MM'), po.po_currency
      ORDER BY month DESC LIMIT 24
    `, { replacements });

    res.json({ byCurrency, bySupplier, byStatus, monthlyTrend });
  } catch (error) {
    console.error('Error fetching purchase summary:', error);
    res.status(500).json({ error: 'Failed to fetch purchase summary' });
  }
});

// Delivery performance report
router.get('/reports/delivery-performance', authorize('procurement.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    // Cancelled orders were never fulfilled, so they shouldn't count toward
    // a supplier's delivery scorecard (kept consistent with purchase-summary,
    // which already excludes cancelled orders from its totals).
    const conditions = ["po.requested_delivery_date IS NOT NULL AND po.status != 'cancelled'", 'po.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };
    const deliveryBranchScope = branchScope(req, replacements, 'po');

    const [results] = await sequelize.query(`
      SELECT s.name as supplier_name,
        COUNT(po.id) as total_orders,
        SUM(CASE WHEN po.delivery_date_actual IS NOT NULL AND po.delivery_date_actual <= po.requested_delivery_date THEN 1 ELSE 0 END) as on_time,
        SUM(CASE WHEN po.delivery_date_actual IS NOT NULL AND po.delivery_date_actual > po.requested_delivery_date THEN 1 ELSE 0 END) as late,
        SUM(CASE WHEN po.delivery_date_actual IS NULL AND po.status NOT IN ('received','cancelled') THEN 1 ELSE 0 END) as pending,
        AVG(((po.delivery_date_actual)::date - (po.order_date)::date)) as avg_delivery_days
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE ${conditions.join(' AND ')} ${deliveryBranchScope}
      GROUP BY s.id, s.name
      ORDER BY total_orders DESC
    `, { replacements });
    res.json(results);
  } catch (error) {
    console.error('Error fetching delivery performance:', error);
    res.status(500).json({ error: 'Failed to fetch delivery performance' });
  }
});

// Purchase Order report — every PO in the filtered range with full status visibility.
router.get('/reports/purchase-orders', authorize('procurement.read'), async (req, res) => {
  try {
    const { start_date, end_date, currency, user_id, supplier_id } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    const conditions = ['po.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (start_date && end_date) {
      // order_date is a DATETIME column — half-open range (same convention as
      // purchase-summary above) avoids excluding orders placed after midnight
      // on the end date.
      conditions.push("po.order_date >= :start_date AND po.order_date < ((:end_date)::date + INTERVAL '1 day')");
      replacements.start_date = start_date;
      replacements.end_date = end_date;
    }
    if (currency && currency !== 'all' && currency !== 'undefined' && currency !== 'null') {
      conditions.push('po.po_currency = :currency');
      replacements.currency = currency;
    }
    if (user_id && user_id !== 'all' && user_id !== 'undefined' && user_id !== 'null') {
      conditions.push('po.created_by = :user_id');
      replacements.user_id = parseInt(user_id, 10);
    }
    if (supplier_id && supplier_id !== 'all' && supplier_id !== 'undefined' && supplier_id !== 'null') {
      conditions.push('po.supplier_id = :supplier_id');
      replacements.supplier_id = parseInt(supplier_id);
    }

    const whereClause = (conditions.length ? `WHERE ${conditions.join(' AND ')}` : '') + branchScope(req, replacements, 'po');

    const [results] = await sequelize.query(`
      SELECT po.id, po.po_number, po.order_date, po.status, po.po_currency, po.total_amount,
        po.created_by,
        s.name as supplier_name, s.supplier_code,
        u.display_name as created_by_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN users u ON po.created_by = u.id
      ${whereClause}
      ORDER BY po.order_date DESC
    `, { replacements });

    // Full line-item detail per PO — the report used to collapse every item into a single
    // total row; fetch items for all POs in range in one query and group them under their
    // parent PO instead of aggregating (item quantities/unit prices/line totals are always
    // implicitly in the parent PO's own po_currency — items have no currency of their own).
    const poIds = results.map((r) => r.id);
    let itemsByPoId = {};
    if (poIds.length > 0) {
      // line_number is only added by a separate, not-always-run enhancement script (see
      // migrateProcurementTables.js) — don't depend on it existing, order by id instead.
      const [items] = await sequelize.query(`
        SELECT id, purchase_order_id, item_name, description, quantity, unit_price, total_price, unit_of_measure
        FROM purchase_order_items
        WHERE purchase_order_id IN (:poIds)
        ORDER BY purchase_order_id, id
      `, { replacements: { poIds } });
      itemsByPoId = items.reduce((acc, item) => {
        (acc[item.purchase_order_id] = acc[item.purchase_order_id] || []).push(item);
        return acc;
      }, {});
    }

    const resultsWithItems = results.map((r) => ({ ...r, items: itemsByPoId[r.id] || [] }));

    res.json(resultsWithItems);
  } catch (error) {
    console.error('Error fetching purchase orders report:', error);
    res.status(500).json({ error: 'Failed to fetch purchase orders report' });
  }
});

// Purchase Requisition report — every PR in the filtered range with full status visibility.
router.get('/reports/purchase-requisitions', authorize('procurement.read'), async (req, res) => {
  try {
    const { start_date, end_date, currency, user_id } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    const conditions = ['pr.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (start_date && end_date) {
      // requisition_date is a DATE column, but we keep the same half-open
      // convention used everywhere else in these reports for consistency.
      conditions.push("pr.requisition_date >= :start_date AND pr.requisition_date < ((:end_date)::date + INTERVAL '1 day')");
      replacements.start_date = start_date;
      replacements.end_date = end_date;
    }
    if (currency && currency !== 'all' && currency !== 'undefined' && currency !== 'null') {
      conditions.push('pr.currency = :currency');
      replacements.currency = currency;
    }
    if (user_id && user_id !== 'all' && user_id !== 'undefined' && user_id !== 'null') {
      // "By user" means the requester (created_by) for a requisition report —
      // approved_by is still returned in the row so both are visible.
      conditions.push('pr.created_by = :user_id');
      replacements.user_id = parseInt(user_id, 10);
    }

    const whereClause = (conditions.length ? `WHERE ${conditions.join(' AND ')}` : '') + branchScope(req, replacements, 'pr');

    const [results] = await sequelize.query(`
      SELECT pr.id, pr.pr_number, pr.requisition_date, pr.department, pr.status,
        pr.currency, pr.total_amount, pr.created_by, pr.approved_by,
        creator.display_name as created_by_name,
        approver.display_name as approved_by_name
      FROM purchase_requisitions pr
      LEFT JOIN users creator ON pr.created_by = creator.id
      LEFT JOIN users approver ON pr.approved_by = approver.id
      ${whereClause}
      ORDER BY pr.requisition_date DESC
    `, { replacements });

    res.json(results);
  } catch (error) {
    console.error('Error fetching purchase requisitions report:', error);
    res.status(500).json({ error: 'Failed to fetch purchase requisitions report' });
  }
});

// Goods Receipt report — every GRN in the filtered range with full status visibility.
router.get('/reports/goods-receipts', authorize('procurement.read'), async (req, res) => {
  try {
    const { start_date, end_date, currency, user_id, supplier_id } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    const conditions = ['grn.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };

    if (start_date && end_date) {
      conditions.push("grn.receipt_date >= :start_date AND grn.receipt_date < ((:end_date)::date + INTERVAL '1 day')");
      replacements.start_date = start_date;
      replacements.end_date = end_date;
    }
    if (currency && currency !== 'all' && currency !== 'undefined' && currency !== 'null') {
      // goods_receipt_notes has no currency column of its own — it inherits
      // its currency from the linked purchase order's po_currency.
      conditions.push('po.po_currency = :currency');
      replacements.currency = currency;
    }
    if (user_id && user_id !== 'all' && user_id !== 'undefined' && user_id !== 'null') {
      conditions.push('grn.received_by = :user_id');
      replacements.user_id = parseInt(user_id, 10);
    }
    if (supplier_id && supplier_id !== 'all' && supplier_id !== 'undefined' && supplier_id !== 'null') {
      conditions.push('grn.supplier_id = :supplier_id');
      replacements.supplier_id = parseInt(supplier_id);
    }

    const whereClause = (conditions.length ? `WHERE ${conditions.join(' AND ')}` : '') + branchScope(req, replacements, 'grn');

    const [results] = await sequelize.query(`
      SELECT grn.id, grn.grn_number, grn.receipt_date, grn.status, grn.total_items_received,
        grn.received_by, grn.inspected_by,
        po.po_number, po.po_currency,
        s.name as supplier_name,
        receiver.display_name as received_by_name,
        inspector.display_name as inspected_by_name
      FROM goods_receipt_notes grn
      LEFT JOIN purchase_orders po ON grn.po_id = po.id
      LEFT JOIN suppliers s ON grn.supplier_id = s.id
      LEFT JOIN users receiver ON grn.received_by = receiver.id
      LEFT JOIN users inspector ON grn.inspected_by = inspector.id
      ${whereClause}
      ORDER BY grn.receipt_date DESC
    `, { replacements });

    res.json(results);
  } catch (error) {
    console.error('Error fetching goods receipts report:', error);
    res.status(500).json({ error: 'Failed to fetch goods receipts report' });
  }
});

// ═══════════════════════════════════════════════════
// Attachments (PO quotations, GRN invoices) — optional, multi-file, persist
// permanently with the record, viewable by anyone with 'procurement.read'
// (i.e. the same audience that can see the PO/GRN itself during approval).
// ═══════════════════════════════════════════════════

router.post('/attachments/:entityType/:entityId', authorize('procurement.write'), (req, res, next) => {
  attachmentUpload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const entityDef = ATTACHMENT_ENTITY_TABLES[entityType];
    if (!entityDef) return res.status(400).json({ error: `Unknown attachment entity type: ${entityType}` });
    // PO attachment uploads follow the same gate as PO creation/modification itself
    // (kept as a literal array here, not authorize(), since it's a mid-handler check,
    // not a route-entry gate); GRN attachments follow the broader 'procurement.write'
    // gate already applied above.
    if (entityType === 'purchase-order' && !PO_WRITE.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', required: PO_WRITE, current: req.user.role });
    }

    // entityDef.table is always purchase_orders or goods_receipt_notes (see
    // ATTACHMENT_ENTITY_TABLES above) — both carry branch_id, so gate the upload the
    // same way every other by-ID route on those tables does.
    const [entityRows] = await sequelize.query(
      `SELECT id, branch_id FROM ${entityDef.table} WHERE id = :id`, { replacements: { id: entityId } }
    );
    if (entityRows.length === 0) return res.status(404).json({ error: `${entityType} not found` });
    if (!assertBranchAccess(entityRows[0], req, res, entityType)) return;

    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No files provided' });

    const created = [];
    for (const file of files) {
      const id = uuidv4();
      await sequelize.query(`
        INSERT INTO procurement_attachments
          (id, entity_type, entity_id, original_filename, stored_filename, mime_type, file_size, uploaded_by, clinic_id, created_at)
        VALUES (:id, :entity_type, :entity_id, :original_filename, :stored_filename, :mime_type, :file_size, :uploaded_by, :clinic_id, NOW())
      `, {
        replacements: {
          id, entity_type: entityType, entity_id: String(entityId),
          original_filename: file.originalname, stored_filename: file.filename,
          mime_type: file.mimetype, file_size: file.size,
          uploaded_by: req.user?.uid || null, clinic_id: req.user?.clinic || null,
        },
      });
      created.push({
        id, entity_type: entityType, entity_id: String(entityId),
        original_filename: file.originalname, mime_type: file.mimetype, file_size: file.size,
        created_at: new Date().toISOString(),
      });
    }

    res.status(201).json(created);
  } catch (error) {
    console.error('Error uploading procurement attachment:', error);
    res.status(500).json({ error: 'Failed to upload attachment' });
  }
});

// Registered before the /:entityType/:entityId list route below — both are shaped
// /attachments/X/Y, and Express matches whichever route was registered first, so this
// literal-suffix ".../file" route must come first or it gets swallowed by the list route
// (entityType=<attachment id>, entityId="file").
router.get('/attachments/:id/file', authorize('procurement.read'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [rows] = await sequelize.query(
      `SELECT * FROM procurement_attachments WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id: req.params.id, clinicId } }
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Attachment not found' });
    const attachment = rows[0];
    const filePath = path.join(ATTACHMENTS_DIR, attachment.stored_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Attachment file missing on disk' });

    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.original_filename)}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving procurement attachment:', error);
    res.status(500).json({ error: 'Failed to load attachment' });
  }
});

router.get('/attachments/:entityType/:entityId', authorize('procurement.read'), async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    if (!ATTACHMENT_ENTITY_TABLES[entityType]) return res.status(400).json({ error: `Unknown attachment entity type: ${entityType}` });
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    const [rows] = await sequelize.query(`
      SELECT a.id, a.entity_type, a.entity_id, a.original_filename, a.mime_type, a.file_size, a.created_at,
        u.display_name as uploaded_by_name
      FROM procurement_attachments a
      LEFT JOIN users u ON a.uploaded_by = u.id
      WHERE a.entity_type = :entity_type AND a.entity_id = :entity_id AND a.clinic_id = :clinicId
      ORDER BY a.created_at ASC
    `, { replacements: { entity_type: entityType, entity_id: String(entityId), clinicId } });

    res.json(rows);
  } catch (error) {
    console.error('Error fetching procurement attachments:', error);
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

module.exports = router;
