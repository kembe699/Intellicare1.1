import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { Wallet, Plus, Loader2, Check } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { formatDate } from '@/lib/format';

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  draft: 'neutral',
  approved: 'info',
  paid: 'success',
  cancelled: 'danger',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function PayrollManagement() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const now = new Date();

  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ period_month: String(now.getMonth() + 1), period_year: String(now.getFullYear()), payment_account_id: '', notes: '' });

  const fetchRuns = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/hr/payroll/runs');
      if (res.ok) setRuns(await res.json());
      else toast.error('Failed to load payroll runs');
    } catch (e) {
      toast.error('Failed to load payroll runs');
    } finally {
      setLoading(false);
    }
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

  useEffect(() => { fetchRuns(); fetchAccounts(); }, []);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await authFetch('/api/hr/payroll/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_month: parseInt(form.period_month), period_year: parseInt(form.period_year),
          payment_account_id: form.payment_account_id || null, notes: form.notes,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success(`Payroll run ${created.run_number} created as a draft`);
        setShowCreate(false);
        navigate(`/hr/payroll/${created.id}`);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to create payroll run');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<Wallet />}
          title="Payroll"
          subtitle="Run payroll, review pay periods, and post payments to the ledger"
          actions={
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" /> Run Payroll
            </Button>
          }
        />

        <div className="bg-card rounded-lg border shadow-sm p-4">
          <AdvancedDataTable<any>
            data={runs}
            keyExtractor={(r) => r.id}
            loading={loading}
            emptyMessage="No payroll runs yet. Click Run Payroll to create the first one."
            onRowClick={(r) => navigate(`/hr/payroll/${r.id}`)}
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            columns={[
              { key: 'run_number', header: 'Run', render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
              { key: 'period_month', header: 'Period', render: (_v, r) => `${MONTHS[r.period_month - 1] || r.period_month} ${r.period_year}` },
              { key: 'employee_count', header: 'Employees', align: 'center' },
              { key: 'payment_account_name', header: 'Payment Account', render: (v) => v || '—' },
              { key: 'run_date', header: 'Run Date', render: (v) => formatDate(v) },
              {
                key: 'status', header: 'Status',
                render: (v) => <StatusBadge status={v} label={v} map={STATUS_TONE} />,
              },
            ]}
          />
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Run Payroll</DialogTitle>
            <DialogDescription>Creates a draft for the period from every active employee's current salary structure — review before approving and paying.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-6 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Month</Label>
                <Combobox
                  options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                  value={form.period_month} onChange={v => setForm({ ...form, period_month: v })}
                  searchPlaceholder="Search..." className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Year</Label>
                <Combobox
                  options={[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => ({ value: String(y), label: String(y) }))}
                  value={form.period_year} onChange={v => setForm({ ...form, period_year: v })}
                  searchPlaceholder="Search..." className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Payment Account (bank/cash to pay from)</Label>
              <Combobox
                options={accounts.map((a: any) => ({ value: String(a.id), label: a.account_name }))}
                value={form.payment_account_id} onChange={v => setForm({ ...form, payment_account_id: v })}
                placeholder="Select account..." searchPlaceholder="Search accounts..." className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Can also be set later, before approving this run.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Create Draft
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </AppLayout>
  );
}
