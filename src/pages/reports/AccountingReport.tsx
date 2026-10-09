import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from 'sonner';
import { ReportSubPageShell } from './ReportSubPageShell';
import { LoadingState } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Calendar, RefreshCw, Download, Printer, Eye } from 'lucide-react';
import { fmtCurrency, fmtCount, fmtDate, CsvColumn, getDatePresets, exportCSV, triggerPrint } from '@/utils/reportUtils';

// One Accounting Reports page, one dropdown — same shape as Revenue/
// Clinical/Inventory/Procurement Reports. Trial Balance, Income Statement,
// and Balance Sheet are NOT re-implemented here — they call the existing,
// already-correct endpoints (/api/accounting/reports/trial-balance,
// /api/accounting/reports/balance-sheet, /api/reports-v2/income-statement)
// directly. Everything else (Cash Flow, Statement of Changes in Equity,
// General Ledger, Account/Sub-Account History, Journal Vouchers, Expenses)
// is new (src/server/routes/reportAccounting.js).
//
// Two things are flagged in their own descriptions rather than silently
// assumed: "Income Statement (Detailed) By Department" has no real
// department/cost-center data anywhere in the GL (those columns exist on
// some models but are never populated) — mapped to Branch instead, the
// only populated grouping dimension. "Cash Flow Statement" is a real,
// correct DIRECT-method cash movement report over the actual cash/bank
// accounts, grouped by source module — NOT a GAAP 3-section (operating/
// investing/financing) statement, since no such categorization exists
// anywhere in this chart of accounts.

type Mode =
  | 'trial-balance' | 'income-statement' | 'income-statement-by-branch' | 'balance-sheet'
  | 'cash-flow' | 'general-ledger' | 'account-history' | 'sub-account-history'
  | 'journal-vouchers' | 'expenses' | 'equity-statement';

interface ReportOption {
  value: string;
  label: string;
  group: string;
  mode: Mode;
  allBranches?: boolean;
  detailed?: boolean;
  isComprehensive?: boolean;
  expensesGroupBy?: 'none' | 'category' | 'period';
}

const REPORT_OPTIONS: ReportOption[] = [
  { value: 'trial_balance_detailed', label: 'Trial Balance (Detailed)', group: 'Trial Balance', mode: 'trial-balance', detailed: true },
  { value: 'trial_balance_summary', label: 'Trial Balance (Summary)', group: 'Trial Balance', mode: 'trial-balance', detailed: false },

  { value: 'income_statement_detailed', label: 'Income Statement (Detailed)', group: 'Income Statement', mode: 'income-statement', detailed: true },
  { value: 'income_statement_summary', label: 'Income Statement (Summary)', group: 'Income Statement', mode: 'income-statement', detailed: false },
  { value: 'income_statement_by_department', label: 'Income Statement (Detailed) By Department', group: 'Income Statement', mode: 'income-statement-by-branch' },
  { value: 'comprehensive_income_statement', label: 'Comprehensive Income Statement', group: 'Income Statement', mode: 'income-statement', detailed: true, isComprehensive: true },

  { value: 'balance_sheet_detailed', label: 'Balance Sheet (Detailed)', group: 'Balance Sheet', mode: 'balance-sheet', detailed: true },
  { value: 'balance_sheet_summary', label: 'Balance Sheet (Summary)', group: 'Balance Sheet', mode: 'balance-sheet', detailed: false },
  { value: 'comprehensive_balance_sheet', label: 'Comprehensive Balance Sheet (Detailed)', group: 'Balance Sheet', mode: 'balance-sheet', detailed: true },

  { value: 'cash_flow_statement', label: 'Cash Flow Statement', group: 'Cash Flow & Equity', mode: 'cash-flow' },
  { value: 'comprehensive_cash_flow', label: 'Comprehensive Cash Flow Statement', group: 'Cash Flow & Equity', mode: 'cash-flow', isComprehensive: true },
  { value: 'statement_of_changes_in_equity', label: 'Statement of Changes in Equity', group: 'Cash Flow & Equity', mode: 'equity-statement' },

  { value: 'general_ledger_detailed', label: 'General Ledger (Detailed)', group: 'General Ledger', mode: 'general-ledger', allBranches: true },
  { value: 'ledger_sub_account_history', label: 'Ledger Sub Account History', group: 'General Ledger', mode: 'sub-account-history' },
  { value: 'ledger_account_history', label: 'Ledger Account History', group: 'General Ledger', mode: 'account-history' },
  { value: 'journal_vouchers_by_branch', label: 'Journal Vouchers By Branch', group: 'General Ledger', mode: 'journal-vouchers', allBranches: false },

  { value: 'all_expenses_detailed', label: 'All Expenses Detailed', group: 'Expenses', mode: 'expenses', expensesGroupBy: 'none', allBranches: true },
  { value: 'all_expenses_summary', label: 'All Expenses Summary', group: 'Expenses', mode: 'expenses', expensesGroupBy: 'category', allBranches: true },
  { value: 'all_expenses_fiscal_period', label: 'All Expenses Grouped by Fiscal Period', group: 'Expenses', mode: 'expenses', expensesGroupBy: 'period', allBranches: true },
];

const OPTION_GROUPS = ['Trial Balance', 'Income Statement', 'Balance Sheet', 'Cash Flow & Equity', 'General Ledger', 'Expenses'];

function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m + 1)}-01`, to: now.toISOString().split('T')[0] };
}

export default function AccountingReport() {
  const { user } = useAuth();
  const facility = useFacilityInfo();
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [reportType, setReportType] = useState('trial_balance_detailed');
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; account_code: string; account_name: string; sub_account_type: string | null }[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedSubAccountType, setSelectedSubAccountType] = useState('');

  useEffect(() => {
    const clinicId = user?.clinic || '1';
    authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => setAccounts([]));
  }, [user?.clinic]);

  const subAccountTypes = useMemo(
    () => [...new Set(accounts.map(a => a.sub_account_type).filter(Boolean))].sort(),
    [accounts]
  );

  const option = REPORT_OPTIONS.find(o => o.value === reportType)!;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setSummary(null);
    try {
      const clinicId = user?.clinic || '1';

      if (option.mode === 'trial-balance') {
        const res = await authFetch(`/api/accounting/reports/trial-balance?clinic_id=${clinicId}&as_of_date=${dateTo}`);
        if (!res.ok) throw new Error('Failed to load trial balance');
        const json = await res.json();
        if (option.detailed) {
          setRows(json.accounts || []);
        } else {
          const byType = new Map<string, { account_type: string; debit_balance: number; credit_balance: number }>();
          for (const a of json.accounts || []) {
            const row = byType.get(a.account_type) || { account_type: a.account_type, debit_balance: 0, credit_balance: 0 };
            row.debit_balance += a.debit_balance;
            row.credit_balance += a.credit_balance;
            byType.set(a.account_type, row);
          }
          setRows([...byType.values()]);
        }
        setSummary({ total_debits: json.total_debits, total_credits: json.total_credits, is_balanced: json.is_balanced });
      } else if (option.mode === 'income-statement') {
        const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: clinicId });
        const res = await authFetch(`/api/reports-v2/income-statement?${params}`);
        if (!res.ok) throw new Error('Failed to load income statement');
        const json = await res.json();
        if (option.isComprehensive) {
          const sections = json.expenseSections || {};
          const expenseRows = [
            ...(sections.costOfGoodsSold?.lines || []).map((l: any) => ({ ...l, section: 'Cost of Goods Sold' })),
            ...(sections.operatingExpenses?.lines || []).map((l: any) => ({ ...l, section: 'Operating Expenses' })),
            ...(sections.miscellaneous?.lines || []).map((l: any) => ({ ...l, section: 'Miscellaneous' })),
          ];
          setRows([
            ...(json.revenue || []).map((r: any) => ({ ...r, section: 'Revenue' })),
            ...expenseRows,
          ]);
        } else if (option.detailed) {
          setRows([
            ...(json.revenue || []).map((r: any) => ({ ...r, section: 'Revenue' })),
            ...(json.expenses || []).map((r: any) => ({ ...r, section: 'Expenses' })),
          ]);
        } else {
          setRows([
            { section: 'Total Revenue', amount: json.totals?.totalRevenue || 0 },
            { section: 'Total Expenses', amount: json.totals?.totalExpenses || 0 },
            { section: 'Net Income', amount: json.totals?.netIncome || 0 },
          ]);
        }
        setSummary(json.totals);
      } else if (option.mode === 'income-statement-by-branch') {
        const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: clinicId });
        const res = await authFetch(`/api/reports-v2/accounting/income-statement-by-branch?${params}`);
        if (!res.ok) throw new Error('Failed to load income statement by department');
        const json = await res.json();
        setRows(json.rows || []);
      } else if (option.mode === 'balance-sheet') {
        const res = await authFetch(`/api/accounting/reports/balance-sheet?clinic_id=${clinicId}&as_of_date=${dateTo}`);
        if (!res.ok) throw new Error('Failed to load balance sheet');
        const json = await res.json();
        const flat = [
          ...(json.assets?.items || []).map((i: any) => ({ ...i, section: 'Assets' })),
          ...(json.liabilities?.items || []).map((i: any) => ({ ...i, section: 'Liabilities' })),
          ...(json.equity?.items || []).map((i: any) => ({ ...i, section: 'Equity' })),
        ];
        if (option.detailed) {
          setRows(flat);
        } else {
          const bySection = new Map<string, number>();
          for (const r of flat) bySection.set(r.section, (bySection.get(r.section) || 0) + r.balance);
          setRows([...bySection.entries()].map(([section, balance]) => ({ section, balance })));
        }
        setSummary({ is_balanced: json.is_balanced, total_liabilities_and_equity: json.total_liabilities_and_equity });
      } else if (option.mode === 'cash-flow') {
        const params = new URLSearchParams({ dateFrom, dateTo, allBranches: 'true', clinic_id: clinicId, detail: String(!!option.isComprehensive) });
        const res = await authFetch(`/api/reports-v2/accounting/cash-flow?${params}`);
        if (!res.ok) throw new Error('Failed to load cash flow statement');
        const json = await res.json();
        setRows(json.rows || []);
        setSummary({ openingBalance: json.openingBalance, closingBalance: json.closingBalance });
      } else if (option.mode === 'general-ledger') {
        const params = new URLSearchParams({ dateFrom, dateTo, allBranches: String(option.allBranches), clinic_id: clinicId });
        const res = await authFetch(`/api/reports-v2/accounting/general-ledger?${params}`);
        if (!res.ok) throw new Error('Failed to load general ledger');
        const json = await res.json();
        setRows(json.rows || []);
      } else if (option.mode === 'account-history') {
        if (!selectedAccountId) { toast.error('Pick an account first'); setRows([]); setHasLoaded(true); setLoading(false); return; }
        const params = new URLSearchParams({ dateFrom, dateTo, accountId: selectedAccountId, clinic_id: clinicId });
        const res = await authFetch(`/api/reports-v2/accounting/account-history?${params}`);
        if (!res.ok) throw new Error('Failed to load account history');
        const json = await res.json();
        setRows(json.rows || []);
        setSummary({ openingBalance: json.openingBalance, closingBalance: json.closingBalance, account: json.account });
      } else if (option.mode === 'sub-account-history') {
        if (!selectedSubAccountType) { toast.error('Pick a sub-account type first'); setRows([]); setHasLoaded(true); setLoading(false); return; }
        const params = new URLSearchParams({ dateFrom, dateTo, subAccountType: selectedSubAccountType, clinic_id: clinicId });
        const res = await authFetch(`/api/reports-v2/accounting/sub-account-history?${params}`);
        if (!res.ok) throw new Error('Failed to load sub-account history');
        const json = await res.json();
        setRows(json.rows || []);
      } else if (option.mode === 'journal-vouchers') {
        const params = new URLSearchParams({ dateFrom, dateTo, allBranches: String(option.allBranches), clinic_id: clinicId });
        const res = await authFetch(`/api/reports-v2/accounting/journal-vouchers?${params}`);
        if (!res.ok) throw new Error('Failed to load journal vouchers');
        const json = await res.json();
        setRows(json.rows || []);
      } else if (option.mode === 'expenses') {
        const params = new URLSearchParams({ dateFrom, dateTo, allBranches: String(option.allBranches), clinic_id: clinicId, groupBy: option.expensesGroupBy || 'none' });
        const res = await authFetch(`/api/reports-v2/accounting/expenses?${params}`);
        if (!res.ok) throw new Error('Failed to load expenses report');
        const json = await res.json();
        setRows(json.rows || []);
      } else if (option.mode === 'equity-statement') {
        const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: clinicId });
        const res = await authFetch(`/api/reports-v2/accounting/equity-statement?${params}`);
        if (!res.ok) throw new Error('Failed to load statement of changes in equity');
        const json = await res.json();
        setRows(json.rows || []);
        setSummary({ netIncome: json.netIncome });
      }
      setGeneratedAt(new Date());
      setHasLoaded(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load accounting report');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, reportType, user?.clinic, selectedAccountId, selectedSubAccountType]);

  // ── Columns per mode ─────────────────────────────────────────────────────
  let columns: Column<any>[] = [];
  let csvColumns: CsvColumn[] = [];
  let keyExtractor: (row: any, i: number) => string | number = (r, i) => r.id ?? i;
  let emptyMessage = 'No records found.';

  if (option.mode === 'trial-balance') {
    keyExtractor = (r, i) => r.account_code ?? r.account_type ?? i;
    columns = option.detailed
      ? [
          { key: 'account_code', header: 'Code', sortable: true, render: v => <span className="font-mono text-xs">{v}</span> },
          { key: 'account_name', header: 'Account', sortable: true },
          { key: 'account_type', header: 'Type', sortable: true, render: v => <span className="capitalize">{v}</span> },
          { key: 'debit_balance', header: 'Debit', align: 'right', sortable: true, render: v => <span className="font-mono">{v ? fmtCurrency(v) : '—'}</span> },
          { key: 'credit_balance', header: 'Credit', align: 'right', sortable: true, render: v => <span className="font-mono">{v ? fmtCurrency(v) : '—'}</span> },
        ]
      : [
          { key: 'account_type', header: 'Account Type', sortable: true, render: v => <span className="capitalize">{v}</span> },
          { key: 'debit_balance', header: 'Total Debit', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
          { key: 'credit_balance', header: 'Total Credit', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
        ];
    csvColumns = columns.map(c => ({ header: String(c.header), key: String(c.key) }));
  } else if (option.mode === 'income-statement') {
    keyExtractor = (r, i) => r.account_id ?? r.section ?? i;
    columns = (option.detailed || option.isComprehensive)
      ? [
          { key: 'section', header: 'Section', sortable: true },
          { key: 'account_code', header: 'Code', render: v => v ? <span className="font-mono text-xs">{v}</span> : '—' },
          { key: 'account_name', header: 'Account', sortable: true, render: v => v || '—' },
          { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
        ]
      : [
          { key: 'section', header: 'Line', sortable: true },
          { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
        ];
    csvColumns = columns.map(c => ({ header: String(c.header), key: String(c.key) }));
  } else if (option.mode === 'income-statement-by-branch') {
    keyExtractor = r => r.branchName;
    columns = [
      { key: 'branchName', header: 'Department (Branch)', sortable: true },
      { key: 'totalRevenue', header: 'Revenue', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'totalExpenses', header: 'Expenses', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'netIncome', header: 'Net Income', align: 'right', sortable: true, render: v => <span className={`font-mono font-medium ${v >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: 'Department (Branch)', key: 'branchName' }, { header: 'Revenue', key: 'totalRevenue' }, { header: 'Expenses', key: 'totalExpenses' }, { header: 'Net Income', key: 'netIncome' }];
  } else if (option.mode === 'balance-sheet') {
    keyExtractor = (r, i) => r.account_code ?? r.section ?? i;
    columns = option.detailed
      ? [
          { key: 'section', header: 'Section', sortable: true },
          { key: 'account_code', header: 'Code', render: v => <span className="font-mono text-xs">{v}</span> },
          { key: 'account_name', header: 'Account', sortable: true },
          { key: 'balance', header: 'Balance', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
        ]
      : [
          { key: 'section', header: 'Section', sortable: true },
          { key: 'balance', header: 'Total', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
        ];
    csvColumns = columns.map(c => ({ header: String(c.header), key: String(c.key) }));
  } else if (option.mode === 'cash-flow') {
    if (option.isComprehensive) {
      columns = [
        { key: 'transactionDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
        { key: 'accountName', header: 'Account', sortable: true },
        { key: 'description', header: 'Description' },
        { key: 'sourceModule', header: 'Source', sortable: true },
        { key: 'cashIn', header: 'Cash In', align: 'right', sortable: true, render: v => <span className="font-mono text-emerald-700">{v ? fmtCurrency(v) : '—'}</span> },
        { key: 'cashOut', header: 'Cash Out', align: 'right', sortable: true, render: v => <span className="font-mono text-red-600">{v ? fmtCurrency(v) : '—'}</span> },
        { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
      ];
    } else {
      keyExtractor = r => r.sourceModule;
      columns = [
        { key: 'sourceModule', header: 'Source', sortable: true },
        { key: 'transactionCount', header: 'Transactions', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
        { key: 'cashIn', header: 'Cash In', align: 'right', sortable: true, render: v => <span className="font-mono text-emerald-700">{fmtCurrency(v)}</span> },
        { key: 'cashOut', header: 'Cash Out', align: 'right', sortable: true, render: v => <span className="font-mono text-red-600">{fmtCurrency(v)}</span> },
        { key: 'netChange', header: 'Net Change', align: 'right', sortable: true, render: v => <span className={`font-mono font-medium ${v >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtCurrency(v)}</span> },
      ];
    }
    csvColumns = columns.map(c => ({ header: String(c.header), key: String(c.key) }));
  } else if (option.mode === 'general-ledger') {
    columns = [
      { key: 'transactionDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'accountCode', header: 'Code', render: v => <span className="font-mono text-xs">{v}</span> },
      { key: 'accountName', header: 'Account', sortable: true },
      { key: 'description', header: 'Description' },
      { key: 'referenceNumber', header: 'Reference', render: v => <span className="font-mono text-xs">{v || '—'}</span> },
      { key: 'debitAmount', header: 'Debit', align: 'right', sortable: true, render: v => <span className="font-mono">{v ? fmtCurrency(v) : '—'}</span> },
      { key: 'creditAmount', header: 'Credit', align: 'right', sortable: true, render: v => <span className="font-mono">{v ? fmtCurrency(v) : '—'}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = columns.map(c => ({ header: String(c.header), key: String(c.key) }));
  } else if (option.mode === 'account-history' || option.mode === 'sub-account-history') {
    columns = [
      { key: 'transactionDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      ...(option.mode === 'sub-account-history' ? [{ key: 'accountCode', header: 'Code', render: (v: any) => <span className="font-mono text-xs">{v}</span> }, { key: 'accountName', header: 'Account', sortable: true }] : []),
      { key: 'description', header: 'Description' },
      { key: 'referenceNumber', header: 'Reference', render: v => <span className="font-mono text-xs">{v || '—'}</span> },
      { key: 'debitAmount', header: 'Debit', align: 'right', sortable: true, render: v => <span className="font-mono">{v ? fmtCurrency(v) : '—'}</span> },
      { key: 'creditAmount', header: 'Credit', align: 'right', sortable: true, render: v => <span className="font-mono">{v ? fmtCurrency(v) : '—'}</span> },
      ...(option.mode === 'account-history' ? [{ key: 'runningBalance', header: 'Running Balance', align: 'right' as const, sortable: true, render: (v: any) => <span className="font-mono font-medium">{fmtCurrency(v)}</span> }] : []),
    ];
    csvColumns = columns.map(c => ({ header: String(c.header), key: String(c.key) }));
  } else if (option.mode === 'journal-vouchers') {
    keyExtractor = r => r.referenceNumber;
    columns = [
      { key: 'transactionDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'referenceNumber', header: 'Voucher / Reference', sortable: true, render: v => <span className="font-mono text-xs text-primary">{v}</span> },
      { key: 'description', header: 'Description' },
      { key: 'sourceModule', header: 'Source', sortable: true },
      { key: 'lineCount', header: 'Lines', align: 'right', render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
      { key: 'totalDebit', header: 'Total Debit', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
      { key: 'totalCredit', header: 'Total Credit', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCurrency(v)}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = columns.map(c => ({ header: String(c.header), key: String(c.key) }));
  } else if (option.mode === 'expenses') {
    if (option.expensesGroupBy === 'none') {
      columns = [
        { key: 'expenseDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
        { key: 'description', header: 'Description' },
        { key: 'accountName', header: 'Account', sortable: true, render: v => v || '—' },
        { key: 'category', header: 'Category', sortable: true, render: v => v || '—' },
        { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
        { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize">{v}</span> },
        { key: 'voucherNumber', header: 'Voucher #', render: v => <span className="font-mono text-xs">{v || '—'}</span> },
        { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
      ];
    } else {
      keyExtractor = r => r.groupLabel;
      columns = [
        { key: 'groupLabel', header: option.expensesGroupBy === 'period' ? 'Month' : 'Category', sortable: true },
        { key: 'expenseCount', header: 'Count', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
        { key: 'totalAmount', header: 'Total Amount', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
      ];
    }
    csvColumns = columns.map(c => ({ header: String(c.header), key: String(c.key) }));
  } else if (option.mode === 'equity-statement') {
    keyExtractor = r => r.accountCode;
    columns = [
      { key: 'accountCode', header: 'Code', render: v => <span className="font-mono text-xs">{v}</span> },
      { key: 'accountName', header: 'Equity Account', sortable: true },
      { key: 'openingBalance', header: 'Opening Balance', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'periodActivity', header: 'Period Activity', align: 'right', sortable: true, render: v => <span className={`font-mono ${v >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtCurrency(v)}</span> },
      { key: 'closingBalance', header: 'Closing Balance', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCurrency(v)}</span> },
    ];
    csvColumns = columns.map(c => ({ header: String(c.header), key: String(c.key) }));
  }

  const numberedRows = useMemo(() => rows.map((r, i) => ({ ...r, no: i + 1 })), [rows]);
  const columnsWithNo: Column<any>[] = [
    { key: 'no', header: 'No', width: '56px', render: v => <span className="text-muted-foreground tabular-nums">{v}</span> },
    ...columns,
  ];

  const presets = getDatePresets();
  const handlePreset = (label: string) => {
    const p = presets.find(x => x.label === label);
    if (!p) return;
    setDateFrom(p.from);
    setDateTo(p.to);
  };
  const handleExportCSV = () => exportCSV(numberedRows, csvColumns, `accounting-${option.value}-${dateFrom}-${dateTo}.csv`);

  return (
    <ReportSubPageShell
      title="Accounting Reports"
      description="Pick a report type and date range, then click View."
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      hideControls
    >
      <div className="sticky top-0 z-10 -mx-6 -mt-6 px-6 pt-6 pb-4 bg-primary/20 print:static print:mx-0 print:px-0 print:pt-0 print:pb-0 print:bg-transparent">
        <div className="flex flex-wrap items-end gap-3 mb-4 print:hidden">
          <select
            value={reportType}
            onChange={e => setReportType(e.target.value)}
            className="h-9 min-w-[320px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {OPTION_GROUPS.map(group => (
              <optgroup key={group} label={group}>
                {REPORT_OPTIONS.filter(o => o.group === group).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {option.mode === 'account-history' && (
            <select
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="h-9 min-w-[220px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Pick an account...</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}
            </select>
          )}

          {option.mode === 'sub-account-history' && (
            <select
              value={selectedSubAccountType}
              onChange={e => setSelectedSubAccountType(e.target.value)}
              className="h-9 min-w-[200px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Pick a sub-account type...</option>
              {subAccountTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}

          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center gap-1">
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px] h-9 text-sm" />
              <span className="text-muted-foreground text-sm">—</span>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[140px] h-9 text-sm" />
            </div>
          </div>
          <Combobox
            options={presets.map(p => ({ value: p.label, label: p.label }))}
            value=""
            onChange={handlePreset}
            placeholder="Quick range"
            searchPlaceholder="Search..."
            className="w-[130px] h-9 text-sm"
          />

          <Button size="sm" onClick={fetchData} disabled={loading} className="h-9 gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            View
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={fetchData} disabled={loading} className="h-9 gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!hasLoaded} className="h-9 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={triggerPrint} disabled={!hasLoaded} className="h-9 gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              Print
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border overflow-hidden bg-card">
          <div className="bg-sky-100 dark:bg-sky-950/40 text-center py-2 border-b border-border">
            <h2 className="text-sm font-bold tracking-wide text-foreground">{option.label}</h2>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {facility.facilityLogo ? (
                <img src={facility.facilityLogo} alt={facility.facilityName} className="h-16 w-16 object-contain rounded border border-border flex-shrink-0" />
              ) : (
                <div className="h-16 w-16 rounded border border-border flex-shrink-0" />
              )}
              <div>
                <p className="font-semibold text-sm">{facility.facilityName || '—'}</p>
                {facility.facilityWebsite && <p className="text-xs text-muted-foreground">{facility.facilityWebsite}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs text-muted-foreground">
              <span><span className="font-semibold text-foreground">From:</span> {fmtDate(dateFrom)}</span>
              <span><span className="font-semibold text-foreground">To:</span> {fmtDate(dateTo)}</span>
              <span><span className="font-semibold text-foreground">Report DateTime:</span> {generatedAt ? generatedAt.toLocaleString() : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {summary && hasLoaded && option.mode === 'income-statement' && (
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Total Revenue</p>
            <p className="text-2xl font-bold mt-1 text-primary">{fmtCurrency(summary.totalRevenue)}</p>
          </div>
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Total Expenses</p>
            <p className="text-2xl font-bold mt-1 text-amber-700">{fmtCurrency(summary.totalExpenses)}</p>
          </div>
          <div className={`rounded-lg border shadow-sm p-4 ${summary.netIncome >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <p className={`text-[11px] uppercase tracking-wide font-medium ${summary.netIncome >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              Net Income — {summary.netIncome >= 0 ? 'Profit' : 'Loss'}
            </p>
            <p className={`text-2xl font-bold mt-1 ${summary.netIncome >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtCurrency(summary.netIncome)}</p>
          </div>
        </div>
      )}

      {summary && hasLoaded && (option.mode === 'trial-balance' || option.mode === 'balance-sheet') && (
        <div className="mb-4 px-4 py-2.5 rounded-md border border-border bg-card text-sm flex items-center gap-4">
          <span className={`font-semibold ${summary.is_balanced ? 'text-emerald-700' : 'text-red-700'}`}>
            {summary.is_balanced ? 'Balanced' : 'Not Balanced'}
          </span>
          {summary.total_debits != null && <span className="text-muted-foreground">Debits: <span className="font-mono text-foreground">{fmtCurrency(summary.total_debits)}</span></span>}
          {summary.total_credits != null && <span className="text-muted-foreground">Credits: <span className="font-mono text-foreground">{fmtCurrency(summary.total_credits)}</span></span>}
        </div>
      )}
      {summary && hasLoaded && option.mode === 'cash-flow' && (
        <div className="mb-4 px-4 py-2.5 rounded-md border border-border bg-card text-sm flex items-center gap-6">
          <span className="text-muted-foreground">Opening Balance: <span className="font-mono text-foreground font-medium">{fmtCurrency(summary.openingBalance)}</span></span>
          <span className="text-muted-foreground">Closing Balance: <span className="font-mono text-foreground font-medium">{fmtCurrency(summary.closingBalance)}</span></span>
        </div>
      )}
      {summary && hasLoaded && option.mode === 'account-history' && (
        <div className="mb-4 px-4 py-2.5 rounded-md border border-border bg-card text-sm flex items-center gap-6">
          <span className="text-muted-foreground">Opening Balance: <span className="font-mono text-foreground font-medium">{fmtCurrency(summary.openingBalance)}</span></span>
          <span className="text-muted-foreground">Closing Balance: <span className="font-mono text-foreground font-medium">{fmtCurrency(summary.closingBalance)}</span></span>
        </div>
      )}
      {summary && hasLoaded && option.mode === 'equity-statement' && (
        <div className="mb-4 px-4 py-2.5 rounded-md border border-border bg-card text-sm">
          <span className="text-muted-foreground">Net Income for Period: <span className={`font-mono font-medium ${summary.netIncome >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtCurrency(summary.netIncome)}</span></span>
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading report..." />
      ) : !hasLoaded ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed border-border rounded-md">
          Pick a report type and date range above, then click View.
        </div>
      ) : (
        <AdvancedDataTable
          data={numberedRows}
          keyExtractor={keyExtractor}
          columns={columnsWithNo}
          emptyMessage={emptyMessage}
          pagination={{ enabled: true, pageSize: 25, pageSizeOptions: [25, 50, 100] }}
          maxRows={15}
          searchable
          searchPlaceholder="Search this report..."
        />
      )}
    </ReportSubPageShell>
  );
}
