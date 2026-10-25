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
import { cn } from '@/lib/utils';
import { MapPin, Edit, Search, RefreshCw, Warehouse, X, Check, Loader2 } from 'lucide-react';
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
  department_id?: string | null;
  department_name?: string | null;
  is_default_selling?: boolean;
}

interface Department {
  id: string;
  department_name: string;
  department_code: string;
}

const LOCATION_TYPES = ['warehouse', 'pharmacy', 'laboratory', 'clinic', 'storage', 'theatre'];
const LOCATION_TYPE_OPTIONS = LOCATION_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));

export default function StockLocations() {
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const clinicId = user?.clinic || 1;

  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editingLocation, setEditingLocation] = useState<StockLocation | null>(null);
  const [formData, setFormData] = useState({ location_code: '', location_name: '', location_type: 'warehouse', address: '', capacity_description: '', department_id: '' });
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);


  useEffect(() => {
    fetchLocations();
    authFetch('/api/departments', { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => setDepartments(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

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
    setFormData({ location_code: '', location_name: '', location_type: 'warehouse', address: '', capacity_description: '', department_id: '' });
  };

  const openEdit = (loc: StockLocation) => {
    setEditingLocation(loc);
    setFormData({
      location_code: loc.location_code, location_name: loc.location_name,
      location_type: loc.location_type || 'warehouse', address: loc.address || '',
      capacity_description: loc.capacity_description || '', department_id: loc.department_id || '',
    });
  };

  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const setDefaultSelling = async (loc: StockLocation) => {
    if (settingDefault) return;
    setSettingDefault(loc.id);
    try {
      const res = await authFetch(`/api/inventory/locations/${loc.id}/default-selling`, { method: 'PUT', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not set the selling store');
      toast.success(`${loc.location_name} is now the default selling store`);
      setLocations((ls) => ls.map((l) => ({ ...l, is_default_selling: l.id === loc.id })));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSettingDefault(null);
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
              <div>
                <label className="text-xs font-medium text-muted-foreground">Work Station / Department</label>
                <Combobox
                  options={[{ value: '', label: '— None —' }, ...departments.map(d => ({ value: d.id, label: d.department_name }))]}
                  value={formData.department_id}
                  onChange={v => setFormData({ ...formData, department_id: v })}
                  searchPlaceholder="Search..."
                  className="mt-1 h-9"
                />
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
              <Button variant="outline" size="icon" aria-label="Refresh" className="h-9 w-9" onClick={fetchLocations} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            }
            columns={[
              {
                key: 'location_name', header: 'Location', sortable: true,
                render: (v, row) => (
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {v}
                      {row.is_default_selling && (
                        <span className="ml-2 inline-flex items-center rounded-full border border-success-border bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success align-middle">
                          Default selling store
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{row.location_code}</p>
                  </div>
                ),
              },
              { key: 'location_type', header: 'Type', sortable: true, render: (v) => <span className="capitalize">{v}</span> },
              { key: 'department_name', header: 'Work Station', render: (v) => v || <span className="text-muted-foreground">—</span> },
              { key: 'address', header: 'Address', render: (v) => v || '—' },
              { key: 'item_count', header: 'Items', align: 'right', sortable: true, render: (v) => Number(v || 0).toLocaleString() },
              { key: 'total_stock', header: 'Units', align: 'right', sortable: true, render: (v) => Number(v || 0).toLocaleString() },
              { key: 'stock_value', header: 'Stock Value', align: 'right', sortable: true, render: (v) => fmt(parseFloat(v) || 0) },
              {
                key: 'id', header: 'Actions', align: 'center',
                render: (_v, row) => (
                  <div className="flex items-center justify-center gap-1">
                    {!row.is_default_selling && row.is_active !== false && (
                      <Button size="sm" variant="outline" disabled={settingDefault === row.id}
                        title="Products are sold, prescribed and dispensed from this store unless someone picks another"
                        onClick={(e) => { e.stopPropagation(); setDefaultSelling(row); }}>
                        {settingDefault === row.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                        Set as default selling store
                      </Button>
                    )}
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

    </AppLayout>
  );
}
