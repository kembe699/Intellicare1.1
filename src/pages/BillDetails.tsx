import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { PaymentReceipt, printThermalReceipt } from '@/components/receipts/PaymentReceipt';
import * as docTemplate from '@/utils/documentTemplate';
import {
  ArrowLeft, Plus, DollarSign, X, Loader2, Check,
  AlertTriangle, Shield, CreditCard, UserPlus, FileText, Wallet, ChevronsUpDown,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface ServiceLine {
  serviceName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  isVoided?: boolean;
  paid?: boolean;
  status?: string;
  paidAt?: string;
  currency?: string;
  // Set when this line is actually covered by the patient's insurance/scheme — it's billed
  // at 0 here (the patient owes nothing in SSP for it) and claimed from the insurer
  // separately, in this currency, via an Insurance Invoice from the Dispensing screen.
  schemePrice?: number;
  schemeCurrency?: string;
  // Set once a credit invoice has been raised covering this line — it's no longer payable
  // directly on this bill (that would double-collect); only from the Invoices page.
  invoiced?: boolean;
  // Display-only metadata captured when the line was added from the Add Service/Product form.
  addedAt?: string;
  discountLabel?: string | null;
}

interface Bill {
  id: string;
  bill_number: string;
  patient_id: string;
  patient_name: string;
  clinic_id: number;
  total_amount: string | number;
  paid_amount: string | number;
  balance_amount: string | number;
  status: string;
  bill_date: string;
  due_date: string | null;
  services: ServiceLine[];
  scheme_id?: string | null;
  scheme_name?: string | null;
  scheme_pricing_applied?: boolean;
  bill_currency?: string;
  notes?: string | null;
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'check', label: 'Cheque' },
  { value: 'credit', label: 'Credit (Invoice)' },
];

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const amt = (v: any) => parseFloat(v) || 0;

// A line only counts as a separate, not-yet-invoiced insurance claim when it's actually
// billed at 0 in SSP. schemePrice/schemeCurrency can also end up stashed (and left behind)
// on a line that a scheme-mode bill later re-priced for real via add-services — that one
// already has a real unitPrice and is included in the bill's SSP total like anything else,
// so it must display and behave like a normal line, not an unbilled claim.
const isUnbilledInsuranceLine = (s: ServiceLine) => s.schemePrice != null && amt(s.unitPrice) === 0;

// A line is only payable/invoiceable here once: not voided, not already paid, not an
// unbilled insurance claim (nothing to collect in SSP for those), and not already covered
// by an earlier credit invoice — that one is only payable from the Invoices page, and
// re-selecting it here (or re-invoicing it) would double-collect the same charge.
const isPayableLine = (s: ServiceLine) => !s.paid && !s.isVoided && !isUnbilledInsuranceLine(s) && !s.invoiced;

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    partial: 'bg-amber-50 text-amber-700 border-amber-200',
    pending: 'bg-sky-50 text-sky-700 border-sky-200',
    // Set once a credit invoice is raised against the bill (see /api/invoices) — "active"
    // on its own reads as meaningless, when what it actually means is "invoiced, awaiting
    // payment on the invoice, not on this bill directly".
    active: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  };
  const label = status === 'active' ? 'Invoiced' : (status || 'pending');
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize ${map[status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      {label}
    </span>
  );
};

export default function BillDetails() {
  const { billId } = useParams<{ billId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const facilityInfo = useFacilityInfo();
  const { facilityName, branchName } = facilityInfo;
  const [buildingBillSummary, setBuildingBillSummary] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
  const [otherOutstanding, setOtherOutstanding] = useState<any[]>([]);

  const [itemType, setItemType] = useState<'service' | 'product'>('service');
  const [newItemCatalogId, setNewItemCatalogId] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [priceOverride, setPriceOverride] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'value'>('percent');
  const [discountAmount, setDiscountAmount] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [voidingIndex, setVoidingIndex] = useState<number | null>(null);
  const [itemPopoverOpen, setItemPopoverOpen] = useState(false);
  const [itemSearchQuery, setItemSearchQuery] = useState('');

  const [hasActiveShift, setHasActiveShift] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash', date: toLocalDateStr(new Date()), reference: '', notes: '', paymentTerms: '30', schemeId: '' });
  const [paying, setPaying] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [receiptData, setReceiptData] = useState<{ bill: any; payment: any } | null>(null);
  const [invoiceData, setInvoiceData] = useState<any | null>(null);
  const [schemes, setSchemes] = useState<any[]>([]);
  const [patientSchemes, setPatientSchemes] = useState<any[]>([]);
  const [schemeServicePricing, setSchemeServicePricing] = useState<any[]>([]);
  const [schemeCurrencyCode, setSchemeCurrencyCode] = useState<string | null>(null);
  const [creatingInsuranceInvoice, setCreatingInsuranceInvoice] = useState(false);
  const [insuranceInvoiced, setInsuranceInvoiced] = useState(false);
  const [depositBalance, setDepositBalance] = useState<{ balance: number; currency: string } | null>(null);

  useEffect(() => {
    if (billId) {
      fetchBill();
      fetchServices();
      fetchInventoryItems();
      fetchShift();
      fetchSchemes();
    }
  }, [billId]);

  // Fires the print dialog the moment a payment succeeds — no "here's your receipt,
  // click Print" confirmation step first. Let the off-screen receipt paint, then print.
  useEffect(() => {
    if (!receiptData) return;
    const t = setTimeout(() => {
      if (receiptRef.current) printThermalReceipt(receiptRef.current);
      setReceiptData(null);
    }, 150);
    return () => clearTimeout(t);
  }, [receiptData]);

  const fetchPatientDepositBalance = async (patientId: string) => {
    try {
      const res = await authFetch(`/api/patient-deposits/${patientId}/balance?clinic_id=${user?.clinic || 1}`, { credentials: 'include' });
      setDepositBalance(res.ok ? await res.json() : null);
    } catch {
      setDepositBalance(null);
    }
  };

  const fetchSchemes = async () => {
    try {
      const res = await authFetch(`/api/schemes/active?clinic_id=${user?.clinic || 1}`, { credentials: 'include' });
      if (res.ok) setSchemes(await res.json());
    } catch (e) {
      console.error('Failed to fetch schemes', e);
    }
  };

  // Needed to create the insurance claim invoice — this bill itself was auto-billed at
  // prescription time with no scheme_id of its own, so the scheme link only exists on the
  // patient's membership record, not on the bill.
  const fetchPatientSchemes = async (patientId: string) => {
    try {
      const res = await authFetch(`/api/schemes/membership/patient/${patientId}`, { credentials: 'include' });
      const memberships = res.ok ? await res.json() : [];
      setPatientSchemes(memberships);
      // Lets "Add Service" offer this patient's insurance price for a service instead of
      // only the cash price — same treatment already applied to drugs from Dispensing.
      if (memberships.length > 0 && memberships[0].scheme_id) {
        const [pricingRes, schemeRes] = await Promise.all([
          authFetch(`/api/schemes/${memberships[0].scheme_id}/service-pricing`, { credentials: 'include' }),
          authFetch(`/api/schemes/${memberships[0].scheme_id}`, { credentials: 'include' }),
        ]);
        setSchemeServicePricing(pricingRes.ok ? await pricingRes.json() : []);
        // The scheme's own currency field is the reliable one — scheme_service_pricing.
        // scheme_currency defaults to the base currency whenever it isn't explicitly set,
        // same gap found on the drug side, so it can't be trusted on its own.
        setSchemeCurrencyCode(schemeRes.ok ? (await schemeRes.json())?.currency || null : null);
      } else {
        setSchemeServicePricing([]);
        setSchemeCurrencyCode(null);
      }
    } catch (e) {
      console.error('Failed to fetch patient schemes', e);
      setPatientSchemes([]);
      setSchemeServicePricing([]);
      setSchemeCurrencyCode(null);
    }
  };

  // silent skips the full-page spinner (see the `if (loading || !bill)` early return
  // below) — every add/void/payment action on this page used to call fetchBill() the
  // same way the initial page load does, which tore down and re-mounted the ENTIRE
  // page behind a spinner just to reflect one new line item. Only the very first load
  // (no bill in state yet to render around) actually needs that.
  const fetchBill = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await authFetch(`/api/patient-bills/${billId}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (!Array.isArray(data.services)) data.services = [];
        setBill(data);
        const payable = data.services.filter(isPayableLine).reduce((sum: number, s: ServiceLine) => sum + amt(s.totalPrice), 0);
        setPaymentForm(f => ({ ...f, amount: String(payable || '') }));
        fetchReceipts(data.id);
        fetchOtherOutstanding(data);
        fetchPatientSchemes(data.patient_id);
        fetchPatientDepositBalance(data.patient_id);
      } else {
        toast.error('Bill not found');
        navigate('/patients-bill');
      }
    } catch {
      toast.error('Failed to fetch bill');
    } finally {
      setLoading(false);
    }
  };

  const fetchReceipts = async (id: string) => {
    try {
      const res = await authFetch(`/api/patient-bills/${id}/receipts`, { credentials: 'include' });
      if (res.ok) setPaymentHistory(await res.json());
    } catch (e) {
      console.error('Failed to fetch receipts', e);
    }
  };

  // Reuses the same clinic bill list the /patients-bill directory already fetches,
  // filtered client-side — there is no dedicated "outstanding bills by patient" endpoint.
  const fetchOtherOutstanding = async (currentBill: Bill) => {
    try {
      const res = await authFetch(`/api/patient-bills/clinic/${currentBill.clinic_id}`, { credentials: 'include' });
      if (res.ok) {
        const all = await res.json();
        setOtherOutstanding(all.filter((b: any) =>
          b.id !== currentBill.id && b.patient_id === currentBill.patient_id && b.status !== 'paid'
        ));
      }
    } catch (e) {
      console.error('Failed to fetch other outstanding bills', e);
    }
  };

  const fetchServices = async () => {
    try {
      const res = await authFetch('/api/services', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setServices((Array.isArray(data) ? data : []).filter((s: any) => s.isActive !== false && s.is_active !== false));
      }
    } catch (e) {
      console.error('Failed to fetch services', e);
    }
  };

  const fetchInventoryItems = async () => {
    try {
      const res = await authFetch(`/api/inventory/items?clinic_id=${user?.clinic || 1}&is_active=true`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setInventoryItems(Array.isArray(data) ? data : (data.items || []));
      }
    } catch (e) {
      console.error('Failed to fetch inventory items', e);
    }
  };

  const fetchShift = async () => {
    try {
      const res = await authFetch('/api/cashier/current-shift', { credentials: 'include' });
      setHasActiveShift(res.ok);
    } catch {
      setHasActiveShift(false);
    }
  };

  const handleAddItem = async () => {
    if (addingItem) return;
    if (!bill || !newItemCatalogId) { toast.error(`Select a ${itemType}`); return; }
    const qty = parseInt(newItemQty, 10) || 1;
    if (qty <= 0) { toast.error('Quantity must be greater than zero'); return; }

    // Discount is applied to the cash (SSP) unit price only, before quantity is multiplied
    // in — never to a separately-tracked insurance scheme price, which is negotiated
    // independently and isn't something this discount control is meant to touch.
    const discountNum = parseFloat(discountAmount) || 0;
    const applyDiscount = (price: number) => {
      if (discountNum <= 0) return price;
      const discounted = discountType === 'percent' ? price * (1 - discountNum / 100) : price - discountNum;
      return Math.max(0, discounted);
    };

    // The Price field auto-fills from the catalog on selection but can be overridden by
    // hand before adding — that edited value (not the raw catalog price) is what the
    // discount is applied to and what actually gets billed, for both products and services.
    let lineItem: any;
    if (itemType === 'product') {
      const product = inventoryItems.find((p: any) => p.id === newItemCatalogId);
      if (!product) return;
      // Products/drugs added here have no scheme-pricing lookup wired up yet (unlike
      // services below) — always billed at the item's own selling price. Insurance pricing
      // for drugs is handled through the Dispensing workflow, not this page.
      const basePrice = priceOverride !== '' ? (parseFloat(priceOverride) || 0) : amt(product.selling_price);
      const unitPrice = applyDiscount(basePrice);
      lineItem = {
        serviceId: product.id, serviceName: product.item_name, quantity: qty,
        unitPrice, totalPrice: unitPrice * qty,
      };
    } else {
      const service = services.find(s => s.id === newItemCatalogId);
      if (!service) return;
      const schemePricing = patientSchemes.length > 0 ? schemeServicePricing.find((p: any) => p.service_id === service.id) : null;
      const basePrice = priceOverride !== '' ? (parseFloat(priceOverride) || 0) : amt(service.price);
      const finalUnitPrice = applyDiscount(basePrice);
      // This bill already has a scheme locked in (it was created/auto-billed under one) —
      // add-services re-prices from bill.scheme_id automatically server-side (real exchange
      // rate, folded into the bill's one SSP total), so just pass the real serviceId and let
      // it do that; don't zero/stash here too, or the stale fields end up looking like a
      // separate, unbilled insurance line even though it's actually already included and owed.
      lineItem = bill.scheme_id
        ? { serviceId: service.id, serviceName: service.service_name || service.name, quantity: qty, unitPrice: finalUnitPrice, totalPrice: finalUnitPrice * qty }
        // No scheme on this bill (it was auto-billed as cash before scheme-awareness existed,
        // and a bill's mode can't change after creation) — bill this line at 0 in SSP instead
        // and stash the real insurance price/currency for the Insurance Claim card, matching
        // the same treatment prescriptions get from Dispensing.
        : schemePricing
        ? { serviceName: service.service_name || service.name, quantity: qty, unitPrice: 0, totalPrice: 0, schemePrice: parseFloat(schemePricing.scheme_price) || 0, schemeCurrency: schemeCurrencyCode }
        : { serviceName: service.service_name || service.name, quantity: qty, unitPrice: finalUnitPrice, totalPrice: finalUnitPrice * qty };
    }

    // Recorded purely for display in the Bill Items table — when this line was added, and
    // what discount (if any) was applied to it.
    lineItem.addedAt = new Date().toISOString();
    lineItem.discountLabel = discountNum > 0 ? (discountType === 'percent' ? `${discountNum}%` : amt(discountNum).toFixed(2)) : null;

    setAddingItem(true);
    try {
      const res = await authFetch(`/api/patient-bills/${bill.id}/add-services`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ services: [lineItem] }),
      });
      if (res.ok) {
        toast.success(`${itemType === 'product' ? 'Product' : 'Service'} added to bill`);
        setNewItemCatalogId('');
        setNewItemQty('1');
        setPriceOverride('');
        setDiscountAmount('');
        fetchBill(true);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to add service');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setAddingItem(false);
    }
  };

  const handleVoidItem = async (index: number) => {
    if (voidingIndex !== null) return;
    if (!bill) return;
    if (!confirm('Void this line item? It will be removed from the bill total.')) return;
    setVoidingIndex(index);
    try {
      const res = await authFetch(`/api/patient-bills/${bill.id}/void-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ serviceIndex: index }),
      });
      if (res.ok) {
        toast.success('Item voided/removed');
        setSelectedItems(new Set()); // Clear selection because indexes may have shifted
        fetchBill(true);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to void item');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setVoidingIndex(null);
    }
  };

  // Toggling an unpaid item selects it for payment and keeps the amount field in sync
  // with the sum of what's selected, so staff can pay for just one or two items at a time.
  const toggleItemSelection = (index: number) => {
    if (!bill) return;
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);

      const payableBalance = bill.services.filter(isPayableLine).reduce((sum, s) => sum + amt(s.totalPrice), 0);
      const selectedTotal = bill.services.reduce((sum, s, i) => next.has(i) ? sum + amt(s.totalPrice) : sum, 0);
      const cappedTotal = Math.min(selectedTotal, payableBalance);
      setPaymentForm(f => ({ ...f, amount: next.size > 0 ? String(cappedTotal) : String(payableBalance) }));
      return next;
    });
  };

  // Same selectability rule the per-row checkboxes use — unpaid, not voided, not an unbilled
  // insurance line (nothing to collect in SSP for those), and not already covered by an
  // earlier credit invoice (payable only from the Invoices page from here on).
  const selectableIndexes = (bill?.services || [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => isPayableLine(s))
    .map(({ i }) => i);
  const allSelected = selectableIndexes.length > 0 && selectableIndexes.every(i => selectedItems.has(i));

  const toggleSelectAll = () => {
    if (!bill) return;
    setSelectedItems(prev => {
      const next = allSelected ? new Set<number>() : new Set(selectableIndexes);
      const payableBalance = bill.services.filter(isPayableLine).reduce((sum, s) => sum + amt(s.totalPrice), 0);
      const selectedTotal = bill.services.reduce((sum, s, i) => next.has(i) ? sum + amt(s.totalPrice) : sum, 0);
      const cappedTotal = Math.min(selectedTotal, payableBalance);
      setPaymentForm(f => ({ ...f, amount: next.size > 0 ? String(cappedTotal) : String(payableBalance) }));
      return next;
    });
  };

  // Credit doesn't collect money now — it defers the balance to an invoice with payment
  // terms, billable/collectable later from /invoices, instead of producing a receipt.
  // If a scheme was picked, link the patient to it first (best-effort — a failed link
  // never blocks the invoice itself) so the invoice carries scheme_id/scheme_name.
  const handleCreateInvoice = async () => {
    if (paying) return;
    if (!bill) return;
    // Only the not-yet-invoiced/paid/voided/insurance lines are eligible — anything already
    // covered by an earlier invoice must not be sent again, or it gets double-invoiced.
    const invoiceableServices = bill.services.filter(isPayableLine);
    const invoiceableAmount = invoiceableServices.reduce((sum, s) => sum + amt(s.totalPrice), 0);
    if (invoiceableAmount <= 0) { toast.error('Everything on this bill is already invoiced or paid — nothing left to invoice.'); return; }
    const amount = parseFloat(paymentForm.amount);
    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid invoice amount'); return; }
    if (amount > invoiceableAmount + 0.01) { toast.error('Invoice amount cannot exceed the not-yet-invoiced balance'); return; }

    setPaying(true);
    try {
      let schemeName: string | null = null;
      if (paymentForm.schemeId) {
        const scheme = schemes.find(s => s.id === paymentForm.schemeId);
        schemeName = scheme?.scheme_name || null;
        try {
          await authFetch(`/api/schemes/patient-schemes/${bill.patient_id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ scheme_id: paymentForm.schemeId, clinic_id: bill.clinic_id }),
          });
        } catch (e) {
          console.error('Failed to link patient to scheme (invoice still proceeds)', e);
        }
      }

      const notes = paymentForm.reference
        ? `${paymentForm.notes ? paymentForm.notes + ' — ' : ''}Ref: ${paymentForm.reference}`
        : paymentForm.notes;

      const res = await authFetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bill_id: bill.id, patient_id: bill.patient_id, patient_name: bill.patient_name,
          clinic_id: bill.clinic_id, amount, currency: bill.bill_currency || 'SSP', payment_terms: parseInt(paymentForm.paymentTerms) || 30,
          notes, services: invoiceableServices,
          scheme_id: paymentForm.schemeId || bill.scheme_id || null, scheme_name: schemeName || bill.scheme_name,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(`Invoice ${result.data.invoice_number} created`);
        setInvoiceData({ ...result.data, patient_name: bill.patient_name, bill_number: bill.bill_number, currency: bill.bill_currency || 'SSP' });
        setPaymentForm({ amount: '', method: 'cash', date: toLocalDateStr(new Date()), reference: '', notes: '', paymentTerms: '30', schemeId: '' });
        fetchBill(true);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create invoice');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setPaying(false);
    }
  };

  // Creates the actual claim record for this bill's insurance-priced items — they're billed
  // at 0 SSP here (the patient owes nothing for them), so there's nothing for the normal
  // Record Payment panel to collect; this is the separate, scheme-currency invoice that
  // makes the claim collectible from the Invoices page.
  const handleCreateInsuranceInvoice = async () => {
    if (!bill || creatingInsuranceInvoice || insuranceInvoiced) return;
    if (patientSchemes.length === 0) { toast.error('This patient has no active insurance membership'); return; }
    const insuranceLines = bill.services.filter(s => isUnbilledInsuranceLine(s) && !s.isVoided);
    if (insuranceLines.length === 0) { toast.error('No insurance-priced items on this bill'); return; }

    const scheme = patientSchemes[0];
    const services = insuranceLines.map(s => ({
      serviceName: s.serviceName, quantity: s.quantity, unitPrice: s.schemePrice,
      totalPrice: parseFloat(((s.schemePrice || 0) * s.quantity).toFixed(2)), currency: s.schemeCurrency,
    }));
    const amount = services.reduce((sum, s) => sum + s.totalPrice, 0);
    const invoiceCurrency = insuranceLines[0].schemeCurrency;

    setCreatingInsuranceInvoice(true);
    try {
      const res = await authFetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patient_id: bill.patient_id, patient_name: bill.patient_name,
          clinic_id: bill.clinic_id, amount, currency: invoiceCurrency,
          payment_terms: 30, notes: `Insurance claim — ${scheme.scheme_name} (${bill.bill_number})`,
          services, scheme_id: scheme.scheme_id, scheme_name: scheme.scheme_name,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(`Insurance invoice ${result.data.invoice_number} created (${invoiceCurrency} ${amount.toFixed(2)})`);
        setInvoiceData({ ...result.data, patient_name: bill.patient_name, scheme_name: scheme.scheme_name, currency: invoiceCurrency });
        setInsuranceInvoiced(true);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create insurance invoice');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setCreatingInsuranceInvoice(false);
    }
  };

  const handleSavePayment = async () => {
    if (paying) return;
    if (!bill) return;
    if (paymentForm.method === 'credit') { handleCreateInvoice(); return; }
    // Whatever's already invoiced or paid isn't payable here again — collect an invoiced
    // amount from the Invoices page instead, never by paying the same line twice.
    const payableBalance = bill.services.filter(isPayableLine).reduce((sum, s) => sum + amt(s.totalPrice), 0);
    if (payableBalance <= 0) { toast.error('Nothing left to collect directly — the remaining balance is already invoiced. Collect it from the Invoices page.'); return; }
    const amount = parseFloat(paymentForm.amount);
    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid payment amount'); return; }
    if (amount > payableBalance + 0.01) { toast.error('Payment cannot exceed the not-yet-invoiced balance due'); return; }

    setPaying(true);
    try {
      const notes = paymentForm.reference
        ? `${paymentForm.notes ? paymentForm.notes + ' — ' : ''}Ref: ${paymentForm.reference}`
        : paymentForm.notes;

      // Nothing checked but the amount covers the whole payable balance — that's still an
      // unambiguous "pay everything payable" instruction, so attribute it to every payable
      // line (same as if they'd checked every box) instead of leaving it unitemized.
      const isFullPayment = amount >= payableBalance - 0.01;
      // Checking a box used to mean "mark this whole line paid" no matter what amount was
      // actually entered — paying 20,000 of a 520,000 bed charge line still flipped its
      // status to Paid outright. Only attribute paidServiceIndexes when the amount actually
      // covers everything checked; a shortfall against exactly one selected line instead
      // splits that one line into a paid portion + a still-open remainder (partialLineSplit)
      // so the table keeps showing what's actually left to collect. A shortfall against
      // more than one selected line has no unambiguous way to divide it, so that's rejected
      // client-side rather than guessed at.
      const selectedTotal = bill.services.reduce((sum, s, i) => selectedItems.has(i) ? sum + amt(s.totalPrice) : sum, 0);
      let paidServiceIndexes: number[] | undefined;
      let partialLineSplit: { index: number; paidAmount: number } | undefined;
      if (selectedItems.size > 0) {
        if (amount >= selectedTotal - 0.01) {
          paidServiceIndexes = Array.from(selectedItems);
        } else if (selectedItems.size === 1) {
          partialLineSplit = { index: Array.from(selectedItems)[0], paidAmount: amount };
        } else {
          toast.error('This amount doesn\'t cover everything selected. Select just the one item you\'re partially paying, or enter the full amount for everything checked.');
          setPaying(false);
          return;
        }
      } else if (isFullPayment) {
        paidServiceIndexes = bill.services.reduce((acc: number[], s, i) => { if (isPayableLine(s)) acc.push(i); return acc; }, []);
      }

      const res = await authFetch(`/api/patient-bills/${bill.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount, payment_method: paymentForm.method, payment_date: paymentForm.date,
          notes, cashierName: user?.displayName, cashierId: user?.uid,
          paidServiceIndexes, partialLineSplit,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success('Payment recorded');
        // The receipt must list only what THIS payment actually covered, not every line on
        // the bill — bill.services includes items paid on earlier receipts (and still-unpaid
        // ones). The backend already computed the right subset (service_details, built from
        // paidServiceIndexes) whenever specific items were attributed above; a genuinely
        // unattributed partial payment (no items checked, amount short of the full payable
        // balance) can't honestly be tied to particular services, so it prints as a plain
        // "Payment on Account" line instead of falsely listing services it may not cover.
        const paidThisTime = result.receipt?.service_details?.length > 0
          ? result.receipt.service_details
          : [{ serviceName: 'Payment on Account', quantity: 1, unitPrice: amount, totalPrice: amount }];
        setReceiptData({
          bill: {
            id: bill.id, billNumber: bill.bill_number, patientName: bill.patient_name, patientId: bill.patient_id,
            totalAmount: amt(bill.total_amount), paidAmount: amt(bill.paid_amount) + amount,
            balanceAmount: amt(bill.balance_amount) - amount, billDate: bill.bill_date, services: paidThisTime,
          },
          payment: { amount, method: paymentForm.method, date: paymentForm.date, notes, from_lease: false, cashierName: user?.displayName },
        });
        setPaymentForm({ amount: '', method: 'cash', date: toLocalDateStr(new Date()), reference: '', notes: '', paymentTerms: '30', schemeId: '' });
        setSelectedItems(new Set());
        fetchBill(true);
      } else {
        const err = await res.json();
        if (err.requiresShift) {
          toast.error('No active cashier shift — please start a shift before recording payments');
          fetchShift();
        } else {
          toast.error(err.error || 'Failed to save payment');
        }
      }
    } catch {
      toast.error('Network error');
    } finally {
      setPaying(false);
    }
  };

  // Full bill summary using the shared branded document template (same one Proforma
  // Invoices, LIS reports, etc. all use) — not the separate, unbranded server-side
  // PDFGenerator the old "PDF" button called.
  const buildBillSummaryHTML = async () => {
    if (!bill) return '';
    const signature = await docTemplate.fetchUserSignature(user?.uid);
    const svcs = bill.services || [];

    const statusLabel = (s: ServiceLine) => {
      if (s.isVoided) return 'Voided';
      if (isUnbilledInsuranceLine(s)) return 'Insurance';
      if (s.paid) return 'Paid';
      if (s.invoiced) return 'Invoiced';
      return 'Unpaid';
    };

    const serviceRows: docTemplate.TableRow[] = svcs.map((s, i) => ({
      cells: [
        i + 1,
        s.serviceName,
        s.quantity,
        isUnbilledInsuranceLine(s) ? `${s.schemeCurrency} ${amt(s.schemePrice).toFixed(2)}` : `${s.currency || bill.bill_currency || 'SSP'} ${amt(s.unitPrice).toFixed(2)}`,
        isUnbilledInsuranceLine(s) ? `${s.schemeCurrency} ${(amt(s.schemePrice) * s.quantity).toFixed(2)}` : `${s.currency || bill.bill_currency || 'SSP'} ${amt(s.totalPrice).toFixed(2)}`,
        statusLabel(s),
      ],
      isSubRow: s.isVoided,
    }));

    const paymentRows: docTemplate.TableRow[] = paymentHistory.map(p => ({
      cells: [p.receipt_number, new Date(p.payment_date).toLocaleDateString(), p.payment_method, `${bill.bill_currency || 'SSP'} ${amt(p.payment_amount).toFixed(2)}`],
    }));

    const bodyHTML = [
      docTemplate.buildInfoGrid(
        { title: 'Bill Details', rows: [
          { label: 'Bill No.', value: bill.bill_number, bold: true },
          { label: 'Bill Date', value: docTemplate.formatDate(bill.bill_date) },
          { label: 'Status', value: bill.status === 'active' ? 'Invoiced' : bill.status, bold: true },
          { label: 'Currency', value: bill.bill_currency || 'SSP' },
          ...(bill.scheme_name ? [{ label: 'Scheme', value: bill.scheme_name }] : []),
        ]},
        { title: 'Patient', rows: [
          { label: 'Name', value: bill.patient_name, bold: true },
          { label: 'Patient ID', value: bill.patient_id },
        ]}
      ),
      `<div class="ic-section-title">Services &amp; Products</div>`,
      docTemplate.buildTable(
        [
          { label: '#', align: 'center', width: '32px' },
          { label: 'Service / Product' },
          { label: 'Qty', align: 'center' },
          { label: 'Unit Price', align: 'right' },
          { label: 'Amount', align: 'right' },
          { label: 'Status', align: 'center' },
        ],
        serviceRows,
      ),
      docTemplate.buildSummary([
        { label: 'Total', value: `${bill.bill_currency || 'SSP'} ${amt(bill.total_amount).toFixed(2)}` },
        { label: 'Paid', value: `${bill.bill_currency || 'SSP'} ${amt(bill.paid_amount).toFixed(2)}` },
        { label: 'Balance Due', value: `${bill.bill_currency || 'SSP'} ${amt(bill.balance_amount).toFixed(2)}`, isTotal: true },
      ]),
      paymentRows.length > 0 ? [
        `<div class="ic-section-title">Payment History</div>`,
        docTemplate.buildTable(
          [
            { label: 'Receipt #' },
            { label: 'Date' },
            { label: 'Method', align: 'center' },
            { label: 'Amount', align: 'right' },
          ],
          paymentRows,
        ),
      ].join('\n') : '',
      docTemplate.buildNotes(bill.notes),
      docTemplate.buildSignatures([
        { label: 'Prepared By', name: user?.displayName || '', signature: signature || undefined },
      ]),
    ].join('\n');

    return docTemplate.buildDocument({
      title: `Bill Summary - ${bill.bill_number}`,
      docType: 'Bill Summary',
      docNumber: bill.bill_number,
      status: bill.status === 'active' ? 'Invoiced' : bill.status,
      date: bill.bill_date,
      bodyHTML,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });
  };

  const handlePrintBillSummary = async () => {
    if (buildingBillSummary) return;
    setBuildingBillSummary(true);
    try {
      const html = await buildBillSummaryHTML();
      const pw = docTemplate.openPrintWindow(html);
      if (!pw) toast.error('Please allow popups to print the bill summary');
    } catch {
      toast.error('Failed to build bill summary');
    } finally {
      setBuildingBillSummary(false);
    }
  };

  if (loading || !bill) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  const visibleServices = (bill.services || []);
  // What's actually still collectible directly on this bill — excludes anything already
  // paid, voided, an unbilled insurance claim, or already covered by an earlier invoice.
  const payableBalance = visibleServices.filter(isPayableLine).reduce((sum, s) => sum + amt(s.totalPrice), 0);
  const invoicedPendingCount = visibleServices.filter(s => s.invoiced && !s.paid && !s.isVoided).length;

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="w-full flex flex-col">
        <PageHeader
          title={bill.bill_number}
          subtitle={bill.patient_name}
          icon={<DollarSign />}
          className="mb-3"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/patients-bill')}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <Button variant="outline" onClick={() => navigate('/lis/registration')}>
                <UserPlus className="w-4 h-4 mr-2" /> New Patient
              </Button>
              <Button variant="outline" onClick={handlePrintBillSummary} disabled={buildingBillSummary}>
                {buildingBillSummary ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />} Bill Summary
              </Button>
            </div>
          }
        />

        {/* Summary strip */}
        <div className="bg-card rounded-lg border shadow-sm p-4 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <div className="mt-1">{statusBadge(bill.status)}</div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bill Date</p>
            <p className="text-sm font-medium">{new Date(bill.bill_date).toLocaleDateString()}</p>
          </div>
          {depositBalance && depositBalance.balance > 0 && (
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="w-3 h-3" /> Deposit Balance</p>
              <p className="text-sm font-medium text-primary">{depositBalance.currency} {depositBalance.balance.toFixed(2)}</p>
            </div>
          )}
          <div className="ml-auto grid grid-cols-3 gap-6 text-right">
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-bold">{bill.bill_currency || 'SSP'} {amt(bill.total_amount).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="text-lg font-bold text-emerald-600">{bill.bill_currency || 'SSP'} {amt(bill.paid_amount).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Balance</p>
              <p className={`text-lg font-bold ${amt(bill.balance_amount) <= 0 ? 'text-emerald-600' : payableBalance > 0 ? 'text-red-600' : 'text-indigo-600'}`}>{bill.bill_currency || 'SSP'} {amt(bill.balance_amount).toFixed(2)}</p>
              {amt(bill.balance_amount) > 0 && payableBalance <= 0 && (
                <p className="text-[11px] text-indigo-600 mt-0.5">awaiting invoice payment</p>
              )}
            </div>
          </div>
        </div>

        {bill.scheme_name && (
          <div className="mt-4 p-3 rounded-lg border border-sky-200 bg-sky-50 flex items-center gap-2 text-sm text-sky-800">
            <Shield className="w-4 h-4" /> Billed under scheme: <span className="font-medium">{bill.scheme_name}</span>
          </div>
        )}

        {invoicedPendingCount > 0 && (
          <div className="mt-4 p-3 rounded-lg border border-indigo-200 bg-indigo-50 flex items-center gap-2 text-sm text-indigo-800">
            <FileText className="w-4 h-4" /> {invoicedPendingCount} item{invoicedPendingCount > 1 ? 's' : ''} already invoiced — collect payment from the Invoices page, not here.
          </div>
        )}

        {otherOutstanding.length > 0 && (
          <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4" />
            This patient has {otherOutstanding.length} other outstanding bill{otherOutstanding.length > 1 ? 's' : ''}.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
          <div className="md:col-span-2">
          {/* Add Service / Product */}
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <h3 className="font-medium mb-4 text-lg border-b pb-2">Add Service / Product</h3>
            {patientSchemes.length > 0 && itemType === 'service' && (
              <p className="text-[11px] text-sky-700 mb-2">
                Only services priced under this patient's insurance ({patientSchemes[0].scheme_name}) are shown.
              </p>
            )}
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => { setItemType('service'); setNewItemCatalogId(''); setItemSearchQuery(''); setPriceOverride(''); }}
                className={cn('h-8 px-3 rounded-md border text-xs font-medium transition-colors', itemType === 'service' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-input hover:bg-muted/50')}
              >
                Service
              </button>
              <button
                type="button"
                onClick={() => { setItemType('product'); setNewItemCatalogId(''); setItemSearchQuery(''); setPriceOverride(''); }}
                className={cn('h-8 px-3 rounded-md border text-xs font-medium transition-colors', itemType === 'product' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-input hover:bg-muted/50')}
              >
                Product
              </button>
            </div>
            {(() => {
              const catalog: any[] = itemType === 'service'
                ? (patientSchemes.length > 0 ? services.filter((s: any) => schemeServicePricing.some((p: any) => p.service_id === s.id)) : services)
                : inventoryItems;
              const options = catalog
                .map((c: any) => {
                  if (itemType === 'product') {
                    return { id: c.id, name: c.item_name, priceLabel: `${amt(c.selling_price).toFixed(2)}${c.unit_of_measure ? ` / ${c.unit_of_measure}` : ''}` };
                  }
                  const schemePricing = schemeServicePricing.find((p: any) => p.service_id === c.id);
                  const priceLabel = patientSchemes.length > 0 && schemePricing
                    ? `${schemeCurrencyCode} ${parseFloat(schemePricing.scheme_price).toFixed(2)} (insurance)`
                    : amt(c.price).toFixed(2);
                  return { id: c.id, name: c.service_name || c.name, priceLabel };
                })
                .filter(o => !itemSearchQuery || o.name.toLowerCase().includes(itemSearchQuery.toLowerCase()));
              const selected = options.find(o => o.id === newItemCatalogId);
              const selectedRaw = itemType === 'product'
                ? inventoryItems.find((p: any) => p.id === newItemCatalogId)
                : services.find((s: any) => s.id === newItemCatalogId);
              const catalogPrice = selectedRaw ? amt(itemType === 'product' ? selectedRaw.selling_price : selectedRaw.price) : 0;
              const basePrice = priceOverride !== '' ? (parseFloat(priceOverride) || 0) : catalogPrice;
              const discountNum = parseFloat(discountAmount) || 0;
              const discountedPrice = discountNum > 0
                ? Math.max(0, discountType === 'percent' ? basePrice * (1 - discountNum / 100) : basePrice - discountNum)
                : basePrice;
              const previewQty = parseInt(newItemQty, 10) || 0;
              const lineTotal = discountedPrice * previewQty;
              return (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Add {itemType === 'product' ? 'Product' : 'Service'}</label>
                    <Popover open={itemPopoverOpen} onOpenChange={setItemPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal h-9 mt-1 px-3">
                          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
                            {selected ? selected.name : `Search ${itemType === 'product' ? 'products' : 'services'}...`}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput placeholder={`Search ${itemType === 'product' ? 'products' : 'services'}...`} value={itemSearchQuery} onValueChange={setItemSearchQuery} />
                          <CommandList className="max-h-64">
                            <CommandEmpty>No matching {itemType === 'product' ? 'products' : 'services'}.</CommandEmpty>
                            <CommandGroup>
                              {options.map(o => (
                                <CommandItem
                                  key={o.id}
                                  value={o.name}
                                  onSelect={() => {
                                    setNewItemCatalogId(o.id);
                                    setItemPopoverOpen(false);
                                    if (itemType === 'product') {
                                      const prod = inventoryItems.find((p: any) => p.id === o.id);
                                      setPriceOverride(prod ? amt(prod.selling_price).toFixed(2) : '');
                                    } else {
                                      const svc = services.find((s: any) => s.id === o.id);
                                      setPriceOverride(svc ? amt(svc.price).toFixed(2) : '');
                                    }
                                  }}
                                >
                                  <Check className={cn('mr-2 h-4 w-4 shrink-0', o.id === newItemCatalogId ? 'opacity-100' : 'opacity-0')} />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate">{o.name}</div>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-lg border p-3 bg-muted/20 space-y-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quantity</p>
                      <div className={cn('grid gap-2', itemType === 'product' ? 'grid-cols-3' : 'grid-cols-1')}>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Qty</label>
                          <Input type="number" min="1" value={newItemQty} onChange={e => setNewItemQty(e.target.value)} className="mt-1" />
                        </div>
                        {itemType === 'product' && (
                          <>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">UOM</label>
                              <Input value={selectedRaw?.unit_of_measure || ''} readOnly disabled className="mt-1 bg-muted/40" />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Qty Left</label>
                              <Input value={selectedRaw?.quantity_on_hand ?? ''} readOnly disabled className="mt-1 bg-muted/40" />
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border p-3 bg-muted/20 space-y-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pricing</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Price</label>
                          <Input value={priceOverride} readOnly disabled className="mt-1 bg-muted/40" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Total</label>
                          <Input value={selectedRaw ? amt(lineTotal).toFixed(2) : ''} readOnly disabled className="mt-1 bg-muted/40 font-medium text-foreground" />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Discount</label>
                        <div className="mt-1 flex gap-1">
                          <button
                            type="button"
                            onClick={() => setDiscountType('percent')}
                            title="Percent discount"
                            className={cn('h-9 px-2 rounded-md border text-xs font-medium transition-colors flex-shrink-0', discountType === 'percent' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-input hover:bg-muted/50')}
                          >
                            %
                          </button>
                          <button
                            type="button"
                            onClick={() => setDiscountType('value')}
                            title="Cash discount"
                            className={cn('h-9 px-2 rounded-md border text-xs font-medium transition-colors flex-shrink-0', discountType === 'value' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-input hover:bg-muted/50')}
                          >
                            Cash
                          </button>
                          <Input
                            type="number" min="0" step="0.01"
                            placeholder={discountType === 'percent' ? '10' : '500'}
                            value={discountAmount}
                            onChange={e => setDiscountAmount(e.target.value)}
                            className="flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {itemType === 'service' && patientSchemes.length > 0 && options.length === 0 && !itemSearchQuery && (
                    <p className="text-[11px] text-red-700">No services have an insurance price configured for this scheme yet — add one in Scheme Management first.</p>
                  )}
                  {selectedRaw && discountNum > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Price after discount: <span className="font-medium text-foreground">{amt(discountedPrice).toFixed(2)}</span>
                      {' '}<span className="line-through">{amt(basePrice).toFixed(2)}</span>
                    </p>
                  )}

                  <div className="flex justify-end">
                    <Button onClick={handleAddItem} disabled={addingItem}>
                      {addingItem ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                      Add
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>

          </div>

          {/* Payment */}
          <div className="md:col-span-1 space-y-6">
            {(() => {
              const insuranceLines = bill.services.filter(s => isUnbilledInsuranceLine(s) && !s.isVoided);
              if (insuranceLines.length === 0) return null;
              const schemeCurrency = insuranceLines[0].schemeCurrency;
              const schemeTotal = insuranceLines.reduce((sum, s) => sum + (s.schemePrice || 0) * s.quantity, 0);
              return (
                <div className="bg-card rounded-lg border border-sky-200 shadow-sm p-4">
                  <h3 className="font-medium mb-2 text-lg border-b pb-2 flex items-center gap-2 text-sky-700"><Shield className="w-4 h-4" /> Insurance Claim</h3>
                  <p className="text-xs text-muted-foreground mb-3">These items are billed at 0 in SSP — they're claimed from the insurer separately, in their own currency.</p>
                  <div className="flex justify-between items-center text-sm mb-3">
                    <span className="text-muted-foreground">Scheme Total</span>
                    <span className="font-bold text-sky-700">{schemeCurrency} {schemeTotal.toFixed(2)}</span>
                  </div>
                  <Button
                    className="w-full border-sky-300 text-sky-700 hover:bg-sky-100" variant="outline"
                    onClick={handleCreateInsuranceInvoice}
                    disabled={creatingInsuranceInvoice || insuranceInvoiced || patientSchemes.length === 0}
                  >
                    {creatingInsuranceInvoice ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
                    {insuranceInvoiced ? 'Invoiced' : 'Create Insurance Invoice'}
                  </Button>
                </div>
              );
            })()}

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <h3 className="font-medium mb-4 text-lg border-b pb-2">Record Payment</h3>
              {!hasActiveShift && (
                <div className="mb-3 p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> No active cashier shift — start one before recording payments.
                </div>
              )}
              {selectedItems.size > 0 && (
                <div className="mb-3 p-2.5 rounded-lg border border-primary/20 bg-primary/5 text-xs text-primary flex items-center justify-between gap-2">
                  <span>{selectedItems.size} item{selectedItems.size > 1 ? 's' : ''} selected</span>
                  <button type="button" className="underline hover:no-underline" onClick={() => { setSelectedItems(new Set()); setPaymentForm(f => ({ ...f, amount: String(payableBalance) })); }}>Clear</button>
                </div>
              )}
              <div className="space-y-3">
                {paymentForm.method === 'credit' && (
                  <div className="p-2.5 rounded-lg border border-sky-200 bg-sky-50 text-xs text-sky-800 flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5 flex-shrink-0" /> No money is collected now — this creates an invoice due later, payable from the Invoices page.
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{paymentForm.method === 'credit' ? 'Amount to Invoice' : 'Amount'}</label>
                  <Input
                    type="number" min="0" step="0.01" value={paymentForm.amount}
                    onChange={e => {
                      let v = e.target.value;
                      if (paymentForm.method === 'deposit' && depositBalance) {
                        const capped = Math.min(payableBalance, depositBalance.balance);
                        if (parseFloat(v) > capped) v = String(capped);
                      }
                      setPaymentForm({ ...paymentForm, amount: v });
                    }}
                    className="mt-1"
                  />
                  {paymentForm.method === 'deposit' && depositBalance && amt(paymentForm.amount) < payableBalance - 0.01 && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      Deposit covers {amt(paymentForm.amount).toFixed(2)} of {payableBalance.toFixed(2)} — the remaining {(payableBalance - amt(paymentForm.amount)).toFixed(2)} will need another payment.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Method</label>
                    <Combobox
                      options={[
                        ...PAYMENT_METHODS,
                        ...(depositBalance && depositBalance.balance > 0 && (bill?.bill_currency || 'SSP').trim().toUpperCase() === (depositBalance.currency || '').trim().toUpperCase()
                          ? [{ value: 'deposit', label: 'Offset from Deposit' }]
                          : []),
                      ]}
                      value={paymentForm.method}
                      onChange={method => {
                        let amount = paymentForm.amount;
                        if (method === 'deposit' && depositBalance) {
                          amount = String(Math.min(payableBalance, depositBalance.balance));
                        }
                        setPaymentForm({ ...paymentForm, method, amount });
                      }}
                      searchPlaceholder="Search..."
                      className="w-full h-9 mt-1"
                    />
                  </div>
                  {paymentForm.method === 'credit' ? (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Payment Terms (days)</label>
                      <Input type="number" min="1" value={paymentForm.paymentTerms} onChange={e => setPaymentForm({ ...paymentForm, paymentTerms: e.target.value })} className="mt-1" />
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Date</label>
                      <Input type="date" value={paymentForm.date} onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })} className="mt-1" />
                    </div>
                  )}
                </div>
                {paymentForm.method === 'credit' && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Link to a Scheme (optional)</label>
                    <Combobox
                      options={[{ value: '', label: 'No scheme — plain credit' }, ...schemes.map((s: any) => ({ value: s.id, label: `${s.scheme_name}${s.is_insurance ? ' (Insurance)' : ''}` }))]}
                      value={paymentForm.schemeId}
                      onChange={v => setPaymentForm({ ...paymentForm, schemeId: v })}
                      placeholder="No scheme — plain credit"
                      searchPlaceholder="Search schemes..."
                      className="w-full h-9 mt-1"
                    />
                  </div>
                )}
                {paymentForm.method !== 'cash' && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Reference No.</label>
                    <Input
                      value={paymentForm.reference}
                      onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                      placeholder={paymentForm.method === 'credit' ? 'Account / PO / claim reference' : paymentForm.method === 'check' ? 'Cheque number' : 'Transaction reference'}
                      className="mt-1"
                    />
                  </div>
                )}
                <Button className="w-full" onClick={handleSavePayment} disabled={paying || payableBalance <= 0 || (paymentForm.method !== 'credit' && !hasActiveShift)}>
                  {paying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
                  {paymentForm.method === 'credit'
                    ? (payableBalance <= 0 ? 'Nothing to Invoice' : 'Create Invoice')
                    : (payableBalance > 0 ? 'Save Payment' : amt(bill.balance_amount) <= 0 ? 'Fully Paid' : 'Awaiting Invoice Payment')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Bill Items */}
        <div className="bg-card rounded-lg border shadow-sm p-4 mt-6">
          <h3 className="font-medium mb-4 text-lg border-b pb-2">Bill Items</h3>
          {(() => {
            const unpaidCount = visibleServices.filter(s => !s.paid && !s.isVoided).length;
            return unpaidCount > 0 ? (
              <p className="text-xs text-muted-foreground mb-2">Check items to pay for just those — the payment amount will follow your selection.</p>
            ) : null;
          })()}
          <AdvancedDataTable<ServiceLine>
            data={visibleServices}
            keyExtractor={(s) => bill.services.indexOf(s)}
            emptyMessage="No services on this bill."
            searchable
            searchPlaceholder="Search bill items..."
            exportable
            exportFileName={`bill-${bill.bill_number}-items`}
            pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
            rowClassName={(s) => s.isVoided ? 'bg-red-50/50 text-red-700/70 line-through' : (s.paid ? 'bg-emerald-50/40' : '')}
            toolbarExtra={
              selectableIndexes.length > 0 ? (
                <Button type="button" variant="outline" size="sm" onClick={toggleSelectAll} className="h-9">
                  {allSelected ? 'Deselect All' : 'Select All Payable'}
                </Button>
              ) : undefined
            }
            columns={[
              {
                key: '__select', header: '', width: '2rem',
                render: (_v, s) => {
                  const realIndex = bill.services.indexOf(s);
                  return isPayableLine(s) ? (
                    <input
                      type="checkbox"
                      className="rounded border-input"
                      checked={selectedItems.has(realIndex)}
                      onChange={() => toggleItemSelection(realIndex)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : null;
                },
              },
              {
                key: 'serviceName', header: 'Service', sortable: true,
                render: (v, s) => <span className={s.paid && !s.isVoided ? 'text-muted-foreground' : ''}>{v}</span>,
              },
              { key: 'quantity', header: 'Qty', align: 'right', sortable: true },
              {
                key: 'unitPrice', header: 'Unit Price', align: 'right',
                render: (_v, s) => isUnbilledInsuranceLine(s)
                  ? <span className="font-mono text-sky-700">{s.schemeCurrency} {amt(s.schemePrice).toFixed(2)}</span>
                  : <span className="font-mono">{s.currency || 'SSP'} {amt(s.unitPrice).toFixed(2)}</span>,
              },
              {
                key: 'totalPrice', header: 'Amount', align: 'right',
                render: (_v, s) => isUnbilledInsuranceLine(s)
                  ? <span className="font-mono font-semibold text-sky-700">{s.schemeCurrency} {(amt(s.schemePrice) * s.quantity).toFixed(2)}</span>
                  : <span className="font-mono font-semibold">{s.currency || 'SSP'} {amt(s.totalPrice).toFixed(2)}</span>,
              },
              { key: 'discountLabel', header: 'Discount', align: 'center', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
              {
                key: 'addedAt', header: 'Added', align: 'center',
                render: (v) => <span className="text-muted-foreground whitespace-nowrap">{v ? new Date(v).toLocaleString() : '—'}</span>,
              },
              {
                key: '__status', header: 'Status', align: 'center',
                render: (_v, s) => isUnbilledInsuranceLine(s) ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-sky-50 text-sky-700 border-sky-200" title="Not billed in SSP — claimed from the insurer separately, from the Dispensing screen">
                    <Shield className="w-3 h-3" /> Insurance
                  </span>
                ) : s.isVoided ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-red-50 text-red-700 border-red-200">
                    Voided
                  </span>
                ) : s.paid ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
                    <Check className="w-3 h-3" /> Paid
                  </span>
                ) : s.invoiced ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200" title="Already covered by a credit invoice — collect payment from the Invoices page">
                    <FileText className="w-3 h-3" /> Invoiced
                  </span>
                ) : (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                    Unpaid
                  </span>
                ),
              },
              {
                key: '__actions', header: '', width: '2rem',
                render: (_v, s) => {
                  const realIndex = bill.services.indexOf(s);
                  return !s.paid && !s.isVoided && !s.invoiced ? (
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleVoidItem(realIndex)} disabled={voidingIndex !== null} title="Void item">
                      {voidingIndex === realIndex ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /> : <X className="w-3.5 h-3.5 text-muted-foreground" />}
                    </Button>
                  ) : null;
                },
              },
            ]}
          />
        </div>
      </div>
      </div>

      {/* Payment succeeded — go straight to the print dialog instead of a confirmation
          modal first. Rendered off-screen purely so printThermalReceipt has a DOM node
          (with real content) to read from. */}
      {receiptData && (
        <div className="fixed -left-[9999px] top-0">
          <div ref={receiptRef}>
            <PaymentReceipt bill={receiptData.bill} payment={receiptData.payment} facilityName={facilityName} branchName={branchName} />
          </div>
        </div>
      )}

      {/* Invoice Created Modal (credit payments) */}
      {invoiceData && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-sm rounded-xl shadow-lg border overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" /> Invoice Created
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setInvoiceData(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-y-2">
                <span className="text-muted-foreground">Invoice No.</span>
                <span className="text-right font-mono text-primary">{invoiceData.invoice_number}</span>
                <span className="text-muted-foreground">Patient</span>
                <span className="text-right">{invoiceData.patient_name}</span>
                {invoiceData.bill_number && <><span className="text-muted-foreground">Bill No.</span><span className="text-right font-mono">{invoiceData.bill_number}</span></>}
                {invoiceData.scheme_name && <><span className="text-muted-foreground">Scheme</span><span className="text-right">{invoiceData.scheme_name}</span></>}
                <span className="text-muted-foreground">Amount Due</span>
                <span className="text-right font-bold">{invoiceData.currency ? `${invoiceData.currency} ` : ''}{parseFloat(invoiceData.balance_due).toFixed(2)}</span>
                <span className="text-muted-foreground">Due Date</span>
                <span className="text-right">{new Date(invoiceData.due_date).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setInvoiceData(null)}>Close</Button>
              <Button onClick={() => navigate('/invoices')}>View Invoices</Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
