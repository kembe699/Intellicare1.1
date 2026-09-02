const { ChartOfAccounts, sequelize } = require('../models');

const healthcareChartOfAccounts = [
  // ASSETS (1000-1999)
  {
    account_code: '1100',
    account_name: 'Cash',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    is_bank_account: true,
    description: 'Cash on hand and petty cash'
  },
  {
    account_code: '1105',
    account_name: 'Cash at Hand',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    is_bank_account: false,
    description: 'Cash held by cashiers at the counter'
  },
  {
    account_code: '1108',
    account_name: 'Petty Cash',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    is_bank_account: false,
    description: 'Petty cash fund for small expenses'
  },
  {
    account_code: '1110',
    account_name: 'Bank Account - Main',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    is_bank_account: true,
    description: 'Main operating bank account'
  },
  {
    account_code: '1120',
    account_name: 'Bank Account - Savings',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    is_bank_account: true,
    description: 'Savings account'
  },
  {
    account_code: '1200',
    account_name: 'Accounts Receivable - Patients',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    is_customer_account: true,
    description: 'Outstanding patient bills'
  },
  {
    account_code: '1210',
    account_name: 'Insurance Receivables',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    description: 'Outstanding insurance claims'
  },
  {
    account_code: '1300',
    account_name: 'Medical Supplies Inventory',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    description: 'Medical supplies and consumables'
  },
  {
    account_code: '1310',
    account_name: 'Pharmaceutical Inventory',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    description: 'Pharmaceutical drugs and medicines'
  },
  {
    account_code: '1320',
    account_name: 'Office Supplies Inventory',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    description: 'Office supplies and stationery'
  },
  {
    account_code: '1400',
    account_name: 'Prepaid Expenses',
    account_type: 'asset',
    sub_account_type: 'current_asset',
    balance_type: 'debit',
    description: 'Prepaid insurance, rent, etc.'
  },
  {
    account_code: '1500',
    account_name: 'Medical Equipment',
    account_type: 'asset',
    sub_account_type: 'fixed_asset',
    balance_type: 'debit',
    description: 'Medical equipment and instruments'
  },
  {
    account_code: '1510',
    account_name: 'Laboratory Equipment',
    account_type: 'asset',
    sub_account_type: 'fixed_asset',
    balance_type: 'debit',
    description: 'Laboratory equipment and analyzers'
  },
  {
    account_code: '1520',
    account_name: 'Office Equipment',
    account_type: 'asset',
    sub_account_type: 'fixed_asset',
    balance_type: 'debit',
    description: 'Computers, furniture, office equipment'
  },
  {
    account_code: '1530',
    account_name: 'Building and Improvements',
    account_type: 'asset',
    sub_account_type: 'fixed_asset',
    balance_type: 'debit',
    description: 'Building, renovations, improvements'
  },
  {
    account_code: '1590',
    account_name: 'Accumulated Depreciation - Equipment',
    account_type: 'asset',
    sub_account_type: 'fixed_asset',
    balance_type: 'credit',
    description: 'Accumulated depreciation on equipment'
  },

  // LIABILITIES (2000-2999)
  {
    account_code: '2100',
    account_name: 'Accounts Payable - Suppliers',
    account_type: 'liability',
    sub_account_type: 'current_liability',
    balance_type: 'credit',
    is_supplier_account: true,
    description: 'Outstanding supplier invoices'
  },
  {
    account_code: '2110',
    account_name: 'Accrued Expenses',
    account_type: 'liability',
    sub_account_type: 'current_liability',
    balance_type: 'credit',
    description: 'Accrued but unpaid expenses'
  },
  {
    account_code: '2150',
    account_name: 'Patient Deposits Held',
    account_type: 'liability',
    sub_account_type: 'current_liability',
    balance_type: 'credit',
    description: 'Unearned patient deposits held until applied to a bill or refunded'
  },
  {
    account_code: '2200',
    account_name: 'Payroll Liabilities',
    account_type: 'liability',
    sub_account_type: 'current_liability',
    balance_type: 'credit',
    description: 'Unpaid salaries and wages'
  },
  {
    account_code: '2210',
    account_name: 'PAYE Tax Payable',
    account_type: 'liability',
    sub_account_type: 'current_liability',
    balance_type: 'credit',
    description: 'PAYE tax withheld from employees'
  },
  {
    account_code: '2220',
    account_name: 'NHIF Contributions Payable',
    account_type: 'liability',
    sub_account_type: 'current_liability',
    balance_type: 'credit',
    description: 'NHIF contributions payable'
  },
  {
    account_code: '2230',
    account_name: 'NSSF Contributions Payable',
    account_type: 'liability',
    sub_account_type: 'current_liability',
    balance_type: 'credit',
    description: 'NSSF contributions payable'
  },
  {
    account_code: '2300',
    account_name: 'VAT Payable',
    account_type: 'liability',
    sub_account_type: 'current_liability',
    balance_type: 'credit',
    description: 'VAT collected and payable to KRA'
  },
  {
    account_code: '2400',
    account_name: 'Short-term Loans',
    account_type: 'liability',
    sub_account_type: 'current_liability',
    balance_type: 'credit',
    description: 'Short-term loans and credit facilities'
  },
  {
    account_code: '2500',
    account_name: 'Long-term Loans',
    account_type: 'liability',
    sub_account_type: 'long_term_liability',
    balance_type: 'credit',
    description: 'Long-term loans and mortgages'
  },

  // EQUITY (3000-3999)
  {
    account_code: '3100',
    account_name: 'Owner\'s Capital',
    account_type: 'equity',
    sub_account_type: 'capital',
    balance_type: 'credit',
    description: 'Owner\'s initial and additional capital'
  },
  {
    account_code: '3200',
    account_name: 'Retained Earnings',
    account_type: 'equity',
    sub_account_type: 'retained_earnings',
    balance_type: 'credit',
    description: 'Accumulated profits/losses'
  },
  {
    account_code: '3300',
    account_name: 'Owner\'s Drawings',
    account_type: 'equity',
    sub_account_type: 'drawings',
    balance_type: 'debit',
    description: 'Owner\'s withdrawals'
  },

  // REVENUE (4000-4999)
  {
    account_code: '4100',
    account_name: 'Patient Services Revenue',
    account_type: 'revenue',
    sub_account_type: 'operating_revenue',
    balance_type: 'credit',
    description: 'Revenue from patient consultations and services'
  },
  {
    account_code: '4110',
    account_name: 'Laboratory Services Revenue',
    account_type: 'revenue',
    sub_account_type: 'operating_revenue',
    balance_type: 'credit',
    description: 'Revenue from laboratory tests'
  },
  {
    account_code: '4120',
    account_name: 'Pharmacy Sales Revenue',
    account_type: 'revenue',
    sub_account_type: 'operating_revenue',
    balance_type: 'credit',
    description: 'Revenue from pharmaceutical sales'
  },
  {
    account_code: '4130',
    account_name: 'Radiology Services Revenue',
    account_type: 'revenue',
    sub_account_type: 'operating_revenue',
    balance_type: 'credit',
    description: 'Revenue from radiology services'
  },
  {
    account_code: '4140',
    account_name: 'Procedure Revenue',
    account_type: 'revenue',
    sub_account_type: 'operating_revenue',
    balance_type: 'credit',
    description: 'Revenue from medical procedures'
  },
  {
    account_code: '4200',
    account_name: 'Insurance Revenue',
    account_type: 'revenue',
    sub_account_type: 'operating_revenue',
    balance_type: 'credit',
    description: 'Revenue from insurance claims'
  },
  {
    account_code: '4900',
    account_name: 'Other Income',
    account_type: 'revenue',
    sub_account_type: 'other_revenue',
    balance_type: 'credit',
    description: 'Miscellaneous income'
  },

  // EXPENSES (5000-5999)
  {
    account_code: '5100',
    account_name: 'Salaries and Wages',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Staff salaries and wages'
  },
  {
    account_code: '5110',
    account_name: 'Doctor Fees',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Payments to consulting doctors'
  },
  {
    account_code: '5120',
    account_name: 'Employee Benefits',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'NHIF, NSSF, and other employee benefits'
  },
  {
    account_code: '5200',
    account_name: 'Medical Supplies Expense',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Cost of medical supplies used'
  },
  {
    account_code: '5210',
    account_name: 'Pharmaceutical Cost of Sales',
    account_type: 'expense',
    sub_account_type: 'cost_of_sales',
    balance_type: 'debit',
    description: 'Cost of pharmaceuticals sold'
  },
  {
    account_code: '5220',
    account_name: 'Laboratory Supplies Expense',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Cost of laboratory supplies and reagents'
  },
  {
    account_code: '5300',
    account_name: 'Rent Expense',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Rent for clinic premises'
  },
  {
    account_code: '5310',
    account_name: 'Utilities Expense',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Electricity, water, telephone'
  },
  {
    account_code: '5320',
    account_name: 'Insurance Expense',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Professional and general insurance'
  },
  {
    account_code: '5330',
    account_name: 'Maintenance and Repairs',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Equipment and facility maintenance'
  },
  {
    account_code: '5400',
    account_name: 'Office Supplies Expense',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Office supplies and stationery'
  },
  {
    account_code: '5410',
    account_name: 'Marketing and Advertising',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Marketing and promotional expenses'
  },
  {
    account_code: '5420',
    account_name: 'Professional Fees',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Legal, accounting, consulting fees'
  },
  {
    account_code: '5430',
    account_name: 'Training and Development',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Staff training and professional development'
  },
  {
    account_code: '5500',
    account_name: 'Depreciation Expense',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Depreciation on equipment and assets'
  },
  {
    account_code: '5600',
    account_name: 'Interest Expense',
    account_type: 'expense',
    sub_account_type: 'financial_expense',
    balance_type: 'debit',
    description: 'Interest on loans and credit facilities'
  },
  {
    account_code: '5700',
    account_name: 'Bad Debt Expense',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Write-offs of uncollectible receivables'
  },
  {
    account_code: '5800',
    account_name: 'Travel and Transport',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Travel and transportation expenses'
  },
  {
    account_code: '5900',
    account_name: 'Miscellaneous Expenses',
    account_type: 'expense',
    sub_account_type: 'operating_expense',
    balance_type: 'debit',
    description: 'Other miscellaneous expenses'
  }
];

/**
 * Initialize Chart of Accounts for a clinic
 * @param {number} clinicId - Clinic ID
 * @param {string} createdBy - User ID creating the accounts
 */
async function initializeChartOfAccounts(clinicId, createdBy = null) {
  const transaction = await sequelize.transaction();

  try {
    console.log(`Initializing Chart of Accounts for clinic ${clinicId}...`);

    // Per-code idempotency, not all-or-nothing — safely re-runnable any time
    // (e.g. clicking the "Initialize Defaults" button again later), so it
    // only fills in whichever standard accounts aren't already there instead
    // of refusing outright the moment a clinic has even one custom account.
    const existing = await ChartOfAccounts.findAll({
      where: { clinic_id: clinicId },
      attributes: ['account_code'],
      transaction,
    });
    const existingCodes = new Set(existing.map((a) => a.account_code));

    const missing = healthcareChartOfAccounts.filter((a) => !existingCodes.has(a.account_code));
    if (missing.length === 0) {
      await transaction.rollback();
      return { success: false, message: 'All standard accounts are already in the chart of accounts' };
    }

    const accountsToCreate = missing.map(account => ({
      ...account,
      clinic_id: clinicId,
      created_by: createdBy,
      opening_balance: 0,
      opening_balance_date: new Date()
    }));

    const createdAccounts = await ChartOfAccounts.bulkCreate(accountsToCreate, { transaction });

    await transaction.commit();

    console.log(`Successfully created ${createdAccounts.length} accounts for clinic ${clinicId}`);

    return {
      success: true,
      message: `Added ${createdAccounts.length} account${createdAccounts.length === 1 ? '' : 's'}${existingCodes.size > 0 ? ` (${existingCodes.size} already existed)` : ''}`,
      accounts: createdAccounts.length
    };

  } catch (error) {
    await transaction.rollback();
    console.error('Error initializing Chart of Accounts:', error);
    throw error;
  }
}

/**
 * Initialize Chart of Accounts for all clinics
 */
async function initializeAllClinics() {
  try {
    let clinics = [];
    
    // Check if clinic_id column exists in users table before querying
    try {
      const [columnCheck] = await sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'clinic_id'
      `);
      
      if (columnCheck && columnCheck.length > 0) {
        // Column exists, query clinic IDs
        const [clinicResults] = await sequelize.query(`
          SELECT DISTINCT clinic_id FROM users WHERE clinic_id IS NOT NULL
        `);
        clinics = clinicResults;
      }
    } catch (checkError) {
      console.log('Note: Could not check clinic_id column:', checkError.message);
    }
    
    // If no clinics found, use default clinic_id = 1
    if (clinics.length === 0) {
      console.log('No clinics found in users table, using default clinic_id = 1');
      clinics = [{ clinic_id: 1 }];
    } else {
      console.log(`Found ${clinics.length} clinics to initialize`);
    }
    
    const results = [];
    for (const clinic of clinics) {
      try {
        const result = await initializeChartOfAccounts(clinic.clinic_id);
        results.push({ clinic_id: clinic.clinic_id, ...result });
      } catch (error) {
        console.error(`Error initializing clinic ${clinic.clinic_id}:`, error.message);
        results.push({ 
          clinic_id: clinic.clinic_id, 
          success: false, 
          message: error.message 
        });
      }
    }
    
    return results;
    
  } catch (error) {
    console.error('Error initializing all clinics:', error);
    throw error;
  }
}

module.exports = {
  initializeChartOfAccounts,
  initializeAllClinics,
  healthcareChartOfAccounts
};
