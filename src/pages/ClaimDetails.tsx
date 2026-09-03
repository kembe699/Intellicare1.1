import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCurrency } from '@/contexts/CurrencyContext';
import { authFetch } from '@/api/apiClient';
import { getStatusColor } from '@/lib/statusColors';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState} from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Loader2, ArrowLeft, Download, Printer, FileText, Clock,
  DollarSign, CheckCircle, XCircle, Send, Edit, AlertTriangle,
  Calendar, User, Shield, History, ChevronDown, ChevronUp
} from 'lucide-react';
import { toast } from 'sonner';

export default function ClaimDetails() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { currency: baseCurrency } = useCurrency();
  const [claim, setClaim] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusAction, setStatusAction] = useState('');
  const [statusNotes, setStatusNotes] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [rejectedReason, setRejectedReason] = useState('');
  const [updating, setUpdating] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [editPriority, setEditPriority] = useState('normal');
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());

  const toggleInvoice = (id: string) => {
    setExpandedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    if (expandedInvoices.size === invoicesRef.length) setExpandedInvoices(new Set());
    else setExpandedInvoices(new Set(invoicesRef.map((inv: any) => inv.id)));
  };

  // Ref for invoices (updated after claim loads)
  const invoicesRef = claim?.invoices || [];

  // silent skips the full-page spinner (see the `if (loading)` guard below) — status
  // updates and edits used to re-run this the same way the initial mount does, blanking
  // the whole page to a spinner just to reflect one field change.
  const loadClaim = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await authFetch(`/api/insurance-claims/${claimId}`);
      if (res.ok) {
        const json = await res.json();
        setClaim(json.data);
        setEditNotes(json.data?.notes || '');
        setEditPriority(json.data?.priority || 'normal');
      } else {
        toast.error('Claim not found');
        navigate('/billing-management');
      }
    } catch (err) { toast.error('Failed to load claim'); }
    setLoading(false);
  };

  useEffect(() => { if (claimId) loadClaim(); }, [claimId]);


  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'paid': case 'accepted': return <CheckCircle className="h-4 w-4 mt-0.5 shrink-0 text-primary" />;
      case 'rejected': case 'cancelled': return <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-primary" />;
      case 'submitted': return <Send className="h-4 w-4 mt-0.5 shrink-0 text-primary" />;
      default: return <Clock className="h-4 w-4 mt-0.5 shrink-0 text-primary" />;
    }
  };

  const handleUpdateStatus = async () => {
    if (updating) return;
    setUpdating(true);
    try {
      const body: any = { status: statusAction, notes: statusNotes };
      if (statusAction === 'paid' && paidAmount) body.paid_amount = parseFloat(paidAmount);
      if (statusAction === 'rejected' && rejectedReason) body.rejected_reason = rejectedReason;

      const res = await authFetch(`/api/insurance-claims/${claimId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(`Claim ${statusAction} successfully`);
        setShowStatusModal(false);
        setStatusNotes('');
        setPaidAmount('');
        setRejectedReason('');
        loadClaim(true);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to update');
      }
    } catch { toast.error('Failed to update status'); }
    finally { setUpdating(false); }
  };

  const handleEdit = async () => {
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await authFetch(`/api/insurance-claims/${claimId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: editNotes, priority: editPriority }),
      });
      if (res.ok) { toast.success('Claim updated'); setShowEditModal(false); loadClaim(true); }
      else { const err = await res.json(); toast.error(err.error || 'Failed to update'); }
    } catch { toast.error('Failed to update'); }
    finally { setSavingEdit(false); }
  };

  const handleCancel = async () => {
    if (cancelling) return;
    if (!confirm('Are you sure you want to cancel this claim?')) return;
    setCancelling(true);
    try {
      const res = await authFetch(`/api/insurance-claims/${claimId}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Claim cancelled'); navigate('/billing-management'); }
      else { const err = await res.json(); toast.error(err.error || 'Failed to cancel'); }
    } catch { toast.error('Failed to cancel'); }
    finally { setCancelling(false); }
  };

  const openClaimDocument = async () => {
    try {
      const res = await authFetch(`/api/insurance-claims/${claimId}/pdf`);
      if (!res.ok) throw new Error();
      const html = await res.text();
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      }
      return w;
    } catch {
      toast.error('Failed to load claim document');
      return null;
    }
  };

  const handleDownload = async () => {
    const w = await openClaimDocument();
    if (w) {
      // Small delay to let content render, then trigger print (user can "Save as PDF")
      setTimeout(() => w.print(), 600);
      toast.success('Use "Save as PDF" in the print dialog to download as PDF');
    }
  };

  const handlePrint = async () => {
    const w = await openClaimDocument();
    if (w) { setTimeout(() => w.print(), 600); }
  };

  const openStatusModal = (action: string) => {
    setStatusAction(action);
    setStatusNotes('');
    setPaidAmount(claim?.claim_amount?.toString() || '');
    setRejectedReason('');
    setShowStatusModal(true);
  };

  if (loading) {
    return (
      <AppLayout>
        <LoadingState variant="page" message="Loading claim..." />
      </AppLayout>
    );
  }

  if (!claim) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-96">
          <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">Claim not found</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/billing-management')}>Back to Billing</Button>
        </div>
      </AppLayout>
    );
  }

  const invoices = claim.invoices || [];
  const statusHistory = claim.status_history || [];
  const canEdit = ['draft', 'pending', 'rejected'].includes(claim.status);
  const canCancel = !['paid', 'accepted'].includes(claim.status);
  const claimCurrency = claim.scheme_currency || invoices[0]?.invoice_currency || baseCurrency.code;

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="animate-fade-in w-full flex flex-col">
        <PageHeader
          icon={<Shield />}
          title={claim.claim_number}
          actions={
            <div className="flex gap-2 flex-wrap items-center">
              <Button variant="ghost" size="sm" onClick={() => navigate('/billing-management')} className="gap-1.5">
                <ArrowLeft className="h-4 w-4" />Back
              </Button>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => setShowEditModal(true)} className="gap-1.5">
                  <Edit className="h-3.5 w-3.5" />Edit
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
                <Printer className="h-3.5 w-3.5" />Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />Download
              </Button>
              {canCancel && (
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling} className="gap-1.5 text-red-600 hover:text-red-700">
                  {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                  {cancelling ? 'Cancelling...' : 'Cancel Claim'}
                </Button>
              )}
            </div>
          }
        />

        {/* Status + Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase font-medium">Status</div>
              <Badge className={`mt-2 text-xs capitalize ${getStatusColor(claim.status)}`}>
                {claim.status?.replace('_', ' ')}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase font-medium">Claim Amount</div>
              <div className="text-xl font-bold mt-1">{claimCurrency} {parseFloat(claim.claim_amount || 0).toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase font-medium">Invoices</div>
              <div className="text-xl font-bold mt-1">{invoices.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase font-medium">Days Pending</div>
              <div className="text-xl font-bold mt-1">{claim.days_pending || 0}d</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase font-medium">Priority</div>
              <Badge variant={claim.priority === 'urgent' ? 'destructive' : 'outline'} className="mt-2 text-xs capitalize">
                {claim.priority || 'normal'}
              </Badge>
            </CardContent>
          </Card>
        </div>

        {/* Claim Status Actions */}
        {!['paid', 'cancelled'].includes(claim.status) && (
          <Card className="mb-6">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm font-medium text-foreground">Update Claim Status</p>
                <div className="flex gap-2 flex-wrap">
                  {claim.status === 'pending' && (
                    <Button size="sm" onClick={() => openStatusModal('submitted')} className="gap-1.5 bg-primary hover:bg-primary">
                      <Send className="h-3.5 w-3.5" /> Mark Submitted
                    </Button>
                  )}
                  {claim.status === 'submitted' && (
                    <>
                      <Button size="sm" onClick={() => openStatusModal('accepted')} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                        <CheckCircle className="h-3.5 w-3.5" /> Accept
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => openStatusModal('rejected')} className="gap-1.5">
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </>
                  )}
                  {claim.status === 'accepted' && (
                    <Button size="sm" onClick={() => openStatusModal('paid')} className="gap-1.5 bg-green-600 hover:bg-green-700">
                      <DollarSign className="h-3.5 w-3.5" /> Record Payment
                    </Button>
                  )}
                  {claim.status === 'rejected' && (
                    <Button size="sm" onClick={() => openStatusModal('submitted')} className="gap-1.5 bg-primary hover:bg-primary">
                      <Send className="h-3.5 w-3.5" /> Resubmit
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Claim Information */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2"><FileText className="h-4 w-4" /> Claim Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Claim Number</p>
                  <p className="font-semibold mt-0.5 font-mono">{claim.claim_number}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Created Date</p>
                  <p className="font-semibold mt-0.5">{new Date(claim.created_at).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Submitted Date</p>
                  <p className="font-semibold mt-0.5">{claim.submitted_at ? new Date(claim.submitted_at).toLocaleDateString() : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Date Range</p>
                  <p className="font-semibold mt-0.5">
                    {claim.date_from ? new Date(claim.date_from).toLocaleDateString() : '—'} to{' '}
                    {claim.date_to ? new Date(claim.date_to).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Paid Amount</p>
                  <p className="font-semibold mt-0.5 text-green-700">{claimCurrency} {parseFloat(claim.paid_amount || 0).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Paid Date</p>
                  <p className="font-semibold mt-0.5">{claim.paid_at ? new Date(claim.paid_at).toLocaleDateString() : '—'}</p>
                </div>
              </div>
              {claim.notes && (
                <div className="mt-4 p-3 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase mb-1">Notes</p>
                  <p className="text-sm">{claim.notes}</p>
                </div>
              )}
              {claim.rejected_reason && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-600 uppercase mb-1 font-medium">Rejection Reason</p>
                  <p className="text-sm text-red-800">{claim.rejected_reason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Insurance Provider */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2"><Shield className="h-4 w-4" /> Insurance Provider</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Scheme Name</p>
                <p className="font-semibold mt-0.5">{claim.scheme_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Scheme Code</p>
                <p className="font-semibold mt-0.5 font-mono">{claim.scheme_code || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Contact Person</p>
                <p className="font-semibold mt-0.5">{claim.contact_person || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Email</p>
                <p className="font-semibold mt-0.5">{claim.contact_email || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Phone</p>
                <p className="font-semibold mt-0.5">{claim.contact_phone || '—'}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Invoices Table */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Invoices in This Claim ({invoices.length})</CardTitle>
              {invoices.length > 0 && (
                <Button variant="ghost" size="sm" onClick={expandAll} className="text-xs gap-1">
                  {expandedInvoices.size === invoices.length ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {expandedInvoices.size === invoices.length ? 'Collapse All' : 'Expand All'}
                </Button>
              )}
            </div>
            <CardDescription>All invoices included in this batch claim — click a row to see service details</CardDescription>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No invoices in this claim</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium text-xs uppercase text-muted-foreground">#</th>
                      <th className="text-left py-2 px-3 font-medium text-xs uppercase text-muted-foreground">Invoice #</th>
                      <th className="text-left py-2 px-3 font-medium text-xs uppercase text-muted-foreground">Patient</th>
                      <th className="text-left py-2 px-3 font-medium text-xs uppercase text-muted-foreground">Invoice Date</th>
                      <th className="text-left py-2 px-3 font-medium text-xs uppercase text-muted-foreground">Due Date</th>
                      <th className="text-right py-2 px-3 font-medium text-xs uppercase text-muted-foreground">Amount</th>
                      <th className="text-center py-2 px-3 font-medium text-xs uppercase text-muted-foreground">Invoice Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoices.map((inv: any, idx: number) => {
                      const isExpanded = expandedInvoices.has(inv.id);
                      const services = inv.services || [];
                      return (
                        <React.Fragment key={inv.id}>
                          <tr className="hover:bg-muted/20 cursor-pointer" onClick={() => toggleInvoice(inv.id)}>
                            <td className="py-2 px-3 text-muted-foreground text-xs">
                              <div className="flex items-center gap-1">
                                {services.length > 0 && (
                                  isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                                {idx + 1}
                              </div>
                            </td>
                            <td className="py-2 px-3 font-mono text-xs font-semibold text-primary">{inv.invoice_number}</td>
                            <td className="py-2 px-3">{inv.patient_name || '—'}</td>
                            <td className="py-2 px-3 text-xs">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '—'}</td>
                            <td className="py-2 px-3 text-xs">{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}</td>
                            <td className="py-2 px-3 text-right font-bold">{inv.invoice_currency || claimCurrency} {parseFloat(inv.amount || 0).toFixed(2)}</td>
                            <td className="py-2 px-3 text-center">
                              <Badge variant="outline" className="text-xs capitalize">{inv.invoice_status || 'in claim'}</Badge>
                            </td>
                          </tr>
                          {isExpanded && services.length > 0 && services.map((svc: any, sIdx: number) => (
                            <tr key={`${inv.id}-svc-${sIdx}`} className="bg-muted/10">
                              <td className="py-1.5 px-3"></td>
                              <td className="py-1.5 px-3 text-xs text-muted-foreground pl-6" colSpan={2}>
                                <span className="text-muted-foreground/60">↳</span>{' '}
                                {svc.service_name || svc.serviceName || svc.name || '—'}
                                {svc.department && <span className="text-muted-foreground/50 ml-2">({svc.department})</span>}
                              </td>
                              <td className="py-1.5 px-3 text-xs text-muted-foreground text-center">
                                Qty: {svc.quantity || 1}
                              </td>
                              <td className="py-1.5 px-3"></td>
                              <td className="py-1.5 px-3 text-right text-xs font-medium">
                                {inv.invoice_currency || claimCurrency} {parseFloat(svc.totalPrice || svc.total_price || svc.price || 0).toFixed(2)}
                              </td>
                              <td className="py-1.5 px-3"></td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr>
                      <td colSpan={5} className="py-2.5 px-3 text-right font-semibold text-sm">Total Claim Amount</td>
                      <td className="py-2.5 px-3 text-right font-bold text-base">
                        {claimCurrency} {invoices.reduce((s: number, i: any) => s + parseFloat(i.amount || 0), 0).toFixed(2)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status History */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><History className="h-4 w-4" /> Status History</CardTitle>
          </CardHeader>
          <CardContent>
            {statusHistory.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">No status changes recorded</div>
            ) : (
              <div className="space-y-3">
                {statusHistory.map((h: any, idx: number) => (
                  <div key={h.id || idx} className="flex items-start gap-3 p-3 bg-muted/20 rounded-lg">
                    {getStatusIcon(h.new_status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm capitalize">{h.new_status?.replace('_', ' ')}</span>
                        {h.old_status && (
                          <span className="text-xs text-muted-foreground">from <span className="capitalize">{h.old_status?.replace('_', ' ')}</span></span>
                        )}
                      </div>
                      {h.notes && <p className="text-sm text-muted-foreground mt-0.5">{h.notes}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        {h.created_by_name || 'System'} · {new Date(h.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      {/* Status Update Modal */}
      <Dialog open={showStatusModal} onOpenChange={setShowStatusModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">
              {statusAction === 'submitted' ? 'Submit Claim' : statusAction === 'accepted' ? 'Accept Claim' : statusAction === 'rejected' ? 'Reject Claim' : statusAction === 'paid' ? 'Record Payment' : 'Update Status'}
            </DialogTitle>
            <DialogDescription>
              {statusAction === 'paid' ? 'Record insurance payment for this claim' :
               statusAction === 'rejected' ? 'Provide a reason for rejection' :
               `Update claim status to ${statusAction}`}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4 space-y-4">
            {statusAction === 'paid' && (
              <div>
                <Label>Payment Amount ({claimCurrency})</Label>
                <Input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)}
                  placeholder="Enter paid amount" className="mt-1" />
              </div>
            )}
            {statusAction === 'rejected' && (
              <div>
                <Label>Rejection Reason *</Label>
                <Textarea value={rejectedReason} onChange={e => setRejectedReason(e.target.value)}
                  placeholder="Explain why this claim was rejected..." rows={3} className="mt-1" />
              </div>
            )}
            <div>
              <Label>Notes (Optional)</Label>
              <Textarea value={statusNotes} onChange={e => setStatusNotes(e.target.value)}
                placeholder="Add notes about this status change..." rows={2} className="mt-1" />
            </div>
            {statusAction === 'paid' && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                <p className="font-medium">This will mark all {invoices.length} invoices as paid.</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowStatusModal(false)}>Cancel</Button>
            <Button onClick={handleUpdateStatus} disabled={updating || (statusAction === 'rejected' && !rejectedReason)}
              className={statusAction === 'rejected' ? 'bg-red-600 hover:bg-red-700' : ''}>
              {updating ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Updating...</> : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Claim</DialogTitle>
            <DialogDescription>Update claim notes and priority</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4 space-y-4">
            <div>
              <Label>Priority</Label>
              <Combobox
                options={[{ value: 'normal', label: 'Normal' }, { value: 'urgent', label: 'Urgent' }]}
                value={editPriority}
                onChange={setEditPriority}
                searchPlaceholder="Search..."
                className="ic-select"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={4} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditModal(false)} disabled={savingEdit}>Cancel</Button>
            <Button onClick={handleEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
