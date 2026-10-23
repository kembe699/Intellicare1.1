import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { ReportSubPageShell } from './ReportSubPageShell';
import { ReportLetterhead } from './ReportLetterhead';
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
  | 'trial-balance' | 'income-statement' | 'income-statement-by-branch' | 'income-statement-by-department' | 'balance-sheet'
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
  { value: 'income_statement_by_department', label: 'Income Statement (Detailed) By Department', group: 'Income Statement', mode: 'income-statement-by-department' },
  { value: 'income_statement_by_branch', label: 'Income Statement By Branch', group: 'Income Statement', mode: 'income-statement-by-branch' },
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
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [reportType, setReportType] = useState('trial_balance_detailed');
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  // Structured income-statement breakdown (Revenue / Cost of Goods Sold /
  // Operating Expenses / Miscellaneous, each with its own line items and
  // subtotal) — rendered as a real formatted financial statement instead of
  // a flat sortable table for the Detailed/Comprehensive variants.
  const [incomeStatement, setIncomeStatement] = useState<{
    revenue: { account_id: string; account_name: string; amount: number }[];
    expenseGroups: { label: string; lines: { account_id: string; account_name: string; amount: number }[]; total: number }[];
    totals: { totalRevenue: number; totalExpenses: number; netIncome: number };
  } | null>(null);
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
    setIncomeStatement(null);
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
        if (option.isComprehensive || option.detailed) {
          // Both variants now render as a real formatted statement (grouped
          // by Revenue / Cost of Goods Sold / Operating Expenses /
          // Miscellaneous, each with its own subtotal) instead of a flat
          // list — the backend already computes this exact breakdown
          // (expenseSections), previously only used for "Comprehensive".
          const sections = json.expenseSections || {};
          const expenseGroups = [
            { label: 'Cost Of Goods Sold', lines: sections.costOfGoodsSold?.lines || [], total: sections.costOfGoodsSold?.total || 0 },
            { label: 'Operating Expenses', lines: sections.operatingExpenses?.lines || [], total: sections.operatingExpenses?.total || 0 },
            { label: 'Miscellaneous', lines: sections.miscellaneous?.lines || [], total: sections.miscellaneous?.total || 0 },
          ].filter(g => g.lines.length > 0);

          setIncomeStatement({
            revenue: json.revenue || [],
            expenseGroups,
            totals: json.totals || { totalRevenue: 0, totalExpenses: 0, netIncome: 0 },
          });

          // Flattened version kept for CSV export only — the formatted
          // statement above is what's actually shown on screen/print.
          const expenseRows = expenseGroups.flatMap(g => g.lines.map((l: any) => ({ ...l, section: g.label })));
          setRows([
            ...(json.revenue || []).map((r: any) => ({ ...r, section: 'Revenue' })),
            ...expenseRows,
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
        if (!res.ok) throw new Error('Failed to load income statement by branch');
        const json = await res.json();
        setRows(json.rows || []);
      } else if (option.mode === 'income-statement-by-department') {
        const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: clinicId });
        const res = await authFetch(`/api/reports-v2/accounting/income-statement-by-department?${params}`);
        if (!res.ok) throw new Error('Failed to load income statement by department');
        const json = await res.json();
        setRows(json.departments || []);
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
      { key: 'branchName', header: 'Branch', sortable: true },
      { key: 'totalRevenue', header: 'Revenue', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'totalExpenses', header: 'Expenses', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'netIncome', header: 'Net Income', align: 'right', sortable: true, render: v => <span className={`font-mono font-medium ${v >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: 'Branch', key: 'branchName' }, { header: 'Revenue', key: 'totalRevenue' }, { header: 'Expenses', key: 'totalExpenses' }, { header: 'Net Income', key: 'netIncome' }];
  } else if (option.mode === 'income-statement-by-department') {
    keyExtractor = r => r.department;
    columns = [
      { key: 'department', header: 'Department', sortable: true },
      { key: 'totalRevenue', header: 'Revenue', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'totalExpenses', header: 'Expenses', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCurrency(v)}</span> },
      { key: 'netIncome', header: 'Net Income', align: 'right', sortable: true, render: v => <span className={`font-mono font-medium ${v >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtCurrency(v)}</span> },
    ];
    csvColumns = [{ header: 'Department', key: 'department' }, { header: 'Revenue', key: 'totalRevenue' }, { header: 'Expenses', key: 'totalExpenses' }, { header: 'Net Income', key: 'netIncome' }];
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
        { key: 'cashIn', header: 'Cash In', align: 'right', sortable: true, render: v => <span className="font-mono text-success">{v ? fmtCurrency(v) : '—'}</span> },
        { key: 'cashOut', header: 'Cash Out', align: 'right', sortable: true, render: v => <span className="font-mono text-destructive">{v ? fmtCurrency(v) : '—'}</span> },
        { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
      ];
    } else {
      keyExtractor = r => r.sourceModule;
      columns = [
        { key: 'sourceModule', header: 'Source', sortable: true },
        { key: 'transactionCount', header: 'Transactions', align: 'right', sortable: true, render: v => <span className="font-mono text-muted-foreground">{fmtCount(v)}</span> },
        { key: 'cashIn', header: 'Cash In', align: 'right', sortable: true, render: v => <span className="font-mono text-success">{fmtCurrency(v)}</span> },
        { key: 'cashOut', header: 'Cash Out', align: 'right', sortable: true, render: v => <span className="font-mono text-destructive">{fmtCurrency(v)}</span> },
        { key: 'netChange', header: 'Net Change', align: 'right', sortable: true, render: v => <span className={`font-mono font-medium ${v >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtCurrency(v)}</span> },
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
      { key: 'periodActivity', header: 'Period Activity', align: 'right', sortable: true, render: v => <span className={`font-mono ${v >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtCurrency(v)}</span> },
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
      {/* Deliberately NOT sticky — this block (filters, letterhead, stat tiles)
          used to pin itself to the viewport while scrolling, but the app's own
          fixed top bar sits at the same z-index band and covered its top edge
          once stuck. It scrolls away with the rest of the page instead. */}
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-4 mb-6 bg-background border-b border-border print:static print:mx-0 print:px-0 print:pt-0 print:pb-0 print:mb-0 print:border-0">
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

        <ReportLetterhead title={option.label} dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} className="mb-0" />
      </div>

      {summary && hasLoaded && (option.mode === 'trial-balance' || option.mode === 'balance-sheet') && (
        <div className="mb-4 px-4 py-2.5 rounded-md border border-border bg-card text-sm flex items-center gap-4">
          <span className={`font-semibold ${summary.is_balanced ? 'text-success' : 'text-destructive'}`}>
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
          <span className="text-muted-foreground">Net Income for Period: <span className={`font-mono font-medium ${summary.netIncome >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtCurrency(summary.netIncome)}</span></span>
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading report..." />
      ) : !hasLoaded ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed border-border rounded-md">
          Pick a report type and date range above, then click View.
        </div>
      ) : option.mode === 'income-statement' && (option.detailed || option.isComprehensive) && incomeStatement ? (
        <>
          {/* A small CSV/Print row of its own, right above the statement
              and aligned the same way — the main toolbar's CSV/Print
              buttons are a long scroll away once the page has content. */}
          <div className="max-w-4xl flex justify-end gap-2 mb-3 print:hidden">
            <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!hasLoaded} className="h-8 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={triggerPrint} disabled={!hasLoaded} className="h-8 gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              Print
            </Button>
          </div>
          {/* Capped at a document-like width (roughly A4 proportions) and
              pushed to the right — full report-width made the right-aligned
              totals sit far away from the line items on the left with a
              huge empty gap between them. */}
          <div className="max-w-4xl bg-card border rounded-lg shadow-sm overflow-hidden print:max-w-none">
          {/* ── Revenue ── */}
          <div className="bg-info-bg dark:bg-info/40 px-4 py-1.5 border-b border-border">
            <h3 className="text-sm font-bold tracking-wide">Revenue</h3>
          </div>
          <div className="px-4 py-3">
            {incomeStatement.revenue.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No revenue in this period.</p>
            ) : (
              <>
                <p className="font-semibold text-sm mb-1">Revenue</p>
                {/* table-fixed + a colgroup with an explicit amount-column
                    width — not just max-w-md shrink-wrapping around content
                    — so the amount column lands at the exact same x position
                    in every section's table below (Revenue, Cost Of Goods
                    Sold, Operating Expenses, Miscellaneous each render their
                    own independent <table>, which otherwise auto-size to
                    their own content and don't line up with each other),
                    and so there's real breathing room between a short label
                    and its amount instead of the two hugging close together. */}
                <table className="w-full table-fixed text-sm border-collapse">
                  <colgroup>
                    <col />
                    <col className="w-40" />
                  </colgroup>
                  <tbody>
                    {incomeStatement.revenue.map(l => (
                      <tr key={l.account_id} className="border-b border-border/70">
                        <td className="py-1 pl-4 pr-6 text-muted-foreground truncate">{l.account_name}</td>
                        <td className="py-1 text-right font-mono whitespace-nowrap">{fmtCurrency(l.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-foreground/70">
                      <td className="pt-1.5 pl-0 pr-6 font-semibold whitespace-nowrap">Total Revenue:</td>
                      <td className="pt-1.5 text-right font-mono font-semibold whitespace-nowrap">{fmtCurrency(incomeStatement.totals.totalRevenue)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
            <div className="flex justify-end mt-3">
              <div className="min-w-[260px] flex justify-between gap-4 text-sm font-semibold">
                <span>Total Revenue</span>
                <span className="font-mono border-b-4 border-double border-foreground pb-0.5">{fmtCurrency(incomeStatement.totals.totalRevenue)}</span>
              </div>
            </div>
          </div>

          {/* ── Expenses ── */}
          <div className="bg-info-bg dark:bg-info/40 px-4 py-1.5 border-b border-t border-border">
            <h3 className="text-sm font-bold tracking-wide">Expenses</h3>
          </div>
          <div className="px-4 py-3">
            {incomeStatement.expenseGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No expenses in this period.</p>
            ) : (
              incomeStatement.expenseGroups.map(g => (
                <div key={g.label} className="mb-3 last:mb-0">
                  <p className="font-semibold text-sm mb-1">{g.label}</p>
                  <table className="w-full table-fixed text-sm border-collapse">
                    <colgroup>
                      <col />
                      <col className="w-40" />
                    </colgroup>
                    <tbody>
                      {g.lines.map(l => (
                        <tr key={l.account_id} className="border-b border-border/70">
                          <td className="py-1 pl-4 pr-6 text-muted-foreground truncate">{l.account_name}</td>
                          <td className="py-1 text-right font-mono whitespace-nowrap">{fmtCurrency(l.amount)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-foreground/70">
                        <td className="pt-1.5 pl-0 pr-6 font-semibold whitespace-nowrap">Total {g.label}:</td>
                        <td className="pt-1.5 text-right font-mono font-semibold whitespace-nowrap">{fmtCurrency(g.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))
            )}
            <div className="flex justify-end mt-3">
              <div className="min-w-[260px] flex justify-between gap-4 text-sm font-semibold">
                <span>Total Expenses:</span>
                <span className="font-mono border-b-4 border-double border-foreground pb-0.5">{fmtCurrency(incomeStatement.totals.totalExpenses)}</span>
              </div>
            </div>
          </div>

          {/* ── Net Income ── */}
          <div className={`px-4 py-3 border-t-2 ${incomeStatement.totals.netIncome >= 0 ? 'bg-success-bg border-success-border' : 'bg-destructive-bg border-destructive-border'}`}>
            <div className="flex justify-end">
              <div className={`min-w-[260px] flex justify-between gap-4 text-base font-bold ${incomeStatement.totals.netIncome >= 0 ? 'text-success' : 'text-destructive'}`}>
                <span>Net Income {incomeStatement.totals.netIncome >= 0 ? '(Profit)' : '(Loss)'}:</span>
                <span className="font-mono">{fmtCurrency(incomeStatement.totals.netIncome)}</span>
              </div>
            </div>
          </div>
          </div>
        </>
      ) : option.mode === 'income-statement' && !option.detailed && !option.isComprehensive && summary ? (
        <>
          <div className="max-w-4xl flex justify-end gap-2 mb-3 print:hidden">
            <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!hasLoaded} className="h-8 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={triggerPrint} disabled={!hasLoaded} className="h-8 gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              Print
            </Button>
          </div>
          <div className="max-w-4xl bg-card border rounded-lg shadow-sm overflow-hidden print:max-w-none">
            <div className="px-4 py-3">
              <table className="w-full table-fixed text-sm border-collapse">
                <colgroup><col /><col className="w-40" /></colgroup>
                <tbody>
                  <tr className="border-b border-border/70">
                    <td className="py-1.5 font-semibold">Total Revenue</td>
                    <td className="py-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(summary.totalRevenue)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 font-semibold">Total Expenses</td>
                    <td className="py-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(summary.totalExpenses)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={`px-4 py-3 border-t-2 ${summary.netIncome >= 0 ? 'bg-success-bg border-success-border' : 'bg-destructive-bg border-destructive-border'}`}>
              <div className="flex justify-between">
                <span className={`text-base font-bold ${summary.netIncome >= 0 ? 'text-success' : 'text-destructive'}`}>
                  Net Income {summary.netIncome >= 0 ? '(Profit)' : '(Loss)'}:
                </span>
                <span className={`text-base font-bold font-mono ${summary.netIncome >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtCurrency(summary.netIncome)}</span>
              </div>
            </div>
          </div>
        </>
      ) : option.mode === 'income-statement-by-department' ? (
        <>
          <div className="max-w-4xl flex justify-end gap-2 mb-3 print:hidden">
            <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!hasLoaded} className="h-8 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={triggerPrint} disabled={!hasLoaded} className="h-8 gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              Print
            </Button>
          </div>
          <div className="max-w-4xl space-y-4 print:max-w-none">
            {rows.length === 0 ? (
              <div className="bg-card border rounded-lg shadow-sm px-4 py-6 text-sm text-muted-foreground">No activity in this period.</div>
            ) : (
              <>
                {/* Summary across departments */}
                <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
                  <div className="bg-info-bg dark:bg-info/40 px-4 py-1.5 border-b border-border">
                    <h3 className="text-sm font-bold tracking-wide">Summary by Department</h3>
                  </div>
                  <div className="px-4 py-3">
                    <table className="w-full table-fixed text-sm border-collapse">
                      <colgroup><col /><col className="w-40" /><col className="w-40" /><col className="w-40" /></colgroup>
                      <thead>
                        <tr className="border-b-2 border-foreground/70 text-xs uppercase tracking-wide text-muted-foreground">
                          <th scope="col" className="text-left font-semibold pb-1.5">Department</th>
                          <th scope="col" className="text-right font-semibold pb-1.5">Revenue</th>
                          <th scope="col" className="text-right font-semibold pb-1.5">Expenses</th>
                          <th scope="col" className="text-right font-semibold pb-1.5">Net Income</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((d: any) => (
                          <tr key={d.department} className="border-b border-border/70">
                            <td className="py-1.5">{d.department}</td>
                            <td className="py-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(d.totalRevenue)}</td>
                            <td className="py-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(d.totalExpenses)}</td>
                            <td className={`py-1.5 text-right font-mono font-medium whitespace-nowrap ${d.netIncome >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtCurrency(d.netIncome)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-foreground/70 font-semibold">
                          <td className="pt-1.5">Total</td>
                          <td className="pt-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(rows.reduce((s: number, d: any) => s + (d.totalRevenue || 0), 0))}</td>
                          <td className="pt-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(rows.reduce((s: number, d: any) => s + (d.totalExpenses || 0), 0))}</td>
                          <td className="pt-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(rows.reduce((s: number, d: any) => s + (d.netIncome || 0), 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Detail per department, account by account */}
                {rows.map((d: any) => (
                  <div key={d.department} className="bg-card border rounded-lg shadow-sm overflow-hidden break-inside-avoid">
                    <div className="bg-info-bg dark:bg-info/40 px-4 py-1.5 border-b border-border flex justify-between">
                      <h3 className="text-sm font-bold tracking-wide">{d.department}</h3>
                      <span className={`text-sm font-mono font-semibold ${d.netIncome >= 0 ? 'text-success' : 'text-destructive'}`}>Net {fmtCurrency(d.netIncome)}</span>
                    </div>
                    <div className="px-4 py-3">
                      <table className="w-full table-fixed text-sm border-collapse">
                        <colgroup><col className="w-20" /><col /><col className="w-40" /></colgroup>
                        <tbody>
                          {[['Revenue', d.revenue, d.totalRevenue], ['Expenses', d.expenses, d.totalExpenses]].map(([label, lines, total]: any) => (
                            <React.Fragment key={label}>
                              <tr><td colSpan={3} className="pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</td></tr>
                              {lines.length === 0 ? (
                                <tr><td /><td className="py-1 text-muted-foreground">None</td><td /></tr>
                              ) : lines.map((l: any) => (
                                <tr key={l.accountCode} className="border-b border-border/50">
                                  <td className="py-1 font-mono text-muted-foreground">{l.accountCode}</td>
                                  <td className="py-1">{l.accountName}</td>
                                  <td className="py-1 text-right font-mono whitespace-nowrap">{fmtCurrency(l.amount)}</td>
                                </tr>
                              ))}
                              <tr className="font-semibold">
                                <td /><td className="py-1">Total {String(label).toLowerCase()}</td>
                                <td className="py-1 text-right font-mono whitespace-nowrap border-t border-foreground/40">{fmtCurrency(total)}</td>
                              </tr>
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground print:hidden">
                  Each account is placed in the department its categories are linked to (Setup › Categories); when several departments share an account it goes to the one with the most products/services on it. Accounts no department-linked category uses are shown under General.
                </p>
              </>
            )}
          </div>
        </>
      ) : option.mode === 'income-statement-by-branch' ? (
        <>
          <div className="max-w-4xl flex justify-end gap-2 mb-3 print:hidden">
            <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!hasLoaded} className="h-8 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={triggerPrint} disabled={!hasLoaded} className="h-8 gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              Print
            </Button>
          </div>
          <div className="max-w-4xl bg-card border rounded-lg shadow-sm overflow-hidden print:max-w-none">
            <div className="bg-info-bg dark:bg-info/40 px-4 py-1.5 border-b border-border">
              <h3 className="text-sm font-bold tracking-wide">By Branch</h3>
            </div>
            <div className="px-4 py-3">
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No activity in this period.</p>
              ) : (
                <table className="w-full table-fixed text-sm border-collapse">
                  <colgroup><col /><col className="w-36" /><col className="w-36" /><col className="w-36" /></colgroup>
                  <thead>
                    <tr className="border-b-2 border-foreground/70 text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="text-left font-semibold pb-1.5">Department</th>
                      <th scope="col" className="text-right font-semibold pb-1.5">Revenue</th>
                      <th scope="col" className="text-right font-semibold pb-1.5">Expenses</th>
                      <th scope="col" className="text-right font-semibold pb-1.5">Net Income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={r.branchName} className="border-b border-border/70">
                        <td className="py-1.5 text-muted-foreground">{r.branchName}</td>
                        <td className="py-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(r.totalRevenue)}</td>
                        <td className="py-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(r.totalExpenses)}</td>
                        <td className={`py-1.5 text-right font-mono font-medium whitespace-nowrap ${r.netIncome >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtCurrency(r.netIncome)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-foreground/70 font-semibold">
                      <td className="pt-1.5">Total</td>
                      <td className="pt-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(rows.reduce((s: number, r: any) => s + (r.totalRevenue || 0), 0))}</td>
                      <td className="pt-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(rows.reduce((s: number, r: any) => s + (r.totalExpenses || 0), 0))}</td>
                      <td className="pt-1.5 text-right font-mono whitespace-nowrap">{fmtCurrency(rows.reduce((s: number, r: any) => s + (r.netIncome || 0), 0))}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : (
        <AdvancedDataTable
          headerClassName="bg-info-bg dark:bg-info/40 border-b border-border"
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
