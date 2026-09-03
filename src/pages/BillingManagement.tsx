import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { getStatusColor } from '@/lib/statusColors';
import { useCurrency } from '@/contexts/CurrencyContext';
import { formatCurrency } from '@/utils/accountingApi';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { toast } from 'sonner';
import CreateClaimModal from '@/components/insurance/CreateClaimModal';
import {
  Plus, Eye, DollarSign,
  Loader2, X,
  TrendingUp, BarChart3, Shield, FileSpreadsheet,
  AlertTriangle, RefreshCw, Download, Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

type TabType = 'receivables' | 'insurance' | 'reports';

function getMonthStart() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().split('T')[0];
}
function getToday() { return new Date().toISOString().split('T')[0]; }

const BillingManagement: React.FC = () => {
  const { user } = useAuth();
  const { currency } = useCurrency();
  const clinicId = user?.clinic || '1';
  const [activeTab, setActiveTab] = useState<TabType>('receivables');
  const [loading, setLoading] = useState(false);

  // Receivables
  const [agingData, setAgingData] = useState<any>(null);
  const [overdueList, setOverdueList] = useState<any[]>([]);
  const [outstandingBalances, setOutstandingBalances] = useState<any[]>([]);

  // Insurance
  const [insuranceClaims, setInsuranceClaims] = useState<any[]>([]);

  // Reports
  const [revenueSummary, setRevenueSummary] = useState<any[]>([]);
  const [revenueByCategory, setRevenueByCategory] = useState<any>(null);
  const [collections, setCollections] = useState<any>(null);
  const [cashPosition, setCashPosition] = useState<any>(null);
  const [reportPeriod, setReportPeriod] = useState({ start: getMonthStart(), end: getToday() });

  // Discount modal
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountForm, setDiscountForm] = useState({
    billId: '', discount_type: 'fixed_amount', discount_amount: '', discount_percentage: '', reason: ''
  });

  // Follow-up modal
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({
    billId: '', follow_up_type: 'phone', follow_up_notes: '', outcome: '', next_follow_up_date: ''
  });

  // Write-off modal
  const [showWriteOffModal, setShowWriteOffModal] = useState(false);
  const [writeOffBillId, setWriteOffBillId] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');

  // Action loading states
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [writingOff, setWritingOff] = useState(false);

  useEffect(() => {
    if (activeTab === 'receivables') loadReceivables();
    else if (activeTab === 'insurance') { /* InsuranceTab loads its own data */ }
    else if (activeTab === 'reports') loadReports();
  }, [activeTab]);

  // ── Data Loaders ──

  async function loadReceivables() {
    setLoading(true);
    try {
      const [agingRes, overdueRes, outstandingRes] = await Promise.all([
        authFetch(`/api/billing/receivables/aging?clinic_id=${clinicId}`),
        authFetch(`/api/billing/receivables/overdue?clinic_id=${clinicId}`),
        authFetch(`/api/billing/reports/outstanding-balance?clinic_id=${clinicId}`)
      ]);
      if (agingRes.ok) setAgingData(await agingRes.json());
      if (overdueRes.ok) setOverdueList(await overdueRes.json());
      if (outstandingRes.ok) setOutstandingBalances(await outstandingRes.json());
    } catch (err) { console.error('Error loading receivables:', err); }
    setLoading(false);
  }

  async function loadInsuranceClaims() { /* InsuranceTab manages its own state */ }

  async function loadReports() {
    setLoading(true);
    try {
      const [revRes, catRes, colRes, cashRes] = await Promise.all([
        authFetch(`/api/billing/reports/revenue-summary?clinic_id=${clinicId}&start_date=${reportPeriod.start}&end_date=${reportPeriod.end}`),
        authFetch(`/api/billing/reports/revenue-by-category?clinic_id=${clinicId}&start_date=${reportPeriod.start}&end_date=${reportPeriod.end}`),
        authFetch(`/api/billing/reports/collections?clinic_id=${clinicId}&start_date=${reportPeriod.start}&end_date=${reportPeriod.end}`),
        authFetch(`/api/billing/reports/cash-position?clinic_id=${clinicId}`)
      ]);
      if (revRes.ok) setRevenueSummary(await revRes.json());
      if (catRes.ok) setRevenueByCategory(await catRes.json());
      if (colRes.ok) setCollections(await colRes.json());
      if (cashRes.ok) setCashPosition(await cashRes.json());
    } catch (err) { console.error('Error loading reports:', err); }
    setLoading(false);
  }

  // ── Actions ──

  async function handleApplyDiscount() {
    if (applyingDiscount) return;
    setApplyingDiscount(true);
    try {
      const res = await authFetch(`/api/billing/bills/${discountForm.billId}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discount_type: discountForm.discount_type,
          discount_amount: parseFloat(discountForm.discount_amount) || 0,
          discount_percentage: parseFloat(discountForm.discount_percentage) || 0,
          reason: discountForm.reason
        })
      });
      if (res.ok) { toast.success('Discount applied'); setShowDiscountModal(false); loadReceivables(); }
      else { const err = await res.json(); toast.error(err.error || 'Failed to apply discount'); }
    } catch { toast.error('Failed to apply discount'); }
    finally { setApplyingDiscount(false); }
  }

  async function handleRecordFollowUp() {
    if (savingFollowUp) return;
    setSavingFollowUp(true);
    try {
      const res = await authFetch(`/api/billing-enhanced/receivables/${followUpForm.billId}/follow-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(followUpForm)
      });
      if (res.ok) { toast.success('Follow-up recorded'); setShowFollowUpModal(false); loadReceivables(); }
      else toast.error('Failed to record follow-up');
    } catch { toast.error('Failed to record follow-up'); }
    finally { setSavingFollowUp(false); }
  }

  async function handleWriteOff() {
    if (writingOff) return;
    setWritingOff(true);
    try {
      const res = await authFetch(`/api/billing/bills/${writeOffBillId}/write-off`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: writeOffReason })
      });
      if (res.ok) { toast.success('Bill written off'); setShowWriteOffModal(false); loadReceivables(); }
      else toast.error('Failed to write off bill');
    } catch { toast.error('Failed to write off bill'); }
    finally { setWritingOff(false); }
  }

  // ── Tab config ──

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'receivables', label: 'Receivables & Aging', icon: TrendingUp },
    { id: 'insurance', label: 'Insurance Claims', icon: Shield },
    { id: 'reports', label: 'Billing Reports', icon: BarChart3 },
  ];

  // ── Main render ──

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="animate-fade-in w-full flex flex-col">
        <PageHeader
          icon={<DollarSign />}
          title="Billing Management"
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="space-y-6">
          <TabsList className="w-full flex h-auto p-0 bg-transparent border-b border-border rounded-none gap-1 overflow-x-auto">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-none whitespace-nowrap"
              >
                <tab.icon className="w-4 h-4" />{tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {loading ? (
            <LoadingState message="Loading billing data..." />
          ) : (
            <>
              <TabsContent value="receivables">
                <ReceivablesTab agingData={agingData} overdueList={overdueList}
                  outstandingBalances={outstandingBalances} onRefresh={loadReceivables}
                  onDiscount={(id: string) => { setDiscountForm(f => ({...f, billId: id})); setShowDiscountModal(true); }}
                  onFollowUp={(id: string) => { setFollowUpForm(f => ({...f, billId: id})); setShowFollowUpModal(true); }}
                  onWriteOff={(id: string) => { setWriteOffBillId(id); setShowWriteOffModal(true); }} />
              </TabsContent>
              <TabsContent value="insurance">
                <InsuranceTab claims={insuranceClaims} onRefresh={loadInsuranceClaims} />
              </TabsContent>
              <TabsContent value="reports">
                <ReportsTab revenueSummary={revenueSummary} revenueByCategory={revenueByCategory}
                  collections={collections} cashPosition={cashPosition} period={reportPeriod}
                  setPeriod={setReportPeriod} onRefresh={loadReports} />
              </TabsContent>
            </>
          )}

        {/* Discount Modal */}
        <Dialog open={showDiscountModal} onOpenChange={setShowDiscountModal}>
          <DialogContent>
            <DialogHeader><DialogTitle>Apply Discount</DialogTitle><DialogDescription>Add a discount to this bill</DialogDescription></DialogHeader>
            <div className="px-5 py-4 space-y-4">
              <div>
                <Label>Discount Type</Label>
                <Combobox
                  options={[
                    { value: 'fixed_amount', label: 'Fixed Amount' },
                    { value: 'percentage', label: 'Percentage' },
                  ]}
                  value={discountForm.discount_type}
                  onChange={v => setDiscountForm(f => ({...f, discount_type: v}))}
                  searchPlaceholder="Search..."
                />
              </div>
              {discountForm.discount_type === 'fixed_amount' ? (
                <div><Label>Discount Amount ({currency.code})</Label>
                  <Input type="number" value={discountForm.discount_amount} onChange={e => setDiscountForm(f => ({...f, discount_amount: e.target.value}))} /></div>
              ) : (
                <div><Label>Discount Percentage (%)</Label>
                  <Input type="number" value={discountForm.discount_percentage} onChange={e => setDiscountForm(f => ({...f, discount_percentage: e.target.value}))} /></div>
              )}
              <div><Label>Reason</Label>
                <Textarea value={discountForm.reason} onChange={e => setDiscountForm(f => ({...f, reason: e.target.value}))} /></div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDiscountModal(false)} disabled={applyingDiscount}>Cancel</Button>
                <Button onClick={handleApplyDiscount} disabled={applyingDiscount}>
                  {applyingDiscount ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {applyingDiscount ? 'Applying...' : 'Apply Discount'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Follow-up Modal */}
        <Dialog open={showFollowUpModal} onOpenChange={setShowFollowUpModal}>
          <DialogContent>
            <DialogHeader><DialogTitle>Record Follow-up</DialogTitle><DialogDescription>Document a collection follow-up</DialogDescription></DialogHeader>
            <div className="px-5 py-4 space-y-4">
              <div><Label>Follow-up Type</Label>
                <Combobox
                  options={[
                    { value: 'phone', label: 'Phone Call' },
                    { value: 'sms', label: 'SMS' },
                    { value: 'email', label: 'Email' },
                    { value: 'in_person', label: 'In Person' },
                    { value: 'letter', label: 'Letter' },
                  ]}
                  value={followUpForm.follow_up_type}
                  onChange={v => setFollowUpForm(f => ({...f, follow_up_type: v}))}
                  searchPlaceholder="Search..."
                />
              </div>
              <div><Label>Notes</Label>
                <Textarea value={followUpForm.follow_up_notes} onChange={e => setFollowUpForm(f => ({...f, follow_up_notes: e.target.value}))} /></div>
              <div><Label>Outcome</Label>
                <Combobox
                  options={[
                    { value: 'promised_payment', label: 'Promised Payment' },
                    { value: 'partial_payment', label: 'Partial Payment' },
                    { value: 'dispute', label: 'Dispute' },
                    { value: 'no_response', label: 'No Response' },
                    { value: 'payment_plan', label: 'Payment Plan Agreed' },
                  ]}
                  value={followUpForm.outcome}
                  onChange={v => setFollowUpForm(f => ({...f, outcome: v}))}
                  placeholder="Select outcome"
                  searchPlaceholder="Search..."
                />
              </div>
              <div><Label>Next Follow-up Date</Label>
                <Input type="date" value={followUpForm.next_follow_up_date} onChange={e => setFollowUpForm(f => ({...f, next_follow_up_date: e.target.value}))} /></div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowFollowUpModal(false)} disabled={savingFollowUp}>Cancel</Button>
                <Button onClick={handleRecordFollowUp} disabled={savingFollowUp}>
                  {savingFollowUp ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {savingFollowUp ? 'Saving...' : 'Save Follow-up'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Write-off Modal */}
        <Dialog open={showWriteOffModal} onOpenChange={setShowWriteOffModal}>
          <DialogContent>
            <DialogHeader><DialogTitle>Bad Debt Write-off</DialogTitle>
              <DialogDescription>This will write off the remaining balance as bad debt and create a GL entry.</DialogDescription></DialogHeader>
            <div className="px-5 py-4 space-y-4">
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
                <p className="text-sm text-red-800">This action is permanent and will zero out the bill balance. A bad debt expense GL entry will be created.</p>
              </div>
              <div><Label>Reason for Write-off</Label>
                <Textarea value={writeOffReason} onChange={e => setWriteOffReason(e.target.value)} placeholder="Explain why this debt is being written off..." /></div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowWriteOffModal(false)} disabled={writingOff}>Cancel</Button>
                <Button variant="destructive" onClick={handleWriteOff} disabled={writingOff}>
                  {writingOff ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {writingOff ? 'Writing Off...' : 'Confirm Write-off'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        </Tabs>
      </div>
      </div>
    </AppLayout>
  );
};

// ════════════════════════════════════════
// SUB-COMPONENTS (Tabs)
// ════════════════════════════════════════

function ReceivablesTab({ agingData, overdueList, outstandingBalances, onRefresh, onDiscount, onFollowUp, onWriteOff }: any) {
  // Bills aren't all in one currency (a scheme/insurance bill can be priced in USD while
  // most are SSP) — the backend now groups sums by bill_currency instead of blending every
  // bill into one number, so every total here is rendered per-currency rather than always
  // labeled with the clinic's base currency regardless of what was actually billed.
  const summaryByCurrency: any[] = Array.isArray(agingData?.summary) ? agingData.summary : (agingData?.summary ? [agingData.summary] : []);
  const totalBillCount = summaryByCurrency.reduce((sum, s) => sum + (parseInt(s.total_bills, 10) || 0), 0);
  const bracketsGrouped: Record<string, any[]> = {};
  (agingData?.aging_brackets || []).forEach((b: any) => {
    if (!bracketsGrouped[b.aging_bracket]) bracketsGrouped[b.aging_bracket] = [];
    bracketsGrouped[b.aging_bracket].push(b);
  });
  return (
    <div className="space-y-6">
      {/* Aging Cards */}
      {agingData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase font-medium">Total Outstanding</div>
              <div className="mt-1 space-y-0.5">
                {summaryByCurrency.length > 0 ? summaryByCurrency.map(s => (
                  <div key={s.bill_currency} className="text-2xl font-bold">
                    {formatCurrency(parseFloat(s.total_outstanding || 0), s.bill_currency)}
                  </div>
                )) : <div className="text-2xl font-bold">{formatCurrency(0, '')}</div>}
              </div>
              <div className="text-xs text-muted-foreground">{totalBillCount} bills</div>
            </div>
          </div>
          {['current', '1_30', '31_60', '61_90', '90_plus'].filter(bk => bracketsGrouped[bk]).map((bk) => {
            const rows = bracketsGrouped[bk];
            const label = bk === 'current' ? 'Current' : bk === '1_30' ? '1-30 Days' :
              bk === '31_60' ? '31-60 Days' : bk === '61_90' ? '61-90 Days' : '90+ Days';
            const color = bk === '90_plus' ? 'text-red-600' : bk === '61_90' ? 'text-orange-600' :
              bk === '31_60' ? 'text-yellow-600' : 'text-foreground';
            const billCount = rows.reduce((sum, r) => sum + (parseInt(r.bill_count, 10) || 0), 0);
            return (
              <div className="bg-card rounded-xl border shadow-sm overflow-hidden" key={bk}>
                <div className="px-5 pt-4 pb-4">
                  <div className="text-xs text-muted-foreground uppercase font-medium">{label}</div>
                  <div className={`mt-1 space-y-0.5 ${color}`}>
                    {rows.map(r => (
                      <div key={r.bill_currency} className="text-xl font-bold">
                        {formatCurrency(parseFloat(r.total_balance || 0), r.bill_currency)}
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">{billCount} bills</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Outstanding by Patient */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30">
          <span className="font-semibold text-[13px] text-foreground">Outstanding Balances by Patient</span>
        </div>
        <div className="px-5 py-4">
          <AdvancedDataTable<any>
            data={outstandingBalances || []}
            keyExtractor={(r, i) => i}
            emptyMessage="No outstanding balances"
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            columns={[
              { key: 'patient_name', header: 'Patient', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
              { key: 'bill_count', header: 'Bills', align: 'right' },
              { key: 'total_billed', header: 'Total Billed', align: 'right', render: (v, r) => formatCurrency(parseFloat(v), r.bill_currency) },
              { key: 'total_paid', header: 'Paid', align: 'right', render: (v, r) => <span className="text-green-600">{formatCurrency(parseFloat(v), r.bill_currency)}</span> },
              { key: 'total_outstanding', header: 'Outstanding', align: 'right', sortable: true, render: (v, r) => <span className="font-bold text-red-600">{formatCurrency(parseFloat(v), r.bill_currency)}</span> },
              {
                key: 'max_days_overdue', header: 'Max Overdue', align: 'right',
                render: (v) => v > 0 ? <Badge variant="destructive">{v}d</Badge> : <Badge variant="secondary">Current</Badge>,
              },
            ]}
          />
        </div>
      </div>

      {/* Overdue Bills */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <div><span className="font-semibold text-[13px] text-foreground">Overdue Bills</span><p className="text-xs text-muted-foreground mt-0.5">Bills past due date</p></div>
            <Button size="sm" variant="outline" onClick={onRefresh}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          </div>
        </div>
        <div className="px-5 py-4">
          <AdvancedDataTable<any>
            data={overdueList || []}
            keyExtractor={(bill) => bill.id}
            emptyMessage="No overdue bills"
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            columns={[
              { key: 'bill_number', header: 'Bill #', render: (v) => <span className="font-mono text-primary text-xs">{v}</span> },
              { key: 'patient_name', header: 'Patient', sortable: true },
              { key: 'balance_amount', header: 'Balance', align: 'right', sortable: true, render: (v, bill) => <span className="font-bold text-red-600">{formatCurrency(parseFloat(v), bill.bill_currency || 'SSP')}</span> },
              {
                key: 'days_overdue', header: 'Days Overdue', align: 'right', sortable: true,
                render: (v) => <Badge variant={v > 90 ? 'destructive' : 'secondary'}>{v}d</Badge>,
              },
              {
                key: '__actions', header: 'Actions', align: 'right',
                render: (_v, bill) => (
                  <div className="flex gap-1 justify-end flex-wrap">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onDiscount(bill.id)}>Discount</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onFollowUp(bill.id)}>Follow-up</Button>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => onWriteOff(bill.id)}>Write-off</Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function InsuranceTab({ claims: _legacyClaims, onRefresh: _legacyRefresh }: any) {
  const navigate = useNavigate();
  const { fmt } = useCurrency();
  const [batchClaims, setBatchClaims] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [updatingClaimId, setUpdatingClaimId] = useState<string | null>(null);

  const loadBatchClaims = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      const res = await authFetch(`/api/insurance-claims?${params}`);
      if (res.ok) {
        const json = await res.json();
        setBatchClaims(json.data || []);
        setStats(json.stats || {});
      }
    } catch (err) { console.error('Error loading batch claims:', err); }
    setLoading(false);
  };

  useEffect(() => { loadBatchClaims(); }, [searchTerm, statusFilter]);

  // Claims can be batched in more than one currency (a USD-priced scheme vs. an SSP one), so
  // a single summed total can't carry one currency label — show each currency's total
  // separately instead of mislabeling a mixed sum.
  const formatByCurrency = (field: 'pending_amount' | 'submitted_amount' | 'paid_amount') => {
    const rows = (stats.by_currency || []).filter((r: any) => parseFloat(r[field] || 0) > 0);
    if (rows.length === 0) return fmt(0);
    return rows.map((r: any) => `${r.currency} ${parseFloat(r[field] || 0).toFixed(2)}`).join(' · ');
  };


  const handleDownloadPdf = async (claimId: string, claimNumber: string) => {
    try {
      const res = await authFetch(`/api/insurance-claims/${claimId}/pdf`);
      if (!res.ok) throw new Error('Failed to generate');
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${claimNumber}.html`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Claim document downloaded');
    } catch { toast.error('Failed to download claim'); }
  };

  const handleUpdateStatus = async (claimId: string, newStatus: string) => {
    if (updatingClaimId) return;
    setUpdatingClaimId(claimId);
    try {
      const res = await authFetch(`/api/insurance-claims/${claimId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, notes: `Status changed to ${newStatus}` }),
      });
      if (res.ok) { toast.success(`Claim marked as ${newStatus}`); loadBatchClaims(); }
      else { const err = await res.json(); toast.error(err.error || 'Failed'); }
    } catch { toast.error('Failed to update status'); }
    finally { setUpdatingClaimId(null); }
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-4">
            <div className="text-xs text-muted-foreground uppercase font-medium">Total Claims</div>
            <div className="text-2xl font-bold mt-1">{stats.total || 0}</div>
          </div>
        </div>
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-4">
            <div className="text-xs text-muted-foreground uppercase font-medium">Pending Amount</div>
            <div className="text-2xl font-bold text-yellow-600 mt-1">
              {formatByCurrency('pending_amount')}
            </div>
            <div className="text-xs text-muted-foreground">{stats.pending_count || 0} claims</div>
          </div>
        </div>
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-4">
            <div className="text-xs text-muted-foreground uppercase font-medium">Submitted</div>
            <div className="text-2xl font-bold text-primary mt-1">{stats.submitted_count || 0}</div>
            <div className="text-xs text-muted-foreground">
              {formatByCurrency('submitted_amount')}
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-4">
            <div className="text-xs text-muted-foreground uppercase font-medium">Paid</div>
            <div className="text-2xl font-bold text-green-600 mt-1">
              {formatByCurrency('paid_amount')}
            </div>
            <div className="text-xs text-muted-foreground">{stats.paid_count || 0} claims</div>
          </div>
        </div>
      </div>

      {/* Actions & Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search claim number or scheme..." value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)} className="pl-10 h-9" />
          </div>
          <Combobox
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'pending', label: 'Pending' },
              { value: 'submitted', label: 'Submitted' },
              { value: 'accepted', label: 'Accepted' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'paid', label: 'Paid' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            searchPlaceholder="Search..."
            className="ic-select"
          />
          <Button size="sm" variant="outline" onClick={loadBatchClaims} className="h-9">
            <RefreshCw className="w-4 h-4 mr-1" />Refresh
          </Button>
        </div>
        <Button onClick={() => setShowCreateModal(true)} className="gap-2 h-9">
          <Plus className="w-4 h-4" /> Create Insurance Claim
        </Button>
      </div>

      {/* Claims Table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30">
          <span className="font-semibold text-[13px] text-foreground">Insurance Batch Claims</span>
          <p className="text-xs text-muted-foreground mt-0.5">Batch insurance claims grouped by scheme</p>
        </div>
        <div className="px-5 py-4">
          {loading ? (
            <LoadingState message="Loading..." />
          ) : batchClaims.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No insurance claims found</p>
              <p className="text-xs mt-1">Click "Create Insurance Claim" to batch unpaid invoices</p>
            </div>
          ) : (
            <AdvancedDataTable<any>
              data={batchClaims}
              keyExtractor={(claim) => claim.id}
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'claim_number', header: 'Claim #', render: (v) => <span className="font-mono text-xs font-semibold text-primary">{v}</span> },
                {
                  key: 'scheme_name', header: 'Scheme', sortable: true,
                  render: (v, claim) => (
                    <>
                      <div className="font-medium">{v}</div>
                      {claim.scheme_code && <div className="text-xs text-muted-foreground">{claim.scheme_code}</div>}
                    </>
                  ),
                },
                { key: 'claim_amount', header: 'Amount', align: 'right', sortable: true, render: (v, claim) => <span className="font-bold">{claim.currency || 'SSP'} {parseFloat(v || 0).toFixed(2)}</span> },
                { key: 'invoice_count', header: '# Invoices', align: 'center', render: (v) => v || 0 },
                { key: 'created_at', header: 'Date Created', sortable: true, render: (v) => <span className="text-xs">{new Date(v).toLocaleDateString()}</span> },
                {
                  key: 'status', header: 'Status', align: 'center', sortable: true,
                  render: (v) => <Badge className={`text-xs capitalize ${getStatusColor(v)}`}>{v?.replace('_', ' ')}</Badge>,
                },
                { key: 'days_pending', header: 'Days', align: 'center', render: (v) => <span className="text-xs">{v || 0}d</span> },
                {
                  key: '__actions', header: 'Actions', align: 'right',
                  render: (_v, claim) => (
                    <div className="flex gap-1 justify-end flex-wrap">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View Details"
                        onClick={() => navigate(`/billing-management/claims/${claim.id}`)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download"
                        onClick={() => handleDownloadPdf(claim.id, claim.claim_number)}>
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                      {claim.status === 'pending' && (
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2" disabled={updatingClaimId === claim.id}
                          onClick={() => handleUpdateStatus(claim.id, 'submitted')}>
                          {updatingClaimId === claim.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                          {updatingClaimId === claim.id ? 'Submitting...' : 'Submit'}
                        </Button>
                      )}
                      {claim.status === 'submitted' && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-green-700" disabled={updatingClaimId === claim.id}
                            onClick={() => handleUpdateStatus(claim.id, 'accepted')}>
                            {updatingClaimId === claim.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                            {updatingClaimId === claim.id ? 'Accepting...' : 'Accept'}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-red-700" disabled={updatingClaimId === claim.id}
                            onClick={() => handleUpdateStatus(claim.id, 'rejected')}>
                            {updatingClaimId === claim.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                            {updatingClaimId === claim.id ? 'Rejecting...' : 'Reject'}
                          </Button>
                        </>
                      )}
                      {claim.status === 'accepted' && (
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-green-700" disabled={updatingClaimId === claim.id}
                          onClick={() => handleUpdateStatus(claim.id, 'paid')}>
                          {updatingClaimId === claim.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                          {updatingClaimId === claim.id ? 'Marking Paid...' : 'Mark Paid'}
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateClaimModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => { setShowCreateModal(false); loadBatchClaims(); toast.success('Insurance claim created'); }}
        />
      )}
    </div>
  );
}

function ReportsTab({ revenueSummary, revenueByCategory, collections, cashPosition, period, setPeriod, onRefresh }: any) {
  const { fmt } = useCurrency();
  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex items-end gap-4 flex-wrap">
        <div><Label className="text-xs">Start Date</Label>
          <Input type="date" className="w-40" value={period.start} onChange={e => setPeriod((p: any) => ({...p, start: e.target.value}))} /></div>
        <div><Label className="text-xs">End Date</Label>
          <Input type="date" className="w-40" value={period.end} onChange={e => setPeriod((p: any) => ({...p, end: e.target.value}))} /></div>
        <Button onClick={onRefresh}><RefreshCw className="w-4 h-4 mr-2" />Load Reports</Button>
      </div>

      {/* Cash Position Today */}
      {cashPosition && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase">Cash Received Today</div>
              <div className="text-2xl font-bold text-green-600 mt-1">{fmt(parseFloat(cashPosition.cash_received || 0))}</div>
            </div>
          </div>
          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase">Bills Today</div>
              <div className="text-2xl font-bold mt-1">{cashPosition.bills_today?.count || 0}</div>
              <div className="text-xs text-muted-foreground">Billed: {fmt(parseFloat(cashPosition.bills_today?.total_billed || 0))}</div>
            </div>
          </div>
          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase">Paid Today</div>
              <div className="text-2xl font-bold text-primary mt-1">{fmt(parseFloat(cashPosition.bills_today?.total_paid || 0))}</div>
            </div>
          </div>
        </div>
      )}

      {/* Revenue by Category */}
      {revenueByCategory && (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30"><span className="font-semibold text-[13px] text-foreground">Revenue by Category</span></div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {['clinical', 'lab', 'pharmacy', 'supply', 'procedure_charges', 'accommodation', 'other'].map(cat => {
                const val = parseFloat(revenueByCategory.summary?.[cat] || 0);
                if (val === 0) return null;
                return (
                  <div key={cat} className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground capitalize">{cat.replace('_', ' ')}</div>
                    <div className="text-lg font-bold mt-1">{fmt(val)}</div>
                  </div>
                );
              })}
              <div className="p-3 bg-primary/10 rounded-lg">
                <div className="text-xs text-muted-foreground">Grand Total</div>
                <div className="text-lg font-bold text-primary mt-1">{fmt(parseFloat(revenueByCategory.summary?.grand_total || 0))}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Collections by Method */}
      {collections && (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30"><span className="font-semibold text-[13px] text-foreground">Collections by Payment Method</span></div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {(collections.by_method || []).map((m: any) => (
                <div key={m.payment_method} className="p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground capitalize">{m.payment_method}</div>
                  <div className="text-lg font-bold mt-1">{fmt(parseFloat(m.total_collected))}</div>
                  <div className="text-xs text-muted-foreground">{m.payment_count} payments</div>
                </div>
              ))}
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="text-xs text-green-700">Total Collected</div>
                <div className="text-lg font-bold text-green-700 mt-1">{fmt(parseFloat(collections.totals?.total_collected || 0))}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Revenue Summary Table */}
      {revenueSummary && revenueSummary.length > 0 && (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30"><span className="font-semibold text-[13px] text-foreground">Revenue Summary</span></div>
          <div className="px-5 py-4">
            <AdvancedDataTable<any>
              data={revenueSummary}
              keyExtractor={(r, i) => i}
              columns={[
                { key: 'period', header: 'Period', render: (v) => <span className="font-medium">{v}</span> },
                { key: 'bill_count', header: 'Bills', align: 'right' },
                { key: 'total_billed', header: 'Billed', align: 'right', render: (v) => fmt(parseFloat(v)) },
                { key: 'total_collected', header: 'Collected', align: 'right', render: (v) => <span className="text-green-600">{fmt(parseFloat(v))}</span> },
                { key: 'total_outstanding', header: 'Outstanding', align: 'right', render: (v) => <span className="text-red-600">{fmt(parseFloat(v))}</span> },
                { key: 'total_discounts', header: 'Discounts', align: 'right', render: (v) => fmt(parseFloat(v || 0)) },
                { key: 'total_insurance', header: 'Insurance', align: 'right', render: (v) => fmt(parseFloat(v || 0)) },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default BillingManagement;
