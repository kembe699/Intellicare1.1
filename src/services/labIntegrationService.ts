import { authFetch } from '@/api/apiClient';

export interface MindrayResult {
  sampleId: string;
  testCode: string;
  machineName: string;
  components: Array<{
    name: string;
    value: string;
    unit: string;
    flag?: string;
  }>;
  timestamp: string;
  status: 'completed' | 'pending' | 'error';
}

export class LabIntegrationService {
  constructor(mindrayHost: string = 'localhost', mindrayPort: number = 5100) {
    // Legacy constructor parameters ignored, we use the central API Holding Tank now
  }

  async initialize(): Promise<void> {
    console.log('Lab integration service initialized via Holding Tank architecture');
  }

  async requestCBCResult(sampleId: string, testRequestId?: string): Promise<MindrayResult | null> {
    try {
      console.log(`Fetching machine result from Holding Tank for sample: ${sampleId}`);
      
      const response = await authFetch(`/api/lab-integration/fetch-machine-result?sampleId=${encodeURIComponent(sampleId)}`, {
        credentials: 'include'
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch from Holding Tank');
      }

      const result = await response.json();
      const rawResult = result.data;

      // Ensure it's marked as processed so it doesn't show up again
      await authFetch('/api/lab-integration/mark-processed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: rawResult.id })
      });

      // Convert stored parsed_data back to MindrayResult format
      const parsedData = typeof rawResult.parsed_data === 'string' ? JSON.parse(rawResult.parsed_data) : rawResult.parsed_data;
      
      const mindrayResult: MindrayResult = {
        sampleId: rawResult.sample_id,
        testCode: parsedData.testCode || 'CBC',
        // The real source analyzer (e.g. "Bonavera Count 5R") — this used to
        // get dropped here, so the UI only ever had "Mindray" to show,
        // regardless of which machine the result actually came from.
        machineName: rawResult.machine_name || 'Lab Machine',
        timestamp: rawResult.created_at,
        status: 'completed',
        components: parsedData.components.map((c: any) => ({
          name: c.component_name,
          value: c.value,
          unit: c.unit || '',
          flag: c.remark || 'N'
        }))
      };
      
      if (testRequestId) {
        try {
          const componentValues = this.mapResultsToComponents(mindrayResult.components);
          await this.saveComponentValues(testRequestId, componentValues);
        } catch (error) {
          console.error('Error saving CBC results:', error);
        }
      }
      return mindrayResult;
    } catch (error) {
      console.error('Error requesting CBC result from Holding Tank:', error);
      throw error;
    }
  }

  private mapResultsToComponents(mindrayComponents: Array<{name: string; value: string; unit: string; flag?: string}>): Record<string, {value: string; remark: string}> {
    const componentValues: Record<string, {value: string; remark: string}> = {};
    for (const component of mindrayComponents) {
      let remark = component.flag || 'Normal';
      if (remark === 'H') remark = 'High';
      if (remark === 'L') remark = 'Low';
      if (remark === 'N' || remark === '') remark = 'Normal';
      
      componentValues[component.name] = {
        value: component.value,
        remark: remark
      };
    }
    return componentValues;
  }

  async getConnectionStatus(): Promise<{connected: boolean; host: string; port: number}> {
    // The Agent architecture means the UI is always "connected" to the central API
    return { connected: true, host: 'Central API', port: 443 };
  }

  disconnect(): void {
    // No-op for API
  }

  async saveComponentValues(testRequestId: string, componentValues: Record<string, {value: string; remark: string}>): Promise<void> {
    try {
      const response = await authFetch(`/api/lab-requests/${testRequestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          componentValues: componentValues,
          lastUpdated: new Date().toISOString(),
          status: 'partial',
          mindrayImported: true,
          mindrayImportedAt: new Date().toISOString()
        }),
      });

      if (!response.ok) throw new Error('Failed to save component values');
    } catch (error) {
      console.error('Error saving component values:', error);
      throw error;
    }
  }

  async clearComponentValues(testRequestId: string): Promise<void> {
    try {
      const response = await authFetch(`/api/lab-requests/${testRequestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          componentValues: {},
          lastUpdated: new Date().toISOString(),
          status: 'pending',
          mindrayImported: false,
          mindrayImportedAt: null
        }),
      });

      if (!response.ok) throw new Error('Failed to clear component values');
    } catch (error) {
      console.error('Error clearing component values:', error);
      throw error;
    }
  }
}

