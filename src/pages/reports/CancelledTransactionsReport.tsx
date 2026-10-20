import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, RotateCcw, DollarSign, Loader2, ListX, UserCircle } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { ReportLetterhead } from './ReportLetterhead';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { StatusBadge, StatusBadgeTone } from '@/components/common';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { fmtCurrency, fmtCount, fmtDate, CsvColumn } from '@/utils/reportUtils';
import { toast } from '@/lib/notify';

// ── Types ────────────────────────────────────────────────────────────────

interface CancelledReceiptRow {
  id: string;
  receiptNumber: string;
  patientId: string;
  patientName: string;
  amount: number;
  paymentMethod: string;
  cashierId: number | null;
  cashierName: string;
  status: 'voided' | 'refunded';
  note: string | null;
  paymentDate: string;
  updatedAt: string;
}

interface VoidedLineItemRow {
  billId: string;
  billNumber: string;
  patientId: string;
  patientName: string;
  lineIndex: number;
  serviceName: string;
  amount: number;
  billDate: string;
  updatedBy: string | null;
  updatedAt: string;
}

interface ReportResponse {
  dateFrom: string;
  dateTo: string;
  cancelledReceipts: CancelledReceiptRow[];
  voidedLineItems: VoidedLineItemRow[];
  summary: {
    cancelledCount: number;
    cancelledValue: number;
    voidedReceiptCount: number;
    refundedReceiptCount: number;
    voidedLineItemCount: number;
    voidedLineItemValue: number;
  };
}

const RECEIPT_STATUS_TONE_MAP: Record<string, StatusBadgeTone> = {
  voided: 'neutral',
  refunded: 'warning',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  insurance: 'Insurance',
  check: 'Cheque',
  lease: 'Lease',
};

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// ── Component ────────────────────────────────────────────────────────────

export default function CancelledTransactionsReport() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;

  // Default to "Last 30 Days"
  const [dateFrom, setDateFrom] = useState(() => toLocalDateStr(new Date(Date.now() - 29 * 86400000)));
  const [dateTo, setDateTo] = useState(() => toLocalDateStr(new Date()));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: String(clinicId) });
      const res = await authFetch(`/api/reports-v2/cancelled-transactions?${params}`);
      if (!res.ok) throw new Error('Failed to load cancelled/refunded transactions report');
      setData(await res.json());
      setGeneratedAt(new Date());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load cancelled/refunded transactions report');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, clinicId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [selectedUser, setSelectedUser] = useState('all');
  useEffect(() => { setSelectedUser('all'); }, [dateFrom, dateTo]);

  const cancelledReceipts = data?.cancelledReceipts || [];
  const voidedLineItems = data?.voidedLineItems || [];
  const summary = data?.summary;

  // One "User" filter drives both sections — receipts key it by cashierName
  // (real per-transaction attribution), voided line items by updatedBy
  // (patient_bills has no updated-by user id column, only a free-text name).
  const userOptions = useMemo(() => {
    const names = new Set<string>();
    cancelledReceipts.forEach(r => { if (r.cashierName) names.add(r.cashierName); });
    voidedLineItems.forEach(v => { if (v.updatedBy) names.add(v.updatedBy); });
    return Array.from(names).sort();
  }, [cancelledReceipts, voidedLineItems]);

  const filteredReceipts = useMemo(
    () => selectedUser === 'all' ? cancelledReceipts : cancelledReceipts.filter(r => r.cashierName === selectedUser),
    [cancelledReceipts, selectedUser]
  );
  const filteredVoidedLineItems = useMemo(
    () => selectedUser === 'all' ? voidedLineItems : voidedLineItems.filter(v => v.updatedBy === selectedUser),
    [voidedLineItems, selectedUser]
  );

  // Backend summary covers the whole period; once a specific user is selected, derive
  // the tiles from just their filtered rows so the summary actually narrows too.
  const displaySummary = useMemo(() => {
    if (selectedUser === 'all') return summary;
    const receiptValue = filteredReceipts.reduce((s, r) => s + r.amount, 0);
    const lineValue = filteredVoidedLineItems.reduce((s, v) => s + v.amount, 0);
    return {
      cancelledCount: filteredReceipts.length,
      cancelledValue: receiptValue,
      voidedReceiptCount: filteredReceipts.filter(r => r.status === 'voided').length,
      refundedReceiptCount: filteredReceipts.filter(r => r.status === 'refunded').length,
      voidedLineItemCount: filteredVoidedLineItems.length,
      voidedLineItemValue: lineValue,
    };
  }, [summary, selectedUser, filteredReceipts, filteredVoidedLineItems]);

  const receiptCsvColumns: CsvColumn[] = [
    { header: 'Receipt Number', key: 'receiptNumber' },
    { header: 'Patient', key: 'patientName' },
    { header: 'Amount', key: 'amount', transform: v => fmtCurrency(v) },
    { header: 'Payment Method', key: 'paymentMethod', transform: v => METHOD_LABELS[v] || v },
    { header: 'Cashier', key: 'cashierName' },
    { header: 'Status', key: 'status' },
    { header: 'Note', key: 'note' },
    { header: 'Payment Date', key: 'paymentDate', transform: v => fmtDate(v) },
    { header: 'Status Changed', key: 'updatedAt', transform: v => fmtDate(v) },
  ];

  return (
    <ReportSubPageShell
      title="Cancelled / Refunded Transactions"
      description="Voided and refunded receipts, plus voided line items on active bills, for the selected period"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={filteredReceipts}
      csvColumns={receiptCsvColumns}
      csvFilename={`cancelled-refunded-transactions-${dateFrom}-${dateTo}.csv`}
    >
      <ReportLetterhead title="Cancelled / Refunded Transactions" dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} />
      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Stat tiles ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Cancelled / Refunded Count</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(displaySummary?.cancelledCount)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">in selected period</p>
                </div>
                <Ban className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Cancelled / Refunded Value</p>
                  <p className="text-2xl font-bold mt-1">{fmtCurrency(displaySummary?.cancelledValue)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">total across both statuses</p>
                </div>
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Voided Receipts</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(displaySummary?.voidedReceiptCount)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">payment records voided</p>
                </div>
                <Ban className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Refunded Receipts</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(displaySummary?.refundedReceiptCount)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">payments refunded to patient</p>
                </div>
                <RotateCcw className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>

          {/* ── Section 1: Cancelled / Refunded Receipts ── */}
          <div>
            <div className="mb-2">
              <h3 className="font-semibold text-sm">Cancelled / Refunded Receipts</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Payment receipts whose status was changed away from <span className="font-mono">active</span> ({fmtDate(dateFrom)} — {fmtDate(dateTo)})
              </p>
            </div>
            <AdvancedDataTable<CancelledReceiptRow>
              headerClassName="bg-info-bg dark:bg-info/40 border-b border-border"
              footerRow={(colSpan) => (
                <tr className="border-t-2 border-foreground/30 bg-info-bg dark:bg-info/20 font-semibold">
                  <td colSpan={colSpan} className="px-4 py-2.5 text-sm">
                    <div className="flex justify-between items-center">
                      <span>Total</span>
                      <span className="font-mono text-base border-b-2 border-double border-foreground pb-0.5">{fmtCurrency(displaySummary?.cancelledValue)}</span>
                    </div>
                  </td>
                </tr>
              )}
              data={filteredReceipts}
              keyExtractor={(r) => r.id}
              searchable
              searchPlaceholder="Search receipts..."
              emptyMessage="No cancelled or refunded transactions in this period."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              toolbarExtra={
                <div className="flex items-center gap-2 flex-wrap">
                  <UserCircle className="h-4 w-4 text-muted-foreground" />
                  <select
                    className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm"
                    value={selectedUser}
                    onChange={e => setSelectedUser(e.target.value)}
                  >
                    <option value="all">All users</option>
                    {userOptions.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
              }
              columns={[
                { key: 'receiptNumber', header: 'Receipt Number', sortable: true, render: (v) => <span className="font-mono">{v}</span> },
                { key: 'patientName', header: 'Patient', sortable: true },
                { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'paymentMethod', header: 'Payment Method', sortable: true, render: (v) => METHOD_LABELS[v] || v },
                { key: 'cashierName', header: 'Cashier', sortable: true, render: (v) => <span className="text-muted-foreground">{v}</span> },
                { key: 'status', header: 'Status', sortable: true, render: (v) => <StatusBadge status={v} map={RECEIPT_STATUS_TONE_MAP} className="capitalize" /> },
                { key: 'note', header: 'Note', render: (v) => <span className="text-muted-foreground max-w-[220px] truncate inline-block" title={v || undefined}>{v || '—'}</span> },
                { key: 'paymentDate', header: 'Date', sortable: true, render: (v) => <span className="text-muted-foreground">{fmtDate(v)}</span> },
              ]}
            />
          </div>

          {/* ── Section 2: Voided Line Items on Active Bills ── */}
          <div>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-1.5">
                  <ListX className="h-4 w-4 text-muted-foreground" />
                  Voided Line Items (Active Bills)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Individual service lines marked voided within otherwise-live bills — a different concept from a cancelled receipt above; the bill itself was not cancelled, only this line was removed from its total.
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-lg font-bold">{fmtCount(displaySummary?.voidedLineItemCount)}</p>
                <p className="text-xs text-muted-foreground">{fmtCurrency(displaySummary?.voidedLineItemValue)}</p>
              </div>
            </div>
            <AdvancedDataTable<VoidedLineItemRow>
              headerClassName="bg-info-bg dark:bg-info/40 border-b border-border"
              footerRow={(colSpan) => (
                <tr className="border-t-2 border-foreground/30 bg-info-bg dark:bg-info/20 font-semibold">
                  <td colSpan={colSpan} className="px-4 py-2.5 text-sm">
                    <div className="flex justify-between items-center">
                      <span>Total</span>
                      <span className="font-mono text-base border-b-2 border-double border-foreground pb-0.5">{fmtCurrency(displaySummary?.voidedLineItemValue)}</span>
                    </div>
                  </td>
                </tr>
              )}
              data={filteredVoidedLineItems}
              keyExtractor={(v) => `${v.billId}-${v.lineIndex}`}
              searchable
              searchPlaceholder="Search bills..."
              emptyMessage="No voided line items on bills in this period."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'billNumber', header: 'Bill Number', sortable: true, render: (v) => <span className="font-mono">{v}</span> },
                { key: 'patientName', header: 'Patient', sortable: true },
                { key: 'serviceName', header: 'Service', sortable: true },
                { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'billDate', header: 'Bill Date', sortable: true, render: (v) => <span className="text-muted-foreground">{fmtDate(v)}</span> },
              ]}
            />
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
