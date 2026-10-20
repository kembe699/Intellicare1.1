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
  ArrowLeftRight, Search, RefreshCw, Download, ArrowUpRight, ArrowDownRight,
  Check, Loader2,
} from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface Transaction {
  id: string;
  transaction_number: string;
  item_id: string;
  item_name: string;
  item_code: string;
  unit_of_measure: string;
  transaction_type: string;
  quantity_change: number;
  from_location_name: string;
  to_location_name: string;
  unit_cost: number;
  total_cost: number;
  transaction_date: string;
  reference_type: string;
  reference_id: string;
  notes: string;
  created_at: string;
}

const TX_TYPES = [
  { value: 'receipt', label: 'Receipt', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'dispense', label: 'Dispense', className: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: 'usage', label: 'Usage', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  { value: 'adjustment', label: 'Adjustment', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'transfer', label: 'Transfer', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { value: 'waste', label: 'Waste', className: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'damage', label: 'Damage', className: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'return_to_supplier', label: 'Return', className: 'bg-slate-100 text-slate-600 border-slate-200' },
];
const TX_TYPE_MAP = Object.fromEntries(TX_TYPES.map(t => [t.value, t]));
// Types that remove stock from a location (as opposed to `receipt`, which adds stock to one).
const STOCK_OUT_TYPES = ['dispense', 'usage', 'waste', 'damage', 'return_to_supplier'];

export default function StockTransactions() {
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const clinicId = user?.clinic || 1;

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [items, setItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    item_id: '', transaction_type: 'receipt', quantity_change: 0,
    from_location_id: '', to_location_id: '', unit_cost: 0,
    reference_type: '', reference_id: '', notes: '',
  });

  useEffect(() => { fetchTransactions(); fetchItems(); fetchLocations(); }, []);
  useEffect(() => { fetchTransactions(); }, [typeFilter, dateFrom, dateTo]);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      // 200 silently truncated real tenants with more history than that — no
      // sign anything was missing, the visible rows just stopped at whatever
      // fit. Matches the server's own raised ceiling (see GET /transactions).
      const params = new URLSearchParams({ clinic_id: String(clinicId), limit: '5000' });
      if (typeFilter !== 'all') params.append('transaction_type', typeFilter);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      const res = await authFetch(`/api/inventory/transactions?${params}`, { credentials: 'include' });
      if (res.ok) setTransactions(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch transactions');
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

  const filteredTx = useMemo(() => {
    if (!search) return transactions;
    const q = search.toLowerCase();
    return transactions.filter(tx =>
      tx.item_name?.toLowerCase().includes(q) || tx.item_code?.toLowerCase().includes(q) || tx.transaction_number?.toLowerCase().includes(q)
    );
  }, [transactions, search]);

  const openCreate = () => {
    setFormData({
      item_id: '', transaction_type: 'receipt', quantity_change: 0,
      from_location_id: '', to_location_id: '', unit_cost: 0,
      reference_type: '', reference_id: '', notes: '',
    });
  };

  // The single "Location" field (non-transfer types) means different things depending on
  // direction: stock-in (receipt) sets to_location_id, stock-out (dispense/usage/waste/
  // damage/return) sets from_location_id — previously this always wrote to_location_id
  // regardless of direction, silently recording stock-out movements backwards.
  const isStockOut = STOCK_OUT_TYPES.includes(formData.transaction_type);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!formData.item_id || formData.quantity_change === 0) { toast.error('Select an item and enter a quantity'); return; }

    setSaving(true);
    try {
      let qty = Math.abs(formData.quantity_change);
      if (isStockOut) qty = -qty;

      const res = await authFetch('/api/inventory/transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          clinic_id: clinicId, item_id: formData.item_id, transaction_type: formData.transaction_type,
          quantity_change: qty, from_location_id: formData.from_location_id || null,
          to_location_id: formData.to_location_id || null, unit_cost: formData.unit_cost || 0,
          reference_type: formData.reference_type || null, reference_id: formData.reference_id || null,
          notes: formData.notes || null, created_by: user?.uid,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to record transaction');

      toast.success('Transaction recorded');
      openCreate();
      fetchTransactions();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create transaction');
    } finally {
      setSaving(false);
    }
  };

  const exportCSV = () => {
    const headers = ['Date', 'Txn #', 'Item Code', 'Item Name', 'Type', 'Qty', 'Unit Cost', 'Total Cost', 'Reference'];
    const rows = filteredTx.map(tx => [
      tx.transaction_date, tx.transaction_number, tx.item_code, tx.item_name,
      tx.transaction_type, tx.quantity_change, tx.unit_cost, tx.total_cost,
      tx.reference_type ? `${tx.reference_type}:${tx.reference_id}` : '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'inventory_transactions.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full flex flex-col">
        <PageHeader title="Stock Transactions" icon={<ArrowLeftRight />} className="mb-3" />

        {/* Form above, table below — the shape the rest of the app uses. Side by
            side, the form was squeezed into a third of the width while the table
            it feeds had to be read in the remaining two thirds, so both were
            cramped on the screens this is actually used on. */}
        <div className="flex flex-col gap-6">

          {/* Create transaction */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden min-w-0">
            <div className="p-4 border-b bg-muted/30 flex justify-between items-center flex-shrink-0">
              <h3 className="font-medium flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-primary" /> New Stock Transaction
              </h3>
            </div>
            <form onSubmit={handleSubmit}>
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
                    <label className="text-xs font-medium text-muted-foreground">Transaction Type</label>
                    <Combobox
                      options={TX_TYPES}
                      value={formData.transaction_type}
                      onChange={v => setFormData({ ...formData, transaction_type: v, from_location_id: '', to_location_id: '' })}
                      searchPlaceholder="Search types..."
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Quantity</label>
                    <Input required type="number" min="1" value={formData.quantity_change || ''} onChange={e => setFormData({ ...formData, quantity_change: parseInt(e.target.value) || 0 })} className="mt-1" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Unit Cost</label>
                    <Input type="number" step="0.01" min="0" value={formData.unit_cost || ''} onChange={e => setFormData({ ...formData, unit_cost: parseFloat(e.target.value) || 0 })} className="mt-1" />
                  </div>
                  {formData.transaction_type === 'transfer' ? (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">From Location</label>
                      <Combobox
                        options={locations.map((l: any) => ({ value: l.id, label: l.location_name }))}
                        value={formData.from_location_id}
                        onChange={v => setFormData({ ...formData, from_location_id: v })}
                        placeholder="Source..."
                        searchPlaceholder="Search locations..."
                        className="mt-1 h-9"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Location{isStockOut ? ' (source)' : ' (destination)'}</label>
                      <Combobox
                        options={locations.map((l: any) => ({ value: l.id, label: l.location_name }))}
                        value={isStockOut ? formData.from_location_id : formData.to_location_id}
                        onChange={v => setFormData(isStockOut ? { ...formData, from_location_id: v } : { ...formData, to_location_id: v })}
                        placeholder="None"
                        searchPlaceholder="Search locations..."
                        className="mt-1 h-9"
                      />
                    </div>
                  )}
                </div>

                {formData.transaction_type === 'transfer' && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">To Location</label>
                    <Combobox
                      options={locations.map((l: any) => ({ value: l.id, label: l.location_name }))}
                      value={formData.to_location_id}
                      onChange={v => setFormData({ ...formData, to_location_id: v })}
                      placeholder="Destination..."
                      searchPlaceholder="Search locations..."
                      className="mt-1 h-9"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Reference Type</label>
                    <Input value={formData.reference_type} onChange={e => setFormData({ ...formData, reference_type: e.target.value })} placeholder="e.g. grn, prescription" className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Reference ID</label>
                    <Input value={formData.reference_id} onChange={e => setFormData({ ...formData, reference_id: e.target.value })} className="mt-1" />
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
                  {saving ? 'Recording...' : 'Record Transaction'}
                </Button>
              </div>
            </form>
          </div>

          {/* Transaction Log */}
          <div className="bg-card rounded-lg border shadow-sm p-0 flex flex-col overflow-hidden min-w-0">
            <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
              <h3 className="font-medium">Transaction Log</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative w-56">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input placeholder="Search transactions..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Combobox
                  options={[{ value: 'all', label: 'All types' }, ...TX_TYPES]}
                  value={typeFilter}
                  onChange={setTypeFilter}
                  searchPlaceholder="Search types..."
                  className="w-40 h-9"
                />
                <Input type="date" className="h-9 w-[140px]" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" className="h-9 w-[140px]" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} />
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchTransactions} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                <Button variant="outline" size="sm" className="h-9" onClick={exportCSV}>
                  <Download className="w-4 h-4 mr-2" /> Export
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <AdvancedDataTable<Transaction>
                data={filteredTx}
                keyExtractor={(tx) => tx.id}
                loading={loading}
                emptyMessage="No transactions found."
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'transaction_number', header: 'Txn No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                  { key: 'transaction_date', header: 'Date', sortable: true, render: (v) => <span className="text-muted-foreground">{v ? new Date(v).toLocaleDateString() : ''}</span> },
                  {
                    key: 'item_name', header: 'Item', sortable: true,
                    render: (v, tx) => (
                      <>
                        {v}
                        <span className="text-xs text-muted-foreground ml-1 font-mono">({tx.item_code})</span>
                      </>
                    ),
                  },
                  {
                    key: 'transaction_type', header: 'Type', sortable: true,
                    render: (v) => {
                      const typeInfo = TX_TYPE_MAP[v] || { label: v, className: 'bg-slate-100 text-slate-600 border-slate-200' };
                      return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border ${typeInfo.className}`}>{typeInfo.label}</span>;
                    },
                  },
                  {
                    key: 'quantity_change', header: 'Qty', sortable: true,
                    render: (v) => (
                      <span className={`flex items-center gap-1 font-mono ${v > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {v > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {v > 0 ? '+' : ''}{v}
                      </span>
                    ),
                  },
                  { key: 'total_cost', header: 'Cost', sortable: true, render: (v) => <span className="font-mono text-muted-foreground">{fmt(v)}</span> },
                  {
                    key: '__location', header: 'Location',
                    render: (_v, tx) => (
                      <span className="text-xs text-muted-foreground">
                        {tx.transaction_type === 'transfer'
                          ? `${tx.from_location_name || '?'} → ${tx.to_location_name || '?'}`
                          : tx.to_location_name || tx.from_location_name || '—'}
                      </span>
                    ),
                  },
                  { key: 'reference_type', header: 'Reference', render: (v) => <span className="text-xs text-muted-foreground">{v || '—'}</span> },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
      </div>
    </AppLayout>
  );
}
