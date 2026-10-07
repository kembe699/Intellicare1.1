import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { expenseVoucherStatus } from '@/lib/expenseStatus';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import { exportCSV } from '@/utils/reportUtils';
import { Receipt, Plus, Printer, ChevronsUpDown, Check, Building2, Loader2, Search, RefreshCw, ShieldCheck, Download, DollarSign, Pencil, Trash2, Ban, FileSpreadsheet, Stethoscope } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import * as docTemplate from '@/utils/documentTemplate';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface CoAAccount { id: string | number; account_code: string; account_name: string; account_type: string; current_balance?: number; balance?: number; }
interface DailyExpense { id: number; expense_date: string; description: string; amount: number; account_name: string; account_id: string; category: string; notes: string; created_by: string; payment_method?: string; voucher_number?: string; status?: string; }
interface ExpApproval { id: string; expense_id: number; approval_level: number; approved_by: string; approved_by_title?: string; signature?: string | null; notes?: string; approved_at: string; }
interface SupplierBill { id: string; po_number: string; order_date: string; total_amount: number; po_currency: string; payment_terms: string; status: string; supplier_name: string; contact_person: string; supplier_phone: string; paid_amount: number; payment_status: string; balance_due: number; }
interface ConsultantBill { id: string; bill_number: string; first_name: string; last_name: string; employee_number: string; period_from: string; period_to: string; total_consultation_revenue: number; fee_percentage: number; bill_amount: number; currency: string; status: string; created_at: string; paid_at?: string; }
interface BillApproval { id: string; po_id: string; approval_level: number; approved_by: string; approved_by_title?: string; signature?: string | null; notes?: string; approved_at: string; }
interface POLineItem { line_number: number; item_name: string; description?: string; quantity: number; unit_of_measure?: string; unit_price: number; total_price: number; status?: string; }
interface UserProfile { id: string; displayName: string; email: string; role: string; signature: string | null; }
const today = () => new Date().toISOString().split('T')[0];
const APPROVAL_LEVELS = ['Approval 1', 'Authorization'];
// Supplier bills / PO payments go through a separate, 3-level approval chain
// (see approvalCount >= 3 below) — a distinct array because APPROVAL_LEVELS
// above only has 2 entries for the daily-expense flow's 2-level chain.
// Indexing APPROVAL_LEVELS[2] for the 3rd PO approval level used to resolve
// to undefined, which printed as the literal word "UNDEFINED" on the voucher
// (buildSignatures renders `${s.label}` with no guard, and .ic-sig-label is
// text-transform: uppercase).
const PO_APPROVAL_LEVELS = ['Checked By', 'Reviewed By', 'Approved By'];

const EXPENSE_CATEGORIES = ['Doctor Fees','Allowance','Office Supplies','Administrative Expenses','Utilities','Maintenance','Transport','Catering','Medical Supplies','Cleaning','Security','Other'];
const PAYMENT_METHODS = ['Cash','Bank Transfer','Cheque','Mobile Money'];

const DailyExpenses: React.FC = () => {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { fmt, currency } = useCurrency();
  const { user } = useAuth();
  const navigate = useNavigate();
  const facilityInfo = useFacilityInfo();
  // `clinic` is the field AuthContext's normalizeUser actually produces (see
  // contexts/AuthContext.tsx) — there is no clinicId/primaryClinicId on the
  // user object, so the previous lookup always fell through to the literal 1.
  // Every request on this page was therefore scoped to clinic 1 regardless of
  // who was signed in: the account picker came back empty, the expense and
  // supplier-bill lists showed another clinic's records, and newly recorded
  // expenses were saved against clinic 1 too.
  const clinicId = user?.clinic || 1;

  const [tab, setTab] = useState('expenses');
  const [expenses, setExpenses] = useState<DailyExpense[]>([]);
  const [bills, setBills] = useState<SupplierBill[]>([]);
  const [coaAccounts, setCoaAccounts] = useState<CoAAccount[]>([]);
  const [loadingExp, setLoadingExp] = useState(false);
  const [loadingBills, setLoadingBills] = useState(false);
  const [searchExp, setSearchExp] = useState('');
  // Today by default: the list grows without limit otherwise, and a day's
  // expenses are what anyone opening this page actually wants to see.
  const todayStr = () => new Date().toLocaleDateString('en-CA');
  const [expFrom, setExpFrom] = useState(todayStr);
  const [expTo, setExpTo] = useState(todayStr);
  const [editExpense, setEditExpense] = useState<DailyExpense | null>(null);
  const [rejectExpense, setRejectExpense] = useState<DailyExpense | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyExpId, setBusyExpId] = useState<number | null>(null);
  const [openEditCombo, setOpenEditCombo] = useState(false);
  const [searchBills, setSearchBills] = useState('');
  // Empty by default — unlike Daily Expenses (a daily log, so "today" is the
  // natural default), this is a worklist of whatever's still unpaid regardless
  // of when it was raised; defaulting to a date window would hide bills nobody
  // has gotten around to paying yet.
  const [billFrom, setBillFrom] = useState('');
  const [billTo, setBillTo] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [showExpModal, setShowExpModal] = useState(false);
  const [expForm, setExpForm] = useState({ expense_date: today(), description: '', amount: '', account_id: '', account_name: '', category: '', notes: '', payment_method: 'Cash' });
  const [openExpCombo, setOpenExpCombo] = useState(false);
  const [submittingExp, setSubmittingExp] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedBill, setSelectedBill] = useState<SupplierBill | null>(null);
  const [payForm, setPayForm] = useState({ payment_date: today(), amount_paid: '', account_id: '', account_name: '', payment_method: 'Bank Transfer', reference_number: '', notes: '', paid_by: '', approved_by: '' });
  const [openPayCombo, setOpenPayCombo] = useState(false);
  const [submittingPay, setSubmittingPay] = useState(false);
  const [billApprovals, setBillApprovals] = useState<Record<string, BillApproval[]>>({});
  // Current active rate for each PO currency -> base currency, e.g. { USD: 1300 } — see
  // fetchPoCurrencyRates. Keyed by PO currency since the base side is always the clinic's own.
  const [poCurrencyRates, setPoCurrencyRates] = useState<Record<string, number>>({});
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approveBill, setApproveBill] = useState<SupplierBill | null>(null);
  const [approveForm, setApproveForm] = useState({ approved_by_title: '', notes: '' });
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [billItems, setBillItems] = useState<Record<string, POLineItem[]>>({});
  const [expApprovals, setExpApprovals] = useState<Record<number, ExpApproval[]>>({});
  const [consultantBills, setConsultantBills] = useState<ConsultantBill[]>([]);
  const [loadingConsultantBills, setLoadingConsultantBills] = useState(false);
  const [searchConsultantBills, setSearchConsultantBills] = useState('');
  const [showConsultantPayModal, setShowConsultantPayModal] = useState(false);
  const [selectedConsultantBill, setSelectedConsultantBill] = useState<ConsultantBill | null>(null);
  const [consultantPayForm, setConsultantPayForm] = useState({ payment_date: today(), account_id: '', account_name: '', payment_method: 'Bank Transfer', reference_number: '', notes: '' });
  const [openConsultantPayCombo, setOpenConsultantPayCombo] = useState(false);
  const [submittingConsultantPay, setSubmittingConsultantPay] = useState(false);
  const [showExpApproveModal, setShowExpApproveModal] = useState(false);
  const [approveExpense, setApproveExpense] = useState<DailyExpense | null>(null);
  const [expApproveForm, setExpApproveForm] = useState({ approved_by_title: '', notes: '' });
  const [submittingExpApproval, setSubmittingExpApproval] = useState(false);

  useEffect(() => { fetchExpenses(); fetchBills(); fetchCoA(); fetchUserProfile(); fetchConsultantBills(); }, []);
  // Re-read whenever the window moves; skipped on the first render, which the
  // effect above already covers.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    fetchExpenses();
  }, [expFrom, expTo]);

  // The base currency loads asynchronously (CurrencyContext's own fetch) and often isn't
  // ready yet when fetchBills first runs — re-fetch rates once it lands so the "≈ base
  // currency" figures aren't silently left blank for the rest of the session.
  useEffect(() => { if (currency?.code && bills.length > 0) fetchPoCurrencyRates(bills); }, [currency?.code]);

  const fetchUserProfile = async () => {
    try {
      const r = await authFetch('/api/auth/me');
      if (r.ok) setUserProfile(await r.json());
    } catch {}
  };

  const fetchExpenses = async () => {
    setLoadingExp(true);
    try {
      const params = new URLSearchParams({ clinic_id: String(clinicId) });
      if (expFrom) params.set('dateFrom', expFrom);
      if (expTo) params.set('dateTo', expTo);
      const r = await authFetch(`/api/daily-expenses?${params}`);
      if (r.ok) {
        const list: DailyExpense[] = await r.json();
        setExpenses(list);
        // Load approvals for all pending expenses
        const pending = list.filter(e => e.status === 'pending_approval');
        if (pending.length > 0) {
          const pairs = await Promise.all(pending.map(async e => {
            try {
              const ar = await authFetch(`/api/daily-expenses/${e.id}/approvals`);
              return [e.id, ar.ok ? await ar.json() : []] as [number, ExpApproval[]];
            } catch { return [e.id, []] as [number, ExpApproval[]]; }
          }));
          setExpApprovals(Object.fromEntries(pairs));
        }
      }
    } catch {}
    finally { setLoadingExp(false); }
  };

  const saveExpenseEdit = async (payload: Partial<DailyExpense>) => {
    if (!editExpense) return;
    setBusyExpId(editExpense.id);
    try {
      const r = await authFetch(`/api/daily-expenses/${editExpense.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Failed to save changes');
      toast.success('Expense updated');
      setEditExpense(null);
      fetchExpenses();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save changes');
    } finally { setBusyExpId(null); }
  };

  const removeExpense = async (exp: DailyExpense) => {
    if (!(await confirm({ description: `Remove "${exp.description}" (${fmt(parseFloat(String(exp.amount || 0)))})? This cannot be undone.` }))) return;
    setBusyExpId(exp.id);
    try {
      const r = await authFetch(`/api/daily-expenses/${exp.id}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Failed to remove expense');
      toast.success('Expense removed');
      fetchExpenses();
    } catch (e: any) {
      toast.error(e.message || 'Failed to remove expense');
    } finally { setBusyExpId(null); }
  };

  const submitReject = async () => {
    if (!rejectExpense) return;
    if (!rejectReason.trim()) { toast.error('Give a reason for rejecting'); return; }
    setBusyExpId(rejectExpense.id);
    try {
      const r = await authFetch(`/api/daily-expenses/${rejectExpense.id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Failed to reject');
      toast.success('Expense rejected');
      setRejectExpense(null); setRejectReason('');
      fetchExpenses();
    } catch (e: any) {
      toast.error(e.message || 'Failed to reject');
    } finally { setBusyExpId(null); }
  };

  const exportExpensesCSV = () => {
    if (filteredExpenses.length === 0) { toast.error('Nothing to export'); return; }
    exportCSV(
      filteredExpenses,
      [
        { key: 'voucher_number', header: 'Voucher' },
        { key: 'expense_date', header: 'Date', transform: (v: any) => (v ? new Date(v).toLocaleDateString() : '') },
        { key: 'description', header: 'Description' },
        { key: 'category', header: 'Category' },
        { key: 'account_name', header: 'Account' },
        { key: 'payment_method', header: 'Method', transform: (v: any) => v || 'cash' },
        { key: 'amount', header: `Amount (${currency.code})`, transform: (v: any) => parseFloat(String(v || 0)).toFixed(2) },
        { key: 'status', header: 'Status' },
        { key: 'created_by', header: 'Recorded By' },
      ],
      `expenses_${expFrom}_to_${expTo}`,
    );
    toast.success(`Exported ${filteredExpenses.length} expense(s)`);
  };

  const exportBillsCSV = () => {
    if (filteredBills.length === 0) { toast.error('Nothing to export'); return; }
    exportCSV(
      filteredBills,
      [
        { key: 'po_number', header: 'PO Number' },
        { key: 'order_date', header: 'Date', transform: (v: any) => (v ? new Date(v).toLocaleDateString() : '') },
        { key: 'supplier_name', header: 'Supplier' },
        { key: 'po_currency', header: 'Currency' },
        { key: 'total_amount', header: 'PO Total', transform: (v: any) => parseFloat(String(v || 0)).toFixed(2) },
        { key: 'paid_amount', header: 'Paid', transform: (v: any) => parseFloat(String(v || 0)).toFixed(2) },
        { key: 'balance_due', header: 'Balance Due', transform: (v: any) => parseFloat(String(v || 0)).toFixed(2) },
        { key: 'payment_status', header: 'Status', transform: (v: any) => v || 'unpaid' },
      ],
      `supplier-bills_${billFrom || 'all'}_to_${billTo || 'all'}`,
    );
    toast.success(`Exported ${filteredBills.length} bill(s)`);
  };

  const generateBillsReportPDF = () => {
    if (filteredBills.length === 0) { toast.error('Nothing to export'); return; }

    const periodLabel = billFrom || billTo
      ? `${billFrom ? new Date(billFrom).toLocaleDateString() : 'Earliest'} — ${billTo ? new Date(billTo).toLocaleDateString() : 'Latest'}`
      : 'All dates';

    const bodyHTML = [
      docTemplate.buildInfoGrid(
        { title: 'Report Filters', rows: [
          { label: 'Period', value: periodLabel },
          { label: 'Supplier', value: supplierFilter === 'all' ? 'All Suppliers' : supplierFilter },
          { label: 'Bills', value: filteredBills.length, bold: true },
        ]},
        { title: 'Totals by Currency', rows: billTotalsByCurrency.flatMap(c => ([
          { label: `Billed (${c.currency})`, value: docTemplate.formatCurrency(c.total_billed, c.currency) },
          { label: `Paid (${c.currency})`, value: docTemplate.formatCurrency(c.total_paid, c.currency) },
          { label: `Outstanding (${c.currency})`, value: docTemplate.formatCurrency(c.total_outstanding, c.currency), bold: true },
        ])) },
      ),
      `<div class="ic-section-title">Supplier Bills</div>`,
      docTemplate.buildTable(
        [
          { label: 'PO Number' }, { label: 'Date' }, { label: 'Supplier' },
          { label: 'Total', align: 'right' }, { label: 'Paid', align: 'right' },
          { label: 'Balance Due', align: 'right' }, { label: 'Status' },
        ],
        filteredBills.map(b => ({
          cells: [
            b.po_number, docTemplate.formatDate(b.order_date), b.supplier_name || '-',
            docTemplate.formatCurrency(b.total_amount, b.po_currency),
            docTemplate.formatCurrency(b.paid_amount, b.po_currency),
            docTemplate.formatCurrency(b.balance_due, b.po_currency),
            b.payment_status || 'unpaid',
          ],
        })),
      ),
    ].join('\n');

    const html = docTemplate.buildDocument({
      title: 'Supplier Bills Report',
      docType: 'Supplier Bills Report',
      date: new Date(),
      bodyHTML,
      facilityInfo: fi(),
      branchInfo: bi(),
    });

    const pw = docTemplate.openPrintWindow(html);
    if (pw) toast.success('PDF generated');
    else toast.error('Please allow popups');
  };

  const fetchExpApprovals = async (expId: number) => {
    try {
      const r = await authFetch(`/api/daily-expenses/${expId}/approvals`);
      if (r.ok) { const data = await r.json(); setExpApprovals(prev => ({ ...prev, [expId]: data })); }
    } catch {}
  };
  const fetchBills = async () => {
    setLoadingBills(true);
    try {
      const r = await authFetch(`/api/daily-expenses/supplier-bills?clinic_id=${clinicId}`);
      if (r.ok) {
        const data: SupplierBill[] = await r.json();
        setBills(data);
        // Fetch approvals and items for all bills in parallel
        const [approvalEntries, itemEntries] = await Promise.all([
          Promise.all(data.map(async b => {
            try {
              const ar = await authFetch(`/api/daily-expenses/supplier-bills/${b.id}/approvals`);
              return [b.id, ar.ok ? await ar.json() : []] as [string, BillApproval[]];
            } catch { return [b.id, []] as [string, BillApproval[]]; }
          })),
          Promise.all(data.map(async b => {
            try {
              const ir = await authFetch(`/api/daily-expenses/supplier-bills/${b.id}/items`);
              return [b.id, ir.ok ? await ir.json() : []] as [string, POLineItem[]];
            } catch { return [b.id, []] as [string, POLineItem[]]; }
          }))
        ]);
        setBillApprovals(Object.fromEntries(approvalEntries));
        setBillItems(Object.fromEntries(itemEntries));
        fetchPoCurrencyRates(data);
      }
    } catch {}
    finally { setLoadingBills(false); }
  };

  // PO totals/balances are recorded in the PO's own currency (po_currency — mostly USD
  // in this system), not the clinic's base currency, but they get paid from a base-currency
  // (SSP) account. Fetches the current active rate for every distinct PO currency present so
  // the UI can show both "what the PO says" and "what it'll actually post as" — no logging
  // side effect (unlike POST /exchange-rates/convert, which records each call as a real
  // conversion event), since this just reads the rate to preview a display, not perform one.
  const fetchPoCurrencyRates = async (billList: SupplierBill[]) => {
    const base = currency?.code;
    if (!base) return;
    const foreignCurrencies = Array.from(new Set(
      billList.map(b => b.po_currency).filter((c): c is string => !!c && c !== base)
    ));
    if (foreignCurrencies.length === 0) return;
    try {
      const entries = await Promise.all(foreignCurrencies.map(async (fc) => {
        try {
          const r = await authFetch(`/api/exchange-rates/rates?from_currency=${fc}&to_currency=${base}&active_only=true`);
          if (!r.ok) return [fc, null] as [string, number | null];
          const { data } = await r.json();
          const rate = data?.[0]?.effective_rate;
          return [fc, rate != null ? parseFloat(rate) : null] as [string, number | null];
        } catch { return [fc, null] as [string, number | null]; }
      }));
      setPoCurrencyRates(prev => ({ ...prev, ...Object.fromEntries(entries.filter(([, rate]) => rate != null)) }));
    } catch {}
  };

  // Converts a PO-currency amount to its current base-currency equivalent for display —
  // null when the rate isn't known yet or the PO is already in the base currency (nothing
  // to convert). Never used for the actual GL posting math, only to preview it here.
  const toBaseCurrency = (amount: number, poCurrency?: string): number | null => {
    if (!poCurrency || poCurrency === currency?.code) return null;
    const rate = poCurrencyRates[poCurrency];
    if (rate == null) return null;
    return Math.round(amount * rate * 100) / 100;
  };

  const fetchConsultantBills = async () => {
    setLoadingConsultantBills(true);
    try {
      const r = await authFetch(`/api/daily-expenses/consultant-bills?clinic_id=${clinicId}`);
      if (r.ok) setConsultantBills(await r.json());
    } catch {}
    finally { setLoadingConsultantBills(false); }
  };

  const filteredConsultantBills = useMemo(() => {
    if (!searchConsultantBills) return consultantBills;
    const q = searchConsultantBills.toLowerCase();
    return consultantBills.filter(b => `${b.bill_number} ${b.first_name} ${b.last_name} ${b.employee_number}`.toLowerCase().includes(q));
  }, [consultantBills, searchConsultantBills]);

  const consultantBillTotalsByCurrency = useMemo(() => {
    const byCurrency: Record<string, { currency: string; total_billed: number; total_paid: number; total_outstanding: number }> = {};
    for (const b of consultantBills) {
      const cur = b.currency || currency.code;
      if (!byCurrency[cur]) byCurrency[cur] = { currency: cur, total_billed: 0, total_paid: 0, total_outstanding: 0 };
      byCurrency[cur].total_billed += parseFloat(String(b.bill_amount || 0));
      if (b.status === 'paid') byCurrency[cur].total_paid += parseFloat(String(b.bill_amount || 0));
      else byCurrency[cur].total_outstanding += parseFloat(String(b.bill_amount || 0));
    }
    return Object.values(byCurrency).sort((a, b) => b.total_billed - a.total_billed);
  }, [consultantBills, currency.code]);

  const openPayConsultantBill = (bill: ConsultantBill) => {
    setSelectedConsultantBill(bill);
    setConsultantPayForm({ payment_date: today(), account_id: '', account_name: '', payment_method: 'Bank Transfer', reference_number: '', notes: '' });
    setShowConsultantPayModal(true);
  };

  const handleConsultantPaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingConsultantPay) return;
    if (!selectedConsultantBill || !consultantPayForm.account_id) { toast.error('Select an account'); return; }
    setSubmittingConsultantPay(true);
    try {
      const r = await authFetch('/api/daily-expenses/consultant-bill-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultant_bill_id: selectedConsultantBill.id, payment_date: consultantPayForm.payment_date,
          account_id: consultantPayForm.account_id, account_name: consultantPayForm.account_name,
          payment_method: consultantPayForm.payment_method, reference_number: consultantPayForm.reference_number || null,
          notes: consultantPayForm.notes || null,
        }) });
      const data = await r.json();
      if (!r.ok) { toast.error(data.error || 'Failed to record payment'); return; }
      toast.success('Consultant bill paid');
      setShowConsultantPayModal(false); setSelectedConsultantBill(null);
      fetchConsultantBills();
    } catch { toast.error('Failed to record payment'); }
    finally { setSubmittingConsultantPay(false); }
  };

  const fetchApprovals = async (poId: string) => {
    try {
      const r = await authFetch(`/api/daily-expenses/supplier-bills/${poId}/approvals`);
      if (r.ok) { const data = await r.json(); setBillApprovals(prev => ({ ...prev, [poId]: data })); }
    } catch {}
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingApproval) return;
    if (!approveBill) return;
    setSubmittingApproval(true);
    try {
      const r = await authFetch(`/api/daily-expenses/supplier-bills/${approveBill.id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by_title: approveForm.approved_by_title, notes: approveForm.notes })
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 403 && Array.isArray(data.allowedActions)) {
          const allowed = data.allowedActions.map((a: any) => a.label).join(', ') || 'none';
          toast.error(`${data.error} Your permitted approvals: ${allowed}`);
        } else {
          toast.error(data.error || 'Failed to submit approval');
        }
        return;
      }
      toast.success(`Approval ${data.approval_level}/3 submitted by ${data.approved_by}`);
      await fetchApprovals(approveBill.id);
      setShowApproveModal(false);
      setApproveForm({ approved_by_title: '', notes: '' });
    } catch { toast.error('Failed to submit approval'); }
    finally { setSubmittingApproval(false); }
  };

  const openExpApprove = (exp: DailyExpense) => {
    setApproveExpense(exp);
    setExpApproveForm({ approved_by_title: '', notes: '' });
    setShowExpApproveModal(true);
  };

  const handleExpApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingExpApproval) return;
    if (!approveExpense) return;
    setSubmittingExpApproval(true);
    try {
      const r = await authFetch(`/api/daily-expenses/${approveExpense.id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by_title: expApproveForm.approved_by_title, notes: expApproveForm.notes }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 403 && Array.isArray(data.allowedActions)) {
          const allowed = data.allowedActions.map((a: any) => a.label).join(', ') || 'none';
          toast.error(`${data.error} Your permitted approvals: ${allowed}`);
        } else {
          toast.error(data.error || 'Approval failed');
        }
        return;
      }
      toast.success(`Approval ${data.approval_level}/2 recorded`);
      await fetchExpApprovals(approveExpense.id);
      if (data.total_approvals >= 2) {
        toast.success('All approvals complete — voucher generated!');
        setShowExpApproveModal(false);
        fetchExpenses();
      }
    } catch { toast.error('Failed to submit approval'); }
    finally { setSubmittingExpApproval(false); }
  };

  const openApprove = (bill: SupplierBill) => {
    setApproveBill(bill);
    setApproveForm({ approved_by_title: '', notes: '' });
    setShowApproveModal(true);
  };
  // Both lookups previously swallowed every failure, so a 403, a 400 or a
  // wrong-database read all surfaced identically: an account picker with no
  // options and no hint as to why. The fallback stays (older instances only
  // have ledger_accounts), but a total failure now says so.
  const fetchCoA = async () => {
    let firstError = '';
    try {
      const r = await authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`);
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data) && data.length) { setCoaAccounts(data); return; }
        firstError = 'chart-of-accounts returned no accounts';
      } else {
        firstError = `chart-of-accounts responded ${r.status}`;
      }
    } catch (e) {
      firstError = `chart-of-accounts request failed: ${e}`;
    }

    try {
      const r = await authFetch('/api/ledger-accounts');
      if (r.ok) {
        const data = await r.json();
        setCoaAccounts(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length) return;
      }
      console.error(`Could not load chart of accounts (${firstError}; ledger-accounts responded ${r.status})`);
    } catch (e) {
      console.error(`Could not load chart of accounts (${firstError}; ledger-accounts request failed: ${e})`);
    }
    toast.error('Could not load the chart of accounts — expenses cannot be recorded until this is resolved.');
  };

  const filteredExpenses = useMemo(() => expenses.filter(e => !searchExp || e.description?.toLowerCase().includes(searchExp.toLowerCase()) || e.category?.toLowerCase().includes(searchExp.toLowerCase())), [expenses, searchExp]);
  const filteredBills = useMemo(() => bills.filter(b => {
    if (searchBills && !b.po_number?.toLowerCase().includes(searchBills.toLowerCase()) && !b.supplier_name?.toLowerCase().includes(searchBills.toLowerCase())) return false;
    if (supplierFilter !== 'all' && b.supplier_name !== supplierFilter) return false;
    if (billFrom && b.order_date < billFrom) return false;
    if (billTo && b.order_date > billTo) return false;
    return true;
  }), [bills, searchBills, supplierFilter, billFrom, billTo]);

  const supplierOptions = useMemo(() => {
    const names = Array.from(new Set(bills.map(b => b.supplier_name).filter(Boolean))).sort();
    return [{ value: 'all', label: 'All Suppliers' }, ...names.map(n => ({ value: n, label: n }))];
  }, [bills]);

  // Now that /supplier-bills also returns fully-paid POs (see the backend
  // comment), the tab's own red "needs attention" badge would otherwise count
  // every bill ever raised, paid or not — meaningless as an attention count.
  // Scoped to what's actually still owed.
  const unpaidBillsCount = useMemo(() => bills.filter(b => b.payment_status !== 'paid').length, [bills]);
  const unpaidConsultantBillsCount = useMemo(() => consultantBills.filter(b => b.status !== 'paid').length, [consultantBills]);

  // Broken out per currency, same as the Supplier Profile and Procurement
  // Reports fixes — a supplier billed in both USD and SSP would otherwise get
  // summed into one number that isn't really either currency's total.
  const billTotalsByCurrency = useMemo(() => {
    const byCurrency: Record<string, { currency: string; total_billed: number; total_paid: number; total_outstanding: number }> = {};
    for (const b of filteredBills) {
      const cur = b.po_currency || currency.code;
      if (!byCurrency[cur]) byCurrency[cur] = { currency: cur, total_billed: 0, total_paid: 0, total_outstanding: 0 };
      byCurrency[cur].total_billed += parseFloat(String(b.total_amount || 0));
      byCurrency[cur].total_paid += parseFloat(String(b.paid_amount || 0));
      byCurrency[cur].total_outstanding += parseFloat(String(b.balance_due || 0));
    }
    return Object.values(byCurrency).sort((a, b) => b.total_billed - a.total_billed);
  }, [filteredBills, currency.code]);
  const todayTotal = useMemo(() => { const t = today(); return expenses.filter(e => e.expense_date?.startsWith(t) && e.status === 'paid').reduce((s, e) => s + parseFloat(String(e.amount || 0)), 0); }, [expenses]);
  const billsTotal = useMemo(() => bills.reduce((s, b) => s + parseFloat(String(b.balance_due || 0)), 0), [bills]);
  const pendingCount = useMemo(() => expenses.filter(e => e.status === 'pending_approval').length, [expenses]);
  const approvedCount = useMemo(() => expenses.filter(e => e.status === 'approved').length, [expenses]);

  const handleExpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingExp) return;
    if (!expForm.account_id) { toast.error('Select an account'); return; }
    setSubmittingExp(true);
    try {
      const r = await authFetch('/api/daily-expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...expForm, amount: parseFloat(expForm.amount), clinic_id: clinicId, created_by: (user as any)?.display_name || (user as any)?.username || 'admin' }) });
      if (!r.ok) throw new Error();
      const data = await r.json();
      toast.success('Expense submitted — awaiting 3 approvals before voucher is issued');
      setShowExpModal(false);
      setExpForm({ expense_date: today(), description: '', amount: '', account_id: '', account_name: '', category: '', notes: '', payment_method: 'Cash' });
      fetchExpenses();
    } catch { toast.error('Failed to record expense'); }
    finally { setSubmittingExp(false); }
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingPay) return;
    if (!selectedBill || !payForm.account_id) { toast.error('Select an account'); return; }
    setSubmittingPay(true);
    try {
      const r = await authFetch('/api/daily-expenses/supplier-bill-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic_id: clinicId, po_id: selectedBill.id, po_number: selectedBill.po_number, supplier_name: selectedBill.supplier_name,
          payment_date: payForm.payment_date, amount_paid: parseFloat(payForm.amount_paid), payment_method: payForm.payment_method,
          account_id: payForm.account_id, account_name: payForm.account_name, reference_number: payForm.reference_number || null,
          notes: payForm.notes || null, paid_by: payForm.paid_by || (user as any)?.display_name || '',
          approved_by: payForm.approved_by || null, created_by: (user as any)?.display_name || (user as any)?.username || 'admin' }) });
      const data = await r.json();
      if (!r.ok) {
        const colInfo = data.columns?.length ? ` | cols: ${data.columns.slice(0,4).join(', ')}` : '';
        toast.error((data.detail || data.error || 'Failed') + colInfo, { duration: 15000 });
        return;
      }
      toast.success('Payment recorded');
      const bSnap = { ...selectedBill }; const pSnap = { ...payForm };
      setShowPayModal(false); setSelectedBill(null);
      setPayForm({ payment_date: today(), amount_paid: '', account_id: '', account_name: '', payment_method: 'Bank Transfer', reference_number: '', notes: '', paid_by: '', approved_by: '' });
      fetchBills();
      if (data.voucher_number) setTimeout(() => printPayVoucher(bSnap, pSnap, data.voucher_number), 300);
    } catch { toast.error('Failed to record payment'); }
    finally { setSubmittingPay(false); }
  };

  const openPayBill = (bill: SupplierBill) => {
    setSelectedBill(bill);
    setPayForm(p => ({ ...p, amount_paid: parseFloat(String(bill.balance_due || 0)).toFixed(2) }));
    setShowPayModal(true);
  };

  const fi = () => ({ name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo });
  const bi = () => ({ name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone });

  const printExpVoucher = (exp: DailyExpense) => {
    const body = docTemplate.buildInfoGrid(
      { title: 'Expense Details', rows: [{ label: 'Voucher No', value: exp.voucher_number || '-', bold: true }, { label: 'Date', value: new Date(exp.expense_date).toLocaleDateString() }, { label: 'Category', value: exp.category || '-' }, { label: 'Method', value: exp.payment_method || 'Cash' }] },
      { title: 'Payment Info', rows: [{ label: 'Account', value: exp.account_name || '-' }, { label: 'Amount', value: fmt(parseFloat(String(exp.amount || 0))), bold: true }, { label: 'Prepared By', value: exp.created_by || '-' }] }
    ) + `<div class="ic-section-title">Description</div><p style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">${exp.description || '-'}</p>`
      + (exp.notes ? docTemplate.buildNotes(exp.notes) : '')
      + docTemplate.buildSignatures([{ label: 'Prepared By', name: exp.created_by || '' }, { label: 'Approved By', name: '' }, { label: 'Received By', name: '' }]);
    docTemplate.openPrintWindow(docTemplate.buildDocument({ docType: 'EXPENSE VOUCHER', docNumber: exp.voucher_number, date: exp.expense_date, status: expenseVoucherStatus(exp.status, (expApprovals[exp.id] || []).length), bodyHTML: body, facilityInfo: fi(), branchInfo: bi() }));
  };

  const printPayVoucher = (bill: SupplierBill, pay: typeof payForm, voucherNo: string) => {
    const approvals = billApprovals[bill.id] || [];
    const items = billItems[bill.id] || [];
    // Items table — the PO's own currency labels these amounts (they're recorded in
    // po_currency, not the clinic's base currency), so it must take precedence over the
    // system default; only fall back to the system currency if the PO has none recorded.
    const cur = bill.po_currency || currency?.code || '';
    const fmtC = (n: number) => `${cur} ${n.toFixed(2)}`;
    const poItemRows = items.map(item => ({
      cells: [String(item.line_number || ''), item.item_name, item.description || '—', String(item.quantity), item.unit_of_measure || 'Each', fmtC(parseFloat(String(item.unit_price || 0))), fmtC(parseFloat(String(item.total_price || 0)))],
    }));
    const itemsSection = poItemRows.length > 0
      ? `<div class="ic-section-title">Items / Services</div>` + docTemplate.buildTable(
          [{ label: '#', width: '30px' }, { label: 'Item / Description' }, { label: 'Specification' }, { label: 'Qty', align: 'center' as const, width: '50px' }, { label: 'UOM', width: '60px' }, { label: `Unit Price (${cur})`, align: 'right' as const }, { label: `Total (${cur})`, align: 'right' as const }],
          poItemRows,
          ['', 'TOTAL', '', '', '', '', fmtC(parseFloat(String(bill.total_amount || 0)))]
        )
      : '';
    const approvalsTableRows = approvals.map(a => ({ cells: [PO_APPROVAL_LEVELS[a.approval_level - 1] || `Level ${a.approval_level}`, a.approved_by, new Date(a.approved_at).toLocaleDateString()] }));
    const approvalsTable = approvals.length > 0
      ? `<div class="ic-section-title">Approvals</div>` + docTemplate.buildTable(
          [{ label: 'Level' }, { label: 'Approved By' }, { label: 'Date' }],
          approvalsTableRows
        )
      : '';
    const signers = [
      { label: 'Prepared By', name: pay.paid_by || '' },
      ...(approvals[0] ? [{ label: PO_APPROVAL_LEVELS[0], name: approvals[0].approved_by, signature: approvals[0].signature || undefined }] : [{ label: PO_APPROVAL_LEVELS[0], name: '' }]),
      ...(approvals[1] ? [{ label: PO_APPROVAL_LEVELS[1], name: approvals[1].approved_by, signature: approvals[1].signature || undefined }] : [{ label: PO_APPROVAL_LEVELS[1], name: '' }]),
      ...(approvals[2] ? [{ label: PO_APPROVAL_LEVELS[2], name: approvals[2].approved_by, signature: approvals[2].signature || undefined }] : [{ label: PO_APPROVAL_LEVELS[2], name: '' }]),
    ];
    const body = docTemplate.buildInfoGrid(
      { title: 'Payment Details', rows: [{ label: 'Voucher No', value: voucherNo, bold: true }, { label: 'PO Number', value: bill.po_number }, { label: 'Payment Date', value: new Date(pay.payment_date).toLocaleDateString() }, { label: 'Method', value: pay.payment_method }, { label: 'Reference', value: pay.reference_number || '-' }] },
      { title: 'Supplier & Amount', rows: [{ label: 'Supplier', value: bill.supplier_name, bold: true }, { label: 'PO Total', value: fmtC(parseFloat(String(bill.total_amount || 0))) }, { label: 'Amount Paid', value: fmtC(parseFloat(pay.amount_paid || '0')), bold: true }, { label: 'Paid From', value: pay.account_name || '-' }] }
    ) + itemsSection
      + docTemplate.buildSummary([{ label: `PO Total (${cur})`, value: fmtC(parseFloat(String(bill.total_amount || 0))) }, { label: 'Previously Paid', value: fmtC(parseFloat(String(bill.paid_amount || 0))) }, { label: 'This Payment', value: fmtC(parseFloat(pay.amount_paid || '0')), isTotal: true }])
      + approvalsTable
      + (pay.notes ? docTemplate.buildNotes(pay.notes) : '')
      + docTemplate.buildSignatures(signers);
    docTemplate.openPrintWindow(docTemplate.buildDocument({ docType: 'PAYMENT VOUCHER', docNumber: voucherNo, date: pay.payment_date, status: 'PAID', bodyHTML: body, facilityInfo: fi(), branchInfo: bi() }));
  };

  const buildBillVoucher = (bill: SupplierBill, approvals: BillApproval[], opts: { autoPrint?: boolean } = {}, items?: POLineItem[]) => {
    const approvalCount = approvals.length;
    const statusLabel = bill.payment_status === 'paid' ? 'PAID' : bill.payment_status === 'partial' ? 'PARTIALLY PAID' : approvalCount >= 3 ? 'APPROVED — AWAITING PAYMENT' : `PENDING APPROVAL (${approvalCount}/3)`;

    // The PO's own currency labels these amounts — they're recorded in po_currency, not
    // the clinic's base currency — so it takes precedence over the system default.
    const cur = bill.po_currency || currency?.code || '';
    const fmtC = (n: number) => `${cur} ${n.toFixed(2)}`;

    // Approvals progress table
    const approvalsRows = [1, 2, 3].map(level => {
      const a = approvals.find(ap => ap.approval_level === level);
      return {
        cells: [
          PO_APPROVAL_LEVELS[level - 1],
          a ? a.approved_by : '—',
          a ? new Date(a.approved_at).toLocaleDateString() : '—',
          a ? '✓ Approved' : 'Pending',
        ],
        bold: !!a,
      };
    });

    // Signature blocks: all 3 levels + supplier receipt
    const signers = [
      ...[1, 2, 3].map(level => {
        const a = approvals.find(ap => ap.approval_level === level);
        return {
          label: PO_APPROVAL_LEVELS[level - 1],
          name: a?.approved_by || '',
          signature: a?.signature || undefined,
        };
      }),
      { label: 'Received By (Supplier)', name: bill.supplier_name },
    ];

    // Items table
    const itemRows = (items || []).map(item => ({
      cells: [
        String(item.line_number || ''),
        item.item_name,
        item.description || '—',
        String(item.quantity),
        item.unit_of_measure || 'Each',
        fmt(parseFloat(String(item.unit_price || 0))),
        fmt(parseFloat(String(item.total_price || 0))),
      ],
    }));
    const itemsSection = itemRows.length > 0
      ? `<div class="ic-section-title">Items / Services</div>`
        + docTemplate.buildTable(
            [
              { label: '#', width: '30px' },
              { label: 'Item / Description' },
              { label: 'Specification' },
              { label: 'Qty', align: 'center' as const, width: '50px' },
              { label: 'UOM', width: '60px' },
              { label: `Unit Price (${cur})`, align: 'right' as const },
              { label: `Total (${cur})`, align: 'right' as const },
            ],
            itemRows,
            ['', 'TOTAL', '', '', '', '', fmtC(parseFloat(String(bill.total_amount || 0)))]
          )
      : '';

    const body = docTemplate.buildInfoGrid(
      { title: 'Purchase Order', rows: [
        { label: 'PO Number', value: bill.po_number, bold: true },
        { label: 'PO Date', value: new Date(bill.order_date).toLocaleDateString() },
        { label: 'Currency', value: cur },
        { label: 'Payment Terms', value: bill.payment_terms || '—' },
      ]},
      { title: 'Supplier & Payment', rows: [
        { label: 'Supplier', value: bill.supplier_name, bold: true },
        { label: 'Total Amount', value: fmtC(parseFloat(String(bill.total_amount || 0))), bold: true },
        { label: 'Amount Paid', value: fmtC(parseFloat(String(bill.paid_amount || 0))) },
        { label: 'Balance Due', value: fmtC(parseFloat(String(bill.balance_due || 0))), bold: parseFloat(String(bill.balance_due)) > 0 },
      ]}
    )
    + itemsSection
    + docTemplate.buildSummary([
      { label: `Total Amount (${cur})`, value: fmtC(parseFloat(String(bill.total_amount || 0))) },
      { label: 'Amount Paid', value: fmtC(parseFloat(String(bill.paid_amount || 0))) },
      { label: 'Balance Due', value: fmtC(parseFloat(String(bill.balance_due || 0))), isTotal: true },
    ])
    + `<div class="ic-section-title">Approval Status</div>`
    + docTemplate.buildTable(
        [
          { label: 'Level' },
          { label: 'Approved By' },
          { label: 'Date' },
          { label: 'Status', align: 'center' as const },
        ],
        approvalsRows
      )
    + docTemplate.buildSignatures(signers);

    return docTemplate.buildDocument({
      docType: 'PAYMENT VOUCHER',
      docNumber: bill.po_number,
      date: today(),
      status: statusLabel,
      bodyHTML: body,
      facilityInfo: fi(),
      branchInfo: bi(),
      autoPrint: opts.autoPrint ?? false,
    });
  };

  const downloadBillVoucher = (bill: SupplierBill) => {
    const approvals = billApprovals[bill.id] || [];
    const items = billItems[bill.id] || [];
    const html = buildBillVoucher(bill, approvals, { autoPrint: false }, items);
    docTemplate.downloadDocument(html, `Payment-Voucher-${bill.po_number}`);
    toast.success(`Voucher downloaded: Payment-Voucher-${bill.po_number}.html`);
  };

  const previewBillVoucher = (bill: SupplierBill) => {
    const approvals = billApprovals[bill.id] || [];
    const items = billItems[bill.id] || [];
    const html = buildBillVoucher(bill, approvals, { autoPrint: true }, items);
    docTemplate.openPrintWindow(html);
  };

  const AccountCombobox = ({ value, onSelect, open, onOpenChange }: { value: string; onSelect: (id: string, name: string) => void; open: boolean; onOpenChange: (o: boolean) => void }) => {
    const sel = coaAccounts.find(a => String(a.id) === value);
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal text-sm h-9">
            <span className="truncate text-left">{sel ? sel.account_name : 'Select account from Chart of Accounts...'}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[460px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by name or code..." />
            <CommandList className="max-h-56">
              <CommandEmpty>No accounts found.</CommandEmpty>
              <CommandGroup>
                {coaAccounts.map(acc => (
                  // `value` still carries the account code so the search box can
                  // match on it, even though the code is no longer displayed.
                  <CommandItem key={acc.id} value={`${acc.account_code} ${acc.account_name}`} onSelect={() => { onSelect(String(acc.id), acc.account_name); onOpenChange(false); }}>
                    <Check className={`mr-2 h-4 w-4 shrink-0 ${String(acc.id) === value ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="flex-1 truncate text-sm font-medium">{acc.account_name}</span>
                    <span className="ml-3 shrink-0 text-xs text-muted-foreground">{acc.account_type}{(acc.current_balance != null || acc.balance != null) ? ` · Bal: ${fmt(parseFloat(String(acc.current_balance ?? acc.balance ?? 0)))}` : ''}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<DollarSign />}
          title="Payments & Expenses"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { fetchExpenses(); fetchBills(); fetchConsultantBills(); }}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
              {tab === 'expenses' && <Button onClick={() => setShowExpModal(true)}><Plus className="w-4 h-4 mr-2" />Add Expense</Button>}
            </div>
          }
        />


        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="expenses" className="gap-2"><Receipt className="w-4 h-4" />Expenses{pendingCount > 0 && <Badge variant="destructive" className="ml-1 text-xs px-1.5 py-0">{pendingCount}</Badge>}</TabsTrigger>
            <TabsTrigger value="bills" className="gap-2">
              <Building2 className="w-4 h-4" />Supplier Bills
              {unpaidBillsCount > 0 && <Badge variant="destructive" className="ml-1 text-xs px-1.5 py-0">{unpaidBillsCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="consultant-bills" className="gap-2">
              <Stethoscope className="w-4 h-4" />Consultant Bills
              {unpaidConsultantBillsCount > 0 && <Badge variant="destructive" className="ml-1 text-xs px-1.5 py-0">{unpaidConsultantBillsCount}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── EXPENSES TAB ── */}
          <TabsContent value="expenses" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base">
                  Expense History
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {expFrom === expTo ? new Date(expFrom).toLocaleDateString() : `${new Date(expFrom).toLocaleDateString()} — ${new Date(expTo).toLocaleDateString()}`}
                    {' · '}{filteredExpenses.length} item{filteredExpenses.length === 1 ? '' : 's'}
                    {' · '}<strong className="text-foreground">{fmt(filteredExpenses.reduce((sum, e) => sum + (parseFloat(String(e.amount || 0)) || 0), 0))}</strong>
                  </span>
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <Input type="date" className="h-8 w-[9.5rem] text-sm" value={expFrom} max={expTo}
                    onChange={e => setExpFrom(e.target.value)} title="From date" />
                  <span className="text-muted-foreground text-xs">to</span>
                  <Input type="date" className="h-8 w-[9.5rem] text-sm" value={expTo} min={expFrom}
                    onChange={e => setExpTo(e.target.value)} title="To date" />
                  <Button variant="outline" size="sm" className="h-8 text-xs"
                    onClick={() => { const t = todayStr(); setExpFrom(t); setExpTo(t); }}>Today</Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportExpensesCSV}>
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />CSV
                  </Button>
                  <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Search..." className="pl-8 h-8 w-40 text-sm" value={searchExp} onChange={e => setSearchExp(e.target.value)} /></div>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <AdvancedDataTable<DailyExpense>
                  data={filteredExpenses}
                  keyExtractor={(exp) => exp.id}
                  loading={loadingExp}
                  emptyMessage="No expenses found"
                  onRowClick={(exp) => navigate(`/procurement/daily-expenses/${exp.id}`)}
                  rowClassName={(exp) => exp.status === 'pending_approval' ? 'bg-amber-50/40' : ''}
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    { key: 'voucher_number', header: 'Voucher', render: (v) => <span className="font-mono text-xs text-muted-foreground">{v || <span className="text-amber-500 italic">pending</span>}</span> },
                    { key: 'expense_date', header: 'Date', sortable: true, render: (v) => <span className="whitespace-nowrap">{new Date(v).toLocaleDateString()}</span> },
                    { key: 'description', header: 'Description', render: (v) => <span className="font-medium max-w-[200px] truncate block">{v}</span> },
                    { key: 'category', header: 'Category', render: (v) => <Badge variant="outline" className="text-xs">{v || '-'}</Badge> },
                    { key: 'account_name', header: 'Account', render: (v) => <span className="text-xs text-muted-foreground">{v}</span> },
                    { key: 'payment_method', header: 'Method', render: (v) => <span className="text-xs">{v || 'Cash'}</span> },
                    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (v) => <span className="font-semibold text-destructive">{fmt(parseFloat(String(v || 0)))}</span> },
                    {
                      key: 'status', header: 'Status',
                      render: (v, exp) => {
                        const approvalCount = (expApprovals[exp.id] || []).length;
                        if (v === 'pending_approval') return <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100">Pending {approvalCount}/2</Badge>;
                        if (v === 'approved') return <Badge className="text-xs bg-primary/10 text-primary border-primary/40 hover:bg-primary/10">Approved</Badge>;
                        if (v === 'rejected') return <Badge className="text-xs bg-destructive/10 text-destructive border-destructive/40 hover:bg-destructive/10">Rejected</Badge>;
                        return <Badge className="text-xs bg-green-100 text-green-800 border-green-300 hover:bg-green-100">Paid</Badge>;
                      },
                    },
                    {
                      key: '__actions', header: '',
                      render: (_v, exp) => {
                        const isPending = exp.status === 'pending_approval';
                        // Editing and removing are only offered while nobody has
                        // approved yet — after that the figures are what someone
                        // signed against. Rejecting stays available for as long as
                        // the expense is unpaid, since that is the case it exists
                        // for: an approver disagreeing with what was submitted.
                        const noApprovalsYet = (expApprovals[exp.id] || []).length === 0;
                        const busy = busyExpId === exp.id;
                        return (
                          <div className="flex items-center gap-1">
                            {isPending && noApprovalsYet && (
                              <>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={busy} title="Edit"
                                  onClick={(e) => { e.stopPropagation(); setEditExpense(exp); }}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" disabled={busy} title="Remove"
                                  onClick={(e) => { e.stopPropagation(); removeExpense(exp); }}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            )}
                            {isPending && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-xs px-2 border-amber-300 text-amber-700 hover:bg-amber-50" disabled={busy} onClick={(e) => { e.stopPropagation(); openExpApprove(exp); }}>
                                  <ShieldCheck className="w-3 h-3 mr-1" />Approve
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs px-2 border-destructive/40 text-destructive hover:bg-destructive/5" disabled={busy} onClick={(e) => { e.stopPropagation(); setRejectExpense(exp); setRejectReason(''); }}>
                                  <Ban className="w-3 h-3 mr-1" />Reject
                                </Button>
                              </>
                            )}
                            {!isPending && exp.status !== 'rejected' && (
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); printExpVoucher(exp); }} title="Print Voucher"><Printer className="w-3.5 h-3.5" /></Button>
                            )}
                          </div>
                        );
                      },
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── SUPPLIER BILLS TAB ── */}
          <TabsContent value="bills" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3 flex-wrap gap-2">
                <CardTitle className="text-base">
                  Authorized PO Bills
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{filteredBills.length} bill{filteredBills.length === 1 ? '' : 's'}</span>
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <Input type="date" className="h-8 w-[9.5rem] text-sm" value={billFrom} max={billTo || undefined}
                    onChange={e => setBillFrom(e.target.value)} title="From date" />
                  <span className="text-muted-foreground text-xs">to</span>
                  <Input type="date" className="h-8 w-[9.5rem] text-sm" value={billTo} min={billFrom || undefined}
                    onChange={e => setBillTo(e.target.value)} title="To date" />
                  {(billFrom || billTo) && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setBillFrom(''); setBillTo(''); }}>Clear</Button>
                  )}
                  <Combobox
                    options={supplierOptions}
                    value={supplierFilter}
                    onChange={setSupplierFilter}
                    searchPlaceholder="Search suppliers..."
                    className="h-8 w-44 text-sm"
                  />
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportBillsCSV}>
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />CSV
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={generateBillsReportPDF}>
                    <Download className="w-3.5 h-3.5 mr-1.5" />PDF
                  </Button>
                  <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Search PO or supplier..." className="pl-8 h-8 w-52 text-sm" value={searchBills} onChange={e => setSearchBills(e.target.value)} /></div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {/* Totals broken out by currency — see billTotalsByCurrency: summing a USD
                    bill and an SSP bill into one number would blend two different
                    currencies together as though they were the same money. */}
                {billTotalsByCurrency.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {billTotalsByCurrency.map(c => (
                      <div key={c.currency} className="flex-1 min-w-[280px] border rounded-lg p-4 bg-muted/20">
                        <p className="text-sm font-bold text-foreground mb-2">{c.currency}</p>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-0.5">Total Billed</p>
                            <p className="font-mono font-bold text-xl leading-tight">{docTemplate.formatCurrency(c.total_billed, c.currency)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-0.5">Total Paid</p>
                            <p className="font-mono font-bold text-xl leading-tight text-emerald-700">{docTemplate.formatCurrency(c.total_paid, c.currency)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-0.5">Outstanding</p>
                            <p className="font-mono font-bold text-xl leading-tight text-amber-700">{docTemplate.formatCurrency(c.total_outstanding, c.currency)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <AdvancedDataTable<SupplierBill>
                  data={filteredBills}
                  keyExtractor={(bill) => bill.id}
                  loading={loadingBills}
                  emptyMessage="No supplier bills found"
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    { key: 'po_number', header: 'PO Number', render: (v) => <span className="font-mono font-medium text-xs">{v}</span> },
                    { key: 'order_date', header: 'Date', sortable: true, render: (v) => <span className="whitespace-nowrap text-sm">{new Date(v).toLocaleDateString()}</span> },
                    { key: 'supplier_name', header: 'Supplier', sortable: true, render: (v) => <span className="font-medium text-sm">{v}</span> },
                    {
                      key: 'total_amount', header: 'PO Total', align: 'right', sortable: true,
                      render: (v, bill) => {
                        const amt = parseFloat(String(v || 0));
                        const cur = bill.po_currency || currency.code;
                        const base = toBaseCurrency(amt, bill.po_currency);
                        return (
                          <div className="leading-tight">
                            <span className="font-mono text-sm">{cur} {amt.toFixed(2)}</span>
                            {base != null && <div className="text-[11px] text-muted-foreground font-mono">≈ {fmt(base)}</div>}
                          </div>
                        );
                      },
                    },
                    {
                      key: 'balance_due', header: 'Balance Due', align: 'right', sortable: true,
                      render: (v, bill) => {
                        const amt = parseFloat(String(v || 0));
                        const cur = bill.po_currency || currency.code;
                        const base = toBaseCurrency(amt, bill.po_currency);
                        return (
                          <div className="leading-tight">
                            <span className="font-mono font-bold text-orange-600 text-sm">{cur} {amt.toFixed(2)}</span>
                            {base != null && <div className="text-[11px] text-muted-foreground font-mono">≈ {fmt(base)} to post</div>}
                          </div>
                        );
                      },
                    },
                    {
                      key: '__approvals', header: 'Approvals',
                      render: (_v, bill) => {
                        const approvals = billApprovals[bill.id] || [];
                        const approvalCount = approvals.length;
                        const fullyApproved = approvalCount >= 3;
                        return (
                          <div className="flex items-center gap-1">
                            {[1, 2, 3].map(level => {
                              const a = approvals.find(ap => ap.approval_level === level);
                              return (
                                <div key={level} title={a ? `${a.approved_by}${a.approved_by_title ? ' · ' + a.approved_by_title : ''}` : `Level ${level} pending`}
                                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${a ? 'bg-green-500 border-green-500 text-white' : 'bg-muted border-muted-foreground/30 text-muted-foreground'}`}>
                                  {a ? '✓' : level}
                                </div>
                              );
                            })}
                            <span className={`ml-1 text-xs font-medium ${fullyApproved ? 'text-green-600' : 'text-muted-foreground'}`}>{approvalCount}/3</span>
                          </div>
                        );
                      },
                    },
                    {
                      key: 'payment_status', header: 'Status',
                      render: (v) => <Badge variant={v === 'partial' ? 'secondary' : 'outline'} className="text-xs capitalize">{v || 'unpaid'}</Badge>,
                    },
                    {
                      key: '__actions', header: 'Actions',
                      render: (_v, bill) => {
                        const approvalCount = (billApprovals[bill.id] || []).length;
                        const fullyApproved = approvalCount >= 3;
                        // payment_status is the authoritative field, but a stale/missing
                        // value shouldn't leave Pay clickable on a bill with nothing left
                        // owed — balance_due backs it up.
                        const isFullyPaid = bill.payment_status === 'paid' || parseFloat(String(bill.balance_due ?? 0)) <= 0.01;
                        return (
                          <div className="flex items-center gap-1">
                            {!fullyApproved && (
                              <Button size="sm" variant="outline" className="h-7 text-xs px-2 border-primary/40 text-primary hover:bg-primary/10" onClick={() => openApprove(bill)}>
                                Approve
                              </Button>
                            )}
                            {!isFullyPaid && (
                              <Button size="sm" variant={fullyApproved ? 'default' : 'ghost'} disabled={!fullyApproved}
                                className={`h-7 text-xs px-2 ${!fullyApproved ? 'opacity-40 cursor-not-allowed' : ''}`}
                                onClick={() => fullyApproved && openPayBill(bill)}
                                title={fullyApproved ? 'Pay this bill' : 'Requires 3 approvals before payment'}>
                                Pay
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Download Voucher" onClick={() => downloadBillVoucher(bill)}>
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Print / Preview Voucher" onClick={() => previewBillVoucher(bill)}>
                              <Printer className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        );
                      },
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CONSULTANT BILLS TAB ── */}
          <TabsContent value="consultant-bills" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3 flex-wrap gap-2">
                <CardTitle className="text-base">
                  Consultant Bills
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{filteredConsultantBills.length} bill{filteredConsultantBills.length === 1 ? '' : 's'}</span>
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Search consultant or bill no..." className="pl-8 h-8 w-56 text-sm" value={searchConsultantBills} onChange={e => setSearchConsultantBills(e.target.value)} /></div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <p className="text-xs text-muted-foreground -mt-1">
                  Created from a consultant's profile page — a percentage of the consultation revenue collected for them over a period. Pay them here, same as a supplier bill.
                </p>
                {consultantBillTotalsByCurrency.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {consultantBillTotalsByCurrency.map(c => (
                      <div key={c.currency} className="flex-1 min-w-[280px] border rounded-lg p-4 bg-muted/20">
                        <p className="text-sm font-bold text-foreground mb-2">{c.currency}</p>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-0.5">Total Billed</p>
                            <p className="font-mono font-bold text-xl leading-tight">{docTemplate.formatCurrency(c.total_billed, c.currency)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-0.5">Total Paid</p>
                            <p className="font-mono font-bold text-xl leading-tight text-emerald-700">{docTemplate.formatCurrency(c.total_paid, c.currency)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-0.5">Outstanding</p>
                            <p className="font-mono font-bold text-xl leading-tight text-amber-700">{docTemplate.formatCurrency(c.total_outstanding, c.currency)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <AdvancedDataTable<ConsultantBill>
                  data={filteredConsultantBills}
                  keyExtractor={(b) => b.id}
                  loading={loadingConsultantBills}
                  emptyMessage="No consultant bills yet — create one from a consultant's profile page under Human Resources."
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    { key: 'bill_number', header: 'Bill No.', render: (v) => <span className="font-mono font-medium text-xs">{v}</span> },
                    { key: 'first_name', header: 'Consultant', render: (_v, b) => <span className="font-medium text-sm">{b.first_name} {b.last_name}</span> },
                    { key: 'period_from', header: 'Period', render: (_v, b) => <span className="text-xs whitespace-nowrap">{new Date(b.period_from).toLocaleDateString()} – {new Date(b.period_to).toLocaleDateString()}</span> },
                    { key: 'total_consultation_revenue', header: 'Revenue Collected', align: 'right', render: (v, b) => <span className="font-mono text-sm">{b.currency} {parseFloat(String(v || 0)).toFixed(2)}</span> },
                    { key: 'fee_percentage', header: 'Fee %', align: 'center', render: (v) => <span className="text-sm">{v}%</span> },
                    { key: 'bill_amount', header: 'Bill Amount', align: 'right', sortable: true, render: (v, b) => <span className="font-mono font-bold text-sm">{b.currency} {parseFloat(String(v || 0)).toFixed(2)}</span> },
                    { key: 'status', header: 'Status', render: (v) => <Badge variant={v === 'paid' ? 'outline' : 'secondary'} className={`text-xs capitalize ${v === 'paid' ? 'text-emerald-700 border-emerald-300' : ''}`}>{v}</Badge> },
                    {
                      key: '__actions', header: 'Actions',
                      render: (_v, b) => (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant={b.status === 'unpaid' ? 'default' : 'ghost'} disabled={b.status !== 'unpaid'}
                            className={`h-7 text-xs px-2 ${b.status !== 'unpaid' ? 'opacity-40 cursor-not-allowed' : ''}`}
                            onClick={() => b.status === 'unpaid' && openPayConsultantBill(b)}>
                            Pay
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ── ADD EXPENSE MODAL ── */}
        <Dialog open={showExpModal} onOpenChange={setShowExpModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Record Daily Expense</DialogTitle>
              <DialogDescription>All payments are linked to the Chart of Accounts</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleExpSubmit} className="space-y-3 px-6 pb-6 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Date *</Label><Input type="date" className="mt-1" value={expForm.expense_date} onChange={e => setExpForm(f => ({...f, expense_date: e.target.value}))} required /></div>
                <div>
                  <Label className="text-xs">Category</Label>
                  <Combobox
                    options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))}
                    value={expForm.category}
                    onChange={v => setExpForm(f => ({...f, category: v}))}
                    placeholder="Select category"
                    searchPlaceholder="Search..."
                    className="mt-1 h-9"
                  />
                </div>
              </div>
              <div><Label className="text-xs">Description *</Label><Input className="mt-1" value={expForm.description} onChange={e => setExpForm(f => ({...f, description: e.target.value}))} placeholder="What was purchased/paid for" required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Amount ({currency.code}) *</Label><Input type="number" step="0.01" min="0.01" className="mt-1" value={expForm.amount} onChange={e => setExpForm(f => ({...f, amount: e.target.value}))} required /></div>
                <div>
                  <Label className="text-xs">Payment Method</Label>
                  <Combobox
                    options={PAYMENT_METHODS.map(m => ({ value: m, label: m }))}
                    value={expForm.payment_method}
                    onChange={v => setExpForm(f => ({...f, payment_method: v}))}
                    searchPlaceholder="Search..."
                    className="mt-1 h-9"
                  />
                </div>
              </div>
              <div><Label className="text-xs">Deduct From Account (CoA) *</Label><div className="mt-1"><AccountCombobox value={expForm.account_id} onSelect={(id, name) => setExpForm(f => ({...f, account_id: id, account_name: name}))} open={openExpCombo} onOpenChange={setOpenExpCombo} /></div></div>
              <div><Label className="text-xs">Notes</Label><Textarea className="mt-1 text-sm" rows={2} value={expForm.notes} onChange={e => setExpForm(f => ({...f, notes: e.target.value}))} placeholder="Additional details..." /></div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" type="submit" className="h-8 px-4 text-xs" disabled={submittingExp}>{submittingExp ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Submitting...</> : <><ShieldCheck className="w-3 h-3 mr-2" />Submit for Approval</>}</Button>
                <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs" onClick={() => setShowExpModal(false)}>Cancel</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── EDIT EXPENSE (only before any approval) ── */}
        <Dialog open={!!editExpense} onOpenChange={(o) => { if (!o) setEditExpense(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Expense</DialogTitle>
              <DialogDescription>Corrections are only possible until someone approves it.</DialogDescription>
            </DialogHeader>
            {editExpense && (() => {
              const e = editExpense;
              const set = (patch: Partial<DailyExpense>) => setEditExpense({ ...e, ...patch } as DailyExpense);
              return (
                <form
                  className="space-y-3 px-6 pb-6 pt-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    if (!(parseFloat(String(e.amount)) > 0)) { toast.error('Amount must be greater than zero'); return; }
                    if (!String(e.description || '').trim()) { toast.error('Description is required'); return; }
                    saveExpenseEdit({
                      expense_date: e.expense_date, description: e.description, amount: parseFloat(String(e.amount)),
                      category: e.category, notes: e.notes, payment_method: e.payment_method,
                      account_id: e.account_id,
                    } as any);
                  }}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Date *</Label>
                      <Input type="date" className="mt-1"
                        value={e.expense_date ? String(e.expense_date).slice(0, 10) : ''}
                        onChange={ev => set({ expense_date: ev.target.value } as any)} required /></div>
                    <div><Label className="text-xs">Category</Label>
                      <Combobox options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))}
                        value={e.category || ''} onChange={v => set({ category: v } as any)}
                        placeholder="Select category" searchPlaceholder="Search..." className="mt-1 h-9" /></div>
                  </div>
                  <div><Label className="text-xs">Description *</Label>
                    <Input className="mt-1" value={e.description || ''}
                      onChange={ev => set({ description: ev.target.value } as any)} required /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Amount ({currency.code}) *</Label>
                      <Input type="number" step="0.01" min="0.01" className="mt-1" value={String(e.amount ?? '')}
                        onChange={ev => set({ amount: ev.target.value } as any)} required /></div>
                    <div><Label className="text-xs">Payment Method</Label>
                      <Combobox options={PAYMENT_METHODS.map(m => ({ value: m, label: m }))}
                        value={e.payment_method || 'Cash'} onChange={v => set({ payment_method: v } as any)}
                        searchPlaceholder="Search..." className="mt-1 h-9" /></div>
                  </div>
                  <div><Label className="text-xs">Deduct From Account (CoA)</Label>
                    <div className="mt-1">
                      <AccountCombobox value={String(e.account_id || '')}
                        onSelect={(id, name) => set({ account_id: id, account_name: name } as any)}
                        open={openEditCombo} onOpenChange={setOpenEditCombo} />
                    </div></div>
                  <div><Label className="text-xs">Notes</Label>
                    <Textarea className="mt-1 text-sm" rows={2} value={e.notes || ''}
                      onChange={ev => set({ notes: ev.target.value } as any)} /></div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" type="submit" className="h-8 px-4 text-xs" disabled={busyExpId === e.id}>
                      {busyExpId === e.id ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Saving...</> : <><Check className="w-3 h-3 mr-2" />Save Changes</>}
                    </Button>
                    <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs" onClick={() => setEditExpense(null)}>Cancel</Button>
                  </div>
                </form>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* ── REJECT EXPENSE ── */}
        <Dialog open={!!rejectExpense} onOpenChange={(o) => { if (!o) { setRejectExpense(null); setRejectReason(''); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Reject Expense</DialogTitle>
              <DialogDescription>
                {rejectExpense && `${rejectExpense.description} — ${fmt(parseFloat(String(rejectExpense.amount || 0)))}`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 px-6 pb-6 pt-2">
              <p className="text-xs text-muted-foreground">
                The expense is kept with the reason recorded against it, and any approvals
                already given are cleared so a corrected version starts afresh.
              </p>
              <div>
                <Label className="text-xs">Reason *</Label>
                <Textarea className="mt-1 text-sm" rows={3} value={rejectReason}
                  onChange={ev => setRejectReason(ev.target.value)}
                  placeholder="Why is this being rejected?" />
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="destructive" className="h-8 px-4 text-xs"
                  disabled={busyExpId === rejectExpense?.id} onClick={submitReject}>
                  {busyExpId === rejectExpense?.id ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Rejecting...</> : <><Ban className="w-3 h-3 mr-2" />Reject Expense</>}
                </Button>
                <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs"
                  onClick={() => { setRejectExpense(null); setRejectReason(''); }}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── APPROVE EXPENSE MODAL ── */}
        <Dialog open={showExpApproveModal} onOpenChange={setShowExpApproveModal}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Approve Expense</DialogTitle>
              <DialogDescription>{approveExpense && `${approveExpense.description} — ${fmt(parseFloat(String(approveExpense.amount || 0)))}`}</DialogDescription>
            </DialogHeader>
            {approveExpense && (() => {
              const approvals = expApprovals[approveExpense.id] || [];
              const nextLevel = approvals.length + 1;
              return (
                <form onSubmit={handleExpApproveSubmit} className="space-y-4 px-6 pb-6 pt-2">
                  {/* Approval progress */}
                  <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Approval Progress</p>
                    {[1,2].map(level => {
                      const a = approvals.find(ap => ap.approval_level === level);
                      const isNext = level === nextLevel;
                      return (
                        <div key={level} className={`flex items-center gap-2 text-sm rounded px-2 py-1 ${isNext ? 'bg-amber-50 border border-amber-200' : ''}`}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0 ${a ? 'bg-green-500 border-green-500 text-white' : isNext ? 'bg-amber-100 border-amber-400 text-amber-700' : 'bg-muted border-muted-foreground/30 text-muted-foreground'}`}>
                            {a ? '✓' : level}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-xs">{APPROVAL_LEVELS[level - 1]}</span>
                            {a && <span className="text-xs text-green-700 ml-2">— {a.approved_by}</span>}
                            {isNext && !a && <span className="text-xs text-amber-600 ml-2">← Your approval</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Expense summary */}
                  <div className="rounded-md border p-3 bg-muted/20 text-xs space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{new Date(approveExpense.expense_date).toLocaleDateString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span>{approveExpense.category || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Account</span><span>{approveExpense.account_name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Method</span><span>{approveExpense.payment_method || 'Cash'}</span></div>
                    <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Amount</span><span className="text-destructive">{fmt(parseFloat(String(approveExpense.amount || 0)))}</span></div>
                  </div>

                  {nextLevel <= 2 ? (
                    <>
                      <div className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        Submitting: <strong>{APPROVAL_LEVELS[nextLevel - 1]}</strong>
                      </div>

                      <div className="rounded-md border p-3 bg-muted/40 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Approving As</p>
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <p className="font-semibold text-sm">{userProfile?.displayName || (user as any)?.display_name || 'Loading...'}</p>
                            <p className="text-xs text-muted-foreground">{userProfile?.email || ''}</p>
                          </div>
                          {userProfile?.signature ? (
                            <div className="border rounded p-1 bg-white"><img src={userProfile.signature} alt="sig" className="h-10 max-w-[120px] object-contain" /></div>
                          ) : (
                            <div className="border rounded p-2 bg-white text-xs text-muted-foreground text-center w-[100px]">No signature<br/>on profile</div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <Button size="sm" type="submit" className="h-8 px-4 text-xs bg-amber-600 hover:bg-amber-700 text-white" disabled={submittingExpApproval}>
                          {submittingExpApproval ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Approving...</> : <><ShieldCheck className="w-3 h-3 mr-2" />Approve ({nextLevel}/2)</>}
                        </Button>
                        <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs" onClick={() => setShowExpApproveModal(false)}>Cancel</Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-green-600 font-semibold">✓ Both approvals complete</p>
                      <p className="text-sm text-muted-foreground mt-1">Voucher has been generated. You can now print it.</p>
                      <Button className="mt-3" onClick={() => { setShowExpApproveModal(false); fetchExpenses(); }}>Done</Button>
                    </div>
                  )}
                </form>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* ── APPROVE BILL MODAL ── */}
        <Dialog open={showApproveModal} onOpenChange={setShowApproveModal}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Approve Supplier Bill</DialogTitle>
              <DialogDescription>{approveBill && `${approveBill.po_number} — ${approveBill.supplier_name}`}</DialogDescription>
            </DialogHeader>
            {approveBill && (() => {
              const approvals = billApprovals[approveBill.id] || [];
              const nextLevel = approvals.length + 1;
              return (
                <form onSubmit={handleApproveSubmit} className="space-y-4 px-6 pb-6 pt-2">
                  {/* Approval progress */}
                  <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Approval Progress</p>
                    {[1,2,3].map(level => {
                      const a = approvals.find(ap => ap.approval_level === level);
                      const isNext = level === nextLevel;
                      return (
                        <div key={level} className={`flex items-center gap-2 text-sm rounded px-2 py-1 ${isNext ? 'bg-primary/10 border border-primary/30' : ''}`}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0 ${a ? 'bg-green-500 border-green-500 text-white' : isNext ? 'bg-primary/10 border-primary/60 text-primary' : 'bg-muted border-muted-foreground/30 text-muted-foreground'}`}>
                            {a ? '✓' : level}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-xs">{PO_APPROVAL_LEVELS[level - 1]}</span>
                            {a && <span className="text-xs text-green-700 ml-2">— {a.approved_by}{a.approved_by_title ? ` (${a.approved_by_title})` : ''}</span>}
                            {isNext && !a && <span className="text-xs text-primary ml-2">← Your approval</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {nextLevel <= 3 ? (
                    <>
                      <div className="text-sm font-medium text-primary bg-primary/10 border border-primary/30 rounded px-3 py-2 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        Submitting: <strong>{PO_APPROVAL_LEVELS[nextLevel - 1]}</strong>
                      </div>

                      {/* Auto-captured identity */}
                      <div className="rounded-md border p-3 bg-muted/40 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Approving As</p>
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <p className="font-semibold text-sm">{userProfile?.displayName || (user as any)?.display_name || 'Loading...'}</p>
                            <p className="text-xs text-muted-foreground">{userProfile?.email || ''}</p>
                            <p className="text-xs text-muted-foreground capitalize">{userProfile?.role || ''}</p>
                          </div>
                          {userProfile?.signature ? (
                            <div className="border rounded p-1 bg-white">
                              <p className="text-xs text-muted-foreground mb-1 text-center">Signature</p>
                              <img src={userProfile.signature} alt="Your signature" className="h-10 max-w-[120px] object-contain" />
                            </div>
                          ) : (
                            <div className="border rounded p-2 bg-white text-xs text-muted-foreground text-center w-[100px]">
                              No signature<br/>on profile
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <Button size="sm" type="submit" className="h-8 px-4 text-xs" disabled={submittingApproval}>
                          {submittingApproval ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Approving...</> : <><ShieldCheck className="w-3 h-3 mr-2" />Approve ({nextLevel}/3)</>}
                        </Button>
                        <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs" onClick={() => setShowApproveModal(false)}>Cancel</Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-green-600 font-semibold">✓ All 3 approvals complete</p>
                      <p className="text-sm text-muted-foreground mt-1">This bill is ready for payment.</p>
                      <Button className="mt-3" onClick={() => { setShowApproveModal(false); openPayBill(approveBill); }}>Proceed to Payment</Button>
                    </div>
                  )}
                </form>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* ── PAY SUPPLIER BILL MODAL ── */}
        <Dialog open={showPayModal} onOpenChange={setShowPayModal}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Pay Supplier Bill</DialogTitle>
              <DialogDescription>
                {selectedBill && (() => {
                  const cur = selectedBill.po_currency || currency.code;
                  const amt = parseFloat(String(selectedBill.balance_due || 0));
                  const base = toBaseCurrency(amt, selectedBill.po_currency);
                  return `${selectedBill.po_number} — ${selectedBill.supplier_name} · Balance Due: ${cur} ${amt.toFixed(2)}${base != null ? ` (≈ ${fmt(base)})` : ''}`;
                })()}
              </DialogDescription>
            </DialogHeader>
            {selectedBill && (
              <form onSubmit={handlePaySubmit} className="space-y-3 px-6 pb-6 pt-2">
                {/* PO Line Items — what is being paid for. These amounts are recorded in
                    the PO's own currency (po_currency), not the clinic's base currency,
                    so that must label them — falling back to the system currency only if
                    the PO has none recorded. */}
                {(() => {
                  const items = billItems[selectedBill.id] || [];
                  const payCur = selectedBill.po_currency || currency.code;
                  if (!items.length) return null;
                  return (
                    <div className="rounded-md border overflow-hidden">
                      <div className="bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Items Being Paid For ({payCur})</div>
                      <AdvancedDataTable<POLineItem>
                        data={items}
                        keyExtractor={(item, i) => item.line_number ?? i}
                        columns={[
                          { key: 'line_number', header: '#', render: (v, item, i) => <span className="text-muted-foreground">{v || i + 1}</span> },
                          {
                            key: 'item_name', header: 'Item / Description',
                            render: (v, item) => (
                              <>
                                <div className="font-medium">{v}</div>
                                {item.description && <div className="text-muted-foreground text-xs">{item.description}</div>}
                              </>
                            ),
                          },
                          { key: 'quantity', header: 'Qty', align: 'center' },
                          { key: 'unit_of_measure', header: 'UOM', render: (v) => <span className="text-muted-foreground">{v || 'Each'}</span> },
                          { key: 'unit_price', header: `Unit Price (${payCur})`, align: 'right', render: (v) => <span className="font-mono">{payCur} {parseFloat(String(v || 0)).toFixed(2)}</span> },
                          { key: 'total_price', header: `Total (${payCur})`, align: 'right', render: (v) => <span className="font-mono font-medium">{payCur} {parseFloat(String(v || 0)).toFixed(2)}</span> },
                        ]}
                      />
                      <div className="bg-muted/40 border-t px-3 py-1.5 flex justify-between">
                        <span className="font-semibold text-xs">TOTAL ({payCur})</span>
                        <span className="font-mono font-bold text-sm">{payCur} {parseFloat(String(selectedBill.total_amount || 0)).toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Payment Date *</Label><Input type="date" className="mt-1" value={payForm.payment_date} onChange={e => setPayForm(f => ({...f, payment_date: e.target.value}))} required /></div>
                  <div>
                    {/* This bill is invoiced in the PO's own currency (po_currency) — the
                        amount entered here is what gets recorded against it and converted
                        to the base currency at today's rate when posted to the GL (see
                        POST /supplier-bill-payment), so the field must be labeled and
                        previewed in that currency, not the clinic's base currency. */}
                    <Label className="text-xs">Amount ({selectedBill.po_currency || currency.code}) *</Label>
                    <Input type="number" step="0.01" min="0.01" className="mt-1" value={payForm.amount_paid} onChange={e => setPayForm(f => ({...f, amount_paid: e.target.value}))} required />
                    {(() => {
                      const entered = parseFloat(payForm.amount_paid);
                      if (!entered || entered <= 0) return null;
                      const base = toBaseCurrency(entered, selectedBill.po_currency);
                      return base != null ? (
                        <p className="text-[11px] text-muted-foreground mt-1">Will post as ≈ {fmt(base)} at today's rate</p>
                      ) : null;
                    })()}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Payment Method *</Label>
                    <Combobox
                      options={PAYMENT_METHODS.map(m => ({ value: m, label: m }))}
                      value={payForm.payment_method}
                      onChange={v => setPayForm(f => ({...f, payment_method: v}))}
                      searchPlaceholder="Search..."
                      className="mt-1 h-9"
                    />
                  </div>
                  <div><Label className="text-xs">Reference No.</Label><Input className="mt-1" value={payForm.reference_number} onChange={e => setPayForm(f => ({...f, reference_number: e.target.value}))} placeholder="Cheque/Transfer ref" /></div>
                </div>
                <div><Label className="text-xs">Pay From Account (CoA) *</Label><div className="mt-1"><AccountCombobox value={payForm.account_id} onSelect={(id, name) => setPayForm(f => ({...f, account_id: id, account_name: name}))} open={openPayCombo} onOpenChange={setOpenPayCombo} /></div></div>
                <div><Label className="text-xs">Prepared / Paid By</Label><Input className="mt-1" value={payForm.paid_by} onChange={e => setPayForm(f => ({...f, paid_by: e.target.value}))} placeholder="Name for signature" /></div>
                <div><Label className="text-xs">Notes</Label><Textarea className="mt-1 text-sm" rows={2} value={payForm.notes} onChange={e => setPayForm(f => ({...f, notes: e.target.value}))} placeholder="Payment remarks..." /></div>
                {/* Approvers summary */}
                {(() => {
                  const approvals = billApprovals[selectedBill.id] || [];
                  return approvals.length > 0 ? (
                    <div className="rounded-md border p-3 bg-green-50 space-y-1">
                      <p className="text-xs font-semibold text-green-800 mb-1">✓ Approved By</p>
                      {approvals.map(a => (
                        <div key={a.id} className="flex items-center gap-2 text-xs">
                          <span className="w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center font-bold shrink-0">{a.approval_level}</span>
                          <span className="font-medium">{a.approved_by}</span>
                          {a.approved_by_title && <span className="text-muted-foreground">· {a.approved_by_title}</span>}
                          <span className="text-muted-foreground ml-auto">{new Date(a.approved_at).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
                {(() => {
                  const cur = selectedBill.po_currency || currency.code;
                  const total = parseFloat(String(selectedBill.total_amount || 0));
                  const paid = parseFloat(String(selectedBill.paid_amount || 0));
                  const balance = parseFloat(String(selectedBill.balance_due || 0));
                  const baseTotal = toBaseCurrency(total, selectedBill.po_currency);
                  const basePaid = toBaseCurrency(paid, selectedBill.po_currency);
                  const baseBalance = toBaseCurrency(balance, selectedBill.po_currency);
                  return (
                    <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">PO Total</span>
                        <span className="font-mono">{cur} {total.toFixed(2)}{baseTotal != null && <span className="text-muted-foreground text-xs"> (≈ {fmt(baseTotal)})</span>}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Previously Paid</span>
                        <span className="font-mono text-green-600">{cur} {paid.toFixed(2)}{basePaid != null && <span className="text-muted-foreground text-xs"> (≈ {fmt(basePaid)})</span>}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1 mt-1">
                        <span className="font-medium">Balance Due</span>
                        <span className="font-mono font-bold text-orange-600">{cur} {balance.toFixed(2)}{baseBalance != null && <span className="text-muted-foreground text-xs font-normal"> (≈ {fmt(baseBalance)})</span>}</span>
                      </div>
                    </div>
                  );
                })()}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" type="submit" className="h-8 px-4 text-xs" disabled={submittingPay}>{submittingPay ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Processing...</> : <><Printer className="w-3 h-3 mr-2" />Record & Print Voucher</>}</Button>
                  <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs gap-1.5" disabled={submittingPay} onClick={() => { if (selectedBill) downloadBillVoucher(selectedBill); }}>
                    <Download className="w-3 h-3" />Download
                  </Button>
                  <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs" onClick={() => { setShowPayModal(false); setSelectedBill(null); }}>Cancel</Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* ── PAY CONSULTANT BILL MODAL ── */}
        <Dialog open={showConsultantPayModal} onOpenChange={setShowConsultantPayModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Pay Consultant Bill</DialogTitle>
              <DialogDescription>
                {selectedConsultantBill && `${selectedConsultantBill.bill_number} — ${selectedConsultantBill.first_name} ${selectedConsultantBill.last_name} · ${selectedConsultantBill.currency} ${parseFloat(String(selectedConsultantBill.bill_amount || 0)).toFixed(2)}`}
              </DialogDescription>
            </DialogHeader>
            {selectedConsultantBill && (
              <form onSubmit={handleConsultantPaySubmit} className="space-y-3 px-6 pb-6 pt-2">
                <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Period</span><span>{new Date(selectedConsultantBill.period_from).toLocaleDateString()} – {new Date(selectedConsultantBill.period_to).toLocaleDateString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Revenue Collected</span><span className="font-mono">{selectedConsultantBill.currency} {parseFloat(String(selectedConsultantBill.total_consultation_revenue || 0)).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee %</span><span>{selectedConsultantBill.fee_percentage}%</span></div>
                  <div className="flex justify-between font-semibold"><span>Bill Amount</span><span className="font-mono">{selectedConsultantBill.currency} {parseFloat(String(selectedConsultantBill.bill_amount || 0)).toFixed(2)}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Payment Date *</Label><Input type="date" className="mt-1" value={consultantPayForm.payment_date} onChange={e => setConsultantPayForm(f => ({...f, payment_date: e.target.value}))} required /></div>
                  <div>
                    <Label className="text-xs">Payment Method *</Label>
                    <Combobox
                      options={PAYMENT_METHODS.map(m => ({ value: m, label: m }))}
                      value={consultantPayForm.payment_method}
                      onChange={v => setConsultantPayForm(f => ({...f, payment_method: v}))}
                      searchPlaceholder="Search..." className="mt-1 h-9"
                    />
                  </div>
                </div>
                <div><Label className="text-xs">Pay From Account (CoA) *</Label><div className="mt-1"><AccountCombobox value={consultantPayForm.account_id} onSelect={(id, name) => setConsultantPayForm(f => ({...f, account_id: id, account_name: name}))} open={openConsultantPayCombo} onOpenChange={setOpenConsultantPayCombo} /></div></div>
                <div><Label className="text-xs">Reference No.</Label><Input className="mt-1" value={consultantPayForm.reference_number} onChange={e => setConsultantPayForm(f => ({...f, reference_number: e.target.value}))} placeholder="Cheque/Transfer ref" /></div>
                <div><Label className="text-xs">Notes</Label><Textarea className="mt-1 text-sm" rows={2} value={consultantPayForm.notes} onChange={e => setConsultantPayForm(f => ({...f, notes: e.target.value}))} /></div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs" onClick={() => { setShowConsultantPayModal(false); setSelectedConsultantBill(null); }}>Cancel</Button>
                  <Button size="sm" type="submit" className="h-8 px-4 text-xs" disabled={submittingConsultantPay}>
                    {submittingConsultantPay ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                    Record Payment
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>

      </div>
      </div>
    </AppLayout>
  );
};

export default DailyExpenses;
