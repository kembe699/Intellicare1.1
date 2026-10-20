import React, { useState, useEffect, useCallback } from 'react';
import { Wallet, Users2, Trophy, Loader2, Info, Building2 } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { ReportLetterhead } from './ReportLetterhead';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { fmtCurrency, fmtCount, CsvColumn } from '@/utils/reportUtils';
import { toast } from '@/lib/notify';

// ── Types ────────────────────────────────────────────────────────────────

interface ClinicRow {
  clinicId: number;
  name: string;
  visitCount: number;
  revenueCollected: number;
}

interface CategoryRow {
  category: string;
  volume: number;
  totalBilled: number;
  totalCollected: number;
  cashBilled: number;
  cashCollected: number;
  insuranceBilled: number;
  insuranceCollected: number;
}

interface ClinicPerformanceData {
  period: { dateFrom: string; dateTo: string };
  summary: {
    totalRevenueCollected: number;
    totalRevenueBilled: number;
    totalVisits: number;
    topCategory: { category: string; totalCollected: number } | null;
    topClinic: { clinicId: number; name: string; revenueCollected: number } | null;
  };
  byClinic: ClinicRow[];
  byCategory: CategoryRow[];
  collectionMethod: { exactItems: number; estimatedItems: number };
  categorization: { matchedItems: number; unmatchedItems: number; uncategorizedShare: number; note: string };
}

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// A small, stable palette keyed by category so bars/badges stay consistent
// across re-renders regardless of sort order.
const CATEGORY_BAR_COLOR: Record<string, string> = {
  Consultation: 'bg-blue-500',
  Diagnostic: 'bg-violet-500',
  Test: 'bg-warning',
  Other: 'bg-cyan-500',
  Uncategorized: 'bg-muted-foreground/40',
};
const barColorFor = (category: string) => CATEGORY_BAR_COLOR[category] || 'bg-success';

// ── Component ────────────────────────────────────────────────────────────

export default function ClinicPerformanceReport() {
  useAuth(); // kept for parity with other report pages; this report is intentionally cross-clinic (see backend header note)

  const [dateFrom, setDateFrom] = useState(() => toLocalDateStr(new Date(Date.now() - 29 * 86400000)));
  const [dateTo, setDateTo] = useState(() => toLocalDateStr(new Date()));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ClinicPerformanceData | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      const res = await authFetch(`/api/reports-v2/clinic-performance?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load clinic performance report');
      setData(await res.json());
      setGeneratedAt(new Date());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load clinic performance report');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const byClinic = data?.byClinic || [];
  const byCategory = data?.byCategory || [];
  const collection = data?.collectionMethod;
  const categorization = data?.categorization;
  const maxCategoryRevenue = byCategory.reduce((m, c) => Math.max(m, c.totalCollected), 0) || 1;

  const csvColumnsCategory: CsvColumn[] = [
    { header: 'Category', key: 'category' },
    { header: 'Volume', key: 'volume', transform: v => fmtCount(v) },
    { header: 'Total Billed', key: 'totalBilled', transform: v => fmtCurrency(v) },
    { header: 'Total Collected', key: 'totalCollected', transform: v => fmtCurrency(v) },
    { header: 'Cash Billed', key: 'cashBilled', transform: v => fmtCurrency(v) },
    { header: 'Insurance/Credit Billed', key: 'insuranceBilled', transform: v => fmtCurrency(v) },
  ];

  return (
    <ReportSubPageShell
      title="Clinic / Department Performance"
      description="Visit volume and revenue by clinic, and by service department/category"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={byCategory}
      csvColumns={csvColumnsCategory}
      csvFilename={`clinic-performance-report-${dateFrom}-${dateTo}.csv`}
    >
      <ReportLetterhead title="Clinic / Department Performance" dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} />
      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Summary tiles ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Revenue (Collected)</p>
                  <p className="text-2xl font-bold mt-1 text-success">{fmtCurrency(data?.summary.totalRevenueCollected)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">of {fmtCurrency(data?.summary.totalRevenueBilled)} billed</p>
                </div>
                <Wallet className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Visits</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(data?.summary.totalVisits)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">across all clinics, this period</p>
                </div>
                <Users2 className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Top Category</p>
                  <p className="text-lg font-bold mt-1 truncate" title={data?.summary.topCategory?.category || '—'}>
                    {data?.summary.topCategory?.category || '—'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data?.summary.topCategory ? fmtCurrency(data.summary.topCategory.totalCollected) + ' collected' : 'no data in period'}
                  </p>
                </div>
                <Trophy className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Top Clinic</p>
                  <p className="text-lg font-bold mt-1 truncate" title={data?.summary.topClinic?.name || '—'}>
                    {data?.summary.topClinic?.name || '—'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data?.summary.topClinic ? fmtCurrency(data.summary.topClinic.revenueCollected) + ' collected' : 'no data in period'}
                  </p>
                </div>
                <Building2 className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>

          {/* ── Disclosure banners ── */}
          <div className="space-y-2">
            {categorization && categorization.unmatchedItems > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  {fmtCount(categorization.unmatchedItems)} of {fmtCount(categorization.matchedItems + categorization.unmatchedItems)} billed line items
                  ({(categorization.uncategorizedShare * 100).toFixed(0)}% of billed value) could not be matched to a service category and are
                  grouped under "Uncategorized" below. {categorization.note}
                </span>
              </div>
            )}
          </div>

          {/* ── By Clinic (lightweight, 2 rows) ── */}
          <div>
            <div className="mb-2">
              <h3 className="font-semibold text-sm">By Clinic</h3>
              <p className="text-xs text-muted-foreground">Visit volume and revenue collected per clinic for the selected period</p>
            </div>
            <AdvancedDataTable<ClinicRow>
              headerClassName="bg-info-bg dark:bg-info/40 border-b border-border"
              data={byClinic}
              keyExtractor={(c) => c.clinicId}
              emptyMessage="No clinics found."
              columns={[
                { key: 'name', header: 'Clinic', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
                { key: 'visitCount', header: 'Visits', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCount(v)}</span> },
                { key: 'revenueCollected', header: 'Revenue Collected', align: 'right', sortable: true, render: (v) => <span className="font-mono text-success">{fmtCurrency(v)}</span> },
              ]}
            />
          </div>

          {/* ── By Department / Category (main content) ── */}
          <div>
            <div className="mb-2">
              <h3 className="font-semibold text-sm">By Department / Service Category</h3>
              <p className="text-xs text-muted-foreground">Volume and revenue per service category — which service lines are generating money</p>
            </div>
            <AdvancedDataTable<CategoryRow>
              headerClassName="bg-info-bg dark:bg-info/40 border-b border-border"
              data={byCategory}
              keyExtractor={(c) => c.category}
              emptyMessage="No billed services found for the selected period."
              columns={[
                {
                  key: 'category', header: 'Category', sortable: true,
                  render: (v, c) => (
                    <>
                      {v}
                      {c.category === 'Uncategorized' && (
                        <span className="ml-1.5 text-xs text-warning" title="Billed line items with no exact name match in the services catalog">not matched to catalog</span>
                      )}
                    </>
                  ),
                },
                {
                  key: '__bar', header: 'Revenue Collected', width: '30%',
                  render: (_v, c) => (
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColorFor(c.category)}`}
                        style={{ width: `${Math.max(2, (c.totalCollected / maxCategoryRevenue) * 100)}%` }}
                      />
                    </div>
                  ),
                },
                { key: 'volume', header: 'Volume', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCount(v)}</span> },
                { key: 'totalBilled', header: 'Billed', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'totalCollected', header: 'Collected', align: 'right', sortable: true, render: (v) => <span className="font-mono text-success">{fmtCurrency(v)}</span> },
                { key: 'cashBilled', header: 'Cash Billed', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'insuranceBilled', header: 'Insurance/Credit Billed', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
              ]}
            />
            {byCategory.length > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5 border border-t-0 border-border rounded-b-md bg-muted/20 text-sm font-semibold -mt-px">
                <span>Total</span>
                <span className="flex gap-8 font-mono">
                  <span>{fmtCount(byCategory.reduce((s, c) => s + c.volume, 0))}</span>
                  <span>{fmtCurrency(byCategory.reduce((s, c) => s + c.totalBilled, 0))}</span>
                  <span className="text-success">{fmtCurrency(byCategory.reduce((s, c) => s + c.totalCollected, 0))}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
