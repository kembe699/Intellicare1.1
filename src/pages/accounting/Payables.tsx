import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Scale } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, AdvancedDataTable } from '@/components/common';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/api/apiClient';
import { formatDate, formatMoney } from '@/lib/format';
import { toast } from '@/lib/notify';

interface SummaryRow { groupLabel: string; current: number; d31_60: number; d61_90: number; d90_plus: number; total: number }
interface DetailRow {
  id: number; poNumber: string; supplierName: string; orderDate: string; paymentTerms: string;
  totalAmount: number; paidAmount: number; balanceAmount: number; currency: string; daysOverdue: number; bucketLabel: string;
}

const BUCKETS: { key: keyof SummaryRow; label: string }[] = [
  { key: 'current', label: '0–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90_plus', label: '90+ days' },
];

export default function Payables() {
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [currency, setCurrency] = useState('');
  const [detail, setDetail] = useState<DetailRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        authFetch('/api/reports-v2/procurement/ap-aging-summary?groupBy=supplier&allBranches=true'),
        authFetch('/api/reports-v2/procurement/ap-aging-detailed?allBranches=true'),
      ]);
      if (!s.ok || !d.ok) throw new Error('Could not load payables');
      const sj = await s.json();
      const dj = await d.json();
      setSummary(sj.rows || []);
      setCurrency(sj.currency || '');
      setDetail(dj.rows || []);
    } catch (e: any) {
      toast.error(e.message || 'Could not load payables');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const t = { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
    for (const r of summary) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += Number(r[k]) || 0;
    return t;
  }, [summary]);

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader
            icon={<Scale />}
            title="A/P & Aging"
            subtitle="What is still owed to suppliers, aged from the order date"
            actions={<Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>}
          />

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[...BUCKETS.map((b) => ({ label: b.label, value: totals[b.key as keyof typeof totals] })), { label: 'Total owed', value: totals.total }].map((c) => (
              <div key={c.label} className="bg-card rounded-lg border shadow-sm p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-lg font-semibold font-mono tabular-nums mt-1">{loading ? '—' : formatMoney(c.value, currency || undefined)}</p>
              </div>
            ))}
          </div>

          <div className="bg-card rounded-lg border shadow-sm p-4">
            <h3 className="font-medium mb-3">By supplier <span className="text-xs text-muted-foreground font-normal">({currency || 'base currency'})</span></h3>
            <AdvancedDataTable<SummaryRow>
              data={summary}
              loading={loading}
              keyExtractor={(r) => r.groupLabel}
              columns={[
                { key: 'groupLabel', header: 'Supplier', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
                ...BUCKETS.map((b) => ({ key: b.key as string, header: b.label, align: 'right' as const, render: (v: number) => <span className="font-mono tabular-nums whitespace-nowrap">{formatMoney(v, currency || undefined)}</span> })),
                { key: 'total', header: 'Total', align: 'right', sortable: true, render: (v) => <span className="font-mono tabular-nums font-semibold whitespace-nowrap">{formatMoney(v, currency || undefined)}</span> },
              ]}
              empty={{ icon: Scale, title: 'Nothing owed to suppliers', message: 'Authorized and received purchase orders with an unpaid balance appear here.' }}
            />
          </div>

          <div className="bg-card rounded-lg border shadow-sm p-4">
            <h3 className="font-medium mb-3">Open supplier bills</h3>
            <AdvancedDataTable<DetailRow>
              data={detail}
              loading={loading}
              keyExtractor={(r) => r.id}
              searchable
              searchPlaceholder="Search PO or supplier..."
              pagination={{ enabled: true, pageSize: 20 }}
              columns={[
                { key: 'poNumber', header: 'PO', sortable: true, render: (v) => <span className="font-mono text-sm whitespace-nowrap">{v}</span> },
                { key: 'supplierName', header: 'Supplier', sortable: true },
                { key: 'orderDate', header: 'Ordered', sortable: true, render: (v) => formatDate(v) },
                { key: 'paymentTerms', header: 'Terms', render: (v) => v || '—' },
                { key: 'totalAmount', header: 'Billed', align: 'right', render: (v, r) => <span className="font-mono tabular-nums whitespace-nowrap">{formatMoney(v, r.currency)}</span> },
                { key: 'paidAmount', header: 'Paid', align: 'right', render: (v, r) => <span className="font-mono tabular-nums whitespace-nowrap">{formatMoney(v, r.currency)}</span> },
                { key: 'balanceAmount', header: 'Owed', align: 'right', sortable: true, render: (v, r) => <span className="font-mono tabular-nums font-semibold whitespace-nowrap">{formatMoney(v, r.currency)}</span> },
                { key: 'bucketLabel', header: 'Age', render: (v, r) => <span className="text-sm">{v} <span className="text-muted-foreground">({r.daysOverdue} d)</span></span> },
              ]}
              empty={{ icon: Scale, title: 'No open supplier bills' }}
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
