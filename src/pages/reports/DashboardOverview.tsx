import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';
import {
  Wallet, UserPlus, Activity, AlertTriangle, PercentCircle, UserCheck, Loader2,
} from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { fmtCurrency, fmtCount, fmtDate, CsvColumn, getDatePresets } from '@/utils/reportUtils';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────────

interface Kpis {
  totalRevenue: number;
  revenueReceiptCount: number;
  patientsRegistered: number;
  patientsFromRegistry: number;
  patientsFromLis: number;
  totalVisits: number;
  outstandingReceivables: number;
  outstandingCount: number;
  collectionRate: number;
  totalBilled: number;
  totalPaid: number;
  totalPending: number;
  activeCashiers: number;
}

interface TrendPoint { day: string; revenue?: number; count?: number; }
interface PaymentMethodRow { method: string; count: number; total: number; }
interface ClinicRevenueRow { clinicId: number; clinicName: string; revenue: number; receiptCount: number; visits: number; }
interface RecentActivityRow {
  id: string;
  receiptNumber: string;
  patientName: string;
  paymentAmount: string | number;
  paymentMethod: string;
  paymentDate: string;
  cashierName: string | null;
}

interface OverviewData {
  period: { dateFrom: string; dateTo: string };
  clinicId: number;
  kpis: Kpis;
  revenueTrend: TrendPoint[];
  patientTrend: TrendPoint[];
  paymentMethodBreakdown: PaymentMethodRow[];
  revenueByClinic: ClinicRevenueRow[];
  recentActivity: RecentActivityRow[];
}

// ── Fixed color assignment — identity follows the entity, never its rank ──
// (see the dataviz categorical palette; validated for both light & dark
// card surfaces — node scripts/validate_palette.js "#0d9488,#d97706,
// #0891b2,#7c3aed,#e11d48" --mode light/dark)
const METHOD_COLORS: Record<string, string> = {
  cash: '#0d9488',
  card: '#d97706',
  check: '#0891b2',
  lease: '#7c3aed',
  insurance: '#e11d48',
};
const METHOD_FALLBACK_COLOR = '#64748b';

const CLINIC_COLORS: Record<number, string> = {
  1: '#0d9488',
  6: '#d97706',
};
const CLINIC_FALLBACK_COLORS = ['#0891b2', '#7c3aed', '#e11d48'];

const REVENUE_COLOR = '#1A7A75'; // app primary teal — hsl(var(--primary))
const PATIENT_COLOR = '#0d9488'; // slot-1 categorical teal (distinguished from primary)

// ── Helpers ──────────────────────────────────────────────────────────────

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatDayTick = (day: string) => {
  const d = new Date(`${day}T00:00:00`);
  return isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatCompact = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
};

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">{formatDayTick(label)}</p>
      <p className="font-semibold text-foreground">{fmtCurrency(payload[0]?.value)}</p>
    </div>
  );
}

function PatientTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">{formatDayTick(label)}</p>
      <p className="font-semibold text-foreground">{fmtCount(payload[0]?.value)} registered</p>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

export default function DashboardOverview() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;

  const presets = useMemo(() => getDatePresets(), []);
  const last30 = presets.find(p => p.label === 'Last 30 Days');

  const [dateFrom, setDateFrom] = useState(() => last30?.from || toLocalDateStr(new Date(Date.now() - 29 * 86400000)));
  const [dateTo, setDateTo] = useState(() => last30?.to || toLocalDateStr(new Date()));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: String(clinicId) });
      const res = await authFetch(`/api/reports-v2/overview?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load dashboard overview');
      setData(await res.json());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load dashboard overview');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, clinicId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const kpis = data?.kpis;
  const revenueTrend = data?.revenueTrend || [];
  const patientTrend = data?.patientTrend || [];
  const paymentMethods = data?.paymentMethodBreakdown || [];
  const revenueByClinic = data?.revenueByClinic || [];
  const recentActivity = data?.recentActivity || [];

  const maxPaymentTotal = Math.max(1, ...paymentMethods.map(m => m.total));
  const maxClinicRevenue = Math.max(1, ...revenueByClinic.map(c => c.revenue));

  const collectionPct = kpis ? Math.round(kpis.collectionRate * 100) : 0;

  const csvColumns: CsvColumn[] = [
    { header: 'Receipt #', key: 'receiptNumber' },
    { header: 'Patient', key: 'patientName' },
    { header: 'Amount', key: 'paymentAmount', transform: v => fmtCurrency(v) },
    { header: 'Method', key: 'paymentMethod' },
    { header: 'Cashier', key: 'cashierName', transform: v => v || '—' },
    { header: 'Date', key: 'paymentDate', transform: v => fmtDate(v) },
  ];

  return (
    <ReportSubPageShell
      title="Dashboard Overview"
      description="Bird's-eye view of hospital operations — revenue, patients, visits and receivables"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={recentActivity}
      csvColumns={csvColumns}
      csvFilename={`dashboard-overview-${dateFrom}-${dateTo}.csv`}
    >
      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── KPI tiles ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Total Revenue</p>
                  <p className="text-2xl font-bold mt-1 text-primary">{fmtCurrency(kpis?.totalRevenue)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fmtCount(kpis?.revenueReceiptCount)} receipts in period</p>
                </div>
                <Wallet className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Patients Registered</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(kpis?.patientsRegistered)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtCount(kpis?.patientsFromRegistry)} registry + {fmtCount(kpis?.patientsFromLis)} LIS
                  </p>
                </div>
                <UserPlus className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Total Visits</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(kpis?.totalVisits)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">in selected period</p>
                </div>
                <Activity className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Outstanding Receivables</p>
                  <p className="text-2xl font-bold mt-1 text-amber-700">{fmtCurrency(kpis?.outstandingReceivables)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fmtCount(kpis?.outstandingCount)} bills owed &middot; current</p>
                </div>
                <AlertTriangle className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div className="w-full">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Collected vs Pending</p>
                  <p className="text-2xl font-bold mt-1 text-emerald-700">{collectionPct}%</p>
                  <div className="h-1.5 w-full rounded-full bg-muted mt-1.5 overflow-hidden">
                    <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${Math.min(100, collectionPct)}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{fmtCurrency(kpis?.totalPaid)} of {fmtCurrency(kpis?.totalBilled)} billed</p>
                </div>
                <PercentCircle className="h-5 w-5 text-primary shrink-0" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Active Cashiers</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(kpis?.activeCashiers)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">took payments in period</p>
                </div>
                <UserCheck className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>

          {/* ── Revenue trend ── */}
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">Revenue Trend</h3>
              <p className="text-xs text-muted-foreground">Daily revenue collected, {fmtDate(dateFrom)} — {fmtDate(dateTo)}</p>
            </div>
            <div className="p-4">
              {revenueTrend.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No revenue data for the selected period.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={revenueTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
                    <XAxis
                      dataKey="day"
                      tickFormatter={formatDayTick}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      tickLine={false}
                      interval={revenueTrend.length > 14 ? Math.ceil(revenueTrend.length / 10) : 0}
                    />
                    <YAxis
                      tickFormatter={formatCompact}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                    />
                    <RTooltip content={<RevenueTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
                    <Bar dataKey="revenue" fill={REVENUE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ── Patient registration trend ── */}
            <div className="lg:col-span-2 bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-muted/30">
                <h3 className="font-semibold text-sm">Patient Registration Trend</h3>
                <p className="text-xs text-muted-foreground">New registrations per day &middot; registry + LIS combined</p>
              </div>
              <div className="p-4">
                {patientTrend.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">No registrations for the selected period.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={patientTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="day"
                        tickFormatter={formatDayTick}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={{ stroke: 'hsl(var(--border))' }}
                        tickLine={false}
                        interval={patientTrend.length > 14 ? Math.ceil(patientTrend.length / 10) : 0}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={false}
                        tickLine={false}
                        width={30}
                      />
                      <RTooltip content={<PatientTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
                      <Bar dataKey="count" fill={PATIENT_COLOR} radius={[4, 4, 0, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* ── Payment method breakdown ── */}
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-muted/30">
                <h3 className="font-semibold text-sm">Payment Method</h3>
                <p className="text-xs text-muted-foreground">Revenue split for the period</p>
              </div>
              <div className="p-4 space-y-3">
                {paymentMethods.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No payments in this period.</p>
                ) : paymentMethods.map(m => {
                  const color = METHOD_COLORS[m.method] || METHOD_FALLBACK_COLOR;
                  const pct = Math.round((m.total / maxPaymentTotal) * 100);
                  return (
                    <div key={m.method}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="flex items-center gap-1.5 text-[13px] capitalize">
                          <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          {m.method}
                        </span>
                        <span className="text-[13px] font-mono font-medium">{fmtCurrency(m.total)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ── Revenue by clinic ── */}
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-muted/30">
                <h3 className="font-semibold text-sm">Revenue by Clinic</h3>
                <p className="text-xs text-muted-foreground">Revenue &amp; visits per clinic, this period</p>
              </div>
              <div className="p-4 space-y-3">
                {revenueByClinic.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No clinic data available.</p>
                ) : revenueByClinic.map((c, i) => {
                  const color = CLINIC_COLORS[c.clinicId] || CLINIC_FALLBACK_COLORS[i % CLINIC_FALLBACK_COLORS.length];
                  const pct = Math.round((c.revenue / maxClinicRevenue) * 100);
                  return (
                    <div key={c.clinicId}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="flex items-center gap-1.5 text-[13px]">
                          <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          {c.clinicName}
                        </span>
                        <span className="text-[13px] font-mono font-medium">{fmtCurrency(c.revenue)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">{fmtCount(c.visits)} visits &middot; {fmtCount(c.receiptCount)} receipts</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Recent activity ── */}
            <div className="lg:col-span-2">
              <div className="mb-2">
                <h3 className="font-semibold text-sm">Recent Activity</h3>
                <p className="text-xs text-muted-foreground">Last {recentActivity.length} payments received</p>
              </div>
              <AdvancedDataTable<RecentActivityRow>
                data={recentActivity}
                keyExtractor={(r) => r.id}
                searchable
                searchPlaceholder="Search patient or receipt..."
                emptyMessage="No recent activity."
                columns={[
                  { key: 'receiptNumber', header: 'Receipt', sortable: true, render: (v) => <span className="font-mono">{v}</span> },
                  { key: 'patientName', header: 'Patient', sortable: true },
                  { key: 'paymentAmount', header: 'Amount', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                  {
                    key: 'paymentMethod', header: 'Method', sortable: true,
                    render: (v) => (
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border capitalize"
                        style={{
                          backgroundColor: `${METHOD_COLORS[v] || METHOD_FALLBACK_COLOR}1a`,
                          borderColor: `${METHOD_COLORS[v] || METHOD_FALLBACK_COLOR}33`,
                          color: METHOD_COLORS[v] || METHOD_FALLBACK_COLOR,
                        }}
                      >
                        {v}
                      </span>
                    ),
                  },
                  { key: 'cashierName', header: 'Cashier', sortable: true, render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                ]}
              />
            </div>
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
