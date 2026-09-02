const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

async function importServices() {
  try {
    console.log('Starting services import...');
    
    // Read the CSV file
    const csvPath = path.join(__dirname, '../../public/services_template.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    
    // Parse CSV
    const lines = csvContent.split('\n');
    const services = [];
    
    // Skip header row (index 0) and process data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines
      
      // Parse CSV line (handling commas within quotes)
      const matches = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
      if (!matches || matches.length < 4) continue;
      
      const mainCategory = matches[0].replace(/"/g, '').trim();
      const subcategory = matches[1].replace(/"/g, '').trim();
      const department = matches[2].replace(/"/g, '').trim();
      const priceStr = matches[3].replace(/"/g, '').trim();
      
      // Parse price - remove commas and convert to number
      const price = priceStr ? parseFloat(priceStr.replace(/,/g, '')) : 0;
      
      // Create unique service name by combining all parts
      const serviceName = `${mainCategory} - ${subcategory} - ${department}`;
      
      services.push({
        category: mainCategory,
        service_name: serviceName,
        description: `${subcategory} | ${department}`,
        price: price || 0,
        is_active: true
      });
    }
    
    console.log(`Parsed ${services.length} services from CSV`);
    
    // Clear existing services
    await sequelize.query('DELETE FROM services');
    console.log('Cleared existing services');
    
    // Insert services in batches
    const batchSize = 50;
    for (let i = 0; i < services.length; i += batchSize) {
      const batch = services.slice(i, i + batchSize);
      
      const values = batch.map(s => 
        `(UUID(), '${s.service_name.replace(/'/g, "''")}', '${s.category.replace(/'/g, "''")}', ${s.price}, '${(s.description || '').replace(/'/g, "''")}', ${s.is_active})`
      ).join(',');
      
      await sequelize.query(`
        INSERT INTO services (id, service_name, category, price, description, is_active)
        VALUES ${values}
      `);
      
      console.log(`Inserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} services)`);
    }
    
    // Verify import
    const [results] = await sequelize.query('SELECT COUNT(*) as count FROM services');
    console.log(`✅ Successfully imported ${results[0].count} services to database`);
    
    // Show sample services
    const [samples] = await sequelize.query('SELECT * FROM services LIMIT 5');
    console.log('\nSample services:');
    samples.forEach(s => {
      console.log(`  - ${s.service_name} (${s.category}) - SSP ${s.price.toLocaleString()}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error importing services:', error);
    process.exit(1);
  }
}

importServices();
