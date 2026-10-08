import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Users, Building2, ShieldCheck, Stethoscope } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { fmtCurrency, CsvColumn } from '@/utils/reportUtils';

// One revenue report, one row shape, four dimensions to view it by —
// "by department, by scheme, by branch, by user, basically all" in one
// place rather than four separate pages. User and Department reuse the
// two breakdowns that already existed and already work well
// (reportBillingByUser.js, reportClinicPerformance.js) rather than
// duplicating that logic; Scheme and Branch are genuinely new
// (reportRevenue.js) — neither existed as a reporting dimension before.
type GroupBy = 'user' | 'department' | 'scheme' | 'branch';

interface Row {
  key: string;
  label: string;
  totalCollected: number;
  transactionCount?: number;
}

function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m + 1)}-01`, to: now.toISOString().split('T')[0] };
}

const GROUP_OPTIONS: { value: GroupBy; label: string; icon: React.ElementType }[] = [
  { value: 'user', label: 'By User', icon: Users },
  { value: 'department', label: 'By Department', icon: Stethoscope },
  { value: 'scheme', label: 'By Scheme', icon: ShieldCheck },
  { value: 'branch', label: 'By Branch', icon: Building2 },
];

export default function RevenueReport() {
  const { user } = useAuth();
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [groupBy, setGroupBy] = useState<GroupBy>('user');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setNote(null);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (user?.clinic) params.append('clinic_id', user.clinic);

      if (groupBy === 'user') {
        const res = await authFetch(`/api/reports-v2/billing-by-user?${params}`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows((json.cashiers || []).map((c: any) => ({
          key: String(c.cashierId ?? c.cashierName), label: c.cashierName, totalCollected: c.totalCollected, transactionCount: c.transactionCount,
        })));
      } else if (groupBy === 'department') {
        const res = await authFetch(`/api/reports-v2/clinic-performance?${params}`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows((json.byCategory || []).map((c: any) => ({
          key: c.category, label: c.category, totalCollected: c.totalCollected,
        })));
        if (json.categorization?.note) setNote(json.categorization.note);
      } else {
        const res = await authFetch(`/api/reports-v2/revenue?${params}&groupBy=${groupBy}`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setRows((json.rows || []).map((r: any) => ({
          key: r.key, label: r.label, totalCollected: r.totalCollected, transactionCount: r.transactionCount,
        })));
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load revenue report');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, user?.clinic, groupBy]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sorted = [...rows].sort((a, b) => b.totalCollected - a.totalCollected);
  const total = sorted.reduce((s, r) => s + r.totalCollected, 0);
  const activeOption = GROUP_OPTIONS.find(o => o.value === groupBy)!;

  const csvColumns: CsvColumn[] = [
    { header: activeOption.label.replace('By ', ''), key: 'label' },
    { header: 'Transactions', key: 'transactionCount' },
    { header: 'Revenue Collected', key: 'totalCollected', transform: (v: any) => fmtCurrency(v) },
  ];

  return (
    <ReportSubPageShell
      title="Revenue Report"
      description="Revenue collected in the period, broken down by whichever dimension you pick"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={sorted}
      csvColumns={csvColumns}
      csvFilename={`revenue-by-${groupBy}-${dateFrom}-${dateTo}.csv`}
    >
      <div className="mb-4 inline-flex rounded-md border overflow-hidden" role="group" aria-label="Group revenue by">
        {GROUP_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setGroupBy(value)}
            aria-pressed={groupBy === value}
            className={`px-3 py-1.5 text-[13px] font-medium transition-colors flex items-center gap-1.5 ${
              groupBy === value ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {note && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{note}</div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-left">{activeOption.label.replace('By ', '')}</th>
                <th className="px-4 py-2 text-right">Transactions</th>
                <th className="px-4 py-2 text-right">Revenue Collected</th>
                <th className="px-4 py-2 text-right w-32">Share</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">No revenue activity in this period</td></tr>
              ) : (
                sorted.map(r => {
                  const share = total > 0 ? (r.totalCollected / total) * 100 : 0;
                  return (
                    <tr key={r.key} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2">{r.label}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">{r.transactionCount ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtCurrency(r.totalCollected)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, share)}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{share.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-foreground/20 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{sorted.reduce((s, r) => s + (r.transactionCount || 0), 0)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtCurrency(total)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </ReportSubPageShell>
  );
}
