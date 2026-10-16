import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { getStatusColor } from '@/lib/statusColors';
import { toast } from 'sonner';
import { usePromptDialog } from '@/hooks/use-prompt-dialog';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { ArrowRightLeft, Plus, X, Check, Loader2, RefreshCw, Trash2, Eye } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface StockLocation { id: string; location_name: string; location_type: string; department_name: string | null; }
interface LocationItem { id: string; item_name: string; item_code: string; unit_of_measure: string; quantity_on_hand: number; }

interface RequestLine { inventory_item_id: string; quantity_requested: string; notes: string }

interface TransferRequest {
  id: string;
  transfer_number: string;
  from_location_id: string;
  to_location_id: string;
  from_location_name: string;
  to_location_name: string;
  requested_by: number;
  requested_by_name: string;
  approved_by_name: string | null;
  status: string;
  notes: string | null;
  rejection_reason: string | null;
  item_count: number;
  created_at: string;
}

interface DetailLine { id: string; item_name: string; item_code: string; unit_of_measure: string; quantity_requested: number; quantity_fulfilled: number; }
interface RequestDetail extends TransferRequest { items: DetailLine[] }

const emptyLine = (): RequestLine => ({ inventory_item_id: '', quantity_requested: '', notes: '' });

export default function StockTransferRequests() {
  const { user } = useAuth();
  const { prompt, promptDialog } = usePromptDialog();
  const { confirm, confirmDialog } = useConfirmDialog();

  const [requests, setRequests] = useState<TransferRequest[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<RequestLine[]>([emptyLine()]);
  const [sourceItems, setSourceItems] = useState<LocationItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [reqRes, locRes] = await Promise.all([
        authFetch('/api/stock-transfers', { credentials: 'include' }),
        authFetch('/api/stock-transfers/locations', { credentials: 'include' }),
      ]);
      if (reqRes.ok) setRequests(await reqRes.json());
      if (locRes.ok) setLocations(await locRes.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to load stock transfer requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // The items a request can draw on are specific to whichever store was
  // picked as the source — load them only once that's chosen, same pattern
  // as Lab Consumables' location-first item picker.
  useEffect(() => {
    if (!fromLocationId) { setSourceItems([]); return; }
    setItemsLoading(true);
    authFetch(`/api/stock-transfers/locations/${fromLocationId}/items`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => setSourceItems(Array.isArray(data) ? data : []))
      .catch(() => setSourceItems([]))
      .finally(() => setItemsLoading(false));
  }, [fromLocationId]);

  const locationOptions = useMemo(() => locations.map(l => ({
    value: l.id, label: l.department_name ? `${l.location_name} (${l.department_name})` : l.location_name,
  })), [locations]);
  const destinationOptions = useMemo(() => locationOptions.filter(o => o.value !== fromLocationId), [locationOptions, fromLocationId]);
  const sourceOptions = useMemo(() => locationOptions.filter(o => o.value !== toLocationId), [locationOptions, toLocationId]);
  const itemOptions = useMemo(() => sourceItems.map(i => ({
    value: i.id, label: `${i.item_name} — ${Number(i.quantity_on_hand || 0).toLocaleString()} ${i.unit_of_measure || ''} available`,
  })), [sourceItems]);

  const resetForm = () => {
    setFromLocationId(''); setToLocationId(''); setNotes(''); setLines([emptyLine()]);
  };

  const updateLine = (idx: number, patch: Partial<RequestLine>) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const addLine = () => setLines(prev => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const cleanLines = lines
      .filter(l => l.inventory_item_id && parseFloat(l.quantity_requested) > 0)
      .map(l => ({ inventory_item_id: l.inventory_item_id, quantity_requested: parseFloat(l.quantity_requested), notes: l.notes || undefined }));
    if (!fromLocationId || !toLocationId || cleanLines.length === 0) {
      toast.error('Pick a source store, a destination store, and at least one item with a quantity');
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch('/api/stock-transfers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ from_location_id: fromLocationId, to_location_id: toLocationId, notes: notes || undefined, items: cleanLines }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to submit request');
      toast.success('Stock transfer request submitted');
      resetForm();
      setShowForm(false);
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit request');
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (row: TransferRequest) => {
    setDetailLoading(true);
    try {
      const res = await authFetch(`/api/stock-transfers/${row.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load request');
      setDetail(await res.json());
    } catch (error: any) {
      toast.error(error.message || 'Failed to load request');
    } finally {
      setDetailLoading(false);
    }
  };

  const approve = async (row: TransferRequest) => {
    const ok = await confirm({
      title: 'Approve & move stock?',
      description: `This will move the requested items out of ${row.from_location_name} into ${row.to_location_name} right away.`,
    });
    if (!ok) return;
    setProcessingId(row.id);
    try {
      const res = await authFetch(`/api/stock-transfers/${row.id}/approve`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to approve');
      toast.success('Request approved — stock moved');
      setDetail(null);
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve request');
    } finally {
      setProcessingId(null);
    }
  };

  const reject = async (row: TransferRequest) => {
    const reason = await prompt({ title: 'Reject request', description: 'Reason for rejecting this transfer request', placeholder: 'Why is this being rejected?' });
    if (reason === null) return;
    setProcessingId(row.id);
    try {
      const res = await authFetch(`/api/stock-transfers/${row.id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ rejection_reason: reason }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to reject');
      toast.success('Request rejected');
      setDetail(null);
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject request');
    } finally {
      setProcessingId(null);
    }
  };

  const cancel = async (row: TransferRequest) => {
    const ok = await confirm({ title: 'Cancel this request?', description: 'This cannot be undone.' });
    if (!ok) return;
    setProcessingId(row.id);
    try {
      const res = await authFetch(`/api/stock-transfers/${row.id}/cancel`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to cancel');
      toast.success('Request cancelled');
      setDetail(null);
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel request');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
          <PageHeader title="Stock Transfer Requests" icon={<ArrowRightLeft />} className="mb-3" />
          <p className="text-sm text-muted-foreground -mt-2 mb-3">
            Request items from another store when your own has run out. Pick the store to pull from, see what it
            actually has in stock, and submit a request — once approved by that store, the items move straight in.
          </p>

          <div className="mb-4">
            {!showForm ? (
              <Button onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" /> New Transfer Request
              </Button>
            ) : (
              <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
                <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
                  <h3 className="font-medium flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-primary" /> New Transfer Request
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); resetForm(); }}>
                    <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                  </Button>
                </div>
                <form onSubmit={handleSubmit}>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">1. Request from (source store)</label>
                      <Combobox
                        options={sourceOptions}
                        value={fromLocationId}
                        onChange={v => { setFromLocationId(v); setLines([emptyLine()]); }}
                        placeholder="Select the store to pull from..."
                        searchPlaceholder="Search stores..."
                        className="mt-1 h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">2. Deliver to (your store)</label>
                      <Combobox
                        options={destinationOptions}
                        value={toLocationId}
                        onChange={setToLocationId}
                        placeholder="Select your store..."
                        searchPlaceholder="Search stores..."
                        className="mt-1 h-9"
                      />
                    </div>
                  </div>

                  <div className="px-4">
                    <label className="text-xs font-medium text-muted-foreground">3. Items & quantities</label>
                    {!fromLocationId && (
                      <p className="text-[11px] text-muted-foreground mt-1 mb-2">Pick a source store above to see what it has in stock.</p>
                    )}
                    <div className="space-y-2 mt-1">
                      {lines.map((line, idx) => (
                        <div key={idx} className="flex gap-2 items-start">
                          <div className="flex-1">
                            <Combobox
                              options={itemOptions}
                              value={line.inventory_item_id}
                              onChange={v => updateLine(idx, { inventory_item_id: v })}
                              placeholder={!fromLocationId ? 'Pick a source store first...' : itemsLoading ? 'Loading...' : 'Select item...'}
                              searchPlaceholder="Search items..."
                              className="h-9"
                              disabled={!fromLocationId || itemsLoading}
                            />
                          </div>
                          <Input
                            type="number" min="0" step="any" placeholder="Qty"
                            value={line.quantity_requested}
                            onChange={e => updateLine(idx, { quantity_requested: e.target.value })}
                            className="w-28 h-9"
                            disabled={!fromLocationId}
                          />
                          <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeLine(idx)} disabled={lines.length === 1}>
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addLine} disabled={!fromLocationId}>
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Add item
                    </Button>
                  </div>

                  <div className="p-4 pt-3">
                    <label className="text-xs font-medium text-muted-foreground">Notes</label>
                    <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className="mt-1" />
                  </div>

                  <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
                    <Button type="submit" disabled={saving}>
                      {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                      {saving ? 'Submitting...' : 'Submit Request'}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0">
            <AdvancedDataTable<TransferRequest>
              data={requests}
              loading={loading}
              loadingMessage="Loading stock transfer requests..."
              emptyMessage="No stock transfer requests yet."
              keyExtractor={(row) => row.id}
              searchable
              searchPlaceholder="Search..."
              pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
              toolbarExtra={
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              }
              onRowClick={openDetail}
              columns={[
                { key: 'transfer_number', header: 'Request #', sortable: true, render: (v) => <span className="font-mono text-sm">{v}</span> },
                { key: 'from_location_name', header: 'From', render: (v) => v || '—' },
                { key: 'to_location_name', header: 'To', render: (v) => v || '—' },
                { key: 'requested_by_name', header: 'Requested By', render: (v) => v || '—' },
                { key: 'item_count', header: 'Items', align: 'right' },
                { key: 'status', header: 'Status', render: (v) => <Badge className={getStatusColor(v)}>{String(v).replace('_', ' ')}</Badge> },
                { key: 'created_at', header: 'Date', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
                {
                  key: 'id', header: 'Actions', align: 'center',
                  render: (_v, row) => (
                    <div className="flex items-center justify-center gap-1">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openDetail(row); }}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {row.status === 'pending' && (
                        <>
                          <Button size="sm" variant="ghost" disabled={processingId === row.id} onClick={(e) => { e.stopPropagation(); approve(row); }}>
                            {processingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-green-600" />}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={processingId === row.id} onClick={(e) => { e.stopPropagation(); reject(row); }}>
                            <X className="w-3.5 h-3.5 text-red-600" />
                          </Button>
                          {(String(row.requested_by) === String(user?.id) || user?.role === 'admin') && (
                            <Button size="sm" variant="ghost" disabled={processingId === row.id} onClick={(e) => { e.stopPropagation(); cancel(row); }}>
                              <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" /> {detail?.transfer_number}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-muted-foreground">{detail.from_location_name}</span>
                  <ArrowRightLeft className="inline w-3.5 h-3.5 mx-2 text-muted-foreground" />
                  <span className="font-medium">{detail.to_location_name}</span>
                </div>
                <Badge className={getStatusColor(detail.status)}>{detail.status.replace('_', ' ')}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Requested by {detail.requested_by_name || '—'}
                {detail.approved_by_name && ` · ${detail.status === 'rejected' ? 'Rejected' : 'Approved'} by ${detail.approved_by_name}`}
              </div>
              {detail.notes && <p className="text-sm">{detail.notes}</p>}
              {detail.rejection_reason && <p className="text-sm text-red-600">Reason: {detail.rejection_reason}</p>}
              <div className="border rounded-lg divide-y">
                {detail.items?.map((line) => (
                  <div key={line.id} className="px-3 py-2 flex justify-between items-center text-sm">
                    <div>
                      <p className="font-medium">{line.item_name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{line.item_code}</p>
                    </div>
                    <div className="text-right">
                      <p>{Number(line.quantity_requested).toLocaleString()} {line.unit_of_measure}</p>
                      {Number(line.quantity_fulfilled) > 0 && (
                        <p className="text-xs text-green-600">{Number(line.quantity_fulfilled).toLocaleString()} moved</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {detail.status === 'pending' && (
                <div className="flex justify-end gap-2 pt-2">
                  {(String(detail.requested_by) === String(user?.id) || user?.role === 'admin') && (
                    <Button variant="outline" onClick={() => cancel(detail)} disabled={processingId === detail.id}>Cancel</Button>
                  )}
                  <Button variant="outline" className="text-red-600" onClick={() => reject(detail)} disabled={processingId === detail.id}>Reject</Button>
                  <Button onClick={() => approve(detail)} disabled={processingId === detail.id}>
                    {processingId === detail.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    Approve & Move Stock
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {promptDialog}
      {confirmDialog}
    </AppLayout>
  );
}
