import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Plus, RefreshCw, Trash2, ArrowRightLeft, TrendingUp, TrendingDown,
  CheckCircle2, Coins, Wallet, History, Calculator, Settings,
  Loader2, DollarSign, BarChart3
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState, StatusBadge } from '@/components/common';
import { apiFetch } from '@/utils/accountingApi';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

const ACTIVE_STATUS_MAP = { active: 'success', inactive: 'neutral' } as const;
const ADJUSTMENT_STATUS_MAP = { realized: 'success', pending: 'warning' } as const;

// ─── Types ───────────────────────────────────────────────────
interface Currency {
  id: number; code: string; name: string; symbol: string;
  is_base_currency: boolean; decimal_places: number; is_active: boolean;
}
interface ExRate {
  id: string; from_currency: string; to_currency: string; rate: string;
  buy_rate?: string; sell_rate?: string; spot_rate?: string;
  effective_date: string; expiry_date?: string; source: string;
  is_active: boolean; notes?: string; effective_rate?: string;
}
interface AcctBalance {
  account_name: string; account_type: string; account_code: string;
  currency_code: string; balance_in_currency: number;
  balance_in_base_currency: number; unrealized_gain_loss: number;
}
interface Adjustment {
  id: string; from_currency: string; to_currency: string;
  original_amount: number; original_rate: number; original_base_amount: number;
  settlement_rate: number; settlement_base_amount: number;
  realized_gain_loss: number; unrealized_gain_loss: number;
  adjustment_type: string; adjustment_status: string;
  reference_type: string; reference_id: string;
  transaction_date: string; notes: string;
}
interface ConversionLog {
  id: string; from_currency: string; to_currency: string;
  amount_source: number; rate_used: number; amount_converted: number;
  conversion_method: string; conversion_date: string;
  source_transaction_type: string;
}

const ExchangeRates: React.FC = () => {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('rates');

  // Data
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [baseCurrency, setBaseCurrency] = useState<Currency | null>(null);
  const [rates, setRates] = useState<ExRate[]>([]);
  const [accountBalances, setAccountBalances] = useState<AcctBalance[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [adjSummary, setAdjSummary] = useState<any>({});
  const [conversions, setConversions] = useState<ConversionLog[]>([]);

  // Dialogs
  const [showRateDialog, setShowRateDialog] = useState(false);
  const [showCurrencyDialog, setShowCurrencyDialog] = useState(false);

  // Forms
  const [rateForm, setRateForm] = useState({
    from_currency: 'USD', to_currency: '', rate: '', buy_rate: '', sell_rate: '', spot_rate: '',
    effective_date: new Date().toISOString().split('T')[0], source: 'manual', notes: ''
  });
  const [currencyForm, setCurrencyForm] = useState({
    code: '', name: '', symbol: '', decimal_places: '2', is_base_currency: false
  });

  // Converter
  const [convAmount, setConvAmount] = useState('');
  const [convFrom, setConvFrom] = useState('USD');
  const [convTo, setConvTo] = useState('');
  const [convResult, setConvResult] = useState<any>(null);

  // ─── Loaders ─────────────────────────────────────────────────
  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (baseCurrency?.code) {
      setRateForm(prev => prev.to_currency ? prev : { ...prev, to_currency: baseCurrency.code });
      setConvTo(prev => prev || baseCurrency.code);
    }
  }, [baseCurrency]);

  const loadAll = async () => {
    setLoading(true);
    try {
      await Promise.all([loadCurrencies(), loadRates(), loadDashboard()]);
    } catch (e) {
      console.error('loadAll error:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrencies = async () => {
    try {
      const res = await apiFetch('/api/exchange-rates/currencies');
      if (res.ok) {
        const json = await res.json();
        setCurrencies(json.data || []);
        setBaseCurrency(json.baseCurrency || null);
      }
    } catch { /* ignore */ }
  };

  const loadRates = async () => {
    try {
      const res = await apiFetch('/api/exchange-rates/rates');
      if (res.ok) {
        const json = await res.json();
        setRates(json.data || []);
      }
    } catch { /* ignore */ }
  };

  const loadDashboard = async () => {
    try {
      const res = await apiFetch('/api/exchange-rates/dashboard');
      if (res.ok) {
        const json = await res.json();
        setAccountBalances(json.data?.accountBalances || []);
      }
    } catch { /* ignore */ }
  };

  const loadAdjustments = async () => {
    try {
      const res = await apiFetch('/api/exchange-rates/adjustments');
      if (res.ok) {
        const json = await res.json();
        setAdjustments(json.data || []);
        setAdjSummary(json.summary || {});
      }
    } catch { /* ignore */ }
  };

  const loadConversions = async () => {
    try {
      const res = await apiFetch('/api/exchange-rates/conversions');
      if (res.ok) {
        const json = await res.json();
        setConversions(json.data || []);
      }
    } catch { /* ignore */ }
  };

  // ─── Actions ─────────────────────────────────────────────────
  const getDefaultRateForm = () => {
    const activeCurrs = currencies.filter(c => c.is_active);
    const base = activeCurrs.find(c => c.is_base_currency);
    const foreign = activeCurrs.find(c => !c.is_base_currency);
    return {
      from_currency: foreign?.code || activeCurrs[0]?.code || 'USD',
      to_currency: base?.code || activeCurrs[1]?.code || '',
      rate: '', buy_rate: '', sell_rate: '', spot_rate: '',
      effective_date: new Date().toISOString().split('T')[0],
      source: 'manual', notes: ''
    };
  };

  const saveRate = async () => {
    if (!rateForm.from_currency || !rateForm.to_currency) {
      toast.error('Please select both From and To currencies'); return;
    }
    if (rateForm.from_currency === rateForm.to_currency) {
      toast.error('From and To currencies must be different'); return;
    }
    if (!rateForm.rate || parseFloat(rateForm.rate) <= 0) {
      toast.error('Enter a valid rate'); return;
    }
    try {
      setSaving(true);
      const res = await apiFetch('/api/exchange-rates/rates', {
        method: 'POST',
        body: JSON.stringify(rateForm),
      });
      if (res.ok) {
        toast.success('Exchange rate saved');
        setShowRateDialog(false);
        setRateForm(getDefaultRateForm());
        await loadRates();
      } else {
        let errMsg = 'Failed to save rate';
        try { const err = await res.json(); errMsg = err.error || errMsg; } catch { /* non-JSON response */ }
        toast.error(errMsg);
        console.error('Save rate failed:', errMsg);
      }
    } catch (e) {
      console.error('Save rate error:', e);
      toast.error('Failed to save rate — check server connection');
    }
    finally { setSaving(false); }
  };

  const deactivateRate = async (id: string) => {
    try {
      const res = await apiFetch(`/api/exchange-rates/rates/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Rate deactivated'); await loadRates(); }
    } catch { toast.error('Failed'); }
  };

  const saveCurrency = async () => {
    if (!currencyForm.code || !currencyForm.name) {
      toast.error('Code and name required'); return;
    }
    try {
      setSaving(true);
      const res = await apiFetch('/api/exchange-rates/currencies', {
        method: 'POST',
        body: JSON.stringify(currencyForm),
      });
      if (res.ok) {
        toast.success(`Currency ${currencyForm.code} saved`);
        setShowCurrencyDialog(false);
        setCurrencyForm({ code: '', name: '', symbol: '', decimal_places: '2', is_base_currency: false });
        await loadCurrencies();
      } else {
        let errMsg = 'Failed';
        try { const err = await res.json(); errMsg = err.error || errMsg; } catch { /* */ }
        toast.error(errMsg);
      }
    } catch { toast.error('Failed'); }
    finally { setSaving(false); }
  };

  const deactivateCurrency = async (code: string) => {
    if (!(await confirm({ description: `Deactivate ${code}?` }))) return;
    try {
      const res = await apiFetch(`/api/exchange-rates/currencies/${code}`, { method: 'DELETE' });
      if (res.ok) { toast.success(`${code} deactivated`); await loadCurrencies(); }
      else { const err = await res.json(); toast.error(err.error || 'Failed'); }
    } catch { toast.error('Failed'); }
  };

  const setAsBaseCurrency = async (code: string) => {
    if (!(await confirm({ description: `Set ${code} as the base currency? This will change all exchange rate calculations.` }))) return;
    try {
      setSaving(true);
      const res = await apiFetch(`/api/exchange-rates/currencies/${code}`, {
        method: 'PUT',
        body: JSON.stringify({ is_base_currency: true }),
      });
      if (res.ok) {
        toast.success(`${code} is now the base currency`);
        await loadAll();
      } else {
        let errMsg = 'Failed to set base currency';
        try { const err = await res.json(); errMsg = err.error || errMsg; } catch { /* */ }
        toast.error(errMsg);
      }
    } catch { toast.error('Failed to set base currency'); }
    finally { setSaving(false); }
  };

  const doConvert = async () => {
    if (!convAmount || parseFloat(convAmount) <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      const res = await apiFetch('/api/exchange-rates/convert', {
        method: 'POST',
        body: JSON.stringify({ amount: parseFloat(convAmount), from_currency: convFrom, to_currency: convTo }),
      });
      if (res.ok) {
        const json = await res.json();
        setConvResult(json.data);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Conversion failed');
        setConvResult(null);
      }
    } catch { toast.error('Conversion failed'); }
  };

  const doRevalue = async () => {
    if (!(await confirm({ description: 'Revalue all foreign currency balances at current rates?' }))) return;
    try {
      setLoading(true);
      const res = await apiFetch('/api/exchange-rates/revalue', { method: 'POST', body: JSON.stringify({}) });
      if (res.ok) {
        const json = await res.json();
        toast.success(json.message || 'Revaluation done');
        await loadDashboard();
        await loadAdjustments();
      }
    } catch { toast.error('Revaluation failed'); }
    finally { setLoading(false); }
  };

  // ─── Helpers ─────────────────────────────────────────────────
  const baseCurrCode = baseCurrency?.code || '';
  const foreignCurrencies = currencies.filter(c => !c.is_base_currency && c.is_active);
  const activeRates = rates.filter(r => r.is_active);

  // Deduplicate to latest rate per pair
  const latestRates: Record<string, ExRate> = {};
  for (const r of activeRates) {
    const key = `${r.from_currency}-${r.to_currency}`;
    if (!latestRates[key]) latestRates[key] = r;
  }

  // Get rate for a foreign currency vs base — checks both directions
  const getRateForCurrency = (foreignCode: string): { rate: ExRate | undefined; inverted: boolean } => {
    const direct = latestRates[`${foreignCode}-${baseCurrCode}`];
    if (direct) return { rate: direct, inverted: false };
    const inverse = latestRates[`${baseCurrCode}-${foreignCode}`];
    if (inverse) return { rate: inverse, inverted: true };
    return { rate: undefined, inverted: false };
  };

  const getEffectiveRate = (r: ExRate, inverted: boolean): number => {
    const raw = parseFloat(r.effective_rate || r.rate || '0');
    return inverted ? (raw > 0 ? 1 / raw : 0) : raw;
  };

  const fmtNum = (v: any, dp = 2) => parseFloat(v || 0).toFixed(dp);
  const currencyOptions = currencies.filter(c => c.is_active);

  // Group account balances by account
  const groupedBalances: Record<string, { name: string; type: string; code: string; currencies: AcctBalance[] }> = {};
  for (const ab of accountBalances) {
    const key = ab.account_code;
    if (!groupedBalances[key]) {
      groupedBalances[key] = { name: ab.account_name, type: ab.account_type, code: ab.account_code, currencies: [] };
    }
    groupedBalances[key].currencies.push(ab);
  }

  // ─── Render ──────────────────────────────────────────────────
  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<BarChart3 />}
          title="Exchange Rates"
          actions={
            <Button onClick={loadAll} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
          }
        />
        {loading && <LoadingState message="Loading exchange rates..." />}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Active Rates</p>
                  <p className="text-2xl font-bold tracking-tight">{activeRates.length}</p>
                  <p className="text-xs text-muted-foreground">Exchange rate pairs</p>
                </div>
                <div className="p-2.5 rounded-lg bg-purple-50 dark:bg-purple-950">
                  <ArrowRightLeft className="w-5 h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          {foreignCurrencies.slice(0, 2).map(fc => {
            const { rate: lr, inverted } = getRateForCurrency(fc.code);
            const displayRate = lr ? getEffectiveRate(lr, inverted) : 0;
            return (
              <Card key={fc.code}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">{fc.code} / {baseCurrCode}</p>
                      <p className="text-2xl font-bold tracking-tight font-mono">{lr ? fmtNum(displayRate) : '—'}</p>
                      <p className="text-xs text-muted-foreground">{lr ? `1 ${fc.code} = ${fmtNum(displayRate)} ${baseCurrCode}` : 'No rate set'}</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950">
                      <DollarSign className="w-5 h-5 text-emerald-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => {
          setActiveTab(v);
          if (v === 'gains' && adjustments.length === 0) loadAdjustments();
          if (v === 'conversions' && conversions.length === 0) loadConversions();
        }}>
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-6">
            <TabsTrigger value="rates" className="gap-1 text-xs"><ArrowRightLeft className="h-3 w-3" /> Rates</TabsTrigger>
            <TabsTrigger value="currencies" className="gap-1 text-xs"><Coins className="h-3 w-3" /> Currencies</TabsTrigger>
            <TabsTrigger value="accounts" className="gap-1 text-xs"><Wallet className="h-3 w-3" /> Balances</TabsTrigger>
            <TabsTrigger value="gains" className="gap-1 text-xs"><BarChart3 className="h-3 w-3" /> Gains/Losses</TabsTrigger>
            <TabsTrigger value="conversions" className="gap-1 text-xs"><History className="h-3 w-3" /> History</TabsTrigger>
            <TabsTrigger value="converter" className="gap-1 text-xs"><Calculator className="h-3 w-3" /> Converter</TabsTrigger>
          </TabsList>

          {/* ═══ EXCHANGE RATES TAB ═══ */}
          <TabsContent value="rates" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Exchange Rates</h2>
              <Dialog open={showRateDialog} onOpenChange={(open) => { setShowRateDialog(open); if (open) setRateForm(getDefaultRateForm()); }}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> New Rate</Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Set Exchange Rate</DialogTitle>
                    <DialogDescription>Define a new exchange rate for a currency pair.</DialogDescription>
                  </DialogHeader>
                  <div className="px-5 py-4 space-y-4">
                    <div className="grid grid-cols-5 gap-2 items-end">
                      <div className="col-span-2">
                        <Label className="text-xs">From</Label>
                        <Combobox
                          options={currencyOptions.length > 0
                            ? currencyOptions.map(c => ({ value: c.code, label: `${c.code} - ${c.name}` }))
                            : [{ value: rateForm.from_currency, label: rateForm.from_currency }]
                          }
                          value={rateForm.from_currency}
                          onChange={v => setRateForm(p => ({ ...p, from_currency: v }))}
                          searchPlaceholder="Search currencies..."
                        />
                      </div>
                      <div className="flex justify-center pb-2"><ArrowRightLeft className="h-4 w-4 text-muted-foreground" /></div>
                      <div className="col-span-2">
                        <Label className="text-xs">To</Label>
                        <Combobox
                          options={currencyOptions.length > 0
                            ? currencyOptions.map(c => ({ value: c.code, label: `${c.code} - ${c.name}` }))
                            : [{ value: rateForm.to_currency, label: rateForm.to_currency }]
                          }
                          value={rateForm.to_currency}
                          onChange={v => setRateForm(p => ({ ...p, to_currency: v }))}
                          searchPlaceholder="Search currencies..."
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Rate (1 {rateForm.from_currency} = ? {rateForm.to_currency})</Label>
                      <Input type="number" step="0.000001" value={rateForm.rate} onChange={e => setRateForm(p => ({ ...p, rate: e.target.value }))} placeholder="e.g., 5700.00" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs">Buy Rate</Label>
                        <Input type="number" step="0.000001" value={rateForm.buy_rate} onChange={e => setRateForm(p => ({ ...p, buy_rate: e.target.value }))} placeholder="Optional" />
                      </div>
                      <div>
                        <Label className="text-xs">Sell Rate</Label>
                        <Input type="number" step="0.000001" value={rateForm.sell_rate} onChange={e => setRateForm(p => ({ ...p, sell_rate: e.target.value }))} placeholder="Optional" />
                      </div>
                      <div>
                        <Label className="text-xs">Spot Rate</Label>
                        <Input type="number" step="0.000001" value={rateForm.spot_rate} onChange={e => setRateForm(p => ({ ...p, spot_rate: e.target.value }))} placeholder="Optional" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs">Effective Date</Label>
                        <Input type="date" value={rateForm.effective_date} onChange={e => setRateForm(p => ({ ...p, effective_date: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs">Source</Label>
                        <Combobox
                          options={[
                            { value: 'manual', label: 'Manual Entry' },
                            { value: 'bank', label: 'Bank Rate' },
                            { value: 'market', label: 'Market Rate' },
                            { value: 'central_bank', label: 'Central Bank' },
                          ]}
                          value={rateForm.source}
                          onChange={v => setRateForm(p => ({ ...p, source: v }))}
                          searchPlaceholder="Search..."
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Notes</Label>
                      <Textarea rows={2} value={rateForm.notes} onChange={e => setRateForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes..." />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowRateDialog(false)}>Cancel</Button>
                    <Button onClick={saveRate} disabled={saving}>{saving ? 'Saving...' : 'Save Rate'}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {/* Active rate cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {foreignCurrencies.map(fc => {
                const { rate: lr, inverted } = getRateForCurrency(fc.code);
                const displayRate = lr ? getEffectiveRate(lr, inverted) : 0;
                return (
                  <Card key={fc.code} className="relative overflow-hidden">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/20">
                              <ArrowRightLeft className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <p className="font-semibold">{fc.code} / {baseCurrCode}</p>
                              <p className="text-xs text-muted-foreground">{fc.name}</p>
                            </div>
                          </div>
                          {lr ? (
                            <>
                              <p className="text-3xl font-bold font-mono tracking-tight">{fmtNum(displayRate)}</p>
                              <div className="text-xs text-muted-foreground space-y-0.5">
                                {lr.buy_rate && <p>Buy: {fmtNum(lr.buy_rate)}</p>}
                                {lr.sell_rate && <p>Sell: {fmtNum(lr.sell_rate)}</p>}
                                {inverted && <p className="text-amber-600">↩ Derived from {lr.from_currency}→{lr.to_currency}</p>}
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground py-4">No active rate set</p>
                          )}
                        </div>
                        {lr && (
                          <div className="text-right space-y-1">
                            <StatusBadge status="active" map={ACTIVE_STATUS_MAP}
                              label={<span className="inline-flex items-center"><CheckCircle2 className="w-3 h-3 mr-1" /> Active</span>} />
                            <div className="text-xs text-muted-foreground mt-2">
                              <p>{new Date(lr.effective_date).toLocaleDateString()}</p>
                              <p className="capitalize">{lr.source}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Rate table */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Rate History</CardTitle>
                <CardDescription>{activeRates.length} active, {rates.length} total</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                <AdvancedDataTable<ExRate>
                  data={rates}
                  keyExtractor={(r) => r.id}
                  emptyMessage='No exchange rates. Click "New Rate" to add.'
                  rowClassName={(r) => r.is_active ? '' : 'opacity-50'}
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    {
                      key: 'from_currency', header: 'Pair',
                      render: (v, r) => (
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs font-mono">{v}</Badge>
                          <ArrowRightLeft className="w-3 h-3 text-muted-foreground" />
                          <Badge variant="outline" className="text-xs font-mono">{r.to_currency}</Badge>
                        </div>
                      ),
                    },
                    { key: 'rate', header: 'Rate', align: 'right', render: (v) => <span className="font-mono font-medium">{fmtNum(v, 4)}</span> },
                    { key: 'buy_rate', header: 'Buy', align: 'right', render: (v) => <span className="font-mono text-xs">{v ? fmtNum(v, 4) : '—'}</span> },
                    { key: 'sell_rate', header: 'Sell', align: 'right', render: (v) => <span className="font-mono text-xs">{v ? fmtNum(v, 4) : '—'}</span> },
                    { key: 'effective_date', header: 'Date', sortable: true, render: (v) => <span className="text-xs">{new Date(v).toLocaleDateString()}</span> },
                    { key: 'source', header: 'Source', render: (v) => <span className="text-xs capitalize">{v}</span> },
                    {
                      key: 'is_active', header: 'Status', align: 'center',
                      render: (v) => <StatusBadge status={v ? 'active' : 'inactive'} map={ACTIVE_STATUS_MAP} />,
                    },
                    {
                      key: '__actions', header: 'Actions', align: 'center',
                      render: (_v, r) => r.is_active ? (
                        <Button size="sm" variant="ghost" onClick={() => deactivateRate(r.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      ) : null,
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ CURRENCIES TAB ═══ */}
          <TabsContent value="currencies" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Currency Management</h2>
              <Dialog open={showCurrencyDialog} onOpenChange={setShowCurrencyDialog}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Currency</Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Add Currency</DialogTitle>
                    <DialogDescription>Add a new currency for your system.</DialogDescription>
                  </DialogHeader>
                  <div className="px-5 py-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Code (3 letters)</Label>
                        <Input maxLength={3} value={currencyForm.code} onChange={e => setCurrencyForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="e.g., EUR" />
                      </div>
                      <div>
                        <Label className="text-xs">Symbol</Label>
                        <Input maxLength={5} value={currencyForm.symbol} onChange={e => setCurrencyForm(p => ({ ...p, symbol: e.target.value }))} placeholder="e.g., $" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Name</Label>
                      <Input value={currencyForm.name} onChange={e => setCurrencyForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Euro" />
                    </div>
                    <div className="grid grid-cols-2 gap-3 items-center">
                      <div>
                        <Label className="text-xs">Decimal Places</Label>
                        <Input type="number" min={0} max={4} value={currencyForm.decimal_places} onChange={e => setCurrencyForm(p => ({ ...p, decimal_places: e.target.value }))} />
                      </div>
                      <div className="flex items-center gap-2 pt-4">
                        <Switch checked={currencyForm.is_base_currency} onCheckedChange={v => setCurrencyForm(p => ({ ...p, is_base_currency: v }))} />
                        <Label className="text-xs">Base Currency</Label>
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowCurrencyDialog(false)}>Cancel</Button>
                    <Button onClick={saveCurrency} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {currencies.map(c => (
                <Card key={c.code} className={`relative ${!c.is_active ? 'opacity-50' : ''}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${c.is_base_currency ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            {c.symbol || c.code.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold text-lg">{c.code}</p>
                            <p className="text-xs text-muted-foreground">{c.name}</p>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <p>Decimal places: {c.decimal_places}</p>
                          <p>Symbol: {c.symbol || '—'}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {c.is_base_currency && (
                          <Badge className="bg-primary/10 text-primary text-xs">Base Currency</Badge>
                        )}
                        <StatusBadge status={c.is_active ? 'active' : 'inactive'} map={ACTIVE_STATUS_MAP} />
                        {!c.is_base_currency && c.is_active && (
                          <div className="flex items-center gap-1 mt-1">
                            <Button size="sm" variant="outline" onClick={() => setAsBaseCurrency(c.code)} className="text-xs h-7 gap-1" disabled={saving}>
                              <CheckCircle2 className="w-3 h-3" /> Set as Base
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => deactivateCurrency(c.code)}>
                              <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ═══ ACCOUNT BALANCES TAB ═══ */}
          <TabsContent value="accounts" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Account Balances by Currency</h2>
              <Button size="sm" variant="outline" onClick={doRevalue} disabled={loading} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Revalue Balances
              </Button>
            </div>
            {Object.keys(groupedBalances).length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Wallet className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>No multi-currency account balances recorded yet.</p>
                  <p className="text-xs mt-1">Balances appear as transactions are posted in different currencies.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {Object.values(groupedBalances).map(acct => (
                  <Card key={acct.code}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm">{acct.name}</CardTitle>
                          <CardDescription className="text-xs">{acct.code} &bull; {acct.type}</CardDescription>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize">{acct.type}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {acct.currencies.map(cb => (
                          <div key={cb.currency_code} className="p-3 bg-card rounded-lg">
                            <p className="text-xs text-muted-foreground font-medium">{cb.currency_code}</p>
                            <p className="text-lg font-bold font-mono">{fmtNum(cb.balance_in_currency)}</p>
                            {cb.currency_code !== baseCurrCode && (
                              <>
                                <p className="text-xs text-muted-foreground">= {fmtNum(cb.balance_in_base_currency)} {baseCurrCode}</p>
                                {cb.unrealized_gain_loss !== 0 && (
                                  <p className={`text-xs font-medium ${cb.unrealized_gain_loss > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {cb.unrealized_gain_loss > 0 ? '+' : ''}{fmtNum(cb.unrealized_gain_loss)} G/L
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ═══ GAINS/LOSSES TAB ═══ */}
          <TabsContent value="gains" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Exchange Gains &amp; Losses</h2>
              <Button size="sm" variant="outline" onClick={loadAdjustments} disabled={loading} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">Realized Gain/Loss</p>
                      <p className={`text-2xl font-bold tracking-tight font-mono ${parseFloat(adjSummary.total_realized || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmtNum(adjSummary.total_realized)} {baseCurrCode}
                      </p>
                      <p className="text-xs text-muted-foreground">Settled transactions</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950">
                      <TrendingUp className="w-5 h-5 text-emerald-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">Unrealized Gain/Loss</p>
                      <p className={`text-2xl font-bold tracking-tight font-mono ${parseFloat(adjSummary.total_unrealized || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmtNum(adjSummary.total_unrealized)} {baseCurrCode}
                      </p>
                      <p className="text-xs text-muted-foreground">Open positions</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950">
                      <TrendingDown className="w-5 h-5 text-amber-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">Total Adjustments</p>
                      <p className="text-2xl font-bold tracking-tight">{adjSummary.total_count || 0}</p>
                      <p className="text-xs text-muted-foreground">Recorded entries</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-primary/10 dark:bg-primary/20">
                      <BarChart3 className="w-5 h-5 text-primary" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            {/* Table */}
            <Card>
              <CardContent className="p-4">
                <AdvancedDataTable<Adjustment>
                  data={adjustments}
                  keyExtractor={(a) => a.id}
                  emptyMessage="No exchange adjustments recorded yet."
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    { key: 'transaction_date', header: 'Date', sortable: true, render: (v) => <span className="text-xs">{new Date(v).toLocaleDateString()}</span> },
                    { key: 'from_currency', header: 'Currency', render: (v) => <Badge variant="outline" className="text-xs font-mono">{v}</Badge> },
                    { key: 'original_amount', header: 'Original', align: 'right', render: (v) => <span className="font-mono">{fmtNum(v)}</span> },
                    { key: 'original_rate', header: 'Rate Orig', align: 'right', render: (v) => <span className="font-mono text-xs">{fmtNum(v, 4)}</span> },
                    { key: 'settlement_rate', header: 'Rate Settle', align: 'right', render: (v) => <span className="font-mono text-xs">{fmtNum(v, 4)}</span> },
                    {
                      key: 'realized_gain_loss', header: 'Realized G/L', align: 'right', sortable: true,
                      render: (v) => <span className={`font-mono font-medium ${v >= 0 ? 'text-green-700' : 'text-red-700'}`}>{v >= 0 ? '+' : ''}{fmtNum(v)}</span>,
                    },
                    { key: 'adjustment_type', header: 'Type', render: (v) => <span className="text-xs capitalize">{v}</span> },
                    { key: 'adjustment_status', header: 'Status', render: (v) => <StatusBadge status={v} map={ADJUSTMENT_STATUS_MAP} className="capitalize" /> },
                  ]}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ CONVERSION HISTORY TAB ═══ */}
          <TabsContent value="conversions" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Conversion Audit Trail</h2>
              <Button size="sm" variant="outline" onClick={loadConversions} disabled={loading} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
            <Card>
              <CardContent className="p-4">
                <AdvancedDataTable<ConversionLog>
                  data={conversions}
                  keyExtractor={(c) => c.id}
                  emptyMessage="No conversions recorded yet."
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    { key: 'conversion_date', header: 'Date', sortable: true, render: (v) => <span className="text-xs">{new Date(v).toLocaleDateString()}</span> },
                    { key: 'from_currency', header: 'From', render: (v) => <Badge variant="outline" className="text-xs font-mono">{v}</Badge> },
                    { key: 'amount_source', header: 'Amount', align: 'right', render: (v) => <span className="font-mono">{fmtNum(v)}</span> },
                    { key: 'rate_used', header: 'Rate', align: 'center', render: (v) => <span className="font-mono text-xs">{fmtNum(v, 4)}</span> },
                    { key: 'to_currency', header: 'To', render: (v) => <Badge variant="outline" className="text-xs font-mono">{v}</Badge> },
                    { key: 'amount_converted', header: 'Converted', align: 'right', render: (v) => <span className="font-mono font-medium">{fmtNum(v)}</span> },
                    { key: 'conversion_method', header: 'Method', render: (v) => <span className="text-xs capitalize">{v}</span> },
                    { key: 'source_transaction_type', header: 'Source', render: (v) => <span className="text-xs capitalize">{v || '—'}</span> },
                  ]}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ CONVERTER TAB ═══ */}
          <TabsContent value="converter" className="space-y-4">
            <h2 className="text-lg font-semibold">Currency Converter</h2>
            <Card className="max-w-lg">
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-5 gap-3 items-end">
                  <div className="col-span-2">
                    <Label className="text-xs">From</Label>
                    <Combobox
                      options={currencyOptions.map(c => ({ value: c.code, label: c.code }))}
                      value={convFrom}
                      onChange={setConvFrom}
                      searchPlaceholder="Search currencies..."
                    />
                  </div>
                  <div className="flex justify-center pb-2">
                    <Button variant="ghost" size="icon" onClick={() => { const t = convFrom; setConvFrom(convTo); setConvTo(t); setConvResult(null); }}>
                      <ArrowRightLeft className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">To</Label>
                    <Combobox
                      options={currencyOptions.map(c => ({ value: c.code, label: c.code }))}
                      value={convTo}
                      onChange={setConvTo}
                      searchPlaceholder="Search currencies..."
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Amount in {convFrom}</Label>
                  <Input type="number" step="0.01" value={convAmount} onChange={e => { setConvAmount(e.target.value); setConvResult(null); }} placeholder="Enter amount..." className="text-lg font-mono" />
                </div>
                <Button onClick={doConvert} className="w-full gap-2">
                  <Calculator className="h-4 w-4" /> Convert
                </Button>
                {convResult && (
                  <div className="p-4 bg-card rounded-lg text-center space-y-1">
                    <p className="text-sm text-muted-foreground">{fmtNum(convAmount)} {convFrom} =</p>
                    <p className="text-3xl font-bold font-mono">{fmtNum(convResult.convertedAmount)} {convTo}</p>
                    <p className="text-xs text-muted-foreground">Rate: 1 {convFrom} = {fmtNum(convResult.rate, 6)} {convTo}</p>
                    <p className="text-xs text-muted-foreground">This conversion has been logged for audit.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      </div>
    </AppLayout>
  );
};

export default ExchangeRates;
