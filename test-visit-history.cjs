const { sequelize } = require('./server/models');

async function testVisitHistory() {
  try {
    console.log('\n=== Testing Visit History Query ===\n');
    
    const dateFrom = '2026-02-13';
    const dateTo = '2026-03-15';
    
    const sql = `
      SELECT 
        v.id as visit_id,
        v.visit_date,
        'General' as visit_type,
        v.chief_complaint,
        v.diagnosis,
        v.clinical_notes as notes,
        v.status as visit_status,
        v.created_at,
        p.id as patient_id,
        p.patient_id as patient_number,
        p.first_name,
        p.last_name,
        p.date_of_birth,
        p.gender,
        p.phone_number as phone,
        CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name,
        TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) as age,
        u.id as doctor_id,
        u.display_name as doctor_name,
        u.email as doctor_email,
        (SELECT COUNT(*) FROM visits WHERE patient_id = p.id) as total_visits,
        (SELECT MAX(visit_date) FROM visits WHERE patient_id = p.id AND id != v.id) as last_visit_date
      FROM visits v
      LEFT JOIN patients p ON v.patient_id = p.id
      LEFT JOIN users u ON v.doctor_id = u.id
      WHERE v.visit_date BETWEEN ? AND ?
      ORDER BY v.visit_date DESC, v.created_at DESC LIMIT 500
    `;
    
    console.log('Executing query...');
    const [visits] = await sequelize.query(sql, { 
      replacements: [dateFrom, dateTo + ' 23:59:59'] 
    });
    
    console.log(`✅ Query successful! Found ${visits.length} visits`);
    
    if (visits.length > 0) {
      console.log('\nSample visit:');
      console.log(JSON.stringify(visits[0], null, 2));
    }
    
    // Test summary query
    console.log('\nTesting summary query...');
    const [stats] = await sequelize.query(`
      SELECT 
        COUNT(DISTINCT v.id) as total_visits,
        COUNT(DISTINCT v.patient_id) as unique_patients,
        COUNT(DISTINCT v.doctor_id) as doctors_involved,
        COUNT(DISTINCT DATE(v.visit_date)) as visit_days
      FROM visits v
      WHERE v.visit_date BETWEEN ? AND ?
    `, { replacements: [dateFrom, dateTo + ' 23:59:59'] });
    
    console.log('Summary:', stats[0]);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Full error:', error);
  } finally {
    process.exit(0);
  }
}

testVisitHistory();
