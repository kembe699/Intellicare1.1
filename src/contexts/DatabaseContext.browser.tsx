import React, { createContext, useContext } from 'react';

// Import our specific API client implementations
import { LabTestApiClient } from '@/api/labTestApiClient';

/**
 * Browser-safe database context that uses API clients instead of direct Sequelize
 * This avoids the "Buffer is not defined" and "process is not defined" errors
 */

// Create specific client instances
const labTestApi = new LabTestApiClient();

// User API client mock
class UserApiClient {
  async findById(id: string) { return this.mockUser(id); }
  async findByEmail(email: string) { return this.mockUser('1', email); }
  async findAll() { return [this.mockUser('1')]; }
  async findByClinic(clinicId: number) { return [this.mockUser('1')]; }
  async create(data: any) { return this.mockUser('new', data.email); }
  async update(id: string, data: any) { return true; }
  async delete(id: string) { return true; }
  
  // Add missing method for Security page compatibility
  async toApplicationUser(dbUser: any) {
    return {
      id: dbUser.id,
      email: dbUser.email || 'user@example.com',
      displayName: dbUser.displayName || 'Test User',
      role: dbUser.role || 'admin',
      clinic: dbUser.clinic || 'Test Clinic',
      isActive: dbUser.isActive !== false
    };
  }
  
  // Helper to create mock user data
  private mockUser(id: string, email = 'user@example.com') {
    return {
      id,
      email,
      displayName: 'Test User',
      role: 'admin',
      clinic: 'Test Clinic',
      isActive: true,
      // Add get method to simulate Sequelize model behavior
      get: (field: string) => {
        const data: any = {
          id,
          email,
          display_name: 'Test User',
          role: 'admin',
          clinic_id: 1,
          status: 'active',
          is_active: true
        };
        return data[field];
      }
    };
  }
}

const userApi = new UserApiClient();

// Create mock implementations for other APIs
class BaseApiClient<T> {
  async findById() { return {} as T; }
  async findAll() { return [] as T[]; }
  async create(data: any) { return data as T; }
  async update(id: string, data: any) { return true; }
  async delete() { return true; }
  async findByClinic() { return [] as T[]; }
}

const patientApi = new BaseApiClient<any>();
const visitApi = new BaseApiClient<any>();
const diagnosisApi = new BaseApiClient<any>();
const drugInventoryApi = new BaseApiClient<any>();

// Create a context for database repositories
interface DatabaseContextType {
  userRepo: typeof userApi;
  patientRepo: typeof patientApi;
  labTestRepo: typeof labTestApi;
  visitRepo: typeof visitApi;
  diagnosisRepo: typeof diagnosisApi;
  drugInventoryRepo: typeof drugInventoryApi;
}

// Create the context with default values
const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);

// Provider component to make repositories available
export const DatabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Use our browser-safe API clients instead of Sequelize repositories
  const value: DatabaseContextType = {
    userRepo: userApi,
    patientRepo: patientApi,
    labTestRepo: labTestApi,
    visitRepo: visitApi,
    diagnosisRepo: diagnosisApi,
    drugInventoryRepo: drugInventoryApi,
  };

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  );
};

// Custom hook to use the database context
export const useDatabase = (): DatabaseContextType => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider');
  }
  return context;
};

export default DatabaseProvider;
