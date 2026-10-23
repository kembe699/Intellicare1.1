import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Loader2, RefreshCw, Scissors, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, AdvancedDataTable } from '@/components/common';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate, formatMoney } from '@/lib/format';
import { toast } from '@/lib/notify';

/** One payable: a consultant bill, or all unpaid team fee splits on one theatre operation. */
interface Payable {
  key: string;
  kind: 'consultant' | 'theatre';
  payee: string;
  detail: string;
  date: string | null;
  amount: number;
  currency: string;
  consultantBillId?: string;
  operationId?: string;
  team?: { name: string; role: string; amount: number }[];
}
interface Account { id: string; account_code: string; account_name: string; account_type: string; is_active?: boolean }

const KIND_MAP = { consultant: 'info', theatre: 'primary' } as const;
const today = () => new Date().toISOString().split('T')[0];

export default function ConsultantPayments() {
  const { user, hasPrivilege } = useAuth();
  const clinicId = user?.clinic || 1;
  const [rows, setRows] = useState<Payable[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Payable | null>(null);
  const [form, setForm] = useState({ accountId: '', date: today() });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cbRes, tpRes, accRes] = await Promise.all([
        authFetch(`/api/daily-expenses/consultant-bills?clinic_id=${clinicId}`),
        authFetch(`/api/theatre/team-payouts?status=unpaid&clinic_id=${clinicId}`),
        authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`),
      ]);
      const out: Payable[] = [];
      const bills: any[] = cbRes.ok ? await cbRes.json() : [];
      for (const b of bills.filter((x) => x.status === 'unpaid')) {
        out.push({
          key: `cb-${b.id}`, kind: 'consultant', consultantBillId: b.id,
          payee: `${b.first_name} ${b.last_name}`,
          detail: `${b.bill_number} · consultations ${formatDate(b.period_from)} – ${formatDate(b.period_to)}`,
          date: b.created_at, amount: parseFloat(b.bill_amount) || 0, currency: b.currency,
        });
      }
      const splits: any[] = tpRes.ok ? await tpRes.json() : [];
      const byOp = new Map<string, Payable>();
      for (const sp of splits) {
        const p = byOp.get(sp.operation_id) || {
          key: `op-${sp.operation_id}`, kind: 'theatre' as const, operationId: sp.operation_id,
          payee: 'Surgical team', detail: sp.procedure_name || 'Operation', date: sp.ended_at || sp.scheduled_at,
          amount: 0, currency: sp.currency || sp.fee_currency, team: [],
        };
        p.amount += Number(sp.amount) || 0;
        p.team!.push({ name: `${sp.first_name} ${sp.last_name}`, role: sp.role, amount: Number(sp.amount) || 0 });
        byOp.set(sp.operation_id, p);
      }
      for (const p of byOp.values()) {
        p.payee = p.team!.length === 1 ? p.team![0].name : `${p.team!.length} team members`;
        out.push(p);
      }
      out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      setRows(out);
      const acc: Account[] = accRes.ok ? await accRes.json() : [];
      setAccounts(acc.filter((a) => a.account_type === 'asset' && /^11/.test(a.account_code) && a.is_active !== false));
    } catch (e: any) {
      toast.error(e.message || 'Could not load consultant payments');
    } finally {
      setLoading(false);
    }
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.currency, (m.get(r.currency) || 0) + r.amount);
    return [...m.entries()];
  }, [rows]);

  const pay = async () => {
    if (!target || !form.accountId) return;
    setSaving(true);
    try {
      const acct = accounts.find((a) => a.id === form.accountId);
      const res = target.kind === 'consultant'
        ? await authFetch('/api/daily-expenses/consultant-bill-payment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consultant_bill_id: target.consultantBillId, account_id: form.accountId, account_name: acct?.account_name, payment_date: form.date, payment_method: 'cash' }),
        })
        : await authFetch(`/api/theatre/operations/${target.operationId}/team-payouts/pay`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_account_id: form.accountId, clinic_id: clinicId }),
        });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Payment failed');
      toast.success(target.kind === 'consultant' ? `Paid ${target.payee}` : `Paid the surgical team for ${target.detail}`);
      setTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const canPay = (r: Payable) => hasPrivilege(r.kind === 'theatre' ? 'theatre.payout' : 'consultant_bills.pay');

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader
            icon={<Stethoscope />}
            title="Consultant Payments"
            subtitle="Consultant bills and theatre team fee splits waiting to be paid"
            actions={<Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>}
          />
          {totals.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {totals.map(([cur, amt]) => (
                <div key={cur} className="bg-card rounded-lg border shadow-sm px-4 py-3">
                  <p className="text-xs text-muted-foreground">Waiting to be paid ({cur})</p>
                  <p className="text-lg font-semibold font-mono tabular-nums">{formatMoney(amt, cur)}</p>
                </div>
              ))}
            </div>
          )}
            <AdvancedDataTable<Payable>
              title="Waiting to be paid"
              countLabel={['payable', 'payables']}
              data={rows}
              loading={loading}
              keyExtractor={(r) => r.key}
              searchable
              searchPlaceholder="Search payee, bill or procedure..."
              pagination={{ enabled: true, pageSize: 20 }}
              columns={[
                { key: 'kind', header: 'Type', exportValue: (r) => (r.kind === 'consultant' ? 'Consultant bill' : 'Theatre fees'), render: (v: Payable['kind']) => <StatusBadge status={v} map={KIND_MAP} label={v === 'consultant' ? 'Consultant bill' : 'Theatre fees'} /> },
                { key: 'payee', header: 'Payee', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
                { key: 'detail', header: 'For', render: (v) => <span className="text-sm">{v}</span> },
                { key: 'date', header: 'Date', sortable: true, render: (v) => <span className="whitespace-nowrap">{formatDate(v)}</span> },
                { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (v, r) => <span className="font-mono tabular-nums font-semibold whitespace-nowrap">{formatMoney(v, r.currency)}</span> },
                {
                  key: 'actions', header: '', align: 'right',
                  render: (_v, r) => canPay(r)
                    ? <Button onClick={() => { setTarget(r); setForm({ accountId: '', date: today() }); }}><Banknote className="w-4 h-4 mr-1.5" />Pay</Button>
                    : <span className="text-xs text-muted-foreground">{r.kind === 'theatre' ? 'Needs theatre payout rights' : 'Needs consultant payment rights'}</span>,
                },
              ]}
              empty={{ icon: Stethoscope, title: 'Nothing waiting to be paid', message: 'Consultant bills (from a consultant’s profile) and theatre team fee splits (from completed operations) appear here.' }}
            />
          <p className="text-sm text-muted-foreground">Consultant bills are generated in <Link to="/hr/consultants" className="text-primary hover:underline">HR › Consultants &amp; Doctors</Link>; theatre fee splits when an operation is completed.</p>
        </div>
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{target?.kind === 'theatre' ? <Scissors className="w-4 h-4" /> : <Stethoscope className="w-4 h-4" />}Pay {target?.payee}</DialogTitle>
            <DialogDescription>{target ? `${formatMoney(target.amount, target.currency)} — ${target.detail}. Posts to Doctor Fees (5110).` : ''}</DialogDescription>
          </DialogHeader>
          {target?.team && (
            <div className="rounded-md border divide-y text-sm">
              {target.team.map((m) => (
                <div key={`${m.name}-${m.role}`} className="flex justify-between px-3 py-2">
                  <span>{m.name} <span className="text-muted-foreground capitalize">· {m.role.replace(/_/g, ' ')}</span></span>
                  <span className="font-mono tabular-nums">{formatMoney(m.amount, target.currency)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <Label>Pay from</Label>
              <Combobox
                options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.account_name}` }))}
                value={form.accountId}
                onChange={(v) => setForm({ ...form, accountId: v })}
                placeholder="Cash or bank account"
                searchPlaceholder="Search accounts..."
              />
            </div>
            {target?.kind === 'consultant' && (
              <div>
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={pay} disabled={saving || !form.accountId}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Pay {target ? formatMoney(target.amount, target.currency) : ''}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
