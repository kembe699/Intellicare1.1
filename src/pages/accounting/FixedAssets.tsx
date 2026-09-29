import React, { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  Building2, Plus, TrendingDown, TrendingUp, FileBarChart, Settings,
  Loader2, ChevronsUpDown, Trash2, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────

interface Category {
  id: string; name: string; nature: 'depreciating' | 'appreciating' | 'non_depreciating';
  default_depreciation_method: string; default_useful_life_years: number | null; default_salvage_percent: string;
  asset_account_id: string; accumulated_depreciation_account_id: string | null; depreciation_expense_account_id: string | null;
  asset_account_name?: string; accumulated_depreciation_account_name?: string; depreciation_expense_account_name?: string;
  is_active: boolean;
}

interface Asset {
  id: string; asset_code: string; name: string; category_id: string; category_name: string; category_nature: string;
  description: string | null; serial_number: string | null; location: string | null; branch_id: number | null;
  assigned_to_employee_id: string | null; assignee_first_name?: string; assignee_last_name?: string;
  nature: string; acquisition_date: string; acquisition_cost: string; salvage_value: string; useful_life_years: number | null;
  accumulated_depreciation: string; current_value: string; status: string;
  disposal_date?: string | null; disposal_proceeds?: string | null; disposal_reason?: string | null;
}

interface ChartAccount { id: string; account_code: string; account_name: string; account_type: string; }
interface Employee { id: string; first_name: string; last_name: string; employee_number: string; }

const NATURE_LABEL: Record<string, string> = { depreciating: 'Depreciating', appreciating: 'Appreciating', non_depreciating: 'Non-depreciating' };
const NATURE_BADGE: Record<string, 'warning' | 'success' | 'neutral'> = { depreciating: 'warning', appreciating: 'success', non_depreciating: 'neutral' };
const fmt = (v: string | number) => `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FixedAssets() {
  const { user, hasPrivilege } = useAuth();
  const clinicId = Number(user?.clinic) || 1;
  const canWrite = hasPrivilege('assets.write');
  const canDispose = hasPrivilege('assets.dispose');

  const [categories, setCategories] = useState<Category[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('active');
  const [searchTerm, setSearchTerm] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, assetRes, acctRes] = await Promise.all([
        authFetch('/api/fixed-assets/categories', { credentials: 'include' }),
        authFetch(`/api/fixed-assets?status=${statusFilter}${searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : ''}`, { credentials: 'include' }),
        authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`, { credentials: 'include' }),
      ]);
      if (catRes.ok) setCategories(await catRes.json());
      if (assetRes.ok) setAssets(await assetRes.json());
      if (acctRes.ok) setAccounts(await acctRes.json());
      authFetch('/api/hr/employees', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : []))
        .then(setEmployees)
        .catch(() => setEmployees([]));
    } catch {
      toast.error('Failed to load fixed assets');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchTerm, clinicId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const columns: Column<Asset>[] = [
    { key: 'asset_code', header: 'Code', sortable: true, width: '120px' },
    { key: 'name', header: 'Name', sortable: true, filterable: true },
    { key: 'category_name', header: 'Category', sortable: true },
    {
      key: 'nature', header: 'Nature', width: '130px',
      render: (v) => <Badge variant={NATURE_BADGE[v] || 'neutral'}>{NATURE_LABEL[v] || v}</Badge>,
    },
    { key: 'location', header: 'Location', render: (v) => v || '—' },
    {
      key: 'assignee_first_name', header: 'Assigned To',
      render: (_v, row) => (row.assignee_first_name ? `${row.assignee_first_name} ${row.assignee_last_name || ''}` : '—'),
    },
    { key: 'acquisition_cost', header: 'Cost', align: 'right', render: (v) => fmt(v) },
    { key: 'current_value', header: 'Book Value', align: 'right', render: (v) => fmt(v) },
    {
      key: 'status', header: 'Status', width: '110px',
      render: (v) => <Badge variant={v === 'active' ? 'success' : v === 'disposed' ? 'danger' : 'neutral'}>{v}</Badge>,
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PageHeader title="Fixed Assets" icon={<Building2 />} subtitle="Asset register, depreciation and reports" />
          <div className="flex items-center gap-2">
            {canWrite && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCategoryDialogOpen(true)}>
                <Settings className="h-3.5 w-3.5" /> Categories
              </Button>
            )}
            {canWrite && (
              <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Asset
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="register">
          <TabsList>
            <TabsTrigger value="register">Register</TabsTrigger>
            <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="register" className="space-y-4 mt-4">
            <Card>
              <CardContent className="p-4 flex flex-wrap items-end gap-3">
                <div className="min-w-[160px]">
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                  <Combobox
                    options={[{ value: 'active', label: 'Active' }, { value: 'under_maintenance', label: 'Under maintenance' }, { value: 'disposed', label: 'Disposed' }, { value: 'written_off', label: 'Written off' }, { value: '', label: 'All' }]}
                    value={statusFilter}
                    onChange={setStatusFilter}
                    searchPlaceholder="Search status..."
                    className="h-9"
                  />
                </div>
                <div className="min-w-[220px] flex-1">
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Search</label>
                  <Input placeholder="Name, code, serial, location..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-9" />
                </div>
              </CardContent>
            </Card>

            {loading ? <LoadingState message="Loading assets..." /> : (
              <AdvancedDataTable
                data={assets}
                columns={columns}
                onRowClick={(row) => setDetailAsset(row)}
                emptyMessage="No assets recorded yet."
                pagination={{ enabled: true, pageSize: 25 }}
                keyExtractor={(r) => r.id}
                exportable
                exportFileName="fixed-assets-register"
              />
            )}
          </TabsContent>

          <TabsContent value="depreciation" className="mt-4">
            <DepreciationTab canWrite={canWrite} clinicId={clinicId} onRan={fetchAll} />
          </TabsContent>

          <TabsContent value="reports" className="mt-4">
            <ReportsTab clinicId={clinicId} />
          </TabsContent>
        </Tabs>
      </div>

      {addOpen && (
        <AddAssetDialog
          categories={categories}
          accounts={accounts}
          employees={employees}
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); fetchAll(); }}
        />
      )}

      {detailAsset && (
        <AssetDetailDialog
          asset={detailAsset}
          accounts={accounts}
          canDispose={canDispose}
          canWrite={canWrite}
          onClose={() => setDetailAsset(null)}
          onChanged={() => { setDetailAsset(null); fetchAll(); }}
        />
      )}

      {categoryDialogOpen && (
        <CategoriesDialog
          categories={categories}
          accounts={accounts}
          onClose={() => setCategoryDialogOpen(false)}
          onChanged={fetchAll}
        />
      )}
    </AppLayout>
  );
}

// ── Add Asset ───────────────────────────────────────────────────────────

function AddAssetDialog({ categories, accounts, employees, onClose, onCreated }: {
  categories: Category[]; accounts: ChartAccount[]; employees: Employee[]; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [location, setLocation] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [acquisitionDate, setAcquisitionDate] = useState(new Date().toISOString().split('T')[0]);
  const [cost, setCost] = useState('');
  const [salvageValue, setSalvageValue] = useState('');
  const [usefulLife, setUsefulLife] = useState('');
  const [postToGl, setPostToGl] = useState(true);
  const [paymentAccountCode, setPaymentAccountCode] = useState('');
  const [saving, setSaving] = useState(false);

  const category = categories.find((c) => c.id === categoryId);
  const isDepreciating = category?.nature === 'depreciating';

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!categoryId) { toast.error('Pick a category'); return; }
    if (!cost || parseFloat(cost) <= 0) { toast.error('Acquisition cost must be a positive number'); return; }
    if (isDepreciating && (!usefulLife || parseInt(usefulLife, 10) <= 0)) { toast.error('Useful life (years) is required for a depreciating category'); return; }
    if (postToGl && !paymentAccountCode) { toast.error('Pick which account funded this purchase, or turn off "Post to ledger"'); return; }

    setSaving(true);
    try {
      const res = await authFetch('/api/fixed-assets', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(), category_id: categoryId, description: description || null, serial_number: serialNumber || null,
          location: location || null, assigned_to_employee_id: assignedTo || null, acquisition_date: acquisitionDate,
          acquisition_cost: parseFloat(cost), salvage_value: salvageValue ? parseFloat(salvageValue) : undefined,
          useful_life_years: usefulLife ? parseInt(usefulLife, 10) : undefined,
          payment_account_code: postToGl ? paymentAccountCode : undefined,
        }),
      });
      if (res.ok) {
        toast.success('Asset registered');
        onCreated();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to register asset');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const cashAccounts = accounts.filter((a) => ['1000', '1100'].includes(a.account_code) || /cash|bank/i.test(a.account_name));
  const payableAccounts = accounts.filter((a) => a.account_type === 'liability' && /payable/i.test(a.account_name));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Register a Fixed Asset</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ultrasound Machine - GE Voluson" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
            <Combobox
              options={categories.map((c) => ({ value: c.id, label: `${c.name} (${NATURE_LABEL[c.nature]})` }))}
              value={categoryId} onChange={setCategoryId} placeholder="Select category..." searchPlaceholder="Search categories..."
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Serial Number</label>
            <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Location</label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Ward 3 Store" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Assigned To (optional)</label>
            <Combobox
              options={[{ value: '', label: 'Not assigned' }, ...employees.map((e) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` }))]}
              value={assignedTo} onChange={setAssignedTo} placeholder="Not assigned" searchPlaceholder="Search employees..."
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Acquisition Date</label>
            <Input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Acquisition Cost</label>
            <Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          {isDepreciating && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Useful Life (years)</label>
                <Input type="number" min="1" value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} placeholder={category?.default_useful_life_years ? String(category.default_useful_life_years) : ''} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Salvage Value (optional)</label>
                <Input type="number" min="0" step="0.01" value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} />
              </div>
            </>
          )}
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Notes / Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="col-span-2 border-t pt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
              <input type="checkbox" checked={postToGl} onChange={(e) => setPostToGl(e.target.checked)} className="rounded border-input" />
              Post this acquisition to the General Ledger now
            </label>
            {postToGl && (
              <Combobox
                options={[...cashAccounts, ...payableAccounts].map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))}
                value={paymentAccountCode} onChange={setPaymentAccountCode} placeholder="Paid from / owed to which account?" searchPlaceholder="Search accounts..."
              />
            )}
            {!postToGl && <p className="text-xs text-muted-foreground">Use this for assets the facility already owned before this module existed — nothing to post twice for.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Register Asset</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Asset Detail (dispose / revalue) ─────────────────────────────────────

function AssetDetailDialog({ asset, accounts, canDispose, canWrite, onClose, onChanged }: {
  asset: Asset; accounts: ChartAccount[]; canDispose: boolean; canWrite: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [history, setHistory] = useState<any[]>([]);
  const [mode, setMode] = useState<'view' | 'dispose' | 'revalue'>('view');
  const [proceeds, setProceeds] = useState('');
  const [disposalReason, setDisposalReason] = useState('');
  const [paymentAccountCode, setPaymentAccountCode] = useState('');
  const [newValue, setNewValue] = useState('');
  const [revalueReason, setRevalueReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    authFetch(`/api/fixed-assets/${asset.id}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHistory(d.depreciationHistory || []))
      .catch(() => {});
  }, [asset.id]);

  const handleDispose = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/fixed-assets/${asset.id}/dispose`, {
        method: 'POST',
        body: JSON.stringify({ proceeds: proceeds ? parseFloat(proceeds) : 0, reason: disposalReason, payment_account_code: proceeds ? paymentAccountCode : undefined }),
      });
      if (res.ok) { toast.success('Asset disposed'); onChanged(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to dispose of asset'); }
    } catch { toast.error('Network error'); } finally { setSaving(false); }
  };

  const handleRevalue = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/fixed-assets/${asset.id}/revalue`, {
        method: 'POST',
        body: JSON.stringify({ new_value: parseFloat(newValue), reason: revalueReason }),
      });
      if (res.ok) { toast.success('Asset revalued'); onChanged(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to revalue asset'); }
    } catch { toast.error('Network error'); } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{asset.asset_code} — {asset.name}</DialogTitle></DialogHeader>

        {mode === 'view' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Category:</span> {asset.category_name}</div>
              <div><span className="text-muted-foreground">Nature:</span> <Badge variant={NATURE_BADGE[asset.nature]}>{NATURE_LABEL[asset.nature]}</Badge></div>
              <div><span className="text-muted-foreground">Location:</span> {asset.location || '—'}</div>
              <div><span className="text-muted-foreground">Assigned to:</span> {asset.assignee_first_name ? `${asset.assignee_first_name} ${asset.assignee_last_name}` : '—'}</div>
              <div><span className="text-muted-foreground">Acquired:</span> {asset.acquisition_date} for {fmt(asset.acquisition_cost)}</div>
              <div><span className="text-muted-foreground">Accumulated depreciation:</span> {fmt(asset.accumulated_depreciation)}</div>
              <div className="font-semibold"><span className="text-muted-foreground font-normal">Current book value:</span> {fmt(asset.current_value)}</div>
              <div><span className="text-muted-foreground">Status:</span> <Badge variant={asset.status === 'active' ? 'success' : 'neutral'}>{asset.status}</Badge></div>
            </div>

            {history.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Depreciation History</p>
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="border-b"><th className="text-left py-1.5">Period</th><th className="text-right py-1.5">Amount</th><th className="text-right py-1.5">Book Value After</th></tr></thead>
                  <tbody>
                    {history.map((h: any) => (
                      <tr key={h.id} className="border-b border-border/50">
                        <td className="py-1.5">{h.period}</td>
                        <td className="py-1.5 text-right">{fmt(h.depreciation_amount)}</td>
                        <td className="py-1.5 text-right">{fmt(h.book_value_after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {asset.status === 'active' && (canWrite || canDispose) && (
              <div className="flex gap-2 border-t pt-3">
                {canWrite && asset.nature !== 'depreciating' && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMode('revalue')}><TrendingUp className="h-3.5 w-3.5" /> Revalue</Button>
                )}
                {canDispose && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30" onClick={() => setMode('dispose')}><Trash2 className="h-3.5 w-3.5" /> Dispose</Button>
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'dispose' && (
          <div className="space-y-3">
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
          </div>
        )}

        {mode === 'revalue' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Current value: <strong>{fmt(asset.current_value)}</strong></p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">New Value</label>
              <Input type="number" min="0" step="0.01" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Reason</label>
              <Input value={revalueReason} onChange={(e) => setRevalueReason(e.target.value)} placeholder="e.g. Independent market valuation" />
            </div>
          </div>
        )}

        <DialogFooter>
          {mode === 'view' ? (
            <Button variant="outline" onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode('view')}>Back</Button>
              <Button onClick={mode === 'dispose' ? handleDispose : handleRevalue} disabled={saving} className={mode === 'dispose' ? 'bg-destructive hover:bg-destructive/90' : ''}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                {mode === 'dispose' ? 'Confirm Disposal' : 'Confirm Revaluation'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Depreciation tab ──────────────────────────────────────────────────────

function DepreciationTab({ canWrite, clinicId, onRan }: { canWrite: boolean; clinicId: number; onRan: () => void }) {
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
        onRan();
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

// ── Reports tab ───────────────────────────────────────────────────────────

function ReportsTab({ clinicId }: { clinicId: number }) {
  const [nbv, setNbv] = useState<any>(null);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      authFetch(`/api/fixed-assets/reports/net-book-value?clinic_id=${clinicId}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
      authFetch(`/api/fixed-assets/reports/depreciation-schedule?clinic_id=${clinicId}&months=6`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
    ]).then(([nbvData, scheduleData]) => { setNbv(nbvData); setSchedule(scheduleData || []); }).finally(() => setLoading(false));
  }, [clinicId]);

  if (loading) return <LoadingState message="Building reports..." />;

  const scheduleByPeriod: Record<string, number> = {};
  for (const row of schedule) scheduleByPeriod[row.period] = (scheduleByPeriod[row.period] || 0) + row.amount;

  return (
    <div className="space-y-5">
      <Card>
        <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2"><Wallet className="h-4 w-4" /><h4 className="font-semibold text-sm">Net Book Value by Category</h4></div>
        <CardContent className="p-0">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="border-b bg-muted/30"><th className="text-left py-2.5 px-4">Category</th><th className="text-left py-2.5 px-4">Nature</th><th className="text-right py-2.5 px-4">Assets</th><th className="text-right py-2.5 px-4">Cost</th><th className="text-right py-2.5 px-4">Accum. Depreciation</th><th className="text-right py-2.5 px-4">Book Value</th></tr></thead>
            <tbody>
              {(nbv?.byCategory || []).map((row: any) => (
                <tr key={row.category_name} className="border-b border-border/50">
                  <td className="py-2 px-4">{row.category_name}</td>
                  <td className="py-2 px-4"><Badge variant={NATURE_BADGE[row.nature]}>{NATURE_LABEL[row.nature]}</Badge></td>
                  <td className="py-2 px-4 text-right">{row.asset_count}</td>
                  <td className="py-2 px-4 text-right">{fmt(row.total_cost)}</td>
                  <td className="py-2 px-4 text-right">{fmt(row.total_accumulated_depreciation)}</td>
                  <td className="py-2 px-4 text-right font-medium">{fmt(row.total_book_value)}</td>
                </tr>
              ))}
              {nbv?.overall && (
                <tr className="font-semibold border-t-2 border-foreground/20">
                  <td className="py-2 px-4" colSpan={2}>Total</td>
                  <td className="py-2 px-4 text-right">{nbv.overall.asset_count}</td>
                  <td className="py-2 px-4 text-right">{fmt(nbv.overall.total_cost)}</td>
                  <td className="py-2 px-4 text-right">{fmt(nbv.overall.total_accumulated_depreciation)}</td>
                  <td className="py-2 px-4 text-right">{fmt(nbv.overall.total_book_value)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2"><FileBarChart className="h-4 w-4" /><h4 className="font-semibold text-sm">Projected Depreciation (next 6 months)</h4></div>
        <CardContent className="p-5 grid grid-cols-3 sm:grid-cols-6 gap-4">
          {Object.entries(scheduleByPeriod).map(([period, amount]) => (
            <div key={period}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{period}</p>
              <p className="text-lg font-semibold">{fmt(amount)}</p>
            </div>
          ))}
          {Object.keys(scheduleByPeriod).length === 0 && <p className="text-sm text-muted-foreground col-span-full">No depreciating assets due — nothing projected.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Categories dialog ─────────────────────────────────────────────────────

function CategoriesDialog({ categories, accounts, onClose, onChanged }: {
  categories: Category[]; accounts: ChartAccount[]; onClose: () => void; onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [nature, setNature] = useState<'depreciating' | 'appreciating' | 'non_depreciating'>('depreciating');
  const [usefulLife, setUsefulLife] = useState('');
  const [salvagePercent, setSalvagePercent] = useState('0');
  const [assetAccountCode, setAssetAccountCode] = useState('');
  const [accumAccountCode, setAccumAccountCode] = useState('');
  const [expenseAccountCode, setExpenseAccountCode] = useState('');
  const [saving, setSaving] = useState(false);

  const assetAccounts = accounts.filter((a) => a.account_type === 'asset');
  const expenseAccounts = accounts.filter((a) => a.account_type === 'expense');

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const assetAccount = accounts.find((a) => a.account_code === assetAccountCode);
    const accumAccount = accounts.find((a) => a.account_code === accumAccountCode);
    const expenseAccount = accounts.find((a) => a.account_code === expenseAccountCode);
    if (!assetAccount) { toast.error('Select the asset GL account'); return; }
    if (nature === 'depreciating' && (!accumAccount || !expenseAccount)) { toast.error('A depreciating category needs both an accumulated-depreciation and a depreciation-expense account'); return; }

    setSaving(true);
    try {
      const res = await authFetch('/api/fixed-assets/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(), nature, default_useful_life_years: usefulLife ? parseInt(usefulLife, 10) : null,
          default_salvage_percent: parseFloat(salvagePercent) || 0, asset_account_id: assetAccount.id,
          accumulated_depreciation_account_id: accumAccount?.id, depreciation_expense_account_id: expenseAccount?.id,
        }),
      });
      if (res.ok) {
        toast.success('Category created');
        setCreating(false); setName(''); setUsefulLife(''); setAssetAccountCode(''); setAccumAccountCode(''); setExpenseAccountCode('');
        onChanged();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to create category');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Asset Categories</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{NATURE_LABEL[c.nature]}{c.default_useful_life_years ? ` · ${c.default_useful_life_years}y` : ''}</span>
              </div>
              <span className="text-xs text-muted-foreground">{c.asset_account_name}</span>
            </div>
          ))}
        </div>

        {!creating ? (
          <Button variant="outline" size="sm" className="gap-1.5 w-fit" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> New Category</Button>
        ) : (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vehicles" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Nature</label>
                <Combobox
                  options={[{ value: 'depreciating', label: 'Depreciating' }, { value: 'appreciating', label: 'Appreciating' }, { value: 'non_depreciating', label: 'Non-depreciating' }]}
                  value={nature} onChange={(v) => setNature(v as any)} searchPlaceholder="Search..."
                />
              </div>
              {nature === 'depreciating' && (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Default Useful Life (years)</label>
                    <Input type="number" min="1" value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Default Salvage %</label>
                    <Input type="number" min="0" max="100" value={salvagePercent} onChange={(e) => setSalvagePercent(e.target.value)} />
                  </div>
                </>
              )}
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Asset Account</label>
                <Combobox options={assetAccounts.map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))} value={assetAccountCode} onChange={setAssetAccountCode} placeholder="Select account..." searchPlaceholder="Search..." />
              </div>
              {nature === 'depreciating' && (
                <>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Accumulated Depreciation Account</label>
                    <Combobox options={assetAccounts.map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))} value={accumAccountCode} onChange={setAccumAccountCode} placeholder="Select account..." searchPlaceholder="Search..." />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Depreciation Expense Account</label>
                    <Combobox options={expenseAccounts.map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))} value={expenseAccountCode} onChange={setExpenseAccountCode} placeholder="Select account..." searchPlaceholder="Search..." />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}Save Category</Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
