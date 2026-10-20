import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/lib/notify';
import { usePromptDialog } from '@/hooks/use-prompt-dialog';
import {
  ClipboardCheck, Plus, RefreshCw, Eye, CheckCircle, XCircle, AlertTriangle,
  ClipboardList, X, Check, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { formatDate } from '@/lib/format';

const STATUS_CLASS: Record<string, string> = {
  in_progress: 'bg-sky-50 text-sky-700 border-sky-200', completed: 'bg-amber-50 text-amber-700 border-amber-200',
  reconciled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-slate-100 text-slate-600 border-slate-200', approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

const defaultCountForm = () => ({ count_type: 'full_count', location_id: '' });

const COUNT_TYPE_OPTIONS = [
  { value: 'full_count', label: 'Full Count' },
  { value: 'cycle_count', label: 'Cycle Count' },
  { value: 'spot_check', label: 'Spot Check' },
];

const VARIANCE_REASON_OPTIONS = [
  { value: 'recount_error', label: 'Recount Error' },
  { value: 'shrinkage', label: 'Shrinkage' },
  { value: 'theft', label: 'Theft' },
  { value: 'damage', label: 'Damage' },
  { value: 'recording_error', label: 'Recording Error' },
  { value: 'other', label: 'Other' },
];

export default function PhysicalCounts() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const clinicId = user?.clinic || 1;
  const { prompt, promptDialog } = usePromptDialog();

  const [activeMode, setActiveMode] = useState<'counts' | 'adjustments'>('counts');
  const [counts, setCounts] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  const [countForm, setCountForm] = useState(defaultCountForm());
  const [creatingCount, setCreatingCount] = useState(false);

  const [selectedCount, setSelectedCount] = useState<any | null>(null);
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineForm, setLineForm] = useState({ item_id: '', counted_quantity: 0, notes: '' });
  const [addingLine, setAddingLine] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const [showCreateAdj, setShowCreateAdj] = useState(false);
  const [adjForm, setAdjForm] = useState({ item_id: '', location_id: '', system_quantity: 0, physical_count: 0, variance_reason: 'recount_error', notes: '' });
  const [creatingAdj, setCreatingAdj] = useState(false);

  // Scoped to the specific adjustment row being approved/rejected so acting on one row
  // doesn't disable every other row's buttons at once.
  const [processingAdj, setProcessingAdj] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);

  useEffect(() => { fetchCounts(); fetchAdjustments(); fetchItems(); fetchLocations(); }, []);

  const fetchCounts = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/inventory/physical-counts?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setCounts(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdjustments = async () => {
    try {
      const res = await authFetch(`/api/inventory/adjustments?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setAdjustments(await res.json());
    } catch (e) { console.error(e); }
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

  const viewCount = async (count: any) => {
    try {
      const res = await authFetch(`/api/inventory/physical-counts/${count.id}`, { credentials: 'include' });
      if (res.ok) setSelectedCount(await res.json());
    } catch {
      toast.error('Failed to load count details');
    }
  };

  const createCount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingCount) return;
    setCreatingCount(true);
    try {
      const res = await authFetch('/api/inventory/physical-counts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...countForm, clinic_id: clinicId, created_by: user?.uid }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to start count');
      const data = await res.json();
      toast.success(`Count ${data.count_number} started`);
      setCountForm(defaultCountForm());
      fetchCounts();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setCreatingCount(false);
    }
  };

  const addCountLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addingLine) return;
    if (!selectedCount || !lineForm.item_id) return;
    setAddingLine(true);
    try {
      const res = await authFetch(`/api/inventory/physical-counts/${selectedCount.id}/add-line`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...lineForm, counted_by: user?.uid }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to add count line');
      toast.success('Count line added');
      setShowAddLine(false);
      viewCount(selectedCount);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setAddingLine(false);
    }
  };

  const completeCount = async () => {
    if (completing) return;
    if (!selectedCount) return;
    setCompleting(true);
    try {
      const res = await authFetch(`/api/inventory/physical-counts/${selectedCount.id}/complete`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ completed_by: user?.uid }),
      });
      if (!res.ok) throw new Error('Failed to complete count');
      toast.success('Count completed');
      viewCount(selectedCount);
      fetchCounts();
    } catch {
      toast.error('Failed to complete count');
    } finally {
      setCompleting(false);
    }
  };

  const reconcileCount = async () => {
    if (reconciling) return;
    if (!selectedCount) return;
    if (!(await confirm({ description: 'Reconcile this count? Adjustments will be created for all variances.' }))) return;
    setReconciling(true);
    try {
      const res = await authFetch(`/api/inventory/physical-counts/${selectedCount.id}/reconcile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ approved_by: user?.uid, clinic_id: clinicId }),
      });
      if (!res.ok) throw new Error('Failed to reconcile');
      const data = await res.json();
      toast.success(`${data.adjustments_created} adjustments created`);
      setSelectedCount(null);
      fetchCounts(); fetchAdjustments();
    } catch {
      toast.error('Failed to reconcile');
    } finally {
      setReconciling(false);
    }
  };

  const handleSelectItemForAdj = (itemId: string) => {
    const item = items.find((i: any) => i.id === itemId);
    setAdjForm({ ...adjForm, item_id: itemId, system_quantity: item?.quantity_on_hand || 0 });
  };

  const createAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingAdj) return;
    setCreatingAdj(true);
    try {
      const res = await authFetch('/api/inventory/adjustments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...adjForm, clinic_id: clinicId, counted_by: user?.uid }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create adjustment');
      toast.success('Adjustment created');
      setShowCreateAdj(false);
      fetchAdjustments();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setCreatingAdj(false);
    }
  };

  const approveAdjustment = async (id: string) => {
    if (processingAdj) return;
    setProcessingAdj({ id, action: 'approve' });
    try {
      const res = await authFetch(`/api/inventory/adjustments/${id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ approved_by: user?.uid }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Adjustment approved, stock updated');
      fetchAdjustments(); fetchItems();
    } catch {
      toast.error('Failed to approve adjustment');
    } finally {
      setProcessingAdj(null);
    }
  };

  // Bug fix: this previously never checked res.ok, so a failed reject request still showed
  // a success toast — matching every other handler here that throws on a non-OK response.
  const rejectAdjustment = async (id: string) => {
    if (processingAdj) return;
    const reason = await prompt({ title: 'Rejection reason' });
    if (!reason) return;
    setProcessingAdj({ id, action: 'reject' });
    try {
      const res = await authFetch(`/api/inventory/adjustments/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ reviewed_by: user?.uid, notes: reason }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Adjustment rejected');
      fetchAdjustments();
    } catch {
      toast.error('Failed to reject adjustment');
    } finally {
      setProcessingAdj(null);
    }
  };

  return (
    <AppLayout>
      {confirmDialog}
      {promptDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full flex flex-col">
        <div className="flex justify-between items-start">
          <PageHeader title="Physical Counts & Adjustments" icon={<ClipboardList />} />
          <div className="flex bg-muted p-1 rounded-lg">
            <button
              onClick={() => setActiveMode('counts')}
              className={cn("px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2", activeMode === 'counts' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <ClipboardCheck className="w-4 h-4" /> Physical Counts
            </button>
            <button
              onClick={() => setActiveMode('adjustments')}
              className={cn("px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2", activeMode === 'adjustments' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <AlertTriangle className="w-4 h-4" /> Adjustments
            </button>
          </div>
        </div>

        {/* Form above, table below — the shape the rest of the app uses. */}
        <div className="mt-6 flex flex-col gap-6">

          {activeMode === 'counts' && (
            /* New Physical Count */
            <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden min-w-0">
              <div className="p-4 border-b bg-muted/30 flex justify-between items-center flex-shrink-0">
                <h3 className="font-medium flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-primary" /> New Physical Count
                </h3>
              </div>
              <form onSubmit={createCount}>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Count Type</label>
                    <Combobox
                      options={COUNT_TYPE_OPTIONS}
                      value={countForm.count_type}
                      onChange={v => setCountForm({ ...countForm, count_type: v })}
                      searchPlaceholder="Search..."
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Location (optional)</label>
                    <Combobox
                      options={locations.map((l: any) => ({ value: l.id, label: l.location_name }))}
                      value={countForm.location_id}
                      onChange={v => setCountForm({ ...countForm, location_id: v })}
                      placeholder="All Locations"
                      searchPlaceholder="Search locations..."
                      className="mt-1 h-9"
                    />
                  </div>
                </div>
                <div className="p-4 border-t bg-muted flex justify-end gap-2">
                  <Button type="submit" disabled={creatingCount}>
                    {creatingCount ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    {creatingCount ? 'Starting...' : 'Start Count'}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Directory */}
          <div className="bg-card rounded-lg border shadow-sm p-0 flex flex-col overflow-hidden min-w-0">
          <div className="p-4 border-b flex justify-between items-center bg-muted/30">
            <h3 className="font-medium">{activeMode === 'counts' ? 'Count Directory' : 'Adjustment Directory'}</h3>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => { fetchCounts(); fetchAdjustments(); }} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              {activeMode === 'adjustments' && (
                <Button size="sm" className="h-9" onClick={() => { setAdjForm({ item_id: '', location_id: '', system_quantity: 0, physical_count: 0, variance_reason: 'recount_error', notes: '' }); setShowCreateAdj(true); }}>
                  <Plus className="w-4 h-4 mr-2" /> New Adjustment
                </Button>
              )}
            </div>
          </div>

          <div className="p-4 min-w-0">
            {activeMode === 'counts' ? (
              <AdvancedDataTable<any>
                data={counts}
                keyExtractor={(c) => c.id}
                loading={loading}
                emptyMessage="No physical counts yet."
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'count_number', header: 'Count No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                  { key: 'count_date', header: 'Date', sortable: true, render: (v) => <span className="text-muted-foreground">{v ? formatDate(v) : '—'}</span> },
                  { key: 'count_type', header: 'Type', sortable: true, render: (v) => <span className="capitalize text-muted-foreground">{v?.replace(/_/g, ' ')}</span> },
                  { key: 'location_name', header: 'Location', render: (v) => v || 'All' },
                  { key: 'total_items_counted', header: 'Items', sortable: true, render: (v) => v || 0 },
                  { key: 'variance_count', header: 'Variances', sortable: true, render: (v) => v || 0 },
                  {
                    key: 'status', header: 'Status', sortable: true,
                    render: (v) => <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border capitalize ${STATUS_CLASS[v] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{v?.replace(/_/g, ' ')}</span>,
                  },
                  {
                    key: '__actions', header: 'Actions',
                    render: (_v, c) => <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => viewCount(c)}><Eye className="w-3.5 h-3.5" /></Button>,
                  },
                ]}
              />
            ) : (
              <AdvancedDataTable<any>
                data={adjustments}
                keyExtractor={(adj) => adj.id}
                emptyMessage="No adjustments yet."
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'adjustment_number', header: 'Adj No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                  {
                    key: 'item_name', header: 'Item', sortable: true,
                    render: (v, adj) => (
                      <>
                        {v}
                        <span className="text-xs text-muted-foreground ml-1 font-mono">({adj.item_code})</span>
                      </>
                    ),
                  },
                  { key: 'system_quantity', header: 'System', sortable: true },
                  { key: 'physical_count', header: 'Physical', sortable: true },
                  {
                    key: 'variance', header: 'Variance', sortable: true,
                    render: (v) => <span className={`font-mono ${v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-600' : ''}`}>{v > 0 ? '+' : ''}{v}</span>,
                  },
                  { key: 'variance_value', header: 'Value', sortable: true, render: (v) => <span className="font-mono text-muted-foreground">{fmt(v)}</span> },
                  { key: 'variance_reason', header: 'Reason', render: (v) => <span className="capitalize text-muted-foreground">{v?.replace(/_/g, ' ')}</span> },
                  {
                    key: 'approval_status', header: 'Status', sortable: true,
                    render: (v) => <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border capitalize ${STATUS_CLASS[v] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{v}</span>,
                  },
                  {
                    key: '__actions', header: 'Actions',
                    render: (_v, adj) => adj.approval_status === 'pending' ? (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => approveAdjustment(adj.id)} disabled={processingAdj?.id === adj.id}>
                          {processingAdj?.id === adj.id && processingAdj.action === 'approve'
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                            : <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => rejectAdjustment(adj.id)} disabled={processingAdj?.id === adj.id}>
                          {processingAdj?.id === adj.id && processingAdj.action === 'reject'
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-600" />
                            : <XCircle className="w-3.5 h-3.5 text-red-600" />}
                        </Button>
                      </div>
                    ) : null,
                  },
                ]}
              />
            )}
          </div>
          </div>
        </div>
      </div>
      </div>

      {/* Count Detail Modal */}
      {selectedCount && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-2xl rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <div>
                <h3 className="font-semibold text-lg font-mono">{selectedCount.count_number}</h3>
                <p className="text-xs text-muted-foreground">{selectedCount.count_date ? formatDate(selectedCount.count_date) : ''} — {selectedCount.count_type?.replace(/_/g, ' ')}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedCount(null)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="p-6 flex-1 overflow-auto space-y-4">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border capitalize ${STATUS_CLASS[selectedCount.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{selectedCount.status?.replace(/_/g, ' ')}</span>
              <div className="border rounded-lg overflow-hidden">
                <AdvancedDataTable<any>
                  data={selectedCount.lines || []}
                  keyExtractor={(line) => line.id}
                  emptyMessage="No items counted yet."
                  rowClassName={(line) => line.variance !== 0 ? 'bg-red-50/50' : ''}
                  columns={[
                    {
                      key: 'item_name', header: 'Item',
                      render: (v, line) => (
                        <>
                          {v}
                          <span className="text-xs text-muted-foreground ml-1 font-mono">({line.item_code})</span>
                        </>
                      ),
                    },
                    { key: 'system_quantity', header: 'System', align: 'right' },
                    { key: 'counted_quantity', header: 'Counted', align: 'right' },
                    {
                      key: 'variance', header: 'Variance', align: 'right',
                      render: (v) => <span className={`font-mono ${v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-600' : ''}`}>{v > 0 ? '+' : ''}{v}</span>,
                    },
                  ]}
                />
              </div>
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-between gap-2">
              {selectedCount.status === 'in_progress' && (
                <>
                  <Button variant="outline" onClick={() => { setLineForm({ item_id: '', counted_quantity: 0, notes: '' }); setShowAddLine(true); }}>
                    <Plus className="w-4 h-4 mr-2" /> Add Item
                  </Button>
                  <Button onClick={completeCount} disabled={completing}>
                    {completing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                    {completing ? 'Completing...' : 'Complete Count'}
                  </Button>
                </>
              )}
              {selectedCount.status === 'completed' && (
                <Button onClick={reconcileCount} disabled={reconciling} className="ml-auto">
                  {reconciling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
                  {reconciling ? 'Reconciling...' : 'Reconcile & Create Adjustments'}
                </Button>
              )}
              {(selectedCount.status === 'reconciled') && <span />}
            </div>
          </div>
        </div>
      )}

      {/* Add Count Line Modal */}
      {showAddLine && (
        // z-50, not z-[60]: the Item combobox inside this modal opens a Radix
        // Popover portalled to a z-50 layer (see components/ui/popover.tsx) — at
        // z-[60] this modal painted above that portal, so the dropdown list was
        // rendered but invisible/unclickable behind the modal's own fields. Every
        // other modal+Combobox pairing in this file (Count Detail, Create
        // Adjustment) is already z-50, which is what lets the popover's later
        // DOM position win the tie and render on top, as intended.
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-md rounded-xl shadow-lg border overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg">Count Item</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowAddLine(false)}><X className="w-4 h-4" /></Button>
            </div>
            <form onSubmit={addCountLine}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Item</label>
                  <Combobox
                    options={items.map((item: any) => ({ value: item.id, label: `${item.item_code} — ${item.item_name} (System: ${item.quantity_on_hand})` }))}
                    value={lineForm.item_id}
                    onChange={v => setLineForm({ ...lineForm, item_id: v })}
                    placeholder="Select item..."
                    searchPlaceholder="Search items..."
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Counted Quantity</label>
                  <Input required type="number" min="0" value={lineForm.counted_quantity || ''} onChange={e => setLineForm({ ...lineForm, counted_quantity: parseInt(e.target.value) || 0 })} className="mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Notes</label>
                  <textarea
                    value={lineForm.notes}
                    onChange={e => setLineForm({ ...lineForm, notes: e.target.value })}
                    className="w-full mt-1 p-3 border border-input rounded-md resize-none h-16 text-sm bg-transparent shadow-sm"
                  />
                </div>
              </div>
              <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowAddLine(false)}>Cancel</Button>
                <Button type="submit" disabled={addingLine}>
                  {addingLine ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  {addingLine ? 'Adding...' : 'Add Count'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Adjustment Modal */}
      {showCreateAdj && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-md rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-primary" /> Create Adjustment</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowCreateAdj(false)}><X className="w-4 h-4" /></Button>
            </div>
            <form onSubmit={createAdjustment} className="flex-1 overflow-auto">
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Item</label>
                  <Combobox
                    options={items.map((item: any) => ({ value: item.id, label: `${item.item_code} — ${item.item_name}` }))}
                    value={adjForm.item_id}
                    onChange={handleSelectItemForAdj}
                    placeholder="Select item..."
                    searchPlaceholder="Search items..."
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Location</label>
                  <Combobox
                    options={locations.map((l: any) => ({ value: l.id, label: l.location_name }))}
                    value={adjForm.location_id}
                    onChange={v => setAdjForm({ ...adjForm, location_id: v })}
                    placeholder="None"
                    searchPlaceholder="Search locations..."
                    className="mt-1 h-9"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">System Qty</label>
                    <Input type="number" value={adjForm.system_quantity} readOnly className="mt-1 bg-muted" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Physical Count</label>
                    <Input required type="number" min="0" value={adjForm.physical_count || ''} onChange={e => setAdjForm({ ...adjForm, physical_count: parseInt(e.target.value) || 0 })} className="mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Reason</label>
                  <Combobox
                    options={VARIANCE_REASON_OPTIONS}
                    value={adjForm.variance_reason}
                    onChange={v => setAdjForm({ ...adjForm, variance_reason: v })}
                    searchPlaceholder="Search..."
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Notes</label>
                  <textarea
                    value={adjForm.notes}
                    onChange={e => setAdjForm({ ...adjForm, notes: e.target.value })}
                    className="w-full mt-1 p-3 border border-input rounded-md resize-none h-16 text-sm bg-transparent shadow-sm"
                  />
                </div>
                {adjForm.item_id && (
                  <div className="p-3 rounded-lg bg-muted/30 text-sm">
                    Variance: <span className="font-bold">{adjForm.physical_count - adjForm.system_quantity}</span>
                  </div>
                )}
              </div>
              <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateAdj(false)}>Cancel</Button>
                <Button type="submit" disabled={creatingAdj}>
                  {creatingAdj ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  {creatingAdj ? 'Creating...' : 'Create Adjustment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
