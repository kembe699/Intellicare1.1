import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';
import { RefreshCw, Loader2 } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { fmtCurrency, fmtCount, fmtDate, getDatePresets } from '@/utils/reportUtils';
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

// A single quiet accent carries the page; everything else stays ink/muted,
// per the minimal brief — no per-metric rainbow.
const ACCENT = '#1A7A75'; // app primary teal
const ACCENT_SOFT = '#99c7c3';

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

function ChartTooltip({ active, payload, label, valueLabel, format }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border rounded-md shadow-md px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-0.5">{formatDayTick(label)}</p>
      <p className="font-medium text-foreground">{format(payload[0]?.value)}{valueLabel ? ` ${valueLabel}` : ''}</p>
    </div>
  );
}

// ── Stat tile — flat, hairline-divided grid (no card shadow/box per tile) ──
function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-card px-4 py-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * Minimal, chart-forward overview — shared verbatim between the Reports
 * Center's Dashboard Overview page and the main app's /dashboard landing
 * page, so both show the exact same numbers and design rather than two
 * independently-drifting dashboards.
 */
export function DashboardOverviewContent() {
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

  return (
    <div className="space-y-8">
      {/* ── Toolbar — two dates and a refresh, nothing else ── */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="h-8 px-2 text-sm rounded-md border border-input bg-transparent"
        />
        <span className="text-muted-foreground text-sm">–</span>
        <input
          type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="h-8 px-2 text-sm rounded-md border border-input bg-transparent"
        />
        <button
          onClick={fetchData}
          disabled={loading}
          className="h-8 w-8 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* ── KPI strip — hairline grid, flat ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-border rounded-lg overflow-hidden border">
            <StatTile label="Revenue" value={fmtCurrency(kpis?.totalRevenue)} sub={`${fmtCount(kpis?.revenueReceiptCount)} receipts`} />
            <StatTile label="Patients" value={fmtCount(kpis?.patientsRegistered)} sub="registered" />
            <StatTile label="Visits" value={fmtCount(kpis?.totalVisits)} sub="in period" />
            <StatTile label="Outstanding" value={fmtCurrency(kpis?.outstandingReceivables)} sub={`${fmtCount(kpis?.outstandingCount)} bills`} />
            <StatTile label="Collected" value={`${collectionPct}%`} sub={`of ${fmtCurrency(kpis?.totalBilled)}`} />
            <StatTile label="Cashiers" value={fmtCount(kpis?.activeCashiers)} sub="active" />
          </div>

          {/* ── Revenue trend — no card chrome, just a labeled chart ── */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-1">Revenue</h3>
            <p className="text-xs text-muted-foreground mb-3">{fmtDate(dateFrom)} – {fmtDate(dateTo)}</p>
            {revenueTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10">No revenue in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revenueTrend} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
                  <XAxis
                    dataKey="day" tickFormatter={formatDayTick}
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false} tickLine={false}
                    interval={revenueTrend.length > 14 ? Math.ceil(revenueTrend.length / 10) : 0}
                  />
                  <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={40} />
                  <RTooltip content={<ChartTooltip format={fmtCurrency} />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
                  <Bar dataKey="revenue" fill={ACCENT} radius={[3, 3, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* ── Patient trend ── */}
            <div className="lg:col-span-2">
              <h3 className="text-sm font-medium text-foreground mb-3">New Patients</h3>
              {patientTrend.length === 0 ? (
                <p className="text-sm text-muted-foreground py-10">No registrations in this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={patientTrend} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap="25%">
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="day" tickFormatter={formatDayTick}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false} tickLine={false}
                      interval={patientTrend.length > 14 ? Math.ceil(patientTrend.length / 10) : 0}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={28} />
                    <RTooltip content={<ChartTooltip format={fmtCount} valueLabel="registered" />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
                    <Bar dataKey="count" fill={ACCENT_SOFT} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* ── Payment method — plain list, no card box ── */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Payment Method</h3>
              {paymentMethods.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6">No payments.</p>
              ) : (
                <div className="space-y-3">
                  {paymentMethods.map(m => {
                    const pct = Math.round((m.total / maxPaymentTotal) * 100);
                    return (
                      <div key={m.method}>
                        <div className="flex items-center justify-between text-[13px] mb-1">
                          <span className="capitalize text-foreground">{m.method}</span>
                          <span className="font-mono tabular-nums text-muted-foreground">{fmtCurrency(m.total)}</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* ── Revenue by clinic ── */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">By Clinic</h3>
              {revenueByClinic.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6">No clinic data.</p>
              ) : (
                <div className="space-y-3">
                  {revenueByClinic.map((c) => {
                    const pct = Math.round((c.revenue / maxClinicRevenue) * 100);
                    return (
                      <div key={c.clinicId}>
                        <div className="flex items-center justify-between text-[13px] mb-1">
                          <span className="text-foreground">{c.clinicName}</span>
                          <span className="font-mono tabular-nums text-muted-foreground">{fmtCurrency(c.revenue)}</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">{fmtCount(c.visits)} visits</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Recent activity ── */}
            <div className="lg:col-span-2">
              <h3 className="text-sm font-medium text-foreground mb-3">Recent Activity</h3>
              <AdvancedDataTable<RecentActivityRow>
                data={recentActivity}
                keyExtractor={(r) => r.id}
                searchable
                searchPlaceholder="Search patient or receipt…"
                emptyMessage="No recent activity."
                compact
                columns={[
                  { key: 'receiptNumber', header: 'Receipt', sortable: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
                  { key: 'patientName', header: 'Patient', sortable: true },
                  { key: 'paymentAmount', header: 'Amount', align: 'right', sortable: true, render: (v) => <span className="font-mono tabular-nums">{fmtCurrency(v)}</span> },
                  { key: 'paymentMethod', header: 'Method', sortable: true, render: (v) => <span className="capitalize text-muted-foreground">{v}</span> },
                  { key: 'cashierName', header: 'Cashier', sortable: true, render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                ]}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DashboardOverviewContent;
