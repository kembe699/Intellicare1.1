const { sequelize, DrugInventory } = require('../server/models');

async function removeDuplicateDrugs() {
  try {
    console.log('🔍 Checking for duplicate drug brand names in inventory...\n');

    // Get all drug inventory items grouped by drug_name and clinic_id
    const allDrugs = await DrugInventory.findAll({
      order: [['drug_name', 'ASC'], ['created_at', 'DESC']]
    });

    // Group drugs by drug_name (case-insensitive) and clinic_id
    const drugGroups = {};
    
    allDrugs.forEach(drug => {
      const key = `${drug.drug_name.toLowerCase().trim()}_${drug.clinic_id}`;
      if (!drugGroups[key]) {
        drugGroups[key] = [];
      }
      drugGroups[key].push(drug);
    });

    // Find groups with duplicates
    let totalDuplicates = 0;
    let totalDeleted = 0;

    for (const [key, drugs] of Object.entries(drugGroups)) {
      if (drugs.length > 1) {
        totalDuplicates += drugs.length - 1;
        
        console.log(`\n📦 Found ${drugs.length} entries for "${drugs[0].drug_name}" (Clinic ID: ${drugs[0].clinic_id})`);
        
        // Keep the first one (most recent based on created_at DESC order)
        const keepDrug = drugs[0];
        const duplicates = drugs.slice(1);
        
        console.log(`   ✅ Keeping: ID ${keepDrug.id} | Stock: ${keepDrug.current_stock} | Created: ${keepDrug.created_at}`);
        
        // Delete the duplicates
        for (const duplicate of duplicates) {
          console.log(`   ❌ Deleting: ID ${duplicate.id} | Stock: ${duplicate.current_stock} | Created: ${duplicate.created_at}`);
          
          await DrugInventory.destroy({
            where: { id: duplicate.id }
          });
          
          totalDeleted++;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✨ Cleanup Complete!`);
    console.log(`   Total duplicate entries found: ${totalDuplicates}`);
    console.log(`   Total entries deleted: ${totalDeleted}`);
    console.log(`   Unique drugs remaining: ${Object.keys(drugGroups).length}`);
    console.log('='.repeat(60) + '\n');

    if (totalDeleted === 0) {
      console.log('✅ No duplicates found! Your inventory is clean.\n');
    } else {
      console.log('✅ All duplicate drug entries have been removed successfully!\n');
    }

  } catch (error) {
    console.error('❌ Error removing duplicate drugs:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run the script
removeDuplicateDrugs()
  .then(() => {
    console.log('Script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
