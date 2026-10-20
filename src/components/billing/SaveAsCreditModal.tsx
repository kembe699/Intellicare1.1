import React, { useState } from 'react';
import { formatDate } from '@/lib/format';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Loader2, FileText, Calendar, User, Receipt, Shield } from 'lucide-react';
import { toast } from '@/lib/notify';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface SaveAsCreditModalProps {
  bill: any;
  schemeInfo?: {
    scheme_id: string;
    scheme_name: string;
    is_insurance?: boolean;
    currency?: string;
    [key: string]: any;
  } | null;
  onClose: () => void;
  onSuccess: (invoiceData: any) => void;
}

export default function SaveAsCreditModal({ bill, schemeInfo, onClose, onSuccess }: SaveAsCreditModalProps) {
  const [paymentTerms, setPaymentTerms] = useState('30');
  const [notes, setNotes] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [saving, setSaving] = useState(false);

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + parseInt(paymentTerms));

  const { currency: baseCurrency } = useCurrency();
  // Determine currency: scheme currency > bill scheme currency > service currency > base currency
  const getBillCurrency = (): string => {
    // 1. From scheme info (most reliable)
    if (schemeInfo?.currency && schemeInfo.currency !== baseCurrency.code) return schemeInfo.currency;
    // 2. From bill-level scheme currency
    if (bill?.schemeCurrency) return bill.schemeCurrency;
    if (bill?.scheme_currency) return bill.scheme_currency;
    // 3. From service-level currency
    if (bill?.services) {
      const services = Array.isArray(bill.services) ? bill.services :
        (typeof bill.services === 'string' ? (() => { try { return JSON.parse(bill.services); } catch { return []; } })() : []);
      for (const s of services) {
        if (s.scheme_currency && s.scheme_currency !== baseCurrency.code) return s.scheme_currency;
        if (s.currency && s.currency !== baseCurrency.code) return s.currency;
      }
    }
    return baseCurrency.code;
  };

  const currency = getBillCurrency();
  const totalAmount = parseFloat(bill?.totalAmount || bill?.total_amount || 0);
  const services = Array.isArray(bill?.services) ? bill.services :
    (typeof bill?.services === 'string' ? (() => { try { return JSON.parse(bill.services); } catch { return []; } })() : []);

  const handleSave = async () => {
    if (!agreedToTerms) {
      toast.error('Please agree to payment terms');
      return;
    }
    setSaving(true);
    try {
      const response = await authFetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_id: bill.id,
          patient_id: bill.patientId || bill.patient_id,
          patient_name: bill.patientName || bill.patient_name,
          clinic_id: bill.clinicId || bill.clinic_id,
          amount: totalAmount,
          currency,
          payment_terms: parseInt(paymentTerms),
          due_date: dueDate.toISOString().split('T')[0],
          notes,
          services,
          scheme_id: bill.schemeId || bill.scheme_id || schemeInfo?.scheme_id || null,
          scheme_name: bill.schemeName || bill.scheme_name || schemeInfo?.scheme_name || null,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create invoice');
      }

      const data = await response.json();
      toast.success(`Invoice ${data.data.invoice_number} created successfully`);
      onSuccess(data.data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto gap-0 p-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <FileText className="w-3.5 h-3.5 text-primary" />
            Save Bill as Credit Invoice
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Convert this bill to a credit invoice. The customer will pay within the specified terms.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          {/* Bill Summary */}
          <div className="bg-muted/50 p-4 rounded-lg border">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-2">
                <User className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Patient</p>
                  <p className="font-semibold text-sm">{bill?.patientName || bill?.patient_name}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Receipt className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Bill Amount</p>
                  <p className="font-bold text-lg text-primary">{currency} {totalAmount.toFixed(2)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Bill Number</p>
                <p className="font-semibold text-sm">{bill?.billNumber || bill?.bill_number}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Services</p>
                <p className="font-semibold text-sm">{services.length} item{services.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            {(bill.schemeName || bill.scheme_name || schemeInfo) && (
              <div className="mt-3 pt-3 border-t border-border/50 flex items-start gap-2">
                <Shield className="h-4 w-4 mt-0.5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Insurance / Scheme</p>
                  <p className="font-semibold text-sm text-primary">{bill.schemeName || bill.scheme_name || schemeInfo?.scheme_name}</p>
                  {schemeInfo?.is_insurance && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Insurance</span>}
                </div>
              </div>
            )}
          </div>

          {/* Services breakdown */}
          {services.length > 0 && (
            <div className="max-h-32 overflow-y-auto">
              <AdvancedDataTable<any>
                data={services}
                keyExtractor={(s, i) => i}
                columns={[
                  { key: 'serviceName', header: 'Service', render: (v, s) => v || s.name || s.service_name || 'Service' },
                  { key: 'quantity', header: 'Qty', align: 'right', render: (v) => v || 1 },
                  {
                    key: '__amount', header: 'Amount', align: 'right',
                    render: (_v, s) => <span className="font-mono">{s.currency || currency} {(s.totalPrice || s.total_price || s.price || 0).toFixed(2)}</span>,
                  },
                ]}
              />
            </div>
          )}

          {/* Payment Terms */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Payment Terms *
            </Label>
            <Combobox
              options={[
                { value: '7', label: 'Net 7 Days' },
                { value: '14', label: 'Net 14 Days' },
                { value: '30', label: 'Net 30 Days' },
                { value: '60', label: 'Net 60 Days' },
                { value: '90', label: 'Net 90 Days' },
              ]}
              value={paymentTerms}
              onChange={setPaymentTerms}
              searchPlaceholder="Search..."
            />
            <p className="text-xs text-muted-foreground">
              Due date: <span className="font-semibold">{formatDate(dueDate)}</span>
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Invoice Notes (Optional)</Label>
            <Textarea
              placeholder="Add any additional notes or payment instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Terms Agreement */}
          <div className="bg-card rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="credit-terms"
                checked={agreedToTerms}
                onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
                className="mt-0.5"
              />
              <div>
                <label htmlFor="credit-terms" className="text-sm font-medium cursor-pointer">
                  I confirm the payment terms
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  Invoice of <span className="font-semibold">{currency} {totalAmount.toFixed(2)}</span> is due
                  on <span className="font-semibold">{formatDate(dueDate)}</span>.
                  This will be recorded as an outstanding receivable.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <Button variant="outline" className="h-8 text-xs" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button className="h-8 text-xs font-semibold" onClick={handleSave} disabled={saving || !agreedToTerms}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Creating Invoice...
              </>
            ) : (
              'Create Invoice'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
