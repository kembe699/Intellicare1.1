const { PharmacyDispensing } = require('../models');
const { v4: uuidv4 } = require('uuid');

async function testDispensingTable() {
  try {
    console.log('Testing pharmacy_dispensing table...');

    // Test creating a dispensing record
    const testRecord = {
      id: uuidv4(),
      drug_id: uuidv4(),
      drug_name: 'Test Medication',
      patient_id: 'TEST001',
      patient_name: 'Test Patient',
      visit_id: null,
      quantity: 10,
      unit_of_measure: 'Tablets',
      prescribed_by: 'Dr. Test',
      dispensed_by: 'Test Pharmacist',
      clinic_id: 1,
      dispensed_at: new Date(),
      notes: 'Test dispensing record'
    };

    console.log('Creating test dispensing record...');
    const createdRecord = await PharmacyDispensing.create(testRecord);
    console.log('✅ Test record created successfully:', createdRecord.id);

    // Test fetching records
    console.log('Fetching dispensing records for clinic 1...');
    const records = await PharmacyDispensing.findAll({
      where: { clinic_id: 1 },
      order: [['dispensed_at', 'DESC']],
      limit: 5
    });

    console.log(`✅ Found ${records.length} dispensing records`);
    if (records.length > 0) {
      console.log('Latest record:', {
        id: records[0].id,
        drug_name: records[0].drug_name,
        patient_name: records[0].patient_name,
        quantity: records[0].quantity,
        dispensed_at: records[0].dispensed_at
      });
    }

    // Clean up test record
    await PharmacyDispensing.destroy({
      where: { id: createdRecord.id }
    });
    console.log('✅ Test record cleaned up');

    console.log('✅ Dispensing table test completed successfully');

  } catch (error) {
    console.error('❌ Error testing dispensing table:', error);
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testDispensingTable()
    .then(() => {
      console.log('✅ Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = testDispensingTable;
