import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Eye, Plus, RefreshCw, Shield } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, AdvancedDataTable } from '@/components/common';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import CreateClaimModal from '@/components/insurance/CreateClaimModal';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate, formatMoney } from '@/lib/format';
import { toast } from '@/lib/notify';

interface Claim {
  id: string;
  claim_number: string;
  scheme_name: string;
  scheme_code?: string;
  claim_amount: string | number;
  currency?: string;
  invoice_count?: number;
  created_at: string;
  status: string;
  days_pending?: number;
}

const STATUS_MAP = {
  pending: 'warning', submitted: 'info', accepted: 'primary', paid: 'success', rejected: 'danger', cancelled: 'neutral',
} as const;

/** The next step for a claim in each status, and what it's called on the button. */
const NEXT_STEPS: Record<string, { to: string; label: string; tone?: 'danger' }[]> = {
  pending: [{ to: 'submitted', label: 'Submit' }],
  submitted: [{ to: 'accepted', label: 'Accept' }, { to: 'rejected', label: 'Reject', tone: 'danger' }],
  accepted: [{ to: 'paid', label: 'Mark paid' }],
};

/** Insurance claims: invoices batched per scheme, taken from pending to paid. */
export default function InsuranceClaims() {
  const navigate = useNavigate();
  const { hasPrivilege } = useAuth();
  const canWrite = hasPrivilege('billing.write');
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState<{ claim: Claim; to: string; label: string; tone?: 'danger' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/insurance-claims');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load claims');
      setClaims((await res.json()).data || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const download = async (claim: Claim) => {
    try {
      const res = await authFetch(`/api/insurance-claims/${claim.id}/pdf`);
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${claim.claim_number}.html`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Claim document downloaded');
    } catch {
      toast.error('Could not download the claim document');
    }
  };

  const changeStatus = async () => {
    if (!pending) return;
    const res = await authFetch(`/api/insurance-claims/${pending.claim.id}/status`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: pending.to, notes: `Status changed to ${pending.to}` }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error || 'Could not update the claim');
      throw new Error('failed');
    }
    toast.success(`${pending.claim.claim_number} marked ${pending.to}`);
    setPending(null);
    load();
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader
            icon={<Shield />}
            title="Insurance Claims"
            subtitle="Unpaid scheme invoices batched into claims, then submitted, accepted and paid"
            actions={
              <div className="flex gap-2">
                <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
                {canWrite && <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" />New claim</Button>}
              </div>
            }
          />

          <AdvancedDataTable<Claim>
            title="Claims"
            countLabel={['claim', 'claims']}
            data={claims}
            loading={loading}
            keyExtractor={(c) => c.id}
            onRowClick={(c) => navigate(`/billing-management/claims/${c.id}`)}
            searchPlaceholder="Search claim or scheme..."
            dateFilterKey="created_at"
            columns={[
              { key: 'claim_number', header: 'Claim', sortable: true, render: (v) => <span className="font-mono text-sm font-semibold text-primary">{v}</span> },
              {
                key: 'scheme_name', header: 'Scheme', sortable: true, filterable: true,
                render: (v, c) => (
                  <div>
                    <p className="font-medium">{v}</p>
                    {c.scheme_code && <p className="text-xs text-muted-foreground">{c.scheme_code}</p>}
                  </div>
                ),
              },
              { key: 'created_at', header: 'Created', sortable: true, render: (v) => <span className="whitespace-nowrap">{formatDate(v)}</span> },
              { key: 'invoice_count', header: 'Invoices', align: 'right', render: (v) => v || 0 },
              {
                key: 'claim_amount', header: 'Amount', align: 'right', sortable: true,
                exportValue: (c) => formatMoney(Number(c.claim_amount) || 0, c.currency),
                render: (v, c) => <span className="font-mono tabular-nums font-semibold whitespace-nowrap">{formatMoney(Number(v) || 0, c.currency)}</span>,
              },
              { key: 'status', header: 'Status', sortable: true, render: (v) => <StatusBadge status={v} map={STATUS_MAP} /> },
              {
                key: 'days_pending', header: 'Waiting', align: 'right',
                exportValue: (c) => `${c.days_pending || 0} days`,
                render: (v, c) => (['paid', 'cancelled', 'rejected'].includes(c.status) ? <span className="text-muted-foreground">—</span> : `${v || 0} d`),
              },
              {
                key: 'actions', header: '', align: 'right',
                render: (_v, c) => (
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {canWrite && (NEXT_STEPS[c.status] || []).map((step) => (
                      <Button key={step.to} variant="outline" className={step.tone === 'danger' ? 'text-destructive' : ''}
                        onClick={() => setPending({ claim: c, ...step })}>
                        {step.label}
                      </Button>
                    ))}
                    <Button size="icon" variant="ghost" aria-label="View claim" title="View claim" onClick={() => navigate(`/billing-management/claims/${c.id}`)}>
                      <Eye />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Download claim" title="Download claim" onClick={() => download(c)}>
                      <Download />
                    </Button>
                  </div>
                ),
              },
            ]}
            empty={{ icon: Shield, title: 'No insurance claims yet', message: 'Use "New claim" to batch a scheme’s unpaid invoices into a claim.' }}
          />
        </div>
      </div>

      {createOpen && (
        <CreateClaimModal
          onClose={() => setCreateOpen(false)}
          onSuccess={() => { setCreateOpen(false); load(); toast.success('Insurance claim created'); }}
        />
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? `${pending.label} ${pending.claim.claim_number}?` : ''}
        description={pending ? `${pending.claim.scheme_name} · ${formatMoney(Number(pending.claim.claim_amount) || 0, pending.claim.currency)}. The claim moves to “${pending.to}”.` : ''}
        confirmLabel={pending?.label}
        tone={pending?.tone === 'danger' ? 'danger' : 'default'}
        icon={Shield}
        onConfirm={changeStatus}
      />
    </AppLayout>
  );
}
