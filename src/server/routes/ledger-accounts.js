const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /accounting, so the API enforces what the client already assumes.
const LEDGER_WRITE = ['admin', 'accountant', 'finance_manager'];
const router = express.Router();
const { LedgerAccount } = require('../models');

// Get all ledger accounts
router.get('/', async (req, res) => {
  try {
    const accounts = await LedgerAccount.findAll({
      order: [['account_code', 'ASC']]
    });
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching ledger accounts:', error);
    res.status(500).json({ error: 'Failed to fetch ledger accounts' });
  }
});

// Get single ledger account
router.get('/:id', async (req, res) => {
  try {
    const account = await LedgerAccount.findByPk(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json(account);
  } catch (error) {
    console.error('Error fetching ledger account:', error);
    res.status(500).json({ error: 'Failed to fetch ledger account' });
  }
});

// Create new ledger account
router.post('/', authorize(LEDGER_WRITE), async (req, res) => {
  try {
    // Validate before writing. Without this the missing field surfaced as a 500
    // from the database driver, which reads to the caller as "the server broke"
    // rather than "you left something out".
    if (!req.body?.account_name) {
      return res.status(400).json({ error: 'account_name is required' });
    }
    const { account_name, account_code, account_type, parent_account_id, description } = req.body;
    
    const account = await LedgerAccount.create({
      account_name,
      account_code,
      account_type,
      parent_account_id: parent_account_id || null,
      description,
      balance: 0.00
    });
    
    res.status(201).json(account);
  } catch (error) {
    console.error('Error creating ledger account:', error);
    res.status(500).json({ error: 'Failed to create ledger account', details: error.message });
  }
});

// Update ledger account
router.put('/:id', authorize(LEDGER_WRITE), async (req, res) => {
  try {
    const { account_name, account_code, account_type, parent_account_id, description } = req.body;
    
    const account = await LedgerAccount.findByPk(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    await account.update({
      account_name,
      account_code,
      account_type,
      parent_account_id: parent_account_id || null,
      description
    });
    
    res.json(account);
  } catch (error) {
    console.error('Error updating ledger account:', error);
    res.status(500).json({ error: 'Failed to update ledger account' });
  }
});

// Delete ledger account
router.delete('/:id', authorize(LEDGER_WRITE), async (req, res) => {
  try {
    const account = await LedgerAccount.findByPk(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    // Check if account has sub-accounts
    const subAccounts = await LedgerAccount.count({
      where: { parent_account_id: req.params.id }
    });
    
    if (subAccounts > 0) {
      return res.status(400).json({ error: 'Cannot delete account with sub-accounts' });
    }
    
    await account.destroy();
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting ledger account:', error);
    res.status(500).json({ error: 'Failed to delete ledger account' });
  }
});

module.exports = router;
