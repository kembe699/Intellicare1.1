import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { CreditCard, Download, FileText, Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { buildInvoiceHTML } from '@/utils/invoiceTemplate';
import { openPrintWindow, downloadDocumentAsPdf } from '@/utils/documentTemplate';

interface Payment {
  id: number;
  amount: string;
  paid_at: string;
  recorded_by_name: string | null;
  notes: string | null;
}

interface InvoiceDetail {
  id: number;
  invoice_number: string;
  issue_date: string;
  currency: string;
  total_amount: string;
  amount_paid: string;
  status: 'unpaid' | 'partial' | 'paid';
  customer: { id: number; name: string; contact_person: string | null; email: string | null; phone: string | null; address: string | null };
  quotation: { id: number; quote_number: string } | null;
  payments: Payment[];
}

const STATUS_VARIANT: Record<string, 'destructive' | 'warning' | 'success'> = {
  unpaid: 'destructive', partial: 'warning', paid: 'success',
};
const STATUS_LABEL: Record<string, string> = { unpaid: 'Unpaid', partial: 'Partially Paid', paid: 'Paid' };

const money = (amount: string | number, currency: string) =>
  `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

const PlatformInvoiceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformFetch(`/quotation-invoices/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load invoice');
      setInvoice(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const balance = invoice ? Number(invoice.total_amount) - Number(invoice.amount_paid) : 0;

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    setPaying(true);
    try {
      const res = await platformFetch(`/quotation-invoices/${invoice.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(payAmount), notes: payNotes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record payment');
      toast.success('Payment recorded');
      setPayOpen(false);
      setPayAmount('');
      setPayNotes('');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPaying(false);
    }
  };

  const generateDocument = async (mode: 'print' | 'pdf') => {
    if (!invoice) return;
    setGenerating(true);
    try {
      const res = await platformFetch('/company-profile');
      const company = await res.json();
      if (!res.ok) throw new Error(company.error || 'Failed to load company profile');
      const html = buildInvoiceHTML(invoice, invoice.customer, invoice.payments, company);
      if (mode === 'print') {
        const pw = openPrintWindow(html);
        if (!pw) toast.error('Please allow popups to generate the invoice');
      } else {
        await downloadDocumentAsPdf(html, `${invoice.invoice_number}-${invoice.customer.name}`);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <PlatformAppLayout><LoadingState message="Loading invoice..." /></PlatformAppLayout>;
  if (!invoice) return <PlatformAppLayout><div className="p-12 text-center text-muted-foreground">Invoice not found</div></PlatformAppLayout>;

  return (
    <PlatformAppLayout>
      <PageHeader
        icon={<Receipt />}
        title={invoice.invoice_number}
        subtitle={`For ${invoice.customer.name}${invoice.quotation ? ` — from ${invoice.quotation.quote_number}` : ''}`}
        actions={
          <>
            <Badge variant={STATUS_VARIANT[invoice.status]} className="text-sm px-3 py-1">{STATUS_LABEL[invoice.status]}</Badge>
            <Button variant="outline" onClick={() => generateDocument('print')} disabled={generating}>
              <FileText className="w-4 h-4 mr-1.5" /> Print
            </Button>
            <Button onClick={() => generateDocument('pdf')} disabled={generating}>
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Download className="w-4 h-4 mr-1.5" /> Download PDF</>}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-5 space-y-5">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border border-border p-4 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</p>
                  <p className="text-lg font-bold text-foreground mt-1">{money(invoice.total_amount, invoice.currency)}</p>
                </div>
                <div className="rounded-lg border border-border p-4 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Paid</p>
                  <p className="text-lg font-bold text-foreground mt-1">{money(invoice.amount_paid, invoice.currency)}</p>
                </div>
                <div className="rounded-lg border border-border p-4 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Balance Due</p>
                  <p className="text-lg font-bold text-primary mt-1">{money(balance, invoice.currency)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                <Field label="Issue Date" value={new Date(invoice.issue_date).toLocaleDateString()} />
                <Field label="Currency" value={invoice.currency} />
              </div>
              {invoice.status !== 'paid' && (
                <div className="pt-4 border-t border-border">
                  <Button className="gap-1.5" onClick={() => setPayOpen(true)}>
                    <CreditCard className="w-4 h-4" /> Record Payment
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Payment History</p>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead>Date</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.payments.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No payments recorded yet</TableCell></TableRow>
                  ) : invoice.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{new Date(p.paid_at).toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{p.recorded_by_name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{p.notes || '—'}</TableCell>
                      <TableCell className="text-right font-medium text-foreground">{money(p.amount, invoice.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Billed To</p>
            <p className="font-semibold text-foreground">{invoice.customer.name}</p>
            {invoice.customer.contact_person && <p className="text-sm text-muted-foreground">{invoice.customer.contact_person}</p>}
            {invoice.customer.email && <p className="text-sm text-muted-foreground">{invoice.customer.email}</p>}
            {invoice.customer.phone && <p className="text-sm text-muted-foreground">{invoice.customer.phone}</p>}
            {invoice.customer.address && <p className="text-sm text-muted-foreground">{invoice.customer.address}</p>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <form onSubmit={handleRecordPayment}>
            <div className="px-5 py-4 space-y-4 text-sm">
              <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-medium text-foreground">{money(invoice.total_amount, invoice.currency)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Already Paid</span><span className="font-medium text-foreground">{money(invoice.amount_paid, invoice.currency)}</span></div>
                <div className="flex justify-between pt-1 border-t border-border"><span className="text-muted-foreground">Balance Due</span><span className="font-semibold text-primary">{money(balance, invoice.currency)}</span></div>
              </div>
              <div className="space-y-1.5">
                <Label>Payment Amount ({invoice.currency})</Label>
                <Input type="number" min="0.01" step="0.01" max={balance} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus required />
              </div>
              <div className="space-y-1.5">
                <Label>Notes (optional)</Label>
                <Textarea rows={2} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="e.g. bank transfer ref, cheque number..." />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={paying}>
                {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Record Payment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PlatformAppLayout>
  );
};

export default PlatformInvoiceDetail;
