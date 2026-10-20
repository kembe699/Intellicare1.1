import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { CreditCard, Download, Eye, FileText, Loader2, Search } from 'lucide-react';
import { toast } from '@/lib/notify';
import { buildInvoiceHTML } from '@/utils/invoiceTemplate';
import { downloadDocumentAsPdf } from '@/utils/documentTemplate';

interface InvoiceRow {
  id: number;
  invoice_number: string;
  currency: string;
  total_amount: string;
  amount_paid: string;
  status: 'unpaid' | 'partial' | 'paid';
  issue_date: string;
  customer: { id: number; name: string; email: string | null };
  quotation: { id: number; quote_number: string };
}

const STATUS_VARIANT: Record<string, 'destructive' | 'warning' | 'success'> = {
  unpaid: 'destructive', partial: 'warning', paid: 'success',
};
const STATUS_LABEL: Record<string, string> = { unpaid: 'Unpaid', partial: 'Partially Paid', paid: 'Paid' };

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
];

const money = (amount: string | number, currency: string) =>
  `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PlatformInvoices: React.FC = () => {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [payTarget, setPayTarget] = useState<InvoiceRow | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const res = await platformFetch(`/quotation-invoices${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load invoices');
      setInvoices(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) =>
      inv.invoice_number.toLowerCase().includes(q) ||
      inv.customer?.name?.toLowerCase().includes(q) ||
      inv.quotation?.quote_number?.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  const openPay = (inv: InvoiceRow) => {
    setPayTarget(inv);
    setPayAmount('');
  };

  const balanceOf = (inv: InvoiceRow) => Number(inv.total_amount) - Number(inv.amount_paid);

  const handleDownload = async (inv: InvoiceRow) => {
    setDownloadingId(inv.id);
    try {
      const [detailRes, companyRes] = await Promise.all([
        platformFetch(`/quotation-invoices/${inv.id}`),
        platformFetch('/company-profile'),
      ]);
      const detail = await detailRes.json();
      const company = await companyRes.json();
      if (!detailRes.ok) throw new Error(detail.error || 'Failed to load invoice');
      if (!companyRes.ok) throw new Error(company.error || 'Failed to load company profile');
      const html = buildInvoiceHTML(detail, detail.customer, detail.payments, company);
      await downloadDocumentAsPdf(html, `${detail.invoice_number}-${detail.customer.name}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    setPaying(true);
    try {
      const res = await platformFetch(`/quotation-invoices/${payTarget.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(payAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record payment');
      toast.success('Payment recorded');
      setPayTarget(null);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <PlatformAppLayout>
      <PageHeader
        icon={<FileText />}
        title="Invoices"
        subtitle="Invoices issued to clients from accepted quotations — track what's paid and what's still owed"
      />

      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/30 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by invoice #, customer, or quote #..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Combobox
            options={STATUS_FILTER_OPTIONS}
            value={statusFilter}
            onChange={setStatusFilter}
            searchPlaceholder="Search..."
            className="h-9 w-[160px]"
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Quote #</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Issue Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-10">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No invoices yet — convert an accepted quotation into one from its detail page.
              </TableCell></TableRow>
            ) : filtered.map((inv) => {
              const balance = balanceOf(inv);
              return (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-sm text-foreground">{inv.invoice_number}</TableCell>
                  <TableCell className="font-medium text-foreground">{inv.customer?.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{inv.quotation?.quote_number}</TableCell>
                  <TableCell className="text-foreground">{money(inv.total_amount, inv.currency)}</TableCell>
                  <TableCell className="text-muted-foreground">{money(inv.amount_paid, inv.currency)}</TableCell>
                  <TableCell className={balance > 0 ? 'text-primary font-semibold' : 'text-muted-foreground'}>{money(balance, inv.currency)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[inv.status]}>{STATUS_LABEL[inv.status]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{new Date(inv.issue_date).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right space-x-1.5 whitespace-nowrap">
                    <Link to={`/platform-admin/invoices/${inv.id}`}>
                      <Button variant="outline" size="sm" title="View invoice"><Eye className="w-3.5 h-3.5" /></Button>
                    </Link>
                    <Button variant="outline" size="sm" title="Download PDF" onClick={() => handleDownload(inv)} disabled={downloadingId === inv.id}>
                      {downloadingId === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    </Button>
                    {inv.status !== 'paid' && (
                      <Button size="sm" onClick={() => openPay(inv)} className="gap-1.5">
                        <CreditCard className="w-3.5 h-3.5" /> Record Payment
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          {payTarget && (
            <form onSubmit={handleRecordPayment}>
              <div className="px-5 py-4 space-y-4 text-sm">
                <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-medium text-foreground">{money(payTarget.total_amount, payTarget.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Already Paid</span><span className="font-medium text-foreground">{money(payTarget.amount_paid, payTarget.currency)}</span></div>
                  <div className="flex justify-between pt-1 border-t border-border"><span className="text-muted-foreground">Balance Due</span><span className="font-semibold text-primary">{money(balanceOf(payTarget), payTarget.currency)}</span></div>
                </div>
                <div className="space-y-1.5">
                  <Label>Payment Amount ({payTarget.currency})</Label>
                  <Input
                    type="number" min="0.01" step="0.01" max={balanceOf(payTarget)}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
                <Button type="submit" disabled={paying}>
                  {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Record Payment'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PlatformAppLayout>
  );
};

export default PlatformInvoices;
