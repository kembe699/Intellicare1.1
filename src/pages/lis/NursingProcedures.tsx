import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Syringe, Check, Loader2, ListChecks } from 'lucide-react';
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
import { useAuth } from '@/contexts/AuthContext';

// A standalone outpatient/triage log of nursing care given directly — an
// injection administered, a minor procedure performed, a dressing changed —
// separate from the doctor's prescription pipeline and from inpatient's own
// drug_administrations (admitted patients). Surfaces on the patient's Visit
// Summary (/lis/orders) the same way triage vitals do.
//
// Two ways an entry gets here: a nurse logs a free, unbilled NOTE directly;
// or a doctor/reception ORDERS a billable procedure (billed immediately
// against the Nursing services catalog), which then waits here 'pending'
// until a nurse opens the patient and marks it done.
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
  entry_type: 'note' | 'procedure';
  status: 'pending' | 'completed';
  procedure_type: string | null;
  description: string;
  notes: string | null;
  performed_at: string;
  created_at: string;
  nurse_name: string | null;
  ordered_by_name: string | null;
  fee_amount: string | null;
  fee_currency: string | null;
  first_name?: string;
  last_name?: string;
  participant_number?: string;
}

interface NursingService { id: string; service_name: string; price: string; }

function StatusPill({ status }: { status: string }) {
  const done = status === 'completed';
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
      {done ? 'Completed' : 'Pending'}
    </span>
  );
}

export default function NursingProcedures() {
  const navigate = useNavigate();
  const { hasPrivilege } = useAuth();
  const canFulfill = hasPrivilege('nursing.procedures.write');
  const canOrder = hasPrivilege('nursing.procedures.order');

  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [services, setServices] = useState<NursingService[]>([]);
  const [log, setLog] = useState<NursingProcedure[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [saving, setSaving] = useState(false);

  // Order form (doctor / reception)
  const [orderParticipantId, setOrderParticipantId] = useState('');
  const [orderServiceId, setOrderServiceId] = useState('');
  const [orderProcedureType, setOrderProcedureType] = useState('injection');
  const [orderNotes, setOrderNotes] = useState('');

  // Quick note form (nurse)
  const [noteParticipantId, setNoteParticipantId] = useState('');
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    fetchPatientDirectory().then(({ people, failed }) => {
      setPeople(people.filter(p => p.source === 'lis'));
      if (failed.length > 0) toast.error(`Could not load the patient list from: ${failed.join(', ')}`);
    });
  }, []);

  useEffect(() => {
    if (!canOrder) return;
    authFetch('/api/nursing-procedures/catalog', { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(setServices)
      .catch(() => setServices([]));
  }, [canOrder]);

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

  const handleOrder = async () => {
    if (!orderParticipantId) { toast.error('Select a patient'); return; }
    if (!orderServiceId) { toast.error('Select a procedure from the catalog'); return; }
    setSaving(true);
    try {
      const res = await authFetch('/api/nursing-procedures/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ participant_id: orderParticipantId, service_id: orderServiceId, procedure_type: orderProcedureType, notes: orderNotes.trim() || undefined }),
      });
      if (res.ok) {
        toast.success('Procedure ordered — billed and queued for a nurse to carry out');
        setOrderParticipantId(''); setOrderServiceId(''); setOrderProcedureType('injection'); setOrderNotes('');
        fetchLog();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to order procedure');
      }
    } catch {
      toast.error('Network error ordering procedure');
    } finally {
      setSaving(false);
    }
  };

  const handleNote = async () => {
    if (!noteParticipantId) { toast.error('Select a patient'); return; }
    if (!note.trim()) { toast.error('Write a note'); return; }
    setSavingNote(true);
    try {
      const res = await authFetch('/api/nursing-procedures/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ participant_id: noteParticipantId, note: note.trim() }),
      });
      if (res.ok) {
        toast.success('Note added');
        setNoteParticipantId(''); setNote('');
        fetchLog();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to add note');
      }
    } catch {
      toast.error('Network error saving note');
    } finally {
      setSavingNote(false);
    }
  };

  const columns: Column<NursingProcedure>[] = [
    { key: 'created_at', header: 'Date/Time', render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(v).toLocaleString()}</span> },
    { key: 'first_name', header: 'Patient', render: (_v, row) => <span className="font-medium">{row.first_name} {row.last_name}</span> },
    { key: 'entry_type', header: 'Kind', render: (v) => <Badge variant="outline" className="capitalize">{v === 'procedure' ? 'Procedure' : 'Note'}</Badge> },
    { key: 'procedure_type', header: 'Type', render: (v) => v ? <span className="text-xs">{PROCEDURE_TYPE_LABEL[v] || v}</span> : <span className="text-muted-foreground">-</span> },
    { key: 'status', header: 'Status', render: (v) => <StatusPill status={v} /> },
    { key: 'fee_amount', header: 'Fee', render: (v, row) => v ? <span className="text-xs whitespace-nowrap">{row.fee_currency} {parseFloat(v).toLocaleString()}</span> : <span className="text-muted-foreground">-</span> },
    { key: 'description', header: 'Description', render: (v) => <span className="whitespace-pre-wrap">{v}</span> },
    { key: 'nurse_name', header: 'By', render: (v, row) => <span className="text-muted-foreground text-xs">{v || row.ordered_by_name || '-'}</span> },
  ];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <PageHeader title="Nursing Procedures" icon={<Syringe />} className="mb-3" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-1 space-y-6">
            {canOrder && (
              <div className="bg-card rounded-lg border shadow-sm p-5 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><Syringe className="w-4 h-4" /> Order a Procedure</h3>
                <p className="text-xs text-muted-foreground">Billed immediately — a nurse will carry it out and mark it complete.</p>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Patient</label>
                  <Combobox
                    options={people.map(p => ({ value: p.id, label: `${p.label}${p.code ? ` (${p.code})` : ''}` }))}
                    value={orderParticipantId}
                    onChange={setOrderParticipantId}
                    placeholder="Search patient..."
                    searchPlaceholder="Search patient..."
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Procedure (catalog)</label>
                  <Combobox
                    options={services.map(s => ({ value: s.id, label: `${s.service_name} — ${parseFloat(s.price).toLocaleString()}` }))}
                    value={orderServiceId}
                    onChange={setOrderServiceId}
                    placeholder={services.length === 0 ? 'No Nursing services set up' : 'Select procedure...'}
                    searchPlaceholder="Search..."
                    className="mt-1 h-9"
                  />
                  {services.length === 0 && <p className="text-[11px] text-muted-foreground mt-1">Set these up under Setup → Services (category: Nursing).</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Type</label>
                  <Combobox options={PROCEDURE_TYPE_OPTIONS} value={orderProcedureType} onChange={setOrderProcedureType} searchPlaceholder="Search..." className="mt-1 h-9" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Notes</label>
                  <Textarea placeholder="Optional instructions for the nurse" value={orderNotes} onChange={e => setOrderNotes(e.target.value)} rows={2} className="mt-1" />
                </div>
                <Button className="w-full gap-1.5" disabled={saving} onClick={handleOrder}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Place Order
                </Button>
              </div>
            )}

            {canFulfill && (
              <div className="bg-card rounded-lg border shadow-sm p-5 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> Log a Note</h3>
                <p className="text-xs text-muted-foreground">Free-form, unbilled — for an observation that doesn't need an order.</p>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Patient</label>
                  <Combobox
                    options={people.map(p => ({ value: p.id, label: `${p.label}${p.code ? ` (${p.code})` : ''}` }))}
                    value={noteParticipantId}
                    onChange={setNoteParticipantId}
                    placeholder="Search patient..."
                    searchPlaceholder="Search patient..."
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Note *</label>
                  <Textarea placeholder="e.g. Patient resting comfortably, no complaints" value={note} onChange={e => setNote(e.target.value)} rows={3} className="mt-1" />
                </div>
                <Button className="w-full gap-1.5" variant="outline" disabled={savingNote} onClick={handleNote}>
                  {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Note
                </Button>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-primary" />
                <h4 className="font-semibold text-sm text-foreground">Recent Activity</h4>
                <span className="text-xs text-muted-foreground">— click a patient to open their record</span>
              </div>
              <AdvancedDataTable<NursingProcedure>
                data={log}
                keyExtractor={(r) => r.id}
                loading={loadingLog}
                emptyMessage="No nursing procedures logged yet"
                searchable
                pagination={{ enabled: true, pageSize: 15, pageSizeOptions: [15, 30, 50] }}
                onRowClick={(row) => navigate(`/nursing/procedures/${row.participant_id}`)}
                columns={columns}
              />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
