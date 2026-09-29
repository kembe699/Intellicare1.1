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
import { Scissors, Plus, X, CalendarPlus } from 'lucide-react';
import { TheatreRequest, PRIORITY_BADGE, STATUS_BADGE, patientName } from './theatreShared';

export default function TheatreRequests() {
  const navigate = useNavigate();
  const { hasPrivilege } = useAuth();
  const canWrite = hasPrivilege('theatre.write');

  const [requests, setRequests] = useState<TheatreRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/theatre/requests${statusFilter ? `?status=${statusFilter}` : ''}`, { credentials: 'include' });
      if (res.ok) setRequests(await res.json());
    } catch {
      toast.error('Failed to load theatre requests');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleCancel = async (id: string) => {
    const reason = window.prompt('Reason for cancelling this request?') || '';
    try {
      const res = await authFetch(`/api/theatre/requests/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      if (res.ok) { toast.success('Request cancelled'); fetchRequests(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to cancel request'); }
    } catch { toast.error('Network error'); }
  };

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PageHeader title="Operation Requests" icon={<Scissors />} subtitle="Every request for theatre time, from any department" />
          {canWrite && (
            <Button size="sm" className="gap-1.5" onClick={() => navigate('/theatre/requests/new')}>
              <Plus className="h-3.5 w-3.5" /> New Request
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <Combobox
                options={[{ value: 'pending', label: 'Pending' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'cancelled', label: 'Cancelled' }, { value: '', label: 'All' }]}
                value={statusFilter} onChange={setStatusFilter} searchPlaceholder="Search status..." className="h-9"
              />
            </div>
          </CardContent>
        </Card>

        {loading ? <LoadingState message="Loading requests..." /> : (
          <div className="space-y-2.5">
            {requests.length === 0 && (
              <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No requests found.</CardContent></Card>
            )}
            {requests.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant={PRIORITY_BADGE[r.priority]}>{r.priority}</Badge>
                      <Badge variant={STATUS_BADGE[r.status]}>{r.status}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                    <p className="font-medium">{r.procedure_name}</p>
                    <p className="text-sm text-muted-foreground">{patientName(r)} {r.patient_code ? `(${r.patient_code})` : ''}{r.requesting_department ? ` — from ${r.requesting_department}` : ''}</p>
                    {r.diagnosis && <p className="text-xs text-muted-foreground mt-1">Dx: {r.diagnosis}</p>}
                  </div>
                  {canWrite && r.status === 'pending' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" className="gap-1.5" onClick={() => navigate(`/theatre/operations/new?request_id=${r.id}`)}>
                        <CalendarPlus className="h-3.5 w-3.5" /> Schedule
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleCancel(r.id)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
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
