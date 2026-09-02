const { sequelize } = require('./models');
const fs = require('fs');
const path = require('path');

// Read CSV file from command line argument or use default
const csvFilePath = process.argv[2] || path.join(__dirname, 'lab-tests.csv');

async function uploadLabTests() {
  try {
    console.log('🔄 Starting lab tests and components upload...\n');
    console.log(`📁 Reading CSV file: ${csvFilePath}\n`);

    // Read CSV file
    if (!fs.existsSync(csvFilePath)) {
      console.error(`❌ CSV file not found: ${csvFilePath}`);
      console.log('\nUsage: node upload-lab-tests-csv.js [path/to/file.csv]');
      process.exit(1);
    }

    const csvData = fs.readFileSync(csvFilePath, 'utf-8');
    
    // Parse CSV
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    console.log('📋 CSV Headers:', headers);
    console.log('');
    
    const testsMap = new Map();
    const componentsMap = new Map();

    // Group by test_code
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ? values[index].trim() : '';
      });

      const testCode = row.test_code;
      
      if (!testCode) {
        console.log(`⚠️  Skipping row ${i + 1}: No test_code`);
        continue;
      }
      
      // Store test info
      if (!testsMap.has(testCode)) {
        testsMap.set(testCode, {
          test_code: testCode,
          test_name: row.test_name,
          category: row.category,
          price: parseFloat(row.price) || 0
        });
        componentsMap.set(testCode, []);
      }

      // Store component info
      if (row.component_name) {
        componentsMap.get(testCode).push({
          component_name: row.component_name,
          unit: row.unit || null,
          reference_range: row.reference_range || null,
          display_order: parseInt(row.display_order) || 0
        });
      }
    }

    console.log(`📊 Found ${testsMap.size} unique lab tests`);
    console.log(`🧪 Found ${Array.from(componentsMap.values()).flat().length} total components\n`);

    // Insert lab tests and components
    let testsCreated = 0;
    let testsUpdated = 0;
    let componentsCreated = 0;

    for (const [testCode, testData] of testsMap) {
      try {
        // Check if test already exists
        const [existingTest] = await sequelize.query(
          `SELECT id FROM lab_tests WHERE test_code = :testCode LIMIT 1`,
          { replacements: { testCode }, type: sequelize.QueryTypes.SELECT }
        );

        let testId;

        if (existingTest) {
          testId = existingTest.id;
          testsUpdated++;
          console.log(`♻️  Test exists: ${testData.test_name} (${testCode})`);
          
          // Delete existing components for this test
          await sequelize.query(
            `DELETE FROM lab_test_components WHERE lab_test_id = :testId`,
            { replacements: { testId } }
          );
        } else {
          // Insert lab test
          const [result] = await sequelize.query(
            `INSERT INTO lab_tests (id, test_name, test_code, category, price, clinic_id, is_active, created_at, updated_at)
             VALUES (uuid_generate_v4(), :test_name, :test_code, :category, :price, 1, true, NOW(), NOW())
             RETURNING id`,
            {
              replacements: {
                test_name: testData.test_name,
                test_code: testData.test_code,
                category: testData.category,
                price: testData.price
              },
              type: sequelize.QueryTypes.INSERT
            }
          );
          testId = result[0].id;
          testsCreated++;
          console.log(`✅ Created test: ${testData.test_name} (${testCode})`);
        }

        // Insert components for this test
        const components = componentsMap.get(testCode);
        for (const component of components) {
          try {
            await sequelize.query(
              `INSERT INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, display_order, clinic_id, created_at, updated_at)
               VALUES (uuid_generate_v4(), :lab_test_id, :component_name, :unit, :reference_range, :display_order, 1, NOW(), NOW())`,
              {
                replacements: {
                  lab_test_id: testId,
                  component_name: component.component_name,
                  unit: component.unit,
                  reference_range: component.reference_range,
                  display_order: component.display_order
                }
              }
            );
            componentsCreated++;
          } catch (compError) {
            console.error(`  ⚠️  Error adding component "${component.component_name}":`, compError.message);
          }
        }
        console.log(`  → Added ${components.length} components\n`);

      } catch (testError) {
        console.error(`❌ Error processing test ${testCode}:`, testError.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Upload Complete!');
    console.log('='.repeat(60));
    console.log(`📊 Lab Tests Created: ${testsCreated}`);
    console.log(`♻️  Lab Tests Updated: ${testsUpdated}`);
    console.log(`🧪 Components Created: ${componentsCreated}`);
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('❌ Upload failed:', error);
    process.exit(1);
  }
}

// Run the upload
uploadLabTests();
