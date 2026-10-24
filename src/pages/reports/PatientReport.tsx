import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { ReportLetterhead } from './ReportLetterhead';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { StatusBadge, StatusBadgeTone } from '@/components/common';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { fmtCurrency, fmtCount, fmtDate, CsvColumn } from '@/utils/reportUtils';
import { toast } from '@/lib/notify';

// ── Types ────────────────────────────────────────────────────────────────

interface BillRow {
  id: string;
  billNumber: string;
  patientId: string;
  patientName: string;
  totalAmount: string | number;
  paidAmount: string | number;
  balanceAmount: string | number;
  status: string;
  billDate: string;
  createdAt: string;
}

interface PatientReportData {
  period: { dateFrom: string; dateTo: string };
  clinicId: number;
  visits: { total: number };
  patientsRegistered: { total: number; fromPatients: number; fromLis: number };
  paidInFull: { count: number; totalAmount: number; paidAmount: number };
  outstanding: {
    totalOutstanding: number;
    totalOutstandingCount: number;
    inPeriodOutstanding: number;
    inPeriodOutstandingCount: number;
  };
  bills: BillRow[];
}

const BILL_STATUS_TONE_MAP: Record<string, StatusBadgeTone> = {
  paid: 'success',
  partial: 'warning',
  pending: 'neutral',
  overdue: 'danger',
  active: 'info',
};

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// ── Component ────────────────────────────────────────────────────────────

export default function PatientReport() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;

  const [dateFrom, setDateFrom] = useState(() => toLocalDateStr(new Date(Date.now() - 29 * 86400000)));
  const [dateTo, setDateTo] = useState(() => toLocalDateStr(new Date()));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PatientReportData | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: String(clinicId) });
      const res = await authFetch(`/api/reports-v2/patients?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load patient report');
      setData(await res.json());
      setGeneratedAt(new Date());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load patient report');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, clinicId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const bills = data?.bills || [];

  const csvColumns: CsvColumn[] = [
    { header: 'Bill Number', key: 'billNumber' },
    { header: 'Patient', key: 'patientName' },
    { header: 'Total', key: 'totalAmount', transform: v => fmtCurrency(v) },
    { header: 'Paid', key: 'paidAmount', transform: v => fmtCurrency(v) },
    { header: 'Balance', key: 'balanceAmount', transform: v => fmtCurrency(v) },
    { header: 'Status', key: 'status' },
    { header: 'Bill Date', key: 'billDate', transform: v => fmtDate(v) },
  ];

  return (
    <ReportSubPageShell
      title="Patient Report"
      description="Visit volume, registrations, paid-in-full and outstanding receivables"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={bills}
      csvColumns={csvColumns}
      csvFilename={`patient-report-${dateFrom}-${dateTo}.csv`}
    >
      <ReportLetterhead title="Patient Report" dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} />
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
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Visits</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(data?.visits.total)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">in selected period</p>
                </div>
                <Users className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Patients Registered</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(data?.patientsRegistered.total)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtCount(data?.patientsRegistered.fromPatients)} registry + {fmtCount(data?.patientsRegistered.fromLis)} LIS
                  </p>
                </div>
                <UserPlus className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Paid in Full</p>
                  <p className="text-2xl font-bold mt-1 text-success">{fmtCount(data?.paidInFull.count)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fmtCurrency(data?.paidInFull.totalAmount)}</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Outstanding</p>
                  <p className="text-2xl font-bold mt-1 text-warning">{fmtCurrency(data?.outstanding.totalOutstanding)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtCount(data?.outstanding.totalOutstandingCount)} bills owed &middot; {fmtCurrency(data?.outstanding.inPeriodOutstanding)} from this period
                  </p>
                </div>
                <AlertTriangle className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>

          {/* ── Breakdown table ── */}
          <div>
            <div className="mb-1.5 print:hidden">
              <p className="text-xs text-muted-foreground">{fmtCount(bills.length)} bill{bills.length === 1 ? '' : 's'} created {fmtDate(dateFrom)} — {fmtDate(dateTo)}</p>
            </div>
            <AdvancedDataTable<BillRow>
              title="Bills in Period"
              footerRow={(colSpan) => (
                <tr className="border-t-2 border-foreground/30 bg-info-bg dark:bg-info/20 font-semibold">
                  <td colSpan={colSpan} className="px-4 py-2.5 text-sm">
                    <div className="flex justify-between items-center">
                      <span>Total Billed</span>
                      <span className="font-mono text-base border-b-2 border-double border-foreground pb-0.5">{fmtCurrency(bills.reduce((s, b) => s + (Number(b.totalAmount) || 0), 0))}</span>
                    </div>
                  </td>
                </tr>
              )}
              data={bills}
              keyExtractor={(bill) => bill.id}
              searchable
              searchPlaceholder="Search bills or patient..."
              emptyMessage="No bills found for the selected period."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'billNumber', header: 'Bill Number', sortable: true, render: (v) => <span className="font-mono">{v}</span> },
                { key: 'patientName', header: 'Patient', sortable: true },
                { key: 'totalAmount', header: 'Total', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'paidAmount', header: 'Paid', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'balanceAmount', header: 'Balance', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'status', header: 'Status', sortable: true, render: (v) => <StatusBadge status={v} map={BILL_STATUS_TONE_MAP} className="capitalize" /> },
                { key: 'billDate', header: 'Bill Date', sortable: true, render: (v) => <span className="text-muted-foreground">{fmtDate(v)}</span> },
              ]}
            />
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
