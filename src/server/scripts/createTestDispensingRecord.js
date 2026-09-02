const { PharmacyDispensing } = require('../models');
const { v4: uuidv4 } = require('uuid');

async function createTestDispensingRecord() {
  try {
    console.log('Creating test dispensing record for demonstration...');

    const testRecord = {
      id: uuidv4(),
      drug_id: uuidv4(),
      drug_name: 'Ibuprofen 400mg',
      patient_id: '1-06866771',
      patient_name: 'Sarah Khalil',
      visit_id: null,
      quantity: 10,
      unit_of_measure: 'Tablets',
      prescribed_by: 'Dr. Smith',
      dispensed_by: 'Test Pharmacist',
      clinic_id: 1,
      dispensed_at: new Date(),
      notes: 'Test dispensing record for demonstration'
    };

    const createdRecord = await PharmacyDispensing.create(testRecord);
    console.log('✅ Test dispensing record created successfully');
    console.log('Record ID:', createdRecord.id);
    console.log('Drug:', createdRecord.drug_name);
    console.log('Patient:', createdRecord.patient_name);
    console.log('Quantity:', createdRecord.quantity);
    console.log('Dispensed at:', createdRecord.dispensed_at);

    // Verify it was saved
    const allRecords = await PharmacyDispensing.findAll({
      where: { clinic_id: 1 },
      order: [['dispensed_at', 'DESC']]
    });

    console.log(`\n✅ Total dispensing records in database: ${allRecords.length}`);
    
    return createdRecord;

  } catch (error) {
    console.error('❌ Error creating test dispensing record:', error);
    throw error;
  }
}

// Run the script
if (require.main === module) {
  createTestDispensingRecord()
    .then(() => {
      console.log('\n✅ Test record creation completed');
      console.log('Now refresh your Pharmacy page and check the Dispensing Report tab!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = createTestDispensingRecord;
