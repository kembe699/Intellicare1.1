import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import {
  Receipt, Plus, RefreshCw, Search, X, Check, Loader2, CreditCard,
  Eye, AlertTriangle, Printer, Wallet, ChevronDown, ChevronUp, Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { fetchPatientDirectory } from '@/lib/patientDirectory';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from 'sonner';
import { PaymentReceipt, printThermalReceipt, printReceiptWhenPainted } from '@/components/receipts/PaymentReceipt';
import { DepositReceipt } from '@/components/receipts/DepositReceipt';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'check', label: 'Cheque' },
  { value: 'credit', label: 'Credit (Invoice)' },
];

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
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

const amt = (v: any) => parseFloat(v) || 0;
// A line billed at 0 in SSP with its real price only stashed for a separate insurance
// claim — same convention as BillDetails.tsx. Nothing collectible on this bill for it.
const isUnbilledInsuranceLine = (s: any) => s.schemePrice != null && amt(s.unitPrice) === 0;
// Payable here: not voided, not already paid, not an unbilled insurance claim, and not
// already covered by an earlier credit invoice (payable only from the Invoices page).
const isPayableLine = (s: any) => !s.paid && !s.isVoided && !isUnbilledInsuranceLine(s) && !s.invoiced;

export default function PatientsBill() {
  const { user } = useAuth();
  const { facilityName, branchName } = useFacilityInfo();
  const navigate = useNavigate();
  const clinicId = user?.clinic || 1;

  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState(() => toLocalDateStr(new Date()));
  const [filterDateTo, setFilterDateTo] = useState(() => toLocalDateStr(new Date()));

  const [hasActiveShift, setHasActiveShift] = useState(false);
  const [checkingShift, setCheckingShift] = useState(true);
  const [showStartShiftModal, setShowStartShiftModal] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('');
  const [startingShift, setStartingShift] = useState(false);

  const [people, setPeople] = useState<any[]>([]); // merged patients + LIS participants
  const [newBillForm, setNewBillForm] = useState({ person_id: '' });
  const [creatingBill, setCreatingBill] = useState(false);
  const [personSearch, setPersonSearch] = useState('');
  const [personDropdownOpen, setPersonDropdownOpen] = useState(false);

  // "Create New Bill" now just picks a patient and hands off to their bill on
  // /patients-bill/:billId — Add Service/Product, scheme pricing, and payment all live
  // there already, so this page doesn't need its own parallel cart/scheme-mode UI.
  const [showNewBillModal, setShowNewBillModal] = useState(false);
  const [newBillSearch, setNewBillSearch] = useState('');
  const [showWalkinForm, setShowWalkinForm] = useState(false);
  const [walkinForm, setWalkinForm] = useState({ full_name: '', gender: '', phone: '' });
  const [registeringWalkin, setRegisteringWalkin] = useState(false);

  const [selectedBill, setSelectedBill] = useState<any | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash', date: toLocalDateStr(new Date()), reference: '', notes: '', paymentTerms: '30', schemeId: '' });
  const [paying, setPaying] = useState(false);
  const [schemes, setSchemes] = useState<any[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  const [receiptData, setReceiptData] = useState<{ bill: any; payment: any } | null>(null);
  const [invoiceData, setInvoiceData] = useState<any | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  // Patient Deposit (prepaid wallet) — balance/history are for whichever patient is
  // currently selected in the "Create New Bill" panel, same scope as patientActiveBill.
  const [depositBalance, setDepositBalance] = useState<{ balance: number; currency: string; totalDeposited: number; totalUsed: number; totalRefunded: number } | null>(null);
  const [depositHistory, setDepositHistory] = useState<any[]>([]);
  const [showDepositHistory, setShowDepositHistory] = useState(false);
  const [loadingDepositHistory, setLoadingDepositHistory] = useState(false);
  const [showAcceptDepositModal, setShowAcceptDepositModal] = useState(false);
  const [showRefundDepositModal, setShowRefundDepositModal] = useState(false);
  const [depositForm, setDepositForm] = useState({ amount: '', method: 'cash', notes: '' });
  const [refundForm, setRefundForm] = useState({ amount: '', method: 'cash', notes: '' });
  const [takingDeposit, setTakingDeposit] = useState(false);
  const [refundingDeposit, setRefundingDeposit] = useState(false);
  // Refunding is gated server-side by the deposit_refund_approve permission — this only
  // controls whether the button is shown/enabled, the real enforcement is on the backend.
  const [canRefundDeposit, setCanRefundDeposit] = useState(false);
  const [depositReceiptData, setDepositReceiptData] = useState<{
    kind: 'deposit' | 'refund'; patientName: string; patientId: string; amount: number;
    newBalance: number; currency: string; method: string; date: string; notes?: string; receiptNumber?: string;
  } | null>(null);
  const depositReceiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchBills();
    fetchShift();
    fetchPeople();
    fetchSchemes();
  }, []);

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

  // Same auto-print pattern for a deposit/refund receipt.
  useEffect(() => {
    if (!depositReceiptData) return;
    // Wait for the off-screen receipt to actually paint rather than assuming a
    // fixed delay is enough — a slow render used to print a receipt with the
    // patient's details blank.
    const cancel = printReceiptWhenPainted(
      () => depositReceiptRef.current,
      (printed) => {
        setDepositReceiptData(null);
        if (!printed) toast.error('Receipt could not be prepared for printing — reprint it from the Receipts page');
      }
    );
    return cancel;
  }, [depositReceiptData]);

  // Whether this user can refund a deposit — admins always can; everyone else needs the
  // deposit_refund_approve grant (checked here from the same list the Approvals admin page
  // manages). The server independently enforces this on the refund endpoint regardless.
  useEffect(() => {
    if (user?.role === 'admin') { setCanRefundDeposit(true); return; }
    (async () => {
      try {
        const res = await authFetch(`/api/approvals/permissions?clinic_id=${clinicId}`, { credentials: 'include' });
        if (res.ok) {
          const grants = await res.json();
          setCanRefundDeposit(grants.some((g: any) => g.approval_type === 'deposit_refund_approve' && String(g.user_id) === String(user?.uid)));
        }
      } catch { /* leave as false */ }
    })();
  }, [user?.uid, user?.role, clinicId]);

  const fetchSchemes = async () => {
    try {
      const res = await authFetch(`/api/schemes/active?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setSchemes(await res.json());
    } catch (e) {
      console.error('Failed to fetch schemes', e);
    }
  };

  // Fetches the full clinic bill list (no server-side date filter — created_at is stored in
  // UTC, so a raw server-side date comparison would wrongly hide bills created in the first
  // few hours of the local day). Date range is applied client-side instead, the same way the
  // /lis/registration Patient Directory does it, using each browser's own local calendar day.
  const fetchBills = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/patient-bills/clinic/${clinicId}`, { credentials: 'include' });
      if (res.ok) setBills(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch bills');
    } finally {
      setLoading(false);
    }
  };

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

  // Merges the main Patient Registry with LIS-registered patients so both are billable here.
  const fetchPeople = async () => {
    const { people, failed } = await fetchPatientDirectory();
    setPeople(people);
    if (failed.length) {
      // A half that cannot be read must say so. Silently showing the other half
      // is how a permission error came to look like "this patient doesn't exist".
      toast.error(`Could not load ${failed.join(' and ')} — the patient list is incomplete.`);
    }
  };

  const fetchPatientDepositBalance = async (patientId: string) => {
    try {
      const res = await authFetch(`/api/patient-deposits/${patientId}/balance?clinic_id=${clinicId}`, { credentials: 'include' });
      setDepositBalance(res.ok ? await res.json() : null);
    } catch {
      setDepositBalance(null);
    }
  };

  const fetchPatientDepositHistory = async (patientId: string) => {
    setLoadingDepositHistory(true);
    try {
      const res = await authFetch(`/api/patient-deposits/${patientId}/history?clinic_id=${clinicId}`, { credentials: 'include' });
      setDepositHistory(res.ok ? await res.json() : []);
    } catch {
      setDepositHistory([]);
    } finally {
      setLoadingDepositHistory(false);
    }
  };

  const handleSelectPatient = (p: any) => {
    setNewBillForm({ person_id: p.id });
    setPersonSearch(`${p.label} (${p.code || '—'})`);
    setPersonDropdownOpen(false);
    setShowDepositHistory(false);
    setDepositHistory([]);
    fetchPatientDepositBalance(p.id);
  };

  const handleAcceptDeposit = async () => {
    if (takingDeposit || !newBillForm.person_id) return;
    const amountNum = parseFloat(depositForm.amount);
    if (!(amountNum > 0)) { toast.error('Enter a valid deposit amount'); return; }
    const person = people.find(p => p.id === newBillForm.person_id);
    setTakingDeposit(true);
    try {
      const res = await authFetch('/api/patient-deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patient_id: newBillForm.person_id, patient_name: person?.label || '',
          amount: amountNum, payment_method: depositForm.method, notes: depositForm.notes, clinic_id: clinicId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success('Deposit recorded');
        setShowAcceptDepositModal(false);
        setDepositForm({ amount: '', method: 'cash', notes: '' });
        setDepositBalance(prev => ({
          balance: data.deposit.balance, currency: data.deposit.currency,
          totalDeposited: (prev?.totalDeposited || 0) + amountNum,
          totalUsed: prev?.totalUsed || 0, totalRefunded: prev?.totalRefunded || 0,
        }));
        if (showDepositHistory) fetchPatientDepositHistory(newBillForm.person_id);
        setDepositReceiptData({
          kind: 'deposit', patientName: person?.label || '', patientId: person?.code || newBillForm.person_id,
          amount: amountNum, newBalance: data.deposit.balance, currency: data.deposit.currency,
          method: depositForm.method, date: new Date().toISOString(), notes: depositForm.notes,
          receiptNumber: data.receipt?.receipt_number,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to record deposit');
      }
    } catch {
      toast.error('Network error recording deposit');
    } finally {
      setTakingDeposit(false);
    }
  };

  const handleRefundDeposit = async () => {
    if (refundingDeposit || !newBillForm.person_id) return;
    const amountNum = parseFloat(refundForm.amount);
    if (!(amountNum > 0)) { toast.error('Enter a valid refund amount'); return; }
    const person = people.find(p => p.id === newBillForm.person_id);
    setRefundingDeposit(true);
    try {
      const res = await authFetch(`/api/patient-deposits/${newBillForm.person_id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: amountNum, payment_method: refundForm.method, notes: refundForm.notes, patient_name: person?.label || '', clinic_id: clinicId }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success('Deposit refunded');
        setShowRefundDepositModal(false);
        setRefundForm({ amount: '', method: 'cash', notes: '' });
        setDepositBalance(prev => ({
          balance: data.deposit.balance, currency: data.deposit.currency,
          totalDeposited: prev?.totalDeposited || 0, totalUsed: prev?.totalUsed || 0,
          totalRefunded: (prev?.totalRefunded || 0) + amountNum,
        }));
        if (showDepositHistory) fetchPatientDepositHistory(newBillForm.person_id);
        setDepositReceiptData({
          kind: 'refund', patientName: person?.label || '', patientId: person?.code || newBillForm.person_id,
          amount: amountNum, newBalance: data.deposit.balance, currency: data.deposit.currency,
          method: refundForm.method, date: new Date().toISOString(), notes: refundForm.notes,
          receiptNumber: data.receipt?.receipt_number,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to refund deposit');
      }
    } catch {
      toast.error('Network error refunding deposit');
    } finally {
      setRefundingDeposit(false);
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

  const newBillFilteredPeople = people.filter(p =>
    p.label?.toLowerCase().includes(newBillSearch.toLowerCase()) || p.code?.toLowerCase().includes(newBillSearch.toLowerCase())
  );

  // Reuses this patient's existing active bill if they already have one (same
  // server-authoritative lookup /pharmacy-dispensing uses) instead of creating a
  // duplicate — otherwise starts a bare bill and hands off to its detail page, where
  // Add Service/Product, scheme pricing, and payment already live.
  const handleStartNewBill = async (p: any) => {
    if (creatingBill) return;
    setCreatingBill(true);
    try {
      const existingRes = await authFetch(`/api/patient-bills/active/${p.id}/${clinicId}`, { credentials: 'include' });
      if (existingRes.ok) {
        const existingBill = await existingRes.json();
        setShowNewBillModal(false);
        navigate(`/patients-bill/${existingBill.id}`);
        return;
      }
      const billNumber = `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
      const res = await authFetch('/api/patient-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bill_number: billNumber, patient_id: p.id, patient_name: p.label,
          clinic_id: parseInt(String(clinicId)), total_amount: 0, paid_amount: 0, balance_amount: 0,
          status: 'pending', bill_date: new Date().toISOString(), due_date: null,
          services: [], notes: '', created_by: user?.displayName || 'System',
        }),
      });
      if (res.ok) {
        const createdBill = await res.json();
        setShowNewBillModal(false);
        navigate(`/patients-bill/${createdBill.id}`);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to create bill');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setCreatingBill(false);
    }
  };

  // Registers a new participant on the fly for a patient with no prior record — same
  // /api/lis/participants convention pharmacy dispensing's walk-in flow already uses —
  // then immediately starts their bill, same as picking an existing patient would.
  const handleRegisterWalkin = async () => {
    const fullName = walkinForm.full_name.trim();
    if (!fullName) {
      toast.error('Name is required');
      return;
    }
    // The registry stores first/last separately, but nothing downstream (Combobox
    // labels, bill patient_name, receipts) ever recombines them in a way that depends
    // on the split being linguistically correct — the first word is enough to satisfy
    // that column, and the remainder (if any) fills last_name.
    const [first_name, ...rest] = fullName.split(/\s+/);
    const last_name = rest.join(' ');
    setRegisteringWalkin(true);
    try {
      const res = await authFetch('/api/lis/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          first_name, last_name,
          gender: walkinForm.gender, phone: walkinForm.phone,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success('Walk-in patient registered');
        setWalkinForm({ full_name: '', gender: '', phone: '' });
        setShowWalkinForm(false);
        fetchPeople();
        await handleStartNewBill({ id: created.id, label: fullName });
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to register walk-in patient');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setRegisteringWalkin(false);
    }
  };

  const openPaymentModal = (bill: any) => {
    setSelectedBill(bill);
    setSelectedItems(new Set());
    setPaymentForm({ amount: String(bill.balance_amount || ''), method: 'cash', date: toLocalDateStr(new Date()), reference: '', notes: '', paymentTerms: '30', schemeId: '' });
  };

  // Toggling an unpaid item selects it for payment and keeps the amount field in sync
  // with the sum of what's selected, so staff can pay for just one or two items at a time —
  // and, unlike an unattributed lump amount, the payment (and its receipt) can be tied to
  // exactly those services.
  const toggleItemSelection = (index: number) => {
    if (!selectedBill) return;
    const services = parseServices(selectedBill.services);
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);

      const payableBalance = services.filter(isPayableLine).reduce((sum, s) => sum + amt(s.totalPrice), 0);
      const selectedTotal = services.reduce((sum, s, i) => next.has(i) ? sum + amt(s.totalPrice) : sum, 0);
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
    if (!selectedBill) return;
    const amount = parseFloat(paymentForm.amount);
    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid invoice amount'); return; }
    if (amount > parseFloat(selectedBill.balance_amount) + 0.01) { toast.error('Invoice amount cannot exceed the balance due'); return; }

    setPaying(true);
    try {
      let schemeName: string | null = null;
      if (paymentForm.schemeId) {
        const scheme = schemes.find(s => s.id === paymentForm.schemeId);
        schemeName = scheme?.scheme_name || null;
        try {
          await authFetch(`/api/schemes/patient-schemes/${selectedBill.patient_id}`, {
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
          bill_id: selectedBill.id, patient_id: selectedBill.patient_id, patient_name: selectedBill.patient_name,
          clinic_id: parseInt(String(clinicId)), amount, payment_terms: parseInt(paymentForm.paymentTerms) || 30,
          notes, services: parseServices(selectedBill.services),
          scheme_id: paymentForm.schemeId || null, scheme_name: schemeName,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(`Invoice ${result.data.invoice_number} created`);
        setInvoiceData({ ...result.data, patient_name: selectedBill.patient_name, bill_number: selectedBill.bill_number });
        setSelectedBill(null);
        fetchBills();
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

  const handleSavePayment = async () => {
    if (paying) return;
    if (!selectedBill) return;
    if (paymentForm.method === 'credit') { handleCreateInvoice(); return; }
    const amount = parseFloat(paymentForm.amount);
    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid payment amount'); return; }
    if (amount > parseFloat(selectedBill.balance_amount) + 0.01) { toast.error('Payment cannot exceed the balance due'); return; }
    if (!paymentForm.method) { toast.error('Select a payment method'); return; }

    setPaying(true);
    try {
      // Method-specific reference numbers (M-Pesa ref, cheque no., etc.) get folded into notes
      // so they reach the server and the audit trail, instead of being silently dropped.
      const notes = paymentForm.reference
        ? `${paymentForm.notes ? paymentForm.notes + ' — ' : ''}Ref: ${paymentForm.reference}`
        : paymentForm.notes;

      // Which specific services this payment covers is unambiguous in two cases: the
      // items were checked directly, or the payment fully settles the bill (every still
      // payable service is covered either way). Anything else — a partial amount with
      // nothing checked — can't be honestly attributed to particular lines, so it's left
      // untagged rather than guessed.
      //
      // Checking a box used to mean "mark this whole line paid" no matter what amount was
      // actually entered. Only attribute paidServiceIndexes when the amount actually covers
      // everything checked; a shortfall against exactly one selected line instead splits
      // that line into a paid portion + a still-open remainder (partialLineSplit). A
      // shortfall against more than one selected line has no unambiguous way to divide it,
      // so that's rejected rather than guessed at.
      const billServices = parseServices(selectedBill.services);
      const isFullPayment = amount >= parseFloat(selectedBill.balance_amount) - 0.01;
      const selectedTotal = billServices.reduce((sum: number, s: any, i: number) => selectedItems.has(i) ? sum + amt(s.totalPrice) : sum, 0);
      let paidServiceIndexes: number[] | undefined;
      let partialLineSplit: { index: number; lineId?: string; paidAmount: number } | undefined;
      if (selectedItems.size > 0) {
        if (amount >= selectedTotal - 0.01) {
          paidServiceIndexes = Array.from(selectedItems);
        } else if (selectedItems.size === 1) {
          const idx = Array.from(selectedItems)[0];
          partialLineSplit = { index: idx, lineId: billServices[idx]?.line_id, paidAmount: amount };
        } else {
          toast.error('This amount doesn\'t cover everything selected. Select just the one item you\'re partially paying, or enter the full amount for everything checked.');
          setPaying(false);
          return;
        }
      } else if (isFullPayment) {
        paidServiceIndexes = billServices.reduce((acc: number[], s: any, i: number) => { if (isPayableLine(s)) acc.push(i); return acc; }, []);
      }
      // B1: resolved against the same billServices this render selected from —
      // see normalizeServices.js's ensureLineIds for why array position alone
      // isn't safe to trust by the time this request reaches the server.
      const paidLineIds = paidServiceIndexes?.map((i) => billServices[i]?.line_id).filter(Boolean);

      const res = await authFetch(`/api/patient-bills/${selectedBill.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount, payment_method: paymentForm.method, payment_date: paymentForm.date,
          notes, cashierName: user?.displayName, cashierId: user?.uid, paidServiceIndexes, paidLineIds, partialLineSplit,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success('Payment recorded');
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
            id: selectedBill.id, billNumber: selectedBill.bill_number, patientName: selectedBill.patient_name,
            patientId: selectedBill.patient_id, totalAmount: parseFloat(selectedBill.total_amount),
            paidAmount: parseFloat(selectedBill.paid_amount) + amount, balanceAmount: parseFloat(selectedBill.balance_amount) - amount,
            billDate: selectedBill.bill_date, services: paidThisTime,
          },
          payment: { amount, method: paymentForm.method, date: paymentForm.date, notes, from_lease: false, cashierName: user?.displayName },
        });
        setSelectedBill(null);
        setSelectedItems(new Set());
        fetchBills();
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

  const filteredBills = bills.filter((b: any) => {
    // created_at/updated_at are stored in UTC; converting through `new Date()` here (rather than comparing
    // raw strings) resolves it to the browser's own local calendar day, so bills created in the
    // first few hours of the local day still land on "today" instead of "yesterday".
    // We use updated_at so that old bills that have new services appended today will correctly show up.
    const billLocalDate = toLocalDateStr(new Date(b.updated_at || b.created_at));
    const matchesDate =
      (!filterDateFrom || !billLocalDate || billLocalDate >= filterDateFrom) &&
      (!filterDateTo || !billLocalDate || billLocalDate <= filterDateTo);
    const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      b.bill_number?.toLowerCase().includes(q) ||
      b.patient_name?.toLowerCase().includes(q) ||
      String(b.patient_id).toLowerCase().includes(q);
    return matchesDate && matchesStatus && matchesSearch;
  });

  const filteredPeople = people.filter(p =>
    p.label?.toLowerCase().includes(personSearch.toLowerCase()) || p.code?.toLowerCase().includes(personSearch.toLowerCase())
  );

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      partial: 'bg-amber-50 text-amber-700 border-amber-200',
      pending: 'bg-sky-50 text-sky-700 border-sky-200',
    };
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize ${map[status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
        {status || 'pending'}
      </span>
    );
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
        <PageHeader title="Patient Bills" icon={<Receipt />} />

        {/* Cashier shift banner */}
        {!checkingShift && !hasActiveShift && (
          <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4" />
              No active cashier shift — you can create bills, but payments require an open shift.
            </div>
            <Button size="sm" onClick={() => setShowStartShiftModal(true)}>Start Shift</Button>
          </div>
        )}

        <div className="flex flex-col gap-6 mt-6 flex-1 min-h-0">
          {/* Patient Deposits */}
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <h3 className="font-medium mb-3 text-lg border-b pb-2 flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Patient Deposits</h3>
            <div className="max-w-md">
              <label className="text-xs font-medium text-muted-foreground">Patient</label>
              <Input
                value={personSearch}
                onChange={e => {
                  setPersonSearch(e.target.value);
                  setPersonDropdownOpen(true);
                  if (newBillForm.person_id) setNewBillForm({ ...newBillForm, person_id: '' });
                }}
                onFocus={() => setPersonDropdownOpen(true)}
                placeholder="Search patient by name or ID..."
                className="mt-1"
              />
              {personDropdownOpen && personSearch && (
                <div className="mt-1 border rounded-lg max-h-40 overflow-y-auto">
                  {filteredPeople.slice(0, 8).map(p => (
                    <div
                      key={`${p.source}-${p.id}`}
                      onClick={() => handleSelectPatient(p)}
                      className={`px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer border-b last:border-0 ${newBillForm.person_id === p.id ? 'bg-primary/5' : ''}`}
                    >
                      <span className="font-medium">{p.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">{p.code || '—'} · {p.source === 'lis' ? 'LIS' : 'Registry'}</span>
                    </div>
                  ))}
                  {filteredPeople.length === 0 && <div className="p-3 text-sm text-muted-foreground text-center">No patients found</div>}
                </div>
              )}
            </div>

            {newBillForm.person_id && (
              <div className="border rounded-lg p-3 bg-muted/20 space-y-2.5 max-w-md mt-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5" /> Balance
                  </label>
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
                    onClick={() => {
                      const next = !showDepositHistory;
                      setShowDepositHistory(next);
                      if (next && depositHistory.length === 0) fetchPatientDepositHistory(newBillForm.person_id);
                    }}
                  >
                    History {showDepositHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Deposited</div>
                    <div className="text-sm font-semibold">{(depositBalance?.totalDeposited ?? 0).toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Used</div>
                    <div className="text-sm font-semibold">{(depositBalance?.totalUsed ?? 0).toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Remaining</div>
                    <div className="text-sm font-bold text-primary">{(depositBalance?.balance ?? 0).toFixed(2)}</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => setShowAcceptDepositModal(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Accept Deposit
                  </Button>
                  {canRefundDeposit && (
                    <Button
                      type="button" size="sm" variant="outline" className="flex-1 h-8 text-xs"
                      disabled={!depositBalance || depositBalance.balance <= 0}
                      onClick={() => setShowRefundDepositModal(true)}
                    >
                      <Undo2 className="w-3.5 h-3.5 mr-1" /> Refund
                    </Button>
                  )}
                </div>

                {showDepositHistory && (
                  <div className="border-t pt-2 mt-1">
                    {loadingDepositHistory ? (
                      <div className="text-[11px] text-muted-foreground text-center py-2">Loading...</div>
                    ) : depositHistory.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground text-center py-2">No deposit activity yet.</div>
                    ) : (
                      <div className="max-h-36 overflow-auto space-y-1">
                        {depositHistory.map((tx: any) => (
                          <div key={tx.id} className="flex justify-between items-center text-[11px]">
                            <span className="capitalize text-muted-foreground">
                              {tx.type.replace('_', ' ')} · {new Date(tx.created_at).toLocaleDateString()}
                            </span>
                            <span className={`font-medium ${tx.type === 'deposit' || tx.type === 'usage_reversal' ? 'text-emerald-600' : 'text-red-600'}`}>
                              {tx.type === 'deposit' || tx.type === 'usage_reversal' ? '+' : '-'}{parseFloat(tx.amount).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bill Directory */}
          <div className="bg-card rounded-lg border shadow-sm p-0 flex flex-col overflow-hidden flex-1 min-h-0">
            <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
              <h3 className="font-medium">Bill Directory</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative w-56">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input placeholder="Search bill or patient..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Combobox
                  options={STATUS_FILTER_OPTIONS}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  searchPlaceholder="Search..."
                  className="w-40 h-9"
                />
                <Input type="date" className="h-9 w-[140px]" value={filterDateFrom} max={filterDateTo || undefined} onChange={e => setFilterDateFrom(e.target.value)} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" className="h-9 w-[140px]" value={filterDateTo} min={filterDateFrom || undefined} onChange={e => setFilterDateTo(e.target.value)} />
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchBills} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <AdvancedDataTable<any>
                data={filteredBills}
                keyExtractor={(bill) => bill.id}
                loading={loading}
                emptyMessage="No bills found."
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                exportable
                exportFileName="patient-bills"
                toolbarExtra={
                  <Button size="sm" onClick={() => { setNewBillSearch(''); setShowWalkinForm(false); setShowNewBillModal(true); }}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Create New Bill
                  </Button>
                }
                columns={[
                  {
                    key: 'bill_number', header: 'Bill No.', sortable: true,
                    render: (v, bill) => (
                      <span className="font-mono text-primary font-medium cursor-pointer" onClick={() => navigate(`/patients-bill/${bill.id}`)}>
                        {v}
                      </span>
                    ),
                  },
                  {
                    key: 'bill_date', header: 'Date', sortable: true,
                    render: (v) => <span className="text-muted-foreground whitespace-nowrap">{v ? new Date(v).toLocaleString() : '—'}</span>,
                  },
                  { key: 'patient_name', header: 'Patient', sortable: true },
                  { key: 'total_amount', header: 'Total', sortable: true, render: (v) => <span className="text-muted-foreground">{parseFloat(v).toFixed(2)}</span> },
                  {
                    key: 'balance_amount', header: 'Balance', sortable: true,
                    render: (v) => (
                      <div className="flex items-center gap-1.5 font-medium">
                        {parseFloat(v).toFixed(2)}
                        {parseFloat(v) < 0 && (
                          <span title={`Overpaid by ${Math.abs(parseFloat(v)).toFixed(2)} — paid amount exceeds the bill total. Review before refunding or adjusting.`}>
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          </span>
                        )}
                      </div>
                    ),
                  },
                  { key: 'status', header: 'Status', render: (v) => statusBadge(v) },
                  {
                    key: '__actions', header: 'Actions',
                    render: (_v, bill) => (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigate(`/patients-bill/${bill.id}`)}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {parseFloat(bill.balance_amount) > 0 && (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => openPaymentModal(bill)}>
                            <CreditCard className="w-3.5 h-3.5 mr-1" /> Pay
                          </Button>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Payment Modal */}
      {selectedBill && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-md rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" /> Record Payment
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedBill(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-6 flex-1 overflow-auto space-y-4">
              <div className="grid grid-cols-2 gap-y-2 text-sm p-3 bg-muted/30 rounded-lg">
                <span className="text-muted-foreground">Bill No.</span>
                <span className="font-mono text-primary text-right">{selectedBill.bill_number}</span>
                <span className="text-muted-foreground">Patient</span>
                <span className="text-right">{selectedBill.patient_name}</span>
                <span className="text-muted-foreground">Balance Due</span>
                <span className="text-right font-bold">{parseFloat(selectedBill.balance_amount).toFixed(2)}</span>
              </div>

              {(() => {
                const services = parseServices(selectedBill.services);
                const payable = services.map((s, i) => ({ s, i })).filter(({ s }) => isPayableLine(s));
                const settledCount = services.length - payable.length;
                if (payable.length === 0) return null;
                return (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Items</label>
                    <p className="text-[11px] text-muted-foreground mb-1">Check items to pay for just those — the amount follows your selection. Leave unchecked to pay the full balance below.</p>
                    <div className="border rounded-lg divide-y max-h-40 overflow-auto">
                      {payable.map(({ s, i }) => (
                        <label key={i} className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/40">
                          <input type="checkbox" className="rounded border-input" checked={selectedItems.has(i)} onChange={() => toggleItemSelection(i)} />
                          <span className="flex-1 min-w-0 truncate">{s.serviceName || s.name || s.service_name}</span>
                          <span className="text-xs text-muted-foreground font-mono flex-shrink-0">{s.currency || 'SSP'} {amt(s.totalPrice).toFixed(2)}</span>
                        </label>
                      ))}
                    </div>
                    {settledCount > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">{settledCount} other item{settledCount > 1 ? 's' : ''} on this bill {settledCount > 1 ? 'are' : 'is'} already paid, voided, or invoiced.</p>
                    )}
                  </div>
                );
              })()}

              {!hasActiveShift && paymentForm.method !== 'credit' && (
                <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> No active cashier shift — start one before recording this payment.
                </div>
              )}

              {paymentForm.method === 'credit' && (
                <div className="p-2.5 rounded-lg border border-sky-200 bg-sky-50 text-xs text-sky-800 flex items-center gap-2">
                  <CreditCard className="w-3.5 h-3.5 flex-shrink-0" /> No money is collected now — this creates an invoice due later, payable from the Invoices page.
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground">{paymentForm.method === 'credit' ? 'Amount to Invoice' : 'Amount'}</label>
                <Input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="mt-1" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Method</label>
                  <Combobox
                    options={PAYMENT_METHODS}
                    value={paymentForm.method}
                    onChange={v => setPaymentForm({ ...paymentForm, method: v })}
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

              <div>
                <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                <Input value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} className="mt-1" />
              </div>
            </div>

            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelectedBill(null)}>Cancel</Button>
              <Button onClick={handleSavePayment} disabled={paying || (paymentForm.method !== 'credit' && !hasActiveShift)}>
                {paying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {paymentForm.method === 'credit' ? 'Create Invoice' : 'Save Payment'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create New Bill — pick a patient, then hand off to their bill detail page
          (an existing active bill if they have one, else a fresh one) where Add
          Service/Product, scheme pricing, and payment already live. */}
      {showNewBillModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-md rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg">Create New Bill</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowNewBillModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            {!showWalkinForm ? (
              <>
                <div className="p-4 border-b space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Patient</label>
                    <button
                      type="button"
                      onClick={() => setShowWalkinForm(true)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      + Register Walk-in
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={newBillSearch}
                      onChange={e => setNewBillSearch(e.target.value)}
                      placeholder="Search patient by name or ID..."
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {newBillSearch.trim() === '' ? (
                    <div className="p-6 text-sm text-muted-foreground text-center">Start typing to search patients</div>
                  ) : newBillFilteredPeople.length > 0 ? (
                    newBillFilteredPeople.slice(0, 30).map(p => (
                      <div
                        key={`${p.source}-${p.id}`}
                        onClick={() => !creatingBill && handleStartNewBill(p)}
                        className="px-4 py-2.5 text-sm hover:bg-muted/50 cursor-pointer border-b last:border-0 flex items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-medium">{p.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">{p.code || '—'} · {p.source === 'lis' ? 'LIS' : 'Registry'}</span>
                        </div>
                        {creatingBill && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-sm text-muted-foreground text-center">No patients found</div>
                  )}
                </div>
              </>
            ) : (
              <div className="p-4 space-y-3">
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
                <div className="grid grid-cols-2 gap-2">
                  <Combobox
                    options={GENDER_OPTIONS}
                    value={walkinForm.gender}
                    onChange={v => setWalkinForm({ ...walkinForm, gender: v })}
                    searchPlaceholder="Search..."
                    placeholder="Gender (optional)"
                  />
                  <Input placeholder="Phone (optional)" value={walkinForm.phone} onChange={e => setWalkinForm({ ...walkinForm, phone: e.target.value })} />
                </div>
                <Button type="button" variant="outline" className="w-full" onClick={handleRegisterWalkin} disabled={registeringWalkin}>
                  {registeringWalkin ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  Register & Continue
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Start Cashier Shift Modal */}
      {showStartShiftModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-sm rounded-xl shadow-lg border overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg">Start Cashier Shift</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowStartShiftModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6">
              <label className="text-xs font-medium text-muted-foreground">Opening Balance</label>
              <Input type="number" min="0" step="0.01" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} placeholder="0.00" className="mt-1" />
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
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

      {depositReceiptData && (
        <div className="fixed -left-[9999px] top-0">
          <div ref={depositReceiptRef}>
            <DepositReceipt
              kind={depositReceiptData.kind}
              patientName={depositReceiptData.patientName}
              patientId={depositReceiptData.patientId}
              amount={depositReceiptData.amount}
              newBalance={depositReceiptData.newBalance}
              currency={depositReceiptData.currency}
              method={depositReceiptData.method}
              date={depositReceiptData.date}
              notes={depositReceiptData.notes}
              receiptNumber={depositReceiptData.receiptNumber}
              facilityName={facilityName}
              branchName={branchName}
            />
          </div>
        </div>
      )}

      {/* Accept Deposit Modal */}
      {showAcceptDepositModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-sm rounded-xl shadow-lg border overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5 text-primary" /> Accept Deposit
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowAcceptDepositModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 space-y-4">
              {!hasActiveShift && (
                <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> No active cashier shift — start one before accepting a deposit.
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-muted-foreground">Amount</label>
                <Input type="number" min="0" step="0.01" value={depositForm.amount} onChange={e => setDepositForm({ ...depositForm, amount: e.target.value })} className="mt-1" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Method</label>
                <Combobox
                  options={PAYMENT_METHODS.filter(m => m.value !== 'credit')}
                  value={depositForm.method}
                  onChange={v => setDepositForm({ ...depositForm, method: v })}
                  searchPlaceholder="Search..."
                  className="w-full h-9 mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                <Input value={depositForm.notes} onChange={e => setDepositForm({ ...depositForm, notes: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAcceptDepositModal(false)}>Cancel</Button>
              <Button onClick={handleAcceptDeposit} disabled={takingDeposit || !hasActiveShift}>
                {takingDeposit ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Save Deposit
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Refund Deposit Modal */}
      {showRefundDepositModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-sm rounded-xl shadow-lg border overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Undo2 className="w-5 h-5 text-primary" /> Refund Deposit
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowRefundDepositModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-2.5 rounded-lg border bg-muted/30 text-xs flex justify-between">
                <span className="text-muted-foreground">Available balance</span>
                <span className="font-semibold">{(depositBalance?.balance ?? 0).toFixed(2)} {depositBalance?.currency || 'SSP'}</span>
              </div>
              {!hasActiveShift && (
                <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> No active cashier shift — start one before refunding.
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-muted-foreground">Amount</label>
                <Input
                  type="number" min="0" step="0.01" max={depositBalance?.balance ?? 0}
                  value={refundForm.amount} onChange={e => setRefundForm({ ...refundForm, amount: e.target.value })} className="mt-1" autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Method</label>
                <Combobox
                  options={PAYMENT_METHODS.filter(m => m.value !== 'credit')}
                  value={refundForm.method}
                  onChange={v => setRefundForm({ ...refundForm, method: v })}
                  searchPlaceholder="Search..."
                  className="w-full h-9 mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
                <Input value={refundForm.notes} onChange={e => setRefundForm({ ...refundForm, notes: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowRefundDepositModal(false)}>Cancel</Button>
              <Button onClick={handleRefundDeposit} disabled={refundingDeposit || !hasActiveShift}>
                {refundingDeposit ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Confirm Refund
              </Button>
            </div>
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
                <span className="text-muted-foreground">Bill No.</span>
                <span className="text-right font-mono">{invoiceData.bill_number}</span>
                <span className="text-muted-foreground">Amount Due</span>
                <span className="text-right font-bold">{parseFloat(invoiceData.balance_due).toFixed(2)}</span>
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
