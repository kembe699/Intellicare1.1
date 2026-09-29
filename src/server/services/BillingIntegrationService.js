const AccountingService = require('./AccountingService');
const { PatientBill, Receipt } = require('../models');

/**
 * Retry an operation that failed for a reason unrelated to its own correctness.
 *
 * A connection that was momentarily unavailable says nothing about whether the
 * entry is valid, and the cost of giving up is silent: the bill is already
 * committed, so the money simply never reaches the reports. Anything that looks
 * like an accounting error is passed straight through — retrying a missing
 * account or an unbalanced entry only produces the same failure again.
 */
const TRANSIENT = /operation timeout|connection terminated|connection refused|econnreset|etimedout|server closed the connection|too many clients|pool is draining/i;

function isTransient(error) {
  const name = error?.name || '';
  if (name === 'SequelizeConnectionAcquireTimeoutError'
    || name === 'SequelizeConnectionError'
    || name === 'SequelizeConnectionRefusedError'
    || name === 'SequelizeHostNotReachableError'
    || name === 'TimeoutError') return true;
  return TRANSIENT.test(error?.message || '');
}

async function withTransientRetry(operation, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts) throw error;
      // Back off before retrying so a pool under pressure is given a moment to
      // drain rather than being hammered by the retry itself.
      const waitMs = 250 * attempt;
      console.warn(`${label}: ${error.message} — retrying in ${waitMs}ms (attempt ${attempt + 1}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}


class BillingIntegrationService {
  
  /**
   * Handle patient bill creation - create GL entries
   * @param {Object} billData - Patient bill data
   * @param {string} userId - User creating the bill
   * @param {import('sequelize').Transaction} [externalTransaction] - When given
   *   (patientBills.js's bill-creation flow), the GL entry joins the SAME
   *   transaction as the PatientBill row itself — a real ACID operation: the bill
   *   and its ledger entry either both commit or neither does. A failure here is
   *   rethrown, not swallowed, and NOT retried in isolation: a failed statement
   *   poisons the whole transaction in Postgres, so only the caller — starting a
   *   fresh transaction from scratch — can meaningfully retry. See
   *   patientBills.js's outer withTransientRetry for that.
   */
  async handleBillCreation(billData, userId, externalTransaction = null) {
    if (externalTransaction) {
      return AccountingService.createGLFromPatientBill(billData, userId, externalTransaction);
    }
    try {
      console.log('Creating accounting entries for patient bill:', billData.bill_number);

      // Legacy self-transacting path (no externalTransaction supplied) — kept for
      // any other caller (e.g. syncExistingBills below) that posts a bill's GL
      // entry well after the bill itself already committed, where true atomicity
      // with the bill row is no longer possible anyway.
      //
      // Retry a transient failure rather than dropping the entry on the floor.
      // A busy moment — a connection briefly unavailable, a dropped socket — is
      // not a reason for a bill's revenue to go unrecorded, and the ledger
      // sweeper would otherwise not correct it for several minutes. A real
      // accounting fault (a missing account, an unbalanced entry) is not
      // retried: repeating it just produces the same error more slowly.
      const glEntry = await withTransientRetry(
        () => AccountingService.createGLFromPatientBill(billData, userId),
        `ledger entry for bill ${billData.bill_number}`
      );

      // Post the GL entry immediately for patient billing
      await withTransientRetry(
        () => AccountingService.postGLEntry(glEntry.id, userId),
        `posting ledger entry for bill ${billData.bill_number}`
      );

      console.log(`GL entry ${glEntry.gl_number} created and posted for bill ${billData.bill_number}`);

      return glEntry;
    } catch (error) {
      // Deliberately not rethrown: a bill must not fail because its ledger entry
      // did. But the reason has to survive — returning a bare null discarded it,
      // so the audit trail recorded "failed to post" with nothing to act on and
      // the only copy of the cause was a console line on the server.
      console.error('Error creating accounting entries for bill:', error);
      this.lastBillPostingError = error?.message || String(error);
      return null;
    }
  }
  
  // N4: handlePaymentReceipt removed — confirmed unused (nothing outside
  // this file ever called it), and its only dependency,
  // AccountingService.createGLFromPayment, was removed alongside it for the
  // same reason. See AccountingService.js's own comment at that spot.

  /**
   * Handle lab request billing - create GL entries
   * @param {Object} labRequestData - Lab request data
   * @param {Object} billData - Associated bill data
   * @param {string} userId - User creating the request
   */
  async handleLabRequestBilling(labRequestData, billData, userId) {
    try {
      console.log('Creating accounting entries for lab request billing:', labRequestData.test_name);
      
      // Use the same bill creation logic but with lab-specific details
      const enhancedBillData = {
        ...billData,
        service_description: `Lab Test: ${labRequestData.test_name}`,
        reference_module: 'lab_billing'
      };
      
      return await this.handleBillCreation(enhancedBillData, userId);
    } catch (error) {
      console.error('Error creating accounting entries for lab request:', error);
      return null;
    }
  }
  
  /**
   * Handle pharmacy sales - create GL entries
   * @param {Object} salesData - Pharmacy sales data
   * @param {string} userId - User processing the sale
   */
  async handlePharmacySale(salesData, userId) {
    try {
      console.log('Creating accounting entries for pharmacy sale');
      
      // Get accounts for pharmacy sales
      const receivablesAccount = await AccountingService.getAccountByCode(salesData.clinic_id, '1200'); // Accounts Receivable
      const revenueAccount = await AccountingService.getAccountByCode(salesData.clinic_id, '4120'); // Pharmacy Sales Revenue
      const inventoryAccount = await AccountingService.getAccountByCode(salesData.clinic_id, '1310'); // Pharmaceutical Inventory
      const cogsAccount = await AccountingService.getAccountByCode(salesData.clinic_id, '5210'); // Pharmaceutical Cost of Sales
      
      if (!receivablesAccount || !revenueAccount || !inventoryAccount || !cogsAccount) {
        throw new Error('Required accounts not found for pharmacy sales');
      }
      
      // Create GL entry for the sale
      const saleGLData = {
        clinic_id: salesData.clinic_id,
        transaction_date: salesData.sale_date || new Date(),
        transaction_type: 'pharmacy_sale',
        description: `Pharmacy Sale - ${salesData.reference_number}`,
        reference_id: salesData.id,
        reference_module: 'pharmacy_sales'
      };
      
      const saleLineItems = [
        {
          account_id: receivablesAccount.id,
          debit_amount: salesData.total_amount,
          credit_amount: 0,
          description: `Pharmacy sale receivable - ${salesData.patient_name}`
        },
        {
          account_id: revenueAccount.id,
          debit_amount: 0,
          credit_amount: salesData.total_amount,
          description: `Pharmacy sales revenue - ${salesData.patient_name}`
        }
      ];
      
      const saleGLEntry = await AccountingService.createGLEntry(saleGLData, saleLineItems, userId);
      
      // Create GL entry for cost of goods sold (if cost data available)
      if (salesData.cost_amount && salesData.cost_amount > 0) {
        const cogsGLData = {
          clinic_id: salesData.clinic_id,
          transaction_date: salesData.sale_date || new Date(),
          transaction_type: 'pharmacy_cogs',
          description: `Pharmacy COGS - ${salesData.reference_number}`,
          reference_id: salesData.id,
          reference_module: 'pharmacy_cogs'
        };
        
        const cogsLineItems = [
          {
            account_id: cogsAccount.id,
            debit_amount: salesData.cost_amount,
            credit_amount: 0,
            description: `Cost of pharmaceuticals sold`
          },
          {
            account_id: inventoryAccount.id,
            debit_amount: 0,
            credit_amount: salesData.cost_amount,
            description: `Reduction in pharmaceutical inventory`
          }
        ];
        
        const cogsGLEntry = await AccountingService.createGLEntry(cogsGLData, cogsLineItems, userId);
        await AccountingService.postGLEntry(cogsGLEntry.id, userId);
      }
      
      // Post the sale GL entry
      await AccountingService.postGLEntry(saleGLEntry.id, userId);
      
      return saleGLEntry;
    } catch (error) {
      console.error('Error creating accounting entries for pharmacy sale:', error);
      return null;
    }
  }
  
  /**
   * Handle expense recording - create GL entries
   * @param {Object} expenseData - Expense data
   * @param {string} userId - User recording the expense
   */
  async handleExpenseRecording(expenseData, userId) {
    try {
      console.log('Creating accounting entries for expense:', expenseData.description);
      
      // Get accounts for expense recording
      const expenseAccount = await AccountingService.getAccountByCode(expenseData.clinic_id, expenseData.expense_account_code || '5900'); // Default to Miscellaneous Expenses
      const payableAccount = await AccountingService.getAccountByCode(expenseData.clinic_id, '2100'); // Accounts Payable
      const cashAccount = await AccountingService.getAccountByCode(expenseData.clinic_id, '1100'); // Cash
      
      if (!expenseAccount) {
        throw new Error('Expense account not found');
      }
      
      const glData = {
        clinic_id: expenseData.clinic_id,
        transaction_date: expenseData.expense_date || new Date(),
        transaction_type: 'expense',
        description: `Expense - ${expenseData.description}`,
        reference_id: expenseData.id,
        reference_module: 'expense_management'
      };
      
      let lineItems = [];
      
      if (expenseData.payment_method === 'cash' || expenseData.is_paid) {
        // Paid expense: Debit Expense, Credit Cash
        if (!cashAccount) {
          throw new Error('Cash account not found for paid expense');
        }
        
        lineItems = [
          {
            account_id: expenseAccount.id,
            debit_amount: expenseData.amount,
            credit_amount: 0,
            description: expenseData.description
          },
          {
            account_id: cashAccount.id,
            debit_amount: 0,
            credit_amount: expenseData.amount,
            description: `Cash payment for ${expenseData.description}`
          }
        ];
      } else {
        // Unpaid expense: Debit Expense, Credit Accounts Payable
        if (!payableAccount) {
          throw new Error('Accounts Payable account not found for unpaid expense');
        }
        
        lineItems = [
          {
            account_id: expenseAccount.id,
            debit_amount: expenseData.amount,
            credit_amount: 0,
            description: expenseData.description
          },
          {
            account_id: payableAccount.id,
            debit_amount: 0,
            credit_amount: expenseData.amount,
            description: `Payable for ${expenseData.description}`
          }
        ];
      }
      
      const glEntry = await AccountingService.createGLEntry(glData, lineItems, userId);
      await AccountingService.postGLEntry(glEntry.id, userId);
      
      return glEntry;
    } catch (error) {
      console.error('Error creating accounting entries for expense:', error);
      return null;
    }
  }
  
  /**
   * Sync existing bills to accounting (for migration)
   * @param {number} clinicId - Clinic ID to sync
   * @param {string} userId - User performing the sync
   */
  async syncExistingBills(clinicId, userId) {
    try {
      console.log(`Starting sync of existing bills for clinic ${clinicId}`);
      
      // Get all bills that don't have accounting entries
      const bills = await PatientBill.findAll({
        where: {
          clinic_id: clinicId,
          // Add condition to check if GL entry doesn't exist
        }
      });
      
      let syncedCount = 0;
      let errorCount = 0;
      
      for (const bill of bills) {
        try {
          await this.handleBillCreation(bill.toJSON(), userId);
          syncedCount++;
        } catch (error) {
          console.error(`Error syncing bill ${bill.bill_number}:`, error);
          errorCount++;
        }
      }
      
      console.log(`Sync completed. Synced: ${syncedCount}, Errors: ${errorCount}`);
      
      return { synced: syncedCount, errors: errorCount };
    } catch (error) {
      console.error('Error syncing existing bills:', error);
      throw error;
    }
  }
}

module.exports = new BillingIntegrationService();
// Exposed so patientBills.js can wrap its own atomic bill-creation transaction
// (bill + GL together) in the same transient-retry logic, at the outer level
// where a fresh transaction can actually be started from scratch.
module.exports.withTransientRetry = withTransientRetry;
module.exports.isTransient = isTransient;
