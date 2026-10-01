const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /receipts, so the API enforces what the client already assumes.
const router = express.Router();
const { Receipt, PatientBill, ChartOfAccounts, JournalEntries, JournalEntryLines, AccountLedger, sequelize } = require('../models');
const { normalizeServices } = require('../utils/normalizeServices');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const BillingIntegrationService = require('../services/BillingIntegrationService');
const { getBranchCondition, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { adjustDepositBalance, BASE_CURRENCY } = require('./patientDeposits');
const { postJournalEntry } = require('../services/JournalPostingService');
const { requireApprovalPermission, userHasApprovalPermission } = require('../middleware/requireApprovalPermission');

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
// N2: requires the caller's own transaction and throws on failure — see
// postDepositGL's own comment in patientDeposits.js for why.
async function reverseDepositUsageGL({ clinicId, branchId, amount, currency, reference, description, userId, transaction, entryDate }) {
  const arAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '1200', is_active: true }, transaction });
  const depositsHeld = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '2150', is_active: true }, transaction });
  if (!arAccount || !depositsHeld) {
    throw new Error('Cannot reverse this deposit-funded payment — the receivable (1200) or Patient Deposits Held (2150) account is missing.');
  }
  const today = entryDate || new Date().toISOString().split('T')[0];
  return postJournalEntry({
    clinicId, branchId, transaction, entryDate: today, description, reference, currency,
    lines: [
      { accountId: arAccount.id, debit: amount, description },
      { accountId: depositsHeld.id, credit: amount, description },
    ],
    userId,
  });
}

// Reverses the GL/JE posting made for a payment when its receipt is voided/refunded.
// Mirrors the payment-posting logic in patientBills.js's add-payment route (same
// account-selection rules) and reverseDepositUsageGL's own pattern below (a new
// offsetting entry, not a mutation of the original — preserves the audit trail).
// Deposit-funded receipts are NOT handled here — restoreDepositForVoidedReceipt /
// reverseDepositUsageGL already reverse those on their own, separate account (2150
// Patient Deposits Held), and running both would double-reverse the receivable.
// N2: requires the caller's own transaction and throws on failure (see
// postDepositGL).
async function reversePaymentGL({ clinicId, branchId, billId, amount, paymentMethod, reference, description, userId, transaction, entryDate }) {
  const method = (paymentMethod || 'cash').toLowerCase();
  if (method === 'deposit' || amount <= 0) return null;

  // Find the account this specific payment actually debited, rather than
  // re-deriving "the current default cash account".
  //
  // Which account cash collections prefer has changed over time — from Cash at
  // Hand to Cash, and it could change again — so re-deriving it here for an
  // old receipt would reverse the wrong account: crediting back an account the
  // original payment never touched, and leaving the one it did touch
  // permanently overstated. The original journal entry is right there, tagged
  // with this receipt's own reference, so this uses that instead.
  let originalDebitAccount = null;
  const originalJE = reference
    ? await JournalEntries.findOne({ where: { clinic_id: clinicId, reference }, transaction })
    : null;
  if (originalJE) {
    const originalLine = await JournalEntryLines.findOne({
      where: { je_id: originalJE.id, debit_amount: { [Op.gt]: 0 } }, transaction,
    });
    if (originalLine) {
      originalDebitAccount = await ChartOfAccounts.findByPk(originalLine.account_id, { transaction });
    }
  }

  // No original entry to go on — a receipt from before this posting method
  // existed, or one whose posting failed at the time. Fall back to today's
  // preference, same as a forward payment would resolve.
  if (!originalDebitAccount) {
    if (method === 'cash') {
      originalDebitAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '1100', is_active: true }, transaction })
        || await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_type: 'asset', is_active: true, account_name: { [Op.iLike]: 'cash' } }, transaction })
        || await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_type: 'asset', is_active: true, account_name: { [Op.iLike]: '%cash%' } }, order: [['account_code', 'ASC']], transaction });
    } else {
      // card, mobile_money, bank_transfer, insurance — all posted to the main bank account originally
      originalDebitAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, is_bank_account: true, is_active: true }, order: [['account_code', 'ASC']], transaction })
        || await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_type: 'asset', is_active: true }, order: [['account_code', 'ASC']], transaction });
    }
  }

  const bill = billId ? await PatientBill.findByPk(billId, { transaction }) : null;
  const receivableCode = bill?.scheme_id ? '1210' : '1200';
  const receivableAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: receivableCode, is_active: true }, transaction })
    || await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '1200', is_active: true }, transaction });

  if (!originalDebitAccount || !receivableAccount) {
    throw new Error(`Cannot reverse this payment — missing ${!originalDebitAccount ? 'the original payment' : 'the receivable'} account for clinic ${clinicId}.`);
  }

  // C1: reverse at the ORIGINAL entry's currency and rate, not today's — this
  // used to hardcode 'SSP'/1:1, so voiding a USD payment reversed only the
  // raw USD number as if it were the same number of SSP. originalJE (found
  // above by this receipt's own RCP-<id> reference) is the source of truth
  // for what was actually posted; only a receipt with no traceable original
  // entry (pre-dating this posting method) falls back to the bill's own
  // currency at today's rate.
  const reversalCurrency = originalJE?.transaction_currency || bill?.bill_currency;
  const reversalRate = originalJE?.transaction_currency ? parseFloat(originalJE.exchange_rate) : undefined;

  const today = entryDate || new Date().toISOString().split('T')[0];
  return postJournalEntry({
    clinicId, branchId, transaction, entryDate: today, description, reference,
    currency: reversalCurrency, exchangeRate: reversalRate,
    // Reversal of the original Dr [cash/bank] / Cr [receivable]: the receivable
    // goes back up, the cash/bank it was never actually kept in goes back down.
    lines: [
      { accountId: receivableAccount.id, debit: amount, description },
      { accountId: originalDebitAccount.id, credit: amount, description },
    ],
    userId,
  });
}

// Best-effort: restores a patient's deposit balance when a receipt that was paid via
// 'deposit' gets voided/refunded — otherwise the money would just vanish from the
// patient's spendable balance with no way to use it again, even though the bill it paid
// is (by the reversal logic above) no longer considered paid. Mirrors
// restoreInventoryForVoidedServices's own best-effort, own-transaction style.
// N2: shares the caller's transaction — the deposit-balance restore and its
// GL reversal used to be two separate best-effort transactions, either of
// which could silently fail while the receipt status changed anyway.
async function restoreDepositForVoidedReceipt(receipt, reason, processedBy, transaction) {
  if (receipt.payment_method !== 'deposit') return;
  const amount = parseFloat(receipt.payment_amount) || 0;
  if (amount <= 0) return;
  const bill = receipt.bill_id ? await PatientBill.findByPk(receipt.bill_id, { transaction }) : null;
  const currency = bill?.bill_currency || BASE_CURRENCY;

  await adjustDepositBalance(transaction, {
    patientId: receipt.patient_id, patientName: receipt.patient_name, clinicId: receipt.clinic_id,
    branchId: receipt.branch_id, currency, type: 'usage_reversal', amount,
    billId: receipt.bill_id, reversedReceiptId: receipt.id,
    notes: reason || 'Deposit payment reversed', createdBy: processedBy,
  });

  await reverseDepositUsageGL({
    clinicId: receipt.clinic_id, branchId: receipt.branch_id, amount, currency,
    reference: `RCP-${receipt.id}`,
    description: `Deposit payment reversed — receipt ${receipt.receipt_number}`,
    userId: processedBy, transaction,
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
// B5: the actual reversal (bill balance/services, deposit, GL) that an
// active -> voided/refunded transition implies — extracted so the immediate
// path (a requester who already holds receipt_void_approve) and the separate
// /approve-void endpoint (someone else approving a pending request) run the
// exact same logic rather than two copies that could drift apart.
async function applyVoidReversal(receipt, status, reason, req, t) {
  let reversedServices = [];
  let billForInventoryRestore = null;

  if (receipt.bill_id) {
    const bill = await PatientBill.findByPk(receipt.bill_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (bill) {
      // Deep clone the array so Sequelize detects the mutation
      let updatedServices = JSON.parse(JSON.stringify(normalizeServices(bill.services)));

      // Reverse paid status for specific services
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
      }, { transaction: t });

      if (reversedServices.length > 0) billForInventoryRestore = bill;
    }
  }

  // Independent of whether a bill_id/bill was found above — a deposit
  // receipt reversal only ever needs the receipt itself.
  await restoreDepositForVoidedReceipt(receipt, reason, req.user?.displayName || req.user?.email, t);

  // Reverse the GL entry the original payment posted (cash/card/mobile/bank/insurance —
  // everything restoreDepositForVoidedReceipt's own reversal doesn't already cover).
  // Without this, voiding a receipt fixed the bill's balance but left the ledger showing
  // cash/bank received and the receivable cleared, permanently, for a payment that was
  // just reversed.
  await reversePaymentGL({
    clinicId: receipt.clinic_id,
    branchId: receipt.branch_id,
    billId: receipt.bill_id,
    amount: parseFloat(receipt.payment_amount) || 0,
    paymentMethod: receipt.payment_method,
    reference: `RCP-${receipt.id}`,
    description: `Receipt ${status} — ${receipt.receipt_number}${reason ? ` (${reason})` : ''}`,
    userId: req.user?.displayName || req.user?.email,
    transaction: t,
  });

  return { reversedServices, billForInventoryRestore };
}

const PENDING_FOR = { voided: 'pending_void', refunded: 'pending_refund' };
const TARGET_FOR_PENDING = { pending_void: 'voided', pending_refund: 'refunded' };

router.put('/:receiptId/status', authorize('receipts.write'), async (req, res) => {
  // N2: the receipt/bill status change and the GL reversal it implies now
  // commit or roll back together — previously each reversal step opened (or
  // skipped) its own separate transaction, called fire-and-forget after the
  // receipt had already been updated, and swallowed failures as "non-fatal".
  // That let a receipt end up "voided" with the bill still showing paid, or
  // the ledger still showing cash received for a payment the UI said was
  // reversed.
  let t;
  try {
    const { receiptId } = req.params;
    const { status, reason } = req.body;

    if (!['active', 'voided', 'refunded'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // B2: the receipt row (and, below, the bill row) are locked for the rest
    // of this handler — without this, two concurrent void/refund requests for
    // the SAME receipt (a double-click, or two staff acting on the same
    // payment within the same second) both read previousStatus === 'active',
    // both pass the B3 terminal-state guard, and both run the reversal below:
    // the bill's balance gets decremented twice and reversePaymentGL posts
    // the GL reversal twice for one real payment. A concurrent request now
    // blocks on this lock and re-reads the just-committed status once it's
    // this call's turn, so the second one correctly hits the B3 guard instead.
    t = await sequelize.transaction();
    const receipt = await Receipt.findByPk(receiptId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!receipt) {
      await t.rollback();
      return res.status(404).json({ error: 'Receipt not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(receipt, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      await t.rollback();
      return res.status(403).json({ error: 'Access denied to this receipt' });
    }

    const previousStatus = receipt.status;

    // B3: voided/refunded/pending_void/pending_refund are all terminal from
    // THIS endpoint's point of view. The only reversal logic here runs on an
    // active -> voided/refunded transition; nothing here undoes THAT
    // reversal, so flipping a voided/refunded receipt back to active (or
    // across to the other terminal state) would silently update just the
    // status column while the bill balance, services, deposit and GL entries
    // stay reversed. A pending_void/pending_refund receipt can only be moved
    // forward through /approve-void or /reject-void below — not by calling
    // this endpoint again, which would let a requester skip approval by
    // simply re-submitting. A genuine correction needs a new receipt, not
    // resurrecting this one.
    if (previousStatus !== 'active' && status !== previousStatus) {
      await t.rollback();
      const humanStatus = previousStatus.startsWith('pending_')
        ? `awaiting approval (${previousStatus})`
        : `already ${previousStatus}`;
      return res.status(400).json({ error: `This receipt is ${humanStatus} and cannot be changed to ${status}. ${previousStatus.startsWith('pending_') ? 'Use approve-void/reject-void.' : 'Record a new receipt instead.'}` });
    }

    // B5: an active -> voided/refunded request needs a second person's
    // sign-off before the reversal actually happens — a cashier could
    // otherwise void/refund their own payment unilaterally, with no record
    // that anyone but them ever looked at it. Someone who already holds
    // receipt_void_approve (which every admin does, per
    // requireApprovalPermission's own admin-bypass rule) can still act
    // immediately, exactly as before this fix — this only adds a gate for
    // everyone else, it does not remove the ability for an authorized person
    // to void/refund in one step.
    if (previousStatus === 'active' && ['voided', 'refunded'].includes(status)) {
      const canActImmediately = await userHasApprovalPermission(req, 'receipt_void_approve');
      if (!canActImmediately) {
        const pendingStatus = PENDING_FOR[status];
        const updatedReceipt = await receipt.update({
          status: pendingStatus,
          notes: reason ? `Requested ${status}: ${reason}` : `Requested ${status}`,
          updated_at: new Date(),
        }, { transaction: t });
        await t.commit();

        try {
          const rr = require('./reports');
          await rr.logAudit({ req,
            clinic_id: receipt.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
            module: 'Billing', action: 'RECEIPT_VOID_REQUESTED',
            entity_type: 'Receipt', entity_id: receiptId,
            description: `${req.user?.displayName || req.user?.email || 'A user'} requested ${status} on receipt ${receipt.receipt_number} (${receipt.payment_amount}) — awaiting approval${reason ? `: ${reason}` : ''}`,
            old_values: { status: previousStatus }, new_values: { status: pendingStatus, reason: reason || null },
            ip_address: req.ip, status: 'success',
          });
        } catch (e) {}

        return res.json({
          message: `Void/refund request submitted for approval`,
          pendingApproval: true,
          receipt: updatedReceipt,
        });
      }
    }

    const updatedReceipt = await receipt.update({
      status,
      notes: reason ? `${status.charAt(0).toUpperCase() + status.slice(1)}: ${reason}` : undefined,
      updated_at: new Date()
    }, { transaction: t });

    let reversedServices = [];
    let billForInventoryRestore = null;
    if (previousStatus === 'active' && ['voided', 'refunded'].includes(status)) {
      ({ reversedServices, billForInventoryRestore } = await applyVoidReversal(receipt, status, reason, req, t));
    }

    await t.commit();

    // Best-effort, outside the transaction — stock/audit are not accounting
    // postings and are not what N2 covers.
    if (billForInventoryRestore) {
      await restoreInventoryForVoidedServices(billForInventoryRestore, reversedServices, reason, req.user?.displayName || req.user?.email).catch((e) =>
        console.error(`Receipt ${receipt.receipt_number}: status changed but inventory restore failed —`, e.message));
    }

    if (previousStatus !== status) {
      try {
        const rr = require('./reports');
        await rr.logAudit({ req,
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
    if (t && !t.finished) await t.rollback().catch(() => {});
    console.error('Error updating receipt status:', error);
    res.status(error.message?.startsWith('Cannot reverse') ? 400 : 500).json({ error: error.message || 'Failed to update receipt status' });
  }
});

// B5: approve a pending void/refund request — the second person's sign-off.
// Runs the exact same reversal applyVoidReversal above runs for an
// immediately-privileged requester, just triggered by whoever approves it
// instead of whoever requested it.
router.post('/:receiptId/approve-void', requireApprovalPermission('receipt_void_approve'), async (req, res) => {
  let t;
  try {
    const { receiptId } = req.params;
    const { reason } = req.body;

    t = await sequelize.transaction();
    const receipt = await Receipt.findByPk(receiptId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!receipt) {
      await t.rollback();
      return res.status(404).json({ error: 'Receipt not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(receipt, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      await t.rollback();
      return res.status(403).json({ error: 'Access denied to this receipt' });
    }

    const targetStatus = TARGET_FOR_PENDING[receipt.status];
    if (!targetStatus) {
      await t.rollback();
      return res.status(400).json({ error: `This receipt has no pending void/refund request to approve (current status: ${receipt.status}).` });
    }

    const updatedReceipt = await receipt.update({
      status: targetStatus,
      notes: reason ? `Approved — ${targetStatus}: ${reason}` : `Approved — ${targetStatus}`,
      updated_at: new Date(),
    }, { transaction: t });

    const { reversedServices, billForInventoryRestore } = await applyVoidReversal(receipt, targetStatus, reason, req, t);
    await t.commit();

    if (billForInventoryRestore) {
      await restoreInventoryForVoidedServices(billForInventoryRestore, reversedServices, reason, req.user?.displayName || req.user?.email).catch((e) =>
        console.error(`Receipt ${receipt.receipt_number}: approved but inventory restore failed —`, e.message));
    }

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: receipt.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Billing', action: 'RECEIPT_VOID_APPROVED',
        entity_type: 'Receipt', entity_id: receiptId,
        description: `${req.user?.displayName || req.user?.email || 'A user'} approved ${targetStatus} on receipt ${receipt.receipt_number} (${receipt.payment_amount})${reason ? ` — ${reason}` : ''}`,
        old_values: { status: receipt.status }, new_values: { status: targetStatus, reason: reason || null },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ message: `Receipt ${targetStatus} successfully`, receipt: updatedReceipt });
  } catch (error) {
    if (t && !t.finished) await t.rollback().catch(() => {});
    console.error('Error approving receipt void/refund:', error);
    res.status(error.message?.startsWith('Cannot reverse') ? 400 : 500).json({ error: error.message || 'Failed to approve void/refund' });
  }
});

// B5: reject a pending void/refund request — back to active, no reversal
// applied (none was ever applied while pending).
router.post('/:receiptId/reject-void', requireApprovalPermission('receipt_void_approve'), async (req, res) => {
  let t;
  try {
    const { receiptId } = req.params;
    const { reason } = req.body;

    t = await sequelize.transaction();
    const receipt = await Receipt.findByPk(receiptId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!receipt) {
      await t.rollback();
      return res.status(404).json({ error: 'Receipt not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(receipt, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      await t.rollback();
      return res.status(403).json({ error: 'Access denied to this receipt' });
    }

    if (!TARGET_FOR_PENDING[receipt.status]) {
      await t.rollback();
      return res.status(400).json({ error: `This receipt has no pending void/refund request to reject (current status: ${receipt.status}).` });
    }

    const previousStatus = receipt.status;
    const updatedReceipt = await receipt.update({
      status: 'active',
      notes: reason ? `Void/refund request rejected: ${reason}` : 'Void/refund request rejected',
      updated_at: new Date(),
    }, { transaction: t });
    await t.commit();

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: receipt.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Billing', action: 'RECEIPT_VOID_REJECTED',
        entity_type: 'Receipt', entity_id: receiptId,
        description: `${req.user?.displayName || req.user?.email || 'A user'} rejected the ${previousStatus} request on receipt ${receipt.receipt_number} (${receipt.payment_amount})${reason ? ` — ${reason}` : ''}`,
        old_values: { status: previousStatus }, new_values: { status: 'active', reason: reason || null },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ message: 'Void/refund request rejected', receipt: updatedReceipt });
  } catch (error) {
    if (t && !t.finished) await t.rollback().catch(() => {});
    console.error('Error rejecting receipt void/refund:', error);
    res.status(500).json({ error: error.message || 'Failed to reject void/refund' });
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
// Exported for tests only (receiptReversalCurrency.test.js — C1): asserting
// the reversal picks up the ORIGINAL entry's currency/rate needs to call
// this directly rather than through the HTTP surface.
module.exports.reversePaymentGL = reversePaymentGL;
