import { LabTest, LabTestComponent } from "@/types";

/**
 * Client-side API for lab tests that matches the LabTestRepository interface
 * This avoids using Sequelize directly in the browser environment
 */
export class LabTestApiClient {
  private readonly endpoint = '/api/lab-tests';

  // Generic API call function
  private async fetchApi(path: string = "", options: RequestInit = {}): Promise<any> {
    try {
      const url = `${this.endpoint}${path}`;
      console.log(`API ${options.method || 'GET'} request to ${url}`);
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API call failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error in lab test API call:', error);
      throw error;
    }
  }

  // Mimic the repository methods
  async findById(id: string): Promise<LabTest | null> {
    return this.fetchApi(`/${id}`);
  }

  async findAll(): Promise<LabTest[]> {
    return this.fetchApi();
  }

  async create(data: any): Promise<LabTest> {
    return this.fetchApi("", { 
      method: "POST", 
      body: JSON.stringify(data) 
    });
  }

  async update(id: string, data: any): Promise<boolean> {
    await this.fetchApi(`/${id}`, { 
      method: "PUT", 
      body: JSON.stringify(data) 
    });
    return true;
  }

  async delete(id: string): Promise<boolean> {
    await this.fetchApi(`/${id}`, { method: "DELETE" });
    return true;
  }

  // Special methods from LabTestRepository
  async findByClinic(clinicId: number): Promise<LabTest[]> {
    return this.fetchApi(`/clinic/${clinicId}`);
  }

  async findByCode(code: string): Promise<LabTest | null> {
    return this.fetchApi(`/code/${code}`);
  }

  async toApplicationLabTest(model: any): Promise<LabTest> {
    // In browser environment, models should already be in application format
    return model as LabTest;
  }

  async createWithComponents(testData: any, components: LabTestComponent[]): Promise<LabTest> {
    return this.fetchApi("/with-components", {
      method: "POST",
      body: JSON.stringify({ test: testData, components })
    });
  }

  async updateWithComponents(id: string, testData: any, components: LabTestComponent[]): Promise<boolean> {
    await this.fetchApi(`/${id}/with-components`, {
      method: "PUT",
      body: JSON.stringify({ test: testData, components })
    });
    return true;
  }

  async deleteWithComponents(id: string): Promise<boolean> {
    await this.fetchApi(`/${id}/with-components`, { method: "DELETE" });
    return true;
  }
}
