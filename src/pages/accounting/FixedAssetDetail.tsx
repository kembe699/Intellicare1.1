import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader, LoadingState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, TrendingUp, Trash2, Building2 } from 'lucide-react';
import { Asset, ChartAccount, NATURE_BADGE, NATURE_LABEL, fmt } from './fixedAssetsShared';

export default function FixedAssetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPrivilege, user } = useAuth();
  const canWrite = hasPrivilege('assets.write');
  const canDispose = hasPrivilege('assets.dispose');
  const clinicId = Number(user?.clinic) || 1;

  const [asset, setAsset] = useState<Asset | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'view' | 'dispose' | 'revalue'>('view');
  const [proceeds, setProceeds] = useState('');
  const [disposalReason, setDisposalReason] = useState('');
  const [paymentAccountCode, setPaymentAccountCode] = useState('');
  const [newValue, setNewValue] = useState('');
  const [revalueReason, setRevalueReason] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchAsset = useCallback(async () => {
    setLoading(true);
    try {
      const [assetRes, acctRes] = await Promise.all([
        authFetch(`/api/fixed-assets/${id}`, { credentials: 'include' }),
        authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`, { credentials: 'include' }),
      ]);
      if (assetRes.ok) {
        const data = await assetRes.json();
        setAsset(data);
        setHistory(data.depreciationHistory || []);
      } else {
        toast.error('Asset not found');
      }
      if (acctRes.ok) setAccounts(await acctRes.json());
    } catch {
      toast.error('Failed to load asset');
    } finally {
      setLoading(false);
    }
  }, [id, clinicId]);

  useEffect(() => { fetchAsset(); }, [fetchAsset]);

  const handleDispose = async () => {
    if (!asset) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/fixed-assets/${asset.id}/dispose`, {
        method: 'POST',
        body: JSON.stringify({ proceeds: proceeds ? parseFloat(proceeds) : 0, reason: disposalReason, payment_account_code: proceeds ? paymentAccountCode : undefined }),
      });
      if (res.ok) { toast.success('Asset disposed'); setMode('view'); fetchAsset(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to dispose of asset'); }
    } catch { toast.error('Network error'); } finally { setSaving(false); }
  };

  const handleRevalue = async () => {
    if (!asset) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/fixed-assets/${asset.id}/revalue`, {
        method: 'POST',
        body: JSON.stringify({ new_value: parseFloat(newValue), reason: revalueReason }),
      });
      if (res.ok) { toast.success('Asset revalued'); setMode('view'); fetchAsset(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to revalue asset'); }
    } catch { toast.error('Network error'); } finally { setSaving(false); }
  };

  if (loading) return <LoadingState message="Loading asset..." />;
  if (!asset) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/accounting/fixed-assets/register')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Register
        </Button>
        <p className="text-sm text-muted-foreground">Asset not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/accounting/fixed-assets/register')}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Register
      </Button>
      <PageHeader title={`${asset.asset_code} — ${asset.name}`} icon={<Building2 />} subtitle="Asset detail" />

      {mode === 'view' && (
        <>
          <Card>
            <CardContent className="p-5 grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Category:</span> {asset.category_name}</div>
              <div><span className="text-muted-foreground">Nature:</span> <Badge variant={NATURE_BADGE[asset.nature]}>{NATURE_LABEL[asset.nature]}</Badge></div>
              <div><span className="text-muted-foreground">Location:</span> {asset.location || '—'}</div>
              <div><span className="text-muted-foreground">Assigned to:</span> {asset.assignee_first_name ? `${asset.assignee_first_name} ${asset.assignee_last_name}` : '—'}</div>
              <div>
                <span className="text-muted-foreground">Acquired:</span> {asset.acquisition_date} for {fmt(asset.acquisition_cost_original ?? asset.acquisition_cost)} {asset.acquisition_currency || ''}
              </div>
              {asset.acquisition_currency && asset.acquisition_exchange_rate && Number(asset.acquisition_exchange_rate) !== 1 && (
                <div><span className="text-muted-foreground">Base currency value:</span> {fmt(asset.acquisition_cost)} (rate {Number(asset.acquisition_exchange_rate).toFixed(4)})</div>
              )}
              <div><span className="text-muted-foreground">Accumulated depreciation:</span> {fmt(asset.accumulated_depreciation)}</div>
              <div className="font-semibold"><span className="text-muted-foreground font-normal">Current book value:</span> {fmt(asset.current_value)}</div>
              <div><span className="text-muted-foreground">Status:</span> <Badge variant={asset.status === 'active' ? 'success' : 'neutral'}>{asset.status}</Badge></div>
              <div><span className="text-muted-foreground">Registered by:</span> {asset.registered_by_name || '—'}</div>
              {asset.created_at && <div><span className="text-muted-foreground">Registered on:</span> {new Date(asset.created_at).toLocaleDateString()}</div>}
            </CardContent>
          </Card>

          {history.length > 0 && (
            <Card>
              <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm">Depreciation History</h4></div>
              <CardContent className="p-0">
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="border-b"><th className="text-left py-2 px-4">Period</th><th className="text-right py-2 px-4">Amount</th><th className="text-right py-2 px-4">Book Value After</th></tr></thead>
                  <tbody>
                    {history.map((h: any) => (
                      <tr key={h.id} className="border-b border-border/50">
                        <td className="py-2 px-4">{h.period}</td>
                        <td className="py-2 px-4 text-right">{fmt(h.depreciation_amount)}</td>
                        <td className="py-2 px-4 text-right">{fmt(h.book_value_after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {asset.status === 'active' && (canWrite || canDispose) && (
            <div className="flex gap-2">
              {canWrite && asset.nature !== 'depreciating' && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMode('revalue')}><TrendingUp className="h-3.5 w-3.5" /> Revalue</Button>
              )}
              {canDispose && (
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30" onClick={() => setMode('dispose')}><Trash2 className="h-3.5 w-3.5" /> Dispose</Button>
              )}
            </div>
          )}
        </>
      )}

      {mode === 'dispose' && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <p className="text-sm text-muted-foreground">Current book value: <strong>{fmt(asset.current_value)}</strong></p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Disposal Proceeds (0 if scrapped/written off)</label>
              <Input type="number" min="0" step="0.01" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
            </div>
            {proceeds && parseFloat(proceeds) > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Deposited to which account?</label>
                <Combobox
                  options={accounts.filter((a) => /cash|bank/i.test(a.account_name)).map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))}
                  value={paymentAccountCode} onChange={setPaymentAccountCode} placeholder="Select account..." searchPlaceholder="Search..."
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Reason</label>
              <Input value={disposalReason} onChange={(e) => setDisposalReason(e.target.value)} placeholder="e.g. Sold, scrapped, damaged beyond repair" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMode('view')}>Back</Button>
              <Button onClick={handleDispose} disabled={saving} className="bg-destructive hover:bg-destructive/90">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Confirm Disposal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === 'revalue' && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <p className="text-sm text-muted-foreground">Current value: <strong>{fmt(asset.current_value)}</strong></p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">New Value</label>
              <Input type="number" min="0" step="0.01" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Reason</label>
              <Input value={revalueReason} onChange={(e) => setRevalueReason(e.target.value)} placeholder="e.g. Independent market valuation" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMode('view')}>Back</Button>
              <Button onClick={handleRevalue} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Confirm Revaluation
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
