const { sequelize } = require('./models');
const fs = require('fs');
const path = require('path');

// Parse CSV data
const csvData = `test_code,test_name,category,price,component_name,unit,reference_range,display_order
CBC,Complete Blood Count,Hematology,0,Hemoglobin,g/dL,Male: 13.5-17.5 | Female: 12.0-16.0,1
CBC,Complete Blood Count,Hematology,0,Hematocrit,%,Male: 41-53 | Female: 36-45,2
CBC,Complete Blood Count,Hematology,0,RBC Count,10^12/L,Male: 4.5-5.9 | Female: 4.0-5.2,3
CBC,Complete Blood Count,Hematology,0,MCV,fL,80-100,4
CBC,Complete Blood Count,Hematology,0,MCH,pg,27-32,5
CBC,Complete Blood Count,Hematology,0,MCHC,g/dL,32-36,6
CBC,Complete Blood Count,Hematology,0,RDW,%,11.5-14.5,7
CBC,Complete Blood Count,Hematology,0,WBC Count,10^9/L,4.0-11.0,8
CBC,Complete Blood Count,Hematology,0,Neutrophils,%,40-70,9
CBC,Complete Blood Count,Hematology,0,Lymphocytes,%,20-40,10
CBC,Complete Blood Count,Hematology,0,Monocytes,%,2-8,11
CBC,Complete Blood Count,Hematology,0,Eosinophils,%,1-4,12
CBC,Complete Blood Count,Hematology,0,Basophils,%,0-1,13
CBC,Complete Blood Count,Hematology,0,Neutrophils Absolute,10^9/L,2.0-7.5,14
CBC,Complete Blood Count,Hematology,0,Lymphocytes Absolute,10^9/L,1.0-4.0,15
CBC,Complete Blood Count,Hematology,0,Monocytes Absolute,10^9/L,0.2-1.0,16
CBC,Complete Blood Count,Hematology,0,Eosinophils Absolute,10^9/L,0.0-0.5,17
CBC,Complete Blood Count,Hematology,0,Basophils Absolute,10^9/L,0.0-0.1,18
CBC,Complete Blood Count,Hematology,0,Platelet Count,10^9/L,150-400,19
CBC,Complete Blood Count,Hematology,0,MPV,fL,7.5-11.5,20
TWBC,Total White Blood Cell Count,Hematology,0,WBC Count,cu/mm,4000-11000,1
TWBC,Total White Blood Cell Count,Hematology,0,Neutrophils,%,40-70,2
TWBC,Total White Blood Cell Count,Hematology,0,Lymphocytes,%,20-40,3
TWBC,Total White Blood Cell Count,Hematology,0,Monocytes,%,2-8,4
TWBC,Total White Blood Cell Count,Hematology,0,Eosinophils,%,1-4,5
TWBC,Total White Blood Cell Count,Hematology,0,Basophils,%,0-1,6
HB,Haemoglobin,Hematology,0,Hemoglobin,g/dL,Male: 13.5-17.5 | Female: 12.0-16.0,1
HB,Haemoglobin,Hematology,0,Hematocrit,%,Male: 41-53 | Female: 36-45,2
ESR,Erythrocyte Sedimentation Rate,Hematology,0,ESR,mm/hr,Male: 0-15 | Female: 0-20,1
BFFM,Blood Film for Malaria Parasites,Hematology,0,Malaria Parasites,,Negative,1
BFFM,Blood Film for Malaria Parasites,Hematology,0,Species Identified,,None,2
BFFM,Blood Film for Malaria Parasites,Hematology,0,Parasitemia,parasites/UL,Negative,3
BLOODGRP,Blood Group & Rh Factor,Hematology,0,Blood Group,,A / B / AB / O,1
BLOODGRP,Blood Group & Rh Factor,Hematology,0,Rh Factor,,Positive / Negative,2
RFT,Renal Function Test,Chemistry,0,Urea,mg/dL,15-45,1
RFT,Renal Function Test,Chemistry,0,Creatinine,mg/dL,Male: 0.7-1.2 | Female: 0.5-1.1,2
RFT,Renal Function Test,Chemistry,0,Sodium,mmol/L,135-145,3
RFT,Renal Function Test,Chemistry,0,Potassium,mmol/L,3.5-5.0,4
RFT,Renal Function Test,Chemistry,0,Chloride,mmol/L,98-107,5
RFT,Renal Function Test,Chemistry,0,Bicarbonate,mmol/L,22-29,6
RBG,Random Blood Glucose,Chemistry,0,Blood Glucose (Random),mg/dL,70-140,1
URICACID,Uric Acid,Chemistry,0,Uric Acid,mg/dL,Male: 3.5-7.2 | Female: 2.5-6.0,1
VDRL,VDRL (Syphilis Screening),Serology,0,VDRL,,Reactive / Non-Reactive,1
HBsAG,Hepatitis B Surface Antigen,Serology,0,HBs Ag,,Non-Reactive,1
HBsAG,Hepatitis B Surface Antigen,Serology,0,Anti-HCV,,Non-Reactive,1
HCV,Hepatitis C Virus Antibody,Serology,0,HCV Antigen,,Non-Reactive,1
HCG,HCG Pregnancy Test,Serology,0,Beta-HCG,,Negative (Non-Pregnant),1
P24,HIV P24 Antigen Test,Serology,0,HIV P24 Antigen,,Non-Reactive,1
P24,HIV P24 Antigen Test,Serology,0,HIV 1/2 Antibody,,Non-Reactive,2
WIDAL,Widal Test,Serology,0,S. Typhi O,titre,< 1:80,1
WIDAL,Widal Test,Serology,0,S. Typhi H,titre,< 1:80,2
WIDAL,Widal Test,Serology,0,S. Paratyphi AO,titre,< 1:80,3
WIDAL,Widal Test,Serology,0,S. Paratyphi BO,titre,< 1:80,4
BRUCELLA,Widal Test for Brucellosis,Serology,0,B. Abortus,titre,< 1:80,1
BRUCELLA,Widal Test for Brucellosis,Serology,0,B. Melitensis,titre,< 1:80,2
TB,TB Test (Mantoux),Microbiology,0,Induration,mm,< 5mm: Negative | 5-9mm: Borderline | ≥10mm: Positive,1
URINE,Urine Analysis,Urinalysis,0,Color,,Yellow,1
URINE,Urine Analysis,Urinalysis,0,Appearance,,Clear,2
URINE,Urine Analysis,Urinalysis,0,Protein,,Negative,3
URINE,Urine Analysis,Urinalysis,0,Sugar/Glucose,,Negative,4
URINE,Urine Analysis,Urinalysis,0,Acetone/Ketones,,Negative,5
URINE,Urine Analysis,Urinalysis,0,Leucocytes,,Negative,6
URINE,Urine Analysis,Urinalysis,0,Worms,,Not Seen,7
URINE,Urine Analysis,Urinalysis,0,Specific Gravity,,1.005-1.030,8
URINE,Urine Analysis,Urinalysis,0,pH,,4.5-8.0,9
URINE,Urine Analysis,Urinalysis,0,Blood,,Negative,10
URINE,Urine Analysis,Urinalysis,0,Pus Cells,cells/HPF,0-5,11
URINE,Urine Analysis,Urinalysis,0,RBCs,cells/HPF,0-2,12
URINE,Urine Analysis,Urinalysis,0,Epithelial Cells,cells/HPF,Occasional,13
URINE,Urine Analysis,Urinalysis,0,Bacteria,,Not Seen,14
URINE,Urine Analysis,Urinalysis,0,Casts,,Not Seen,15
URINE,Urine Analysis,Urinalysis,0,Ova,,Not Seen,16
URINE,Urine Analysis,Urinalysis,0,Cysts,,Not Seen,17
URINE,Urine Analysis,Urinalysis,0,Others,,Not Seen,18
STOOL,Stool Analysis,Microbiology,0,Color,,Brown,1
STOOL,Stool Analysis,Microbiology,0,Consistency,,Formed,2
STOOL,Stool Analysis,Microbiology,0,Undigested Food,,Negative,3
STOOL,Stool Analysis,Microbiology,0,Mucus,,Negative,4
STOOL,Stool Analysis,Microbiology,0,Blood,,Negative,5
STOOL,Stool Analysis,Microbiology,0,Pus Cells,cells/HPF,0-5,6
STOOL,Stool Analysis,Microbiology,0,RBCs,cells/HPF,Not Seen,7
STOOL,Stool Analysis,Microbiology,0,Parasites,,Not Seen,8
STOOL,Stool Analysis,Microbiology,0,Ova,,Not Seen,9
STOOL,Stool Analysis,Microbiology,0,Cysts,,Not Seen,10
STOOL,Stool Analysis,Microbiology,0,Others,,Not Seen,11`;

async function uploadLabTests() {
  try {
    console.log('🔄 Starting lab tests and components upload...\n');

    // Parse CSV
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',');
    
    const testsMap = new Map();
    const componentsMap = new Map();

    // Group by test_code
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });

      const testCode = row.test_code;
      
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
          unit: row.unit,
          reference_range: row.reference_range,
          display_order: parseInt(row.display_order) || 0
        });
      }
    }

    console.log(`📊 Found ${testsMap.size} unique lab tests`);
    console.log(`🧪 Found ${Array.from(componentsMap.values()).flat().length} total components\n`);

    // Insert lab tests and components
    let testsCreated = 0;
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
          console.log(`✓ Test exists: ${testData.test_name} (${testCode})`);
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
              `INSERT INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, display_order, created_at, updated_at)
               VALUES (uuid_generate_v4(), :lab_test_id, :component_name, :unit, :reference_range, :display_order, NOW(), NOW())
               ON CONFLICT (lab_test_id, component_name) DO UPDATE 
               SET unit = EXCLUDED.unit, 
                   reference_range = EXCLUDED.reference_range,
                   display_order = EXCLUDED.display_order,
                   updated_at = NOW()`,
              {
                replacements: {
                  lab_test_id: testId,
                  component_name: component.component_name,
                  unit: component.unit || null,
                  reference_range: component.reference_range || null,
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
