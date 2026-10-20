import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/notify';
import {
  Calculator, TrendingUp, TrendingDown, PieChart, RefreshCw, CheckCircle2,
  XCircle, Building2, CreditCard, Landmark, FileText, Download
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { apiFetch, formatCurrency, getAccountTypeColor, TrialBalance, TrialBalanceAccount } from '@/utils/accountingApi';
import { useCurrency } from '@/contexts/CurrencyContext';
import { formatDate } from '@/lib/format';

interface IncomeStatement {
  revenue: { items: any[]; total: number };
  expenses: { items: any[]; total: number };
  net_income: number;
}

const FinancialReports: React.FC = () => {
  const { user } = useAuth();
  const { currency: baseCurrencyData } = useCurrency();
  const BASE_CURRENCY = baseCurrencyData.code;
  const [loading, setLoading] = useState(false);
  const [activeReport, setActiveReport] = useState<'trial-balance' | 'income-statement' | 'balance-sheet' | null>(null);
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatement | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<{ assets: TrialBalanceAccount[]; liabilities: TrialBalanceAccount[]; equity: TrialBalanceAccount[] } | null>(null);

  // Local (not UTC) date string — toISOString() shifts the calendar day for any
  // timezone behind UTC late in the day, so "today" could silently default to
  // tomorrow or yesterday depending on when and where this loads.
  const toLocalDateStr = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const now = new Date();
  const todayStr = toLocalDateStr(now);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);

  const loadTrialBalance = async () => {
    try {
      setLoading(true);
      setActiveReport('trial-balance');
      const response = await apiFetch(`/api/accounting/reports/trial-balance?clinic_id=${user?.clinic}`);
      if (response.ok) {
        setTrialBalance(await response.json());
      } else {
        toast.error('Failed to load trial balance');
      }
    } catch (error) {
      toast.error('Failed to load trial balance');
    } finally {
      setLoading(false);
    }
  };

  const loadIncomeStatement = async () => {
    try {
      setLoading(true);
      setActiveReport('income-statement');
      const response = await apiFetch(
        `/api/accounting/reports/income-statement?clinic_id=${user?.clinic}&start_date=${startDate}&end_date=${endDate}`
      );
      if (response.ok) {
        setIncomeStatement(await response.json());
      } else {
        toast.error('Failed to load income statement');
      }
    } catch (error) {
      toast.error('Failed to load income statement');
    } finally {
      setLoading(false);
    }
  };

  const loadBalanceSheet = async () => {
    try {
      setLoading(true);
      setActiveReport('balance-sheet');
      // This used to re-derive the balance sheet from the trial-balance
      // endpoint's accounts array — duplicating logic that could (and did,
      // via the trial balance's own sign-drop bug on negative debit-type
      // balances) drift from GET /reports/balance-sheet, a dedicated endpoint
      // that already computes opening_balance + period_balance correctly with
      // sign preserved but was never actually called from here.
      const response = await apiFetch(`/api/accounting/reports/balance-sheet?clinic_id=${user?.clinic}`);
      if (response.ok) {
        const data = await response.json();
        // Preserves sign: an asset/liability/equity account can legitimately compute to a
        // negative balance (overpayment, refund exceeding what was held, a misposted entry,
        // etc.), and clamping it to 0 here doesn't make the number disappear — it just
        // silently drops it from both the row display AND the section total below, making
        // a real imbalance in the underlying data look like a clean, balanced sheet.
        const toAccounts = (items: any[], field: 'debit_balance' | 'credit_balance'): TrialBalanceAccount[] =>
          (items || []).map((i: any) => ({
            account_code: i.account_code,
            account_name: i.account_name,
            account_type: i.account_type,
            balance_type: field === 'debit_balance' ? 'debit' : 'credit',
            debit_balance: field === 'debit_balance' ? (parseFloat(i.balance) || 0) : 0,
            credit_balance: field === 'credit_balance' ? (parseFloat(i.balance) || 0) : 0,
          } as TrialBalanceAccount));
        setBalanceSheet({
          assets: toAccounts(data.assets?.items, 'debit_balance'),
          liabilities: toAccounts(data.liabilities?.items, 'credit_balance'),
          equity: toAccounts(data.equity?.items, 'credit_balance'),
        });
      } else {
        toast.error('Failed to load balance sheet');
      }
    } catch (error) {
      toast.error('Failed to load balance sheet');
    } finally {
      setLoading(false);
    }
  };

  const reportCards = [
    {
      id: 'trial-balance' as const, title: 'Trial Balance', desc: 'Verify debits equal credits',
      icon: Calculator, color: 'text-primary', bg: 'bg-primary/10 dark:bg-primary/20',
      action: loadTrialBalance
    },
    {
      id: 'income-statement' as const, title: 'Income Statement', desc: 'Revenue, expenses & net income',
      icon: TrendingUp, color: 'text-success', bg: 'bg-success-bg dark:bg-success',
      action: loadIncomeStatement
    },
    {
      id: 'balance-sheet' as const, title: 'Balance Sheet', desc: 'Assets, liabilities & equity',
      icon: PieChart, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950',
      action: loadBalanceSheet
    },
  ];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          title="Financial Reports"
        />
        {loading && <LoadingState message="Generating report..." />}

        {/* Date Range Selector */}
        <Card className="bg-primary/10 border-primary/15">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Period Start</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[160px]" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Period End</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[160px]" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => {
                  setStartDate(todayStr);
                  setEndDate(todayStr);
                }}>Today</Button>
                <Button variant="outline" size="sm" onClick={() => {
                  setStartDate(toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1)));
                  setEndDate(toLocalDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
                }}>This Month</Button>
                <Button variant="outline" size="sm" onClick={() => {
                  setStartDate(toLocalDateStr(new Date(now.getFullYear(), 0, 1)));
                  setEndDate(toLocalDateStr(new Date(now.getFullYear(), 11, 31)));
                }}>This Year</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Report Selector Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {reportCards.map((r) => (
            <Card key={r.id}
              className={`cursor-pointer transition-all hover:shadow-md ${activeReport === r.id ? 'ring-2 ring-primary shadow-md' : ''}`}
              onClick={r.action}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`p-2.5 rounded-lg ${r.bg}`}>
                    <r.icon className={`w-6 h-6 ${r.color}`} />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">{r.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{r.desc}</p>
                  </div>
                  {loading && activeReport === r.id && (
                    <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Trial Balance Report */}
        {activeReport === 'trial-balance' && trialBalance && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="w-5 h-5" /> Trial Balance
                  </CardTitle>
                  <CardDescription>As of {formatDate(new Date())}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {trialBalance.is_balanced
                    ? <Badge className="bg-success-bg text-success dark:bg-success dark:text-success">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Balanced
                      </Badge>
                    : <Badge variant="destructive">
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Unbalanced
                      </Badge>
                  }
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-muted/30">
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Code</th>
                      <th className="px-4 py-3 font-medium">Account Name</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium text-right">Debit ({BASE_CURRENCY})</th>
                      <th className="px-4 py-3 font-medium text-right">Credit ({BASE_CURRENCY})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {trialBalance.accounts.map((account: TrialBalanceAccount, index: number) => (
                      <tr key={index} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-sm">{account.account_code}</td>
                        <td className="px-4 py-2.5 text-sm">{account.account_name}</td>
                        <td className="px-4 py-2.5">
                          <Badge className={`text-xs ${getAccountTypeColor(account.account_type)}`}>{account.account_type}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm">
                          {account.debit_balance > 0 ? formatCurrency(account.debit_balance) : '\u2014'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm">
                          {account.credit_balance > 0 ? formatCurrency(account.credit_balance) : '\u2014'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 font-bold bg-muted/30">
                    <tr>
                      <td colSpan={3} className="px-4 py-3">TOTALS</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(trialBalance.total_debits)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(trialBalance.total_credits)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Income Statement */}
        {activeReport === 'income-statement' && incomeStatement && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" /> Income Statement (P&L)
                  </CardTitle>
                  <CardDescription>
                    Period: {formatDate(startDate)} &mdash; {formatDate(endDate)}
                  </CardDescription>
                  {/* This statement stays on an accrual footing so it agrees with
                      the trial balance and balance sheet beside it — a balance
                      sheet showing receivables only makes sense if revenue was
                      recognised when the bill was raised. Reports ▸ Income
                      Statement answers the other question (what was collected),
                      so the two legitimately differ and each says which it is. */}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Accrual basis — every bill raised in the period, paid or not. For money actually
                    collected, use Reports &rsaquo; Income Statement.
                  </p>
                </div>
                <Badge className={incomeStatement.net_income >= 0
                  ? 'bg-success-bg text-success dark:bg-success dark:text-success'
                  : 'bg-destructive-bg text-destructive dark:bg-destructive dark:text-destructive'}>
                  Net {incomeStatement.net_income >= 0 ? 'Profit' : 'Loss'}: {formatCurrency(Math.abs(incomeStatement.net_income))}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Revenue Section */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-md bg-success-bg dark:bg-success">
                    <TrendingUp className="w-4 h-4 text-success" />
                  </div>
                  <h3 className="font-semibold text-sm uppercase tracking-wider">Revenue</h3>
                </div>
                <div className="border rounded bg-card">
                  <table className="w-full text-sm">
                    <tbody className="divide-y">
                      {incomeStatement.revenue.items.length > 0 ? incomeStatement.revenue.items.map((acc: any, i: number) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground w-20">{acc.account_code}</td>
                          <td className="px-4 py-2.5">{acc.account_name}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-medium">{formatCurrency(acc.balance || acc.credit_balance || 0)}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={3} className="px-4 py-3 text-center text-muted-foreground">No revenue recorded</td></tr>
                      )}
                    </tbody>
                    <tfoot className="border-t-2 bg-success-bg/50 dark:bg-success/30">
                      <tr className="font-bold">
                        <td colSpan={2} className="px-4 py-2.5">Total Revenue</td>
                        <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(incomeStatement.revenue.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Expenses Section */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-md bg-destructive-bg dark:bg-destructive">
                    <TrendingDown className="w-4 h-4 text-destructive" />
                  </div>
                  <h3 className="font-semibold text-sm uppercase tracking-wider">Expenses</h3>
                </div>
                <div className="border rounded bg-card">
                  <table className="w-full text-sm">
                    <tbody className="divide-y">
                      {incomeStatement.expenses.items.length > 0 ? incomeStatement.expenses.items.map((acc: any, i: number) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground w-20">{acc.account_code}</td>
                          <td className="px-4 py-2.5">{acc.account_name}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-medium">{formatCurrency(acc.balance || acc.debit_balance || 0)}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={3} className="px-4 py-3 text-center text-muted-foreground">No expenses recorded</td></tr>
                      )}
                    </tbody>
                    <tfoot className="border-t-2 bg-destructive-bg/50 dark:bg-destructive/30">
                      <tr className="font-bold">
                        <td colSpan={2} className="px-4 py-2.5">Total Expenses</td>
                        <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(incomeStatement.expenses.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Net Income */}
              <div className={`p-4 rounded-lg border-2 ${incomeStatement.net_income >= 0
                ? 'border-success-border bg-success-bg/50 dark:border-success-border dark:bg-success/30'
                : 'border-destructive-border bg-destructive-bg/50 dark:border-destructive-border dark:bg-destructive/30'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">Net {incomeStatement.net_income >= 0 ? 'Income' : 'Loss'}</span>
                  <span className={`text-2xl font-bold font-mono ${incomeStatement.net_income >= 0 ? 'text-success dark:text-success' : 'text-destructive dark:text-destructive'}`}>
                    {formatCurrency(Math.abs(incomeStatement.net_income))}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Balance Sheet */}
        {activeReport === 'balance-sheet' && balanceSheet && (() => {
          const totalAssets = balanceSheet.assets.reduce((s, a) => s + (a.debit_balance || 0), 0);
          const totalLiabilities = balanceSheet.liabilities.reduce((s, a) => s + (a.credit_balance || 0), 0);
          const totalEquity = balanceSheet.equity.reduce((s, a) => s + (a.credit_balance || 0), 0);
          const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

          const SectionTable = ({ title, icon, iconColor, iconBg, accounts, field, total }: {
            title: string; icon: React.ReactNode; iconColor: string; iconBg: string;
            accounts: TrialBalanceAccount[]; field: 'debit_balance' | 'credit_balance'; total: number;
          }) => (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className={`p-1.5 rounded-md ${iconBg}`}>{icon}</div>
                <h3 className="font-semibold text-sm uppercase tracking-wider">{title}</h3>
              </div>
              <div className="border rounded bg-card">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {accounts.length > 0 ? accounts.map((acc, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground w-20">{acc.account_code}</td>
                        <td className="px-4 py-2.5">{acc.account_name}</td>
                        <td className={`px-4 py-2.5 text-right font-mono font-medium ${acc[field] < 0 ? 'text-destructive dark:text-destructive' : ''}`}>
                          {acc[field] !== 0 ? formatCurrency(acc[field]) : '\u2014'}
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={3} className="px-4 py-3 text-center text-muted-foreground">No {title.toLowerCase()} accounts</td></tr>
                    )}
                  </tbody>
                  <tfoot className="border-t-2 bg-muted/30">
                    <tr className="font-bold">
                      <td colSpan={2} className="px-4 py-2.5">Total {title}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );

          return (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <PieChart className="w-5 h-5" /> Balance Sheet
                    </CardTitle>
                    <CardDescription>As of {formatDate(new Date())}</CardDescription>
                  </div>
                  <Badge className={isBalanced
                    ? 'bg-success-bg text-success dark:bg-success dark:text-success'
                    : 'bg-destructive-bg text-destructive dark:bg-destructive dark:text-destructive'}>
                    {isBalanced
                      ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Balanced</>
                      : <><XCircle className="w-3.5 h-3.5 mr-1" /> Unbalanced</>}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <SectionTable title="Assets" icon={<Building2 className="w-4 h-4 text-primary" />}
                  iconColor="text-primary" iconBg="bg-primary/10 dark:bg-primary/20"
                  accounts={balanceSheet.assets} field="debit_balance" total={totalAssets} />

                <SectionTable title="Liabilities" icon={<CreditCard className="w-4 h-4 text-destructive" />}
                  iconColor="text-destructive" iconBg="bg-destructive-bg dark:bg-destructive"
                  accounts={balanceSheet.liabilities} field="credit_balance" total={totalLiabilities} />

                <SectionTable title="Equity" icon={<Landmark className="w-4 h-4 text-purple-600" />}
                  iconColor="text-purple-600" iconBg="bg-purple-50 dark:bg-purple-950"
                  accounts={balanceSheet.equity} field="credit_balance" total={totalEquity} />

                {/* Equation Summary */}
                <div className="p-4 rounded-lg border-2 border-muted bg-card">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Assets</p>
                      <p className="text-xl font-bold font-mono text-primary">{formatCurrency(totalAssets)}</p>
                    </div>
                    <div className="flex items-center justify-center text-2xl font-bold text-muted-foreground">=</div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Liabilities + Equity</p>
                      <p className="text-xl font-bold font-mono">{formatCurrency(totalLiabilities + totalEquity)}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </div>
      </div>
    </AppLayout>
  );
};

export default FinancialReports;
