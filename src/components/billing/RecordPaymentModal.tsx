import React, { useState } from 'react';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Loader2, DollarSign } from 'lucide-react';
import { toast } from '@/lib/notify';

interface RecordPaymentModalProps {
  invoice: any;
  onClose: () => void;
  onSuccess: () => void;
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'mobile_money', label: 'Mobile Money' },
];

export default function RecordPaymentModal({ invoice, onClose, onSuccess }: RecordPaymentModalProps) {
  const [amount, setAmount] = useState(String(parseFloat(invoice.balance_due) || 0));
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { currency: baseCurrency } = useCurrency();
  const currency = invoice.currency || baseCurrency.code;
  const balanceDue = parseFloat(invoice.balance_due) || 0;

  const handleSave = async () => {
    const payAmt = parseFloat(amount);
    if (!payAmt || payAmt <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (payAmt > balanceDue + 0.01) {
      toast.error(`Amount cannot exceed balance due (${currency} ${balanceDue.toFixed(2)})`);
      return;
    }

    setSaving(true);
    try {
      const response = await authFetch(`/api/invoices/${invoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: payAmt,
          payment_date: paymentDate,
          payment_method: paymentMethod,
          reference_number: referenceNumber || undefined,
          notes: notes || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to record payment');
      }

      const data = await response.json();
      toast.success(`Payment of ${currency} ${payAmt.toFixed(2)} recorded. Balance: ${currency} ${parseFloat(data.data.balance_due).toFixed(2)}`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-success" />
            Record Payment
          </DialogTitle>
        </DialogHeader>

        <div className="bg-muted/50 rounded-lg p-3 border mb-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Invoice:</span>
            <span className="font-semibold">{invoice.invoice_number}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-muted-foreground">Total Amount:</span>
            <span className="font-semibold">{currency} {parseFloat(invoice.amount).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-muted-foreground">Already Paid:</span>
            <span className="font-semibold text-success">{currency} {parseFloat(invoice.amount_paid).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm mt-1 pt-1 border-t">
            <span className="text-muted-foreground font-medium">Balance Due:</span>
            <span className="font-bold text-destructive">{currency} {balanceDue.toFixed(2)}</span>
          </div>
        </div>

        <div className="space-y-3">
          {/* Amount */}
          <div className="space-y-1">
            <Label>Amount ({currency}) *</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max={balanceDue}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="font-mono"
            />
          </div>

          {/* Payment Date */}
          <div className="space-y-1">
            <Label>Payment Date *</Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>

          {/* Payment Method */}
          <div className="space-y-1">
            <Label>Payment Method *</Label>
            <Combobox
              options={PAYMENT_METHODS}
              value={paymentMethod}
              onChange={setPaymentMethod}
              searchPlaceholder="Search..."
            />
          </div>

          {/* Reference Number */}
          <div className="space-y-1">
            <Label>Reference Number (Optional)</Label>
            <Input
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Receipt/Check number..."
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Payment notes..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Recording...
              </>
            ) : (
              'Record Payment'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
