const express = require('express');
const { authorize } = require('../middleware/authorize');
const { reportSchemaGuardFailure } = require('../utils/legacyDDL');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /billing-management and /patients-bill, so the API enforces what the client already assumes.
const BILLING_WRITE = ['admin', 'reception', 'doctor', 'finance_manager', 'accountant'];
const router = express.Router();
const { sequelize, PatientBill, Receipt, CashierShift } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');

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
        if (e.original?.code !== 'ER_DUP_FIELDNAME') console.warn(`Could not add insurance_claims.${col}:`, e.message);
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
router.post('/bills/:billId/line-items', authorize(BILLING_WRITE), async (req, res) => {
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
        currency: item.line_currency || 'SSP',
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
router.put('/bills/:billId/line-items/:lineId', authorize(BILLING_WRITE), async (req, res) => {
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
router.delete('/bills/:billId/line-items/:lineId', authorize(BILLING_WRITE), async (req, res) => {
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
router.post('/bills/:billId/discounts', authorize(BILLING_WRITE), async (req, res) => {
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

    // Create GL entry for discount (Dr. Discount Expense, Cr. Accounts Receivable)
    try {
      const AccountingService = require('../services/AccountingService');
      // 5300 is "Rent Expense" in this chart of accounts — posting discounts there was
      // silently miscoding every patient discount as rent, corrupting the P&L. Patient
      // discounts need their own contra-revenue expense line.
      let discountAccount = await AccountingService.getAccountByCode(bills[0].clinic_id, '5230');
      if (!discountAccount) {
        const { ChartOfAccounts } = require('../models');
        discountAccount = await ChartOfAccounts.create({
          clinic_id: bills[0].clinic_id, account_code: '5230',
          account_name: 'Patient Discounts & Allowances', account_type: 'expense',
          balance_type: 'debit', is_active: true
        });
      }
      // Must match whichever account (1210 Insurance Receivables vs 1200 Accounts
      // Receivable) the bill's own receivable was originally booked to at creation
      // time (AccountingService.createGLFromPatientBill) — crediting the wrong one
      // here leaves the actual receivable un-reduced while a different, unrelated
      // account absorbs the credit.
      const receivablesAccount = await AccountingService.getReceivableAccount(bills[0].clinic_id, bills[0].scheme_id);

      if (discountAccount && receivablesAccount) {
        const glEntry = await AccountingService.createGLEntry({
          clinic_id: bills[0].clinic_id,
          transaction_date: new Date(),
          transaction_type: 'bill_discount',
          description: `Discount on Bill ${bills[0].bill_number} - ${reason || 'No reason'}`,
          reference_id: id,
          reference_module: 'billing_discount',
          transaction_currency: bills[0].bill_currency,
        }, [
          { account_id: discountAccount.id, debit_amount: calcAmount, credit_amount: 0, description: `Discount: ${reason || 'Applied'}` },
          { account_id: receivablesAccount.id, debit_amount: 0, credit_amount: calcAmount, description: `AR reduction: Discount on ${bills[0].bill_number}` }
        ], req.user?.id || 'system');

        await AccountingService.postGLEntry(glEntry.id, req.user?.id || 'system');
        await sequelize.query('UPDATE bill_discounts SET discount_gl_entry_id = :glId WHERE id = :id',
          { replacements: { glId: glEntry.id, id }, transaction: t });
      }
    } catch (glErr) {
      console.error('GL entry for discount failed:', glErr.message);
    }

    await t.commit();
    res.json({ id, discount_number: discountNumber, discount_amount: calcAmount });
  } catch (error) {
    await t.rollback();
    console.error('Error applying discount:', error);
    res.status(500).json({ error: 'Failed to apply discount' });
  }
});

// ============ WRITE-OFFS ============

// Write off the remaining balance of a bill as bad debt
router.post('/bills/:billId/write-off', authorize(BILLING_WRITE), async (req, res) => {
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

    // Dr. Bad Debt Expense, Cr. Accounts Receivable
    try {
      const AccountingService = require('../services/AccountingService');
      const badDebtAccount = await AccountingService.getAccountByCode(bill.clinic_id, '5700');
      // Same receivable the bill was originally booked to (1210 for insurance-scheme
      // bills, 1200 otherwise) — see the matching comment in the discount handler above.
      const receivablesAccount = await AccountingService.getReceivableAccount(bill.clinic_id, bill.scheme_id);

      if (badDebtAccount && receivablesAccount) {
        const glEntry = await AccountingService.createGLEntry({
          clinic_id: bill.clinic_id,
          transaction_date: new Date(),
          transaction_type: 'bad_debt_write_off',
          description: `Write-off Bill ${bill.bill_number} - ${reason || 'No reason'}`,
          reference_id: id,
          reference_module: 'bill_write_off',
          transaction_currency: bill.bill_currency,
        }, [
          { account_id: badDebtAccount.id, debit_amount: writeOffAmount, credit_amount: 0, description: `Bad debt: ${reason || 'Write-off'}` },
          { account_id: receivablesAccount.id, debit_amount: 0, credit_amount: writeOffAmount, description: `AR write-off: ${bill.bill_number}` }
        ], req.user?.id || 'system');

        await AccountingService.postGLEntry(glEntry.id, req.user?.id || 'system');
        await sequelize.query('UPDATE bill_write_offs SET write_off_gl_entry_id = :glId WHERE id = :id',
          { replacements: { glId: glEntry.id, id }, transaction: t });
      }
    } catch (glErr) {
      console.error('GL entry for write-off failed:', glErr.message);
    }

    await t.commit();
    res.json({ id, write_off_number: writeOffNumber, write_off_amount: writeOffAmount });
  } catch (error) {
    await t.rollback();
    console.error('Error writing off bill:', error);
    res.status(500).json({ error: 'Failed to write off bill' });
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
router.post('/credit-notes', authorize(BILLING_WRITE), async (req, res) => {
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
        reason, reason_details, status, created_by)
      VALUES (:id, :clinicId, :cn, :billId, :patientId, :patientName, CURRENT_DATE,
        :amount, :currency, :reason, :details, 'created', :createdBy)
    `, {
      replacements: {
        id, clinicId: bill.clinic_id, cn: creditNoteNumber,
        billId: original_bill_id, patientId: bill.patient_id,
        patientName: bill.patient_name, amount: credit_amount,
        currency: credit_currency || 'SSP', reason: reason || 'adjustment',
        details: reason_details || '', createdBy: req.user?.id || null
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
router.put('/credit-notes/:id/approve', authorize(BILLING_WRITE), async (req, res) => {
  try {
    const { id } = req.params;
    await sequelize.query(`
      UPDATE credit_notes SET status = 'approved', approved_by = :userId, approval_date = NOW()
      WHERE id = :id AND status = 'created'
    `, { replacements: { id, userId: req.user?.id || null } });
    const [note] = await sequelize.query('SELECT * FROM credit_notes WHERE id = :id', { replacements: { id } });
    res.json(note[0]);
  } catch (error) {
    console.error('Error approving credit note:', error);
    res.status(500).json({ error: 'Failed to approve credit note' });
  }
});

// Apply credit note to bill
router.put('/credit-notes/:id/apply', authorize(BILLING_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { applied_to_bill_id } = req.body;

    const [notes] = await sequelize.query(
      'SELECT * FROM credit_notes WHERE id = :id AND status = :status',
      { replacements: { id, status: 'approved' }, transaction: t }
    );
    if (notes.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'Credit note not found or not approved' });
    }
    const note = notes[0];
    const targetBillId = applied_to_bill_id || note.original_bill_id;

    // Reduce bill balance
    await sequelize.query(`
      UPDATE patient_bills SET
        paid_amount = paid_amount + :amount,
        balance_amount = GREATEST(0, balance_amount - :amount),
        status = CASE WHEN balance_amount - :amount <= 0 THEN 'paid' ELSE 'partial' END
      WHERE id = :billId
    `, { replacements: { amount: note.credit_amount, billId: targetBillId }, transaction: t });

    // Update credit note
    await sequelize.query(`
      UPDATE credit_notes SET status = 'applied', applied_to_bill_id = :billId,
        applied_date = CURRENT_DATE, applied_amount = :amount
      WHERE id = :id
    `, { replacements: { billId: targetBillId, amount: note.credit_amount, id }, transaction: t });

    // Create GL reversal (Cr. Revenue, Dr. AR)
    try {
      const AccountingService = require('../services/AccountingService');
      const revenueAccount = await AccountingService.getAccountByCode(note.clinic_id, '4100');
      // credit_notes doesn't carry scheme_id/currency itself — look them up from the
      // bill this note is actually being applied against, same as discount/write-off above.
      const [targetBillRows] = await sequelize.query(
        'SELECT scheme_id, bill_currency FROM patient_bills WHERE id = :billId',
        { replacements: { billId: targetBillId }, transaction: t }
      );
      const receivablesAccount = await AccountingService.getReceivableAccount(note.clinic_id, targetBillRows[0]?.scheme_id);

      if (revenueAccount && receivablesAccount) {
        const glEntry = await AccountingService.createGLEntry({
          clinic_id: note.clinic_id,
          transaction_date: new Date(),
          transaction_type: 'credit_note',
          description: `Credit Note ${note.credit_note_number} - ${note.reason || 'adjustment'}`,
          reference_id: id,
          transaction_currency: targetBillRows[0]?.bill_currency,
          reference_module: 'credit_note'
        }, [
          { account_id: revenueAccount.id, debit_amount: note.credit_amount, credit_amount: 0, description: `Revenue reversal: ${note.credit_note_number}` },
          { account_id: receivablesAccount.id, debit_amount: 0, credit_amount: note.credit_amount, description: `AR credit: ${note.credit_note_number}` }
        ], req.user?.id || 'system');

        await AccountingService.postGLEntry(glEntry.id, req.user?.id || 'system');
        await sequelize.query('UPDATE credit_notes SET credit_gl_entry_id = :glId WHERE id = :id',
          { replacements: { glId: glEntry.id, id }, transaction: t });
      }
    } catch (glErr) {
      console.error('GL entry for credit note failed:', glErr.message);
    }

    await t.commit();
    res.json({ message: 'Credit note applied', applied_amount: note.credit_amount });
  } catch (error) {
    await t.rollback();
    console.error('Error applying credit note:', error);
    res.status(500).json({ error: 'Failed to apply credit note' });
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

    const [notes] = await sequelize.query(`
      SELECT cn.*, pb.bill_number AS original_bill_number
      FROM credit_notes cn
      LEFT JOIN patient_bills pb ON cn.original_bill_id = pb.id
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
    const [notes] = await sequelize.query(`
      SELECT cn.*, pb.bill_number AS original_bill_number
      FROM credit_notes cn
      LEFT JOIN patient_bills pb ON cn.original_bill_id = pb.id
      WHERE cn.id = :id
    `, { replacements: { id: req.params.id } });
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
router.post('/patient-insurance', authorize(BILLING_WRITE), async (req, res) => {
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
router.put('/patient-insurance/:id', authorize(BILLING_WRITE), async (req, res) => {
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
router.put('/bills/:billId/apply-insurance', authorize(BILLING_WRITE), async (req, res) => {
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
router.post('/insurance-claims/:billId', authorize(BILLING_WRITE), async (req, res) => {
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
        currency: bill.bill_currency || 'SSP', createdBy: req.user?.id || null
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
router.put('/insurance-claims/:id', authorize(BILLING_WRITE), async (req, res) => {
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
        SELECT balance_amount, total_amount, paid_amount, COALESCE(bill_currency, 'SSP') AS bill_currency,
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
      SELECT COALESCE(bill_currency, 'SSP') AS bill_currency,
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
router.post('/receivables/:billId/follow-up', authorize(BILLING_WRITE), async (req, res) => {
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
      SELECT pb.patient_id, pb.patient_name, COALESCE(pb.bill_currency, 'SSP') AS bill_currency,
        COUNT(*) AS bill_count,
        COALESCE(SUM(pb.total_amount), 0) AS total_billed,
        COALESCE(SUM(pb.paid_amount), 0) AS total_paid,
        COALESCE(SUM(pb.balance_amount), 0) AS total_outstanding,
        MIN(pb.due_date) AS oldest_due_date,
        MAX(((CURRENT_DATE)::date - (pb.due_date)::date)) AS max_days_overdue
      FROM patient_bills pb
      WHERE pb.clinic_id = :clinicId AND pb.balance_amount > 0 AND pb.status != 'paid'
      GROUP BY pb.patient_id, pb.patient_name, COALESCE(pb.bill_currency, 'SSP')
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

    if (sums.length > 0) {
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
        default_currency: 'SSP', default_payment_terms: 'immediate', default_due_date_days: 30,
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
router.put('/settings/:clinicId', authorize(BILLING_WRITE), async (req, res) => {
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
