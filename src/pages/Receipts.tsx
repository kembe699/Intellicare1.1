import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { PaymentReceipt, printThermalReceipt } from '@/components/receipts/PaymentReceipt';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from '@/lib/notify';
import { FileText, Search, Download, Loader2, X, Printer, Ban, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { usePDFDocument } from '@/hooks/usePDFDocument';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface Receipt {
  id: string;
  receipt_number: string;
  bill_id?: string | null;
  patient_id?: string | null;
  /** The patient's own reference (UH-…, a participant number), not the row id. */
  patient_ref?: string | null;
  patient_name?: string | null;
  clinic_id: number;
  payment_amount: number;
  payment_method: 'cash' | 'card' | 'check' | 'lease' | 'insurance' | 'bank_transfer' | 'deposit';
  // 'deposit'/'deposit_refund' receipts have bill_id: null — money moving in/out of a
  // patient's prepaid balance, not tied to any specific bill.
  receipt_type?: 'payment' | 'deposit' | 'deposit_refund';
  payment_date: string;
  paid_services: string[];
  service_details: Array<{
    index: number;
    serviceName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    department: string;
    discountLabel?: string | null;
  }>;
  notes?: string;
  from_lease: boolean;
  lease_details?: string;
  cashier_name?: string;
  cashier_id?: string;
  // B5: 'pending_void'/'pending_refund' — a void/refund request awaiting a
  // second person's approval (see /:receiptId/approve-void, /reject-void on
  // the backend). Approving/rejecting those is not yet exposed here; a
  // pending receipt still shows correctly, it just can't be actioned from
  // this page until that follow-up UI lands.
  status: 'active' | 'voided' | 'refunded' | 'pending_void' | 'pending_refund';
  created_at: string;
  updated_at: string;
}

const toAmount = (v: any) => (typeof v === 'number' ? v : parseFloat(v) || 0);

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'voided', label: 'Voided' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'pending_void', label: 'Pending Void' },
  { value: 'pending_refund', label: 'Pending Refund' },
];

const METHOD_FILTER_OPTIONS = [
  { value: 'all', label: 'All methods' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'check', label: 'Cheque' },
  { value: 'lease', label: 'Lease' },
  { value: 'insurance', label: 'Insurance' },
];

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  voided: 'Voided',
  refunded: 'Refunded',
  pending_void: 'Pending Void',
  pending_refund: 'Pending Refund',
};

const statusBadge = (status: Receipt['status']) => {
  const map: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    voided: 'bg-red-50 text-red-700 border-red-200',
    refunded: 'bg-amber-50 text-amber-700 border-amber-200',
    pending_void: 'bg-orange-50 text-orange-700 border-orange-200',
    pending_refund: 'bg-orange-50 text-orange-700 border-orange-200',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border ${map[status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
};

export default function Receipts() {
  const { user } = useAuth();
  const { facilityName, branchName } = useFacilityInfo();
  const thermalRef = useRef<HTMLDivElement>(null);
  const { downloadPDF, loading: pdfLoading } = usePDFDocument();

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  // Off by default: a plain cancel just reverses the payment, leaving the
  // billed item(s) unpaid and payable again (e.g. wrong payment method,
  // redo the same charge). Checking this also marks those item(s) voided —
  // same red/struck-through "Voided" treatment as /void-item — so they can
  // never be paid for again, while the rest of the bill (and anything added
  // to it afterward) stays normal and payable.
  const [cancelItemsOnVoid, setCancelItemsOnVoid] = useState(false);

  // Live bill state for the selected receipt — used to know which line items are
  // already voided (a receipt itself never changes after the fact) and to void one.
  const [billServices, setBillServices] = useState<Array<{ serviceName: string; quantity?: number; unitPrice?: number; totalPrice: number; isVoided?: boolean; discountLabel?: string | null }> | null>(null);
  const [loadingBill, setLoadingBill] = useState(false);
  const [voidItemIndex, setVoidItemIndex] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidingItem, setVoidingItem] = useState(false);

  useEffect(() => {
    fetchReceipts();
  }, []);

  useEffect(() => {
    if (selectedReceipt?.bill_id) {
      fetchBillServices(selectedReceipt.bill_id);
    } else {
      setBillServices(null);
    }
  }, [selectedReceipt?.bill_id]);

  const fetchBillServices = async (billId: string) => {
    setLoadingBill(true);
    try {
      const res = await authFetch(`/api/patient-bills/${billId}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setBillServices(Array.isArray(data.services) ? data.services : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingBill(false);
    }
  };

  const fetchReceipts = async () => {
    setLoading(true);
    try {
      const clinicId = user?.clinic || '1';
      const res = await authFetch(`/api/receipts/clinic/${clinicId}`, { credentials: 'include' });
      if (res.ok) setReceipts(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch receipts');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelReceipt = async () => {
    if (!selectedReceipt || !cancellationReason.trim()) {
      toast.error('Please provide a cancellation reason');
      return;
    }
    setCancelling(true);
    try {
      const res = await authFetch(`/api/receipts/${selectedReceipt.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'voided', reason: cancellationReason, cancelItems: cancelItemsOnVoid }),
      });
      if (res.ok) {
        const result = await res.json();
        // B5: a requester without approval authority gets a pending request,
        // not an immediate void — say so, rather than claiming it's done.
        toast.success(result.pendingApproval ? 'Void request submitted for approval' : 'Receipt cancelled successfully');
        setShowCancelModal(false);
        setCancellationReason('');
        setCancelItemsOnVoid(false);
        setSelectedReceipt(null);
        fetchReceipts();
      } else {
        toast.error('Failed to cancel receipt');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setCancelling(false);
    }
  };

  const handleVoidItem = async () => {
    if (!selectedReceipt?.bill_id || voidItemIndex === null) return;
    setVoidingItem(true);
    try {
      const res = await authFetch(`/api/patient-bills/${selectedReceipt.bill_id}/void-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ serviceIndex: voidItemIndex, reason: voidReason }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          data.resultingCredit > 0
            ? `Item voided. This bill now has a credit of ${toAmount(data.resultingCredit).toFixed(2)} since the amount was already paid.`
            : 'Item voided from the bill.'
        );
        setBillServices(Array.isArray(data.bill?.services) ? data.bill.services : billServices);
        setVoidItemIndex(null);
        setVoidReason('');
      } else {
        toast.error(data.error || 'Failed to void item');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setVoidingItem(false);
    }
  };

  const handlePrintReceipt = () => {
    if (!thermalRef.current) return;
    printThermalReceipt(thermalRef.current);
  };

  const filteredReceipts = receipts.filter(r => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      r.receipt_number?.toLowerCase().includes(q) ||
      (r.patient_name || '').toLowerCase().includes(q) ||
      (r.patient_ref || '').toLowerCase().includes(q) ||
      (r.patient_id || '').toLowerCase().includes(q) ||
      (r.cashier_name || '').toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    const matchesMethod = methodFilter === 'all' || r.payment_method === methodFilter;
    const receiptDate = r.payment_date ? r.payment_date.slice(0, 10) : '';
    const matchesDate =
      (!filterDateFrom || !receiptDate || receiptDate >= filterDateFrom) &&
      (!filterDateTo || !receiptDate || receiptDate <= filterDateTo);
    return matchesSearch && matchesStatus && matchesMethod && matchesDate;
  });

  const displayServices = Array.isArray(selectedReceipt?.service_details) && selectedReceipt.service_details.length > 0
    ? selectedReceipt.service_details
    : (billServices?.map((bs, i) => ({
        serviceName: bs.serviceName || 'Unknown Service',
        quantity: bs.quantity || 1,
        unitPrice: bs.unitPrice ?? bs.totalPrice ?? 0,
        totalPrice: bs.totalPrice ?? 0,
        index: i,
        discountLabel: bs.discountLabel ?? null,
      })) || []);

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
        <PageHeader title="Receipts" icon={<FileText />} className="mb-3" />

        <div className="flex-1 min-h-0 bg-card rounded-lg border shadow-sm p-0 flex flex-col overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
            <h3 className="font-medium">Receipt Directory</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative w-56">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input placeholder="Search receipt or patient..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Combobox
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={setStatusFilter}
                searchPlaceholder="Search..."
                className="w-40 h-9"
              />
              <Combobox
                options={METHOD_FILTER_OPTIONS}
                value={methodFilter}
                onChange={setMethodFilter}
                searchPlaceholder="Search..."
                className="w-40 h-9"
              />
              <Input type="date" className="h-9 w-[140px]" value={filterDateFrom} max={filterDateTo || undefined} onChange={e => setFilterDateFrom(e.target.value)} />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" className="h-9 w-[140px]" value={filterDateTo} min={filterDateFrom || undefined} onChange={e => setFilterDateTo(e.target.value)} />
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <AdvancedDataTable<Receipt>
              data={filteredReceipts}
              keyExtractor={(r) => r.id}
              loading={loading}
              emptyMessage="No receipts found."
              onRowClick={(r) => setSelectedReceipt(r)}
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                {
                  key: 'receipt_number', header: 'Receipt No.', sortable: true,
                  render: (v, r) => (
                    <>
                      {v}
                      {r.receipt_type && r.receipt_type !== 'payment' && (
                        <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border ${r.receipt_type === 'deposit' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                          {r.receipt_type === 'deposit' ? 'Deposit' : 'Deposit Refund'}
                        </span>
                      )}
                    </>
                  ),
                },
                {
                  key: 'patient_name', header: 'Patient',
                  render: (v, r) => (
                    <>
                      {v || 'Walk-in Patient'}
                      {/* The patient's own reference, not the internal row id —
                          a raw UUID beside every name is noise. */}
                      <span className="text-xs text-muted-foreground ml-1">{r.patient_ref ? `(${r.patient_ref})` : ''}</span>
                    </>
                  ),
                },
                { key: 'payment_amount', header: 'Amount', sortable: true, render: (v) => <span className="font-medium">{toAmount(v).toFixed(2)}</span> },
                { key: 'payment_method', header: 'Method', render: (v) => <span className="capitalize text-muted-foreground">{v}</span> },
                { key: 'payment_date', header: 'Date', sortable: true, render: (v) => <span className="text-muted-foreground">{new Date(v).toLocaleDateString()}</span> },
                { key: 'cashier_name', header: 'Cashier', render: (v) => <span className="text-muted-foreground">{v || 'Unknown'}</span> },
                { key: 'status', header: 'Status', render: (v) => statusBadge(v) },
              ]}
            />
          </div>
        </div>
      </div>
      </div>

      {/* Receipt Details Modal */}
      {selectedReceipt && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-lg rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> {selectedReceipt.receipt_number}
                {selectedReceipt.receipt_type && selectedReceipt.receipt_type !== 'payment' && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${selectedReceipt.receipt_type === 'deposit' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                    {selectedReceipt.receipt_type === 'deposit' ? 'Deposit' : 'Deposit Refund'}
                  </span>
                )}
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedReceipt(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-6 flex-1 overflow-auto space-y-4">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="bg-muted/30 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p className="font-bold">{toAmount(selectedReceipt.payment_amount).toFixed(2)}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-muted-foreground">Method</p>
                  <p className="font-bold capitalize">{selectedReceipt.payment_method}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-bold">{statusBadge(selectedReceipt.status)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <span className="text-muted-foreground">Patient</span>
                <span className="text-right">{selectedReceipt.patient_name || 'Walk-in Patient'}</span>
                <span className="text-muted-foreground">Payment Date</span>
                <span className="text-right">{new Date(selectedReceipt.payment_date).toLocaleDateString()}</span>
                <span className="text-muted-foreground">Cashier</span>
                <span className="text-right">{selectedReceipt.cashier_name || 'Unknown'}</span>
              </div>

              {selectedReceipt.notes && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{selectedReceipt.notes}</p>
                </div>
              )}

              {displayServices.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase">Service Items</p>
                    {loadingBill && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                  </div>
                  <AdvancedDataTable<any>
                    data={displayServices}
                    keyExtractor={(s, i) => i}
                    rowClassName={(s) => billServices?.[s.index]?.isVoided ? 'bg-red-50/40' : ''}
                    columns={[
                      { key: 'serviceName', header: 'Service', render: (v, s) => <span className={billServices?.[s.index]?.isVoided ? 'line-through text-muted-foreground' : ''}>{v}</span> },
                      { key: 'quantity', header: 'Qty', align: 'right', render: (v, s) => <span className={billServices?.[s.index]?.isVoided ? 'line-through text-muted-foreground' : ''}>{v}</span> },
                      { key: 'totalPrice', header: 'Amount', align: 'right', render: (v, s) => <span className={`font-mono ${billServices?.[s.index]?.isVoided ? 'line-through text-muted-foreground' : ''}`}>{toAmount(v).toFixed(2)}</span> },
                      {
                        key: '__void', header: '', width: '5rem', align: 'right',
                        render: (_v, s) => {
                          const isVoided = !!billServices?.[s.index]?.isVoided;
                          if (isVoided) {
                            return (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border bg-red-50 text-red-700 border-red-200">
                                Voided
                              </span>
                            );
                          }
                          return selectedReceipt.status === 'active' && selectedReceipt.bill_id ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => { setVoidItemIndex(s.index); setVoidReason(''); }}
                              disabled={loadingBill}
                            >
                              Void
                            </Button>
                          ) : null;
                        },
                      },
                    ]}
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Voiding an item removes it from the bill's total. Since it was already paid, the bill will show a credit for that amount rather than an automatic refund.
                  </p>
                </div>
              )}

              {/* Hidden thermal receipt used as the print/PDF source */}
              <div ref={thermalRef} style={{ position: 'absolute', left: '-9999px', top: 0 }}>
                <PaymentReceipt
                  bill={{
                    id: selectedReceipt.id,
                    billNumber: selectedReceipt.receipt_number,
                    patientName: selectedReceipt.patient_name || '',
                    patientId: selectedReceipt.patient_id || '',
                    totalAmount: toAmount(selectedReceipt.payment_amount),
                    paidAmount: toAmount(selectedReceipt.payment_amount),
                    balanceAmount: 0,
                    billDate: selectedReceipt.payment_date,
                    services: displayServices.map(s => ({
                      id: String(s.index), serviceName: s.serviceName, quantity: s.quantity,
                      unitPrice: s.unitPrice, totalPrice: s.totalPrice, discountLabel: s.discountLabel,
                    })),
                  }}
                  payment={{
                    amount: toAmount(selectedReceipt.payment_amount), method: selectedReceipt.payment_method,
                    date: selectedReceipt.payment_date, notes: selectedReceipt.notes,
                    from_lease: selectedReceipt.from_lease, lease_details: selectedReceipt.lease_details,
                    cashierName: selectedReceipt.cashier_name, cashierId: selectedReceipt.cashier_id,
                  }}
                  receiptNumber={selectedReceipt.receipt_number}
                  facilityName={facilityName}
                  branchName={branchName}
                />
              </div>
            </div>

            <div className="p-4 border-t bg-muted/30 flex justify-between gap-2">
              {selectedReceipt.status === 'active' ? (
                <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={() => setShowCancelModal(true)}>
                  <Ban className="w-4 h-4 mr-2" /> Cancel Receipt
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => downloadPDF('receipt', selectedReceipt.id, `${selectedReceipt.receipt_number}.pdf`)} disabled={pdfLoading}>
                  <Download className="w-4 h-4 mr-2" /> PDF
                </Button>
                <Button onClick={handlePrintReceipt}>
                  <Printer className="w-4 h-4 mr-2" /> Print
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Receipt Modal */}
      {showCancelModal && selectedReceipt && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-sm rounded-xl shadow-lg border overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2 text-red-600">
                <Ban className="w-5 h-5" /> Cancel Receipt
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowCancelModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to cancel receipt {selectedReceipt.receipt_number}? This action cannot be undone.
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Cancellation Reason</label>
                <textarea
                  value={cancellationReason}
                  onChange={e => setCancellationReason(e.target.value)}
                  placeholder="Please provide a reason..."
                  className="w-full mt-1 p-3 border border-input rounded-md resize-none h-24 text-sm bg-transparent shadow-sm"
                />
              </div>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={cancelItemsOnVoid}
                  onChange={e => setCancelItemsOnVoid(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Also cancel the billed item(s) — they will show as Voided and cannot be paid for again.
                  Leave unchecked if you just need to redo this payment (the item becomes payable again).
                </span>
              </label>
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowCancelModal(false); setCancellationReason(''); setCancelItemsOnVoid(false); }}>Cancel</Button>
              <Button
                variant="outline"
                className="text-red-600 hover:text-red-700"
                onClick={handleCancelReceipt}
                disabled={cancelling || !cancellationReason.trim()}
              >
                {cancelling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ban className="w-4 h-4 mr-2" />}
                Cancel Receipt
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Void Item Modal */}
      {voidItemIndex !== null && selectedReceipt && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-sm rounded-xl shadow-lg border overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2 text-red-600">
                <Ban className="w-5 h-5" /> Void Line Item
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setVoidItemIndex(null); setVoidReason(''); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to void this item? The amount will be credited back to the bill balance.
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Void Reason</label>
                <textarea
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                  placeholder="Please provide a reason..."
                  className="w-full mt-1 p-3 border border-input rounded-md resize-none h-24 text-sm bg-transparent shadow-sm"
                />
              </div>
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setVoidItemIndex(null); setVoidReason(''); }}>Cancel</Button>
              <Button
                variant="outline"
                className="text-red-600 hover:text-red-700"
                onClick={handleVoidItem}
                disabled={voidingItem || !voidReason.trim()}
              >
                {voidingItem ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ban className="w-4 h-4 mr-2" />}
                Void Item
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
