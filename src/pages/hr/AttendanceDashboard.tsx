import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { formatDateTime, formatDate } from '@/lib/format';
import { Clock, Loader2, Download, Pencil } from 'lucide-react';

const today = () => new Date().toISOString().split('T')[0];
const weekAgo = () => new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  present: 'success', clocked_out: 'neutral', on_leave: 'warning', absent: 'danger',
};

function TodayBoardTab() {
  const [board, setBoard] = useState<any[]>([]);
  const [counts, setCounts] = useState<any>({});
  const [loading, setLoading] = useState(true);

  const fetchBoard = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/attendance/today-board');
      if (res.ok) { const data = await res.json(); setBoard(data.board); setCounts(data.counts); }
      else toast.error('Failed to load today\'s board.');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchBoard(); }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          ['Present', counts.present, 'success'],
          ['Clocked out', counts.clocked_out, 'neutral'],
          ['On leave', counts.on_leave, 'warning'],
          ['Absent', counts.absent, 'danger'],
          ['Late', counts.late, 'warning'],
          ['Missing clock-out', counts.missing_clock_out, 'danger'],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-card rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold font-mono">{value ?? 0}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <AdvancedDataTable
        data={board}
        loading={loading}
        searchable
        columns={[
          { key: 'employee_number', header: 'Employee #', sortable: true },
          { key: 'name', header: 'Name', sortable: true },
          { key: 'department', header: 'Department', render: (v) => v || '—' },
          { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} map={STATUS_TONE} label={String(v).replace(/_/g, ' ')} /> },
          { key: 'first_in', header: 'First In', render: (v) => v ? formatDateTime(v) : '—' },
          { key: 'last_out', header: 'Last Out', render: (v) => v ? formatDateTime(v) : '—' },
          { key: 'late_minutes', header: 'Late (min)', align: 'right', render: (v) => v > 0 ? v : '—' },
        ]}
        keyExtractor={(r) => r.employee_id}
        emptyMessage="No active employees found."
      />
    </div>
  );
}

function ReportsTab() {
  const [from, setFrom] = useState(weekAgo());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/attendance/reports?from=${from}&to=${to}`);
      if (res.ok) setRows(await res.json());
      else toast.error('Failed to generate report.');
    } finally { setLoading(false); }
  };

  useEffect(() => { run(); }, []);

  const exportCsv = () => {
    window.open(`/api/attendance/reports?from=${from}&to=${to}&format=csv`, '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button onClick={run} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Run report</Button>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
      </div>
      <AdvancedDataTable
        data={rows}
        loading={loading}
        searchable
        exportable
        exportFileName={`attendance-report-${from}-to-${to}`}
        columns={[
          { key: 'employee_number', header: 'Employee #', sortable: true },
          { key: 'name', header: 'Name', sortable: true },
          { key: 'department', header: 'Department', render: (v) => v || '—' },
          { key: 'days_present', header: 'Days Present', align: 'right' },
          { key: 'total_hours', header: 'Hours', align: 'right' },
          { key: 'late_count', header: 'Late Count', align: 'right' },
          { key: 'late_minutes_total', header: 'Late Minutes', align: 'right' },
          { key: 'early_leave_count', header: 'Early Leaves', align: 'right' },
          { key: 'leave_days', header: 'Leave Days', align: 'right' },
        ]}
        keyExtractor={(r) => r.employee_id}
        emptyMessage="No data for this range."
      />
    </div>
  );
}

function CorrectDialog({ record, onClose, onSaved }: { record: any; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [type, setType] = useState(record?.type || 'in');
  const [occurredAt, setOccurredAt] = useState(record ? new Date(record.occurred_at).toISOString().slice(0, 16) : '');
  const [saving, setSaving] = useState(false);

  if (!record) return null;

  const save = async () => {
    if (!reason.trim()) { toast.error('A reason is required.'); return; }
    setSaving(true);
    try {
      const res = await authFetch(`/api/attendance/records/${record.id}/correct`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, occurred_at: new Date(occurredAt).toISOString(), reason }),
      });
      if (res.ok) { toast.success('Record corrected.'); onSaved(); onClose(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to correct record.'); }
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct attendance record</DialogTitle>
          <DialogDescription>This change is audited — a reason is required.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <div className="flex gap-2">
              <Button type="button" variant={type === 'in' ? 'default' : 'outline'} onClick={() => setType('in')}>Clock In</Button>
              <Button type="button" variant={type === 'out' ? 'default' : 'outline'} onClick={() => setType('out')}>Clock Out</Button>
            </div>
          </div>
          <div>
            <Label>Time</Label>
            <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </div>
          <div>
            <Label>Reason (required)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Employee forgot phone, confirmed via CCTV" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save correction</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RawLogTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [correcting, setCorrecting] = useState<any>(null);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const url = statusFilter ? `/api/attendance/records?status=${statusFilter}` : '/api/attendance/records';
      const res = await authFetch(url);
      if (res.ok) setRows(await res.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchRows(); }, [statusFilter]);

  return (
    <div className="space-y-4">
      {correcting && <CorrectDialog record={correcting} onClose={() => setCorrecting(null)} onSaved={fetchRows} />}
      <div className="flex gap-2">
        {['', 'accepted', 'rejected', 'corrected'].map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? 'default' : 'outline'} onClick={() => setStatusFilter(s)}>
            {s || 'All'}
          </Button>
        ))}
      </div>
      <AdvancedDataTable
        data={rows}
        loading={loading}
        searchable
        columns={[
          { key: 'employee_number', header: 'Employee #' },
          { key: 'first_name', header: 'Name', render: (_v, r) => `${r.first_name} ${r.last_name}` },
          { key: 'site_name', header: 'Site' },
          { key: 'type', header: 'Type', render: (v) => v === 'in' ? 'Clock In' : 'Clock Out' },
          { key: 'occurred_at', header: 'Time', render: (v) => formatDateTime(v) },
          { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} map={{ accepted: 'success', rejected: 'danger', corrected: 'warning' }} /> },
          { key: 'reject_reason', header: 'Reason', render: (v) => v || '—' },
          { key: 'distance_m', header: 'Distance (m)', align: 'right', render: (v) => v != null ? Math.round(v) : '—' },
          {
            key: 'actions', header: '', render: (_v, r) => (
              <Button size="sm" variant="ghost" onClick={() => setCorrecting(r)}><Pencil className="h-4 w-4" /></Button>
            ),
          },
        ]}
        keyExtractor={(r) => r.id}
        emptyMessage="No attendance records yet."
      />
    </div>
  );
}

function PortalAccessTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await authFetch('/api/attendance/portal-access');
        if (res.ok) setRows(await res.json());
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <AdvancedDataTable
      data={rows}
      loading={loading}
      searchable
      columns={[
        { key: 'employee_number', header: 'Employee #' },
        { key: 'first_name', header: 'Name', render: (_v, r) => `${r.first_name} ${r.last_name}` },
        { key: 'department', header: 'Department', render: (v) => v || '—' },
        { key: 'portal_access_enabled', header: 'Access', render: (v) => <StatusBadge status={v ? 'enabled' : 'disabled'} map={{ enabled: 'success', disabled: 'neutral' }} label={v ? 'Enabled' : 'Disabled'} /> },
        { key: 'portal_pin_set_at', header: 'PIN Set', render: (v) => v ? formatDate(v) : 'Not yet' },
        { key: 'portal_last_login_at', header: 'Last Login', render: (v) => v ? formatDateTime(v) : 'Never' },
        { key: 'is_locked', header: 'Locked', render: (v) => v ? <StatusBadge status="locked" map={{ locked: 'danger' }} label="Locked" /> : '—' },
      ]}
      keyExtractor={(r) => r.id}
      emptyMessage="No employees have portal access yet. Grant it from an employee's profile."
    />
  );
}

export default function AttendanceDashboard() {
  return (
    <AppLayout>
      <PageHeader title="Attendance" subtitle="Today's board, reports, and the raw clock-in/out log" icon={<Clock />} />
      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="log">Raw Log</TabsTrigger>
          <TabsTrigger value="portal">Portal Access</TabsTrigger>
        </TabsList>
        <TabsContent value="today"><TodayBoardTab /></TabsContent>
        <TabsContent value="reports"><ReportsTab /></TabsContent>
        <TabsContent value="log"><RawLogTab /></TabsContent>
        <TabsContent value="portal"><PortalAccessTab /></TabsContent>
      </Tabs>
    </AppLayout>
  );
}
