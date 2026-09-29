import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { CalendarClock, Plus } from 'lucide-react';
import { TheatreOperation, STATUS_BADGE, OUTCOME_LABEL, OUTCOME_BADGE, patientName, formatDuration } from './theatreShared';

export default function TheatreOperations() {
  const navigate = useNavigate();
  const { hasPrivilege } = useAuth();
  const canWrite = hasPrivilege('theatre.write');

  const [operations, setOperations] = useState<TheatreOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

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

  useEffect(() => { fetchOperations(); }, [fetchOperations]);

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

        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <Combobox
                options={[{ value: '', label: 'All' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'in_progress', label: 'In Progress' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }]}
                value={statusFilter} onChange={setStatusFilter} searchPlaceholder="Search status..." className="h-9"
              />
            </div>
          </CardContent>
        </Card>

        {loading ? <LoadingState message="Loading operations..." /> : (
          <div className="space-y-2.5">
            {operations.length === 0 && (
              <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No operations found.</CardContent></Card>
            )}
            {operations.map((op) => (
              <Card key={op.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate(`/theatre/operations/${op.id}`)}>
                <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant={STATUS_BADGE[op.status]}>{op.status.replace('_', ' ')}</Badge>
                      {op.outcome && <Badge variant={OUTCOME_BADGE[op.outcome]}>{OUTCOME_LABEL[op.outcome]}</Badge>}
                      {op.scheduled_at && <span className="text-xs text-muted-foreground">{new Date(op.scheduled_at).toLocaleString()}</span>}
                    </div>
                    <p className="font-medium">{op.procedure_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {patientName(op)} {op.patient_code ? `(${op.patient_code})` : ''}
                      {op.room_name ? ` — ${op.room_name}` : ''}
                      {op.surgeon_first_name ? ` — Dr. ${op.surgeon_first_name} ${op.surgeon_last_name}` : ''}
                    </p>
                  </div>
                  {op.status === 'completed' && (
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">Duration</p>
                      <p className="font-semibold font-mono">{formatDuration(op.duration_minutes)}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
