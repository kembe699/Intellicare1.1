const { PharmacyDispensing } = require('../models');

async function checkDispensingRecords() {
  try {
    console.log('Checking existing dispensing records...');

    // Get all dispensing records
    const records = await PharmacyDispensing.findAll({
      order: [['dispensed_at', 'DESC']],
      limit: 10
    });

    console.log(`Found ${records.length} dispensing records in the database`);

    if (records.length > 0) {
      console.log('\nLatest dispensing records:');
      records.forEach((record, index) => {
        console.log(`${index + 1}. ${record.drug_name} - ${record.quantity} ${record.unit_of_measure || 'units'}`);
        console.log(`   Patient: ${record.patient_name}`);
        console.log(`   Dispensed by: ${record.dispensed_by}`);
        console.log(`   Date: ${record.dispensed_at}`);
        console.log('   ---');
      });
    } else {
      console.log('\nNo dispensing records found. This means:');
      console.log('1. No medications have been dispensed yet, OR');
      console.log('2. There might be an issue with the dispensing workflow');
      console.log('\nTo test dispensing:');
      console.log('1. Go to Pharmacy page');
      console.log('2. Click "Dispense Medication" button');
      console.log('3. Select a patient and medications');
      console.log('4. Click "Dispense All"');
      console.log('5. Check browser console for any errors');
    }

  } catch (error) {
    console.error('Error checking dispensing records:', error);
    
    if (error.name === 'SequelizeDatabaseError') {
      console.log('\nDatabase error detected. This might mean:');
      console.log('1. The PharmacyDispensing model is not properly loaded');
      console.log('2. The pharmacy_dispensing table structure doesn\'t match the model');
      console.log('3. Database connection issues');
    }
  }
}

// Run the check
if (require.main === module) {
  checkDispensingRecords()
    .then(() => {
      console.log('\n✅ Check completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Check failed:', error);
      process.exit(1);
    });
}

module.exports = checkDispensingRecords;
