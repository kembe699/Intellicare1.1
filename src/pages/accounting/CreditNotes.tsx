import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileMinus, Loader2, Plus, RefreshCw, Send } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, AdvancedDataTable } from '@/components/common';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate, formatMoney } from '@/lib/format';
import { toast } from '@/lib/notify';

interface CreditNote {
  id: string; credit_note_number: string; credit_date: string; patient_name: string;
  original_bill_number: string | null; original_bill_id: string; credit_amount: string | number;
  credit_currency: string; reason: string; reason_details: string | null; status: 'created' | 'approved' | 'applied';
}
interface OpenBill { id: string; bill_number: string; patient_name: string; balance_amount: string | number; status: string; bill_currency?: string }

const STATUS_MAP = { created: 'warning', approved: 'info', applied: 'success' } as const;
const STATUS_LABEL = { created: 'Awaiting approval', approved: 'Approved', applied: 'Applied' } as const;
const REASONS = [
  { value: 'adjustment', label: 'Price adjustment' },
  { value: 'service_not_rendered', label: 'Service not rendered' },
  { value: 'billing_error', label: 'Billing error' },
  { value: 'goodwill', label: 'Goodwill' },
];

export default function CreditNotes() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<{ kind: 'approve' | 'apply'; note: CreditNote } | null>(null);
  const [creating, setCreating] = useState(false);
  const [bills, setBills] = useState<OpenBill[]>([]);
  const [form, setForm] = useState({ billId: '', amount: '', reason: 'adjustment', details: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/billing/credit-notes?clinic_id=${clinicId}`);
      if (!res.ok) throw new Error('Could not load credit notes');
      setNotes(await res.json());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);

  const openCreate = async () => {
    setForm({ billId: '', amount: '', reason: 'adjustment', details: '' });
    setCreating(true);
    try {
      const res = await authFetch(`/api/patient-bills/clinic/${clinicId}`);
      const all: OpenBill[] = res.ok ? await res.json() : [];
      setBills(all.filter((b) => parseFloat(String(b.balance_amount)) > 0 && b.status !== 'cancelled'));
    } catch { setBills([]); }
  };

  const selectedBill = useMemo(() => bills.find((b) => b.id === form.billId), [bills, form.billId]);
  const owed = selectedBill ? parseFloat(String(selectedBill.balance_amount)) || 0 : 0;
  const amountNum = parseFloat(form.amount) || 0;
  const amountError = selectedBill && amountNum > owed + 0.01 ? `More than the ${formatMoney(owed, selectedBill.bill_currency)} still owed on this bill` : '';

  const create = async () => {
    if (!selectedBill || !(amountNum > 0) || amountError) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/billing/credit-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original_bill_id: selectedBill.id, credit_amount: amountNum, credit_currency: selectedBill.bill_currency, reason: form.reason, reason_details: form.details }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not create the credit note');
      toast.success(`Credit note ${body.credit_note_number} created — it needs approval before it is applied`);
      setCreating(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const decide = async () => {
    if (!action) return;
    const { kind, note } = action;
    const res = await authFetch(`/api/billing/credit-notes/${note.id}/${kind}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error || `Could not ${kind} this credit note`);
      throw new Error(body.error || 'failed');
    }
    toast.success(kind === 'approve' ? `${note.credit_note_number} approved` : `${note.credit_note_number} applied — the bill now owes ${formatMoney(note.credit_amount, note.credit_currency)} less`);
    setAction(null);
    load();
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader
            icon={<FileMinus />}
            title="Credit Notes"
            subtitle="Reduce what a patient owes on a bill — created, approved by a second person, then applied"
            actions={
              <div className="flex gap-2">
                <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
                <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />New credit note</Button>
              </div>
            }
          />
            <AdvancedDataTable<CreditNote>
              title="Credit notes"
              countLabel={['credit note', 'credit notes']}
              data={notes}
              loading={loading}
              keyExtractor={(n) => n.id}
              searchable
              searchPlaceholder="Search number, patient or bill..."
              pagination={{ enabled: true, pageSize: 20 }}
              columns={[
                { key: 'credit_note_number', header: 'Credit note', sortable: true, render: (v) => <span className="font-mono text-sm whitespace-nowrap">{v}</span> },
                { key: 'credit_date', header: 'Date', sortable: true, render: (v) => <span className="whitespace-nowrap">{formatDate(v)}</span> },
                { key: 'patient_name', header: 'Patient', sortable: true },
                { key: 'original_bill_number', header: 'Bill', render: (v) => <span className="font-mono text-sm whitespace-nowrap">{v || '—'}</span> },
                { key: 'credit_amount', header: 'Amount', align: 'right', sortable: true, render: (v, n) => <span className="font-mono tabular-nums whitespace-nowrap">{formatMoney(v, n.credit_currency)}</span> },
                { key: 'reason', header: 'Reason', render: (v, n) => <span className="text-sm">{REASONS.find((r) => r.value === v)?.label || v}{n.reason_details ? <span className="text-muted-foreground"> — {n.reason_details}</span> : null}</span> },
                { key: 'status', header: 'Status', render: (v: CreditNote['status']) => <StatusBadge status={v} map={STATUS_MAP} label={STATUS_LABEL[v] || v} /> },
                {
                  key: 'actions', header: '', align: 'right',
                  render: (_: unknown, n: CreditNote) => n.status === 'created'
                    ? <Button variant="outline" onClick={(e) => { e.stopPropagation(); setAction({ kind: 'approve', note: n }); }}><CheckCircle2 className="w-4 h-4 mr-1.5" />Approve</Button>
                    : n.status === 'approved'
                      ? <Button onClick={(e) => { e.stopPropagation(); setAction({ kind: 'apply', note: n }); }}><Send className="w-4 h-4 mr-1.5" />Apply to bill</Button>
                      : null,
                },
              ]}
              empty={{ icon: FileMinus, title: 'No credit notes yet', message: 'Create one to reduce what a patient owes on a bill.', action: { label: 'New credit note', onClick: openCreate } }}
            />
        </div>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New credit note</DialogTitle>
            <DialogDescription>The bill's total and balance go down when the note is applied. Cash collected is not changed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Bill</Label>
              <Combobox
                options={bills.map((b) => ({ value: b.id, label: `${b.bill_number} — ${b.patient_name} (owes ${formatMoney(b.balance_amount, b.bill_currency)})` }))}
                value={form.billId}
                onChange={(v) => setForm({ ...form, billId: v })}
                placeholder="Select a bill with a balance"
                searchPlaceholder="Search bill number or patient..."
                emptyText="No bills with an outstanding balance"
              />
            </div>
            <div>
              <Label>Amount{selectedBill?.bill_currency ? ` (${selectedBill.bill_currency})` : ''}</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
              {amountError && <p className="text-sm text-destructive mt-1">{amountError}</p>}
            </div>
            <div>
              <Label>Reason</Label>
              <Combobox options={REASONS} value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} placeholder="Reason" />
            </div>
            <div>
              <Label>Details</Label>
              <Textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="What happened" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={create} disabled={saving || !selectedBill || !(amountNum > 0) || !!amountError}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Create credit note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.kind === 'approve' ? `Approve ${action.note.credit_note_number}?` : `Apply ${action?.note.credit_note_number}?`}
        description={action ? (action.kind === 'approve'
          ? `${formatMoney(action.note.credit_amount, action.note.credit_currency)} off ${action.note.original_bill_number || 'the bill'} for ${action.note.patient_name}. It still has to be applied afterwards.`
          : `${action.note.original_bill_number || 'The bill'} will owe ${formatMoney(action.note.credit_amount, action.note.credit_currency)} less and the revenue it posted is reversed by the same amount.`) : ''}
        confirmLabel={action?.kind === 'approve' ? 'Approve' : 'Apply to bill'}
        icon={action?.kind === 'approve' ? CheckCircle2 : Send}
        onConfirm={decide}
      />
    </AppLayout>
  );
}
