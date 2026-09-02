import { testConnection } from '../lib/database';
import sequelize from '../lib/database';
import { initializeAssociations } from '../models/associations';

async function testDb() {
  try {
    console.log('Testing database connection...');
    
    // Test connection
    const connectionSuccess = await testConnection();
    
    if (connectionSuccess) {
      // Initialize model associations
      initializeAssociations();
      console.log('Model associations initialized');
      
      // Close connection
      await sequelize.close();
      console.log('Connection closed');
    }
  } catch (error) {
    console.error('Error testing database connection:', error);
    process.exit(1);
  }
}

// Run the test
testDb();
