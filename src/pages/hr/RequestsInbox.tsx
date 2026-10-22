import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { formatDate, formatMoney } from '@/lib/format';
import { ClipboardCheck, Loader2 } from 'lucide-react';

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  pending: 'warning', approved_by_hod: 'info', approved: 'success', rejected: 'danger',
  cancelled: 'neutral', disbursed: 'success', repaying: 'warning', repaid: 'success',
};

function RejectDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject request</DialogTitle>
          <DialogDescription>A reason is required and will be shown to the employee.</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button variant="destructive" disabled={saving || !reason.trim()} onClick={async () => {
            setSaving(true);
            try { await onConfirm(reason); setReason(''); } finally { setSaving(false); }
          }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Reject
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LeaveTab() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [rejectTarget, setRejectTarget] = useState<any>(null);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const url = statusFilter === 'all' ? '/api/hr/leave/requests' : `/api/hr/leave/requests?status=${statusFilter}`;
      const res = await authFetch(url);
      if (res.ok) setRows(await res.json());
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchRows(); }, [statusFilter]);

  const approveHod = async (r: any) => {
    if (!(await confirm({ title: 'Approve as HOD?', description: `Approve ${r.first_name} ${r.last_name}'s leave request? It will then go to HR for final approval.` }))) return;
    const res = await authFetch(`/api/hr/leave/requests/${r.id}/approve-hod`, { method: 'POST' });
    if (res.ok) { toast.success('Approved. Awaiting HR.'); fetchRows(); } else { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed to approve.'); }
  };
  const approveHr = async (r: any) => {
    if (!(await confirm({ title: 'Approve leave request?', description: `Give final approval for ${r.first_name} ${r.last_name}'s leave?` }))) return;
    const res = await authFetch(`/api/hr/leave/requests/${r.id}/approve`, { method: 'POST' });
    if (res.ok) { toast.success('Leave approved.'); fetchRows(); } else { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed to approve.'); }
  };
  const reject = async (reason: string, r: any, viaHod: boolean) => {
    const res = await authFetch(`/api/hr/leave/requests/${r.id}/${viaHod ? 'reject-hod' : 'reject'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    if (res.ok) { toast.success('Request rejected.'); setRejectTarget(null); fetchRows(); } else { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed to reject.'); }
  };

  return (
    <div className="space-y-4">
      {confirmDialog}
      <RejectDialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)} onConfirm={(reason) => reject(reason, rejectTarget, rejectTarget.status === 'pending')} />
      <div className="flex gap-2">
        {['pending', 'approved_by_hod', 'approved', 'rejected', 'cancelled', 'all'].map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? 'default' : 'outline'} onClick={() => setStatusFilter(s)}>{s.replace(/_/g, ' ')}</Button>
        ))}
      </div>
      <AdvancedDataTable
        data={rows}
        loading={loading}
        searchable
        columns={[
          { key: 'employee_number', header: 'Employee #' },
          { key: 'first_name', header: 'Name', render: (_v, r) => `${r.first_name} ${r.last_name}` },
          { key: 'leave_type_name', header: 'Type' },
          { key: 'start_date', header: 'From', render: (v) => formatDate(v) },
          { key: 'end_date', header: 'To', render: (v) => formatDate(v) },
          { key: 'days', header: 'Days', align: 'right' },
          { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} map={STATUS_TONE} label={v.replace(/_/g, ' ')} /> },
          {
            key: 'actions', header: '', render: (_v, r) => (
              <div className="flex gap-1 justify-end">
                {r.status === 'pending' && <Button size="sm" variant="outline" onClick={() => approveHod(r)}>Approve (HOD)</Button>}
                {r.status === 'approved_by_hod' && <Button size="sm" variant="outline" onClick={() => approveHr(r)}>Approve (HR)</Button>}
                {['pending', 'approved_by_hod'].includes(r.status) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRejectTarget(r)}>Reject</Button>}
              </div>
            ),
          },
        ]}
        keyExtractor={(r) => r.id}
        emptyMessage="No leave requests in this view."
      />
    </div>
  );
}

function AdvancesTab() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [rejectTarget, setRejectTarget] = useState<any>(null);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const url = statusFilter === 'all' ? '/api/hr/salary-advances' : `/api/hr/salary-advances?status=${statusFilter}`;
      const res = await authFetch(url);
      if (res.ok) setRows(await res.json());
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchRows(); }, [statusFilter]);

  const approveHod = async (r: any) => {
    if (!(await confirm({ title: 'Approve as HOD?', description: `Approve ${r.first_name} ${r.last_name}'s advance request? It will then go to HR.` }))) return;
    const res = await authFetch(`/api/hr/salary-advances/${r.id}/approve-hod`, { method: 'POST' });
    if (res.ok) { toast.success('Approved. Awaiting HR.'); fetchRows(); } else { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed to approve.'); }
  };
  const approveHr = async (r: any) => {
    if (!(await confirm({ title: 'Approve advance?', description: `Give final approval for ${r.first_name} ${r.last_name}'s advance of ${formatMoney(r.amount, r.currency)}?` }))) return;
    const res = await authFetch(`/api/hr/salary-advances/${r.id}/approve`, { method: 'POST' });
    if (res.ok) { toast.success('Advance approved.'); fetchRows(); } else { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed to approve.'); }
  };
  const reject = async (reason: string, r: any, viaHod: boolean) => {
    const res = await authFetch(`/api/hr/salary-advances/${r.id}/${viaHod ? 'reject-hod' : 'cancel'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    if (res.ok) { toast.success('Request rejected.'); setRejectTarget(null); fetchRows(); } else { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed to reject.'); }
  };

  return (
    <div className="space-y-4">
      {confirmDialog}
      <RejectDialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)} onConfirm={(reason) => reject(reason, rejectTarget, rejectTarget.status === 'pending')} />
      <div className="flex gap-2">
        {['pending', 'approved_by_hod', 'approved', 'disbursed', 'repaying', 'repaid', 'cancelled', 'all'].map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? 'default' : 'outline'} onClick={() => setStatusFilter(s)}>{s.replace(/_/g, ' ')}</Button>
        ))}
      </div>
      <AdvancedDataTable
        data={rows}
        loading={loading}
        searchable
        columns={[
          { key: 'advance_number', header: 'Advance #' },
          { key: 'employee_number', header: 'Employee #' },
          { key: 'first_name', header: 'Name', render: (_v, r) => `${r.first_name} ${r.last_name}` },
          { key: 'amount', header: 'Amount', align: 'right', render: (v, r) => formatMoney(v, r.currency) },
          { key: 'balance_remaining', header: 'Balance', align: 'right', render: (v, r) => formatMoney(v, r.currency) },
          { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} map={STATUS_TONE} label={v.replace(/_/g, ' ')} /> },
          {
            key: 'actions', header: '', render: (_v, r) => (
              <div className="flex gap-1 justify-end">
                {r.status === 'pending' && <Button size="sm" variant="outline" onClick={() => approveHod(r)}>Approve (HOD)</Button>}
                {r.status === 'approved_by_hod' && <Button size="sm" variant="outline" onClick={() => approveHr(r)}>Approve (HR)</Button>}
                {['pending', 'approved_by_hod'].includes(r.status) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRejectTarget(r)}>Reject</Button>}
              </div>
            ),
          },
        ]}
        keyExtractor={(r) => r.id}
        emptyMessage="No salary advance requests in this view."
      />
    </div>
  );
}

export default function RequestsInbox() {
  return (
    <AppLayout>
      <PageHeader title="Requests" subtitle="Leave and salary advance requests awaiting action" icon={<ClipboardCheck />} />
      <Tabs defaultValue="leave">
        <TabsList>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="advances">Salary Advances</TabsTrigger>
        </TabsList>
        <TabsContent value="leave"><LeaveTab /></TabsContent>
        <TabsContent value="advances"><AdvancesTab /></TabsContent>
      </Tabs>
    </AppLayout>
  );
}
