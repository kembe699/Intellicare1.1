import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, LoadingState, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Building2, Edit, Star, Phone, Mail, MapPin, CheckCircle, Ban, Loader2,
  Check, Receipt, Plus, FileText, ArrowLeft, Truck, Wallet, Clock, ClipboardList,
} from 'lucide-react';

const SUPPLIER_STATUS_TONE: Record<string, StatusBadgeTone> = {
  active: 'success',
  on_hold: 'warning',
  inactive: 'neutral',
};

const PO_STATUS_TONE: Record<string, StatusBadgeTone> = {
  draft: 'neutral',
  check: 'warning',
  approved: 'warning',
  authorized: 'info',
  received: 'success',
  cancelled: 'danger',
};

const supplierStatus = (s: any) => {
  if (s.on_hold) return { status: 'on_hold', label: 'On Hold' };
  if (s.is_active) return { status: 'active', label: 'Active' };
  return { status: 'inactive', label: 'Inactive' };
};

const renderStars = (rating: number) => {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(<Star key={i} className={`w-4 h-4 ${i <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />);
  }
  return <div className="flex gap-0.5">{stars}</div>;
};

export default function SupplierProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currency, fmt } = useCurrency();

  const [supplier, setSupplier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holdingId, setHoldingId] = useState<number | null>(null);

  const [bills, setBills] = useState<any[]>([]);
  const [billSummary, setBillSummary] = useState({ total_billed: 0, total_paid: 0, total_outstanding: 0 });
  const [loadingBills, setLoadingBills] = useState(false);

  const [showCreateBill, setShowCreateBill] = useState(false);
  const [billAmount, setBillAmount] = useState('');
  const [billDescription, setBillDescription] = useState('');
  const [creatingBill, setCreatingBill] = useState(false);

  const [currencies, setCurrencies] = useState<any[]>([]);

  const fetchSupplier = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/procurement/suppliers/${id}`);
      if (!res.ok) { setError('Supplier not found'); return; }
      setSupplier(await res.json());
    } catch (e) {
      setError('Failed to load supplier');
    } finally {
      setLoading(false);
    }
  };

  const fetchBills = async () => {
    setLoadingBills(true);
    try {
      const res = await authFetch(`/api/procurement/suppliers/${id}/purchase-orders`);
      if (res.ok) {
        const data = await res.json();
        setBills(data.purchase_orders || []);
        setBillSummary(data.summary || { total_billed: 0, total_paid: 0, total_outstanding: 0 });
      }
    } catch (e) {
      toast.error("Failed to load this supplier's purchase orders");
    } finally {
      setLoadingBills(false);
    }
  };

  const fetchCurrencies = async () => {
    try {
      const res = await authFetch('/api/currencies');
      if (res.ok) setCurrencies(await res.json());
    } catch (e) { /* non-blocking */ }
  };

  useEffect(() => { fetchSupplier(); fetchBills(); fetchCurrencies(); }, [id]);

  const formatInCurrency = (amount: number, code?: string) => {
    const match = currencies.find((c: any) => c.code === code);
    const symbol = match?.symbol || code || currency.symbol || currency.code;
    const decimals = match?.decimal_places ?? currency.decimal_places ?? 2;
    return `${symbol} ${Number(amount || 0).toFixed(decimals)}`;
  };

  const toggleHold = async () => {
    if (!supplier || holdingId === supplier.id) return;
    const reason = supplier.on_hold ? '' : prompt('Reason for placing on hold:');
    if (!supplier.on_hold && !reason) return;
    setHoldingId(supplier.id);
    try {
      const res = await authFetch(`/api/procurement/suppliers/${supplier.id}/hold`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on_hold: !supplier.on_hold, hold_reason: reason || '' }),
      });
      if (res.ok) {
        toast.success(supplier.on_hold ? 'Hold released' : 'Supplier placed on hold');
        setSupplier((prev: any) => ({ ...prev, on_hold: !prev.on_hold, hold_reason: reason || '' }));
      } else {
        toast.error('Failed to update hold status');
      }
    } catch (e) {
      toast.error('Failed to update hold status');
    } finally {
      setHoldingId(null);
    }
  };

  const handleCreateBill = async () => {
    if (creatingBill || !supplier) return;
    const amt = parseFloat(billAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!billDescription.trim()) { toast.error("Add a short description of what this bill is for"); return; }
    setCreatingBill(true);
    try {
      const res = await authFetch('/api/procurement/purchase-orders/quick-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: supplier.id, amount: amt, description: billDescription.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success(`Bill ${created.po_number} recorded`);
        setShowCreateBill(false);
        setBillAmount(''); setBillDescription('');
        fetchBills();
        fetchSupplier();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create bill');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setCreatingBill(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6"><LoadingState /></div>
      </AppLayout>
    );
  }

  if (error || !supplier) {
    return (
      <AppLayout>
        <div className="p-6 space-y-4">
          <Button variant="outline" onClick={() => navigate('/procurement/suppliers-mgmt')}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Suppliers
          </Button>
          <div className="text-center text-muted-foreground py-12">{error || 'Supplier not found'}</div>
        </div>
      </AppLayout>
    );
  }

  const st = supplierStatus(supplier);

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)]">
        <div className="max-w-[1700px] mx-auto space-y-4">
          <PageHeader
            icon={<Truck />}
            title="Supplier Profile"
            subtitle="Profile, performance, and billing history"
            actions={
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate('/procurement/suppliers-mgmt')}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back
                </Button>
                <Link to={`/procurement/suppliers-mgmt?edit=${supplier.id}`}>
                  <Button variant="outline" size="sm">
                    <Edit className="w-4 h-4 mr-2" /> Edit
                  </Button>
                </Link>
                <Button variant="outline" size="sm" disabled={holdingId === supplier.id} onClick={toggleHold}>
                  {holdingId === supplier.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : (supplier.on_hold ? <><CheckCircle className="w-4 h-4 mr-2" /> Release Hold</> : <><Ban className="w-4 h-4 mr-2" /> Place on Hold</>)}
                </Button>
              </div>
            }
          />

          <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
            {/* LEFT: identity, contact, and reference details */}
            <div className="space-y-4">
              <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold leading-tight">{supplier.name}</h2>
                      <p className="text-sm text-muted-foreground font-mono">{supplier.supplier_code}</p>
                    </div>
                  </div>
                </div>
                <StatusBadge status={st.status} label={st.label} map={SUPPLIER_STATUS_TONE} />

                <div className="space-y-2.5 text-sm border-t pt-4">
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground shrink-0" />{supplier.phone || '—'}</div>
                  <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground shrink-0" />{supplier.email || '—'}</div>
                  <div className="flex items-start gap-2"><MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />{supplier.address || '—'}{supplier.town ? `, ${supplier.town}` : ''}</div>
                </div>

                <div className="space-y-2 border-t pt-4 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{(supplier.supplier_type || 'general').replace('_', ' ')}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Payment Terms</span><span>{supplier.payment_terms || 'Net30'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Currency</span><span>{supplier.currency || currency.code}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Credit Limit</span><span className="font-mono">{formatInCurrency(supplier.credit_limit || 0, supplier.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax ID</span><span>{supplier.tax_id || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Bank</span><span>{supplier.bank_name || '—'}</span></div>
                </div>
              </div>
            </div>

            {/* RIGHT: performance stats + billing, given the wider column since
                the PO table is the part that actually needs the room */}
            <div className="space-y-4 min-w-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-card rounded-lg border shadow-sm p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><ClipboardList className="w-4 h-4 text-primary" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total POs</p>
                    <p className="text-lg font-bold">{supplier.stats?.total_pos || 0}</p>
                  </div>
                </div>
                <div className="bg-card rounded-lg border shadow-sm p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Wallet className="w-4 h-4 text-primary" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Spend</p>
                    <p className="text-lg font-bold font-mono">{fmt(supplier.stats?.total_po_amount || 0)}</p>
                  </div>
                </div>
                <div className="bg-card rounded-lg border shadow-sm p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Clock className="w-4 h-4 text-primary" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Open POs</p>
                    <p className="text-lg font-bold">{supplier.stats?.open_pos || 0}</p>
                  </div>
                </div>
                <div className="bg-card rounded-lg border shadow-sm p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Star className="w-4 h-4 text-primary" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Rating</p>
                    {supplier.performance?.avg_rating > 0 ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        {renderStars(supplier.performance.avg_rating)}
                        <span className="text-xs text-muted-foreground ml-1">({supplier.performance.total_reviews})</span>
                      </div>
                    ) : <p className="text-sm text-muted-foreground mt-0.5">No ratings</p>}
                  </div>
                </div>
              </div>

              {/* Billing: what this supplier is owed, what's already been paid, and
                  every PO/bill behind those numbers. */}
              <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" /> Billing &amp; Purchase Orders</h3>
                  <Button size="sm" variant="outline" onClick={() => setShowCreateBill(v => !v)}>
                    <Plus className="w-4 h-4 mr-2" /> Create Bill
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                    <p className="text-xs text-amber-800">Outstanding</p>
                    <p className="text-xl font-bold font-mono text-amber-900">{fmt(billSummary.total_outstanding)}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                    <p className="text-xs text-emerald-800">Paid</p>
                    <p className="text-xl font-bold font-mono text-emerald-900">{fmt(billSummary.total_paid)}</p>
                  </div>
                </div>

                {showCreateBill && (
                  <div className="p-4 rounded-lg border bg-muted/20 space-y-3">
                    <p className="text-sm font-medium">New bill for {supplier.name} — items not required</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">Amount ({supplier.currency || currency.code})</Label>
                        <Input type="number" step="0.01" min="0" className="mt-1" placeholder="0.00" value={billAmount} onChange={e => setBillAmount(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">What's it for?</Label>
                        <Input className="mt-1" placeholder="e.g. Equipment repair" value={billDescription} onChange={e => setBillDescription(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setShowCreateBill(false)}>Cancel</Button>
                      <Button size="sm" onClick={handleCreateBill} disabled={creatingBill}>
                        {creatingBill ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                        {creatingBill ? 'Saving...' : 'Save Bill'}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="border rounded-lg overflow-hidden overflow-x-auto">
                  {loadingBills ? (
                    <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                  ) : bills.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                      <FileText className="w-6 h-6 text-muted-foreground/50" />
                      No purchase orders or bills for this supplier yet.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr className="text-left text-muted-foreground text-xs">
                          <th className="px-4 py-2.5 font-medium">PO / Bill No.</th>
                          <th className="px-4 py-2.5 font-medium">Date</th>
                          <th className="px-4 py-2.5 font-medium">Status</th>
                          <th className="px-4 py-2.5 font-medium text-right">Total</th>
                          <th className="px-4 py-2.5 font-medium text-right">Paid</th>
                          <th className="px-4 py-2.5 font-medium text-right">Balance Due</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {bills.map((b: any) => (
                          <tr key={b.id}>
                            <td className="px-4 py-2.5 font-mono text-primary">{b.po_number}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{new Date(b.order_date).toLocaleDateString()}</td>
                            <td className="px-4 py-2.5"><StatusBadge status={b.status} label={b.status} map={PO_STATUS_TONE} /></td>
                            <td className="px-4 py-2.5 text-right font-mono">{formatInCurrency(b.total_amount, b.po_currency)}</td>
                            <td className="px-4 py-2.5 text-right font-mono">{formatInCurrency(b.paid_amount, b.po_currency)}</td>
                            <td className={cn("px-4 py-2.5 text-right font-mono font-semibold", parseFloat(b.balance_due) > 0 ? "text-amber-700" : "text-emerald-700")}>
                              {formatInCurrency(b.balance_due, b.po_currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
