import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/lib/notify';
import { Plus, Eye, Edit, Building2, CreditCard, Landmark, TrendingUp, TrendingDown, RefreshCw, Save, FileSpreadsheet, BarChart3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { apiFetch, formatCurrency, Account, BASE_CURRENCY } from '@/utils/accountingApi';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

const ACCOUNT_TYPE_TONE_MAP: Record<string, StatusBadgeTone> = {
  asset: 'primary',
  liability: 'danger',
  equity: 'info',
  revenue: 'success',
  expense: 'warning',
};

const ACTIVE_TONE_MAP: Record<string, StatusBadgeTone> = {
  active: 'success',
  inactive: 'neutral',
};

const ACCOUNT_TYPES = [
  { value: 'asset', label: 'Asset', icon: Building2, color: 'text-primary', bg: 'bg-primary/10 dark:bg-primary/20' },
  { value: 'liability', label: 'Liability', icon: CreditCard, color: 'text-destructive', bg: 'bg-destructive-bg dark:bg-destructive' },
  { value: 'equity', label: 'Equity', icon: Landmark, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950' },
  { value: 'revenue', label: 'Revenue', icon: TrendingUp, color: 'text-success', bg: 'bg-success-bg dark:bg-success' },
  { value: 'expense', label: 'Expense', icon: TrendingDown, color: 'text-warning', bg: 'bg-warning-bg dark:bg-warning' },
];

const emptyForm = {
  account_code: '', account_name: '', account_type: 'asset', sub_account_type: '',
  balance_type: 'debit', opening_balance: 0, description: '',
  is_bank_account: false, is_customer_account: false, is_supplier_account: false
};

// Hoisted to module scope (not defined inside ChartOfAccounts) so it keeps a stable
// component identity across renders — defining it inline recreated it on every keystroke,
// which made React unmount/remount the inputs and drop focus after each character typed.
const AccountFormFields = ({ data, setData }: { data: typeof emptyForm; setData: (fn: (prev: typeof emptyForm) => typeof emptyForm) => void }) => (
  <div className="px-5 py-4 space-y-4">
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label>Account Code</Label>
        <Input value={data.account_code}
          onChange={(e) => setData(prev => ({ ...prev, account_code: e.target.value }))}
          placeholder="e.g., 1100" />
      </div>
      <div className="space-y-1.5">
        <Label>Account Type</Label>
        <Combobox
          options={ACCOUNT_TYPES.map(t => ({ value: t.value, label: t.label }))}
          value={data.account_type}
          onChange={(value) => setData(prev => ({ ...prev, account_type: value }))}
          searchPlaceholder="Search types..."
        />
      </div>
    </div>
    <div className="space-y-1.5">
      <Label>Account Name</Label>
      <Input value={data.account_name}
        onChange={(e) => setData(prev => ({ ...prev, account_name: e.target.value }))}
        placeholder="e.g., Cash and Cash Equivalents" />
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label>Balance Type</Label>
        <Combobox
          options={[{ value: 'debit', label: 'Debit' }, { value: 'credit', label: 'Credit' }]}
          value={data.balance_type}
          onChange={(value) => setData(prev => ({ ...prev, balance_type: value }))}
          searchPlaceholder="Search..."
        />
      </div>
      <div className="space-y-1.5">
        <Label>Opening Balance ({BASE_CURRENCY})</Label>
        <Input type="number" step="0.01" value={data.opening_balance}
          onChange={(e) => setData(prev => ({ ...prev, opening_balance: parseFloat(e.target.value) || 0 }))} />
      </div>
    </div>
    <div className="space-y-1.5">
      <Label>Description</Label>
      <Textarea value={data.description}
        onChange={(e) => setData(prev => ({ ...prev, description: e.target.value }))}
        placeholder="Account description (optional)" rows={2} />
    </div>
  </div>
);

const ChartOfAccounts: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filterType, setFilterType] = useState('all');
  // Off by default — most accounts in a fresh chart of accounts seed never end up used,
  // and showing every one of them by default is exactly the clutter this filter exists
  // to hide. Reactivating one (or creating a new one) is still one click away.
  const [showInactive, setShowInactive] = useState(false);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [viewAccount, setViewAccount] = useState<Account | null>(null);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [accountFormData, setAccountFormData] = useState({ ...emptyForm });
  const [editFormData, setEditFormData] = useState({ ...emptyForm });

  useEffect(() => {
    if (user?.clinic) loadAccounts();
  }, [user]);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const response = await apiFetch(`/api/accounting/chart-of-accounts?clinic_id=${user?.clinic}`);
      if (response.ok) setAccounts(await response.json());
    } catch (error) {
      console.error('Error loading accounts:', error);
      toast.error('Failed to load chart of accounts');
    } finally {
      setLoading(false);
    }
  };

  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      const matchesType = filterType === 'all' || acc.account_type === filterType;
      const matchesActive = showInactive || acc.is_active !== false;
      return matchesType && matchesActive;
    });
  }, [accounts, filterType, showInactive]);

  const initializeChartOfAccounts = async () => {
    try {
      setLoading(true);
      const response = await apiFetch('/api/accounting/chart-of-accounts/initialize', {
        method: 'POST',
        body: JSON.stringify({ clinic_id: user?.clinic })
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          toast.success(result.message);
          await loadAccounts();
        } else {
          toast.info(result.message);
        }
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to initialize');
      }
    } catch (error) {
      toast.error('Failed to initialize chart of accounts');
    } finally {
      setLoading(false);
    }
  };

  const createAccount = async () => {
    try {
      setLoading(true);
      const response = await apiFetch('/api/accounting/chart-of-accounts', {
        method: 'POST',
        body: JSON.stringify({ ...accountFormData, clinic_id: user?.clinic })
      });
      if (response.ok) {
        toast.success('Account created successfully');
        setShowAccountDialog(false);
        setAccountFormData({ ...emptyForm });
        await loadAccounts();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to create account');
      }
    } catch (error) {
      toast.error('Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleView = (account: Account) => {
    setViewAccount(account);
    setShowViewDialog(true);
  };

  const handleEdit = (account: Account) => {
    setEditAccount(account);
    setEditFormData({
      account_code: account.account_code,
      account_name: account.account_name,
      account_type: account.account_type,
      sub_account_type: account.sub_account_type || '',
      balance_type: account.balance_type,
      opening_balance: parseFloat(String(account.opening_balance || 0)),
      description: account.description || '',
      is_bank_account: account.is_bank_account || false,
      is_customer_account: account.is_customer_account || false,
      is_supplier_account: account.is_supplier_account || false
    });
    setShowEditDialog(true);
  };

  const saveEdit = async () => {
    if (!editAccount) return;
    try {
      setLoading(true);
      const response = await apiFetch(`/api/accounting/chart-of-accounts/${editAccount.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...editFormData, clinic_id: user?.clinic })
      });
      if (response.ok) {
        toast.success('Account updated successfully');
        setShowEditDialog(false);
        setEditAccount(null);
        await loadAccounts();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to update account');
      }
    } catch (error) {
      toast.error('Failed to update account');
    } finally {
      setLoading(false);
    }
  };



  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<BarChart3 />}
          title="Chart of Accounts"
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={initializeChartOfAccounts} variant="outline" disabled={loading}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                {accounts.length === 0 ? 'Initialize Defaults' : 'Add Missing Defaults'}
              </Button>
              <Button onClick={() => setShowAccountDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />Add Account
              </Button>
            </div>
          }
        />
        {loading && <LoadingState message="Loading accounts..." />}

        {/* Add Account Dialog */}
        <Dialog open={showAccountDialog} onOpenChange={setShowAccountDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Account</DialogTitle>
              <DialogDescription>Add a new account to your chart of accounts</DialogDescription>
            </DialogHeader>
            <AccountFormFields data={accountFormData} setData={setAccountFormData} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAccountDialog(false)}>Cancel</Button>
              <Button onClick={createAccount} disabled={loading}>Create Account</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Accounts Table */}
            <AdvancedDataTable<Account>
              title="Accounts"
              countLabel={['account', 'accounts']}
              toolbarExtra={
                <>
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap px-1">
                    <input type="checkbox" className="rounded border-input" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                    Show inactive
                  </label>
                  <Button variant="outline" size="icon" aria-label="Refresh" className="h-8 w-8" onClick={loadAccounts} disabled={loading}>
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </>
              }
              data={filteredAccounts}
              keyExtractor={(account) => account.id}
              emptyMessage={accounts.length === 0 ? 'No accounts found. Initialize default accounts or add one manually.' : 'No accounts match your search criteria.'}
              pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
              searchable
              searchPlaceholder="Search by code or name..."
              exportable
              exportFileName="chart-of-accounts"
              columns={[
                { key: 'account_code', header: 'Code', sortable: true, render: (v) => <span className="font-mono">{v}</span> },
                { key: 'account_name', header: 'Account Name', sortable: true },
                { key: 'account_type', header: 'Type', sortable: true, render: (v) => <StatusBadge status={v} map={ACCOUNT_TYPE_TONE_MAP} /> },
                { key: 'balance_type', header: 'Normal Balance', render: (v) => <span className="capitalize">{v}</span> },
                { key: 'opening_balance', header: 'Opening Balance', align: 'right', render: (v) => <span className="font-mono">{formatCurrency(v)}</span> },
                {
                  key: 'current_balance', header: 'Current Balance', align: 'right', sortable: true,
                  render: (v) => <span className="font-mono">{formatCurrency(v || 0)}</span>,
                },
                {
                  key: 'is_active', header: 'Status', align: 'center',
                  render: (v) => <StatusBadge status={v !== false ? 'active' : 'inactive'} map={ACTIVE_TONE_MAP} label={v !== false ? 'Active' : 'Inactive'} />,
                },
                {
                  key: '__actions', header: 'Actions', align: 'center',
                  render: (_v, account) => (
                    <div className="flex items-center justify-center space-x-1">
                      <Button size="icon" aria-label="View" variant="ghost" onClick={() => handleView(account)} title="View">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" aria-label="Edit" variant="ghost" onClick={() => handleEdit(account)} title="Edit">
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ),
                },
              ]}
            />

        {/* View Dialog */}
        <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono">{viewAccount?.account_code}</span> &mdash; {viewAccount?.account_name}
              </DialogTitle>
              <DialogDescription>Account details</DialogDescription>
            </DialogHeader>
            {viewAccount && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Account Type</Label>
                    <p><StatusBadge status={viewAccount.account_type} map={ACCOUNT_TYPE_TONE_MAP} /></p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Normal Balance</Label>
                    <p className="text-sm font-medium capitalize">{viewAccount.balance_type}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Opening Balance</Label>
                    <p className="text-sm font-mono font-medium">{formatCurrency(viewAccount.opening_balance)}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Current Balance</Label>
                    <p className="text-sm font-mono font-medium">{formatCurrency(viewAccount.current_balance || 0)}</p>
                  </div>
                </div>
                {viewAccount.description && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Description</Label>
                    <p className="text-sm">{viewAccount.description}</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {viewAccount.is_bank_account && <Badge variant="outline">Bank Account</Badge>}
                  {viewAccount.is_customer_account && <Badge variant="outline">Customer Account</Badge>}
                  {viewAccount.is_supplier_account && <Badge variant="outline">Supplier Account</Badge>}
                  <StatusBadge
                    status={viewAccount.is_active !== false ? 'active' : 'inactive'}
                    map={ACTIVE_TONE_MAP}
                    label={viewAccount.is_active !== false ? 'Active' : 'Inactive'}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => { setShowViewDialog(false); handleEdit(viewAccount); }}>
                    <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                  <Button variant="outline" onClick={() => setShowViewDialog(false)}>Close</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Account: {editAccount?.account_code}</DialogTitle>
              <DialogDescription>Update account details</DialogDescription>
            </DialogHeader>
            <AccountFormFields data={editFormData} setData={setEditFormData} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={loading}>
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default ChartOfAccounts;
