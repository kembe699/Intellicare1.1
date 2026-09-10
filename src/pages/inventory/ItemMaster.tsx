import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import {
  Package, Edit, Search, Eye, RefreshCw, Download, Upload, FileSpreadsheet,
  X, Check, Loader2, Layers, Calendar, MapPin, Percent, Barcode,
} from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface InventoryItem {
  id: string;
  item_code: string;
  barcode: string;
  item_name: string;
  item_description: string;
  item_category: string;
  item_type: string;
  unit_of_measure: string;
  quantity_on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
  minimum_stock_level: number;
  maximum_stock_level: number;
  reorder_quantity: number;
  lead_time_days: number;
  inventory_valuation_method: string;
  current_unit_cost: number;
  average_unit_cost: number;
  selling_price: number;
  cost_currency: string;
  requires_batch_tracking: boolean;
  requires_expiry_tracking: boolean;
  is_controlled_substance: boolean;
  is_active: boolean;
  preferred_supplier_id: number;
  preferred_supplier_name: string;
  active_batches: number;
  nearest_expiry: string;
  notes: string;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);

const CATEGORIES = ['drugs', 'consumables', 'equipment', 'supplies', 'reagents', 'surgical', 'general'];
const ITEM_TYPES = ['consumable', 'equipment', 'reagent', 'surgical', 'diagnostic'];
const CATEGORY_OPTIONS = CATEGORIES.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }));
const STOCK_FILTER_OPTIONS = [
  { value: 'all', label: 'All stock' }, { value: 'low', label: 'Low Stock' },
  { value: 'out', label: 'Out of Stock' }, { value: 'over', label: 'Over Stock' },
];

const UOM_OPTIONS = [
  { value: 'Tab', label: 'Tablet(s)' }, { value: 'Cap', label: 'Capsule(s)' },
  { value: 'Amp', label: 'Ampoule(s)' }, { value: 'Vial', label: 'Vial(s)' },
  { value: 'Bottle', label: 'Bottle(s)' }, { value: 'Sachet', label: 'Sachet(s)' },
  { value: 'Tube', label: 'Tube(s)' }, { value: 'Syringe', label: 'Syringe(s)' },
  { value: 'mL', label: 'Millilitre(s)' }, { value: 'L', label: 'Litre(s)' },
  { value: 'g', label: 'Gram(s)' }, { value: 'mg', label: 'Milligram(s)' },
  { value: 'mcg', label: 'Microgram(s)' }, { value: 'IU', label: 'International Units' },
  { value: 'U', label: 'Units' }, { value: 'Each', label: 'Each' },
  { value: 'Box', label: 'Box(es)' }, { value: 'Pack', label: 'Pack(s)' },
  { value: 'Strip', label: 'Strip(s)' }, { value: 'Dose', label: 'Dose(s)' },
  { value: 'Patch', label: 'Patch(es)' }, { value: 'Supp', label: 'Suppository/Suppositories' },
  { value: 'Drop', label: 'Drop(s)' }, { value: 'Puff', label: 'Puff(s) / Inhalation' },
  { value: 'Roll', label: 'Roll(s)' }, { value: 'Pair', label: 'Pair(s)' },
  { value: 'Set', label: 'Set(s)' }, { value: 'Piece', label: 'Piece(s)' },
];

const stockStatus = (item: InventoryItem) => {
  if (item.quantity_on_hand === 0) return { label: 'Out of Stock', className: 'bg-red-50 text-red-700 border-red-200' };
  if (item.minimum_stock_level > 0 && item.quantity_on_hand <= item.minimum_stock_level) return { label: 'Low Stock', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (item.maximum_stock_level > 0 && item.quantity_on_hand >= item.maximum_stock_level) return { label: 'Over Stock', className: 'bg-purple-50 text-purple-700 border-purple-200' };
  return { label: 'Normal', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
};

const generateItemCode = () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 900 + 100);
  return `ITM-${stamp}-${rand}`;
};

const generateBarcode = () => {
  // 12 digits + a mod-10 (Luhn) check digit — renders as a valid-looking EAN/CODE128 value.
  let digits = '';
  for (let i = 0; i < 12; i++) digits += Math.floor(Math.random() * 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i], 10) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return digits + check;
};

const emptyForm = (currencyCode: string) => ({
  item_code: generateItemCode(), barcode: '', item_name: '', item_description: '', item_category: 'general',
  item_type: 'consumable', unit_of_measure: 'Each', reorder_unit: 'Each',
  conversion_factor: 1, minimum_stock_level: 0, maximum_stock_level: 0,
  reorder_quantity: 0, lead_time_days: 7, inventory_valuation_method: 'weighted_average',
  current_unit_cost: 0, selling_price: 0, cost_currency: currencyCode,
  requires_batch_tracking: false, requires_expiry_tracking: false,
  is_controlled_substance: false, preferred_supplier_id: '', notes: '',
  initial_quantity: 0, location_id: '', expiry_date: '',
});

export default function ItemMaster() {
  const { user } = useAuth();
  const { currency } = useCurrency();
  const clinicId = user?.clinic || 1;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');

  const [locations, setLocations] = useState<any[]>([]);
  // Items are shown for one store location at a time, chosen first.
  //
  // Stock only means anything somewhere: a catalogue-wide list mixes what is on
  // the pharmacy shelf with what is in the main store, and the quantity beside
  // each row then belongs to neither. Nothing loads until a location is picked,
  // so every number on the page refers to the same shelf.
  const [viewLocationId, setViewLocationId] = useState('');

  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState(emptyForm(currency.code));
  const [saving, setSaving] = useState(false);

  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showPriceAdjustment, setShowPriceAdjustment] = useState(false);
  const [priceAdjForm, setPriceAdjForm] = useState({ mode: 'percentage' as 'percentage' | 'rate', percentage: '', direction: 'increase' as 'increase' | 'decrease', newRate: '', category: '' });
  const [applyingPriceAdj, setApplyingPriceAdj] = useState(false);
  const [currentExchangeRate, setCurrentExchangeRate] = useState<number | null>(null);

  useEffect(() => { fetchLocations(); fetchCurrentExchangeRate(); }, []);
  // Re-fetch whenever the chosen location changes; nothing is loaded until one is.
  useEffect(() => {
    if (!viewLocationId) { setItems([]); return; }
    fetchItems();
  }, [viewLocationId]);

  const fetchCurrentExchangeRate = async () => {
    try {
      const res = await authFetch('/api/exchange-rates/rates?from_currency=USD&to_currency=SSP', { credentials: 'include' });
      if (res.ok) {
        const { data } = await res.json();
        if (data?.[0]) setCurrentExchangeRate(parseFloat(data[0].effective_rate));
      }
    } catch (e) { /* rate display is best-effort */ }
  };

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/inventory/items?clinic_id=${clinicId}&is_active=true&location_id=${encodeURIComponent(viewLocationId)}`,
        { credentials: 'include' }
      );
      if (res.ok) setItems(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch items');
    } finally {
      setLoading(false);
    }
  };

  const fetchLocations = async () => {
    try {
      const res = await authFetch(`/api/inventory/locations?clinic_id=${clinicId}`, { credentials: 'include' });
      if (!res.ok) return;
      const rows = await res.json();
      setLocations(rows);
      // A facility with one store has nothing to choose between, but the
      // directory still opened empty behind a "choose a location" prompt and a
      // dropdown holding a single option. Pick it, and the items are simply
      // there. Anywhere with a real choice is left to make it.
      const usable = rows.filter((l: any) => l.is_active !== false);
      if (usable.length === 1) {
        setViewLocationId((current: string) => current || String(usable[0].id));
      }
    } catch (e) {
      console.error('Failed to fetch locations', e);
    }
  };

  const filteredItems = useMemo(() => items.filter(item => {
    const q = search.toLowerCase();
    const matchesSearch = !q || item.item_name?.toLowerCase().includes(q) || item.item_code?.toLowerCase().includes(q);
    const matchesCategory = categoryFilter === 'all' || item.item_category === categoryFilter;
    let matchesStock = true;
    if (stockFilter === 'low') matchesStock = item.quantity_on_hand <= item.minimum_stock_level;
    else if (stockFilter === 'out') matchesStock = item.quantity_on_hand === 0;
    else if (stockFilter === 'over') matchesStock = item.maximum_stock_level > 0 && item.quantity_on_hand >= item.maximum_stock_level;
    return matchesSearch && matchesCategory && matchesStock;
  }), [items, search, categoryFilter, stockFilter]);


  const openCreate = () => {
    setEditingItem(null);
    setFormData(emptyForm(currency.code));
  };

  const openEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setFormData({
      item_code: item.item_code || '', barcode: item.barcode || '', item_name: item.item_name || '',
      item_description: item.item_description || '', item_category: item.item_category || 'general',
      item_type: item.item_type || 'consumable', unit_of_measure: item.unit_of_measure || 'Each',
      reorder_unit: item.unit_of_measure || 'Each', conversion_factor: 1,
      minimum_stock_level: item.minimum_stock_level || 0, maximum_stock_level: item.maximum_stock_level || 0,
      reorder_quantity: item.reorder_quantity || 0, lead_time_days: item.lead_time_days || 7,
      inventory_valuation_method: item.inventory_valuation_method || 'weighted_average',
      current_unit_cost: item.current_unit_cost || 0, selling_price: item.selling_price || 0,
      cost_currency: item.cost_currency || currency.code,
      requires_batch_tracking: !!item.requires_batch_tracking,
      requires_expiry_tracking: !!item.requires_expiry_tracking,
      is_controlled_substance: !!item.is_controlled_substance,
      preferred_supplier_id: item.preferred_supplier_id ? String(item.preferred_supplier_id) : '',
      notes: item.notes || '', initial_quantity: 0, location_id: '', expiry_date: '',
    });
  };

  const viewItem = async (item: InventoryItem) => {
    setSelectedItem(item);
    setDetailLoading(true);
    try {
      const res = await authFetch(`/api/inventory/items/${item.id}`, { credentials: 'include' });
      if (res.ok) setSelectedItem(await res.json());
    } catch {
      toast.error('Failed to load item details');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!formData.item_code || !formData.item_name) { toast.error('Item code and name are required'); return; }

    setSaving(true);
    try {
      const url = editingItem ? `/api/inventory/items/${editingItem.id}` : '/api/inventory/items';
      const method = editingItem ? 'PUT' : 'POST';
      const res = await authFetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...formData, clinic_id: clinicId, created_by: user?.uid }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save item');
      }
      const created = await res.json();

      if (formData.initial_quantity > 0) {
        const today = new Date().toISOString().split('T')[0];
        const itemId = editingItem ? editingItem.id : created.id;
        const prefix = editingItem ? 'RECV' : 'OPEN';
        await authFetch('/api/inventory/batches', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({
            clinic_id: clinicId, item_id: itemId, batch_number: `${prefix}-${formData.item_code}-${today}`,
            quantity_received: formData.initial_quantity, unit_cost: formData.current_unit_cost || 0,
            cost_currency: formData.cost_currency, location_id: formData.location_id || null,
            expiry_date: formData.expiry_date || null, receipt_date: today, notes: 'Opening stock',
          }),
        });
      }

      toast.success(editingItem ? 'Item updated' : 'Item created');
      openCreate();
      fetchItems();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  const exportCSV = () => {
    const headers = ['item_code', 'barcode', 'item_name', 'item_description', 'item_category', 'item_type', 'unit_of_measure',
      'minimum_stock_level', 'maximum_stock_level', 'reorder_quantity', 'lead_time_days', 'current_unit_cost',
      'selling_price', 'cost_currency', 'requires_batch_tracking', 'requires_expiry_tracking', 'is_controlled_substance', 'notes'];
    const rows = filteredItems.map(i => [
      i.item_code, i.barcode || '', i.item_name, i.item_description || '', i.item_category, i.item_type, i.unit_of_measure,
      i.minimum_stock_level ?? 0, i.maximum_stock_level ?? 0, i.reorder_quantity ?? 0, i.lead_time_days ?? 7,
      i.current_unit_cost ?? 0, i.selling_price ?? 0, i.cost_currency || currency.code,
      i.requires_batch_tracking ? 'true' : 'false', i.requires_expiry_tracking ? 'true' : 'false',
      i.is_controlled_substance ? 'true' : 'false', i.notes || '',
    ]);
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inventory_items_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredItems.length} items`);
  };

  const downloadTemplate = () => {
    const headers = ['item_code', 'item_name', 'item_description', 'item_category', 'item_type', 'unit_of_measure',
      'minimum_stock_level', 'maximum_stock_level', 'reorder_quantity', 'lead_time_days', 'current_unit_cost',
      'selling_price', 'cost_currency', 'requires_batch_tracking', 'requires_expiry_tracking',
      'is_controlled_substance', 'initial_quantity', 'expiry_date', 'notes'];
    const exampleRow = ['PARA500', 'Paracetamol 500mg', 'Pain relief medication', 'drugs', 'consumable', 'Tab',
      '100', '1000', '500', '7', '0.50', '1.00', currency.code, 'false', 'true', 'false', '500', '2026-12-31', 'Common pain reliever'];
    const csv = [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'drug_upload_template.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  };

  const handleBulkUpload = async () => {
    if (uploading) return;
    if (!uploadFile) { toast.error('Select a file to upload'); return; }
    setUploading(true);
    try {
      const csvText = await uploadFile.text();
      const res = await authFetch('/api/inventory/items/bulk-upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ csvData: csvText, clinic_id: clinicId }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(`Uploaded ${result.created || 0} items`);
        setShowBulkUpload(false);
        setUploadFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchItems();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to upload items');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload items');
    } finally {
      setUploading(false);
    }
  };

  const handleApplyPriceAdjustment = async () => {
    if (applyingPriceAdj) return;
    const scopeLabel = priceAdjForm.category ? `items in category "${priceAdjForm.category}"` : 'ALL active items';

    let body: any = { category: priceAdjForm.category || undefined, clinic_id: clinicId, mode: priceAdjForm.mode };
    let confirmMsg: string;

    if (priceAdjForm.mode === 'rate') {
      const rate = parseFloat(priceAdjForm.newRate);
      if (isNaN(rate) || rate <= 0) { toast.error('Enter a valid exchange rate greater than 0'); return; }
      body.new_rate = rate;
      confirmMsg = `Rebase the selling price of ${scopeLabel} from the current rate (1 USD = ${currentExchangeRate ?? '?'} SSP) to 1 USD = ${rate} SSP? This applies immediately and cannot be undone automatically.`;
    } else {
      const pct = parseFloat(priceAdjForm.percentage);
      if (isNaN(pct) || pct <= 0) { toast.error('Enter a valid percentage greater than 0'); return; }
      body.percentage = pct;
      body.direction = priceAdjForm.direction;
      confirmMsg = `${priceAdjForm.direction === 'increase' ? 'Increase' : 'Decrease'} the selling price of ${scopeLabel} by ${pct}%? This applies immediately and cannot be undone automatically.`;
    }

    if (!confirm(confirmMsg)) return;

    setApplyingPriceAdj(true);
    try {
      const res = await authFetch('/api/inventory/items/bulk-price-adjustment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(
          priceAdjForm.mode === 'rate'
            ? `Selling price rebased to 1 USD = ${result.newRate} SSP on ${result.affected_count} item(s)`
            : `Selling price ${priceAdjForm.direction}d by ${result.percentage}% on ${result.affected_count} item(s)`
        );
        setShowPriceAdjustment(false);
        setPriceAdjForm({ mode: 'percentage', percentage: '', direction: 'increase', newRate: '', category: '' });
        fetchItems();
        fetchCurrentExchangeRate();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to apply price adjustment');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to apply price adjustment');
    } finally {
      setApplyingPriceAdj(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1800px] mx-auto w-full flex flex-col">
        <PageHeader title="Item Master" icon={<Package />} className="mb-3" />

        <div className="flex flex-col gap-6">

          {/* TOP: Create/Edit form */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col">
            <div className="p-2.5 border-b bg-muted/30 flex justify-between items-center flex-shrink-0">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" /> {editingItem ? `Edit — ${editingItem.item_code}` : 'New Inventory Item'}
              </h3>
              {editingItem && (
                <Button variant="ghost" size="sm" onClick={openCreate}>
                  <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                </Button>
              )}
            </div>

            <form onSubmit={handleSubmit}>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 rounded-lg border p-2.5 bg-card">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Basic Information</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Item Code</label>
                        <div className="mt-0.5 flex gap-1">
                          <Input readOnly disabled={!!editingItem} value={formData.item_code} className="h-8 text-xs font-mono bg-muted/40" />
                          {!editingItem && (
                            <Button type="button" variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" title="Regenerate code" onClick={() => setFormData({ ...formData, item_code: generateItemCode() })}>
                              <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Category</label>
                        <Combobox
                          options={CATEGORY_OPTIONS}
                          value={formData.item_category}
                          onChange={v => setFormData({ ...formData, item_category: v })}
                          searchPlaceholder="Search categories..."
                          className="mt-0.5 h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><Barcode className="w-3 h-3" /> Barcode</label>
                      <div className="mt-0.5 flex gap-1">
                        <Input
                          value={formData.barcode}
                          onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                          placeholder="Scan, type, or generate..."
                          className="h-8 text-xs font-mono"
                        />
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" title="Generate barcode" onClick={() => setFormData({ ...formData, barcode: generateBarcode() })}>
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">Item Name</label>
                      <Input required value={formData.item_name} onChange={e => setFormData({ ...formData, item_name: e.target.value })} placeholder="Drug / item full name" className="mt-0.5 h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">Description</label>
                      <textarea
                        value={formData.item_description}
                        onChange={e => setFormData({ ...formData, item_description: e.target.value })}
                        placeholder="Strength, formulation, notes..."
                        className="w-full mt-0.5 p-2 border border-input rounded-md resize-none h-10 text-xs bg-background shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">Unit of Measure</label>
                      <Combobox
                        options={UOM_OPTIONS}
                        value={formData.unit_of_measure}
                        onChange={v => setFormData({ ...formData, unit_of_measure: v, reorder_unit: v })}
                        searchPlaceholder="Search units..."
                        className="mt-0.5 h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5 rounded-lg border p-2.5 bg-card">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pricing & Costing</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground">Unit Cost</label>
                          <Input type="number" step="0.01" min="0" value={formData.current_unit_cost} onChange={e => setFormData({ ...formData, current_unit_cost: parseFloat(e.target.value) || 0 })} className="mt-0.5 h-8 text-xs" />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground">Selling Price</label>
                          <Input type="number" step="0.01" min="0" value={formData.selling_price} onChange={e => setFormData({ ...formData, selling_price: parseFloat(e.target.value) || 0 })} className="mt-0.5 h-8 text-xs" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5 rounded-lg border p-2.5 bg-card">
                      <p className={`text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 ${editingItem ? 'text-emerald-700' : 'text-primary'}`}>
                        <Layers className="w-3.5 h-3.5" />
                        {editingItem ? `Add Stock Receipt${formData.initial_quantity > 0 ? ` — +${formData.initial_quantity} units` : ' (optional)'}` : 'Opening Stock'}
                      </p>
                      {editingItem && (
                        <p className="text-[11px] text-muted-foreground">Current on hand: <span className="font-semibold text-foreground">{editingItem.quantity_on_hand ?? 0} {editingItem.unit_of_measure}</span>. Enter a quantity to add a new batch receipt.</p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground">{editingItem ? 'Quantity to Add' : 'Quantity on Hand'}</label>
                          <Input type="number" min="0" value={formData.initial_quantity} onChange={e => setFormData({ ...formData, initial_quantity: parseInt(e.target.value) || 0 })} className="mt-0.5 h-8 text-xs" />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Expiry Date</label>
                          <Input type="date" value={formData.expiry_date} onChange={e => setFormData({ ...formData, expiry_date: e.target.value })} className="mt-0.5 h-8 text-xs" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> Storage Location</label>
                        <Combobox
                          options={[{ value: '', label: 'No specific location' }, ...locations.map((l: any) => ({ value: String(l.id), label: `${l.location_name}${l.location_code ? ` (${l.location_code})` : ''}` }))]}
                          value={formData.location_id}
                          onChange={v => setFormData({ ...formData, location_id: v })}
                          placeholder="No specific location"
                          searchPlaceholder="Search locations..."
                          className="mt-0.5 h-8 text-xs"
                        />
                        {locations.length === 0 && <p className="text-[11px] text-muted-foreground mt-0.5">No locations set up yet — add one in Stock Locations.</p>}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 rounded-lg border p-2.5 bg-card">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reorder Levels</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Min Stock Level</label>
                        <Input type="number" min="0" value={formData.minimum_stock_level} onChange={e => setFormData({ ...formData, minimum_stock_level: parseInt(e.target.value) || 0 })} className="mt-0.5 h-8 text-xs" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Max Stock Level</label>
                        <Input type="number" min="0" value={formData.maximum_stock_level} onChange={e => setFormData({ ...formData, maximum_stock_level: parseInt(e.target.value) || 0 })} className="mt-0.5 h-8 text-xs" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Reorder Qty</label>
                        <Input type="number" min="0" value={formData.reorder_quantity} onChange={e => setFormData({ ...formData, reorder_quantity: parseInt(e.target.value) || 0 })} className="mt-0.5 h-8 text-xs" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Lead Time (days)</label>
                        <Input type="number" min="0" value={formData.lead_time_days} onChange={e => setFormData({ ...formData, lead_time_days: parseInt(e.target.value) || 7 })} className="mt-0.5 h-8 text-xs" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 rounded-lg border p-2.5 bg-card">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tracking Flags</p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {[
                        { key: 'requires_batch_tracking', label: 'Batch Tracking' },
                        { key: 'requires_expiry_tracking', label: 'Expiry Tracking' },
                        { key: 'is_controlled_substance', label: 'Controlled Substance' },
                      ].map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-1.5 rounded-lg border p-1.5 cursor-pointer hover:bg-muted/40 transition-colors">
                          <input
                            type="checkbox"
                            checked={formData[key as keyof typeof formData] as boolean}
                            onChange={e => setFormData({ ...formData, [key]: e.target.checked })}
                            className="rounded"
                          />
                          <span className="text-[11px] font-medium">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

              <div className="p-3 border-t bg-muted flex justify-end gap-2 sticky bottom-0">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                  {saving ? (editingItem ? 'Updating...' : 'Creating...') : (editingItem ? 'Update Item' : 'Create Item')}
                </Button>
              </div>
            </form>
          </div>

          {/* BOTTOM: Item Directory */}
          <div className="bg-card rounded-lg border shadow-sm p-0 flex flex-col">
            <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
              <h3 className="font-medium">Item Directory</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative w-56">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input placeholder="Search items..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Combobox
                  options={[{ value: 'all', label: 'All categories' }, ...CATEGORY_OPTIONS]}
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  searchPlaceholder="Search categories..."
                  className="w-44 h-9"
                />
                <Combobox
                  options={STOCK_FILTER_OPTIONS}
                  value={stockFilter}
                  onChange={setStockFilter}
                  searchPlaceholder="Search..."
                  className="w-40 h-9"
                />
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchItems} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                <div className="flex items-center gap-2 mr-1">
                  <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Store location</label>
                  <Combobox
                    options={[
                      { value: '', label: 'Select a location…' },
                      ...locations.map((l: any) => ({
                        value: String(l.id),
                        label: `${l.location_name}${l.location_code ? ` (${l.location_code})` : ''}`,
                      })),
                    ]}
                    value={viewLocationId}
                    onChange={setViewLocationId}
                    placeholder="Select a location…"
                    searchPlaceholder="Search locations..."
                    className="h-9 w-56"
                  />
                </div>
                <Button variant="outline" size="sm" className="h-9" onClick={exportCSV} disabled={!viewLocationId}>
                  <Download className="w-4 h-4 mr-2" /> Export
                </Button>
                <Button variant="outline" size="sm" className="h-9" onClick={() => setShowBulkUpload(true)}>
                  <Upload className="w-4 h-4 mr-2" /> Bulk Upload
                </Button>
                <Button variant="outline" size="sm" className="h-9" onClick={() => setShowPriceAdjustment(true)}>
                  <Percent className="w-4 h-4 mr-2" /> Price Adjustment
                </Button>
              </div>
            </div>

            <div className="p-4">
              {!viewLocationId ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <MapPin className="mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="font-medium text-foreground">Choose a store location</p>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Items are listed per location, so the quantity beside each one is the stock actually held there.
                  </p>
                </div>
              ) : (
              <AdvancedDataTable<InventoryItem>
                data={filteredItems}
                keyExtractor={(item) => item.id}
                loading={loading}
                loadingMessage="Loading items at this location..."
                emptyMessage="No items held at this location yet."
                onRowClick={(item) => openEdit(item)}
                rowClassName={(item) => editingItem?.id === item.id ? 'bg-primary/5' : ''}
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'item_code', header: 'Code', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                  {
                    key: 'item_name', header: 'Item Name', sortable: true,
                    render: (v, item) => (
                      <>
                        {v}
                        <span className="text-xs text-muted-foreground ml-1">({item.unit_of_measure})</span>
                      </>
                    ),
                  },
                  { key: 'item_category', header: 'Category', sortable: true, render: (v) => <span className="capitalize text-muted-foreground">{v}</span> },
                  { key: 'quantity_on_hand', header: 'On Hand', sortable: true },
                  { key: 'average_unit_cost', header: 'Unit Cost', sortable: true, render: (v) => <span className="text-muted-foreground">{formatCurrency(v)}</span> },
                  {
                    key: '__value', header: 'Value',
                    render: (_v, item) => <span className="font-medium">{formatCurrency(item.quantity_on_hand * (item.average_unit_cost || 0))}</span>,
                  },
                  {
                    key: '__status', header: 'Status',
                    render: (_v, item) => {
                      const status = stockStatus(item);
                      return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${status.className}`}>{status.label}</span>;
                    },
                  },
                  {
                    key: '__actions', header: 'Actions',
                    render: (_v, item) => (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); viewItem(item); }}><Eye className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(item); }}><Edit className="w-3.5 h-3.5" /></Button>
                      </div>
                    ),
                  },
                ]}
              />
              )}
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Item Details Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-2xl rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <div>
                <h3 className="font-semibold text-lg font-mono">{selectedItem.item_code}</h3>
                <p className="text-xs text-muted-foreground">{selectedItem.item_name}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedItem(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-6 flex-1 overflow-auto space-y-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${stockStatus(selectedItem).className}`}>
                      {stockStatus(selectedItem).label}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Category</p>
                      <p className="font-medium capitalize">{selectedItem.item_category}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">UOM</p>
                      <p className="font-medium">{selectedItem.unit_of_measure}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Barcode</p>
                      <p className="font-medium font-mono">{selectedItem.barcode || '—'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-3 text-sm border rounded-lg p-3 bg-muted/20">
                    <div className="text-center">
                      <p className="text-lg font-bold">{selectedItem.quantity_on_hand}</p>
                      <p className="text-[10px] text-muted-foreground">On Hand</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold">{selectedItem.reserved_quantity || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Reserved</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold">{selectedItem.available_quantity ?? selectedItem.quantity_on_hand}</p>
                      <p className="text-[10px] text-muted-foreground">Available</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold font-mono">{formatCurrency((selectedItem.quantity_on_hand || 0) * (selectedItem.average_unit_cost || 0))}</p>
                      <p className="text-[10px] text-muted-foreground">Stock Value</p>
                    </div>
                  </div>

                  {selectedItem.batches?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Active Batches</p>
                      <div className="border rounded-lg overflow-hidden">
                        <AdvancedDataTable<any>
                          data={selectedItem.batches}
                          keyExtractor={(b) => b.id}
                          columns={[
                            { key: 'batch_number', header: 'Batch #', render: (v) => <span className="font-mono text-xs">{v}</span> },
                            { key: 'quantity_received', header: 'Received', align: 'right' },
                            { key: '__available', header: 'Available', align: 'right', render: (_v, b) => b.quantity_received - b.quantity_used },
                            { key: 'expiry_date', header: 'Expiry', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
                            { key: 'unit_cost', header: 'Unit Cost', align: 'right', render: (v) => <span className="font-mono">{formatCurrency(v)}</span> },
                          ]}
                        />
                      </div>
                    </div>
                  )}

                  {selectedItem.recent_transactions?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Recent Transactions</p>
                      <div className="border rounded-lg overflow-hidden">
                        <AdvancedDataTable<any>
                          data={selectedItem.recent_transactions.slice(0, 10)}
                          keyExtractor={(tx) => tx.id}
                          columns={[
                            { key: 'transaction_date', header: 'Date', render: (v) => <span className="text-xs">{v ? new Date(v).toLocaleDateString() : ''}</span> },
                            { key: 'transaction_type', header: 'Type', render: (v) => <span className="capitalize text-xs">{v}</span> },
                            {
                              key: 'quantity_change', header: 'Qty', align: 'right',
                              render: (v) => (
                                <span className={`font-mono ${v > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {v > 0 ? '+' : ''}{v}
                                </span>
                              ),
                            },
                            { key: 'reference_type', header: 'Ref', render: (v) => <span className="text-xs text-muted-foreground">{v || ''}</span> },
                          ]}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setSelectedItem(null); openEdit(selectedItem); }}>
                <Edit className="w-4 h-4 mr-2" /> Edit Item
              </Button>
              <Button onClick={() => setSelectedItem(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Upload Modal */}
      {showBulkUpload && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-lg rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary" /> Bulk Upload Items
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowBulkUpload(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-6 flex-1 overflow-auto space-y-4">
              <div className="p-4 bg-primary/5 border border-primary/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm mb-1">Download Template</h4>
                    <p className="text-xs text-muted-foreground mb-3">Download the CSV template, fill it with your item data, and upload it below.</p>
                    <Button onClick={downloadTemplate} variant="outline" size="sm">
                      <Download className="w-4 h-4 mr-2" /> Download Template
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Select CSV File</label>
                <Input ref={fileInputRef} type="file" accept=".csv" onChange={e => {
                  const file = e.target.files?.[0];
                  if (file && !file.name.endsWith('.csv')) { toast.error('Please select a CSV file'); return; }
                  if (file) setUploadFile(file);
                }} className="mt-1 cursor-pointer" />
                {uploadFile && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <FileSpreadsheet className="w-3 h-3" /> Selected: {uploadFile.name}
                  </p>
                )}
              </div>

              <div className="p-3 bg-muted/30 rounded-lg">
                <h4 className="font-semibold text-xs mb-2">Instructions</h4>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Download the template and fill in your item information</li>
                  <li>Ensure required fields are filled (item_code, item_name, category)</li>
                  <li>Use valid categories: drugs, consumables, equipment, supplies, reagents</li>
                  <li>Boolean fields should be 'true' or 'false'</li>
                  <li>Save the file as CSV format</li>
                </ul>
              </div>
            </div>

            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setShowBulkUpload(false); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button onClick={handleBulkUpload} disabled={!uploadFile || uploading}>
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                {uploading ? 'Uploading...' : 'Upload Items'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Price Adjustment Modal */}
      {showPriceAdjustment && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-md rounded-xl shadow-lg border overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Percent className="w-5 h-5 text-primary" /> Bulk Price Adjustment
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowPriceAdjustment(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                Raise or lower the selling price on every matching item in one step, instead of editing items one at a time. Only selling price changes — cost is untouched.
              </p>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Adjust by</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPriceAdjForm({ ...priceAdjForm, mode: 'percentage' })}
                    className={cn("h-9 rounded-md border text-sm font-medium transition-colors", priceAdjForm.mode === 'percentage' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50")}
                  >
                    Percentage
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriceAdjForm({ ...priceAdjForm, mode: 'rate' })}
                    className={cn("h-9 rounded-md border text-sm font-medium transition-colors", priceAdjForm.mode === 'rate' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50")}
                  >
                    Exchange Rate
                  </button>
                </div>
              </div>

              {priceAdjForm.mode === 'percentage' ? (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Direction</label>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPriceAdjForm({ ...priceAdjForm, direction: 'increase' })}
                        className={cn("h-9 rounded-md border text-sm font-medium transition-colors", priceAdjForm.direction === 'increase' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50")}
                      >
                        Increase
                      </button>
                      <button
                        type="button"
                        onClick={() => setPriceAdjForm({ ...priceAdjForm, direction: 'decrease' })}
                        className={cn("h-9 rounded-md border text-sm font-medium transition-colors", priceAdjForm.direction === 'decrease' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50")}
                      >
                        Decrease
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Percentage</label>
                    <div className="relative mt-1">
                      <Input
                        type="number" min="0.01" step="0.01" placeholder="e.g. 10"
                        value={priceAdjForm.percentage}
                        onChange={e => setPriceAdjForm({ ...priceAdjForm, percentage: e.target.value })}
                        className="pr-8"
                      />
                      <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">New Exchange Rate (SSP per 1 USD)</label>
                  <Input
                    type="number" min="0.01" step="0.01" placeholder="e.g. 6000"
                    value={priceAdjForm.newRate}
                    onChange={e => setPriceAdjForm({ ...priceAdjForm, newRate: e.target.value })}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {currentExchangeRate != null
                      ? `Current system rate: 1 USD = ${currentExchangeRate.toLocaleString()} SSP. Every matching item's price is rescaled to reflect the new rate you enter here.`
                      : 'No active USD → SSP rate is configured yet — set one on the Exchange Rates page first.'}
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground">Category (optional — leave blank for all)</label>
                <Combobox
                  options={[{ value: '', label: 'All categories' }, ...CATEGORIES.map(c => ({ value: c, label: c }))]}
                  value={priceAdjForm.category}
                  onChange={v => setPriceAdjForm({ ...priceAdjForm, category: v })}
                  placeholder="All categories"
                  searchPlaceholder="Search categories..."
                  className="mt-1"
                />
              </div>

              {priceAdjForm.mode === 'percentage' && priceAdjForm.percentage && !isNaN(parseFloat(priceAdjForm.percentage)) && (
                <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
                  Example: an item priced at 100.00 becomes{' '}
                  <strong>
                    {priceAdjForm.direction === 'increase'
                      ? (100 * (1 + parseFloat(priceAdjForm.percentage) / 100)).toFixed(2)
                      : (100 * (1 - parseFloat(priceAdjForm.percentage) / 100)).toFixed(2)}
                  </strong>.
                  This applies immediately to {priceAdjForm.category ? `all "${priceAdjForm.category}" items` : 'ALL active items'} and cannot be undone automatically.
                </div>
              )}

              {priceAdjForm.mode === 'rate' && priceAdjForm.newRate && !isNaN(parseFloat(priceAdjForm.newRate)) && currentExchangeRate != null && (
                <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
                  Example: an item priced at 100.00 becomes{' '}
                  <strong>{(100 * (parseFloat(priceAdjForm.newRate) / currentExchangeRate)).toFixed(2)}</strong>.
                  This applies immediately to {priceAdjForm.category ? `all "${priceAdjForm.category}" items` : 'ALL active items'} and cannot be undone automatically.
                </div>
              )}
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPriceAdjustment(false)} disabled={applyingPriceAdj}>Cancel</Button>
              <Button
                onClick={handleApplyPriceAdjustment}
                disabled={applyingPriceAdj || (priceAdjForm.mode === 'percentage' ? !priceAdjForm.percentage : !priceAdjForm.newRate)}
              >
                {applyingPriceAdj ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Percent className="w-4 h-4 mr-2" />}
                {applyingPriceAdj ? 'Applying...' : 'Apply Adjustment'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
