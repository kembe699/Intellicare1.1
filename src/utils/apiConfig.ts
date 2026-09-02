// Dynamic API configuration for network access
export const getApiBaseUrl = () => {
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  
  if (isLocalhost) {
    return `${window.location.origin}/api`;
  } else {
    // For production, use VITE_API_URL env variable pointing to Render backend
    const apiUrl = (import.meta as any).env?.VITE_API_URL || 'https://api.nilehc.tech';
    return `${apiUrl}/api`;
  }
};

export const getAuthApiUrl = () => `${getApiBaseUrl()}/auth`;
export const getPatientsApiUrl = () => `${getApiBaseUrl()}/patients`;
export const getPharmacyApiUrl = () => `${getApiBaseUrl()}/pharmacy`;
export const getPatientBillsApiUrl = () => `${getApiBaseUrl()}/patient-bills`;
export const getReceiptsApiUrl = () => `${getApiBaseUrl()}/receipts`;
export const getClinicalApiUrl = () => `${getApiBaseUrl()}/clinical`;
export const getDashboardApiUrl = () => `${getApiBaseUrl()}/dashboard`;
export const getServicesApiUrl = () => `${getApiBaseUrl()}/services`;
export const getClinicsApiUrl = () => `${getApiBaseUrl()}/clinics`;
