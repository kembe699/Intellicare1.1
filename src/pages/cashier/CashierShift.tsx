import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { getStatusColor } from '@/lib/statusColors';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/contexts/CurrencyContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/lib/notify';
import { formatDuration } from '@/lib/format';
import { EmptyState } from '@/components/common/EmptyState/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { DollarSign, Clock, XCircle, ArrowRightLeft, Receipt, TrendingUp, Loader2, Undo2, Ban, FileText, Download, ChevronRight, ChevronDown } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface CashierShift {
  id: number;
  cashier_id: number;
  cashier_name: string;
  start_time: string;
  end_time: string | null;
  opening_balance: number;
  closing_balance: number | null;
  total_receipts: number;
  total_amount: number;
  status: 'open' | 'closed';
  notes: string | null;
  expected_cash?: number | null;
  cash_variance?: number | null;
  cash_transferred?: number | null;
}

interface ReceiptServiceDetail {
  index?: number;
  serviceName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  department?: string;
}

interface ShiftReceipt {
  id: number;
  receipt_number: string;
  patient_name: string;
  payment_amount: number;
  payment_method: string;
  created_at: string;
  notes?: string | null;
  service_details?: ReceiptServiceDetail[] | null;
  receipt_type?: string | null;
}

interface ShiftInvoice {
  id: string;
  invoice_number: string;
  patient_name: string;
  amount: number;
  amount_paid: number;
  balance_due: number;
  currency: string;
  status: string;
  scheme_name: string | null;
  created_at: string;
}

interface ShiftReport {
  shift: CashierShift;
  activeReceipts: ShiftReceipt[];
  voidedReceipts: ShiftReceipt[];
  refundedReceipts: ShiftReceipt[];
  invoices: ShiftInvoice[];
  totals: {
    collectedCash: number;
    collectedCard: number;
    collectedMobile: number;
    collectedOther: number;
    collectedTotal: number;
    voidedTotal: number;
    refundedTotal: number;
    invoicedTotal: number;
    invoicedCollected: number;
  };
}

interface CashierOption {
  cashier_id: number;
  cashier_name: string;
}

interface LedgerAccount {
  id: string;
  account_name: string;
  account_code: string;
  balance: number;
  current_balance?: number;
  account_type?: string;
  is_active?: boolean;
}

// The row a receipt expands into when clicked — the line items it actually covered.
const ReceiptItemsPanel: React.FC<{ details?: ReceiptServiceDetail[] | null; colSpan: number; receiptType?: string }> = ({ details: rawDetails, colSpan, receiptType }) => {
  // Backend now normalizes this array-shaped JSON field before sending, but guard here too
  // — a raw (unparsed) JSON string has a non-zero .length and would otherwise slip past the
  // emptiness check below and crash on .map().
  const details = Array.isArray(rawDetails) ? rawDetails : [];
  return (
  <tr className="bg-muted/20 border-b">
    <td colSpan={colSpan} className="px-6 sm:px-10 py-2">
      {details.length === 0 ? (
        <div className="text-xs text-muted-foreground py-1">
          {receiptType === 'deposit' ? 'Deposit taken — not tied to any billed service.'
            : receiptType === 'deposit_refund' ? 'Deposit refund — money paid back to the patient, not tied to any billed service.'
            : 'No item details recorded for this receipt.'}
        </div>
      ) : (
        <table className="w-full text-xs table-fixed">
          <colgroup>
            <col />
            <col className="w-12" />
            <col className="w-20" />
            <col className="w-20" />
          </colgroup>
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left py-1 font-normal">Item</th>
              <th className="text-left py-1 font-normal pl-2">Qty</th>
              <th className="text-right py-1 font-normal">Unit Price</th>
              <th className="text-right py-1 font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {details.map((d, i) => (
              <tr key={i} className="border-t border-border/50">
                <td className="py-1 truncate">{d.serviceName}</td>
                <td className="py-1 pl-2">{d.quantity}</td>
                <td className="py-1 text-right">{parseFloat(String(d.unitPrice || 0)).toFixed(2)}</td>
                <td className="py-1 text-right">{parseFloat(String(d.totalPrice || 0)).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </td>
  </tr>
  );
};

const CashierShift: React.FC = () => {
  const { user } = useAuth();
  const { fmt, currency } = useCurrency();
  const [currentShift, setCurrentShift] = useState<CashierShift | null>(null);
  const [shiftReceipts, setShiftReceipts] = useState<ShiftReceipt[]>([]);
  const [allShifts, setAllShifts] = useState<CashierShift[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
  const [cashAtHandAccount, setCashAtHandAccount] = useState<LedgerAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStartShiftModal, setShowStartShiftModal] = useState(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showShiftDetailsModal, setShowShiftDetailsModal] = useState(false);
  const [selectedShift, setSelectedShift] = useState<CashierShift | null>(null);
  const [shiftReport, setShiftReport] = useState<ShiftReport | null>(null);
  const [loadingShiftReport, setLoadingShiftReport] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('0');
  const [closingBalance, setClosingBalance] = useState('0');
  const [closingNotes, setClosingNotes] = useState('');
  const [transferAmount, setTransferAmount] = useState('0');
  const [transferAccount, setTransferAccount] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [filterCashierId, setFilterCashierId] = useState<string>('all');
  const [cashierOptions, setCashierOptions] = useState<CashierOption[]>([]);
  const [expandedShiftReceiptId, setExpandedShiftReceiptId] = useState<number | null>(null);
  const [expandedReportReceiptId, setExpandedReportReceiptId] = useState<number | null>(null);
  const [startingShift, setStartingShift] = useState(false);
  const [closingShift, setClosingShift] = useState(false);
  const [transferringCash, setTransferringCash] = useState(false);

  useEffect(() => {
    fetchCurrentShift();
    fetchLedgerAccounts();
    fetchAllShifts();
    if (user?.role === 'admin') fetchCashierOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchAllShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterStartDate, filterEndDate, filterCashierId]);

  useEffect(() => {
    if (currentShift) {
      fetchShiftReceipts(currentShift.id);
    }
  }, [currentShift]);

  const fetchCurrentShift = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await authFetch('/api/cashier/current-shift', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCurrentShift(data);
      } else {
        setCurrentShift(null);
      }
    } catch (error) {
      console.error('Failed to fetch current shift:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchShiftReceipts = async (shiftId: number) => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await authFetch(`/api/cashier/shift/${shiftId}/receipts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setShiftReceipts(data);
      }
    } catch (error) {
      toast.error('Failed to load shift receipts');
    }
  };

  const fetchLedgerAccounts = async () => {
    try {
      const clinicId = user?.clinic || 1;
      const response = await authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`);
      if (response.ok) {
        const data = await response.json();
        const active = data.filter((acc: LedgerAccount) => acc.is_active !== false);
        setLedgerAccounts(active);

        // Find Cash at Hand account by name (case-insensitive)
        const cashAtHand = active.find((acc: LedgerAccount) =>
          /cash.*(at|in|on).*hand/i.test(acc.account_name) ||
          /cash.at.hand/i.test(acc.account_name)
        ) || active.find((acc: LedgerAccount) =>
          /petty.cash/i.test(acc.account_name)
        ) || active.find((acc: LedgerAccount) =>
          acc.account_type === 'asset' && /cash/i.test(acc.account_name)
        );
        if (cashAtHand) setCashAtHandAccount(cashAtHand);
      }
    } catch (error) {
      console.error('Failed to fetch accounts');
    }
  };

  const fetchAllShifts = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      
      // Build query parameters for filters
      const params = new URLSearchParams();
      if (filterStatus && filterStatus !== 'all') {
        params.append('status', filterStatus);
      }
      if (filterStartDate) {
        params.append('startDate', filterStartDate);
      }
      if (filterEndDate) {
        params.append('endDate', filterEndDate);
      }
      if (filterCashierId && filterCashierId !== 'all') {
        params.append('cashierId', filterCashierId);
      }

      const queryString = params.toString();
      const url = `/api/cashier/shifts${queryString ? `?${queryString}` : ''}`;

      const response = await authFetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAllShifts(data);
      }
    } catch (error) {
      // Log the error itself: discarding it left "Failed to fetch shifts" in the
      // console with nothing to act on.
      console.error('Failed to fetch shifts:', error);
    }
  };

  const fetchCashierOptions = async () => {
    try {
      const response = await authFetch('/api/cashier/cashiers');
      if (response.ok) setCashierOptions(await response.json());
    } catch (error) {
      console.error('Failed to fetch cashier list');
    }
  };

  const handleShiftClick = async (shift: CashierShift) => {
    setSelectedShift(shift);
    setShiftReport(null);
    setShowShiftDetailsModal(true);
    setLoadingShiftReport(true);
    try {
      const response = await authFetch(`/api/cashier/shift/${shift.id}/report`);
      if (response.ok) {
        setShiftReport(await response.json());
      } else {
        toast.error('Failed to load shift report');
      }
    } catch (error) {
      toast.error('Failed to load shift report');
    } finally {
      setLoadingShiftReport(false);
    }
  };

  // One CSV covering everything finance needs to reconcile this cashier's shift —
  // collected receipts, reversed (voided/refunded) receipts, and invoices raised instead
  // of collecting cash, all clearly labeled by row type.
  const exportShiftReportCSV = (report: ShiftReport) => {
    const headers = ['Type', 'Reference #', 'Patient', 'Amount', 'Method / Status', 'Time'];
    const rows: string[][] = [];
    report.activeReceipts.forEach(r => rows.push(['Collected', r.receipt_number, r.patient_name, parseFloat(String(r.payment_amount || '0')).toFixed(2), r.payment_method, new Date(r.created_at).toLocaleString()]));
    report.voidedReceipts.forEach(r => rows.push(['Voided', r.receipt_number, r.patient_name, Math.abs(parseFloat(String(r.payment_amount || '0'))).toFixed(2), r.notes || '', new Date(r.created_at).toLocaleString()]));
    report.refundedReceipts.forEach(r => rows.push(['Refunded', r.receipt_number, r.patient_name, Math.abs(parseFloat(String(r.payment_amount || '0'))).toFixed(2), r.notes || '', new Date(r.created_at).toLocaleString()]));
    report.invoices.forEach(inv => rows.push(['Invoiced', inv.invoice_number, inv.patient_name, parseFloat(String(inv.amount || '0')).toFixed(2), `${inv.status}${inv.scheme_name ? ` (${inv.scheme_name})` : ''}`, new Date(inv.created_at).toLocaleString()]));

    const csvContent = 'data:text/csv;charset=utf-8,'
      + headers.join(',') + '\n'
      + rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `shift_${report.shift.id}_${report.shift.cashier_name.replace(/\s+/g, '_')}_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Just the receipts table, for a quick export without the void/refund/invoice sections.
  const exportReceiptsCSV = (receipts: ShiftReceipt[], filename: string) => {
    const headers = ['Receipt #', 'Patient', 'Amount', 'Method', 'Time'];
    const rows = receipts.map(r => [r.receipt_number, r.patient_name, parseFloat(String(r.payment_amount || '0')).toFixed(2), r.payment_method, new Date(r.created_at).toLocaleString()]);

    const csvContent = 'data:text/csv;charset=utf-8,'
      + headers.join(',') + '\n'
      + rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleStartShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (startingShift) return;
    try {
      setStartingShift(true);
      const token = localStorage.getItem('auth_token');
      const response = await authFetch('/api/cashier/start-shift', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ opening_balance: parseFloat(openingBalance) })
      });
      if (!response.ok) throw new Error('Failed to start shift');
      toast.success('Shift started successfully');
      setShowStartShiftModal(false);
      setOpeningBalance('0');
      fetchCurrentShift();
      fetchAllShifts();
    } catch (error) {
      toast.error('Failed to start shift');
    } finally {
      setStartingShift(false);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShift) return;
    if (closingShift) return;
    try {
      setClosingShift(true);
      const token = localStorage.getItem('auth_token');
      const response = await authFetch(`/api/cashier/close-shift/${currentShift.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          closing_balance: parseFloat(closingBalance),
          notes: closingNotes
        })
      });
      if (!response.ok) throw new Error('Failed to close shift');
      const closed = await response.json();
      const variance = parseFloat(closed.cash_variance ?? String(closingVariance));
      if (Math.abs(variance) < 0.01) {
        toast.success('Shift closed — cash drawer balanced. Now transfer cash to account');
      } else {
        toast.warning(
          `Shift closed with a cash ${variance > 0 ? 'overage' : 'shortage'} of SSP ${Math.abs(variance).toFixed(2)}. Now transfer cash to account`
        );
      }

      // Close the close shift modal
      setShowCloseShiftModal(false);
      setClosingBalance('0');
      setClosingNotes('');

      // Open transfer modal, pre-filled with whichever is smaller: the physically-counted
      // drawer amount, or what's actually available in the Cash at Hand ledger — never more
      // than the ledger can actually move, or the transfer is rejected before it's tried.
      const closingBalanceValue = parseFloat(closingBalance) || 0;
      setTransferAmount(String(Math.min(closingBalanceValue, availableCashAtHand)));
      setShowTransferModal(true);

      fetchCurrentShift();
      fetchAllShifts();
    } catch (error) {
      toast.error('Failed to close shift');
    } finally {
      setClosingShift(false);
    }
  };

  const handleTransferCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (transferringCash) return;

    // Validate required fields
    if (!transferAccount) {
      toast.error('Please select a destination account');
      return;
    }

    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      toast.error('Please enter a valid transfer amount');
      return;
    }

    if (parseFloat(transferAmount) > availableCashAtHand + 0.01) {
      toast.error(`Only SSP ${availableCashAtHand.toFixed(2)} is available in Cash at Hand — reduce the amount.`);
      return;
    }

    try {
      setTransferringCash(true);
      const token = localStorage.getItem('auth_token');
      const response = await authFetch('/api/cashier/transfer-cash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          shift_id: currentShift?.id || null,
          amount: parseFloat(transferAmount),
          to_account_id: transferAccount,
          notes: transferNotes || 'Cash transfer'
        })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to transfer cash');
      }

      const data = await response.json();
      toast.success(`Cash transferred to ${data.to_account} - Cash at Hand updated`);

      setShowTransferModal(false);
      setTransferAmount('0');
      setTransferAccount('');
      setTransferNotes('');
      fetchCurrentShift();
      fetchLedgerAccounts(); // Refresh to show updated balances including Cash at Hand
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to transfer cash');
    } finally {
      setTransferringCash(false);
    }
  };

  // What the "Transfer Cash" flow can actually move — the ledger's own tracked balance,
  // not the shift's physically-counted drawer total. Those two can legitimately diverge
  // (e.g. a prior shift's cash never transferred out, or a payment that failed to post to
  // the ledger), and pre-filling/allowing a transfer above this always gets rejected
  // server-side with "insufficient balance" — so cap against this everywhere up front.
  const availableCashAtHand = parseFloat(String(cashAtHandAccount?.current_balance ?? cashAtHandAccount?.balance ?? 0)) || 0;

  // A deposit refund is its own separate 'active' receipt (money leaving the drawer),
  // not a status flip on the original deposit receipt (which stays 'active' too) — so a
  // plain sum of payment_amount across shiftReceipts double-counts it as money received
  // twice instead of netting it out. Every total below must use this signed amount, never
  // the raw magnitude, or the shift's cash reconciliation comes out wrong.
  const signedReceiptAmount = (r: any) => {
    const magnitude = parseFloat(String(r.payment_amount || '0'));
    return r.receipt_type === 'deposit_refund' ? -magnitude : magnitude;
  };

  const totalCash = shiftReceipts
    .filter(r => r.payment_method === 'cash')
    .reduce((sum, r) => sum + signedReceiptAmount(r), 0);

  const totalMobile = shiftReceipts
    .filter(r => r.payment_method === 'mobile_money')
    .reduce((sum, r) => sum + signedReceiptAmount(r), 0);

  const totalCard = shiftReceipts
    .filter(r => r.payment_method === 'card')
    .reduce((sum, r) => sum + signedReceiptAmount(r), 0);

  // Estimate only — the authoritative expected-cash figure (net of any mid-shift cash
  // transfers) is computed server-side in POST /cashier/close-shift/:id.
  const expectedCashComponents = {
    cashTotal: totalCash,
    expectedCash: parseFloat(String(currentShift?.opening_balance || '0')) + totalCash
  };
  const closingVariance = closingBalance === '' ? 0 :
    Math.round((parseFloat(closingBalance || '0') - expectedCashComponents.expectedCash) * 100) / 100;

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<DollarSign />}
          title="Cashier Shift"
          actions={
            !currentShift ? (
              <Button onClick={() => setShowStartShiftModal(true)}>
                <Clock className="w-4 h-4 mr-2" />Start Shift
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowTransferModal(true)}>
                  <ArrowRightLeft className="w-4 h-4 mr-2" />Transfer Cash
                </Button>
                <Button variant="destructive" onClick={() => setShowCloseShiftModal(true)}>
                  <XCircle className="w-4 h-4 mr-2" />Close Shift
                </Button>
              </div>
            )
          }
        />

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-3 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-6 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !currentShift ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Clock className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">No active shift</p>
                <p className="text-sm">Start a new shift to begin accepting payments</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Opening Balance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">SSP {parseFloat(String(currentShift.opening_balance || '0')).toFixed(2)}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Receipts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{shiftReceipts.length}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Amount</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">
                    SSP {shiftReceipts.reduce((sum, r) => sum + signedReceiptAmount(r), 0).toFixed(2)}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Shift Duration</CardTitle>
                </CardHeader>
                <CardContent>
                  {currentShift.start_time && !Number.isNaN(new Date(currentShift.start_time).getTime()) ? (
                    <div className="text-2xl font-bold">
                      {formatDuration(new Date().getTime() - new Date(currentShift.start_time).getTime())}
                    </div>
                  ) : (
                    <>
                      <div className="text-2xl font-bold">—</div>
                      <p className="text-xs text-muted-foreground mt-1">No shift open</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Cash Payments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">SSP {totalCash.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">
                    {shiftReceipts.filter(r => r.payment_method === 'cash').length} transactions
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Mobile Money</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">SSP {totalMobile.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">
                    {shiftReceipts.filter(r => r.payment_method === 'mobile_money').length} transactions
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Card Payments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">SSP {totalCard.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">
                    {shiftReceipts.filter(r => r.payment_method === 'card').length} transactions
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="w-5 h-5" />
                  Shift Receipts
                </CardTitle>
              </CardHeader>
              <CardContent>
                {shiftReceipts.length === 0 ? (
                  <EmptyState
                    icon={Receipt}
                    title="No receipts yet"
                    message="Receipts taken during this shift will show up here as payments come in."
                  />
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="max-h-[420px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="p-2.5 text-left font-medium">Receipt #</th>
                            <th className="p-2.5 text-left font-medium">Patient</th>
                            <th className="p-2.5 text-left font-medium">Amount</th>
                            <th className="p-2.5 text-left font-medium">Payment Method</th>
                            <th className="p-2.5 text-left font-medium">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shiftReceipts.map(receipt => {
                            const isExpanded = expandedShiftReceiptId === receipt.id;
                            return (
                              <React.Fragment key={receipt.id}>
                                <tr
                                  className="border-b hover:bg-muted/50 cursor-pointer"
                                  onClick={() => setExpandedShiftReceiptId(isExpanded ? null : receipt.id)}
                                >
                                  <td className="p-2.5">
                                    <span className="inline-flex items-center gap-1">
                                      {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                                      {receipt.receipt_number}
                                    </span>
                                  </td>
                                  <td className="p-2.5">
                                    {receipt.patient_name}
                                    {receipt.receipt_type === 'deposit' && <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-info-bg text-info">Deposit</span>}
                                    {receipt.receipt_type === 'deposit_refund' && <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-destructive-bg text-destructive">Deposit Refund</span>}
                                  </td>
                                  <td className={cn('p-2.5', receipt.receipt_type === 'deposit_refund' && 'text-destructive font-medium')}>
                                    {receipt.receipt_type === 'deposit_refund' ? '-' : ''}SSP {parseFloat(String(receipt.payment_amount || '0')).toFixed(2)}
                                  </td>
                                  <td className="p-2.5 capitalize">{receipt.payment_method.replace('_', ' ')}</td>
                                  <td className="p-2.5 text-muted-foreground">
                                    {new Date(receipt.created_at).toLocaleTimeString()}
                                  </td>
                                </tr>
                                {isExpanded && <ReceiptItemsPanel details={receipt.service_details} colSpan={5} receiptType={receipt.receipt_type} />}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Shift History</CardTitle>
              {user?.role === 'admin' && (
                <div className="flex gap-2 items-center flex-wrap">
                  <Combobox
                    options={[{ value: 'all', label: 'All Cashiers' }, ...cashierOptions.map(c => ({ value: String(c.cashier_id), label: c.cashier_name }))]}
                    value={filterCashierId}
                    onChange={setFilterCashierId}
                    placeholder="Cashier"
                    searchPlaceholder="Search cashiers..."
                    className="w-[170px]"
                  />
                  <Combobox
                    options={[
                      { value: 'all', label: 'All Status' },
                      { value: 'open', label: 'Open' },
                      { value: 'closed', label: 'Closed' },
                    ]}
                    value={filterStatus}
                    onChange={setFilterStatus}
                    placeholder="Status"
                    searchPlaceholder="Search..."
                    className="w-[140px]"
                  />
                  <Input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    placeholder="Start Date"
                    className="w-[150px]"
                  />
                  <Input
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    placeholder="End Date"
                    className="w-[150px]"
                  />
                  {(filterStatus !== 'all' || filterStartDate || filterEndDate || filterCashierId !== 'all') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFilterStatus('all');
                        setFilterStartDate('');
                        setFilterEndDate('');
                        setFilterCashierId('all');
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <AdvancedDataTable<CashierShift>
              data={allShifts}
              keyExtractor={(shift) => shift.id}
              onRowClick={(shift) => handleShiftClick(shift)}
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'cashier_name', header: 'Cashier', sortable: true },
                { key: 'start_time', header: 'Start Time', sortable: true, render: (v) => <span className="text-sm">{new Date(v).toLocaleString()}</span> },
                { key: 'end_time', header: 'End Time', sortable: true, render: (v) => <span className="text-sm">{v ? new Date(v).toLocaleString() : '-'}</span> },
                { key: 'opening_balance', header: 'Opening', sortable: true, render: (v) => fmt(parseFloat(String(v || '0'))) },
                { key: 'closing_balance', header: 'Closing', sortable: true, render: (v) => v ? fmt(parseFloat(String(v))) : '-' },
                { key: 'total_receipts', header: 'Receipts', sortable: true },
                { key: 'total_amount', header: 'Total', sortable: true, render: (v) => <span className="font-semibold">{fmt(parseFloat(String(v || '0')))}</span> },
                {
                  key: 'cash_variance', header: 'Variance',
                  render: (v) => {
                    const variance = v != null ? parseFloat(String(v)) : null;
                    if (variance === null) return '-';
                    return (
                      <span className={`text-xs font-semibold ${
                        Math.abs(variance) < 0.01 ? 'text-success' : variance > 0 ? 'text-info' : 'text-destructive'
                      }`}>
                        {Math.abs(variance) < 0.01 ? 'Balanced' : `${variance > 0 ? '+' : ''}${variance.toFixed(2)}`}
                      </span>
                    );
                  },
                },
                {
                  key: 'status', header: 'Status', sortable: true,
                  render: (v) => <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(v)}`}>{v}</span>,
                },
              ]}
            />
          </CardContent>
        </Card>

        <Dialog open={showStartShiftModal} onOpenChange={setShowStartShiftModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start New Shift</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleStartShift} className="px-5 py-4 space-y-4">
              <div>
                <Label>Opening Balance ({currency.code})</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={openingBalance}
                  onChange={e => setOpeningBalance(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={startingShift}>
                {startingShift ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Clock className="w-4 h-4 mr-2" />}
                {startingShift ? 'Starting...' : 'Start Shift'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={showCloseShiftModal} onOpenChange={(open) => { setShowCloseShiftModal(open); if (!open) { setClosingBalance('0'); setClosingNotes(''); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Close Shift — Count Cash Drawer</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCloseShift} className="px-5 py-4 space-y-4">
              <div className="bg-muted p-4 rounded-lg">
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Opening Float:</span>
                    <span className="font-semibold">SSP {parseFloat(String(currentShift?.opening_balance || '0')).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>+ Cash Payments Received:</span>
                    <span className="font-semibold">SSP {expectedCashComponents.cashTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-1 mt-1">
                    <span>Expected Cash in Drawer:</span>
                    <span>SSP {expectedCashComponents.expectedCash.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground pt-1">
                    Card and mobile money payments are excluded — they never touch the physical drawer.
                  </p>
                </div>
              </div>
              <div>
                <Label>Physically Counted Cash (SSP) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={closingBalance}
                  onChange={e => setClosingBalance(e.target.value)}
                  placeholder="Count the drawer and enter the actual amount"
                  required
                />
              </div>
              {closingBalance !== '' && (
                <div className={`p-3 rounded-lg text-sm font-semibold flex justify-between ${
                  Math.abs(closingVariance) < 0.01 ? 'bg-success-bg text-success' :
                  closingVariance > 0 ? 'bg-info-bg text-info' : 'bg-destructive-bg text-destructive'
                }`}>
                  <span>{Math.abs(closingVariance) < 0.01 ? 'Balanced' : closingVariance > 0 ? 'Over' : 'Short'}</span>
                  <span>SSP {closingVariance.toFixed(2)}</span>
                </div>
              )}
              <div>
                <Label>Notes {closingVariance !== 0 ? '(explain the variance)' : '(Optional)'}</Label>
                <Textarea
                  value={closingNotes}
                  onChange={e => setClosingNotes(e.target.value)}
                  placeholder="Any notes about this shift..."
                />
              </div>
              <Button type="submit" variant="destructive" className="w-full" disabled={closingShift}>
                {closingShift ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                {closingShift ? 'Closing Shift...' : 'Close Shift'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={showTransferModal} onOpenChange={(open) => { setShowTransferModal(open); if (!open) { setTransferAmount('0'); setTransferAccount(''); setTransferNotes(''); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Transfer Cash from Cash at Hand</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleTransferCash} className="px-5 py-4 space-y-4">
              <div className="bg-primary/10 p-3 rounded-lg mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Available: SSP {availableCashAtHand.toFixed(2)}</div>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setTransferAmount(String(availableCashAtHand))}>
                  Use Max
                </Button>
              </div>
              <div>
                <Label>Amount (SSP)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={transferAmount}
                  onChange={e => setTransferAmount(e.target.value)}
                  required
                />
                {parseFloat(transferAmount || '0') > availableCashAtHand + 0.01 && (
                  <p className="text-xs text-destructive mt-1">Exceeds the SSP {availableCashAtHand.toFixed(2)} available in Cash at Hand.</p>
                )}
              </div>
              <div>
                <Label>Transfer To Account *</Label>
                <Combobox
                  options={ledgerAccounts
                    .filter(account => account.id !== cashAtHandAccount?.id)
                    .map(account => ({ value: account.id.toString(), label: `${account.account_name} (${account.account_code})` }))}
                  value={transferAccount}
                  onChange={setTransferAccount}
                  placeholder="Select account"
                  searchPlaceholder="Search accounts..."
                  emptyText="No matching accounts"
                />
              </div>
              <div>
                <Label>Notes (Optional)</Label>
                <Textarea
                  value={transferNotes}
                  onChange={e => setTransferNotes(e.target.value)}
                  placeholder="Transfer notes (optional)..."
                />
              </div>
              <Button type="submit" className="w-full" disabled={transferringCash || parseFloat(transferAmount || '0') > availableCashAtHand + 0.01}>
                {transferringCash ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 mr-2" />}
                {transferringCash ? 'Transferring...' : 'Transfer Cash'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={showShiftDetailsModal} onOpenChange={setShowShiftDetailsModal}>
          <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between gap-4 pr-6">
                <DialogTitle>End of Day Report — {selectedShift?.cashier_name}</DialogTitle>
                {shiftReport && (
                  <Button variant="outline" size="sm" onClick={() => exportShiftReportCSV(shiftReport)}>
                    <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
                  </Button>
                )}
              </div>
            </DialogHeader>
            {selectedShift && (
              <div className="space-y-5 px-5 py-4">
                <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                  <div>
                    <div className="text-sm text-muted-foreground">Cashier</div>
                    <div className="font-semibold">{selectedShift.cashier_name}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Status</div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      getStatusColor(selectedShift.status)
                    }`}>
                      {selectedShift.status}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Start Time</div>
                    <div className="font-semibold">{new Date(selectedShift.start_time).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">End Time</div>
                    <div className="font-semibold">{selectedShift.end_time ? new Date(selectedShift.end_time).toLocaleString() : 'Ongoing'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Opening Balance</div>
                    <div className="font-semibold">{fmt(parseFloat(String(selectedShift.opening_balance || '0')))}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Closing Balance</div>
                    <div className="font-semibold">{selectedShift.closing_balance ? fmt(parseFloat(String(selectedShift.closing_balance))) : '-'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Total Receipts</div>
                    <div className="font-semibold">{selectedShift.total_receipts}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Total Amount</div>
                    <div className="font-semibold text-success">{fmt(parseFloat(String(selectedShift.total_amount || '0')))}</div>
                  </div>
                  {selectedShift.expected_cash != null && (
                    <div>
                      <div className="text-sm text-muted-foreground">Expected Cash</div>
                      <div className="font-semibold">{fmt(parseFloat(String(selectedShift.expected_cash)))}</div>
                    </div>
                  )}
                  {selectedShift.cash_variance != null && (
                    <div>
                      <div className="text-sm text-muted-foreground">Cash Variance</div>
                      <div className={`font-semibold ${
                        Math.abs(parseFloat(String(selectedShift.cash_variance))) < 0.01 ? 'text-success' :
                        parseFloat(String(selectedShift.cash_variance)) > 0 ? 'text-info' : 'text-destructive'
                      }`}>
                        {Math.abs(parseFloat(String(selectedShift.cash_variance))) < 0.01 ? 'Balanced' :
                          `${parseFloat(String(selectedShift.cash_variance)) > 0 ? 'Over' : 'Short'} ${fmt(Math.abs(parseFloat(String(selectedShift.cash_variance))))}`}
                      </div>
                    </div>
                  )}
                </div>

                {loadingShiftReport ? (
                  <div className="text-center py-10 text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading report...
                  </div>
                ) : shiftReport ? (
                  <>
                    {/* Reconciliation summary — what finance actually needs at a glance */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 rounded-lg border bg-success-bg border-success-border">
                        <div className="text-xs text-success">Collected</div>
                        <div className="text-lg font-bold text-success">{fmt(shiftReport.totals.collectedTotal)}</div>
                        <div className="text-xs text-success/80">{shiftReport.activeReceipts.length} receipt{shiftReport.activeReceipts.length !== 1 ? 's' : ''}</div>
                      </div>
                      <div className="p-3 rounded-lg border bg-destructive-bg border-destructive-border">
                        <div className="text-xs text-destructive flex items-center gap-1"><Ban className="w-3 h-3" /> Voided</div>
                        <div className="text-lg font-bold text-destructive">{fmt(shiftReport.totals.voidedTotal)}</div>
                        <div className="text-xs text-destructive/80">{shiftReport.voidedReceipts.length} receipt{shiftReport.voidedReceipts.length !== 1 ? 's' : ''}</div>
                      </div>
                      <div className="p-3 rounded-lg border bg-warning-bg border-warning-border">
                        <div className="text-xs text-warning flex items-center gap-1"><Undo2 className="w-3 h-3" /> Refunded</div>
                        <div className="text-lg font-bold text-warning">{fmt(shiftReport.totals.refundedTotal)}</div>
                        <div className="text-xs text-warning/80">{shiftReport.refundedReceipts.length} receipt{shiftReport.refundedReceipts.length !== 1 ? 's' : ''}</div>
                      </div>
                      <div className="p-3 rounded-lg border bg-indigo-50 border-indigo-200">
                        <div className="text-xs text-indigo-700 flex items-center gap-1"><FileText className="w-3 h-3" /> Invoiced</div>
                        <div className="text-lg font-bold text-indigo-700">{fmt(shiftReport.totals.invoicedTotal)}</div>
                        <div className="text-xs text-indigo-700/80">{shiftReport.invoices.length} invoice{shiftReport.invoices.length !== 1 ? 's' : ''}</div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold flex items-center gap-2"><Receipt className="w-4 h-4" /> Receipts Collected</h3>
                        {shiftReport.activeReceipts.length > 0 && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => exportReceiptsCSV(shiftReport.activeReceipts, `shift_${shiftReport.shift.id}_receipts.csv`)}>
                            <Download className="w-3 h-3 mr-1.5" /> Export CSV
                          </Button>
                        )}
                      </div>
                      {shiftReport.activeReceipts.length === 0 ? (
                        <p className="text-center text-muted-foreground py-4 text-sm">No receipts</p>
                      ) : (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="max-h-[420px] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-muted sticky top-0">
                                <tr>
                                  <th className="p-2 text-left font-medium">Receipt #</th>
                                  <th className="p-2 text-left font-medium">Patient</th>
                                  <th className="p-2 text-left font-medium">Amount</th>
                                  <th className="p-2 text-left font-medium">Method</th>
                                  <th className="p-2 text-left font-medium">Time</th>
                                </tr>
                              </thead>
                              <tbody>
                                {shiftReport.activeReceipts.map(receipt => {
                                  const isExpanded = expandedReportReceiptId === receipt.id;
                                  return (
                                    <React.Fragment key={receipt.id}>
                                      <tr
                                        className="border-b hover:bg-muted/50 cursor-pointer"
                                        onClick={() => setExpandedReportReceiptId(isExpanded ? null : receipt.id)}
                                      >
                                        <td className="p-2">
                                          <span className="inline-flex items-center gap-1">
                                            {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                                            {receipt.receipt_number}
                                          </span>
                                        </td>
                                        <td className="p-2">
                                          {receipt.patient_name}
                                          {receipt.receipt_type === 'deposit' && <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-info-bg text-info">Deposit</span>}
                                          {receipt.receipt_type === 'deposit_refund' && <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-destructive-bg text-destructive">Deposit Refund</span>}
                                        </td>
                                        <td className={cn('p-2', receipt.receipt_type === 'deposit_refund' && 'text-destructive font-medium')}>
                                          {receipt.receipt_type === 'deposit_refund' ? '-' : ''}SSP {parseFloat(String(receipt.payment_amount || '0')).toFixed(2)}
                                        </td>
                                        <td className="p-2 capitalize">{receipt.payment_method.replace('_', ' ')}</td>
                                        <td className="p-2">{new Date(receipt.created_at).toLocaleTimeString()}</td>
                                      </tr>
                                      {isExpanded && <ReceiptItemsPanel details={receipt.service_details} colSpan={5} receiptType={receipt.receipt_type} />}
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>

                    {(shiftReport.voidedReceipts.length > 0 || shiftReport.refundedReceipts.length > 0) && (
                      <div>
                        <h3 className="font-semibold mb-2 flex items-center gap-2 text-destructive"><Ban className="w-4 h-4" /> Voided / Refunded</h3>
                        <AdvancedDataTable<any>
                          data={[...shiftReport.voidedReceipts.map(r => ({ ...r, kind: 'Voided' })), ...shiftReport.refundedReceipts.map(r => ({ ...r, kind: 'Refunded' }))]
                            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())}
                          keyExtractor={(receipt) => `${receipt.kind}-${receipt.id}`}
                          columns={[
                            { key: 'receipt_number', header: 'Receipt #' },
                            { key: 'patient_name', header: 'Patient' },
                            { key: 'payment_amount', header: 'Amount', render: (v) => <span className="font-semibold text-destructive">SSP {Math.abs(parseFloat(String(v || '0'))).toFixed(2)}</span> },
                            {
                              key: 'kind', header: 'Type',
                              render: (v) => <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${v === 'Voided' ? 'bg-destructive-bg text-destructive' : 'bg-warning-bg text-warning'}`}>{v}</span>,
                            },
                            { key: 'notes', header: 'Reason', render: (v) => <span className="text-muted-foreground">{v || '-'}</span> },
                            { key: 'created_at', header: 'Time', render: (v) => new Date(v).toLocaleTimeString() },
                          ]}
                        />
                      </div>
                    )}

                    {shiftReport.invoices.length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-2 flex items-center gap-2 text-indigo-700"><FileText className="w-4 h-4" /> Invoices Created</h3>
                        <AdvancedDataTable<ShiftInvoice>
                          data={shiftReport.invoices}
                          keyExtractor={(inv) => inv.id}
                          columns={[
                            { key: 'invoice_number', header: 'Invoice #', render: (v) => <span className="font-mono text-primary">{v}</span> },
                            { key: 'patient_name', header: 'Patient' },
                            { key: 'amount', header: 'Amount', render: (v, inv) => <span className="font-semibold">{inv.currency} {parseFloat(String(v || '0')).toFixed(2)}</span> },
                            { key: 'amount_paid', header: 'Paid', render: (v, inv) => <>{inv.currency} {parseFloat(String(v || '0')).toFixed(2)}</> },
                            { key: 'status', header: 'Status', render: (v) => <span className="capitalize">{v}</span> },
                            { key: 'scheme_name', header: 'Scheme', render: (v) => v || '-' },
                            { key: 'created_at', header: 'Time', render: (v) => new Date(v).toLocaleTimeString() },
                          ]}
                        />
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default CashierShift;
