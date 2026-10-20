import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader, LoadingState, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  ArrowLeft, Loader2, TrendingUp, Trash2, Building2, MapPin, User, CalendarDays,
  Wallet, TrendingDown, Layers, UserCircle2,
} from 'lucide-react';
import { Asset, ChartAccount, NATURE_BADGE, NATURE_LABEL, fmt } from './fixedAssetsShared';

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  active: 'success',
  under_maintenance: 'warning',
  disposed: 'danger',
  written_off: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Active', under_maintenance: 'Under Maintenance', disposed: 'Disposed', written_off: 'Written Off',
};

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

  const hasFxNote = asset.acquisition_currency && asset.acquisition_exchange_rate && Number(asset.acquisition_exchange_rate) !== 1;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Building2 />}
        title={asset.name}
        subtitle={asset.asset_code}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/accounting/fixed-assets/register')}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            {mode === 'view' && asset.status === 'active' && canWrite && asset.nature !== 'depreciating' && (
              <Button variant="outline" size="sm" onClick={() => setMode('revalue')}><TrendingUp className="h-4 w-4 mr-2" /> Revalue</Button>
            )}
            {mode === 'view' && asset.status === 'active' && canDispose && (
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setMode('dispose')}>
                <Trash2 className="h-4 w-4 mr-2" /> Dispose
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
        {/* LEFT: identity card */}
        <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight truncate">{asset.name}</h2>
              <p className="text-sm text-muted-foreground font-mono">{asset.asset_code}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={asset.status} label={STATUS_LABEL[asset.status] || asset.status} map={STATUS_TONE} />
            <Badge variant={NATURE_BADGE[asset.nature]}>{NATURE_LABEL[asset.nature]}</Badge>
          </div>

          <div className="space-y-2.5 text-sm border-t pt-4">
            <div className="flex items-center gap-2"><Layers className="w-4 h-4 text-muted-foreground shrink-0" />{asset.category_name}</div>
            <div className="flex items-start gap-2"><MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />{asset.location || 'No location on file'}</div>
            <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground shrink-0" />{asset.assignee_first_name ? `${asset.assignee_first_name} ${asset.assignee_last_name}` : 'Not assigned'}</div>
          </div>

          <div className="space-y-2 border-t pt-4 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Acquired</span><span>{asset.acquisition_date}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Serial No.</span><span>{asset.serial_number || '—'}</span></div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5"><UserCircle2 className="w-3.5 h-3.5" /> Registered by</span>
              <span>{asset.registered_by_name || '—'}</span>
            </div>
            {asset.created_at && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Registered on</span>
                <span>{new Date(asset.created_at).toLocaleDateString()}</span>
              </div>
            )}
          </div>

          {asset.description && (
            <div className="border-t pt-4 text-sm">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
              <p className="text-muted-foreground">{asset.description}</p>
            </div>
          )}
        </div>

        {/* RIGHT: financials + history/actions */}
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-card rounded-lg border shadow-sm p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Wallet className="w-4 h-4 text-primary" /></div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Acquisition Cost</p>
                <p className="text-lg font-bold font-mono leading-tight truncate">{fmt(asset.acquisition_cost_original ?? asset.acquisition_cost)} {asset.acquisition_currency || ''}</p>
                {hasFxNote && <p className="text-xs text-muted-foreground mt-0.5">= {fmt(asset.acquisition_cost)} base (rate {Number(asset.acquisition_exchange_rate).toFixed(4)})</p>}
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><TrendingDown className="w-4 h-4 text-amber-600" /></div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Accumulated Depreciation</p>
                <p className="text-lg font-bold font-mono leading-tight">{fmt(asset.accumulated_depreciation)}</p>
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4 text-emerald-600" /></div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Current Book Value</p>
                <p className="text-lg font-bold font-mono leading-tight">{fmt(asset.current_value)}</p>
              </div>
            </div>
          </div>

          {mode === 'view' && (
            <Card>
              <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm">Depreciation History</h4></div>
              <CardContent className="p-0">
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No depreciation has been posted for this asset yet.</p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead><tr className="border-b bg-muted/20"><th className="text-left py-2 px-4">Period</th><th className="text-right py-2 px-4">Amount</th><th className="text-right py-2 px-4">Book Value After</th></tr></thead>
                    <tbody>
                      {history.map((h: any) => (
                        <tr key={h.id} className="border-b border-border/50">
                          <td className="py-2 px-4">{h.period}</td>
                          <td className="py-2 px-4 text-right font-mono">{fmt(h.depreciation_amount)}</td>
                          <td className="py-2 px-4 text-right font-mono">{fmt(h.book_value_after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}

          {mode === 'dispose' && (
            <Card>
              <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm">Dispose of Asset</h4></div>
              <CardContent className="p-5 space-y-3">
                <p className="text-sm text-muted-foreground">Current book value: <strong className="font-mono">{fmt(asset.current_value)}</strong></p>
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
                  <Button variant="outline" onClick={() => setMode('view')}>Cancel</Button>
                  <Button onClick={handleDispose} disabled={saving} className="bg-destructive hover:bg-destructive/90">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Confirm Disposal
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {mode === 'revalue' && (
            <Card>
              <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm">Revalue Asset</h4></div>
              <CardContent className="p-5 space-y-3">
                <p className="text-sm text-muted-foreground">Current value: <strong className="font-mono">{fmt(asset.current_value)}</strong></p>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">New Value</label>
                  <Input type="number" min="0" step="0.01" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Reason</label>
                  <Input value={revalueReason} onChange={(e) => setRevalueReason(e.target.value)} placeholder="e.g. Independent market valuation" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setMode('view')}>Cancel</Button>
                  <Button onClick={handleRevalue} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Confirm Revaluation
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
