// Browser-safe stub for database imports
// The actual database is handled by the backend server (server/models/index.js)

export const db = null;
export const testConnection = () => Promise.resolve(false);
export default { models: {} } as any;
