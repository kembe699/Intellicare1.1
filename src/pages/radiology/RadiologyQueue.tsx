import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState, StatusBadge } from '@/components/common';
import { Scan, AlertTriangle } from 'lucide-react';
import { authFetch } from '@/api/apiClient';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface RadiologyVisitRow {
  id: string;
  participant_id: string;
  request_date: string;
  request_count: number;
  pending_count: number;
  in_progress_count: number;
  completed_count: number;
  urgent: boolean;
  first_name: string;
  last_name: string;
  participant_number: string;
  doctor_name: string | null;
  // Derived client-side (see deriveStatus) — kept as a real field, not just a
  // render-time computation, so search/export/filter all see the same value.
  patient_name: string;
  status: string;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  pending: 'warning',
  in_progress: 'neutral',
  completed: 'success',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
};

// A visit's overall status for the queue's single Status column/filter — any
// exam still pending needs attention first, then anything in progress, and
// only "Completed" once every exam in the visit has been reported.
function deriveStatus(v: { pending_count: number; in_progress_count: number }): string {
  if (v.pending_count > 0) return 'pending';
  if (v.in_progress_count > 0) return 'in_progress';
  return 'completed';
}

export default function RadiologyQueue() {
  const navigate = useNavigate();
  const [visits, setVisits] = useState<RadiologyVisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const fetchVisits = async () => {
      try {
        const res = await authFetch('/api/radiology/visits', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setVisits((Array.isArray(data) ? data : []).map((v: any) => ({
            ...v,
            request_count: parseInt(v.request_count, 10) || 0,
            pending_count: parseInt(v.pending_count, 10) || 0,
            in_progress_count: parseInt(v.in_progress_count, 10) || 0,
            completed_count: parseInt(v.completed_count, 10) || 0,
            patient_name: `${v.first_name} ${v.last_name}`,
            status: deriveStatus(v),
          })));
        }
      } catch (e) {
        console.error('Failed to fetch radiology visits', e);
      } finally {
        setLoading(false);
      }
    };
    fetchVisits();
  }, []);

  const filteredVisits = statusFilter === 'all' ? visits : visits.filter((v) => v.status === statusFilter);

  if (loading) return <AppLayout><LoadingState message="Loading radiology requests..." /></AppLayout>;

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-5 w-full flex flex-col">
          <PageHeader title="Radiology" icon={<Scan />} />
          <AdvancedDataTable<RadiologyVisitRow>
            data={filteredVisits}
            keyExtractor={(v) => v.id}
            emptyMessage="No radiology requests yet"
            onRowClick={(v) => navigate(`/radiology/requests/${v.id}`)}
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            searchable
            searchPlaceholder="Search patient, participant no, doctor..."
            exportable
            exportFileName="radiology-requests"
            toolbarExtra={
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            }
            columns={[
              { key: 'request_date', header: 'Date', sortable: true, render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(v).toLocaleString()}</span> },
              { key: 'patient_name', header: 'Patient', sortable: true, render: (_v, r) => (
                <span className="flex items-center gap-1.5">
                  {r.patient_name}
                  {r.urgent && <span title="Urgent"><AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" /></span>}
                </span>
              ) },
              { key: 'participant_number', header: 'Patient No' },
              { key: 'doctor_name', header: 'Doctor', render: (v) => v || '—' },
              { key: 'request_count', header: 'Requests', align: 'center', sortable: true, render: (v) => <span className="font-medium text-foreground">{v}</span> },
              { key: 'status', header: 'Status', sortable: true, render: (v) => <StatusBadge status={v} map={STATUS_TONE} label={STATUS_LABEL[v] || v} /> },
            ]}
          />
        </div>
      </div>
    </AppLayout>
  );
}
