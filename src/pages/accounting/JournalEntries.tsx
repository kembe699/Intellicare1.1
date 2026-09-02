import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Plus, Eye, Edit, Save, X, Send, CheckCircle, BookOpen, XCircle, RotateCcw, RefreshCw, Search, FileText, TrendingUp, TrendingDown, BarChart3, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader, LoadingState, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { AppLayout } from '@/components/layout/AppLayout';
import { apiFetch, formatCurrency, Account, JournalEntry, CurrencyCode } from '@/utils/accountingApi';
import { useCurrency } from '@/contexts/CurrencyContext';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

const JE_STATUS_TONE_MAP: Record<string, StatusBadgeTone> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'primary',
  posted: 'success',
  rejected: 'danger',
};

const JournalEntriesPage: React.FC = () => {
  const { user } = useAuth();
  const { currency: baseCurrencyData } = useCurrency();
  const BASE_CURRENCY = baseCurrencyData.code;
  const [availableCurrencies, setAvailableCurrencies] = useState<{ code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [showJEDialog, setShowJEDialog] = useState(false);
  const [viewEntry, setViewEntry] = useState<JournalEntry | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [editEntry, setEditEntry] = useState<JournalEntry | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editFormData, setEditFormData] = useState<{
    entry_date: string; description: string; narration: string; reference: string;
    transaction_currency: CurrencyCode; exchange_rate: number;
    lines: { account_id: string; debit_amount: number; credit_amount: number; description: string }[];
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [statusActionKey, setStatusActionKey] = useState<string | null>(null);
  const [jeFormData, setJeFormData] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    description: '',
    narration: '',
    reference: '',
    transaction_currency: '' as CurrencyCode,
    exchange_rate: 1.0,
    lines: [
      { account_id: '', debit_amount: 0, credit_amount: 0, description: '' },
      { account_id: '', debit_amount: 0, credit_amount: 0, description: '' }
    ]
  });

  const fetchExchangeRate = async (currency: CurrencyCode) => {
    if (currency === BASE_CURRENCY) {
      setJeFormData(prev => ({ ...prev, transaction_currency: currency, exchange_rate: 1.0 }));
      return;
    }
    try {
      const response = await apiFetch(`/api/accounting/exchange-rates/current?clinic_id=${user?.clinic}&from_currency=${currency}&to_currency=${BASE_CURRENCY}`);
      if (response.ok) {
        const data = await response.json();
        setJeFormData(prev => ({ ...prev, transaction_currency: currency, exchange_rate: data.rate }));
      } else {
        toast.error(`No exchange rate found for ${currency} to ${BASE_CURRENCY}. Please set one in Exchange Rates first or enter manually.`);
        setJeFormData(prev => ({ ...prev, transaction_currency: currency, exchange_rate: 0 }));
      }
    } catch {
      setJeFormData(prev => ({ ...prev, transaction_currency: currency, exchange_rate: 0 }));
    }
  };

  useEffect(() => {
    if (user?.clinic) {
      loadAccounts();
      loadJournalEntries();
    }
  }, [user]);

  useEffect(() => {
    if (!BASE_CURRENCY) return;
    setJeFormData(prev => ({ ...prev, transaction_currency: prev.transaction_currency || BASE_CURRENCY }));
    apiFetch('/api/exchange-rates/currencies').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.data?.length) setAvailableCurrencies(d.data.map((c: any) => ({ code: c.code, name: c.name })));
      else if (BASE_CURRENCY) setAvailableCurrencies([{ code: BASE_CURRENCY, name: baseCurrencyData.name }]);
    }).catch(() => {});
  }, [BASE_CURRENCY]);

  const filteredEntries = useMemo(() => {
    return journalEntries.filter(entry => {
      const matchesSearch = !searchQuery ||
        entry.je_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || entry.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [journalEntries, searchQuery, statusFilter]);

  const loadAccounts = async () => {
    try {
      const response = await apiFetch(`/api/accounting/chart-of-accounts?clinic_id=${user?.clinic}`);
      if (response.ok) {
        const data = await response.json();
        setAccounts(data);
      }
    } catch (error) {
      console.error('Error loading accounts:', error);
    }
  };

  const loadJournalEntries = async () => {
    try {
      const response = await apiFetch(`/api/accounting/journal-entries?clinic_id=${user?.clinic}`);
      if (response.ok) {
        const data = await response.json();
        setJournalEntries(data);
      }
    } catch (error) {
      console.error('Error loading journal entries:', error);
      toast.error('Failed to load journal entries');
    }
  };

  const createJournalEntry = async () => {
    if (loading) return;
    try {
      setLoading(true);
      const response = await apiFetch('/api/accounting/journal-entries', {
        method: 'POST',
        body: JSON.stringify({
          ...jeFormData,
          clinic_id: user?.clinic,
          transaction_currency: jeFormData.transaction_currency,
          exchange_rate: jeFormData.exchange_rate
        })
      });
      if (response.ok) {
        toast.success('Journal entry created successfully');
        setShowJEDialog(false);
        setJeFormData({
          entry_date: new Date().toISOString().split('T')[0],
          description: '', narration: '', reference: '',
          transaction_currency: BASE_CURRENCY as CurrencyCode,
          exchange_rate: 1.0,
          lines: [
            { account_id: '', debit_amount: 0, credit_amount: 0, description: '' },
            { account_id: '', debit_amount: 0, credit_amount: 0, description: '' }
          ]
        });
        await loadJournalEntries();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to create journal entry');
      }
    } catch (error) {
      console.error('Error creating journal entry:', error);
      toast.error('Failed to create journal entry');
    } finally {
      setLoading(false);
    }
  };

  const addJournalEntryLine = () => {
    setJeFormData(prev => ({
      ...prev,
      lines: [...prev.lines, { account_id: '', debit_amount: 0, credit_amount: 0, description: '' }]
    }));
  };

  const updateJournalEntryLine = (index: number, field: string, value: any) => {
    setJeFormData(prev => ({
      ...prev,
      lines: prev.lines.map((line, i) => i === index ? { ...line, [field]: value } : line)
    }));
  };

  const removeJournalEntryLine = (index: number) => {
    if (jeFormData.lines.length > 2) {
      setJeFormData(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));
    }
  };

  const calculateJETotals = () => {
    const totalDebits = jeFormData.lines.reduce((sum, line) => sum + (parseFloat(line.debit_amount.toString()) || 0), 0);
    const totalCredits = jeFormData.lines.reduce((sum, line) => sum + (parseFloat(line.credit_amount.toString()) || 0), 0);
    return { totalDebits, totalCredits, isBalanced: Math.abs(totalDebits - totalCredits) < 0.01 };
  };

  // ===== VIEW =====
  const handleView = async (entry: JournalEntry) => {
    try {
      const response = await apiFetch(`/api/accounting/journal-entries/${entry.id}`);
      if (response.ok) {
        const data = await response.json();
        setViewEntry(data);
        setShowViewDialog(true);
      } else {
        setViewEntry(entry);
        setShowViewDialog(true);
      }
    } catch {
      setViewEntry(entry);
      setShowViewDialog(true);
    }
  };

  // ===== EDIT =====
  const handleEdit = async (entry: JournalEntry) => {
    if (entry.status !== 'draft') {
      toast.error('Only draft entries can be edited');
      return;
    }
    try {
      const response = await apiFetch(`/api/accounting/journal-entries/${entry.id}`);
      const data = response.ok ? await response.json() : entry;
      setEditEntry(data);
      setEditFormData({
        entry_date: data.entry_date?.split('T')[0] || data.entry_date,
        description: data.description || '',
        narration: data.narration || '',
        reference: data.reference || '',
        transaction_currency: (data.transaction_currency || BASE_CURRENCY) as CurrencyCode,
        exchange_rate: parseFloat(data.exchange_rate) || 1.0,
        lines: (data.lines || []).map((l: any) => ({
          account_id: l.account_id,
          debit_amount: parseFloat(l.debit_amount) || 0,
          credit_amount: parseFloat(l.credit_amount) || 0,
          description: l.description || ''
        }))
      });
      setShowEditDialog(true);
    } catch {
      toast.error('Failed to load journal entry for editing');
    }
  };

  const fetchEditExchangeRate = async (currency: CurrencyCode) => {
    if (currency === BASE_CURRENCY) {
      setEditFormData(prev => prev ? { ...prev, transaction_currency: currency, exchange_rate: 1.0 } : prev);
      return;
    }
    try {
      const response = await apiFetch(`/api/accounting/exchange-rates/current?clinic_id=${user?.clinic}&from_currency=${currency}&to_currency=${BASE_CURRENCY}`);
      if (response.ok) {
        const data = await response.json();
        setEditFormData(prev => prev ? { ...prev, transaction_currency: currency, exchange_rate: data.rate } : prev);
      } else {
        toast.error(`No exchange rate found for ${currency} to ${BASE_CURRENCY}`);
        setEditFormData(prev => prev ? { ...prev, transaction_currency: currency, exchange_rate: 0 } : prev);
      }
    } catch {
      setEditFormData(prev => prev ? { ...prev, transaction_currency: currency, exchange_rate: 0 } : prev);
    }
  };

  const addEditLine = () => {
    setEditFormData(prev => prev ? {
      ...prev,
      lines: [...prev.lines, { account_id: '', debit_amount: 0, credit_amount: 0, description: '' }]
    } : prev);
  };

  const updateEditLine = (index: number, field: string, value: any) => {
    setEditFormData(prev => prev ? {
      ...prev,
      lines: prev.lines.map((line, i) => i === index ? { ...line, [field]: value } : line)
    } : prev);
  };

  const removeEditLine = (index: number) => {
    if (editFormData && editFormData.lines.length > 2) {
      setEditFormData(prev => prev ? { ...prev, lines: prev.lines.filter((_, i) => i !== index) } : prev);
    }
  };

  const calcEditTotals = () => {
    if (!editFormData) return { totalDebits: 0, totalCredits: 0, isBalanced: false };
    const totalDebits = editFormData.lines.reduce((sum, line) => sum + (parseFloat(line.debit_amount.toString()) || 0), 0);
    const totalCredits = editFormData.lines.reduce((sum, line) => sum + (parseFloat(line.credit_amount.toString()) || 0), 0);
    return { totalDebits, totalCredits, isBalanced: Math.abs(totalDebits - totalCredits) < 0.01 };
  };

  // ===== STATUS CHANGES =====
  const changeStatus = async (entryId: string, action: string, label: string) => {
    if (loading) return;
    try {
      setLoading(true);
      setStatusActionKey(`${entryId}-${action}`);
      const response = await apiFetch(`/api/accounting/journal-entries/${entryId}/${action}`, {
        method: 'POST'
      });
      if (response.ok) {
        toast.success(`Journal entry ${label} successfully`);
        await loadJournalEntries();
        if (showViewDialog) {
          const updated = await apiFetch(`/api/accounting/journal-entries/${entryId}`);
          if (updated.ok) setViewEntry(await updated.json());
        }
      } else {
        const error = await response.json();
        toast.error(error.error || `Failed to ${label} journal entry`);
      }
    } catch (error) {
      console.error(`Error ${action} journal entry:`, error);
      toast.error(`Failed to ${label} journal entry`);
    } finally {
      setLoading(false);
      setStatusActionKey(null);
    }
  };

  const getStatusActions = (entry: JournalEntry) => {
    const actions: { label: string; action: string; icon: React.ReactNode; variant: 'default' | 'outline' | 'destructive' }[] = [];
    switch (entry.status) {
      case 'draft':
        actions.push({ label: 'Submit', action: 'submit', icon: <Send className="w-3 h-3" />, variant: 'default' });
        break;
      case 'submitted':
        actions.push({ label: 'Approve', action: 'approve', icon: <CheckCircle className="w-3 h-3" />, variant: 'default' });
        actions.push({ label: 'Reject', action: 'reject', icon: <XCircle className="w-3 h-3" />, variant: 'destructive' });
        break;
      case 'approved':
        actions.push({ label: 'Post', action: 'post', icon: <BookOpen className="w-3 h-3" />, variant: 'default' });
        actions.push({ label: 'Reject', action: 'reject', icon: <XCircle className="w-3 h-3" />, variant: 'destructive' });
        break;
      case 'rejected':
        actions.push({ label: 'Revert to Draft', action: 'revert-to-draft', icon: <RotateCcw className="w-3 h-3" />, variant: 'outline' });
        break;
    }
    return actions;
  };

  const saveEdit = async () => {
    if (!editEntry || !editFormData) return;
    if (loading) return;
    try {
      setLoading(true);
      const response = await apiFetch(`/api/accounting/journal-entries/${editEntry.id}`, {
        method: 'PUT',
        body: JSON.stringify(editFormData)
      });
      if (response.ok) {
        toast.success('Journal entry updated successfully');
        setShowEditDialog(false);
        setEditEntry(null);
        setEditFormData(null);
        await loadJournalEntries();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to update journal entry');
      }
    } catch (error) {
      console.error('Error updating journal entry:', error);
      toast.error('Failed to update journal entry');
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
          title="Journal Entries"
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={loadJournalEntries} variant="outline" size="sm" disabled={loading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
              </Button>
              <Button onClick={() => setShowJEDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />New Journal Entry
              </Button>
            </div>
          }
        />

        {/* Create Journal Entry Dialog */}
        <Dialog open={showJEDialog} onOpenChange={setShowJEDialog}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Journal Entry</DialogTitle>
              <DialogDescription>Create a manual journal entry with multiple line items</DialogDescription>
            </DialogHeader>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="entry_date">Entry Date</Label>
                  <Input id="entry_date" type="date" value={jeFormData.entry_date}
                    onChange={(e) => setJeFormData(prev => ({ ...prev, entry_date: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="reference">Reference</Label>
                  <Input id="reference" value={jeFormData.reference}
                    onChange={(e) => setJeFormData(prev => ({ ...prev, reference: e.target.value }))}
                    placeholder="Reference number" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="transaction_currency">Transaction Currency</Label>
                  <Combobox
                    options={availableCurrencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
                    value={jeFormData.transaction_currency}
                    onChange={(value) => fetchExchangeRate(value as CurrencyCode)}
                    searchPlaceholder="Search currencies..."
                  />
                </div>
                <div>
                  <Label htmlFor="exchange_rate">Exchange Rate (to {BASE_CURRENCY})</Label>
                  <Input id="exchange_rate" type="number" step="0.000001"
                    value={jeFormData.exchange_rate}
                    onChange={(e) => setJeFormData(prev => ({ ...prev, exchange_rate: parseFloat(e.target.value) || 0 }))}
                    disabled={jeFormData.transaction_currency === BASE_CURRENCY} />
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input id="description" value={jeFormData.description}
                  onChange={(e) => setJeFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Journal entry description" />
              </div>
              <div>
                <Label htmlFor="narration">Narration</Label>
                <Textarea id="narration" value={jeFormData.narration}
                  onChange={(e) => setJeFormData(prev => ({ ...prev, narration: e.target.value }))}
                  placeholder="Detailed explanation" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-4">
                  <Label>Line Items</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addJournalEntryLine}>
                    <Plus className="w-4 h-4 mr-2" />Add Line
                  </Button>
                </div>
                <div className="space-y-2">
                  {jeFormData.lines.map((line, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-center p-2 border rounded">
                      <div className="col-span-4">
                        <Combobox
                          options={accounts.map((account) => ({ value: account.id, label: `${account.account_code} - ${account.account_name}` }))}
                          value={line.account_id}
                          onChange={(value) => updateJournalEntryLine(index, 'account_id', value)}
                          placeholder="Select account"
                          searchPlaceholder="Search accounts..."
                        />
                      </div>
                      <div className="col-span-2">
                        <Input type="number" step="0.01" placeholder="Debit" value={line.debit_amount}
                          onChange={(e) => updateJournalEntryLine(index, 'debit_amount', parseFloat(e.target.value) || 0)} />
                      </div>
                      <div className="col-span-2">
                        <Input type="number" step="0.01" placeholder="Credit" value={line.credit_amount}
                          onChange={(e) => updateJournalEntryLine(index, 'credit_amount', parseFloat(e.target.value) || 0)} />
                      </div>
                      <div className="col-span-3">
                        <Input placeholder="Description" value={line.description}
                          onChange={(e) => updateJournalEntryLine(index, 'description', e.target.value)} />
                      </div>
                      <div className="col-span-1">
                        <Button type="button" variant="outline" size="sm"
                          onClick={() => removeJournalEntryLine(index)} disabled={jeFormData.lines.length <= 2}>
                          ×
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Total Debits ({jeFormData.transaction_currency}): </span>
                      {formatCurrency(calculateJETotals().totalDebits, jeFormData.transaction_currency)}
                    </div>
                    <div>
                      <span className="font-medium">Total Credits ({jeFormData.transaction_currency}): </span>
                      {formatCurrency(calculateJETotals().totalCredits, jeFormData.transaction_currency)}
                    </div>
                    {jeFormData.transaction_currency !== BASE_CURRENCY && (
                      <div>
                        <span className="font-medium">Base ({BASE_CURRENCY}): </span>
                        {formatCurrency(calculateJETotals().totalDebits * jeFormData.exchange_rate, BASE_CURRENCY)}
                      </div>
                    )}
                    <div>
                      <span className="font-medium">Status: </span>
                      <Badge variant={calculateJETotals().isBalanced ? "default" : "destructive"}>
                        {calculateJETotals().isBalanced ? "Balanced" : "Unbalanced"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowJEDialog(false)}>Cancel</Button>
                <Button onClick={createJournalEntry} disabled={loading || !calculateJETotals().isBalanced}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {loading ? 'Creating...' : 'Create Entry'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Search & Filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search JE number or description..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>
          <Combobox
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'draft', label: 'Draft' },
              { value: 'submitted', label: 'Submitted' },
              { value: 'approved', label: 'Approved' },
              { value: 'posted', label: 'Posted' },
              { value: 'rejected', label: 'Rejected' },
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
            {filteredEntries.length} of {journalEntries.length} entries
          </span>
        </div>

        <Card className="rounded-lg shadow-sm bg-primary/10 border-primary/15">
          <CardContent className="p-4">
            <AdvancedDataTable<JournalEntry>
              data={filteredEntries}
              keyExtractor={(entry) => entry.id}
              emptyMessage={journalEntries.length === 0 ? 'No journal entries found. Click "New Journal Entry" to create one.' : 'No entries match your search criteria.'}
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'je_number', header: 'JE Number', sortable: true, render: (v) => <span className="font-mono text-[13px] font-medium">{v}</span> },
                { key: 'entry_date', header: 'Date', sortable: true, render: (v) => <span className="text-[13px]">{new Date(v).toLocaleDateString()}</span> },
                { key: 'description', header: 'Description', render: (v) => <p className="text-[13px] truncate max-w-[200px]">{v}</p> },
                {
                  key: 'transaction_currency', header: 'Currency',
                  render: (v, entry) => (
                    <>
                      <Badge variant="outline" className="text-xs">{v || BASE_CURRENCY}</Badge>
                      {v && v !== BASE_CURRENCY && (
                        <span className="text-xs text-muted-foreground ml-1">@{entry.exchange_rate}</span>
                      )}
                    </>
                  ),
                },
                { key: 'base_total_debit', header: `Debit (${BASE_CURRENCY})`, align: 'right', sortable: true, render: (v) => <span className="font-mono text-[13px] font-medium">{formatCurrency(v ?? 0)}</span> },
                { key: 'base_total_credit', header: `Credit (${BASE_CURRENCY})`, align: 'right', sortable: true, render: (v) => <span className="font-mono text-[13px] font-medium">{formatCurrency(v ?? 0)}</span> },
                { key: 'status', header: 'Status', align: 'center', sortable: true, render: (v) => <StatusBadge status={v} map={JE_STATUS_TONE_MAP} /> },
                {
                  key: '__actions', header: 'Actions', align: 'center',
                  render: (_v, entry) => (
                    <div className="flex items-center justify-center space-x-1">
                      <Button size="icon" variant="ghost" onClick={() => handleView(entry)} title="View">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {entry.status === 'draft' && (
                        <Button size="icon" variant="ghost" onClick={() => handleEdit(entry)} title="Edit">
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {getStatusActions(entry).map((act) => {
                        const isActive = statusActionKey === `${entry.id}-${act.action}`;
                        return (
                          <Button key={act.action} size="icon" variant={act.variant}
                            onClick={() => changeStatus(entry.id, act.action, act.label)}
                            disabled={loading} title={act.label}>
                            {isActive ? <Loader2 className="w-3 h-3 animate-spin" /> : act.icon}
                          </Button>
                        );
                      })}
                    </div>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
        {/* VIEW DIALOG */}
        <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Journal Entry: {viewEntry?.je_number}</DialogTitle>
              <DialogDescription>View journal entry details</DialogDescription>
            </DialogHeader>
            {viewEntry && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Date</Label>
                    <p className="font-medium">{new Date(viewEntry.entry_date).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Status</Label>
                    <p><StatusBadge status={viewEntry.status} map={JE_STATUS_TONE_MAP} /></p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Currency</Label>
                    <p className="font-medium">{viewEntry.transaction_currency || BASE_CURRENCY}
                      {viewEntry.transaction_currency && viewEntry.transaction_currency !== BASE_CURRENCY && (
                        <span className="text-muted-foreground text-xs ml-1">@ {viewEntry.exchange_rate}</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Reference</Label>
                    <p className="font-medium">{viewEntry.description}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Description</Label>
                    <p>{viewEntry.description}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Narration</Label>
                    <p>{(viewEntry as any).narration || '—'}</p>
                  </div>
                </div>
                <div>
                  <Label className="font-medium">Line Items</Label>
                  <div className="mt-2">
                    {(() => {
                      const isForeign = !!(viewEntry.transaction_currency && viewEntry.transaction_currency !== BASE_CURRENCY);
                      const txCur = (viewEntry.transaction_currency || BASE_CURRENCY) as CurrencyCode;
                      return (
                        <>
                          <AdvancedDataTable<any>
                            data={viewEntry.lines || []}
                            keyExtractor={(line, i) => i}
                            columns={[
                              {
                                key: 'account', header: 'Account',
                                render: (_v, line) => (
                                  <>
                                    <span className="font-mono text-xs">{line.account?.account_code}</span>{' '}
                                    {line.account?.account_name}
                                  </>
                                ),
                              },
                              { key: 'debit_amount', header: `Debit (${txCur})`, align: 'right', render: (v) => v > 0 ? formatCurrency(v, txCur) : '—' },
                              { key: 'credit_amount', header: `Credit (${txCur})`, align: 'right', render: (v) => v > 0 ? formatCurrency(v, txCur) : '—' },
                              ...(isForeign ? [
                                { key: 'base_debit_amount', header: `Base Debit (${BASE_CURRENCY})`, align: 'right' as const, render: (v: number) => v > 0 ? formatCurrency(v) : '—' },
                                { key: 'base_credit_amount', header: `Base Credit (${BASE_CURRENCY})`, align: 'right' as const, render: (v: number) => v > 0 ? formatCurrency(v) : '—' },
                              ] : []),
                              { key: 'description', header: 'Description', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                            ]}
                          />
                          <div className="border border-t-0 rounded-b bg-muted/30 -mt-px px-3 py-2.5 flex justify-between text-sm font-bold">
                            <span>TOTALS</span>
                            <span className="flex gap-6">
                              <span>{formatCurrency(viewEntry.total_debit, txCur)}</span>
                              <span>{formatCurrency(viewEntry.total_credit, txCur)}</span>
                              {isForeign && (
                                <>
                                  <span>{formatCurrency(viewEntry.base_total_debit ?? 0)}</span>
                                  <span>{formatCurrency(viewEntry.base_total_credit ?? 0)}</span>
                                </>
                              )}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    {viewEntry && getStatusActions(viewEntry).map((act) => {
                      const isActive = statusActionKey === `${viewEntry.id}-${act.action}`;
                      return (
                        <Button key={act.action} size="sm" variant={act.variant}
                          onClick={() => changeStatus(viewEntry.id, act.action, act.label)}
                          disabled={loading}>
                          {isActive ? <Loader2 className="w-3 h-3 animate-spin" /> : act.icon}
                          <span className="ml-1">{isActive ? 'Processing...' : act.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                  <Button variant="outline" onClick={() => setShowViewDialog(false)}>Close</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* EDIT DIALOG */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Journal Entry: {editEntry?.je_number}</DialogTitle>
              <DialogDescription>Edit a draft journal entry</DialogDescription>
            </DialogHeader>
            {editFormData && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Entry Date</Label>
                    <Input type="date" value={editFormData.entry_date}
                      onChange={(e) => setEditFormData(prev => prev ? { ...prev, entry_date: e.target.value } : prev)} />
                  </div>
                  <div>
                    <Label>Reference</Label>
                    <Input value={editFormData.reference}
                      onChange={(e) => setEditFormData(prev => prev ? { ...prev, reference: e.target.value } : prev)}
                      placeholder="Reference number" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Transaction Currency</Label>
                    <Combobox
                      options={availableCurrencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
                      value={editFormData.transaction_currency}
                      onChange={(value) => fetchEditExchangeRate(value as CurrencyCode)}
                      searchPlaceholder="Search currencies..."
                    />
                  </div>
                  <div>
                    <Label>Exchange Rate (to {BASE_CURRENCY})</Label>
                    <Input type="number" step="0.000001"
                      value={editFormData.exchange_rate}
                      onChange={(e) => setEditFormData(prev => prev ? { ...prev, exchange_rate: parseFloat(e.target.value) || 0 } : prev)}
                      disabled={editFormData.transaction_currency === BASE_CURRENCY} />
                  </div>
                </div>
                <div>
                  <Label>Description</Label>
                  <Input value={editFormData.description}
                    onChange={(e) => setEditFormData(prev => prev ? { ...prev, description: e.target.value } : prev)}
                    placeholder="Journal entry description" />
                </div>
                <div>
                  <Label>Narration</Label>
                  <Textarea value={editFormData.narration}
                    onChange={(e) => setEditFormData(prev => prev ? { ...prev, narration: e.target.value } : prev)}
                    placeholder="Detailed explanation" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <Label>Line Items</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addEditLine}>
                      <Plus className="w-4 h-4 mr-2" /> Add Line
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {editFormData.lines.map((line, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2 items-center p-2 border rounded">
                        <div className="col-span-4">
                          <Combobox
                            options={accounts.map((account) => ({ value: account.id, label: `${account.account_code} - ${account.account_name}` }))}
                            value={line.account_id}
                            onChange={(value) => updateEditLine(index, 'account_id', value)}
                            placeholder="Select account"
                            searchPlaceholder="Search accounts..."
                          />
                        </div>
                        <div className="col-span-2">
                          <Input type="number" step="0.01" placeholder="Debit" value={line.debit_amount}
                            onChange={(e) => updateEditLine(index, 'debit_amount', parseFloat(e.target.value) || 0)} />
                        </div>
                        <div className="col-span-2">
                          <Input type="number" step="0.01" placeholder="Credit" value={line.credit_amount}
                            onChange={(e) => updateEditLine(index, 'credit_amount', parseFloat(e.target.value) || 0)} />
                        </div>
                        <div className="col-span-3">
                          <Input placeholder="Description" value={line.description}
                            onChange={(e) => updateEditLine(index, 'description', e.target.value)} />
                        </div>
                        <div className="col-span-1">
                          <Button type="button" variant="outline" size="sm"
                            onClick={() => removeEditLine(index)} disabled={editFormData.lines.length <= 2}>
                            ×
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-4 bg-muted rounded-lg">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="font-medium">Total Debits ({editFormData.transaction_currency}): </span>
                        {formatCurrency(calcEditTotals().totalDebits, editFormData.transaction_currency)}
                      </div>
                      <div>
                        <span className="font-medium">Total Credits ({editFormData.transaction_currency}): </span>
                        {formatCurrency(calcEditTotals().totalCredits, editFormData.transaction_currency)}
                      </div>
                      {editFormData.transaction_currency !== BASE_CURRENCY && (
                        <div>
                          <span className="font-medium">Base ({BASE_CURRENCY}): </span>
                          {formatCurrency(calcEditTotals().totalDebits * editFormData.exchange_rate, BASE_CURRENCY)}
                        </div>
                      )}
                      <div>
                        <span className="font-medium">Status: </span>
                        <Badge variant={calcEditTotals().isBalanced ? "default" : "destructive"}>
                          {calcEditTotals().isBalanced ? "Balanced" : "Unbalanced"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
                  <Button onClick={saveEdit} disabled={loading || !calcEditTotals().isBalanced}>
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {loading ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default JournalEntriesPage;
