import React, { useState, useCallback, useMemo } from 'react';
import { authFetch } from '@/api/apiClient';
import { ReportLetterhead } from './ReportLetterhead';
import { toast } from '@/lib/notify';
import { ReportSubPageShell } from './ReportSubPageShell';
import { LoadingState } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Calendar, RefreshCw, Download, Printer, Eye, CheckCircle2 } from 'lucide-react';
import { fmtCurrency, fmtDate, CsvColumn, getDatePresets, exportCSV, triggerPrint } from '@/utils/reportUtils';

// One Workforce Reports page, one dropdown — same shape as Clinical Reports:
// nothing loads until "View" is clicked. None of these four registers
// (Attendance, Leave, Salary Advances, Payroll) had any report at all
// before this file.

type Mode = 'attendance-register' | 'leave-register' | 'salary-advances-register' | 'payroll-register';

interface ReportOption { value: string; label: string; group: string; mode: Mode; allBranches: boolean; }

const REPORT_OPTIONS: ReportOption[] = [
  { value: 'attendance_register_all', label: 'Attendance Register (All Branches)', group: 'Attendance', mode: 'attendance-register', allBranches: true },
  { value: 'attendance_register_branch', label: 'Attendance Register (By Branch)', group: 'Attendance', mode: 'attendance-register', allBranches: false },

  { value: 'leave_register_all', label: 'Leave Register (All Branches)', group: 'Leave', mode: 'leave-register', allBranches: true },
  { value: 'leave_register_branch', label: 'Leave Register (By Branch)', group: 'Leave', mode: 'leave-register', allBranches: false },

  { value: 'salary_advances_register_all', label: 'Salary Advances Register (All Branches)', group: 'Salary Advances', mode: 'salary-advances-register', allBranches: true },
  { value: 'salary_advances_register_branch', label: 'Salary Advances Register (By Branch)', group: 'Salary Advances', mode: 'salary-advances-register', allBranches: false },

  { value: 'payroll_register_all', label: 'Payroll Register (All Branches)', group: 'Payroll', mode: 'payroll-register', allBranches: true },
  { value: 'payroll_register_branch', label: 'Payroll Register (By Branch)', group: 'Payroll', mode: 'payroll-register', allBranches: false },
];

const OPTION_GROUPS = ['Attendance', 'Leave', 'Salary Advances', 'Payroll'];

function fmtTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m + 1)}-01`, to: now.toISOString().split('T')[0] };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function WorkforceReport() {
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [reportType, setReportType] = useState('attendance_register_branch');
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const option = REPORT_OPTIONS.find(o => o.value === reportType)!;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo, allBranches: String(option.allBranches) });
      let path = '';
      if (option.mode === 'attendance-register') path = '/attendance-register';
      else if (option.mode === 'leave-register') path = '/leave-register';
      else if (option.mode === 'salary-advances-register') path = '/salary-advances-register';
      else if (option.mode === 'payroll-register') path = '/payroll-register';

      const res = await authFetch(`/api/reports-v2/workforce${path}?${params}`);
      if (!res.ok) throw new Error('Failed to load report');
      const json = await res.json();
      setRows(json.rows || []);
      setGeneratedAt(new Date());
      setHasLoaded(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load workforce report');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, reportType]);

  // ── Columns per mode ─────────────────────────────────────────────────────
  let columns: Column<any>[] = [];
  let csvColumns: CsvColumn[] = [];
  let emptyMessage = 'No records in this period.';

  if (option.mode === 'attendance-register') {
    columns = [
      { key: 'employeeName', header: 'Employee', sortable: true },
      { key: 'employeeNumber', header: 'Employee #', sortable: true },
      { key: 'department', header: 'Department', render: v => v || '—' },
      { key: 'shiftDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'shiftName', header: 'Shift', render: v => v || '—' },
      { key: 'firstIn', header: 'Clock In', render: v => fmtTime(v) },
      { key: 'lastOut', header: 'Clock Out', render: v => fmtTime(v) },
      { key: 'hoursWorked', header: 'Hours', align: 'right', render: v => v != null ? Number(v).toFixed(2) : '—' },
      { key: 'lateMinutes', header: 'Late (min)', align: 'right', render: v => v > 0 ? <span className="text-warning">{v}</span> : '0' },
      { key: 'missingClockOut', header: 'Missing Clock Out', render: v => v ? <span className="text-destructive font-medium">Yes</span> : '—' },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [
      { header: 'Employee', key: 'employeeName' }, { header: 'Employee #', key: 'employeeNumber' }, { header: 'Department', key: 'department' },
      { header: 'Date', key: 'shiftDate', transform: v => fmtDate(v) }, { header: 'Shift', key: 'shiftName' },
      { header: 'Clock In', key: 'firstIn', transform: v => fmtTime(v) }, { header: 'Clock Out', key: 'lastOut', transform: v => fmtTime(v) },
      { header: 'Hours', key: 'hoursWorked' }, { header: 'Late (min)', key: 'lateMinutes' }, { header: 'Missing Clock Out', key: 'missingClockOut', transform: v => v ? 'Yes' : 'No' },
      { header: 'Branch', key: 'branchName' },
    ];
    emptyMessage = 'No attendance records in this period.';
  } else if (option.mode === 'leave-register') {
    columns = [
      { key: 'employeeName', header: 'Employee', sortable: true },
      { key: 'employeeNumber', header: 'Employee #', sortable: true },
      { key: 'department', header: 'Department', render: v => v || '—' },
      { key: 'leaveTypeName', header: 'Leave Type', sortable: true },
      { key: 'startDate', header: 'From', sortable: true, render: v => fmtDate(v) },
      { key: 'endDate', header: 'To', render: v => fmtDate(v) },
      { key: 'days', header: 'Days', align: 'right' },
      { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize">{String(v).replace(/_/g, ' ')}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [
      { header: 'Employee', key: 'employeeName' }, { header: 'Employee #', key: 'employeeNumber' }, { header: 'Department', key: 'department' },
      { header: 'Leave Type', key: 'leaveTypeName' }, { header: 'From', key: 'startDate', transform: v => fmtDate(v) }, { header: 'To', key: 'endDate', transform: v => fmtDate(v) },
      { header: 'Days', key: 'days' }, { header: 'Status', key: 'status' }, { header: 'Branch', key: 'branchName' },
    ];
    emptyMessage = 'No leave requests in this period.';
  } else if (option.mode === 'salary-advances-register') {
    columns = [
      { key: 'employeeName', header: 'Employee', sortable: true },
      { key: 'employeeNumber', header: 'Employee #', sortable: true },
      { key: 'department', header: 'Department', render: v => v || '—' },
      { key: 'advanceNumber', header: 'Advance #', sortable: true },
      { key: 'requestDate', header: 'Requested', sortable: true, render: v => fmtDate(v) },
      { key: 'amount', header: 'Amount', align: 'right', render: (v, r) => fmtCurrency(v, r.currency) },
      { key: 'balanceRemaining', header: 'Balance Remaining', align: 'right', render: (v, r) => fmtCurrency(v, r.currency) },
      { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize">{String(v).replace(/_/g, ' ')}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [
      { header: 'Employee', key: 'employeeName' }, { header: 'Employee #', key: 'employeeNumber' }, { header: 'Department', key: 'department' },
      { header: 'Advance #', key: 'advanceNumber' }, { header: 'Requested', key: 'requestDate', transform: v => fmtDate(v) },
      { header: 'Amount', key: 'amount' }, { header: 'Balance Remaining', key: 'balanceRemaining' }, { header: 'Status', key: 'status' }, { header: 'Branch', key: 'branchName' },
    ];
    emptyMessage = 'No salary advances in this period.';
  } else if (option.mode === 'payroll-register') {
    columns = [
      { key: 'employeeName', header: 'Employee', sortable: true },
      { key: 'employeeNumber', header: 'Employee #', sortable: true },
      { key: 'department', header: 'Department', render: v => v || '—' },
      { key: 'runNumber', header: 'Run #', sortable: true },
      { key: 'periodMonth', header: 'Period', render: (v, r) => `${MONTHS[v - 1] || v} ${r.periodYear}` },
      { key: 'grossPay', header: 'Gross', align: 'right', render: (v, r) => fmtCurrency(v, r.currency) },
      { key: 'netPay', header: 'Net', align: 'right', render: (v, r) => fmtCurrency(v, r.currency) },
      { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'receiptConfirmed', header: 'Receipt Confirmed', render: v => v ? <span className="flex items-center gap-1 text-success"><CheckCircle2 className="w-3.5 h-3.5" /> Yes</span> : '—' },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [
      { header: 'Employee', key: 'employeeName' }, { header: 'Employee #', key: 'employeeNumber' }, { header: 'Department', key: 'department' },
      { header: 'Run #', key: 'runNumber' }, { header: 'Period', key: 'periodMonth', transform: (v, r) => `${MONTHS[v - 1] || v} ${r.periodYear}` },
      { header: 'Gross', key: 'grossPay' }, { header: 'Net', key: 'netPay' }, { header: 'Status', key: 'status' },
      { header: 'Receipt Confirmed', key: 'receiptConfirmed', transform: v => v ? 'Yes' : 'No' }, { header: 'Branch', key: 'branchName' },
    ];
    emptyMessage = 'No payroll lines in this period.';
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
  const handleExportCSV = () => exportCSV(numberedRows, csvColumns, `workforce-${option.value}-${dateFrom}-${dateTo}.csv`);

  return (
    <ReportSubPageShell
      title="Workforce Reports"
      description="Pick a report type and date range, then click View."
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      hideControls
    >
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

      {loading ? (
        <LoadingState message="Loading report..." />
      ) : !hasLoaded ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed border-border rounded-md">
          Pick a report type and date range above, then click View.
        </div>
      ) : (
        <AdvancedDataTable
          headerClassName="bg-info-bg dark:bg-info/40 border-b border-border"
          data={numberedRows}
          keyExtractor={(r, i) => r.employeeId ? `${r.employeeId}-${i}` : i}
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
