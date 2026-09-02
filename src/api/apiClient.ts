/**
 * API client for communicating with the MySQL backend
 * Centralised fetch with automatic JWT injection
 */

import { User, Patient, LabTest, Visit, Diagnosis, DrugInventory } from "@/types";

// ── Production-safe base URL ────────────────────────────────────────────────
const RENDER_BACKEND = 'https://api.nilehc.tech';
const getProductionBase = () => {
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocalhost) return '';
  // Private/LAN IP — route to the local backend on port 3002 (same host)
  const isPrivateIP = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(hostname);
  if (isPrivateIP) return `http://${hostname}:3002`;
  return import.meta.env.VITE_API_URL || RENDER_BACKEND;
};

// ── Auth-aware fetch ─────────────────────────────────────────────────────────
export const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  // In production, prepend backend URL to any relative /api/ path
  if (url.startsWith('/api') || url.startsWith('/health')) {
    url = `${getProductionBase()}${url}`;
  }
  const token = localStorage.getItem('auth_token');
  const currentBranchId = localStorage.getItem('current_branch_id');
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(currentBranchId ? { 'X-Branch-ID': currentBranchId } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // Token expired — clear session and redirect to login
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }

  return response;
};

// ── Base class ───────────────────────────────────────────────────────────────
class BaseApiClient<T> {
  protected readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  protected async fetchApi(path: string = "", options: RequestInit = {}): Promise<any> {
    const url = `${getProductionBase()}/api/${this.endpoint}${path}`;
    try {
      const response = await authFetch(url, options);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error in ${this.endpoint} API call:`, error);
      throw error;
    }
  }

  async findById(id: string): Promise<T | null> { return this.fetchApi(`/${id}`); }
  async findAll(): Promise<T[]>                  { return this.fetchApi(); }
  async create(data: Partial<T>): Promise<T>     { return this.fetchApi("", { method: "POST", body: JSON.stringify(data) }); }
  async update(id: string, data: Partial<T>): Promise<boolean> {
    await this.fetchApi(`/${id}`, { method: "PUT", body: JSON.stringify(data) });
    return true;
  }
  async delete(id: string): Promise<boolean> {
    await this.fetchApi(`/${id}`, { method: "DELETE" });
    return true;
  }
}

// ── Specialised clients ──────────────────────────────────────────────────────
export class UserApiClient extends BaseApiClient<User> {
  constructor() { super("users"); }
  findByEmail(email: string)            { return this.fetchApi(`/email/${email}`); }
  findByClinic(clinicId: number)        { return this.fetchApi(`/clinic/${clinicId}`); }
}

export class PatientApiClient extends BaseApiClient<Patient> {
  constructor() { super("patients"); }
  findByClinic(clinicId: number)        { return this.fetchApi(`/clinic/${clinicId}`); }
  searchByName(query: string)           { return this.fetchApi(`/search?q=${encodeURIComponent(query)}`); }
}

export class LabTestApiClient extends BaseApiClient<LabTest> {
  constructor() { super("lab-tests"); }
  findByClinic(clinicId: number)        { return this.fetchApi(`/clinic/${clinicId}`); }
  findByCategory(category: string)      { return this.fetchApi(`/category/${encodeURIComponent(category)}`); }
  search(query: string)                 { return this.fetchApi(`/search?q=${encodeURIComponent(query)}`); }
}

export class VisitApiClient extends BaseApiClient<Visit> {
  constructor() { super("visits"); }
  findByPatient(patientId: string)      { return this.fetchApi(`/patient/${patientId}`); }
}

export class DiagnosisApiClient extends BaseApiClient<Diagnosis> {
  constructor() { super("diagnoses"); }
  findByPatient(patientId: string)      { return this.fetchApi(`/patient/${patientId}`); }
}

export class DrugInventoryApiClient extends BaseApiClient<DrugInventory> {
  constructor() { super("pharmacy"); }
  findByClinic(clinicId: number)        { return this.fetchApi(`/inventory/${clinicId}`); }
}

// ── Generic ad-hoc API clients used by pages ─────────────────────────────────
export class GenericApiClient {
  private base: string;
  constructor(base: string) { this.base = base; }

  async get(path = ""): Promise<any> {
    const r = await authFetch(`${this.base}${path}`);
    if (!r.ok) throw new Error(`GET ${this.base}${path} failed: ${r.status}`);
    return r.json();
  }

  // Convenience alias used by Dashboard
  async getStats(clinicId: string | number): Promise<any> {
    return this.get(`/stats/${clinicId}`);
  }

  async post(path = "", body: unknown): Promise<any> {
    const r = await authFetch(`${this.base}${path}`, { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`POST ${this.base}${path} failed: ${r.status}`);
    return r.json();
  }

  async put(path = "", body: unknown): Promise<any> {
    const r = await authFetch(`${this.base}${path}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`PUT ${this.base}${path} failed: ${r.status}`);
    return r.json();
  }

  async del(path = ""): Promise<any> {
    const r = await authFetch(`${this.base}${path}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${this.base}${path} failed: ${r.status}`);
    return r.json();
  }
}

// ── Singleton exports ────────────────────────────────────────────────────────
export const userApi          = new UserApiClient();
export const patientApi       = new PatientApiClient();
export const labTestApi       = new LabTestApiClient();
export const visitApi         = new VisitApiClient();
export const diagnosisApi     = new DiagnosisApiClient();
export const drugInventoryApi = new DrugInventoryApiClient();

const B = () => getProductionBase();
export const dashboardApi     = new GenericApiClient(`${B()}/api/dashboard`);
export const clinicalApi      = new GenericApiClient(`${B()}/api/clinical`);
export const pharmacyApi      = new GenericApiClient(`${B()}/api/pharmacy`);
export const clinicsApi       = new GenericApiClient(`${B()}/api/clinics`);
export const servicesApi      = new GenericApiClient(`${B()}/api/services`);
export const patientQueueApi  = new GenericApiClient(`${B()}/api/patient-queue`);
export const patientBillApi   = new GenericApiClient(`${B()}/api/patient-bills`);
export const receiptsApi      = new GenericApiClient(`${B()}/api/receipts`);
export const reportsApi       = new GenericApiClient(`${B()}/api/reports`);
export const labRequestsApi   = new GenericApiClient(`${B()}/api/lab-requests`);
export const labResultsApi    = new GenericApiClient(`${B()}/api/lab-results`);
export const suppliersApi     = new GenericApiClient(`${B()}/api/suppliers`);
export const purchaseOrdersApi= new GenericApiClient(`${B()}/api/purchase-orders`);
export const dailyExpensesApi = new GenericApiClient(`${B()}/api/daily-expenses`);
export const ledgerApi        = new GenericApiClient(`${B()}/api/ledger-accounts`);
export const cashierApi       = new GenericApiClient(`${B()}/api/cashier`);
export const cashTransferApi  = new GenericApiClient(`${B()}/api/cash-transfers`);
export const facilitiesApi    = new GenericApiClient(`${B()}/api/facilities`);
export const procurementApi   = new GenericApiClient(`${B()}/api/procurement`);
