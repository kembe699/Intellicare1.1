import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { dashboardApi, authFetch } from '@/api/apiClient';
import {
  Stethoscope, FlaskConical, Pill,
  UserPlus, ArrowUpRight, Receipt as ReceiptIcon, FileBarChart, Wallet, X, Package,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardOverviewContent } from '@/pages/reports/DashboardOverviewContent';
import { HeroStatCard, FilterBar, FilterPill, PageHeader, LoadingState } from '@/components/common';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { toast } from 'sonner';

interface DashboardStats {
  totalPatients: number;
  todayPatients: number;
  todayVisits: number;
  pendingLabTests: number;
  completedLabTests: number;
  lowStockItems: number;
  queuePatients: number;
  totalOutstanding: number;
}

const PAID_COLOR = 'hsl(var(--success))';
const OUTSTANDING_COLOR = 'hsl(var(--destructive))';

// The movement chart counts items, not money, so it needs its own tooltip
// rather than the currency-formatting billing one.
function LabStatusTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-popover-foreground">{item.name}</p>
      <p className="text-muted-foreground">{item.value} request{item.value === 1 ? '' : 's'}</p>
    </div>
  );
}

function StockMovementTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-popover-foreground">{item.name}</p>
      <p className="text-muted-foreground">{item.value} item{item.value === 1 ? '' : 's'}</p>
    </div>
  );
}

function BillingStatusTooltip({ active, payload, fmt, maskPaid }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  // The Paid slice is the collections figure; masking it on the card while
  // leaving it readable on hover would hand it straight back.
  const masked = maskPaid && item.name === 'Paid';
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-popover-foreground">{item.name}</p>
      <p className="text-muted-foreground">{masked ? '••••••••' : fmt(item.value)}</p>
    </div>
  );
}

interface ReceiptStats {
  totalReceipts: number;
  totalAmount: number;
}

interface RecentReceipt {
  id: string;
  receipt_number: string;
  patient_name: string;
  payment_amount: number;
  payment_method: string;
  payment_date: string;
  status: string;
}

const PERIODS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
] as const;

type Period = (typeof PERIODS)[number]['value'];

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const facilityInfo = useFacilityInfo();
  const { fmt } = useCurrency();
  const [stats, setStats] = useState<DashboardStats>({
    totalPatients: 0, todayPatients: 0, todayVisits: 0,
    pendingLabTests: 0, completedLabTests: 0, lowStockItems: 0, queuePatients: 0,
    totalOutstanding: 0,
  });
  const [receiptStats, setReceiptStats] = useState<ReceiptStats>({ totalReceipts: 0, totalAmount: 0 });

  // Collections figures are masked for everyone by default and only an admin or
  // an accountant can reveal them. Note this is a presentation control: the
  // totals are already in the API response by the time this renders, so it keeps
  // takings off a shared screen rather than making them unobtainable.
  // A pharmacy user's dashboard answers a different question from a cashier's:
  // what is moving off the shelf, not what was taken at the till. Both panels
  // below swap out for them rather than showing billing they cannot act on.
  const isPharmacyView = user?.role === 'pharmacy';
  // A lab shift is measured by the queue, not by takings, so the same three
  // panels swap out for that role too.
  const isLabView = user?.role === 'lab';
  const [stockMovement, setStockMovement] = useState<any | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [labData, setLabData] = useState<any | null>(null);
  const [labLoading, setLabLoading] = useState(false);

  useEffect(() => {
    if (!isLabView) return;
    let cancelled = false;
    setLabLoading(true);
    authFetch('/api/lis/lab-dashboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setLabData(d); })
      .catch(() => { if (!cancelled) setLabData(null); })
      .finally(() => { if (!cancelled) setLabLoading(false); });
    return () => { cancelled = true; };
  }, [isLabView]);

  useEffect(() => {
    if (!isPharmacyView) return;
    let cancelled = false;
    setStockLoading(true);
    authFetch('/api/pharmacy-module/stock-movement?days=30')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setStockMovement(d); })
      .catch(() => { if (!cancelled) setStockMovement(null); })
      .finally(() => { if (!cancelled) setStockLoading(false); });
    return () => { cancelled = true; };
  }, [isPharmacyView]);

  const CAN_VIEW_COLLECTIONS = ['admin', 'accountant'];
  const canViewCollections = !!user?.role && CAN_VIEW_COLLECTIONS.includes(user.role);
  const [collectionsRevealed, setCollectionsRevealed] = useState(false);
  const maskMoney = (formatted: string) => (collectionsRevealed ? formatted : '••••••••');
  const [recentReceipts, setRecentReceipts] = useState<RecentReceipt[]>([]);
  const [period, setPeriod] = useState<Period>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [paymentsFrom, setPaymentsFrom] = useState('');
  const [paymentsTo, setPaymentsTo] = useState('');

  const isCustomRange = Boolean(customFrom && customTo);
  const isPaymentsRangeFiltered = Boolean(paymentsFrom && paymentsTo);

  const clinicId = user?.clinic || '1';

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setLoading(true);
        const data = await dashboardApi.get(`/stats/${clinicId}`);
        setStats(data);
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, clinicId]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        // A custom From/To range isn't a period the /stats endpoint understands —
        // reuse the same /search endpoint the "Recent Payments" list already calls
        // (it already supports startDate/endDate) and total the results here instead.
        if (isCustomRange) {
          const res = await authFetch(`/api/receipts/clinic/${clinicId}/search?startDate=${customFrom}&endDate=${customTo}`);
          if (res.ok) {
            const data = await res.json();
            const rows: RecentReceipt[] = Array.isArray(data) ? data : [];
            setReceiptStats({
              totalReceipts: rows.length,
              totalAmount: rows.reduce((sum, r) => sum + (parseFloat(String(r.payment_amount)) || 0), 0),
            });
          }
        } else {
          const res = await authFetch(`/api/receipts/clinic/${clinicId}/stats?period=${period}`);
          if (res.ok) setReceiptStats(await res.json());
        }
      } catch (error) { /* hero stat best-effort */ }
    })();
  }, [user, clinicId, period, isCustomRange, customFrom, customTo]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setReceiptsLoading(true);
        const url = isPaymentsRangeFiltered
          ? `/api/receipts/clinic/${clinicId}/search?startDate=${paymentsFrom}&endDate=${paymentsTo}`
          : `/api/receipts/clinic/${clinicId}/search`;
        const res = await authFetch(url);
        if (res.ok) {
          const data = await res.json();
          const rows: RecentReceipt[] = Array.isArray(data) ? data : [];
          // With no range set this is a "recent activity" glance, capped at 8. Once a
          // range is picked the user is actively looking for something specific, so show
          // every match instead — the table's own pagination takes it from there.
          setRecentReceipts(isPaymentsRangeFiltered ? rows : rows.slice(0, 8));
        }
      } catch (error) {
        console.error('Error fetching recent receipts:', error);
      } finally {
        setReceiptsLoading(false);
      }
    })();
  }, [user, clinicId, isPaymentsRangeFiltered, paymentsFrom, paymentsTo]);

  const quickActions = [
    { label: 'Register Patient', subtitle: 'New patient intake', icon: UserPlus, href: '/lis/registration', roles: ['admin', 'reception'] },
    { label: 'Clinical Visit', subtitle: 'Orders & consultations', icon: Stethoscope, href: '/lis/orders', roles: ['admin', 'doctor'] },
    { label: 'Lab Queue', subtitle: 'Specimens & results', icon: FlaskConical, href: '/lis/queue', roles: ['admin', 'lab'] },
    { label: 'Dispense Drugs', subtitle: 'Pharmacy workflow', icon: Pill, href: '/pharmacy-dispensing', roles: ['admin', 'pharmacy'] },
  ];
  const filteredActions = quickActions.filter((action) => user?.role && action.roles.includes(user.role));

  const greetingDate = useMemo(
    () => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()),
    [],
  );
  const firstName = user?.displayName?.split(' ')[0] ?? '';

  if (loading) {
    return (
      <AppLayout>
        <LoadingState message="Loading dashboard..." />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">{greetingDate}</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">
            Welcome back{firstName ? `, ${firstName}` : ''}
            {facilityInfo.facilityName && (
              <> — <span className="text-primary">{facilityInfo.facilityName}</span></>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Here's what's happening across the clinic right now.</p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
            <FilterBar>
              {PERIODS.map((p) => (
                <FilterPill
                  key={p.value}
                  label={p.label}
                  active={!isCustomRange && period === p.value}
                  onClick={() => { setPeriod(p.value); setCustomFrom(''); setCustomTo(''); }}
                />
              ))}
              <div className="flex items-center gap-2 pl-2">
                <Label htmlFor="dashFrom" className="text-xs text-muted-foreground">From</Label>
                <Input id="dashFrom" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-auto" />
                <Label htmlFor="dashTo" className="text-xs text-muted-foreground">To</Label>
                <Input id="dashTo" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-auto" />
                {isCustomRange && (
                  <button
                    type="button"
                    onClick={() => { setCustomFrom(''); setCustomTo(''); }}
                    className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Clear custom date range"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </FilterBar>
            <HeroStatCard
              canReveal={canViewCollections}
              revealed={collectionsRevealed}
              onRevealedChange={setCollectionsRevealed}
              onDeniedReveal={() =>
                toast.error('Access denied', {
                  description: 'Only administrators and accountants can view collection figures.',
                })
              }
              label={isCustomRange ? `Collections — ${customFrom} to ${customTo}` : `Collections — ${PERIODS.find((p) => p.value === period)?.label}`}
              value={fmt(receiptStats.totalAmount)}
              stats={[
                { label: 'Receipts recorded', value: String(receiptStats.totalReceipts) },
                {
                  label: 'Avg. per receipt',
                  value: receiptStats.totalReceipts > 0 ? fmt(receiptStats.totalAmount / receiptStats.totalReceipts) : fmt(0),
                },
              ]}
              actions={
                <>
                  <Link to="/accounting/reports" className="inline-flex items-center gap-1.5 rounded-lg border border-white/40 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10">
                    <FileBarChart className="h-4 w-4" /> View Reports
                  </Link>
                  <Link to="/billing-management" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-white/90">
                    <Wallet className="h-4 w-4" /> Billing
                  </Link>
                </>
              }
            />

            {filteredActions.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Quick Actions</h2>
                <div className="grid grid-cols-4 gap-4">
                  {filteredActions.map((action) => (
                    <Link
                      key={action.label}
                      to={action.href}
                      className="group relative flex flex-col items-center text-center rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
                    >
                      <ArrowUpRight className="absolute right-5 top-5 h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                      <action.icon className="mb-4 h-11 w-11 text-primary transition-transform group-hover:scale-110" strokeWidth={1.75} />
                      <p className="text-base font-semibold text-foreground">{action.label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{action.subtitle}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {isLabView ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Lab Workload</CardTitle>
              </CardHeader>
              <CardContent>
                {labLoading ? (
                  <LoadingState message="Loading lab workload..." />
                ) : !labData ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No lab data yet</p>
                ) : (
                  <>
                    {/* Patient totals and stock alerts belong to other roles.
                        These are the four numbers a lab shift is judged on,
                        each one a queue somebody has to clear. */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Awaiting collection</p>
                        <p className={`mt-0.5 text-lg font-semibold ${labData.totals.awaitingCollection > 0 ? 'text-destructive' : 'text-foreground'}`}>
                          {labData.totals.awaitingCollection}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">In progress</p>
                        <p className="mt-0.5 text-lg font-semibold text-foreground">{labData.totals.inProgress}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Awaiting approval</p>
                        <p className={`mt-0.5 text-lg font-semibold ${labData.totals.awaitingApproval > 0 ? 'text-amber-600' : 'text-foreground'}`}>
                          {labData.totals.awaitingApproval}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Completed today</p>
                        <p className="mt-0.5 text-lg font-semibold text-foreground">{labData.totals.completedToday}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Requested today</p>
                        <p className="mt-0.5 text-lg font-semibold text-foreground">{labData.totals.requestedToday}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Completed (all time)</p>
                        <p className="mt-0.5 text-lg font-semibold text-foreground">{labData.totals.completed}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 border-t border-border pt-3 mt-4 text-xs text-muted-foreground">
                      <span className={`h-1.5 w-1.5 rounded-full ${labData.totals.outstanding > 0 ? 'bg-amber-500' : 'bg-success'}`} />
                      {labData.totals.outstanding > 0
                        ? `${labData.totals.outstanding} request${labData.totals.outstanding === 1 ? '' : 's'} still open`
                        : 'Queue clear'}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : isPharmacyView ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Dispensing Report (last 30 days)</CardTitle>
              </CardHeader>
              <CardContent>
                {stockLoading ? (
                  <LoadingState message="Loading dispensing report..." />
                ) : !stockMovement ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No dispensing data yet</p>
                ) : (
                  <>
                    {/* Patient counts and lab queues are a clinician's summary.
                        A pharmacist needs what left the shelf, what it was worth,
                        and what needs reordering. */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Units dispensed</p>
                        <p className="mt-0.5 text-lg font-semibold text-foreground">
                          {stockMovement.totals.unitsDispensed.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Dispensing value</p>
                        <p className="mt-0.5 text-lg font-semibold text-foreground">
                          {fmt(stockMovement.totals.dispensingValue)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Items dispensed</p>
                        <p className="mt-0.5 text-lg font-semibold text-foreground">
                          {stockMovement.totals.movedItems} of {stockMovement.totals.items}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Not moving</p>
                        <p className={`mt-0.5 text-lg font-semibold ${stockMovement.totals.neverMoved > 0 ? 'text-amber-600' : 'text-foreground'}`}>
                          {stockMovement.totals.neverMoved}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Prescriptions pending</p>
                        <p className="mt-0.5 text-lg font-semibold text-foreground">{stats.pendingLabTests ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Low Stock Alerts</p>
                        <p className={`mt-0.5 text-lg font-semibold ${stats.lowStockItems > 0 ? 'text-destructive' : 'text-foreground'}`}>
                          {stats.lowStockItems}
                        </p>
                      </div>
                    </div>
                    {stockMovement.movement.slow.length > 0 && (
                      <div className="mt-4 border-t border-border pt-3">
                        <p className="text-xs text-muted-foreground">Longest without movement</p>
                        <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                          {stockMovement.movement.slow[0].itemName}
                          <span className="ml-1 font-normal text-muted-foreground">
                            ({stockMovement.movement.slow[0].quantityOnHand} on hand)
                          </span>
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Today at a Glance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total Patients (all-time)</p>
                  <p className="mt-0.5 text-lg font-semibold text-foreground">{stats.totalPatients}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Today's Registrations</p>
                  <p className="mt-0.5 text-lg font-semibold text-foreground">{stats.todayPatients}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Today's Visits</p>
                  <p className="mt-0.5 text-lg font-semibold text-foreground">{stats.todayVisits}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Patients in Queue</p>
                  <p className="mt-0.5 text-lg font-semibold text-foreground">{stats.queuePatients}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pending Lab Tests</p>
                  <p className="mt-0.5 text-lg font-semibold text-foreground">{stats.pendingLabTests}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Completed Today</p>
                  <p className="mt-0.5 text-lg font-semibold text-foreground">{stats.completedLabTests}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Low Stock Alerts</p>
                  <p className={`mt-0.5 text-lg font-semibold ${stats.lowStockItems > 0 ? 'text-destructive' : 'text-foreground'}`}>{stats.lowStockItems}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-border pt-3 mt-4 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                All systems operational
              </div>
            </CardContent>
          </Card>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 bg-card border rounded-lg shadow-sm p-4">
            {isLabView ? (
              <>
                <PageHeader title="Lab Queue" icon={<FlaskConical />} className="mb-3" />
                <AdvancedDataTable<any>
                  data={labData?.queue || []}
                  loading={labLoading}
                  loadingMessage="Loading lab queue..."
                  emptyMessage="Nothing in the lab queue — requests appear here as they are ordered."
                  keyExtractor={(row) => row.id}
                  searchable
                  searchPlaceholder="Search by patient, test or barcode..."
                  exportable
                  exportFileName="lab-queue"
                  pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
                  columns={[
                    { key: 'patientName', header: 'Patient', sortable: true,
                      render: (v, row) => (
                        <div className="min-w-0">
                          <p className="truncate font-medium">{v}</p>
                          {row.patientNumber && <p className="font-mono text-xs text-muted-foreground">{row.patientNumber}</p>}
                        </div>
                      ) },
                    { key: 'testName', header: 'Test', sortable: true },
                    { key: 'department', header: 'Department', sortable: true },
                    { key: 'barcode', header: 'Barcode', render: (v) => <span className="font-mono text-xs">{v || '—'}</span> },
                    { key: 'status', header: 'Status', sortable: true,
                      // The stage a sample has reached is the whole point of this
                      // list, so it is coloured rather than left as raw text.
                      render: (v) => {
                        const label = String(v || '').replace(/_/g, ' ');
                        const tone = v === 'approved' ? 'bg-emerald-100 text-emerald-800'
                          : v === 'analyzed' ? 'bg-amber-100 text-amber-800'
                          : v === 'pending_collection' ? 'bg-rose-100 text-rose-800'
                          : 'bg-sky-100 text-sky-800';
                        return <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${tone}`}>{label}</span>;
                      } },
                    { key: 'requestedAt', header: 'Requested', sortable: true, render: (v) => (v ? new Date(v).toLocaleString() : '—') },
                  ]}
                />
              </>
            ) : isPharmacyView ? (
              <>
                <PageHeader title="Recent Stock Movement" icon={<Package />} className="mb-3" />
                <AdvancedDataTable<any>
                  data={stockMovement?.recentMovements || []}
                  loading={stockLoading}
                  loadingMessage="Loading stock movement..."
                  emptyMessage="No stock movement recorded yet — receipts, dispensing and adjustments will show up here."
                  keyExtractor={(row) => row.id}
                  searchable
                  searchPlaceholder="Search by item or reference..."
                  exportable
                  exportFileName="recent-stock-movement"
                  pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
                  columns={[
                    { key: 'reference', header: 'Reference', sortable: true, render: (v) => <span className="font-mono text-xs">{v || '—'}</span> },
                    { key: 'itemName', header: 'Item', sortable: true },
                    { key: 'type', header: 'Type', sortable: true, render: (v) => <span className="capitalize">{String(v || '').replace(/_/g, ' ')}</span> },
                    {
                      key: 'quantityChange', header: 'Qty', align: 'right', sortable: true,
                      // Direction is the point of a movement row, so it is shown
                      // rather than left for the reader to infer from a sign.
                      render: (v, row) => (
                        <span className={Number(v) < 0 ? 'text-destructive' : 'text-foreground'}>
                          {Number(v) > 0 ? '+' : ''}{v} {row.unit}
                        </span>
                      ),
                    },
                    { key: 'at', header: 'When', sortable: true, render: (v) => (v ? new Date(v).toLocaleString() : '—') },
                  ]}
                />
              </>
            ) : (
            <>
            <PageHeader title="Recent Payments" icon={<ReceiptIcon />} className="mb-3" />
            <AdvancedDataTable<RecentReceipt>
              data={recentReceipts}
              loading={receiptsLoading}
              emptyMessage="No payments recorded yet — receipts will show up here once billing starts."
              keyExtractor={(row) => row.id}
              searchable
              searchPlaceholder="Search by patient or receipt number..."
              toolbarExtra={
                <div className="flex items-center gap-2 flex-wrap">
                  <Label htmlFor="paymentsFrom" className="text-xs text-muted-foreground">From</Label>
                  <Input id="paymentsFrom" type="date" value={paymentsFrom} onChange={(e) => setPaymentsFrom(e.target.value)} className="h-9 w-auto" />
                  <Label htmlFor="paymentsTo" className="text-xs text-muted-foreground">To</Label>
                  <Input id="paymentsTo" type="date" value={paymentsTo} onChange={(e) => setPaymentsTo(e.target.value)} className="h-9 w-auto" />
                  {isPaymentsRangeFiltered && (
                    <button
                      type="button"
                      onClick={() => { setPaymentsFrom(''); setPaymentsTo(''); }}
                      className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Clear payments date range"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              }
              exportable
              exportFileName="recent-payments"
              pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
              columns={[
                { key: 'receipt_number', header: 'Receipt', sortable: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
                { key: 'patient_name', header: 'Patient', sortable: true },
                { key: 'payment_method', header: 'Method', sortable: true, render: (v) => <span className="capitalize">{v}</span> },
                { key: 'payment_amount', header: 'Amount', align: 'right', sortable: true, render: (v) => fmt(v) },
                { key: 'payment_date', header: 'Date', sortable: true, render: (v) => new Date(v).toLocaleDateString() },
              ]}
            />
            </>
            )}
          </div>

          <div className="lg:col-span-4">
            {isLabView ? (
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Lab Requests — Completed vs Outstanding</CardTitle>
                </CardHeader>
                <CardContent>
                  {labLoading ? (
                    <LoadingState message="Loading lab requests..." />
                  ) : !labData || labData.totals.total === 0 ? (
                    <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                      No lab requests yet
                    </div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Completed', value: labData.totals.completed },
                              { name: 'Outstanding', value: labData.totals.outstanding },
                            ]}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={60}
                            outerRadius={85}
                            paddingAngle={labData.totals.completed > 0 && labData.totals.outstanding > 0 ? 3 : 0}
                            strokeWidth={0}
                          >
                            <Cell fill={PAID_COLOR} />
                            <Cell fill={OUTSTANDING_COLOR} />
                          </Pie>
                          <RTooltip content={<LabStatusTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="mt-2 space-y-2 border-t border-border pt-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PAID_COLOR }} />
                            Completed (approved)
                          </span>
                          <span className="font-semibold text-foreground">{labData.totals.completed}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: OUTSTANDING_COLOR }} />
                            Still outstanding
                          </span>
                          <span className="font-semibold text-foreground">{labData.totals.outstanding}</span>
                        </div>
                        {/* Where the outstanding work actually sits, so the number
                            points at a next action rather than just a backlog. */}
                        <p className="pt-1 text-xs text-muted-foreground">
                          {labData.totals.awaitingCollection} awaiting collection ·{' '}
                          {labData.totals.inProgress} in progress ·{' '}
                          {labData.totals.awaitingApproval} awaiting approval
                        </p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : isPharmacyView ? (
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Stock Movement (last 30 days)</CardTitle>
                </CardHeader>
                <CardContent>
                  {stockLoading ? (
                    <LoadingState message="Loading stock movement..." />
                  ) : !stockMovement || stockMovement.totals?.items === 0 ? (
                    <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                      No stock in this pharmacy yet
                    </div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Fast moving', value: stockMovement.movement.fast.length },
                              { name: 'Average moving', value: stockMovement.movement.average.length },
                              { name: 'Slow / not moving', value: stockMovement.movement.slow.length },
                            ]}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={60}
                            outerRadius={85}
                            paddingAngle={3}
                            strokeWidth={0}
                          >
                            <Cell fill={PAID_COLOR} />
                            <Cell fill="#F59E0B" />
                            <Cell fill={OUTSTANDING_COLOR} />
                          </Pie>
                          <RTooltip content={<StockMovementTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="mt-2 space-y-2 border-t border-border pt-3">
                        {[
                          { label: 'Fast moving', color: PAID_COLOR, list: stockMovement.movement.fast },
                          { label: 'Average moving', color: '#F59E0B', list: stockMovement.movement.average },
                          { label: 'Slow / not moving', color: OUTSTANDING_COLOR, list: stockMovement.movement.slow },
                        ].map(({ label, color, list }) => (
                          <div key={label} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                              {label}
                            </span>
                            <span className="font-semibold text-foreground">{list.length} items</span>
                          </div>
                        ))}
                        {stockMovement.movement.fast[0] && (
                          <p className="pt-1 text-xs text-muted-foreground">
                            Top mover: <span className="font-medium text-foreground">{stockMovement.movement.fast[0].itemName}</span>
                            {' '}({stockMovement.movement.fast[0].qtyDispensed} dispensed)
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Paid ({isCustomRange ? `${customFrom} to ${customTo}` : PERIODS.find((p) => p.value === period)?.label}) vs Outstanding
                </CardTitle>
              </CardHeader>
              <CardContent>
                {receiptStats.totalAmount === 0 && stats.totalOutstanding === 0 ? (
                  <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                    No billing activity in this period
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Paid', value: receiptStats.totalAmount },
                            { name: 'Outstanding', value: stats.totalOutstanding },
                          ]}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={60}
                          outerRadius={85}
                          paddingAngle={receiptStats.totalAmount > 0 && stats.totalOutstanding > 0 ? 3 : 0}
                          strokeWidth={0}
                        >
                          <Cell fill={PAID_COLOR} />
                          <Cell fill={OUTSTANDING_COLOR} />
                        </Pie>
                        <RTooltip content={<BillingStatusTooltip fmt={fmt} maskPaid={!collectionsRevealed} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 space-y-2 border-t border-border pt-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PAID_COLOR }} />
                          Paid ({isCustomRange ? 'custom range' : PERIODS.find((p) => p.value === period)?.label})
                        </span>
                        <span className="font-semibold text-foreground">{maskMoney(fmt(receiptStats.totalAmount))}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: OUTSTANDING_COLOR }} />
                          Outstanding (current)
                        </span>
                        <span className="font-semibold text-foreground">{fmt(stats.totalOutstanding)}</span>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            )}
          </div>
        </div>

        {/* Same minimal overview as Reports Center's Dashboard Overview page —
            gated the same way collections already are above, since it leads
            with revenue figures that shouldn't be visible to every role. */}
        {canViewCollections && (
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Overview</h2>
            <DashboardOverviewContent />
          </div>
        )}
      </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
