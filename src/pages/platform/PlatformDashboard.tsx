import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  PieChart, Pie, Cell,
} from 'recharts';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Building2, CheckCircle2, Wallet, AlertTriangle, Loader2, Clock } from 'lucide-react';
import { formatDate } from '@/lib/format';

const REVENUE_COLOR = '#1A7A75'; // app primary teal — matches DashboardOverview's revenue bar
const ACTIVE_COLOR = 'hsl(var(--success))';
const SUSPENDED_COLOR = 'hsl(var(--destructive))';

interface DashboardData {
  totalClients: number;
  activeClients: number;
  suspendedClients: number;
  totalRevenue: number;
  revenueThisMonth: number;
  revenueByMonth: { month: string; revenue: number }[];
  outstandingCount: number;
  outstandingAmount: number;
  expiringSoon: { id: number; name: string; code: string; daysUntilExpiry: number; periodEnd: string }[];
}

const fmtCurrency = (n?: number) => `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const formatCompact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${Math.round(n)}`);

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-semibold text-foreground">{fmtCurrency(payload[0]?.value)}</p>
    </div>
  );
}

function expiryTone(days: number): 'destructive' | 'warning' | 'success' {
  if (days < 0) return 'destructive';
  if (days <= 3) return 'destructive';
  if (days <= 7) return 'warning';
  return 'success';
}

const PlatformDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await platformFetch('/dashboard');
        const json = await res.json();
        if (res.ok) setData(json);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading || !data) {
    return (
      <PlatformAppLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </PlatformAppLayout>
    );
  }

  const statusPie = [
    { name: 'Active', value: data.activeClients },
    { name: 'Suspended', value: data.suspendedClients },
  ].filter((d) => d.value > 0);

  return (
    <PlatformAppLayout>
      <PageHeader title="Dashboard" subtitle="Clients, revenue, and upcoming renewals" />

      <div className="space-y-6">
        {/* ── Stat tiles ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Clients</p>
                <p className="text-2xl font-bold mt-1">{data.totalClients}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{data.activeClients} active · {data.suspendedClients} suspended</p>
              </div>
              <Building2 className="h-5 w-5 text-primary" />
            </div>
          </div>

          <div className="bg-card rounded-lg border shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Revenue</p>
                <p className="text-2xl font-bold mt-1 text-primary">{fmtCurrency(data.totalRevenue)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">all-time, paid invoices</p>
              </div>
              <Wallet className="h-5 w-5 text-primary" />
            </div>
          </div>

          <div className="bg-card rounded-lg border shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">This Month</p>
                <p className="text-2xl font-bold mt-1 text-success">{fmtCurrency(data.revenueThisMonth)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">revenue collected</p>
              </div>
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
          </div>

          <div className="bg-card rounded-lg border shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Outstanding</p>
                <p className="text-2xl font-bold mt-1 text-warning">{fmtCurrency(data.outstandingAmount)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{data.outstandingCount} unpaid invoice{data.outstandingCount === 1 ? '' : 's'}</p>
              </div>
              <AlertTriangle className="h-5 w-5 text-primary" />
            </div>
          </div>
        </div>

        {/* ── Charts ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">Revenue by Month</h3>
              <p className="text-xs text-muted-foreground">Paid invoices, last 6 months</p>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.revenueByMonth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={formatCompact}
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <RTooltip content={<RevenueTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
                  <Bar dataKey="revenue" fill={REVENUE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">Client Status</h3>
              <p className="text-xs text-muted-foreground">Active vs suspended</p>
            </div>
            <div className="p-4">
              {statusPie.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-16">No clients yet</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={65} paddingAngle={2}>
                        <Cell fill={ACTIVE_COLOR} />
                        <Cell fill={SUSPENDED_COLOR} />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex items-center justify-center gap-4 text-xs mt-1">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ACTIVE_COLOR }} />
                      Active ({data.activeClients})
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SUSPENDED_COLOR }} />
                      Suspended ({data.suspendedClients})
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Expiring soon ── */}
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">Expiring Soon</h3>
              <p className="text-xs text-muted-foreground">Active clients whose subscription lapses within 14 days</p>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Client</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Renews / Expires</TableHead>
                <TableHead className="text-right">Days Left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.expiringSoon.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  Nothing expiring in the next 14 days
                </TableCell></TableRow>
              ) : data.expiringSoon.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold text-foreground">
                    <Link to={`/platform-admin/clients/${c.id}`} className="hover:text-primary transition-colors">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-sm">{c.code}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(c.periodEnd)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={expiryTone(c.daysUntilExpiry)}>
                      {c.daysUntilExpiry < 0
                        ? `${Math.abs(c.daysUntilExpiry)}d overdue`
                        : c.daysUntilExpiry === 0 ? 'Today' : `${c.daysUntilExpiry}d left`}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </PlatformAppLayout>
  );
};

export default PlatformDashboard;
