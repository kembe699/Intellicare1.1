import React, { useEffect, useMemo, useState } from 'react';
import { staffFetch } from '@/api/apiClient';
import { formatDate } from '@/lib/format';
import { ChevronLeft, ChevronRight, Loader2, CalendarRange } from 'lucide-react';

interface Entry { duty_date: string; name: string; code: string | null; kind: string; color: string | null; start_time: string; end_time: string }
interface RosterData { period: string; today: string; department: string | null; status: string | null; entries: Entry[] }

const shiftPeriod = (p: string, n: number) => {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const hm = (t: string) => String(t).slice(0, 5);

/** Staff portal › My Roster — the employee's own shifts from their department's approved roster. */
export default function StaffRoster() {
  const [period, setPeriod] = useState<string | null>(null);
  const [data, setData] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    staffFetch(`/api/employee-portal/roster${period ? `?period=${period}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setData(d); if (d && !period) setPeriod(d.period); })
      .finally(() => setLoading(false));
  }, [period]);

  const days = useMemo(() => {
    if (!data) return [];
    const [y, m] = data.period.split('-').map(Number);
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${data.period}-${String(i + 1).padStart(2, '0')}`);
  }, [data]);
  const byDate = useMemo(() => new Map((data?.entries || []).map((e) => [e.duty_date, e])), [data]);
  const next = data ? data.entries.find((e) => e.duty_date >= data.today) : undefined;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous month" className="p-2" style={{ minWidth: 44, minHeight: 44 }} onClick={() => period && setPeriod(shiftPeriod(period, -1))}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="font-semibold" style={{ color: '#14363C' }}>{period ? monthLabel(period) : 'My Roster'}</p>
          {data?.department && <p className="text-xs text-muted-foreground">{data.department}</p>}
        </div>
        <button type="button" aria-label="Next month" className="p-2" style={{ minWidth: 44, minHeight: 44 }} onClick={() => period && setPeriod(shiftPeriod(period, 1))}>
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : !data || !data.entries.length ? (
        <div className="flex flex-col items-center text-center gap-1 py-12 px-4 border border-dashed rounded-lg">
          <CalendarRange className="w-7 h-7 mb-2 text-primary" />
          <p className="font-semibold">No roster for this month yet</p>
          <p className="text-sm text-muted-foreground">
            {data?.status && data.status !== 'approved'
              ? 'Your department’s roster is being prepared — it shows here once HR approves it.'
              : 'When your department’s roster is approved, your shifts appear here.'}
          </p>
        </div>
      ) : (
        <>
          {next && (
            <div className="rounded-lg p-4 text-white" style={{ backgroundColor: '#0F766E' }}>
              <p className="text-xs opacity-80">{next.duty_date === data.today ? 'Today' : 'Next shift'}</p>
              <p className="text-lg font-semibold">{next.name}</p>
              <p className="text-sm opacity-90">{formatDate(next.duty_date)} · {hm(next.start_time)}–{hm(next.end_time)}</p>
            </div>
          )}
          <div className="border rounded-lg divide-y">
            {days.map((d) => {
              const e = byDate.get(d);
              const isToday = d === data.today;
              return (
                <div key={d} className="flex items-center gap-3 px-3 py-2.5" style={{ backgroundColor: isToday ? '#F0FDFA' : undefined }}>
                  <div className="w-12 shrink-0">
                    <p className="text-xs text-muted-foreground">{weekday(d)}</p>
                    <p className="font-semibold">{Number(d.slice(8))}</p>
                  </div>
                  {e ? (
                    <div className="flex-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex items-center justify-center rounded-md text-xs font-bold text-white px-2 h-6 min-w-8"
                          style={{ backgroundColor: e.color || '#0F766E' }}>{e.code || e.name.slice(0, 2).toUpperCase()}</span>
                        <span className="text-sm truncate">{e.name}{e.kind === 'on_call' ? ' (on call)' : ''}</span>
                      </div>
                      <span className="text-sm text-muted-foreground whitespace-nowrap">{hm(e.start_time)}–{hm(e.end_time)}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Off</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
