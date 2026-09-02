// Browser-safe stub for database imports
// This prevents Sequelize from being loaded in the browser

export const db = null;
export const testConnection = () => Promise.resolve(false);
export default null;
