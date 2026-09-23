const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /proforma-invoices, so the API enforces what the client already assumes.
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const AccountingService = require('../services/AccountingService');

function getClinicId(req) {
  return parseInt(req.query.clinic_id || req.body.clinic_id) || req.user?.clinicId || 1;
}

// Ensure the table exists — mirrors the pattern used across the rest of the
// server (checked once per process, not per request).
let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS proforma_invoices (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      proforma_number VARCHAR(50) UNIQUE NOT NULL,
      patient_id VARCHAR(255) NOT NULL,
      patient_name VARCHAR(255) NOT NULL,
      items JSON NOT NULL,
      subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'SSP',
      notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      converted_bill_id CHAR(36),
      created_by CHAR(36),
      created_by_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const [[idxCheck]] = await sequelize.query(`
    SELECT COUNT(*) AS cnt FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = 'proforma_invoices' AND indexname = 'idx_proforma_patient'
  `);
  if (!idxCheck.cnt) {
    await sequelize.query(`CREATE INDEX idx_proforma_patient ON proforma_invoices(patient_id)`);
  }
  ensured = true;
}

router.use(async (req, res, next) => {
  try { await ensureTable(); next(); }
  catch (e) { console.error('proforma_invoices ensureTable failed:', e); res.status(500).json({ error: 'Database error' }); }
});

// List proforma invoices — optionally filtered by patient or free-text search.
router.get('/', async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const { patient_id, search } = req.query;
    const conditions = ['clinic_id = :clinicId'];
    const replacements = { clinicId };
    if (patient_id) { conditions.push('patient_id = :patient_id'); replacements.patient_id = patient_id; }
    if (search) {
      conditions.push('(patient_name LIKE :search OR proforma_number LIKE :search)');
      replacements.search = `%${search}%`;
    }
    if (req.user?.role !== 'admin') {
      const branchId = req.branchContext?.branchId || req.user?.branchId;
      if (branchId) { conditions.push('branch_id = :branchId'); replacements.branchId = branchId; }
    }
    const [rows] = await sequelize.query(
      `SELECT * FROM proforma_invoices WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
      { replacements }
    );
    res.json(rows.map(r => ({ ...r, items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items })));
  } catch (error) {
    console.error('Error listing proforma invoices:', error);
    res.status(500).json({ error: 'Failed to fetch proforma invoices' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[row]] = await sequelize.query(`SELECT * FROM proforma_invoices WHERE id = :id`, { replacements: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Proforma invoice not found' });
    if (!BranchQueryFilter.canAccessRecord(row, req.branchContext)) return res.status(404).json({ error: 'Proforma invoice not found' });
    res.json({ ...row, items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch proforma invoice' });
  }
});

router.post('/', authorize('proforma.write'), async (req, res) => {
  try {
    const { patient_id, patient_name, items, notes, currency } = req.body;
    if (!patient_id) return res.status(400).json({ error: 'Patient is required' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Add at least one service or product' });

    const clinicId = getClinicId(req);
    const branchId = req.branchContext?.branchId || req.user?.branchId || null;
    const subtotal = items.reduce((sum, l) => sum + (parseFloat(l.totalPrice) || 0), 0);
    const id = uuidv4();
    const proformaNumber = `PF-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

    await sequelize.query(`
      INSERT INTO proforma_invoices
        (id, clinic_id, branch_id, proforma_number, patient_id, patient_name, items, subtotal, currency, notes, status, created_by, created_by_name)
      VALUES
        (:id, :clinicId, :branchId, :proformaNumber, :patient_id, :patient_name, :items, :subtotal, :currency, :notes, 'draft', :created_by, :created_by_name)
    `, {
      replacements: {
        id, clinicId, branchId, proformaNumber, patient_id, patient_name: patient_name || '',
        items: JSON.stringify(items), subtotal, currency: currency || 'SSP', notes: notes || null,
        created_by: req.user?.id || null, created_by_name: req.user?.displayName || req.user?.email || 'System',
      },
    });

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName, user_role: req.user?.role,
        module: 'Billing', action: 'PROFORMA_CREATED', entity_type: 'ProformaInvoice', entity_id: id,
        description: `Proforma ${proformaNumber} created for ${patient_name} — ${items.length} item(s), ${subtotal}`,
      });
    } catch (e) {}

    const [[created]] = await sequelize.query(`SELECT * FROM proforma_invoices WHERE id = :id`, { replacements: { id } });
    res.status(201).json({ ...created, items: typeof created.items === 'string' ? JSON.parse(created.items) : created.items });
  } catch (error) {
    console.error('Error creating proforma invoice:', error);
    res.status(500).json({ error: 'Failed to create proforma invoice' });
  }
});

router.delete('/:id', authorize('proforma.write'), async (req, res) => {
  try {
    const [[row]] = await sequelize.query(`SELECT status, branch_id FROM proforma_invoices WHERE id = :id`, { replacements: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Proforma invoice not found' });
    if (!BranchQueryFilter.canAccessRecord(row, req.branchContext)) return res.status(404).json({ error: 'Proforma invoice not found' });
    if (row.status === 'converted') return res.status(400).json({ error: 'Cannot delete a proforma that has already been converted to a bill' });
    await sequelize.query(`DELETE FROM proforma_invoices WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json({ message: 'Proforma invoice deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete proforma invoice' });
  }
});

// Convert a draft proforma into a real patient bill — adds to the patient's
// active bill if one exists, otherwise creates a new one. Same create-or-add
// pattern used by the LIS order billing flow, so a patient never ends up
// with two open bills just because one line came from a converted proforma.
router.post('/:id/convert', authorize('proforma.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [[proforma]] = await sequelize.query(`SELECT * FROM proforma_invoices WHERE id = :id`, { replacements: { id: req.params.id }, transaction: t });
    if (!proforma) { await t.rollback(); return res.status(404).json({ error: 'Proforma invoice not found' }); }
    if (!BranchQueryFilter.canAccessRecord(proforma, req.branchContext)) { await t.rollback(); return res.status(404).json({ error: 'Proforma invoice not found' }); }
    if (proforma.status === 'converted') { await t.rollback(); return res.status(400).json({ error: 'This proforma has already been converted to a bill' }); }

    const items = typeof proforma.items === 'string' ? JSON.parse(proforma.items) : proforma.items;
    const clinicId = proforma.clinic_id;
    const proformaCurrency = proforma.currency || 'SSP';

    // Converts the proforma's items/subtotal from proformaCurrency into targetCurrency
    // using the rate configured under Accounting → Exchange Rates. A proforma is always
    // quoted in a single currency, so one rate covers the whole thing. When both
    // currencies already match, this is a no-op — no rate lookup, no rounding drift.
    // Throws (isExchangeRateError) rather than silently billing the raw foreign-currency
    // number as if it were the target currency, matching computeBaseCurrencyTotal's
    // convention in patientBills.js.
    async function convertToCurrency(targetCurrency) {
      const subtotal = parseFloat(proforma.subtotal) || 0;
      if (proformaCurrency === targetCurrency) {
        return { items, subtotal };
      }
      let rate;
      try {
        rate = await AccountingService.getExchangeRate(clinicId, proformaCurrency, targetCurrency, proforma.created_at || new Date());
      } catch (e) {
        const err = new Error(`No exchange rate configured for ${proformaCurrency} → ${targetCurrency} — add one under Accounting → Exchange Rates first.`);
        err.isExchangeRateError = true;
        throw err;
      }
      const convertedItems = items.map((it) => {
        const unitPrice = parseFloat(it.unitPrice ?? it.unit_price ?? it.price ?? 0) || 0;
        const qty = parseFloat(it.quantity ?? 1) || 1;
        const totalPrice = parseFloat(it.totalPrice ?? it.total_price ?? (unitPrice * qty)) || 0;
        const convertedUnit = AccountingService.convertAmount(unitPrice, rate);
        const convertedTotal = AccountingService.convertAmount(totalPrice, rate);
        return {
          ...it,
          unitPrice: convertedUnit,
          unit_price: convertedUnit,
          totalPrice: convertedTotal,
          total_price: convertedTotal,
          currency: targetCurrency,
          original_currency: proformaCurrency,
          original_unit_price: unitPrice,
          original_total_price: totalPrice,
        };
      });
      return { items: convertedItems, subtotal: AccountingService.convertAmount(subtotal, rate) };
    }

    // Only fold into an existing bill from the SAME branch as the proforma —
    // otherwise a proforma converted at Branch B could silently merge its
    // items into a still-open bill left over from Branch A, moving money
    // across the branch boundary this whole file otherwise enforces.
    const billBranchClause = proforma.branch_id ? ' AND branch_id = :branchId' : '';
    const [[existingBill]] = await sequelize.query(`
      SELECT * FROM patient_bills WHERE patient_id = :patient_id AND clinic_id = :clinicId
        AND status IN ('pending', 'partial')${billBranchClause} ORDER BY created_at DESC LIMIT 1
    `, {
      replacements: {
        patient_id: proforma.patient_id, clinicId,
        ...(proforma.branch_id ? { branchId: proforma.branch_id } : {}),
      },
      transaction: t,
    });

    let billId;
    if (existingBill) {
      // Fold into the existing bill's own currency, not the proforma's — that bill may
      // already be a scheme bill (its own currency) or a prior cash bill in the base
      // currency; converting the incoming items to match keeps every line on that bill
      // in one consistent currency instead of re-introducing the mix this fix removes.
      const targetCurrency = existingBill.bill_currency || 'SSP';
      const { items: convertedItems, subtotal: convertedSubtotal } = await convertToCurrency(targetCurrency);
      const existingServices = typeof existingBill.services === 'string' ? JSON.parse(existingBill.services) : (existingBill.services || []);
      const combinedServices = [...existingServices, ...convertedItems];
      const newTotal = parseFloat(existingBill.total_amount) + convertedSubtotal;
      const newBalance = parseFloat(existingBill.balance_amount) + convertedSubtotal;
      await sequelize.query(`
        UPDATE patient_bills SET services = :services, total_amount = :total, balance_amount = :balance, updated_at = NOW()
        WHERE id = :id
      `, { replacements: { services: JSON.stringify(combinedServices), total: newTotal, balance: newBalance, id: existingBill.id }, transaction: t });
      billId = existingBill.id;
    } else {
      // No open bill to fold into — the new bill is billed in the clinic's configured
      // base currency (mirrors computeBaseCurrencyTotal in patientBills.js), converting
      // the proforma's amounts into it via the configured exchange rate when needed.
      const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`, { transaction: t });
      const baseCurrency = baseCurrencyRow?.code || 'SSP';
      const { items: convertedItems, subtotal: convertedSubtotal } = await convertToCurrency(baseCurrency);

      billId = uuidv4();
      const billNumber = `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
      await sequelize.query(`
        INSERT INTO patient_bills
          (id, bill_number, patient_id, patient_name, clinic_id, branch_id, total_amount, paid_amount, balance_amount, bill_currency, status, bill_date, services, notes, created_by, created_at, updated_at)
        VALUES
          (:id, :billNumber, :patient_id, :patient_name, :clinicId, :branchId, :total, 0, :total, :billCurrency, 'pending', NOW(), :services, :notes, :created_by, NOW(), NOW())
      `, {
        replacements: {
          id: billId, billNumber, patient_id: proforma.patient_id, patient_name: proforma.patient_name, clinicId,
          branchId: proforma.branch_id || null,
          total: convertedSubtotal, billCurrency: baseCurrency, services: JSON.stringify(convertedItems),
          notes: `Converted from proforma invoice ${proforma.proforma_number}`,
          created_by: req.user?.displayName || req.user?.email || 'System',
        },
        transaction: t,
      });
    }

    await sequelize.query(`UPDATE proforma_invoices SET status = 'converted', converted_bill_id = :billId, updated_at = NOW() WHERE id = :id`,
      { replacements: { billId, id: proforma.id }, transaction: t });

    await t.commit();

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName, user_role: req.user?.role,
        module: 'Billing', action: 'PROFORMA_CONVERTED', entity_type: 'ProformaInvoice', entity_id: proforma.id,
        description: `Proforma ${proforma.proforma_number} converted to bill for ${proforma.patient_name}`,
        new_values: { bill_id: billId },
      });
    } catch (e) {}

    res.json({ message: 'Converted to bill', bill_id: billId });
  } catch (error) {
    await t.rollback();
    if (error.isExchangeRateError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error converting proforma invoice:', error);
    res.status(500).json({ error: 'Failed to convert proforma invoice to a bill' });
  }
});

module.exports = router;
