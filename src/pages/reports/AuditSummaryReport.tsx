import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, Users, Trophy, Zap, Calendar, RefreshCw, Download, Printer, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReportSubPageShell } from './ReportSubPageShell';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { ReportLetterhead } from './ReportLetterhead';
import { StatusBadge, StatusBadgeTone, LoadingState } from '@/components/common';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { fmtCount, fmtDate, CsvColumn, getDatePresets, exportCSV, triggerPrint } from '@/utils/reportUtils';
import { toast } from '@/lib/notify';

// Same letterhead + "nothing loads until View is clicked" shape as the rest
// of the Reports Center (Clinical/Inventory/Procurement/Accounting Reports).
// This page isn't a dropdown of distinct report *types* — the audit trail is
// one dataset — so instead of a mode selector, the toolbar carries filters:
// Staff, Action, and Outcome (success/failure), on top of the date range.
// The Action dropdown is built from the real, complete history of action
// values this clinic has ever logged (GET /actions, unscoped by date), not
// just whatever occurred in the currently selected period — picking an
// action that never happened in this window should still be a valid pick
// that correctly returns zero rows, not an option that was never offered.

// ── Types ────────────────────────────────────────────────────────────────

interface ActivityRow {
  id: string;
  userId: string | number | null;
  userName: string;
  userRole: string;
  module: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  description: string | null;
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  ipAddress: string | null;
  status: string;
  createdAt: string;
}

interface ByUserRow {
  userId: string | number | null;
  userName: string;
  userRole: string;
  actionCount: number;
  lastActionAt: string;
}

interface ByUserActionRow {
  userId: string | number | null;
  userName: string;
  action: string;
  actionCount: number;
}

interface AuditSummaryData {
  period: { dateFrom: string; dateTo: string };
  clinicId: number;
  totals: {
    totalActions: number;
    activeStaffCount: number;
    mostActiveUser: { userId: string | number; userName: string; actionCount: number } | null;
    mostCommonAction: { action: string; actionCount: number } | null;
  };
  byUser: ByUserRow[];
  byUserAction: ByUserActionRow[];
  byAction: { action: string; module: string; actionCount: number }[];
  activity: {
    rows: ActivityRow[];
    rowCap: number;
    totalCount: number;
    truncated: boolean;
  };
}

const STATUS_TONE_MAP: Record<string, StatusBadgeTone> = {
  success: 'success',
  failure: 'danger',
  failed: 'danger',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All outcomes' },
  { value: 'success', label: 'Successful only' },
  { value: 'failure', label: 'Failed only' },
];

/** Derives a badge tone from an action string via loose keyword matching —
 * action values are free-form (LOGIN, PO_STATUS_APPROVED, EXPENSE_CREATED,
 * ...) so this isn't an exact lookup map. */
function actionTone(action: string): StatusBadgeTone {
  const a = (action || '').toUpperCase();
  if (a.includes('FAIL')) return 'danger';
  if (a.includes('DELETE')) return 'danger';
  if (a.includes('LOGOUT')) return 'neutral';
  if (a.includes('LOGIN')) return 'info';
  if (a.includes('APPROV')) return 'primary';
  if (a.includes('CREATE') || a.includes('PAID')) return 'success';
  if (a.includes('UPDATE') || a.includes('EDIT') || a.includes('STATUS')) return 'warning';
  return 'neutral';
}

/** Turns a raw action value like "BILL_ITEM_VOIDED" into "Bill Item Voided" for the dropdown. */
function humanizeAction(action: string): string {
  return (action || '')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(w => w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Renders a before/after field value for the diff table — never raw `[object Object]`, never a bare "null". */
function formatDiffValue(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const fmtDateTime = (val?: string | null): string => {
  if (!val) return '—';
  const d = new Date(String(val).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
};

// ── Component ────────────────────────────────────────────────────────────

export default function AuditSummaryReport() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const presets = getDatePresets();

  const [dateFrom, setDateFrom] = useState(() => toLocalDateStr(new Date(Date.now() - 29 * 86400000)));
  const [dateTo, setDateTo] = useState(() => toLocalDateStr(new Date()));
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [data, setData] = useState<AuditSummaryData | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detailRow, setDetailRow] = useState<ActivityRow | null>(null);

  // Full staff roster + the complete real action catalog — fetched once on
  // mount so both filter dropdowns are populated before the first View
  // click, not dependent on whatever the currently loaded report contains.
  const [staffRoster, setStaffRoster] = useState<{ id: number | string; display_name: string; role: string }[]>([]);
  const [allActions, setAllActions] = useState<string[]>([]);

  useEffect(() => {
    if (!clinicId) return;
    authFetch(`/api/users/clinic/${clinicId}`)
      .then(res => (res.ok ? res.json() : []))
      .then(list => setStaffRoster(Array.isArray(list) ? list : []))
      .catch(() => setStaffRoster([]));
    authFetch(`/api/reports-v2/audit-summary/actions?clinic_id=${clinicId}`)
      .then(res => (res.ok ? res.json() : { actions: [] }))
      .then(json => setAllActions(Array.isArray(json.actions) ? json.actions : []))
      .catch(() => setAllActions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  // Takes an optional override so the "click a staff row to drill down"
  // interaction below can fetch with the new userId immediately — setState
  // is async, so reading the just-set userFilter from this closure on the
  // very next line would still see the old value.
  const fetchData = useCallback(async (overrides?: { userId?: string }) => {
    setLoading(true);
    try {
      const effectiveUserId = overrides?.userId !== undefined ? overrides.userId : userFilter;
      const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: String(clinicId) });
      if (effectiveUserId) params.set('userId', effectiveUserId);
      if (actionFilter) params.set('action', actionFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await authFetch(`/api/reports-v2/audit-summary?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load audit summary report');
      setData(await res.json());
      setGeneratedAt(new Date());
      setHasLoaded(true);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load audit summary report');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, clinicId, userFilter, actionFilter, statusFilter]);

  const handlePreset = (label: string) => {
    const p = presets.find(x => x.label === label);
    if (!p) return;
    setDateFrom(p.from);
    setDateTo(p.to);
  };

  const byUser = data?.byUser || [];
  const activityRows = data?.activity.rows || [];
  const numberedByUser = useMemo(() => byUser.map((r, i) => ({ ...r, no: i + 1 })), [byUser]);
  const numberedActivity = useMemo(() => activityRows.map((r, i) => ({ ...r, no: i + 1 })), [activityRows]);

  // Top 3 action types per user, for the compact badge list in the summary table.
  const topActionsByUser = useMemo(() => {
    const map = new Map<string, ByUserActionRow[]>();
    (data?.byUserAction || []).forEach(row => {
      const key = String(row.userId ?? row.userName);
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    });
    map.forEach(list => list.sort((a, b) => b.actionCount - a.actionCount));
    return map;
  }, [data?.byUserAction]);

  const userOptions = useMemo(() => [
    { value: '', label: 'All staff' },
    ...staffRoster.map(u => ({ value: String(u.id), label: `${u.display_name}${u.role ? ` (${u.role})` : ''}` })),
  ], [staffRoster]);

  const actionOptions = useMemo(() => [
    { value: '', label: 'All actions' },
    ...allActions.map(a => ({ value: a, label: humanizeAction(a) })),
  ], [allActions]);

  const csvColumns: CsvColumn[] = [
    { header: 'Date', key: 'createdAt', transform: v => fmtDateTime(v) },
    { header: 'User', key: 'userName' },
    { header: 'Role', key: 'userRole' },
    { header: 'Module', key: 'module' },
    { header: 'Action', key: 'action' },
    { header: 'Entity Type', key: 'entityType' },
    { header: 'Entity ID', key: 'entityId' },
    { header: 'Outcome', key: 'status' },
    { header: 'Note / Reason', key: 'description' },
    { header: 'Before', key: 'oldValues', transform: v => v ? JSON.stringify(v) : '' },
    { header: 'After', key: 'newValues', transform: v => v ? JSON.stringify(v) : '' },
    { header: 'IP Address', key: 'ipAddress' },
  ];
  const handleExportCSV = () => exportCSV(activityRows, csvColumns, `audit-log-${dateFrom}-${dateTo}.csv`);

  return (
    <>
    <ReportSubPageShell
      title="Staff Activity / Audit Log"
      description="Who did what, when, and whether it succeeded — every logged action across the system."
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      hideControls
    >
      {/* Filters + letterhead + stat tiles, in normal document flow (not
          sticky) — scrolls away with the page like the rest of the report. */}
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-4 mb-6 bg-background border-b border-border print:static print:mx-0 print:px-0 print:pt-0 print:pb-0 print:mb-0 print:border-0">
        <div className="flex flex-wrap items-end gap-3 mb-4 print:hidden">
          <Combobox
            options={userOptions}
            value={userFilter}
            onChange={setUserFilter}
            placeholder="All staff"
            searchPlaceholder="Search staff..."
            className="w-[220px] h-9 text-sm"
          />
          <Combobox
            options={actionOptions}
            value={actionFilter}
            onChange={setActionFilter}
            placeholder="All actions"
            searchPlaceholder="Search actions..."
            className="w-[220px] h-9 text-sm"
          />
          <Combobox
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="All outcomes"
            searchPlaceholder="Search..."
            className="w-[160px] h-9 text-sm"
          />

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

          <Button size="sm" onClick={() => fetchData()} disabled={loading} className="h-9 gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            View
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => fetchData()} disabled={loading} className="h-9 gap-1.5">
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

        <ReportLetterhead title="Staff Activity / Audit Log" dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} className="mb-0" />

        {/* ── Stat tiles ── */}
        {hasLoaded && data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Total Actions Logged</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(data?.totals.totalActions)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">matching the filters above</p>
                </div>
                <Activity className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Active Staff Count</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(data?.totals.activeStaffCount)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">distinct users with activity</p>
                </div>
                <Users className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Most Active User</p>
                  <p className="text-2xl font-bold mt-1 truncate">{data?.totals.mostActiveUser?.userName ?? '—'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data?.totals.mostActiveUser ? `${fmtCount(data.totals.mostActiveUser.actionCount)} actions` : 'no activity in period'}
                  </p>
                </div>
                <Trophy className="h-5 w-5 text-primary shrink-0" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Most Common Action</p>
                  <p className="text-2xl font-bold mt-1 truncate">{data?.totals.mostCommonAction ? humanizeAction(data.totals.mostCommonAction.action) : '—'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data?.totals.mostCommonAction ? `${fmtCount(data.totals.mostCommonAction.actionCount)} occurrences` : 'no activity in period'}
                  </p>
                </div>
                <Zap className="h-5 w-5 text-primary shrink-0" />
              </div>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <LoadingState message="Loading audit log..." />
      ) : !hasLoaded ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed border-border rounded-md">
          Pick filters and a date range above, then click View.
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Staff activity summary — clicking a row filters the activity log below to that user ── */}
          <div className="print:hidden">
            <div className="mb-1.5 print:hidden">
              <p className="text-xs text-muted-foreground">{fmtCount(byUser.length)} staff member{byUser.length === 1 ? '' : 's'} with logged activity {fmtDate(dateFrom)} — {fmtDate(dateTo)} &middot; click a row to filter the activity log below</p>
            </div>
            <AdvancedDataTable<ByUserRow & { no: number }>
              title="Staff Activity Summary"
              data={numberedByUser}
              keyExtractor={(row) => String(row.userId ?? row.userName)}
              searchable
              searchPlaceholder="Search staff..."
              emptyMessage="No staff activity found for the selected filters."
              maxRows={15}
              onRowClick={(row) => {
                const newUserId = userFilter === String(row.userId ?? '') ? '' : String(row.userId ?? '');
                setUserFilter(newUserId);
                fetchData({ userId: newUserId });
              }}
              rowClassName={(row) => (String(row.userId ?? '') === userFilter ? 'bg-primary/5' : '')}
              columns={[
                { key: 'no', header: 'No', width: '56px', render: (v) => <span className="text-muted-foreground tabular-nums">{v}</span> },
                { key: 'userName', header: 'User', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
                { key: 'userRole', header: 'Role', sortable: true, render: (v) => <span className="text-muted-foreground">{humanizeAction(v)}</span> },
                { key: 'actionCount', header: 'Total Actions', align: 'right', sortable: true, render: (v) => <span className="font-mono">{fmtCount(v)}</span> },
                {
                  key: '__topActions', header: 'Top Action Types',
                  render: (_v, row) => {
                    const key = String(row.userId ?? row.userName);
                    const topActions = (topActionsByUser.get(key) || []).slice(0, 3);
                    return (
                      <div className="flex flex-wrap gap-1">
                        {topActions.map(a => (
                          <StatusBadge
                            key={a.action}
                            status={a.action}
                            map={{ [a.action]: actionTone(a.action) }}
                            label={`${humanizeAction(a.action)} ×${a.actionCount}`}
                          />
                        ))}
                      </div>
                    );
                  },
                },
                { key: 'lastActionAt', header: 'Last Active', sortable: true, render: (v) => <span className="text-muted-foreground">{fmtDateTime(v)}</span> },
              ]}
            />
          </div>

          {/* ── Chronological activity log — who did what, when, and whether it succeeded ── */}
          <div>
            <div className="mb-1.5 print:hidden">
              <p className="text-xs text-muted-foreground">
                Most recent {fmtCount(activityRows.length)}
                {data?.activity.truncated ? ` of ${fmtCount(data.activity.totalCount)}` : ''} entries, newest first
              </p>
            </div>
            <AdvancedDataTable<ActivityRow & { no: number }>
              title="Activity Log"
              data={numberedActivity}
              keyExtractor={(row) => row.id}
              searchable
              searchPlaceholder="Search activity log..."
              emptyMessage="No audit log entries found for the selected filters."
              pagination={{ enabled: true, pageSize: 25, pageSizeOptions: [25, 50, 100] }}
              maxRows={15}
              columns={[
                { key: 'no', header: 'No', width: '56px', render: (v) => <span className="text-muted-foreground tabular-nums">{v}</span> },
                { key: 'createdAt', header: 'Date & Time', sortable: true, render: (v) => <span className="text-muted-foreground whitespace-nowrap">{fmtDateTime(v)}</span> },
                { key: 'userName', header: 'User', sortable: true, render: (v) => <span className="font-medium whitespace-nowrap">{v}</span> },
                { key: 'module', header: 'Module', sortable: true, render: (v) => <span className="text-muted-foreground whitespace-nowrap">{humanizeAction(v)}</span> },
                { key: 'action', header: 'Action', sortable: true, render: (v) => <span className="whitespace-nowrap"><StatusBadge status={v} map={{ [v]: actionTone(v) }} label={humanizeAction(v)} /></span> },
                {
                  key: 'entityType', header: 'Entity',
                  render: (_v, row) => <span className="text-muted-foreground whitespace-nowrap">{row.entityType ? `${row.entityType}${row.entityId ? ` #${row.entityId}` : ''}` : '—'}</span>,
                },
                { key: 'status', header: 'Outcome', sortable: true, render: (v) => <StatusBadge status={v} map={STATUS_TONE_MAP} className="capitalize" /> },
                {
                  key: 'description', header: 'Note / Reason',
                  render: (v) => <span className="text-muted-foreground max-w-[360px] truncate inline-block" title={v || undefined}>{v || '—'}</span>,
                },
                {
                  key: '__details', header: 'Details',
                  render: (_v, row) => {
                    const hasDetail = !!(row.oldValues || row.newValues);
                    return hasDetail ? (
                      <button type="button" className="text-primary underline hover:no-underline text-xs print:hidden" onClick={() => setDetailRow(row)}>
                        View
                      </button>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    );
                  },
                },
              ]}
            />
          </div>
        </div>
      )}
    </ReportSubPageShell>

    {/* ── Action detail modal — before/after values for a void, cancel, update, etc. ── */}
    <Dialog open={!!detailRow} onOpenChange={(open) => { if (!open) setDetailRow(null); }}>
      <DialogContent className="p-0 max-w-2xl max-h-[85vh] flex flex-col">
        {detailRow && (
        <>
          <div className="flex justify-between items-center p-4 pr-12 border-b bg-muted/30">
            <div>
              <h3 className="font-semibold text-sm">{humanizeAction(detailRow.action)}</h3>
              <p className="text-xs text-muted-foreground">{detailRow.userName} · {fmtDateTime(detailRow.createdAt)}</p>
            </div>
          </div>
          <div className="p-4 space-y-4 overflow-auto">
            {detailRow.description && (
              <p className="text-sm">{detailRow.description}</p>
            )}
            {detailRow.entityType && (
              <p className="text-xs text-muted-foreground">{detailRow.entityType}{detailRow.entityId ? ` #${detailRow.entityId}` : ''}</p>
            )}
            {(detailRow.oldValues || detailRow.newValues) ? (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-info-bg dark:bg-info/40 border-b border-border text-left">
                      <th scope="col" className="px-2.5 py-2 font-semibold text-foreground">Field</th>
                      <th scope="col" className="px-2.5 py-2 font-semibold text-destructive">Before</th>
                      <th scope="col" className="px-2.5 py-2 font-semibold text-success">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(new Set([
                      ...Object.keys(detailRow.oldValues || {}),
                      ...Object.keys(detailRow.newValues || {}),
                    ])).sort().map(key => {
                      const oldV = detailRow.oldValues?.[key];
                      const newV = detailRow.newValues?.[key];
                      const changed = JSON.stringify(oldV ?? null) !== JSON.stringify(newV ?? null);
                      return (
                        <tr key={key} className={cn('border-b border-border/60 last:border-0', changed && 'bg-warning-bg dark:bg-warning/20')}>
                          <td className="px-2.5 py-1.5 align-top font-medium text-foreground whitespace-nowrap">{humanizeAction(key)}</td>
                          <td className="px-2.5 py-1.5 align-top text-destructive break-words max-w-[160px]">{formatDiffValue(oldV)}</td>
                          <td className="px-2.5 py-1.5 align-top text-success break-words max-w-[160px]">{formatDiffValue(newV)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No before/after values recorded for this action.</p>
            )}
          </div>
        </>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
