import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, AdvancedDataTable } from '@/components/common';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime, formatMoney } from '@/lib/format';
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
    { key: 'receipt_number', header: 'Receipt', sortable: true, render: (v: string) => <span className="font-mono text-sm">{v}</span> },
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
      render: (v: string, r: PendingReceipt) => <span className="font-mono tabular-nums">{formatMoney(v, r.receipt_currency || undefined)}</span>,
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

export default function Refunds() {
  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader icon={<RotateCcw />} title="Refunds" subtitle="Approve receipt voids and refunds" />
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <ReceiptApprovals />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
