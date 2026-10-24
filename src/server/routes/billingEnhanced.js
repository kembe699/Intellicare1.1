const express = require('express');
const { getBaseCurrencyCode, BASE_CURRENCY_SQL } = require('../utils/baseCurrency');
const { isUniqueViolation, isDuplicateColumn } = require('../utils/dbErrors');
const { authorize } = require('../middleware/authorize');
const { reportSchemaGuardFailure } = require('../utils/legacyDDL');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /billing-management and /patients-bill, so the API enforces what the client already assumes.
const router = express.Router();
const { sequelize, PatientBill, Receipt, CashierShift } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { getCreateBranchId } = require('../middleware/branchFilter');

// Named-replacement raw-SQL branch filter for credit_notes (has branch_id, part of the
// branch-data-isolation initiative) — same convention as accounting.js's branchScope.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

// Ensure billing-related tables exist
(async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS insurance_claims (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        claim_number VARCHAR(100) UNIQUE NOT NULL,
        bill_id VARCHAR(36),
        patient_id VARCHAR(255),
        patient_name VARCHAR(255),
        insurance_provider VARCHAR(255),
        insurance_type VARCHAR(100),
        member_id VARCHAR(100),
        claim_amount DECIMAL(15,2) DEFAULT 0,
        claim_currency VARCHAR(10) DEFAULT 'USD',
        claim_date DATE,
        status VARCHAR(50) DEFAULT 'pending',
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(()=>{});
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS batch_insurance_claims (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        batch_number VARCHAR(100) UNIQUE NOT NULL,
        scheme_id VARCHAR(36),
        scheme_name VARCHAR(255),
        scheme_code VARCHAR(50),
        claim_amount DECIMAL(15,2) DEFAULT 0,
        invoice_count INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(()=>{});
    // `ADD COLUMN IF NOT EXISTS` is Postgres-only syntax and throws a MySQL 1064 syntax
    // error — silently swallowed by the .catch(()=>{}) below, so none of these 4 columns
    // were ever actually added. Use the standard MySQL-safe idempotent pattern instead.
    for (const [col, def] of [
      ['batch_id', 'VARCHAR(36)'],
      ['rejection_reason', 'TEXT'],
      ['paid_amount', 'DECIMAL(15,2) DEFAULT 0'],
      ['payment_date', 'DATE'],
    ]) {
      try {
        await sequelize.query(`ALTER TABLE insurance_claims ADD COLUMN ${col} ${def}`);
      } catch (e) {
        if (!isDuplicateColumn(e)) console.warn(`Could not add insurance_claims.${col}:`, e.message);
      }
    }

    // The Billing Management "Write-off" button called a route that never existed on the
    // backend — always 404'd. Give it a real audit-trail table and a terminal bill status.
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS bill_write_offs (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        bill_id VARCHAR(36) NOT NULL,
        write_off_number VARCHAR(50) UNIQUE NOT NULL,
        write_off_amount DECIMAL(15,2) NOT NULL,
        reason TEXT,
        write_off_gl_entry_id VARCHAR(36),
        created_by VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(()=>{});
    try {
      await sequelize.query(`
        ALTER TABLE patient_bills MODIFY COLUMN status
        ENUM('pending','partial','paid','overdue','active','written_off') DEFAULT 'pending'
      `);
    } catch (e) { reportSchemaGuardFailure('patient_bills.status enum', e); }

    // Billing settings
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS billing_settings (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        default_currency VARCHAR(10) DEFAULT 'SSP',
        default_payment_terms VARCHAR(50) DEFAULT 'immediate',
        default_due_date_days INT DEFAULT 30,
        auto_bill_pharmacy_dispensing BOOLEAN DEFAULT true,
        auto_bill_lab_tests BOOLEAN DEFAULT true,
        auto_bill_imaging BOOLEAN DEFAULT true,
        auto_bill_procedures BOOLEAN DEFAULT true,
        auto_bill_bed_charges BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY clinic_settings_idx (clinic_id)
      )
    `).catch(()=>{});
  } catch(e) { console.warn('billingEnhanced table init warning:', e.message); }
})();

// ============ BILL LINE ITEMS ============

// Get all line items for a bill
router.get('/bills/:billId/line-items', async (req, res) => {
  try {
    const { billId } = req.params;
    const [items] = await sequelize.query(`
      SELECT bli.*, s.service_name AS catalog_service_name, s.service_category AS catalog_category
      FROM bill_line_items bli
      LEFT JOIN services s ON bli.service_code = s.service_code
      WHERE bli.bill_id = :billId
      ORDER BY bli.line_number ASC, bli.created_at ASC
    `, { replacements: { billId } });
    res.json(items);
  } catch (error) {
    console.error('Error fetching bill line items:', error);
    res.status(500).json({ error: 'Failed to fetch bill line items' });
  }
});

// Add line item to a bill
router.post('/bills/:billId/line-items', authorize('billing.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { billId } = req.params;
    const item = req.body;

    // Get current max line number
    const [maxLine] = await sequelize.query(
      'SELECT COALESCE(MAX(line_number), 0) AS max_ln FROM bill_line_items WHERE bill_id = :billId',
      { replacements: { billId }, transaction: t }
    );
    const lineNumber = (maxLine[0]?.max_ln || 0) + 1;

    const lineTotal = (item.quantity || 1) * (item.unit_price || 0);
    const exchangeRate = item.exchange_rate || 1;
    const baseCurrencyTotal = Math.round(lineTotal * exchangeRate * 100) / 100;
    const itemDiscount = item.item_discount || 0;
    const insuranceCoverage = item.insurance_coverage || 0;
    const balanceAmount = lineTotal - itemDiscount - insuranceCoverage;
    const patientCopay = item.patient_copay || balanceAmount;

    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO bill_line_items (
        id, bill_id, line_number, service_category, service_code, service_name,
        source_module, source_id, quantity, unit_price, line_currency, exchange_rate,
        base_currency_unit_price, line_total, base_currency_total, paid_amount,
        balance_amount, item_status, patient_copay, insurance_coverage,
        item_discount, discount_percentage, revenue_account_id, gl_entry_id, notes
      ) VALUES (
        :id, :billId, :lineNumber, :category, :serviceCode, :serviceName,
        :sourceModule, :sourceId, :quantity, :unitPrice, :currency, :exchangeRate,
        :baseCurrencyUnitPrice, :lineTotal, :baseCurrencyTotal, 0,
        :balance, 'pending', :copay, :insuranceCoverage,
        :discount, :discountPct, :revenueAccountId, :glEntryId, :notes
      )
    `, {
      replacements: {
        id, billId, lineNumber,
        category: item.service_category || 'other',
        serviceCode: item.service_code || null,
        serviceName: item.service_name,
        sourceModule: item.source_module || null,
        sourceId: item.source_id || null,
        quantity: item.quantity || 1,
        unitPrice: item.unit_price || 0,
        currency: item.line_currency || (await getBaseCurrencyCode()),
        exchangeRate,
        baseCurrencyUnitPrice: Math.round((item.unit_price || 0) * exchangeRate * 100) / 100,
        lineTotal, baseCurrencyTotal,
        balance: balanceAmount,
        copay: patientCopay,
        insuranceCoverage,
        discount: itemDiscount,
        discountPct: item.discount_percentage || 0,
        revenueAccountId: item.revenue_account_id || null,
        glEntryId: item.gl_entry_id || null,
        notes: item.notes || null
      },
      transaction: t
    });

    // Recalculate bill totals
    await recalculateBillTotals(billId, t);

    await t.commit();

    const [created] = await sequelize.query(
      'SELECT * FROM bill_line_items WHERE id = :id', { replacements: { id } }
    );
    res.json(created[0]);
  } catch (error) {
    await t.rollback();
    console.error('Error adding bill line item:', error);
    res.status(500).json({ error: 'Failed to add line item' });
  }
});

// Update a line item
router.put('/bills/:billId/line-items/:lineId', authorize('billing.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { billId, lineId } = req.params;
    const updates = req.body;

    const [existing] = await sequelize.query(
      'SELECT * FROM bill_line_items WHERE id = :lineId AND bill_id = :billId',
      { replacements: { lineId, billId }, transaction: t }
    );
    if (existing.length === 0) {
      await t.rollback();
      return res.status(404).json({ error: 'Line item not found' });
    }

    const quantity = updates.quantity || existing[0].quantity;
    const unitPrice = updates.unit_price !== undefined ? updates.unit_price : existing[0].unit_price;
    const lineTotal = quantity * unitPrice;
    const discount = updates.item_discount !== undefined ? updates.item_discount : existing[0].item_discount;
    const insurance = updates.insurance_coverage !== undefined ? updates.insurance_coverage : existing[0].insurance_coverage;
    const balance = lineTotal - discount - insurance - (existing[0].paid_amount || 0);

    await sequelize.query(`
      UPDATE bill_line_items SET
        quantity = :quantity, unit_price = :unitPrice, line_total = :lineTotal,
        balance_amount = :balance, item_discount = :discount, insurance_coverage = :insurance,
        service_name = COALESCE(:serviceName, service_name),
        service_category = COALESCE(:category, service_category),
        notes = COALESCE(:notes, notes),
        updated_at = NOW()
      WHERE id = :lineId
    `, {
      replacements: {
        quantity, unitPrice, lineTotal, balance, discount, insurance,
        serviceName: updates.service_name || null,
        category: updates.service_category || null,
        notes: updates.notes || null,
        lineId
      },
      transaction: t
    });

    await recalculateBillTotals(billId, t);
    await t.commit();

    const [updated] = await sequelize.query(
      'SELECT * FROM bill_line_items WHERE id = :lineId', { replacements: { lineId } }
    );
    res.json(updated[0]);
  } catch (error) {
    await t.rollback();
    console.error('Error updating line item:', error);
    res.status(500).json({ error: 'Failed to update line item' });
  }
});

// Delete (cancel) a line item
router.delete('/bills/:billId/line-items/:lineId', authorize('billing.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { billId, lineId } = req.params;

    const [existing] = await sequelize.query(
      'SELECT * FROM bill_line_items WHERE id = :lineId AND bill_id = :billId',
      { replacements: { lineId, billId }, transaction: t }
    );
    if (existing.length === 0) {
      await t.rollback();
      return res.status(404).json({ error: 'Line item not found' });
    }
    if (existing[0].paid_amount > 0) {
      // Can't delete paid items, cancel them instead
      await sequelize.query(
        "UPDATE bill_line_items SET item_status = 'cancelled' WHERE id = :lineId",
        { replacements: { lineId }, transaction: t }
      );
    } else {
      await sequelize.query(
        'DELETE FROM bill_line_items WHERE id = :lineId',
        { replacements: { lineId }, transaction: t }
      );
    }

    await recalculateBillTotals(billId, t);
    await t.commit();
    res.json({ message: 'Line item removed' });
  } catch (error) {
    await t.rollback();
    console.error('Error deleting line item:', error);
    res.status(500).json({ error: 'Failed to delete line item' });
  }
});

// ============ DISCOUNTS ============

// Apply discount to a bill
router.post('/bills/:billId/discounts', authorize('billing.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { billId } = req.params;
    const { discount_type, discount_amount, discount_percentage, reason, approved_by } = req.body;

    const [bills] = await sequelize.query(
      'SELECT * FROM patient_bills WHERE id = :billId', { replacements: { billId }, transaction: t }
    );
    if (bills.length === 0) {
      await t.rollback();
      return res.status(404).json({ error: 'Bill not found' });
    }

    let calcAmount = discount_amount || 0;
    if (discount_type === 'percentage' && discount_percentage) {
      calcAmount = Math.round(parseFloat(bills[0].total_amount) * discount_percentage / 100 * 100) / 100;
    }

    const ts = Date.now().toString().slice(-8);
    const discountNumber = `DSC-${ts}`;
    const id = uuidv4();

    await sequelize.query(`
      INSERT INTO bill_discounts (id, clinic_id, bill_id, discount_number, discount_type,
        discount_amount, discount_percentage, reason, approved_by, approval_date, created_by)
      VALUES (:id, :clinicId, :billId, :dn, :dtype, :amount, :pct, :reason, :approvedBy, NOW(), :createdBy)
    `, {
      replacements: {
        id, clinicId: bills[0].clinic_id, billId, dn: discountNumber,
        dtype: discount_type || 'fixed_amount',
        amount: calcAmount, pct: discount_percentage || 0,
        reason: reason || '', approvedBy: approved_by || req.user?.id || null,
        createdBy: req.user?.id || null
      },
      transaction: t
    });

    // patient_bills has no discount_* columns of its own — the audit trail lives entirely
    // in bill_discounts (inserted above). Only balance_amount (and status, if now fully
    // paid) actually exist on patient_bills and need updating.
    const [totalDiscount] = await sequelize.query(
      'SELECT COALESCE(SUM(discount_amount), 0) AS total FROM bill_discounts WHERE bill_id = :billId',
      { replacements: { billId }, transaction: t }
    );
    const newDiscount = parseFloat(totalDiscount[0].total);
    const newBalance = Math.max(0, parseFloat(bills[0].total_amount) - parseFloat(bills[0].paid_amount) - newDiscount);

    await sequelize.query(`
      UPDATE patient_bills SET
        balance_amount = :balance,
        status = CASE WHEN :balance <= 0 THEN 'paid' WHEN paid_amount > 0 THEN 'partial' ELSE status END
      WHERE id = :billId
    `, {
      replacements: { balance: newBalance, billId },
      transaction: t
    });

    // Dr 5230 Patient Discounts & Allowances / Cr the bill's receivable — in the SAME
    // transaction as the bill change: a discount that can't be posted isn't applied.
    const AccountingService = require('../services/AccountingService');
    const ledgerFail = (msg) => Object.assign(new Error(`Discount not applied: ${msg} Nothing was changed.`), { statusCode: 422 });
    let discountAccount = await AccountingService.getAccountByCode(bills[0].clinic_id, '5230');
    if (!discountAccount) {
      const { ChartOfAccounts } = require('../models');
      discountAccount = await ChartOfAccounts.create({
        clinic_id: bills[0].clinic_id, account_code: '5230',
        account_name: 'Patient Discounts & Allowances', account_type: 'expense',
        balance_type: 'debit', is_active: true
      }, { transaction: t });
    }
    const receivablesAccount = await AccountingService.getReceivableAccount(bills[0].clinic_id, bills[0].scheme_id);
    if (!receivablesAccount) throw ledgerFail('the receivable account (1200/1210) is missing or inactive in the Chart of Accounts.');
    let discountGl;
    try {
      discountGl = await AccountingService.createGLEntry({
        clinic_id: bills[0].clinic_id,
        branch_id: bills[0].branch_id || null,
        transaction_date: new Date(),
        transaction_type: 'bill_discount',
        description: `Discount on Bill ${bills[0].bill_number} - ${reason || 'No reason'}`,
        reference_id: id,
        reference_module: 'billing_discount',
        transaction_currency: bills[0].bill_currency,
      }, [
        { account_id: discountAccount.id, debit_amount: calcAmount, credit_amount: 0, description: `Discount: ${reason || 'Applied'}` },
        { account_id: receivablesAccount.id, debit_amount: 0, credit_amount: calcAmount, description: `AR reduction: Discount on ${bills[0].bill_number}` }
      ], req.user?.id || 'system', t);
    } catch (glErr) {
      if (glErr.statusCode) throw glErr;
      throw ledgerFail(`posting to the ledger failed (${glErr.message}).`);
    }
    await sequelize.query('UPDATE bill_discounts SET discount_gl_entry_id = :glId WHERE id = :id',
      { replacements: { glId: discountGl.id, id }, transaction: t });

    await t.commit();
    res.json({ id, discount_number: discountNumber, discount_amount: calcAmount });
  } catch (error) {
    if (!t.finished) await t.rollback().catch(() => {});
    console.error('Error applying discount:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Failed to apply discount' });
  }
});

// ============ WRITE-OFFS ============

// Write off the remaining balance of a bill as bad debt
router.post('/bills/:billId/write-off', authorize('billing.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { billId } = req.params;
    const { reason } = req.body;

    const [bills] = await sequelize.query(
      'SELECT * FROM patient_bills WHERE id = :billId', { replacements: { billId }, transaction: t }
    );
    if (bills.length === 0) { await t.rollback(); return res.status(404).json({ error: 'Bill not found' }); }
    const bill = bills[0];
    const writeOffAmount = parseFloat(bill.balance_amount || 0);
    if (writeOffAmount <= 0) {
      await t.rollback();
      return res.status(400).json({ error: 'Bill has no outstanding balance to write off' });
    }

    const ts = Date.now().toString().slice(-8);
    const writeOffNumber = `WO-${ts}`;
    const id = uuidv4();

    await sequelize.query(`
      INSERT INTO bill_write_offs (id, clinic_id, bill_id, write_off_number, write_off_amount, reason, created_by)
      VALUES (:id, :clinicId, :billId, :won, :amount, :reason, :createdBy)
    `, {
      replacements: {
        id, clinicId: bill.clinic_id, billId, won: writeOffNumber,
        amount: writeOffAmount, reason: reason || '', createdBy: req.user?.id || null
      },
      transaction: t
    });

    await sequelize.query(`
      UPDATE patient_bills SET balance_amount = 0, status = 'written_off' WHERE id = :billId
    `, { replacements: { billId }, transaction: t });

    // Dr 5700 Bad Debt / Cr the bill's receivable, in the same transaction as the write-off.
    const AccountingService = require('../services/AccountingService');
    const woFail = (msg) => Object.assign(new Error(`Write-off not recorded: ${msg} Nothing was changed.`), { statusCode: 422 });
    const badDebtAccount = await AccountingService.getAccountByCode(bill.clinic_id, '5700');
    const receivablesAccount = await AccountingService.getReceivableAccount(bill.clinic_id, bill.scheme_id);
    if (!badDebtAccount) throw woFail('the Bad Debt Expense account (5700) is missing or inactive in the Chart of Accounts.');
    if (!receivablesAccount) throw woFail('the receivable account (1200/1210) is missing or inactive in the Chart of Accounts.');
    let woGl;
    try {
      woGl = await AccountingService.createGLEntry({
        clinic_id: bill.clinic_id,
        branch_id: bill.branch_id || null,
        transaction_date: new Date(),
        transaction_type: 'bad_debt_write_off',
        description: `Write-off Bill ${bill.bill_number} - ${reason || 'No reason'}`,
        reference_id: id,
        reference_module: 'bill_write_off',
        transaction_currency: bill.bill_currency,
      }, [
        { account_id: badDebtAccount.id, debit_amount: writeOffAmount, credit_amount: 0, description: `Bad debt: ${reason || 'Write-off'}` },
        { account_id: receivablesAccount.id, debit_amount: 0, credit_amount: writeOffAmount, description: `AR write-off: ${bill.bill_number}` }
      ], req.user?.id || 'system', t);
    } catch (glErr) {
      if (glErr.statusCode) throw glErr;
      throw woFail(`posting to the ledger failed (${glErr.message}).`);
    }
    await sequelize.query('UPDATE bill_write_offs SET write_off_gl_entry_id = :glId WHERE id = :id',
      { replacements: { glId: woGl.id, id }, transaction: t });

    await t.commit();
    res.json({ id, write_off_number: writeOffNumber, write_off_amount: writeOffAmount });
  } catch (error) {
    if (!t.finished) await t.rollback().catch(() => {});
    console.error('Error writing off bill:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Failed to write off bill' });
  }
});

// Get discounts for a bill
router.get('/bills/:billId/discounts', async (req, res) => {
  try {
    const [discounts] = await sequelize.query(
      'SELECT * FROM bill_discounts WHERE bill_id = :billId ORDER BY created_at DESC',
      { replacements: { billId: req.params.billId } }
    );
    res.json(discounts);
  } catch (error) {
    console.error('Error fetching discounts:', error);
    res.status(500).json({ error: 'Failed to fetch discounts' });
  }
});

// ============ CREDIT NOTES ============

// Create credit note
router.post('/credit-notes', authorize('billing.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { original_bill_id, credit_amount, credit_currency, reason, reason_details } = req.body;

    const [bills] = await sequelize.query(
      'SELECT * FROM patient_bills WHERE id = :billId',
      { replacements: { billId: original_bill_id }, transaction: t }
    );
    if (bills.length === 0) {
      await t.rollback();
      return res.status(404).json({ error: 'Original bill not found' });
    }
    const bill = bills[0];

    const ts = Date.now().toString().slice(-8);
    const creditNoteNumber = `CN-${new Date().getFullYear()}-${ts}`;
    const id = uuidv4();

    await sequelize.query(`
      INSERT INTO credit_notes (id, clinic_id, credit_note_number, original_bill_id,
        patient_id, patient_name, credit_date, credit_amount, credit_currency,
        reason, reason_details, status, created_by, branch_id)
      VALUES (:id, :clinicId, :cn, :billId, :patientId, :patientName, CURRENT_DATE,
        :amount, :currency, :reason, :details, 'created', :createdBy, :branchId)
    `, {
      replacements: {
        id, clinicId: bill.clinic_id, cn: creditNoteNumber,
        billId: original_bill_id, patientId: bill.patient_id,
        patientName: bill.patient_name, amount: credit_amount,
        currency: credit_currency || (await getBaseCurrencyCode()), reason: reason || 'adjustment',
        details: reason_details || '', createdBy: req.user?.id || null,
        branchId: getCreateBranchId(req)
      },
      transaction: t
    });

    await t.commit();
    res.json({ id, credit_note_number: creditNoteNumber, credit_amount, status: 'created' });
  } catch (error) {
    await t.rollback();
    console.error('Error creating credit note:', error);
    res.status(500).json({ error: 'Failed to create credit note' });
  }
});

// Approve credit note
router.put('/credit-notes/:id/approve', authorize('billing.write'), async (req, res) => {
  try {
    const { id } = req.params;
    // Setup › Configurations: optionally the person who created a credit
    // note may not approve it.
    const [[cnRow]] = await sequelize.query('SELECT clinic_id, created_by FROM credit_notes WHERE id = :id', { replacements: { id } });
    if (cnRow) {
      const { getFacilitySettings } = require('../utils/facilitySettings');
      const st = await getFacilitySettings(sequelize, cnRow.clinic_id);
      if (st.credit_note_separate_approver && String(cnRow.created_by) === String(req.user?.id)) {
        return res.status(400).json({ error: 'You created this credit note — a different person must approve it.' });
      }
    }
    const approveReplacements = { id, userId: req.user?.id || null };
    const approveBranchScope = branchScope(req, approveReplacements);
    await sequelize.query(`
      UPDATE credit_notes SET status = 'approved', approved_by = :userId, approval_date = NOW()
      WHERE id = :id AND status = 'created' ${approveBranchScope}
    `, { replacements: approveReplacements });
    const [note] = await sequelize.query(`SELECT * FROM credit_notes WHERE id = :id ${approveBranchScope}`, { replacements: approveReplacements });
    res.json(note[0]);
  } catch (error) {
    console.error('Error approving credit note:', error);
    res.status(500).json({ error: 'Failed to approve credit note' });
  }
});

// Apply credit note to bill
router.put('/credit-notes/:id/apply', authorize('billing.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { applied_to_bill_id } = req.body;

    const applyReplacements = { id, status: 'approved' };
    const applyBranchScope = branchScope(req, applyReplacements);
    const [notes] = await sequelize.query(
      `SELECT * FROM credit_notes WHERE id = :id AND status = :status ${applyBranchScope}`,
      { replacements: applyReplacements, transaction: t }
    );
    if (notes.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'Credit note not found or not approved' });
    }
    const note = notes[0];
    const targetBillId = applied_to_bill_id || note.original_bill_id;

    // A credit note lowers what the patient owes — it is not money received, so it
    // reduces the bill's total and balance and leaves paid_amount alone (otherwise
    // every "collected" figure read from bills overstates cash by the credit).
    const [[target]] = await sequelize.query(
      'SELECT id, total_amount, paid_amount, balance_amount, base_currency_total, bill_currency FROM patient_bills WHERE id = :billId',
      { replacements: { billId: targetBillId }, transaction: t }
    );
    if (!target) {
      await t.rollback();
      return res.status(404).json({ error: 'The bill this credit note applies to was not found' });
    }
    const fmtMoney = (n) => `${target.bill_currency || ''} ${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
    const creditAmt = Math.round(parseFloat(note.credit_amount) * 100) / 100;
    const oldTotal = parseFloat(target.total_amount) || 0;
    const paid = parseFloat(target.paid_amount) || 0;
    const outstanding = Math.round((parseFloat(target.balance_amount) || 0) * 100) / 100;
    if (creditAmt > outstanding + 0.01) {
      await t.rollback();
      return res.status(400).json({
        error: `This credit (${fmtMoney(creditAmt)}) is more than the ${fmtMoney(outstanding)} still owed on the bill. Credit ${fmtMoney(outstanding)} or less, or refund the patient instead.`,
      });
    }
    const newTotal = Math.round((oldTotal - creditAmt) * 100) / 100;
    const newBalance = Math.max(0, Math.round((outstanding - creditAmt) * 100) / 100);
    const oldBase = parseFloat(target.base_currency_total) || 0;
    const newBase = oldBase > 0 && oldTotal > 0 ? Math.round(oldBase * (newTotal / oldTotal) * 100) / 100 : oldBase;
    const newStatus = newBalance <= 0.01 ? 'paid' : (paid > 0 ? 'partial' : 'pending');
    await sequelize.query(`
      UPDATE patient_bills SET
        total_amount = :newTotal,
        base_currency_total = :newBase,
        balance_amount = :newBalance,
        status = :newStatus,
        updated_at = NOW()
      WHERE id = :billId
    `, { replacements: { newTotal, newBase, newBalance, newStatus, billId: targetBillId }, transaction: t });

    // Update credit note
    await sequelize.query(`
      UPDATE credit_notes SET status = 'applied', applied_to_bill_id = :billId,
        applied_date = CURRENT_DATE, applied_amount = :amount
      WHERE id = :id
    `, { replacements: { billId: targetBillId, amount: note.credit_amount, id }, transaction: t });

    // Revenue reversal (Dr revenue / Cr receivable) in the same transaction as the bill change.
    {
      const AccountingService = require('../services/AccountingService');
      // credit_notes doesn't carry scheme_id/currency itself — look them up from the
      // bill this note is actually being applied against, same as discount/write-off above.
      const [targetBillRows] = await sequelize.query(
        'SELECT scheme_id, bill_currency FROM patient_bills WHERE id = :billId',
        { replacements: { billId: targetBillId }, transaction: t }
      );
      const receivablesAccount = await AccountingService.getReceivableAccount(note.clinic_id, targetBillRows[0]?.scheme_id);

      // Reverse from whichever revenue account(s) this bill's own creation actually
      // posted to — not a hardcoded 4100 — so a credit note against a lab or pharmacy
      // bill doesn't silently understate Consultation Revenue instead while leaving
      // the real category overstated (same bug class fixed in
      // AccountingService.syncBillRevenueToGL: a wrong-but-plausible account produces
      // category totals that don't match any real service).
      const [postedRevenueRows] = await sequelize.query(
        `SELECT al.account_id, SUM(al.credit_amount) - SUM(al.debit_amount) AS amount
           FROM account_ledger al
           JOIN chart_of_accounts coa ON coa.id = al.account_id AND coa.account_type = 'revenue'
           JOIN general_ledger gl ON gl.id = al.transaction_id
          WHERE gl.reference_id = :billId
            AND gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')
          GROUP BY 1
         HAVING SUM(al.credit_amount) - SUM(al.debit_amount) > 0.001
          ORDER BY 2 DESC`,
        { replacements: { billId: targetBillId }, transaction: t }
      );

      let revenueLines = [];
      if (postedRevenueRows.length > 0) {
        // Waterfall: take the credit out of the largest revenue account first,
        // spilling into the next only once it's exhausted — same discipline as
        // the cash-revenue allocation in reportIncomeStatement.js, so a partial
        // credit lands on real posted amounts rather than a fraction of every
        // category.
        let remaining = Math.round(Number(note.credit_amount) * 100) / 100;
        for (const row of postedRevenueRows) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, Math.round(Number(row.amount) * 100) / 100);
          if (take <= 0) continue;
          revenueLines.push({ account_id: row.account_id, amount: take });
          remaining = Math.round((remaining - take) * 100) / 100;
        }
        if (remaining > 0.001 && revenueLines.length > 0) {
          // The note exceeds everything this bill ever posted (e.g. adjusted
          // since) — put the remainder on the largest account rather than
          // losing it silently.
          revenueLines[0].amount = Math.round((revenueLines[0].amount + remaining) * 100) / 100;
        }
      }
      if (revenueLines.length === 0) {
        const fallback = await AccountingService.getAccountByCode(note.clinic_id, '4100');
        if (fallback) revenueLines = [{ account_id: fallback.id, amount: Number(note.credit_amount) }];
      }

      if (revenueLines.length > 0 && receivablesAccount) {
        const glEntry = await AccountingService.createGLEntry({
          clinic_id: note.clinic_id,
          transaction_date: new Date(),
          transaction_type: 'credit_note',
          description: `Credit Note ${note.credit_note_number} - ${note.reason || 'adjustment'}`,
          reference_id: id,
          transaction_currency: targetBillRows[0]?.bill_currency,
          reference_module: 'credit_note'
        }, [
          ...revenueLines.map((r) => ({ account_id: r.account_id, debit_amount: r.amount, credit_amount: 0, description: `Revenue reversal: ${note.credit_note_number}` })),
          { account_id: receivablesAccount.id, debit_amount: 0, credit_amount: note.credit_amount, description: `AR credit: ${note.credit_note_number}` }
        ], req.user?.id || 'system', t);
        await sequelize.query('UPDATE credit_notes SET credit_gl_entry_id = :glId WHERE id = :id',
          { replacements: { glId: glEntry.id, id }, transaction: t });
      } else {
        throw Object.assign(new Error(`Credit note not applied: no revenue or receivable account could be resolved for this bill. Nothing was changed.`), { statusCode: 422 });
      }
    }

    await t.commit();
    res.json({ message: 'Credit note applied', applied_amount: note.credit_amount });
  } catch (error) {
    if (!t.finished) await t.rollback().catch(() => {});
    console.error('Error applying credit note:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : `Credit note not applied: ${error.message}. Nothing was changed.` });
  }
});

// Get credit notes
router.get('/credit-notes', async (req, res) => {
  try {
    const { clinic_id, patient_id, status } = req.query;
    let where = 'WHERE 1=1';
    const replacements = {};
    if (clinic_id) { where += ' AND cn.clinic_id = :clinicId'; replacements.clinicId = parseInt(clinic_id); }
    if (patient_id) { where += ' AND cn.patient_id = :patientId'; replacements.patientId = patient_id; }
    if (status) { where += ' AND cn.status = :status'; replacements.status = status; }
    where += branchScope(req, replacements, 'cn');

    const [notes] = await sequelize.query(`
      SELECT cn.*, pb.bill_number AS original_bill_number
      FROM credit_notes cn
      LEFT JOIN patient_bills pb ON pb.id::text = cn.original_bill_id::text
      ${where}
      ORDER BY cn.created_at DESC
    `, { replacements });
    res.json(notes);
  } catch (error) {
    console.error('Error fetching credit notes:', error);
    res.status(500).json({ error: 'Failed to fetch credit notes' });
  }
});

// Get single credit note
router.get('/credit-notes/:id', async (req, res) => {
  try {
    const singleReplacements = { id: req.params.id };
    const singleBranchScope = branchScope(req, singleReplacements, 'cn');
    const [notes] = await sequelize.query(`
      SELECT cn.*, pb.bill_number AS original_bill_number
      FROM credit_notes cn
      LEFT JOIN patient_bills pb ON pb.id::text = cn.original_bill_id::text
      WHERE cn.id = :id ${singleBranchScope}
    `, { replacements: singleReplacements });
    if (notes.length === 0) return res.status(404).json({ error: 'Credit note not found' });
    res.json(notes[0]);
  } catch (error) {
    console.error('Error fetching credit note:', error);
    res.status(500).json({ error: 'Failed to fetch credit note' });
  }
});

// ============ INSURANCE ============

// Get patient insurance
router.get('/patient-insurance/:patientId', async (req, res) => {
  try {
    const [rows] = await sequelize.query(
      'SELECT * FROM patient_insurance WHERE patient_id = :pid ORDER BY is_active DESC, created_at DESC',
      { replacements: { pid: req.params.patientId } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching patient insurance:', error);
    res.status(500).json({ error: 'Failed to fetch patient insurance' });
  }
});

// Create/update patient insurance
router.post('/patient-insurance', authorize('billing.write'), async (req, res) => {
  try {
    const data = req.body;
    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO patient_insurance (id, clinic_id, patient_id, insurance_type,
        insurance_provider, member_id, member_name, nhif_member_number,
        nhif_status, nhif_card_number, effective_from, effective_to,
        is_active, copay_percentage, copay_max_per_visit)
      VALUES (:id, :clinicId, :patientId, :type, :provider, :memberId,
        :memberName, :nhifNum, :nhifStatus, :nhifCard, :from, :to,
        :active, :copayPct, :copayMax)
    `, {
      replacements: {
        id, clinicId: data.clinic_id, patientId: data.patient_id,
        type: data.insurance_type || 'nhif', provider: data.insurance_provider || null,
        memberId: data.member_id || null, memberName: data.member_name || null,
        nhifNum: data.nhif_member_number || null, nhifStatus: data.nhif_status || 'active',
        nhifCard: data.nhif_card_number || null,
        from: data.effective_from || null, to: data.effective_to || null,
        active: data.is_active !== false, copayPct: data.copay_percentage || 0,
        copayMax: data.copay_max_per_visit || null
      }
    });
    res.json({ id, message: 'Insurance record created' });
  } catch (error) {
    console.error('Error creating patient insurance:', error);
    res.status(500).json({ error: 'Failed to create insurance record' });
  }
});

// Update patient insurance
router.put('/patient-insurance/:id', authorize('billing.write'), async (req, res) => {
  try {
    const data = req.body;
    const fields = [];
    const replacements = { id: req.params.id };

    for (const [key, val] of Object.entries(data)) {
      if (key !== 'id') {
        fields.push(`${key} = :${key}`);
        replacements[key] = val;
      }
    }
    if (fields.length > 0) {
      await sequelize.query(`UPDATE patient_insurance SET ${fields.join(', ')} WHERE id = :id`, { replacements });
    }
    const [updated] = await sequelize.query('SELECT * FROM patient_insurance WHERE id = :id', { replacements: { id: req.params.id } });
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating patient insurance:', error);
    res.status(500).json({ error: 'Failed to update insurance' });
  }
});

// Apply insurance copay to bill
router.put('/bills/:billId/apply-insurance', authorize('billing.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { billId } = req.params;
    const { insurance_type, member_id, copay_percentage, coverage_amount } = req.body;

    const [bills] = await sequelize.query(
      'SELECT * FROM patient_bills WHERE id = :billId', { replacements: { billId }, transaction: t }
    );
    if (bills.length === 0) { await t.rollback(); return res.status(404).json({ error: 'Bill not found' }); }

    const bill = bills[0];
    let insuranceCoverage = coverage_amount || 0;
    let copay = 0;

    if (copay_percentage && !coverage_amount) {
      copay = Math.round(parseFloat(bill.total_amount) * copay_percentage / 100 * 100) / 100;
      insuranceCoverage = parseFloat(bill.total_amount) - copay;
    } else {
      copay = parseFloat(bill.total_amount) - insuranceCoverage;
    }

    await sequelize.query(`
      UPDATE patient_bills SET
        insurance_type = :insType, insurance_member_id = :memberId,
        insurance_copay = :copay, insurance_coverage_amount = :coverage,
        balance_amount = :copay - paid_amount
      WHERE id = :billId
    `, {
      replacements: { insType: insurance_type, memberId: member_id || null, copay, coverage: insuranceCoverage, billId },
      transaction: t
    });

    await t.commit();
    res.json({ insurance_coverage: insuranceCoverage, patient_copay: copay });
  } catch (error) {
    await t.rollback();
    console.error('Error applying insurance:', error);
    res.status(500).json({ error: 'Failed to apply insurance' });
  }
});

// ============ INSURANCE CLAIMS ============

// List insurance claims
router.get('/insurance-claims', async (req, res) => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS insurance_claims (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INT NOT NULL,
        claim_number VARCHAR(100) UNIQUE NOT NULL,
        bill_id VARCHAR(36), patient_id VARCHAR(255), patient_name VARCHAR(255),
        insurance_provider VARCHAR(255), insurance_type VARCHAR(100), member_id VARCHAR(100),
        claim_amount DECIMAL(15,2) DEFAULT 0, claim_currency VARCHAR(10) DEFAULT 'USD',
        claim_date DATE, status VARCHAR(50) DEFAULT 'pending',
        batch_id VARCHAR(36), rejection_reason TEXT,
        paid_amount DECIMAL(15,2) DEFAULT 0, payment_date DATE,
        notes TEXT, created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(() => {});

    const { clinic_id, status, patient_id } = req.query;
    let where = 'WHERE 1=1';
    const replacements = {};
    if (clinic_id) { where += ' AND ic.clinic_id = :clinicId'; replacements.clinicId = parseInt(clinic_id); }
    if (status) { where += ' AND ic.status = :status'; replacements.status = status; }
    if (patient_id) { where += ' AND ic.patient_id = :patientId'; replacements.patientId = patient_id; }

    const [claims] = await sequelize.query(`
      SELECT ic.*, pb.bill_number
      FROM insurance_claims ic
      LEFT JOIN patient_bills pb ON ic.bill_id = pb.id
      ${where}
      ORDER BY ic.created_at DESC
    `, { replacements });
    res.json(claims);
  } catch (error) {
    console.error('Error fetching insurance claims:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch claims' });
  }
});

// Create insurance claim from bill
router.post('/insurance-claims/:billId', authorize('billing.write'), async (req, res) => {
  try {
    const { billId } = req.params;
    const [bills] = await sequelize.query('SELECT * FROM patient_bills WHERE id = :billId', { replacements: { billId } });
    if (bills.length === 0) return res.status(404).json({ error: 'Bill not found' });
    const bill = bills[0];

    if (!bill.insurance_type) return res.status(400).json({ error: 'Bill has no insurance information' });

    const ts = Date.now().toString().slice(-8);
    const claimNumber = `CLM-${new Date().getFullYear()}-${ts}`;
    const id = uuidv4();

    await sequelize.query(`
      INSERT INTO insurance_claims (id, clinic_id, claim_number, bill_id, patient_id,
        patient_name, insurance_provider, insurance_type, member_id,
        claim_amount, claim_currency, claim_date, status, created_by)
      VALUES (:id, :clinicId, :cn, :billId, :patientId, :patientName,
        :provider, :insType, :memberId, :amount, :currency, CURRENT_DATE, 'submitted', :createdBy)
    `, {
      replacements: {
        id, clinicId: bill.clinic_id, cn: claimNumber, billId,
        patientId: bill.patient_id, patientName: bill.patient_name,
        provider: bill.insurance_type, insType: bill.insurance_type,
        memberId: bill.insurance_member_id, amount: bill.insurance_coverage_amount || 0,
        currency: bill.bill_currency || (await getBaseCurrencyCode()), createdBy: req.user?.id || null
      }
    });

    // Mark bill as claim submitted
    await sequelize.query(
      'UPDATE patient_bills SET insurance_claim_submitted = true, insurance_claim_date = CURRENT_DATE WHERE id = :billId',
      { replacements: { billId } }
    );

    res.json({ id, claim_number: claimNumber, status: 'submitted' });
  } catch (error) {
    console.error('Error creating insurance claim:', error);
    res.status(500).json({ error: 'Failed to create claim' });
  }
});

// Update insurance claim status
router.put('/insurance-claims/:id', authorize('billing.write'), async (req, res) => {
  try {
    const data = req.body;
    const fields = [];
    const replacements = { id: req.params.id };
    for (const [key, val] of Object.entries(data)) {
      if (key !== 'id') { fields.push(`${key} = :${key}`); replacements[key] = val; }
    }
    if (fields.length > 0) {
      await sequelize.query(`UPDATE insurance_claims SET ${fields.join(', ')} WHERE id = :id`, { replacements });
    }
    const [updated] = await sequelize.query('SELECT * FROM insurance_claims WHERE id = :id', { replacements: { id: req.params.id } });
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating insurance claim:', error);
    res.status(500).json({ error: 'Failed to update claim' });
  }
});

// ============ RECEIVABLES & AGING ============

// Get receivables summary
router.get('/receivables/clinic/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const [rows] = await sequelize.query(`
      SELECT pb.*, (p.first_name || ' ' || p.last_name) AS full_name,
        ((CURRENT_DATE)::date - (pb.due_date)::date) AS calc_days_overdue
      FROM patient_bills pb
      LEFT JOIN patients p ON pb.patient_id = p.patient_id OR pb.patient_id = p.id
      WHERE pb.clinic_id = :clinicId AND pb.balance_amount > 0 AND pb.status != 'paid'
      ORDER BY pb.due_date ASC
    `, { replacements: { clinicId } });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching receivables:', error);
    res.status(500).json({ error: 'Failed to fetch receivables' });
  }
});

// Get aging analysis
router.get('/receivables/aging', async (req, res) => {
  try {
    const { clinic_id } = req.query;
    if (!clinic_id) return res.status(400).json({ error: 'clinic_id required' });

    // Grouped by bill_currency too — bills aren't all in the clinic's base currency (a
    // scheme/insurance bill can be priced in USD), so summing every bill into one number
    // and labeling it with the base currency was silently mislabeling foreign-currency
    // balances. Each currency gets its own row instead of being blended into one total.
    const [aging] = await sequelize.query(`
      SELECT aging_bracket, bill_currency,
        COUNT(*) AS bill_count,
        SUM(balance_amount) AS total_balance,
        SUM(total_amount) AS total_billed,
        SUM(paid_amount) AS total_paid
      FROM (
        SELECT balance_amount, total_amount, paid_amount, COALESCE(bill_currency, ${BASE_CURRENCY_SQL}) AS bill_currency,
          CASE
            WHEN due_date IS NULL OR ((CURRENT_DATE)::date - (due_date)::date) <= 0 THEN 'current'
            WHEN ((CURRENT_DATE)::date - (due_date)::date) BETWEEN 1 AND 30 THEN '1_30'
            WHEN ((CURRENT_DATE)::date - (due_date)::date) BETWEEN 31 AND 60 THEN '31_60'
            WHEN ((CURRENT_DATE)::date - (due_date)::date) BETWEEN 61 AND 90 THEN '61_90'
            ELSE '90_plus'
          END AS aging_bracket
        FROM patient_bills
        WHERE clinic_id = :clinicId AND COALESCE(balance_amount, 0) > 0 AND status != 'paid'
      ) sub
      GROUP BY aging_bracket, bill_currency
      ORDER BY CASE aging_bracket WHEN 'current' THEN 1 WHEN '1_30' THEN 2 WHEN '31_60' THEN 3 WHEN '61_90' THEN 4 ELSE 5 END, bill_currency
    `, { replacements: { clinicId: parseInt(clinic_id) } });

    // Totals per currency — an array now instead of one blended object.
    const [totals] = await sequelize.query(`
      SELECT COALESCE(bill_currency, ${BASE_CURRENCY_SQL}) AS bill_currency,
        COUNT(*) AS total_bills,
        COALESCE(SUM(total_amount), 0) AS total_billed,
        COALESCE(SUM(paid_amount), 0) AS total_paid,
        COALESCE(SUM(balance_amount), 0) AS total_outstanding,
        COUNT(CASE WHEN ((CURRENT_DATE)::date - (due_date)::date) > 0 THEN 1 END) AS overdue_count
      FROM patient_bills
      WHERE clinic_id = :clinicId AND balance_amount > 0 AND status != 'paid'
      GROUP BY bill_currency
    `, { replacements: { clinicId: parseInt(clinic_id) } });

    res.json({ aging_brackets: aging, summary: totals });
  } catch (error) {
    console.error('Error fetching aging:', error);
    res.status(500).json({ error: 'Failed to fetch aging analysis' });
  }
});

// Get overdue bills
router.get('/receivables/overdue', async (req, res) => {
  try {
    const { clinic_id } = req.query;
    if (!clinic_id) return res.status(400).json({ error: 'clinic_id required' });

    const [rows] = await sequelize.query(`
      SELECT pb.*, ((CURRENT_DATE)::date - (pb.due_date)::date) AS days_overdue
      FROM patient_bills pb
      WHERE pb.clinic_id = :clinicId AND pb.balance_amount > 0
        AND DATE(pb.due_date) < CURRENT_DATE AND pb.status != 'paid'
      ORDER BY pb.due_date ASC
    `, { replacements: { clinicId: parseInt(clinic_id) } });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching overdue bills:', error);
    res.status(500).json({ error: 'Failed to fetch overdue bills' });
  }
});

// Get patient receivables
router.get('/receivables/patient/:patientId', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT pb.*, ((CURRENT_DATE)::date - (pb.due_date)::date) AS days_overdue
      FROM patient_bills pb
      WHERE pb.patient_id = :patientId AND pb.balance_amount > 0 AND pb.status != 'paid'
      ORDER BY pb.due_date ASC
    `, { replacements: { patientId: req.params.patientId } });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching patient receivables:', error);
    res.status(500).json({ error: 'Failed to fetch patient receivables' });
  }
});

// Record a collections follow-up on an overdue bill. The billing_follow_ups table already
// existed (created by an earlier migration) but no route ever wrote to it — the
// Receivables tab's "Follow-up" button called this exact path and always 404'd.
router.post('/receivables/:billId/follow-up', authorize('billing.write'), async (req, res) => {
  try {
    const { billId } = req.params;
    const { follow_up_type, follow_up_notes, outcome, next_follow_up_date } = req.body;

    const [bills] = await sequelize.query(
      'SELECT clinic_id, patient_id FROM patient_bills WHERE id = :billId',
      { replacements: { billId } }
    );
    if (bills.length === 0) return res.status(404).json({ error: 'Bill not found' });

    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO billing_follow_ups (id, clinic_id, bill_id, patient_id, follow_up_date,
        follow_up_type, follow_up_notes, outcome, next_follow_up_date, performed_by)
      VALUES (:id, :clinicId, :billId, :patientId, CURRENT_DATE, :type, :notes, :outcome, :nextDate, :performedBy)
    `, {
      replacements: {
        id, clinicId: bills[0].clinic_id, billId, patientId: bills[0].patient_id,
        type: follow_up_type || 'phone', notes: follow_up_notes || '',
        outcome: outcome || null, nextDate: next_follow_up_date || null,
        performedBy: req.user?.id || null
      }
    });

    res.json({ id, message: 'Follow-up recorded' });
  } catch (error) {
    console.error('Error recording follow-up:', error);
    res.status(500).json({ error: 'Failed to record follow-up' });
  }
});

// Get follow-up history for a bill
router.get('/receivables/:billId/follow-ups', async (req, res) => {
  try {
    const [rows] = await sequelize.query(
      'SELECT * FROM billing_follow_ups WHERE bill_id = :billId ORDER BY created_at DESC',
      { replacements: { billId: req.params.billId } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching follow-ups:', error);
    res.status(500).json({ error: 'Failed to fetch follow-ups' });
  }
});

// Get outstanding balance report
router.get('/reports/outstanding-balance', async (req, res) => {
  try {
    const { clinic_id } = req.query;
    if (!clinic_id) return res.status(400).json({ error: 'clinic_id required' });

    // Grouped by bill_currency as well as patient — a patient with both an SSP bill and a
    // USD scheme bill gets one row per currency instead of the two balances being summed
    // together into a single number with only one (wrong) currency label.
    const [rows] = await sequelize.query(`
      SELECT pb.patient_id, pb.patient_name, COALESCE(pb.bill_currency, ${BASE_CURRENCY_SQL}) AS bill_currency,
        COUNT(*) AS bill_count,
        COALESCE(SUM(pb.total_amount), 0) AS total_billed,
        COALESCE(SUM(pb.paid_amount), 0) AS total_paid,
        COALESCE(SUM(pb.balance_amount), 0) AS total_outstanding,
        MIN(pb.due_date) AS oldest_due_date,
        MAX(((CURRENT_DATE)::date - (pb.due_date)::date)) AS max_days_overdue
      FROM patient_bills pb
      WHERE pb.clinic_id = :clinicId AND pb.balance_amount > 0 AND pb.status != 'paid'
      GROUP BY pb.patient_id, pb.patient_name, COALESCE(pb.bill_currency, ${BASE_CURRENCY_SQL})
      ORDER BY total_outstanding DESC
    `, { replacements: { clinicId: parseInt(clinic_id) } });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching outstanding balances:', error);
    res.status(500).json({ error: 'Failed to fetch outstanding balances' });
  }
});

// Revenue summary by period
router.get('/reports/revenue-summary', async (req, res) => {
  try {
    const { clinic_id, start_date, end_date, group_by } = req.query;
    if (!clinic_id) return res.status(400).json({ error: 'clinic_id required' });
    const startDt = start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const endDt = end_date || new Date().toISOString().split('T')[0];
    const groupExpr = group_by === 'week'  ? "to_char(bill_date, 'IYYY-IW')"
                    : group_by === 'month' ? "to_char(bill_date, 'YYYY-MM')"
                    : "DATE(bill_date)";
    // patient_bills has no discount_amount or insurance_coverage_amount column — this
    // query referenced both and threw "Unknown column" on every call. Neither concept is
    // tracked anywhere else in this schema (discounts/insurance coverage aren't broken out
    // from a bill's services), so rather than fabricate a placeholder 0 that implies the
    // feature exists, those two figures are dropped from the response entirely.
    const [rows] = await sequelize.query(`
      SELECT ${groupExpr} AS period,
        COUNT(*) AS bill_count,
        COALESCE(SUM(total_amount), 0) AS total_billed,
        COALESCE(SUM(paid_amount), 0) AS total_collected,
        COALESCE(SUM(balance_amount), 0) AS total_outstanding
      FROM patient_bills
      WHERE clinic_id = :clinicId AND DATE(bill_date) BETWEEN DATE(:start) AND DATE(:end)
      GROUP BY 1 ORDER BY 1 ASC
    `, { replacements: { clinicId: parseInt(clinic_id), start: startDt, end: endDt } });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching revenue summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// Revenue by service category
router.get('/reports/revenue-by-category', async (req, res) => {
  try {
    const { clinic_id, start_date, end_date } = req.query;
    if (!clinic_id) return res.status(400).json({ error: 'clinic_id required' });
    const startDt = start_date || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const endDt = end_date || new Date().toISOString().split('T')[0];
    const [rows] = await sequelize.query(`
      SELECT
        COALESCE(SUM(clinical_total), 0) AS clinical,
        COALESCE(SUM(lab_total), 0) AS lab,
        COALESCE(SUM(pharmacy_total), 0) AS pharmacy,
        COALESCE(SUM(supply_total), 0) AS supply,
        COALESCE(SUM(procedure_total), 0) AS procedure_charges,
        COALESCE(SUM(accommodation_total), 0) AS accommodation,
        COALESCE(SUM(other_total), 0) AS other,
        COALESCE(SUM(total_amount), 0) AS grand_total
      FROM patient_bills
      WHERE clinic_id = :clinicId AND DATE(bill_date) BETWEEN DATE(:start) AND DATE(:end)
    `, { replacements: { clinicId: parseInt(clinic_id), start: startDt, end: endDt } });
    const [lineItems] = await sequelize.query(`
      SELECT bli.service_category,
        COUNT(*) AS item_count,
        COALESCE(SUM(bli.line_total), 0) AS total_amount,
        COALESCE(SUM(bli.paid_amount), 0) AS paid_amount
      FROM bill_line_items bli
      JOIN patient_bills pb ON bli.bill_id = pb.id
      WHERE pb.clinic_id = :clinicId AND DATE(pb.bill_date) BETWEEN DATE(:start) AND DATE(:end)
        AND bli.item_status != 'cancelled'
      GROUP BY bli.service_category
    `, { replacements: { clinicId: parseInt(clinic_id), start: startDt, end: endDt } }).catch(() => [[]]);
    res.json({ summary: rows[0], by_line_items: lineItems });
  } catch (error) {
    console.error('Error fetching revenue by category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Collections by payment method
router.get('/reports/collections', async (req, res) => {
  try {
    const { clinic_id, start_date, end_date } = req.query;
    if (!clinic_id) return res.status(400).json({ error: 'clinic_id required' });
    const startDt = start_date || new Date().toISOString().split('T')[0];
    const endDt = end_date || new Date().toISOString().split('T')[0];
    const [rows] = await sequelize.query(`
      SELECT payment_method,
        COUNT(*) AS payment_count,
        COALESCE(SUM(payment_amount), 0) AS total_collected
      FROM receipts
      WHERE clinic_id = :clinicId AND DATE(payment_date) BETWEEN DATE(:start) AND DATE(:end)
        AND status = 'active'
      GROUP BY payment_method
    `, { replacements: { clinicId: parseInt(clinic_id), start: startDt, end: endDt } });
    const [totals] = await sequelize.query(`
      SELECT COUNT(*) AS total_payments,
        COALESCE(SUM(payment_amount), 0) AS total_collected
      FROM receipts
      WHERE clinic_id = :clinicId AND DATE(payment_date) BETWEEN DATE(:start) AND DATE(:end)
        AND status = 'active'
    `, { replacements: { clinicId: parseInt(clinic_id), start: startDt, end: endDt } });
    res.json({ by_method: rows, totals: totals[0] });
  } catch (error) {
    console.error('Error fetching collections:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cash position today
router.get('/reports/cash-position', async (req, res) => {
  try {
    const { clinic_id } = req.query;
    if (!clinic_id) return res.status(400).json({ error: 'clinic_id required' });
    const today = new Date().toISOString().split('T')[0];
    const [cashIn] = await sequelize.query(`
      SELECT COALESCE(SUM(payment_amount), 0) AS total_cash_in
      FROM receipts
      WHERE clinic_id = :clinicId AND DATE(payment_date) = DATE(:today)
        AND payment_method = 'cash' AND status = 'active'
    `, { replacements: { clinicId: parseInt(clinic_id), today } });
    const [allPayments] = await sequelize.query(`
      SELECT payment_method, COALESCE(SUM(payment_amount), 0) AS amount
      FROM receipts
      WHERE clinic_id = :clinicId AND DATE(payment_date) = DATE(:today) AND status = 'active'
      GROUP BY payment_method
    `, { replacements: { clinicId: parseInt(clinic_id), today } });
    const [billsToday] = await sequelize.query(`
      SELECT COUNT(*) AS count,
        COALESCE(SUM(total_amount), 0) AS total_billed,
        COALESCE(SUM(paid_amount), 0) AS total_paid
      FROM patient_bills
      WHERE clinic_id = :clinicId AND DATE(bill_date) = DATE(:today)
    `, { replacements: { clinicId: parseInt(clinic_id), today } });
    res.json({
      date: today,
      cash_received: parseFloat(cashIn[0].total_cash_in),
      payments_by_method: allPayments,
      bills_today: billsToday[0]
    });
  } catch (error) {
    console.error('Error fetching cash position:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get bills with category breakdowns
router.get('/bills/clinic/:clinicId/enhanced', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { status, start_date, end_date, patient_id, insurance_type } = req.query;

    let where = 'WHERE pb.clinic_id = :clinicId';
    const replacements = { clinicId };
    if (status) { where += ' AND pb.status = :status'; replacements.status = status; }
    if (start_date) { where += ' AND pb.bill_date >= :startDate'; replacements.startDate = start_date; }
    if (end_date) { where += ' AND pb.bill_date <= :endDate'; replacements.endDate = end_date; }
    if (patient_id) { where += ' AND pb.patient_id = :patientId'; replacements.patientId = patient_id; }
    if (insurance_type) { where += ' AND pb.insurance_type = :insType'; replacements.insType = insurance_type; }

    const [bills] = await sequelize.query(`
      SELECT pb.*,
        (SELECT COUNT(*) FROM bill_line_items bli WHERE bli.bill_id = pb.id AND bli.item_status != 'cancelled') AS line_item_count,
        (SELECT COUNT(*) FROM bill_line_items bli WHERE bli.bill_id = pb.id AND bli.item_status = 'paid') AS paid_item_count,
        (SELECT COUNT(*) FROM bill_discounts bd WHERE bd.bill_id = pb.id) AS discount_count,
        ((CURRENT_DATE)::date - (pb.due_date)::date) AS days_overdue_calc
      FROM patient_bills pb
      ${where}
      ORDER BY pb.created_at DESC
    `, { replacements });

    res.json(bills);
  } catch (error) {
    console.error('Error fetching enhanced bills:', error);
    res.status(500).json({ error: 'Failed to fetch enhanced bills' });
  }
});

// Get patient bills history
router.get('/bills/patient/:patientId', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT pb.*,
        (SELECT COUNT(*) FROM bill_line_items bli WHERE bli.bill_id = pb.id) AS line_item_count,
        ((CURRENT_DATE)::date - (pb.due_date)::date) AS days_overdue_calc
      FROM patient_bills pb
      WHERE pb.patient_id = :patientId
      ORDER BY pb.created_at DESC
    `, { replacements: { patientId: req.params.patientId } });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching patient bills:', error);
    res.status(500).json({ error: 'Failed to fetch patient bills' });
  }
});

// ============ HELPER FUNCTIONS ============

async function recalculateBillTotals(billId, transaction) {
  try {
    // Sum line items by category
    const [sums] = await sequelize.query(`
      SELECT
        COUNT(*) AS item_count,
        COALESCE(SUM(CASE WHEN service_category = 'clinical' AND item_status != 'cancelled' THEN line_total ELSE 0 END), 0) AS clinical,
        COALESCE(SUM(CASE WHEN service_category = 'lab' AND item_status != 'cancelled' THEN line_total ELSE 0 END), 0) AS lab,
        COALESCE(SUM(CASE WHEN service_category = 'pharmacy' AND item_status != 'cancelled' THEN line_total ELSE 0 END), 0) AS pharmacy,
        COALESCE(SUM(CASE WHEN service_category = 'supply' AND item_status != 'cancelled' THEN line_total ELSE 0 END), 0) AS supply,
        COALESCE(SUM(CASE WHEN service_category = 'procedure' AND item_status != 'cancelled' THEN line_total ELSE 0 END), 0) AS procedure_total,
        COALESCE(SUM(CASE WHEN service_category = 'accommodation' AND item_status != 'cancelled' THEN line_total ELSE 0 END), 0) AS accommodation,
        COALESCE(SUM(CASE WHEN service_category = 'other' AND item_status != 'cancelled' THEN line_total ELSE 0 END), 0) AS other,
        COALESCE(SUM(CASE WHEN item_status != 'cancelled' THEN line_total ELSE 0 END), 0) AS grand_total,
        COALESCE(SUM(CASE WHEN item_status != 'cancelled' THEN paid_amount ELSE 0 END), 0) AS total_paid
      FROM bill_line_items WHERE bill_id = :billId
    `, { replacements: { billId }, transaction });

    // Bills created through the normal flow (POST /patient-bills) store their
    // charges in patient_bills.services (JSON), never in this bill_line_items
    // table — nothing in the app copies one into the other. So for virtually
    // every real bill this query matches zero rows, and COALESCE(SUM(...), 0)
    // used to turn that into grand_total = 0, which the UPDATE below then
    // wrote straight into patient_bills.total_amount — zeroing out a bill's
    // total (with its GL revenue left fully posted, since this function never
    // syncs to the ledger) the moment anyone hit this route for it. Found in
    // production (nation tenant) via accountingHealthCheck.js's "each bill's
    // revenue matches the bill" check turning up 3 bills posted at their full
    // original GL amount but showing total_amount = 0. Bailing out when there
    // are no bill_line_items rows avoids repeating that corruption; it does
    // not fix the underlying disconnect between this table and `services`,
    // which has no current frontend caller (grepped — nothing calls these
    // /line-items routes) to justify the larger rewire.
    if (sums.length > 0 && parseInt(sums[0].item_count, 10) > 0) {
      const s = sums[0];
      const grandTotal = parseFloat(s.grand_total);

      // Get discount total
      const [discountSum] = await sequelize.query(
        'SELECT COALESCE(SUM(discount_amount), 0) AS total FROM bill_discounts WHERE bill_id = :billId',
        { replacements: { billId }, transaction }
      );
      const discount = parseFloat(discountSum[0].total);

      // Get current bill paid_amount (from receipts, not line items, for accuracy)
      const [bill] = await sequelize.query(
        'SELECT paid_amount, insurance_coverage_amount FROM patient_bills WHERE id = :billId',
        { replacements: { billId }, transaction }
      );
      const paidAmount = parseFloat(bill[0]?.paid_amount || 0);
      const insuranceCoverage = parseFloat(bill[0]?.insurance_coverage_amount || 0);
      const balance = Math.max(0, grandTotal - discount - insuranceCoverage - paidAmount);

      let status = 'pending';
      if (balance <= 0 && grandTotal > 0) status = 'paid';
      else if (paidAmount > 0) status = 'partial';

      await sequelize.query(`
        UPDATE patient_bills SET
          total_amount = :total,
          balance_amount = :balance,
          clinical_total = :clinical, lab_total = :lab, pharmacy_total = :pharmacy,
          supply_total = :supply, procedure_total = :procedure, accommodation_total = :accommodation,
          other_total = :other,
          status = :status
        WHERE id = :billId
      `, {
        replacements: {
          total: grandTotal, balance,
          clinical: s.clinical, lab: s.lab, pharmacy: s.pharmacy,
          supply: s.supply, procedure: s.procedure_total, accommodation: s.accommodation,
          other: s.other, status, billId
        },
        transaction
      });
    }
  } catch (error) {
    console.error('Error recalculating bill totals:', error);
  }
}

// ============ BILLING SETTINGS ============

// Get settings
router.get('/settings/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const [settings] = await sequelize.query(
      'SELECT * FROM billing_settings WHERE clinic_id = :clinicId',
      { replacements: { clinicId: parseInt(clinicId) } }
    );
    if (settings.length === 0) {
      return res.json({
        clinic_id: parseInt(clinicId),
        default_currency: await getBaseCurrencyCode(), default_payment_terms: 'immediate', default_due_date_days: 30,
        auto_bill_pharmacy_dispensing: true, auto_bill_lab_tests: true,
        auto_bill_clinical_visits: true, auto_bill_on_service: true, auto_post_to_gl: true,
        nhif_enabled: false, nhif_copay_percentage: 10, auto_apply_insurance_copay: false,
        allow_discounts: true, allow_refunds: true, refund_approval_required: true,
        write_off_after_days: 180
      });
    }
    res.json(settings[0]);
  } catch (error) {
    console.error('Error fetching billing settings:', error);
    res.status(500).json({ error: 'Failed to fetch billing settings' });
  }
});

// Update settings
router.put('/settings/:clinicId', authorize('billing.write'), async (req, res) => {
  try {
    const clinicId = parseInt(req.params.clinicId);
    const data = req.body;
    
    // Every toggle the Settings UI exposes must round-trip through here — this list was
    // previously missing 8 of 15 real columns (and included 3 columns, auto_bill_imaging/
    // procedures/bed_charges, that don't exist in billing_settings or the frontend at
    // all), so those settings silently reverted on reload even though the "Settings
    // saved" toast implied they'd been persisted.
    const allFields = [
      'default_currency', 'default_payment_terms', 'default_due_date_days',
      'auto_bill_pharmacy_dispensing', 'auto_bill_lab_tests', 'auto_bill_clinical_visits',
      'auto_bill_on_service', 'auto_post_to_gl', 'nhif_enabled', 'nhif_copay_percentage',
      'auto_apply_insurance_copay', 'allow_discounts', 'allow_refunds',
      'refund_approval_required', 'write_off_after_days'
    ];

    const [existing] = await sequelize.query('SELECT id FROM billing_settings WHERE clinic_id = :cid', { replacements: { cid: clinicId } });
    if (existing.length === 0) {
      const replacements = { id: uuidv4(), cid: clinicId };
      for (const f of allFields) replacements[f] = data[f] !== undefined ? data[f] : null;
      await sequelize.query(`
        INSERT INTO billing_settings (id, clinic_id, ${allFields.join(', ')})
        VALUES (:id, :cid, ${allFields.map(f => `:${f}`).join(', ')})
      `, { replacements });
    } else {
      const sets = [];
      const replacements = { cid: clinicId };
      const fields = allFields;
      for (const f of fields) {
        if (data[f] !== undefined) {
          sets.push(`${f} = :${f}`);
          replacements[f] = data[f];
        }
      }
      if (sets.length > 0) {
        await sequelize.query(`UPDATE billing_settings SET ${sets.join(', ')} WHERE clinic_id = :cid`, { replacements });
      }
    }
    res.json({ message: 'Settings saved' });
  } catch (error) {
    console.error('Error updating billing settings:', error);
    res.status(500).json({ error: 'Failed to update billing settings' });
  }
});

module.exports = router;
module.exports.recalculateBillTotals = recalculateBillTotals;
