const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /accounting/cash-transfer, so the API enforces what the client already assumes.
const router = express.Router();
const { LedgerAccount } = require('../models');
const { getBranchCondition, getCreateBranchId } = require('../middleware/branchFilter');
const { postJournalEntry } = require('../services/JournalPostingService');

// Note: this file previously also defined a `postToChartOfAccounts` helper
// that duplicated the POST / route's own inline posting logic below, with the
// two copies already drifting apart (this route uses fromAccount.clinic_id,
// the helper re-looked accounts up by name). The helper was never actually
// called from anywhere — removed rather than kept in sync by hand.

// Get all cash transfers
router.get('/', async (req, res) => {
  try {
    const { CashTransfer } = require('../models');
    const transfers = await CashTransfer.findAll({
      where: { ...getBranchCondition(req) },
      order: [['created_at', 'DESC']],
      limit: 100
    });
    res.json(transfers);
  } catch (error) {
    console.error('Error fetching transfers:', error);
    res.json([]);
  }
});

// Create new cash transfer
router.post('/', authorize('cash_transfers.write'), async (req, res) => {
  try {
    const { from_account_id, to_account_id, amount, notes } = req.body;

    if (!from_account_id || !to_account_id || !amount) {
      return res.status(400).json({ error: 'Missing required fields: from_account_id, to_account_id, amount' });
    }

    const { ChartOfAccounts, AccountLedger, CashTransfer, sequelize } = require('../models');

    const [fromAccount, toAccount] = await Promise.all([
      ChartOfAccounts.findByPk(from_account_id),
      ChartOfAccounts.findByPk(to_account_id)
    ]);

    if (!fromAccount) return res.status(404).json({ error: 'Source account not found' });
    if (!toAccount)   return res.status(404).json({ error: 'Destination account not found' });

    const amt = parseFloat(amount);
    if (amt <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
    const clinic_id = fromAccount.clinic_id;
    const today = new Date().toISOString().split('T')[0];

    // Neither the client nor this route checked whether the source account
    // actually held enough balance before transferring — a transfer could
    // silently overdraw an account with no warning. balance_type-aware, same
    // convention as the chart-of-accounts current_balance calculation.
    {
      const ledgerTotals = await AccountLedger.findOne({
        where: { account_id: from_account_id, is_posted: true },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('debit_amount')), 'total_debit'],
          [sequelize.fn('SUM', sequelize.col('credit_amount')), 'total_credit']
        ],
        raw: true
      });
      const opening = parseFloat(fromAccount.opening_balance || 0);
      const totalDebit = parseFloat(ledgerTotals?.total_debit || 0);
      const totalCredit = parseFloat(ledgerTotals?.total_credit || 0);
      const currentBalance = fromAccount.balance_type === 'debit'
        ? opening + totalDebit - totalCredit
        : opening + totalCredit - totalDebit;
      if (amt > currentBalance) {
        return res.status(400).json({ error: `Insufficient balance in ${fromAccount.account_name}. Available: ${currentBalance.toFixed(2)}, requested: ${amt.toFixed(2)}` });
      }
    }

    // Cash transfers are always within the chart of accounts, in whatever the
    // deployment's actual base currency is — hardcoding 'SSP' mislabeled every
    // transfer once a facility's base currency was ever reconfigured.
    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'SSP';

    const t = await sequelize.transaction();
    try {
      // Record the transfer history. cash_transfers.created_by is an INT (the user's id),
      // unlike journal_entries.created_by below which is a free-text varchar — the literal
      // string 'system' used to be passed here too and MySQL rejected it outright
      // ("Incorrect integer value: 'system'"), so every transfer failed after the
      // account-id fix. Record who actually performed it instead.
      const transfer = await CashTransfer.create({
        from_account_id,
        from_account_name: fromAccount.account_name,
        to_account_id,
        to_account_name: toAccount.account_name,
        amount: amt,
        notes: notes || 'Cash transfer',
        created_by: req.user?.id || null,
        branch_id: getCreateBranchId(req)
      }, { transaction: t });

      // N2/N3: shared posting helper, same transaction as the transfer record above.
      const glBranchId = getCreateBranchId(req);
      await postJournalEntry({
        clinicId: clinic_id, branchId: glBranchId, transaction: t, entryDate: today, currency: baseCurrency,
        description: `Cash Transfer: ${fromAccount.account_name} → ${toAccount.account_name}`,
        narration: notes || 'Cash transfer',
        reference: `CT-${transfer.id}`,
        // DEBIT destination, CREDIT source
        lines: [
          { accountId: toAccount.id, debit: amt, description: `Transfer from ${fromAccount.account_name}` },
          { accountId: fromAccount.id, credit: amt, description: `Transfer to ${toAccount.account_name}` },
        ],
        userId: 'system', sourceModule: 'cash_transfer',
      });

      await t.commit();

      res.json({ message: 'Transfer completed successfully', transfer });
    } catch (err) {
      await t.rollback();
      throw err;
    }
  } catch (error) {
    console.error('Cash transfer error:', error.message);
    res.status(500).json({ error: 'Failed to complete transfer', details: error.message });
  }
});

module.exports = router;
