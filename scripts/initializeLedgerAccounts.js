const { LedgerAccount } = require('../models');

async function initializeLedgerAccounts() {
  try {
    console.log('Initializing ledger accounts...');

    // Create main Cash account (code 01)
    let cashAccount = await LedgerAccount.findOne({ where: { account_code: '01' } });
    if (!cashAccount) {
      cashAccount = await LedgerAccount.create({
        account_name: 'Cash',
        account_code: '01',
        account_type: 'asset',
        description: 'Main cash account',
        balance: 0.00
      });
      console.log('Created main Cash account:', cashAccount.account_name);
    } else {
      console.log('Main Cash account already exists:', cashAccount.account_name);
    }

    // Create Cash at Hand sub-account (code 3)
    let cashAtHandAccount = await LedgerAccount.findOne({
      where: { 
        account_code: '3',
        parent_account_id: cashAccount.id
      }
    });
    
    if (!cashAtHandAccount) {
      cashAtHandAccount = await LedgerAccount.create({
        account_name: 'Cash at Hand',
        account_code: '3',
        account_type: 'asset',
        parent_account_id: cashAccount.id,
        description: 'Cash at hand sub-account',
        balance: 0.00
      });
      console.log('Created Cash at Hand sub-account:', cashAtHandAccount.account_name);
    } else {
      console.log('Cash at Hand sub-account already exists:', cashAtHandAccount.account_name);
    }

    // Create Bank account for transfers
    let bankAccount = await LedgerAccount.findOne({ where: { account_code: '02' } });
    if (!bankAccount) {
      bankAccount = await LedgerAccount.create({
        account_name: 'Bank Account',
        account_code: '02',
        account_type: 'asset',
        description: 'Main bank account for transfers',
        balance: 0.00
      });
      console.log('Created Bank account:', bankAccount.account_name);
    } else {
      console.log('Bank account already exists:', bankAccount.account_name);
    }

    console.log('✅ Ledger accounts initialized successfully');
    return { cashAccount, cashAtHandAccount, bankAccount };
  } catch (error) {
    console.error('Error initializing ledger accounts:', error);
    throw error;
  }
}

module.exports = { initializeLedgerAccounts };

// Run if called directly
if (require.main === module) {
  const { sequelize } = require('../models');
  
  sequelize.authenticate()
    .then(() => {
      console.log('Database connected successfully');
      return initializeLedgerAccounts();
    })
    .then(() => {
      console.log('Initialization complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('Initialization failed:', error);
      process.exit(1);
    });
}
