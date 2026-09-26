import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState, StatusBadge } from '@/components/common';
import { Scan, AlertTriangle } from 'lucide-react';
import { authFetch } from '@/api/apiClient';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface RadiologyRequestRow {
  id: string;
  request_number: string;
  exam_name: string;
  status: string;
  urgent: boolean;
  request_date: string;
  first_name: string;
  last_name: string;
  participant_number: string;
  doctor_name: string | null;
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

export default function RadiologyQueue() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<RadiologyRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await authFetch('/api/radiology/requests', { credentials: 'include' });
        if (res.ok) setRequests(await res.json());
      } catch (e) {
        console.error('Failed to fetch radiology requests', e);
      } finally {
        setLoading(false);
      }
    };
    fetchRequests();
  }, []);

  if (loading) return <AppLayout><LoadingState message="Loading radiology requests..." /></AppLayout>;

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-5 w-full flex flex-col">
          <PageHeader title="Radiology" icon={<Scan />} />
          <AdvancedDataTable<RadiologyRequestRow>
            data={requests}
            keyExtractor={(r) => r.id}
            emptyMessage="No radiology requests yet"
            onRowClick={(r) => navigate(`/radiology/requests/${r.id}`)}
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            columns={[
              { key: 'request_number', header: 'Request No', render: (v) => <span className="font-medium text-foreground">{v}</span> },
              { key: 'first_name', header: 'Patient', render: (_v, r) => `${r.first_name} ${r.last_name}` },
              { key: 'doctor_name', header: 'Doctor', render: (v) => v || '—' },
              { key: 'exam_name', header: 'Exam', render: (v, r) => (
                <span className="flex items-center gap-1.5">
                  {v}
                  {r.urgent && <span title="Urgent"><AlertTriangle className="h-3.5 w-3.5 text-destructive" /></span>}
                </span>
              ) },
              { key: 'request_date', header: 'Date', render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(v).toLocaleString()}</span> },
              { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} map={STATUS_TONE} label={STATUS_LABEL[v] || v} /> },
            ]}
          />
        </div>
      </div>
    </AppLayout>
  );
}
