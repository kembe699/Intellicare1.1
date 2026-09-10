const { Op } = require('sequelize');
const { 
  ChartOfAccounts, 
  GeneralLedger, 
  GLLineItems, 
  AccountLedger,
  PatientReceivables,
  ExchangeRate,
  sequelize 
} = require('../models');
const CurrencyService = require('./CurrencyService');
const { v4: uuidv4 } = require('uuid');

class AccountingService {
  
  /**
   * Create a General Ledger entry with line items
   * @param {Object} glData - GL entry data
   * @param {Array} lineItems - Array of line items
   * @param {string} userId - User creating the entry
   * @returns {Object} Created GL entry
   */
  /**
   * Get the current exchange rate for a currency pair
   * @param {number} clinicId - Clinic ID
   * @param {string} fromCurrency - Source currency code
   * @param {string} toCurrency - Target currency code
   * @param {Date} date - Date for the rate lookup
   * @returns {number} Exchange rate
   */
  async getExchangeRate(clinicId, fromCurrency, toCurrency, date = new Date()) {
    if (fromCurrency === toCurrency) return 1.0;

    const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date;

    const rate = await ExchangeRate.findOne({
      where: {
        clinic_id: clinicId,
        from_currency: fromCurrency,
        to_currency: toCurrency,
        is_active: true,
        effective_date: { [Op.lte]: dateStr },
        [Op.or]: [
          { expiry_date: null },
          { expiry_date: { [Op.gte]: dateStr } }
        ]
      },
      order: [['effective_date', 'DESC']]
    });

    if (rate) return parseFloat(rate.rate);

    // Try inverse rate
    const inverseRate = await ExchangeRate.findOne({
      where: {
        clinic_id: clinicId,
        from_currency: toCurrency,
        to_currency: fromCurrency,
        is_active: true,
        effective_date: { [Op.lte]: dateStr },
        [Op.or]: [
          { expiry_date: null },
          { expiry_date: { [Op.gte]: dateStr } }
        ]
      },
      order: [['effective_date', 'DESC']]
    });

    if (inverseRate) return 1.0 / parseFloat(inverseRate.rate);

    throw new Error(`No exchange rate found for ${fromCurrency} to ${toCurrency} on ${dateStr}`);
  }

  /**
   * Convert amount from one currency to another
   */
  convertAmount(amount, exchangeRate) {
    return Math.round(parseFloat(amount) * parseFloat(exchangeRate) * 100) / 100;
  }

  // externalTransaction: pass an already-open Sequelize transaction to make this GL
  // entry part of a larger atomic operation (e.g. bill creation + its receivable
  // record) — the caller owns commit/rollback in that case. Omit it (the default,
  // used by every existing caller) to keep the original self-contained behavior:
  // this method opens and commits/rolls back its own transaction.
  /**
   * Create a GL entry and, unless a draft was asked for, post it.
   *
   * This used to always write a draft with its account_ledger rows flagged
   * is_posted = false, leaving every caller to remember a separate postGLEntry.
   * Three of them did not, so every patient bill's revenue sat unposted — and
   * because the income statement, trial balance and balance sheet all count
   * posted rows only, the reports showed a fraction of what had been billed
   * while nothing anywhere looked broken.
   *
   * Posting is now the default and happens inside the same transaction as the
   * entry itself, so an entry cannot exist in a state no report will show. A
   * genuine draft — the manual journal-entry screen, where a person creates an
   * entry and posts it as a separate act — passes { draft: true }.
   */
  async createGLEntry(glData, lineItems, userId, externalTransaction = null, options = {}) {
    const draft = options.draft === true;
    const transaction = externalTransaction || await sequelize.transaction();
    const ownsTransaction = !externalTransaction;

    try {
      // Validate that debits equal credits in transaction currency
      const totalDebits = lineItems.reduce((sum, item) => sum + parseFloat(item.debit_amount || 0), 0);
      const totalCredits = lineItems.reduce((sum, item) => sum + parseFloat(item.credit_amount || 0), 0);
      
      if (Math.abs(totalDebits - totalCredits) > 0.01) {
        throw new Error(`GL entry is not balanced. Debits: ${totalDebits}, Credits: ${totalCredits}`);
      }
      
      // Currency conversion
      const baseCurrencyData = await CurrencyService.getBaseCurrency();
      const baseCurrency = baseCurrencyData.code;
      const txnCurrency = glData.transaction_currency || baseCurrency;
      let exchangeRate = 1.0;

      if (txnCurrency !== baseCurrency) {
        exchangeRate = glData.exchange_rate
          ? parseFloat(glData.exchange_rate)
          : await this.getExchangeRate(glData.clinic_id, txnCurrency, baseCurrency, glData.transaction_date);
      }

      const baseTotalDebits = this.convertAmount(totalDebits, exchangeRate);
      const baseTotalCredits = this.convertAmount(totalCredits, exchangeRate);
      
      // Generate GL number if not provided
      const glNumber = glData.gl_number || await this.generateGLNumber(glData.clinic_id);
      
      // Create GL entry
      const glEntry = await GeneralLedger.create({
        ...glData,
        gl_number: glNumber,
        transaction_currency: txnCurrency,
        base_currency: baseCurrency,
        exchange_rate: exchangeRate,
        total_debit: totalDebits,
        total_credit: totalCredits,
        base_total_debit: baseTotalDebits,
        base_total_credit: baseTotalCredits,
        is_balanced: true,
        created_by: userId,
        status: draft ? 'draft' : 'posted',
        is_posted: !draft,
        posted_by: draft ? null : userId,
        posted_date: draft ? null : new Date()
      }, { transaction });
      
      // Create line items with base currency amounts
      const createdLineItems = [];
      for (const lineItem of lineItems) {
        const baseDebit = this.convertAmount(lineItem.debit_amount || 0, exchangeRate);
        const baseCredit = this.convertAmount(lineItem.credit_amount || 0, exchangeRate);

        const glLineItem = await GLLineItems.create({
          gl_id: glEntry.id,
          account_id: lineItem.account_id,
          debit_amount: lineItem.debit_amount || 0,
          credit_amount: lineItem.credit_amount || 0,
          base_debit_amount: baseDebit,
          base_credit_amount: baseCredit,
          line_description: lineItem.description
        }, { transaction });
        
        createdLineItems.push(glLineItem);
        
        // Create account ledger entries in BASE currency for reporting
        await AccountLedger.create({
          clinic_id: glData.clinic_id,
          account_id: lineItem.account_id,
          transaction_id: glEntry.id,
          transaction_date: glData.transaction_date,
          debit_amount: baseDebit,
          credit_amount: baseCredit,
          reference_number: glData.reference_id,
          description: lineItem.description,
          source_module: glData.reference_module,
          posted_by: userId,
          // Matches the entry above: a posted entry's ledger rows must be posted
          // too, or the reports that read account_ledger will not see them.
          is_posted: !draft,
          posted_date: draft ? null : new Date()
        }, { transaction });
      }
      
      if (ownsTransaction) await transaction.commit();

      return {
        ...glEntry.toJSON(),
        lineItems: createdLineItems
      };

    } catch (error) {
      if (ownsTransaction) await transaction.rollback();
      throw error;
    }
  }
  
  /**
   * Post a GL entry (make it permanent)
   * @param {string} glId - GL entry ID
   * @param {string} userId - User posting the entry
   */
  async postGLEntry(glId, userId) {
    // Read before opening the transaction. Querying without passing the
    // transaction while holding one checks out a second connection from the
    // same pool, and the pool is small: under concurrent billing every request
    // ended up holding one connection and waiting for another, so bills were
    // written while their ledger entry timed out — the income statement then
    // reported less than the cashier had actually taken.
    const glEntry = await GeneralLedger.findByPk(glId);
    if (!glEntry) {
      throw new Error('GL entry not found');
    }

    if (glEntry.status === 'posted' && glEntry.is_posted) {
      // Not an error. createGLEntry posts by default now, and most callers
      // still call this straight afterwards; throwing here would turn a
      // correctly-posted entry into a failure at every one of those sites.
      // This returns before any transaction is opened — it used to return out
      // of an open one, which leaked that connection permanently. Since this
      // is the common path, the pool drained a connection per bill until
      // nothing could post at all.
      return glEntry;
    }

    const transaction = await sequelize.transaction();

    try {
      
      // Update GL entry status
      await glEntry.update({
        status: 'posted',
        is_posted: true,
        posted_by: userId,
        posted_date: new Date()
      }, { transaction });
      
      // Update account ledger entries
      await AccountLedger.update({
        is_posted: true,
        posted_date: new Date()
      }, {
        where: { transaction_id: glId },
        transaction
      });
      
      await transaction.commit();
      return glEntry;
      
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  
  /**
   * Resolve the receivable account for a bill/invoice: insurance-scheme records
   * (scheme_id set) are owed by the insurer, not the patient directly, and
   * age/reconcile completely differently — they get their own receivable
   * account (1210) instead of being blended into the general patient
   * receivable (1200). Falls back to 1200 if 1210 was ever deactivated so
   * billing never hard-fails over a missing account. Every place that posts
   * a receivable-touching GL/JE entry (bill creation, payment, discount,
   * write-off, credit note) must use this same resolution, or the same
   * logical receivable ends up split across two different accounts and
   * neither one ever balances back to zero.
   */
  async getReceivableAccount(clinicId, schemeId) {
    return schemeId
      ? (await this.getAccountByCode(clinicId, '1210')) || (await this.getAccountByCode(clinicId, '1200'))
      : await this.getAccountByCode(clinicId, '1200');
  }

  /**
   * Create GL entry from patient bill
   * @param {Object} billData - Patient bill data
   * @param {string} userId - User creating the entry
   */
  async createGLFromPatientBill(billData, userId) {
    try {
      const receivablesAccount = await this.getReceivableAccount(billData.clinic_id, billData.scheme_id);
      const defaultRevenueAccount = await this.getAccountByCode(billData.clinic_id, '4100'); // Patient Services Revenue (fallback)

      if (!receivablesAccount || !defaultRevenueAccount) {
        // Name what was looked for and which schema answered. "Required accounts
        // not found" on its own cannot distinguish a genuinely missing account
        // from the lookup running against the wrong tenant — the template's
        // chart of accounts is clinic 1, so a clinic-6 tenant finds nothing
        // there and fails identically.
        const [[ctx]] = await sequelize.query('SELECT current_schema() AS schema').catch(() => [[{}]]);
        throw new Error(
          `Required accounts not found for patient billing — clinic ${billData.clinic_id}, `
          + `receivable ${receivablesAccount ? 'ok' : 'MISSING'}, revenue 4100 ${defaultRevenueAccount ? 'ok' : 'MISSING'}, `
          + `schema ${ctx?.schema || 'unknown'}`);
      }

      const glData = {
        clinic_id: billData.clinic_id,
        transaction_date: billData.bill_date || new Date(),
        transaction_type: 'patient_billing',
        description: `Patient Bill - ${billData.bill_number}`,
        reference_id: billData.id,
        reference_module: 'patient_billing',
        // Scheme-priced bills (e.g. insurance schemes billing in USD) carry their own
        // currency on bill_currency — without this, createGLEntry defaults to base
        // currency and posts the raw foreign-currency number straight into the SSP
        // ledger unconverted.
        transaction_currency: billData.bill_currency,
      };

      // Build per-service revenue credit line items
      const services = billData.services
        ? (typeof billData.services === 'string' ? JSON.parse(billData.services) : billData.services)
        : [];

      // Group services by revenue_account_id → sum amounts.
      //
      // Most callers write a bill line as a name, a quantity and a price and
      // nothing else, so relying on them to attach a revenue account meant
      // every such line grouped under one key and credited 4100. The line is
      // identified here instead, from the tenant's own catalogues, so a bill
      // splits correctly no matter which screen raised it.
      const { resolveRevenueAccountForLine } = require('../utils/resolveRevenueAccount');
      const revenueMap = {};
      for (const svc of services) {
        let acctId = svc.revenue_account_id || null;
        if (!acctId) {
          try {
            acctId = await resolveRevenueAccountForLine(svc, billData.clinic_id);
          } catch (e) {
            console.error('Could not classify bill line for revenue:', svc.serviceName, e.message);
          }
        }
        const amt = parseFloat(svc.totalPrice || svc.total_price || svc.price || 0);
        const key = acctId || 'default';
        if (!revenueMap[key]) revenueMap[key] = { account_id: acctId, amount: 0 };
        revenueMap[key].amount += amt;
      }

      // Resolve account IDs and build credit line items
      const revenueLineItems = [];
      for (const entry of Object.values(revenueMap)) {
        let acct = null;
        if (entry.account_id) {
          acct = await ChartOfAccounts.findByPk(entry.account_id);
        }
        if (!acct) acct = defaultRevenueAccount;
        revenueLineItems.push({
          account_id: acct.id,
          debit_amount: 0,
          credit_amount: entry.amount || parseFloat(billData.total_amount),
          description: `Revenue - ${billData.patient_name}`
        });
      }

      // If no services breakdown, credit default revenue for full amount
      if (revenueLineItems.length === 0) {
        revenueLineItems.push({
          account_id: defaultRevenueAccount.id,
          debit_amount: 0,
          credit_amount: parseFloat(billData.total_amount),
          description: `Patient services revenue - ${billData.patient_name}`
        });
      }

      const lineItems = [
        {
          account_id: receivablesAccount.id,
          debit_amount: parseFloat(billData.total_amount),
          credit_amount: 0,
          description: `Patient receivable - ${billData.patient_name}`
        },
        ...revenueLineItems
      ];

      // GL entry and its PatientReceivables row must both exist or neither does — a bill
      // whose GL entry committed but whose receivable record failed to write would show
      // correctly in the ledger while silently vanishing from receivables/aging reports
      // (and vice versa). Sharing one transaction makes that impossible.
      const receivablesTransaction = await sequelize.transaction();
      let glEntry;
      try {
        glEntry = await this.createGLEntry(glData, lineItems, userId, receivablesTransaction);

        await PatientReceivables.create({
          clinic_id: billData.clinic_id,
          patient_id: billData.patient_id,
          bill_id: billData.id,
          bill_number: billData.bill_number,
          service_date: billData.bill_date,
          bill_date: billData.bill_date,
          due_date: billData.due_date,
          service_description: 'Patient services',
          service_amount: billData.total_amount,
          amount_due: billData.total_amount,
          amount_paid: 0,
          status: 'pending',
          gl_entry_id: glEntry.id
        }, { transaction: receivablesTransaction });

        await receivablesTransaction.commit();
      } catch (innerError) {
        await receivablesTransaction.rollback();
        throw innerError;
      }

      // Post it.
      //
      // createGLEntry writes the entry as a draft and its account_ledger rows
      // with is_posted = false; only postGLEntry flips them. Nothing here ever
      // called it, so every patient bill's revenue sat unposted — and the income
      // statement counts posted rows only, so it showed a fraction of what had
      // actually been billed while the cashier's own totals showed the real
      // money. Posting happens after the commit above, because postGLEntry opens
      // its own transaction and cannot see rows that are still uncommitted.
      // Non-fatal: the bill and its ledger rows already exist and are correct,
      // so a failure here must be visible and repairable, not a lost bill.
      try {
        await this.postGLEntry(glEntry.id, userId);
      } catch (postError) {
        console.error(`GL entry ${glEntry.id} for bill ${billData.bill_number} was created but not posted:`, postError.message);
      }

      return glEntry;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Post a GL entry for services added to an ALREADY-CREATED bill (add-services, or a
   * duplicate-create-bill request merged into an existing bill). createGLFromPatientBill
   * above posts the bill's full total_amount and creates a fresh PatientReceivables row —
   * correct only once, at creation. Calling it again here for the whole (now-larger) total
   * would double-count everything already posted at creation time, and a second .create()
   * on PatientReceivables would duplicate that bill's row in the Aging report. This posts
   * only the newly-added amount, and tops up the existing PatientReceivables row instead of
   * creating another one — closing the gap where every add-services call previously posted
   * nothing at all (see patientBills.js), silently under-stating receivables/revenue by the
   * added amount forever.
   * @param {Object} bill - The bill row AFTER its total/balance were updated (needs id, clinic_id, scheme_id, bill_number, patient_name, bill_date, bill_currency)
   * @param {Array} addedServices - Just the newly-added service lines (not the whole bill)
   * @param {number} addedAmount - Sum of addedServices, in bill_currency — the exact delta being posted
   * @param {string} userId
   */
  async createGLTopUpForPatientBill(bill, addedServices, addedAmount, userId) {
    if (!addedAmount || addedAmount <= 0) return null;

    const receivablesAccount = await this.getReceivableAccount(bill.clinic_id, bill.scheme_id);
    const defaultRevenueAccount = await this.getAccountByCode(bill.clinic_id, '4100');
    if (!receivablesAccount || !defaultRevenueAccount) {
      throw new Error('Required accounts not found for patient billing');
    }

    const glData = {
      clinic_id: bill.clinic_id,
      transaction_date: new Date(),
      transaction_type: 'patient_billing',
      description: `Patient Bill - ${bill.bill_number} (items added)`,
      reference_id: bill.id,
      reference_module: 'patient_billing',
      transaction_currency: bill.bill_currency,
    };

    // Same classification as bill creation — items added to an existing bill
    // must land on the same revenue lines as items billed with it.
    const { resolveRevenueAccountForLine } = require('../utils/resolveRevenueAccount');
    const revenueMap = {};
    for (const svc of addedServices) {
      let acctId = svc.revenue_account_id || null;
      if (!acctId) {
        try {
          acctId = await resolveRevenueAccountForLine(svc, bill.clinic_id);
        } catch (e) {
          console.error('Could not classify added bill line for revenue:', svc.serviceName, e.message);
        }
      }
      const amt = parseFloat(svc.totalPrice || svc.total_price || svc.price || 0);
      const key = acctId || 'default';
      if (!revenueMap[key]) revenueMap[key] = { account_id: acctId, amount: 0 };
      revenueMap[key].amount += amt;
    }
    const revenueLineItems = [];
    for (const entry of Object.values(revenueMap)) {
      let acct = entry.account_id ? await ChartOfAccounts.findByPk(entry.account_id) : null;
      if (!acct) acct = defaultRevenueAccount;
      revenueLineItems.push({
        account_id: acct.id,
        debit_amount: 0,
        credit_amount: entry.amount || addedAmount,
        description: `Revenue - ${bill.patient_name}`,
      });
    }
    if (revenueLineItems.length === 0) {
      revenueLineItems.push({
        account_id: defaultRevenueAccount.id,
        debit_amount: 0,
        credit_amount: addedAmount,
        description: `Patient services revenue - ${bill.patient_name}`,
      });
    }

    const lineItems = [
      {
        account_id: receivablesAccount.id,
        debit_amount: addedAmount,
        credit_amount: 0,
        description: `Patient receivable (items added) - ${bill.patient_name}`,
      },
      ...revenueLineItems,
    ];

    const txn = await sequelize.transaction();
    try {
      const glEntry = await this.createGLEntry(glData, lineItems, userId, txn);

      // Top up the existing receivables row rather than creating a second one for the
      // same bill_id. If none exists yet (e.g. the original creation-time GL posting
      // failed — see the GL_POSTING_FAILED audit path in patientBills.js), there's
      // nothing to top up; that bill already needs manual reconciliation regardless,
      // so this is intentionally non-fatal rather than trying to reconstruct a row here.
      const [affected] = await PatientReceivables.update({
        amount_due: sequelize.literal(`amount_due + ${addedAmount}`),
        service_amount: sequelize.literal(`service_amount + ${addedAmount}`),
        status: sequelize.literal(`CASE WHEN status = 'paid' THEN 'partial' ELSE status END`),
      }, { where: { bill_id: bill.id }, transaction: txn });

      await txn.commit();
      if (affected === 0) {
        console.warn(`No PatientReceivables row found for bill ${bill.bill_number} — GL posted for the added ${addedAmount}, but the Receivables/Aging report won't reflect it until reconciled.`);
      }

      // Posted after the commit, for the same reason as bill creation: the
      // income statement only counts posted ledger rows, and postGLEntry runs
      // in its own transaction so it cannot see uncommitted ones.
      try {
        await this.postGLEntry(glEntry.id, userId);
      } catch (postError) {
        console.error(`GL entry ${glEntry.id} for items added to bill ${bill.bill_number} was created but not posted:`, postError.message);
      }

      return glEntry;
    } catch (error) {
      if (!txn.finished) await txn.rollback().catch(() => {});
      throw error;
    }
  }

  /**
   * Bring a bill's posted revenue back in line with what the bill is worth.
   *
   * Revenue is posted when a bill is created and topped up when items are added,
   * but a bill's total can also move by other routes — an item voided, a line
   * edited, PUT /patient-bills/:id changing total_amount outright — and each of
   * those was a way for the ledger to drift from the bill silently. Reports then
   * disagreed with the till, and the only way to notice was to add the day up by
   * hand.
   *
   * Rather than expecting every one of those paths to compute and post its own
   * delta correctly, this compares the two and posts the difference. It is
   * idempotent: run against a bill that already agrees, it does nothing. Call it
   * after anything that can change a bill's total, and drift cannot survive.
   *
   * Returns the adjustment posted, or 0.
   */
  async syncBillRevenueToGL(billId, userId = 'system') {
    if (!billId) return 0;

    const [[bill]] = await sequelize.query(
      `SELECT id, clinic_id, scheme_id, bill_number, bill_date,
              COALESCE(NULLIF(base_currency_total, 0), total_amount) AS worth
         FROM patient_bills WHERE id = :id LIMIT 1`,
      { replacements: { id: billId } });
    if (!bill) return 0;

    const [[postedRow]] = await sequelize.query(
      `SELECT COALESCE(SUM(al.credit_amount) - SUM(al.debit_amount), 0) AS revenue
         FROM account_ledger al
         JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
         JOIN general_ledger gl ON gl.id = al.transaction_id
        WHERE gl.reference_id = :id
          AND gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')`,
      { replacements: { id: billId } });

    const worth = parseFloat(bill.worth) || 0;
    const posted = parseFloat(postedRow?.revenue) || 0;
    const delta = Math.round((worth - posted) * 100) / 100;
    if (Math.abs(delta) < 0.01) return 0;

    // Put the adjustment where this bill's revenue already sits, so a service
    // line is corrected on the account it was recognised on rather than all of
    // it landing in one bucket.
    const [byAccount] = await sequelize.query(
      `SELECT al.account_id, SUM(al.credit_amount) - SUM(al.debit_amount) AS amount
         FROM account_ledger al
         JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
         JOIN general_ledger gl ON gl.id = al.transaction_id
        WHERE gl.reference_id = :id
          AND gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')
        GROUP BY 1`,
      { replacements: { id: billId } });

    let targets = byAccount.filter((r) => Math.abs(Number(r.amount)) > 0.001);
    if (targets.length === 0) {
      // Nothing posted yet for this bill: classify its own lines instead.
      const { resolveRevenueAccountForLine } = require('../utils/resolveRevenueAccount');
      const [[row]] = await sequelize.query('SELECT services FROM patient_bills WHERE id = :id', { replacements: { id: billId } });
      let services = row?.services;
      if (typeof services === 'string') { try { services = JSON.parse(services); } catch { services = []; } }
      const totals = new Map();
      for (const line of (Array.isArray(services) ? services : [])) {
        if (!line || line.isVoided) continue;
        const amount = parseFloat(line.totalPrice || line.total_price || 0) || 0;
        if (amount <= 0) continue;
        const acct = line.revenue_account_id || await resolveRevenueAccountForLine(line, bill.clinic_id);
        if (!acct) continue;
        totals.set(acct, (totals.get(acct) || 0) + amount);
      }
      targets = [...totals.entries()].map(([account_id, amount]) => ({ account_id, amount }));
    }
    if (targets.length === 0) {
      const fallback = await this.getAccountByCode(bill.clinic_id, '4100');
      if (!fallback) {
        console.error(`Bill ${bill.bill_number}: revenue is out by ${delta} but no account could be resolved to correct it.`);
        return 0;
      }
      targets = [{ account_id: fallback.id, amount: 1 }];
    }

    const receivable = await this.getReceivableAccount(bill.clinic_id, bill.scheme_id);
    if (!receivable) {
      console.error(`Bill ${bill.bill_number}: revenue is out by ${delta} but no receivable account was found.`);
      return 0;
    }

    const adding = delta > 0;
    const magnitude = Math.abs(delta);
    const weights = targets.map((r) => Math.abs(Number(r.amount)) || 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const lineItems = [];
    let allocated = 0;
    targets.forEach((r, i) => {
      const share = i === targets.length - 1
        ? Math.round((magnitude - allocated) * 100) / 100
        : Math.round((weights[i] / totalWeight) * magnitude * 100) / 100;
      allocated = Math.round((allocated + share) * 100) / 100;
      if (share <= 0) return;
      lineItems.push({
        account_id: r.account_id,
        debit_amount: adding ? 0 : share,
        credit_amount: adding ? share : 0,
        description: `Revenue ${adding ? 'adjustment' : 'reversal'} - ${bill.bill_number}`,
      });
    });
    lineItems.push({
      account_id: receivable.id,
      debit_amount: adding ? magnitude : 0,
      credit_amount: adding ? 0 : magnitude,
      description: `Receivable ${adding ? 'adjustment' : 'reversal'} - ${bill.bill_number}`,
    });

    const glEntry = await this.createGLEntry({
      clinic_id: bill.clinic_id,
      transaction_date: new Date().toISOString().split('T')[0],
      transaction_type: 'bill_revenue_adjustment',
      description: `Revenue brought in line with bill ${bill.bill_number}`,
      reference_id: bill.id,
      reference_module: 'bill_revenue_adjustment',
    }, lineItems, userId);

    console.log(`Bill ${bill.bill_number}: revenue was out by ${delta}, corrected via ${glEntry.gl_number}.`);
    return delta;
  }

  /**
   * Create GL entry from payment receipt
   * @param {Object} receiptData - Payment receipt data
   * @param {string} userId - User creating the entry
   */
  async createGLFromPayment(receiptData, userId) {
    try {
      // Get accounts for payment
      const cashAccount = await this.getAccountByCode(receiptData.clinic_id, '1100'); // Cash
      const receivablesAccount = await this.getAccountByCode(receiptData.clinic_id, '1200'); // Accounts Receivable
      
      if (!cashAccount || !receivablesAccount) {
        throw new Error('Required accounts not found for payment processing');
      }
      
      const glData = {
        clinic_id: receiptData.clinic_id,
        transaction_date: receiptData.payment_date || new Date(),
        transaction_type: 'payment_receipt',
        description: `Payment Receipt - ${receiptData.receipt_number}`,
        reference_id: receiptData.id,
        reference_module: 'payment_receipt'
      };
      
      const lineItems = [
        {
          account_id: cashAccount.id,
          debit_amount: receiptData.amount_paid,
          credit_amount: 0,
          description: `Cash received from ${receiptData.patient_name}`
        },
        {
          account_id: receivablesAccount.id,
          debit_amount: 0,
          credit_amount: receiptData.amount_paid,
          description: `Payment against receivable - ${receiptData.patient_name}`
        }
      ];
      
      const glEntry = await this.createGLEntry(glData, lineItems, userId);
      
      // Update patient receivables
      await PatientReceivables.update({
        amount_paid: sequelize.literal(`amount_paid + ${receiptData.amount_paid}`),
        amount_due: sequelize.literal(`amount_due - ${receiptData.amount_paid}`),
        last_payment_date: receiptData.payment_date,
        status: sequelize.literal(`CASE 
          WHEN amount_due - ${receiptData.amount_paid} <= 0 THEN 'paid' 
          ELSE 'partial' 
        END`)
      }, {
        where: { 
          bill_id: receiptData.bill_id,
          clinic_id: receiptData.clinic_id
        }
      });

      // A receipt's entry needs posting too, or cash collected never reaches the
      // cash account on any report. This one runs outside a transaction of its
      // own, so it can post immediately.
      try {
        await this.postGLEntry(glEntry.id, userId);
      } catch (postError) {
        console.error(`GL entry ${glEntry.id} for receipt ${receiptData.receipt_number} was created but not posted:`, postError.message);
      }

      return glEntry;
      
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Get account by account code
   * @param {number} clinicId - Clinic ID
   * @param {string} accountCode - Account code
   * @returns {Object} Account object
   */
  async getAccountByCode(clinicId, accountCode) {
    return await ChartOfAccounts.findOne({
      where: {
        clinic_id: clinicId,
        account_code: accountCode,
        is_active: true
      }
    });
  }
  
  /**
   * Generate GL number
   * @param {number} clinicId - Clinic ID
   * @returns {string} GL number
   */
  async generateGLNumber(clinicId) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Get the last GL number for this clinic and period
    const lastGL = await GeneralLedger.findOne({
      where: {
        clinic_id: clinicId,
        gl_number: {
          [Op.like]: `GL-${year}${month}-%`
        }
      },
      order: [['gl_number', 'DESC']]
    });
    
    let sequence = 1;
    if (lastGL) {
      const lastSequence = parseInt(lastGL.gl_number.split('-').pop());
      sequence = lastSequence + 1;
    }
    
    return `GL-${year}${month}-${String(sequence).padStart(4, '0')}`;
  }
  
  /**
   * Get account balance
   * @param {string} accountId - Account ID
   * @param {Date} asOfDate - Date to calculate balance as of
   * @returns {number} Account balance
   */
  async getAccountBalance(accountId, asOfDate = new Date()) {
    const account = await ChartOfAccounts.findByPk(accountId);
    if (!account) {
      throw new Error('Account not found');
    }
    
    const ledgerEntries = await AccountLedger.findAll({
      where: {
        account_id: accountId,
        transaction_date: {
          [Op.lte]: asOfDate
        },
        is_posted: true
      }
    });
    
    let balance = parseFloat(account.opening_balance || 0);
    
    for (const entry of ledgerEntries) {
      if (account.balance_type === 'debit') {
        balance += parseFloat(entry.debit_amount || 0) - parseFloat(entry.credit_amount || 0);
      } else {
        balance += parseFloat(entry.credit_amount || 0) - parseFloat(entry.debit_amount || 0);
      }
    }
    
    return balance;
  }
  
  /**
   * Get trial balance
   * @param {number} clinicId - Clinic ID
   * @param {Date} asOfDate - Date to calculate trial balance as of
   * @returns {Array} Trial balance data
   */
  async getTrialBalance(clinicId, asOfDate = new Date()) {
    const accounts = await ChartOfAccounts.findAll({
      where: {
        clinic_id: clinicId,
        is_active: true
      },
      order: [['account_code', 'ASC']]
    });
    
    const trialBalance = [];
    let totalDebits = 0;
    let totalCredits = 0;
    
    for (const account of accounts) {
      const balance = await this.getAccountBalance(account.id, asOfDate);

      // A debit-type account that goes negative (e.g. an overdrawn bank
      // account) used to report 0 on BOTH sides here instead of flipping to
      // the credit column — silently dropping its balance from the trial
      // balance entirely, while is_balanced could still read true. Sort by
      // the balance's actual sign, not blindly by the account's nominal type.
      let debitBalance = 0;
      let creditBalance = 0;
      if (account.balance_type === 'debit') {
        if (balance >= 0) debitBalance = balance; else creditBalance = Math.abs(balance);
      } else {
        if (balance >= 0) creditBalance = balance; else debitBalance = Math.abs(balance);
      }

      totalDebits += debitBalance;
      totalCredits += creditBalance;
      
      trialBalance.push({
        account_code: account.account_code,
        account_name: account.account_name,
        account_type: account.account_type,
        balance_type: account.balance_type,
        debit_balance: debitBalance,
        credit_balance: creditBalance
      });
    }
    
    return {
      accounts: trialBalance,
      total_debits: totalDebits,
      total_credits: totalCredits,
      is_balanced: Math.abs(totalDebits - totalCredits) < 0.01
    };
  }
}

module.exports = new AccountingService();
