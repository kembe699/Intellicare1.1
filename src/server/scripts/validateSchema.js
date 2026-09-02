require('dotenv').config({ path: '../.env' });
const sequelize = require('../config/database');
const models = require('../models');

(async () => {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const allModels = Object.values(models).filter(m => m.rawAttributes);
    
    console.log(`Checking ${allModels.length} models...`);
    let missingColumnsCount = 0;
    
    for (const model of allModels) {
      try {
        const tableName = model.tableName;
        const attributes = model.rawAttributes;
        
        // Skip if table doesn't exist
        const tables = await sequelize.query('SHOW TABLES LIKE :table', {
          replacements: { table: tableName },
          type: sequelize.QueryTypes.SELECT
        });
        
        if (tables.length === 0) {
          console.log(`[WARNING] Table ${tableName} does not exist for model ${model.name}`);
          continue;
        }
        
        const columns = await queryInterface.describeTable(tableName);
        
        const missingCols = [];
        for (const [attrName, attrDef] of Object.entries(attributes)) {
          // Sequelize uses snake_case column names based on field or underscored: true
          const colName = attrDef.field || attrName;
          
          if (!columns[colName]) {
            missingCols.push(colName);
          }
        }
        
        if (missingCols.length > 0) {
          console.log(`[ERROR] Table ${tableName} is missing columns: ${missingCols.join(', ')}`);
          missingColumnsCount += missingCols.length;
          
          // Fix them automatically
          for (const missingCol of missingCols) {
            const attrDef = Object.values(attributes).find(a => (a.field || a.name) === missingCol);
            let sqlType = 'VARCHAR(255)'; // fallback
            if (attrDef.type.key === 'INTEGER') sqlType = 'INT';
            if (attrDef.type.key === 'UUID') sqlType = 'VARCHAR(36)';
            if (attrDef.type.key === 'BOOLEAN') sqlType = 'BOOLEAN';
            if (attrDef.type.key === 'DECIMAL') sqlType = 'DECIMAL(10,2)';
            if (attrDef.type.key === 'TEXT') sqlType = 'TEXT';
            if (attrDef.type.key === 'JSON') sqlType = 'JSON';
            if (attrDef.type.key === 'DATE') sqlType = 'DATETIME';
            
            try {
              await sequelize.query(`ALTER TABLE ${tableName} ADD COLUMN ${missingCol} ${sqlType} NULL`);
              console.log(`  -> Fixed: Added ${missingCol} to ${tableName}`);
            } catch (err) {
              console.log(`  -> Failed to add ${missingCol} to ${tableName}: ${err.message}`);
            }
          }
        }
      } catch (e) {
        // Just skip models that fail reflection
      }
    }
    
    console.log(`\nDone! Found and fixed ${missingColumnsCount} missing columns.`);
  } catch (err) {
    console.error('Script Error:', err);
  } finally {
    process.exit();
  }
})();
