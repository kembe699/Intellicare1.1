const { sequelize } = require('../models');

async function migrateDepartments() {
  console.log('\n=== Departments Table Migration ===\n');

  try {
    // Create departments table
    console.log('1. Creating departments table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id VARCHAR(36) PRIMARY KEY,
        department_name VARCHAR(255) NOT NULL,
        department_code VARCHAR(50) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        clinic_id INT NOT NULL DEFAULT 1,
        branch_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_dept_code_clinic UNIQUE (department_code, clinic_id)
      )
    `);
    console.log('  ✅ departments table created');

    // Create indexes
    console.log('2. Creating indexes...');
    for (const [idxName, idxSql] of [
      ['idx_dept_clinic', 'CREATE INDEX idx_dept_clinic ON departments(clinic_id)'],
      ['idx_dept_branch', 'CREATE INDEX idx_dept_branch ON departments(branch_id)'],
      ['idx_dept_active', 'CREATE INDEX idx_dept_active ON departments(is_active)'],
      ['idx_dept_code', 'CREATE INDEX idx_dept_code ON departments(department_code)'],
    ]) {
      try {
        const [[idxCheck]] = await sequelize.query(
          `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'departments' AND indexname = :idxName`,
          { replacements: { idxName } }
        );
        if (!idxCheck.cnt) await sequelize.query(idxSql);
      } catch (e) { console.log(`  Note: could not create index ${idxName}: ${e.message}`); }
    }
    console.log('  ✅ indexes created');

    // Insert some default departments
    console.log('\n3. Seeding default departments...');
    
    const defaultDepartments = [
      { code: 'ER', name: 'Emergency Department', description: 'Emergency and urgent care services' },
      { code: 'OPD', name: 'Outpatient Department', description: 'General outpatient consultations' },
      { code: 'IPD', name: 'Inpatient Department', description: 'Inpatient care and admissions' },
      { code: 'LAB', name: 'Laboratory', description: 'Clinical laboratory services' },
      { code: 'PHARM', name: 'Pharmacy', description: 'Pharmaceutical services' },
      { code: 'RAD', name: 'Radiology', description: 'Imaging and radiology services' },
      { code: 'SURG', name: 'Surgery', description: 'Surgical services' },
      { code: 'PEDS', name: 'Pediatrics', description: 'Child healthcare services' },
      { code: 'OBGYN', name: 'Obstetrics & Gynecology', description: 'Maternal and women health services' },
      { code: 'ADMIN', name: 'Administration', description: 'Administrative and management' }
    ];

    for (const dept of defaultDepartments) {
      try {
        const [existing] = await sequelize.query(
          'SELECT id FROM departments WHERE department_code = ? AND clinic_id = 1',
          { replacements: [dept.code] }
        );

        if (existing.length === 0) {
          const { v4: uuidv4 } = require('uuid');
          await sequelize.query(`
            INSERT INTO departments (id, department_name, department_code, description, is_active, clinic_id)
            VALUES (?, ?, ?, ?, TRUE, 1)
          `, {
            replacements: [uuidv4(), dept.name, dept.code, dept.description]
          });
          console.log(`  ✅ Created department: ${dept.name} (${dept.code})`);
        } else {
          console.log(`  ℹ️  Department ${dept.code} already exists`);
        }
      } catch (err) {
        if (!err.message.includes('Duplicate')) {
          console.error(`  ⚠️  Error seeding ${dept.code}:`, err.message);
        }
      }
    }

    console.log('\n=== Departments Migration Complete ===\n');
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  migrateDepartments()
    .then(() => {
      console.log('✅ Departments migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Departments migration failed:', error);
      process.exit(1);
    });
}

module.exports = migrateDepartments;
