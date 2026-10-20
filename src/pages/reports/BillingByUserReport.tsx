import React, { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { Loader2, DollarSign, Receipt, Users, Trophy, UserCircle } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { ReportLetterhead } from './ReportLetterhead';
import { AdvancedDataTable, type Column } from '@/components/common/DataTable/AdvancedDataTable';
import { fmtCurrency, fmtCount, CsvColumn } from '@/utils/reportUtils';

// ─── Types ───────────────────────────────────────────────────────────────────
interface MethodBreakdown {
  count: number;
  amount: number;
}

interface CashierRow {
  cashierId: number | null;
  cashierName: string;
  transactionCount: number;
  totalCollected: number;
  methods: Record<string, MethodBreakdown>;
}

interface ReportResponse {
  dateFrom: string;
  dateTo: string;
  cashiers: CashierRow[];
  summary: {
    totalCollected: number;
    totalTransactions: number;
    cashierCount: number;
    topCashierName: string | null;
    topCashierAmount: number;
  };
}

// Canonical display order for payment method columns; anything else found in
// the data is appended after these.
const KNOWN_METHOD_ORDER = ['cash', 'card', 'insurance', 'check', 'lease'];
const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  insurance: 'Insurance',
  check: 'Cheque',
  lease: 'Lease',
};

const todayStr = () => new Date().toISOString().split('T')[0];

export default function BillingByUserReport() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;

  // Default both ends of the range to today, matching "today how much they made"
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [selectedCashier, setSelectedCashier] = useState('all');
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      if (clinicId) params.append('clinic_id', String(clinicId));
      const res = await authFetch(`/api/reports-v2/billing-by-user?${params}`);
      if (!res.ok) throw new Error('Failed to load billing report');
      setData(await res.json());
      setGeneratedAt(new Date());
    } catch (err: any) {
      toast.error(err.message || 'Failed to load billing report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [dateFrom, dateTo]);
  useEffect(() => { setSelectedCashier('all'); }, [dateFrom, dateTo]);

  const cashiers = data?.cashiers || [];
  const cashierKey = (c: CashierRow) => String(c.cashierId ?? c.cashierName);

  const cashierOptions = useMemo(
    () => cashiers.map(c => ({ key: cashierKey(c), name: c.cashierName })),
    [cashiers]
  );

  const filteredCashiers = useMemo(
    () => selectedCashier === 'all' ? cashiers : cashiers.filter(c => cashierKey(c) === selectedCashier),
    [cashiers, selectedCashier]
  );

  // Global summary comes from the backend; when a specific user is selected, derive
  // the tiles from just their row so "view billing by a specific user" actually narrows
  // what's shown, not just the table.
  const summary = useMemo(() => {
    if (selectedCashier === 'all') return data?.summary;
    const row = filteredCashiers[0];
    if (!row) return { totalCollected: 0, totalTransactions: 0, cashierCount: 0, topCashierName: null, topCashierAmount: 0 };
    return {
      totalCollected: row.totalCollected,
      totalTransactions: row.transactionCount,
      cashierCount: 1,
      topCashierName: row.cashierName,
      topCashierAmount: row.totalCollected,
    };
  }, [data, selectedCashier, filteredCashiers]);

  // Which payment-method columns actually appear in the returned data
  const methodColumns = useMemo(() => {
    const present = new Set<string>();
    cashiers.forEach(c => Object.keys(c.methods || {}).forEach(m => present.add(m)));
    const known = KNOWN_METHOD_ORDER.filter(m => present.has(m));
    const extra = Array.from(present).filter(m => !KNOWN_METHOD_ORDER.includes(m)).sort();
    return [...known, ...extra];
  }, [cashiers]);

  const csvColumns: CsvColumn[] = useMemo(() => {
    const cols: CsvColumn[] = [
      { header: 'Cashier', key: 'cashierName' },
      { header: 'Transactions', key: 'transactionCount' },
    ];
    methodColumns.forEach(m => {
      cols.push({
        header: METHOD_LABELS[m] || m,
        key: `method_${m}`,
        transform: (_v, row) => fmtCurrency(row.methods?.[m]?.amount || 0),
      });
    });
    cols.push({ header: 'Total Collected', key: 'totalCollected', transform: (v) => fmtCurrency(v) });
    return cols;
  }, [methodColumns]);

  const isSameDay = dateFrom === dateTo;
  const periodLabel = isSameDay
    ? (dateFrom === todayStr() ? 'Today' : dateFrom)
    : `${dateFrom} — ${dateTo}`;

  return (
    <ReportSubPageShell
      title="Billing Report by User"
      description="Collections per cashier for the selected period"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={filteredCashiers}
      csvColumns={csvColumns}
      csvFilename={`billing-by-user-${dateFrom}-${dateTo}.csv`}
    >
      <ReportLetterhead title="Billing Report by User" dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} />
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* ── Stat tiles ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Collected ({periodLabel})</p>
                  <p className="text-2xl font-bold mt-1">{fmtCurrency(summary?.totalCollected)}</p>
                </div>
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Transactions</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(summary?.totalTransactions)}</p>
                </div>
                <Receipt className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Cashiers Active</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(summary?.cashierCount)}</p>
                </div>
                <Users className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Top Cashier</p>
                  <p className="text-lg font-bold mt-1 truncate">{summary?.topCashierName || '—'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fmtCurrency(summary?.topCashierAmount)}</p>
                </div>
                <Trophy className="h-5 w-5 text-primary shrink-0" />
              </div>
            </div>
          </div>

          {/* ── Per-cashier table — cashier filter lives here (not the table's own built-in
              search) because it also drives what the page-level CSV export downloads. ── */}
          <div>
            <div className="mb-2">
              <h3 className="text-sm font-semibold">Collections by Cashier</h3>
            </div>
            <AdvancedDataTable<CashierRow>
              headerClassName="bg-sky-100 dark:bg-sky-950/40 border-b border-border"
              footerRow={(colSpan) => (
                <tr className="border-t-2 border-foreground/30 bg-sky-50 dark:bg-sky-950/20 font-semibold">
                  <td colSpan={colSpan} className="px-4 py-2.5 text-sm">
                    <div className="flex justify-between items-center">
                      <span>Total Collected</span>
                      <span className="font-mono text-base border-b-2 border-double border-foreground pb-0.5">{fmtCurrency(summary?.totalCollected)}</span>
                    </div>
                  </td>
                </tr>
              )}
              data={filteredCashiers}
              keyExtractor={(c, i) => c.cashierId ?? `${c.cashierName}-${i}`}
              emptyMessage="No receipts recorded for this period."
              toolbarExtra={
                <div className="flex items-center gap-2 flex-wrap">
                  <UserCircle className="h-4 w-4 text-muted-foreground" />
                  <select
                    className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm"
                    value={selectedCashier}
                    onChange={e => setSelectedCashier(e.target.value)}
                  >
                    <option value="all">All cashiers</option>
                    {cashierOptions.map(o => (
                      <option key={o.key} value={o.key}>{o.name}</option>
                    ))}
                  </select>
                </div>
              }
              columns={[
                { key: 'cashierName', header: 'Cashier', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
                { key: 'transactionCount', header: 'Transactions', align: 'right', sortable: true, render: (v) => fmtCount(v) },
                ...methodColumns.map((m): Column<CashierRow> => ({
                  key: `method_${m}`,
                  header: METHOD_LABELS[m] || m,
                  align: 'right',
                  render: (_v, c) => <span className="text-muted-foreground">{c.methods?.[m] ? fmtCurrency(c.methods[m].amount) : '—'}</span>,
                })),
                { key: 'totalCollected', header: 'Total Collected', align: 'right', sortable: true, render: (v) => <span className="font-semibold">{fmtCurrency(v)}</span> },
              ]}
            />
            {filteredCashiers.length > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5 border border-t-0 border-border rounded-b-md bg-muted/20 text-sm font-bold -mt-px">
                <span>Grand Total</span>
                <span className="flex gap-6">
                  <span>{fmtCount(summary?.totalTransactions)}</span>
                  {methodColumns.map(m => (
                    <span key={m}>{fmtCurrency(filteredCashiers.reduce((s, c) => s + (c.methods?.[m]?.amount || 0), 0))}</span>
                  ))}
                  <span className="text-primary">{fmtCurrency(summary?.totalCollected)}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
