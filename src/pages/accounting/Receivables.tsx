import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { toast } from '@/lib/notify';
import { Users, RefreshCw, Search, Clock, AlertTriangle, CheckCircle2, FileText, BarChart3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState, StatusBadge } from '@/components/common';
import { apiFetch, formatCurrency } from '@/utils/accountingApi';
import { useCurrency } from '@/contexts/CurrencyContext';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

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

const Receivables: React.FC = () => {
  const { user } = useAuth();
  const { currency: baseCurrencyData } = useCurrency();
  const BASE_CURRENCY = baseCurrencyData.code;
  const [loading, setLoading] = useState(false);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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

  const getItemStatus = (item: Receivable) => {
    if (item.status === 'paid') return 'paid';
    if (new Date(item.due_date) < new Date()) return 'overdue';
    return 'current';
  };

  const filteredReceivables = useMemo(() => {
    return receivables.filter(item => {
      const matchesSearch = !searchQuery ||
        item.invoice_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.patient_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.patient_id?.toLowerCase().includes(searchQuery.toLowerCase());
      const itemStatus = getItemStatus(item);
      const matchesStatus = statusFilter === 'all' || itemStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [receivables, searchQuery, statusFilter]);

  const RECEIVABLE_STATUS_MAP = { paid: 'success', overdue: 'danger', current: 'warning' } as const;
  const RECEIVABLE_STATUS_ICON: Record<string, React.ReactNode> = {
    paid: <CheckCircle2 className="w-3 h-3 mr-1" />,
    overdue: <AlertTriangle className="w-3 h-3 mr-1" />,
    current: <Clock className="w-3 h-3 mr-1" />,
  };
  const getStatusBadge = (item: Receivable) => {
    const status = getItemStatus(item);
    const label = status === 'paid' ? 'Paid' : status === 'overdue' ? 'Overdue' : 'Current';
    return (
      <StatusBadge
        status={status}
        map={RECEIVABLE_STATUS_MAP}
        label={<span className="inline-flex items-center">{RECEIVABLE_STATUS_ICON[status]}{label}</span>}
      />
    );
  };

  const getDaysOverdue = (dueDate: string) => {
    const diff = Math.floor((new Date().getTime() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<BarChart3 />}
          title="Accounts Receivable"
          actions={
            <Button onClick={loadReceivables} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
          }
        />
        {loading && <LoadingState message="Loading receivables..." />}

        {/* Search & Filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search invoice or patient..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>
          <Combobox
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'current', label: 'Current' },
              { value: 'overdue', label: 'Overdue' },
              { value: 'paid', label: 'Paid' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="All Status"
            searchPlaceholder="Search..."
            className="w-[140px]"
          />
          {(searchQuery || statusFilter !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>Clear</Button>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {filteredReceivables.length} of {receivables.length} records
          </span>
        </div>

        {/* Table */}
        <Card className="bg-primary/10 border-primary/15">
          <CardContent className="p-4">
            <AdvancedDataTable<Receivable>
              data={filteredReceivables}
              keyExtractor={(item) => item.id}
              emptyMessage={receivables.length === 0 ? 'No receivables found. Receivables are created from patient billing.' : 'No records match your filter criteria.'}
              rowClassName={(item) => getItemStatus(item) === 'overdue' ? 'bg-red-50/30 dark:bg-red-950/10' : ''}
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'invoice_number', header: 'Invoice #', sortable: true, render: (v) => <span className="font-mono font-medium">{v}</span> },
                { key: 'patient_name', header: 'Patient', render: (v, item) => <p className="font-medium">{v || item.patient_id}</p> },
                { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (v) => <span className="font-mono">{formatCurrency(v)}</span> },
                { key: 'paid_amount', header: 'Paid', align: 'right', sortable: true, render: (v) => <span className="font-mono text-emerald-600">{formatCurrency(v)}</span> },
                { key: 'balance', header: 'Balance', align: 'right', sortable: true, render: (v) => <span className="font-mono font-medium">{formatCurrency(v)}</span> },
                {
                  key: '__progress', header: 'Payment Progress', width: '9rem',
                  render: (_v, item) => {
                    const paidPct = item.amount > 0 ? (item.paid_amount / item.amount * 100) : 0;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div className={`h-2 rounded-full transition-all ${paidPct >= 100 ? 'bg-emerald-500' : paidPct > 0 ? 'bg-primary/100' : 'bg-muted'}`}
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
                    const isOverdue = getItemStatus(item) === 'overdue';
                    const daysOver = getDaysOverdue(v);
                    return (
                      <div>
                        <p>{new Date(v).toLocaleDateString()}</p>
                        {isOverdue && daysOver > 0 && (
                          <p className="text-xs text-red-600 font-medium">{daysOver} days overdue</p>
                        )}
                      </div>
                    );
                  },
                },
                { key: '__status', header: 'Status', align: 'center', render: (_v, item) => getStatusBadge(item) },
              ]}
            />
            {filteredReceivables.length > 0 && (
              <div className="border border-t-0 border-border rounded-b-md bg-muted/40 -mt-px px-4 py-3 flex justify-between text-sm font-bold">
                <span>TOTALS</span>
                <span className="font-mono flex gap-6">
                  <span>{formatCurrency(filteredReceivables.reduce((s, r) => s + r.amount, 0))}</span>
                  <span className="text-emerald-600">{formatCurrency(filteredReceivables.reduce((s, r) => s + r.paid_amount, 0))}</span>
                  <span>{formatCurrency(filteredReceivables.reduce((s, r) => s + r.balance, 0))}</span>
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
    </AppLayout>
  );
};

export default Receivables;
