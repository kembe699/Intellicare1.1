const { Op } = require('sequelize');
const { 
  ChartOfAccounts, 
  GeneralLedger, 
  GLLineItems, 
  AccountLedger,
  ExchangeRate,
  sequelize 
} = require('../models');
const CurrencyService = require('./CurrencyService');
const { v4: uuidv4 } = require('uuid');
const { getNextDocumentNumber } = require('./DocumentNumberService');

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

    // C4: this used to be caught by callers and silently treated as 1:1 —
    // posting a USD payment as if it were the same number of SSP, understating
    // (or overstating) the ledger with no visible sign anything was wrong.
    // Every real caller now lets this propagate and fails the whole posting
    // instead (see JournalPostingService.postJournalEntry, which never
    // catches it) — the message says exactly what to do about it, since this
    // is the error a cashier will actually see.
    throw new Error(`No exchange rate found for ${fromCurrency} to ${toCurrency} on ${dateStr} — add today's ${fromCurrency}→${toCurrency} rate in Accounting > Exchange Rates before recording this.`);
  }

  /**
   * Like getExchangeRate, but for money that is about to be paid, posted or
   * charged: never falls back to 1:1. Throws a 400-tagged error naming the
   * exact rate and date to add, for the caller to return as-is.
   * @param {string} [action] - what is being blocked, e.g. "pay Akol Deng's salary"
   */
  async requireExchangeRate(clinicId, fromCurrency, toCurrency, date = new Date(), action = '') {
    if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return 1;
    try {
      const rate = parseFloat(await this.getExchangeRate(clinicId, fromCurrency, toCurrency, date));
      if (rate > 0) return rate;
    } catch (e) { /* fall through to the clear refusal below */ }
    const d = date instanceof Date ? date : new Date(date);
    const day = Number.isNaN(d.getTime()) ? String(date) : d.toISOString().split('T')[0];
    const err = new Error(
      `Cannot ${action || 'record this'} — there is no ${fromCurrency}→${toCurrency} exchange rate for ${day}. ` +
      `Add the ${fromCurrency}→${toCurrency} rate for ${day} in Accounting › Exchange Rates, then try again.`
    );
    err.statusCode = 400;
    err.isExchangeRateError = true;
    throw err;
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
      
      // N1: the number is allocated from document_number_counters (see
      // DocumentNumberService.js) inside this SAME transaction, which takes a
      // row lock as part of the allocation — a concurrent writer for the same
      // clinic/period simply blocks until this transaction commits or rolls
      // back, so two entries can never be handed the same number. A failed
      // INSERT aborts the whole Postgres transaction anyway (there is no
      // "retry with the next number" possible once that happens — the
      // transaction is already dead), so the old retry loop here could never
      // actually have succeeded; removed rather than reimplemented.
      const glNumber = glData.gl_number || await getNextDocumentNumber('GL', glData.clinic_id, transaction, { date: glData.transaction_date });
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
      
      // Create line items with base currency amounts.
      //
      // C6: converting each line independently can leave base debits and
      // base credits a cent or two apart even though the transaction-currency
      // amounts balance exactly — convertAmount rounds every line on its
      // own, and rounding several lines independently does not generally sum
      // to the same total as rounding the sum once. The entry's own
      // base_total_debit/base_total_credit (computed from the TOTALS above,
      // not from summing per-line roundings) are already correct — the last
      // line on each side is made to absorb whatever the per-line rounding
      // drifted by, so the line items always foot to the entry's own totals
      // exactly, not just approximately.
      const lastDebitIndex = lineItems.map((l) => parseFloat(l.debit_amount) || 0).reduce((lastIdx, v, i) => (v > 0 ? i : lastIdx), -1);
      const lastCreditIndex = lineItems.map((l) => parseFloat(l.credit_amount) || 0).reduce((lastIdx, v, i) => (v > 0 ? i : lastIdx), -1);
      let runningBaseDebit = 0;
      let runningBaseCredit = 0;
      const createdLineItems = [];
      for (let i = 0; i < lineItems.length; i++) {
        const lineItem = lineItems[i];
        let baseDebit = this.convertAmount(lineItem.debit_amount || 0, exchangeRate);
        let baseCredit = this.convertAmount(lineItem.credit_amount || 0, exchangeRate);
        if (i === lastDebitIndex) baseDebit = Number((baseTotalDebits - runningBaseDebit).toFixed(2));
        if (i === lastCreditIndex) baseCredit = Number((baseTotalCredits - runningBaseCredit).toFixed(2));
        runningBaseDebit += baseDebit;
        runningBaseCredit += baseCredit;

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
          // B7: account_ledger.branch_id is what branch-scoped reports actually
          // filter on (see reportIncomeStatement.js's branchScope(), which
          // queries account_ledger directly) — general_ledger/gl_line_items have
          // no branch_id column at all, so this was the one place a missing
          // value actually mattered. Every entry used to post with no branch_id
          // whatsoever regardless of what the caller resolved, so a branch's own
          // income statement never saw its own patient billing revenue at all.
          branch_id: glData.branch_id || null,
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
   * @param {import('sequelize').Transaction} [externalTransaction] - When given, the
   *   GL entry and its receivable row become part of THIS transaction instead of
   *   their own — the caller (patientBills.js) includes the PatientBill row itself
   *   in the same transaction, so the bill and its ledger entry either both commit
   *   or neither does. See the real production gap this closes: a bill could commit
   *   while its GL posting failed for any reason, and the income statement fell
   *   short of the cashier's own totals with nothing looking wrong until someone
   *   noticed the day didn't add up (ledgerSweeper.js's docstring has the full story).
   */
  async createGLFromPatientBill(billData, userId, externalTransaction = null) {
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
        // B7: without this, every patient bill's revenue posted with no
        // branch_id at all — a branch-scoped income statement (or the
        // branch-filtered account_ledger/gl_line_items any report reads)
        // could never show this entry, regardless of which branch actually
        // billed it.
        branch_id: billData.branch_id || null,
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

      // patient_receivables is retired (no longer written): receivables come from
      // patient_bills plus the ledger. ownsTransaction is false when the caller
      // (patientBills.js) supplied the transaction that also holds the bill row.
      const ownsTransaction = !externalTransaction;
      const receivablesTransaction = externalTransaction || await sequelize.transaction();
      let glEntry;
      try {
        glEntry = await this.createGLEntry(glData, lineItems, userId, receivablesTransaction);

        if (ownsTransaction) await receivablesTransaction.commit();
      } catch (innerError) {
        if (ownsTransaction) await receivablesTransaction.rollback();
        throw innerError;
      }

      // Legacy self-transacting path only (no externalTransaction supplied): confirm
      // the entry posted. createGLEntry already posts by default within the
      // transaction just committed above, so this is normally a fast no-op
      // (postGLEntry returns immediately for an already-posted entry) — kept as a
      // last-resort safety net for this path specifically. Skipped entirely when
      // the caller supplied its own transaction: that transaction has not committed
      // yet, so a fresh query here would not find the row at all, and posting
      // already happened atomically as part of it regardless.
      if (ownsTransaction) {
        try {
          await this.postGLEntry(glEntry.id, userId);
        } catch (postError) {
          console.error(`GL entry ${glEntry.id} for bill ${billData.bill_number} was created but not posted:`, postError.message);
        }
      }

      return glEntry;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Post a GL entry for services added to an ALREADY-CREATED bill (add-services, or a
   * duplicate-create-bill request merged into an existing bill). Posts only the newly-added
   * amount; calling createGLFromPatientBill again would double-count the total already posted.
   * @param {Object} bill - The bill row AFTER its total/balance were updated (needs id, clinic_id, scheme_id, bill_number, patient_name, bill_date, bill_currency)
   * @param {Array} addedServices - Just the newly-added service lines (not the whole bill)
   * @param {number} addedAmount - Sum of addedServices, in bill_currency — the exact delta being posted
   * @param {string} userId
   * @param {import('sequelize').Transaction} [externalTransaction] - When given (the
   *   merge-into-existing-bill path in patientBills.js), this top-up joins the same
   *   transaction as the bill row update itself, for the same atomicity reason as
   *   createGLFromPatientBill above.
   */
  async createGLTopUpForPatientBill(bill, addedServices, addedAmount, userId, externalTransaction = null) {
    if (!addedAmount || addedAmount <= 0) return null;

    const receivablesAccount = await this.getReceivableAccount(bill.clinic_id, bill.scheme_id);
    const defaultRevenueAccount = await this.getAccountByCode(bill.clinic_id, '4100');
    if (!receivablesAccount || !defaultRevenueAccount) {
      throw new Error('Required accounts not found for patient billing');
    }

    const glData = {
      clinic_id: bill.clinic_id,
      branch_id: bill.branch_id || null, // B7 — see createGLFromPatientBill's identical comment
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

    const ownsTransaction = !externalTransaction;
    const txn = externalTransaction || await sequelize.transaction();
    try {
      const glEntry = await this.createGLEntry(glData, lineItems, userId, txn);

      if (ownsTransaction) {
        await txn.commit();
        // Legacy self-transacting path only — see createGLFromPatientBill's own
        // comment on why this is skipped when the caller supplies a transaction.
        try {
          await this.postGLEntry(glEntry.id, userId);
        } catch (postError) {
          console.error(`GL entry ${glEntry.id} for items added to bill ${bill.bill_number} was created but not posted:`, postError.message);
        }
      }

      return glEntry;
    } catch (error) {
      if (ownsTransaction && !txn.finished) await txn.rollback().catch(() => {});
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
      `SELECT id, clinic_id, branch_id, scheme_id, bill_number, bill_date, status,
              COALESCE(NULLIF(base_currency_total, 0), total_amount) AS worth
         FROM patient_bills WHERE id = :id LIMIT 1`,
      { replacements: { id: billId } });
    // A cancelled bill's postings were fully reversed on purpose — never re-post them.
    if (!bill || bill.status === 'cancelled') return 0;

    // Credit notes lower the bill's total AND reverse revenue under their own
    // reference (the note's id); counting them here keeps the two in step, so
    // this sync never reverses an applied credit a second time.
    const [[postedRow]] = await sequelize.query(
      `SELECT COALESCE(SUM(al.credit_amount) - SUM(al.debit_amount), 0) AS revenue
         FROM account_ledger al
         JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
         JOIN general_ledger gl ON gl.id = al.transaction_id
        WHERE (gl.reference_id = :id
               AND gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment'))
           OR (gl.reference_module = 'credit_note'
               AND gl.reference_id::text IN (SELECT id::text FROM credit_notes WHERE applied_to_bill_id::text = :id))`,
      { replacements: { id: billId } });

    const worth = parseFloat(bill.worth) || 0;
    const posted = parseFloat(postedRow?.revenue) || 0;
    const delta = Math.round((worth - posted) * 100) / 100;
    if (Math.abs(delta) < 0.01) return 0;

    // What each account should hold, taken from the bill's own lines.
    //
    // Splitting the shortfall across accounts in proportion to what they already
    // hold produces amounts that match no real price: a 3,000 correction became
    // 321.72 consultation, 1,126.01 laboratory and 1,552.27 pharmacy, and the
    // income statement then reported consultation revenue of 237,257.76 for a
    // service that costs 20,000 or 50,000. The figures were right in total and
    // unreadable line by line.
    //
    // The bill already says what each line is worth and which account it belongs
    // to, so the correction per account is simply its target less what it holds.
    // Every amount posted is then a real price or the difference between two.
    const { resolveRevenueAccountForLine } = require('../utils/resolveRevenueAccount');
    const [[servicesRow]] = await sequelize.query(
      'SELECT services FROM patient_bills WHERE id = :id', { replacements: { id: billId } });
    let services = servicesRow?.services;
    if (typeof services === 'string') { try { services = JSON.parse(services); } catch { services = []; } }

    const targetByAccount = new Map();
    for (const line of (Array.isArray(services) ? services : [])) {
      if (!line || line.isVoided) continue;
      const amount = parseFloat(line.totalPrice || line.total_price || 0) || 0;
      if (amount <= 0) continue;
      const acct = line.revenue_account_id || await resolveRevenueAccountForLine(line, bill.clinic_id);
      if (!acct) continue;
      targetByAccount.set(acct, Math.round(((targetByAccount.get(acct) || 0) + amount) * 100) / 100);
    }

    const [byAccount] = await sequelize.query(
      `SELECT al.account_id, SUM(al.credit_amount) - SUM(al.debit_amount) AS amount
         FROM account_ledger al
         JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
         JOIN general_ledger gl ON gl.id = al.transaction_id
        WHERE gl.reference_id = :id
          AND gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')
        GROUP BY 1`,
      { replacements: { id: billId } });
    const postedByAccount = new Map(
      byAccount.map((r) => [String(r.account_id), Math.round((Number(r.amount) || 0) * 100) / 100]));

    // Per-account differences, when the bill's lines account for the whole delta.
    let perAccount = null;
    if (targetByAccount.size > 0) {
      const diffs = [];
      let summed = 0;
      for (const key of new Set([...targetByAccount.keys(), ...postedByAccount.keys()].map(String))) {
        const diff = Math.round(((targetByAccount.get(key) || 0) - (postedByAccount.get(key) || 0)) * 100) / 100;
        if (Math.abs(diff) < 0.01) continue;
        diffs.push({ account_id: key, diff });
        summed = Math.round((summed + diff) * 100) / 100;
      }
      // Only trust this when it reconciles to the delta already computed; if the
      // bill's lines do not explain the gap, fall back rather than invent a split.
      if (Math.abs(summed - delta) < 0.01) perAccount = diffs;
    }

    let targets = byAccount.filter((r) => Math.abs(Number(r.amount)) > 0.001);
    if (targets.length === 0) {
      targets = [...targetByAccount.entries()].map(([account_id, amount]) => ({ account_id, amount }));
    }
    if (!perAccount && targets.length === 0) {
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
    const lineItems = [];

    if (perAccount) {
      // Each account moved to what the bill says it should hold. An account may
      // move the opposite way to the overall delta — one line over-posted while
      // another was missed — which proportional splitting could never express.
      for (const { account_id, diff } of perAccount) {
        lineItems.push({
          account_id,
          debit_amount: diff < 0 ? Math.abs(diff) : 0,
          credit_amount: diff > 0 ? diff : 0,
          description: `Revenue ${diff > 0 ? 'adjustment' : 'reversal'} - ${bill.bill_number}`,
        });
      }
    } else {
      // The bill's lines do not explain the gap — a voided item, a bill edited
      // after posting. Spread it over the accounts this bill has touched, which
      // keeps the total right even though the split is an estimate.
      const weights = targets.map((r) => Math.abs(Number(r.amount)) || 1);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
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
    }
    lineItems.push({
      account_id: receivable.id,
      debit_amount: adding ? magnitude : 0,
      credit_amount: adding ? 0 : magnitude,
      description: `Receivable ${adding ? 'adjustment' : 'reversal'} - ${bill.bill_number}`,
    });

    // Date the correction to the bill, not to the day the correction happened.
    // Revenue belongs to the period the bill was raised in: dating a repair to
    // today moves an old bill's money onto today's income statement and leaves
    // the day it actually belonged to permanently short. A late repair must
    // leave every day's total right, including days already reported on.
    const billDay = bill.bill_date
      ? new Date(bill.bill_date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const glEntry = await this.createGLEntry({
      clinic_id: bill.clinic_id,
      branch_id: bill.branch_id,
      transaction_date: billDay,
      transaction_type: 'bill_revenue_adjustment',
      description: `Revenue brought in line with bill ${bill.bill_number}`,
      reference_id: bill.id,
      reference_module: 'bill_revenue_adjustment',
    }, lineItems, userId);

    console.log(`Bill ${bill.bill_number}: revenue was out by ${delta}, corrected via ${glEntry.gl_number}.`);
    return delta;
  }

  // N4: createGLFromPayment removed — confirmed unused (its one caller,
  // BillingIntegrationService.handlePaymentReceipt, was itself never called
  // from anywhere else, so both were dead). It was also wrong: it hardcoded
  // account_code '1200' (Patient AR) regardless of receiptData.scheme_id, so
  // an insurance/scheme bill's payment would have credited the wrong
  // receivable (1200 instead of 1210 Insurance Receivables) had anything
  // ever called it. Real payment posting now goes through
  // JournalPostingService.postJournalEntry, which every live payment path
  // (patientBills.js, patientDeposits.js, receipts.js, invoices.js,
  // cashier.js, cash-transfers.js) already uses.

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
  
  // N1: GL number allocation moved to DocumentNumberService.getNextDocumentNumber,
  // called directly from createGLEntry (it needs the entry's own open
  // transaction, which this method never had). The old "read the highest
  // gl_number sorted as text, +skip" version lived here — removed, not kept as
  // a wrapper, since keeping it would leave a second, still-racy way to
  // generate a GL number available to call.


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
