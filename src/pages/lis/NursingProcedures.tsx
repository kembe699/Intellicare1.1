import React, { useState, useEffect } from 'react';
import { Syringe, Check, Loader2, User } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { fetchPatientDirectory, DirectoryPerson } from '@/lib/patientDirectory';

// A standalone outpatient/triage log of nursing care given directly — an
// injection administered, a minor procedure performed, a dressing changed —
// separate from the doctor's prescription pipeline and from inpatient's own
// drug_administrations (admitted patients). Surfaces on the patient's Visit
// Summary (/lis/orders) the same way triage vitals do.
const PROCEDURE_TYPE_OPTIONS = [
  { value: 'injection', label: 'Injection' },
  { value: 'minor_procedure', label: 'Minor Procedure' },
  { value: 'dressing', label: 'Dressing' },
  { value: 'other', label: 'Other' },
];
const PROCEDURE_TYPE_LABEL: Record<string, string> = Object.fromEntries(PROCEDURE_TYPE_OPTIONS.map(o => [o.value, o.label]));

interface NursingProcedure {
  id: string;
  participant_id: string;
  procedure_type: string;
  description: string;
  notes: string | null;
  performed_at: string;
  nurse_name: string | null;
  first_name?: string;
  last_name?: string;
  participant_number?: string;
}

export default function NursingProcedures() {
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [log, setLog] = useState<NursingProcedure[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [saving, setSaving] = useState(false);

  const [participantId, setParticipantId] = useState('');
  const [procedureType, setProcedureType] = useState('injection');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<NursingProcedure[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    fetchPatientDirectory().then(({ people, failed }) => {
      setPeople(people.filter(p => p.source === 'lis'));
      if (failed.length > 0) toast.error(`Could not load the patient list from: ${failed.join(', ')}`);
    });
  }, []);

  const fetchLog = async () => {
    setLoadingLog(true);
    try {
      const res = await authFetch('/api/nursing-procedures', { credentials: 'include' });
      if (res.ok) setLog(await res.json());
    } catch (e) {
      console.error('Failed to fetch nursing procedures log', e);
    } finally {
      setLoadingLog(false);
    }
  };

  useEffect(() => { fetchLog(); }, []);

  useEffect(() => {
    if (!participantId) { setHistory([]); return; }
    setLoadingHistory(true);
    authFetch(`/api/nursing-procedures/participant/${participantId}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false));
  }, [participantId]);

  const resetForm = () => {
    setParticipantId(''); setProcedureType('injection'); setDescription(''); setNotes('');
  };

  const handleSave = async () => {
    if (!participantId) { toast.error('Select a patient'); return; }
    if (!description.trim()) { toast.error('Describe what was done'); return; }
    setSaving(true);
    try {
      const res = await authFetch('/api/nursing-procedures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ participant_id: participantId, procedure_type: procedureType, description: description.trim(), notes: notes.trim() || undefined }),
      });
      if (res.ok) {
        toast.success('Nursing procedure logged');
        resetForm();
        fetchLog();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to log procedure');
      }
    } catch {
      toast.error('Network error saving procedure');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<NursingProcedure>[] = [
    { key: 'performed_at', header: 'Date/Time', render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(v).toLocaleString()}</span> },
    { key: 'first_name', header: 'Patient', render: (_v, row) => <span className="font-medium">{row.first_name} {row.last_name}</span> },
    { key: 'procedure_type', header: 'Type', render: (v) => <Badge variant="outline" className="capitalize">{PROCEDURE_TYPE_LABEL[v] || v}</Badge> },
    { key: 'description', header: 'Description', render: (v) => <span className="whitespace-pre-wrap">{v}</span> },
    { key: 'nurse_name', header: 'Nurse', render: (v) => <span className="text-muted-foreground">{v || '-'}</span> },
    { key: 'notes', header: 'Notes', render: (v) => <span className="text-muted-foreground whitespace-pre-wrap">{v || '-'}</span> },
  ];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <PageHeader title="Nursing Procedures" icon={<Syringe />} className="mb-3" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-1 bg-card rounded-lg border shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><Syringe className="w-4 h-4" /> Log a Procedure</h3>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Patient</label>
              <Combobox
                options={people.map(p => ({ value: p.id, label: `${p.label}${p.code ? ` (${p.code})` : ''}` }))}
                value={participantId}
                onChange={setParticipantId}
                placeholder="Search patient..."
                searchPlaceholder="Search patient..."
                className="mt-1 h-9"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Type</label>
              <Combobox
                options={PROCEDURE_TYPE_OPTIONS}
                value={procedureType}
                onChange={setProcedureType}
                searchPlaceholder="Search..."
                className="mt-1 h-9"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Description *</label>
              <Textarea
                placeholder="e.g. IM Diclofenac 75mg given, or Wound dressing changed — left forearm"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Notes</label>
              <Textarea placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1" />
            </div>
            <Button className="w-full gap-1.5" disabled={saving} onClick={handleSave}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
            </Button>

            {participantId && (
              <div className="pt-3 border-t">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">This Patient's History</p>
                {loadingHistory ? (
                  <p className="text-xs text-muted-foreground">Loading...</p>
                ) : history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No procedures logged yet for this patient.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {history.map(h => (
                      <div key={h.id} className="text-xs p-2 border rounded-md bg-muted/30">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium capitalize">{PROCEDURE_TYPE_LABEL[h.procedure_type] || h.procedure_type}</span>
                          <span className="text-muted-foreground whitespace-nowrap">{new Date(h.performed_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-muted-foreground mt-0.5">{h.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                <h4 className="font-semibold text-sm text-foreground">Recent Procedures</h4>
              </div>
              <AdvancedDataTable<NursingProcedure>
                data={log}
                keyExtractor={(r) => r.id}
                loading={loadingLog}
                emptyMessage="No nursing procedures logged yet"
                searchable
                pagination={{ enabled: true, pageSize: 15, pageSizeOptions: [15, 30, 50] }}
                columns={columns}
              />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
