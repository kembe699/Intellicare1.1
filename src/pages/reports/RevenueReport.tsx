import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { ReportLetterhead } from './ReportLetterhead';
import { toast } from 'sonner';
import { ReportSubPageShell } from './ReportSubPageShell';
import { LoadingState } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Calendar, RefreshCw, Download, Printer, Eye } from 'lucide-react';
import { fmtCurrency, fmtCount, fmtDate, fmtNum, CsvColumn, getDatePresets, exportCSV, triggerPrint } from '@/utils/reportUtils';

// One Revenue Report page, one report-type dropdown — every variant the
// hospital asked for (by user/department/scheme/branch/payment mode/doctor/
// item, patient-bill breakdowns by branch/scheme/status with an outpatient/
// inpatient/discharged filter, a chronological revenue journal, weekly/
// monthly trends, cancelled receipts/invoices, service cost analysis, and a
// patient register by scheme) lives behind one selector instead of a
// four-button tab strip. Picking a report type or date range only updates
// the form — nothing loads until "View" is clicked, so a report never
// fetches while someone is still choosing what they want. The selector,
// date range and letterhead stay pinned at the top (sticky) while a long
// table scrolls underneath, capped to a fixed height so it scrolls inside
// itself rather than growing the page.

type Mode = 'group' | 'bills-group' | 'detail-only' | 'trend' | 'cancelled-receipts' | 'cancelled-invoices' | 'cost-analysis' | 'register';
type PatientType = 'all' | 'outpatient' | 'inpatient' | 'discharged';

interface ReportOption {
  value: string;
  label: string;
  group: string;
  mode: Mode;
  billsGroupBy?: 'branch' | 'scheme' | 'status';
  patientType?: PatientType;
}

const REPORT_OPTIONS: ReportOption[] = [
  { value: 'user', label: 'Revenue by User (Cashier)', group: 'Revenue Breakdowns', mode: 'group' },
  { value: 'department', label: 'Revenue by Department / Category', group: 'Revenue Breakdowns', mode: 'group' },
  { value: 'scheme', label: 'Revenue by Scheme', group: 'Revenue Breakdowns', mode: 'group' },
  { value: 'branch', label: 'Revenue by Branch', group: 'Revenue Breakdowns', mode: 'group' },
  { value: 'payment_mode', label: 'Revenue by Payment Mode', group: 'Revenue Breakdowns', mode: 'group' },
  { value: 'doctor', label: 'Revenue by Doctor', group: 'Revenue Breakdowns', mode: 'group' },
  { value: 'item', label: 'Revenue Detailed (By Item)', group: 'Revenue Breakdowns', mode: 'group' },
  { value: 'journal', label: 'Revenue Journal (All Receipts)', group: 'Revenue Breakdowns', mode: 'detail-only' },
  { value: 'trend_week', label: 'Revenue — Weekly Trend', group: 'Revenue Breakdowns', mode: 'trend' },
  { value: 'trend_month', label: 'Revenue — Monthly Trend', group: 'Revenue Breakdowns', mode: 'trend' },

  { value: 'bills_all_branch', label: 'All Patient Bills (By Branch)', group: 'Patient Bills', mode: 'bills-group', billsGroupBy: 'branch', patientType: 'all' },
  { value: 'bills_all_scheme', label: 'All Patient Bills (By Scheme)', group: 'Patient Bills', mode: 'bills-group', billsGroupBy: 'scheme', patientType: 'all' },
  { value: 'bills_all_status', label: 'All Patient Bills (By Status)', group: 'Patient Bills', mode: 'bills-group', billsGroupBy: 'status', patientType: 'all' },
  { value: 'bills_out_branch', label: 'Outpatient Bills (By Branch)', group: 'Patient Bills', mode: 'bills-group', billsGroupBy: 'branch', patientType: 'outpatient' },
  { value: 'bills_out_scheme', label: 'Outpatient Bills (By Scheme)', group: 'Patient Bills', mode: 'bills-group', billsGroupBy: 'scheme', patientType: 'outpatient' },
  { value: 'bills_in_branch', label: 'Inpatient / Admitted Bills (By Branch)', group: 'Patient Bills', mode: 'bills-group', billsGroupBy: 'branch', patientType: 'inpatient' },
  { value: 'bills_in_scheme', label: 'Inpatient / Admitted Bills (By Scheme)', group: 'Patient Bills', mode: 'bills-group', billsGroupBy: 'scheme', patientType: 'inpatient' },
  { value: 'bills_discharged_branch', label: 'Discharged Inpatient Bills (By Branch)', group: 'Patient Bills', mode: 'bills-group', billsGroupBy: 'branch', patientType: 'discharged' },
  { value: 'bills_detail', label: 'Total Invoices Breakdown (All Branches)', group: 'Patient Bills', mode: 'detail-only' },

  { value: 'cancelled_receipts', label: 'Cancelled Receipts', group: 'Cancelled / Voided', mode: 'cancelled-receipts' },
  { value: 'cancelled_invoices', label: 'Cancelled Invoices', group: 'Cancelled / Voided', mode: 'cancelled-invoices' },

  { value: 'service_cost_analysis', label: 'Service Cost Analysis', group: 'Analysis', mode: 'cost-analysis' },
  { value: 'patient_register', label: 'Patient Register (By Scheme)', group: 'Analysis', mode: 'register' },
];

const OPTION_GROUPS = ['Revenue Breakdowns', 'Patient Bills', 'Cancelled / Voided', 'Analysis'];

function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m + 1)}-01`, to: now.toISOString().split('T')[0] };
}

function fmtBucket(iso: string, interval: 'week' | 'month'): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return interval === 'month'
    ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

const TREND_COLOR = '#1A7A75'; // app primary teal — hsl(var(--primary)), same as DashboardOverview.tsx's revenue chart

function formatCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-semibold text-foreground">{fmtCurrency(payload[0]?.value)}</p>
      <p className="text-muted-foreground">{fmtCount(payload[0]?.payload?.transactionCount)} transaction{payload[0]?.payload?.transactionCount === 1 ? '' : 's'}</p>
    </div>
  );
}

export default function RevenueReport() {
  const { user } = useAuth();
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [reportType, setReportType] = useState('user');
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [costSummary, setCostSummary] = useState<{ totalRevenue: number; totalCOGS: number; grossMargin: number; grossMarginPct: number } | null>(null);
  const [cogsByAccount, setCogsByAccount] = useState<{ accountName: string; amount: number }[]>([]);
  const [schemes, setSchemes] = useState<{ id: string; scheme_name: string }[]>([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState(''); // '' = all schemes; 'cash' = the Cash/No Scheme bucket

  // Loaded once, up front — the Patient Register filter needs the list
  // before anyone even picks that report, not lazily on first use.
  useEffect(() => {
    const params = new URLSearchParams();
    if (user?.clinic) params.append('clinic_id', user.clinic);
    authFetch(`/api/schemes/active?${params}`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => setSchemes(Array.isArray(data) ? data : []))
      .catch(() => setSchemes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.clinic]);

  const option = REPORT_OPTIONS.find(o => o.value === reportType)!;
  const isGroupShaped = option.mode === 'group' || option.mode === 'bills-group';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setCostSummary(null);
    setCogsByAccount([]);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (user?.clinic) params.append('clinic_id', user.clinic);

      if (option.mode === 'group') {
        if (option.value === 'user') {
          const res = await authFetch(`/api/reports-v2/billing-by-user?${params}`);
          if (!res.ok) throw new Error('Failed to load');
          const json = await res.json();
          setRows((json.cashiers || []).map((c: any) => ({ key: String(c.cashierId ?? c.cashierName), label: c.cashierName, transactionCount: c.transactionCount, totalCollected: c.totalCollected })));
        } else if (option.value === 'department') {
          const res = await authFetch(`/api/reports-v2/clinic-performance?${params}`);
          if (!res.ok) throw new Error('Failed to load');
          const json = await res.json();
          setRows((json.byCategory || []).map((c: any) => ({ key: c.category, label: c.category, transactionCount: c.volume, totalCollected: c.totalCollected })));
        } else if (option.value === 'doctor') {
          const res = await authFetch(`/api/reports-v2/doctor-performance?${params}`);
          if (!res.ok) throw new Error('Failed to load');
          const json = await res.json();
          setRows((json.doctors || []).map((d: any) => ({ key: d.doctorId, label: d.doctorName, transactionCount: d.visits, totalCollected: d.revenueCollected })));
        } else {
          const res = await authFetch(`/api/reports-v2/revenue?${params}&groupBy=${option.value}`);
          if (!res.ok) throw new Error('Failed to load');
          const json = await res.json();
          setRows((json.rows || []).map((r: any) => ({ key: r.key, label: r.label, transactionCount: r.transactionCount, totalCollected: r.totalCollected })));
        }
      } else if (option.mode === 'bills-group') {
        params.set('groupBy', option.billsGroupBy!);
        params.set('patientType', option.patientType!);
        const res = await authFetch(`/api/reports-v2/revenue/bills?${params}`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows(json.rows || []);
      } else if (option.mode === 'detail-only' && option.value === 'bills_detail') {
        const res = await authFetch(`/api/reports-v2/revenue/detail?${params}&source=bills`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows(json.rows || []);
      } else if (option.mode === 'detail-only') {
        // 'journal' — the only other detail-only option.
        const res = await authFetch(`/api/reports-v2/revenue/detail?${params}&source=receipts`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows(json.rows || []);
      } else if (option.mode === 'trend') {
        const interval = option.value === 'trend_month' ? 'month' : 'week';
        const res = await authFetch(`/api/reports-v2/revenue/trend?${params}&interval=${interval}`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows((json.rows || []).map((r: any) => ({ ...r, label: fmtBucket(r.bucket, interval) })));
      } else if (option.mode === 'cancelled-receipts' || option.mode === 'cancelled-invoices') {
        const res = await authFetch(`/api/reports-v2/cancelled-transactions?${params}`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows(option.mode === 'cancelled-receipts' ? (json.cancelledReceipts || []) : (json.voidedLineItems || []));
      } else if (option.mode === 'cost-analysis') {
        const res = await authFetch(`/api/reports-v2/revenue/service-cost-analysis?${params}`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows(json.byCategory || []);
        setCostSummary(json.summary || null);
        setCogsByAccount(json.cogsByAccount || []);
      } else if (option.mode === 'register') {
        if (selectedSchemeId) params.set('schemeId', selectedSchemeId);
        const res = await authFetch(`/api/reports-v2/revenue/patient-register?${params}`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows(json.rows || []);
      }
      setGeneratedAt(new Date());
      setHasLoaded(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load revenue report');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, user?.clinic, reportType, selectedSchemeId]);

  const sortedGroupRows = useMemo(
    () => isGroupShaped
      ? [...rows].sort((a, b) => (b.totalCollected ?? b.totalBilled ?? 0) - (a.totalCollected ?? a.totalBilled ?? 0))
      : rows,
    [rows, isGroupShaped]
  );

  const groupTotal = sortedGroupRows.reduce((s, r) => s + (r.totalCollected ?? 0), 0);

  // ── Columns + CSV per render shape ──────────────────────────────────────
  let columns: Column<any>[] = [];
  let csvColumns: CsvColumn[] = [];
  let keyExtractor: (row: any, i: number) => string | number = (r, i) => r.key ?? r.id ?? i;
  let emptyMessage = 'No activity in this period.';

  if (option.mode === 'group') {
    columns = [
      { key: 'label', header: option.label.replace('Revenue by ', '').replace('Revenue Detailed (By ', '').replace(')', ''), sortable: true },
      { key: 'transactionCount', header: 'Transactions', align: 'right', sortable: true, render: v => <span className="text-muted-foreground">{v != null ? fmtCount(v) : '—'}</span> },
      { key: 'totalCollected', header: 'Revenue Collected', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [
      { header: 'Label', key: 'label' },
      { header: 'Transactions', key: 'transactionCount' },
      { header: 'Revenue Collected', key: 'totalCollected', transform: v => fmtCurrency(v) },
    ];
  } else if (option.mode === 'bills-group') {
    columns = [
      { key: 'label', header: option.billsGroupBy === 'status' ? 'Status' : option.billsGroupBy === 'scheme' ? 'Scheme' : 'Branch', sortable: true },
      { key: 'billCount', header: 'Bills', align: 'right', sortable: true, render: v => <span className="text-muted-foreground">{fmtCount(v)}</span> },
      { key: 'totalBilled', header: 'Total Billed', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
      { key: 'totalPaid', header: 'Total Paid', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'totalBalance', header: 'Balance', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [
      { header: 'Label', key: 'label' }, { header: 'Bills', key: 'billCount' },
      { header: 'Total Billed', key: 'totalBilled', transform: v => fmtCurrency(v) },
      { header: 'Total Paid', key: 'totalPaid', transform: v => fmtCurrency(v) },
      { header: 'Balance', key: 'totalBalance', transform: v => fmtCurrency(v) },
    ];
  } else if (option.mode === 'detail-only' && option.value === 'bills_detail') {
    keyExtractor = r => r.id;
    columns = [
      { key: 'date', header: 'Bill Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'billNumber', header: 'Bill #', sortable: true, render: v => <span className="font-mono text-primary">{v}</span> },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'branch', header: 'Branch', sortable: true },
      { key: 'scheme', header: 'Scheme', sortable: true },
      { key: 'patientType', header: 'Patient Type', sortable: true },
      { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'totalAmount', header: 'Total', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
      { key: 'paidAmount', header: 'Paid', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'balanceAmount', header: 'Balance', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [
      { header: 'Bill Date', key: 'date', transform: v => fmtDate(v) }, { header: 'Bill #', key: 'billNumber' },
      { header: 'Patient', key: 'patientName' }, { header: 'Branch', key: 'branch' }, { header: 'Scheme', key: 'scheme' },
      { header: 'Patient Type', key: 'patientType' }, { header: 'Status', key: 'status' },
      { header: 'Total', key: 'totalAmount', transform: v => fmtCurrency(v) },
      { header: 'Paid', key: 'paidAmount', transform: v => fmtCurrency(v) },
      { header: 'Balance', key: 'balanceAmount', transform: v => fmtCurrency(v) },
    ];
  } else if (option.mode === 'detail-only') {
    // 'journal' — the only other detail-only option.
    keyExtractor = r => r.id;
    columns = [
      { key: 'date', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'receiptNumber', header: 'Receipt #', sortable: true, render: v => <span className="font-mono text-primary">{v}</span> },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'branch', header: 'Branch', sortable: true },
      { key: 'scheme', header: 'Scheme', sortable: true },
      { key: 'cashierName', header: 'Cashier', sortable: true },
      { key: 'paymentMethod', header: 'Payment Mode', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [
      { header: 'Date', key: 'date', transform: v => fmtDate(v) }, { header: 'Receipt #', key: 'receiptNumber' },
      { header: 'Patient', key: 'patientName' }, { header: 'Branch', key: 'branch' }, { header: 'Scheme', key: 'scheme' },
      { header: 'Cashier', key: 'cashierName' }, { header: 'Payment Mode', key: 'paymentMethod' },
      { header: 'Amount', key: 'amount', transform: v => fmtCurrency(v) },
    ];
  } else if (option.mode === 'trend') {
    keyExtractor = r => r.bucket;
    columns = [
      { key: 'label', header: option.value === 'trend_month' ? 'Month' : 'Week' },
      { key: 'transactionCount', header: 'Transactions', align: 'right', render: v => <span className="text-muted-foreground">{fmtCount(v)}</span> },
      { key: 'totalCollected', header: 'Revenue Collected', align: 'right', render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: option.value === 'trend_month' ? 'Month' : 'Week', key: 'label' }, { header: 'Transactions', key: 'transactionCount' }, { header: 'Revenue Collected', key: 'totalCollected', transform: v => fmtCurrency(v) }];
  } else if (option.mode === 'cancelled-receipts') {
    keyExtractor = r => r.id;
    columns = [
      { key: 'paymentDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'receiptNumber', header: 'Receipt #', sortable: true, render: v => <span className="font-mono text-primary">{v}</span> },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      { key: 'paymentMethod', header: 'Payment Mode', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'cashierName', header: 'Cashier', sortable: true },
      { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize text-red-600 font-medium">{v}</span> },
      { key: 'note', header: 'Note' },
    ];
    csvColumns = [{ header: 'Date', key: 'paymentDate', transform: v => fmtDate(v) }, { header: 'Receipt #', key: 'receiptNumber' }, { header: 'Patient', key: 'patientName' }, { header: 'Amount', key: 'amount', transform: v => fmtCurrency(v) }, { header: 'Payment Mode', key: 'paymentMethod' }, { header: 'Cashier', key: 'cashierName' }, { header: 'Status', key: 'status' }];
    emptyMessage = 'No cancelled or refunded receipts in this period.';
  } else if (option.mode === 'cancelled-invoices') {
    keyExtractor = (r, i) => `${r.billId}-${r.lineIndex ?? i}`;
    columns = [
      { key: 'billDate', header: 'Bill Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'billNumber', header: 'Bill #', sortable: true, render: v => <span className="font-mono text-primary">{v}</span> },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'serviceName', header: 'Voided Service', sortable: true },
      { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      { key: 'reason', header: 'Reason', render: v => v || '—' },
      { key: 'updatedBy', header: 'Voided By', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Bill Date', key: 'billDate', transform: v => fmtDate(v) }, { header: 'Bill #', key: 'billNumber' }, { header: 'Patient', key: 'patientName' }, { header: 'Voided Service', key: 'serviceName' }, { header: 'Amount', key: 'amount', transform: v => fmtCurrency(v) }, { header: 'Reason', key: 'reason' }, { header: 'Voided By', key: 'updatedBy' }];
    emptyMessage = 'No voided line items in this period.';
  } else if (option.mode === 'cost-analysis') {
    columns = [
      { key: 'category', header: 'Category', sortable: true },
      { key: 'totalBilled', header: 'Billed', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'totalCollected', header: 'Collected', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: 'Category', key: 'category' }, { header: 'Billed', key: 'totalBilled', transform: v => fmtCurrency(v) }, { header: 'Collected', key: 'totalCollected', transform: v => fmtCurrency(v) }];
  } else if (option.mode === 'register') {
    keyExtractor = r => r.patientId;
    columns = [
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'schemeName', header: 'Scheme', sortable: true },
      { key: 'billCount', header: 'Bills', align: 'right', sortable: true, render: v => <span className="text-muted-foreground">{fmtCount(v)}</span> },
      { key: 'totalBilled', header: 'Total Billed', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
      { key: 'totalPaid', header: 'Total Paid', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'totalBalance', header: 'Balance', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: 'Patient', key: 'patientName' }, { header: 'Scheme', key: 'schemeName' }, { header: 'Bills', key: 'billCount' }, { header: 'Total Billed', key: 'totalBilled', transform: v => fmtCurrency(v) }, { header: 'Total Paid', key: 'totalPaid', transform: v => fmtCurrency(v) }, { header: 'Balance', key: 'totalBalance', transform: v => fmtCurrency(v) }];
  }

  // Row number, computed over the full (unpaginated) result so it stays
  // correct across pages, not reset to 1 on every page like the table's own
  // local row index would.
  const numberedRows = useMemo(
    () => (isGroupShaped ? sortedGroupRows : rows)
      .map((r, i) => ({ ...r, no: i + 1 })),
    [sortedGroupRows, rows, isGroupShaped]
  );
  const displayRows = numberedRows;
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
  const handleExportCSV = () => exportCSV(displayRows, csvColumns, `revenue-${option.value}-${dateFrom}-${dateTo}.csv`);

  return (
    <ReportSubPageShell
      title="Revenue Report"
      description="Pick a report type and date range, then click View."
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      hideControls
    >
      {/* Selector, date range, and letterhead stay pinned while the table
          scrolls beneath — matches the standard page background so content
          scrolling underneath never shows through. */}
      <div className="sticky top-0 z-10 -mx-6 -mt-6 px-6 pt-6 pb-4 bg-primary/20 print:hidden">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <select
            value={reportType}
            onChange={e => setReportType(e.target.value)}
            className="h-9 min-w-[280px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {OPTION_GROUPS.map(group => (
              <optgroup key={group} label={group}>
                {REPORT_OPTIONS.filter(o => o.group === group).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {option.mode === 'register' && (
            <select
              value={selectedSchemeId}
              onChange={e => setSelectedSchemeId(e.target.value)}
              className="h-9 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Schemes</option>
              <option value="cash">Cash / No Scheme</option>
              {schemes.map(s => (
                <option key={s.id} value={s.id}>{s.scheme_name}</option>
              ))}
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

        <ReportLetterhead title={option.label} dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} className="mb-0" />
      </div>

      {option.mode === 'cost-analysis' && costSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Total Revenue</p>
            <p className="text-2xl font-bold mt-1 text-primary">{fmtCurrency(costSummary.totalRevenue)}</p>
          </div>
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Cost of Goods Sold</p>
            <p className="text-2xl font-bold mt-1 text-amber-700">{fmtCurrency(costSummary.totalCOGS)}</p>
            {cogsByAccount.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{cogsByAccount.map(a => a.accountName).join(', ')}</p>
            )}
          </div>
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Gross Margin</p>
            <p className={`text-2xl font-bold mt-1 ${costSummary.grossMargin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtCurrency(costSummary.grossMargin)}</p>
          </div>
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Gross Margin %</p>
            <p className="text-2xl font-bold mt-1">{fmtNum(costSummary.grossMarginPct, 1)}%</p>
          </div>
        </div>
      )}

      {option.mode === 'trend' && hasLoaded && rows.length > 0 && (
        <div className="bg-card rounded-lg border shadow-sm p-4 mb-4">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={false}
                interval={rows.length > 14 ? Math.ceil(rows.length / 10) : 0}
              />
              <YAxis
                tickFormatter={formatCompact}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <RTooltip content={<TrendTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
              <Bar dataKey="totalCollected" fill={TREND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading report..." />
      ) : !hasLoaded ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed border-border rounded-md">
          Pick a report type and date range above, then click View.
        </div>
      ) : (
        <>
          <AdvancedDataTable
            data={displayRows}
            keyExtractor={keyExtractor}
            columns={columnsWithNo}
            emptyMessage={emptyMessage}
            pagination={{ enabled: true, pageSize: 25, pageSizeOptions: [25, 50, 100] }}
            maxRows={15}
            searchable
            searchPlaceholder="Search this report..."
          />
          {isGroupShaped && sortedGroupRows.length > 0 && (
            <div className="flex justify-between items-center px-4 py-2.5 border border-t-0 border-border rounded-b-md bg-muted/20 text-sm font-semibold -mt-px">
              <span>Total</span>
              <span className="flex gap-8">
                {option.mode === 'group' ? (
                  <>
                    <span>{fmtCount(sortedGroupRows.reduce((s, r) => s + (r.transactionCount || 0), 0))}</span>
                    <span>{fmtCurrency(groupTotal)}</span>
                  </>
                ) : (
                  <>
                    <span>{fmtCount(sortedGroupRows.reduce((s, r) => s + (r.billCount || 0), 0))}</span>
                    <span>{fmtCurrency(sortedGroupRows.reduce((s, r) => s + (r.totalBilled || 0), 0))}</span>
                  </>
                )}
              </span>
            </div>
          )}
        </>
      )}
    </ReportSubPageShell>
  );
}
