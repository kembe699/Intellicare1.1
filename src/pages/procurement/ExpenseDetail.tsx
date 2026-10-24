import React, { useState, useEffect } from 'react';
import { useApprovalSettings } from '@/hooks/useApprovalSettings';
import { useParams, useNavigate } from 'react-router-dom';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/notify';
import {
  ArrowLeft, ShieldCheck, Printer, Loader2, CheckCircle2,
  Clock, AlertCircle, Receipt, Calendar,
  Tag, Wallet, CreditCard, User, FileText,
} from 'lucide-react';
import * as docTemplate from '@/utils/documentTemplate';
import { expenseVoucherStatus } from '@/lib/expenseStatus';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { formatDate } from '@/lib/format';

interface Expense {
  id: number; expense_date: string; description: string; amount: string;
  account_name: string; account_id: string; category: string; notes: string;
  created_by: string; payment_method: string; voucher_number: string | null;
  status: string; clinic_id: number; paid_at?: string | null;
}
interface Approval {
  id: string; expense_id: number; approval_level: number;
  approved_by: string; approved_by_title?: string;
  signature?: string | null; notes?: string; approved_at: string;
}
interface UserProfile { id: string; displayName: string; email: string; role: string; signature: string | null; }

const APPROVAL_LEVELS = ['Approval 1', 'Authorization'];

/** payments: opened from Accounting › Payments (can pay); requests: from Procurement (view/approve only). */
export default function ExpenseDetail({ mode = 'requests' }: { mode?: 'requests' | 'payments' }) {
  const { expReq, expLevels, expLevelNumbers } = useApprovalSettings();
  const listPath = mode === 'payments' ? '/accounting/payments/expenses' : '/procurement/daily-expenses';
  const { confirm, confirmDialog } = useConfirmDialog();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasPrivilege } = useAuth();
  const { fmt } = useCurrency();
  const facilityInfo = useFacilityInfo();

  const [expense, setExpense] = useState<Expense | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState({ approved_by_title: '', notes: '' });
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // silent skips the full-page spinner (see the `if (loading)` guard below) — paying
  // and approving used to re-run this the same way the initial mount does, blanking the
  // whole page to a spinner just to reflect the new status.
  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [expRes, aprRes, profRes] = await Promise.all([
        authFetch(`/api/daily-expenses/${id}`),
        authFetch(`/api/daily-expenses/${id}/approvals`),
        authFetch('/api/auth/me'),
      ]);
      if (!expRes.ok) { setError('Expense not found'); return; }
      setExpense(await expRes.json());
      if (aprRes.ok) setApprovals(await aprRes.json());
      if (profRes.ok) setUserProfile(await profRes.json());
    } catch { setError('Failed to load expense'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (id) fetchAll(); }, [id]);

  const handlePay = async () => {
    if (paying) return;
    if (!(await confirm({ description: 'Confirm payment? This will deduct the amount from the selected account.' }))) return;
    setPaying(true);
    try {
      const r = await authFetch(`/api/daily-expenses/${id}/pay`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) { toast.error(data.error || 'Payment failed'); return; }
      toast.success('Payment processed — expense marked as Paid');
      await fetchAll(true);
    } catch { toast.error('Failed to process payment'); }
    finally { setPaying(false); }
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await authFetch(`/api/daily-expenses/${id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by_title: form.approved_by_title, notes: form.notes }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 403 && Array.isArray(data.allowedActions)) {
          const allowed = data.allowedActions.map((a: any) => a.label).join(', ') || 'none';
          toast.error(`${data.error} Your permitted approvals: ${allowed}`);
        } else {
          toast.error(data.error || 'Approval failed');
        }
        return;
      }
      toast.success(`Approval ${data.approval_level}/${expReq} recorded by ${data.approved_by}`);
      setForm(f => ({ ...f, approved_by_title: '', notes: '' }));
      await fetchAll(true);
    } catch { toast.error('Failed to submit approval'); }
    finally { setSubmitting(false); }
  };

  const printVoucher = () => {
    if (!expense) return;
    const fi = { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo };
    const bi = { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone };

    const approvalsRows = expLevelNumbers.map(level => {
      const a = approvals.find(ap => ap.approval_level === level);
      return { cells: [expLevels[level - 1], a ? a.approved_by : '—', a ? formatDate(a.approved_at) : '—', a ? '✓ Approved' : 'Pending'], bold: !!a };
    });
    const signers = [
      { label: 'Prepared By', name: expense.created_by || '' },
      ...(expLevelNumbers.map(level => {
        const a = approvals.find(ap => ap.approval_level === level);
        return { label: expLevels[level - 1], name: a?.approved_by || '', signature: a?.signature || undefined };
      })),
    ];
    const itemRows = [
      { cells: ['1', expense.description, expense.category || '—', expense.payment_method || 'Cash', expense.account_name || '—', fmt(parseFloat(String(expense.amount || 0)))], bold: false },
    ];

    const body = docTemplate.buildInfoGrid(
      { title: 'Voucher Details', rows: [
        { label: 'Voucher No', value: expense.voucher_number || '—', bold: true },
        { label: 'Date', value: formatDate(expense.expense_date) },
        { label: 'Prepared By', value: expense.created_by || '—' },
      ]},
      { title: 'Payment', rows: [
        { label: 'Account', value: expense.account_name || '—' },
        { label: 'Method', value: expense.payment_method || 'Cash' },
        { label: 'Amount', value: fmt(parseFloat(String(expense.amount || 0))), bold: true },
      ]}
    )
    + `<div class="ic-section-title">Items / Description</div>`
    + docTemplate.buildTable(
        [{ label: '#' }, { label: 'Description' }, { label: 'Category' }, { label: 'Method' }, { label: 'Account' }, { label: 'Amount', align: 'right' as const }],
        itemRows
      )
    + docTemplate.buildSummary([
        { label: 'Total Amount', value: fmt(parseFloat(String(expense.amount || 0))), isTotal: true },
      ])
    + (expense.notes ? `<div class="ic-section-title">Remarks</div><p style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:12px">${expense.notes}</p>` : '')
    + docTemplate.buildSignatures(signers);

    docTemplate.openPrintWindow(docTemplate.buildDocument({
      docType: 'EXPENSE VOUCHER',
      docNumber: expense.voucher_number || `EXP-${expense.id}`,
      date: expense.expense_date,
      status: expenseVoucherStatus(expense.status, approvals.length),
      bodyHTML: body,
      facilityInfo: fi,
      branchInfo: bi,
    }));
  };

  if (loading) return <AppLayout><LoadingState message="Loading expense details..." /></AppLayout>;

  if (error || !expense) return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-10 h-10 text-destructive" />
        <p className="text-destructive font-semibold">{error || 'Expense not found'}</p>
        <Button variant="outline" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
      </div>
    </AppLayout>
  );

  const isPending = expense.status === 'pending_approval';
  const isApproved = expense.status === 'approved';
  const isPaid = expense.status === 'paid';
  const approvalCount = approvals.length;
  const nextLevel = approvalCount + 1;
  const fullyApproved = approvalCount >= expReq;
  const amount = parseFloat(String(expense.amount || 0));

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-5xl mx-auto w-full space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate(listPath)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="flex-1">
            <h1 className="ic-text-title tracking-tight">{expense.description}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Expense #{expense.id} &nbsp;·&nbsp; {formatDate(expense.expense_date)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isPending && (
              <Badge className="text-sm px-3 py-1 bg-warning-bg text-warning border-warning-border">
                <Clock className="w-3.5 h-3.5 mr-1" /> Pending Approval ({approvalCount}/{expReq})
              </Badge>
            )}
            {isApproved && (
              <Badge className="text-sm px-3 py-1 bg-primary/10 text-primary border-primary/40">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approved — Awaiting Payment
              </Badge>
            )}
            {isPaid && (
              <Badge className="text-sm px-3 py-1 bg-success-bg text-success border-success-border">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Paid
              </Badge>
            )}
            {isPaid && (
              <Button size="sm" onClick={printVoucher} className="gap-1.5">
                <Printer className="w-4 h-4" /> Print Voucher
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Left: Expense Details ── */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Expense Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="w-4 h-4" />Date</span>
                  <span className="font-medium text-sm">{formatDate(expense.expense_date)}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground"><Tag className="w-4 h-4" />Category</span>
                  <Badge variant="outline" className="text-xs">{expense.category || '—'}</Badge>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="w-4 h-4" />Account</span>
                  <span className="font-medium text-sm text-right max-w-[200px] truncate">{expense.account_name}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground"><CreditCard className="w-4 h-4" />Payment Method</span>
                  <span className="text-sm">{expense.payment_method || 'Cash'}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground"><User className="w-4 h-4" />Prepared By</span>
                  <span className="text-sm">{expense.created_by || '—'}</span>
                </div>
                {expense.voucher_number && (
                  <div className="flex items-center justify-between py-2 border-b">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground"><FileText className="w-4 h-4" />Voucher No</span>
                    <span className="font-mono text-sm font-semibold">{expense.voucher_number}</span>
                  </div>
                )}
                {expense.notes && (
                  <div className="pt-1">
                    <p className="text-xs text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm bg-muted/40 rounded p-2">{expense.notes}</p>
                  </div>
                )}
                <div className="rounded-lg bg-muted/50 p-4 mt-2 flex items-center justify-between">
                  <span className="font-semibold text-muted-foreground">Total Amount</span>
                  <span className="text-2xl font-bold text-destructive">{fmt(amount)}</span>
                </div>
              </CardContent>
            </Card>

            {/* ── Approval Progress Summary ── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Approval Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {expLevelNumbers.map(level => {
                  const a = approvals.find(ap => ap.approval_level === level);
                  const isNext = level === nextLevel && isPending;
                  return (
                    <div key={level} className={`flex items-center gap-3 rounded-lg p-3 border ${a ? 'bg-success-bg border-success-border' : isNext ? 'bg-warning-bg border-warning-border' : 'bg-muted/20 border-transparent'}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${a ? 'bg-success text-white' : isNext ? 'bg-warning text-white' : 'bg-muted text-muted-foreground'}`}>
                        {a ? '✓' : level}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{expLevels[level - 1]}</p>
                        {a ? (
                          <p className="text-xs text-success">{a.approved_by} &nbsp;·&nbsp; {formatDate(a.approved_at)}</p>
                        ) : isNext ? (
                          <p className="text-xs text-warning">Awaiting your approval</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Pending</p>
                        )}
                      </div>
                      {a?.signature && (
                        <img src={a.signature} alt="sig" className="h-8 max-w-[80px] object-contain border rounded bg-white p-0.5" />
                      )}
                    </div>
                  );
                })}

                {fullyApproved && (
                  <div className="mt-3 rounded-lg bg-success-bg border border-success-border p-4 text-center">
                    <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
                    <p className="font-semibold text-success">Fully Authorized</p>
                    <p className="text-sm text-success mt-0.5">Voucher: <span className="font-mono font-bold">{expense.voucher_number}</span></p>
                    <Button className="mt-3 gap-2" onClick={printVoucher}>
                      <Printer className="w-4 h-4" /> Print Expense Voucher
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Right: Approve Action ── */}
          <div>
            {isPending && !fullyApproved ? (
              <Card className="border-warning-border">
                <CardHeader className="pb-3 bg-warning-bg rounded-t-xl">
                  <CardTitle className="text-base flex items-center gap-2 text-warning">
                    <ShieldCheck className="w-5 h-5" />
                    {expLevels[nextLevel - 1]} Required
                  </CardTitle>
                  <p className="text-xs text-warning mt-0.5">
                    {2 - approvalCount} more approval{2 - approvalCount !== 1 ? 's' : ''} needed before the voucher is issued and payment is posted.
                  </p>
                </CardHeader>
                <CardContent className="pt-5">
                  <form onSubmit={handleApprove} className="space-y-4">
                    <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Approving As</p>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <p className="font-semibold text-sm">{userProfile?.displayName || (user as any)?.display_name || '...'}</p>
                          <p className="text-xs text-muted-foreground">{userProfile?.email || ''}</p>
                          <p className="text-xs text-muted-foreground capitalize">{userProfile?.role || ''}</p>
                        </div>
                        {userProfile?.signature ? (
                          <div className="border rounded p-1 bg-white">
                            <p className="text-xs text-muted-foreground mb-1 text-center">Signature</p>
                            <img src={userProfile.signature} alt="Your signature" className="h-12 max-w-[140px] object-contain" />
                          </div>
                        ) : (
                          <div className="border rounded p-2 bg-white text-xs text-muted-foreground text-center w-[110px]">
                            No signature<br/>on profile
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs">Approval Notes (optional)</Label>
                      <Input className="mt-1" placeholder="Any remarks..." value={form.notes}
                        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                    </div>

                    <Button type="submit" className="w-full bg-warning hover:bg-warning gap-2 h-11" disabled={submitting}>
                      {submitting
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Approving...</>
                        : <><ShieldCheck className="w-4 h-4" /> Approve ({nextLevel}/{expReq})</>
                      }
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : isApproved ? (
              <Card className="border-primary/30">
                <CardContent className="pt-8 pb-8 flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle2 className="w-9 h-9 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-primary">Fully Authorized</h3>
                    <p className="text-sm text-primary mt-1">Both approvals recorded. Ready for payment.</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Voucher: <span className="font-mono font-semibold">{expense.voucher_number}</span>
                    </p>
                  </div>
                  {mode === 'payments' && hasPrivilege('expenses.pay') ? (
                    <>
                      <Button className="gap-2 mt-2 bg-success hover:bg-success" size="lg" onClick={handlePay} disabled={paying}>
                        {paying
                          ? <><Loader2 className="w-5 h-5 animate-spin" /> Processing Payment...</>
                          : <><CreditCard className="w-5 h-5" /> Pay Now</>}
                      </Button>
                      <p className="text-xs text-muted-foreground">This will deduct {fmt(amount)} from <strong>{expense.account_name}</strong></p>
                    </>
                  ) : (
                    <Button variant="outline" className="gap-2 mt-2" onClick={() => navigate(`/accounting/payments/expenses/${expense.id}`)}>
                      <CreditCard className="w-4 h-4" /> Pay in Accounting
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : isPaid ? (
              <Card className="border-success-border">
                <CardContent className="pt-8 pb-8 flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-success-bg flex items-center justify-center">
                    <CheckCircle2 className="w-9 h-9 text-success" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-success">Payment Complete</h3>
                    <p className="text-sm text-success mt-1">{fmt(amount)} deducted from <strong>{expense.account_name}</strong></p>
                    {expense.paid_at && <p className="text-xs text-muted-foreground mt-0.5">Paid on {new Date(expense.paid_at).toLocaleString()}</p>}
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Voucher: <span className="font-mono font-semibold">{expense.voucher_number}</span>
                    </p>
                  </div>
                  <Button className="gap-2 mt-2" size="lg" onClick={printVoucher}>
                    <Printer className="w-5 h-5" /> Print Expense Voucher
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>

        </div>
      </div>
      </div>
    </AppLayout>
  );
}
