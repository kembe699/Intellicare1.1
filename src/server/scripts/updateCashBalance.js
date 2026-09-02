const { LedgerAccount } = require('../models');

async function updateCashBalance() {
  try {
    console.log('Updating Cash at Hand account balance...');

    // Find the Cash at Hand account (ID 17 from the logs)
    const cashAtHandAccount = await LedgerAccount.findByPk(17);
    
    if (!cashAtHandAccount) {
      console.log('Cash at Hand account not found');
      return;
    }

    console.log('Current balance:', cashAtHandAccount.balance);
    
    // Update balance to a positive amount (100,000)
    await cashAtHandAccount.update({
      balance: 100000.00
    });

    console.log('Updated balance to: 100000.00');
    
    // Also update the main Cash account if needed
    const mainCashAccount = await LedgerAccount.findOne({ where: { account_code: '01' } });
    if (mainCashAccount) {
      console.log('Updating main Cash account balance...');
      await mainCashAccount.update({
        balance: 100000.00
      });
      console.log('Main Cash account updated to: 100000.00');
    }

    console.log('✅ Cash balances updated successfully');
  } catch (error) {
    console.error('Error updating cash balance:', error);
    throw error;
  }
}

module.exports = { updateCashBalance };

// Run if called directly
if (require.main === module) {
  const { sequelize } = require('../models');
  
  sequelize.authenticate()
    .then(() => {
      console.log('Database connected successfully');
      return updateCashBalance();
    })
    .then(() => {
      console.log('Balance update complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('Update failed:', error);
      process.exit(1);
    });
}
