import React, { useState, useEffect } from 'react';
import { CalendarClock, Check, Loader2, Plus, UserCheck, Ban } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { fetchPatientDirectory, DirectoryPerson } from '@/lib/patientDirectory';
import { useAuth } from '@/contexts/AuthContext';

// Follow-up / next-visit scheduling — booked from a patient's Visit Summary
// (by the doctor who wants to see them again) or directly here (reception,
// for a walk-in follow-up). Not a time-slot calendar: just a date, who it's
// for, and who it's with. On the day, "Queue" hands the patient straight
// into the normal consultation queue, pre-assigned to that same doctor.
interface AppointmentRow {
  id: string;
  participant_id: string;
  doctor_id: number | null;
  scheduled_date: string;
  reason: string | null;
  status: 'scheduled' | 'queued' | 'cancelled';
  first_name: string;
  last_name: string;
  participant_number: string;
  doctor_name: string | null;
  created_by_name: string | null;
}

interface DoctorOption { id: number; display_name: string; }

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'queued', label: 'Queued' },
  { value: 'cancelled', label: 'Cancelled' },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: 'bg-amber-100 text-amber-700',
    queued: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-slate-100 text-slate-500',
  };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap ${map[status] || map.cancelled}`}>{status}</span>;
}

export default function Appointments() {
  const { hasPrivilege } = useAuth();
  const canWrite = hasPrivilege('appointments.write');

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('scheduled');
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [queuingId, setQueuingId] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [participantId, setParticipantId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPatientDirectory().then(({ people, failed }) => {
      setPeople(people.filter(p => p.source === 'lis'));
      if (failed.length > 0) toast.error(`Could not load the patient list from: ${failed.join(', ')}`);
    });
    authFetch('/api/users?all=true', { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then((users: any[]) => setDoctors(users.filter(u => u.role === 'doctor' && u.is_active)))
      .catch(() => setDoctors([]));
  }, []);

  const fetchRows = async (status = statusFilter) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/appointments${status ? `?status=${status}` : ''}`, { credentials: 'include' });
      if (res.ok) setRows(await res.json());
    } catch (e) {
      console.error('Failed to fetch appointments', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(statusFilter); }, [statusFilter]);

  const resetForm = () => {
    setParticipantId(''); setDoctorId(''); setScheduledDate(''); setReason('');
  };

  const handleSchedule = async () => {
    if (!participantId) { toast.error('Select a patient'); return; }
    if (!scheduledDate) { toast.error('Pick a date'); return; }
    setSaving(true);
    try {
      const res = await authFetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ participant_id: participantId, doctor_id: doctorId || undefined, scheduled_date: scheduledDate, reason: reason.trim() || undefined }),
      });
      if (res.ok) {
        toast.success('Appointment scheduled');
        setOpen(false);
        resetForm();
        fetchRows();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to schedule appointment');
      }
    } catch {
      toast.error('Network error scheduling appointment');
    } finally {
      setSaving(false);
    }
  };

  const handleQueue = async (row: AppointmentRow) => {
    setQueuingId(row.id);
    try {
      const res = await authFetch(`/api/appointments/${row.id}/queue`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        toast.success(`${row.first_name} ${row.last_name} queued${row.doctor_name ? ` to Dr. ${row.doctor_name}` : ''}`);
        fetchRows();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to queue patient');
      }
    } catch {
      toast.error('Network error queuing patient');
    } finally {
      setQueuingId(null);
    }
  };

  const handleCancel = async (row: AppointmentRow) => {
    try {
      const res = await authFetch(`/api/appointments/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (res.ok) { toast.success('Appointment cancelled'); fetchRows(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to cancel'); }
    } catch {
      toast.error('Network error cancelling appointment');
    }
  };

  const columns: Column<AppointmentRow>[] = [
    { key: 'scheduled_date', header: 'Date', render: (v) => <span className="whitespace-nowrap font-medium">{new Date(v).toLocaleDateString()}</span> },
    { key: 'first_name', header: 'Patient', render: (_v, row) => <div><p className="font-medium text-sm">{row.first_name} {row.last_name}</p><p className="text-xs text-muted-foreground font-mono">{row.participant_number}</p></div> },
    { key: 'doctor_name', header: 'Doctor', render: (v) => v ? `Dr. ${v}` : <span className="text-muted-foreground">Any doctor</span> },
    { key: 'reason', header: 'Reason', render: (v) => <span className="text-sm">{v || '-'}</span> },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} /> },
    { key: 'created_by_name', header: 'Booked By', render: (v) => <span className="text-xs text-muted-foreground">{v || '-'}</span> },
    {
      key: 'id', header: 'Action',
      render: (_v, row) => row.status !== 'scheduled' ? <span className="text-xs text-muted-foreground">{row.status === 'queued' ? 'Queued' : '-'}</span> : (
        <div className="flex gap-1.5">
          <Button size="sm" className="h-7 px-2 gap-1" disabled={queuingId === row.id} onClick={() => handleQueue(row)}>
            {queuingId === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />} Queue
          </Button>
          {canWrite && (
            <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-muted-foreground" onClick={() => handleCancel(row)}>
              <Ban className="w-3 h-3" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <PageHeader title="Appointments" icon={<CalendarClock />} className="mb-3" actions={
          <Button className="gap-1.5" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> New Appointment</Button>
        } />

        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-semibold text-muted-foreground">Status:</span>
          <Combobox options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} className="w-44 h-9" searchPlaceholder="Search..." />
        </div>

        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <AdvancedDataTable<AppointmentRow>
            data={rows}
            keyExtractor={(r) => r.id}
            loading={loading}
            emptyMessage="No appointments found"
            searchable
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            columns={columns}
          />
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarClock className="w-5 h-5" /> Schedule Appointment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Patient *</label>
              <Combobox
                options={people.map(p => ({ value: p.id, label: `${p.label}${p.code ? ` (${p.code})` : ''}` }))}
                value={participantId}
                onChange={setParticipantId}
                placeholder="Search patient..."
                searchPlaceholder="Search patient..."
                className="mt-1 h-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Date *</label>
                <Input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className="mt-1" min={new Date().toISOString().split('T')[0]} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Doctor</label>
                <Combobox
                  options={[{ value: '', label: 'Any doctor' }, ...doctors.map(d => ({ value: String(d.id), label: `Dr. ${d.display_name}` }))]}
                  value={doctorId}
                  onChange={setDoctorId}
                  placeholder="Any doctor"
                  searchPlaceholder="Search doctors..."
                  className="mt-1 h-9"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Reason</label>
              <Textarea placeholder="e.g. Review labs, follow-up on treatment" value={reason} onChange={e => setReason(e.target.value)} rows={2} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="gap-1.5" disabled={saving} onClick={handleSchedule}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Schedule
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
