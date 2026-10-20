import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Loader2, Plus, Receipt, CalendarClock, Database, ListTree } from 'lucide-react';
import { toast } from '@/lib/notify';
import { formatDate } from '@/lib/format';

const DB_USAGE_COLOR = '#1A7A75'; // app primary teal — same as the dashboard's revenue chart

function expiryTone(days: number): 'destructive' | 'warning' | 'success' {
  if (days <= 3) return 'destructive';
  if (days <= 7) return 'warning';
  return 'success';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function BreakdownTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-semibold text-foreground">{payload[0]?.value?.toLocaleString()} records</p>
    </div>
  );
}

function DbUsageTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">{new Date(label).toLocaleString()}</p>
      <p className="font-semibold text-foreground">{formatBytes(payload[0]?.value)}</p>
    </div>
  );
}

interface Plan {
  id: number;
  name: string;
  amount: string;
  billing_period: string;
  is_active: boolean;
}

interface Invoice {
  id: number;
  plan_name: string;
  billing_period: string;
  amount: string;
  status: 'pending' | 'paid' | 'overdue';
  period_start: string;
  period_end: string;
  paid_at: string | null;
  marked_paid_by_name: string | null;
}

interface ClientDetail {
  id: number;
  name: string;
  code: string;
  status: 'active' | 'suspended';
  admin_email: string;
  invoices: Invoice[];
  periodEnd: string | null;
  daysUntilExpiry: number | null;
  isCovered: boolean;
}

interface DbUsage {
  currentSizeBytes: number;
  currentTableCount: number;
  history: { recordedAt: string; sizeBytes: number }[];
}

interface BreakdownEntry {
  label: string;
  table: string;
  count: number;
}

const PlatformClientDetail: React.FC = () => {
  const { id } = useParams();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dbUsage, setDbUsage] = useState<DbUsage | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownEntry[] | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  // silent skips the full-page spinner (see the `if (loading || !client)` guard below) —
  // suspend/activate, creating an invoice, and marking one paid used to re-run this the
  // same way the initial mount does, blanking the whole page just to reflect one change.
  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [clientRes, plansRes, usageRes, breakdownRes] = await Promise.all([
        platformFetch(`/clients/${id}`),
        platformFetch('/plans'),
        platformFetch(`/clients/${id}/db-usage`),
        platformFetch(`/clients/${id}/data-breakdown`),
      ]);
      const clientData = await clientRes.json();
      const plansData = await plansRes.json();
      if (!clientRes.ok) throw new Error(clientData.error || 'Failed to load client');
      setClient(clientData);
      setPlans(plansData.filter((p: Plan) => p.is_active));
      if (usageRes.ok) setDbUsage(await usageRes.json());
      if (breakdownRes.ok) {
        const { breakdown: rows } = await breakdownRes.json();
        setBreakdown([...rows].sort((a: BreakdownEntry, b: BreakdownEntry) => b.count - a.count));
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const toggleStatus = async () => {
    if (!client) return;
    const nextStatus = client.status === 'active' ? 'suspended' : 'active';
    try {
      const res = await platformFetch(`/clients/${client.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update status');
      toast.success(`Client ${nextStatus === 'suspended' ? 'suspended' : 'activated'}`);
      await load(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const createInvoice = async () => {
    if (!client || !selectedPlanId) return;
    setCreatingInvoice(true);
    try {
      const res = await platformFetch('/billing/invoices', {
        method: 'POST',
        body: JSON.stringify({ client_id: client.id, plan_id: Number(selectedPlanId) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create invoice');
      toast.success('Invoice created');
      await load(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreatingInvoice(false);
    }
  };

  const markPaid = async (invoiceId: number) => {
    try {
      const res = await platformFetch(`/billing/invoices/${invoiceId}/mark-paid`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to mark paid');
      toast.success('Invoice marked paid');
      await load(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading || !client) {
    return (
      <PlatformAppLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </PlatformAppLayout>
    );
  }

  return (
    <PlatformAppLayout>
      <PageHeader
        title={client.name}
        subtitle={`${client.code} · ${client.admin_email}`}
        breadcrumbs={[{ label: 'Clients', href: '/platform-admin/clients' }, { label: client.name }]}
        actions={
          <div className="flex items-center gap-3">
            <Badge variant={client.status === 'active' ? 'success' : 'destructive'} className="capitalize">
              {client.status}
            </Badge>
            <Button variant="outline" size="sm" onClick={toggleStatus}>
              {client.status === 'active' ? 'Suspend' : 'Activate'}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          <div className="bg-card rounded-lg border border-border shadow-sm p-4 flex items-center gap-3">
            <CalendarClock className="w-5 h-5 text-primary shrink-0" />
            {client.daysUntilExpiry === null ? (
              <p className="text-sm text-muted-foreground">No active subscription — bill manually via a plan below whenever you're ready.</p>
            ) : (
              <div className="flex items-center gap-3">
                <Badge variant={expiryTone(client.daysUntilExpiry)}>
                  {client.daysUntilExpiry < 0
                    ? `${Math.abs(client.daysUntilExpiry)}d overdue`
                    : client.daysUntilExpiry === 0 ? 'Expires today' : `${client.daysUntilExpiry}d left`}
                </Badge>
                <p className="text-sm text-foreground">
                  {client.isCovered ? 'Covered through' : 'Coverage lapsed on'}{' '}
                  <span className="font-semibold">{formatDate(client.periodEnd as string)}</span>
                </p>
              </div>
            )}
          </div>

          <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" /> Create Invoice
              </h3>
            </div>
            <div className="p-4 flex items-center gap-3">
              <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select a plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} — ${p.amount} / {p.billing_period}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={createInvoice} disabled={!selectedPlanId || creatingInvoice}>
                {creatingInvoice ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1.5" /> Create Invoice</>}
              </Button>
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Receipt className="w-4 h-4 text-primary" /> Invoices
              </h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead>Plan</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {client.invoices.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No invoices yet</TableCell></TableRow>
                ) : client.invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium text-foreground">
                      {inv.plan_name} <span className="text-muted-foreground font-normal">({inv.billing_period})</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                    </TableCell>
                    <TableCell className="text-primary font-semibold">${Number(inv.amount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'destructive' : 'warning'} className="capitalize">
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {inv.status !== 'paid' && (
                        <Button variant="outline" size="sm" onClick={() => markPaid(inv.id)}>Mark Paid</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-6">
        {/* ── Database usage ── */}
        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" /> Database Usage
            </h3>
            <p className="text-xs text-muted-foreground">Actual storage used in their instance</p>
          </div>
          <div className="p-4">
            {dbUsage ? (
              <>
                <p className="text-2xl font-bold text-primary">{formatBytes(dbUsage.currentSizeBytes)}</p>
                <p className="text-xs text-muted-foreground mb-3">total raw storage, all tables</p>
                {dbUsage.history.length > 1 ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={dbUsage.history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="dbUsageFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={DB_USAGE_COLOR} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={DB_USAGE_COLOR} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
                      <XAxis
                        dataKey="recordedAt"
                        tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={{ stroke: 'hsl(var(--border))' }}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(v) => formatBytes(v)}
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={false}
                        tickLine={false}
                        width={56}
                      />
                      <RTooltip content={<DbUsageTooltip />} />
                      <Area type="monotone" dataKey="sizeBytes" stroke={DB_USAGE_COLOR} strokeWidth={2} fill="url(#dbUsageFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-muted-foreground py-8 text-center">
                    Collecting history — check back after the next snapshot to see growth over time.
                  </p>
                )}
              </>
            ) : (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto my-8" />
            )}
          </div>
        </div>

        {/* ── Data breakdown ── */}
        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ListTree className="w-4 h-4 text-primary" /> Data Breakdown
            </h3>
            <p className="text-xs text-muted-foreground">What they've actually entered, by module</p>
          </div>
          <div className="p-4">
            {!breakdown ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto my-8" />
            ) : breakdown.every((b) => b.count === 0) ? (
              <p className="text-xs text-muted-foreground py-8 text-center">No data entered yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, breakdown.length * 26)}>
                <BarChart
                  data={breakdown}
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                  barCategoryGap="25%"
                >
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="0" />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    width={110}
                  />
                  <RTooltip content={<BreakdownTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
                  <Bar dataKey="count" fill={DB_USAGE_COLOR} radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        </div>
      </div>
    </PlatformAppLayout>
  );
};

export default PlatformClientDetail;
