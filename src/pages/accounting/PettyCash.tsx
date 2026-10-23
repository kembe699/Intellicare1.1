import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, Coins, Loader2, Plus, RefreshCw, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, AdvancedDataTable } from '@/components/common';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
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

interface Movement { id: string; transaction_date: string; description: string; source_module: string | null; reference_number: string | null; money_in: number; money_out: number; posted_by: string | null }
interface PettyCashData { account: { id: string; account_code: string; account_name: string; is_active: boolean } | null; currency: string; balance: number; movements: Movement[] }
interface Account { id: string; account_code: string; account_name: string; account_type: string; is_active?: boolean }

const SOURCE_LABEL: Record<string, string> = { cash_transfer: 'Top-up (cash transfer)', daily_expense: 'Expense paid', cashier: 'Cashier hand-over' };

export default function PettyCash() {
  const { user, hasPrivilege } = useAuth();
  const navigate = useNavigate();
  const clinicId = user?.clinic || 1;
  const [data, setData] = useState<PettyCashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [sources, setSources] = useState<Account[]>([]);
  const [form, setForm] = useState({ fromId: '', amount: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/accounting/petty-cash?clinic_id=${clinicId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load petty cash');
      setData(await res.json());
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);

  const openTopUp = async () => {
    setForm({ fromId: '', amount: '', notes: '' });
    setTopUpOpen(true);
    const res = await authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`).catch(() => null);
    const acc: Account[] = res && res.ok ? await res.json() : [];
    setSources(acc.filter((a) => a.account_type === 'asset' && /^11/.test(a.account_code) && a.account_code !== '1108' && a.is_active !== false));
  };

  const topUp = async () => {
    const amount = parseFloat(form.amount) || 0;
    if (!data?.account || !form.fromId || !(amount > 0)) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/cash-transfers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_account_id: form.fromId, to_account_id: data.account.id, amount, notes: form.notes || 'Petty cash top-up' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Top-up failed');
      toast.success(`Petty cash topped up by ${formatMoney(amount, data.currency)}`);
      setTopUpOpen(false);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const stats = useMemo(() => {
    const ms = data?.movements || [];
    const month = new Date().toISOString().slice(0, 7);
    const thisMonth = ms.filter((m) => String(m.transaction_date).slice(0, 7) === month);
    return {
      inMonth: thisMonth.reduce((s, m) => s + (m.money_in || 0), 0),
      outMonth: thisMonth.reduce((s, m) => s + (m.money_out || 0), 0),
    };
  }, [data]);

  const active = !!data?.account?.is_active;

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader
            icon={<Coins />}
            title="Petty Cash"
            subtitle="The small cash float (account 1108): top it up from cash or bank, spend it through expenses"
            actions={active ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
                {hasPrivilege('cash_transfers.write') && <Button variant="outline" onClick={openTopUp}><ArrowDownToLine className="w-4 h-4 mr-2" />Top up</Button>}
                {hasPrivilege('expenses.write') && <Button onClick={() => navigate(`/procurement/daily-expenses?paid_from=${data!.account!.id}`)}><Plus className="w-4 h-4 mr-2" />Spend (new expense)</Button>}
              </div>
            ) : undefined}
          />

          {!loading && !active && (
            <div className="bg-card rounded-lg border shadow-sm p-6">
              <EmptyState
                icon={Wallet}
                title="Petty cash isn't set up"
                message={data?.account
                  ? 'Account 1108 Petty Cash exists in the Chart of Accounts but is switched off. Turn it on to start tracking the float.'
                  : 'There is no Petty Cash account (1108) yet. Setting it up adds it to the Chart of Accounts.'}
                action={hasPrivilege('accounting.write') ? { label: 'Set up petty cash', onClick: () => setSetupOpen(true) } : undefined}
              />
            </div>
          )}

          {active && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-card rounded-lg border shadow-sm p-4">
                  <p className="text-xs text-muted-foreground">Balance on hand</p>
                  <p className="text-2xl font-semibold font-mono tabular-nums mt-1">{formatMoney(data!.balance, data!.currency)}</p>
                </div>
                <div className="bg-card rounded-lg border shadow-sm p-4">
                  <p className="text-xs text-muted-foreground">Topped up this month</p>
                  <p className="text-lg font-semibold font-mono tabular-nums mt-1">{formatMoney(stats.inMonth, data!.currency)}</p>
                </div>
                <div className="bg-card rounded-lg border shadow-sm p-4">
                  <p className="text-xs text-muted-foreground">Spent this month</p>
                  <p className="text-lg font-semibold font-mono tabular-nums mt-1">{formatMoney(stats.outMonth, data!.currency)}</p>
                </div>
              </div>
                <AdvancedDataTable<Movement>
                  title="Movements"
                  countLabel={['movement', 'movements']}
                  data={data!.movements}
                  loading={loading}
                  keyExtractor={(m) => m.id}
                  searchable
                  searchPlaceholder="Search description..."
                  pagination={{ enabled: true, pageSize: 20 }}
                  columns={[
                    { key: 'transaction_date', header: 'Date', sortable: true, render: (v) => <span className="whitespace-nowrap">{formatDate(v)}</span> },
                    { key: 'description', header: 'Description', render: (v) => <span className="text-sm">{v}</span> },
                    { key: 'source_module', header: 'Type', exportValue: (m) => SOURCE_LABEL[m.source_module || ''] || m.source_module || '', render: (v) => <span className="text-sm text-muted-foreground">{SOURCE_LABEL[v] || v || '—'}</span> },
                    { key: 'money_in', header: 'In', align: 'right', render: (v) => (v > 0 ? <span className="font-mono tabular-nums text-success whitespace-nowrap">{formatMoney(v, data!.currency)}</span> : '') },
                    { key: 'money_out', header: 'Out', align: 'right', render: (v) => (v > 0 ? <span className="font-mono tabular-nums whitespace-nowrap">{formatMoney(v, data!.currency)}</span> : '') },
                  ]}
                  empty={{ icon: Coins, title: 'No movements yet', message: 'Top up the float to start.' }}
                />
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        title="Set up petty cash?"
        description={data?.account ? 'This switches on account 1108 Petty Cash in the Chart of Accounts.' : 'This adds account 1108 Petty Cash (asset) to the Chart of Accounts.'}
        confirmLabel="Set up petty cash"
        icon={Wallet}
        onConfirm={async () => {
          const res = await authFetch('/api/accounting/petty-cash/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clinic_id: clinicId }) });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) { toast.error(body.error || 'Could not set up petty cash'); throw new Error('failed'); }
          toast.success(body.message || 'Petty cash is ready');
          setSetupOpen(false);
          load();
        }}
      />

      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Top up petty cash</DialogTitle>
            <DialogDescription>Moves money from cash or bank into the petty cash float (a cash transfer).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>From</Label>
              <Combobox options={sources.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.account_name}` }))} value={form.fromId} onChange={(v) => setForm({ ...form, fromId: v })} placeholder="Cash or bank account" searchPlaceholder="Search accounts..." />
            </div>
            <div>
              <Label>Amount ({data?.currency})</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Weekly float" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpOpen(false)}>Cancel</Button>
            <Button onClick={topUp} disabled={saving || !form.fromId || !(parseFloat(form.amount) > 0)}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Top up</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
