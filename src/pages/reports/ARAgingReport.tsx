import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { Loader2, DollarSign, Clock, AlertTriangle, AlertOctagon, Search } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { ReportLetterhead } from './ReportLetterhead';
import { StatusBadge, StatusBadgeTone, LoadingState} from '@/components/common';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { fmtCurrency, fmtCount, fmtNum, fmtDate, CsvColumn } from '@/utils/reportUtils';

// ── Types ────────────────────────────────────────────────────────────────

type Bucket = 'current' | 'd31_60' | 'd61_90' | 'd90_plus';

interface AgingBillRow {
  id: string;
  billNumber: string;
  patientId: string;
  patientName: string;
  billDate: string;
  dueDate: string | null;
  status: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  daysOverdue: number;
  bucket: Bucket;
}

interface AgingSummaryRow {
  bucket: Bucket;
  label: string;
  count: number;
  amount: number;
  pctOfTotal: number;
}

interface ARAgingPayload {
  clinicId: number;
  asOf: string;
  summary: {
    totalOutstanding: number;
    totalCount: number;
    buckets: Record<Bucket, { count: number; amount: number }>;
  };
  agingSummary: AgingSummaryRow[];
  items: AgingBillRow[];
}

// Progression from healthy to critical: green -> blue -> amber -> red.
const BUCKET_TONE: Record<Bucket, StatusBadgeTone> = {
  current: 'success',
  d31_60: 'info',
  d61_90: 'warning',
  d90_plus: 'danger',
};

const BUCKET_LABEL: Record<Bucket, string> = {
  current: 'Current (0-30d)',
  d31_60: '31-60 Days',
  d61_90: '61-90 Days',
  d90_plus: '90+ Days',
};

const BUCKET_ORDER: Bucket[] = ['current', 'd31_60', 'd61_90', 'd90_plus'];

// ── Component ────────────────────────────────────────────────────────────

export default function ARAgingReport() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;

  // Aging is always bucketed against today, but which bills are considered can be
  // narrowed by bill date — e.g. "AR aging for bills raised last quarter" vs. the
  // whole open book. Blank (the default) means no date filter, same as before.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ARAgingPayload | null>(null);
  const [search, setSearch] = useState('');
  const [bucketFilter, setBucketFilter] = useState<'all' | Bucket>('all');
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ clinic_id: String(clinicId) });
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await authFetch(`/api/reports-v2/ar-aging?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load AR aging report');
      setData(await res.json());
      setGeneratedAt(new Date());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load AR aging report');
    } finally {
      setLoading(false);
    }
  }, [clinicId, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const items = data?.items || [];
  const summary = data?.summary || {
    totalOutstanding: 0,
    totalCount: 0,
    buckets: {
      current: { count: 0, amount: 0 },
      d31_60: { count: 0, amount: 0 },
      d61_90: { count: 0, amount: 0 },
      d90_plus: { count: 0, amount: 0 },
    },
  };
  const agingSummary = data?.agingSummary || [];

  // Detail table: sorted oldest/most-overdue first by default (collections priority).
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.daysOverdue - a.daysOverdue),
    [items]
  );

  const filteredItems = useMemo(() => sortedItems.filter(item => {
    const q = search.toLowerCase();
    const matchesSearch = !q
      || item.patientName?.toLowerCase().includes(q)
      || item.billNumber?.toLowerCase().includes(q);
    const matchesBucket = bucketFilter === 'all' || item.bucket === bucketFilter;
    return matchesSearch && matchesBucket;
  }), [sortedItems, search, bucketFilter]);

  const csvColumns: CsvColumn[] = [
    { header: 'Bill Number', key: 'billNumber' },
    { header: 'Patient', key: 'patientName' },
    { header: 'Bill Date', key: 'billDate', transform: v => fmtDate(v) },
    { header: 'Days Overdue', key: 'daysOverdue' },
    { header: 'Aging Bucket', key: 'bucket', transform: v => BUCKET_LABEL[v as Bucket] },
    { header: 'Total', key: 'totalAmount', transform: v => fmtCurrency(v) },
    { header: 'Paid', key: 'paidAmount', transform: v => fmtCurrency(v) },
    { header: 'Balance', key: 'balanceAmount', transform: v => fmtCurrency(v) },
    { header: 'Status', key: 'status' },
  ];

  const d90 = summary.buckets.d90_plus;

  return (
    <ReportSubPageShell
      title="Accounts Receivable Aging"
      description="Outstanding patient balances as of today, bucketed by days overdue. Optionally filter to bills raised in a given date range."
      dateFrom={dateFrom} dateTo={dateTo}
      onDateFromChange={setDateFrom} onDateToChange={setDateTo}
      onRefresh={fetchData} loading={loading}
      csvData={filteredItems} csvColumns={csvColumns} csvFilename={`ar-aging-report-${new Date().toISOString().split('T')[0]}.csv`}
    >
      <ReportLetterhead title="Accounts Receivable Aging" dateFrom={dateFrom} dateTo={data?.asOf || new Date().toISOString().split('T')[0]} generatedAt={generatedAt} asOf />
      {loading && !data ? (
        <LoadingState message="Loading report..." />
      ) : (
        <div className="space-y-6">

          {/* Headline stat tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Outstanding</p>
                  <p className="text-2xl font-bold mt-1 text-primary">{fmtCurrency(summary.totalOutstanding)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fmtCount(summary.totalCount)} bill{summary.totalCount === 1 ? '' : 's'} unpaid</p>
                </div>
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Current (0-30d)</p>
                  <p className="text-2xl font-bold mt-1 text-emerald-700">{fmtCurrency(summary.buckets.current.amount)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fmtCount(summary.buckets.current.count)} bills</p>
                </div>
                <Clock className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">31-90 Days</p>
                  <p className="text-2xl font-bold mt-1 text-amber-700">
                    {fmtCurrency(summary.buckets.d31_60.amount + summary.buckets.d61_90.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtCount(summary.buckets.d31_60.count + summary.buckets.d61_90.count)} bills
                  </p>
                </div>
                <AlertTriangle className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">90+ Days (Critical)</p>
                  <p className="text-2xl font-bold mt-1 text-red-700">{fmtCurrency(d90.amount)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">across {fmtCount(d90.count)} bill{d90.count === 1 ? '' : 's'}</p>
                </div>
                <AlertOctagon className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>

          {/* Aging summary table */}
          <div>
            <div className="mb-2">
              <h3 className="font-medium text-sm">Aging Summary</h3>
              <p className="text-xs text-muted-foreground mt-0.5">As of {fmtDate(data?.asOf)}</p>
            </div>
            <AdvancedDataTable<AgingSummaryRow>
              headerClassName="bg-sky-100 dark:bg-sky-950/40 border-b border-border"
              data={agingSummary}
              keyExtractor={(row) => row.bucket}
              columns={[
                { key: 'bucket', header: 'Bucket', render: (_v, row) => <StatusBadge status={row.bucket} map={BUCKET_TONE} label={row.label} /> },
                { key: 'count', header: 'Bills', align: 'right', render: (v) => <span className="text-muted-foreground">{fmtCount(v)}</span> },
                { key: 'amount', header: 'Total Amount', align: 'right', render: (v) => <span className="font-medium">{fmtCurrency(v)}</span> },
                { key: 'pctOfTotal', header: '% of Total', align: 'right', render: (v) => <span className="text-muted-foreground">{fmtNum(v, 1)}%</span> },
              ]}
            />
            <div className="flex justify-between items-center px-4 py-2.5 border border-t-0 border-border rounded-b-md bg-muted/20 text-sm font-semibold -mt-px">
              <span>Total</span>
              <span className="flex gap-8">
                <span>{fmtCount(summary.totalCount)}</span>
                <span>{fmtCurrency(summary.totalOutstanding)}</span>
                <span>100.0%</span>
              </span>
            </div>
          </div>

          {/* Detail table — search/bucket filter live here (not the table's own built-in
              search) because they also drive what the page-level CSV export downloads. */}
          <div>
            <div className="mb-2">
              <h3 className="font-medium text-sm">Outstanding Bills</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sorted by days overdue, most overdue first &middot; showing {filteredItems.length} of {items.length} &middot; balance (filtered): {fmtCurrency(filteredItems.reduce((s, i) => s + i.balanceAmount, 0))}
              </p>
            </div>
            <AdvancedDataTable<AgingBillRow>
              headerClassName="bg-sky-100 dark:bg-sky-950/40 border-b border-border"
              data={filteredItems}
              keyExtractor={(item) => item.id}
              emptyMessage="No outstanding bills found."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              toolbarExtra={
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-56">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <input
                      placeholder="Search patient or bill #..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pl-8 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                    />
                  </div>
                  <select
                    className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm"
                    value={bucketFilter}
                    onChange={e => setBucketFilter(e.target.value as 'all' | Bucket)}
                  >
                    <option value="all">All buckets</option>
                    {BUCKET_ORDER.map(b => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
                  </select>
                </div>
              }
              columns={[
                { key: 'billNumber', header: 'Bill Number', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                { key: 'patientName', header: 'Patient', sortable: true },
                { key: 'billDate', header: 'Bill Date', sortable: true, render: (v) => <span className="text-muted-foreground">{fmtDate(v)}</span> },
                { key: 'daysOverdue', header: 'Days Overdue', align: 'right', sortable: true, render: (v) => <span className="font-medium">{fmtCount(v)}</span> },
                { key: 'totalAmount', header: 'Total', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'paidAmount', header: 'Paid', align: 'right', sortable: true, render: (v) => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
                { key: 'balanceAmount', header: 'Balance', align: 'right', sortable: true, render: (v) => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
                { key: 'bucket', header: 'Bucket', sortable: true, render: (_v, item) => <StatusBadge status={item.bucket} map={BUCKET_TONE} label={BUCKET_LABEL[item.bucket]} /> },
              ]}
            />
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
