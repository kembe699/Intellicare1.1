/**
 * Browser-safe database module that provides no actual database functionality
 * This file replaces database.ts in browser environments to prevent Sequelize imports
 */

// Mock implementations for browser environment
export const testConnection = async (): Promise<boolean> => {
  console.warn('Database operations not available in browser environment');
  return false;
};

// Mock sequelize instance
const mockSequelize = {
  authenticate: async () => { throw new Error('Sequelize not available in browser'); },
  sync: async () => { throw new Error('Sequelize not available in browser'); },
  close: async () => { console.warn('No database connection to close in browser'); },
  transaction: async () => { throw new Error('Transactions not available in browser'); },
  query: async () => { throw new Error('Raw queries not available in browser'); },
  models: {},
};

export default mockSequelize;
