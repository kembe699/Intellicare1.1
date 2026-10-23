import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/lib/notify';
import { RefreshCw, Clock, AlertTriangle, CheckCircle2, BarChart3, BadgePercent, PhoneCall, Ban } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge } from '@/components/common';
import { apiFetch, formatCurrency } from '@/utils/accountingApi';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { formatDate } from '@/lib/format';

interface Receivable {
  id: string;
  patient_id: string;
  patient_name?: string;
  invoice_number: string;
  amount: number;
  paid_amount: number;
  balance: number;
  due_date: string;
  status: string;
}

const RECEIVABLE_STATUS_MAP = { paid: 'success', overdue: 'danger', current: 'warning' } as const;
const RECEIVABLE_STATUS_ICON: Record<string, React.ReactNode> = {
  paid: <CheckCircle2 className="w-3 h-3 mr-1" />,
  overdue: <AlertTriangle className="w-3 h-3 mr-1" />,
  current: <Clock className="w-3 h-3 mr-1" />,
};

const EMPTY_DISCOUNT = { discount_type: 'fixed_amount', discount_amount: '', discount_percentage: '', reason: '' };
const EMPTY_FOLLOW_UP = { follow_up_type: 'phone', follow_up_notes: '', outcome: '', next_follow_up_date: '' };

const getItemStatus = (item: Receivable) => {
  if (item.status === 'paid') return 'paid';
  if (new Date(item.due_date) < new Date() && item.balance > 0) return 'overdue';
  return 'current';
};

const getDaysOverdue = (dueDate: string) => {
  const diff = Math.floor((new Date().getTime() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
};

const Receivables: React.FC = () => {
  const { user, hasPrivilege } = useAuth();
  const { currency: baseCurrencyData } = useCurrency();
  const canAdjust = hasPrivilege('billing.write');
  const [loading, setLoading] = useState(false);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');

  // Discount / follow-up / write-off — moved here from the old "Discounts &
  // Write-offs" page, acting on the row's bill.
  const [target, setTarget] = useState<{ bill: Receivable; action: 'discount' | 'follow_up' | 'write_off' } | null>(null);
  const [discountForm, setDiscountForm] = useState(EMPTY_DISCOUNT);
  const [followUpForm, setFollowUpForm] = useState(EMPTY_FOLLOW_UP);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.clinic) loadReceivables();
  }, [user]);

  const loadReceivables = async () => {
    try {
      setLoading(true);
      const response = await apiFetch(`/api/accounting/receivables?clinic_id=${user?.clinic}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) setReceivables(data);
      }
    } catch (error) {
      console.error('Error loading receivables:', error);
      toast.error('Failed to load receivables');
    } finally {
      setLoading(false);
    }
  };

  const filteredReceivables = useMemo(
    () => receivables.filter((item) => statusFilter === 'all' || getItemStatus(item) === statusFilter),
    [receivables, statusFilter],
  );

  const open = (bill: Receivable, action: 'discount' | 'follow_up' | 'write_off') => {
    setDiscountForm(EMPTY_DISCOUNT);
    setFollowUpForm(EMPTY_FOLLOW_UP);
    setWriteOffReason('');
    setTarget({ bill, action });
  };

  const submit = async () => {
    if (!target || saving) return;
    const { bill, action } = target;
    const req = action === 'discount'
      ? { url: `/api/billing/bills/${bill.id}/discounts`, body: { discount_type: discountForm.discount_type, discount_amount: parseFloat(discountForm.discount_amount) || 0, discount_percentage: parseFloat(discountForm.discount_percentage) || 0, reason: discountForm.reason }, ok: 'Discount applied' }
      : action === 'follow_up'
        ? { url: `/api/billing-enhanced/receivables/${bill.id}/follow-up`, body: followUpForm, ok: 'Follow-up recorded' }
        : { url: `/api/billing/bills/${bill.id}/write-off`, body: { reason: writeOffReason }, ok: `${bill.invoice_number} written off` };
    setSaving(true);
    try {
      const res = await authFetch(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That didn’t go through');
      toast.success(req.ok);
      setTarget(null);
      loadReceivables();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const formValid = !target ? false
    : target.action === 'discount' ? parseFloat(discountForm.discount_type === 'percentage' ? discountForm.discount_percentage : discountForm.discount_amount) > 0
      : true;

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-4 w-full flex flex-col">
        <PageHeader
          icon={<BarChart3 />}
          title="Accounts Receivable"
          subtitle="What patients and schemes still owe, by bill — apply a discount, log a follow-up or write off from the row"
          actions={
            <Button onClick={loadReceivables} variant="outline" disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
          }
        />

        <AdvancedDataTable<Receivable>
          title="Bills"
          countLabel={['bill', 'bills']}
          data={filteredReceivables}
          loading={loading}
          keyExtractor={(item) => item.id}
          searchPlaceholder="Search invoice or patient..."
          dateFilterKey="due_date"
          toolbarExtra={
            <Combobox
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'current', label: 'Current' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'paid', label: 'Paid' },
              ]}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v || 'all')}
              searchPlaceholder="Search..."
              className="h-8 w-36 text-sm"
            />
          }
          empty={{ icon: BarChart3, title: receivables.length === 0 ? 'No receivables yet' : 'No bills match these filters', message: receivables.length === 0 ? 'Receivables are created from patient billing.' : undefined }}
          rowClassName={(item) => getItemStatus(item) === 'overdue' ? 'bg-destructive-bg/30 dark:bg-destructive/10' : ''}
          pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
          footerRow={(colSpan) => (
            <tr className="bg-muted/40 font-semibold text-sm">
              <td className="px-4 py-2.5" colSpan={2}>Totals</td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(filteredReceivables.reduce((s, r) => s + Number(r.amount || 0), 0))}</td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-success">{formatCurrency(filteredReceivables.reduce((s, r) => s + Number(r.paid_amount || 0), 0))}</td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(filteredReceivables.reduce((s, r) => s + Number(r.balance || 0), 0))}</td>
              <td colSpan={colSpan - 5} />
            </tr>
          )}
          columns={[
            { key: 'invoice_number', header: 'Invoice #', sortable: true, render: (v) => <span className="font-mono font-medium">{v}</span> },
            { key: 'patient_name', header: 'Patient', render: (v, item) => <p className="font-medium">{v || item.patient_id}</p> },
            { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (v) => <span className="font-mono tabular-nums">{formatCurrency(v)}</span> },
            { key: 'paid_amount', header: 'Paid', align: 'right', sortable: true, render: (v) => <span className="font-mono tabular-nums text-success">{formatCurrency(v)}</span> },
            { key: 'balance', header: 'Balance', align: 'right', sortable: true, render: (v) => <span className="font-mono tabular-nums font-medium">{formatCurrency(v)}</span> },
            {
              key: '__progress', header: 'Payment Progress', width: '9rem',
              render: (_v, item) => {
                const paidPct = item.amount > 0 ? (item.paid_amount / item.amount * 100) : 0;
                return (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-2 rounded-full transition-all ${paidPct >= 100 ? 'bg-success' : paidPct > 0 ? 'bg-primary' : 'bg-muted'}`}
                        style={{ width: `${Math.min(paidPct, 100)}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-9 text-right">{paidPct.toFixed(0)}%</span>
                  </div>
                );
              },
            },
            {
              key: 'due_date', header: 'Due Date', sortable: true,
              render: (v, item) => {
                const daysOver = getDaysOverdue(v);
                return (
                  <div className="whitespace-nowrap">
                    <p>{formatDate(v)}</p>
                    {getItemStatus(item) === 'overdue' && daysOver > 0 && (
                      <p className="text-xs text-destructive font-medium">{daysOver} days overdue</p>
                    )}
                  </div>
                );
              },
            },
            {
              key: '__status', header: 'Status', align: 'center',
              exportValue: (item) => getItemStatus(item),
              render: (_v, item) => {
                const status = getItemStatus(item);
                return (
                  <StatusBadge
                    status={status}
                    map={RECEIVABLE_STATUS_MAP}
                    label={<span className="inline-flex items-center">{RECEIVABLE_STATUS_ICON[status]}{status === 'paid' ? 'Paid' : status === 'overdue' ? 'Overdue' : 'Current'}</span>}
                  />
                );
              },
            },
            ...(canAdjust ? [{
              key: 'actions', header: '', align: 'right' as const,
              render: (_v: unknown, item: Receivable) => item.balance > 0 ? (
                <div className="flex items-center justify-end gap-1">
                  <Button size="icon" variant="ghost" title="Apply discount" aria-label="Apply discount" onClick={() => open(item, 'discount')}><BadgePercent /></Button>
                  <Button size="icon" variant="ghost" title="Record follow-up" aria-label="Record follow-up" onClick={() => open(item, 'follow_up')}><PhoneCall /></Button>
                  <Button size="icon" variant="ghost" className="text-destructive" title="Write off" aria-label="Write off" onClick={() => open(item, 'write_off')}><Ban /></Button>
                </div>
              ) : null,
            }] : []),
          ]}
        />
      </div>
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && !saving && setTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {target?.action === 'discount' ? 'Apply discount' : target?.action === 'follow_up' ? 'Record follow-up' : 'Write off as bad debt'}
            </DialogTitle>
            <DialogDescription>
              {target && `${target.bill.invoice_number} · ${target.bill.patient_name || target.bill.patient_id} · balance ${formatCurrency(target.bill.balance)}`}
            </DialogDescription>
          </DialogHeader>

          {target?.action === 'discount' && (
            <div className="space-y-4">
              <div>
                <Label>Discount type</Label>
                <Combobox
                  options={[{ value: 'fixed_amount', label: 'Fixed amount' }, { value: 'percentage', label: 'Percentage' }]}
                  value={discountForm.discount_type}
                  onChange={(v) => setDiscountForm((f) => ({ ...f, discount_type: v || 'fixed_amount' }))}
                  searchPlaceholder="Search..."
                />
              </div>
              {discountForm.discount_type === 'fixed_amount' ? (
                <div>
                  <Label>Amount ({baseCurrencyData.code})</Label>
                  <Input type="number" min="0" step="0.01" placeholder="0.00" value={discountForm.discount_amount} onChange={(e) => setDiscountForm((f) => ({ ...f, discount_amount: e.target.value }))} />
                </div>
              ) : (
                <div>
                  <Label>Percentage (%)</Label>
                  <Input type="number" min="0" max="100" placeholder="0" value={discountForm.discount_percentage} onChange={(e) => setDiscountForm((f) => ({ ...f, discount_percentage: e.target.value }))} />
                </div>
              )}
              <div>
                <Label>Reason</Label>
                <Textarea rows={2} value={discountForm.reason} onChange={(e) => setDiscountForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Why the discount is given" />
              </div>
            </div>
          )}

          {target?.action === 'follow_up' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>How</Label>
                  <Combobox
                    options={[
                      { value: 'phone', label: 'Phone call' }, { value: 'sms', label: 'SMS' }, { value: 'email', label: 'Email' },
                      { value: 'in_person', label: 'In person' }, { value: 'letter', label: 'Letter' },
                    ]}
                    value={followUpForm.follow_up_type}
                    onChange={(v) => setFollowUpForm((f) => ({ ...f, follow_up_type: v || 'phone' }))}
                    searchPlaceholder="Search..."
                  />
                </div>
                <div>
                  <Label>Outcome</Label>
                  <Combobox
                    options={[
                      { value: 'promised_payment', label: 'Promised payment' }, { value: 'partial_payment', label: 'Partial payment' },
                      { value: 'dispute', label: 'Dispute' }, { value: 'no_response', label: 'No response' }, { value: 'payment_plan', label: 'Payment plan agreed' },
                    ]}
                    value={followUpForm.outcome}
                    onChange={(v) => setFollowUpForm((f) => ({ ...f, outcome: v }))}
                    placeholder="Select outcome"
                    searchPlaceholder="Search..."
                  />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea rows={2} value={followUpForm.follow_up_notes} onChange={(e) => setFollowUpForm((f) => ({ ...f, follow_up_notes: e.target.value }))} placeholder="What was said" />
              </div>
              <div>
                <Label>Next follow-up</Label>
                <Input type="date" value={followUpForm.next_follow_up_date} onChange={(e) => setFollowUpForm((f) => ({ ...f, next_follow_up_date: e.target.value }))} />
              </div>
            </div>
          )}

          {target?.action === 'write_off' && (
            <div className="space-y-4">
              <div className="p-3 bg-destructive-bg border border-destructive-border rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-sm text-destructive">This is permanent: the bill's balance goes to zero and a bad-debt expense entry is posted.</p>
              </div>
              <div>
                <Label>Reason</Label>
                <Textarea rows={2} value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} placeholder="Why this debt is being written off" />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={saving}>Cancel</Button>
            <Button variant={target?.action === 'write_off' ? 'destructive' : 'default'} onClick={submit} loading={saving} disabled={!formValid}>
              {target?.action === 'discount' ? 'Apply discount' : target?.action === 'follow_up' ? 'Save follow-up' : 'Write off'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Receivables;
