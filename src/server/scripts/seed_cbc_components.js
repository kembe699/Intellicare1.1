const { sequelize } = require('../models');
const crypto = require('crypto');

const CBC_TEST_ID = 'dca8c776-1211-42cc-8c8c-004422301a62';

const components = [
  // Image 2
  { name: 'WBC',     range: '4.0-10.0',     unit: '10^9/L' },
  { name: 'Lymph#',  range: '0.8-4.0',      unit: '10^9/L' },
  { name: 'Mid#',    range: '0.1-1.5',       unit: '10^9/L' },
  { name: 'NEU#',    range: '2.00-7.00',     unit: '10^9/L' },
  { name: 'Lymph%',  range: '20.0-40.0',     unit: '%'      },
  { name: 'Mid%',    range: '3.0-15.0',      unit: '%'      },
  { name: 'NEU%',    range: '50.0-70.0',     unit: '%'      },
  { name: 'RBC',     range: '3.50-5.50',     unit: '10^12/L'},
  { name: 'HGB',     range: '11.0-16.0',     unit: 'g/dl'   },
  { name: 'HCT',     range: '37.0-54.0',     unit: '%'      },
  // Image 3
  { name: 'MCV',     range: '80.0-100.0',    unit: 'fl'     },
  { name: 'MCH',     range: '27.0-34.0',     unit: 'pg'     },
  { name: 'MCHC',    range: '32.0-36.0',     unit: 'g/dl'   },
  { name: 'RDW-CV',  range: '11.0-16.0',     unit: '%'      },
  { name: 'RDW-SD',  range: '35.0-56.0',     unit: 'fl'     },
  { name: 'PLT',     range: '150-450',        unit: '10^9/L' },
  { name: 'MPV',     range: '6.5-12.0',      unit: 'fl'     },
  { name: 'PDW',     range: '15.0-17.0',     unit: 'fl'     },
  { name: 'PCT',     range: '0.108-0.282',   unit: '%'      },
  // Image 1
  { name: 'P-LCR',   range: '11.0-45.0',    unit: '%'      },
  { name: 'EOS%',    range: '0.5-5.0',       unit: '%'      },
  { name: 'BAS%',    range: '0.00-0.10',     unit: '%'      },
  { name: 'Gran#',   range: '2.0-7.0',       unit: '10^9/L' },
  { name: 'BAS#',    range: '0.00-0.10',     unit: '10^9/L' },
  { name: 'EOS#',    range: '0.02-0.50',     unit: '10^9/L' },
  { name: 'P-LCC',   range: '30-90',         unit: '10^9/L' },
  { name: 'Gran%',   range: '50.0-70.0',     unit: '%'      },
];

async function run() {
  try {
    // Clear existing components for CBC
    await sequelize.query(
      'DELETE FROM lab_test_components WHERE lab_test_id = ?',
      { replacements: [CBC_TEST_ID] }
    );
    console.log('Cleared existing CBC components.');

    for (let i = 0; i < components.length; i++) {
      const { name, range, unit } = components[i];
      const id = crypto.randomUUID();
      await sequelize.query(
        `INSERT INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        { replacements: [id, CBC_TEST_ID, name, unit, range, i] }
      );
      console.log(`  [${i + 1}/${components.length}] ${name} (${range} ${unit})`);
    }

    const [[{ count }]] = await sequelize.query(
      'SELECT COUNT(*) as count FROM lab_test_components WHERE lab_test_id = ?',
      { replacements: [CBC_TEST_ID] }
    );
    console.log(`\nDone. ${count} CBC components saved.`);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

run();
