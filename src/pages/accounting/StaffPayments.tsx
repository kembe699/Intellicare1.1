import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, HandCoins, Loader2, QrCode, RefreshCw, Users2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, AdvancedDataTable } from '@/components/common';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate, formatMoney } from '@/lib/format';
import { toast } from '@/lib/notify';

interface PayLine {
  id: string; run_id: string; run_number: string; period: string; payment_account_name: string;
  first_name: string; last_name: string; employee_number: string; job_title?: string;
  currency: string; gross_pay: string; net_pay: string;
}
interface Advance {
  id: string; advance_number: string; first_name: string; last_name: string; employee_number: string;
  amount: string; currency: string; request_date: string; repayment_months: number; reason?: string;
}
interface Account { id: string; account_code: string; account_name: string; account_type: string; is_active?: boolean }

const today = () => new Date().toISOString().split('T')[0];

export default function StaffPayments() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const [lines, setLines] = useState<PayLine[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [payLine, setPayLine] = useState<PayLine | null>(null);
  const [payRun, setPayRun] = useState<{ id: string; run_number: string; count: number } | null>(null);
  const [qr, setQr] = useState<{ line: PayLine; data: any | null } | null>(null);
  const [disburse, setDisburse] = useState<Advance | null>(null);
  const [disburseForm, setDisburseForm] = useState({ accountId: '', date: today() });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [runsRes, advRes, accRes] = await Promise.all([
        authFetch('/api/hr/payroll/runs'),
        authFetch('/api/hr/salary-advances?status=approved'),
        authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`),
      ]);
      const runs: any[] = runsRes.ok ? await runsRes.json() : [];
      const approved = runs.filter((r) => r.status === 'approved');
      const details = await Promise.all(approved.map((r) => authFetch(`/api/hr/payroll/runs/${r.id}`).then((x) => (x.ok ? x.json() : null))));
      const ready: PayLine[] = [];
      for (const d of details) {
        if (!d) continue;
        for (const l of d.lines || []) {
          if (l.status === 'paid') continue;
          ready.push({ ...l, run_id: d.id, run_number: d.run_number, period: `${String(d.period_month).padStart(2, '0')}/${d.period_year}`, payment_account_name: d.payment_account_name });
        }
      }
      setLines(ready);
      setAdvances(advRes.ok ? await advRes.json() : []);
      const acc: Account[] = accRes.ok ? await accRes.json() : [];
      setAccounts(acc.filter((a) => a.account_type === 'asset' && /^11/.test(a.account_code) && a.is_active !== false));
    } catch (e: any) {
      toast.error(e.message || 'Could not load staff payments');
    } finally {
      setLoading(false);
    }
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);

  const runs = useMemo(() => {
    const m = new Map<string, { id: string; run_number: string; count: number }>();
    for (const l of lines) {
      const r = m.get(l.run_id) || { id: l.run_id, run_number: l.run_number, count: 0 };
      r.count += 1; m.set(l.run_id, r);
    }
    return [...m.values()];
  }, [lines]);

  const post = async (url: string, body?: object) => {
    const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error || 'Payment failed'); throw new Error(data.error || 'failed'); }
    return data;
  };

  const openQr = async (line: PayLine) => {
    setQr({ line, data: null });
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${line.run_id}/lines/${line.id}/signing-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the signing link');
      setQr({ line, data });
    } catch (e: any) {
      toast.error(e.message);
      setQr(null);
    }
  };

  // While the QR is shown, watch for the employee having signed (which pays the line).
  const checkSigned = useCallback(async () => {
    if (!qr) return;
    const res = await authFetch(`/api/hr/payroll/runs/${qr.line.run_id}`).catch(() => null);
    if (!res || !res.ok) return;
    const data = await res.json();
    if ((data.lines || []).find((l: any) => l.id === qr.line.id)?.status === 'paid') {
      toast.success(`${qr.line.first_name} ${qr.line.last_name} signed and was paid`);
      setQr(null);
      load();
    }
  }, [qr, load]);
  useEffect(() => {
    if (!qr?.data) return;
    const interval = setInterval(checkSigned, 2500);
    const onVisible = () => { if (document.visibilityState === 'visible') checkSigned(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [qr?.data, checkSigned]);

  const doDisburse = async () => {
    if (!disburse || !disburseForm.accountId) return;
    setSaving(true);
    try {
      const acct = accounts.find((a) => a.id === disburseForm.accountId);
      await post(`/api/hr/salary-advances/${disburse.id}/disburse`, { payment_account_id: disburseForm.accountId, account_name: acct?.account_name, disbursement_date: disburseForm.date });
      toast.success(`Advance ${disburse.advance_number} disbursed to ${disburse.first_name} ${disburse.last_name}`);
      setDisburse(null);
      load();
    } catch { /* toast shown */ } finally { setSaving(false); }
  };

  const name = (r: { first_name: string; last_name: string; employee_number: string }) => (
    <div><div className="font-medium">{r.first_name} {r.last_name}</div><div className="text-xs text-muted-foreground font-mono">{r.employee_number}</div></div>
  );

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader
            icon={<Users2 />}
            title="Staff Payments"
            subtitle="Pay approved payroll and disburse approved salary advances — HR prepares and approves them"
            actions={<Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>}
          />
          <Tabs defaultValue="payroll">
            <TabsList>
              <TabsTrigger value="payroll" className="gap-2"><Banknote className="w-4 h-4" />Payroll ({lines.length})</TabsTrigger>
              <TabsTrigger value="advances" className="gap-2"><HandCoins className="w-4 h-4" />Salary advances ({advances.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="payroll" className="mt-4 space-y-3">
              {runs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {runs.map((r) => (
                    <Button key={r.id} variant="outline" onClick={() => setPayRun(r)}>
                      <Banknote className="w-4 h-4 mr-2" />Pay all on {r.run_number} ({r.count})
                    </Button>
                  ))}
                </div>
              )}
              <div className="bg-card rounded-lg border shadow-sm p-4">
                <AdvancedDataTable<PayLine>
                  data={lines}
                  loading={loading}
                  keyExtractor={(l) => l.id}
                  searchable
                  searchPlaceholder="Search employee or run..."
                  pagination={{ enabled: true, pageSize: 20 }}
                  columns={[
                    { key: 'first_name', header: 'Employee', sortable: true, render: (_v, l) => name(l) },
                    { key: 'run_number', header: 'Payroll run', render: (v, l) => <span className="whitespace-nowrap"><span className="font-mono text-sm">{v}</span> <span className="text-muted-foreground text-xs">({l.period})</span></span> },
                    { key: 'gross_pay', header: 'Gross', align: 'right', render: (v, l) => <span className="font-mono tabular-nums whitespace-nowrap">{formatMoney(v, l.currency)}</span> },
                    { key: 'net_pay', header: 'Net pay', align: 'right', sortable: true, render: (v, l) => <span className="font-mono tabular-nums font-semibold whitespace-nowrap">{formatMoney(v, l.currency)}</span> },
                    { key: 'payment_account_name', header: 'Paid from', render: (v) => v || '—' },
                    {
                      key: 'actions', header: '', align: 'right',
                      render: (_v, l) => (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={() => openQr(l)} title="Employee scans and signs to receive"><QrCode className="w-4 h-4 mr-1.5" />QR sign</Button>
                          <Button onClick={() => setPayLine(l)}><Banknote className="w-4 h-4 mr-1.5" />Pay</Button>
                        </div>
                      ),
                    },
                  ]}
                  empty={{ icon: Banknote, title: 'No payroll waiting to be paid', message: 'Lines from payroll runs HR has approved appear here.' }}
                />
              </div>
            </TabsContent>

            <TabsContent value="advances" className="mt-4">
              <div className="bg-card rounded-lg border shadow-sm p-4">
                <AdvancedDataTable<Advance>
                  data={advances}
                  loading={loading}
                  keyExtractor={(a) => a.id}
                  searchable
                  searchPlaceholder="Search employee or advance..."
                  columns={[
                    { key: 'advance_number', header: 'Advance', render: (v) => <span className="font-mono text-sm whitespace-nowrap">{v}</span> },
                    { key: 'first_name', header: 'Employee', render: (_v, a) => name(a) },
                    { key: 'request_date', header: 'Requested', render: (v) => <span className="whitespace-nowrap">{formatDate(v)}</span> },
                    { key: 'repayment_months', header: 'Repay over', render: (v) => (v ? `${v} month${v === 1 ? '' : 's'}` : '—') },
                    { key: 'amount', header: 'Amount', align: 'right', render: (v, a) => <span className="font-mono tabular-nums font-semibold whitespace-nowrap">{formatMoney(v, a.currency)}</span> },
                    {
                      key: 'actions', header: '', align: 'right',
                      render: (_v, a) => <Button onClick={() => { setDisburse(a); setDisburseForm({ accountId: '', date: today() }); }}><HandCoins className="w-4 h-4 mr-1.5" />Disburse</Button>,
                    },
                  ]}
                  empty={{ icon: HandCoins, title: 'No approved advances to disburse', message: 'Advances approved in HR › Salary Advances appear here.' }}
                />
              </div>
            </TabsContent>
          </Tabs>
          <p className="text-sm text-muted-foreground">Payroll runs are prepared and approved in <Link to="/hr/payroll" className="text-primary hover:underline">HR › Payroll</Link>; advances in <Link to="/hr/salary-advances" className="text-primary hover:underline">HR › Salary Advances</Link>.</p>
        </div>
      </div>

      <ConfirmDialog
        open={!!payLine}
        onOpenChange={(o) => !o && setPayLine(null)}
        title={`Pay ${payLine?.first_name} ${payLine?.last_name}?`}
        description={payLine ? `${formatMoney(payLine.net_pay, payLine.currency)} net from ${payLine.payment_account_name || 'the run’s payment account'} (${payLine.run_number}). Posts salary, deductions and the payment to the ledger. This cannot be undone.` : ''}
        confirmLabel="Pay"
        icon={Banknote}
        onConfirm={async () => {
          if (!payLine) return;
          await post(`/api/hr/payroll/runs/${payLine.run_id}/lines/${payLine.id}/pay`);
          toast.success(`${payLine.first_name} ${payLine.last_name} paid`);
          setPayLine(null); load();
        }}
      />
      <ConfirmDialog
        open={!!payRun}
        onOpenChange={(o) => !o && setPayRun(null)}
        title={`Pay everyone on ${payRun?.run_number}?`}
        description={payRun ? `${payRun.count} employee(s) still unpaid on this run. Each gets their own ledger entry. This cannot be undone.` : ''}
        confirmLabel="Pay all"
        icon={Banknote}
        onConfirm={async () => {
          if (!payRun) return;
          await post(`/api/hr/payroll/runs/${payRun.id}/pay`);
          toast.success(`${payRun.run_number} paid`);
          setPayRun(null); load();
        }}
      />

      <Dialog open={!!qr} onOpenChange={(o) => { if (!o) { setQr(null); load(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign to receive pay</DialogTitle>
            <DialogDescription>{qr?.line.first_name} {qr?.line.last_name} scans this, checks their pay and signs. Signing pays the line.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            {qr?.data ? <img src={qr.data.qr_data_url} alt="Scan to sign" className="w-56 h-56 border rounded-lg" /> : <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />}
          </div>
          <DialogFooter className="gap-2">
            {qr?.data && (
              <Button variant="outline" onClick={() => navigator.clipboard.writeText(`${window.location.origin}${qr.data.path}`).then(() => toast.success('Link copied')).catch(() => toast.error('Could not copy link'))}>Copy link</Button>
            )}
            <Button variant="outline" onClick={checkSigned} disabled={!qr?.data}>Check now</Button>
            <Button onClick={() => { setQr(null); load(); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!disburse} onOpenChange={(o) => !o && setDisburse(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disburse {disburse?.advance_number}</DialogTitle>
            <DialogDescription>{disburse ? `${formatMoney(disburse.amount, disburse.currency)} to ${disburse.first_name} ${disburse.last_name}. ${disburse.repayment_months ? `Repaid over ${disburse.repayment_months} month(s) through payroll.` : ''}` : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Pay from</Label>
              <Combobox
                options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.account_name}` }))}
                value={disburseForm.accountId}
                onChange={(v) => setDisburseForm({ ...disburseForm, accountId: v })}
                placeholder="Cash or bank account"
                searchPlaceholder="Search accounts..."
              />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={disburseForm.date} onChange={(e) => setDisburseForm({ ...disburseForm, date: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisburse(null)}>Cancel</Button>
            <Button onClick={doDisburse} disabled={saving || !disburseForm.accountId}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Disburse</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
