import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { useConfirm } from '@/hooks/useConfirm';
import { FlaskConical, Edit, Trash2, X, Check, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface LinkRow {
  id: string;
  lab_test_id: string;
  test_name: string;
  test_code: string;
  inventory_item_id: string;
  item_name: string;
  item_code: string;
  unit_of_measure: string;
  quantity_on_hand: number;
  tests_per_unit: number;
  tests_remaining: number;
  location_id: string | null;
  location_name: string | null;
  is_active: boolean;
  notes: string | null;
}

interface LabTest { id: string; test_name: string; test_code: string; }
interface InventoryItem { id: string; item_name: string; item_code: string; unit_of_measure: string; quantity_on_hand: number; }
interface StockLocation { id: string; location_name: string; }

const empty = { lab_test_id: '', inventory_item_id: '', location_id: '', tests_per_unit: '', notes: '' };

export default function LabTestConsumables() {
  const confirm = useConfirm();
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(empty);

  const [itemsLoading, setItemsLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [linksRes, testsRes, locsRes] = await Promise.all([
        authFetch('/api/inventory/lab-test-consumables', { credentials: 'include' }),
        authFetch('/api/lab-tests', { credentials: 'include' }),
        authFetch('/api/inventory/locations', { credentials: 'include' }),
      ]);
      if (linksRes.ok) setLinks(await linksRes.json());
      if (testsRes.ok) setLabTests(await testsRes.json());
      if (locsRes.ok) setLocations(await locsRes.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to load lab test consumables');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Items are specific to whichever store the reagent/kit actually sits in —
  // picking the location first and loading only what's stocked there means
  // you're never offered an item you'd then have to go hunt down.
  useEffect(() => {
    if (!formData.location_id) { setItems([]); return; }
    setItemsLoading(true);
    authFetch(`/api/inventory/items?location_id=${formData.location_id}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => setItems(Array.isArray(data) ? data : data.items || []))
      .catch(() => setItems([]))
      .finally(() => setItemsLoading(false));
  }, [formData.location_id]);

  const testOptions = useMemo(() => labTests.map(t => ({ value: t.id, label: `${t.test_name} (${t.test_code})` })), [labTests]);
  const itemOptions = useMemo(() => items.map(i => ({ value: i.id, label: `${i.item_name} — ${Number(i.quantity_on_hand || 0).toLocaleString()} ${i.unit_of_measure || ''} on hand` })), [items]);
  const locationOptions = useMemo(() => locations.map(l => ({ value: l.id, label: l.location_name })), [locations]);

  const openCreate = () => { setEditingId(null); setFormData(empty); };
  const openEdit = (row: LinkRow) => {
    setEditingId(row.id);
    setFormData({
      lab_test_id: row.lab_test_id, inventory_item_id: row.inventory_item_id,
      location_id: row.location_id || '', tests_per_unit: String(row.tests_per_unit), notes: row.notes || '',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const testsPerUnit = parseFloat(formData.tests_per_unit);
    if (!formData.location_id || !formData.lab_test_id || !formData.inventory_item_id || !testsPerUnit || testsPerUnit <= 0) {
      toast.error('Pick a storage location, a test, an item, and a positive "tests per unit"');
      return;
    }
    setSaving(true);
    try {
      const url = editingId ? `/api/inventory/lab-test-consumables/${editingId}` : '/api/inventory/lab-test-consumables';
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId
        ? { tests_per_unit: testsPerUnit, location_id: formData.location_id || null, notes: formData.notes }
        : { ...formData, tests_per_unit: testsPerUnit, location_id: formData.location_id || null };
      const res = await authFetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save link');
      toast.success(editingId ? 'Link updated' : 'Link created');
      openCreate();
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save link');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Remove this link?',
      description: 'The test will no longer deplete this item or check its stock.',
      confirmLabel: 'Remove link',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await authFetch(`/api/inventory/lab-test-consumables/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete');
      toast.success('Link removed');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete link');
    }
  };

  const toggleActive = async (row: LinkRow) => {
    try {
      const res = await authFetch(`/api/inventory/lab-test-consumables/${row.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ is_active: !row.is_active }),
      });
      if (!res.ok) throw new Error('Failed to update');
      load();
    } catch {
      toast.error('Failed to update link');
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
          <PageHeader title="Lab Test Consumables" icon={<FlaskConical />} className="mb-3" />
          <p className="text-sm text-muted-foreground -mt-2 mb-3">
            Optionally link a reagent or kit to a lab test with its yield (e.g. 200 tests per 200ml reagent box, or 1 test per rapid-test kit).
            Every time that test is performed, this quantity is deducted automatically — and once it can't cover one more test, the test shows as unavailable when billing a patient.
          </p>

          <div className="bg-card rounded-lg border shadow-sm overflow-hidden mb-6">
            <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
              <h3 className="font-medium flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-primary" />
                {editingId ? 'Edit Link' : 'New Link'}
              </h3>
              {editingId && (
                <Button variant="ghost" size="sm" onClick={openCreate}>
                  <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                </Button>
              )}
            </div>
            <form onSubmit={handleSubmit}>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">1. Storage Location</label>
                  <Combobox
                    options={locationOptions}
                    value={formData.location_id}
                    onChange={v => setFormData({ ...formData, location_id: v, inventory_item_id: '' })}
                    placeholder="Pick a store first..."
                    searchPlaceholder="Search..."
                    className="mt-1 h-9"
                    disabled={!!editingId}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">2. Lab Test</label>
                  <Combobox
                    options={testOptions}
                    value={formData.lab_test_id}
                    onChange={v => setFormData({ ...formData, lab_test_id: v })}
                    searchPlaceholder="Search tests..."
                    className="mt-1 h-9"
                    disabled={!!editingId}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">3. Reagent / Kit</label>
                  <Combobox
                    options={itemOptions}
                    value={formData.inventory_item_id}
                    onChange={v => setFormData({ ...formData, inventory_item_id: v })}
                    placeholder={!formData.location_id ? 'Pick a location first...' : itemsLoading ? 'Loading...' : 'Select item...'}
                    searchPlaceholder="Search items..."
                    className="mt-1 h-9"
                    disabled={!!editingId || !formData.location_id || itemsLoading}
                  />
                  {!formData.location_id && !editingId && (
                    <p className="text-xs text-muted-foreground mt-1">Only items actually stocked at the chosen location will be listed here.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Tests per Unit</label>
                  <Input
                    type="number" min="0" step="any" required
                    value={formData.tests_per_unit}
                    onChange={e => setFormData({ ...formData, tests_per_unit: e.target.value })}
                    placeholder="e.g. 200"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Notes</label>
                  <Input value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Optional" className="mt-1" />
                </div>
              </div>
              <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  {saving ? 'Saving...' : editingId ? 'Update Link' : 'Create Link'}
                </Button>
              </div>
            </form>
          </div>

          <div className="flex-1 min-h-0">
            <AdvancedDataTable<LinkRow>
              data={links}
              loading={loading}
              loadingMessage="Loading links..."
              emptyMessage="No lab tests are linked to a consumable yet — add one above."
              keyExtractor={(row) => row.id}
              searchable
              searchPlaceholder="Search..."
              pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
              toolbarExtra={
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              }
              columns={[
                { key: 'test_name', header: 'Test', sortable: true, render: (v, row) => <div><p className="font-medium">{v}</p><p className="text-xs text-muted-foreground font-mono">{row.test_code}</p></div> },
                { key: 'item_name', header: 'Reagent / Kit', render: (v, row) => <div><p>{v}</p><p className="text-xs text-muted-foreground font-mono">{row.item_code}</p></div> },
                { key: 'location_name', header: 'Location', render: (v) => v || <span className="text-muted-foreground">Any</span> },
                { key: 'tests_per_unit', header: 'Tests/Unit', align: 'right', render: (v) => Number(v).toLocaleString() },
                {
                  key: 'tests_remaining', header: 'Tests Remaining', align: 'right', sortable: true,
                  render: (v) => {
                    const n = Number(v || 0);
                    return (
                      <span className={`font-semibold inline-flex items-center gap-1 ${n <= 0 ? 'text-red-600' : n < 10 ? 'text-amber-600' : 'text-foreground'}`}>
                        {n <= 0 && <AlertTriangle className="w-3.5 h-3.5" />} {n.toLocaleString()}
                      </span>
                    );
                  },
                },
                {
                  key: 'is_active', header: 'Active', align: 'center',
                  render: (v, row) => (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleActive(row); }}
                      className={`relative w-9 h-5 rounded-full transition-colors ${v ? 'bg-primary' : 'bg-muted'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform ${v ? 'translate-x-4' : ''}`} />
                    </button>
                  ),
                },
                {
                  key: 'id', header: 'Actions', align: 'center',
                  render: (_v, row) => (
                    <div className="flex items-center justify-center gap-1">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(row); }}>
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
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
