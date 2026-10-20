import React, { useState, useEffect } from 'react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { toast } from '@/lib/notify';
import { RotateCcw, Search, X, Loader2, Check } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { formatDate } from '@/lib/format';

const API = '/api/pharmacy-module';

const RETURN_REASONS = [
  { value: 'expired', label: 'Expired' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'unused', label: 'Unused' },
  { value: 'patient_request', label: 'Patient Request' },
  { value: 'wrong_drug', label: 'Wrong Drug' },
  { value: 'other', label: 'Other' },
];

export default function PharmacyReturns() {
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const clinicId = user?.clinic || 1;

  const [returns, setReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [dispensingRecords, setDispensingRecords] = useState<any[]>([]);
  const [selectedDispensingId, setSelectedDispensingId] = useState('');
  const [quantityReturned, setQuantityReturned] = useState('');
  const [returnReason, setReturnReason] = useState('unused');
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => { fetchReturns(); }, []);

  const fetchReturns = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API}/returns?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setReturns(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch returns');
    } finally {
      setLoading(false);
    }
  };

  const openModal = async () => {
    setSelectedDispensingId('');
    setQuantityReturned('');
    setReturnReason('unused');
    setNotes('');
    setShowModal(true);
    try {
      // Include partially_returned records too — a record that's had some but
      // not all of its quantity returned must stay pickable for the remainder.
      const res = await authFetch(`${API}/dispensing?clinic_id=${clinicId}&status=dispensed,partially_returned`, { credentials: 'include' });
      if (res.ok) setDispensingRecords(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const selectedDispensing = dispensingRecords.find(d => d.id === selectedDispensingId);
  const remainingQty = selectedDispensing
    ? parseFloat(selectedDispensing.quantity_dispensed) - parseFloat(selectedDispensing.quantity_returned_total || 0)
    : 0;

  const handleSelectDispensing = (id: string) => {
    setSelectedDispensingId(id);
    const disp = dispensingRecords.find(d => d.id === id);
    const remaining = disp ? parseFloat(disp.quantity_dispensed) - parseFloat(disp.quantity_returned_total || 0) : 0;
    setQuantityReturned(String(remaining || ''));
  };

  const handleProcessReturn = async () => {
    if (!selectedDispensingId) { toast.error('Select a dispensing record'); return; }
    const qty = parseInt(quantityReturned, 10);
    if (!qty || qty <= 0) { toast.error('Enter a valid quantity'); return; }

    setProcessing(true);
    try {
      const res = await authFetch(`${API}/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          dispensing_record_id: selectedDispensingId, return_reason: returnReason,
          quantity_returned: qty, notes, clinic_id: clinicId, processed_by: user?.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`${data.return_number} processed — Refund: ${fmt(parseFloat(data.amount_refunded) || 0)}`);
        setShowModal(false);
        fetchReturns();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to process return');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setProcessing(false);
    }
  };

  const filteredReturns = returns.filter(r => {
    const q = search.toLowerCase();
    return !q ||
      r.return_number?.toLowerCase().includes(q) ||
      r.dispensing_number?.toLowerCase().includes(q) ||
      r.patient_name?.toLowerCase().includes(q) ||
      r.drug_name?.toLowerCase().includes(q);
  });

  // What the refunds on screen actually cost, so the cash leaving the drawer is
  // visible here and not only in the accounts it posts to.
  const refundedTotal = filteredReturns.reduce((sum, r) => sum + (parseFloat(r.amount_refunded) || 0), 0);
  const refundedToday = filteredReturns
    .filter(r => String(r.return_date || '').slice(0, 10) === new Date().toISOString().slice(0, 10))
    .reduce((sum, r) => sum + (parseFloat(r.amount_refunded) || 0), 0);

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
        <PageHeader title="Pharmacy Returns" icon={<RotateCcw />} className="mb-3" />

        <div className="flex-1 min-h-0 bg-card rounded-lg border shadow-sm p-0 flex flex-col overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
            <div className="flex items-baseline gap-4 flex-wrap">
              <h3 className="font-medium">Return Directory</h3>
              <span className="text-xs text-muted-foreground">
                {filteredReturns.length} return{filteredReturns.length === 1 ? '' : 's'} ·
                refunded <strong className="text-foreground">{fmt(refundedTotal)}</strong>
                {refundedToday > 0 && <> · today <strong className="text-foreground">{fmt(refundedToday)}</strong></>}
              </span>
              <span
                className="text-xs text-muted-foreground"
                title="Each refund posts a journal entry: pharmacy revenue is debited and cash at hand credited, so the income statement and cash balance both reflect the money returned."
              >
                Refunds reduce pharmacy revenue and cash at hand in the accounts.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative w-64">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input placeholder="Search returns..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Button onClick={openModal}>
                <RotateCcw className="w-4 h-4 mr-2" /> Process Return
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <AdvancedDataTable<any>
              data={filteredReturns}
              keyExtractor={(r) => r.id}
              loading={loading}
              emptyMessage="No returns found."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'return_number', header: 'Return No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                { key: 'patient_name', header: 'Patient', render: (v) => v || '—' },
                { key: 'drug_name', header: 'Drug', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                { key: 'quantity_returned', header: 'Qty', sortable: true },
                { key: 'amount_refunded', header: 'Refund', sortable: true, render: (v) => <span className="font-medium">{fmt(parseFloat(v) || 0)}</span> },
                { key: 'return_reason', header: 'Reason', render: (v) => <span className="capitalize text-muted-foreground">{v?.replace(/_/g, ' ')}</span> },
                { key: 'return_date', header: 'Date', sortable: true, render: (v) => <span className="text-muted-foreground">{v ? formatDate(v) : '—'}</span> },
                { key: 'processed_by_name', header: 'Processed By', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
              ]}
            />
          </div>
        </div>
      </div>
      </div>

      {/* Process Return Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-lg rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-primary" /> Process Drug Return
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-6 flex-1 overflow-auto space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Dispensing Record</label>
                <Combobox
                  options={dispensingRecords.map((d: any) => ({ value: d.id, label: `${d.dispensing_number} — ${d.drug_name} (${d.patient_name})` }))}
                  value={selectedDispensingId}
                  onChange={handleSelectDispensing}
                  placeholder="Select dispensing record..."
                  searchPlaceholder="Search dispensing records..."
                  className="mt-1 h-9"
                />
              </div>

              {selectedDispensing && (
                <div className="grid grid-cols-2 gap-y-2 text-sm p-3 bg-muted/30 rounded-lg">
                  <span className="text-muted-foreground">Drug</span>
                  <span className="text-right">{selectedDispensing.drug_name}</span>
                  <span className="text-muted-foreground">Patient</span>
                  <span className="text-right">{selectedDispensing.patient_name}</span>
                  <span className="text-muted-foreground">Qty Dispensed</span>
                  <span className="text-right">{selectedDispensing.quantity_dispensed}</span>
                  {parseFloat(selectedDispensing.quantity_returned_total || 0) > 0 && (
                    <>
                      <span className="text-muted-foreground">Already Returned</span>
                      <span className="text-right">{selectedDispensing.quantity_returned_total}</span>
                      <span className="text-muted-foreground">Remaining</span>
                      <span className="text-right font-medium">{remainingQty}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">Unit Price</span>
                  <span className="text-right">{fmt(parseFloat(selectedDispensing.unit_price) || 0)}</span>
                  <span className="text-muted-foreground">Batch</span>
                  <span className="text-right">{selectedDispensing.batch_number || 'N/A'}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Quantity to Return</label>
                  <Input
                    type="number" min="1" max={remainingQty || undefined}
                    value={quantityReturned} onChange={e => setQuantityReturned(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Reason</label>
                  <Combobox
                    options={RETURN_REASONS}
                    value={returnReason}
                    onChange={setReturnReason}
                    searchPlaceholder="Search..."
                    className="mt-1 h-9"
                  />
                </div>
              </div>

              {selectedDispensing && parseInt(quantityReturned, 10) > 0 && (
                <div className="bg-success-bg border border-success-border rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Estimated Refund</p>
                  <p className="text-xl font-bold text-success">
                    {fmt((parseFloat(selectedDispensing.unit_price) || 0) * (parseInt(quantityReturned, 10) || 0))}
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional notes..."
                  className="w-full mt-1 p-3 border border-input rounded-md resize-none h-20 text-sm bg-transparent shadow-sm"
                />
              </div>
            </div>

            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button onClick={handleProcessReturn} disabled={processing}>
                {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Process Return
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
