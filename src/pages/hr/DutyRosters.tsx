import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarRange, CheckCircle2, Copy, Download, Eraser, FileWarning, Loader2, RotateCcw, Save, Send, Settings2, Undo2, Upload,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, AdvancedDataTable } from '@/components/common';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { formatDate, formatDateTime } from '@/lib/format';
import { toast } from '@/lib/notify';
import { cn } from '@/lib/utils';

interface Shift { id: string; name: string; code: string | null; kind: string; color: string | null; start_time: string; end_time: string; early_window_min: number; is_active: boolean }
interface Dept { name: string; head_name: string | null; employees: number }
interface Meta { shifts: Shift[]; departments: Dept[]; permissions: { view: boolean; manage: boolean; approve: boolean; head_of: string[] }; enforce_clock_in: boolean }
interface RosterRow { id: string; department: string; status: string; version: number; entry_count: number; submitted_by_name: string | null; submitted_at: string | null; approved_by_name: string | null; approved_at: string | null; return_reason: string | null }
interface Employee { id: string; employee_number: string; first_name: string; last_name: string; job_title: string | null }
interface Leave { employee_id: string; start_date: string; end_date: string; leave_type: string }
interface Detail {
  roster: (RosterRow & { period: string; source: string | null }) | null;
  days: string[]; employees: Employee[]; shifts: Shift[];
  entries: { employee_id: string; duty_date: string; shift_id: string }[];
  leave: Leave[]; conflicts: { employee_id: string; duty_date: string; shift: string; leave_type: string }[];
  events: { action: string; detail: string | null; created_at: string; actor: string | null }[];
  can: { edit: boolean; submit: boolean; approve: boolean; reopen: boolean };
}

const STATUS_MAP = { draft: 'neutral', submitted: 'warning', approved: 'success', returned: 'danger', none: 'neutral' } as const;
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', submitted: 'Awaiting approval', approved: 'Approved', returned: 'Returned', none: 'Not started' };
const PALETTE = ['#0F766E', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#CA8A04', '#16A34A', '#475569'];
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const hm = (t: string) => String(t || '').slice(0, 5);
const shiftLabel = (s?: Shift) => (s ? s.code || s.name.slice(0, 2).toUpperCase() : '');
const shiftColor = (s: Shift | undefined, i: number) => s?.color || PALETTE[i % PALETTE.length];

async function api(path: string, init?: RequestInit) {
  const res = await authFetch(`/api/rosters${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const err: any = new Error(body.error || 'Something went wrong'); err.body = body; throw err; }
  return body;
}

export default function DutyRosters() {
  const [params, setParams] = useSearchParams();
  const period = params.get('period') || thisMonth();
  const department = params.get('department');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState('');
  const [shiftsOpen, setShiftsOpen] = useState(false);

  const loadMeta = useCallback(() => {
    api('/meta').then(setMeta).catch((e) => setMetaError(e.message));
  }, []);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const go = (next: { period?: string; department?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.period) p.set('period', next.period);
    if (next.department === null) p.delete('department'); else if (next.department) p.set('department', next.department);
    setParams(p);
  };

  const toggleRule = async (on: boolean) => {
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ enforce_clock_in: on }) });
      setMeta((m) => (m ? { ...m, enforce_clock_in: on } : m));
      toast.success(on ? 'Clock-in now follows approved rosters' : 'Clock-in no longer checks the roster');
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader
            icon={<CalendarRange />}
            title="Duty Rosters"
            subtitle="Monthly shift rosters per department — upload the Excel template or fill in the grid, then submit for approval"
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                <Input type="month" aria-label="Month" className="w-44" value={period} onChange={(e) => e.target.value && go({ period: e.target.value })} />
                {meta?.permissions.manage && (
                  <Button variant="outline" onClick={() => setShiftsOpen(true)}><Settings2 className="w-4 h-4 mr-2" />Shift codes</Button>
                )}
              </div>
            }
          />

          {metaError ? (
            <div className="bg-card border rounded-lg p-6 text-sm text-destructive">{metaError}</div>
          ) : !meta ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : department ? (
            <RosterEditor key={`${department}|${period}`} meta={meta} department={department} period={period} onBack={() => go({ department: null })} />
          ) : (
            <MonthOverview meta={meta} period={period} onOpen={(d) => go({ department: d })} onToggleRule={toggleRule} />
          )}
        </div>
      </div>
      {meta && <ShiftCodesDialog open={shiftsOpen} onOpenChange={setShiftsOpen} shifts={meta.shifts} onSaved={loadMeta} />}
    </AppLayout>
  );
}

// ── Month overview: every department and where its roster stands ────────
function MonthOverview({ meta, period, onOpen, onToggleRule }: { meta: Meta; period: string; onOpen: (d: string) => void; onToggleRule: (on: boolean) => void }) {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api(`?period=${period}`).then(setRows).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [period]);

  const data = meta.departments.map((d) => {
    const r = rows.find((x) => x.department === d.name);
    return { ...d, status: r?.status || 'none', entry_count: r?.entry_count || 0, submitted_by_name: r?.submitted_by_name, submitted_at: r?.submitted_at, approved_by_name: r?.approved_by_name, approved_at: r?.approved_at, version: r?.version };
  });
  const noCodes = meta.shifts.filter((s) => s.is_active !== false && !s.code).length;

  return (
    <>
      {meta.permissions.approve && (
        <div className="bg-card border rounded-lg shadow-sm px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-medium text-sm">Only allow clock-in for rostered staff</p>
            <p className="text-xs text-muted-foreground">Applies to departments whose roster for the month is approved. Others clock in as today.</p>
          </div>
          <Switch checked={meta.enforce_clock_in} onCheckedChange={onToggleRule} aria-label="Only allow clock-in for rostered staff" />
        </div>
      )}
      {noCodes > 0 && meta.permissions.manage && (
        <div className="bg-warning-bg border border-warning-border text-warning rounded-lg px-4 py-3 text-sm">
          {noCodes} shift{noCodes === 1 ? ' has' : 's have'} no roster code yet. Give each shift a short code (e.g. M, N) under <strong>Shift codes</strong> — the Excel template uses them.
        </div>
      )}
      <AdvancedDataTable<any>
        title={`Departments — ${monthLabel(period)}`}
        countLabel={['department', 'departments']}
        data={data}
        loading={loading}
        keyExtractor={(r) => r.name}
        onRowClick={(r) => onOpen(r.name)}
        dateFilterKey={false}
        searchPlaceholder="Search department..."
        columns={[
          { key: 'name', header: 'Department', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
          { key: 'head_name', header: 'Head of department', render: (v) => v || <span className="text-muted-foreground">Not set</span> },
          { key: 'employees', header: 'Staff', align: 'right', sortable: true },
          { key: 'status', header: 'Roster', sortable: true, exportValue: (r) => STATUS_LABEL[r.status], render: (v) => <StatusBadge status={v} map={STATUS_MAP} label={STATUS_LABEL[v]} /> },
          { key: 'entry_count', header: 'Shifts entered', align: 'right' },
          { key: 'submitted_by_name', header: 'Submitted', render: (v, r) => (v ? <span className="text-sm">{v}<span className="block text-xs text-muted-foreground">{formatDate(r.submitted_at)}</span></span> : '—') },
          { key: 'approved_by_name', header: 'Approved', render: (v, r) => (v ? <span className="text-sm">{v}<span className="block text-xs text-muted-foreground">{formatDate(r.approved_at)}</span></span> : '—') },
          { key: 'actions', header: '', align: 'right', render: (_v, r) => <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onOpen(r.name); }}>Open</Button> },
        ]}
        empty={{ icon: CalendarRange, title: 'No departments', message: 'Departments come from Setup › Departments and the department on each employee.' }}
      />
    </>
  );
}

// ── One department's month ─────────────────────────────────────────────
function RosterEditor({ meta, department, period, onBack }: { meta: Meta; department: string; period: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Map<string, string | null>>(new Map());
  const [brush, setBrush] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[] | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const painting = useRef(false);
  const base = `/${encodeURIComponent(department)}/${period}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d: Detail = await api(base);
      setDetail(d);
      setPending(new Map());
      setBrush((b) => b ?? d.shifts.find((s) => s.is_active !== false)?.id ?? null);
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }, [base]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const up = () => { painting.current = false; }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, []);

  const shifts = useMemo(() => (detail?.shifts || []).filter((s) => s.is_active !== false), [detail]);
  const shiftById = useMemo(() => new Map((detail?.shifts || []).map((s, i) => [s.id, { ...s, _i: i }])), [detail]);
  const saved = useMemo(() => new Map((detail?.entries || []).map((e) => [`${e.employee_id}|${e.duty_date}`, e.shift_id])), [detail]);
  const cell = (emp: string, day: string) => (pending.has(`${emp}|${day}`) ? pending.get(`${emp}|${day}`) : saved.get(`${emp}|${day}`)) || null;
  const leaveOn = (emp: string, day: string) => detail?.leave.find((l) => l.employee_id === emp && l.start_date <= day && l.end_date >= day);
  const editable = !!detail?.can.edit;
  const dirty = pending.size > 0;
  const status = detail?.roster?.status || 'none';

  const paint = (emp: string, day: string) => {
    if (!editable) return;
    const key = `${emp}|${day}`;
    setPending((prev) => {
      const next = new Map(prev);
      const target = brush;
      if ((saved.get(key) || null) === target) next.delete(key); else next.set(key, target);
      return next;
    });
  };

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setBusy(true);
    try {
      await api(`${base}/entries`, { method: 'PUT', body: JSON.stringify({ changes: [...pending].map(([k, shift_id]) => { const [employee_id, duty_date] = k.split('|'); return { employee_id, duty_date, shift_id }; }) }) });
      toast.success('Roster saved');
      await load();
      return true;
    } catch (e: any) { toast.error(e.message); return false; } finally { setBusy(false); }
  };

  const action = async (path: string, body: any, ok: string) => {
    setBusy(true);
    try {
      await api(`${base}/${path}`, { method: 'POST', body: JSON.stringify(body || {}) });
      toast.success(ok);
      await load();
    } catch (e: any) {
      if (e.body?.conflicts?.length) toast.error(`${e.message}`);
      else toast.error(e.message);
      throw e;
    } finally { setBusy(false); }
  };

  const submit = async () => { if (await save()) await action('submit', {}, 'Roster submitted for approval').catch(() => {}); };

  // ── Excel template & upload ──
  const downloadTemplate = async () => {
    if (!detail) return;
    const XLSX = await import('xlsx');
    const header = ['Employee No', 'Name', ...detail.days.map((d) => Number(d.slice(8)))];
    const weekdays = ['', '', ...detail.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(d)])];
    const rows = detail.employees.map((e) => [e.employee_number, `${e.first_name} ${e.last_name}`, ...detail.days.map((d) => shiftLabel(shiftById.get(cell(e.id, d) || '')))]);
    const ws = XLSX.utils.aoa_to_sheet([[`${department} — duty roster ${monthLabel(period)}`], weekdays, header, ...rows]);
    ws['!cols'] = [{ wch: 14 }, { wch: 26 }, ...detail.days.map(() => ({ wch: 4 }))];
    const legend = XLSX.utils.aoa_to_sheet([
      ['Code', 'Shift', 'Starts', 'Ends', 'Kind'],
      ...shifts.map((s) => [s.code || '(no code — set one under Shift codes)', s.name, hm(s.start_time), hm(s.end_time), s.kind === 'on_call' ? 'On call' : 'Work']),
      [],
      ['Leave a cell blank (or write OFF) for a day off.'],
      ['Shift names also work instead of codes. Do not change the Employee No column or the day numbers.'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Roster');
    XLSX.utils.book_append_sheet(wb, legend, 'Shift codes');
    XLSX.writeFile(wb, `roster-${department.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${period}.xlsx`);
  };

  const upload = async (file: File) => {
    if (!detail) return;
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames.find((n) => /roster/i.test(n)) || wb.SheetNames[0]];
      const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
      const h = grid.findIndex((r) => r.some((c) => /employee\s*(no|number|#)/i.test(String(c))));
      if (h < 0) throw new Error('Could not find the "Employee No" header row. Start from the downloaded template.');
      const head = grid[h];
      const numCol = head.findIndex((c) => /employee\s*(no|number|#)/i.test(String(c)));
      const dayCols: { col: number; date: string }[] = [];
      head.forEach((c, i) => {
        const n = typeof c === 'number' ? c : /^\d{1,2}$/.test(String(c).trim()) ? Number(c) : NaN;
        const iso = Number.isFinite(n) ? `${period}-${String(n).padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(String(c).trim()) ? String(c).trim() : '';
        if (iso && detail.days.includes(iso)) dayCols.push({ col: i, date: iso });
      });
      if (!dayCols.length) throw new Error(`No day columns for ${monthLabel(period)} found in the header row.`);
      const rows: any[] = [];
      grid.slice(h + 1).forEach((r, i) => {
        const num = String(r[numCol] ?? '').trim();
        if (!num) return;
        for (const dc of dayCols) rows.push({ row: h + i + 2, employee_number: num, duty_date: dc.date, code: String(r[dc.col] ?? '').trim() });
      });
      if (!rows.length) throw new Error('The file has no employee rows.');
      const res = await api(`${base}/import`, { method: 'POST', body: JSON.stringify({ rows }) });
      toast.success(`Uploaded — ${res.imported} shift${res.imported === 1 ? '' : 's'} set for ${monthLabel(period)}`);
      await load();
    } catch (e: any) {
      if (e.body?.errors) setUploadErrors(e.body.errors);
      else toast.error(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (loading && !detail) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!detail) return null;

  const conflictKeys = new Set(detail.conflicts.map((c) => `${c.employee_id}|${c.duty_date}`));
  const coverage = detail.days.map((d) => detail.employees.filter((e) => { const s = shiftById.get(cell(e.id, d) || ''); return s && s.kind !== 'on_call'; }).length);

  return (
    <>
      {/* Status bar */}
      <div className="bg-card border rounded-lg shadow-sm px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => (dirty && !window.confirm('Leave without saving your changes?') ? null : onBack())}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />All departments
          </Button>
          <div>
            <p className="font-semibold">{department} <span className="font-normal text-muted-foreground">· {monthLabel(period)}</span></p>
            <p className="text-xs text-muted-foreground">
              {detail.employees.length} staff
              {detail.roster ? ` · version ${detail.roster.version}` : ''}
              {detail.roster?.source ? ` · last ${detail.roster.source === 'upload' ? 'uploaded' : detail.roster.source === 'copy' ? 'copied from last month' : 'edited in the grid'}` : ''}
            </p>
          </div>
          <StatusBadge status={status} map={STATUS_MAP} label={STATUS_LABEL[status]} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="w-4 h-4 mr-1.5" />Excel template</Button>
          {editable && (
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 mr-1.5" />Upload roster</Button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setCopyOpen(true)}><Copy className="w-4 h-4 mr-1.5" />Copy last month</Button>
              <Button variant="outline" size="sm" disabled={busy || (!detail.entries.length && !dirty)} onClick={() => setClearOpen(true)}><Eraser className="w-4 h-4 mr-1.5" />Clear</Button>
              {dirty && <Button variant="ghost" size="sm" onClick={() => setPending(new Map())}><Undo2 className="w-4 h-4 mr-1.5" />Discard</Button>}
              <Button variant="outline" size="sm" disabled={busy || !dirty} onClick={save}><Save className="w-4 h-4 mr-1.5" />Save{dirty ? ` (${pending.size})` : ''}</Button>
            </>
          )}
          {(detail.can.submit || (editable && dirty)) && (
            <Button size="sm" disabled={busy || (!detail.entries.length && !dirty)} onClick={submit}><Send className="w-4 h-4 mr-1.5" />Submit for approval</Button>
          )}
          {detail.can.approve && (
            <>
              <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => setReturnOpen(true)}><RotateCcw className="w-4 h-4 mr-1.5" />Return</Button>
              <Button size="sm" disabled={busy} onClick={() => action('approve', {}, 'Roster approved — staff can see it in My Roster').catch(() => {})}><CheckCircle2 className="w-4 h-4 mr-1.5" />Approve</Button>
            </>
          )}
          {detail.can.reopen && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setReopenOpen(true)}><RotateCcw className="w-4 h-4 mr-1.5" />Reopen to change</Button>
          )}
        </div>
      </div>

      {status === 'returned' && detail.roster?.return_reason && (
        <div className="bg-destructive-bg border border-destructive-border text-destructive rounded-lg px-4 py-3 text-sm"><strong>Returned:</strong> {detail.roster.return_reason}</div>
      )}
      {status === 'submitted' && !detail.can.approve && (
        <div className="bg-warning-bg border border-warning-border text-warning rounded-lg px-4 py-3 text-sm">Submitted — waiting for HR approval. It can't be changed until it's approved or returned.</div>
      )}
      {detail.conflicts.length > 0 && (
        <div className="bg-destructive-bg border border-destructive-border text-destructive rounded-lg px-4 py-3 text-sm flex items-start gap-2">
          <FileWarning className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{detail.conflicts.length} shift{detail.conflicts.length === 1 ? '' : 's'} fall on approved leave (outlined in red). Clear them before submitting.</span>
        </div>
      )}

      <Tabs defaultValue="grid">
        <TabsList>
          <TabsTrigger value="grid">Roster</TabsTrigger>
          <TabsTrigger value="report">Rostered vs attended</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="grid" className="mt-4 space-y-3">
          {editable && (
            <div className="bg-card border rounded-lg shadow-sm px-4 py-3 flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground mr-1">Pick a shift, then click or drag across cells:</span>
              {shifts.map((s) => {
                const i = shiftById.get(s.id)?._i ?? 0;
                return (
                  <button key={s.id} type="button" onClick={() => setBrush(s.id)}
                    className={cn('h-8 px-2.5 rounded-md text-xs font-semibold border flex items-center gap-1.5', brush === s.id ? 'ring-2 ring-offset-1 ring-primary' : '')}
                    title={`${s.name} ${hm(s.start_time)}–${hm(s.end_time)}`}>
                    <span className="inline-flex items-center justify-center rounded text-white px-1.5 h-5 min-w-6" style={{ backgroundColor: shiftColor(s, i) }}>{shiftLabel(s)}</span>
                    {s.name}
                  </button>
                );
              })}
              <button type="button" onClick={() => setBrush(null)} className={cn('h-8 px-2.5 rounded-md text-xs font-semibold border flex items-center gap-1.5', brush === null ? 'ring-2 ring-offset-1 ring-primary' : '')}>
                <Eraser className="w-3.5 h-3.5" />Off
              </button>
            </div>
          )}
          <div className="bg-card border rounded-lg shadow-sm overflow-x-auto select-none">
            {detail.employees.length === 0 ? (
              <p className="text-sm text-muted-foreground p-8 text-center">No active staff in {department}. Employees join a department on their HR profile.</p>
            ) : (
              <table className="border-collapse text-xs w-max min-w-full">
                <thead>
                  <tr className="bg-muted">
                    <th className="sticky left-0 z-10 bg-muted text-left font-semibold px-3 py-2 min-w-[170px] border-b border-r">Staff</th>
                    {detail.days.map((d) => (
                      <th key={d} className={cn('w-[30px] min-w-[30px] font-semibold py-1 border-b text-center', [0, 6].includes(dow(d)) && 'bg-muted-foreground/10')}>
                        <div className="text-[10px] font-normal text-muted-foreground">{['S', 'M', 'T', 'W', 'T', 'F', 'S'][dow(d)]}</div>
                        {Number(d.slice(8))}
                      </th>
                    ))}
                    <th className="px-2 border-b text-center font-semibold" title="Shifts this month">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.employees.map((e) => (
                    <tr key={e.id} className="border-b last:border-b-0">
                      <td className="sticky left-0 z-10 bg-card px-3 py-1.5 border-r">
                        <div className="font-medium text-sm leading-tight">{e.first_name} {e.last_name}</div>
                        <div className="text-[11px] text-muted-foreground">{e.employee_number}{e.job_title ? ` · ${e.job_title}` : ''}</div>
                      </td>
                      {detail.days.map((d) => {
                        const id = cell(e.id, d);
                        const s = id ? shiftById.get(id) : undefined;
                        const l = leaveOn(e.id, d);
                        const key = `${e.id}|${d}`;
                        const conflict = !!s && !!l && (conflictKeys.has(key) || pending.has(key));
                        return (
                          <td key={d}
                            onMouseDown={() => { painting.current = true; paint(e.id, d); }}
                            onMouseEnter={() => painting.current && paint(e.id, d)}
                            title={`${formatDate(d)}${s ? ` · ${s.name} ${hm(s.start_time)}–${hm(s.end_time)}` : ' · off'}${l ? ` · on ${l.leave_type}` : ''}`}
                            className={cn('p-0.5 text-center border-l border-border/40', [0, 6].includes(dow(d)) && 'bg-muted/40', editable && 'cursor-pointer hover:bg-primary/10', pending.has(key) && 'bg-primary/5')}
                            style={l && !s ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(202,138,4,.18) 4px 8px)' } : undefined}>
                            {s ? (
                              <span className={cn('inline-flex items-center justify-center rounded text-white font-bold h-6 w-[26px] text-[11px]', conflict && 'ring-2 ring-destructive')}
                                style={{ backgroundColor: shiftColor(s, s._i) }}>{shiftLabel(s)}</span>
                            ) : l ? (
                              <span className="text-[10px] font-semibold text-warning">L</span>
                            ) : (
                              <span className="text-muted-foreground/40">·</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center font-semibold px-2">{detail.days.filter((d) => cell(e.id, d)).length}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/50 border-t">
                    <td className="sticky left-0 z-10 bg-muted px-3 py-1.5 border-r text-[11px] font-semibold">On duty (excl. on-call)</td>
                    {coverage.map((n, i) => (
                      <td key={i} className={cn('text-center font-semibold py-1', n === 0 && 'text-destructive')}>{n}</td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Hover a cell for details. <span className="font-semibold text-warning">L</span> = approved leave. Red-outlined shifts fall on leave. A red 0 in the last row means nobody is on duty that day.
          </p>
        </TabsContent>

        <TabsContent value="report" className="mt-4">
          <RosterReport department={department} period={period} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <AdvancedDataTable<any>
            title="History"
            countLabel={['event', 'events']}
            data={detail.events}
            keyExtractor={(_r, i) => i}
            dateFilterKey={false}
            columns={[
              { key: 'created_at', header: 'When', render: (v) => <span className="whitespace-nowrap">{formatDateTime(v)}</span> },
              { key: 'action', header: 'What', render: (v) => <span className="capitalize">{v}</span> },
              { key: 'actor', header: 'Who', render: (v) => v || '—' },
              { key: 'detail', header: 'Detail', render: (v) => v || '—' },
            ]}
            empty={{ icon: CalendarRange, title: 'Nothing yet', message: 'Uploads, edits, submissions and approvals are listed here.' }}
          />
        </TabsContent>
      </Tabs>

      {/* Upload problems */}
      <Dialog open={!!uploadErrors} onOpenChange={(o) => !o && setUploadErrors(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>The file wasn't uploaded</DialogTitle>
            <DialogDescription>Fix these {uploadErrors?.length} problem{uploadErrors?.length === 1 ? '' : 's'} in the file and upload it again. Nothing was saved.</DialogDescription>
          </DialogHeader>
          <ul className="text-sm space-y-1.5 list-disc pl-5">{uploadErrors?.map((e, i) => <li key={i}>{e}</li>)}</ul>
          <DialogFooter><Button onClick={() => setUploadErrors(null)}>OK</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={copyOpen} onOpenChange={setCopyOpen} title="Copy last month's pattern?" icon={Copy}
        description="Each day takes the shift from four weeks earlier (same weekday). This replaces everything in this month's grid."
        confirmLabel="Copy last month" onConfirm={() => action('copy-previous', {}, 'Copied last month — review and save changes, then submit')} />
      <ConfirmDialog open={clearOpen} onOpenChange={setClearOpen} title="Clear the whole month?" tone="danger" icon={Eraser}
        description="Every shift in this month's roster is removed."
        confirmLabel="Clear month" onConfirm={async () => {
          setBusy(true);
          try { await api(`${base}/entries`, { method: 'PUT', body: JSON.stringify({ changes: [], replace: true }) }); toast.success('Month cleared'); await load(); }
          catch (e: any) { toast.error(e.message); throw e; } finally { setBusy(false); }
        }} />
      <ConfirmDialog open={returnOpen} onOpenChange={setReturnOpen} title="Return this roster?" tone="danger" icon={RotateCcw}
        description="It goes back to the department to change and resubmit."
        reason={{ label: 'What needs to change', placeholder: 'e.g. No night cover on weekends' }}
        confirmLabel="Return roster" onConfirm={(reason) => action('return', { reason }, 'Roster returned')} />
      <ConfirmDialog open={reopenOpen} onOpenChange={setReopenOpen} title="Reopen the approved roster?" icon={RotateCcw}
        description="It becomes a draft (new version) and must be approved again. Until then staff in this department clock in as if there were no roster."
        reason={{ label: 'Why it is being changed', placeholder: 'e.g. Swap between two nurses' }}
        confirmLabel="Reopen" onConfirm={(reason) => action('reopen', { reason }, 'Roster reopened as a draft')} />
    </>
  );
}

function RosterReport({ department, period }: { department: string; period: string }) {
  const [data, setData] = useState<{ roster_status: string | null; rows: any[] } | null>(null);
  useEffect(() => {
    api(`/report?department=${encodeURIComponent(department)}&period=${period}`).then(setData).catch((e) => toast.error(e.message));
  }, [department, period]);
  return (
    <div className="space-y-2">
      {data && data.roster_status !== 'approved' && (
        <p className="text-sm text-muted-foreground">This compares attendance with the <strong>approved</strong> roster. This month's roster isn't approved yet, so rostered days show as 0.</p>
      )}
      <AdvancedDataTable<any>
        title={`Rostered vs attended — ${monthLabel(period)}`}
        countLabel={['person', 'people']}
        data={data?.rows || []}
        loading={!data}
        keyExtractor={(r) => r.employee_id}
        dateFilterKey={false}
        exportFileName={`roster-vs-attended-${department}-${period}`}
        columns={[
          { key: 'name', header: 'Staff', sortable: true, render: (v, r) => <span><span className="font-medium">{v}</span><span className="block text-xs text-muted-foreground">{r.employee_number}</span></span> },
          { key: 'rostered_days', header: 'Rostered days', align: 'right', sortable: true },
          { key: 'attended_rostered', header: 'Attended', align: 'right', sortable: true },
          { key: 'absent', header: 'Absent', align: 'right', sortable: true, render: (v) => <span className={v > 0 ? 'text-destructive font-semibold' : ''}>{v}</span> },
          { key: 'late_days', header: 'Late (days)', align: 'right', sortable: true, render: (v, r) => (v ? `${v} · ${r.late_minutes} min` : '0') },
          { key: 'unrostered_attendance', header: 'Came in unrostered', align: 'right', sortable: true },
          { key: 'leave_days', header: 'On leave', align: 'right', sortable: true },
        ]}
        empty={{ icon: CalendarRange, title: 'No staff in this department' }}
      />
    </div>
  );
}

// ── Shift codes / colours ──────────────────────────────────────────────
function ShiftCodesDialog({ open, onOpenChange, shifts, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; shifts: Shift[]; onSaved: () => void }) {
  const [rows, setRows] = useState<Shift[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setRows(shifts.filter((s) => s.is_active !== false).map((s, i) => ({ ...s, color: s.color || PALETTE[i % PALETTE.length] }))); }, [open, shifts]);
  const set = (id: string, patch: Partial<Shift>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const save = async () => {
    setSaving(true);
    try {
      for (const r of rows) {
        await api(`/shifts/${r.id}`, { method: 'PUT', body: JSON.stringify({ code: r.code, kind: r.kind, color: r.color, early_window_min: r.early_window_min }) });
      }
      toast.success('Shift codes saved');
      onSaved();
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Shift codes</DialogTitle>
          <DialogDescription>The short code each shift has on the roster and in the Excel template. Shifts themselves (times) are set up under HR › Attendance.</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shifts yet — create them under HR › Attendance first.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_5rem_8rem_6.5rem] gap-2 items-end">
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{hm(r.start_time)}–{hm(r.end_time)}</p>
                </div>
                <div><Label className="text-xs">Code</Label><Input value={r.code || ''} maxLength={10} onChange={(e) => set(r.id, { code: e.target.value.toUpperCase() })} placeholder="M" /></div>
                <div>
                  <Label className="text-xs">Kind</Label>
                  <Combobox options={[{ value: 'work', label: 'Work' }, { value: 'on_call', label: 'On call' }]} value={r.kind || 'work'} onChange={(v) => set(r.id, { kind: v || 'work' })} />
                </div>
                <div>
                  <Label className="text-xs">Clock-in from</Label>
                  <div className="flex items-center gap-1"><Input type="number" min={0} max={240} value={r.early_window_min ?? 60} onChange={(e) => set(r.id, { early_window_min: Number(e.target.value) })} /><span className="text-xs text-muted-foreground">min</span></div>
                </div>
                <div className="col-span-4 flex gap-1.5 -mt-1">
                  {PALETTE.map((c) => (
                    <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => set(r.id, { color: c })}
                      className={cn('h-5 w-5 rounded-full border-2', r.color === c ? 'border-foreground' : 'border-transparent')} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">"Clock-in from" is how many minutes before the start staff may clock in when the roster rule is on.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!rows.length}>Save codes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
