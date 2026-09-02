const { sequelize } = require('./models');

async function linkLabTestsToServices() {
  try {
    console.log('🔄 Starting lab tests to services linking...\n');

    // Define mappings between test codes and service names
    const testServiceMappings = [
      { test_code: 'CBC', service_pattern: 'CBC (Complete Blood Count)' },
      { test_code: 'TWBC', service_pattern: 'TWBC (Total White Blood Cell Count)' },
      { test_code: 'HB', service_pattern: 'HB (Haemoglobin)' },
      { test_code: 'ESR', service_pattern: 'ESR (Erythrocyte Sedimentation Rate)' },
      { test_code: 'BFFM', service_pattern: 'BFFM' },
      { test_code: 'BLOODGRP', service_pattern: 'Blood Group' },
      { test_code: 'RFT', service_pattern: 'RFT (Renal Function Test)' },
      { test_code: 'RBG', service_pattern: 'RBG (Random Blood Glucose)' },
      { test_code: 'URICACID', service_pattern: 'Uric Acid' },
      { test_code: 'VDRL', service_pattern: 'VDRL' },
      { test_code: 'HBsAG', service_pattern: 'HBs Ag (Hepatitis B Surface Antigen)' },
      { test_code: 'HCV', service_pattern: 'HCV (Hepatitis C Virus)' },
      { test_code: 'HCG', service_pattern: 'HCG' },
      { test_code: 'P24', service_pattern: 'P24' },
      { test_code: 'WIDAL', service_pattern: 'Widal Test' },
      { test_code: 'BRUCELLA', service_pattern: 'Widal Test for Brucellosis' },
      { test_code: 'TB', service_pattern: 'TB Test' },
      { test_code: 'URINE', service_pattern: 'Urine Analysis' },
      { test_code: 'STOOL', service_pattern: 'Stool Analysis' }
    ];

    let linkedCount = 0;
    let notFoundCount = 0;

    for (const mapping of testServiceMappings) {
      try {
        // Find the service by name pattern
        const [service] = await sequelize.query(`
          SELECT id, service_name 
          FROM services 
          WHERE service_name ILIKE :pattern
          LIMIT 1
        `, {
          replacements: { pattern: `%${mapping.service_pattern}%` },
          type: sequelize.QueryTypes.SELECT
        });

        if (service) {
          // Update the lab test with the service_id
          const [result] = await sequelize.query(`
            UPDATE lab_tests 
            SET service_id = :serviceId, updated_at = NOW()
            WHERE test_code = :testCode
            RETURNING test_name
          `, {
            replacements: { 
              serviceId: service.id,
              testCode: mapping.test_code 
            },
            type: sequelize.QueryTypes.UPDATE
          });

          if (result && result.length > 0) {
            console.log(`✅ Linked ${mapping.test_code} → ${service.service_name}`);
            linkedCount++;
          }
        } else {
          console.log(`⚠️  Service not found for: ${mapping.test_code} (pattern: ${mapping.service_pattern})`);
          notFoundCount++;
        }
      } catch (error) {
        console.error(`❌ Error linking ${mapping.test_code}:`, error.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Linking Complete!');
    console.log('='.repeat(60));
    console.log(`✅ Tests Linked: ${linkedCount}`);
    console.log(`⚠️  Services Not Found: ${notFoundCount}`);
    console.log('='.repeat(60));

    // Show results
    console.log('\nVerification:');
    const results = await sequelize.query(`
      SELECT 
        lt.test_code,
        lt.test_name,
        s.service_name
      FROM lab_tests lt
      LEFT JOIN services s ON lt.service_id = s.id
      ORDER BY lt.test_code
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    results.forEach(row => {
      const status = row.service_name ? '✅' : '❌';
      console.log(`${status} ${row.test_code.padEnd(12)} → ${row.service_name || 'NOT LINKED'}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Linking failed:', error);
    process.exit(1);
  }
}

// Run the linking
linkLabTestsToServices();
