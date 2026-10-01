import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { usePromptDialog } from '@/hooks/use-prompt-dialog';
import { Scissors, Plus, X, CalendarPlus, Search, Loader2 } from 'lucide-react';
import { TheatreRequest, PatientOption, PRIORITY_BADGE, STATUS_BADGE, patientName } from './theatreShared';

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

export default function TheatreRequests() {
  const navigate = useNavigate();
  const { hasPrivilege } = useAuth();
  const canWrite = hasPrivilege('theatre.write');
  const { prompt, promptDialog } = usePromptDialog();

  const [requests, setRequests] = useState<TheatreRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');

  // ── New request form (inline, not a separate page) ─────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [department, setDepartment] = useState('');
  const [procedureName, setProcedureName] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [priority, setPriority] = useState('routine');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: patientResults = [], isFetching: searchingPatients } = useQuery({
    queryKey: ['theatre-patient-search', patientSearch],
    queryFn: async () => {
      if (!patientSearch || patientSearch.length < 2) return [] as PatientOption[];
      const res = await authFetch(`/api/theatre/patients/search?q=${encodeURIComponent(patientSearch)}`, { credentials: 'include' });
      return res.ok ? res.json() : [];
    },
  });

  const resetForm = () => {
    setFormOpen(false);
    setPatientSearch(''); setSelectedPatient(null); setDepartment(''); setProcedureName('');
    setDiagnosis(''); setPriority('routine'); setNotes('');
  };

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

  const handleSubmit = async () => {
    if (!selectedPatient) { toast.error('Search for and select a patient'); return; }
    if (!procedureName.trim()) { toast.error('Procedure name is required'); return; }

    setSaving(true);
    try {
      const res = await authFetch('/api/theatre/requests', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: selectedPatient.id, requesting_department: department || null,
          procedure_name: procedureName.trim(), diagnosis: diagnosis || null, priority, notes: notes || null,
        }),
      });
      if (res.ok) {
        toast.success('Request submitted');
        resetForm();
        fetchRequests();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to submit request');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    const reason = (await prompt({ title: 'Cancel this request', description: 'Reason for cancelling this request?', required: false })) ?? null;
    if (reason === null) return; // cancelled the dialog itself — don't cancel the request
    try {
      const res = await authFetch(`/api/theatre/requests/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      if (res.ok) { toast.success('Request cancelled'); fetchRequests(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to cancel request'); }
    } catch { toast.error('Network error'); }
  };

  const columns: Column<TheatreRequest>[] = [
    { key: 'procedure_name', header: 'Procedure', sortable: true, filterable: true },
    {
      key: 'patient_first_name', header: 'Patient', sortable: true,
      render: (_v, row) => `${patientName(row)}${row.patient_code ? ` (${row.patient_code})` : ''}`,
    },
    { key: 'requesting_department', header: 'Department', render: (v) => v || '—' },
    { key: 'priority', header: 'Priority', width: '110px', render: (v) => <Badge variant={PRIORITY_BADGE[v]}>{v}</Badge> },
    { key: 'status', header: 'Status', width: '110px', render: (v) => <Badge variant={STATUS_BADGE[v]}>{v}</Badge> },
    { key: 'created_at', header: 'Submitted', sortable: true, render: (v) => new Date(v).toLocaleString() },
    {
      key: '__actions', header: '', width: '140px',
      render: (_v, row) => canWrite && row.status === 'pending' ? (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" className="h-7 gap-1.5" onClick={() => navigate(`/theatre/operations/new?request_id=${row.id}`)}>
            <CalendarPlus className="h-3.5 w-3.5" /> Schedule
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => handleCancel(row.id)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null,
    },
  ];

  return (
    <AppLayout>
      {promptDialog}
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PageHeader title="Operation Requests" icon={<Scissors />} subtitle="Every request for theatre time, from any department" />
          {canWrite && !formOpen && (
            <Button size="sm" className="gap-1.5" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New Request
            </Button>
          )}
        </div>

        {formOpen && (
          <Card>
            <CardContent className="p-5">
              <SectionHeader icon={Scissors} title="New Operation Request" subtitle="Request theatre time for a patient" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="lg:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Patient</label>
                  {selectedPatient ? (
                    <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-muted/30">
                      <div className="text-sm">
                        <span className="font-medium">{selectedPatient.first_name} {selectedPatient.last_name}</span>
                        <span className="text-muted-foreground ml-2">{selectedPatient.code}</span>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setSelectedPatient(null); setPatientSearch(''); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input className="pl-8" placeholder="Search patient by name or ID..." value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />
                      {patientSearch.length >= 2 && (
                        <div className="mt-1 border rounded-md max-h-56 overflow-y-auto bg-card shadow-sm">
                          {searchingPatients ? (
                            <p className="text-sm text-muted-foreground px-3 py-2">Searching...</p>
                          ) : patientResults.length === 0 ? (
                            <p className="text-sm text-muted-foreground px-3 py-2">No patients found.</p>
                          ) : patientResults.map((p: PatientOption) => (
                            <button key={`${p.source}-${p.id}`} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between" onClick={() => setSelectedPatient(p)}>
                              <span>{p.first_name} {p.last_name}</span>
                              <span className="text-xs text-muted-foreground">{p.code}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Requesting Department (optional)</label>
                  <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Surgical Ward" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Priority</label>
                  <Combobox
                    options={[{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }, { value: 'emergency', label: 'Emergency' }]}
                    value={priority} onChange={setPriority} searchPlaceholder="Search..."
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Procedure</label>
                  <Input value={procedureName} onChange={(e) => setProcedureName(e.target.value)} placeholder="e.g. Appendectomy" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Diagnosis</label>
                  <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Optional" />
                </div>
                <div className="lg:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Notes</label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Submit Request</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? <LoadingState message="Loading requests..." /> : (
          <AdvancedDataTable
            data={requests}
            columns={columns}
            emptyMessage="No requests found."
            pagination={{ enabled: true, pageSize: 25 }}
            keyExtractor={(r) => r.id}
            searchable
            searchPlaceholder="Search requests..."
            exportable
            exportFileName="theatre-requests"
            toolbarExtra={
              <Combobox
                options={[{ value: 'pending', label: 'Pending' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'cancelled', label: 'Cancelled' }, { value: '', label: 'All' }]}
                value={statusFilter} onChange={setStatusFilter} searchPlaceholder="Search status..." className="h-9 w-[160px]"
              />
            }
          />
        )}
      </div>
    </AppLayout>
  );
}
