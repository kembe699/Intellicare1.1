import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Activity, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { LabIntegrationService, MindrayResult } from '@/services/labIntegrationService';

interface MindrayIntegrationProps {
  testRequestId?: string;
  onResultReceived?: (sampleId: string, results: MindrayResult) => void;
}

export const MindrayIntegration: React.FC<MindrayIntegrationProps> = ({ 
  testRequestId,
  onResultReceived 
}) => {
  const [integrationService] = useState(new LabIntegrationService());
  const [sampleId, setSampleId] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [lastResult, setLastResult] = useState<MindrayResult | null>(null);

  const handleRequestResult = async () => {
    if (!sampleId.trim()) {
      toast.error('Please enter a sample ID');
      return;
    }

    setIsRequesting(true);
    try {
      const result = await integrationService.requestCBCResult(sampleId, testRequestId);
      
      if (result) {
        setLastResult(result);
        toast.success(`Results fetched from holding tank for sample ${sampleId}`);
        
        if (onResultReceived) {
          onResultReceived(sampleId, result);
        }
        
        setSampleId('');
      } else {
        toast.error('No results found for this sample ID in the holding tank. Ensure the machine has sent the data.');
      }
    } catch (error: any) {
      console.error('Error requesting result:', error);
      toast.error(error.message || 'Failed to fetch result from holding tank');
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <div className="ic-card">
      <div className="ic-card-header flex justify-between items-center py-2">
        <span className="font-semibold text-[13px] text-foreground flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Fetch from Machine
        </span>
        <div className="flex gap-1.5 items-center">
            <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Sample ID</label>
            <Input
              value={sampleId}
              onChange={(e) => setSampleId(e.target.value)}
              placeholder="e.g. 1234"
              onKeyPress={(e) => e.key === 'Enter' && handleRequestResult()}
              disabled={isRequesting}
              className="h-7 w-24 text-xs font-mono border-slate-200"
            />
            <Button 
              onClick={handleRequestResult}
              disabled={isRequesting}
              className="h-7 text-xs text-primary-foreground bg-primary hover:bg-primary/90 font-semibold px-3 rounded-lg shadow-sm"
            >
              {isRequesting ? (
                <div className="flex items-center gap-1.5"><Activity className="w-3 h-3 animate-pulse" /> Fetching...</div>
              ) : (
                <div className="flex items-center gap-1.5"><Download className="w-3 h-3" /> Fetch</div>
              )}
            </Button>
        </div>
      </div>

      {lastResult && (
        <div className="ic-card-body">
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-green-800 mb-1">
                Success: Sample {lastResult.sampleId} Fetched
              </div>
              <div className="text-xs text-green-700">
                {lastResult.components.length} parameters loaded into the form below. Please review and click 'Submit Lab Report' to officially save them.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
