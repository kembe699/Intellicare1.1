import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { Loader2, Activity, CheckCircle2, XCircle, Clock, Scissors, Stethoscope, Users, Banknote } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { ReportLetterhead } from './ReportLetterhead';
import { fmtCurrency, CsvColumn } from '@/utils/reportUtils';
import { ROLE_LABEL } from '@/pages/theatre/theatreShared';

interface ProcedureRow { procedureName: string; operationCount: number; totalRevenue: number; }
interface SurgeonRow { surgeonId: string | null; surgeonName: string; operationCount: number; totalRevenue: number; }
interface TeamPayoutRow {
  employeeId: string | null; employeeName: string; role: string;
  payoutCount: number; totalAmount: number; paidAmount: number; unpaidAmount: number;
}

interface TheatreData {
  period: { dateFrom: string; dateTo: string };
  summary: {
    totalOperations: number;
    completedOperations: number;
    cancelledOperations: number;
    deaths: number;
    totalRevenue: number;
    avgDurationMinutes: number;
    totalTeamPayouts: number;
    unpaidTeamPayouts: number;
  };
  byProcedure: ProcedureRow[];
  bySurgeon: SurgeonRow[];
  byTeamPayout: TeamPayoutRow[];
}

function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m + 1)}-01`, to: now.toISOString().split('T')[0] };
}

function StatCard({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="bg-card rounded-lg border shadow-sm p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone || 'bg-primary/10 text-primary'}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums truncate">{value}</p>
      </div>
    </div>
  );
}

export default function TheatreReport() {
  const { user } = useAuth();
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TheatreData | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (user?.clinic) params.append('clinic_id', user.clinic);
      const res = await authFetch(`/api/reports-v2/theatre?${params}`);
      if (!res.ok) throw new Error('Failed to load theatre report');
      setData(await res.json());
      setGeneratedAt(new Date());
    } catch (err: any) {
      toast.error(err.message || 'Failed to load theatre report');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, user?.clinic]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const summary = data?.summary;
  const byProcedure = data?.byProcedure || [];
  const bySurgeon = data?.bySurgeon || [];
  const byTeamPayout = data?.byTeamPayout || [];

  const csvColumns: CsvColumn[] = [
    { header: 'Procedure', key: 'procedureName' },
    { header: 'Operations', key: 'operationCount' },
    { header: 'Revenue', key: 'totalRevenue', transform: (v: any) => fmtCurrency(v) },
  ];

  return (
    <ReportSubPageShell
      title="Theatre Report"
      description="Operations performed in the period, by procedure and by surgeon"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={byProcedure}
      csvColumns={csvColumns}
      csvFilename={`theatre-report-${dateFrom}-${dateTo}.csv`}
    >
      <ReportLetterhead title="Theatre Report" dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} />
      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard icon={Activity} label="Total Operations" value={summary?.totalOperations ?? 0} />
            <StatCard icon={CheckCircle2} label="Completed" value={summary?.completedOperations ?? 0} tone="bg-success-bg text-success" />
            <StatCard icon={XCircle} label="Cancelled" value={summary?.cancelledOperations ?? 0} tone="bg-muted text-muted-foreground" />
            <StatCard icon={Clock} label="Avg Duration" value={`${summary?.avgDurationMinutes ?? 0}m`} tone="bg-info-bg text-info" />
            <StatCard icon={Scissors} label="Revenue Billed" value={fmtCurrency(summary?.totalRevenue ?? 0)} tone="bg-primary/10 text-primary" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={Users} label="Team Fee Payouts" value={fmtCurrency(summary?.totalTeamPayouts ?? 0)} tone="bg-info-bg text-info" />
            <StatCard icon={Banknote} label="Unpaid Team Payouts" value={fmtCurrency(summary?.unpaidTeamPayouts ?? 0)} tone={(summary?.unpaidTeamPayouts ?? 0) > 0 ? 'bg-warning-bg text-warning' : 'bg-muted text-muted-foreground'} />
          </div>

          {(summary?.deaths ?? 0) > 0 && (
            <div className="rounded-md border border-destructive-border bg-destructive-bg px-3 py-2 text-xs text-destructive">
              {summary?.deaths} operation{summary?.deaths === 1 ? '' : 's'} with a recorded outcome of death in this period.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
                <Scissors className="w-4 h-4 text-muted-foreground" />
                <h4 className="font-semibold text-sm">By Procedure</h4>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-info-bg dark:bg-info/40 border-b border-border text-xs uppercase tracking-wide text-foreground font-semibold">
                    <th scope="col" className="px-4 py-2 text-left">Procedure</th>
                    <th scope="col" className="px-4 py-2 text-right">Count</th>
                    <th scope="col" className="px-4 py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {byProcedure.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-muted-foreground">No operations in this period</td></tr>
                  ) : byProcedure.map(p => (
                    <tr key={p.procedureName} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2">{p.procedureName}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">{p.operationCount}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtCurrency(p.totalRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
                {byProcedure.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-foreground/30 bg-info-bg dark:bg-info/20 font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{byProcedure.reduce((s, p) => s + p.operationCount, 0)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums border-b-2 border-double border-foreground">{fmtCurrency(byProcedure.reduce((s, p) => s + p.totalRevenue, 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-muted-foreground" />
                <h4 className="font-semibold text-sm">By Surgeon</h4>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-info-bg dark:bg-info/40 border-b border-border text-xs uppercase tracking-wide text-foreground font-semibold">
                    <th scope="col" className="px-4 py-2 text-left">Surgeon</th>
                    <th scope="col" className="px-4 py-2 text-right">Count</th>
                    <th scope="col" className="px-4 py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {bySurgeon.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-muted-foreground">No operations in this period</td></tr>
                  ) : bySurgeon.map(s => (
                    <tr key={s.surgeonId || 'unassigned'} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2">{s.surgeonName}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">{s.operationCount}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtCurrency(s.totalRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
                {bySurgeon.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-foreground/30 bg-info-bg dark:bg-info/20 font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{bySurgeon.reduce((s, x) => s + x.operationCount, 0)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums border-b-2 border-double border-foreground">{fmtCurrency(bySurgeon.reduce((s, x) => s + x.totalRevenue, 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <h4 className="font-semibold text-sm">Team Fee Payouts</h4>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-info-bg dark:bg-info/40 border-b border-border text-xs uppercase tracking-wide text-foreground font-semibold">
                  <th scope="col" className="px-4 py-2 text-left">Employee</th>
                  <th scope="col" className="px-4 py-2 text-left">Role</th>
                  <th scope="col" className="px-4 py-2 text-right">Payouts</th>
                  <th scope="col" className="px-4 py-2 text-right">Total</th>
                  <th scope="col" className="px-4 py-2 text-right">Paid</th>
                  <th scope="col" className="px-4 py-2 text-right">Unpaid</th>
                </tr>
              </thead>
              <tbody>
                {byTeamPayout.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No team fee payouts in this period</td></tr>
                ) : byTeamPayout.map((t) => (
                  <tr key={`${t.employeeId}-${t.role}`} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">{t.employeeName}</td>
                    <td className="px-4 py-2 text-muted-foreground">{ROLE_LABEL[t.role] || t.role}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">{t.payoutCount}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtCurrency(t.totalAmount)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-success">{fmtCurrency(t.paidAmount)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-warning">{fmtCurrency(t.unpaidAmount)}</td>
                  </tr>
                ))}
              </tbody>
              {byTeamPayout.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-foreground/30 bg-info-bg dark:bg-info/20 font-semibold">
                    <td className="px-4 py-2.5" colSpan={2}>Total</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{byTeamPayout.reduce((s, t) => s + t.payoutCount, 0)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums border-b-2 border-double border-foreground">{fmtCurrency(byTeamPayout.reduce((s, t) => s + t.totalAmount, 0))}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtCurrency(byTeamPayout.reduce((s, t) => s + t.paidAmount, 0))}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtCurrency(byTeamPayout.reduce((s, t) => s + t.unpaidAmount, 0))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
