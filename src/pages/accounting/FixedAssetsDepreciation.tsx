import React, { useCallback, useEffect, useState } from 'react';
import { LoadingState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { Loader2, TrendingDown } from 'lucide-react';
import { fmt } from './fixedAssetsShared';

export default function FixedAssetsDepreciation() {
  const { hasPrivilege, user } = useAuth();
  const canWrite = hasPrivilege('assets.write');
  const clinicId = Number(user?.clinic) || 1;

  const defaultPeriod = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();
  const [period, setPeriod] = useState(defaultPeriod);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/fixed-assets/depreciation/history?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setHistory(await res.json());
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await authFetch('/api/fixed-assets/depreciation/run', { method: 'POST', body: JSON.stringify({ period }) });
      if (res.ok) {
        const result = await res.json();
        if (result.assetsDepreciated === 0) toast.info('No assets were due for depreciation this period');
        else toast.success(`Depreciated ${result.assetsDepreciated} asset(s), total ${fmt(result.totalDepreciation)}`);
        fetchHistory();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to run depreciation');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Period</label>
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" />
            </div>
            <Button onClick={handleRun} disabled={running} className="gap-1.5">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingDown className="h-3.5 w-3.5" />} Run Depreciation
            </Button>
            <p className="text-xs text-muted-foreground ml-2">Straight-line, posts one consolidated ledger entry. Safe to re-run — already-depreciated assets for this period are skipped.</p>
          </CardContent>
        </Card>
      )}

      {loading ? <LoadingState message="Loading depreciation history..." /> : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm border-collapse">
              <thead><tr className="border-b bg-muted/30"><th className="text-left py-2.5 px-4">Period</th><th className="text-right py-2.5 px-4">Assets</th><th className="text-right py-2.5 px-4">Total Depreciation</th><th className="text-left py-2.5 px-4">Posted</th></tr></thead>
              <tbody>
                {history.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No depreciation runs yet.</td></tr>
                ) : history.map((h: any) => (
                  <tr key={`${h.period}-${h.gl_entry_id}`} className="border-b border-border/50">
                    <td className="py-2 px-4">{h.period}</td>
                    <td className="py-2 px-4 text-right">{h.asset_count}</td>
                    <td className="py-2 px-4 text-right">{fmt(h.total_depreciation)}</td>
                    <td className="py-2 px-4">{new Date(h.posted_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
