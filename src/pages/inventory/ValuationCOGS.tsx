import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { DollarSign, RefreshCw, Download, TrendingUp, Package, BarChart3, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

export default function ValuationCOGS() {
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const clinicId = user?.clinic || 1;

  const [activeMode, setActiveMode] = useState<'valuation' | 'cogs'>('valuation');
  const [loading, setLoading] = useState(true);
  const [valuation, setValuation] = useState<any>(null);
  const [cogsData, setCogsData] = useState<any>(null);
  const [cogsPeriod, setCogsPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => { fetchValuation(); }, []);
  useEffect(() => { if (activeMode === 'cogs') fetchCOGS(); }, [activeMode, cogsPeriod]);

  const fetchValuation = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/inventory/valuation?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setValuation(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchCOGS = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/inventory/cogs/monthly/${cogsPeriod}?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setCogsData(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const exportValuationCSV = () => {
    if (!valuation?.items) return;
    const headers = ['Item Code', 'Item Name', 'Category', 'UOM', 'Qty', 'Avg Cost', 'Value', 'Method'];
    const rows = valuation.items.map((i: any) => [i.item_code, i.item_name, i.item_category, i.unit_of_measure, i.quantity_on_hand, i.average_unit_cost, i.weighted_average_value, i.inventory_valuation_method]);
    const csv = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inventory_valuation_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCogsCSV = () => {
    if (!cogsData?.items) return;
    const headers = ['Item Code', 'Item Name', 'Qty Used', 'Qty Wasted', 'Total Cost'];
    const rows = cogsData.items.map((i: any) => [i.item_code, i.item_name, i.quantity_used, i.quantity_wasted, i.total_cost]);
    const csv = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cogs_${cogsPeriod}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const categoryBreakdown: Record<string, { count: number; value: number; quantity: number }> = valuation?.items
    ? valuation.items.reduce((acc: any, item: any) => {
        const cat = item.item_category || 'uncategorized';
        if (!acc[cat]) acc[cat] = { count: 0, value: 0, quantity: 0 };
        acc[cat].count++;
        acc[cat].value += parseFloat(item.weighted_average_value) || 0;
        acc[cat].quantity += parseFloat(item.quantity_on_hand) || 0;
        return acc;
      }, {})
    : {};

  const totalQty = (valuation?.items || []).reduce((s: number, i: any) => s + (parseFloat(i.quantity_on_hand) || 0), 0);

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col overflow-auto">
        <div className="flex justify-between items-start">
          <PageHeader title="Valuation & COGS" icon={<DollarSign />} />
          <div className="flex bg-muted p-1 rounded-lg">
            <button
              onClick={() => setActiveMode('valuation')}
              className={cn("px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2", activeMode === 'valuation' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Package className="w-4 h-4" /> Inventory Valuation
            </button>
            <button
              onClick={() => setActiveMode('cogs')}
              className={cn("px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2", activeMode === 'cogs' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <TrendingUp className="w-4 h-4" /> Cost of Goods Sold
            </button>
          </div>
        </div>

        {activeMode === 'valuation' ? (
          <div className="mt-6 space-y-6">
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="icon" aria-label="Refresh" className="h-9 w-9" onClick={fetchValuation} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="outline" size="sm" className="h-9" onClick={exportValuationCSV}>
                <Download className="w-4 h-4 mr-2" /> Export
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-card rounded-lg border shadow-sm p-4 border-success-border">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-success" />
                  <p className="text-xs text-muted-foreground">Total Inventory Value</p>
                </div>
                <p className="text-2xl font-bold text-success">{fmt(valuation?.total_inventory_value || 0)}</p>
              </div>
              <div className="bg-card rounded-lg border shadow-sm p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Items with Stock</p>
                </div>
                <p className="text-2xl font-bold">{valuation?.item_count || 0}</p>
              </div>
              <div className="bg-card rounded-lg border shadow-sm p-4">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4 text-purple-600" />
                  <p className="text-xs text-muted-foreground">Categories</p>
                </div>
                <p className="text-2xl font-bold">{Object.keys(categoryBreakdown).length}</p>
              </div>
            </div>

            {Object.keys(categoryBreakdown).length > 0 && (
              <div className="bg-card rounded-lg border shadow-sm p-4">
                <h3 className="font-medium mb-3">Value by Category</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(categoryBreakdown).map(([cat, data]) => (
                    <div key={cat} className="p-3 rounded-lg bg-muted/30 border">
                      <p className="text-sm font-semibold capitalize">{cat}</p>
                      <p className="text-xs text-muted-foreground">{data.count} items · {data.quantity} units</p>
                      <p className="text-sm font-mono font-medium mt-1">{fmt(data.value)}</p>
                      <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-success rounded-full" style={{ width: `${Math.min(100, (data.value / (valuation?.total_inventory_value || 1)) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
                <AdvancedDataTable<any>
                  title="Item Valuation Detail"
                  data={valuation?.items || []}
                  keyExtractor={(item) => item.id}
                  loading={loading}
                  emptyMessage="No inventory data."
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    { key: 'item_code', header: 'Code', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                    { key: 'item_name', header: 'Item', sortable: true },
                    { key: 'item_category', header: 'Category', sortable: true, render: (v) => <span className="capitalize text-muted-foreground">{v}</span> },
                    { key: 'quantity_on_hand', header: 'Qty', sortable: true },
                    { key: 'average_unit_cost', header: 'Avg Cost', sortable: true, render: (v) => <span className="font-mono text-muted-foreground">{fmt(v)}</span> },
                    { key: 'weighted_average_value', header: 'Value', sortable: true, render: (v) => <span className="font-mono font-medium">{fmt(v)}</span> },
                    { key: 'inventory_valuation_method', header: 'Method', render: (v) => <span className="capitalize text-muted-foreground">{v?.replace(/_/g, ' ')}</span> },
                  ]}
                />
                {(valuation?.items || []).length > 0 && (
                  <div className="border border-t-0 border-border rounded-b-md bg-muted/20 -mt-px px-3 py-2 flex justify-between text-sm font-semibold">
                    <span>Total:</span>
                    <span className="font-mono">{totalQty} units · {fmt(valuation.total_inventory_value)}</span>
                  </div>
                )}
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground">Period</label>
                <Input type="month" value={cogsPeriod} onChange={e => setCogsPeriod(e.target.value)} className="w-[180px] h-9" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" aria-label="Refresh" className="h-9 w-9" onClick={fetchCOGS} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                <Button variant="outline" size="sm" className="h-9" onClick={exportCogsCSV}>
                  <Download className="w-4 h-4 mr-2" /> Export
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-card rounded-lg border shadow-sm p-4 border-destructive-border">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-destructive" />
                  <p className="text-xs text-muted-foreground">Total COGS</p>
                </div>
                <p className="text-2xl font-bold text-destructive">{fmt(cogsData?.total_cogs || 0)}</p>
              </div>
              <div className="bg-card rounded-lg border shadow-sm p-4">
                <p className="text-xs text-muted-foreground mb-1">Items with Usage</p>
                <p className="text-2xl font-bold">{cogsData?.items?.length || 0}</p>
              </div>
              <div className="bg-card rounded-lg border shadow-sm p-4">
                <p className="text-xs text-muted-foreground mb-1">Period</p>
                <p className="text-2xl font-bold">{cogsPeriod}</p>
              </div>
            </div>

            <div>
                <AdvancedDataTable<any>
                  title={<>COGS by Item — {cogsPeriod}</>}
                  data={cogsData?.items || []}
                  keyExtractor={(item, idx) => item.item_code || idx}
                  loading={loading}
                  emptyMessage="No COGS data for this period."
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    { key: 'item_code', header: 'Code', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                    { key: 'item_name', header: 'Item', sortable: true },
                    { key: 'quantity_used', header: 'Qty Used', sortable: true, render: (v) => v || 0 },
                    { key: 'quantity_wasted', header: 'Qty Wasted', sortable: true, render: (v) => <span className="text-destructive">{v || 0}</span> },
                    { key: '__total_cost', header: 'Total Cost', render: (_v, item) => <span className="font-mono font-medium">{fmt(item.total_cost_base ?? item.total_cost)}</span> },
                    {
                      key: '__pct', header: '% of COGS',
                      render: (_v, item) => cogsData?.total_cogs > 0 ? `${((parseFloat(item.total_cost_base ?? item.total_cost) / cogsData.total_cogs) * 100).toFixed(1)}%` : '—',
                    },
                  ]}
                />
                {(cogsData?.items || []).length > 0 && (
                  <div className="border border-t-0 border-border rounded-b-md bg-muted/20 -mt-px px-3 py-2 flex justify-between text-sm font-semibold">
                    <span>Total:</span>
                    <span className="font-mono">
                      {cogsData.items.reduce((s: number, i: any) => s + (parseInt(i.quantity_used) || 0), 0)} used ·{' '}
                      <span className="text-destructive">{cogsData.items.reduce((s: number, i: any) => s + (parseInt(i.quantity_wasted) || 0), 0)} wasted</span> ·{' '}
                      {fmt(cogsData.total_cogs)}
                    </span>
                  </div>
                )}
            </div>
          </div>
        )}
      </div>
      </div>
    </AppLayout>
  );
}
