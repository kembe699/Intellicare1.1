const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../routes');
const files = ['inpatient.js', 'pharmacyModule.js', 'schemes.js', 'labRequests.js', 'clinical.js', 'reports.js'];

for (const file of files) {
  const filePath = path.join(dir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace ::uuid with nothing
    content = content.replace(/::uuid/g, '');
    
    // Replace DATE_PART('year', AGE(p.date_of_birth)) with (EXTRACT(YEAR FROM AGE((CURRENT_DATE)::timestamp, (p.date_of_birth)::timestamp)))::int
    content = content.replace(/DATE_PART\('year', AGE\(([^)]+)\)\)/g, '(EXTRACT(YEAR FROM AGE((CURRENT_DATE)::timestamp, ($1)::timestamp)))::int');
    
    fs.writeFileSync(filePath, content);
    console.log('Fixed', file);
  }
}
