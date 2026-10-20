import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { ArrowLeft, Package, RefreshCw, MinusCircle, X, Check, Loader2 } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface StockLocation { id: string; location_name: string; location_type: string; department_name: string | null; }
interface LocationItem { id: string; item_name: string; item_code: string; item_category: string; unit_of_measure: string; quantity_on_hand: number; }

export default function StoreStock() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationId, setLocationId] = useState('');
  const [items, setItems] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [consuming, setConsuming] = useState<LocationItem | null>(null);
  const [consumeQty, setConsumeQty] = useState('');
  const [consumeNotes, setConsumeNotes] = useState('');
  const [submittingConsume, setSubmittingConsume] = useState(false);

  useEffect(() => {
    authFetch('/api/stock-transfers/locations', { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => setLocations(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load storage locations'));
  }, []);

  const load = () => {
    if (!locationId) { setItems([]); return; }
    setLoading(true);
    authFetch(`/api/stock-transfers/locations/${locationId}/items`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => { setItems([]); toast.error('Failed to load stock for this store'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [locationId]);

  const locationOptions = useMemo(() => locations.map(l => ({
    value: l.id, label: l.department_name ? `${l.location_name} (${l.department_name})` : l.location_name,
  })), [locations]);

  const openConsume = (item: LocationItem) => {
    setConsuming(item);
    setConsumeQty('');
    setConsumeNotes('');
  };

  const submitConsume = async () => {
    if (!consuming) return;
    const qty = parseFloat(consumeQty);
    if (!qty || qty <= 0) {
      toast.error('Enter a positive quantity');
      return;
    }
    setSubmittingConsume(true);
    try {
      const res = await authFetch(`/api/stock-transfers/locations/${locationId}/consume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ inventory_item_id: consuming.id, quantity: qty, notes: consumeNotes || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to record usage');
      toast.success(`Recorded ${qty} ${consuming.unit_of_measure} of ${consuming.item_name} used`);
      setConsuming(null);
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to record usage');
    } finally {
      setSubmittingConsume(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="max-w-[1200px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
          <PageHeader
            title="Store Stock"
            icon={<Package />}
            className="mb-3"
            breadcrumbs={[
              { label: 'Stock Transfer Requests', href: '/procurement/stock-transfers' },
              { label: 'Store Stock' },
            ]}
            actions={
              <Button variant="outline" onClick={() => navigate('/procurement/stock-transfers')}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to List
              </Button>
            }
          />
          <p className="text-sm text-muted-foreground -mt-2 mb-3">
            Pick any store to see exactly what it has on hand right now — useful before deciding where to request items from,
            and to record usage as items are consumed at your own store.
          </p>

          <div className="w-80 mb-4">
            <label className="text-xs font-medium text-muted-foreground">Store</label>
            <Combobox
              options={locationOptions}
              value={locationId}
              onChange={v => { setLocationId(v); setConsuming(null); }}
              placeholder="Select a store..."
              searchPlaceholder="Search stores..."
              className="mt-1 h-9"
            />
          </div>

          {consuming && (
            <div className="bg-card rounded-lg border shadow-sm p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium flex items-center gap-2">
                  <MinusCircle className="w-4 h-4 text-primary" /> Record Usage — {consuming.item_name}
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setConsuming(null)}>
                  <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Quantity used ({consuming.unit_of_measure}, {consuming.quantity_on_hand.toLocaleString()} available)</label>
                  <Input
                    type="number" min="0" step="any" autoFocus
                    value={consumeQty}
                    onChange={e => setConsumeQty(e.target.value)}
                    placeholder="e.g. 5"
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                  <Input
                    value={consumeNotes}
                    onChange={e => setConsumeNotes(e.target.value)}
                    placeholder="What was it used for?"
                    className="mt-1 h-9"
                  />
                </div>
                <Button onClick={submitConsume} disabled={submittingConsume}>
                  {submittingConsume ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  Record Usage
                </Button>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0">
            <AdvancedDataTable<LocationItem>
              data={items}
              loading={loading}
              loadingMessage="Loading stock..."
              emptyMessage={locationId ? 'This store has no stock on hand.' : 'Select a store above to see what it has in stock.'}
              keyExtractor={(row) => row.id}
              searchable
              searchPlaceholder="Search items..."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              toolbarExtra={
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} disabled={loading || !locationId}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              }
              columns={[
                { key: 'item_name', header: 'Item', sortable: true, render: (v, row) => <div><p className="font-medium">{v}</p><p className="text-xs text-muted-foreground font-mono">{row.item_code}</p></div> },
                { key: 'item_category', header: 'Category', render: (v) => v || '—' },
                { key: 'quantity_on_hand', header: 'Qty on Hand', align: 'right', sortable: true, render: (v, row) => <span className="font-semibold">{Number(v).toLocaleString()} {row.unit_of_measure}</span> },
                {
                  key: 'id', header: 'Actions', align: 'center',
                  render: (_v, row) => (
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openConsume(row); }}>
                      <MinusCircle className="w-3.5 h-3.5 mr-1.5" /> Record Usage
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
