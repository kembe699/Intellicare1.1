const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /cashier/shift, so the API enforces what the client already assumes.
const CASHIER_WRITE = ['admin', 'reception', 'pharmacy', 'cashier'];
const router = express.Router();
const { CashierShift, Receipt, sequelize } = require('../models');
const { Op } = require('sequelize');
const { getBranchCondition } = require('../middleware/branchFilter');

// Sequelize's DataTypes.JSON auto-parse depends on the MySQL wire protocol reporting the
// column as JSON-typed, but MariaDB (common on shared hosts) stores JSON columns as plain
// LONGTEXT under the hood and never sets that flag — so the same query that returns a
// parsed object on real MySQL silently returns the raw string on MariaDB, and any `.map()`
// on receipt.service_details/paid_services downstream crashes with "x.map is not a
// function". Normalize explicitly here so it works the same on both.
function parseJSONField(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}
function normalizeReceipt(r) {
  const plain = typeof r?.toJSON === 'function' ? r.toJSON() : r;
  return {
    ...plain,
    paid_services: parseJSONField(plain.paid_services, []),
    service_details: parseJSONField(plain.service_details, []),
  };
}

// Reconciliation needs to compare physically-counted cash against expected cash only
// (not card/mobile money), and needs to know how much cash was transferred out of the
// drawer mid-shift. Neither column existed before — add them the MySQL-safe way.
(async () => {
  for (const [col, def] of [
    ['expected_cash', 'DECIMAL(15,2)'],
    ['cash_variance', 'DECIMAL(15,2)'],
    ['cash_transferred', 'DECIMAL(15,2) DEFAULT 0'],
  ]) {
    try {
      await sequelize.query(`ALTER TABLE cashier_shifts ADD COLUMN ${col} ${def}`);
    } catch (e) {
      if (e.original?.code !== 'ER_DUP_FIELDNAME') console.warn(`Could not add cashier_shifts.${col}:`, e.message);
    }
  }
})();

// A shift's receipts are the *cashier's own* active receipts in the time window — not
// every receipt in the branch, which would double-count when two cashiers work the same
// branch concurrently, and not voided/refunded receipts, which never touched the drawer.
async function getShiftReceipts(req, shift, endTime) {
  return Receipt.findAll({
    where: {
      ...getBranchCondition(req),
      cashier_id: shift.cashier_id,
      status: 'active',
      created_at: {
        [Op.gte]: new Date(shift.start_time),
        [Op.lte]: endTime || new Date()
      }
    },
    order: [['created_at', 'DESC']]
  });
}

// Same window/cashier as getShiftReceipts, but for reconciliation: voided and refunded
// receipts never touched the drawer (excluded from the cash count above) but still need
// to surface on the cashier's end-of-day report so finance can see what was reversed.
async function getShiftReceiptsByStatus(req, shift, endTime, statuses) {
  return Receipt.findAll({
    where: {
      ...getBranchCondition(req),
      cashier_id: shift.cashier_id,
      status: { [Op.in]: statuses },
      created_at: {
        [Op.gte]: new Date(shift.start_time),
        [Op.lte]: endTime || new Date()
      }
    },
    order: [['created_at', 'DESC']]
  });
}

// Credit invoices this cashier raised during the shift window — created_by is stored as
// the same numeric user id used for cashier_id elsewhere, just in a char(36) column.
async function getShiftInvoices(shift, endTime) {
  const [rows] = await sequelize.query(
    `SELECT id, invoice_number, patient_name, amount, amount_paid, balance_due, currency, status, scheme_name, created_at
     FROM invoices
     WHERE created_by = :cashierId AND created_at >= :startTime AND created_at <= :endTime
     ORDER BY created_at DESC`,
    { replacements: { cashierId: String(shift.cashier_id), startTime: new Date(shift.start_time), endTime: endTime || new Date() } }
  );
  return rows;
}

// Cash transferred out of the drawer during this shift (tagged by transfer-cash with
// reference SHIFT-<id>) must be netted out of expected cash, or a cashier who correctly
// transfers cash to the safe mid-shift would show a false "short" at close-out.
async function getShiftCashTransferred(shift) {
  const { JournalEntries } = require('../models');
  const total = await JournalEntries.sum('total_debit', {
    where: { reference: `SHIFT-${shift.id}`, status: 'posted' }
  });
  return parseFloat(total || 0);
}

/**
 * Post a double-entry journal entry to Chart of Accounts for a cash transfer.
 * Silently skips if matching CoA accounts are not found.
 */
async function postToChartOfAccounts(fromAccountName, toAccountName, transferAmount, referenceId, notesText) {
  try {
    const { ChartOfAccounts, JournalEntries, JournalEntryLines, AccountLedger, sequelize } = require('../models');

    const [coaFrom, coaTo] = await Promise.all([
      ChartOfAccounts.findOne({ where: { account_name: { [Op.iLike]: fromAccountName } } }),
      ChartOfAccounts.findOne({ where: { account_name: { [Op.iLike]: toAccountName } } })
    ]);

    if (!coaFrom || !coaTo) {
      console.log(`CoA posting skipped — from:"${fromAccountName}" found:${!!coaFrom}, to:"${toAccountName}" found:${!!coaTo}`);
      return;
    }

    const clinic_id = coaFrom.clinic_id;
    const today = new Date().toISOString().split('T')[0];
    const amt = parseFloat(transferAmount);

    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const lastJE = await JournalEntries.findOne({
      where: { clinic_id, je_number: { [Op.like]: `JE-${year}${month}-%` } },
      order: [['je_number', 'DESC']]
    });
    const seq = lastJE ? parseInt(lastJE.je_number.split('-').pop()) + 1 : 1;
    const jeNumber = `JE-${year}${month}-${String(seq).padStart(4, '0')}`;

    const t = await sequelize.transaction();
    try {
      const je = await JournalEntries.create({
        clinic_id,
        je_number: jeNumber,
        entry_date: today,
        description: `Cash Transfer: ${fromAccountName} → ${toAccountName}`,
        narration: notesText || 'Cash transfer',
        reference: `CT-${referenceId}`,
        transaction_currency: 'SSP',
        base_currency: 'SSP',
        exchange_rate: 1.0,
        total_debit: amt,
        total_credit: amt,
        base_total_debit: amt,
        base_total_credit: amt,
        status: 'posted',
        created_by: 'system',
        posted_by: 'system',
        posted_date: new Date()
      }, { transaction: t });

      await JournalEntryLines.bulkCreate([
        { je_id: je.id, account_id: coaTo.id, debit_amount: amt, credit_amount: 0, base_debit_amount: amt, base_credit_amount: 0, description: `Transfer from ${fromAccountName}` },
        { je_id: je.id, account_id: coaFrom.id, debit_amount: 0, credit_amount: amt, base_debit_amount: 0, base_credit_amount: amt, description: `Transfer to ${toAccountName}` }
      ], { transaction: t });

      await AccountLedger.bulkCreate([
        { clinic_id, account_id: coaTo.id, transaction_date: today, debit_amount: amt, credit_amount: 0, reference_number: jeNumber, description: `Cash Transfer from ${fromAccountName}`, is_posted: true, posted_date: new Date(), source_module: 'cash_transfer' },
        { clinic_id, account_id: coaFrom.id, transaction_date: today, debit_amount: 0, credit_amount: amt, reference_number: jeNumber, description: `Cash Transfer to ${toAccountName}`, is_posted: true, posted_date: new Date(), source_module: 'cash_transfer' }
      ], { transaction: t });

      await t.commit();
      console.log(`CoA journal entry posted: ${jeNumber}`);
    } catch (err) {
      await t.rollback();
      console.error('Failed to post journal entry for cashier transfer:', err.message);
    }
  } catch (err) {
    console.error('Error in postToChartOfAccounts (cashier):', err.message);
  }
}

router.get('/current-shift', async (req, res) => {
  try {
    console.log('=== CURRENT SHIFT REQUEST ===');
    const userId = req.user?.id;
    console.log('User ID:', userId);
    
    if (!userId) {
      console.log('No user ID, returning 401');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    console.log('Looking for active shift for user:', userId);
    const shift = await CashierShift.findOne({
      where: { cashier_id: userId, status: 'open' },
      order: [['start_time', 'DESC']]
    });
    
    console.log('Active shift found:', shift ? { id: shift.id, status: shift.status } : 'NOT FOUND');
    
    if (!shift) {
      // 200 with null, not 404. "Nobody has opened a till yet" is a normal
      // state, not a failure, and four screens ask this question on load — so a
      // 404 put a red error in the browser console every time any of them
      // opened, which is how a genuine failure goes unnoticed.
      return res.json(null);
    }
    
    console.log('Returning active shift');
    res.json(shift);
  } catch (error) {
    console.error('Error fetching current shift:', error);
    res.status(500).json({ error: 'Failed to fetch shift' });
  }
});

router.get('/shifts', async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Build where clause based on role and filters
    const whereClause = {};
    
    // Non-admins can only see their own shifts
    if (userRole !== 'admin') {
      whereClause.cashier_id = userId;
    } else if (req.query.cashierId) {
      // Admin reconciling a specific cashier's activity
      whereClause.cashier_id = parseInt(req.query.cashierId);
    }

    // Apply status filter if provided
    if (req.query.status) {
      whereClause.status = req.query.status;
    }
    
    // Apply date range filters if provided
    if (req.query.startDate || req.query.endDate) {
      whereClause.start_time = {};
      if (req.query.startDate) {
        whereClause.start_time[Op.gte] = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        endDate.setHours(23, 59, 59, 999); // End of day
        whereClause.start_time[Op.lte] = endDate;
      }
    }
    
    const shifts = await CashierShift.findAll({
      where: whereClause,
      order: [['start_time', 'DESC']],
      limit: req.query.limit ? parseInt(req.query.limit) : 100
    });

    // Calculate real-time totals for each shift (open shifts only — closed shifts already
    // have their final totals frozen at close-shift time and shouldn't drift as new
    // unrelated receipts land after the shift ended)
    const shiftsWithTotals = await Promise.all(shifts.map(async (shift) => {
      if (shift.status === 'closed') return shift.toJSON();
      const receipts = await getShiftReceipts(req, shift, new Date());
      const actualTotalAmount = receipts.reduce((sum, r) => sum + parseFloat(r.payment_amount || 0), 0);
      return {
        ...shift.toJSON(),
        total_amount: actualTotalAmount,
        total_receipts: receipts.length
      };
    }));

    res.json(shiftsWithTotals);
  } catch (error) {
    console.error('Fetch shifts error:', error);
    res.status(500).json({ error: 'Failed to fetch shifts' });
  }
});

// Every cashier who has ever run a shift — feeds the admin "filter by cashier" dropdown
// on the Cashier Shift page without needing a separate roles/users lookup.
router.get('/cashiers', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const [rows] = await sequelize.query(
      `SELECT DISTINCT cashier_id, cashier_name FROM cashier_shifts ORDER BY cashier_name ASC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cashiers' });
  }
});

// End-of-day reconciliation report for a single shift: what was actually collected, what
// was voided/refunded (reversed, never touched the drawer), and what was invoiced instead
// of collected — everything finance needs to reconcile one cashier's shift in one place.
router.get('/shift/:shiftId/report', async (req, res) => {
  try {
    const shift = await CashierShift.findByPk(req.params.shiftId);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    if (userRole !== 'admin' && shift.cashier_id !== userId) {
      return res.status(403).json({ error: 'Access denied: You can only view your own shift report' });
    }

    const endTime = shift.end_time ? new Date(shift.end_time) : new Date();
    const [activeReceipts, voidedReceipts, refundedReceipts, invoices] = await Promise.all([
      getShiftReceipts(req, shift, endTime),
      getShiftReceiptsByStatus(req, shift, endTime, ['voided']),
      getShiftReceiptsByStatus(req, shift, endTime, ['refunded']),
      getShiftInvoices(shift, endTime),
    ]);

    // A deposit refund is its own separate 'active' receipt (money leaving the drawer),
    // not a status flip on the original deposit receipt (which also stays 'active') — so
    // treating every active receipt's payment_amount as money collected double-counts a
    // refund as money received twice. Sign it negative here so every collected total
    // (cash/card/mobile/overall) nets it out correctly, symmetric with the deposit itself
    // adding to collected.
    const signedAmount = (r) => {
      const magnitude = Math.abs(parseFloat(r.payment_amount) || 0);
      return r.receipt_type === 'deposit_refund' ? -magnitude : magnitude;
    };
    const sumBy = (list, pred) => list.filter(pred).reduce((sum, r) => sum + signedAmount(r), 0);
    const totals = {
      collectedCash: sumBy(activeReceipts, r => r.payment_method === 'cash'),
      collectedCard: sumBy(activeReceipts, r => r.payment_method === 'card'),
      collectedMobile: sumBy(activeReceipts, r => r.payment_method === 'mobile_money'),
      collectedOther: sumBy(activeReceipts, r => !['cash', 'card', 'mobile_money'].includes(r.payment_method)),
      collectedTotal: activeReceipts.reduce((sum, r) => sum + signedAmount(r), 0),
      voidedTotal: voidedReceipts.reduce((sum, r) => sum + Math.abs(parseFloat(r.payment_amount) || 0), 0),
      refundedTotal: refundedReceipts.reduce((sum, r) => sum + Math.abs(parseFloat(r.payment_amount) || 0), 0),
      invoicedTotal: invoices.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0),
      invoicedCollected: invoices.reduce((sum, r) => sum + (parseFloat(r.amount_paid) || 0), 0),
    };

    res.json({
      shift,
      activeReceipts: activeReceipts.map(normalizeReceipt),
      voidedReceipts: voidedReceipts.map(normalizeReceipt),
      refundedReceipts: refundedReceipts.map(normalizeReceipt),
      invoices,
      totals,
    });
  } catch (error) {
    console.error('Shift report error:', error);
    res.status(500).json({ error: 'Failed to build shift report' });
  }
});

router.get('/shift/:shiftId/receipts', async (req, res) => {
  try {
    const shift = await CashierShift.findByPk(req.params.shiftId);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    
    // Security: Allow admins to view all shifts, others only their own
    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Allow admins to view any shift, others only their own
    if (userRole !== 'admin' && shift.cashier_id !== userId) {
      return res.status(403).json({ error: 'Access denied: You can only view your own shift receipts' });
    }
    
    const endTime = shift.end_time ? new Date(shift.end_time) : new Date();
    const receipts = await getShiftReceipts(req, shift, endTime);
    res.json(receipts.map(normalizeReceipt));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

router.post('/start-shift', authorize(CASHIER_WRITE), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const existing = await CashierShift.findOne({
      where: { cashier_id: userId, status: 'open' }
    });
    if (existing) return res.status(400).json({ error: 'Shift already open' });

    const shift = await CashierShift.create({
      cashier_id: userId,
      cashier_name: req.user?.email || 'Cashier',
      opening_balance: req.body.opening_balance || 0,
      status: 'open'
    });
    res.status(201).json(shift);
  } catch (error) {
    console.error('Start shift error:', error);
    res.status(500).json({ error: 'Failed to start shift', details: error.message });
  }
});

router.post('/close-shift/:shiftId', authorize(CASHIER_WRITE), async (req, res) => {
  try {
    const shift = await CashierShift.findByPk(req.params.shiftId);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    if (shift.status === 'closed') return res.status(400).json({ error: 'Already closed' });
    
    // Security: Ensure user can only close their own shifts
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (shift.cashier_id !== userId) {
      return res.status(403).json({ error: 'Access denied: You can only close your own shifts' });
    }

    const endTime = new Date();
    const receipts = await getShiftReceipts(req, shift, endTime);
    // Same deposit-refund sign fix as the shift report (GET /shift/:shiftId/report) —
    // a deposit refund is real cash physically leaving the drawer during this shift, so it
    // must reduce expected cash, not add to it like every other active receipt does.
    const signedAmount = (r) => {
      const magnitude = parseFloat(r.payment_amount || 0);
      return r.receipt_type === 'deposit_refund' ? -magnitude : magnitude;
    };
    const totalAmount = receipts.reduce((sum, r) => sum + signedAmount(r), 0);
    const cashTotal = receipts
      .filter(r => r.payment_method === 'cash')
      .reduce((sum, r) => sum + signedAmount(r), 0);
    const cashTransferred = await getShiftCashTransferred(shift);

    // Expected cash is what should physically be in the drawer: opening float + cash
    // takings, minus anything already moved out to the safe/bank mid-shift. Card and
    // mobile money payments never touch the drawer, so they're excluded on purpose.
    const expectedCash = parseFloat(shift.opening_balance || 0) + cashTotal - cashTransferred;
    const closingBalance = parseFloat(req.body.closing_balance || 0);
    const cashVariance = Math.round((closingBalance - expectedCash) * 100) / 100;

    await shift.update({
      end_time: endTime,
      closing_balance: closingBalance,
      total_receipts: receipts.length,
      total_amount: totalAmount,
      expected_cash: Math.round(expectedCash * 100) / 100,
      cash_variance: cashVariance,
      cash_transferred: cashTransferred,
      status: 'closed',
      notes: req.body.notes
    });
    res.json(shift);
  } catch (error) {
    res.status(500).json({ error: 'Failed to close shift' });
  }
});

router.post('/transfer-cash', authorize(CASHIER_WRITE), async (req, res) => {
  try {
    const { shift_id, amount, to_account_id, notes } = req.body;
    const { ChartOfAccounts, AccountLedger, JournalEntries, JournalEntryLines, sequelize: seq } = require('../models');

    if (!to_account_id || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'to_account_id and a positive amount are required' });
    }

    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (shift_id) {
      const shift = await CashierShift.findByPk(shift_id);
      if (!shift) return res.status(404).json({ error: 'Shift not found' });
      if (userRole !== 'admin' && shift.cashier_id !== userId) {
        return res.status(403).json({ error: 'Access denied: You can only transfer cash from your own shift' });
      }
    }

    // Find "Cash at Hand" (or nearest cash asset) in Chart of Accounts
    const cashAtHandAccount = await ChartOfAccounts.findOne({
      where: seq.where(
        seq.fn('LOWER', seq.col('account_name')),
        { [Op.iLike]: '%cash at hand%' }
      )
    }) || await ChartOfAccounts.findOne({
      where: seq.where(
        seq.fn('LOWER', seq.col('account_name')),
        { [Op.iLike]: '%cash in hand%' }
      )
    }) || await ChartOfAccounts.findOne({
      where: seq.where(
        seq.fn('LOWER', seq.col('account_name')),
        { [Op.iLike]: '%petty cash%' }
      )
    }) || await ChartOfAccounts.findOne({
      where: { account_type: 'asset', is_active: true },
      order: [['account_code', 'ASC']]
    });

    if (!cashAtHandAccount) {
      return res.status(404).json({ error: 'No cash account found in Chart of Accounts. Please create one first.' });
    }

    const toAccount = await ChartOfAccounts.findByPk(to_account_id);
    if (!toAccount) {
      return res.status(404).json({ error: 'Destination account not found' });
    }

    const amt = parseFloat(amount);
    const clinic_id = cashAtHandAccount.clinic_id;
    const today = new Date().toISOString().split('T')[0];

    // Don't allow transferring out more cash than is actually recorded as sitting in the
    // drawer — otherwise the ledger goes negative while the UI still calls it a balance.
    const ledgerTotals = await AccountLedger.findOne({
      where: { account_id: cashAtHandAccount.id, is_posted: true },
      attributes: [
        [seq.fn('SUM', seq.col('debit_amount')), 'total_debit'],
        [seq.fn('SUM', seq.col('credit_amount')), 'total_credit']
      ],
      raw: true
    });
    const opening = parseFloat(cashAtHandAccount.opening_balance || 0);
    const totalDebit = parseFloat(ledgerTotals?.total_debit || 0);
    const totalCredit = parseFloat(ledgerTotals?.total_credit || 0);
    const currentCashBalance = cashAtHandAccount.balance_type === 'debit'
      ? opening + totalDebit - totalCredit
      : opening + totalCredit - totalDebit;
    if (amt > currentCashBalance) {
      return res.status(400).json({
        error: `Insufficient cash at hand balance. Available: ${currentCashBalance.toFixed(2)}, requested: ${amt.toFixed(2)}`
      });
    }

    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const lastJE = await JournalEntries.findOne({
      where: { clinic_id, je_number: { [Op.like]: `JE-${year}${month}-%` } },
      order: [['je_number', 'DESC']]
    });
    const jeSeq = lastJE ? parseInt(lastJE.je_number.split('-').pop()) + 1 : 1;
    const jeNumber = `JE-${year}${month}-${String(jeSeq).padStart(4, '0')}`;

    const t = await seq.transaction();
    try {
      const je = await JournalEntries.create({
        clinic_id,
        je_number: jeNumber,
        entry_date: today,
        description: `Cash Transfer: ${cashAtHandAccount.account_name} → ${toAccount.account_name}`,
        narration: notes || 'Cash transfer from shift',
        reference: `SHIFT-${shift_id || 'manual'}`,
        transaction_currency: 'SSP',
        base_currency: 'SSP',
        exchange_rate: 1.0,
        total_debit: amt,
        total_credit: amt,
        base_total_debit: amt,
        base_total_credit: amt,
        status: 'posted',
        created_by: 'system',
        posted_by: 'system',
        posted_date: new Date()
      }, { transaction: t });

      await JournalEntryLines.bulkCreate([
        { je_id: je.id, account_id: toAccount.id,          debit_amount: amt, credit_amount: 0,   base_debit_amount: amt, base_credit_amount: 0,   description: `Transfer from ${cashAtHandAccount.account_name}` },
        { je_id: je.id, account_id: cashAtHandAccount.id,  debit_amount: 0,   credit_amount: amt, base_debit_amount: 0,   base_credit_amount: amt, description: `Transfer to ${toAccount.account_name}` }
      ], { transaction: t });

      await AccountLedger.bulkCreate([
        { clinic_id, account_id: toAccount.id,         transaction_date: today, debit_amount: amt, credit_amount: 0,   reference_number: jeNumber, description: `Cash Transfer from ${cashAtHandAccount.account_name}`, is_posted: true, posted_date: new Date(), source_module: 'cash_transfer' },
        { clinic_id, account_id: cashAtHandAccount.id, transaction_date: today, debit_amount: 0,   credit_amount: amt, reference_number: jeNumber, description: `Cash Transfer to ${toAccount.account_name}`,          is_posted: true, posted_date: new Date(), source_module: 'cash_transfer' }
      ], { transaction: t });

      await t.commit();

      res.json({
        message: 'Cash transferred successfully',
        from_account: cashAtHandAccount.account_name,
        to_account: toAccount.account_name,
        amount: amt,
        je_number: jeNumber
      });
    } catch (err) {
      await t.rollback();
      throw err;
    }
  } catch (error) {
    console.error('Cashier transfer-cash error:', error.message);
    res.status(500).json({ error: 'Failed to transfer cash', details: error.message });
  }
});

module.exports = router;
