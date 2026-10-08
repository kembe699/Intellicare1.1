import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from 'sonner';
import { ReportSubPageShell } from './ReportSubPageShell';
import { LoadingState } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Calendar, RefreshCw, Download, Printer, Eye } from 'lucide-react';
import { fmtCurrency, fmtCount, fmtDate, CsvColumn, getDatePresets, exportCSV, triggerPrint } from '@/utils/reportUtils';

// One Inventory Reports page, one dropdown — same shape as Revenue/Clinical
// Reports. Five entries are flagged rather than guessed at: Internal Order
// Receipt/Issuance Detailed and Interbranch Order Issuance/Receipt Detailed
// have no backing table anywhere in this codebase (no requisition or
// branch-transfer workflow exists today — the only inter-location movement
// is a same-branch `transfer` transaction type, not a two-document
// request/approval flow). Material Consumption (Committed) has no backing
// either — `inventory_items.reserved_quantity` and the whole
// `inventory_reservations` table exist in the schema but are never written
// to anywhere; only "(Not Committed)" (stock actually deducted) has real
// data. Selecting any of these five shows a message instead of fake data —
// tell me how you want each one to actually work and it's a straightforward
// add once the workflow is decided.

type Mode =
  | 'stock-analysis-items' | 'stock-analysis-category' | 'fast-moving' | 'slow-moving'
  | 'retired-batches' | 'near-expiry' | 'stock-expiry' | 'stock-valuation-all'
  | 'stock-valuation-location' | 'out-of-stock' | 'below-reorder-level' | 'material-consumption'
  | 'stock-movement-detail' | 'stock-movement-summary' | 'unavailable';

interface ReportOption {
  value: string;
  label: string;
  group: string;
  mode: Mode;
  allBranches: boolean;
  summaryGroupBy?: 'branch' | 'location';
  needsLocation?: boolean;
  needsItem?: boolean;
  unavailableReason?: string;
}

const NO_ORDER_WORKFLOW = 'No internal-order or interbranch-transfer workflow exists in the system today — only a same-branch stock transfer. Tell me how this should actually work (who requests, who approves, does it move between branches or just locations) and it\'s a quick add.';
const NO_COMMITTED_CONCEPT = 'No "committed" (reserved-but-not-yet-deducted) stock concept is actually in use — the reservations table exists in the schema but nothing in the app writes to it. Tell me what should count as "committed" and this is a quick add.';

const REPORT_OPTIONS: ReportOption[] = [
  { value: 'stock_analysis', label: 'Stock Analysis', group: 'Stock Analysis', mode: 'stock-analysis-items', allBranches: false },
  { value: 'stock_analysis_category', label: 'Stock Analysis Grouped by Category', group: 'Stock Analysis', mode: 'stock-analysis-category', allBranches: false },

  { value: 'fast_moving', label: 'Fast Moving Items (First 20)', group: 'Movement Analysis', mode: 'fast-moving', allBranches: false },
  { value: 'slow_moving', label: 'Slow Moving Items', group: 'Movement Analysis', mode: 'slow-moving', allBranches: false },

  { value: 'stock_movement_detail_all', label: 'Stock Movement Detailed (All Branches)', group: 'Stock Movement', mode: 'stock-movement-detail', allBranches: true },
  { value: 'stock_movement_detail_branch', label: 'Stock Movement Detailed (By Branch)', group: 'Stock Movement', mode: 'stock-movement-detail', allBranches: false },
  { value: 'stock_movement_detail_location', label: 'Stock Movement Detailed (By Storage Location)', group: 'Stock Movement', mode: 'stock-movement-detail', allBranches: true, needsLocation: true },
  { value: 'stock_movement_detail_item', label: 'Stock Movement Detailed (By Item)', group: 'Stock Movement', mode: 'stock-movement-detail', allBranches: true, needsItem: true },
  { value: 'stock_movement_summary_branch', label: 'Stock Movement Summary (By Branch)', group: 'Stock Movement', mode: 'stock-movement-summary', allBranches: false, summaryGroupBy: 'branch' },
  { value: 'stock_movement_summary_location', label: 'Stock Movement Summary (By Storage Location)', group: 'Stock Movement', mode: 'stock-movement-summary', allBranches: true, summaryGroupBy: 'location' },

  { value: 'out_of_stock', label: 'Out Of Stock', group: 'Stock Levels', mode: 'out-of-stock', allBranches: false },
  { value: 'below_reorder_level', label: 'Below Reorder Level', group: 'Stock Levels', mode: 'below-reorder-level', allBranches: false },
  { value: 'near_expiry', label: 'Near Expiry', group: 'Stock Levels', mode: 'near-expiry', allBranches: false },
  { value: 'stock_expiry', label: 'Stock Expiry', group: 'Stock Levels', mode: 'stock-expiry', allBranches: false },
  { value: 'retired_batches', label: 'Retired Batches', group: 'Stock Levels', mode: 'retired-batches', allBranches: false },

  { value: 'stock_valuation_all', label: 'Stock Valuation (All)', group: 'Valuation', mode: 'stock-valuation-all', allBranches: false },
  { value: 'stock_valuation_location', label: 'Stock Valuation (By Storage Location)', group: 'Valuation', mode: 'stock-valuation-location', allBranches: false },

  { value: 'material_consumption_not_committed', label: 'Material Consumption (Not Committed)', group: 'Consumption', mode: 'material-consumption', allBranches: false },
  { value: 'material_consumption_committed', label: 'Material Consumption (Committed)', group: 'Consumption', mode: 'unavailable', allBranches: false, unavailableReason: NO_COMMITTED_CONCEPT },

  { value: 'internal_order_receipt', label: 'Internal Order Receipt Detailed', group: 'Internal / Interbranch Orders', mode: 'unavailable', allBranches: false, unavailableReason: NO_ORDER_WORKFLOW },
  { value: 'internal_order_issuance', label: 'Internal Order Issuance Detailed', group: 'Internal / Interbranch Orders', mode: 'unavailable', allBranches: false, unavailableReason: NO_ORDER_WORKFLOW },
  { value: 'interbranch_order_issuance', label: 'Interbranch Order Issuance Detailed', group: 'Internal / Interbranch Orders', mode: 'unavailable', allBranches: false, unavailableReason: NO_ORDER_WORKFLOW },
  { value: 'interbranch_order_receipt', label: 'Interbranch Order Receipt Detailed', group: 'Internal / Interbranch Orders', mode: 'unavailable', allBranches: false, unavailableReason: NO_ORDER_WORKFLOW },
];

const OPTION_GROUPS = ['Stock Analysis', 'Movement Analysis', 'Stock Movement', 'Stock Levels', 'Valuation', 'Consumption', 'Internal / Interbranch Orders'];

function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m + 1)}-01`, to: now.toISOString().split('T')[0] };
}

export default function InventoryReport() {
  const { user } = useAuth();
  const facility = useFacilityInfo();
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [reportType, setReportType] = useState('stock_analysis');
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [locations, setLocations] = useState<{ id: string; location_name: string }[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [items, setItems] = useState<{ id: string; item_name: string }[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');

  useEffect(() => {
    authFetch(`/api/inventory/locations`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => setLocations(Array.isArray(data) ? data : []))
      .catch(() => setLocations([]));
    authFetch(`/api/inventory/items`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => setItems(Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : [])))
      .catch(() => setItems([]));
  }, []);

  const option = REPORT_OPTIONS.find(o => o.value === reportType)!;

  const fetchData = useCallback(async () => {
    if (option.mode === 'unavailable') {
      setRows([]);
      setHasLoaded(true);
      setGeneratedAt(new Date());
      return;
    }
    setLoading(true);
    try {
      const clinicId = user?.clinic || '1';
      let path = '';
      let dataKey = 'rows';
      const params = new URLSearchParams({ dateFrom, dateTo, allBranches: String(option.allBranches), clinic_id: String(clinicId) });

      if (option.mode === 'stock-analysis-items') { path = '/'; dataKey = 'items'; }
      else if (option.mode === 'stock-analysis-category') { path = '/'; dataKey = 'categoryBreakdown'; }
      else if (option.mode === 'stock-valuation-all') { path = '/'; dataKey = 'items'; }
      else if (option.mode === 'stock-valuation-location') path = '/stock-valuation-by-location';
      else if (option.mode === 'fast-moving') path = '/fast-moving';
      else if (option.mode === 'slow-moving') path = '/slow-moving';
      else if (option.mode === 'retired-batches') path = '/retired-batches';
      else if (option.mode === 'near-expiry') path = '/near-expiry';
      else if (option.mode === 'stock-expiry') path = '/stock-expiry';
      else if (option.mode === 'out-of-stock') path = '/out-of-stock';
      else if (option.mode === 'below-reorder-level') path = '/below-reorder-level';
      else if (option.mode === 'material-consumption') path = '/material-consumption';
      else if (option.mode === 'stock-movement-detail') {
        path = '/stock-movement-detail';
        if (option.needsLocation && selectedLocationId) params.set('locationId', selectedLocationId);
        if (option.needsItem && selectedItemId) params.set('itemId', selectedItemId);
      } else if (option.mode === 'stock-movement-summary') {
        path = '/stock-movement-summary';
        params.set('groupBy', option.summaryGroupBy!);
      }

      const res = await authFetch(`/api/reports-v2/inventory${path}?${params}`);
      if (!res.ok) throw new Error('Failed to load report');
      const json = await res.json();
      setRows(Array.isArray(json[dataKey]) ? json[dataKey] : []);
      setGeneratedAt(new Date());
      setHasLoaded(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load inventory report');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, reportType, user?.clinic, selectedLocationId, selectedItemId]);

  // ── Columns per mode ─────────────────────────────────────────────────────
  let columns: Column<any>[] = [];
  let csvColumns: CsvColumn[] = [];
  let keyExtractor: (row: any, i: number) => string | number = (r, i) => r.id ?? i;
  let emptyMessage = 'No records found.';

  if (option.mode === 'stock-analysis-items' || option.mode === 'stock-valuation-all') {
    columns = [
      { key: 'item_code', header: 'Code', sortable: true, render: v => <span className="font-mono text-xs">{v}</span> },
      { key: 'item_name', header: 'Item', sortable: true },
      { key: 'item_category', header: 'Category', sortable: true },
      { key: 'quantity_on_hand', header: 'Qty on Hand', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'average_unit_cost', header: 'Avg Unit Cost', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'stock_value_base', header: 'Stock Value', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      { key: 'status', header: 'Status', sortable: true },
    ];
    csvColumns = [{ header: 'Code', key: 'item_code' }, { header: 'Item', key: 'item_name' }, { header: 'Category', key: 'item_category' }, { header: 'Qty on Hand', key: 'quantity_on_hand' }, { header: 'Avg Unit Cost', key: 'average_unit_cost', transform: v => fmtCurrency(v) }, { header: 'Stock Value', key: 'stock_value_base', transform: v => fmtCurrency(v) }, { header: 'Status', key: 'status' }];
  } else if (option.mode === 'stock-analysis-category') {
    keyExtractor = r => r.item_category;
    columns = [
      { key: 'item_category', header: 'Category', sortable: true },
      { key: 'item_count', header: 'Items', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'total_quantity', header: 'Total Qty', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'total_value', header: 'Total Value', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: 'Category', key: 'item_category' }, { header: 'Items', key: 'item_count' }, { header: 'Total Qty', key: 'total_quantity' }, { header: 'Total Value', key: 'total_value', transform: v => fmtCurrency(v) }];
  } else if (option.mode === 'fast-moving' || option.mode === 'slow-moving') {
    columns = [
      { key: 'itemCode', header: 'Code', sortable: true, render: v => <span className="font-mono text-xs">{v}</span> },
      { key: 'itemName', header: 'Item', sortable: true },
      { key: 'itemCategory', header: 'Category', sortable: true },
      { key: 'totalMoved', header: 'Qty Moved', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCount(v)}</span> },
      { key: 'transactionCount', header: 'Transactions', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
    ];
    csvColumns = [{ header: 'Code', key: 'itemCode' }, { header: 'Item', key: 'itemName' }, { header: 'Category', key: 'itemCategory' }, { header: 'Qty Moved', key: 'totalMoved' }, { header: 'Transactions', key: 'transactionCount' }];
  } else if (option.mode === 'retired-batches' || option.mode === 'near-expiry' || option.mode === 'stock-expiry') {
    columns = [
      { key: 'batchNumber', header: 'Batch #', sortable: true, render: v => <span className="font-mono text-xs">{v}</span> },
      { key: 'itemName', header: 'Item', sortable: true },
      { key: 'quantityReceived', header: 'Received', align: 'right', render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
      { key: 'quantityUsed', header: 'Used', align: 'right', render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
      ...(option.mode !== 'retired-batches' ? [{ key: 'quantityRemaining', header: 'Remaining', align: 'right' as const, sortable: true, render: (v: any) => <span className="font-mono font-medium">{fmtCount(v)}</span> }] : []),
      { key: 'expiryDate', header: 'Expiry Date', sortable: true, render: v => v ? fmtDate(v) : '—' },
      ...(option.mode === 'near-expiry' ? [{ key: 'daysToExpiry', header: 'Days Left', align: 'right' as const, sortable: true, render: (v: any) => <span className="font-mono font-medium text-amber-700">{v}</span> }] : []),
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Batch #', key: 'batchNumber' }, { header: 'Item', key: 'itemName' }, { header: 'Received', key: 'quantityReceived' }, { header: 'Used', key: 'quantityUsed' }, { header: 'Expiry Date', key: 'expiryDate', transform: v => v ? fmtDate(v) : '' }, { header: 'Branch', key: 'branchName' }];
    emptyMessage = 'No batches in this category.';
  } else if (option.mode === 'stock-valuation-location') {
    columns = [
      { key: 'locationName', header: 'Location', sortable: true },
      { key: 'itemName', header: 'Item', sortable: true },
      { key: 'quantityOnHand', header: 'Qty on Hand', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'averageUnitCost', header: 'Avg Unit Cost', align: 'right', render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'stockValue', header: 'Stock Value', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Location', key: 'locationName' }, { header: 'Item', key: 'itemName' }, { header: 'Qty on Hand', key: 'quantityOnHand' }, { header: 'Stock Value', key: 'stockValue', transform: v => fmtCurrency(v) }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'out-of-stock' || option.mode === 'below-reorder-level') {
    columns = [
      { key: 'itemCode', header: 'Code', sortable: true, render: v => <span className="font-mono text-xs">{v}</span> },
      { key: 'itemName', header: 'Item', sortable: true },
      { key: 'itemCategory', header: 'Category', sortable: true },
      ...(option.mode === 'below-reorder-level' ? [{ key: 'quantityOnHand', header: 'Qty on Hand', align: 'right' as const, sortable: true, render: (v: any) => <span className="font-mono font-medium">{fmtCount(v)}</span> }] : []),
      { key: 'minimumStockLevel', header: 'Reorder Trigger', align: 'right', render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Code', key: 'itemCode' }, { header: 'Item', key: 'itemName' }, { header: 'Category', key: 'itemCategory' }, { header: 'Reorder Trigger', key: 'minimumStockLevel' }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'material-consumption') {
    keyExtractor = (r, i) => r.itemCode ?? i;
    columns = [
      { key: 'itemCode', header: 'Code', sortable: true, render: v => <span className="font-mono text-xs">{v}</span> },
      { key: 'itemName', header: 'Item', sortable: true },
      { key: 'itemCategory', header: 'Category', sortable: true },
      { key: 'quantityConsumed', header: 'Qty Consumed', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCount(v)}</span> },
      { key: 'totalValue', header: 'Value', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
      { key: 'transactionCount', header: 'Transactions', align: 'right', render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
    ];
    csvColumns = [{ header: 'Code', key: 'itemCode' }, { header: 'Item', key: 'itemName' }, { header: 'Category', key: 'itemCategory' }, { header: 'Qty Consumed', key: 'quantityConsumed' }, { header: 'Value', key: 'totalValue', transform: v => fmtCurrency(v) }];
  } else if (option.mode === 'stock-movement-detail') {
    columns = [
      { key: 'transactionDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'transactionNumber', header: 'Transaction #', sortable: true, render: v => <span className="font-mono text-xs text-primary">{v}</span> },
      { key: 'transactionType', header: 'Type', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'itemName', header: 'Item', sortable: true },
      { key: 'quantityChange', header: 'Qty Change', align: 'right', sortable: true, render: v => <span className={`font-mono font-medium ${v < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{v > 0 ? '+' : ''}{v}</span> },
      { key: 'fromLocation', header: 'From', render: v => v || '—' },
      { key: 'toLocation', header: 'To', render: v => v || '—' },
      { key: 'totalCost', header: 'Value', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Date', key: 'transactionDate', transform: v => fmtDate(v) }, { header: 'Transaction #', key: 'transactionNumber' }, { header: 'Type', key: 'transactionType' }, { header: 'Item', key: 'itemName' }, { header: 'Qty Change', key: 'quantityChange' }, { header: 'From', key: 'fromLocation' }, { header: 'To', key: 'toLocation' }, { header: 'Value', key: 'totalCost', transform: v => fmtCurrency(v) }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'stock-movement-summary') {
    keyExtractor = r => r.groupLabel;
    columns = [
      { key: 'groupLabel', header: option.summaryGroupBy === 'location' ? 'Location' : 'Branch', sortable: true },
      { key: 'transactionCount', header: 'Transactions', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
      { key: 'totalQuantity', header: 'Total Qty Moved', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'totalValue', header: 'Total Value', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: option.summaryGroupBy === 'location' ? 'Location' : 'Branch', key: 'groupLabel' }, { header: 'Transactions', key: 'transactionCount' }, { header: 'Total Qty Moved', key: 'totalQuantity' }, { header: 'Total Value', key: 'totalValue', transform: v => fmtCurrency(v) }];
  }

  const numberedRows = useMemo(() => rows.map((r, i) => ({ ...r, no: i + 1 })), [rows]);
  const columnsWithNo: Column<any>[] = [
    { key: 'no', header: 'No', width: '56px', render: v => <span className="text-muted-foreground tabular-nums">{v}</span> },
    ...columns,
  ];

  const presets = getDatePresets();
  const handlePreset = (label: string) => {
    const p = presets.find(x => x.label === label);
    if (!p) return;
    setDateFrom(p.from);
    setDateTo(p.to);
  };
  const handleExportCSV = () => exportCSV(numberedRows, csvColumns, `inventory-${option.value}-${dateFrom}-${dateTo}.csv`);

  return (
    <ReportSubPageShell
      title="Inventory Reports"
      description="Pick a report type and date range, then click View."
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      hideControls
    >
      <div className="sticky top-0 z-10 -mx-6 -mt-6 px-6 pt-6 pb-4 bg-primary/20 print:hidden">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <select
            value={reportType}
            onChange={e => setReportType(e.target.value)}
            className="h-9 min-w-[320px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {OPTION_GROUPS.map(group => (
              <optgroup key={group} label={group}>
                {REPORT_OPTIONS.filter(o => o.group === group).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {option.needsLocation && (
            <select
              value={selectedLocationId}
              onChange={e => setSelectedLocationId(e.target.value)}
              className="h-9 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Locations</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}
            </select>
          )}

          {option.needsItem && (
            <select
              value={selectedItemId}
              onChange={e => setSelectedItemId(e.target.value)}
              className="h-9 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Items</option>
              {items.map(it => <option key={it.id} value={it.id}>{it.item_name}</option>)}
            </select>
          )}

          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center gap-1">
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px] h-9 text-sm" />
              <span className="text-muted-foreground text-sm">—</span>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[140px] h-9 text-sm" />
            </div>
          </div>
          <Combobox
            options={presets.map(p => ({ value: p.label, label: p.label }))}
            value=""
            onChange={handlePreset}
            placeholder="Quick range"
            searchPlaceholder="Search..."
            className="w-[130px] h-9 text-sm"
          />

          <Button size="sm" onClick={fetchData} disabled={loading} className="h-9 gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            View
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={fetchData} disabled={loading} className="h-9 gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!hasLoaded} className="h-9 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={triggerPrint} disabled={!hasLoaded} className="h-9 gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              Print
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border overflow-hidden bg-card">
          <div className="bg-sky-100 dark:bg-sky-950/40 text-center py-2 border-b border-border">
            <h2 className="text-sm font-bold tracking-wide text-foreground">{option.label}</h2>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {facility.facilityLogo ? (
                <img src={facility.facilityLogo} alt={facility.facilityName} className="h-16 w-16 object-contain rounded border border-border flex-shrink-0" />
              ) : (
                <div className="h-16 w-16 rounded border border-border flex-shrink-0" />
              )}
              <div>
                <p className="font-semibold text-sm">{facility.facilityName || '—'}</p>
                {facility.facilityWebsite && <p className="text-xs text-muted-foreground">{facility.facilityWebsite}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs text-muted-foreground">
              <span><span className="font-semibold text-foreground">From:</span> {fmtDate(dateFrom)}</span>
              <span><span className="font-semibold text-foreground">To:</span> {fmtDate(dateTo)}</span>
              <span><span className="font-semibold text-foreground">Report DateTime:</span> {generatedAt ? generatedAt.toLocaleString() : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {option.mode === 'unavailable' && hasLoaded ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed border-border rounded-md text-center px-6">
          {option.unavailableReason}
        </div>
      ) : loading ? (
        <LoadingState message="Loading report..." />
      ) : !hasLoaded ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed border-border rounded-md">
          Pick a report type and date range above, then click View.
        </div>
      ) : (
        <AdvancedDataTable
          data={numberedRows}
          keyExtractor={keyExtractor}
          columns={columnsWithNo}
          emptyMessage={emptyMessage}
          pagination={{ enabled: true, pageSize: 25, pageSizeOptions: [25, 50, 100] }}
          maxRows={15}
          searchable
          searchPlaceholder="Search this report..."
        />
      )}
    </ReportSubPageShell>
  );
}
