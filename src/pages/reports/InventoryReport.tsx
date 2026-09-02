import React, { useState, useEffect, useMemo } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Package, DollarSign, AlertTriangle, XCircle, Search } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { fmtCurrency, fmtNum, fmtCount, fmtDate, CsvColumn } from '@/utils/reportUtils';

interface InventoryReportItem {
  id: string;
  item_code: string;
  item_name: string;
  item_category: string;
  item_type: string;
  unit_of_measure: string;
  quantity_on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
  minimum_stock_level: number;
  maximum_stock_level: number;
  average_unit_cost: number;
  current_unit_cost: number;
  selling_price: number;
  cost_currency: string;
  stock_value: number;
  stock_value_base: number;
  fx_rate_to_base: number | null;
  last_received_date: string | null;
  status: 'Normal' | 'Low Stock' | 'Out of Stock' | 'Over Stock';
}

interface CategoryRow {
  item_category: string;
  item_count: number;
  total_quantity: number;
  total_value: number;
}

interface ReportPayload {
  baseCurrency: string;
  summary: {
    total_items: number;
    total_stock_value: number;
    low_stock_count: number;
    out_of_stock_count: number;
    unconverted_currency_count: number;
  };
  items: InventoryReportItem[];
  categoryBreakdown: CategoryRow[];
}

// Same visual language as src/pages/inventory/ItemMaster.tsx's stockStatus() —
// the backend computes the status label with identical thresholds, this just maps
// the label to the matching badge classes.
const STATUS_CLASS: Record<string, string> = {
  'Out of Stock': 'bg-red-50 text-red-700 border-red-200',
  'Low Stock': 'bg-amber-50 text-amber-700 border-amber-200',
  'Over Stock': 'bg-purple-50 text-purple-700 border-purple-200',
  'Normal': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export default function InventoryReport() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;

  // The date range control is hidden — inventory is a current-state snapshot,
  // not a period report. Kept as state only to satisfy ReportSubPageShell's props.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReportPayload | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/reports-v2/inventory?clinic_id=${clinicId}`);
      if (!res.ok) throw new Error('Failed to load inventory report');
      setData(await res.json());
    } catch (err: any) {
      toast.error(err.message || 'Failed to load inventory report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = data?.items || [];
  const summary = data?.summary || { total_items: 0, total_stock_value: 0, low_stock_count: 0, out_of_stock_count: 0, unconverted_currency_count: 0 };
  const categoryBreakdown = data?.categoryBreakdown || [];
  const baseCurrency = data?.baseCurrency || 'SSP';

  const categories = useMemo(() => Array.from(new Set(items.map(i => i.item_category))).sort(), [items]);

  const filteredItems = useMemo(() => items.filter(item => {
    const q = search.toLowerCase();
    const matchesSearch = !q || item.item_name?.toLowerCase().includes(q) || item.item_code?.toLowerCase().includes(q);
    const matchesCategory = categoryFilter === 'all' || item.item_category === categoryFilter;
    const matchesStock = stockFilter === 'all' || item.status === stockFilter;
    return matchesSearch && matchesCategory && matchesStock;
  }), [items, search, categoryFilter, stockFilter]);

  const csvColumns: CsvColumn[] = [
    { header: 'Item Code', key: 'item_code' },
    { header: 'Item Name', key: 'item_name' },
    { header: 'Category', key: 'item_category' },
    { header: 'UOM', key: 'unit_of_measure' },
    { header: 'Qty On Hand', key: 'quantity_on_hand' },
    { header: 'Unit Cost', key: 'average_unit_cost', transform: v => fmtNum(v) },
    { header: `Stock Value (${baseCurrency})`, key: 'stock_value_base', transform: v => fmtNum(v) },
    { header: 'Status', key: 'status' },
  ];

  return (
    <ReportSubPageShell
      title="Inventory Report"
      description="Full current stock listing with valuation, as of now"
      dateFrom={dateFrom} dateTo={dateTo}
      onDateFromChange={setDateFrom} onDateToChange={setDateTo}
      onRefresh={fetchData} loading={loading}
      hideDateRange
      csvData={filteredItems} csvColumns={csvColumns} csvFilename={`inventory-report-${new Date().toISOString().split('T')[0]}.csv`}
    >
      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-6">

          {/* Headline stat tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Total Items</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(summary.total_items)}</p>
                </div>
                <Package className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Total Stock Value</p>
                  <p className="text-2xl font-bold mt-1 text-primary">{fmtCurrency(summary.total_stock_value, baseCurrency)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">normalized to {baseCurrency}</p>
                </div>
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Low Stock</p>
                  <p className="text-2xl font-bold mt-1 text-amber-700">{fmtCount(summary.low_stock_count)}</p>
                </div>
                <AlertTriangle className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Out of Stock</p>
                  <p className="text-2xl font-bold mt-1 text-red-700">{fmtCount(summary.out_of_stock_count)}</p>
                </div>
                <XCircle className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>

          {/* Category breakdown */}
          {categoryBreakdown.length > 0 && (
            <div>
              <div className="mb-2">
                <h3 className="font-medium text-sm">Stock Value by Category</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Values normalized to {baseCurrency}</p>
              </div>
              <AdvancedDataTable<CategoryRow>
                data={categoryBreakdown}
                keyExtractor={(cat) => cat.item_category}
                columns={[
                  { key: 'item_category', header: 'Category', sortable: true, render: (v) => <span className="capitalize font-medium">{v}</span> },
                  { key: 'item_count', header: 'Items', align: 'right', sortable: true, render: (v) => <span className="text-muted-foreground">{fmtCount(v)}</span> },
                  { key: 'total_quantity', header: 'Total Qty', align: 'right', sortable: true, render: (v) => <span className="text-muted-foreground">{fmtCount(v)}</span> },
                  { key: 'total_value', header: 'Stock Value', align: 'right', sortable: true, render: (v) => <span className="font-medium">{fmtCurrency(v, baseCurrency)}</span> },
                  {
                    key: '__pct', header: '% of Total', align: 'right',
                    render: (_v, cat) => (
                      <span className="text-muted-foreground">
                        {summary.total_stock_value > 0 ? fmtNum((cat.total_value / summary.total_stock_value) * 100, 1) : '0.0'}%
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {/* Full inventory table — search/category/stock filters live here (not the table's
              own built-in search) because they also drive what the page-level CSV export downloads. */}
          <div>
            <div className="mb-2">
              <h3 className="font-medium text-sm">Full Inventory Listing</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Showing {filteredItems.length} of {items.length} items &middot; total value (filtered): {fmtCurrency(filteredItems.reduce((s, i) => s + i.stock_value_base, 0), baseCurrency)}
              </p>
            </div>
            <AdvancedDataTable<InventoryReportItem>
              data={filteredItems}
              keyExtractor={(item) => item.id}
              emptyMessage="No items found."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              toolbarExtra={
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-56">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <input
                      placeholder="Search items..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pl-8 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                    />
                  </div>
                  <select
                    className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm"
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                  >
                    <option value="all">All categories</option>
                    {categories.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                  <select
                    className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm"
                    value={stockFilter}
                    onChange={e => setStockFilter(e.target.value)}
                  >
                    <option value="all">All stock</option>
                    <option value="Normal">Normal</option>
                    <option value="Low Stock">Low Stock</option>
                    <option value="Out of Stock">Out of Stock</option>
                    <option value="Over Stock">Over Stock</option>
                  </select>
                </div>
              }
              columns={[
                { key: 'item_code', header: 'Code', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                {
                  key: 'item_name', header: 'Item Name', sortable: true,
                  render: (v, item) => <>{v}<span className="text-xs text-muted-foreground ml-1">({item.unit_of_measure})</span></>,
                },
                { key: 'item_category', header: 'Category', sortable: true, render: (v) => <span className="capitalize text-muted-foreground">{v}</span> },
                { key: 'quantity_on_hand', header: 'On Hand', align: 'right', sortable: true, render: (v) => fmtCount(v) },
                { key: 'average_unit_cost', header: 'Unit Cost', align: 'right', sortable: true, render: (v, item) => <span className="text-muted-foreground">{fmtCurrency(v, item.cost_currency)}</span> },
                {
                  key: 'stock_value_base', header: `Stock Value (${baseCurrency})`, align: 'right', sortable: true,
                  render: (v, item) => (
                    <div className="font-medium">
                      {fmtCurrency(v, baseCurrency)}
                      {item.cost_currency !== baseCurrency && (
                        <div className="text-[11px] text-muted-foreground font-normal">
                          {fmtCurrency(item.stock_value, item.cost_currency)}
                          {item.fx_rate_to_base == null && <span className="text-amber-600"> (no rate — 1:1 used)</span>}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'status', header: 'Status', sortable: true,
                  render: (v) => (
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${STATUS_CLASS[v]}`}>
                      {v}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
