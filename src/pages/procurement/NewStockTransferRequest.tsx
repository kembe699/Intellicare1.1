import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRightLeft, Plus, Trash2, Check, Loader2 } from 'lucide-react';

interface StockLocation { id: string; location_name: string; location_type: string; department_name: string | null; }
interface LocationItem { id: string; item_name: string; item_code: string; unit_of_measure: string; quantity_on_hand: number; }
interface RequestLine { inventory_item_id: string; quantity_requested: string; notes: string }

const emptyLine = (): RequestLine => ({ inventory_item_id: '', quantity_requested: '', notes: '' });

export default function NewStockTransferRequest() {
  const navigate = useNavigate();

  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<RequestLine[]>([emptyLine()]);
  const [sourceItems, setSourceItems] = useState<LocationItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    authFetch('/api/stock-transfers/locations', { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => setLocations(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load storage locations'));
  }, []);

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
      navigate('/procurement/stock-transfers');
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)]">
        <div className="max-w-3xl mx-auto w-full">
          <PageHeader
            title="New Transfer Request"
            icon={<ArrowRightLeft />}
            className="mb-3"
            breadcrumbs={[
              { label: 'Stock Transfer Requests', href: '/procurement/stock-transfers' },
              { label: 'New Request' },
            ]}
            actions={
              <Button variant="outline" onClick={() => navigate('/procurement/stock-transfers')}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to List
              </Button>
            }
          />

          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
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
                  <p className="text-xs text-muted-foreground mt-1 mb-2">Pick a source store above to see what it has in stock.</p>
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
        </div>
      </div>
    </AppLayout>
  );
}
