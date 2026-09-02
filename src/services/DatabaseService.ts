/**
 * Client-side service to handle database operations without direct Sequelize usage in browser
 * This avoids the "Buffer is not defined" errors from Sequelize in browser context
 */

import { User, Patient, LabTest, Visit } from "@/types";

// Base repository interface to standardize CRUD operations
interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

// Abstract base service for common API operations
abstract class BaseService<T> implements IRepository<T> {
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  // Generic API call wrapper with error handling
  protected async fetchApi(path: string, options: RequestInit = {}): Promise<any> {
    try {
      // For development, use the backend API endpoint
      // In production, this would point to your actual API
      const baseUrl = '/api';
      const url = `${baseUrl}/${this.endpoint}${path}`;
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `API call failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error in ${this.endpoint} service:`, error);
      throw error;
    }
  }

  // Standard CRUD implementations
  async findById(id: string): Promise<T | null> {
    return this.fetchApi(`/${id}`);
  }

  async findAll(): Promise<T[]> {
    return this.fetchApi('/');
  }

  async create(data: Partial<T>): Promise<T> {
    return this.fetchApi('/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async update(id: string, data: T): Promise<boolean> {
    await this.fetchApi(`/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return true;
  }

  async delete(id: string): Promise<boolean> {
    await this.fetchApi(`/${id}`, {
      method: 'DELETE',
    });
    return true;
  }
}

// User-specific service implementation
export class UserService extends BaseService<User> {
  constructor() {
    super('users');
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.fetchApi(`/email/${email}`);
  }

  async findByClinic(clinicId: number): Promise<User[]> {
    return this.fetchApi(`/clinic/${clinicId}`);
  }
}

// Patient-specific service implementation
export class PatientService extends BaseService<Patient> {
  constructor() {
    super('patients');
  }

  async findByClinic(clinicId: number): Promise<Patient[]> {
    return this.fetchApi(`/clinic/${clinicId}`);
  }

  async searchByName(query: string): Promise<Patient[]> {
    return this.fetchApi(`/search?q=${encodeURIComponent(query)}`);
  }
}

// Lab test service implementation
export class LabTestService extends BaseService<LabTest> {
  constructor() {
    super('lab-tests');
  }

  async findByClinic(clinicId: number): Promise<LabTest[]> {
    return this.fetchApi(`/clinic/${clinicId}`);
  }

  async findByCategory(category: string): Promise<LabTest[]> {
    return this.fetchApi(`/category/${encodeURIComponent(category)}`);
  }
}

// Visit service implementation
export class VisitService extends BaseService<Visit> {
  constructor() {
    super('visits');
  }

  async findByPatient(patientId: string): Promise<Visit[]> {
    return this.fetchApi(`/patient/${patientId}`);
  }

  async findByDoctor(doctorId: string): Promise<Visit[]> {
    return this.fetchApi(`/doctor/${doctorId}`);
  }
}

// Export service instances
export const userService = new UserService();
export const patientService = new PatientService();
export const labTestService = new LabTestService();
export const visitService = new VisitService();
