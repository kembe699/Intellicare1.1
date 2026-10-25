const express = require('express');
const { Op } = require('sequelize');
const { 
  ChartOfAccounts, 
  GeneralLedger, 
  GLLineItems,
  JournalEntries,
  JournalEntryLines,
  SuppliersAccounting,
  ExpenseInvoices,
  ExchangeRate,
  sequelize 
} = require('../models');
const AccountingService = require('../services/AccountingService');
const { getNextDocumentNumber } = require('../services/DocumentNumberService');
const CurrencyService = require('../services/CurrencyService');
const { initializeChartOfAccounts } = require('../scripts/initializeChartOfAccounts');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { userHasApprovalPermission } = require('../middleware/requireApprovalPermission');
const { getBranchCondition, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const router = express.Router();

// Non-admin users only see/touch rows from their own branch within a clinic; admins see
// everything. Written inline with named replacements for the raw-SQL queries in this file
// (branchFilter.js's getBranchConditionSQL uses positional `?` placeholders that can't mix
// with the named :params these queries use) — same idea as hr.js's branchScope.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

// Approving/rejecting a journal entry already worked for admin + finance_manager
// via the accounting.journal_entries.approve privilege — that keeps working
// unchanged. This only ADDS a second path: Setup > Approvals can now grant this
// specific authority to someone who isn't a finance_manager, same as every other
// per-user approval grant in the app (procurement, expenses, deposits).
async function canApproveJournalEntry(req) {
  if (req.user?.role === 'admin') return true;
  const roles = [req.user?.role, ...(req.user?.additionalRoles || [])];
  if (roles.includes('finance_manager')) return true;
  return userHasApprovalPermission(req, 'journal_entry_approve');
}

function journalEntryApprovalGate(req, res, next) {
  canApproveJournalEntry(req).then(allowed => {
    if (allowed) return next();
    return res.status(403).json({ error: 'You are not authorized to approve or reject journal entries.' });
  }).catch(error => {
    console.error('Error checking journal entry approval permission:', error);
    res.status(500).json({ error: 'Failed to verify approval permission' });
  });
}

// Chart of accounts / journal entries / exchange rates only carry clinic_id (no
// branch_id, unlike patient billing — see BranchQueryFilter), so their by-ID routes
// need their own clinic check rather than reusing that helper. Without this, any user
// with accounting permissions could view/edit another clinic's financial records just
// by knowing the record's ID, since `authorize()` only gates by role. Admins keep
// cross-clinic visibility (needed for consolidated reporting).
function assertClinicAccess(record, req, res, label) {
  if (req.user?.role === 'admin') return true;
  if (String(record.clinic_id) === String(req.user?.clinicId)) return true;
  res.status(403).json({ error: `Access denied to this ${label}` });
  return false;
}

// Branch-level counterpart to assertClinicAccess, for the tables that now carry
// branch_id (journal_entries, patient_receivables, etc.). Uses the same
// fetch-by-ID-then-check pattern as patients.js/patientBills.js.
function assertBranchAccess(record, req, res, label) {
  const branchContext = req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' };
  if (!BranchQueryFilter.canAccessRecord(record, branchContext)) {
    res.status(403).json({ error: `Access denied to this ${label}` });
    return false;
  }
  return true;
}

// Permission checks below use privilege keys resolved dynamically against
// the Roles & Privileges tables — see src/server/config/permissionsCatalog.js
// for what each key ('accounting.read', 'accounting.rates.read', etc.) grants.

// Add request logging middleware
router.use((req, res, next) => {
  console.log(`=== ACCOUNTING: ${req.method} ${req.url} ===`);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  next();
});

// ============ CHART OF ACCOUNTS ENDPOINTS ============

// Get all accounts for a clinic
router.get('/chart-of-accounts', authorize('accounting.chart_of_accounts.list'), async (req, res) => {
  try {
    const { clinic_id } = req.query;
    
    if (!clinic_id) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }

    const { AccountLedger } = require('../models');

    const accounts = await ChartOfAccounts.findAll({
      where: { clinic_id: parseInt(clinic_id) },
      order: [['account_code', 'ASC']]
    });

    // Compute current_balance for each account from AccountLedger
    const ledgerTotals = await AccountLedger.findAll({
      where: { is_posted: true },
      attributes: [
        'account_id',
        [sequelize.fn('SUM', sequelize.col('debit_amount')), 'total_debit'],
        [sequelize.fn('SUM', sequelize.col('credit_amount')), 'total_credit']
      ],
      group: ['account_id'],
      raw: true
    });

    const ledgerMap = {};
    for (const row of ledgerTotals) {
      ledgerMap[row.account_id] = {
        total_debit: parseFloat(row.total_debit || 0),
        total_credit: parseFloat(row.total_credit || 0)
      };
    }

    const result = accounts.map(acc => {
      const plain = acc.toJSON();
      const ledger = ledgerMap[plain.id] || { total_debit: 0, total_credit: 0 };
      const opening = parseFloat(plain.opening_balance || 0);
      const current_balance = plain.balance_type === 'debit'
        ? opening + ledger.total_debit - ledger.total_credit
        : opening + ledger.total_credit - ledger.total_debit;
      return { ...plain, current_balance };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching chart of accounts:', error);
    res.status(500).json({ error: 'Failed to fetch chart of accounts' });
  }
});

// Create new account
router.post('/chart-of-accounts', authorize('accounting.write'), async (req, res) => {
  try {
    const {
      clinic_id,
      account_code,
      account_name,
      account_type,
      sub_account_type,
      balance_type,
      opening_balance,
      description,
      is_bank_account,
      is_customer_account,
      is_supplier_account
    } = req.body;

    // Validate required fields
    if (!clinic_id || !account_code || !account_name || !account_type || !balance_type) {
      return res.status(400).json({ 
        error: 'Missing required fields: clinic_id, account_code, account_name, account_type, balance_type' 
      });
    }

    // Check if account code already exists for this clinic
    const existingAccount = await ChartOfAccounts.findOne({
      where: { clinic_id, account_code }
    });

    if (existingAccount) {
      return res.status(400).json({ error: 'Account code already exists for this clinic' });
    }

    const account = await ChartOfAccounts.create({
      clinic_id,
      account_code,
      account_name,
      account_type,
      sub_account_type,
      balance_type,
      opening_balance: opening_balance || 0,
      opening_balance_date: new Date(),
      description,
      is_bank_account: is_bank_account || false,
      is_customer_account: is_customer_account || false,
      is_supplier_account: is_supplier_account || false,
      created_by: req.user?.id || 'system'
    });

    res.status(201).json(account);
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Get account details
router.get('/chart-of-accounts/:id', authorize('accounting.read'), async (req, res) => {
  try {
    const account = await ChartOfAccounts.findByPk(req.params.id);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    if (!assertClinicAccess(account, req, res, 'account')) return;

    // Get account balance
    const balance = await AccountingService.getAccountBalance(account.id);

    res.json({
      ...account.toJSON(),
      current_balance: balance
    });
  } catch (error) {
    console.error('Error fetching account details:', error);
    res.status(500).json({ error: 'Failed to fetch account details' });
  }
});

// Update account
router.put('/chart-of-accounts/:id', authorize('accounting.write'), async (req, res) => {
  try {
    const account = await ChartOfAccounts.findByPk(req.params.id);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    if (!assertClinicAccess(account, req, res, 'account')) return;

    await account.update(req.body);
    res.json(account);
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// Initialize Chart of Accounts for clinic
router.post('/chart-of-accounts/initialize', authorize('accounting.chart_of_accounts.initialize'), async (req, res) => {
  try {
    const { clinic_id } = req.body;
    
    if (!clinic_id) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }

    const result = await initializeChartOfAccounts(clinic_id, req.user?.id || 'system');
    // Not having anything left to add is a normal outcome (already fully
    // seeded), not an error — always 200/201 here, success just indicates
    // whether anything new was actually created.
    res.status(result.success ? 201 : 200).json(result);
  } catch (error) {
    console.error('Error initializing chart of accounts:', error);
    res.status(500).json({ error: 'Failed to initialize chart of accounts' });
  }
});

// ============ GENERAL LEDGER ENDPOINTS ============

// Get GL entries
router.get('/general-ledger', authorize('accounting.read'), async (req, res) => {
  try {
    // include: needs the real, tenant-bound model classes (not the
    // request-agnostic top-level import) so Sequelize's association lookup
    // matches correctly — see models/index.js's tenant-aware proxy comment.
    const { GeneralLedger, GLLineItems, ChartOfAccounts } = req.models;
    const { clinic_id, account_id, start_date, end_date, status } = req.query;
    
    if (!clinic_id) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }

    const whereClause = { clinic_id: parseInt(clinic_id) };
    
    if (account_id) {
      // Find GL entries that have line items for this account
      const glIds = await GLLineItems.findAll({
        where: { account_id },
        attributes: ['gl_id'],
        raw: true
      });
      whereClause.id = glIds.map(item => item.gl_id);
    }
    
    if (start_date && end_date) {
      whereClause.transaction_date = {
        [Op.between]: [start_date, end_date]
      };
    }
    
    if (status) {
      whereClause.status = status;
    }

    const glEntries = await GeneralLedger.findAll({
      where: whereClause,
      include: [{
        model: GLLineItems,
        as: 'lineItems',
        include: [{
          model: ChartOfAccounts,
          as: 'account',
          attributes: ['account_code', 'account_name', 'account_type']
        }]
      }],
      order: [['transaction_date', 'DESC'], ['gl_number', 'DESC']]
    });

    res.json(glEntries);
  } catch (error) {
    console.error('Error fetching GL entries:', error);
    res.status(500).json({ error: 'Failed to fetch GL entries' });
  }
});

// Create GL entry
router.post('/general-ledger', authorize('accounting.write'), async (req, res) => {
  try {
    const { glData, lineItems } = req.body;
    
    if (!glData || !lineItems || !Array.isArray(lineItems)) {
      return res.status(400).json({ error: 'glData and lineItems array are required' });
    }

    // Explicitly a draft: this screen creates an entry and posts it as a
    // separate, deliberate act (POST /general-ledger/:id/post below).
    const glEntry = await AccountingService.createGLEntry(
      glData, 
      lineItems, 
      req.user?.id || 'system',
      null,
      { draft: true }
    );

    res.status(201).json(glEntry);
  } catch (error) {
    console.error('Error creating GL entry:', error);
    res.status(500).json({ error: error.message || 'Failed to create GL entry' });
  }
});

// Post GL entry
router.post('/general-ledger/:id/post', authorize('accounting.write'), async (req, res) => {
  try {
    const glEntry = await AccountingService.postGLEntry(req.params.id, req.user?.id || 'system');
    res.json(glEntry);
  } catch (error) {
    console.error('Error posting GL entry:', error);
    res.status(500).json({ error: error.message || 'Failed to post GL entry' });
  }
});

// ============ JOURNAL ENTRIES ENDPOINTS ============

// Get journal entries
router.get('/journal-entries', authorize('accounting.read'), async (req, res) => {
  try {
    const { JournalEntries, JournalEntryLines, ChartOfAccounts } = req.models;
    const { clinic_id, status } = req.query;
    
    if (!clinic_id) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }

    const whereClause = { clinic_id: parseInt(clinic_id), ...getBranchCondition(req) };
    if (status) whereClause.status = status;

    const journalEntries = await JournalEntries.findAll({
      where: whereClause,
      include: [{
        model: JournalEntryLines,
        as: 'lines',
        include: [{
          model: ChartOfAccounts,
          as: 'account',
          attributes: ['account_code', 'account_name']
        }]
      }],
      order: [['entry_date', 'DESC'], ['je_number', 'DESC']]
    });

    res.json(journalEntries);
  } catch (error) {
    console.error('Error fetching journal entries:', error);
    res.status(500).json({ error: 'Failed to fetch journal entries' });
  }
});

// Create journal entry
router.post('/journal-entries', authorize('accounting.write'), async (req, res) => {
  try {
    const { sequelize, JournalEntries, JournalEntryLines, ChartOfAccounts } = req.models;
    const { clinic_id, entry_date, description, narration, reference, lines, transaction_currency, exchange_rate: reqExchangeRate } = req.body;

    if (!clinic_id || !entry_date || !description || !lines || !Array.isArray(lines)) {
      return res.status(400).json({ 
        error: 'clinic_id, entry_date, description, and lines array are required' 
      });
    }

    // Validate that debits equal credits in transaction currency
    const totalDebits = lines.reduce((sum, line) => sum + parseFloat(line.debit_amount || 0), 0);
    const totalCredits = lines.reduce((sum, line) => sum + parseFloat(line.credit_amount || 0), 0);
    
    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      return res.status(400).json({ 
        error: `Journal entry is not balanced. Debits: ${totalDebits}, Credits: ${totalCredits}` 
      });
    }

    // Currency conversion
    const baseCurrencyData = await CurrencyService.getBaseCurrency();
    const baseCurrency = baseCurrencyData.code;
    const txnCurrency = transaction_currency || baseCurrency;
    let exchangeRate = 1.0;

    if (txnCurrency !== baseCurrency) {
      if (reqExchangeRate) {
        exchangeRate = parseFloat(reqExchangeRate);
      } else {
        try {
          exchangeRate = await AccountingService.getExchangeRate(clinic_id, txnCurrency, baseCurrency, entry_date);
        } catch (rateError) {
          return res.status(400).json({ error: rateError.message });
        }
      }
    }

    const baseTotalDebits = AccountingService.convertAmount(totalDebits, exchangeRate);
    const baseTotalCredits = AccountingService.convertAmount(totalCredits, exchangeRate);

    const transaction = await sequelize.transaction();
    
    try {
      // Numbered by the same allocator as every automatic journal entry (cash
      // payments, transfers, deposits — JournalPostingService). Counting the
      // highest existing number + 1 here left that allocator's counter behind:
      // the next payment was handed a number a manual entry already held, hit
      // the unique index on je_number, and failed.
      const jeNumber = await getNextDocumentNumber('JE', clinic_id, transaction, { date: entry_date });
      const branchId = getCreateBranchId(req);

      // Create journal entry with currency info
      const journalEntry = await JournalEntries.create({
        clinic_id,
        je_number: jeNumber,
        entry_date,
        description,
        narration,
        reference,
        transaction_currency: txnCurrency,
        base_currency: baseCurrency,
        exchange_rate: exchangeRate,
        total_debit: totalDebits,
        total_credit: totalCredits,
        base_total_debit: baseTotalDebits,
        base_total_credit: baseTotalCredits,
        status: 'draft',
        created_by: req.user?.id || 'system',
        branch_id: branchId
      }, { transaction });

      // Create journal entry lines with base currency amounts
      for (const line of lines) {
        await JournalEntryLines.create({
          je_id: journalEntry.id,
          account_id: line.account_id,
          debit_amount: line.debit_amount || 0,
          credit_amount: line.credit_amount || 0,
          base_debit_amount: AccountingService.convertAmount(line.debit_amount || 0, exchangeRate),
          base_credit_amount: AccountingService.convertAmount(line.credit_amount || 0, exchangeRate),
          description: line.description,
          branch_id: branchId
        }, { transaction });
      }

      await transaction.commit();

      // Fetch the created entry with associations
      const createdEntry = await JournalEntries.findByPk(journalEntry.id, {
        include: [{
          model: JournalEntryLines,
          as: 'lines',
          include: [{
            model: ChartOfAccounts,
            as: 'account',
            attributes: ['account_code', 'account_name']
          }]
        }]
      });

      res.status(201).json(createdEntry);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error creating journal entry:', error);
    res.status(500).json({ error: 'Failed to create journal entry' });
  }
});

// Get single journal entry by ID
router.get('/journal-entries/:id', authorize('accounting.read'), async (req, res) => {
  try {
    const { JournalEntries, JournalEntryLines, ChartOfAccounts } = req.models;
    const journalEntry = await JournalEntries.findByPk(req.params.id, {
      include: [{
        model: JournalEntryLines,
        as: 'lines',
        include: [{
          model: ChartOfAccounts,
          as: 'account',
          attributes: ['account_code', 'account_name']
        }]
      }]
    });

    if (!journalEntry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }
    if (!assertClinicAccess(journalEntry, req, res, 'journal entry')) return;
    if (!assertBranchAccess(journalEntry, req, res, 'journal entry')) return;

    res.json(journalEntry);
  } catch (error) {
    console.error('Error fetching journal entry:', error);
    res.status(500).json({ error: 'Failed to fetch journal entry' });
  }
});

// Update journal entry (draft only)
router.put('/journal-entries/:id', authorize('accounting.write'), async (req, res) => {
  try {
    const { sequelize, JournalEntries, JournalEntryLines, ChartOfAccounts } = req.models;
    const journalEntry = await JournalEntries.findByPk(req.params.id);

    if (!journalEntry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }
    // NOTE: this route was already missing assertClinicAccess before this change (every
    // sibling journal-entries route calls it) — flagged, not fixed here per scope; adding
    // just the branch check below.
    if (!assertBranchAccess(journalEntry, req, res, 'journal entry')) return;

    if (journalEntry.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft entries can be edited' });
    }

    const { entry_date, description, narration, reference, lines, transaction_currency, exchange_rate: reqExchangeRate } = req.body;

    if (!lines || !Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ error: 'At least 2 line items are required' });
    }

    const totalDebits = lines.reduce((sum, line) => sum + parseFloat(line.debit_amount || 0), 0);
    const totalCredits = lines.reduce((sum, line) => sum + parseFloat(line.credit_amount || 0), 0);

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      return res.status(400).json({ error: `Entry is not balanced. Debits: ${totalDebits}, Credits: ${totalCredits}` });
    }

    const baseCurrencyData2 = await CurrencyService.getBaseCurrency();
    const baseCurrency = baseCurrencyData2.code;
    const txnCurrency = transaction_currency || journalEntry.transaction_currency || baseCurrency;
    let exchangeRate = 1.0;

    if (txnCurrency !== baseCurrency) {
      if (reqExchangeRate) {
        exchangeRate = parseFloat(reqExchangeRate);
      } else {
        try {
          exchangeRate = await AccountingService.getExchangeRate(journalEntry.clinic_id, txnCurrency, baseCurrency, entry_date || journalEntry.entry_date);
        } catch (rateError) {
          return res.status(400).json({ error: rateError.message });
        }
      }
    }

    const baseTotalDebits = AccountingService.convertAmount(totalDebits, exchangeRate);
    const baseTotalCredits = AccountingService.convertAmount(totalCredits, exchangeRate);

    const transaction = await sequelize.transaction();

    try {
      await journalEntry.update({
        entry_date: entry_date || journalEntry.entry_date,
        description: description || journalEntry.description,
        narration: narration !== undefined ? narration : journalEntry.narration,
        reference: reference !== undefined ? reference : journalEntry.reference,
        transaction_currency: txnCurrency,
        base_currency: baseCurrency,
        exchange_rate: exchangeRate,
        total_debit: totalDebits,
        total_credit: totalCredits,
        base_total_debit: baseTotalDebits,
        base_total_credit: baseTotalCredits,
      }, { transaction });

      // Delete old lines and recreate
      await JournalEntryLines.destroy({ where: { je_id: journalEntry.id }, transaction });

      for (const line of lines) {
        await JournalEntryLines.create({
          je_id: journalEntry.id,
          account_id: line.account_id,
          debit_amount: line.debit_amount || 0,
          credit_amount: line.credit_amount || 0,
          base_debit_amount: AccountingService.convertAmount(line.debit_amount || 0, exchangeRate),
          base_credit_amount: AccountingService.convertAmount(line.credit_amount || 0, exchangeRate),
          description: line.description,
          branch_id: journalEntry.branch_id
        }, { transaction });
      }

      await transaction.commit();

      // Reload with associations
      const updated = await JournalEntries.findByPk(journalEntry.id, {
        include: [{
          model: JournalEntryLines,
          as: 'lines',
          include: [{ model: ChartOfAccounts, as: 'account', attributes: ['account_code', 'account_name'] }]
        }]
      });

      res.json(updated);
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error) {
    console.error('Error updating journal entry:', error);
    res.status(500).json({ error: 'Failed to update journal entry' });
  }
});

// Submit journal entry for approval
router.post('/journal-entries/:id/submit', authorize('accounting.write'), async (req, res) => {
  try {
    const journalEntry = await JournalEntries.findByPk(req.params.id);
    
    if (!journalEntry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }
    if (!assertClinicAccess(journalEntry, req, res, 'journal entry')) return;
    if (!assertBranchAccess(journalEntry, req, res, 'journal entry')) return;

    if (journalEntry.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft entries can be submitted' });
    }

    await journalEntry.update({ status: 'submitted' });
    res.json(journalEntry);
  } catch (error) {
    console.error('Error submitting journal entry:', error);
    res.status(500).json({ error: 'Failed to submit journal entry' });
  }
});

// Approve journal entry
router.post('/journal-entries/:id/approve', journalEntryApprovalGate, async (req, res) => {
  try {
    const journalEntry = await JournalEntries.findByPk(req.params.id);
    
    if (!journalEntry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }
    if (!assertClinicAccess(journalEntry, req, res, 'journal entry')) return;
    if (!assertBranchAccess(journalEntry, req, res, 'journal entry')) return;

    if (journalEntry.status !== 'submitted') {
      return res.status(400).json({ error: 'Only submitted entries can be approved' });
    }

    await journalEntry.update({
      status: 'approved',
      approved_by: req.user?.id || 'system',
      approved_date: new Date()
    });

    res.json(journalEntry);
  } catch (error) {
    console.error('Error approving journal entry:', error);
    res.status(500).json({ error: 'Failed to approve journal entry' });
  }
});

// Post journal entry (creates GL entry)
// NOTE: previously this only flipped journal_entries.status to 'posted' and did
// nothing else — it never wrote to general_ledger/gl_line_items or account_ledger.
// That meant a manually created, approved, and "posted" journal entry from this
// UI would never show up in the General Ledger and would never move any Chart of
// Accounts balance (verified: account_ledger only ever contains rows sourced from
// billing's AccountingService.createGLEntry, never anything tied to a journal_entries
// row, and journal_entries itself had zero rows in the live DB despite this endpoint
// existing). We now create a matching, immediately-posted GL entry — the same path
// billing uses — so posting a JE has real accounting effect.
router.post('/journal-entries/:id/post', authorize('accounting.write'), async (req, res) => {
  try {
    const { JournalEntries, JournalEntryLines } = req.models;
    const journalEntry = await JournalEntries.findByPk(req.params.id, {
      include: [{ model: JournalEntryLines, as: 'lines' }]
    });

    if (!journalEntry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }

    if (journalEntry.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved entries can be posted' });
    }

    const userId = req.user?.id || 'system';

    const glEntry = await AccountingService.createGLEntry(
      {
        clinic_id: journalEntry.clinic_id,
        transaction_date: journalEntry.entry_date,
        transaction_type: 'journal_entry',
        description: journalEntry.description,
        reference_id: journalEntry.id,
        reference_module: 'journal_entry',
        transaction_currency: journalEntry.transaction_currency,
        exchange_rate: journalEntry.exchange_rate
      },
      journalEntry.lines.map(line => ({
        account_id: line.account_id,
        debit_amount: line.debit_amount,
        credit_amount: line.credit_amount,
        description: line.description
      })),
      userId
    );

    await AccountingService.postGLEntry(glEntry.id, userId);

    await journalEntry.update({
      status: 'posted',
      posted_by: userId,
      posted_date: new Date()
    });

    res.json(journalEntry);
  } catch (error) {
    console.error('Error posting journal entry:', error);
    res.status(500).json({ error: error.message || 'Failed to post journal entry' });
  }
});

// Reject journal entry
router.post('/journal-entries/:id/reject', journalEntryApprovalGate, async (req, res) => {
  try {
    const journalEntry = await JournalEntries.findByPk(req.params.id);

    if (!journalEntry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }
    if (!assertClinicAccess(journalEntry, req, res, 'journal entry')) return;
    if (!assertBranchAccess(journalEntry, req, res, 'journal entry')) return;

    if (!['submitted', 'approved'].includes(journalEntry.status)) {
      return res.status(400).json({ error: 'Only submitted or approved entries can be rejected' });
    }

    await journalEntry.update({
      status: 'rejected'
    });

    res.json(journalEntry);
  } catch (error) {
    console.error('Error rejecting journal entry:', error);
    res.status(500).json({ error: 'Failed to reject journal entry' });
  }
});

// Revert rejected entry back to draft
router.post('/journal-entries/:id/revert-to-draft', authorize('accounting.write'), async (req, res) => {
  try {
    const journalEntry = await JournalEntries.findByPk(req.params.id);

    if (!journalEntry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }
    if (!assertClinicAccess(journalEntry, req, res, 'journal entry')) return;
    if (!assertBranchAccess(journalEntry, req, res, 'journal entry')) return;

    if (journalEntry.status !== 'rejected') {
      return res.status(400).json({ error: 'Only rejected entries can be reverted to draft' });
    }

    await journalEntry.update({ status: 'draft' });
    res.json(journalEntry);
  } catch (error) {
    console.error('Error reverting journal entry:', error);
    res.status(500).json({ error: 'Failed to revert journal entry' });
  }
});

// ============ RECEIVABLES ENDPOINTS ============

// GET /receivables — alias used by Receivables.tsx frontend
// NOTE: This reads directly from `patient_bills` (the live billing table that
// BillingManagement/PatientsBill/etc. actually write to) rather than the
// retired `patient_receivables` side-table, which is no longer written to.
// due_date defaults to 30 days after bill_date when unset, since a NULL
// due_date otherwise reads as epoch (1970) on the client and wrongly flags
// the bill as overdue.
router.get('/receivables', authorize('accounting.read'), async (req, res) => {
  try {
    const { clinic_id, patient_id, status } = req.query;
    if (!clinic_id) return res.status(400).json({ error: 'clinic_id is required' });

    const { sequelize } = require('../models');
    let where = `WHERE pb.clinic_id = :clinic_id`;
    const replacements = { clinic_id: parseInt(clinic_id) };
    if (patient_id) { where += ` AND pb.patient_id = :patient_id`; replacements.patient_id = patient_id; }
    if (status) { where += ` AND pb.status = :status`; replacements.status = status; }
    where += branchScope(req, replacements, 'pb');

    const rows = await sequelize.query(`
      SELECT
        pb.id,
        pb.patient_id,
        pb.patient_name,
        pb.bill_number         AS invoice_number,
        pb.total_amount        AS amount,
        pb.paid_amount,
        pb.balance_amount      AS balance,
        COALESCE(pb.due_date, ((pb.bill_date) + INTERVAL '30 day')) AS due_date,
        pb.status,
        pb.bill_date,
        pb.created_at,
        pb.scheme_id,
        pb.scheme_name,
        pb.bill_currency
      FROM patient_bills pb
      ${where}
      ORDER BY pb.bill_date DESC
    `, { replacements, type: sequelize.QueryTypes.SELECT });

    // Amounts come back in the base currency so the list, its totals and the
    // aging cards never add a USD bill's "6" to SSP thousands. A bill in
    // another currency is converted at the rate for its bill date (the stored
    // patient_bills.exchange_rate is 1.0 on such bills, so it can't be used);
    // its own-currency figures ride along for display.
    const { getBaseCurrencyCode } = require('../utils/baseCurrency');
    const base = await getBaseCurrencyCode();
    const rates = new Map();
    for (const r of rows) {
      const cur = r.bill_currency || base;
      r.currency = base;
      if (cur === base) continue;
      const day = new Date(r.bill_date || r.created_at || Date.now()).toISOString().slice(0, 10);
      const key = `${cur}|${day}`;
      if (!rates.has(key)) {
        let rate = null;
        try { rate = parseFloat(await AccountingService.getExchangeRate(parseInt(clinic_id), cur, base, day)); } catch { rate = null; }
        rates.set(key, Number.isFinite(rate) && rate > 0 ? rate : null);
      }
      const rate = rates.get(key);
      r.original_currency = cur;
      r.original_amount = r.amount; r.original_paid_amount = r.paid_amount; r.original_balance = r.balance;
      r.exchange_rate = rate;
      if (rate == null) { r.unconverted = true; continue; }
      const conv = (v) => Math.round((parseFloat(v) || 0) * rate * 100) / 100;
      r.amount = conv(r.amount); r.paid_amount = conv(r.paid_amount); r.balance = conv(r.balance);
    }

    res.json(rows);
  } catch (error) {
    console.error('Error fetching receivables:', error);
    res.status(500).json({ error: 'Failed to fetch receivables', details: error.message });
  }
});

// ============ PETTY CASH (account 1108) ============
// Balance and movements of the petty cash float. Top-ups are cash transfers into
// 1108; spending is an expense whose paid-from account is 1108.
router.get('/petty-cash', authorize('accounting.read'), async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id) || req.user?.clinicId || 1;
    const [[account]] = await sequelize.query(
      `SELECT id, account_code, account_name, is_active FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = '1108' LIMIT 1`,
      { replacements: { clinicId } }
    );
    const { getBaseCurrencyCode } = require('../utils/baseCurrency');
    const currency = await getBaseCurrencyCode();
    if (!account || !account.is_active) return res.json({ account: account || null, currency, balance: 0, movements: [] });
    const [[bal]] = await sequelize.query(
      `SELECT COALESCE(SUM(debit_amount - credit_amount), 0)::float AS balance FROM account_ledger
        WHERE account_id::text = :id AND COALESCE(is_posted, TRUE) = TRUE`,
      { replacements: { id: String(account.id) } }
    );
    const [movements] = await sequelize.query(
      `SELECT id, transaction_date, description, source_module, reference_number,
              debit_amount::float AS money_in, credit_amount::float AS money_out, posted_by
         FROM account_ledger
        WHERE account_id::text = :id AND COALESCE(is_posted, TRUE) = TRUE
        ORDER BY transaction_date DESC, created_at DESC
        LIMIT 500`,
      { replacements: { id: String(account.id) } }
    );
    res.json({ account, currency, balance: bal.balance, movements });
  } catch (error) {
    console.error('Error loading petty cash:', error);
    res.status(500).json({ error: 'Failed to load petty cash' });
  }
});

// Turns on the petty cash account — activates 1108 if it exists, otherwise creates it.
// An explicit, user-confirmed action (nothing seeds it automatically).
router.post('/petty-cash/setup', authorize('accounting.write'), async (req, res) => {
  try {
    const clinicId = parseInt(req.body?.clinic_id) || req.user?.clinicId || 1;
    const [[existing]] = await sequelize.query(
      `SELECT id, is_active FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = '1108' LIMIT 1`,
      { replacements: { clinicId } }
    );
    if (existing) {
      if (!existing.is_active) {
        await sequelize.query(`UPDATE chart_of_accounts SET is_active = TRUE, updated_at = NOW() WHERE id = :id`, { replacements: { id: existing.id } });
      }
      return res.json({ message: 'Petty cash account 1108 is active', id: existing.id, created: false });
    }
    const created = await ChartOfAccounts.create({
      clinic_id: clinicId, account_code: '1108', account_name: 'Petty Cash', account_type: 'asset',
      sub_account_type: 'current_asset', balance_type: 'debit', is_active: true,
      description: 'Small cash float for minor purchases — topped up by cash transfer, spent through expenses',
    });
    res.status(201).json({ message: 'Petty cash account 1108 created', id: created.id, created: true });
  } catch (error) {
    console.error('Error setting up petty cash:', error);
    res.status(500).json({ error: 'Failed to set up petty cash' });
  }
});

// ============ FINANCIAL REPORTS ENDPOINTS ============

// Get trial balance
router.get('/reports/trial-balance', authorize('accounting.read'), async (req, res) => {
  try {
    const { clinic_id, as_of_date } = req.query;
    
    if (!clinic_id) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }

    const asOfDate = as_of_date ? new Date(as_of_date) : new Date();
    const trialBalance = await AccountingService.getTrialBalance(parseInt(clinic_id), asOfDate);

    res.json(trialBalance);
  } catch (error) {
    console.error('Error generating trial balance:', error);
    res.status(500).json({ error: 'Failed to generate trial balance' });
  }
});

// Get income statement (P&L)
router.get('/reports/income-statement', authorize('accounting.read'), async (req, res) => {
  try {
    const { clinic_id, start_date, end_date } = req.query;
    
    if (!clinic_id || !start_date || !end_date) {
      return res.status(400).json({ 
        error: 'clinic_id, start_date, and end_date are required' 
      });
    }

    const incomeStatementReplacements = {
      clinic_id: parseInt(clinic_id),
      start_date,
      end_date
    };
    const incomeStatementBranchScope = branchScope(req, incomeStatementReplacements, 'al');
    const [results] = await sequelize.query(`
      SELECT
        coa.account_code,
        coa.account_name,
        coa.account_type,
        coa.sub_account_type,
        SUM(CASE WHEN coa.balance_type = 'credit'
                 THEN al.credit_amount - al.debit_amount
                 ELSE al.debit_amount - al.credit_amount END) as balance
      FROM chart_of_accounts coa
      LEFT JOIN account_ledger al ON coa.id = al.account_id
        AND al.transaction_date BETWEEN :start_date AND :end_date
        AND al.is_posted = true
        ${incomeStatementBranchScope}
      WHERE coa.clinic_id = :clinic_id
        AND coa.account_type IN ('revenue', 'expense')
        AND coa.is_active = true
      GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.sub_account_type
      ORDER BY coa.account_code
    `, {
      replacements: incomeStatementReplacements
    });

    // Organize into revenue and expenses
    const revenue = results.filter(item => item.account_type === 'revenue');
    const expenses = results.filter(item => item.account_type === 'expense');

    const totalRevenue = revenue.reduce((sum, item) => sum + parseFloat(item.balance || 0), 0);
    const totalExpenses = expenses.reduce((sum, item) => sum + parseFloat(item.balance || 0), 0);
    const netIncome = totalRevenue - totalExpenses;

    res.json({
      period: { start_date, end_date },
      revenue: {
        items: revenue,
        total: totalRevenue
      },
      expenses: {
        items: expenses,
        total: totalExpenses
      },
      net_income: netIncome
    });
  } catch (error) {
    console.error('Error generating income statement:', error);
    res.status(500).json({ error: 'Failed to generate income statement' });
  }
});

// Get balance sheet
router.get('/reports/balance-sheet', authorize('accounting.read'), async (req, res) => {
  try {
    const { clinic_id, as_of_date } = req.query;
    
    if (!clinic_id) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }

    const asOfDate = as_of_date || new Date().toISOString().split('T')[0];

    const balanceSheetReplacements = {
      clinic_id: parseInt(clinic_id),
      as_of_date: asOfDate
    };
    const balanceSheetBranchScope = branchScope(req, balanceSheetReplacements, 'al');
    // period_balance (and, below, opening_balance) are expressed in each
    // SECTION's own natural direction — debit-normal for assets,
    // credit-normal for liabilities/equity — not each row's own
    // balance_type. A contra account (e.g. 1590 Accumulated Depreciation:
    // an asset but balance_type='credit'; 3300 Owner's Drawings: equity but
    // balance_type='debit') is exactly the case this distinction matters
    // for: branching per-row on its own balance_type would report its
    // balance as a positive number in ITS natural direction, which then
    // gets ADDED to the section total instead of subtracted, overstating
    // the section by 2x the contra account's balance. Branching on
    // account_type instead makes a contra account's balance net negative
    // within its own section automatically — no special-casing needed.
    const [results] = await sequelize.query(`
      SELECT
        coa.account_code,
        coa.account_name,
        coa.account_type,
        coa.sub_account_type,
        coa.balance_type,
        coa.opening_balance,
        SUM(CASE WHEN coa.account_type = 'asset'
                 THEN al.debit_amount - al.credit_amount
                 ELSE al.credit_amount - al.debit_amount END) as period_balance
      FROM chart_of_accounts coa
      LEFT JOIN account_ledger al ON coa.id = al.account_id
        AND al.transaction_date <= :as_of_date
        AND al.is_posted = true
        ${balanceSheetBranchScope}
      WHERE coa.clinic_id = :clinic_id
        AND coa.account_type IN ('asset', 'liability', 'equity')
        AND coa.is_active = true
      GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.sub_account_type, coa.balance_type, coa.opening_balance
      ORDER BY coa.account_code
    `, {
      replacements: balanceSheetReplacements
    });

    // Calculate final balances — opening_balance is stored per-account in
    // THAT account's own balance_type direction (confirmed in
    // AccountingService.getAccountBalance), so it needs the same
    // section-direction normalization as period_balance above before the
    // two can be added together.
    const balanceSheetItems = results.map(item => {
      const sectionIsDebitNormal = item.account_type === 'asset';
      const accountIsDebitNormal = item.balance_type === 'debit';
      const openingInSectionDirection = (accountIsDebitNormal === sectionIsDebitNormal ? 1 : -1) * parseFloat(item.opening_balance || 0);
      return {
        ...item,
        balance: openingInSectionDirection + parseFloat(item.period_balance || 0),
      };
    });

    // Organize by account type
    const assets = balanceSheetItems.filter(item => item.account_type === 'asset');
    const liabilities = balanceSheetItems.filter(item => item.account_type === 'liability');
    const equity = balanceSheetItems.filter(item => item.account_type === 'equity');

    // Revenue and expense accounts are deliberately excluded from the query above (they're
    // income-statement accounts, not balance-sheet ones) — but their net effect, Net Income,
    // still belongs in Equity: Assets = Liabilities + Equity only holds once accumulated
    // earnings are accounted for somewhere. Without a formal period-close step that posts
    // Net Income into Retained Earnings (3200), this system has no other mechanism for that,
    // so it's computed live here as "Current Year Earnings" — the same approach QuickBooks
    // and similar tools use for an interim (not-yet-closed) balance sheet.
    const netIncomeReplacements = { clinic_id: parseInt(clinic_id), as_of_date: asOfDate };
    const netIncomeBranchScope = branchScope(req, netIncomeReplacements, 'al');
    const [[netIncomeRow]] = await sequelize.query(`
      SELECT
        SUM(CASE WHEN coa.account_type = 'revenue' THEN al.credit_amount - al.debit_amount
                 WHEN coa.account_type = 'expense' THEN -(al.debit_amount - al.credit_amount)
                 ELSE 0 END) as net_income
      FROM account_ledger al
      JOIN chart_of_accounts coa ON coa.id = al.account_id
      WHERE coa.clinic_id = :clinic_id
        AND coa.account_type IN ('revenue', 'expense')
        AND al.transaction_date <= :as_of_date
        AND al.is_posted = true
        ${netIncomeBranchScope}
    `, { replacements: netIncomeReplacements });

    const currentYearEarnings = parseFloat(netIncomeRow?.net_income || 0);
    if (Math.abs(currentYearEarnings) > 0.01) {
      equity.push({
        account_code: '3900',
        account_name: 'Current Year Earnings',
        account_type: 'equity',
        sub_account_type: 'computed',
        opening_balance: 0,
        period_balance: currentYearEarnings,
        balance: currentYearEarnings,
      });
    }

    const totalAssets = assets.reduce((sum, item) => sum + parseFloat(item.balance || 0), 0);
    const totalLiabilities = liabilities.reduce((sum, item) => sum + parseFloat(item.balance || 0), 0);
    const totalEquity = equity.reduce((sum, item) => sum + parseFloat(item.balance || 0), 0);

    res.json({
      as_of_date: asOfDate,
      assets: {
        items: assets,
        total: totalAssets
      },
      liabilities: {
        items: liabilities,
        total: totalLiabilities
      },
      equity: {
        items: equity,
        total: totalEquity
      },
      total_liabilities_and_equity: totalLiabilities + totalEquity,
      is_balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
    });
  } catch (error) {
    console.error('Error generating balance sheet:', error);
    res.status(500).json({ error: 'Failed to generate balance sheet' });
  }
});

// ============ EXCHANGE RATE ENDPOINTS ============

// Get all exchange rates for a clinic
router.get('/exchange-rates', authorize('accounting.rates.read'), async (req, res) => {
  try {
    const { clinic_id, active_only } = req.query;
    
    if (!clinic_id) {
      return res.status(400).json({ error: 'clinic_id is required' });
    }

    const whereClause = { clinic_id: parseInt(clinic_id) };
    if (active_only === 'true') {
      whereClause.is_active = true;
    }

    const rates = await ExchangeRate.findAll({
      where: whereClause,
      order: [['effective_date', 'DESC'], ['from_currency', 'ASC']]
    });

    res.json(rates);
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    res.status(500).json({ error: 'Failed to fetch exchange rates' });
  }
});

// Get current rate for a currency pair
router.get('/exchange-rates/current', authorize('accounting.rates.read'), async (req, res) => {
  try {
    const { clinic_id, from_currency, to_currency, date } = req.query;
    
    if (!clinic_id || !from_currency || !to_currency) {
      return res.status(400).json({ error: 'clinic_id, from_currency, and to_currency are required' });
    }

    const rate = await AccountingService.getExchangeRate(
      parseInt(clinic_id),
      from_currency,
      to_currency,
      date || new Date()
    );

    res.json({ from_currency, to_currency, rate, date: date || new Date().toISOString().split('T')[0] });
  } catch (error) {
    console.error('Error fetching current rate:', error);
    res.status(400).json({ error: error.message });
  }
});

// Create or update exchange rate
router.post('/exchange-rates', authorize('accounting.rates.write'), async (req, res) => {
  try {
    const { clinic_id, from_currency, to_currency, rate, effective_date, expiry_date, source } = req.body;

    if (!clinic_id || !from_currency || !to_currency || !rate || !effective_date) {
      return res.status(400).json({
        error: 'clinic_id, from_currency, to_currency, rate, and effective_date are required'
      });
    }

    if (from_currency === to_currency) {
      return res.status(400).json({ error: 'from_currency and to_currency must be different' });
    }

    // Deactivate any existing active rate for this pair that would overlap
    await ExchangeRate.update(
      { is_active: false },
      {
        where: {
          clinic_id,
          from_currency,
          to_currency,
          is_active: true,
          effective_date: { [Op.lte]: effective_date },
          [Op.or]: [
            { expiry_date: null },
            { expiry_date: { [Op.gte]: effective_date } }
          ]
        }
      }
    );

    const exchangeRate = await ExchangeRate.create({
      clinic_id,
      from_currency: from_currency.toUpperCase(),
      to_currency: to_currency.toUpperCase(),
      rate: parseFloat(rate),
      effective_date,
      expiry_date: expiry_date || null,
      source: source || 'manual',
      is_active: true,
      created_by: req.user?.id || 'system'
    });

    res.status(201).json(exchangeRate);
  } catch (error) {
    console.error('Error creating exchange rate:', error);
    res.status(500).json({ error: 'Failed to create exchange rate' });
  }
});

// Update exchange rate
router.put('/exchange-rates/:id', authorize('accounting.rates.write'), async (req, res) => {
  try {
    const exchangeRate = await ExchangeRate.findByPk(req.params.id);

    if (!exchangeRate) {
      return res.status(404).json({ error: 'Exchange rate not found' });
    }
    if (!assertClinicAccess(exchangeRate, req, res, 'exchange rate')) return;

    await exchangeRate.update(req.body);
    res.json(exchangeRate);
  } catch (error) {
    console.error('Error updating exchange rate:', error);
    res.status(500).json({ error: 'Failed to update exchange rate' });
  }
});

// Delete (deactivate) exchange rate
router.delete('/exchange-rates/:id', authorize('accounting.rates.write'), async (req, res) => {
  try {
    const exchangeRate = await ExchangeRate.findByPk(req.params.id);

    if (!exchangeRate) {
      return res.status(404).json({ error: 'Exchange rate not found' });
    }
    if (!assertClinicAccess(exchangeRate, req, res, 'exchange rate')) return;

    await exchangeRate.update({ is_active: false });
    res.json({ message: 'Exchange rate deactivated' });
  } catch (error) {
    console.error('Error deactivating exchange rate:', error);
    res.status(500).json({ error: 'Failed to deactivate exchange rate' });
  }
});

// Get supported currencies
router.get('/currencies', authorize('accounting.rates.read'), async (req, res) => {
  try {
    const currencies = await CurrencyService.getCurrencies();
    res.json(currencies);
  } catch (error) {
    console.error('Error fetching currencies:', error);
    res.status(500).json({ error: 'Failed to fetch currencies' });
  }
});

module.exports = router;
