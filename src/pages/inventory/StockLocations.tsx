import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MapPin, Edit, Search, Eye, RefreshCw, Warehouse, X, Check, Loader2, Package, Beaker, Pill, Stethoscope } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface StockLocation {
  id: string;
  location_code: string;
  location_name: string;
  location_type: string;
  address: string;
  is_active: boolean;
  capacity_description: string;
  item_count: number;
  total_stock: number;
}

const LOCATION_TYPES = ['warehouse', 'pharmacy', 'laboratory', 'clinic', 'storage'];
const LOCATION_TYPE_OPTIONS = LOCATION_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));

const TypeIcon = ({ type, className = "w-6 h-6" }: { type: string, className?: string }) => {
  switch (type) {
    case 'warehouse': return <Warehouse className={className} />;
    case 'pharmacy': return <Pill className={className} />;
    case 'laboratory': return <Beaker className={className} />;
    case 'clinic': return <Stethoscope className={className} />;
    case 'storage': return <Package className={className} />;
    default: return <Package className={className} />;
  }
};

export default function StockLocations() {
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const clinicId = user?.clinic || 1;

  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editingLocation, setEditingLocation] = useState<StockLocation | null>(null);
  const [formData, setFormData] = useState({ location_code: '', location_name: '', location_type: 'warehouse', address: '', capacity_description: '' });
  const [saving, setSaving] = useState(false);

  const [selectedLocation, setSelectedLocation] = useState<StockLocation | null>(null);
  const [locationStock, setLocationStock] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  useEffect(() => { fetchLocations(); }, []);

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/inventory/locations?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setLocations(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch locations');
    } finally {
      setLoading(false);
    }
  };

  const filteredLocations = useMemo(() => locations.filter(loc => {
    const q = search.toLowerCase();
    return !q || loc.location_name?.toLowerCase().includes(q) || loc.location_code?.toLowerCase().includes(q);
  }), [locations, search]);

  const openCreate = () => {
    setEditingLocation(null);
    setFormData({ location_code: '', location_name: '', location_type: 'warehouse', address: '', capacity_description: '' });
  };

  const openEdit = (loc: StockLocation) => {
    setEditingLocation(loc);
    setFormData({
      location_code: loc.location_code, location_name: loc.location_name,
      location_type: loc.location_type || 'warehouse', address: loc.address || '',
      capacity_description: loc.capacity_description || '',
    });
  };

  const viewStock = async (loc: StockLocation) => {
    setSelectedLocation(loc);
    setStockLoading(true);
    try {
      const res = await authFetch(`/api/inventory/locations/${loc.id}/stock`, { credentials: 'include' });
      if (res.ok) setLocationStock(await res.json());
    } catch {
      toast.error('Failed to load stock');
    } finally {
      setStockLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!formData.location_code || !formData.location_name) { toast.error('Code and name are required'); return; }
    setSaving(true);
    try {
      const url = editingLocation ? `/api/inventory/locations/${editingLocation.id}` : '/api/inventory/locations';
      const method = editingLocation ? 'PUT' : 'POST';
      const res = await authFetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...formData, clinic_id: clinicId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save location');
      toast.success(editingLocation ? 'Location updated' : 'Location created');
      openCreate();
      fetchLocations();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save location');
    } finally {
      setSaving(false);
    }
  };

  const totalQty = locationStock.reduce((s, i) => s + (parseFloat(i.quantity_on_hand) || 0), 0);
  const totalValue = locationStock.reduce((s, i) => s + (parseFloat(i.stock_value) || 0), 0);

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
        <PageHeader title="Stock Locations" icon={<MapPin />} className="mb-3" />

        {/* Form above, table below — the layout used across the rest of the
            system, rather than this page's own side-by-side arrangement. */}
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden mb-6">
          <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
            <h3 className="font-medium flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              {editingLocation ? `Edit — ${editingLocation.location_name}` : 'New Stock Location'}
            </h3>
            {editingLocation && (
              <Button variant="ghost" size="sm" onClick={openCreate}>
                <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
              </Button>
            )}
          </div>
          <form onSubmit={handleSubmit}>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Location Code</label>
                <Input required disabled={!!editingLocation} value={formData.location_code} onChange={e => setFormData({ ...formData, location_code: e.target.value })} placeholder="e.g. MAIN-WH" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Location Name</label>
                <Input required value={formData.location_name} onChange={e => setFormData({ ...formData, location_name: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <Combobox
                  options={LOCATION_TYPE_OPTIONS}
                  value={formData.location_type}
                  onChange={v => setFormData({ ...formData, location_type: v })}
                  searchPlaceholder="Search..."
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Capacity Description</label>
                <Input value={formData.capacity_description} onChange={e => setFormData({ ...formData, capacity_description: e.target.value })} placeholder="e.g. 500 sq ft cold storage" className="mt-1" />
              </div>
              <div className="md:col-span-2 lg:col-span-4">
                <label className="text-xs font-medium text-muted-foreground">Address</label>
                <textarea
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  className="w-full mt-1 p-3 border border-input rounded-md resize-none h-16 text-sm bg-background shadow-sm"
                />
              </div>
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {saving ? (editingLocation ? 'Updating...' : 'Creating...') : `${editingLocation ? 'Update' : 'Create'} Location`}
              </Button>
            </div>
          </form>
        </div>

        <div className="flex-1 min-h-0">
          <AdvancedDataTable<any>
            data={filteredLocations}
            loading={loading}
            loadingMessage="Loading locations..."
            emptyMessage="No stock locations yet — add one above."
            keyExtractor={(row) => row.id}
            searchable
            searchPlaceholder="Search locations..."
            exportable
            exportFileName="stock-locations"
            pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
            toolbarExtra={
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchLocations} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            }
            columns={[
              {
                key: 'location_name', header: 'Location', sortable: true,
                render: (v, row) => (
                  <div className="flex items-center gap-2.5">
                    <TypeIcon type={row.location_type} className="w-4 h-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{v}</p>
                      <p className="text-xs text-muted-foreground font-mono">{row.location_code}</p>
                    </div>
                  </div>
                ),
              },
              { key: 'location_type', header: 'Type', sortable: true, render: (v) => <span className="capitalize">{v}</span> },
              { key: 'address', header: 'Address', render: (v) => v || '—' },
              { key: 'item_count', header: 'Items', align: 'right', sortable: true, render: (v) => Number(v || 0).toLocaleString() },
              { key: 'total_stock', header: 'Units', align: 'right', sortable: true, render: (v) => Number(v || 0).toLocaleString() },
              { key: 'stock_value', header: 'Stock Value', align: 'right', sortable: true, render: (v) => fmt(parseFloat(v) || 0) },
              {
                key: 'id', header: 'Actions', align: 'center',
                render: (_v, row) => (
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); viewStock(row); }}>
                      <Eye className="w-3.5 h-3.5 mr-1" /> Stock
                    </Button>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(row); }}>
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
      </div>

      {/* Location Stock Modal */}
      {selectedLocation && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-2xl rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg">Stock at {selectedLocation.location_name}</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedLocation(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 flex-1 overflow-auto">
              {stockLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div>
                  <AdvancedDataTable<any>
                    data={locationStock}
                    keyExtractor={(s, idx) => s.item_code || idx}
                    emptyMessage="No stock at this location."
                    columns={[
                      { key: 'item_code', header: 'Code', render: (v) => <span className="font-mono text-xs">{v}</span> },
                      { key: 'item_name', header: 'Item' },
                      { key: 'item_category', header: 'Category', render: (v) => <span className="capitalize text-muted-foreground">{v}</span> },
                      { key: 'quantity_on_hand', header: 'Qty', align: 'right' },
                      { key: 'average_unit_cost', header: 'Unit Cost', align: 'right', render: (v) => <span className="font-mono">{fmt(v)}</span> },
                      { key: 'stock_value', header: 'Value', align: 'right', render: (v) => <span className="font-mono">{fmt(v)}</span> },
                    ]}
                  />
                  {locationStock.length > 0 && (
                    <div className="border border-t-0 border-border rounded-b-md bg-muted/20 -mt-px px-3 py-2 flex justify-between text-sm font-semibold">
                      <span>Total:</span>
                      <span className="font-mono">{totalQty} units · {fmt(totalValue)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end">
              <Button onClick={() => setSelectedLocation(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
