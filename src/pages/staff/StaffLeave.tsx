import React, { useState, useEffect } from 'react';
import { staffFetch } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/lib/notify';
import { formatDate } from '@/lib/format';
import { Loader2, Plus } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', approved_by_hod: 'Awaiting HR', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
};
const STATUS_COLOR: Record<string, string> = {
  pending: '#B45309', approved_by_hod: '#1D4ED8', approved: '#16A34A', rejected: '#DC2626', cancelled: '#6B7280',
};

export default function StaffLeave() {
  const [balance, setBalance] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [form, setForm] = useState({ leave_type_id: '', start_date: '', end_date: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        staffFetch('/api/employee-portal/leave/balance'),
        staffFetch('/api/employee-portal/leave/requests'),
      ]);
      if (balRes.ok) setBalance(await balRes.json());
      if (reqRes.ok) setRequests(await reqRes.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (showForm) setLeaveTypes(balance.map((b) => ({ id: b.leave_type_id, name: b.leave_type_name }))); }, [showForm, balance]);

  const submit = async () => {
    if (!form.leave_type_id || !form.start_date || !form.end_date) { toast.error('Please fill in all required fields.'); return; }
    setSubmitting(true);
    try {
      const res = await staffFetch('/api/employee-portal/leave/requests', { method: 'POST', body: JSON.stringify(form) });
      const data = await res.json();
      if (res.ok) {
        toast.success('Leave request submitted.');
        setShowForm(false);
        setForm({ leave_type_id: '', start_date: '', end_date: '', reason: '' });
        load();
      } else {
        toast.error(data.error || 'Could not submit request.');
      }
    } finally { setSubmitting(false); }
  };

  const cancel = async (id: string) => {
    const res = await staffFetch(`/api/employee-portal/leave/requests/${id}/cancel`, { method: 'POST' });
    if (res.ok) { toast.success('Request cancelled.'); load(); } else { toast.error('Could not cancel request.'); }
  };

  return (
    <div className="px-4 py-5 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold" style={{ color: '#14363C' }}>Leave</h1>
        <Button size="sm" className="h-10" style={{ backgroundColor: '#077A84' }} onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-1" /> Request
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {balance.map((b) => (
              <div key={b.leave_type_id} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{b.leave_type_name}</p>
                <p className="text-lg font-semibold">{b.remaining_days}<span className="text-xs text-muted-foreground font-normal"> / {b.entitled_days} days</span></p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold" style={{ color: '#14363C' }}>My requests</h2>
            {requests.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No leave requests yet.</p>}
            {requests.map((r) => (
              <div key={r.id} className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{r.leave_type_name}</p>
                  <span className="text-xs font-medium" style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status] || r.status}</span>
                </div>
                <p className="text-sm text-muted-foreground">{formatDate(r.start_date)} – {formatDate(r.end_date)} ({r.days} day{r.days === 1 ? '' : 's'})</p>
                {r.rejection_reason && <p className="text-xs text-destructive">Reason: {r.rejection_reason}</p>}
                {['pending', 'approved_by_hod', 'approved'].includes(r.status) && (
                  <button type="button" className="text-xs text-muted-foreground underline" onClick={() => cancel(r.id)}>Cancel</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request leave</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Leave type</Label>
              <Select value={form.leave_type_id} onValueChange={(v) => setForm((f) => ({ ...f, leave_type_id: v }))}>
                <SelectTrigger className="h-11 text-mobile-base"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>{leaveTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>From</Label><Input type="date" className="h-11 text-mobile-base" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} /></div>
              <div><Label>To</Label><Input type="date" className="h-11 text-mobile-base" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} /></div>
            </div>
            <div><Label>Reason</Label><Textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="text-mobile-base" /></div>
            <Button className="w-full h-11" style={{ backgroundColor: '#077A84' }} onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Submit request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
