import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Stethoscope, Users, ClipboardList, Wallet, Loader2, Info, UserCircle } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { ReportLetterhead } from './ReportLetterhead';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { fmtCurrency, fmtCount, CsvColumn } from '@/utils/reportUtils';
import { toast } from '@/lib/notify';

// ── Types ────────────────────────────────────────────────────────────────

interface DoctorRow {
  doctorId: number;
  doctorName: string;
  patientsSeen: number;
  visits: number;
  revenueBilled: number;
  revenueCollected: number;
  cashRevenueBilled: number;
  cashRevenueCollected: number;
  insuranceRevenueBilled: number;
  insuranceRevenueCollected: number;
  avgRevenuePerVisit: number;
}

interface DoctorPerformanceData {
  period: { dateFrom: string; dateTo: string };
  clinicId: number;
  summary: {
    totalDoctorsActive: number;
    totalPatientsSeen: number;
    totalVisits: number;
    totalRevenueAttributed: number;
  };
  doctors: DoctorRow[];
  dataQuality: {
    totalVisitsAllStaff: number;
    doctorAttributedVisits: number;
    unattributedVisits: number;
    note: string | null;
  };
  revenueAttribution: {
    totalConsultationBilled: number;
    totalConsultationCollected: number;
    cashConsultationBilled: number;
    insuranceConsultationBilled: number;
    unattributedConsultationBilled: number;
    unattributedConsultationCollected: number;
    ambiguousBillCount: number;
    collectionMethod: { exactItems: number; estimatedItems: number };
    note: string;
  };
}

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// ── Component ────────────────────────────────────────────────────────────

export default function DoctorPerformanceReport() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;

  const [dateFrom, setDateFrom] = useState(() => toLocalDateStr(new Date(Date.now() - 29 * 86400000)));
  const [dateTo, setDateTo] = useState(() => toLocalDateStr(new Date()));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DoctorPerformanceData | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: String(clinicId) });
      const res = await authFetch(`/api/reports-v2/doctor-performance?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load doctor performance report');
      setData(await res.json());
      setGeneratedAt(new Date());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load doctor performance report');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, clinicId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const doctors = data?.doctors || [];

  const [selectedDoctor, setSelectedDoctor] = useState('all');
  useEffect(() => { setSelectedDoctor('all'); }, [dateFrom, dateTo]);

  const doctorOptions = useMemo(
    () => doctors.map(d => ({ key: String(d.doctorId), name: d.doctorName })),
    [doctors]
  );
  const filteredDoctors = useMemo(
    () => selectedDoctor === 'all' ? doctors : doctors.filter(d => String(d.doctorId) === selectedDoctor),
    [doctors, selectedDoctor]
  );

  // Backend summary is period-wide; once a specific doctor is selected, derive the
  // tiles from just their filtered row so the summary actually narrows too.
  const displaySummary = useMemo(() => {
    if (selectedDoctor === 'all') return data?.summary;
    const row = filteredDoctors[0];
    if (!row) return { totalDoctorsActive: 0, totalPatientsSeen: 0, totalVisits: 0, totalRevenueAttributed: 0 };
    return {
      totalDoctorsActive: 1,
      totalPatientsSeen: row.patientsSeen,
      totalVisits: row.visits,
      totalRevenueAttributed: row.revenueBilled,
    };
  }, [data, selectedDoctor, filteredDoctors]);

  const csvColumns: CsvColumn[] = [
    { header: 'Doctor', key: 'doctorName' },
    { header: 'Patients Seen', key: 'patientsSeen' },
    { header: 'Visits', key: 'visits' },
    { header: 'Revenue Billed', key: 'revenueBilled', transform: v => fmtCurrency(v) },
    { header: 'Revenue Collected', key: 'revenueCollected', transform: v => fmtCurrency(v) },
    { header: 'Cash Revenue Billed', key: 'cashRevenueBilled', transform: v => fmtCurrency(v) },
    { header: 'Insurance/Credit Revenue Billed', key: 'insuranceRevenueBilled', transform: v => fmtCurrency(v) },
    { header: 'Avg Revenue / Visit', key: 'avgRevenuePerVisit', transform: v => fmtCurrency(v) },
  ];

  return (
    <ReportSubPageShell
      title="Doctor Performance Report"
      description="Patients seen, visit volume and approximate consultation revenue per doctor"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={filteredDoctors}
      csvColumns={csvColumns}
      csvFilename={`doctor-performance-report-${dateFrom}-${dateTo}.csv`}
    >
      <ReportLetterhead title="Doctor Performance Report" dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} />
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
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Doctors Active</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(displaySummary?.totalDoctorsActive)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">in selected period</p>
                </div>
                <Stethoscope className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Patients Seen</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(displaySummary?.totalPatientsSeen)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">distinct patients, doctor-attributed visits</p>
                </div>
                <Users className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Visits</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(displaySummary?.totalVisits)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">attributed to an active doctor</p>
                </div>
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Revenue Attributed</p>
                  <p className="text-2xl font-bold mt-1 text-emerald-700">{fmtCurrency(displaySummary?.totalRevenueAttributed)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">approximate — see note below</p>
                </div>
                <Wallet className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>

          {/* ── Data quality disclosure: doctor_id attribution ── */}
          {data?.dataQuality.note && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 flex gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-slate-500" />
              <div>
                <p className="font-medium mb-0.5">Some visits could not be attributed to a doctor</p>
                <p>{data.dataQuality.note}</p>
              </div>
            </div>
          )}

          {/* ── Per-doctor table ── */}
          <div>
            <div className="mb-2">
              <h3 className="font-semibold text-sm">Performance by Doctor</h3>
              <p className="text-xs text-muted-foreground">
                {fmtCount(doctors.length)} doctor{doctors.length === 1 ? '' : 's'} with activity {fmtCount(data?.summary.totalVisits)} visit{data?.summary.totalVisits === 1 ? '' : 's'} total
              </p>
            </div>
            <AdvancedDataTable<DoctorRow>
              headerClassName="bg-sky-100 dark:bg-sky-950/40 border-b border-border"
              footerRow={(colSpan) => (
                <tr className="border-t-2 border-foreground/30 bg-sky-50 dark:bg-sky-950/20 font-semibold">
                  <td colSpan={colSpan} className="px-4 py-2.5 text-sm">
                    <div className="flex justify-between items-center">
                      <span>Total Revenue Attributed</span>
                      <span className="font-mono text-base border-b-2 border-double border-foreground pb-0.5">{fmtCurrency(displaySummary?.totalRevenueAttributed)}</span>
                    </div>
                  </td>
                </tr>
              )}
              data={filteredDoctors}
              keyExtractor={(doc) => doc.doctorId}
              searchable
              searchPlaceholder="Search doctors..."
              emptyMessage={
                data?.dataQuality.totalVisitsAllStaff
                  ? 'No visits in this period could be attributed to a doctor account. See the note above.'
                  : 'No visits recorded for the selected period.'
              }
              toolbarExtra={
                <div className="flex items-center gap-2 flex-wrap">
                  <UserCircle className="h-4 w-4 text-muted-foreground" />
                  <select
                    className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm"
                    value={selectedDoctor}
                    onChange={e => setSelectedDoctor(e.target.value)}
                  >
                    <option value="all">All doctors</option>
                    {doctorOptions.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}
                  </select>
                </div>
              }
              columns={[
                { key: 'doctorName', header: 'Doctor', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
                { key: 'patientsSeen', header: 'Patients Seen', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCount(v)}</span> },
                { key: 'visits', header: 'Visits', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCount(v)}</span> },
                { key: 'revenueBilled', header: 'Revenue Billed', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'revenueCollected', header: 'Revenue Collected', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'cashRevenueBilled', header: 'Cash Revenue', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'insuranceRevenueBilled', header: 'Insurance/Credit Revenue', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
                { key: 'avgRevenuePerVisit', header: 'Avg / Visit', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCurrency(v)}</span> },
              ]}
            />
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
