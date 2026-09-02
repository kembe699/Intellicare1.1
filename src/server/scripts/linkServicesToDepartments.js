const { sequelize } = require('../models');

async function linkServicesToDepartments() {
  console.log('\n=== Linking Services to Departments ===\n');

  try {
    // Fetch all departments
    console.log('1. Fetching departments...');
    const [departments] = await sequelize.query(`
      SELECT id, department_name, department_code FROM departments WHERE is_active = TRUE
    `);
    
    console.log(`  ✅ Found ${departments.length} active departments`);
    
    // Create department lookup map
    const deptMap = {};
    departments.forEach(dept => {
      deptMap[dept.department_code] = dept.id;
    });

    // Fetch all services
    console.log('\n2. Fetching services...');
    const [services] = await sequelize.query(`
      SELECT id, service_name, category, description FROM services WHERE is_active = TRUE
    `);
    
    console.log(`  ✅ Found ${services.length} active services`);

    // Intelligent mapping logic
    const mapServiceToDepartment = (service) => {
      const name = (service.service_name || '').toLowerCase();
      const category = (service.category || '').toLowerCase();
      const desc = (service.description || '').toLowerCase();
      const combined = `${name} ${category} ${desc}`;

      // Emergency Department (ER)
      if (combined.includes('emergency') || combined.includes('urgent') || 
          combined.includes('trauma') || combined.includes('er ') ||
          combined.includes('resuscitation') || combined.includes('triage')) {
        return deptMap['ER'];
      }

      // Laboratory (LAB)
      if (combined.includes('lab') || combined.includes('test') || 
          combined.includes('blood') || combined.includes('urine') ||
          combined.includes('specimen') || combined.includes('culture') ||
          combined.includes('cbc') || combined.includes('rft') || 
          combined.includes('lft') || combined.includes('hiv') ||
          combined.includes('malaria') || combined.includes('pregnancy test') ||
          combined.includes('urinalysis') || combined.includes('stool') ||
          combined.includes('microscopy') || combined.includes('serology')) {
        return deptMap['LAB'];
      }

      // Radiology (RAD)
      if (combined.includes('x-ray') || combined.includes('xray') ||
          combined.includes('ultrasound') || combined.includes('scan') ||
          combined.includes('ct ') || combined.includes('mri') ||
          combined.includes('imaging') || combined.includes('radiolog') ||
          combined.includes('echo') || combined.includes('mammogram')) {
        return deptMap['RAD'];
      }

      // Pharmacy (PHARM)
      if (combined.includes('pharmacy') || combined.includes('medication') ||
          combined.includes('drug') || combined.includes('prescription') ||
          combined.includes('dispensing')) {
        return deptMap['PHARM'];
      }

      // Surgery (SURG)
      if (combined.includes('surgery') || combined.includes('surgical') ||
          combined.includes('operation') || combined.includes('appendectomy') ||
          combined.includes('cesarean') || combined.includes('c-section') ||
          combined.includes('laparotomy') || combined.includes('amputation') ||
          combined.includes('hernia repair') || combined.includes('mastectomy') ||
          category === 'surgery') {
        return deptMap['SURG'];
      }

      // Obstetrics & Gynecology (OBGYN)
      if (combined.includes('delivery') || combined.includes('antenatal') ||
          combined.includes('postnatal') || combined.includes('prenatal') ||
          combined.includes('maternity') || combined.includes('gynecolog') ||
          combined.includes('obstetric') || combined.includes('pregnancy') ||
          combined.includes('pap smear') || combined.includes('contracepti') ||
          combined.includes('family planning') || combined.includes('ivf')) {
        return deptMap['OBGYN'];
      }

      // Pediatrics (PEDS)
      if (combined.includes('pediatric') || combined.includes('paediatric') ||
          combined.includes('child') || combined.includes('infant') ||
          combined.includes('vaccination') || combined.includes('immunization') ||
          combined.includes('newborn') || combined.includes('neonatal')) {
        return deptMap['PEDS'];
      }

      // Inpatient Department (IPD)
      if (combined.includes('admission') || combined.includes('ward') ||
          combined.includes('bed') || combined.includes('inpatient') ||
          combined.includes('hospitalization') || combined.includes('icu') ||
          combined.includes('intensive care')) {
        return deptMap['IPD'];
      }

      // Administration (ADMIN)
      if (combined.includes('admin') || combined.includes('registration') ||
          combined.includes('records') || combined.includes('filing') ||
          combined.includes('documentation')) {
        return deptMap['ADMIN'];
      }

      // Outpatient Department (OPD) - Default for consultations and general services
      if (combined.includes('consultation') || combined.includes('consult') ||
          combined.includes('checkup') || combined.includes('check-up') ||
          combined.includes('review') || combined.includes('follow-up') ||
          combined.includes('outpatient') || category === 'consultation') {
        return deptMap['OPD'];
      }

      // Procedures that don't fit other categories -> OPD
      if (category === 'procedure' || category === 'therapy' || category === 'diagnostic') {
        return deptMap['OPD'];
      }

      // Default to OPD for unmatched services
      return deptMap['OPD'];
    };

    // Update services with department links
    console.log('\n3. Linking services to departments...');
    let linkedCount = 0;
    const updates = {};

    for (const service of services) {
      const departmentId = mapServiceToDepartment(service);
      if (departmentId) {
        if (!updates[departmentId]) {
          updates[departmentId] = [];
        }
        updates[departmentId].push(service.id);
      }
    }

    // Execute batch updates
    for (const [deptId, serviceIds] of Object.entries(updates)) {
      const dept = departments.find(d => d.id === deptId);
      await sequelize.query(`
        UPDATE services 
        SET department_id = :deptId 
        WHERE id IN (:serviceIds)
      `, {
        replacements: { deptId, serviceIds }
      });
      
      linkedCount += serviceIds.length;
      console.log(`  ✅ Linked ${serviceIds.length} services to ${dept.department_name} (${dept.department_code})`);
    }

    console.log(`\n  📊 Total services linked: ${linkedCount}/${services.length}`);
    console.log('\n=== Linking Complete ===\n');

    // Show summary by department
    console.log('Summary by Department:');
    for (const dept of departments) {
      const count = updates[dept.id]?.length || 0;
      if (count > 0) {
        console.log(`  • ${dept.department_name} (${dept.department_code}): ${count} services`);
      }
    }
    console.log('');

  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  linkServicesToDepartments()
    .then(() => {
      console.log('✅ Service-Department linking completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Service-Department linking failed:', error);
      process.exit(1);
    });
}

module.exports = linkServicesToDepartments;
