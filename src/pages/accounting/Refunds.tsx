import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Pill, RefreshCw, RotateCcw, Wallet, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, AdvancedDataTable } from '@/components/common';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { toast } from '@/lib/notify';

interface PendingReceipt {
  id: string;
  receipt_number: string;
  patient_name: string;
  patient_ref?: string | null;
  payment_amount: string | number;
  receipt_currency?: string | null;
  payment_method: string;
  cashier_name?: string | null;
  status: 'pending_void' | 'pending_refund';
  notes?: string | null;
  updated_at: string;
}

const REQUEST_MAP = { pending_void: 'warning', pending_refund: 'info' } as const;
const REQUEST_LABEL: Record<PendingReceipt['status'], string> = { pending_void: 'Void', pending_refund: 'Refund' };

export function ReceiptApprovals() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const [rows, setRows] = useState<PendingReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<{ kind: 'approve' | 'reject'; receipt: PendingReceipt } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/receipts/clinic/${clinicId}?status=pending_void,pending_refund`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load pending requests');
      setRows(await res.json());
    } catch (e: any) {
      toast.error(e.message || 'Could not load pending requests');
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => { load(); }, [load]);

  const decide = async (reason: string) => {
    if (!action) return;
    const { kind, receipt } = action;
    const res = await authFetch(`/api/receipts/${receipt.id}/${kind === 'approve' ? 'approve-void' : 'reject-void'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error || `Could not ${kind} this request`);
      throw new Error(body.error || 'failed');
    }
    toast.success(kind === 'approve'
      ? `Receipt ${receipt.receipt_number} ${receipt.status === 'pending_void' ? 'voided' : 'refunded'}`
      : `Request on ${receipt.receipt_number} rejected — receipt is active again`);
    setAction(null);
    load();
  };

  const columns = [
    { key: 'receipt_number', header: 'Receipt', sortable: true, render: (v: string) => <span className="font-mono text-sm whitespace-nowrap">{v}</span> },
    { key: 'updated_at', header: 'Requested', sortable: true, render: (v: string) => formatDateTime(v) },
    {
      key: 'patient_name', header: 'Patient', sortable: true,
      render: (v: string, r: PendingReceipt) => (
        <div>
          <div className="font-medium">{v}</div>
          {r.patient_ref && <div className="text-xs text-muted-foreground font-mono">{r.patient_ref}</div>}
        </div>
      ),
    },
    {
      key: 'payment_amount', header: 'Amount', align: 'right' as const, sortable: true,
      render: (v: string, r: PendingReceipt) => <span className="font-mono tabular-nums whitespace-nowrap">{formatMoney(v, r.receipt_currency || undefined)}</span>,
    },
    { key: 'status', header: 'Request', render: (v: PendingReceipt['status']) => <StatusBadge status={v} map={REQUEST_MAP} label={REQUEST_LABEL[v]} /> },
    { key: 'cashier_name', header: 'Cashier', render: (v: string) => v || '—' },
    { key: 'notes', header: 'Reason given', render: (v: string) => <span className="text-sm text-muted-foreground">{v || '—'}</span> },
    {
      key: 'actions', header: '', align: 'right' as const,
      render: (_: unknown, r: PendingReceipt) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={(e) => { e.stopPropagation(); setAction({ kind: 'reject', receipt: r }); }}>
            <XCircle className="w-4 h-4 mr-1.5" />Reject
          </Button>
          <Button onClick={(e) => { e.stopPropagation(); setAction({ kind: 'approve', receipt: r }); }}>
            <CheckCircle2 className="w-4 h-4 mr-1.5" />Approve
          </Button>
        </div>
      ),
    },
  ];

  const verb = action?.receipt.status === 'pending_void' ? 'void' : 'refund';

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          Voids and refunds requested by a cashier wait here for a second person. Approving reverses the payment in the ledger at its original rate.
        </p>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>
      <AdvancedDataTable
        data={rows}
        columns={columns}
        loading={loading}
        keyExtractor={(r) => r.id}
        searchable
        searchPlaceholder="Search receipt or patient..."
        pagination={{ enabled: true, pageSize: 20 }}
        empty={{ icon: CheckCircle2, title: 'No requests waiting', message: 'Void and refund requests from cashiers will appear here for approval.' }}
      />
      <ConfirmDialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.kind === 'approve' ? `Approve this ${verb}?` : `Reject this ${verb} request?`}
        description={action ? (action.kind === 'approve'
          ? `Receipt ${action.receipt.receipt_number} for ${formatMoney(action.receipt.payment_amount, action.receipt.receipt_currency || undefined)} will be ${verb === 'void' ? 'voided' : 'refunded'} and the payment reversed in the ledger. This cannot be undone.`
          : `Receipt ${action.receipt.receipt_number} goes back to active. Nothing is reversed.`) : ''}
        confirmLabel={action?.kind === 'approve' ? `Approve ${verb}` : 'Reject request'}
        tone={action?.kind === 'approve' ? 'danger' : 'default'}
        reason={action?.kind === 'reject' ? { label: 'Reason for rejecting', placeholder: 'e.g. Payment was correct' } : undefined}
        icon={action?.kind === 'approve' ? RotateCcw : XCircle}
        onConfirm={decide}
      />
    </>
  );
}

interface DepositBalance { patient_id: string; patient_name: string | null; patient_ref: string | null; currency: string; balance: number; updated_at: string }

function DepositRefunds() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const [rows, setRows] = useState<DepositBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<DepositBalance | null>(null);
  const [form, setForm] = useState({ amount: '', method: 'cash', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/patient-deposits/balances?clinic_id=${clinicId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load deposits');
      setRows(await res.json());
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);

  const amount = parseFloat(form.amount) || 0;
  const tooMuch = target ? amount > target.balance + 0.01 : false;

  const refund = async () => {
    if (!target || !(amount > 0) || tooMuch) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/patient-deposits/${target.patient_id}/refund`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, payment_method: form.method, notes: form.notes, currency: target.currency, clinic_id: clinicId, patient_name: target.patient_name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Refund failed');
      toast.success(`Refunded ${formatMoney(amount, target.currency)} to ${target.patient_name || 'the patient'}`);
      setTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">Patients holding an unused deposit. Refunding needs deposit-refund approval rights and an open cashier shift.</p>
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>
      <AdvancedDataTable<DepositBalance>
        data={rows}
        loading={loading}
        keyExtractor={(r) => `${r.patient_id}-${r.currency}`}
        searchable
        searchPlaceholder="Search patient..."
        columns={[
          { key: 'patient_name', header: 'Patient', sortable: true, render: (v, r) => <div><div className="font-medium">{v || '—'}</div>{r.patient_ref && <div className="text-xs text-muted-foreground font-mono">{r.patient_ref}</div>}</div> },
          { key: 'balance', header: 'Deposit held', align: 'right', sortable: true, render: (v, r) => <span className="font-mono tabular-nums font-semibold whitespace-nowrap">{formatMoney(v, r.currency)}</span> },
          { key: 'updated_at', header: 'Last movement', render: (v) => <span className="whitespace-nowrap">{formatDate(v)}</span> },
          { key: 'actions', header: '', align: 'right', render: (_v, r) => <Button onClick={() => { setTarget(r); setForm({ amount: String(r.balance), method: 'cash', notes: '' }); }}><Wallet className="w-4 h-4 mr-1.5" />Refund</Button> },
        ]}
        empty={{ icon: Wallet, title: 'No deposits held', message: 'Patients with an unused deposit balance appear here.' }}
      />
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Refund deposit</DialogTitle>
            <DialogDescription>{target ? `${target.patient_name || 'This patient'} holds ${formatMoney(target.balance, target.currency)}. The refund is paid from the drawer of your open cashier shift.` : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount ({target?.currency})</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              {tooMuch && <p className="text-sm text-destructive mt-1">More than the deposit held</p>}
            </div>
            <div>
              <Label>Paid by</Label>
              <Combobox options={[{ value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'card', label: 'Card' }]} value={form.method} onChange={(v) => setForm({ ...form, method: v })} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why the deposit is being returned" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={refund} disabled={saving || !(amount > 0) || tooMuch}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Refund {amount > 0 && target ? formatMoney(amount, target.currency) : ''}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface PharmacyReturn { id: string; return_number: string; return_date: string; drug_name: string | null; patient_name: string | null; quantity_returned: number; amount_refunded: string | number | null; refund_method: string | null; processed_by_name: string | null; return_reason: string | null }

function PharmacyRefunds() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const [rows, setRows] = useState<PharmacyReturn[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`/api/pharmacy-module/returns?clinic_id=${clinicId}`);
        setRows(res.ok ? await res.json() : []);
      } catch { setRows([]); } finally { setLoading(false); }
    })();
  }, [clinicId]);
  return (
    <>
      <p className="text-sm text-muted-foreground mb-3">
        Cash refunds paid when a pharmacist records a return (stock back on the shelf, revenue reversed). Returns are recorded in <Link to="/pharmacy-returns" className="text-primary hover:underline">Pharmacy › Returns</Link>.
      </p>
      <AdvancedDataTable<PharmacyReturn>
        data={rows}
        loading={loading}
        keyExtractor={(r) => r.id}
        searchable
        searchPlaceholder="Search return, drug or patient..."
        pagination={{ enabled: true, pageSize: 20 }}
        columns={[
          { key: 'return_number', header: 'Return', render: (v) => <span className="font-mono text-sm whitespace-nowrap">{v}</span> },
          { key: 'return_date', header: 'Date', sortable: true, render: (v) => <span className="whitespace-nowrap">{formatDate(v)}</span> },
          { key: 'patient_name', header: 'Patient', render: (v) => v || '—' },
          { key: 'drug_name', header: 'Item', render: (v, r) => `${v || '—'} × ${r.quantity_returned}` },
          { key: 'return_reason', header: 'Reason', render: (v) => v || '—' },
          { key: 'amount_refunded', header: 'Refunded', align: 'right', render: (v) => <span className="font-mono tabular-nums whitespace-nowrap">{formatMoney(v || 0)}</span> },
          { key: 'processed_by_name', header: 'By', render: (v) => v || '—' },
        ]}
        empty={{ icon: Pill, title: 'No pharmacy refunds', message: 'Refunds from returned items appear here.' }}
      />
    </>
  );
}

export default function Refunds() {
  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader icon={<RotateCcw />} title="Refunds" subtitle="Approve receipt voids and refunds, refund deposits, and see pharmacy return refunds" />
          <Tabs defaultValue="receipts">
            <TabsList>
              <TabsTrigger value="receipts" className="gap-2"><RotateCcw className="w-4 h-4" />Receipt voids &amp; refunds</TabsTrigger>
              <TabsTrigger value="deposits" className="gap-2"><Wallet className="w-4 h-4" />Deposit refunds</TabsTrigger>
              <TabsTrigger value="pharmacy" className="gap-2"><Pill className="w-4 h-4" />Pharmacy refunds</TabsTrigger>
            </TabsList>
            <TabsContent value="receipts" className="mt-4"><div className="bg-card rounded-lg border shadow-sm p-4"><ReceiptApprovals /></div></TabsContent>
            <TabsContent value="deposits" className="mt-4"><div className="bg-card rounded-lg border shadow-sm p-4"><DepositRefunds /></div></TabsContent>
            <TabsContent value="pharmacy" className="mt-4"><div className="bg-card rounded-lg border shadow-sm p-4"><PharmacyRefunds /></div></TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
