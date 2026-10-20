import React, { useState, useEffect } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, CheckCircle, FileText, Users, DollarSign, Calendar } from 'lucide-react';
import { toast } from '@/lib/notify';

interface CreateClaimModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateClaimModal({ onClose, onSuccess }: CreateClaimModalProps) {
  const { user } = useAuth();
  const clinicId = user?.clinic || '1';

  const [step, setStep] = useState<'form' | 'preview' | 'success'>('form');
  const [selectedScheme, setSelectedScheme] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('normal');
  const [schemes, setSchemes] = useState<any[]>([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState<any[]>([]);
  const [loadingSchemes, setLoadingSchemes] = useState(true);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdClaim, setCreatedClaim] = useState<any>(null);

  // Load insurance schemes
  useEffect(() => {
    async function load() {
      try {
        const res = await authFetch(`/api/insurance-claims/insurance-schemes?clinic_id=${clinicId}`);
        if (res.ok) {
          const json = await res.json();
          setSchemes(json.data || []);
        }
      } catch (err) { console.error(err); }
      setLoadingSchemes(false);
    }
    load();
  }, [clinicId]);

  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());

  // Load unpaid invoices only when a scheme is selected
  useEffect(() => {
    if (!selectedScheme || !dateFrom || !dateTo) { setUnpaidInvoices([]); setSelectedInvoiceIds(new Set()); return; }
    let cancelled = false;
    async function load() {
      setLoadingInvoices(true);
      try {
        const params = new URLSearchParams({ scheme_id: selectedScheme, from: dateFrom, to: dateTo });
        const res = await authFetch(`/api/insurance-claims/unpaid-invoices?${params}`);
        if (res.ok && !cancelled) {
          const json = await res.json();
          const data = json.data || [];
          setUnpaidInvoices(data);
          // Auto-select all on first load / when scheme changes
          setSelectedInvoiceIds(new Set(data.map((inv: any) => inv.id)));
        }
      } catch (err) { console.error(err); }
      if (!cancelled) setLoadingInvoices(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selectedScheme, dateFrom, dateTo]);

  const toggleInvoice = (id: string) => {
    setSelectedInvoiceIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedInvoices = unpaidInvoices.filter((inv: any) => selectedInvoiceIds.has(inv.id));
  const totalAmount = selectedInvoices.reduce((s: number, inv: any) => s + parseFloat(inv.balance_due || 0), 0);

  const selectedSchemeObj = schemes.find((s: any) => s.id?.toString() === selectedScheme);
  const { currency: baseCurrency } = useCurrency();
  const schemeCurrency = selectedSchemeObj?.currency || baseCurrency.code;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await authFetch('/api/insurance-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheme_id: selectedScheme,
          date_from: dateFrom,
          date_to: dateTo,
          invoice_ids: selectedInvoices.map((inv: any) => inv.id),
          claim_amount: totalAmount,
          currency: schemeCurrency,
          notes,
          priority,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create claim');
      }
      const json = await res.json();
      setCreatedClaim(json.data);
      setStep('success');
      setTimeout(() => onSuccess(), 2500);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create claim');
    } finally {
      setSubmitting(false);
    }
  };

  const setPresetRange = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    setDateFrom(d.toISOString().split('T')[0]);
    setDateTo(new Date().toISOString().split('T')[0]);
  };

  // ── Success step ──
  if (step === 'success') {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <div className="text-center py-4">
            <div className="flex justify-center mb-4">
              <CheckCircle className="h-12 w-12 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Claim Created Successfully!</h2>
            <p className="text-gray-500 mt-2">
              Claim <span className="font-semibold text-primary">{createdClaim?.claim_number}</span> has been created
              with {createdClaim?.invoice_count} invoice{createdClaim?.invoice_count !== 1 ? 's' : ''} totaling{' '}
              <span className="font-semibold">{schemeCurrency} {createdClaim?.claim_amount?.toFixed(2)}</span>
            </p>
            <p className="text-xs text-gray-400 mt-3">Redirecting...</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Preview step ──
  if (step === 'preview') {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Insurance Claim</DialogTitle>
            <DialogDescription>
              {selectedInvoices.length} invoice{selectedInvoices.length !== 1 ? 's' : ''} selected · {schemeCurrency} {totalAmount.toFixed(2)}
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-4 space-y-4">
            {/* Claim Summary */}
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Insurance Scheme</p>
                    <p className="font-bold text-gray-900 mt-0.5">{selectedSchemeObj?.scheme_name}</p>
                    <p className="text-xs text-gray-500">{selectedSchemeObj?.scheme_code}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Claim Amount</p>
                    <p className="font-bold text-xl text-primary mt-0.5">{schemeCurrency} {totalAmount.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Date Range</p>
                    <p className="font-semibold text-gray-900 mt-0.5">{dateFrom} — {dateTo}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Invoices</p>
                    <p className="font-bold text-gray-900 mt-0.5">{unpaidInvoices.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Invoices List */}
            <Card>
              <CardContent className="pt-4 pb-3">
                <h3 className="font-semibold text-sm mb-3">Invoices in This Claim</h3>
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                  {selectedInvoices.map((inv: any, idx: number) => (
                    <div key={inv.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-gray-400 w-5">{idx + 1}.</span>
                        <div className="min-w-0">
                          <span className="font-mono text-xs text-primary">{inv.invoice_number}</span>
                          <span className="text-gray-400 mx-1.5">—</span>
                          <span className="text-gray-700 truncate">{inv.patient_name}</span>
                        </div>
                      </div>
                      <span className="font-semibold whitespace-nowrap ml-2">{inv.currency || schemeCurrency} {parseFloat(inv.balance_due).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {notes && (
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-gray-500 font-medium uppercase mb-1">Notes</p>
                  <p className="text-sm text-gray-700">{notes}</p>
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setStep('form')}>Back</Button>
            <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : 'Create Claim'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Form step ──
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Create Insurance Claim
          </DialogTitle>
          <DialogDescription>Batch unpaid invoices into one claim for insurance submission</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-5">
          {/* Scheme Selection */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Insurance Scheme *</label>
            {loadingSchemes ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading schemes...</div>
            ) : schemes.length === 0 ? (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700 flex gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>No insurance schemes found. Create an insurance scheme in Scheme Management first.</span>
              </div>
            ) : (
              <Combobox
                options={schemes.map((s: any) => ({ value: s.id.toString(), label: `${s.scheme_name}${s.scheme_code ? ` (${s.scheme_code})` : ''}` }))}
                value={selectedScheme}
                onChange={setSelectedScheme}
                placeholder="Select insurance scheme"
                searchPlaceholder="Search schemes..."
              />
            )}
            {selectedSchemeObj && (
              <div className="mt-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-xs text-primary">
                <span className="font-medium">{selectedSchemeObj.insurance_provider_name || selectedSchemeObj.scheme_name}</span>
                {selectedSchemeObj.contact_person && <span> · Contact: {selectedSchemeObj.contact_person}</span>}
                {selectedSchemeObj.contact_email && <span> · {selectedSchemeObj.contact_email}</span>}
              </div>
            )}
          </div>

          {/* Date Range */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Invoice Date Range *</label>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">From</label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">To</label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9" />
              </div>
            </div>
            <div className="flex gap-1.5">
              {[30, 60, 90].map(d => (
                <Button key={d} variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPresetRange(d)}>
                  Last {d} days
                </Button>
              ))}
            </div>
          </div>

          {/* Unpaid Invoices */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">Unpaid Invoices for Selected Scheme</label>
              {unpaidInvoices.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    selectedInvoiceIds.size === unpaidInvoices.length
                      ? setSelectedInvoiceIds(new Set())
                      : setSelectedInvoiceIds(new Set(unpaidInvoices.map((i: any) => i.id)))
                  }
                >
                  {selectedInvoiceIds.size === unpaidInvoices.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
            {!selectedScheme ? (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500 text-center">
                Select an insurance scheme above to view its unpaid invoices
              </div>
            ) : loadingInvoices ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : unpaidInvoices.length === 0 ? (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">No unpaid invoices for this scheme</p>
                  <p className="text-xs text-yellow-600 mt-0.5">No unpaid invoices for this scheme in the selected date range. Try a wider range or different scheme.</p>
                </div>
              </div>
            ) : (
              <Card className="border-gray-200">
                <CardContent className="pt-3 pb-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">{selectedInvoiceIds.size} of {unpaidInvoices.length} selected</span>
                    <div className="flex items-center gap-1">
                      <DollarSign className="h-3.5 w-3.5 text-green-600" />
                      <span className="font-bold text-green-700 text-sm">{schemeCurrency} {totalAmount.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {unpaidInvoices.map((inv: any) => (
                      <div
                        key={inv.id}
                        className={`flex items-center justify-between text-sm px-2 py-1.5 rounded border cursor-pointer transition-colors ${
                          selectedInvoiceIds.has(inv.id) ? 'bg-primary/10 border-primary/30' : 'bg-white border-gray-100 opacity-60'
                        }`}
                        onClick={() => toggleInvoice(inv.id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedInvoiceIds.has(inv.id)}
                            onChange={() => toggleInvoice(inv.id)}
                            onClick={e => e.stopPropagation()}
                            className="h-3.5 w-3.5 rounded"
                          />
                          <span className="font-mono text-xs text-primary">{inv.invoice_number}</span>
                          <span className="text-gray-500">—</span>
                          <span className="text-gray-700 truncate">{inv.patient_name}</span>
                          {inv.scheme_name && <span className="text-xs text-gray-400 hidden sm:inline">({inv.scheme_name})</span>}
                        </div>
                        <span className="font-semibold text-gray-900 whitespace-nowrap ml-2">
                          {inv.currency || schemeCurrency} {parseFloat(inv.balance_due).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Priority</label>
            <Combobox
              options={[{ value: 'normal', label: 'Normal' }, { value: 'urgent', label: 'Urgent' }]}
              value={priority}
              onChange={setPriority}
              searchPlaceholder="Search..."
              className="w-40"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Notes (Optional)</label>
            <Textarea
              placeholder="Add any notes about this claim..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => setStep('preview')}
            disabled={!selectedScheme || !dateFrom || !dateTo || selectedInvoices.length === 0}
            className="gap-2"
          >
            Review & Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
