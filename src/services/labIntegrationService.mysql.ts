import { MindrayClient, MindrayResult } from './mindrayIntegration';

// Browser-safe lab request API client
class LabRequestApiClient {
  private get baseUrl() { return `${window.location.origin}/api/lab-requests`; }

  async findById(id: string): Promise<any | null> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('Error finding lab request:', error);
      return null;
    }
  }

  async update(id: string, data: any): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return response.ok;
    } catch (error) {
      console.error('Error updating lab request:', error);
      return false;
    }
  }
}

export class LabIntegrationService {
  private mindrayClient: MindrayClient;
  private labRequestRepo: LabRequestApiClient;

  constructor(mindrayHost: string = 'localhost', mindrayPort: number = 5100) {
    this.mindrayClient = new MindrayClient(mindrayHost, mindrayPort);
    this.labRequestRepo = new LabRequestApiClient();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.mindrayClient.on('connected', () => {
      console.log('Mindray analyzer connected');
    });

    this.mindrayClient.on('error', (error) => {
      console.error('Mindray analyzer error:', error);
    });

    this.mindrayClient.on('result', (result: MindrayResult) => {
      console.log('Received result from Mindray:', result);
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.mindrayClient.connect();
      console.log('Lab integration service initialized');
    } catch (error) {
      console.error('Failed to initialize lab integration:', error);
      throw error;
    }
  }

  async requestCBCResult(sampleId: string, testRequestId?: string): Promise<MindrayResult | null> {
    try {
      console.log(`Requesting CBC result for sample ID: ${sampleId}, testRequestId: ${testRequestId}`);
      
      // Only fetch real data from BC-10 device - no mock/random generation
      console.log(`Fetching real CBC data from BC-10 at ${this.mindrayClient.getConnectionStatus().host}:${this.mindrayClient.getConnectionStatus().port}`);
      let result: MindrayResult | null = null;
      
      try {
        // Only use real connection - no fallback to mock data
        result = await this.mindrayClient.requestResult(sampleId);
        if (!result) {
          throw new Error('No data received from BC-10 device');
        }
      } catch (error) {
        console.error('Failed to fetch real data from BC-10:', error);
        throw new Error(`Cannot retrieve sample ${sampleId} from BC-10 device: ${error.message}`);
      }
      
      if (result && result.testCode === 'CBC') {
        if (testRequestId) {
          try {
            // Save component values directly instead of updating the lab request
            const componentValues = this.mapResultsToComponents(result.components);
            await this.saveComponentValues(testRequestId, componentValues);
            console.log('CBC results saved successfully');
          } catch (error) {
            console.error('Error saving CBC results:', error);
            // Don't throw here, still return the result for UI display
          }
        }
        return result;
      }
      
      return null;
    } catch (error) {
      console.error('Error requesting CBC result:', error);
      throw error;
    }
  }

  private async updateTestRequestWithResults(testRequestId: string, result: MindrayResult): Promise<void> {
    try {
      // Get the lab request using repository
      const labRequest = await this.labRequestRepo.findById(testRequestId);
      
      if (!labRequest) {
        throw new Error('Test request not found');
      }

      // Update component values with Mindray results
      const updatedComponents = this.mapResultsToComponents(result.components);
      
      // Update the test request with results using repository
      await this.labRequestRepo.update(testRequestId, {
        status: 'completed',
        completed_at: new Date(),
        results: JSON.stringify({
          components: updatedComponents,
          analyzedBy: 'Mindray Analyzer',
          analyzedAt: result.timestamp,
          sampleId: result.sampleId
        })
      });

      console.log(`Test request ${testRequestId} updated with Mindray results`);
    } catch (error) {
      console.error('Error updating test request:', error);
      throw error;
    }
  }

  private mapResultsToComponents(mindrayComponents: Array<{name: string; value: string; unit: string; flag?: string}>): Record<string, {value: string; remark: string}> {
    const componentValues: Record<string, {value: string; remark: string}> = {};
    
    for (const component of mindrayComponents) {
      // Determine remark based on flag
      let remark = '';
      if (component.flag) {
        switch (component.flag.toUpperCase()) {
          case 'H':
            remark = 'High';
            break;
          case 'L':
            remark = 'Low';
            break;
          case 'N':
          case '':
            remark = 'Normal';
            break;
          default:
            remark = component.flag;
        }
      }
      
      componentValues[component.name] = {
        value: component.value,
        remark: remark
      };
    }
    
    return componentValues;
  }

  async getConnectionStatus(): Promise<{connected: boolean; host: string; port: number}> {
    return this.mindrayClient.getConnectionStatus();
  }

  disconnect(): void {
    this.mindrayClient.disconnect();
  }

  // Method to save component values using repository
  async saveComponentValues(testRequestId: string, componentValues: Record<string, {value: string; remark: string}>): Promise<void> {
    try {
      // Update lab request using repository
      await this.labRequestRepo.update(testRequestId, {
        component_values: JSON.stringify(componentValues),
        last_saved_at: new Date(),
        status: 'partial', // Update status to indicate results are being entered
        mindray_imported: true, // Flag to indicate values came from Mindray
        mindray_imported_at: new Date()
      });

      console.log(`Component values overwritten for lab request ${testRequestId}`);
    } catch (error) {
      console.error('Error saving component values:', error);
      throw error;
    }
  }

  // Method to clear component values from database
  async clearComponentValues(testRequestId: string): Promise<void> {
    try {
      // Update lab request using repository
      await this.labRequestRepo.update(testRequestId, {
        component_values: '{}',
        last_saved_at: new Date(),
        status: 'pending', // Reset status
        mindray_imported: false,
        mindray_imported_at: null
      });

      console.log(`Component values cleared for lab request ${testRequestId}`);
    } catch (error) {
      console.error('Error clearing component values:', error);
      throw error;
    }
  }

  // Method to get saved component values
  async getSavedComponentValues(testRequestId: string): Promise<Record<string, {value: string; remark: string}>> {
    try {
      // Get lab request using repository
      const labRequest = await this.labRequestRepo.findById(testRequestId);
      
      if (labRequest) {
        const componentValues = labRequest.get('component_values');
        // Parse component values if they exist
        if (componentValues && typeof componentValues === 'string') {
          try {
            return JSON.parse(componentValues);
          } catch (e) {
            console.error('Error parsing component values', e);
          }
        }
      }
      
      return {};
    } catch (error) {
      console.error('Error getting saved component values:', error);
      return {};
    }
  }
}
