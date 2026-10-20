import React, { useState, useEffect } from 'react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { toast } from 'sonner';
import {
  Search, FileSpreadsheet, FileText, DollarSign, Clock, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, Loader2, X, Ban, Download, Printer,
} from 'lucide-react';
import { usePDFDocument } from '@/hooks/usePDFDocument';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import RecordPaymentModal from '@/components/billing/RecordPaymentModal';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface Invoice {
  id: string;
  invoice_number: string;
  patient_name: string;
  patient_id: string;
  bill_id: string | null;
  amount: number;
  amount_paid: number;
  balance_due: number;
  currency: string;
  payment_terms: number;
  due_date: string;
  status: string;
  notes: string | null;
  days_overdue: number;
  scheme_id: string | null;
  scheme_name: string | null;
  created_at: string;
}

const STATUS_MAP: Record<string, { className: string; icon: React.ReactNode }> = {
  unpaid: { className: 'bg-red-50 text-red-700 border-red-200', icon: <Clock className="w-3 h-3" /> },
  partial: { className: 'bg-amber-50 text-amber-700 border-amber-200', icon: <AlertTriangle className="w-3 h-3" /> },
  paid: { className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle2 className="w-3 h-3" /> },
  overdue: { className: 'bg-orange-50 text-orange-700 border-orange-200', icon: <AlertTriangle className="w-3 h-3" /> },
  cancelled: { className: 'bg-slate-100 text-slate-600 border-slate-200', icon: <XCircle className="w-3 h-3" /> },
};

const statusBadge = (status: string) => {
  const s = STATUS_MAP[status] || STATUS_MAP.unpaid;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold border capitalize ${s.className}`}>
      {s.icon} {status}
    </span>
  );
};

export default function Invoices() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { currency } = useCurrency();
  const { downloadPDF, printPDF, loading: pdfLoading } = usePDFDocument();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [cancellingInvoice, setCancellingInvoice] = useState(false);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (filterDateFrom) params.append('from', filterDateFrom);
      if (filterDateTo) params.append('to', filterDateTo);
      const res = await authFetch(`/api/invoices?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch invoices');
      const data = await res.json();
      setInvoices(data.data || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInvoices(); }, [statusFilter, filterDateFrom, filterDateTo]);
  useEffect(() => {
    const timer = setTimeout(() => fetchInvoices(), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // silent skips the panel's own spinner (see the `detailLoading || !invoiceDetail` guard
  // below) — marking an invoice paid used to re-run this the same way opening the panel
  // does, blanking the already-open detail panel just to reflect the new status.
  const fetchInvoiceDetail = async (inv: Invoice, silent = false) => {
    setSelectedInvoice(inv);
    if (!silent) setDetailLoading(true);
    try {
      const res = await authFetch(`/api/invoices/${inv.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load invoice');
      const data = await res.json();
      setInvoiceDetail(data.data);
    } catch {
      toast.error('Failed to load invoice details');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => { setSelectedInvoice(null); setInvoiceDetail(null); };

  const handleMarkPaid = async (inv: Invoice) => {
    if (markingPaid) return;
    if (!(await confirm({ description: `Mark invoice ${inv.invoice_number} as fully paid?` }))) return;
    setMarkingPaid(true);
    try {
      const res = await authFetch(`/api/invoices/${inv.id}/mark-paid`, { method: 'PUT', credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      toast.success('Invoice marked as paid');
      fetchInvoices();
      if (invoiceDetail?.id === inv.id) fetchInvoiceDetail(inv, true);
    } catch { toast.error('Failed to mark as paid'); }
    finally { setMarkingPaid(false); }
  };

  const handleCancel = async (inv: Invoice) => {
    if (cancellingInvoice) return;
    if (!(await confirm({ description: `Cancel invoice ${inv.invoice_number}? This will revert the bill to cash billing.` }))) return;
    setCancellingInvoice(true);
    try {
      const res = await authFetch(`/api/invoices/${inv.id}/cancel`, { method: 'PUT', credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      toast.success('Invoice cancelled');
      fetchInvoices();
      closeDetail();
    } catch { toast.error('Failed to cancel invoice'); }
    finally { setCancellingInvoice(false); }
  };

  const filteredInvoices = invoices;

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
        <PageHeader
          title="Invoices"
          icon={<FileSpreadsheet />}
          className="mb-3"
        />

        <div className="flex-1 min-h-0 flex flex-col gap-4">
          <div className="bg-card rounded-lg border shadow-sm p-0 flex flex-col overflow-hidden flex-1 min-h-0">
            <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
              <h3 className="font-medium">Invoice Directory</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative w-56">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input placeholder="Search invoice or patient..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Combobox
                  options={[
                    { value: 'all', label: 'All statuses' },
                    { value: 'unpaid', label: 'Unpaid' },
                    { value: 'partial', label: 'Partial' },
                    { value: 'paid', label: 'Paid' },
                    { value: 'overdue', label: 'Overdue' },
                    { value: 'cancelled', label: 'Cancelled' },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  searchPlaceholder="Search..."
                  className="w-40 h-9"
                />
                <Input type="date" className="h-9 w-[140px]" value={filterDateFrom} max={filterDateTo || undefined} onChange={e => setFilterDateFrom(e.target.value)} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" className="h-9 w-[140px]" value={filterDateTo} min={filterDateFrom || undefined} onChange={e => setFilterDateTo(e.target.value)} />
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchInvoices} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <AdvancedDataTable<Invoice>
                data={filteredInvoices}
                keyExtractor={(inv) => inv.id}
                loading={loading}
                emptyMessage="No invoices found."
                onRowClick={(inv) => fetchInvoiceDetail(inv)}
                rowClassName={(inv) => (inv.days_overdue > 0 && inv.status !== 'paid' && inv.status !== 'cancelled') ? 'bg-orange-50/50' : ''}
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'invoice_number', header: 'Invoice No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                  { key: 'patient_name', header: 'Patient', sortable: true },
                  { key: 'scheme_name', header: 'Scheme', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                  {
                    key: 'due_date', header: 'Due Date', sortable: true,
                    render: (v, inv) => {
                      const overdue = inv.days_overdue > 0 && inv.status !== 'paid' && inv.status !== 'cancelled';
                      return (
                        <>
                          <span className={overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}>{new Date(v).toLocaleDateString()}</span>
                          {overdue && <span className="text-xs text-orange-600 ml-1">({inv.days_overdue}d)</span>}
                        </>
                      );
                    },
                  },
                  { key: 'amount', header: 'Total', sortable: true, render: (v, inv) => <span className="text-muted-foreground">{inv.currency || currency.code} {parseFloat(String(v)).toFixed(2)}</span> },
                  {
                    key: 'balance_due', header: 'Balance', sortable: true,
                    render: (v, inv) => (
                      <span className={`font-medium ${parseFloat(String(v)) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {inv.currency || currency.code} {parseFloat(String(v)).toFixed(2)}
                      </span>
                    ),
                  },
                  { key: 'status', header: 'Status', render: (v) => statusBadge(v) },
                ]}
              />
            </div>
          </div>

        </div>
      </div>
      </div>

      {/* Invoice Detail Modal */}
      <Dialog open={!!selectedInvoice} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <DialogContent className="p-0 max-w-lg max-h-[90vh] flex flex-col">
          {selectedInvoice && (
          <>
            <div className="flex justify-between items-center p-4 pr-12 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> {selectedInvoice.invoice_number}
              </h3>
            </div>

            <div className="p-6 flex-1 overflow-auto space-y-4">
              {detailLoading || !invoiceDetail ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {(() => {
                    const inv = invoiceDetail;
                    const cur = inv.currency || currency.code;
                    return (
                      <>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div className="bg-muted/30 rounded-lg p-2.5 text-center">
                            <p className="text-xs text-muted-foreground">Total</p>
                            <p className="font-bold">{cur} {parseFloat(inv.amount).toFixed(2)}</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2.5 text-center">
                            <p className="text-xs text-muted-foreground">Paid</p>
                            <p className="font-bold text-emerald-600">{cur} {parseFloat(inv.amount_paid).toFixed(2)}</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2.5 text-center">
                            <p className="text-xs text-muted-foreground">Balance</p>
                            <p className={`font-bold ${parseFloat(inv.balance_due) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{cur} {parseFloat(inv.balance_due).toFixed(2)}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-y-2 text-sm">
                          <span className="text-muted-foreground">Invoice Date</span>
                          <span className="text-right">{new Date(inv.created_at).toLocaleDateString()}</span>
                          <span className="text-muted-foreground">Due Date</span>
                          <span className="text-right">{new Date(inv.due_date).toLocaleDateString()}</span>
                          <span className="text-muted-foreground">Payment Terms</span>
                          <span className="text-right">Net {inv.payment_terms} Days</span>
                          <span className="text-muted-foreground">Scheme</span>
                          <span className="text-right">{inv.scheme_name || '—'}</span>
                        </div>

                        {inv.notes && (
                          <div className="bg-muted/30 rounded-lg p-3">
                            <p className="text-xs text-muted-foreground mb-1">Notes</p>
                            <p className="text-sm">{inv.notes}</p>
                          </div>
                        )}

                        {(inv.items || []).length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Itemized Breakdown</p>
                            <AdvancedDataTable<any>
                              data={inv.items}
                              keyExtractor={(item, i) => item.id || i}
                              columns={[
                                { key: 'description', header: 'Description' },
                                { key: 'quantity', header: 'Qty', align: 'right' },
                                { key: 'amount', header: 'Amount', align: 'right', render: (v, item) => <span className="font-mono">{item.currency || cur} {parseFloat(v).toFixed(2)}</span> },
                              ]}
                            />
                          </div>
                        )}

                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Payment History</p>
                          {(inv.payments || []).length > 0 ? (
                            <AdvancedDataTable<any>
                              data={inv.payments}
                              keyExtractor={(p, i) => p.id || i}
                              columns={[
                                { key: 'payment_date', header: 'Date', render: (v) => new Date(v).toLocaleDateString() },
                                { key: 'amount', header: 'Amount', align: 'right', render: (v) => <span className="font-mono font-semibold text-emerald-600">{cur} {parseFloat(v).toFixed(2)}</span> },
                                { key: 'payment_method', header: 'Method', render: (v) => <span className="capitalize">{(v || '').replace('_', ' ')}</span> },
                              ]}
                            />
                          ) : (
                            <div className="text-center py-6 text-muted-foreground border rounded-lg text-sm">No payments recorded yet</div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </>
              )}
            </div>

            <div className="p-4 border-t bg-muted/30 flex justify-between gap-2 flex-wrap">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => downloadPDF('invoice', selectedInvoice.id, `${selectedInvoice.invoice_number}.pdf`)} disabled={pdfLoading}>
                  <Download className="w-4 h-4 mr-2" /> PDF
                </Button>
                <Button variant="outline" onClick={() => printPDF('invoice', selectedInvoice.id)} disabled={pdfLoading}>
                  <Printer className="w-4 h-4 mr-2" /> Print
                </Button>
              </div>
              {selectedInvoice.status !== 'paid' && selectedInvoice.status !== 'cancelled' && (
                <div className="flex gap-2">
                  <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={() => handleCancel(selectedInvoice)} disabled={cancellingInvoice || markingPaid}>
                    {cancellingInvoice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                  </Button>
                  <Button variant="outline" onClick={() => handleMarkPaid(selectedInvoice)} disabled={markingPaid || cancellingInvoice}>
                    {markingPaid ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                    {markingPaid ? 'Marking Paid...' : 'Mark Paid'}
                  </Button>
                  <Button onClick={() => setShowPaymentModal(true)}>
                    <DollarSign className="w-4 h-4 mr-2" /> Record Payment
                  </Button>
                </div>
              )}
            </div>
          </>
          )}
        </DialogContent>
      </Dialog>

      {/* Record Payment Modal */}
      {showPaymentModal && selectedInvoice && (
        <RecordPaymentModal
          invoice={selectedInvoice}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            setShowPaymentModal(false);
            fetchInvoices();
            if (invoiceDetail?.id === selectedInvoice.id) fetchInvoiceDetail(selectedInvoice, true);
          }}
        />
      )}
    </AppLayout>
  );
}
