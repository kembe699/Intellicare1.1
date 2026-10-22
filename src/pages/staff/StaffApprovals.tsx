import React, { useState, useEffect } from 'react';
import { staffFetch } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from '@/lib/notify';
import { formatMoney, formatDate } from '@/lib/format';
import { Loader2 } from 'lucide-react';

export default function StaffApprovals() {
  const [data, setData] = useState<{ leave: any[]; advances: any[] }>({ leave: [], advances: [] });
  const [loading, setLoading] = useState(true);
  const [rejectTarget, setRejectTarget] = useState<{ kind: 'leave' | 'advance'; id: string } | null>(null);
  const [reason, setReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await staffFetch('/api/employee-portal/approvals');
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const approve = async (kind: 'leave' | 'advance', id: string) => {
    const res = await staffFetch(`/api/employee-portal/approvals/${kind}/${id}/approve`, { method: 'POST' });
    if (res.ok) { toast.success('Approved.'); load(); } else { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Could not approve.'); }
  };

  const reject = async () => {
    if (!rejectTarget || !reason.trim()) return;
    const res = await staffFetch(`/api/employee-portal/approvals/${rejectTarget.kind}/${rejectTarget.id}/reject`, {
      method: 'POST', body: JSON.stringify({ reason }),
    });
    if (res.ok) { toast.success('Rejected.'); setRejectTarget(null); setReason(''); load(); } else { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Could not reject.'); }
  };

  const total = data.leave.length + data.advances.length;

  return (
    <div className="px-4 py-5 space-y-5">
      <h1 className="text-lg font-semibold" style={{ color: '#14363C' }}>Approvals</h1>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nothing awaiting your approval.</p>
      ) : (
        <>
          {data.leave.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Leave requests</h2>
              {data.leave.map((r) => (
                <div key={r.id} className="rounded-lg border p-3 space-y-2">
                  <p className="font-medium text-sm">{r.first_name} {r.last_name} — {r.leave_type_name}</p>
                  <p className="text-sm text-muted-foreground">{formatDate(r.start_date)} – {formatDate(r.end_date)} ({r.days} day{r.days === 1 ? '' : 's'})</p>
                  {r.reason && <p className="text-sm">{r.reason}</p>}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="h-10 flex-1" style={{ backgroundColor: '#077A84' }} onClick={() => approve('leave', r.id)}>Approve</Button>
                    <Button size="sm" variant="outline" className="h-10 flex-1 text-destructive" onClick={() => setRejectTarget({ kind: 'leave', id: r.id })}>Reject</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {data.advances.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Salary advances</h2>
              {data.advances.map((r) => (
                <div key={r.id} className="rounded-lg border p-3 space-y-2">
                  <p className="font-medium text-sm">{r.first_name} {r.last_name}</p>
                  <p className="text-base font-mono font-semibold">{formatMoney(r.amount, r.currency)}</p>
                  {r.reason && <p className="text-sm">{r.reason}</p>}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="h-10 flex-1" style={{ backgroundColor: '#077A84' }} onClick={() => approve('advance', r.id)}>Approve</Button>
                    <Button size="sm" variant="outline" className="h-10 flex-1 text-destructive" onClick={() => setRejectTarget({ kind: 'advance', id: r.id })}>Reject</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject request</DialogTitle>
            <DialogDescription>A reason is required.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection" className="text-mobile-base" />
          <Button className="w-full h-11" variant="destructive" disabled={!reason.trim()} onClick={reject}>Reject</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
