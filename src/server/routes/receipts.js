const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /receipts, so the API enforces what the client already assumes.
const RECEIPT_WRITE = ['admin', 'reception', 'doctor', 'pharmacy', 'cashier'];
const router = express.Router();
const { Receipt, PatientBill, ChartOfAccounts, JournalEntries, JournalEntryLines, AccountLedger, sequelize } = require('../models');
const { normalizeServices } = require('../utils/normalizeServices');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const BillingIntegrationService = require('../services/BillingIntegrationService');
const { getBranchCondition, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { adjustDepositBalance, BASE_CURRENCY } = require('./patientDeposits');

// receipts.paid_services/service_details are JSON columns, but this host's MariaDB
// stores JSON as LONGTEXT under the hood (same issue documented in lisModule.js's
// parseJSONField and cashier.js) — mysql2 can't tell it's JSON and hands back the raw
// string instead of an array. Every route below used to res.json(receipt) straight from
// Sequelize with neither field ever parsed, so the frontend's `.length > 0` truthy check
// on the raw string passed, then `.map()` on that string crashed the whole page
// (Receipts.tsx: "O.map is not a function"). normalizeServices always returns a real array.
function serializeReceipt(receipt) {
  const plain = receipt.toJSON ? receipt.toJSON() : receipt;
  return {
    ...plain,
    paid_services: normalizeServices(plain.paid_services),
    service_details: normalizeServices(plain.service_details),
  };
}

// Mirrors postDepositGL's account resolution in patientDeposits.js, but for the one pair
// that function doesn't cover: reversing a deposit-funded bill payment restores the AR
// balance that receipt.js's own bill-reversal logic above already put back (Debit 1200),
// and needs the matching Credit 2150 to bring "Patient Deposits Held" back up by the same
// amount adjustDepositBalance() just restored on the ledger side.
async function reverseDepositUsageGL({ clinicId, amount, reference, description, userId }) {
  try {
    const arAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '1200', is_active: true } });
    const depositsHeld = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '2150', is_active: true } });
    if (!arAccount || !depositsHeld) return;
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const lastJE = await JournalEntries.findOne({
      where: { clinic_id: clinicId, je_number: { [Op.like]: `JE-${year}${month}-%` } },
      order: [['je_number', 'DESC']]
    });
    const jeSeq = lastJE ? parseInt(lastJE.je_number.split('-').pop()) + 1 : 1;
    const jeNumber = `JE-${year}${month}-${String(jeSeq).padStart(4, '0')}`;
    const today = new Date().toISOString().split('T')[0];

    const t2 = await sequelize.transaction();
    try {
      const je = await JournalEntries.create({
        clinic_id: clinicId, je_number: jeNumber, entry_date: today, description,
        narration: reference, reference, transaction_currency: BASE_CURRENCY, base_currency: BASE_CURRENCY,
        exchange_rate: 1.0, total_debit: amount, total_credit: amount, base_total_debit: amount, base_total_credit: amount,
        status: 'posted', created_by: userId || 'system', posted_by: userId || 'system', posted_date: new Date(),
      }, { transaction: t2 });
      await JournalEntryLines.bulkCreate([
        { je_id: je.id, account_id: arAccount.id, debit_amount: amount, credit_amount: 0, base_debit_amount: amount, base_credit_amount: 0, description },
        { je_id: je.id, account_id: depositsHeld.id, debit_amount: 0, credit_amount: amount, base_debit_amount: 0, base_credit_amount: amount, description },
      ], { transaction: t2 });
      await AccountLedger.bulkCreate([
        { clinic_id: clinicId, account_id: arAccount.id, transaction_date: today, debit_amount: amount, credit_amount: 0, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'billing' },
        { clinic_id: clinicId, account_id: depositsHeld.id, transaction_date: today, debit_amount: 0, credit_amount: amount, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'billing' },
      ], { transaction: t2 });
      await t2.commit();
    } catch (jeErr) {
      await t2.rollback();
      console.warn('Non-fatal: failed to post deposit-reversal GL:', jeErr.message);
    }
  } catch (coaErr) {
    console.warn('Non-fatal: deposit-reversal GL posting skipped:', coaErr.message);
  }
}

// Reverses the GL/JE posting made for a payment when its receipt is voided/refunded.
// Mirrors the payment-posting logic in patientBills.js's add-payment route (same
// account-selection rules) and reverseDepositUsageGL's own pattern below (a new
// offsetting entry, not a mutation of the original — preserves the audit trail).
// Deposit-funded receipts are NOT handled here — restoreDepositForVoidedReceipt /
// reverseDepositUsageGL already reverse those on their own, separate account (2150
// Patient Deposits Held), and running both would double-reverse the receivable.
async function reversePaymentGL({ clinicId, billId, amount, paymentMethod, reference, description, userId }) {
  try {
    const method = (paymentMethod || 'cash').toLowerCase();
    if (method === 'deposit' || amount <= 0) return;

    let originalDebitAccount = null;
    if (method === 'cash') {
      originalDebitAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_name: { [Op.iLike]: 'cash at hand' }, is_active: true } })
        || await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_type: 'asset', is_active: true, account_name: { [Op.iLike]: '%cash%' } }, order: [['account_code', 'ASC']] });
    } else {
      // card, mobile_money, bank_transfer, insurance — all posted to the main bank account originally
      originalDebitAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, is_bank_account: true, is_active: true }, order: [['account_code', 'ASC']] })
        || await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_type: 'asset', is_active: true }, order: [['account_code', 'ASC']] });
    }

    const bill = billId ? await PatientBill.findByPk(billId) : null;
    const receivableCode = bill?.scheme_id ? '1210' : '1200';
    const receivableAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: receivableCode, is_active: true } })
      || await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '1200', is_active: true } });

    if (!originalDebitAccount || !receivableAccount) {
      console.warn(`Non-fatal: could not reverse payment GL for voided receipt — missing account for clinic ${clinicId}`);
      return;
    }

    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const lastJE = await JournalEntries.findOne({
      where: { clinic_id: clinicId, je_number: { [Op.like]: `JE-${year}${month}-%` } },
      order: [['je_number', 'DESC']]
    });
    const jeSeq = lastJE ? parseInt(lastJE.je_number.split('-').pop()) + 1 : 1;
    const jeNumber = `JE-${year}${month}-${String(jeSeq).padStart(4, '0')}`;
    const today = new Date().toISOString().split('T')[0];

    const t2 = await sequelize.transaction();
    try {
      const je = await JournalEntries.create({
        clinic_id: clinicId, je_number: jeNumber, entry_date: today, description,
        narration: reference, reference, transaction_currency: 'SSP', base_currency: 'SSP',
        exchange_rate: 1.0, total_debit: amount, total_credit: amount, base_total_debit: amount, base_total_credit: amount,
        status: 'posted', created_by: userId || 'system', posted_by: userId || 'system', posted_date: new Date(),
      }, { transaction: t2 });
      // Reversal of the original Dr [cash/bank] / Cr [receivable]: the receivable
      // goes back up, the cash/bank it was never actually kept in goes back down.
      await JournalEntryLines.bulkCreate([
        { je_id: je.id, account_id: receivableAccount.id, debit_amount: amount, credit_amount: 0, base_debit_amount: amount, base_credit_amount: 0, description },
        { je_id: je.id, account_id: originalDebitAccount.id, debit_amount: 0, credit_amount: amount, base_debit_amount: 0, base_credit_amount: amount, description },
      ], { transaction: t2 });
      await AccountLedger.bulkCreate([
        { clinic_id: clinicId, account_id: receivableAccount.id, transaction_date: today, debit_amount: amount, credit_amount: 0, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'billing' },
        { clinic_id: clinicId, account_id: originalDebitAccount.id, transaction_date: today, debit_amount: 0, credit_amount: amount, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'billing' },
      ], { transaction: t2 });
      await t2.commit();
    } catch (jeErr) {
      await t2.rollback();
      console.warn('Non-fatal: failed to post payment-reversal GL:', jeErr.message);
    }
  } catch (coaErr) {
    console.warn('Non-fatal: payment-reversal GL posting skipped:', coaErr.message);
  }
}

// Best-effort: restores a patient's deposit balance when a receipt that was paid via
// 'deposit' gets voided/refunded — otherwise the money would just vanish from the
// patient's spendable balance with no way to use it again, even though the bill it paid
// is (by the reversal logic above) no longer considered paid. Mirrors
// restoreInventoryForVoidedServices's own best-effort, own-transaction style.
async function restoreDepositForVoidedReceipt(receipt, reason, processedBy) {
  if (receipt.payment_method !== 'deposit') return;
  const amount = parseFloat(receipt.payment_amount) || 0;
  if (amount <= 0) return;
  const bill = receipt.bill_id ? await PatientBill.findByPk(receipt.bill_id) : null;
  const currency = bill?.bill_currency || BASE_CURRENCY;

  const t = await sequelize.transaction();
  try {
    await adjustDepositBalance(t, {
      patientId: receipt.patient_id, patientName: receipt.patient_name, clinicId: receipt.clinic_id,
      branchId: receipt.branch_id, currency, type: 'usage_reversal', amount,
      billId: receipt.bill_id, reversedReceiptId: receipt.id,
      notes: reason || 'Deposit payment reversed', createdBy: processedBy,
    });
    await t.commit();
  } catch (e) {
    await t.rollback();
    console.warn('Non-fatal: failed to restore deposit balance for voided receipt:', e.message);
    return;
  }

  reverseDepositUsageGL({
    clinicId: receipt.clinic_id, amount, reference: `RCP-${receipt.id}`,
    description: `Deposit payment reversed — receipt ${receipt.receipt_number}`, userId: processedBy,
  });
}

// Best-effort: restores pharmacy stock for any dispensed drug whose charge was just
// un-paid by a receipt void/refund. There's no direct FK from a bill service line to
// the dispensing_records row it came from, so this matches on patient + drug name +
// quantity (same heuristic used when a not-yet-dispensed prescription line is removed
// elsewhere) and only touches records still in 'dispensed' status — anything already
// returned or partially returned is left alone rather than risk a double reversal.
async function restoreInventoryForVoidedServices(bill, reversedServices, reason, processedBy) {
  for (const svc of reversedServices) {
    const drugName = svc.serviceName || svc.name;
    const qty = parseFloat(svc.quantity);
    if (!drugName || !qty) continue;

    const t = await sequelize.transaction();
    try {
      const [matches] = await sequelize.query(`
        SELECT dr.* FROM dispensing_records dr
        JOIN inventory_items ii ON ii.id = dr.inventory_item_id
        WHERE dr.patient_id = :pid AND dr.status = 'dispensed'
          AND LOWER(ii.item_name) = LOWER(:name) AND dr.quantity_dispensed = :qty
        ORDER BY dr.dispensing_date DESC, dr.created_at DESC LIMIT 1
      `, { replacements: { pid: bill.patient_id, name: drugName, qty }, transaction: t });

      if (matches.length === 0) { await t.rollback(); continue; }
      const record = matches[0];

      const retId = uuidv4();
      const retNum = `RET-${record.dispensing_number}`;
      await sequelize.query(`
        INSERT INTO dispensing_returns (id, clinic_id, return_number, dispensing_record_id,
          return_date, return_reason, quantity_returned, amount_refunded, refund_method, processed_by, notes)
        VALUES (:id, :cid, :rn, :drid, CURRENT_DATE, :reason, :qty, :amt, 'cash', :by, :notes)
      `, {
        replacements: {
          id: retId, cid: record.clinic_id, rn: retNum, drid: record.id,
          reason: 'receipt_voided', qty, amt: 0, by: processedBy || null,
          notes: reason ? `Receipt voided: ${reason}` : 'Receipt voided'
        },
        transaction: t
      });

      if (record.inventory_item_id) {
        const invTxnId = uuidv4();
        await sequelize.query(`
          INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
            quantity_change, from_location_id, batch_id, unit_cost, total_cost,
            reference_type, reference_id, transaction_date, notes, created_by)
          VALUES (:id, :cid, :txn, :iid, 'return_from_patient', :qty, :flid, :bid, 0, 0,
            'return', :ref, CURRENT_DATE, :notes, :by)
        `, {
          replacements: {
            id: invTxnId, cid: record.clinic_id, txn: `TXN-RET-${record.dispensing_number}`,
            iid: record.inventory_item_id, qty, flid: record.from_location_id || null,
            bid: record.batch_id || null, ref: retNum, notes: 'Receipt voided', by: processedBy || null
          },
          transaction: t
        });

        await sequelize.query('UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + :qty WHERE id = :id',
          { replacements: { qty, id: record.inventory_item_id }, transaction: t });
        if (record.batch_id) {
          await sequelize.query('UPDATE inventory_batches SET quantity_used = GREATEST(0, quantity_used - :qty) WHERE id = :id',
            { replacements: { qty, id: record.batch_id }, transaction: t });
        }
        await sequelize.query('UPDATE dispensing_returns SET inventory_reversal_done = true, inventory_transaction_id = :tid WHERE id = :id',
          { replacements: { tid: invTxnId, id: retId }, transaction: t });
      }

      await sequelize.query(
        "UPDATE dispensing_records SET status = 'returned', return_date = CURRENT_DATE, return_reason = 'receipt_voided' WHERE id = :id",
        { replacements: { id: record.id }, transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      console.error('Failed to restore inventory for voided receipt service:', drugName, err);
    }
  }
}

// Get all receipts for a clinic
router.get('/clinic/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { bill_id } = req.query;
    
    let whereClause = { 
      clinic_id: parseInt(clinicId),
      status: { [Op.in]: ['active', 'voided', 'refunded'] },
      ...getBranchCondition(req)
    };
    
    // If bill_id is provided, filter by it
    if (bill_id) {
      whereClause.bill_id = bill_id;
    }
    
    const receipts = await Receipt.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']]
    });

    // Attach the patient's own reference (UH-203920, a participant number), not
    // the internal row id. receipts.patient_id holds the foreign key, and the
    // receipts list was printing that raw UUID beside every name — noise to a
    // cashier, and useless for finding anyone. Looked up in one pass rather than
    // per row.
    const ids = [...new Set(receipts.map((r) => r.patient_id).filter(Boolean))];
    const refs = new Map();
    if (ids.length > 0) {
      const [rows] = await sequelize.query(
        `SELECT id, patient_id AS ref FROM patients WHERE id IN (:ids)
          UNION ALL
         SELECT id, participant_number AS ref FROM lis_participants WHERE id IN (:ids)`,
        { replacements: { ids } },
      ).catch(() => [[]]);
      for (const row of rows || []) if (row.ref) refs.set(String(row.id), row.ref);
    }

    res.json(receipts.map((r) => {
      const out = serializeReceipt(r);
      out.patient_ref = refs.get(String(r.patient_id)) || null;
      return out;
    }));
  } catch (error) {
    console.error('Error fetching receipts:', error);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

// Get a specific receipt by ID
router.get('/:receiptId', async (req, res) => {
  try {
    const { receiptId } = req.params;
    
    const receipt = await Receipt.findByPk(receiptId);
    
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(receipt, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this receipt' });
    }
    
    res.json(serializeReceipt(receipt));
  } catch (error) {
    console.error('Error fetching receipt:', error);
    res.status(500).json({ error: 'Failed to fetch receipt' });
  }
});

// Get receipts by patient
router.get('/patient/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { clinicId } = req.query;
    
    const whereClause = { patient_id: patientId, ...BranchQueryFilter.buildBranchWhere(req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' }) };
    if (clinicId) {
      whereClause.clinic_id = parseInt(clinicId);
    }
    
    const receipts = await Receipt.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']]
    });

    res.json(receipts.map(serializeReceipt));
  } catch (error) {
    console.error('Error fetching patient receipts:', error);
    res.status(500).json({ error: 'Failed to fetch patient receipts' });
  }
});

// Get receipts by date range
router.get('/clinic/:clinicId/date-range', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }
    
    const receipts = await Receipt.findAll({
      where: {
        clinic_id: parseInt(clinicId),
        ...getBranchCondition(req),
        payment_date: {
          [Op.between]: [new Date(startDate), new Date(endDate)]
        }
      },
      order: [['created_at', 'DESC']]
    });

    res.json(receipts.map(serializeReceipt));
  } catch (error) {
    console.error('Error fetching receipts by date range:', error);
    res.status(500).json({ error: 'Failed to fetch receipts by date range' });
  }
});

// Update receipt status (void/refund)
router.put('/:receiptId/status', authorize(RECEIPT_WRITE), async (req, res) => {
  try {
    const { receiptId } = req.params;
    const { status, reason } = req.body;
    
    if (!['active', 'voided', 'refunded'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const receipt = await Receipt.findByPk(receiptId);
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(receipt, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this receipt' });
    }

    const previousStatus = receipt.status;
    const updatedReceipt = await receipt.update({ 
      status,
      notes: reason ? `${status.charAt(0).toUpperCase() + status.slice(1)}: ${reason}` : undefined,
      updated_at: new Date()
    });

    // If changing from active to voided/refunded, reverse the payment on the bill
    if (previousStatus === 'active' && ['voided', 'refunded'].includes(status) && receipt.bill_id) {
      const bill = await PatientBill.findByPk(receipt.bill_id);
      if (bill) {
        // Deep clone the array so Sequelize detects the mutation
        let updatedServices = JSON.parse(JSON.stringify(normalizeServices(bill.services)));
        
        // Reverse paid status for specific services
        const reversedServices = [];
        if (receipt.paid_services && Array.isArray(receipt.paid_services)) {
          receipt.paid_services.forEach(idx => {
            const index = parseInt(idx, 10);
            if (updatedServices[index] && updatedServices[index].paid) {
              reversedServices.push(updatedServices[index]);
              updatedServices[index].paid = false;
              delete updatedServices[index].paidAt;
              delete updatedServices[index].status;
            }
          });
        }

        const receiptAmount = parseFloat(receipt.payment_amount) || 0;
        let newPaidAmount = Math.max(0, parseFloat(bill.paid_amount) - receiptAmount);
        let newBalanceAmount = parseFloat(bill.total_amount) - newPaidAmount;
        
        let newBillStatus = bill.status;
        if (newBalanceAmount > 0) {
          newBillStatus = newPaidAmount > 0 ? 'partial' : 'pending';
        } else {
          newBillStatus = 'paid';
        }

        await bill.update({
          services: updatedServices,
          paid_amount: newPaidAmount,
          balance_amount: newBalanceAmount,
          status: newBillStatus,
          updated_at: new Date()
        });

        if (reversedServices.length > 0) {
          await restoreInventoryForVoidedServices(bill, reversedServices, reason, req.user?.displayName || req.user?.email);
        }
      }
    }

    // Same active → voided/refunded transition, but independent of whether a bill_id/bill
    // was found above — a deposit receipt reversal only ever needs the receipt itself.
    if (previousStatus === 'active' && ['voided', 'refunded'].includes(status)) {
      await restoreDepositForVoidedReceipt(receipt, reason, req.user?.displayName || req.user?.email);

      // Reverse the GL entry the original payment posted (cash/card/mobile/bank/insurance —
      // everything restoreDepositForVoidedReceipt's own reversal doesn't already cover).
      // Without this, voiding a receipt fixed the bill's balance but left the ledger showing
      // cash/bank received and the receivable cleared, permanently, for a payment that was
      // just reversed.
      await reversePaymentGL({
        clinicId: receipt.clinic_id,
        billId: receipt.bill_id,
        amount: parseFloat(receipt.payment_amount) || 0,
        paymentMethod: receipt.payment_method,
        reference: `RCP-${receipt.id}`,
        description: `Receipt ${status} — ${receipt.receipt_number}${reason ? ` (${reason})` : ''}`,
        userId: req.user?.displayName || req.user?.email,
      });
    }

    if (previousStatus !== status) {
      try {
        const rr = require('./reports');
        await rr.logAudit({
          clinic_id: receipt.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
          module: 'Billing', action: status === 'voided' ? 'RECEIPT_VOIDED' : status === 'refunded' ? 'RECEIPT_REFUNDED' : 'RECEIPT_STATUS_CHANGED',
          entity_type: 'Receipt', entity_id: receiptId,
          description: `Receipt ${receipt.receipt_number} (${receipt.payment_amount}) changed ${previousStatus} → ${status}${reason ? ` — ${reason}` : ''}`,
          old_values: { status: previousStatus }, new_values: { status, reason: reason || null },
          ip_address: req.ip, status: 'success',
        });
      } catch (e) {}
    }

    res.json({
      message: `Receipt ${status} successfully`,
      receipt: updatedReceipt
    });
  } catch (error) {
    console.error('Error updating receipt status:', error);
    res.status(500).json({ error: 'Failed to update receipt status' });
  }
});

// Search receipts
router.get('/clinic/:clinicId/search', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { q, status, paymentMethod, startDate, endDate } = req.query;
    
    const whereClause = { clinic_id: parseInt(clinicId), ...getBranchCondition(req) };
    
    // Add search query
    if (q) {
      whereClause[Op.or] = [
        { receipt_number: { [Op.iLike]: `%${q}%` } },
        { patient_name: { [Op.iLike]: `%${q}%` } },
        { patient_id: { [Op.iLike]: `%${q}%` } },
        { cashier_name: { [Op.iLike]: `%${q}%` } }
      ];
    }
    
    // Add status filter
    if (status && status !== 'all') {
      whereClause.status = status;
    }
    
    // Add payment method filter
    if (paymentMethod && paymentMethod !== 'all') {
      whereClause.payment_method = paymentMethod;
    }
    
    // Add date range filter
    if (startDate && endDate) {
      // endDate arrives as a plain date, which parses to midnight — so asking for
      // "2026-09-08 to 2026-09-08" produced a zero-width window at 00:00 and
      // matched nothing for that day. Run to the end of the closing day instead.
      const from = new Date(startDate);
      const to = new Date(endDate);
      if (!/T/.test(String(endDate))) to.setHours(23, 59, 59, 999);
      whereClause.payment_date = { [Op.between]: [from, to] };
    }
    
    const receipts = await Receipt.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']]
    });

    res.json(receipts.map(serializeReceipt));
  } catch (error) {
    console.error('Error searching receipts:', error);
    res.status(500).json({ error: 'Failed to search receipts' });
  }
});

// Get receipt statistics
router.get('/clinic/:clinicId/stats', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { period = 'today' } = req.query;
    
    let dateFilter = {};
    const now = new Date();
    
    switch (period) {
      case 'today':
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        dateFilter = { payment_date: { [Op.between]: [startOfDay, endOfDay] } };
        break;
      case 'week':
        const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = { payment_date: { [Op.gte]: startOfWeek } };
        break;
      case 'month':
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter = { payment_date: { [Op.gte]: startOfMonth } };
        break;
    }
    
    const receipts = await Receipt.findAll({
      where: {
        clinic_id: parseInt(clinicId),
        ...getBranchCondition(req),
        ...dateFilter
      }
    });
    
    // A voided receipt never touched the drawer, so it must not count towards
    // money collected; a refund did leave the drawer and is already negative, so
    // it nets out on its own. Counting voided receipts made collections read
    // high by their full value.
    const collected = receipts.filter((r) => r.status !== 'voided');
    const stats = {
      totalReceipts: collected.length,
      totalAmount: collected.reduce((sum, r) => sum + (parseFloat(r.payment_amount) || 0), 0),
      activeReceipts: receipts.filter(r => r.status === 'active').length,
      voidedReceipts: receipts.filter(r => r.status === 'voided').length,
      refundedReceipts: receipts.filter(r => r.status === 'refunded').length,
      paymentMethods: {
        cash: receipts.filter(r => r.payment_method === 'cash').length,
        card: receipts.filter(r => r.payment_method === 'card').length,
        check: receipts.filter(r => r.payment_method === 'check').length,
        lease: receipts.filter(r => r.payment_method === 'lease').length,
        insurance: receipts.filter(r => r.payment_method === 'insurance').length
      }
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching receipt statistics:', error);
    res.status(500).json({ error: 'Failed to fetch receipt statistics' });
  }
});

module.exports = router;
