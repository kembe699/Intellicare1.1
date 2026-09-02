// Centralized API URL utility for consistent HTTPS handling
export const getApiUrl = (path: string = '') => {
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  
  const baseUrl = isLocalhost 
    ? window.location.origin 
    : (import.meta.env.VITE_API_URL || 'https://api.nilehc.tech');
  
  // Ensure path starts with /api if not already included
  if (path && !path.startsWith('/api')) {
    path = `/api/${path}`;
  } else if (path && path.startsWith('/api')) {
    // Path already has /api prefix
  } else if (!path) {
    path = '/api';
  }
  
  return `${baseUrl}${path}`;
};

// Specific API endpoint helpers
export const getAuthApiUrl = (endpoint: string = '') => getApiUrl(`/auth${endpoint}`);
export const getPatientsApiUrl = (endpoint: string = '') => getApiUrl(`/patients${endpoint}`);
export const getInventoryApiUrl = (endpoint: string = '') => getApiUrl(`/inventory${endpoint}`);
export const getSchemesApiUrl = (endpoint: string = '') => getApiUrl(`/schemes${endpoint}`);
export const getInvoicesApiUrl = (endpoint: string = '') => getApiUrl(`/invoices${endpoint}`);
export const getAccountingApiUrl = (endpoint: string = '') => getApiUrl(`/accounting${endpoint}`);
export const getUsersApiUrl = (endpoint: string = '') => getApiUrl(`/users${endpoint}`);
export const getPharmacyModuleApiUrl = (endpoint: string = '') => getApiUrl(`/pharmacy-module${endpoint}`);
