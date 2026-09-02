// Global lab auto-save service
class LabAutoSaveService {
  private static instance: LabAutoSaveService;
  private handleSavePartialResult: (() => Promise<void>) | null = null;

  private constructor() {}

  static getInstance(): LabAutoSaveService {
    if (!LabAutoSaveService.instance) {
      LabAutoSaveService.instance = new LabAutoSaveService();
    }
    return LabAutoSaveService.instance;
  }

  setHandleSavePartialResult(handler: () => Promise<void>) {
    console.log('🔧 LabAutoSaveService: Setting handleSavePartialResult handler');
    this.handleSavePartialResult = handler;
    
    // Also set it globally for backward compatibility
    (window as any).handleSavePartialResult = handler;
    (globalThis as any).handleSavePartialResult = handler;
  }

  async executeHandleSavePartialResult(): Promise<void> {
    console.log('🔧 LabAutoSaveService: Executing handleSavePartialResult');
    
    if (this.handleSavePartialResult) {
      console.log('🔧 LabAutoSaveService: Handler found, executing...');
      await this.handleSavePartialResult();
    } else {
      console.error('🔧 LabAutoSaveService: No handleSavePartialResult handler registered');
      throw new Error('handleSavePartialResult is not defined');
    }
  }

  clearHandler() {
    console.log('🔧 LabAutoSaveService: Clearing handleSavePartialResult handler');
    this.handleSavePartialResult = null;
    delete (window as any).handleSavePartialResult;
    delete (globalThis as any).handleSavePartialResult;
  }
}

// Create global instance
const labAutoSaveService = LabAutoSaveService.getInstance();

// Export for use in components
export { labAutoSaveService };

// Make service available globally
(window as any).labAutoSaveService = labAutoSaveService;
(globalThis as any).labAutoSaveService = labAutoSaveService;

// Global function that uses the service
(window as any).handleSavePartialResult = async () => {
  console.log('🔧 Global handleSavePartialResult called, delegating to service');
  await labAutoSaveService.executeHandleSavePartialResult();
};

(globalThis as any).handleSavePartialResult = async () => {
  console.log('🔧 Global handleSavePartialResult called, delegating to service');
  await labAutoSaveService.executeHandleSavePartialResult();
};
