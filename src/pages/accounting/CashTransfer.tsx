import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ArrowRightLeft, Download, RefreshCw, BarChart3, Loader2 } from 'lucide-react';
import { formatCurrency, BASE_CURRENCY } from '@/utils/accountingApi';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface LedgerAccount {
  id: string;
  account_name: string;
  account_code: string;
  balance: number;
  current_balance?: number;
  account_type?: string;
  is_active?: boolean;
}

interface Transfer {
  id: number;
  from_account_name: string;
  to_account_name: string;
  amount: number;
  notes: string;
  created_at?: string;
  createdAt?: string;
}

const CashTransfer: React.FC = () => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.clinic) {
      loadAll();
    }
  }, [user]);

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([fetchAccounts(), fetchTransfers()]);
    setLoading(false);
  };

  const fetchAccounts = async () => {
    try {
      const clinicId = user?.clinic || 1;
      const response = await authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`);
      if (response.ok) {
        const data = await response.json();
        setAccounts(data.filter((a: LedgerAccount) => a.is_active !== false));
      }
    } catch (error) {
      console.error('Failed to fetch accounts');
    }
  };

  const fetchTransfers = async () => {
    try {
      const response = await authFetch('/api/cash-transfers');
      if (response.ok) {
        const data = await response.json();
        setTransfers(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to fetch transfers');
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!fromAccount || !toAccount) {
      toast.error('Please select both accounts');
      return;
    }
    if (fromAccount === toAccount) {
      toast.error('Source and destination must be different');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    try {
      setSubmitting(true);
      const response = await authFetch('/api/cash-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_account_id: fromAccount,
          to_account_id: toAccount,
          amount: parseFloat(amount),
          notes: notes || 'Cash transfer'
        })
      });

      if (!response.ok) throw new Error('Transfer failed');

      toast.success('Transfer completed successfully');
      setFromAccount('');
      setToAccount('');
      setAmount('');
      setNotes('');
      loadAll();
    } catch (error) {
      toast.error('Failed to complete transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const csvField = (value: unknown): string => {
    let s = value == null ? '' : String(value);
    // Neutralize CSV formula injection (Excel/Sheets execute leading =,+,-,@)
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const downloadCSV = () => {
    const csv = [
      ['Date', 'From Account', 'To Account', 'Amount', 'Notes'],
      ...transfers.map(t => [
        new Date(t.created_at).toLocaleDateString(),
        t.from_account_name,
        t.to_account_name,
        parseFloat(String(t.amount)).toFixed(2),
        t.notes
      ])
    ].map(row => row.map(csvField).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cash-transfers-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getAccountBalance = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId);
    const bal = account?.current_balance ?? account?.balance ?? 0;
    return parseFloat(String(bal));
  };

  const parseDate = (val?: string) => {
    if (!val) return null;
    const d = new Date(val.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  };

  const getCreatedAt = (t: Transfer) => t.createdAt || t.created_at;

  const fmtDate = (val: string) => {
    const d = parseDate(val);
    return d ? d.toLocaleDateString() : '—';
  };

  const fmtTime = (val: string) => {
    const d = parseDate(val);
    return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<BarChart3 />}
          title="Cash Transfer"
          actions={
            <Button onClick={loadAll} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
          }
        />
        {loading && <LoadingState message="Loading accounts..." />}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Transfer Form */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30">
              <h3 className="font-medium flex items-center gap-2 text-sm">
                <ArrowRightLeft className="w-4 h-4 text-primary" /> Transfer Funds
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Move funds between GL accounts</p>
            </div>
            <form onSubmit={handleTransfer} className="p-4 space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">From Account</Label>
                <Combobox
                  options={accounts.map(account => ({ value: account.id.toString(), label: account.account_name }))}
                  value={fromAccount}
                  onChange={setFromAccount}
                  placeholder="Select source account"
                  searchPlaceholder="Search accounts..."
                />
                {fromAccount && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Balance: {formatCurrency(getAccountBalance(fromAccount))}
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">To Account</Label>
                <Combobox
                  options={accounts.filter(a => a.id.toString() !== fromAccount).map(account => ({ value: account.id.toString(), label: account.account_name }))}
                  value={toAccount}
                  onChange={setToAccount}
                  placeholder="Select destination account"
                  searchPlaceholder="Search accounts..."
                />
                {toAccount && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Balance: {formatCurrency(getAccountBalance(toAccount))}
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Amount ({BASE_CURRENCY})</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="font-mono"
                  required
                />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Notes (Optional)</Label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Transfer notes..."
                  rows={3}
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 mr-2" />}
                {submitting ? 'Processing...' : 'Transfer Funds'}
              </Button>
            </form>
          </div>

          {/* Transfer History */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-sm">Transfer History</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{transfers.length} transfers recorded</p>
              </div>
              {transfers.length > 0 && (
                <Button size="sm" variant="outline" onClick={downloadCSV} className="gap-1.5">
                  <Download className="w-4 h-4" />
                  CSV
                </Button>
              )}
            </div>
            <div className="max-h-[460px] overflow-y-auto p-4">
              <AdvancedDataTable<Transfer>
                data={transfers}
                keyExtractor={(transfer) => transfer.id}
                emptyMessage="No transfers yet"
                columns={[
                  {
                    key: '__date', header: 'Date',
                    render: (_v, transfer) => (
                      <>
                        <p className="text-sm">{fmtDate(getCreatedAt(transfer))}</p>
                        <p className="text-xs text-muted-foreground">{fmtTime(getCreatedAt(transfer))}</p>
                      </>
                    ),
                  },
                  {
                    key: '__from_to', header: 'From → To',
                    render: (_v, transfer) => (
                      <>
                        <div className="flex items-center gap-1 flex-wrap">
                          <Badge variant="outline" className="text-xs font-normal">{transfer.from_account_name}</Badge>
                          <ArrowRightLeft className="w-3 h-3 text-muted-foreground shrink-0" />
                          <Badge variant="outline" className="text-xs font-normal">{transfer.to_account_name}</Badge>
                        </div>
                        {transfer.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]">{transfer.notes}</p>
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'amount', header: 'Amount', align: 'right',
                    render: (v) => <span className="font-mono font-medium">{formatCurrency(parseFloat(String(v || 0)))}</span>,
                  },
                  {
                    key: '__status', header: 'Status', align: 'right',
                    render: () => <StatusBadge status="completed" map={{ completed: 'success' }} label="Completed" />,
                  },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
      </div>
    </AppLayout>
  );
};

export default CashTransfer;
