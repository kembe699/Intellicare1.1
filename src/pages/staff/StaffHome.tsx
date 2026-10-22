import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStaffAuth } from '@/contexts/StaffAuthContext';
import { staffFetch } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Clock, Loader2, ChevronRight } from 'lucide-react';

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function formatWeekday(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function StaffHome() {
  const { employee } = useStaffAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await staffFetch('/api/employee-portal/attendance/summary');
      if (res.ok) setSummary(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSummary(); }, []);

  const clockedIn = summary?.today?.first_in && !summary?.today?.last_out;
  const nextAction: 'in' | 'out' = clockedIn ? 'out' : 'in';

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="px-4 py-5 space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">{greeting()}, {employee?.firstName}</p>
        <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="rounded-2xl border p-5 text-center space-y-3" style={{ backgroundColor: clockedIn ? '#ECFDF5' : '#F8FAFC' }}>
            <p className="text-sm text-muted-foreground">
              {clockedIn ? `Clocked in at ${formatTime(summary.today.first_in)}` : summary?.today?.last_out ? `Clocked out at ${formatTime(summary.today.last_out)}` : "You haven't clocked in today"}
            </p>
            <button
              type="button"
              onClick={() => navigate('/staff/clock', { state: { type: nextAction } })}
              className="w-full rounded-xl py-5 text-white text-lg font-semibold flex items-center justify-center gap-2 active:opacity-90"
              style={{ backgroundColor: nextAction === 'in' ? '#077A84' : '#14363C', minHeight: 64 }}
            >
              <Clock className="w-6 h-6" />
              {nextAction === 'in' ? 'Clock In' : 'Clock Out'}
            </button>
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-2" style={{ color: '#14363C' }}>This week</h2>
            <div className="space-y-2">
              {(summary?.week || []).length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No attendance recorded this week yet.</p>
              )}
              {(summary?.week || []).map((d: any) => (
                <div key={d.shift_date} className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
                  <span>{formatWeekday(d.shift_date)}</span>
                  <span className="text-muted-foreground">{formatTime(d.first_in)} – {formatTime(d.last_out)}</span>
                  <span className="font-mono font-medium">{d.hours_worked ? `${Number(d.hours_worked).toFixed(1)}h` : '—'}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5 mt-2 text-sm font-medium">
              <span>Month total</span>
              <span>{summary?.monthTotalHours ? `${Number(summary.monthTotalHours).toFixed(1)} hours` : '0 hours'}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/staff/clock')}
            className="w-full flex items-center justify-between text-sm text-muted-foreground py-2"
          >
            <span>Scan a different site's QR code</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
