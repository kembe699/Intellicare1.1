import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/lib/notify';
import {
  Clock, Search, RefreshCw, AlertTriangle, Package, Download, Trash2,
  CheckSquare, X, Check, Loader2,
} from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { formatDate } from '@/lib/format';

interface Batch {
  id: string;
  item_id: string;
  item_name: string;
  item_code: string;
  unit_of_measure: string;
  batch_number: string;
  location_name: string;
  location_id: string;
  receipt_date: string;
  quantity_received: number;
  quantity_used: number;
  quantity_available: number;
  unit_cost: number;
  expiry_date: string;
  days_to_expiry: number;
  is_expired: boolean;
  status: string;
  notes: string;
}

const expiryBadge = (daysToExpiry: number | null, isExpired: boolean) => {
  if (isExpired || (daysToExpiry !== null && daysToExpiry < 0)) return { label: 'Expired', className: 'bg-destructive-bg text-destructive border-destructive-border' };
  if (daysToExpiry !== null && daysToExpiry <= 7) return { label: `${daysToExpiry}d left`, className: 'bg-destructive-bg text-destructive border-destructive-border' };
  if (daysToExpiry !== null && daysToExpiry <= 30) return { label: `${daysToExpiry}d left`, className: 'bg-warning-bg text-warning border-warning-border' };
  if (daysToExpiry !== null && daysToExpiry <= 90) return { label: `${daysToExpiry}d left`, className: 'bg-warning-bg text-warning border-warning-border' };
  return { label: 'OK', className: 'bg-success-bg text-success border-success-border' };
};

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-success-bg text-success border-success-border', partial_use: 'bg-info-bg text-info border-info-border',
  exhausted: 'bg-muted text-muted-foreground border-border', expired: 'bg-destructive-bg text-destructive border-destructive-border',
  damaged: 'bg-orange-50 text-orange-700 border-orange-200', returned: 'bg-purple-50 text-purple-700 border-purple-200',
};

const defaultBatchForm = () => ({
  item_id: '', batch_number: '', location_id: '', receipt_date: new Date().toISOString().split('T')[0],
  quantity_received: 0, unit_cost: 0, manufacture_date: '', expiry_date: '', notes: '',
});

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'partial_use', label: 'Partial Use' },
  { value: 'exhausted', label: 'Exhausted' },
  { value: 'expired', label: 'Expired' },
  { value: 'damaged', label: 'Damaged' },
];

const EXPIRY_FILTER_OPTIONS = [
  { value: 'all', label: 'All expiry' },
  { value: 'expired', label: 'Expired' },
  { value: 'not_expired', label: 'Not Expired' },
];

const USAGE_TYPE_OPTIONS = [
  { value: 'clinical_use', label: 'Clinical Use' },
  { value: 'pharmacy_dispense', label: 'Pharmacy Dispense' },
  { value: 'lab_test', label: 'Lab Test' },
  { value: 'waste', label: 'Waste' },
  { value: 'damage', label: 'Damage' },
];

export default function BatchTracking() {
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const clinicId = user?.clinic || 1;

  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [items, setItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(defaultBatchForm());

  const [showUseModal, setShowUseModal] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [useData, setUseData] = useState({ quantity_used: 0, usage_type: 'clinical_use', notes: '' });
  const [usingBatch, setUsingBatch] = useState(false);

  const [showRetireModal, setShowRetireModal] = useState(false);
  const [retireReason, setRetireReason] = useState('Expired stock write-off');
  const [retiring, setRetiring] = useState(false);

  useEffect(() => { fetchBatches(); fetchItems(); fetchLocations(); }, []);
  useEffect(() => { fetchBatches(); setSelectedIds(new Set()); }, [statusFilter, expiryFilter]);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ clinic_id: String(clinicId) });
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (expiryFilter === 'expired') params.append('expired', 'true');
      if (expiryFilter === 'not_expired') params.append('expired', 'false');
      const res = await authFetch(`/api/inventory/batches?${params}`, { credentials: 'include' });
      if (res.ok) setBatches(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch batches');
    } finally {
      setLoading(false);
    }
  };

  const fetchItems = async () => {
    try {
      const res = await authFetch(`/api/inventory/items?clinic_id=${clinicId}&is_active=true`, { credentials: 'include' });
      if (res.ok) setItems(await res.json());
    } catch (e) { console.error(e); }
  };

  const fetchLocations = async () => {
    try {
      const res = await authFetch(`/api/inventory/locations?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setLocations(await res.json());
    } catch (e) { console.error(e); }
  };

  const filteredBatches = useMemo(() => {
    if (!search) return batches;
    const q = search.toLowerCase();
    return batches.filter(b => b.item_name?.toLowerCase().includes(q) || b.item_code?.toLowerCase().includes(q) || b.batch_number?.toLowerCase().includes(q));
  }, [batches, search]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllExpired = () => {
    const expiredIds = filteredBatches
      .filter(b => (b.is_expired || (b.days_to_expiry !== null && b.days_to_expiry < 0)) && b.quantity_available > 0)
      .map(b => b.id);
    setSelectedIds(new Set(expiredIds));
  };

  const selectedBatches = filteredBatches.filter(b => selectedIds.has(b.id));
  const totalQtyToRetire = selectedBatches.reduce((s, b) => s + (b.quantity_available || 0), 0);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!formData.item_id || !formData.batch_number || !formData.quantity_received) {
      toast.error('Item, batch number, and quantity are required'); return;
    }
    setSaving(true);
    try {
      const res = await authFetch('/api/inventory/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...formData, clinic_id: clinicId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create batch');
      toast.success('Batch created and stock updated');
      setFormData(defaultBatchForm());
      fetchBatches(); fetchItems();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create batch');
    } finally {
      setSaving(false);
    }
  };

  const openUse = (batch: Batch) => {
    setSelectedBatch(batch);
    setUseData({ quantity_used: 0, usage_type: 'clinical_use', notes: '' });
    setShowUseModal(true);
  };

  const handleUse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usingBatch) return;
    if (!selectedBatch || useData.quantity_used <= 0) { toast.error('Enter a valid quantity'); return; }
    setUsingBatch(true);
    try {
      const res = await authFetch(`/api/inventory/batches/${selectedBatch.id}/use`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...useData, used_by: user?.uid }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to record usage');
      toast.success('Usage recorded');
      setShowUseModal(false);
      fetchBatches(); fetchItems();
    } catch (error: any) {
      toast.error(error.message || 'Failed to record usage');
    } finally {
      setUsingBatch(false);
    }
  };

  const handleRetire = async () => {
    if (retiring) return;
    if (selectedIds.size === 0) return;
    setRetiring(true);
    try {
      const res = await authFetch('/api/inventory/batches/retire-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ batch_ids: Array.from(selectedIds), reason: retireReason, retired_by: user?.uid }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to retire batches');
      const data = await res.json();
      toast.success(data.message || 'Batches retired');
      setShowRetireModal(false);
      setSelectedIds(new Set());
      fetchBatches();
    } catch (error: any) {
      toast.error(error.message || 'Failed to retire batches');
    } finally {
      setRetiring(false);
    }
  };

  const exportCSV = () => {
    const headers = ['Batch #', 'Item Code', 'Item Name', 'Received', 'Used', 'Available', 'Unit Cost', 'Expiry', 'Status'];
    const rows = filteredBatches.map(b => [b.batch_number, b.item_code, b.item_name, b.quantity_received, b.quantity_used, b.quantity_available, b.unit_cost, b.expiry_date || '', b.status]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'inventory_batches.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full flex flex-col">
        <PageHeader title="Batch & Expiry Tracking" icon={<Clock />} className="mb-3" />

        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-destructive-border bg-destructive-bg px-4 py-3 mt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <CheckSquare className="w-5 h-5 text-destructive" />
              <span className="text-sm font-semibold text-destructive">{selectedIds.size} batch{selectedIds.size > 1 ? 'es' : ''} selected</span>
              <span className="text-sm text-destructive">— <span className="font-bold">{totalQtyToRetire}</span> units will be removed from stock</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>Clear</Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive border-destructive-border" onClick={() => setShowRetireModal(true)}>
                <Trash2 className="w-4 h-4 mr-1.5" /> Retire Selected
              </Button>
            </div>
          </div>
        )}

        {/* Form above, table below — the shape the rest of the app uses. */}
        <div className="flex flex-col gap-6">

          {/* New Batch */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden min-w-0">
            <div className="p-4 border-b bg-muted/30 flex justify-between items-center flex-shrink-0">
              <h3 className="font-medium flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" /> New Batch
              </h3>
            </div>
            <form onSubmit={handleCreate}>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Item</label>
                  <Combobox
                    options={items.map((item: any) => ({ value: item.id, label: `${item.item_code} — ${item.item_name}` }))}
                    value={formData.item_id}
                    onChange={v => setFormData({ ...formData, item_id: v })}
                    placeholder="Select item..."
                    searchPlaceholder="Search items..."
                    className="mt-1 h-9"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Batch Number</label>
                    <Input required value={formData.batch_number} onChange={e => setFormData({ ...formData, batch_number: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Location</label>
                    <Combobox
                      options={locations.map((l: any) => ({ value: l.id, label: l.location_name }))}
                      value={formData.location_id}
                      onChange={v => setFormData({ ...formData, location_id: v })}
                      placeholder="None"
                      searchPlaceholder="Search locations..."
                      className="mt-1 h-9"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Qty Received</label>
                    <Input required type="number" min="1" value={formData.quantity_received || ''} onChange={e => setFormData({ ...formData, quantity_received: parseInt(e.target.value) || 0 })} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Unit Cost</label>
                    <Input type="number" step="0.01" min="0" value={formData.unit_cost || ''} onChange={e => setFormData({ ...formData, unit_cost: parseFloat(e.target.value) || 0 })} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Receipt Date</label>
                    <Input type="date" value={formData.receipt_date} onChange={e => setFormData({ ...formData, receipt_date: e.target.value })} className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Manufacture Date</label>
                    <Input type="date" value={formData.manufacture_date} onChange={e => setFormData({ ...formData, manufacture_date: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Expiry Date</label>
                    <Input type="date" value={formData.expiry_date} onChange={e => setFormData({ ...formData, expiry_date: e.target.value })} className="mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full mt-1 p-3 border border-input rounded-md resize-none h-16 text-sm bg-background shadow-sm"
                  />
                </div>
              </div>
              <div className="p-4 border-t bg-muted flex justify-end gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  {saving ? 'Creating...' : 'Create Batch'}
                </Button>
              </div>
            </form>
          </div>

          {/* Batch Directory */}
          <AdvancedDataTable<Batch>
            title="Batch Directory"
            searchSlot={
              <div className="relative w-52">
                <Search className="w-4 h-4 absolute left-2.5 top-2 text-muted-foreground" />
                <Input placeholder="Search batches..." className="text-sm pl-8 h-8" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            }
            toolbarExtra={
              <>
                <Combobox
                  options={STATUS_FILTER_OPTIONS}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  searchPlaceholder="Search..."
                  className="text-sm w-40 h-8"
                />
                <Combobox
                  options={EXPIRY_FILTER_OPTIONS}
                  value={expiryFilter}
                  onChange={setExpiryFilter}
                  searchPlaceholder="Search..."
                  className="text-sm w-40 h-8"
                />
                <Button variant="outline" size="icon" aria-label="Refresh" className="h-8 w-8" onClick={fetchBatches} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-destructive border-destructive-border hover:bg-destructive-bg" onClick={selectAllExpired}>
                  <AlertTriangle className="w-4 h-4 mr-2" /> Select Expired
                </Button>
              </>
            }
            autoFilters={false}
            data={filteredBatches}
            keyExtractor={(batch) => batch.id}
            loading={loading}
            emptyMessage="No batches found."
            rowClassName={(batch) => selectedIds.has(batch.id) ? 'bg-destructive-bg/60' : ''}
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            columns={[
              {
                key: '__select', header: '', width: '2rem',
                render: (_v, batch) => (
                  <input
                    type="checkbox" className="rounded"
                    checked={selectedIds.has(batch.id)}
                    onChange={() => toggleSelect(batch.id)}
                    disabled={batch.quantity_available <= 0}
                  />
                ),
              },
              { key: 'batch_number', header: 'Batch No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
              {
                key: 'item_name', header: 'Item', sortable: true,
                render: (v, batch) => (
                  <>
                    {v}
                    <span className="text-xs text-muted-foreground ml-1 font-mono">({batch.item_code})</span>
                  </>
                ),
              },
              { key: 'location_name', header: 'Location', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
              { key: 'quantity_available', header: 'Available', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
              { key: 'unit_cost', header: 'Unit Cost', sortable: true, render: (v) => <span className="font-mono text-muted-foreground">{fmt(v)}</span> },
              {
                key: 'expiry_date', header: 'Expiry', sortable: true,
                render: (v, batch) => {
                  if (!v) return <span className="text-xs text-muted-foreground">N/A</span>;
                  const expBadge = expiryBadge(batch.days_to_expiry, batch.is_expired);
                  return (
                    <div>
                      <p className="text-xs">{formatDate(v)}</p>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border mt-0.5 ${expBadge.className}`}>{expBadge.label}</span>
                    </div>
                  );
                },
              },
              {
                key: 'status', header: 'Status', sortable: true,
                render: (v) => <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border capitalize ${STATUS_CLASS[v] || 'bg-muted text-muted-foreground border-border'}`}>{v?.replace(/_/g, ' ')}</span>,
              },
              {
                key: '__actions', header: 'Actions',
                render: (_v, batch) => (
                  batch.quantity_available > 0 && batch.status !== 'expired' ? (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openUse(batch)}>Use</Button>
                  ) : null
                ),
              },
            ]}
          />
        </div>
      </div>
      </div>

      {/* Use Batch Modal */}
      {showUseModal && selectedBatch && (
        <div className="ic-modal-overlay">
          <div className="ic-modal max-w-md">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <div>
                <h3 className="font-semibold text-lg">Record Batch Usage</h3>
                <p className="text-xs text-muted-foreground">{selectedBatch.item_name} — Batch {selectedBatch.batch_number} (Available: {selectedBatch.quantity_available})</p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Close" className="h-8 w-8" onClick={() => setShowUseModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <form onSubmit={handleUse}>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Quantity to Use</label>
                    <Input required type="number" min="1" max={selectedBatch.quantity_available} value={useData.quantity_used || ''} onChange={e => setUseData({ ...useData, quantity_used: parseInt(e.target.value) || 0 })} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Usage Type</label>
                    <Combobox
                      options={USAGE_TYPE_OPTIONS}
                      value={useData.usage_type}
                      onChange={v => setUseData({ ...useData, usage_type: v })}
                      searchPlaceholder="Search..."
                      className="mt-1 h-9"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Notes</label>
                  <textarea
                    value={useData.notes}
                    onChange={e => setUseData({ ...useData, notes: e.target.value })}
                    className="w-full mt-1 p-3 border border-input rounded-md resize-none h-16 text-sm bg-transparent shadow-sm"
                  />
                </div>
              </div>
              <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowUseModal(false)}>Cancel</Button>
                <Button type="submit" disabled={usingBatch}>
                  {usingBatch ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  {usingBatch ? 'Recording...' : 'Record Usage'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Retire Confirmation Modal */}
      {showRetireModal && (
        <div className="ic-modal-overlay">
          <div className="ic-modal max-w-md max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2 text-destructive">
                <Trash2 className="w-5 h-5" /> Retire Batches
              </h3>
              <Button variant="ghost" size="icon" aria-label="Close" className="h-8 w-8" onClick={() => setShowRetireModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 flex-1 overflow-auto space-y-4">
              <p className="text-sm text-muted-foreground">This removes the remaining quantities from total stock and marks the batches as retired.</p>
              <div className="rounded-lg border border-destructive-border bg-destructive-bg p-3 space-y-1.5 max-h-48 overflow-y-auto">
                {selectedBatches.map(b => (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <span className="font-mono font-medium">{b.batch_number}</span>
                    <span className="text-muted-foreground text-xs">{b.item_name}</span>
                    <span className="font-semibold text-destructive">−{b.quantity_available} {b.unit_of_measure}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-sm">
                <span className="font-medium">Total units removed from stock:</span>
                <span className="text-lg font-bold text-destructive">{totalQtyToRetire}</span>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Reason</label>
                <Input value={retireReason} onChange={e => setRetireReason(e.target.value)} placeholder="e.g. Expired stock write-off" className="mt-1" />
              </div>
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowRetireModal(false)}>Cancel</Button>
              <Button variant="outline" className="text-destructive hover:text-destructive border-destructive-border" onClick={handleRetire} disabled={retiring}>
                {retiring ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                {retiring ? 'Retiring...' : `Retire ${selectedIds.size} Batch${selectedIds.size > 1 ? 'es' : ''}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
