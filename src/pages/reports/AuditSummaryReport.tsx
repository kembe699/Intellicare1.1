import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Users, Trophy, Zap, Loader2, ShieldAlert } from 'lucide-react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { StatusBadge, StatusBadgeTone } from '@/components/common';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { fmtCount, fmtDate, CsvColumn } from '@/utils/reportUtils';
import { toast } from 'sonner';

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

  const [dateFrom, setDateFrom] = useState(() => toLocalDateStr(new Date(Date.now() - 29 * 86400000)));
  const [dateTo, setDateTo] = useState(() => toLocalDateStr(new Date()));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AuditSummaryData | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [detailRow, setDetailRow] = useState<ActivityRow | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo, clinic_id: String(clinicId) });
      if (userFilter) params.set('userId', userFilter);
      const res = await authFetch(`/api/reports-v2/audit-summary?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load audit summary report');
      setData(await res.json());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load audit summary report');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, clinicId, userFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const byUser = data?.byUser || [];
  const activityRows = data?.activity.rows || [];

  // Top 3 action types per user, for the compact badge list in the summary table.
  const topActionsByUser = React.useMemo(() => {
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

  const csvColumns: CsvColumn[] = [
    { header: 'Timestamp', key: 'createdAt', transform: v => fmtDateTime(v) },
    { header: 'User', key: 'userName' },
    { header: 'Role', key: 'userRole' },
    { header: 'Module', key: 'module' },
    { header: 'Action', key: 'action' },
    { header: 'Entity Type', key: 'entityType' },
    { header: 'Entity ID', key: 'entityId' },
    { header: 'Description', key: 'description' },
    { header: 'Before', key: 'oldValues', transform: v => v ? JSON.stringify(v) : '' },
    { header: 'After', key: 'newValues', transform: v => v ? JSON.stringify(v) : '' },
    { header: 'IP Address', key: 'ipAddress' },
    { header: 'Status', key: 'status' },
  ];

  return (
    <>
    <ReportSubPageShell
      title="Staff Activity / Audit Log Summary"
      description="Who did what, when — staff action counts and the underlying chronological audit trail"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      csvData={activityRows}
      csvColumns={csvColumns}
      csvFilename={`audit-summary-${dateFrom}-${dateTo}.csv`}
    >
      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Staff filter ── */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <select
                className="h-8 text-sm rounded-md border border-input bg-transparent px-2"
                value={userFilter}
                onChange={e => setUserFilter(e.target.value)}
              >
                <option value="">All staff</option>
                {(data?.byUser || []).map(u => (
                  <option key={String(u.userId)} value={String(u.userId ?? '')}>{u.userName} ({u.userRole})</option>
                ))}
              </select>
            </div>
            {userFilter && (
              <div className="flex items-center gap-2 text-xs text-primary bg-primary/5 border border-primary/20 rounded-md px-2.5 py-1">
                Showing only {data?.byUser.find(u => String(u.userId ?? '') === userFilter)?.userName || 'this user'}'s activity
                <button type="button" className="underline hover:no-underline" onClick={() => setUserFilter('')}>Clear</button>
              </div>
            )}
          </div>

          {/* ── Stat tiles ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Total Actions Logged</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(data?.totals.totalActions)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">in selected period</p>
                </div>
                <Activity className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Active Staff Count</p>
                  <p className="text-2xl font-bold mt-1">{fmtCount(data?.totals.activeStaffCount)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">distinct users with activity</p>
                </div>
                <Users className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Most Active User</p>
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
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Most Common Action</p>
                  <p className="text-2xl font-bold mt-1 truncate">{data?.totals.mostCommonAction?.action ?? '—'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data?.totals.mostCommonAction ? `${fmtCount(data.totals.mostCommonAction.actionCount)} occurrences` : 'no activity in period'}
                  </p>
                </div>
                <Zap className="h-5 w-5 text-primary shrink-0" />
              </div>
            </div>
          </div>

          {/* ── Staff activity summary — clicking a row filters the activity log below to that user ── */}
          <div>
            <div className="mb-2">
              <h3 className="font-semibold text-sm">Staff Activity Summary</h3>
              <p className="text-xs text-muted-foreground">{fmtCount(byUser.length)} staff member{byUser.length === 1 ? '' : 's'} with logged activity {fmtDate(dateFrom)} — {fmtDate(dateTo)} &middot; click a row to filter the activity log below</p>
            </div>
            <AdvancedDataTable<ByUserRow>
              data={byUser}
              keyExtractor={(row) => String(row.userId ?? row.userName)}
              searchable
              searchPlaceholder="Search staff..."
              emptyMessage="No staff activity found for the selected period."
              onRowClick={(row) => setUserFilter(userFilter === String(row.userId ?? '') ? '' : String(row.userId ?? ''))}
              rowClassName={(row) => (String(row.userId ?? '') === userFilter ? 'bg-primary/5' : '')}
              columns={[
                { key: 'userName', header: 'User', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
                { key: 'userRole', header: 'Role', sortable: true, render: (v) => <span className="text-muted-foreground capitalize">{v}</span> },
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
                            label={`${a.action} ×${a.actionCount}`}
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

          {/* ── Chronological activity log ── */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="font-semibold text-sm">Activity Log</h3>
                <p className="text-xs text-muted-foreground">
                  Most recent {fmtCount(activityRows.length)}
                  {data?.activity.truncated ? ` of ${fmtCount(data.activity.totalCount)}` : ''} entries, newest first
                </p>
              </div>
              {data?.activity.truncated && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Capped at {fmtCount(data.activity.rowCap)} rows — narrow the date range or export CSV for the full set.
                </div>
              )}
            </div>
            <AdvancedDataTable<ActivityRow>
              data={activityRows}
              keyExtractor={(row) => row.id}
              searchable
              searchPlaceholder="Search activity log..."
              emptyMessage="No audit log entries found for the selected period."
              pagination={{ enabled: true, pageSize: 25, pageSizeOptions: [25, 50, 100] }}
              columns={[
                { key: 'createdAt', header: 'Timestamp', sortable: true, render: (v) => <span className="text-muted-foreground whitespace-nowrap">{fmtDateTime(v)}</span> },
                { key: 'userName', header: 'User', sortable: true, render: (v) => <span className="font-medium whitespace-nowrap">{v}</span> },
                { key: 'module', header: 'Module', sortable: true, render: (v) => <span className="text-muted-foreground whitespace-nowrap">{v}</span> },
                { key: 'action', header: 'Action', sortable: true, render: (v) => <span className="whitespace-nowrap"><StatusBadge status={v} map={{ [v]: actionTone(v) }} /></span> },
                {
                  key: 'entityType', header: 'Entity',
                  render: (_v, row) => <span className="text-muted-foreground whitespace-nowrap">{row.entityType ? `${row.entityType}${row.entityId ? ` #${row.entityId}` : ''}` : '—'}</span>,
                },
                {
                  key: 'description', header: 'Description',
                  render: (v) => <span className="text-muted-foreground max-w-[360px] truncate inline-block" title={v || undefined}>{v || '—'}</span>,
                },
                { key: 'status', header: 'Status', sortable: true, render: (v) => <StatusBadge status={v} map={STATUS_TONE_MAP} className="capitalize" /> },
                {
                  key: '__details', header: 'Details',
                  render: (_v, row) => {
                    const hasDetail = !!(row.oldValues || row.newValues);
                    return hasDetail ? (
                      <button type="button" className="text-primary underline hover:no-underline text-xs" onClick={() => setDetailRow(row)}>
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
    {detailRow && (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDetailRow(null)}>
        <div className="bg-card w-full max-w-lg rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center p-4 border-b bg-muted/30">
            <div>
              <h3 className="font-semibold text-sm">{detailRow.action}</h3>
              <p className="text-xs text-muted-foreground">{detailRow.userName} · {fmtDateTime(detailRow.createdAt)}</p>
            </div>
            <button type="button" className="text-muted-foreground hover:text-foreground text-sm" onClick={() => setDetailRow(null)}>✕</button>
          </div>
          <div className="p-4 space-y-4 overflow-auto">
            {detailRow.description && (
              <p className="text-sm">{detailRow.description}</p>
            )}
            {detailRow.entityType && (
              <p className="text-xs text-muted-foreground">{detailRow.entityType}{detailRow.entityId ? ` #${detailRow.entityId}` : ''}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Before</p>
                <pre className="text-xs bg-red-50 border border-red-100 rounded-md p-2.5 overflow-auto max-h-64 whitespace-pre-wrap break-words">
                  {detailRow.oldValues ? JSON.stringify(detailRow.oldValues, null, 2) : '—'}
                </pre>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">After</p>
                <pre className="text-xs bg-emerald-50 border border-emerald-100 rounded-md p-2.5 overflow-auto max-h-64 whitespace-pre-wrap break-words">
                  {detailRow.newValues ? JSON.stringify(detailRow.newValues, null, 2) : '—'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
