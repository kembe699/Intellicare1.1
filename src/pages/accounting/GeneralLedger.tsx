import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { toast } from 'sonner';
import { Eye, RefreshCw, Search, BookOpen, ChevronDown, ChevronRight, Calendar, BarChart3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { apiFetch, formatCurrency, GLEntry, CurrencyCode } from '@/utils/accountingApi';
import { useCurrency } from '@/contexts/CurrencyContext';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

const GL_STATUS_TONE_MAP: Record<string, StatusBadgeTone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  posted: 'success',
  reversed: 'danger',
};

const GeneralLedger: React.FC = () => {
  const { user } = useAuth();
  const { currency: baseCurrencyData } = useCurrency();
  const BASE_CURRENCY = baseCurrencyData.code;
  const [loading, setLoading] = useState(false);
  const [glEntries, setGlEntries] = useState<GLEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewEntry, setViewEntry] = useState<GLEntry | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);

  useEffect(() => {
    if (user?.clinic) loadGLEntries();
  }, [user]);

  const loadGLEntries = async () => {
    try {
      setLoading(true);
      let url = `/api/accounting/general-ledger?clinic_id=${user?.clinic}`;
      if (startDate && endDate) url += `&start_date=${startDate}&end_date=${endDate}`;
      if (statusFilter !== 'all') url += `&status=${statusFilter}`;
      const response = await apiFetch(url);
      if (response.ok) setGlEntries(await response.json());
    } catch (error) {
      console.error('Error loading GL entries:', error);
      toast.error('Failed to load general ledger entries');
    } finally {
      setLoading(false);
    }
  };

  const filteredEntries = useMemo(() => {
    if (!searchQuery) return glEntries;
    const q = searchQuery.toLowerCase();
    return glEntries.filter(e =>
      e.gl_number?.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.transaction_type?.toLowerCase().includes(q)
    );
  }, [glEntries, searchQuery]);

  const summary = useMemo(() => {
    const totalDebit = filteredEntries.reduce((s, e) => s + parseFloat(String(e.base_total_debit ?? 0)), 0);
    const totalCredit = filteredEntries.reduce((s, e) => s + parseFloat(String(e.base_total_credit ?? 0)), 0);
    const posted = filteredEntries.filter(e => e.status === 'posted').length;
    return { totalDebit, totalCredit, count: filteredEntries.length, posted };
  }, [filteredEntries]);

  const handleView = (entry: GLEntry) => {
    setViewEntry(entry);
    setShowViewDialog(true);
  };

  const setThisMonth = () => {
    const d = new Date();
    setStartDate(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]);
    setEndDate(new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]);
  };

  useEffect(() => {
    if (startDate && endDate && user?.clinic) loadGLEntries();
  }, [startDate, endDate, statusFilter]);

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<BarChart3 />}
          title="General Ledger"
          actions={
            <Button onClick={loadGLEntries} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
          }
        />
        {loading && <LoadingState message="Loading general ledger..." />}

        {/* Filters */}
        <Card className="bg-primary/10 border-primary/15">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search GL number, description..." value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[150px]" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[150px]" />
                </div>
                <Button variant="outline" size="sm" onClick={setThisMonth}>
                  <Calendar className="w-3.5 h-3.5 mr-1" /> This Month
                </Button>
              </div>
              <Combobox
                options={[
                  { value: 'all', label: 'All Status' },
                  { value: 'draft', label: 'Draft' },
                  { value: 'posted', label: 'Posted' },
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="All Status"
                searchPlaceholder="Search..."
                className="w-[130px]"
              />
              {(searchQuery || startDate || endDate || statusFilter !== 'all') && (
                <Button variant="ghost" size="sm" onClick={() => {
                  setSearchQuery(''); setStartDate(''); setEndDate(''); setStatusFilter('all');
                }}>Clear</Button>
              )}
              <span className="text-sm text-muted-foreground ml-auto">
                {filteredEntries.length} entries
              </span>
            </div>
          </CardContent>
        </Card>

        {/* GL Table */}
        <Card className="rounded-lg shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
              <table className="w-full min-w-[1100px] text-sm border-collapse">
                <thead className="bg-muted sticky top-0 border-b z-10">
                  <tr className="text-left">
                    <th className="pl-5 pr-2 py-3.5 w-10"></th>
                    <th className="px-3 py-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">GL Number</th>
                    <th className="px-3 py-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">Date</th>
                    <th className="px-3 py-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">Type</th>
                    <th className="px-3 py-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground min-w-[220px]">Description</th>
                    <th className="px-3 py-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">Currency</th>
                    <th className="px-3 py-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">Debit ({BASE_CURRENCY})</th>
                    <th className="px-3 py-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">Credit ({BASE_CURRENCY})</th>
                    <th className="px-3 py-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground text-center whitespace-nowrap">Status</th>
                    <th className="px-3 pr-5 py-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground text-center whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-5 py-16 text-center">
                        <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">
                          No general ledger entries found. Entries are created when journal entries are posted.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map((entry) => (
                      <React.Fragment key={entry.id}>
                        <tr className="hover:bg-muted/30 transition-colors">
                          <td className="pl-5 pr-2 py-3.5">
                            {entry.lineItems && entry.lineItems.length > 0 && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}>
                                {expandedId === entry.id
                                  ? <ChevronDown className="w-3.5 h-3.5" />
                                  : <ChevronRight className="w-3.5 h-3.5" />}
                              </Button>
                            )}
                          </td>
                          <td className="px-3 py-3.5 whitespace-nowrap">
                            <span className="font-mono text-sm font-medium">{entry.gl_number}</span>
                          </td>
                          <td className="px-3 py-3.5 text-sm whitespace-nowrap">{new Date(entry.transaction_date).toLocaleDateString()}</td>
                          <td className="px-3 py-3.5 whitespace-nowrap">
                            <Badge variant="outline" className="text-xs capitalize">{entry.transaction_type}</Badge>
                          </td>
                          <td className="px-3 py-3.5 max-w-[320px]">
                            <p className="text-sm truncate" title={entry.description}>{entry.description}</p>
                          </td>
                          <td className="px-3 py-3.5 whitespace-nowrap">
                            <Badge variant="outline" className="text-xs">{entry.transaction_currency || BASE_CURRENCY}</Badge>
                            {entry.transaction_currency && entry.transaction_currency !== BASE_CURRENCY && (
                              <span className="text-xs text-muted-foreground ml-1">@{entry.exchange_rate}</span>
                            )}
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono text-sm font-medium whitespace-nowrap">
                            {formatCurrency(entry.base_total_debit ?? 0)}
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono text-sm font-medium whitespace-nowrap">
                            {formatCurrency(entry.base_total_credit ?? 0)}
                          </td>
                          <td className="px-3 py-3.5 text-center whitespace-nowrap">
                            <StatusBadge status={entry.status} map={GL_STATUS_TONE_MAP} />
                          </td>
                          <td className="px-3 pr-5 py-3.5 text-center whitespace-nowrap">
                            <Button size="icon" variant="ghost" className="hover:bg-muted" onClick={() => handleView(entry)} title="View Details">
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                        {/* Expanded Line Items */}
                        {expandedId === entry.id && entry.lineItems && entry.lineItems.length > 0 && (
                          <tr>
                            <td colSpan={10} className="bg-muted/20 px-5 py-4">
                              <div className="ml-8 overflow-hidden rounded-lg border border-border/70 bg-background">
                                <table className="w-full text-sm">
                                  <thead className="bg-muted/40 border-b border-border/70">
                                    <tr className="text-xs text-muted-foreground">
                                      <th className="px-4 py-2.5 text-left font-medium">Account</th>
                                      <th className="px-4 py-2.5 text-right font-medium">Debit</th>
                                      <th className="px-4 py-2.5 text-right font-medium">Credit</th>
                                      <th className="px-4 py-2.5 text-left font-medium">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/60">
                                    {entry.lineItems.map((li: any, i: number) => (
                                      <tr key={i}>
                                        <td className="px-4 py-2.5">
                                          <span className="font-mono text-xs">{li.account?.account_code}</span>{' '}
                                          {li.account?.account_name}
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-mono">
                                          {parseFloat(li.debit_amount) > 0 ? formatCurrency(li.debit_amount) : '\u2014'}
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-mono">
                                          {parseFloat(li.credit_amount) > 0 ? formatCurrency(li.credit_amount) : '\u2014'}
                                        </td>
                                        <td className="px-4 py-2.5 text-muted-foreground">{li.description || '\u2014'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
                {filteredEntries.length > 0 && (
                  <tfoot className="border-t-2 font-bold bg-muted sticky bottom-0">
                    <tr>
                      <td className="pl-5 pr-3 py-3.5" colSpan={6}>TOTALS</td>
                      <td className="px-3 py-3.5 text-right font-mono text-sm whitespace-nowrap">{formatCurrency(summary.totalDebit)}</td>
                      <td className="px-3 py-3.5 text-right font-mono text-sm whitespace-nowrap">{formatCurrency(summary.totalCredit)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* View Dialog */}
        <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
          <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
            <DialogHeader>
              <DialogTitle>GL Entry: {viewEntry?.gl_number}</DialogTitle>
              <DialogDescription>General ledger entry details</DialogDescription>
            </DialogHeader>
            {viewEntry && (
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Date</Label>
                    <p className="text-sm font-medium">{new Date(viewEntry.transaction_date).toLocaleDateString()}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Type</Label>
                    <p><Badge variant="outline" className="capitalize">{viewEntry.transaction_type}</Badge></p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Currency</Label>
                    <p className="text-sm font-medium">{viewEntry.transaction_currency || BASE_CURRENCY}
                      {viewEntry.exchange_rate && viewEntry.transaction_currency !== BASE_CURRENCY &&
                        <span className="text-muted-foreground text-xs ml-1">@ {viewEntry.exchange_rate}</span>}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <p><StatusBadge status={viewEntry.status} map={GL_STATUS_TONE_MAP} /></p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <p className="text-sm">{viewEntry.description}</p>
                </div>
                {viewEntry.lineItems && viewEntry.lineItems.length > 0 && (
                  <div className="space-y-2">
                    <Label className="font-medium">Line Items</Label>
                    <div>
                      <AdvancedDataTable<any>
                        data={viewEntry.lineItems}
                        keyExtractor={(li, i) => i}
                        columns={[
                          {
                            key: 'account', header: 'Account',
                            render: (_v, li) => (
                              <>
                                <span className="font-mono text-xs">{li.account?.account_code}</span>{' '}
                                {li.account?.account_name}
                              </>
                            ),
                          },
                          { key: 'debit_amount', header: `Debit (${BASE_CURRENCY})`, align: 'right', render: (v) => <span className="font-mono">{parseFloat(v) > 0 ? formatCurrency(v) : '\u2014'}</span> },
                          { key: 'credit_amount', header: `Credit (${BASE_CURRENCY})`, align: 'right', render: (v) => <span className="font-mono">{parseFloat(v) > 0 ? formatCurrency(v) : '\u2014'}</span> },
                          { key: 'description', header: 'Description', render: (v) => <span className="text-muted-foreground">{v || '\u2014'}</span> },
                        ]}
                      />
                      <div className="border border-t-0 border-border rounded-b-md bg-muted/30 -mt-px px-4 py-2.5 flex justify-between text-sm font-bold">
                        <span>TOTALS</span>
                        <span className="font-mono flex gap-6">
                          <span>{formatCurrency(viewEntry.base_total_debit ?? 0)}</span>
                          <span>{formatCurrency(viewEntry.base_total_credit ?? 0)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowViewDialog(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default GeneralLedger;
