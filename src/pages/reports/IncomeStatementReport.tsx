import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { fmtCurrency, CsvColumn } from '@/utils/reportUtils';

interface AccountLine {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: number;
}

type Basis = 'cash' | 'accrual';

interface IncomeStatementData {
  period: { dateFrom: string; dateTo: string };
  basis?: Basis;
  revenue: AccountLine[];
  expenses: AccountLine[];
  totals: {
    totalRevenue: number;
    totalExpenses: number;
    netIncome: number;
  };
}

function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: now.toISOString().split('T')[0],
  };
}

export default function IncomeStatementReport() {
  const { user } = useAuth();
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<IncomeStatementData | null>(null);
  // Cash by default: what was collected is the figure that should agree with
  // the cashier and the dashboard. Accrual stays available because it is what
  // the receivables balance reconciles against.
  const [basis, setBasis] = useState<Basis>('cash');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      if (user?.clinic) params.append('clinic_id', user.clinic);
      params.append('basis', basis);
      const res = await authFetch(`/api/reports-v2/income-statement?${params}`);
      if (!res.ok) throw new Error('Failed to load income statement');
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load income statement');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, user?.clinic, basis]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const revenue = data?.revenue || [];
  const expenses = data?.expenses || [];
  const totalRevenue = data?.totals?.totalRevenue ?? 0;
  const totalExpenses = data?.totals?.totalExpenses ?? 0;
  const netIncome = data?.totals?.netIncome ?? 0;
  const netPositive = netIncome >= 0;

  const csvRows = [
    { section: '', account_code: '', account_name: basis === 'cash' ? 'Basis: cash received' : 'Basis: billed (accrual)', amount: 0 },
    ...revenue.map(r => ({ section: 'Revenue', account_code: r.account_code, account_name: r.account_name, amount: r.amount })),
    { section: '', account_code: '', account_name: 'Total Revenue', amount: totalRevenue },
    ...expenses.map(e => ({ section: 'Expenses', account_code: e.account_code, account_name: e.account_name, amount: e.amount })),
    { section: '', account_code: '', account_name: 'Total Expenses', amount: totalExpenses },
    { section: '', account_code: '', account_name: 'Net Income', amount: netIncome },
  ];
  const csvColumns: CsvColumn[] = [
    { header: 'Section', key: 'section' },
    { header: 'Account Code', key: 'account_code' },
    { header: 'Account', key: 'account_name' },
    { header: 'Amount', key: 'amount', transform: (v: any) => fmtCurrency(v) },
  ];

  return (
    <ReportSubPageShell
      title="Income Statement"
      description={basis === 'cash'
        ? 'Profit & Loss — revenue counted when the patient pays'
        : 'Profit & Loss — revenue counted when the bill is raised, paid or not'}
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={csvRows}
      csvColumns={csvColumns}
      csvFilename={`income-statement-${basis}-${dateFrom}-${dateTo}.csv`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border overflow-hidden" role="group" aria-label="Accounting basis">
          {(['cash', 'accrual'] as Basis[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBasis(b)}
              aria-pressed={basis === b}
              className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${
                basis === b ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
              }`}
            >
              {b === 'cash' ? 'Cash received' : 'Billed (accrual)'}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {basis === 'cash'
            ? 'Counting money actually received in this period. Unpaid and part-paid bills are excluded until they are paid.'
            : 'Counting every bill raised in this period, whether or not it has been paid. Use this to reconcile receivables.'}
        </p>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {/* ── Revenue section ── */}
              <tr className="bg-muted/50">
                <td colSpan={2} className="px-4 py-2 font-semibold text-[13px] uppercase tracking-wide text-muted-foreground">
                  Revenue
                </td>
              </tr>
              {revenue.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-4 text-center text-sm text-muted-foreground">
                    No revenue activity in this period
                  </td>
                </tr>
              ) : (
                revenue.map(r => (
                  <tr key={r.account_id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">
                      <span className="text-muted-foreground font-mono text-xs mr-2">{r.account_code}</span>
                      {r.account_name}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtCurrency(r.amount)}</td>
                  </tr>
                ))
              )}
              <tr className="border-t-2 border-foreground/20">
                <td className="px-4 py-2 font-semibold">Total Revenue</td>
                <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">{fmtCurrency(totalRevenue)}</td>
              </tr>

              {/* ── Spacer ── */}
              <tr><td colSpan={2} className="h-3" /></tr>

              {/* ── Expenses section ── */}
              <tr className="bg-muted/50">
                <td colSpan={2} className="px-4 py-2 font-semibold text-[13px] uppercase tracking-wide text-muted-foreground">
                  Expenses
                </td>
              </tr>
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-4 text-center text-sm text-muted-foreground">
                    No expense activity in this period
                  </td>
                </tr>
              ) : (
                expenses.map(e => (
                  <tr key={e.account_id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">
                      <span className="text-muted-foreground font-mono text-xs mr-2">{e.account_code}</span>
                      {e.account_name}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtCurrency(e.amount)}</td>
                  </tr>
                ))
              )}
              <tr className="border-t-2 border-foreground/20">
                <td className="px-4 py-2 font-semibold">Total Expenses</td>
                <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">{fmtCurrency(totalExpenses)}</td>
              </tr>

              {/* ── Net Income ── */}
              <tr className={`border-t-4 ${netPositive ? 'border-green-600/40' : 'border-red-600/40'}`}>
                <td className="px-4 py-3 font-bold text-base flex items-center gap-2">
                  {netPositive ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  )}
                  Net Income
                </td>
                <td
                  className={`px-4 py-3 text-right font-mono font-bold text-base tabular-nums ${
                    netPositive ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {fmtCurrency(netIncome)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </ReportSubPageShell>
  );
}
