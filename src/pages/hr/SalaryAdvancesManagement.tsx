import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Wallet, Plus, Loader2, Check, HandCoins } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface Advance {
  id: string; advance_number: string; employee_id: string; first_name: string; last_name: string; employee_number: string;
  amount: number; currency: string; reason?: string; request_date: string; status: string; balance_remaining: number;
}

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  pending: 'warning', approved: 'info', disbursed: 'primary', repaying: 'primary', repaid: 'success', cancelled: 'neutral',
};

const today = () => new Date().toISOString().split('T')[0];

export default function SalaryAdvancesManagement() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const navigate = useNavigate();

  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [employees, setEmployees] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ employee_id: '', amount: '', currency: 'USD', reason: '', request_date: today() });

  const [actionAdvance, setActionAdvance] = useState<Advance | null>(null);
  const [actionType, setActionType] = useState<'disburse' | 'repay' | null>(null);
  const [actionForm, setActionForm] = useState({ amount: '', payment_account_id: '', account_name: '', date: today(), notes: '' });
  const [submittingAction, setSubmittingAction] = useState(false);

  const fetchAdvances = async () => {
    setLoading(true);
    try {
      const url = statusFilter === 'all' ? '/api/hr/salary-advances' : `/api/hr/salary-advances?status=${statusFilter}`;
      const res = await authFetch(url);
      if (res.ok) setAdvances(await res.json());
      else toast.error('Failed to load salary advances');
    } catch (e) {
      toast.error('Failed to load salary advances');
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const res = await authFetch('/api/hr/employees?status=active');
      if (res.ok) setEmployees(await res.json());
    } catch (e) { /* non-blocking */ }
  };

  const fetchAccounts = async () => {
    try {
      const res = await authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) { setAccounts(data); return; }
      }
      const r2 = await authFetch('/api/ledger-accounts');
      if (r2.ok) setAccounts(await r2.json());
    } catch (e) { /* non-blocking */ }
  };

  useEffect(() => { fetchEmployees(); fetchAccounts(); }, []);
  useEffect(() => { fetchAdvances(); }, [statusFilter]);

  const handleCreate = async () => {
    if (creating) return;
    if (!createForm.employee_id) { toast.error('Select an employee'); return; }
    const amt = parseFloat(createForm.amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setCreating(true);
    try {
      const res = await authFetch('/api/hr/salary-advances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...createForm, amount: amt }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success(`Advance ${created.advance_number} requested`);
        setShowCreate(false);
        setCreateForm({ employee_id: '', amount: '', currency: 'USD', reason: '', request_date: today() });
        fetchAdvances();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to request advance');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setCreating(false);
    }
  };

  const handleApprove = async (a: Advance) => {
    try {
      const res = await authFetch(`/api/hr/salary-advances/${a.id}/approve`, { method: 'POST' });
      if (res.ok) { toast.success('Advance approved'); fetchAdvances(); }
      else toast.error('Failed to approve');
    } catch (e) { toast.error('Failed to approve'); }
  };

  const handleCancel = async (a: Advance) => {
    if (!confirm(`Cancel advance ${a.advance_number}?`)) return;
    try {
      const res = await authFetch(`/api/hr/salary-advances/${a.id}/cancel`, { method: 'POST' });
      if (res.ok) { toast.success('Advance cancelled'); fetchAdvances(); }
      else toast.error('Failed to cancel');
    } catch (e) { toast.error('Failed to cancel'); }
  };

  const openAction = (a: Advance, type: 'disburse' | 'repay') => {
    setActionAdvance(a);
    setActionType(type);
    setActionForm({ amount: type === 'repay' ? String(a.balance_remaining) : String(a.amount), payment_account_id: '', account_name: '', date: today(), notes: '' });
  };

  const handleSubmitAction = async () => {
    if (!actionAdvance || !actionType || submittingAction) return;
    if (!actionForm.payment_account_id) { toast.error('Select an account'); return; }
    setSubmittingAction(true);
    try {
      const url = actionType === 'disburse'
        ? `/api/hr/salary-advances/${actionAdvance.id}/disburse`
        : `/api/hr/salary-advances/${actionAdvance.id}/repay`;
      const body = actionType === 'disburse'
        ? { payment_account_id: actionForm.payment_account_id, account_name: actionForm.account_name, disbursement_date: actionForm.date }
        : { amount: parseFloat(actionForm.amount), payment_account_id: actionForm.payment_account_id, account_name: actionForm.account_name, payment_date: actionForm.date, notes: actionForm.notes };
      const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed'); return; }
      toast.success(actionType === 'disburse' ? 'Advance disbursed' : 'Repayment recorded');
      setActionAdvance(null);
      setActionType(null);
      fetchAdvances();
    } catch (e) {
      toast.error('Network error');
    } finally {
      setSubmittingAction(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<HandCoins />}
          title="Salary Advances"
          subtitle="Cash advances against future salary — request, approve, disburse, and track repayment"
          actions={<Button size="sm" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-2" /> Request Advance</Button>}
        />

        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
            <h3 className="font-medium">Advances</h3>
            <Combobox
              options={[{ value: 'all', label: 'All Status' }, { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'disbursed', label: 'Disbursed' }, { value: 'repaying', label: 'Repaying' }, { value: 'repaid', label: 'Repaid' }, { value: 'cancelled', label: 'Cancelled' }]}
              value={statusFilter} onChange={setStatusFilter} searchPlaceholder="Search..." className="w-[160px] h-9"
            />
          </div>
          <div className="p-4">
            <AdvancedDataTable<Advance>
              data={advances}
              keyExtractor={(a) => a.id}
              loading={loading}
              emptyMessage="No salary advances yet."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'advance_number', header: 'Advance No.', render: (v) => <span className="font-mono text-xs">{v}</span> },
                { key: 'first_name', header: 'Employee', render: (_v, a) => <span className="font-medium">{a.first_name} {a.last_name}</span> },
                { key: 'request_date', header: 'Date', render: (v) => new Date(v).toLocaleDateString() },
                { key: 'amount', header: 'Amount', align: 'right', render: (v, a) => <span className="font-mono">{a.currency} {parseFloat(String(v)).toFixed(2)}</span> },
                { key: 'balance_remaining', header: 'Balance', align: 'right', render: (v, a) => <span className="font-mono text-amber-700">{a.currency} {parseFloat(String(v)).toFixed(2)}</span> },
                { key: 'status', header: 'Status', align: 'center', render: (v) => <StatusBadge status={v} label={v} map={STATUS_TONE} /> },
                {
                  key: '__actions', header: 'Actions', align: 'center',
                  render: (_v, a) => (
                    <div className="flex items-center justify-center gap-1">
                      {a.status === 'pending' && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleApprove(a)}>Approve</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handleCancel(a)}>Cancel</Button>
                        </>
                      )}
                      {a.status === 'approved' && (
                        <>
                          <Button size="sm" className="h-7 text-xs" onClick={() => openAction(a, 'disburse')}>Disburse</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handleCancel(a)}>Cancel</Button>
                        </>
                      )}
                      {(a.status === 'disbursed' || a.status === 'repaying') && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openAction(a, 'repay')}>Record Repayment</Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate(`/hr/employees/${a.employee_id}`)}>View Employee</Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Salary Advance</DialogTitle>
            <DialogDescription>Creates a pending request — approve and disburse it once ready.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-6 pt-2">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Employee</Label>
              <Combobox
                options={employees.map((e: any) => ({ value: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})` }))}
                value={createForm.employee_id} onChange={v => setCreateForm({ ...createForm, employee_id: v })}
                placeholder="Select employee..." searchPlaceholder="Search employees..." className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Amount</Label>
                <Input type="number" step="0.01" min="0.01" className="mt-1" value={createForm.amount} onChange={e => setCreateForm({ ...createForm, amount: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Currency</Label>
                <Combobox options={[{ value: 'USD', label: 'USD' }, { value: 'SSP', label: 'SSP' }]} value={createForm.currency} onChange={v => setCreateForm({ ...createForm, currency: v })} searchPlaceholder="Search..." className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Date</Label>
              <Input type="date" className="mt-1" value={createForm.request_date} onChange={e => setCreateForm({ ...createForm, request_date: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Reason</Label>
              <Textarea className="mt-1" rows={2} value={createForm.reason} onChange={e => setCreateForm({ ...createForm, reason: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Submit Request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionAdvance} onOpenChange={(o) => { if (!o) { setActionAdvance(null); setActionType(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionType === 'disburse' ? 'Disburse Advance' : 'Record Repayment'}</DialogTitle>
            <DialogDescription>
              {actionAdvance && `${actionAdvance.advance_number} — ${actionAdvance.first_name} ${actionAdvance.last_name}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-6 pt-2">
            {actionType === 'repay' && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Amount ({actionAdvance?.currency})</Label>
                <Input type="number" step="0.01" min="0.01" className="mt-1" value={actionForm.amount} onChange={e => setActionForm({ ...actionForm, amount: e.target.value })} />
                <p className="text-[11px] text-muted-foreground mt-1">Outstanding balance: {actionAdvance?.currency} {actionAdvance?.balance_remaining.toFixed(2)}</p>
              </div>
            )}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">{actionType === 'disburse' ? 'Pay From Account' : 'Received Into Account'}</Label>
              <Combobox
                options={accounts.map((a: any) => ({ value: String(a.id), label: a.account_name }))}
                value={actionForm.payment_account_id}
                onChange={v => setActionForm({ ...actionForm, payment_account_id: v, account_name: accounts.find((a: any) => String(a.id) === v)?.account_name || '' })}
                placeholder="Select account..." searchPlaceholder="Search accounts..." className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Date</Label>
              <Input type="date" className="mt-1" value={actionForm.date} onChange={e => setActionForm({ ...actionForm, date: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => { setActionAdvance(null); setActionType(null); }}>Cancel</Button>
              <Button size="sm" onClick={handleSubmitAction} disabled={submittingAction}>
                {submittingAction ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {actionType === 'disburse' ? 'Disburse' : 'Record Payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </AppLayout>
  );
}
