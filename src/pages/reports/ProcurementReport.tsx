import React, { useState, useCallback, useMemo } from 'react';
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

// One Procurement / Accounts Payable Reports page, one dropdown — same
// shape as Revenue/Clinical/Inventory Reports. This is a NEW page; the
// existing operational /procurement/reports (purchase/delivery/orders/
// requisitions/receipts/consultant-bills tabs) is untouched — that page
// answers "what's the status of this PO/GRN", this one answers "give me
// a register/ledger-style report over a date range".

type Mode =
  | 'pending-bills' | 'bills-due-payment' | 'payments' | 'ap-aging-detailed' | 'ap-aging-summary'
  | 'consultant-bill-items' | 'consultant-bills' | 'purchases';

interface ReportOption {
  value: string;
  label: string;
  group: string;
  mode: Mode;
  allBranches: boolean;
  sortBy?: 'date' | 'supplier';
  aggGroupBy?: 'branch' | 'supplier' | 'item' | 'location';
  billStatus?: 'unpaid' | 'paid';
}

const REPORT_OPTIONS: ReportOption[] = [
  { value: 'pending_bills_all', label: 'Pending Supplier Bills (All Branches)', group: 'Supplier Bills', mode: 'pending-bills', allBranches: true, sortBy: 'date' },
  { value: 'pending_bills_branch', label: 'Pending Supplier Bills (By Branch)', group: 'Supplier Bills', mode: 'pending-bills', allBranches: false, sortBy: 'date' },
  { value: 'pending_bills_supplier', label: 'Pending Supplier Bills (By Supplier)', group: 'Supplier Bills', mode: 'pending-bills', allBranches: true, sortBy: 'supplier' },
  { value: 'bills_due_payment_branch', label: 'Supplier Bills Due Payment (By Branch)', group: 'Supplier Bills', mode: 'bills-due-payment', allBranches: false },

  { value: 'payments_detail_all', label: 'Supplier Bills Payments Detail (All Branches)', group: 'Payments', mode: 'payments', allBranches: true },
  { value: 'payments_detail_branch', label: 'Supplier Bills Payments Detail (By Branch)', group: 'Payments', mode: 'payments', allBranches: false },
  { value: 'payment_voucher_branch', label: 'Payment Voucher Report (By Branch)', group: 'Payments', mode: 'payments', allBranches: false },

  { value: 'ap_aging_detailed_branch', label: 'A/P Aging Schedule Detailed (By Branch)', group: 'A/P Aging', mode: 'ap-aging-detailed', allBranches: false },
  { value: 'ap_aging_summary_branch', label: 'A/P Aging Schedule Summary (By Branch)', group: 'A/P Aging', mode: 'ap-aging-summary', allBranches: false, aggGroupBy: 'branch' },
  { value: 'ap_aging_summary_supplier', label: 'A/P Aging Schedule Summary (By Supplier)', group: 'A/P Aging', mode: 'ap-aging-summary', allBranches: true, aggGroupBy: 'supplier' },

  { value: 'pending_consultant_items', label: 'Pending Consultant Bill Items', group: 'Consultant Bills', mode: 'consultant-bill-items', allBranches: true, billStatus: 'unpaid' },
  { value: 'cleared_consultant_items', label: 'Cleared Consultant Bill Items', group: 'Consultant Bills', mode: 'consultant-bill-items', allBranches: true, billStatus: 'paid' },
  { value: 'unsettled_consultant_bills', label: 'Unsettled Consultant Bills', group: 'Consultant Bills', mode: 'consultant-bills', allBranches: true, billStatus: 'unpaid' },
  { value: 'settled_consultant_bills', label: 'Settled Consultant Bills', group: 'Consultant Bills', mode: 'consultant-bills', allBranches: true, billStatus: 'paid' },

  { value: 'purchases_by_branch', label: 'Purchases By Branch', group: 'Purchases', mode: 'purchases', allBranches: true, aggGroupBy: 'branch' },
  { value: 'purchases_by_supplier', label: 'Purchases By Supplier', group: 'Purchases', mode: 'purchases', allBranches: true, aggGroupBy: 'supplier' },
  { value: 'purchases_by_item', label: 'Purchases By Item', group: 'Purchases', mode: 'purchases', allBranches: true, aggGroupBy: 'item' },
  { value: 'purchases_by_location', label: 'Purchases By Storage Location', group: 'Purchases', mode: 'purchases', allBranches: true, aggGroupBy: 'location' },
];

const OPTION_GROUPS = ['Supplier Bills', 'Payments', 'A/P Aging', 'Consultant Bills', 'Purchases'];

// Only /payments and /purchases actually filter by dateFrom/dateTo server-side
// (confirmed by reading reportProcurement.js) — the rest are current-state
// worklists (every still-outstanding bill/item, regardless of when it was
// raised), the same way a real A/P aging schedule is always "as of today"
// rather than bounded to a period. Showing a From/To range on those would
// claim a filter that was never actually applied.
const SNAPSHOT_MODES = new Set<Mode>(['pending-bills', 'bills-due-payment', 'ap-aging-detailed', 'ap-aging-summary', 'consultant-bill-items', 'consultant-bills']);

function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m + 1)}-01`, to: now.toISOString().split('T')[0] };
}

export default function ProcurementReport() {
  const { user } = useAuth();
  const facility = useFacilityInfo();
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [reportType, setReportType] = useState('pending_bills_all');
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const option = REPORT_OPTIONS.find(o => o.value === reportType)!;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const clinicId = user?.clinic || '1';
      const isSnapshot = SNAPSHOT_MODES.has(option.mode);
      const params = new URLSearchParams({ allBranches: String(option.allBranches), clinic_id: String(clinicId) });
      if (!isSnapshot) { params.set('dateFrom', dateFrom); params.set('dateTo', dateTo); }
      let path = '';

      if (option.mode === 'pending-bills') { path = '/pending-bills'; params.set('sortBy', option.sortBy || 'date'); }
      else if (option.mode === 'bills-due-payment') path = '/bills-due-payment';
      else if (option.mode === 'payments') path = '/payments';
      else if (option.mode === 'ap-aging-detailed') path = '/ap-aging-detailed';
      else if (option.mode === 'ap-aging-summary') { path = '/ap-aging-summary'; params.set('groupBy', option.aggGroupBy!); }
      else if (option.mode === 'consultant-bill-items') { path = '/consultant-bill-items'; params.set('status', option.billStatus!); }
      else if (option.mode === 'consultant-bills') { path = '/consultant-bills'; params.set('status', option.billStatus!); }
      else if (option.mode === 'purchases') { path = '/purchases'; params.set('groupBy', option.aggGroupBy!); }

      const res = await authFetch(`/api/reports-v2/procurement${path}?${params}`);
      if (!res.ok) throw new Error('Failed to load report');
      const json = await res.json();
      setRows(json.rows || []);
      setGeneratedAt(new Date());
      setHasLoaded(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load procurement report');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, reportType, user?.clinic]);

  // ── Columns per mode ─────────────────────────────────────────────────────
  let columns: Column<any>[] = [];
  let csvColumns: CsvColumn[] = [];
  let keyExtractor: (row: any, i: number) => string | number = (r, i) => r.id ?? i;
  let emptyMessage = 'No records found.';

  if (option.mode === 'pending-bills' || option.mode === 'bills-due-payment') {
    columns = [
      { key: 'poNumber', header: 'PO #', sortable: true, render: v => <span className="font-mono text-xs text-primary">{v}</span> },
      { key: 'supplierName', header: 'Supplier', sortable: true, render: v => v || '—' },
      { key: 'orderDate', header: 'Order Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      ...(option.mode === 'bills-due-payment' ? [{ key: 'dueDate', header: 'Est. Due Date', sortable: true, render: (v: any) => <span className="font-medium">{v ? fmtDate(v) : '—'}</span> }] : []),
      { key: 'totalAmount', header: 'Total', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'paidAmount', header: 'Paid', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'balanceAmount', header: 'Balance', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      { key: 'paymentStatus', header: 'Status', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'PO #', key: 'poNumber' }, { header: 'Supplier', key: 'supplierName' }, { header: 'Order Date', key: 'orderDate', transform: v => fmtDate(v) }, { header: 'Total', key: 'totalAmount', transform: v => fmtCurrency(v) }, { header: 'Paid', key: 'paidAmount', transform: v => fmtCurrency(v) }, { header: 'Balance', key: 'balanceAmount', transform: v => fmtCurrency(v) }, { header: 'Status', key: 'paymentStatus' }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'payments') {
    columns = [
      { key: 'paymentDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'poNumber', header: 'PO #', sortable: true, render: v => <span className="font-mono text-xs text-primary">{v}</span> },
      { key: 'supplierName', header: 'Supplier', sortable: true, render: v => v || '—' },
      { key: 'amountPaid', header: 'Amount Paid', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      { key: 'paymentMethod', header: 'Method', sortable: true, render: v => <span className="capitalize">{v || '—'}</span> },
      { key: 'voucherNumber', header: 'Voucher #', sortable: true, render: v => <span className="font-mono text-xs">{v || '—'}</span> },
      { key: 'referenceNumber', header: 'Reference', render: v => v || '—' },
      { key: 'paidBy', header: 'Paid By', render: v => v || '—' },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Date', key: 'paymentDate', transform: v => fmtDate(v) }, { header: 'PO #', key: 'poNumber' }, { header: 'Supplier', key: 'supplierName' }, { header: 'Amount Paid', key: 'amountPaid', transform: v => fmtCurrency(v) }, { header: 'Method', key: 'paymentMethod' }, { header: 'Voucher #', key: 'voucherNumber' }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'ap-aging-detailed') {
    columns = [
      { key: 'poNumber', header: 'PO #', sortable: true, render: v => <span className="font-mono text-xs text-primary">{v}</span> },
      { key: 'supplierName', header: 'Supplier', sortable: true, render: v => v || '—' },
      { key: 'orderDate', header: 'Order Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'daysOverdue', header: 'Days', align: 'right', sortable: true, render: v => <span className="font-mono">{v}</span> },
      { key: 'bucketLabel', header: 'Aging Bucket', sortable: true },
      { key: 'balanceAmount', header: 'Balance', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'PO #', key: 'poNumber' }, { header: 'Supplier', key: 'supplierName' }, { header: 'Order Date', key: 'orderDate', transform: v => fmtDate(v) }, { header: 'Days Overdue', key: 'daysOverdue' }, { header: 'Bucket', key: 'bucketLabel' }, { header: 'Balance', key: 'balanceAmount', transform: v => fmtCurrency(v) }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'ap-aging-summary') {
    keyExtractor = r => r.groupLabel;
    columns = [
      { key: 'groupLabel', header: option.aggGroupBy === 'supplier' ? 'Supplier' : 'Branch', sortable: true },
      { key: 'current', header: 'Current (0-30)', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
      { key: 'd31_60', header: '31-60 Days', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
      { key: 'd61_90', header: '61-90 Days', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
      { key: 'd90_plus', header: '90+ Days', align: 'right', sortable: true, render: v => <span className="font-mono text-red-600">{fmtCurrency(v)}</span> },
      { key: 'total', header: 'Total Outstanding', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: option.aggGroupBy === 'supplier' ? 'Supplier' : 'Branch', key: 'groupLabel' }, { header: 'Current (0-30)', key: 'current', transform: v => fmtCurrency(v) }, { header: '31-60 Days', key: 'd31_60', transform: v => fmtCurrency(v) }, { header: '61-90 Days', key: 'd61_90', transform: v => fmtCurrency(v) }, { header: '90+ Days', key: 'd90_plus', transform: v => fmtCurrency(v) }, { header: 'Total', key: 'total', transform: v => fmtCurrency(v) }];
  } else if (option.mode === 'consultant-bill-items') {
    columns = [
      { key: 'visitDate', header: 'Visit Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'consultantName', header: 'Consultant', sortable: true },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'billNumber', header: 'Bill #', sortable: true, render: v => <span className="font-mono text-xs text-primary">{v}</span> },
      { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Visit Date', key: 'visitDate', transform: v => fmtDate(v) }, { header: 'Consultant', key: 'consultantName' }, { header: 'Patient', key: 'patientName' }, { header: 'Bill #', key: 'billNumber' }, { header: 'Amount', key: 'amount', transform: v => fmtCurrency(v) }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'consultant-bills') {
    columns = [
      { key: 'billNumber', header: 'Bill #', sortable: true, render: v => <span className="font-mono text-xs text-primary">{v}</span> },
      { key: 'consultantName', header: 'Consultant', sortable: true },
      { key: 'periodFrom', header: 'Period From', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'periodTo', header: 'Period To', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'billAmount', header: 'Amount', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      { key: 'paidAt', header: 'Paid At', render: v => v ? fmtDate(v) : '—' },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Bill #', key: 'billNumber' }, { header: 'Consultant', key: 'consultantName' }, { header: 'Period From', key: 'periodFrom', transform: v => fmtDate(v) }, { header: 'Period To', key: 'periodTo', transform: v => fmtDate(v) }, { header: 'Amount', key: 'billAmount', transform: v => fmtCurrency(v) }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'purchases') {
    keyExtractor = r => r.groupLabel;
    columns = [
      { key: 'groupLabel', header: option.aggGroupBy === 'item' ? 'Item' : option.aggGroupBy === 'supplier' ? 'Supplier' : option.aggGroupBy === 'location' ? 'Storage Location' : 'Branch', sortable: true },
      { key: 'orderCount', header: 'Orders', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
      ...(option.aggGroupBy === 'item' ? [{ key: 'totalQuantity', header: 'Total Qty', align: 'right' as const, sortable: true, render: (v: any) => <span className="font-mono">{fmtCount(v)}</span> }] : []),
      { key: 'totalAmount', header: 'Total Purchased', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: 'Group', key: 'groupLabel' }, { header: 'Orders', key: 'orderCount' }, { header: 'Total Purchased', key: 'totalAmount', transform: v => fmtCurrency(v) }];
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
  const handleExportCSV = () => exportCSV(numberedRows, csvColumns, `procurement-${option.value}-${dateFrom}-${dateTo}.csv`);

  return (
    <ReportSubPageShell
      title="Procurement Reports"
      description="Pick a report type and date range, then click View."
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      hideControls
    >
      <div className="sticky top-0 z-10 -mx-6 -mt-6 px-6 pt-6 pb-4 mb-4 bg-background border-b border-border shadow-sm print:static print:mx-0 print:px-0 print:pt-0 print:pb-0 print:mb-0 print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-end gap-3 mb-4 print:hidden">
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
              {SNAPSHOT_MODES.has(option.mode) ? (
                <span><span className="font-semibold text-foreground">As Of:</span> {generatedAt ? fmtDate(generatedAt.toISOString()) : fmtDate(new Date().toISOString())}</span>
              ) : (
                <>
                  <span><span className="font-semibold text-foreground">From:</span> {fmtDate(dateFrom)}</span>
                  <span><span className="font-semibold text-foreground">To:</span> {fmtDate(dateTo)}</span>
                </>
              )}
              <span><span className="font-semibold text-foreground">Report DateTime:</span> {generatedAt ? generatedAt.toLocaleString() : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
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
