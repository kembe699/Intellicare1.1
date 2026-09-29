import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Scissors, Search, X } from 'lucide-react';
import { PatientOption } from './theatreShared';

export default function TheatreRequestNew() {
  const navigate = useNavigate();
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [department, setDepartment] = useState('');
  const [procedureName, setProcedureName] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [priority, setPriority] = useState('routine');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: patientResults = [], isFetching } = useQuery({
    queryKey: ['theatre-patient-search', patientSearch],
    queryFn: async () => {
      if (!patientSearch || patientSearch.length < 2) return [] as PatientOption[];
      const res = await authFetch(`/api/theatre/patients/search?q=${encodeURIComponent(patientSearch)}`, { credentials: 'include' });
      return res.ok ? res.json() : [];
    },
  });

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
        navigate('/theatre/requests');
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

  return (
    <AppLayout>
      <div className="space-y-4 max-w-2xl">
        <PageHeader
          icon={<Scissors />}
          title="New Operation Request"
          subtitle="Request theatre time for a patient"
          actions={
            <Button variant="outline" size="sm" onClick={() => navigate('/theatre/requests')}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Requests
            </Button>
          }
        />

        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
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
                      {isFetching ? (
                        <p className="text-sm text-muted-foreground px-3 py-2">Searching...</p>
                      ) : patientResults.length === 0 ? (
                        <p className="text-sm text-muted-foreground px-3 py-2">No patients found.</p>
                      ) : patientResults.map((p: PatientOption) => (
                        <button
                          key={`${p.source}-${p.id}`} type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between"
                          onClick={() => { setSelectedPatient(p); }}
                        >
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
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Procedure</label>
              <Input value={procedureName} onChange={(e) => setProcedureName(e.target.value)} placeholder="e.g. Appendectomy" />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Diagnosis</label>
              <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Optional" />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Priority</label>
              <Combobox
                options={[{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }, { value: 'emergency', label: 'Emergency' }]}
                value={priority} onChange={setPriority} searchPlaceholder="Search..."
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Notes</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/theatre/requests')}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Submit Request</Button>
        </div>
      </div>
    </AppLayout>
  );
}
