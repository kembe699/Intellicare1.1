import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { CalendarClock, Plus } from 'lucide-react';
import { TheatreOperation, TheatreRoom, STATUS_BADGE, ROOM_STATUS_BADGE, OUTCOME_LABEL, OUTCOME_BADGE, patientName, formatDuration } from './theatreShared';

export default function TheatreOperations() {
  const navigate = useNavigate();
  const { hasPrivilege } = useAuth();
  const canWrite = hasPrivilege('theatre.write');

  const [operations, setOperations] = useState<TheatreOperation[]>([]);
  const [rooms, setRooms] = useState<TheatreRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [markingReady, setMarkingReady] = useState<string | null>(null);

  const fetchOperations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/theatre/operations${statusFilter ? `?status=${statusFilter}` : ''}`, { credentials: 'include' });
      if (res.ok) setOperations(await res.json());
    } catch {
      toast.error('Failed to load operations');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await authFetch('/api/theatre/rooms', { credentials: 'include' });
      if (res.ok) setRooms(await res.json());
    } catch { /* rooms panel is a convenience, not critical to the page */ }
  }, []);

  useEffect(() => { fetchOperations(); }, [fetchOperations]);
  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const columns: Column<TheatreOperation>[] = [
    { key: 'procedure_name', header: 'Procedure', sortable: true, filterable: true },
    {
      key: 'patient_first_name', header: 'Patient', sortable: true,
      render: (_v, row) => `${patientName(row)}${row.patient_code ? ` (${row.patient_code})` : ''}`,
    },
    { key: 'room_name', header: 'Room', render: (v) => v || '—' },
    {
      key: 'surgeon_first_name', header: 'Surgeon',
      render: (_v, row) => row.surgeon_first_name ? `Dr. ${row.surgeon_first_name} ${row.surgeon_last_name}` : '—',
    },
    { key: 'status', header: 'Status', width: '120px', render: (v) => <Badge variant={STATUS_BADGE[v]}>{v.replace('_', ' ')}</Badge> },
    {
      key: 'outcome', header: 'Outcome', width: '130px',
      render: (v) => v ? <Badge variant={OUTCOME_BADGE[v]}>{OUTCOME_LABEL[v]}</Badge> : '—',
    },
    { key: 'scheduled_at', header: 'Scheduled', sortable: true, render: (v) => v ? new Date(v).toLocaleString() : '—' },
    { key: 'duration_minutes', header: 'Duration', width: '100px', render: (v, row) => row.status === 'completed' ? formatDuration(v) : '—' },
  ];

  // T4: the only way a room previously left "cleaning" (set automatically
  // when an operation completes) was a manual database fix — this is the
  // missing step, so a room doesn't stay blocked on the board indefinitely.
  const markRoomReady = async (roomId: string) => {
    setMarkingReady(roomId);
    try {
      const res = await authFetch(`/api/theatre/rooms/${roomId}/ready`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        toast.success('Room marked ready');
        fetchRooms();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to mark room ready');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setMarkingReady(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PageHeader title="Operations Board" icon={<CalendarClock />} subtitle="Scheduled, in-progress, and completed operations" />
          {canWrite && (
            <Button size="sm" className="gap-1.5" onClick={() => navigate('/theatre/operations/new')}>
              <Plus className="h-3.5 w-3.5" /> Schedule Operation
            </Button>
          )}
        </div>

        {rooms.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2.5">Theatre Rooms</p>
              <div className="flex flex-wrap gap-2">
                {rooms.map((room) => (
                  <div key={room.id} className="flex items-center gap-2 border rounded-md px-3 py-1.5">
                    <span className="text-sm font-medium">{room.name}</span>
                    <Badge variant={ROOM_STATUS_BADGE[room.status]}>{room.status.replace('_', ' ')}</Badge>
                    {canWrite && room.status === 'cleaning' && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={markingReady === room.id} onClick={() => markRoomReady(room.id)}>
                        Mark Ready
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? <LoadingState message="Loading operations..." /> : (
          <AdvancedDataTable
            data={operations}
            columns={columns}
            emptyMessage="No operations found."
            pagination={{ enabled: true, pageSize: 25 }}
            keyExtractor={(op) => op.id}
            onRowClick={(op) => navigate(`/theatre/operations/${op.id}`)}
            searchable
            searchPlaceholder="Search operations..."
            exportable
            exportFileName="theatre-operations"
            toolbarExtra={
              <Combobox
                options={[{ value: '', label: 'All' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'in_progress', label: 'In Progress' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }]}
                value={statusFilter} onChange={setStatusFilter} searchPlaceholder="Search status..." className="h-9 w-[160px]"
              />
            }
          />
        )}
      </div>
    </AppLayout>
  );
}
