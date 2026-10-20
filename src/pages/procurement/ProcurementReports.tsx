import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { StatusBadge, type StatusBadgeTone } from '@/components/common/StatusBadge';
import { toast } from 'sonner';
import { getDatePresets, exportCSV, triggerPrint } from '@/utils/reportUtils';
import * as docTemplate from '@/utils/documentTemplate';
import {
  RefreshCw, TrendingUp, DollarSign, Building2,
  Truck, FileText, Download, Printer, Calendar,
  ShoppingCart, ClipboardCheck, PackageCheck, Filter as FilterIcon, Stethoscope,
} from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

type ReportTab = 'purchase' | 'delivery' | 'orders' | 'requisitions' | 'receipts' | 'consultant-bills';

interface CurrencyOption { code: string; symbol: string; name: string; }
interface UserOption { id: number; display_name: string; }

const poStatusMap: Record<string, StatusBadgeTone> = {
  draft: 'neutral', check: 'info', approved: 'primary', authorized: 'warning', received: 'success', cancelled: 'danger',
};
const prStatusMap: Record<string, StatusBadgeTone> = {
  draft: 'neutral', submitted: 'info', approved: 'success', rejected: 'danger', cancelled: 'neutral',
};
const grnStatusMap: Record<string, StatusBadgeTone> = {
  pending_inspection: 'warning', inspected: 'info', accepted: 'success', rejected: 'danger', partial: 'warning',
};

const ProcurementReports: React.FC = () => {
  const { user } = useAuth();
  const { fmt: formatCurrency } = useCurrency();
  const facilityInfo = useFacilityInfo();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ReportTab>('purchase');
  const datePresets = getDatePresets();
  const thisMonth = datePresets.find(p => p.label === 'This Month')!;

  // ── Purchase Summary tab (existing) ──────────────────────────────
  const [purchaseSummary, setPurchaseSummary] = useState<any>(null);
  const [deliveryPerformance, setDeliveryPerformance] = useState<any[]>([]);

  // ── New reports: shared filter bar (date + currency + user + supplier) ─────
  const [newFilters, setNewFilters] = useState({
    start_date: thisMonth.from, end_date: thisMonth.to, currency: 'all', user_id: 'all', supplier_id: 'all'
  });
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [poReport, setPoReport] = useState<any[]>([]);
  const [prReport, setPrReport] = useState<any[]>([]);
  const [grnReport, setGrnReport] = useState<any[]>([]);
  const [consultantBillsReport, setConsultantBillsReport] = useState<any[]>([]);

  const fmtAmt = (amount: any, currencyCode?: string) => {
    const n = parseFloat(String(amount || 0));
    const label = currencyCode || '';
    return `${label ? label + ' ' : ''}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
  };

  // ── Fetchers: existing ────────────────────────────────────────────
  const fetchPurchaseSummary = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/procurement/reports/purchase-summary?${buildNewReportQuery()}`);
      if (res.ok) setPurchaseSummary(await res.json());
      else toast.error('Failed to load purchase summary');
    } catch (error) {
      console.error('Error fetching purchase summary:', error);
      toast.error('Failed to load purchase summary');
    } finally { setLoading(false); }
  };

  const fetchDeliveryPerformance = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/procurement/reports/delivery-performance?clinic_id=${user?.clinic || ''}`);
      if (res.ok) setDeliveryPerformance(await res.json());
      else toast.error('Failed to load delivery performance');
    } catch (error) {
      console.error('Error fetching delivery performance:', error);
      toast.error('Failed to load delivery performance');
    } finally { setLoading(false); }
  };

  // ── Fetchers: new reports ─────────────────────────────────────────
  const buildNewReportQuery = () => {
    const params = new URLSearchParams();
    if (user?.clinic) params.set('clinic_id', String(user.clinic));
    params.set('start_date', newFilters.start_date);
    params.set('end_date', newFilters.end_date);
    if (newFilters.currency !== 'all') params.set('currency', newFilters.currency);
    if (newFilters.user_id !== 'all') params.set('user_id', newFilters.user_id);
    if (newFilters.supplier_id !== 'all') params.set('supplier_id', newFilters.supplier_id);
    return params.toString();
  };

  const fetchPurchaseOrdersReport = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/procurement/reports/purchase-orders?${buildNewReportQuery()}`);
      if (res.ok) setPoReport(await res.json());
      else toast.error('Failed to load purchase orders report');
    } catch (error) {
      console.error('Error fetching purchase orders report:', error);
      toast.error('Failed to load purchase orders report');
    } finally { setLoading(false); }
  };

  const fetchPurchaseRequisitionsReport = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/procurement/reports/purchase-requisitions?${buildNewReportQuery()}`);
      if (res.ok) setPrReport(await res.json());
      else toast.error('Failed to load purchase requisitions report');
    } catch (error) {
      console.error('Error fetching purchase requisitions report:', error);
      toast.error('Failed to load purchase requisitions report');
    } finally { setLoading(false); }
  };

  const fetchGoodsReceiptsReport = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/procurement/reports/goods-receipts?${buildNewReportQuery()}`);
      if (res.ok) setGrnReport(await res.json());
      else toast.error('Failed to load goods receipts report');
    } catch (error) {
      console.error('Error fetching goods receipts report:', error);
      toast.error('Failed to load goods receipts report');
    } finally { setLoading(false); }
  };

  const fetchConsultantBillsReport = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/daily-expenses/consultant-bills?clinic_id=${user?.clinic || 1}`);
      if (res.ok) setConsultantBillsReport(await res.json());
      else toast.error('Failed to load consultant bills report');
    } catch (error) {
      toast.error('Failed to load consultant bills report');
    } finally { setLoading(false); }
  };

  const fetchForTab = (tab: ReportTab) => {
    if (tab === 'purchase') fetchPurchaseSummary();
    else if (tab === 'delivery') fetchDeliveryPerformance();
    else if (tab === 'orders') fetchPurchaseOrdersReport();
    else if (tab === 'requisitions') fetchPurchaseRequisitionsReport();
    else if (tab === 'receipts') fetchGoodsReceiptsReport();
    else if (tab === 'consultant-bills') fetchConsultantBillsReport();
  };

  // Load currency, user, & supplier dropdown data once (not part of the "Apply" gate).
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/currencies');
        if (res.ok) setCurrencies(await res.json());
      } catch { /* dropdown stays empty, "All Currencies" still works */ }
      try {
        const res = await authFetch('/api/users?all=true');
        if (res.ok) setUsers(await res.json());
      } catch { /* dropdown stays empty, "All Users" still works */ }
      try {
        const res = await authFetch('/api/procurement/suppliers');
        if (res.ok) setSuppliers(await res.json());
      } catch { /* dropdown stays empty */ }
    })();
  }, []);

  // Only refetch when the active tab changes — not on every filter keystroke.
  useEffect(() => {
    fetchForTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleRefresh = () => fetchForTab(activeTab);
  const handleApplyNewFilters = () => fetchForTab(activeTab);


  const handleNewPreset = (label: string) => {
    const p = datePresets.find(x => x.label === label);
    if (!p) return;
    setNewFilters({ ...newFilters, start_date: p.from, end_date: p.to });
  };

  const selectedUserName = newFilters.user_id === 'all'
    ? 'All Users'
    : (users.find(u => String(u.id) === newFilters.user_id)?.display_name || newFilters.user_id);
  const selectedSupplierName = newFilters.supplier_id === 'all'
    ? 'All Suppliers'
    : (suppliers.find(s => String(s.id) === newFilters.supplier_id)?.name || newFilters.supplier_id);
  const selectedCurrencyLabel = newFilters.currency === 'all' ? 'All Currencies' : newFilters.currency;

  // ── CSV export ─────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (activeTab === 'purchase') {
      const rows = purchaseSummary?.bySupplier || [];
      if (!rows.length) { toast.error('No data to export'); return; }
      exportCSV(rows, [
        { header: 'Supplier', key: 'supplier_name' },
        { header: 'Supplier Code', key: 'supplier_code' },
        { header: 'Currency', key: 'currency' },
        { header: 'Orders', key: 'order_count' },
        { header: 'Total', key: 'total_amount', transform: (v) => parseFloat(v || 0).toFixed(2) },
        { header: 'Avg Order Value', key: 'avg_order_value', transform: (v) => parseFloat(v || 0).toFixed(2) },
      ], `purchase-summary-${newFilters.start_date}_to_${newFilters.end_date}.csv`);
    } else if (activeTab === 'delivery') {
      if (!deliveryPerformance.length) { toast.error('No data to export'); return; }
      exportCSV(deliveryPerformance, [
        { header: 'Supplier', key: 'supplier_name' },
        { header: 'Total Orders', key: 'total_orders' },
        { header: 'On Time', key: 'on_time' },
        { header: 'Late', key: 'late' },
        { header: 'Pending', key: 'pending' },
        { header: 'Avg Days', key: 'avg_delivery_days', transform: (v) => v ? parseFloat(v).toFixed(1) : '' },
      ], `delivery-performance-${new Date().toISOString().split('T')[0]}.csv`);
    } else if (activeTab === 'orders') {
      if (!poReport.length) { toast.error('No data to export'); return; }
      // One row per line item (PO summary fields repeated) rather than one row per PO,
      // so every item in every PO is represented, not collapsed into a single total.
      const itemRows = poReport.flatMap((po: any) => {
        const items = po.items?.length ? po.items : [{ item_name: '', quantity: '', unit_price: '', total_price: po.total_amount }];
        return items.map((item: any) => ({ ...po, ...item, po_total_amount: po.total_amount }));
      });
      exportCSV(itemRows, [
        { header: 'PO Number', key: 'po_number' },
        { header: 'Supplier', key: 'supplier_name' },
        { header: 'Order Date', key: 'order_date', transform: (v) => v ? new Date(v).toLocaleDateString() : '' },
        { header: 'Status', key: 'status' },
        { header: 'Currency', key: 'po_currency' },
        { header: 'Item', key: 'item_name' },
        { header: 'Qty', key: 'quantity' },
        { header: 'Unit Price', key: 'unit_price', transform: (v) => v !== '' && v != null ? parseFloat(v || 0).toFixed(2) : '' },
        { header: 'Line Total', key: 'total_price', transform: (v) => v !== '' && v != null ? parseFloat(v || 0).toFixed(2) : '' },
        { header: 'PO Total Amount', key: 'po_total_amount', transform: (v) => parseFloat(v || 0).toFixed(2) },
        { header: 'Created By', key: 'created_by_name' },
      ], `purchase-orders-${newFilters.start_date}_to_${newFilters.end_date}.csv`);
    } else if (activeTab === 'requisitions') {
      if (!prReport.length) { toast.error('No data to export'); return; }
      exportCSV(prReport, [
        { header: 'PR Number', key: 'pr_number' },
        { header: 'Department', key: 'department' },
        { header: 'Requested By', key: 'created_by_name' },
        { header: 'Date', key: 'requisition_date', transform: (v) => v ? new Date(v).toLocaleDateString() : '' },
        { header: 'Status', key: 'status' },
        { header: 'Currency', key: 'currency' },
        { header: 'Total Estimated Amount', key: 'total_amount', transform: (v) => parseFloat(v || 0).toFixed(2) },
        { header: 'Approved By', key: 'approved_by_name', transform: (v) => v || '' },
      ], `purchase-requisitions-${newFilters.start_date}_to_${newFilters.end_date}.csv`);
    } else if (activeTab === 'receipts') {
      if (!grnReport.length) { toast.error('No data to export'); return; }
      exportCSV(grnReport, [
        { header: 'GRN Number', key: 'grn_number' },
        { header: 'Linked PO', key: 'po_number' },
        { header: 'Supplier', key: 'supplier_name' },
        { header: 'Receipt Date', key: 'receipt_date', transform: (v) => v ? new Date(v).toLocaleDateString() : '' },
        { header: 'Status', key: 'status' },
        { header: 'Received By', key: 'received_by_name' },
        { header: 'Inspected By', key: 'inspected_by_name', transform: (v) => v || '' },
      ], `goods-receipts-${newFilters.start_date}_to_${newFilters.end_date}.csv`);
    } else if (activeTab === 'consultant-bills') {
      if (!consultantBillsReport.length) { toast.error('No data to export'); return; }
      exportCSV(consultantBillsReport, [
        { header: 'Bill No.', key: 'bill_number' },
        { header: 'Consultant', key: 'first_name', transform: (_v, row) => `${row.first_name} ${row.last_name}` },
        { header: 'Period From', key: 'period_from', transform: (v) => v ? new Date(v).toLocaleDateString() : '' },
        { header: 'Period To', key: 'period_to', transform: (v) => v ? new Date(v).toLocaleDateString() : '' },
        { header: 'Revenue Collected', key: 'total_consultation_revenue', transform: (v) => parseFloat(v || 0).toFixed(2) },
        { header: 'Fee %', key: 'fee_percentage' },
        { header: 'Currency', key: 'currency' },
        { header: 'Bill Amount', key: 'bill_amount', transform: (v) => parseFloat(v || 0).toFixed(2) },
        { header: 'Status', key: 'status' },
      ], `consultant-bills-${new Date().toISOString().split('T')[0]}.csv`);
    }
  };

  // ── PDF export (shared documentTemplate helpers) ────────────────────
  const buildFilterSummaryBox = (): docTemplate.InfoBox => ({
    title: 'Report Filters',
    rows: [
      { label: 'Period', value: `${newFilters.start_date} to ${newFilters.end_date}`, bold: true },
      { label: 'Currency', value: selectedCurrencyLabel },
      { label: 'User', value: selectedUserName },
      { label: 'Supplier', value: selectedSupplierName },
    ],
  });

  const generateReportPDF = () => {
    let title = '';
    let bodyHTML = '';

    if (activeTab === 'orders') {
      if (!poReport.length) { toast.error('No data to export'); return; }
      title = 'Purchase Order Report';
      const currenciesUsed = new Set(poReport.map((r) => r.po_currency));
      const totalLabel = currenciesUsed.size === 1
        ? docTemplate.formatCurrency(poReport.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0), poReport[0].po_currency)
        : '(mixed currencies)';
      bodyHTML = [
        docTemplate.buildInfoGrid(buildFilterSummaryBox(), { title: 'Summary', rows: [
          { label: 'Total Orders', value: poReport.length, bold: true },
          { label: 'Total Amount', value: totalLabel },
        ]}),
        `<div class="ic-section-title">Purchase Orders — full line-item detail</div>`,
        docTemplate.buildTable(
          [
            { label: 'PO Number' }, { label: 'Supplier' }, { label: 'Item' },
            { label: 'Qty', align: 'center' }, { label: 'Unit Price', align: 'right' },
            { label: 'Line Total', align: 'right' }, { label: 'Status' },
          ],
          poReport.flatMap((r) => {
            const header = {
              cells: [
                `${r.po_number} (${docTemplate.formatDate(r.order_date)})`, r.supplier_name || '-', '',
                '', '', docTemplate.formatCurrency(r.total_amount, r.po_currency), r.status,
              ],
              bold: true,
            };
            const itemRows = (r.items?.length ? r.items : []).map((item: any) => ({
              cells: [
                '', '', item.item_name,
                `${item.quantity} ${item.unit_of_measure || ''}`.trim(),
                docTemplate.formatCurrency(item.unit_price, r.po_currency),
                docTemplate.formatCurrency(item.total_price, r.po_currency),
                '',
              ],
            }));
            return [header, ...itemRows];
          }),
        ),
      ].join('\n');
    } else if (activeTab === 'requisitions') {
      if (!prReport.length) { toast.error('No data to export'); return; }
      title = 'Purchase Requisition Report';
      const currenciesUsed = new Set(prReport.map((r) => r.currency));
      const totalLabel = currenciesUsed.size === 1
        ? docTemplate.formatCurrency(prReport.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0), prReport[0].currency)
        : '(mixed currencies)';
      bodyHTML = [
        docTemplate.buildInfoGrid(buildFilterSummaryBox(), { title: 'Summary', rows: [
          { label: 'Total Requisitions', value: prReport.length, bold: true },
          { label: 'Total Estimated Amount', value: totalLabel },
        ]}),
        `<div class="ic-section-title">Purchase Requisitions</div>`,
        docTemplate.buildTable(
          [
            { label: 'PR Number' }, { label: 'Department' }, { label: 'Requested By' },
            { label: 'Date' }, { label: 'Status' }, { label: 'Currency', align: 'center' },
            { label: 'Total Est. Amount', align: 'right' }, { label: 'Approved By' },
          ],
          prReport.map((r) => ({
            cells: [
              r.pr_number, r.department || '-', r.created_by_name || '-',
              docTemplate.formatDate(r.requisition_date), r.status, r.currency || '-',
              docTemplate.formatCurrency(r.total_amount, r.currency), r.approved_by_name || '-',
            ],
          })),
        ),
      ].join('\n');
    } else if (activeTab === 'receipts') {
      if (!grnReport.length) { toast.error('No data to export'); return; }
      title = 'Goods Receipt Report';
      bodyHTML = [
        docTemplate.buildInfoGrid(buildFilterSummaryBox(), { title: 'Summary', rows: [
          { label: 'Total GRNs', value: grnReport.length, bold: true },
        ]}),
        `<div class="ic-section-title">Goods Receipt Notes</div>`,
        docTemplate.buildTable(
          [
            { label: 'GRN Number' }, { label: 'Linked PO' }, { label: 'Supplier' },
            { label: 'Receipt Date' }, { label: 'Status' }, { label: 'Received By' }, { label: 'Inspected By' },
          ],
          grnReport.map((r) => ({
            cells: [
              r.grn_number, r.po_number || '-', r.supplier_name || '-',
              docTemplate.formatDate(r.receipt_date), r.status, r.received_by_name || '-', r.inspected_by_name || '-',
            ],
          })),
        ),
      ].join('\n');
    } else {
      toast.error('PDF export is only available for the Purchase Orders, Requisitions and Goods Receipts reports');
      return;
    }

    const html = docTemplate.buildDocument({
      title,
      docType: title,
      date: new Date(),
      bodyHTML,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });

    const pw = docTemplate.openPrintWindow(html);
    if (pw) toast.success('PDF generated');
    else toast.error('Please allow popups');
  };

  // bySupplier/byStatus/monthlyTrend are each split by (…, currency) now, so a single
  // blended "total spend" would silently add SSP and USD amounts together. byCurrency
  // gives the honest per-currency totals for the headline tiles; order counts are
  // currency-agnostic so those can still be summed directly.
  const byCurrency: Array<{ currency: string; order_count: number; total_amount: number }> = purchaseSummary?.byCurrency || [];
  const totalOrders = byCurrency.reduce((s: number, r: any) => s + parseInt(r.order_count || 0), 0);
  const uniqueSupplierCount = new Set((purchaseSummary?.bySupplier || []).map((r: any) => r.supplier_code || r.supplier_name)).size;

  const thClass = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
  const thClassRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
  const thClassCenter = "px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground";

  const isNewReportTab = activeTab === 'orders' || activeTab === 'requisitions' || activeTab === 'receipts' || activeTab === 'purchase';

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          title="Procurement Reports"
          actions={
            <div className="print:hidden flex items-center gap-2">
              <Button onClick={handleExportCSV} variant="outline" size="sm" className="gap-1.5">
                <Download className="w-3.5 h-3.5" /> CSV
              </Button>
              {isNewReportTab && (
                <Button onClick={generateReportPDF} variant="outline" size="sm" className="gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </Button>
              )}
              <Button onClick={() => triggerPrint()} variant="outline" size="sm" className="gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Print
              </Button>
              <Button onClick={handleRefresh} variant="outline" size="icon" disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          }
        />
        {loading && <LoadingState message="Loading report data..." />}

        {/* Tabs */}
        <div className="print:hidden flex flex-wrap gap-2">
          <Button variant={activeTab === 'purchase' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('purchase')}>
            <DollarSign className="w-4 h-4 mr-1" /> Purchase Summary
          </Button>
          <Button variant={activeTab === 'delivery' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('delivery')}>
            <Truck className="w-4 h-4 mr-1" /> Delivery Performance
          </Button>
          <Button variant={activeTab === 'orders' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('orders')}>
            <ShoppingCart className="w-4 h-4 mr-1" /> Purchase Orders
          </Button>
          <Button variant={activeTab === 'requisitions' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('requisitions')}>
            <ClipboardCheck className="w-4 h-4 mr-1" /> Purchase Requisitions
          </Button>
          <Button variant={activeTab === 'receipts' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('receipts')}>
            <PackageCheck className="w-4 h-4 mr-1" /> Goods Receipts
          </Button>
          <Button variant={activeTab === 'consultant-bills' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('consultant-bills')}>
            <Stethoscope className="w-4 h-4 mr-1" /> Consultant Bills
          </Button>
        </div>

        {activeTab === 'purchase' && (
          <>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs text-muted-foreground">Total Spend</span>
                  </div>
                  {byCurrency.length === 0 ? (
                    <p className="text-lg font-bold font-mono leading-tight text-muted-foreground">—</p>
                  ) : (
                    <div className="space-y-0.5">
                      {/* Was hardcoded to always show SSP then USD (even as 0.00) with
                          every other currency buried below as "others" — a tenant whose
                          real spend is in a third currency (UGX, KES, whatever they're
                          actually configured for) saw two irrelevant zero lines before
                          their own total. Purely data-driven now: whatever currencies
                          purchase orders actually exist in, largest first. */}
                      {[...byCurrency].sort((a, b) => b.total_amount - a.total_amount).map(c => (
                        <p key={c.currency} className="text-lg font-bold font-mono leading-tight">{fmtAmt(c.total_amount, c.currency)}</p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Total Orders</span>
                  </div>
                  <p className="text-2xl font-bold">{totalOrders}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className="w-4 h-4 text-purple-500" />
                    <span className="text-xs text-muted-foreground">Unique Suppliers</span>
                  </div>
                  <p className="text-2xl font-bold">{uniqueSupplierCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-amber-500" />
                    <span className="text-xs text-muted-foreground">Avg Order Value</span>
                  </div>
                  {byCurrency.length > 0 ? (
                    <div className="space-y-0.5">
                      {byCurrency.map((c) => (
                        <p key={c.currency} className="text-lg font-bold font-mono leading-tight">
                          {fmtAmt(c.order_count > 0 ? c.total_amount / c.order_count : 0, c.currency)}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-2xl font-bold font-mono">{fmtAmt(0)}</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By Supplier */}
              <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b">
                  <h3 className="font-semibold text-sm">Spend by Supplier</h3>
                </div>
                <AdvancedDataTable<any>
                  data={purchaseSummary?.bySupplier || []}
                  keyExtractor={(row, i) => i}
                  emptyMessage="No data for this period"
                  columns={[
                    {
                      key: 'supplier_name', header: 'Supplier',
                      render: (v, row) => (
                        <>
                          <p className="font-medium">{v}</p>
                          <p className="text-xs text-muted-foreground font-mono">{row.supplier_code || '—'}</p>
                        </>
                      ),
                    },
                    { key: 'currency', header: 'Currency', render: (v) => <span className="text-xs text-muted-foreground">{v}</span> },
                    { key: 'order_count', header: 'Orders', align: 'center' },
                    { key: 'total_amount', header: 'Total', align: 'right', render: (v, row) => <span className="font-mono">{fmtAmt(v, row.currency)}</span> },
                    { key: 'avg_order_value', header: 'Avg', align: 'right', render: (v, row) => <span className="font-mono text-muted-foreground">{fmtAmt(v, row.currency)}</span> },
                  ]}
                />
              </div>

              {/* By Status */}
              <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b">
                  <h3 className="font-semibold text-sm">Orders by Status</h3>
                </div>
                <div className="p-4 space-y-3">
                  {(() => {
                    // byStatus rows are split by (status, currency) — regroup by status so
                    // the count/percentage bar reflects the true total (counts are
                    // currency-agnostic), while the $ line below stays split per currency.
                    const grouped = new Map<string, { count: number; byCurrency: Record<string, number> }>();
                    for (const row of (purchaseSummary?.byStatus || [])) {
                      const g = grouped.get(row.status) || { count: 0, byCurrency: {} };
                      g.count += parseInt(row.count || 0);
                      g.byCurrency[row.currency] = (g.byCurrency[row.currency] || 0) + parseFloat(row.total_amount || 0);
                      grouped.set(row.status, g);
                    }
                    const entries = Array.from(grouped.entries());
                    if (entries.length === 0) return <p className="text-center text-muted-foreground py-8">No data</p>;
                    return entries.map(([status, g]) => {
                      const pct = totalOrders > 0 ? (g.count / totalOrders) * 100 : 0;
                      return (
                        <div key={status}>
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="outline" className="capitalize text-xs">{status}</Badge>
                            <span className="text-sm font-mono">{g.count} ({pct.toFixed(0)}%)</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-xs text-muted-foreground text-right mt-0.5">
                            {Object.entries(g.byCurrency).map(([cur, amt]) => fmtAmt(amt, cur)).join(' · ')}
                          </p>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

            {/* Monthly Trend */}
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b">
                <h3 className="font-semibold text-sm">Monthly Purchasing Trend</h3>
              </div>
              {(() => {
                // monthlyTrend rows are split by (month, currency) — regroup by month
                // so order counts and the visual bar (based on count, currency-agnostic)
                // are correct, while the $ amount stays broken out per currency.
                const grouped = new Map<string, { order_count: number; byCurrency: Record<string, number> }>();
                for (const row of (purchaseSummary?.monthlyTrend || [])) {
                  const g = grouped.get(row.month) || { order_count: 0, byCurrency: {} };
                  g.order_count += parseInt(row.order_count || 0);
                  g.byCurrency[row.currency] = (g.byCurrency[row.currency] || 0) + parseFloat(row.total_amount || 0);
                  grouped.set(row.month, g);
                }
                const entries = Array.from(grouped.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
                const maxCount = Math.max(...entries.map(([, g]) => g.order_count), 1);
                const trendRows = entries.map(([month, g]) => ({ month, ...g }));
                return (
                  <AdvancedDataTable<any>
                    data={trendRows}
                    keyExtractor={(row) => row.month}
                    emptyMessage="No data"
                    columns={[
                      { key: 'month', header: 'Month', render: (v) => <span className="font-medium">{v}</span> },
                      { key: 'order_count', header: 'Orders', align: 'center' },
                      {
                        key: '__amount', header: 'Amount',
                        render: (_v, row) => <span className="font-mono">{Object.entries(row.byCurrency).map(([cur, amt]) => fmtAmt(amt as number, cur)).join(' · ')}</span>,
                      },
                      {
                        key: '__visual', header: 'Visual', width: '200px',
                        render: (_v, row) => (
                          <div className="w-full bg-muted rounded-full h-2">
                            <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${maxCount > 0 ? (row.order_count / maxCount) * 100 : 0}%` }} />
                          </div>
                        ),
                      },
                    ]}
                  />
                );
              })()}
            </div>
          </>
        )}

        {activeTab === 'delivery' && (
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">Supplier Delivery Performance</h3>
            </div>
            <AdvancedDataTable<any>
              data={deliveryPerformance}
              keyExtractor={(row, i) => i}
              emptyMessage="No delivery data available"
              columns={[
                { key: 'supplier_name', header: 'Supplier', render: (v) => <span className="font-medium">{v}</span> },
                { key: 'total_orders', header: 'Total Orders', align: 'center' },
                { key: 'on_time', header: 'On Time', align: 'center', render: (v) => <Badge className="bg-emerald-100 text-emerald-700 text-xs">{v || 0}</Badge> },
                { key: 'late', header: 'Late', align: 'center', render: (v) => <Badge className="bg-red-100 text-red-700 text-xs">{v || 0}</Badge> },
                { key: 'pending', header: 'Pending', align: 'center', render: (v) => <Badge className="bg-muted text-muted-foreground text-xs">{v || 0}</Badge> },
                { key: 'avg_delivery_days', header: 'Avg Days', align: 'center', render: (v) => <span className="font-mono">{v ? parseFloat(v).toFixed(1) : '—'}</span> },
                {
                  key: '__ontime_pct', header: 'On-Time %', align: 'center',
                  render: (_v, row) => {
                    const delivered = (parseInt(row.on_time) || 0) + (parseInt(row.late) || 0);
                    const onTimePct = delivered > 0 ? ((parseInt(row.on_time) || 0) / delivered * 100) : 0;
                    return (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 bg-muted rounded-full h-2">
                          <div className={`h-2 rounded-full ${onTimePct >= 80 ? 'bg-emerald-500' : onTimePct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${onTimePct}%` }} />
                        </div>
                        <span className="text-xs font-medium">{onTimePct.toFixed(0)}%</span>
                      </div>
                    );
                  },
                },
              ]}
            />
          </div>
        )}

        {isNewReportTab && (
          <>
            {/* Shared Filter Bar: date range + currency + user, explicit Apply */}
            <div className="print:hidden bg-card rounded-lg border shadow-sm p-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label className="text-xs">Start Date</Label>
                  <Input type="date" value={newFilters.start_date} onChange={e => setNewFilters({ ...newFilters, start_date: e.target.value })} className="w-[160px]" />
                </div>
                <div>
                  <Label className="text-xs">End Date</Label>
                  <Input type="date" value={newFilters.end_date} onChange={e => setNewFilters({ ...newFilters, end_date: e.target.value })} className="w-[160px]" />
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1"><Calendar className="w-3 h-3" /> Quick Range</Label>
                  <Combobox
                    options={datePresets.map(p => ({ value: p.label, label: p.label }))}
                    value=""
                    onChange={handleNewPreset}
                    placeholder="Select range"
                    searchPlaceholder="Search..."
                    className="w-[150px]"
                  />
                </div>
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Combobox
                    options={[{ value: 'all', label: 'All Currencies' }, ...currencies.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }))]}
                    value={newFilters.currency}
                    onChange={(v) => setNewFilters({ ...newFilters, currency: v })}
                    placeholder="All Currencies"
                    searchPlaceholder="Search..."
                    className="w-[160px]"
                  />
                </div>
                <div>
                  <Label className="text-xs">User</Label>
                  <Combobox
                    options={[{ value: 'all', label: 'All Users' }, ...users.map(u => ({ value: String(u.id), label: u.display_name }))]}
                    value={newFilters.user_id}
                    onChange={(v) => setNewFilters({ ...newFilters, user_id: v })}
                    placeholder="All Users"
                    searchPlaceholder="Search..."
                    className="w-[180px]"
                  />
                </div>
                <div>
                  <Label className="text-xs">Supplier</Label>
                  <Combobox
                    options={[{ value: 'all', label: 'All Suppliers' }, ...suppliers.map(s => ({ value: String(s.id), label: s.name }))]}
                    value={newFilters.supplier_id}
                    onChange={(v) => setNewFilters({ ...newFilters, supplier_id: v })}
                    placeholder="All Suppliers"
                    searchPlaceholder="Search..."
                    className="w-[180px]"
                  />
                </div>
                <Button onClick={handleApplyNewFilters} size="sm" disabled={loading} className="gap-1.5">
                  <FilterIcon className="w-3.5 h-3.5" /> Apply
                </Button>
              </div>
            </div>

            {/* Print header */}
            <div className="hidden print:block mb-2">
              <h1 className="text-xl font-bold">
                {activeTab === 'purchase' ? 'Purchase Summary Report' : activeTab === 'orders' ? 'Purchase Order Report' : activeTab === 'requisitions' ? 'Purchase Requisition Report' : 'Goods Receipt Report'}
              </h1>
              <p className="text-xs text-gray-500">
                Period: {newFilters.start_date} — {newFilters.end_date} | Currency: {selectedCurrencyLabel} | User: {selectedUserName} | Supplier: {selectedSupplierName} | Printed: {new Date().toLocaleString()}
              </p>
            </div>
          </>
        )}

        {activeTab === 'orders' && (
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">Purchase Orders</h3>
              <p className="text-xs text-muted-foreground">{poReport.length} order{poReport.length === 1 ? '' : 's'} in range · every line item shown under its PO</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted sticky top-0">
                    <th className={thClass}>PO / Item</th>
                    <th className={thClass}>Supplier / Description</th>
                    <th className={thClassCenter}>Qty</th>
                    <th className={thClassRight}>Unit Price</th>
                    <th className={thClassRight}>Line Total</th>
                    <th className={thClass}>Date / Status</th>
                    <th className={thClass}>Created By</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {poReport.map((row: any) => (
                    <React.Fragment key={row.id}>
                      <tr className="bg-muted/20 font-semibold">
                        <td className="px-3 py-2 font-mono">{row.po_number}</td>
                        <td className="px-3 py-2">{row.supplier_name || '—'}</td>
                        <td className="px-3 py-2 text-center text-muted-foreground" colSpan={2}>
                          {row.items?.length || 0} item{row.items?.length === 1 ? '' : 's'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{fmtAmt(row.total_amount, row.po_currency)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {row.order_date ? new Date(row.order_date).toLocaleDateString() : '—'}
                            <StatusBadge status={row.status} map={poStatusMap} className="capitalize" />
                          </div>
                        </td>
                        <td className="px-3 py-2">{row.created_by_name || '—'}</td>
                      </tr>
                      {(row.items || []).map((item: any, i: number) => (
                        <tr key={item.id ?? i} className="hover:bg-muted/30">
                          <td className="px-3 py-2 pl-8 text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {item.item_name}
                            {item.description && <span className="block text-xs">{item.description}</span>}
                          </td>
                          <td className="px-3 py-2 text-center font-mono">{item.quantity} {item.unit_of_measure || ''}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmtAmt(item.unit_price, row.po_currency)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmtAmt(item.total_price, row.po_currency)}</td>
                          <td className="px-3 py-2" colSpan={2}></td>
                        </tr>
                      ))}
                      {(!row.items || row.items.length === 0) && (
                        <tr>
                          <td className="px-3 py-2 pl-8 text-muted-foreground italic" colSpan={7}>No line items</td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {poReport.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      No purchase orders for the selected filters
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'requisitions' && (
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">Purchase Requisitions</h3>
              <p className="text-xs text-muted-foreground">{prReport.length} requisition{prReport.length === 1 ? '' : 's'} in range</p>
            </div>
            <AdvancedDataTable<any>
              data={prReport}
              keyExtractor={(row) => row.id}
              emptyMessage="No purchase requisitions for the selected filters"
              columns={[
                { key: 'pr_number', header: 'PR Number', render: (v) => <span className="font-medium font-mono">{v}</span> },
                {
                  key: 'department', header: 'Department / Requester',
                  render: (v, row) => (
                    <>
                      <p>{v || '—'}</p>
                      <p className="text-xs text-muted-foreground">{row.created_by_name || '—'}</p>
                    </>
                  ),
                },
                { key: 'requisition_date', header: 'Date', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
                { key: 'status', header: 'Status', align: 'center', render: (v) => <StatusBadge status={v} map={prStatusMap} className="capitalize" /> },
                { key: 'currency', header: 'Currency', align: 'center', render: (v) => <span className="font-mono">{v || '—'}</span> },
                { key: 'total_amount', header: 'Total Est. Amount', align: 'right', render: (v, row) => <span className="font-mono">{fmtAmt(v, row.currency)}</span> },
                { key: 'approved_by_name', header: 'Approved By', render: (v) => v || '—' },
              ]}
            />
          </div>
        )}

        {activeTab === 'receipts' && (
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">Goods Receipt Notes</h3>
              <p className="text-xs text-muted-foreground">{grnReport.length} receipt{grnReport.length === 1 ? '' : 's'} in range</p>
            </div>
            <AdvancedDataTable<any>
              data={grnReport}
              keyExtractor={(row) => row.id}
              emptyMessage="No goods receipts for the selected filters"
              columns={[
                { key: 'grn_number', header: 'GRN Number', render: (v) => <span className="font-medium font-mono">{v}</span> },
                { key: 'po_number', header: 'Linked PO', render: (v) => <span className="font-mono text-muted-foreground">{v || '—'}</span> },
                { key: 'supplier_name', header: 'Supplier', render: (v) => v || '—' },
                { key: 'receipt_date', header: 'Receipt Date', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
                { key: 'status', header: 'Status', align: 'center', render: (v) => <StatusBadge status={v} map={grnStatusMap} className="capitalize" /> },
                { key: 'received_by_name', header: 'Received By', render: (v) => v || '—' },
                { key: 'inspected_by_name', header: 'Inspected By', render: (v) => v || '—' },
              ]}
            />
          </div>
        )}

        {activeTab === 'consultant-bills' && (
          <>
            {(() => {
              const byCurrency: Record<string, { billed: number; paid: number; outstanding: number }> = {};
              for (const b of consultantBillsReport) {
                const cur = b.currency || 'USD';
                if (!byCurrency[cur]) byCurrency[cur] = { billed: 0, paid: 0, outstanding: 0 };
                const amt = parseFloat(b.bill_amount || 0);
                byCurrency[cur].billed += amt;
                if (b.status === 'paid') byCurrency[cur].paid += amt; else byCurrency[cur].outstanding += amt;
              }
              const rows = Object.entries(byCurrency);
              return rows.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {rows.map(([cur, t]) => (
                    <div key={cur} className="flex-1 min-w-[280px] bg-card rounded-lg border shadow-sm p-4">
                      <p className="text-sm font-bold mb-2">{cur}</p>
                      <div className="grid grid-cols-3 gap-3">
                        <div><p className="text-xs text-muted-foreground mb-0.5">Total Billed</p><p className="font-mono font-bold text-lg">{fmtAmt(t.billed)}</p></div>
                        <div><p className="text-xs text-muted-foreground mb-0.5">Paid</p><p className="font-mono font-bold text-lg text-emerald-700">{fmtAmt(t.paid)}</p></div>
                        <div><p className="text-xs text-muted-foreground mb-0.5">Outstanding</p><p className="font-mono font-bold text-lg text-amber-700">{fmtAmt(t.outstanding)}</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null;
            })()}
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b">
                <h3 className="font-semibold text-sm">Consultant Bills</h3>
                <p className="text-xs text-muted-foreground">{consultantBillsReport.length} bill{consultantBillsReport.length === 1 ? '' : 's'} — a percentage of consultation revenue billed to each consultant, paid from Procurement &gt; Expenses</p>
              </div>
              <AdvancedDataTable<any>
                data={consultantBillsReport}
                keyExtractor={(row) => row.id}
                emptyMessage="No consultant bills yet"
                columns={[
                  { key: 'bill_number', header: 'Bill No.', render: (v) => <span className="font-medium font-mono">{v}</span> },
                  { key: 'first_name', header: 'Consultant', render: (_v, row) => `${row.first_name} ${row.last_name}` },
                  { key: 'period_from', header: 'Period', render: (_v, row) => `${new Date(row.period_from).toLocaleDateString()} – ${new Date(row.period_to).toLocaleDateString()}` },
                  { key: 'total_consultation_revenue', header: 'Revenue', align: 'right', render: (v, row) => <span className="font-mono">{row.currency} {parseFloat(v || 0).toFixed(2)}</span> },
                  { key: 'fee_percentage', header: 'Fee %', align: 'center', render: (v) => `${v}%` },
                  { key: 'bill_amount', header: 'Bill Amount', align: 'right', render: (v, row) => <span className="font-mono font-bold">{row.currency} {parseFloat(v || 0).toFixed(2)}</span> },
                  { key: 'status', header: 'Status', align: 'center', render: (v) => <Badge variant={v === 'paid' ? 'outline' : 'secondary'} className="text-xs capitalize">{v}</Badge> },
                ]}
              />
            </div>
          </>
        )}
      </div>
      </div>
    </AppLayout>
  );
};

export default ProcurementReports;
