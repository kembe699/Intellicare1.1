import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { useCurrency } from '@/contexts/CurrencyContext';
import { authFetch } from '@/api/apiClient';
import { fetchPatientDirectory } from '@/lib/patientDirectory';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState} from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/notify';
import {
  Pill, Search, Check, Loader2, ClipboardList, History, Calendar, RefreshCw, AlertTriangle, Plus, X,
  CreditCard, Printer, Pencil, Shield, FileText, User, Stethoscope, PackageX, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PaymentReceipt, printThermalReceipt, printReceiptWhenPainted } from '@/components/receipts/PaymentReceipt';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { doseUnitLabel, packEquivalent } from '@/lib/prescriptionFrequency';
import { formatDate } from '@/lib/format';

const API = '/api/pharmacy-module';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'check', label: 'Cheque' },
  { value: 'credit', label: 'Credit (Invoice)' },
];

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
];

function parseServices(raw: any): any[] {
  if (!raw) return [];
  let s = raw;
  try {
    if (typeof s === 'string') s = JSON.parse(s);
    if (typeof s === 'string') s = JSON.parse(s);
  } catch {
    return [];
  }
  return Array.isArray(s) ? s : [];
}

// A line is billed at 0 in SSP with its real price only stashed for a separate insurance
// claim — same convention as BillDetails.tsx. Never counts as something to (re-)invoice or
// pay directly here; it has nothing collectible on this bill yet.
const isUnbilledInsuranceLine = (s: any) => s.schemePrice != null && (parseFloat(s.unitPrice) || 0) === 0;
// Payable/invoiceable here once: not voided, not paid, not an unbilled insurance stash, and
// not already covered by an earlier credit invoice (that's only payable from /invoices now).
const isPayableLine = (s: any) => !s.paid && !s.isVoided && !isUnbilledInsuranceLine(s) && !s.invoiced;

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export default function DispensingWorkflow() {
  const { user } = useAuth();
  const { facilityName, branchName } = useFacilityInfo();
  const { fmt, fmtDual, currency } = useCurrency();
  const location = useLocation();
  const navigate = useNavigate();
  const clinicId = user?.clinic || 1;

  const [activeMode, setActiveMode] = useState<'dispense' | 'history'>('dispense');

  // Dispense mode
  const [pendingRx, setPendingRx] = useState<any[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [selectedRx, setSelectedRx] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [checkedLines, setCheckedLines] = useState<Record<string, boolean>>({});
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [dispensing, setDispensing] = useState(false);
  const [activeBill, setActiveBill] = useState<any | null>(null);
  const billBalance = activeBill ? parseFloat(activeBill.balance_amount) || 0 : 0;
  // Shown in both the Record Payment card and the Bill Items table — the bill total once
  // one exists, else a running total straight off the not-yet-billed prescription lines.
  const orderTotal = activeBill
    ? parseFloat(activeBill.total_amount) || 0
    : (selectedRx?.lines || []).filter((l: any) => l.status !== 'cancelled').reduce((sum: number, l: any) => sum + (parseFloat(l.selling_price) || 0) * (l.quantity_prescribed || 0), 0);
  // What's actually still collectible directly on this bill right now — excludes anything
  // already paid, voided, an unbilled insurance claim, or already covered by an earlier
  // invoice (that remainder is only payable/invoiceable from the Invoices page from here on).
  const payableBillBalance = activeBill
    ? parseServices(activeBill.services).filter(isPayableLine).reduce((sum: number, s: any) => sum + (parseFloat(s.totalPrice) || 0), 0)
    : 0;
  const [checkingBill, setCheckingBill] = useState(false);

  // Add/remove items on the selected prescription before it's dispensed
  const [addLineDrugId, setAddLineDrugId] = useState('');
  const [addLineQty, setAddLineQty] = useState('1');
  const [addingLine, setAddingLine] = useState(false);
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');
  const [savingLineQty, setSavingLineQty] = useState(false);
  // Tracks which Cart row's quantity is currently being changed via the +/- stepper or
  // typed directly — separate from editingLineId/editQty above (the Bill Items table's
  // own pencil-to-edit flow), since the Cart uses an always-visible stepper instead.
  const [updatingQtyLineId, setUpdatingQtyLineId] = useState<string | null>(null);

  // Collecting payment directly from this screen — same bill/receipt/invoice flow as
  // /patients-bill, so a balance blocking dispensing can be cleared without leaving here.
  const [hasActiveShift, setHasActiveShift] = useState(false);
  const [checkingShift, setCheckingShift] = useState(true);
  const [showStartShiftModal, setShowStartShiftModal] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('');
  const [startingShift, setStartingShift] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash', date: toLocalDateStr(new Date()), reference: '', notes: '', paymentTerms: '30', schemeId: '' });
  const [paying, setPaying] = useState(false);
  const [schemes, setSchemes] = useState<any[]>([]);
  const [patientSchemes, setPatientSchemes] = useState<any[]>([]);
  const [schemeProductPricing, setSchemeProductPricing] = useState<any[]>([]);
  const [schemeCurrencyCode, setSchemeCurrencyCode] = useState<string | null>(null);
  // True while (re)loading this patient's scheme pricing — the self-heal effect below must
  // not act while this is true, or it briefly sees an empty schemeProductPricing mid-fetch,
  // treats every insured line as "no insurance price", reprices it back to the catalog price,
  // then flips it back to 0 once the real data lands — an infinite reprice/refetch loop that
  // shows up as constant flickering between the two states.
  const [schemesLoading, setSchemesLoading] = useState(false);
  const [repricingLineId, setRepricingLineId] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<{ bill: any; payment: any } | null>(null);
  const [invoiceData, setInvoiceData] = useState<any | null>(null);
  const [creatingInsuranceInvoice, setCreatingInsuranceInvoice] = useState(false);
  const [insuranceInvoicedRxId, setInsuranceInvoicedRxId] = useState<string | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  // Direct Sale (walk-in / counter dispensing, no prior doctor prescription) — this same
  // patient/drug/price/discount state now also drives the always-visible Add Product card.
  const [people, setPeople] = useState<any[]>([]);
  const [drugs, setDrugs] = useState<any[]>([]);
  const [personSearch, setPersonSearch] = useState('');
  const [personDropdownOpen, setPersonDropdownOpen] = useState(false);
  const [saleForm, setSaleForm] = useState({ person_id: '', person_name: '' });
  const [salePrice, setSalePrice] = useState('');
  const [saleDiscountType, setSaleDiscountType] = useState<'percent' | 'value'>('percent');
  const [saleDiscountAmount, setSaleDiscountAmount] = useState('');
  const [showWalkinForm, setShowWalkinForm] = useState(false);
  const [walkinForm, setWalkinForm] = useState({ full_name: '' });
  const [registeringWalkin, setRegisteringWalkin] = useState(false);

  // History mode
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [dateFrom, setDateFrom] = useState(() => toLocalDateStr(new Date()));
  const [dateTo, setDateTo] = useState(() => toLocalDateStr(new Date()));

  useEffect(() => {
    if (activeMode === 'dispense') fetchPendingRx();
    else fetchHistory();
  }, [activeMode]);

  useEffect(() => {
    if (activeMode === 'history') fetchHistory();
  }, [dateFrom, dateTo]);

  // Fires the print dialog the moment a payment succeeds — no "here's your receipt,
  // click Print" confirmation step first. Let the off-screen receipt paint, then print.
  useEffect(() => {
    if (!receiptData) return;
    // Wait for the off-screen receipt to actually paint rather than assuming a
    // fixed delay is enough — a slow render used to print a receipt with the
    // patient's details blank.
    const cancel = printReceiptWhenPainted(
      () => receiptRef.current,
      (printed) => {
        setReceiptData(null);
        if (!printed) toast.error('Receipt could not be prepared for printing — reprint it from the Receipts page');
      }
    );
    return cancel;
  }, [receiptData]);

  useEffect(() => {
    fetchPeople();
    fetchDrugs();
    fetchShift();
    fetchSchemes();
  }, []);

  const fetchShift = async () => {
    setCheckingShift(true);
    try {
      const res = await authFetch('/api/cashier/current-shift', { credentials: 'include' });
      // The body decides, not the status. The endpoint now answers 200 with null
      // when no till is open — a normal state rather than an error — so treating
      // a successful response as "a shift is open" would let dispensing and
      // billing proceed with no shift at all.
      const shift = res.ok ? await res.json().catch(() => null) : null;
      setHasActiveShift(!!shift?.id);
    } catch {
      setHasActiveShift(false);
    } finally {
      setCheckingShift(false);
    }
  };

  const startShift = async () => {
    if (startingShift) return;
    setStartingShift(true);
    try {
      const res = await authFetch('/api/cashier/start-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ opening_balance: parseFloat(openingBalance) || 0 }),
      });
      if (res.ok) {
        toast.success('Cashier shift started');
        setShowStartShiftModal(false);
        setOpeningBalance('');
        fetchShift();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to start shift');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setStartingShift(false);
    }
  };

  const fetchSchemes = async () => {
    try {
      const res = await authFetch(`/api/schemes/active?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setSchemes(await res.json());
    } catch (e) {
      console.error('Failed to fetch schemes', e);
    }
  };

  const fetchPatientSchemes = async (patientId: string) => {
    setSchemesLoading(true);
    try {
      const res = await authFetch(`/api/schemes/membership/patient/${patientId}`, { credentials: 'include' });
      const memberships = res.ok ? await res.json() : [];
      setPatientSchemes(memberships);
      // Purely informational — the scheme price is shown in the scheme's own currency
      // (patient_schemes.currency) and never converted or written onto the SSP-denominated
      // bill. This app's bills only carry one currency total, so a scheme price in a
      // different currency has to stay its own separate reference figure rather than being
      // folded into (and silently mispricing) the SSP order total.
      // Pricing/currency are only committed once fetched — never cleared first — so nothing
      // downstream (the self-heal effect) ever sees a false "no pricing" gap mid-request.
      if (memberships.length > 0 && memberships[0].scheme_id) {
        const schemeId = memberships[0].scheme_id;
        const [pricingRes, schemeRes] = await Promise.all([
          authFetch(`/api/schemes/${schemeId}/product-pricing`, { credentials: 'include' }),
          authFetch(`/api/schemes/${schemeId}`, { credentials: 'include' }),
        ]);
        setSchemeProductPricing(pricingRes.ok ? await pricingRes.json() : []);
        setSchemeCurrencyCode(schemeRes.ok ? (await schemeRes.json())?.currency || null : null);
      } else {
        setSchemeProductPricing([]);
        setSchemeCurrencyCode(null);
      }
    } catch (e) {
      console.error('Failed to fetch patient schemes', e);
      setPatientSchemes([]);
      setSchemeProductPricing([]);
      setSchemeCurrencyCode(null);
    } finally {
      setSchemesLoading(false);
    }
  };

  // Merges the main Patient Registry with LIS-registered patients — same picker used on
  // /patients-bill and /pharmacy-prescriptions.
  const fetchPeople = async () => {
    const { people, failed } = await fetchPatientDirectory();
    setPeople(people);
    if (failed.length) {
      // A half that cannot be read must say so. Silently showing the other half
      // is how a permission error came to look like "this patient doesn't exist".
      toast.error(`Could not load ${failed.join(' and ')} — the patient list is incomplete.`);
    }
  };

  const fetchDrugs = async () => {
    try {
      const res = await authFetch(`${API}/drugs?clinic_id=${clinicId}&is_active=true`, { credentials: 'include' });
      if (res.ok) setDrugs(await res.json());
    } catch (e) {
      console.error('Failed to fetch drugs', e);
    }
  };

  const filteredPeople = people.filter(p =>
    p.label?.toLowerCase().includes(personSearch.toLowerCase()) || p.code?.toLowerCase().includes(personSearch.toLowerCase())
  );

  // Quick-registers an unregistered walk-in as an LIS participant (the same lightweight
  // registration path /lis/registration uses) so they get a real, billable identity —
  // then selects them straight into the sale form.
  const handleRegisterWalkin = async () => {
    const fullName = walkinForm.full_name.trim();
    if (!fullName) {
      toast.error('Name is required');
      return;
    }
    // The registry stores first/last separately, but nothing downstream depends on the
    // split being linguistically correct — the first word fills first_name, the rest
    // (if any) fills last_name.
    const [first_name, ...rest] = fullName.split(/\s+/);
    const last_name = rest.join(' ');
    setRegisteringWalkin(true);
    try {
      const res = await authFetch('/api/lis/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ first_name, last_name }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success('Walk-in patient registered');
        handlePatientSelect({ id: created.id, label: fullName, code: 'walk-in' });
        setWalkinForm({ full_name: '' });
        fetchPeople();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to register walk-in patient');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setRegisteringWalkin(false);
    }
  };

  // Selects a patient into the always-visible Add Product / Payment workspace below — the
  // one new addition this screen needed. Reuses whatever pending prescription this patient
  // already has (already loaded in pendingRx) instead of refetching, exactly like clicking a
  // queue entry used to do; a patient with nothing pending yet just starts clean, ready for
  // their first Add.
  const handlePatientSelect = (p: { id: string; label: string; code?: string }) => {
    setSaleForm({ person_id: p.id, person_name: p.label });
    setPersonSearch(`${p.label}${p.code ? ` (${p.code})` : ''}`);
    setPersonDropdownOpen(false);
    setShowWalkinForm(false);
    const existing = pendingRx.find((rx: any) => rx.patient_id === p.id);
    if (existing) {
      openRx(existing);
    } else {
      setSelectedRx(null);
      setActiveBill(null);
      setCheckedLines({});
      setLineQty({});
      checkBillingStatus(p.id);
      fetchPatientSchemes(p.id);
    }
  };

  const handleChangePatient = () => {
    setSaleForm({ person_id: '', person_name: '' });
    setPersonSearch('');
    setPersonDropdownOpen(false);
    setSelectedRx(null);
    setActiveBill(null);
    setCheckedLines({});
    setLineQty({});
    setAddLineDrugId('');
    setAddLineQty('1');
    setSalePrice('');
    setSaleDiscountAmount('');
  };

  // Best-effort bill creation, mirroring the same pattern used on /pharmacy-prescriptions
  // and /lis/orders — bills once, at the point the items are committed to.
  const billForSale = async (patientId: string, patientName: string, lines: any[]) => {
    try {
      const lineItems = lines
        .filter(l => l.selling_price > 0)
        .map(l => ({
          serviceId: l.drug_id, serviceName: l.drug_name, quantity: l.quantity_prescribed,
          unitPrice: l.selling_price, totalPrice: l.selling_price * l.quantity_prescribed,
          category: 'Pharmacy / Inventory',
        }));
      if (lineItems.length === 0) {
        // Every line had no price configured — nothing was billed, so this sale
        // won't appear anywhere for the cashier to collect payment on.
        toast.error('No prices are configured for these drugs — nothing was billed. Ask an admin to set drug prices.');
        return;
      }
      const total = lineItems.reduce((sum, li) => sum + li.totalPrice, 0);

      const existingBillRes = await authFetch(`/api/patient-bills/active/${patientId}/${clinicId}`, { credentials: 'include' });
      if (existingBillRes.ok) {
        const existingBill = await existingBillRes.json();
        const addRes = await authFetch(`/api/patient-bills/${existingBill.id}/add-services`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ services: lineItems }),
        });
        if (addRes.ok) {
          toast.success(`Added to bill ${existingBill.bill_number}`);
        } else {
          const err = await addRes.json().catch(() => ({}));
          toast.error(`Failed to bill this sale: ${err.error || 'unknown error'}. The patient will not be charged — please bill manually.`);
        }
      } else {
        const billNumber = `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
        const billRes = await authFetch('/api/patient-bills', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({
            bill_number: billNumber, patient_id: patientId, patient_name: patientName,
            clinic_id: parseInt(String(clinicId)), total_amount: total, paid_amount: 0,
            balance_amount: total, status: 'pending', bill_date: new Date().toISOString(),
            due_date: null, services: lineItems,
            notes: 'Auto-generated from pharmacy direct sale', created_by: user?.displayName || 'System',
          }),
        });
        if (billRes.ok) {
          toast.success(`Bill ${billNumber} created`);
        } else {
          const err = await billRes.json().catch(() => ({}));
          toast.error(`Failed to bill this sale: ${err.error || 'unknown error'}. The patient will not be charged — please bill manually.`);
        }
      }
    } catch (e) {
      console.error('Error billing for sale', e);
      toast.error('Failed to bill this sale due to a network error — please bill manually.');
    }
  };

  // Unified "Add Product" — the one card that both starts a patient's first order (creating
  // the prescription + bill) and adds every item after that (via handleAddLineToRx). Which
  // path runs depends only on whether a prescription is already selected for this patient;
  // the form/price/discount handling is identical either way.
  const handleAddProduct = async () => {
    if (!saleForm.person_id) { toast.error('Select a patient'); return; }
    const drugId = addLineDrugId;
    if (!drugId) { toast.error('Select a drug'); return; }
    const drug = drugs.find(d => d.id === drugId);
    if (!drug) return;
    const qty = parseInt(addLineQty, 10) || 1;
    if (qty <= 0) { toast.error('Quantity must be greater than zero'); return; }
    // Price auto-fills from the catalog when a drug is picked but can be overridden by hand —
    // that edited value (not the raw catalog price) is what the discount applies to and what
    // actually gets billed, same as the Add Service/Product form on /patients-bill.
    const basePrice = salePrice !== '' ? (parseFloat(salePrice) || 0) : (parseFloat(drug.selling_price) || 0);
    const discountNum = parseFloat(saleDiscountAmount) || 0;
    const finalPrice = discountNum > 0
      ? Math.max(0, saleDiscountType === 'percent' ? basePrice * (1 - discountNum / 100) : basePrice - discountNum)
      : basePrice;

    if (selectedRx) {
      await handleAddLineToRx(finalPrice);
      setSalePrice('');
      setSaleDiscountAmount('');
      return;
    }

    setAddingLine(true);
    try {
      const res = await authFetch(`${API}/prescriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: saleForm.person_id,
          doctor_id: null,
          prescription_date: new Date().toISOString().split('T')[0],
          prescribed_by_name: user?.displayName,
          prescription_notes: 'Pharmacist-initiated direct sale',
          lines: [{
            drug_id: drug.id, quantity_prescribed: qty, unit_of_measure: drug.unit_of_measure || 'tablet',
            dose_strength: '', frequency: '', duration_days: 0, notes: '',
          }],
        }),
      });
      if (res.ok) {
        const created = await res.json();
        await billForSale(saleForm.person_id, saleForm.person_name, [{
          drug_id: drug.id, drug_name: drug.drug_name, quantity_prescribed: qty, selling_price: finalPrice,
        }]);
        setAddLineDrugId('');
        setAddLineQty('1');
        setSalePrice('');
        setSaleDiscountAmount('');
        fetchPendingRx();
        await openRx({ id: created.id });
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to add item');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setAddingLine(false);
    }
  };

  // Arriving from the Prescriptions "Dispense" button — open that prescription directly,
  // even if it's partially dispensed (and so wouldn't be in the pending-only queue list).
  useEffect(() => {
    const prescriptionId = (location.state as any)?.prescriptionId;
    if (prescriptionId) {
      openRx({ id: prescriptionId });
    }
  }, []);

  const fetchPendingRx = async () => {
    setQueueLoading(true);
    try {
      const res = await authFetch(`${API}/prescriptions?clinic_id=${clinicId}&status=pending,partial_dispensed`, { credentials: 'include' });
      if (res.ok) setPendingRx(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch pending prescriptions');
    } finally {
      setQueueLoading(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ clinic_id: String(clinicId) });
      if (dateFrom) params.append('from_date', dateFrom);
      if (dateTo) params.append('to_date', dateTo);
      const res = await authFetch(`${API}/dispensing?${params}`, { credentials: 'include' });
      if (res.ok) setHistory(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch dispensing history');
    } finally {
      setHistoryLoading(false);
    }
  };

  // opts lets a caller that already knows the current bill/schemes (e.g. handleAddLineToRx,
  // which just got the updated bill back from the add-services/create-bill call itself)
  // skip those two extra round trips on an incremental refresh — they haven't changed
  // since the last full load, so re-fetching them on every single tap/removal was pure
  // added latency for no new information.
  // silent skips the Bill Items card's own spinner (see the `detailLoading` guard on that
  // card) — skipBillCheck/skipSchemes above only ever trimmed which EXTRA requests this
  // makes; this function still unconditionally blanked the whole card to a spinner for
  // its own GET /prescriptions/:id, on every add/remove/qty-change/payment, regardless of
  // those flags. That's what still looked like a "reload" on every single item added.
  const openRx = async (rx: any, opts?: { skipBillCheck?: boolean; skipSchemes?: boolean; silent?: boolean }) => {
    setSelectedRx(rx);
    if (!opts?.silent) setDetailLoading(true);
    setCheckedLines({});
    setLineQty({});
    // No setActiveBill(null) reset here — checkBillingStatus below always ends by
    // setting activeBill to whatever's actually current, so clearing it first only
    // creates a needless flash to "no bill yet" on every incremental refresh (e.g.
    // after each POS add) instead of the numbers just updating in place.
    try {
      const res = await authFetch(`${API}/prescriptions/${rx.id}`, { credentials: 'include' });
      if (res.ok) {
        const detail = await res.json();
        setSelectedRx(detail);
        // Show who this is for. The patient area is driven by saleForm, which only
        // the picker's own onSelect used to fill, so arriving here from a
        // prescription's Dispense button left it on its "Search patient..."
        // placeholder — the prescription had loaded, but the page read as though
        // nothing had, with no patient and no obvious way forward.
        if (detail.patient_id) {
          setSaleForm({
            person_id: detail.patient_id,
            person_name: detail.patient_name || detail.patient_id,
          });
        }
        const initialQty: Record<string, string> = {};
        const initialChecked: Record<string, boolean> = {};
        (detail.lines || []).forEach((l: any) => {
          const remaining = l.quantity_prescribed - (l.total_quantity_dispensed || 0);
          if ((l.status === 'pending' || l.status === 'partial') && remaining > 0) {
            initialQty[l.id] = String(remaining);
            // Leftover lines from before stock was checked at prescribing time can still
            // exceed current stock — don't pre-check those, the row itself flags it as
            // "Out of stock" and disables the checkbox until restocked.
            const stockRaw = l.stock_on_hand != null ? parseFloat(l.stock_on_hand) : NaN;
            initialChecked[l.id] = isNaN(stockRaw) || stockRaw >= packEquivalent(remaining, l);
          }
        });
        setLineQty(initialQty);
        setCheckedLines(initialChecked);
        if (!opts?.skipBillCheck) checkBillingStatus(detail.patient_id);
        if (!opts?.skipSchemes) fetchPatientSchemes(detail.patient_id);
      }
    } catch {
      toast.error('Failed to load prescription');
    } finally {
      setDetailLoading(false);
    }
  };

  // Dispensing is gated on the patient's bill being settled — prescriptions bill the
  // patient at creation time (on /lis/orders or /pharmacy-prescriptions), so any
  // outstanding balance here means payment hasn't been collected yet. Keeping the whole
  // bill (not just its balance) lets this screen collect payment against it directly.
  const checkBillingStatus = async (patientId: string) => {
    setCheckingBill(true);
    try {
      const res = await authFetch(`/api/patient-bills/active/${patientId}/${clinicId}`, { credentials: 'include' });
      if (res.ok) {
        setActiveBill(await res.json());
      } else {
        setActiveBill(null);
      }
    } catch {
      setActiveBill(null);
    } finally {
      setCheckingBill(false);
    }
  };

  const toggleLine = (lineId: string) => {
    setCheckedLines(prev => ({ ...prev, [lineId]: !prev[lineId] }));
  };

  const startEditLineQty = (line: any) => {
    setEditingLineId(line.id);
    setEditQty(String(line.quantity_prescribed));
  };

  const handleSaveLineQty = async (line: any) => {
    if (!selectedRx || savingLineQty) return;
    const qty = parseInt(editQty, 10);
    if (!qty || qty <= 0) { toast.error('Quantity must be greater than zero'); return; }
    if (qty === line.quantity_prescribed) { setEditingLineId(null); return; }

    setSavingLineQty(true);
    try {
      const res = await authFetch(`${API}/prescriptions/${selectedRx.id}/lines/${line.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quantity_prescribed: qty }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(data.billAdjusted ? `Quantity updated and bill adjusted` : 'Quantity updated');
        setEditingLineId(null);
        // Only the line itself needs re-fetching here (no optimistic patch to fall back
        // on) — billing status and schemes haven't changed, same reasoning as the
        // stepper's updateLineQty just above.
        await openRx(selectedRx, { skipBillCheck: true, skipSchemes: true, silent: true });
        if (data.billAdjusted) {
          const billRes = await authFetch(`/api/patient-bills/active/${selectedRx.patient_id}/${clinicId}`, { credentials: 'include' });
          if (billRes.ok) setActiveBill(await billRes.json());
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to update quantity');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSavingLineQty(false);
    }
  };

  // Shared by the Cart's +/- stepper and manual qty entry, and by the POS grid tapping
  // an item that's already in the cart (bumps quantity instead of adding a duplicate
  // line — see handleAddProduct). Patches selectedRx.lines locally first so the number
  // visibly changes right away, same instant-feedback idea as the optimistic add — the
  // qty PUT itself still round-trips to keep the bill total correct, but the UI doesn't
  // sit frozen waiting on it. Reverts the optimistic patch if the request fails.
  const updateLineQty = async (line: any, newQty: number) => {
    if (!selectedRx || updatingQtyLineId === line.id) return;
    if (newQty <= 0) { toast.error('Quantity must be greater than zero'); return; }
    if (newQty === line.quantity_prescribed) return;

    const previousQty = line.quantity_prescribed;
    setUpdatingQtyLineId(line.id);
    setSelectedRx((prev: any) => prev ? {
      ...prev,
      lines: (prev.lines || []).map((l: any) => l.id === line.id ? { ...l, quantity_prescribed: newQty } : l),
    } : prev);

    try {
      const res = await authFetch(`${API}/prescriptions/${selectedRx.id}/lines/${line.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quantity_prescribed: newQty }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        // The optimistic patch above already shows the new quantity — a full openRx()
        // (prescription detail + billing status + schemes, 3 round trips) just to confirm
        // a qty bump is what made this feel slow. Only the bill's total/balance can
        // actually have changed server-side, and only when a matching charge line was
        // found (billAdjusted), so that's the one thing worth re-fetching.
        if (data.billAdjusted) {
          const billRes = await authFetch(`/api/patient-bills/active/${selectedRx.patient_id}/${clinicId}`, { credentials: 'include' });
          if (billRes.ok) setActiveBill(await billRes.json());
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to update quantity');
        setSelectedRx((prev: any) => prev ? {
          ...prev,
          lines: (prev.lines || []).map((l: any) => l.id === line.id ? { ...l, quantity_prescribed: previousQty } : l),
        } : prev);
      }
    } catch {
      toast.error('Network error');
      setSelectedRx((prev: any) => prev ? {
        ...prev,
        lines: (prev.lines || []).map((l: any) => l.id === line.id ? { ...l, quantity_prescribed: previousQty } : l),
      } : prev);
    } finally {
      setUpdatingQtyLineId(null);
    }
  };

  // Silently re-prices one not-yet-dispensed line to a given rate — corrects the bill
  // line item's price without touching the shared drug catalog price everyone else is
  // billed at. Returns whether it succeeded; caller decides when/how to refresh & notify.
  const repriceLine = async (rxId: string, line: any, unitPrice: number, schemeInfo?: { scheme_price: number | null; scheme_currency: string | null }) => {
    try {
      const res = await authFetch(`${API}/prescriptions/${rxId}/lines/${line.id}/reprice`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ unit_price: unitPrice, ...schemeInfo }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // Keeps each not-yet-dispensed line's SSP bill charge correct:
  //  - Bill already locked into a scheme (activeBill.scheme_id set — the whole visit is being
  //    claimed via that scheme's own invoice) → an insured item is billed at its real scheme
  //    rate folded straight into the bill's one SSP total, exactly like BillDetails' add-service
  //    does for a scheme-mode bill. Never zeroed/stashed here — that would make an item that's
  //    already included and owed look like a separate, not-yet-billed insurance claim, and would
  //    silently drop its price out of the bill total.
  //  - Bill not on a scheme (plain cash bill) + item has an insurance price → the patient owes
  //    nothing in SSP for it (it's claimed from the insurer separately, in the scheme's own
  //    currency) — zero it and stash the scheme reference for Bill Details to show.
  //  - Everyone else → the plain catalog cash price (also self-heals the earlier bug where a
  //    scheme price briefly got written straight into the SSP bill in the wrong currency).
  useEffect(() => {
    if (!selectedRx || !activeBill || repricingLineId || schemesLoading) return;
    const isInsured = patientSchemes.length > 0;
    const billHasScheme = !!activeBill.scheme_id;
    const billServices = parseServices(activeBill.services);
    const findBillService = (l: any) => billServices.find((s: any) =>
      !s.isVoided && String(s.serviceName || '').toLowerCase() === String(l.drug_name || '').toLowerCase() && Number(s.quantity) === Number(l.quantity_prescribed)
    );
    const toFix = (selectedRx.lines || [])
      .filter((l: any) => l.status !== 'cancelled' && (l.total_quantity_dispensed || 0) === 0)
      .map((l: any) => {
        const bs = findBillService(l);
        const pricing = schemeProductPricing.find((p: any) => p.product_id === l.drug_id);
        const covered = isInsured && !!pricing;
        const targetPrice = billHasScheme
          ? (covered ? (parseFloat(pricing.scheme_price) || 0) : (parseFloat(l.selling_price) || 0))
          : (covered ? 0 : (parseFloat(l.selling_price) || 0));
        // Stashed purely for other pages (e.g. Bill Details) to show what the insurer is
        // actually being charged instead of the SSP 0 the patient owes — never summed into
        // the bill's own SSP total/balance, which only ever reads unitPrice/totalPrice.
        // Always sent explicitly (never omitted) so a patient/item that stops being covered
        // (or a bill that's now scheme-priced directly) gets its stale scheme reference
        // cleared, not left behind.
        const schemeInfo = (!billHasScheme && covered)
          ? { scheme_price: parseFloat(pricing.scheme_price) || 0, scheme_currency: schemeCurrencyCode }
          : { scheme_price: null, scheme_currency: null };
        const billedPrice = bs ? parseFloat(bs.unitPrice) || 0 : targetPrice;
        const billedSchemePrice = bs?.schemePrice != null ? parseFloat(bs.schemePrice) : null;
        const schemeInfoStale = schemeInfo.scheme_price !== null
          ? (billedSchemePrice === null || Math.abs(billedSchemePrice - (schemeInfo.scheme_price as number)) > 0.01 || bs?.schemeCurrency !== schemeInfo.scheme_currency)
          : (billedSchemePrice !== null);
        return { line: l, targetPrice, schemeInfo, needsFix: !!bs && (Math.abs(billedPrice - targetPrice) > 0.01 || schemeInfoStale) };
      })
      .filter((x: any) => x.needsFix);
    if (toFix.length === 0) return;

    const rxId = selectedRx.id;
    (async () => {
      setRepricingLineId(toFix[0].line.id);
      try {
        let count = 0;
        for (const { line, targetPrice, schemeInfo } of toFix) {
          if (await repriceLine(rxId, line, targetPrice, schemeInfo)) count++;
        }
        if (count > 0) {
          await openRx(selectedRx, { silent: true });
        }
      } finally {
        setRepricingLineId(null);
      }
    })();
  }, [selectedRx, activeBill, patientSchemes, schemeProductPricing, schemesLoading]);

  // ── Collect payment against the patient's active bill, directly from this screen ──
  // Same endpoint /patients-bill uses, so a payment recorded here is the exact same bill
  // (and shows up there too) rather than a parallel record. The Record Payment card is
  // always visible now (not opened on demand), so the amount field is kept in sync with
  // the current payable balance whenever a different/updated bill loads, instead of only
  // being seeded once when a "Pay" button used to be clicked.
  useEffect(() => {
    if (activeBill) {
      setPaymentForm(f => ({ ...f, amount: String(payableBillBalance || '') }));
    }
  }, [activeBill]);

  const handleCreateInvoice = async () => {
    if (paying || !activeBill) return;
    // Only the not-yet-invoiced/paid/voided/insurance lines are eligible — anything already
    // covered by an earlier invoice must not be sent again, or it gets double-invoiced.
    const invoiceableServices = parseServices(activeBill.services).filter(isPayableLine);
    const invoiceableAmount = invoiceableServices.reduce((sum: number, s: any) => sum + (parseFloat(s.totalPrice) || 0), 0);
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
          await authFetch(`/api/schemes/patient-schemes/${activeBill.patient_id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ scheme_id: paymentForm.schemeId, clinic_id: clinicId }),
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
          bill_id: activeBill.id, patient_id: activeBill.patient_id, patient_name: activeBill.patient_name,
          clinic_id: parseInt(String(clinicId)), amount, payment_terms: parseInt(paymentForm.paymentTerms) || 30,
          notes, services: invoiceableServices,
          scheme_id: paymentForm.schemeId || null, scheme_name: schemeName,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(`Invoice ${result.data.invoice_number} created`);
        setInvoiceData({ ...result.data, patient_name: activeBill.patient_name, bill_number: activeBill.bill_number });
        checkBillingStatus(activeBill.patient_id);
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

  // Creates the actual claim record for this patient's insurance-priced items — the "Scheme
  // Total" figure is otherwise just a display number with nothing to send the insurer.
  // Deliberately NOT linked to the patient's SSP bill_id: that bill has already been zeroed
  // for these lines (the patient owes nothing in SSP for them), so this is a wholly separate,
  // scheme-currency invoice tracked only by patient + scheme.
  const handleCreateInsuranceInvoice = async () => {
    if (!selectedRx || creatingInsuranceInvoice || insuranceInvoicedRxId === selectedRx.id) return;
    if (patientSchemes.length === 0) return;
    const activeLines = (selectedRx.lines || []).filter((l: any) => l.status !== 'cancelled');
    const schemeLines = activeLines
      .map((l: any) => ({ line: l, pricing: schemeProductPricing.find((p: any) => p.product_id === l.drug_id) }))
      .filter((x: any) => x.pricing);
    if (schemeLines.length === 0) { toast.error('No insurance-priced items on this order'); return; }

    const services = schemeLines.map(({ line, pricing }: any) => {
      const unitPrice = parseFloat(pricing.scheme_price) || 0;
      return {
        serviceName: line.drug_name, quantity: line.quantity_prescribed,
        unitPrice, totalPrice: parseFloat((unitPrice * line.quantity_prescribed).toFixed(2)), currency: schemeCurrencyCode,
      };
    });
    const amount = services.reduce((sum: number, s: any) => sum + s.totalPrice, 0);
    const scheme = patientSchemes[0];

    setCreatingInsuranceInvoice(true);
    try {
      const res = await authFetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patient_id: selectedRx.patient_id, patient_name: selectedRx.patient_name,
          clinic_id: parseInt(String(clinicId)), amount, currency: schemeCurrencyCode,
          payment_terms: 30, notes: `Insurance claim — ${scheme.scheme_name} (${selectedRx.prescription_number})`,
          services, scheme_id: scheme.scheme_id, scheme_name: scheme.scheme_name,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(`Insurance invoice ${result.data.invoice_number} created (${schemeCurrencyCode} ${amount.toFixed(2)})`);
        setInvoiceData({ ...result.data, patient_name: selectedRx.patient_name, scheme_name: scheme.scheme_name, currency: schemeCurrencyCode });
        setInsuranceInvoicedRxId(selectedRx.id);
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
    if (paying || !activeBill) return;
    if (paymentForm.method === 'credit') { handleCreateInvoice(); return; }
    // Whatever's already invoiced or paid isn't payable here again — collect an invoiced
    // amount from the Invoices page instead, never by paying the same line twice.
    const billServices = parseServices(activeBill.services);
    const payableBalance = billServices.filter(isPayableLine).reduce((sum: number, s: any) => sum + (parseFloat(s.totalPrice) || 0), 0);
    if (payableBalance <= 0) { toast.error('Nothing left to collect directly — the remaining balance is already invoiced. Collect it from the Invoices page.'); return; }
    const amount = parseFloat(paymentForm.amount);
    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid payment amount'); return; }
    if (amount > payableBalance + 0.01) { toast.error('Payment cannot exceed the not-yet-invoiced balance due'); return; }
    if (!paymentForm.method) { toast.error('Select a payment method'); return; }

    setPaying(true);
    try {
      const notes = paymentForm.reference
        ? `${paymentForm.notes ? paymentForm.notes + ' — ' : ''}Ref: ${paymentForm.reference}`
        : paymentForm.notes;

      const isFullPayment = amount >= payableBalance - 0.01;
      const paidServiceIndexes = isFullPayment
        ? billServices.reduce((acc: number[], s: any, i: number) => { if (isPayableLine(s)) acc.push(i); return acc; }, [])
        : undefined;

      const res = await authFetch(`/api/patient-bills/${activeBill.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount, payment_method: paymentForm.method, payment_date: paymentForm.date,
          notes, cashierName: user?.displayName, cashierId: user?.id, paidServiceIndexes,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        // The receipt must list only what THIS payment actually covered, not every line on
        // the bill (which includes items paid on earlier receipts and still-unpaid ones).
        // The backend returns the right subset whenever paidServiceIndexes was sent (the
        // full-payment case above); an unattributed partial payment can't honestly be tied
        // to particular services, so it prints as a plain "Payment on Account" line instead
        // of falsely listing services it may not cover.
        const paidThisTime = result.receipt?.service_details?.length > 0
          ? result.receipt.service_details
          : [{ serviceName: 'Payment on Account', quantity: 1, unitPrice: amount, totalPrice: amount }];
        setReceiptData({
          bill: {
            id: activeBill.id, billNumber: activeBill.bill_number, patientName: activeBill.patient_name,
            patientId: activeBill.patient_id, totalAmount: parseFloat(activeBill.total_amount),
            paidAmount: parseFloat(activeBill.paid_amount) + amount, balanceAmount: parseFloat(activeBill.balance_amount) - amount,
            billDate: activeBill.bill_date, services: paidThisTime,
          },
          payment: { amount, method: paymentForm.method, date: paymentForm.date, notes, from_lease: false, cashierName: user?.displayName },
        });

        // Fully settling the bill in this same step unblocks dispensing right away — dispense
        // whatever's checked now instead of making the pharmacist click Dispense separately.
        // Re-opens the same prescription afterward (rather than closing it) so any items left
        // unchecked stay visible to remove or come back and dispense later.
        const rxToRefresh = selectedRx;
        if (isFullPayment && rxToRefresh) {
          const linesToDispense = (rxToRefresh.lines || []).filter((l: any) => checkedLines[l.id] && parseInt(lineQty[l.id], 10) > 0);
          if (linesToDispense.length > 0) {
            setDispensing(true);
            try {
              const successCount = await dispenseLines(linesToDispense);
              toast.success(`Payment recorded${successCount > 0 ? ` — dispensed ${successCount} item${successCount > 1 ? 's' : ''}` : ''}`);
              fetchPendingRx();
            } finally {
              setDispensing(false);
            }
          } else {
            toast.success('Payment recorded');
          }
        } else {
          toast.success(isFullPayment ? 'Payment recorded' : 'Partial payment recorded — pay the remaining balance to dispense');
        }
        if (rxToRefresh) await openRx(rxToRefresh, { silent: true });
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

  // Form-view "Add" button only (see handleAddProduct) — adds a drug to the currently
  // open prescription and bills it the same way a freshly prescribed/sold line is
  // billed, letting a pharmacist correct an order (add something the doctor missed)
  // before it's dispensed and paid for. priceOverride carries the Add Product card's
  // editable price/discount through to billing instead of always re-reading the raw
  // catalog price.
  const handleAddLineToRx = async (priceOverride?: number) => {
    if (!selectedRx || addingLine) return;
    const drugId = addLineDrugId;
    if (!drugId) { toast.error('Select a drug'); return; }
    const drug = drugs.find(d => d.id === drugId);
    if (!drug) return;
    const qty = parseInt(addLineQty, 10) || 1;
    if (qty <= 0) { toast.error('Quantity must be greater than zero'); return; }
    const stockOnHand = drug.stock_on_hand != null ? parseFloat(drug.stock_on_hand) : null;
    if (stockOnHand != null && !isNaN(stockOnHand) && packEquivalent(qty, drug) > stockOnHand) {
      toast.error(`Only ${stockOnHand} ${drug.unit_of_measure || 'unit'}(s) of ${drug.drug_name} in stock (≈ ${Math.floor(stockOnHand * (Number(drug.units_per_pack) || 1))} ${doseUnitLabel(drug)}) — reduce the quantity.`);
      return;
    }

    // This drug is already an active (not yet dispensed) line on this order — bump its
    // quantity instead of posting a second line. Without this, clicking "Add" again for
    // the same drug created a duplicate line every time instead of accumulating the quantity.
    const existingLine = (selectedRx.lines || []).find((l: any) =>
      l.drug_id === drugId && l.status !== 'cancelled' && (l.total_quantity_dispensed || 0) === 0
    );
    if (existingLine) {
      updateLineQty(existingLine, (existingLine.quantity_prescribed || 0) + qty);
      setAddLineDrugId('');
      setAddLineQty('1');
      return;
    }

    setAddingLine(true);
    try {
      // The line-add and the active-bill lookup don't depend on each other's result —
      // firing them together instead of one-after-the-other cuts a full network round
      // trip off every "Add", same optimization already used by the POS grid's tap
      // handler above.
      const [res, existingBillRes] = await Promise.all([
        authFetch(`${API}/prescriptions/${selectedRx.id}/lines`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ drug_id: drug.id, quantity_prescribed: qty, unit_of_measure: doseUnitLabel(drug) }),
        }),
        authFetch(`/api/patient-bills/active/${selectedRx.patient_id}/${clinicId}`, { credentials: 'include' }),
      ]);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to add item');
        return;
      }

      const sellingPrice = priceOverride != null ? priceOverride : (parseFloat(drug.selling_price) || 0);
      if (sellingPrice > 0) {
        // sellingPrice is "price per pack" (per Strip/Bottle/etc.) same as
        // everywhere else — the bill line shows qty in dose units, so its
        // own unitPrice must be price-per-dose-unit for qty*unitPrice to
        // still equal totalPrice, or this overcharges by units_per_pack.
        const unitsPerPack = Number(drug.units_per_pack) || 1;
        // serviceId/category: this is always a drug dispense, so the category is known with
        // certainty right here — no need to guess it later from "drug.drug_name" the way
        // reportClinicPerformance.js's fuzzy matching otherwise has to.
        const lineItem = { serviceId: drug.id, serviceName: drug.drug_name, quantity: qty, unitPrice: sellingPrice / unitsPerPack, totalPrice: sellingPrice * packEquivalent(qty, drug), category: 'Pharmacy / Inventory' };
        if (existingBillRes.ok) {
          const existingBill = await existingBillRes.json();
          const addRes = await authFetch(`/api/patient-bills/${existingBill.id}/add-services`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ services: [lineItem] }),
          });
          if (addRes.ok) {
            const updated = await addRes.json();
            setActiveBill(updated);
            const actualAdded = parseFloat(updated.total_amount) - parseFloat(existingBill.total_amount);
            if (Math.abs(actualAdded - lineItem.totalPrice) > 0.01) {
              toast.success(`${drug.drug_name} added — scheme pricing applied: billed ${actualAdded.toFixed(2)} (listed price was ${lineItem.totalPrice.toFixed(2)})`, { duration: 8000 });
            } else {
              toast.success(`${drug.drug_name} added and billed`);
            }
          } else {
            toast.error(`${drug.drug_name} added to the order, but billing it failed — please bill manually`);
          }
        } else {
          const billNumber = `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
          const billRes = await authFetch('/api/patient-bills', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({
              bill_number: billNumber, patient_id: selectedRx.patient_id, patient_name: selectedRx.patient_name,
              clinic_id: parseInt(String(clinicId)), total_amount: lineItem.totalPrice, paid_amount: 0,
              balance_amount: lineItem.totalPrice, status: 'pending', bill_date: new Date().toISOString(),
              due_date: null, services: [lineItem], notes: 'Added during dispensing', created_by: user?.displayName || 'System',
            }),
          });
          if (billRes.ok) {
            setActiveBill(await billRes.json());
            toast.success(`${drug.drug_name} added and billed (${billNumber})`);
          } else {
            toast.error(`${drug.drug_name} added to the order, but billing it failed — please bill manually`);
          }
        }
      } else {
        toast.error(`${drug.drug_name} added, but has no price configured — not billed`);
      }

      setAddLineDrugId('');
      setAddLineQty('1');
      // The bill is already refreshed above straight from its own mutation response —
      // a full openRx() (which also re-checks billing status and re-fetches insurance
      // schemes) just to pick up the new prescription line is what made every "Add"
      // blank the whole Bill Items card to a spinner.
      await openRx(selectedRx, { skipBillCheck: true, skipSchemes: true, silent: true });
    } catch {
      toast.error('Network error');
    } finally {
      setAddingLine(false);
    }
  };

  // Removes a not-yet-dispensed line from the order and, if it hasn't been paid
  // for, drops the matching charge from the bill too.
  const handleRemoveLine = async (line: any) => {
    if (!selectedRx || removingLineId) return;
    setRemovingLineId(line.id);
    // Removes the row instantly instead of waiting for the DELETE + a full prescription
    // refresh to come back — that round trip used to hold the row (and its spinner) on
    // screen for the whole request. Reverted below if the DELETE actually fails.
    const rxBeforeRemove = selectedRx;
    // openRx below resets selectedRx to whatever rx object it's given as its very first
    // step (before the fresh fetch resolves) — passing the already-filtered version, not
    // the stale pre-removal one, avoids the removed row flickering back for a moment.
    const rxAfterRemove = { ...selectedRx, lines: (selectedRx.lines || []).filter((l: any) => l.id !== line.id) };
    setSelectedRx(rxAfterRemove);
    try {
      const res = await authFetch(`${API}/prescriptions/${rxBeforeRemove.id}/lines/${line.id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(data.billAdjusted ? `${line.drug_name} removed and un-billed` : `${line.drug_name} removed`);
        // Bill totals may have changed (billAdjusted) — schemes never change from removing
        // a line, so that round trip is skipped same as the POS-add path.
        openRx(rxAfterRemove, { skipSchemes: true, silent: true });
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to remove item');
        setSelectedRx(rxBeforeRemove);
      }
    } catch {
      toast.error('Network error');
      setSelectedRx(rxBeforeRemove);
    } finally {
      setRemovingLineId(null);
    }
  };

  // Posts one /dispensing record per line. Shared by the plain "Dispense Selected" button
  // (balance already clear) and the combined "Save Payment & Dispense" flow (balance just
  // cleared by the payment that triggered it, so the caller decides when this runs).
  const dispenseLines = async (lines: any[]) => {
    let successCount = 0;
    for (const line of lines) {
      const qty = parseInt(lineQty[line.id], 10);
      const res = await authFetch(`${API}/dispensing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clinic_id: clinicId,
          prescription_id: selectedRx.id,
          prescription_line_id: line.id,
          patient_id: selectedRx.patient_id,
          drug_id: line.drug_id,
          pharmacist_id: user?.id,
          batch_id: '',
          from_location_id: '',
          quantity_dispensed: qty,
          unit_of_measure: line.unit_of_measure,
          unit_price: line.selling_price,
          dispensing_notes: '',
          patient_counselling_provided: false,
          counselling_notes: '',
        }),
      });
      if (res.ok) {
        successCount++;
      } else {
        const err = await res.json().catch(() => ({}));
        const detail = err.error === 'Insufficient stock' && err.available != null
          ? `Insufficient stock — only ${err.available} available, ${err.requested} requested`
          : (err.error || 'Failed to dispense');
        toast.error(`${line.drug_name}: ${detail}`);
      }
    }
    return successCount;
  };

  const handleDispense = async () => {
    if (!selectedRx) return;
    // A scheme/insurance bill (activeBill.scheme_id set) is claimed via an invoice the
    // cashier raises later, not cash collected up front — only a plain cash balance blocks.
    if (billBalance > 0 && !activeBill?.scheme_id) { toast.error('This patient has an outstanding balance — dispensing is blocked until payment is collected.'); return; }
    const linesToDispense = (selectedRx.lines || []).filter((l: any) => {
      if (!checkedLines[l.id] || !(parseInt(lineQty[l.id], 10) > 0)) return false;
      const stockRaw = l.stock_on_hand != null ? parseFloat(l.stock_on_hand) : NaN;
      const remaining = l.quantity_prescribed - (l.total_quantity_dispensed || 0);
      return isNaN(stockRaw) || stockRaw >= packEquivalent(remaining, l);
    });
    if (linesToDispense.length === 0) { toast.error('Select at least one item to dispense'); return; }

    setDispensing(true);
    try {
      const successCount = await dispenseLines(linesToDispense);
      if (successCount > 0) {
        toast.success(`Dispensed ${successCount} item${successCount > 1 ? 's' : ''}`);
      }
      setSelectedRx(null);
      fetchPendingRx();
    } finally {
      setDispensing(false);
    }
  };

  const filteredHistory = history.filter((h: any) => {
    const q = historySearch.toLowerCase();
    return !q ||
      h.dispensing_number?.toLowerCase().includes(q) ||
      h.patient_name?.toLowerCase().includes(q) ||
      h.drug_name?.toLowerCase().includes(q);
  });

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
        <div className="flex justify-between items-start gap-4 flex-wrap">
          <PageHeader
            title={activeMode === 'dispense' ? 'Dispensing' : 'Dispensing History'}
            icon={<Pill />}
          />
          <div className="flex items-center gap-3">
            {!checkingShift && (
              <span
                className={cn(
                  "hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border",
                  hasActiveShift
                    ? "border-success-border bg-success-bg text-success"
                    : "border-warning-border bg-warning-bg text-warning"
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", hasActiveShift ? "bg-success" : "bg-warning")} />
                {hasActiveShift ? 'Shift Active' : 'No Active Shift'}
              </span>
            )}
            <div className="flex bg-muted p-1 rounded-full">
              <button
                onClick={() => setActiveMode('dispense')}
                className={cn("px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2", activeMode === 'dispense' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <ClipboardList className="w-4 h-4" /> Dispense
              </button>
              <button
                onClick={() => setActiveMode('history')}
                className={cn("px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2", activeMode === 'history' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <History className="w-4 h-4" /> History
              </button>
            </div>
          </div>
        </div>

        {/* Cashier shift banner — payments collected from this screen require an open shift */}
        {!checkingShift && !hasActiveShift && (
          <div className="mt-4 px-4 py-3 rounded-xl border border-warning-border bg-warning-bg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              No active cashier shift — you can dispense, but collecting payment here requires an open shift.
            </div>
            <Button size="sm" onClick={() => setShowStartShiftModal(true)}>Start Shift</Button>
          </div>
        )}

        {activeMode === 'dispense' ? (
          <div className="mt-6 flex-1 min-h-0 flex flex-col gap-6 overflow-auto">
            {/* Patient — the one new addition to this screen: everything below (Add
                Product, Record Payment, Bill Items) is scoped to whichever patient is
                picked here, the same way /patients-bill is scoped to one bill via its
                URL param. */}
            <div className="bg-card rounded-lg border shadow-sm p-4">
              {!saleForm.person_id ? (
                <div className="space-y-2 max-w-md">
                  <Label className="text-xs font-medium text-muted-foreground">Patient</Label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      value={personSearch}
                      onChange={e => { setPersonSearch(e.target.value); setPersonDropdownOpen(true); }}
                      onFocus={() => setPersonDropdownOpen(true)}
                      placeholder="Search patient by name or ID to dispense to..."
                      className="pl-8"
                    />
                    {personDropdownOpen && personSearch && (
                      <div className="absolute z-10 mt-1 w-full bg-card border rounded-lg max-h-48 overflow-y-auto shadow-md">
                        {filteredPeople.slice(0, 8).map(p => (
                          <div
                            key={`${p.source}-${p.id}`}
                            onClick={() => handlePatientSelect(p)}
                            className="px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer border-b last:border-0"
                          >
                            <span className="font-medium">{p.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">{p.code || '—'} · {p.source === 'lis' ? 'LIS' : 'Registry'}</span>
                          </div>
                        ))}
                        {filteredPeople.length === 0 && <div className="p-3 text-sm text-muted-foreground text-center">No patients found</div>}
                      </div>
                    )}
                  </div>
                  {!showWalkinForm ? (
                    <button type="button" onClick={() => setShowWalkinForm(true)} className="text-xs text-primary hover:underline">
                      + Walk-in patient (not registered)?
                    </button>
                  ) : (
                    <div className="border rounded-lg p-3 space-y-2.5 bg-muted/20">
                      <div className="flex justify-between items-center">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Register Walk-in</p>
                        <button type="button" onClick={() => setShowWalkinForm(false)} className="text-muted-foreground hover:text-foreground">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <Input
                        autoFocus
                        placeholder="Full Name"
                        value={walkinForm.full_name}
                        onChange={e => setWalkinForm({ ...walkinForm, full_name: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter' && !registeringWalkin) handleRegisterWalkin(); }}
                      />
                      <Button type="button" variant="outline" className="w-full" onClick={handleRegisterWalkin} disabled={registeringWalkin}>
                        {registeringWalkin ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                        Register & Continue
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="w-4 h-4 text-primary shrink-0" />
                    <span className="font-semibold truncate">{saleForm.person_name}</span>
                    {selectedRx && <span className="text-xs font-mono text-muted-foreground shrink-0">· {selectedRx.prescription_number}</span>}
                    {selectedRx && !checkingBill && (
                      billBalance > 0 && activeBill?.scheme_id ? (
                        <Badge variant="outline" className="shrink-0 border-info-border bg-info-bg text-info gap-1"><Shield className="w-3 h-3" /> Insurance Billed</Badge>
                      ) : billBalance > 0 ? (
                        <Badge variant="outline" className="shrink-0 border-destructive-border bg-destructive-bg text-destructive gap-1"><AlertTriangle className="w-3 h-3" /> Balance Due</Badge>
                      ) : activeBill ? (
                        <Badge variant="outline" className="shrink-0 border-success-border bg-success-bg text-success gap-1"><Check className="w-3 h-3" /> Bill Settled</Badge>
                      ) : null
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={handleChangePatient}>Change Patient</Button>
                </div>
              )}
            </div>

            <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Add Product */}
                  <div className="md:col-span-2 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
                    <div className="p-4 border-b bg-muted/30">
                      <h3 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Add Product</h3>
                    </div>
                    <div className="p-4 space-y-3">
                      {patientSchemes.length > 0 && (
                        <p className="text-xs text-info">
                          Only drugs priced under this patient's insurance ({patientSchemes[0].scheme_name}) are shown.
                        </p>
                      )}
                      {(() => {
                        const eligibleDrugs = patientSchemes.length > 0
                          ? drugs.filter((d: any) => schemeProductPricing.some((p: any) => p.product_id === d.id))
                          : drugs;
                        const selectedDrug = drugs.find((d: any) => d.id === addLineDrugId);
                        const schemePricing = selectedDrug ? schemeProductPricing.find((p: any) => p.product_id === selectedDrug.id) : null;
                        const basePrice = salePrice !== '' ? (parseFloat(salePrice) || 0) : (selectedDrug ? parseFloat(selectedDrug.selling_price) || 0 : 0);
                        const discountNum = parseFloat(saleDiscountAmount) || 0;
                        const discountedPrice = discountNum > 0
                          ? Math.max(0, saleDiscountType === 'percent' ? basePrice * (1 - discountNum / 100) : basePrice - discountNum)
                          : basePrice;
                        const previewQty = parseInt(addLineQty, 10) || 0;
                        // Stock is worth knowing before the click, not after it. Adding a
                        // drug with none left was rejected only once Add had been pressed,
                        // by which point the pharmacist had already told the patient it was
                        // going on the bill.
                        const stockLeft = selectedDrug && selectedDrug.stock_on_hand != null
                          ? parseFloat(selectedDrug.stock_on_hand)
                          : null;
                        const knownStock = stockLeft != null && !isNaN(stockLeft);
                        const outOfStock = knownStock && stockLeft <= 0;
                        // previewQty is a dose-unit count (tablets), stockLeft is pack-
                        // tracked (strips/bottles) — compare like units via packEquivalent.
                        const notEnoughStock = knownStock && packEquivalent(previewQty, selectedDrug) > stockLeft;
                        // discountedPrice is "price per pack" same as selling_price —
                        // billed by the pack-equivalent of previewQty, not the raw dose count.
                        const lineTotal = discountedPrice * packEquivalent(previewQty, selectedDrug);
                        return (
                          <>
                            <div>
                              <Label className="text-xs font-medium text-muted-foreground">Product</Label>
                              <Combobox
                                options={eligibleDrugs.map((d: any) => ({ value: d.id, label: d.drug_name }))}
                                value={addLineDrugId}
                                onChange={v => {
                                  setAddLineDrugId(v);
                                  const d = drugs.find((x: any) => x.id === v);
                                  setSalePrice(d ? (parseFloat(d.selling_price) || 0).toFixed(2) : '');
                                }}
                                placeholder="Select product..."
                                searchPlaceholder="Search products..."
                                className="mt-1"
                              />
                              {patientSchemes.length > 0 && eligibleDrugs.length === 0 && (
                                <p className="text-xs text-destructive mt-1">No drugs have an insurance price configured for this scheme yet — add one in Scheme Management first.</p>
                              )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="rounded-lg border p-3 bg-muted/20 space-y-1.5">
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quantity</p>
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <Label className="text-xs font-medium text-muted-foreground">Qty</Label>
                                    <Input type="number" min="1" value={addLineQty} onChange={e => setAddLineQty(e.target.value)} className="mt-1" />
                                  </div>
                                  <div>
                                    <Label className="text-xs font-medium text-muted-foreground">UOM</Label>
                                    <Input value={selectedDrug ? doseUnitLabel(selectedDrug) : ''} readOnly disabled className="mt-1 bg-muted/40" />
                                  </div>
                                  <div>
                                    <Label className={cn('text-xs font-medium whitespace-nowrap', outOfStock ? 'text-destructive' : 'text-muted-foreground')}>Stock</Label>
                                    <Input
                                      // Stock is pack-tracked (Strip/Bottle/etc.) while Qty/UOM
                                      // above are dose units — labeled with the item's own
                                      // unit_of_measure so the two aren't mistaken for the same unit.
                                      value={selectedDrug?.stock_on_hand != null ? `${selectedDrug.stock_on_hand} ${selectedDrug.unit_of_measure || ''}`.trim() : ''}
                                      readOnly
                                      disabled
                                      className={cn('mt-1', outOfStock ? 'bg-destructive-bg border-destructive-border text-destructive font-semibold' : 'bg-muted/40')}
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-lg border p-3 bg-muted/20 space-y-1.5">
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pricing</p>
                                {patientSchemes.length > 0 && schemePricing ? (
                                  <div className="text-xs font-semibold text-info inline-flex items-center gap-1 py-1.5">
                                    <Shield className="w-3 h-3" /> {schemeCurrencyCode} {parseFloat(schemePricing.scheme_price).toFixed(2)} (insurance)
                                  </div>
                                ) : (
                                  <>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Price</Label>
                                        <Input value={salePrice} readOnly disabled className="mt-1 bg-muted/40" />
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Total</Label>
                                        <Input value={selectedDrug ? fmt(lineTotal) : ''} readOnly disabled className="mt-1 bg-muted/40 font-medium text-foreground" />
                                      </div>
                                    </div>
                                    <div>
                                      <Label className="text-xs font-medium text-muted-foreground">Discount</Label>
                                      <div className="mt-1 flex gap-1">
                                        <button
                                          type="button"
                                          onClick={() => setSaleDiscountType('percent')}
                                          title="Percent discount"
                                          className={cn('h-9 px-2 rounded-md border text-xs font-medium transition-colors flex-shrink-0', saleDiscountType === 'percent' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-input hover:bg-muted/50')}
                                        >
                                          %
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setSaleDiscountType('value')}
                                          title="Cash discount"
                                          className={cn('h-9 px-2 rounded-md border text-xs font-medium transition-colors flex-shrink-0', saleDiscountType === 'value' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-input hover:bg-muted/50')}
                                        >
                                          Cash
                                        </button>
                                        <Input
                                          type="number" min="0" step="0.01"
                                          placeholder={saleDiscountType === 'percent' ? '10' : '500'}
                                          value={saleDiscountAmount}
                                          onChange={e => setSaleDiscountAmount(e.target.value)}
                                          className="flex-1"
                                        />
                                      </div>
                                    </div>
                                    {selectedDrug && discountNum > 0 && (
                                      <p className="text-xs text-muted-foreground">
                                        Price after discount: <span className="font-medium text-foreground">{fmt(discountedPrice)}</span>
                                        {' '}<span className="line-through">{fmt(basePrice)}</span>
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            {selectedDrug && (outOfStock || notEnoughStock) && (
                              <p className="text-xs text-destructive flex items-center gap-1.5">
                                <PackageX className="w-3.5 h-3.5 shrink-0" />
                                {outOfStock
                                  ? `${selectedDrug.drug_name} is out of stock — receive stock before billing it.`
                                  : `Only ${stockLeft} ${selectedDrug.unit_of_measure || 'unit'}(s) of ${selectedDrug.drug_name} in stock — reduce the quantity.`}
                              </p>
                            )}

                            <div className="flex justify-end">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleAddProduct()}
                                disabled={addingLine || outOfStock || notEnoughStock}
                                title={outOfStock ? 'Out of stock' : notEnoughStock ? 'Not enough stock for that quantity' : undefined}
                              >
                                {addingLine ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
                                Add
                              </Button>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Record Payment */}
                  <div className="md:col-span-1 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
                    <div className="p-4 border-b bg-muted/30">
                      <h3 className="font-semibold flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-primary" />
                        Record Payment
                      </h3>
                    </div>
                    <div className="p-4">
                      {/* checkingBill also flips true on every background re-check after each
                          add/remove/qty-change (openRx re-runs it) — only blank the whole
                          section out for the true first load (no bill fetched yet at all).
                          Once a bill has loaded once, a re-check updates the numbers in place
                          instead of replacing the card with a spinner each time. */}
                      {checkingBill && !activeBill ? (
                        <LoadingState size="sm" message="" className="py-8" />
                      ) : !activeBill ? (
                        <div className="text-sm text-muted-foreground text-center py-8">Add a product to generate a bill for this patient.</div>
                      ) : (
                        <div className="space-y-4">
                          <div className="rounded-lg border divide-y">
                            <div className="px-3.5 py-2.5 flex items-center justify-between">
                              <span className="text-sm font-medium text-muted-foreground">Order Total</span>
                              <span className="text-base font-semibold">{fmtDual(orderTotal)}</span>
                            </div>
                            <div className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                              <div>
                                <span className={cn("text-sm font-semibold", billBalance > 0 ? "text-destructive" : "text-success")}>
                                  {billBalance > 0 ? 'Balance Due' : 'Bill Settled'}
                                </span>
                                <span className={cn("block text-base font-bold", billBalance > 0 ? "text-destructive" : "text-success")}>{fmtDual(billBalance)}</span>
                              </div>
                              <Button size="sm" variant="outline" className="shrink-0" onClick={() => navigate(`/patients-bill/${activeBill.id}`)} title="Open this bill on Patient Bills to invoice or review it in full">
                                <FileText className="w-3.5 h-3.5 mr-1.5" /> View Bill
                              </Button>
                            </div>
                          </div>
                          {patientSchemes.length > 0 && (
                            <div className="px-3 py-2.5 rounded-lg border border-info-border bg-info-bg text-xs text-info">
                              Active membership: {patientSchemes.map((s: any) => s.scheme_name).join(', ')} — pick "Credit (Invoice)" below to bill this to a scheme/insurance instead of collecting cash now.
                            </div>
                          )}

                          {!hasActiveShift && paymentForm.method !== 'credit' && (
                            <div className="px-3 py-2.5 rounded-lg border border-warning-border bg-warning-bg text-xs text-warning flex items-center gap-2">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> No active cashier shift — start one before recording this payment.
                            </div>
                          )}

                          {paymentForm.method === 'credit' && (
                            <div className="px-3 py-2.5 rounded-lg border border-info-border bg-info-bg text-xs text-info flex items-center gap-2">
                              <CreditCard className="w-3.5 h-3.5 flex-shrink-0" /> No money is collected now — this creates an invoice due later, payable from the Invoices page. Dispensing still stays blocked until the balance clears.
                            </div>
                          )}

                          <div>
                            <Label className="text-xs font-medium text-muted-foreground">{paymentForm.method === 'credit' ? 'Amount to Invoice' : 'Amount'}</Label>
                            <Input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="mt-1.5" />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs font-medium text-muted-foreground">Method</Label>
                              <Combobox
                                options={PAYMENT_METHODS}
                                value={paymentForm.method}
                                onChange={v => setPaymentForm({ ...paymentForm, method: v })}
                                searchPlaceholder="Search..."
                                className="mt-1.5 h-9"
                              />
                            </div>
                            {paymentForm.method === 'credit' ? (
                              <div>
                                <Label className="text-xs font-medium text-muted-foreground">Terms (days)</Label>
                                <Input type="number" min="1" value={paymentForm.paymentTerms} onChange={e => setPaymentForm({ ...paymentForm, paymentTerms: e.target.value })} className="mt-1.5" />
                              </div>
                            ) : (
                              <div>
                                <Label className="text-xs font-medium text-muted-foreground">Date</Label>
                                <Input type="date" value={paymentForm.date} onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })} className="mt-1.5" />
                              </div>
                            )}
                          </div>

                          {paymentForm.method === 'credit' && (
                            <div>
                              <Label className="text-xs font-medium text-muted-foreground">Link to a Scheme / Insurance (optional)</Label>
                              <Combobox
                                options={[
                                  { value: '', label: 'No scheme — plain credit' },
                                  ...schemes.map((s: any) => ({ value: s.id, label: `${s.scheme_name}${s.is_insurance ? ' (Insurance)' : ''}` })),
                                ]}
                                value={paymentForm.schemeId}
                                onChange={v => setPaymentForm({ ...paymentForm, schemeId: v })}
                                placeholder="No scheme — plain credit"
                                searchPlaceholder="Search schemes..."
                                className="mt-1.5 h-9"
                              />
                            </div>
                          )}

                          {paymentForm.method !== 'cash' && (
                            <div>
                              <Label className="text-xs font-medium text-muted-foreground">Reference No.</Label>
                              <Input
                                value={paymentForm.reference}
                                onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                                placeholder={paymentForm.method === 'credit' ? 'Account / PO / claim reference' : paymentForm.method === 'check' ? 'Cheque number' : 'Transaction reference'}
                                className="mt-1.5"
                              />
                            </div>
                          )}

                          <div>
                            <Label className="text-xs font-medium text-muted-foreground">Notes (optional)</Label>
                            <Input value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} className="mt-1.5" />
                          </div>

                          <Button className="w-full" onClick={handleSavePayment} disabled={paying || dispensing || payableBillBalance <= 0 || (paymentForm.method !== 'credit' && !hasActiveShift)}>
                            {paying || dispensing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                            {payableBillBalance <= 0
                              ? (paymentForm.method === 'credit' ? 'Nothing to Invoice' : 'Awaiting Invoice Payment')
                              : paymentForm.method === 'credit'
                              ? 'Create Invoice'
                              : Object.values(checkedLines).some(Boolean) ? 'Save Payment & Dispense' : 'Save Payment'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bill Items — full width, matching /patients-bill.
                    min-w-0 on the card and its body: a flex item's default
                    min-width:auto makes it as wide as its widest cell, so the
                    card outgrew the page and overflow-hidden cropped the table
                    instead of the table scrolling within it. The medication
                    name and the out-of-stock note are both long enough to
                    trigger it, which put Total off the right edge with no way
                    to reach it. */}
                {/* shrink-0: this is a flex child of a column, and a flex item
                    shrinks below its content by default. With the page short on
                    room the card was compressed and its own overflow-hidden cut
                    the table off mid-row — the rows were there, just cropped. */}
                <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden min-w-0 shrink-0">
                  <div className="p-4 border-b bg-muted/30">
                    <h3 className="font-semibold flex items-center gap-2"><ClipboardList className="w-4 h-4 text-primary" /> Bill Items</h3>
                  </div>
                  <div className="p-4 min-w-0">
                    {detailLoading ? (
                      <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : !selectedRx ? (
                      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
                        <ClipboardList className="w-10 h-10 text-muted-foreground/25" />
                        {saleForm.person_id ? 'No products added for this patient yet.' : 'Select a patient above, then add a product to start a bill.'}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {checkingBill ? (
                          <div className="px-3.5 py-2.5 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking billing status...
                          </div>
                        ) : billBalance > 0 && activeBill?.scheme_id ? (
                          <div className="px-3.5 py-3 rounded-lg border border-info-border bg-info-bg text-xs text-info flex items-center gap-2.5">
                            <Shield className="w-4 h-4 flex-shrink-0" />
                            Billed under scheme {activeBill.scheme_name || ''} ({fmt(billBalance)}) — the cashier will invoice this later, so dispensing is not blocked.
                          </div>
                        ) : activeBill && billBalance <= 0 ? (
                          <div className="px-3.5 py-3 rounded-lg border border-success-border bg-success-bg text-xs text-success flex items-center gap-2.5">
                            <Check className="w-4 h-4 flex-shrink-0" />
                            Bill {activeBill.bill_number} is settled — dispensing is unblocked.
                          </div>
                        ) : null}
                        {(() => {
                          const activeLines = (selectedRx.lines || []).filter((l: any) => l.status !== 'cancelled');
                          if (activeLines.length === 0) {
                            return <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg">No medications on this prescription.</div>;
                          }
                          const billServices = activeBill ? parseServices(activeBill.services) : [];
                          // The bill is the source of truth for what's actually charged in SSP —
                          // only fall back to the raw catalog price when there's no bill yet to match against.
                          const findBillService = (l: any) => billServices.find((s: any) =>
                            !s.isVoided && String(s.serviceName || '').toLowerCase() === String(l.drug_name || '').toLowerCase() && Number(s.quantity) === Number(l.quantity_prescribed)
                          );
                          const isInsured = patientSchemes.length > 0;
                          const billHasScheme = !!activeBill?.scheme_id;
                          // Scheme prices are informational only — kept in their own currency, never
                          // converted or folded into the SSP order total (this app's bills only carry
                          // one currency total, so a differently-priced scheme item has to stand apart).
                          // Not applicable once the bill itself is scheme-priced (billHasScheme) — those
                          // items are already folded into orderTotal above, so a separate claim here
                          // would double-bill the insurer for the same items.
                          const schemeTotal = billHasScheme ? 0 : activeLines.reduce((sum: number, l: any) => {
                            const sp = schemeProductPricing.find((p: any) => p.product_id === l.drug_id);
                            return sp ? sum + (parseFloat(sp.scheme_price) || 0) * (l.quantity_prescribed || 0) : sum;
                          }, 0);
                          return (
                            <div className="border rounded-xl overflow-x-auto min-w-0">
                              <AdvancedDataTable<any>
                                data={activeLines}
                                keyExtractor={(l) => l.id}
                                searchable
                                searchPlaceholder="Search medications..."
                                exportable
                                exportFileName={`${selectedRx.prescription_number}-medications`}
                                // Hold the list to five rows and scroll past them. A
                                // prescription with a dozen items otherwise grew the card
                                // taller than the space it had, and the rows past the edge
                                // were cropped rather than reachable. The header stays put
                                // while scrolling so the columns remain labelled.
                                maxRows={5}
                                pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
                                rowClassName={(l) => {
                                  const remaining = l.quantity_prescribed - (l.total_quantity_dispensed || 0);
                                  const schemePricing = schemeProductPricing.find((p: any) => p.product_id === l.drug_id);
                                  const hasSchemePrice = !!schemePricing;
                                  const missingInsurancePrice = isInsured && !billHasScheme && !hasSchemePrice;
                                  const stockOnHand = l.stock_on_hand != null ? parseFloat(l.stock_on_hand) : null;
                                  const insufficientStock = stockOnHand != null && !isNaN(stockOnHand) && stockOnHand < packEquivalent(remaining, l);
                                  const selectable = (l.status === 'pending' || l.status === 'partial') && remaining > 0 && !missingInsurancePrice && !insufficientStock;
                                  return !selectable ? 'opacity-50' : '';
                                }}
                                columns={[
                                  {
                                    key: '__select', header: '', width: '2rem',
                                    render: (_v, l) => {
                                      const remaining = l.quantity_prescribed - (l.total_quantity_dispensed || 0);
                                      const schemePricing = schemeProductPricing.find((p: any) => p.product_id === l.drug_id);
                                      const hasSchemePrice = !!schemePricing;
                                      const missingInsurancePrice = isInsured && !billHasScheme && !hasSchemePrice;
                                      const stockOnHand = l.stock_on_hand != null ? parseFloat(l.stock_on_hand) : null;
                                      const insufficientStock = stockOnHand != null && !isNaN(stockOnHand) && stockOnHand < packEquivalent(remaining, l);
                                      const selectable = (l.status === 'pending' || l.status === 'partial') && remaining > 0 && !missingInsurancePrice && !insufficientStock;
                                      return (
                                        <input
                                          type="checkbox"
                                          disabled={!selectable}
                                          checked={!!checkedLines[l.id]}
                                          onChange={() => toggleLine(l.id)}
                                          className="rounded"
                                        />
                                      );
                                    },
                                  },
                                  {
                                    key: 'drug_name', header: 'Medication',
                                    render: (v, l) => (
                                      <>
                                        <p className="font-medium">{v}</p>
                                        {(l.dose_strength || l.frequency) && (
                                          <p className="text-xs text-muted-foreground mt-0.5">{[l.dose_strength, l.frequency].filter(Boolean).join(' · ')}</p>
                                        )}
                                      </>
                                    ),
                                  },
                                  { key: 'unit_of_measure', header: 'UOM', render: (v) => <span className="whitespace-nowrap text-muted-foreground">{v || 'unit'}</span> },
                                  {
                                    key: '__unit_price', header: 'Unit Price',
                                    render: (_v, l) => {
                                      const billService = findBillService(l);
                                      const unitPrice = billService ? parseFloat(billService.unitPrice) || 0 : parseFloat(l.selling_price) || 0;
                                      const schemePricing = schemeProductPricing.find((p: any) => p.product_id === l.drug_id);
                                      const hasSchemePrice = !!schemePricing;
                                      const schemeUnitPrice = schemePricing ? parseFloat(schemePricing.scheme_price) || 0 : 0;
                                      const missingInsurancePrice = isInsured && !billHasScheme && !hasSchemePrice;
                                      return (
                                        <div className="whitespace-nowrap">
                                          {repricingLineId === l.id ? (
                                            <div className="text-xs text-info inline-flex items-center gap-1">
                                              <Loader2 className="w-3 h-3 animate-spin" /> Updating billed price…
                                            </div>
                                          ) : missingInsurancePrice ? (
                                            <div className="text-xs font-medium text-destructive bg-destructive-bg border border-destructive-border rounded px-1.5 py-1 w-fit max-w-[160px]">
                                              No insurance price — add insurance price first
                                            </div>
                                          ) : hasSchemePrice && !billHasScheme ? (
                                            <div className="text-xs font-semibold text-info inline-flex items-center gap-1" title="This patient's insurance price — tracked separately in this currency for the insurance claim, never shown or billed in SSP">
                                              <Shield className="w-3 h-3" />
                                              {schemeCurrencyCode} {schemeUnitPrice.toFixed(2)}
                                            </div>
                                          ) : (
                                            <span className={cn(hasSchemePrice && billHasScheme ? "text-info font-medium inline-flex items-center gap-1" : "text-muted-foreground")} title={hasSchemePrice && billHasScheme ? "Scheme rate — already included in this bill's total" : undefined}>
                                              {hasSchemePrice && billHasScheme && <Shield className="w-3 h-3" />}
                                              {fmt(unitPrice)}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    },
                                  },
                                  {
                                    key: 'quantity_prescribed', header: 'Qty',
                                    render: (v, l) => {
                                      const removable = (l.total_quantity_dispensed || 0) === 0;
                                      return (
                                        <div className="whitespace-nowrap">
                                          {editingLineId === l.id ? (
                                            <span className="inline-flex items-center gap-1">
                                              <Input
                                                type="number" min="1" autoFocus
                                                value={editQty}
                                                onChange={e => setEditQty(e.target.value)}
                                                className="w-16 h-8 text-sm px-1.5"
                                              />
                                              <button type="button" onClick={() => handleSaveLineQty(l)} disabled={savingLineQty} className="text-success hover:text-success">
                                                {savingLineQty ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-4 h-4" />}
                                              </button>
                                              <button type="button" onClick={() => setEditingLineId(null)} className="text-muted-foreground hover:text-foreground">
                                                <X className="w-4 h-4" />
                                              </button>
                                            </span>
                                          ) : (
                                            <span className="inline-flex items-center gap-1.5">
                                              {v}
                                              {removable && (
                                                <button type="button" onClick={() => startEditLineQty(l)} title="Adjust quantity — updates the bill total too" className="text-muted-foreground hover:text-primary">
                                                  <Pencil className="h-3.5 w-3.5" />
                                                </button>
                                              )}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    },
                                  },
                                  {
                                    key: 'created_at', header: 'Added', sortable: true,
                                    render: (v) => <span className="whitespace-nowrap text-muted-foreground text-xs">{v ? new Date(v).toLocaleString() : '—'}</span>,
                                  },
                                  {
                                    key: 'status', header: 'Status',
                                    render: (v, l) => {
                                      const remaining = l.quantity_prescribed - (l.total_quantity_dispensed || 0);
                                      const schemePricing = schemeProductPricing.find((p: any) => p.product_id === l.drug_id);
                                      const hasSchemePrice = !!schemePricing;
                                      const missingInsurancePrice = isInsured && !billHasScheme && !hasSchemePrice;
                                      const stockOnHand = l.stock_on_hand != null ? parseFloat(l.stock_on_hand) : null;
                                      const insufficientStock = stockOnHand != null && !isNaN(stockOnHand) && stockOnHand < packEquivalent(remaining, l);
                                      const selectable = (v === 'pending' || v === 'partial') && remaining > 0 && !missingInsurancePrice && !insufficientStock;
                                      return insufficientStock ? (
                                        <span className="inline-flex flex-col gap-0.5">
                                          <Badge variant="outline" className="w-fit gap-1 border-destructive-border bg-destructive-bg text-destructive"><PackageX className="w-3 h-3" /> Out of stock</Badge>
                                          <span className="text-xs text-destructive">Only {stockOnHand} {l.pack_unit_of_measure || ''} in stock — restock to dispense</span>
                                        </span>
                                      ) : (
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "capitalize font-medium",
                                            selectable ? "border-info-border bg-info-bg text-info" : v === 'dispensed' ? "border-success-border bg-success-bg text-success" : "border-border bg-muted text-muted-foreground"
                                          )}
                                        >
                                          {v}
                                        </Badge>
                                      );
                                    },
                                  },
                                  {
                                    key: '__total', header: 'Total', align: 'right',
                                    render: (_v, l) => {
                                      const billService = findBillService(l);
                                      const unitPrice = billService ? parseFloat(billService.unitPrice) || 0 : parseFloat(l.selling_price) || 0;
                                      const lineTotal = billService ? parseFloat(billService.totalPrice) || 0 : unitPrice * (l.quantity_prescribed || 0);
                                      const schemePricing = schemeProductPricing.find((p: any) => p.product_id === l.drug_id);
                                      const hasSchemePrice = !!schemePricing;
                                      const schemeUnitPrice = schemePricing ? parseFloat(schemePricing.scheme_price) || 0 : 0;
                                      const missingInsurancePrice = isInsured && !billHasScheme && !hasSchemePrice;
                                      return (
                                        <span className="font-semibold whitespace-nowrap">
                                          {missingInsurancePrice ? '—' : hasSchemePrice ? `${schemeCurrencyCode} ${(schemeUnitPrice * (l.quantity_prescribed || 0)).toFixed(2)}` : fmt(lineTotal)}
                                        </span>
                                      );
                                    },
                                  },
                                  {
                                    key: '__remove', header: '', width: '2rem',
                                    render: (_v, l) => {
                                      const removable = (l.total_quantity_dispensed || 0) === 0;
                                      return removable ? (
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveLine(l)}
                                          disabled={removingLineId === l.id}
                                          title="Remove this item before it's dispensed"
                                          className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                                        >
                                          {removingLineId === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                                        </button>
                                      ) : null;
                                    },
                                  },
                                ]}
                              />

                              {/* Balance/Order Total now live in the Record Payment card instead of
                                  repeating here — only the insurance claim action (unrelated to
                                  paying the SSP balance) stays with the table. */}
                              {schemeTotal > 0 && (
                                <div className="border-t px-4 py-3 flex items-center justify-between gap-3 bg-info-bg/60">
                                  <div>
                                    <span className="text-sm font-medium text-info">Scheme Total</span>
                                    <span className="block text-xs text-info">{schemeCurrencyCode} {schemeTotal.toFixed(2)} — claimable from insurer</span>
                                  </div>
                                  <Button
                                    size="sm" variant="outline" className="border-info-border text-info hover:bg-info-bg shrink-0"
                                    onClick={handleCreateInsuranceInvoice}
                                    disabled={creatingInsuranceInvoice || insuranceInvoicedRxId === selectedRx.id}
                                  >
                                    {creatingInsuranceInvoice ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Shield className="w-3.5 h-3.5 mr-1.5" />}
                                    {insuranceInvoicedRxId === selectedRx.id ? 'Invoiced' : 'Create Insurance Invoice'}
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                  {selectedRx && (selectedRx.lines || []).length > 0 && (() => {
                    // Nothing ticked means there is nothing for the button to do. It used
                    // to stay enabled and fail on the click, which reads as the screen
                    // being broken rather than as "you haven't chosen anything yet".
                    const selectedCount = Object.values(checkedLines).filter(Boolean).length;
                    const blockedByBalance = billBalance > 0 && !activeBill?.scheme_id;
                    return (
                    <div className="p-4 border-t bg-muted/30 flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">
                        {selectedCount > 0
                          ? `${selectedCount} item${selectedCount > 1 ? 's' : ''} selected`
                          : 'Select items above to dispense'}
                      </span>
                      <Button
                        onClick={handleDispense}
                        disabled={dispensing || checkingBill || blockedByBalance || selectedCount === 0}
                        title={selectedCount === 0 ? 'Tick the items to dispense first' : undefined}
                      >
                        {dispensing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                        Dispense Selected
                      </Button>
                    </div>
                    );
                  })()}
                </div>
            </>
          </div>
        ) : (
          <div className="mt-6 flex-1 min-h-0 bg-card rounded-lg border shadow-sm p-0 flex flex-col overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
              <h3 className="font-semibold flex items-center gap-2"><History className="w-4 h-4 text-primary" /> Dispensing Records</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative w-56">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input placeholder="Search records..." className="pl-8 h-9" value={historySearch} onChange={e => setHistorySearch(e.target.value)} />
                </div>
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <Input type="date" className="h-9 w-[150px]" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" className="h-9 w-[150px]" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} />
                <Button variant="outline" size="icon" aria-label="Refresh" className="h-9 w-9" onClick={fetchHistory} disabled={historyLoading}>
                  <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <AdvancedDataTable<any>
                data={filteredHistory}
                keyExtractor={(h) => h.id}
                loading={historyLoading}
                emptyMessage="No dispensing records found."
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'dispensing_number', header: 'Dispensing No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium whitespace-nowrap">{v}</span> },
                  { key: 'patient_name', header: 'Patient', render: (v) => v || 'Unknown' },
                  { key: 'drug_name', header: 'Drug', render: (v) => <span className="text-muted-foreground">{v}</span> },
                  { key: 'quantity_dispensed', header: 'Qty', sortable: true, render: (v) => <span className="whitespace-nowrap">{v}</span> },
                  {
                    key: '__amount', header: 'Amount', align: 'right',
                    render: (_v, h) => <span className="font-medium whitespace-nowrap">{fmt((parseFloat(h.unit_price) || 0) * (h.quantity_dispensed || 0))}</span>,
                  },
                  { key: 'pharmacist_name', header: 'Pharmacist', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                  { key: 'dispensing_date', header: 'Date', sortable: true, render: (v) => <span className="text-muted-foreground whitespace-nowrap">{v ? formatDate(v) : '—'}</span> },
                ]}
              />
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Start Cashier Shift Modal */}
      {showStartShiftModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-sm rounded-xl shadow-lg border overflow-hidden flex flex-col">
            <div className="flex justify-between items-center px-5 py-4 border-b bg-muted/30">
              <h3 className="font-semibold text-base flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Start Cashier Shift</h3>
              <Button variant="ghost" size="icon" aria-label="Close" className="h-8 w-8" onClick={() => setShowStartShiftModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="px-5 py-5">
              <Label className="text-xs font-medium text-muted-foreground">Opening Balance</Label>
              <Input type="number" min="0" step="0.01" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} placeholder="0.00" className="mt-1.5" />
            </div>
            <div className="px-5 py-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowStartShiftModal(false)}>Cancel</Button>
              <Button onClick={startShift} disabled={startingShift}>
                {startingShift ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Start Shift
              </Button>
            </div>
          </div>
        </div>
      )}

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
            <div className="flex justify-between items-center px-5 py-4 border-b bg-muted/30">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                Invoice Created
              </h3>
              <Button variant="ghost" size="icon" aria-label="Close" className="h-8 w-8" onClick={() => setInvoiceData(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="px-5 py-5 space-y-2.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Invoice No.</span><span className="font-mono text-primary font-medium">{invoiceData.invoice_number}</span></div>
              {invoiceData.bill_number && <div className="flex justify-between"><span className="text-muted-foreground">Bill No.</span><span>{invoiceData.bill_number}</span></div>}
              {invoiceData.scheme_name && <div className="flex justify-between"><span className="text-muted-foreground">Scheme</span><span>{invoiceData.scheme_name}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Patient</span><span>{invoiceData.patient_name}</span></div>
              <div className="flex justify-between pt-2 border-t">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-bold text-base">{invoiceData.currency && invoiceData.currency !== currency.code ? `${invoiceData.currency} ${(parseFloat(invoiceData.amount) || 0).toFixed(2)}` : fmt(invoiceData.amount)}</span>
              </div>
            </div>
            <div className="px-5 py-4 border-t bg-muted/30 flex justify-end">
              <Button onClick={() => setInvoiceData(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
