import React, { useState, useEffect, useMemo } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import {
  Loader2, BedDouble, UserCheck, CheckCircle2, Percent, Wrench,
  Search, TrendingUp, Clock, CalendarDays, RefreshCw,
} from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { ReportLetterhead } from './ReportLetterhead';
import { StatusBadge, type StatusBadgeTone, LoadingState} from '@/components/common';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { fmtNum, fmtCount, fmtDate, getDatePresets, CsvColumn } from '@/utils/reportUtils';

// Same tone map as src/pages/inpatient/RoomsManagement.tsx's bedStatusToneMap —
// keep bed status badges visually identical across the app.
const bedStatusToneMap: Record<string, StatusBadgeTone> = {
  available: 'success',
  occupied: 'danger',
  maintenance: 'warning',
  reserved: 'primary',
};

interface WardRow {
  ward_id: string;
  ward_name: string;
  ward_code: string;
  ward_type: string;
  total_beds: number;
  occupied_beds: number;
  available_beds: number;
  maintenance_beds: number;
  occupancy_rate: number;
}

interface BedRow {
  id: string;
  bed_number: string;
  bed_type: string;
  status: string;
  room_number: string | null;
  room_type: string | null;
  ward_name: string | null;
}

interface DailyRow {
  day: string;
  admissions: number;
}

interface ReportPayload {
  asOf: string;
  summary: {
    total_beds: number;
    occupied_beds: number;
    available_beds: number;
    maintenance_beds: number;
    occupancy_rate: number;
  };
  byWard: WardRow[];
  beds: BedRow[];
  admissionsTrend: {
    dateFrom: string;
    dateTo: string;
    daily: DailyRow[];
    totalAdmissionsInPeriod: number;
    currentActiveAdmissions: number;
    completedStaysInPeriod: number;
    avgLengthOfStayDays: number | null;
  };
}

export default function OccupancyReport() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;

  // Occupancy itself is a current-state snapshot — the shell's global date range
  // is hidden (same call as InventoryReport.tsx). The admissions-trend section
  // below is genuinely period-based though, so it gets its own local date range,
  // scoped just to that card, instead of the shell's.
  const [shellDateFrom, setShellDateFrom] = useState('');
  const [shellDateTo, setShellDateTo] = useState('');

  const presets = useMemo(() => getDatePresets(), []);
  const last30 = presets.find(p => p.label === 'Last 30 Days')!;
  const [trendFrom, setTrendFrom] = useState(last30.from);
  const [trendTo, setTrendTo] = useState(last30.to);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReportPayload | null>(null);
  const [bedSearch, setBedSearch] = useState('');
  const [bedStatusFilter, setBedStatusFilter] = useState('all');
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const fetchData = async (from = trendFrom, to = trendTo) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ clinic_id: String(clinicId), dateFrom: from, dateTo: to });
      const res = await authFetch(`/api/reports-v2/occupancy?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load occupancy report');
      setData(await res.json());
      setGeneratedAt(new Date());
    } catch (err: any) {
      toast.error(err.message || 'Failed to load occupancy report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTrendPreset = (label: string) => {
    const p = presets.find(x => x.label === label);
    if (!p) return;
    setTrendFrom(p.from);
    setTrendTo(p.to);
    fetchData(p.from, p.to);
  };

  const summary = data?.summary || { total_beds: 0, occupied_beds: 0, available_beds: 0, maintenance_beds: 0, occupancy_rate: 0 };
  const byWard = data?.byWard || [];
  const beds = data?.beds || [];
  const trend = data?.admissionsTrend || {
    dateFrom: trendFrom, dateTo: trendTo, daily: [], totalAdmissionsInPeriod: 0,
    currentActiveAdmissions: 0, completedStaysInPeriod: 0, avgLengthOfStayDays: null,
  };

  const bedStatuses = useMemo(() => Array.from(new Set(beds.map(b => b.status))).sort(), [beds]);

  const filteredBeds = useMemo(() => beds.filter(b => {
    const q = bedSearch.toLowerCase();
    const matchesSearch = !q
      || b.bed_number?.toLowerCase().includes(q)
      || b.room_number?.toLowerCase().includes(q)
      || b.ward_name?.toLowerCase().includes(q);
    const matchesStatus = bedStatusFilter === 'all' || b.status === bedStatusFilter;
    return matchesSearch && matchesStatus;
  }), [beds, bedSearch, bedStatusFilter]);

  const csvColumns: CsvColumn[] = [
    { header: 'Ward', key: 'ward_name' },
    { header: 'Room', key: 'room_number' },
    { header: 'Bed Number', key: 'bed_number' },
    { header: 'Bed Type', key: 'bed_type' },
    { header: 'Status', key: 'status' },
  ];

  const maxDaily = Math.max(1, ...trend.daily.map(d => d.admissions));

  const losLabel = trend.completedStaysInPeriod === 0
    ? 'No completed stays in this period'
    : trend.completedStaysInPeriod === 1
      ? `${fmtNum(trend.avgLengthOfStayDays ?? 0, 1)} days (based on 1 completed stay)`
      : `${fmtNum(trend.avgLengthOfStayDays ?? 0, 1)} days avg (${trend.completedStaysInPeriod} completed stays)`;

  return (
    <ReportSubPageShell
      title="Bed / Ward Occupancy"
      description="Current bed occupancy across wards, plus admissions trend over a period"
      dateFrom={shellDateFrom} dateTo={shellDateTo}
      onDateFromChange={setShellDateFrom} onDateToChange={setShellDateTo}
      onRefresh={() => fetchData()} loading={loading}
      hideDateRange
      csvData={filteredBeds} csvColumns={csvColumns} csvFilename={`bed-occupancy-${new Date().toISOString().split('T')[0]}.csv`}
    >
      <ReportLetterhead title="Bed / Ward Occupancy" dateFrom={trendFrom} dateTo={trendTo} generatedAt={generatedAt} />
      {loading && !data ? (
        <LoadingState message="Loading report..." />
      ) : (
        <div className="space-y-6">

          {data && (
            <p className="text-xs text-muted-foreground -mt-2">As of {new Date(data.asOf).toLocaleString()}</p>
          )}

          {/* Occupancy summary tiles */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${summary.maintenance_beds > 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Beds</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(summary.total_beds)}</p>
                </div>
                <BedDouble className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Occupied Beds</p>
                  <p className="text-2xl font-bold mt-1 text-destructive">{fmtCount(summary.occupied_beds)}</p>
                </div>
                <UserCheck className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Available Beds</p>
                  <p className="text-2xl font-bold mt-1 text-success">{fmtCount(summary.available_beds)}</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Occupancy Rate</p>
                  <p className="text-2xl font-bold mt-1 text-primary">{fmtNum(summary.occupancy_rate, 1)}%</p>
                </div>
                <Percent className="h-5 w-5 text-primary" />
              </div>
            </div>
            {summary.maintenance_beds > 0 && (
              <div className="bg-card rounded-lg border shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Other / Maintenance</p>
                    <p className="text-2xl font-bold mt-1 text-warning">{fmtCount(summary.maintenance_beds)}</p>
                  </div>
                  <Wrench className="h-5 w-5 text-primary" />
                </div>
              </div>
            )}
          </div>

          {/* By Ward */}
          <div>
            <div className="mb-2">
              <h3 className="font-medium text-sm">Occupancy by Ward</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Current bed state, grouped by ward</p>
            </div>
            <AdvancedDataTable<WardRow>
              headerClassName="bg-info-bg dark:bg-info/40 border-b border-border"
              data={byWard}
              keyExtractor={(w) => w.ward_id}
              searchable
              searchPlaceholder="Search wards..."
              emptyMessage="No active wards configured."
              columns={[
                {
                  key: 'ward_name', header: 'Ward', sortable: true,
                  render: (_v, w) => <>{w.ward_name}<span className="text-xs text-muted-foreground ml-1">({w.ward_code})</span></>,
                },
                { key: 'total_beds', header: 'Total Beds', align: 'right', sortable: true, render: (v) => <span className="text-muted-foreground">{fmtCount(v)}</span> },
                { key: 'occupied_beds', header: 'Occupied', align: 'right', sortable: true, render: (v) => <span className="text-destructive">{fmtCount(v)}</span> },
                { key: 'available_beds', header: 'Available', align: 'right', sortable: true, render: (v) => <span className="text-success">{fmtCount(v)}</span> },
                {
                  key: 'occupancy_rate', header: 'Occupancy', align: 'right', sortable: true,
                  render: (v) => (
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, v)}%` }} />
                      </div>
                      <span className="text-right w-12 font-medium">{fmtNum(v, 1)}%</span>
                    </div>
                  ),
                },
              ]}
            />
          </div>

          {/* Full bed roster — search/status filter live here (not the table's own built-in
              search) because they also drive what the page-level CSV export downloads. */}
          <div>
            <div className="mb-2">
              <h3 className="font-medium text-sm">Bed Roster</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Showing {filteredBeds.length} of {beds.length} beds</p>
            </div>
            <AdvancedDataTable<BedRow>
              headerClassName="bg-info-bg dark:bg-info/40 border-b border-border"
              data={filteredBeds}
              keyExtractor={(b) => b.id}
              emptyMessage="No beds match your filters."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              toolbarExtra={
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-56">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <input
                      placeholder="Search bed, room, ward..."
                      value={bedSearch}
                      onChange={e => setBedSearch(e.target.value)}
                      className="pl-8 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                    />
                  </div>
                  <select
                    className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm"
                    value={bedStatusFilter}
                    onChange={e => setBedStatusFilter(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {bedStatuses.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              }
              columns={[
                { key: 'ward_name', header: 'Ward', sortable: true, render: (v) => v || '—' },
                { key: 'room_number', header: 'Room', sortable: true, render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                { key: 'bed_number', header: 'Bed', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                { key: 'bed_type', header: 'Type', sortable: true, render: (v) => <span className="capitalize text-muted-foreground">{v}</span> },
                { key: 'status', header: 'Status', sortable: true, render: (v) => <StatusBadge status={v} map={bedStatusToneMap} className="text-xs px-2 py-0.5" /> },
              ]}
            />
          </div>

          {/* Admissions trend (secondary, period-based) */}
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-medium text-sm flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-muted-foreground" /> Admissions Trend</h3>
                <p className="text-xs text-muted-foreground mt-0.5">New admissions over a period — independent of the current-state snapshot above</p>
              </div>
              <div className="flex flex-wrap items-end gap-2 print:hidden">
                <div className="flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                  <Input type="date" value={trendFrom} onChange={e => setTrendFrom(e.target.value)} className="w-[135px] h-8 text-sm" />
                  <span className="text-muted-foreground text-sm">—</span>
                  <Input type="date" value={trendTo} onChange={e => setTrendTo(e.target.value)} className="w-[135px] h-8 text-sm" />
                </div>
                <Select onValueChange={handleTrendPreset}>
                  <SelectTrigger className="w-[130px] h-8 text-sm">
                    <SelectValue placeholder="Quick range" />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => fetchData()} disabled={loading} className="h-8 gap-1.5">
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Apply
                </Button>
              </div>
            </div>

            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 border-b">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Admissions in Period</p>
                <p className="text-xl font-bold mt-1">{fmtCount(trend.totalAdmissionsInPeriod)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Currently Active (all-time)</p>
                <p className="text-xl font-bold mt-1">{fmtCount(trend.currentActiveAdmissions)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1"><Clock className="w-3 h-3" /> Avg. Length of Stay</p>
                <p className="text-sm font-semibold mt-1.5 text-muted-foreground">{losLabel}</p>
              </div>
            </div>

            <AdvancedDataTable<DailyRow>
              headerClassName="bg-info-bg dark:bg-info/40 border-b border-border"
              data={trend.daily}
              keyExtractor={(d) => d.day}
              emptyMessage="No admissions in this period."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'day', header: 'Date', sortable: true, render: (v) => fmtDate(v) },
                { key: 'admissions', header: 'New Admissions', align: 'right', sortable: true, render: (v) => <span className="font-medium">{fmtCount(v)}</span> },
                {
                  key: '__bar', header: '', width: '50%',
                  render: (_v, d) => <div className="h-2 rounded-full bg-primary/70" style={{ width: `${(d.admissions / maxDaily) * 100}%` }} />,
                },
              ]}
            />
          </div>
        </div>
      )}
    </ReportSubPageShell>
  );
}
