import React, { useState, useEffect } from 'react';
import { staffFetch } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/lib/notify';
import { formatMoney, formatDate } from '@/lib/format';
import { Loader2, Plus } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', approved_by_hod: 'Awaiting HR', approved: 'Approved', disbursed: 'Paid out',
  repaying: 'Repaying', repaid: 'Repaid', cancelled: 'Cancelled',
};
const STATUS_COLOR: Record<string, string> = {
  pending: '#B45309', approved_by_hod: '#1D4ED8', approved: '#16A34A', disbursed: '#16A34A',
  repaying: '#B45309', repaid: '#16A34A', cancelled: '#6B7280',
};

export default function StaffAdvances() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: '', reason: '', repayment_months: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await staffFetch('/api/employee-portal/advances');
      if (res.ok) setRequests(await res.json());
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    const amount = parseFloat(form.amount);
    if (!(amount > 0)) { toast.error('Enter a valid amount.'); return; }
    setSubmitting(true);
    try {
      const res = await staffFetch('/api/employee-portal/advances', {
        method: 'POST',
        body: JSON.stringify({ amount, reason: form.reason, repayment_months: form.repayment_months ? parseInt(form.repayment_months, 10) : undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Advance request submitted.');
        setShowForm(false);
        setForm({ amount: '', reason: '', repayment_months: '' });
        load();
      } else {
        toast.error(data.error || 'Could not submit request.');
      }
    } finally { setSubmitting(false); }
  };

  const cancel = async (id: string) => {
    const res = await staffFetch(`/api/employee-portal/advances/${id}/cancel`, { method: 'POST' });
    if (res.ok) { toast.success('Request cancelled.'); load(); } else { toast.error('Could not cancel request.'); }
  };

  return (
    <div className="px-4 py-5 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold" style={{ color: '#14363C' }}>Salary Advances</h1>
        <Button size="sm" className="h-10" style={{ backgroundColor: '#077A84' }} onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-1" /> Request
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No salary advance requests yet.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{r.advance_number}</p>
                <span className="text-xs font-medium" style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status] || r.status}</span>
              </div>
              <p className="text-base font-mono font-semibold">{formatMoney(r.amount, r.currency)}</p>
              {['disbursed', 'repaying', 'repaid'].includes(r.status) && (
                <p className="text-xs text-muted-foreground">Balance remaining: {formatMoney(r.balance_remaining, r.currency)}</p>
              )}
              <p className="text-xs text-muted-foreground">Requested {formatDate(r.request_date)}</p>
              {['pending', 'approved_by_hod', 'approved'].includes(r.status) && (
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => cancel(r.id)}>Cancel</button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request a salary advance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount</Label><Input type="number" inputMode="decimal" className="h-11 text-mobile-base" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
            <div><Label>Repayment period (months)</Label><Input type="number" inputMode="numeric" className="h-11 text-mobile-base" value={form.repayment_months} onChange={(e) => setForm((f) => ({ ...f, repayment_months: e.target.value }))} /></div>
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
