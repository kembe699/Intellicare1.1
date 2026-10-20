import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { ArrowLeft, Loader2, CalendarClock, Search, X } from 'lucide-react';
import { PatientOption, TheatreRoom, TheatreRequest, ROLE_LABEL } from './theatreShared';

interface Employee { id: string; first_name: string; last_name: string; }

type TeamRole = 'surgeon' | 'anesthetist' | 'scrub_nurse';

export default function TheatreOperationNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('request_id') || '';

  const [loadingRequest, setLoadingRequest] = useState(!!requestId);
  const [chosenRequest, setChosenRequest] = useState<TheatreRequest | null>(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [procedureName, setProcedureName] = useState('');
  const [rooms, setRooms] = useState<TheatreRoom[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roomId, setRoomId] = useState('');
  const [surgeonIds, setSurgeonIds] = useState<string[]>([]);
  const [anesthetistIds, setAnesthetistIds] = useState<string[]>([]);
  const [nurseIds, setNurseIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [procedureFee, setProcedureFee] = useState('');
  const [saving, setSaving] = useState(false);

  // Already billed via the request that was picked (either from
  // /theatre/requests directly, or auto-created when a Procedure-category
  // service was billed elsewhere) — the fee is then a read-only fact, not an
  // input, and the server ignores any procedure_fee sent alongside it.
  const isBilled = !!chosenRequest?.bill_id;

  const { data: patientResults = [], isFetching } = useQuery({
    queryKey: ['theatre-patient-search', patientSearch],
    queryFn: async () => {
      if (!patientSearch || patientSearch.length < 2) return [] as PatientOption[];
      const res = await authFetch(`/api/theatre/patients/search?q=${encodeURIComponent(patientSearch)}`, { credentials: 'include' });
      return res.ok ? res.json() : [];
    },
    enabled: !requestId && !chosenRequest,
  });

  const { data: pendingRequests = [] } = useQuery({
    queryKey: ['theatre-pending-requests'],
    queryFn: async () => {
      const res = await authFetch('/api/theatre/requests?status=pending', { credentials: 'include' });
      return res.ok ? res.json() : [];
    },
    enabled: !requestId,
  });

  useEffect(() => {
    (async () => {
      const [roomsRes, empRes] = await Promise.all([
        authFetch('/api/theatre/rooms', { credentials: 'include' }),
        authFetch('/api/hr/employees', { credentials: 'include' }),
      ]);
      if (roomsRes.ok) setRooms(await roomsRes.json());
      if (empRes.ok) setEmployees(await empRes.json());
    })();
  }, []);

  const applyRequest = (req: TheatreRequest) => {
    setChosenRequest(req);
    setProcedureName(req.procedure_name);
    setSelectedPatient({ id: req.patient_id, code: req.patient_code || '', first_name: req.patient_first_name || '', last_name: req.patient_last_name || '', gender: null, date_of_birth: null, source: 'patients' });
    if (req.bill_id) setProcedureFee(req.estimated_fee != null ? String(req.estimated_fee) : '');
  };

  useEffect(() => {
    if (!requestId) return;
    (async () => {
      setLoadingRequest(true);
      try {
        const res = await authFetch(`/api/theatre/requests?status=`, { credentials: 'include' });
        if (res.ok) {
          const all = await res.json();
          const req = all.find((r: TheatreRequest) => r.id === requestId);
          if (req) applyRequest(req);
        }
      } finally {
        setLoadingRequest(false);
      }
    })();
  }, [requestId]);

  const handleSubmit = async () => {
    if (!selectedPatient) { toast.error('Search for and select a patient'); return; }
    if (!procedureName.trim()) { toast.error('Procedure name is required'); return; }

    setSaving(true);
    try {
      const res = await authFetch('/api/theatre/operations', {
        method: 'POST',
        body: JSON.stringify({
          request_id: requestId || chosenRequest?.id || undefined, patient_id: selectedPatient.id, procedure_name: procedureName.trim(),
          theatre_room_id: roomId || undefined,
          surgeon_employee_ids: surgeonIds, anesthetist_employee_ids: anesthetistIds, scrub_nurse_employee_ids: nurseIds,
          scheduled_at: scheduledAt || undefined,
          // T1: captured now, while whoever is booking the case knows what it
          // should cost — billed automatically once the operation completes.
          // Left blank means "not billed through this module" (covered/charity).
          // Omitted entirely once a request has already billed this —
          // the server is authoritative there and ignores it anyway.
          procedure_fee: isBilled ? undefined : (procedureFee ? parseFloat(procedureFee) : undefined),
        }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success('Operation scheduled');
        navigate(`/theatre/operations/${created.id}`);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to schedule operation');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const teamPicker = (role: TeamRole, ids: string[], setIds: (ids: string[]) => void) => (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1.5">{ROLE_LABEL[role]}</label>
      <Combobox
        options={employees.filter((e) => !ids.includes(e.id)).map((e) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` }))}
        value="" onChange={(id) => id && setIds([...ids, id])}
        placeholder={`Add ${ROLE_LABEL[role].toLowerCase()}...`} searchPlaceholder="Search employees..."
      />
      {ids.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {ids.map((id) => {
            const emp = employees.find((e) => e.id === id);
            return (
              <div key={id} className="flex items-center justify-between border rounded-md px-2.5 py-1.5 bg-muted/30 text-sm">
                <span>{emp ? `${emp.first_name} ${emp.last_name}` : id}</span>
                <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setIds(ids.filter((x) => x !== id))}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader
          icon={<CalendarClock />}
          title="Schedule Operation"
          subtitle={requestId || chosenRequest ? 'From an existing theatre request' : 'Schedule a new operation'}
          actions={
            <Button variant="outline" size="sm" onClick={() => navigate('/theatre/operations')}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Board
            </Button>
          }
        />

        {!requestId && !chosenRequest && pendingRequests.length > 0 && (
          <Card>
            <CardContent className="p-5">
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Select from a pending request (optional)</label>
              <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                {pendingRequests.map((r: TheatreRequest) => (
                  <button key={r.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between" onClick={() => applyRequest(r)}>
                    <span>
                      <span className="font-medium">{r.procedure_name}</span>
                      <span className="text-muted-foreground ml-2">{r.patient_first_name} {r.patient_last_name}</span>
                    </span>
                    {r.bill_id && <span className="text-xs text-muted-foreground">Billed — {r.estimated_fee} {r.fee_currency}</span>}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Patient</label>
                {loadingRequest ? (
                  <p className="text-sm text-muted-foreground">Loading request...</p>
                ) : selectedPatient ? (
                  <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-muted/30">
                    <div className="text-sm">
                      <span className="font-medium">{selectedPatient.first_name} {selectedPatient.last_name}</span>
                      {selectedPatient.code && <span className="text-muted-foreground ml-2">{selectedPatient.code}</span>}
                    </div>
                    {!requestId && !chosenRequest && (
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setSelectedPatient(null); setPatientSearch(''); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
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
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Procedure</label>
                {chosenRequest ? (
                  <div className="border rounded-md px-3 py-2 bg-muted/30 text-sm">{procedureName}</div>
                ) : (
                  <Input value={procedureName} onChange={(e) => setProcedureName(e.target.value)} placeholder="e.g. Appendectomy" />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Theatre Room</label>
                  <Combobox
                    options={rooms.map((r) => ({ value: r.id, label: `${r.name} (${r.status.replace('_', ' ')})` }))}
                    value={roomId} onChange={setRoomId} placeholder="Select room..." searchPlaceholder="Search..."
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Scheduled Date/Time</label>
                  <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Procedure Fee (SSP){!isBilled && ' — optional'}</label>
                {isBilled ? (
                  <div className="border rounded-md px-3 py-2 bg-muted/30 text-sm text-muted-foreground">
                    Already billed via request — {chosenRequest?.estimated_fee} {chosenRequest?.fee_currency}
                  </div>
                ) : (
                  <Input type="number" min="0" step="0.01" value={procedureFee} onChange={(e) => setProcedureFee(e.target.value)} placeholder="Leave blank if not billed through Theatre" />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-4">
              {teamPicker('surgeon', surgeonIds, setSurgeonIds)}
              {teamPicker('anesthetist', anesthetistIds, setAnesthetistIds)}
              {teamPicker('scrub_nurse', nurseIds, setNurseIds)}
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/theatre/operations')}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Schedule Operation</Button>
        </div>
      </div>
    </AppLayout>
  );
}
