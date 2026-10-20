import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from '@/lib/notify';
import { usePromptDialog } from '@/hooks/use-prompt-dialog';
import {
  ArrowLeft, Loader2, Scissors, Play, Square, XCircle, User, MapPin,
  Stethoscope, Activity, CheckCircle2, Circle, Plus, Download, FileWarning, Syringe, Users, X,
} from 'lucide-react';
import * as docTemplate from '@/utils/documentTemplate';
import {
  TheatreOperation, PHASE_LABEL, STATUS_BADGE, OUTCOME_LABEL, OUTCOME_BADGE,
  patientName, formatDuration, StockLocation, StockItemOption, ROLE_LABEL,
} from './theatreShared';
import { formatDate } from '@/lib/format';

type TeamRole = 'surgeon' | 'anesthetist' | 'scrub_nurse';
const TEAM_ROLES: TeamRole[] = ['surgeon', 'anesthetist', 'scrub_nurse'];

function useElapsedTimer(startedAt: string | null, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [running]);
  if (!startedAt) return '00:00:00';
  const diff = Math.max(0, now - new Date(startedAt).getTime());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const PHASES: Array<'pre_op' | 'intra_op' | 'post_op'> = ['pre_op', 'intra_op', 'post_op'];

export default function TheatreOperationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPrivilege } = useAuth();
  const canWrite = hasPrivilege('theatre.write');
  const facilityInfo = useFacilityInfo();
  const { prompt, promptDialog } = usePromptDialog();

  const [operation, setOperation] = useState<TheatreOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePhase, setActivePhase] = useState<'pre_op' | 'intra_op' | 'post_op'>('pre_op');
  const [busy, setBusy] = useState(false);

  const [newItemText, setNewItemText] = useState('');
  const [vBp, setVBp] = useState(''); const [vPulse, setVPulse] = useState(''); const [vTemp, setVTemp] = useState('');
  const [vResp, setVResp] = useState(''); const [vSpo2, setVSpo2] = useState(''); const [vNotes, setVNotes] = useState('');

  const [completing, setCompleting] = useState(false);
  const [outcome, setOutcome] = useState('successful');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [causeOfDeath, setCauseOfDeath] = useState('');

  const [patientVisits, setPatientVisits] = useState<any[] | null>(null);
  const [labResultsBySpecimen, setLabResultsBySpecimen] = useState<Record<string, any[]>>({});

  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationId, setLocationId] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<StockItemOption | null>(null);
  const [itemQty, setItemQty] = useState('');
  const [itemNotes, setItemNotes] = useState('');
  const [recordingItem, setRecordingItem] = useState(false);

  const [employees, setEmployees] = useState<Array<{ id: string; first_name: string; last_name: string }>>([]);

  const timer = useElapsedTimer(operation?.started_at || null, operation?.status === 'in_progress');

  useEffect(() => {
    authFetch('/api/theatre/locations', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setLocations)
      .catch(() => setLocations([]));
    authFetch('/api/hr/employees', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []);

  const { data: itemResults = [], isFetching: searchingItems } = useQuery({
    queryKey: ['theatre-item-search', locationId, itemSearch],
    queryFn: async () => {
      if (!locationId) return [] as StockItemOption[];
      const res = await authFetch(`/api/theatre/items/search?location_id=${locationId}&q=${encodeURIComponent(itemSearch)}`, { credentials: 'include' });
      return res.ok ? res.json() : [];
    },
    enabled: !!locationId,
  });

  // showLoading is only true for the initial mount fetch — every subsequent
  // refresh (after starting/completing/toggling a checklist item/recording
  // vitals) fetches silently in the background, so acting on the page never
  // flashes the whole thing back to a full-page spinner.
  const fetchOperation = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await authFetch(`/api/theatre/operations/${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setOperation(data);
        // Best-effort: this patient_id only resolves to something if it's an
        // LIS participant — a pure inpatient/reception-only patient simply
        // gets an empty result back, which is fine, not an error.
        authFetch(`/api/lis/visit-summaries?participant_id=${data.patient_id}`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then(async (d) => {
            const visits = Array.isArray(d) ? d : d?.visits || null;
            setPatientVisits(visits);
            // Component-level values (e.g. WBC/RBC for a Complete Blood
            // Count), not just the test name — same pattern LISTestOrders.tsx
            // already uses (fetch per approved specimen, once each).
            const approved: Array<{ id: string }> = (visits || []).flatMap((v: any) => (v.tests || []).filter((t: any) => t.status === 'approved'));
            const results = await Promise.all(approved.map(async (t) => {
              try {
                const r = await authFetch(`/api/lis/specimens/${t.id}/results`, { credentials: 'include' });
                return [t.id, r.ok ? await r.json() : []] as const;
              } catch { return [t.id, []] as const; }
            }));
            setLabResultsBySpecimen(Object.fromEntries(results));
          })
          .catch(() => setPatientVisits(null));
      } else {
        toast.error('Operation not found');
      }
    } catch {
      toast.error('Failed to load operation');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchOperation(true); }, [fetchOperation]);

  const handleStart = async () => {
    setBusy(true);
    try {
      const res = await authFetch(`/api/theatre/operations/${id}/start`, { method: 'POST' });
      if (res.ok) { toast.success('Operation started'); setActivePhase('intra_op'); fetchOperation(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to start operation'); }
    } catch { toast.error('Network error'); } finally { setBusy(false); }
  };

  const handleComplete = async () => {
    if (outcome === 'death' && !causeOfDeath.trim()) { toast.error('Cause of death is required'); return; }
    setBusy(true);
    try {
      const res = await authFetch(`/api/theatre/operations/${id}/complete`, {
        method: 'POST', body: JSON.stringify({ outcome, outcome_notes: outcomeNotes || null, cause_of_death: outcome === 'death' ? causeOfDeath : null }),
      });
      if (res.ok) { toast.success('Operation completed'); setCompleting(false); fetchOperation(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to complete operation'); }
    } catch { toast.error('Network error'); } finally { setBusy(false); }
  };

  const handleCancel = async () => {
    const reason = await prompt({ title: 'Cancel this operation', description: 'Reason for cancelling this operation?', required: false });
    if (reason === null) return; // cancelled the dialog itself — don't cancel the operation
    setBusy(true);
    try {
      const res = await authFetch(`/api/theatre/operations/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      if (res.ok) { toast.success('Operation cancelled'); fetchOperation(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to cancel operation'); }
    } catch { toast.error('Network error'); } finally { setBusy(false); }
  };

  const toggleChecklistItem = async (itemId: string, checked: boolean) => {
    // Optimistic — flip it locally immediately so a click reads as an
    // instant checkbox toggle, not a page reload; revert if the save fails.
    setOperation((prev) => prev && { ...prev, checklist: prev.checklist.map((c) => (c.id === itemId ? { ...c, is_checked: checked } : c)) });
    try {
      const res = await authFetch(`/api/theatre/operations/${id}/checklist/${itemId}`, { method: 'PUT', body: JSON.stringify({ checked }) });
      if (!res.ok) {
        toast.error('Failed to update checklist item');
        fetchOperation();
      }
    } catch {
      toast.error('Network error');
      fetchOperation();
    }
  };

  const addChecklistItem = async () => {
    if (!newItemText.trim()) return;
    try {
      const res = await authFetch(`/api/theatre/operations/${id}/checklist`, { method: 'POST', body: JSON.stringify({ phase: activePhase, item_text: newItemText.trim() }) });
      if (res.ok) { setNewItemText(''); fetchOperation(); }
      else toast.error('Failed to add checklist item');
    } catch { toast.error('Network error'); }
  };

  const recordVitals = async () => {
    if (!vBp && !vPulse && !vTemp && !vResp && !vSpo2) { toast.error('Enter at least one vital reading'); return; }
    try {
      const res = await authFetch(`/api/theatre/operations/${id}/vitals`, {
        method: 'POST',
        body: JSON.stringify({
          phase: activePhase, blood_pressure: vBp || null, pulse: vPulse ? parseInt(vPulse, 10) : null,
          temperature: vTemp || null, respiratory_rate: vResp ? parseInt(vResp, 10) : null, spo2: vSpo2 ? parseInt(vSpo2, 10) : null,
          notes: vNotes || null,
        }),
      });
      if (res.ok) {
        toast.success('Vitals recorded');
        setVBp(''); setVPulse(''); setVTemp(''); setVResp(''); setVSpo2(''); setVNotes('');
        fetchOperation();
      } else toast.error('Failed to record vitals');
    } catch { toast.error('Network error'); }
  };

  const recordItemUsage = async () => {
    if (!locationId) { toast.error('Pick a storage location'); return; }
    if (!selectedItem) { toast.error('Search for and select an item'); return; }
    const qty = parseFloat(itemQty);
    if (!(qty > 0)) { toast.error('Enter a quantity greater than 0'); return; }

    setRecordingItem(true);
    try {
      const res = await authFetch(`/api/theatre/operations/${id}/items`, {
        method: 'POST',
        body: JSON.stringify({ location_id: locationId, item_id: selectedItem.id, quantity: qty, notes: itemNotes || null }),
      });
      if (res.ok) {
        toast.success(`${qty} ${selectedItem.unit_of_measure || ''} of ${selectedItem.item_name} recorded`);
        setSelectedItem(null); setItemSearch(''); setItemQty(''); setItemNotes('');
        fetchOperation();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to record item usage');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setRecordingItem(false);
    }
  };

  const handleAddTeamMember = async (role: TeamRole, employeeId: string) => {
    try {
      const res = await authFetch(`/api/theatre/operations/${id}/team`, {
        method: 'POST',
        body: JSON.stringify({ employee_id: employeeId, role }),
      });
      if (res.ok) { fetchOperation(); } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to add team member');
      }
    } catch { toast.error('Network error'); }
  };

  const handleRemoveTeamMember = async (teamMemberId: string) => {
    try {
      const res = await authFetch(`/api/theatre/operations/${id}/team/${teamMemberId}`, { method: 'DELETE' });
      if (res.ok) { fetchOperation(); } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to remove team member');
      }
    } catch { toast.error('Network error'); }
  };

  const fi = () => ({ name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo });
  const bi = () => ({ name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone });

  const buildReportHtml = () => {
    if (!operation) return '';
    const infoBody = docTemplate.buildInfoGrid(
      { title: 'Patient', rows: [
        { label: 'Name', value: patientName(operation), bold: true },
        { label: 'Code', value: operation.patient_code || '—' },
        { label: 'Gender', value: operation.patient_gender || '—' },
      ]},
      { title: 'Operation', rows: [
        { label: 'Procedure', value: operation.procedure_name, bold: true },
        { label: 'Room', value: operation.room_name || '—' },
        { label: 'Surgeon', value: operation.surgeon_first_name ? `${operation.surgeon_first_name} ${operation.surgeon_last_name}` : '—' },
        { label: 'Anaesthetist', value: operation.anesthetist_first_name ? `${operation.anesthetist_first_name} ${operation.anesthetist_last_name}` : '—' },
      ]}
    );
    const summary = docTemplate.buildSummary([
      { label: 'Started', value: operation.started_at ? new Date(operation.started_at).toLocaleString() : '—' },
      { label: 'Ended', value: operation.ended_at ? new Date(operation.ended_at).toLocaleString() : '—' },
      { label: 'Duration', value: formatDuration(operation.duration_minutes) },
      { label: 'Outcome', value: operation.outcome ? OUTCOME_LABEL[operation.outcome] : '—', isTotal: true },
    ]);
    const outcomeBody = operation.outcome_notes || operation.cause_of_death
      ? `<div class="ic-section-title">Outcome Notes</div><p>${operation.outcome_notes || ''}${operation.cause_of_death ? `<br/><strong>Cause of death:</strong> ${operation.cause_of_death}` : ''}</p>`
      : '';
    const checklistBody = PHASES.map((phase) => {
      const items = operation.checklist.filter((c) => c.phase === phase);
      if (items.length === 0) return '';
      return `<div class="ic-section-title">${PHASE_LABEL[phase]}</div>`
        + docTemplate.buildTable([{ label: 'Item' }, { label: 'Done', align: 'center' }], items.map((it) => ({ cells: [it.item_text, it.is_checked ? 'Yes' : 'No'] })));
    }).join('');
    const vitalsBody = operation.vitals.length > 0
      ? `<div class="ic-section-title">Vitals</div>` + docTemplate.buildTable(
          [{ label: 'Time' }, { label: 'Phase' }, { label: 'BP' }, { label: 'Pulse' }, { label: 'Temp' }, { label: 'RR' }, { label: 'SpO2' }],
          operation.vitals.map((v) => ({ cells: [new Date(v.recorded_at).toLocaleString(), PHASE_LABEL[v.phase], v.blood_pressure || '—', v.pulse ?? '—', v.temperature ?? '—', v.respiratory_rate ?? '—', v.spo2 ?? '—'] }))
        )
      : '';
    const itemsBody = operation.items.length > 0
      ? `<div class="ic-section-title">Drugs, Consumables & Blood Used</div>` + docTemplate.buildTable(
          [{ label: 'Time' }, { label: 'Item' }, { label: 'Qty', align: 'right' }, { label: 'From' }, { label: 'Notes' }],
          operation.items.map((it) => ({ cells: [new Date(it.dispensed_at).toLocaleString(), it.item_name, `${it.quantity} ${it.unit_of_measure || ''}`, it.location_name || '—', it.notes || '—'] }))
        )
      : '';

    return docTemplate.buildDocument({
      docType: 'OPERATION REPORT', docNumber: operation.id.slice(0, 8).toUpperCase(),
      status: operation.status, date: operation.started_at || operation.scheduled_at || new Date(),
      bodyHTML: infoBody + summary + outcomeBody + checklistBody + vitalsBody + itemsBody,
      facilityInfo: fi(), branchInfo: bi(),
    });
  };

  const handleDownloadReport = () => {
    const pw = docTemplate.openPrintWindow(buildReportHtml());
    if (pw) toast.success('Report generated');
    else toast.error('Please allow popups');
  };

  if (loading) return <AppLayout><LoadingState message="Loading operation..." /></AppLayout>;
  if (!operation) {
    return (
      <AppLayout>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/theatre/operations')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Board
        </Button>
        <p className="text-sm text-muted-foreground mt-4">Operation not found.</p>
      </AppLayout>
    );
  }

  const checklistForPhase = operation.checklist.filter((c) => c.phase === activePhase);
  const vitalsForPhase = operation.vitals.filter((v) => v.phase === activePhase);

  return (
    <AppLayout>
      {promptDialog}
      <div className="space-y-4">
        <PageHeader
          icon={<Scissors />}
          title={operation.procedure_name}
          subtitle={patientName(operation)}
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => navigate('/theatre/operations')}><ArrowLeft className="h-4 w-4 mr-2" /> Back</Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadReport}><Download className="h-4 w-4" /> Report</Button>
              {canWrite && operation.status === 'scheduled' && (
                <Button size="sm" className="gap-1.5" onClick={handleStart} disabled={busy}><Play className="h-4 w-4" /> Start Operation</Button>
              )}
              {canWrite && operation.status === 'in_progress' && (
                <Button size="sm" className="gap-1.5" onClick={() => setCompleting(true)} disabled={busy}><Square className="h-4 w-4" /> Complete Operation</Button>
              )}
              {canWrite && ['scheduled', 'in_progress'].includes(operation.status) && (
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30" onClick={handleCancel} disabled={busy}><XCircle className="h-4 w-4" /> Cancel</Button>
              )}
            </div>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
          {/* LEFT: identity + status */}
          <div className="space-y-4">
            <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><User className="w-5 h-5 text-primary" /></div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold leading-tight truncate">{patientName(operation)}</h2>
                  <p className="text-sm text-muted-foreground font-mono">{operation.patient_code || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={STATUS_BADGE[operation.status]}>{operation.status.replace('_', ' ')}</Badge>
                {operation.outcome && <Badge variant={OUTCOME_BADGE[operation.outcome]}>{OUTCOME_LABEL[operation.outcome]}</Badge>}
              </div>

              {operation.status === 'in_progress' && (
                <div className="border-t pt-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Elapsed Time</p>
                  <p className="text-3xl font-bold font-mono tabular-nums">{timer}</p>
                </div>
              )}
              {operation.status === 'completed' && (
                <div className="border-t pt-4 flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Duration</span>
                  <span className="font-semibold font-mono">{formatDuration(operation.duration_minutes)}</span>
                </div>
              )}

              <div className="space-y-2.5 text-sm border-t pt-4">
                <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground shrink-0" />{operation.room_name || 'No room assigned'}</div>
                <div className="flex items-center gap-2"><Stethoscope className="w-4 h-4 text-muted-foreground shrink-0" />{operation.surgeon_first_name ? `Dr. ${operation.surgeon_first_name} ${operation.surgeon_last_name}` : 'No surgeon assigned'}</div>
                {operation.anesthetist_first_name && <div className="flex items-center gap-2 pl-6 text-muted-foreground text-xs">Anaesthetist: {operation.anesthetist_first_name} {operation.anesthetist_last_name}</div>}
                {operation.nurse_first_name && <div className="flex items-center gap-2 pl-6 text-muted-foreground text-xs">Scrub Nurse: {operation.nurse_first_name} {operation.nurse_last_name}</div>}
                {operation.scheduled_at && <div className="flex justify-between"><span className="text-muted-foreground">Scheduled</span><span>{new Date(operation.scheduled_at).toLocaleString()}</span></div>}
              </div>

              {operation.outcome_notes && (
                <div className="border-t pt-4 text-sm">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Outcome Notes</p>
                  <p>{operation.outcome_notes}</p>
                  {operation.cause_of_death && <p className="text-destructive mt-1"><strong>Cause of death:</strong> {operation.cause_of_death}</p>}
                </div>
              )}
            </div>

            {/* Patient context — best-effort, only populates for an LIS-identified patient */}
            <div className="bg-card rounded-lg border shadow-sm p-5">
              <h3 className="font-medium flex items-center gap-2 mb-3 text-sm"><Activity className="w-4 h-4 text-primary" /> Recent Results & Vitals</h3>
              {!patientVisits || patientVisits.length === 0 ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><FileWarning className="w-3.5 h-3.5" /> No linked visit history found for this patient.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {patientVisits.slice(0, 5).map((v: any, i: number) => (
                    <div key={v.id || i} className="text-xs border-b border-border/50 pb-2 last:border-0 space-y-1.5">
                      <p className="font-medium">{v.created_at ? formatDate(v.created_at) : ''}</p>
                      {v.vitals && <p className="text-muted-foreground">Vitals: {Object.entries(v.vitals).filter(([, val]) => val).map(([k, val]) => `${k}: ${val}`).join(', ') || '—'}</p>}
                      {v.tests?.map((t: any) => {
                        const results = labResultsBySpecimen[t.id];
                        return (
                          <div key={t.id} className="pl-2 border-l-2 border-border/70">
                            <p className="text-muted-foreground">{t.test_name || t.name} — <span className="capitalize">{(t.status || '').replace('_', ' ')}</span></p>
                            {t.status === 'approved' && Array.isArray(results) && results.length > 0 && (
                              <table className="w-full text-xs mt-1">
                                <tbody>
                                  {results.map((r: any) => (
                                    <tr key={r.id} className={r.flag ? 'text-destructive' : ''}>
                                      <td className="pr-2 py-0.5">{r.analyte}</td>
                                      <td className="pr-2 py-0.5 font-mono">{r.value} {r.unit || ''}</td>
                                      <td className="text-muted-foreground py-0.5">{r.reference_range || ''}{r.flag ? ` (${r.flag})` : ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Full multi-member roster — the summary lines above stay as the
                quick-glance primary per role; this is the complete list. */}
            <div className="bg-card rounded-lg border shadow-sm p-5">
              <h3 className="font-medium flex items-center gap-2 mb-3 text-sm"><Users className="w-4 h-4 text-primary" /> Surgical Team</h3>
              {TEAM_ROLES.map((role) => {
                const members = (operation.team || []).filter((m) => m.role === role);
                const availableEmployees = employees.filter((e) => !members.some((m) => m.employee_id === e.id));
                return (
                  <div key={role} className="mb-3 last:mb-0">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{ROLE_LABEL[role]}</p>
                    {members.length === 0 && <p className="text-xs text-muted-foreground mb-1">None assigned</p>}
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between text-sm py-0.5">
                        <span>{m.first_name} {m.last_name}</span>
                        {canWrite && ['scheduled', 'in_progress'].includes(operation.status) && (
                          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => handleRemoveTeamMember(m.id)}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {canWrite && ['scheduled', 'in_progress'].includes(operation.status) && (
                      <Combobox
                        options={availableEmployees.map((e) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` }))}
                        value="" onChange={(empId) => empId && handleAddTeamMember(role, empId)}
                        placeholder={`Add ${ROLE_LABEL[role].toLowerCase()}...`} searchPlaceholder="Search employees..."
                        className="h-8 mt-1"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT: phase workflow — checklist + vitals */}
          <div className="space-y-4 min-w-0">
            <div className="flex gap-1 border-b border-border">
              {PHASES.map((phase) => (
                <button
                  key={phase}
                  onClick={() => setActivePhase(phase)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activePhase === phase ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  {PHASE_LABEL[phase]}
                </button>
              ))}
            </div>

            <Card>
              <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm">Checklist</h4></div>
              <CardContent className="p-4 space-y-1.5">
                {checklistForPhase.map((item) => (
                  <button
                    key={item.id}
                    disabled={!canWrite}
                    onClick={() => toggleChecklistItem(item.id, !item.is_checked)}
                    className="w-full flex items-start gap-2.5 text-left px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors disabled:cursor-default"
                  >
                    {item.is_checked ? <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" /> : <Circle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
                    <span className={`text-sm ${item.is_checked ? 'line-through text-muted-foreground' : ''}`}>{item.item_text}</span>
                  </button>
                ))}
                {canWrite && (
                  <div className="flex gap-2 pt-2">
                    <Input value={newItemText} onChange={(e) => setNewItemText(e.target.value)} placeholder="Add a custom checklist item..." className="h-8 text-sm" />
                    <Button size="sm" variant="outline" className="h-8 px-2.5" onClick={addChecklistItem}><Plus className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <Card>
              <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm">Vitals — {PHASE_LABEL[activePhase]}</h4></div>
              <CardContent className="p-4 space-y-3">
                {canWrite && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <Input placeholder="BP" value={vBp} onChange={(e) => setVBp(e.target.value)} className="h-8 text-sm" />
                    <Input placeholder="Pulse" type="number" value={vPulse} onChange={(e) => setVPulse(e.target.value)} className="h-8 text-sm" />
                    <Input placeholder="Temp °C" type="number" step="0.1" value={vTemp} onChange={(e) => setVTemp(e.target.value)} className="h-8 text-sm" />
                    <Input placeholder="RR" type="number" value={vResp} onChange={(e) => setVResp(e.target.value)} className="h-8 text-sm" />
                    <Input placeholder="SpO2 %" type="number" value={vSpo2} onChange={(e) => setVSpo2(e.target.value)} className="h-8 text-sm" />
                  </div>
                )}
                {canWrite && (
                  <div className="flex gap-2">
                    <Input placeholder="Notes (optional)" value={vNotes} onChange={(e) => setVNotes(e.target.value)} className="h-8 text-sm flex-1" />
                    <Button size="sm" onClick={recordVitals}>Record</Button>
                  </div>
                )}
                {vitalsForPhase.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No vitals recorded for this phase yet.</p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead><tr className="border-b text-xs text-muted-foreground"><th scope="col" className="text-left py-1.5">Time</th><th scope="col" className="text-left py-1.5">BP</th><th scope="col" className="text-left py-1.5">Pulse</th><th scope="col" className="text-left py-1.5">Temp</th><th scope="col" className="text-left py-1.5">RR</th><th scope="col" className="text-left py-1.5">SpO2</th></tr></thead>
                    <tbody>
                      {vitalsForPhase.map((v) => (
                        <tr key={v.id} className="border-b border-border/50">
                          <td className="py-1.5">{new Date(v.recorded_at).toLocaleTimeString()}</td>
                          <td className="py-1.5">{v.blood_pressure || '—'}</td>
                          <td className="py-1.5">{v.pulse ?? '—'}</td>
                          <td className="py-1.5">{v.temperature ?? '—'}</td>
                          <td className="py-1.5">{v.respiratory_rate ?? '—'}</td>
                          <td className="py-1.5">{v.spo2 ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm">Drugs, Consumables & Blood Used</h4></div>
              <CardContent className="p-4 space-y-3">
                {canWrite && (
                  <div className="space-y-2">
                    <Combobox
                      options={locations.map((l) => ({ value: l.id, label: `${l.location_name} (${l.location_type})` }))}
                      value={locationId} onChange={(v) => { setLocationId(v); setSelectedItem(null); setItemSearch(''); }}
                      placeholder="Storage location..." searchPlaceholder="Search locations..." className="h-9"
                    />
                    {locationId && (
                      selectedItem ? (
                        <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-muted/30 text-sm">
                          <div>
                            <span className="font-medium">{selectedItem.item_name}</span>
                            <span className="text-muted-foreground ml-2">{selectedItem.available_quantity} {selectedItem.unit_of_measure} available</span>
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => { setSelectedItem(null); setItemSearch(''); }}>×</Button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Input placeholder="Search items at this location..." value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} className="h-9 text-sm" />
                          {itemSearch.length >= 1 && (
                            <div className="mt-1 border rounded-md max-h-44 overflow-y-auto bg-card shadow-sm">
                              {searchingItems ? (
                                <p className="text-sm text-muted-foreground px-3 py-2">Searching...</p>
                              ) : itemResults.length === 0 ? (
                                <p className="text-sm text-muted-foreground px-3 py-2">No matching items with stock here.</p>
                              ) : itemResults.map((it: StockItemOption) => (
                                <button key={it.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between" onClick={() => setSelectedItem(it)}>
                                  <span>{it.item_name}</span>
                                  <span className="text-xs text-muted-foreground">{it.available_quantity} {it.unit_of_measure}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    )}
                    {selectedItem && (
                      <div className="flex gap-2">
                        <Input placeholder="Quantity" type="number" min="0" step="0.01" value={itemQty} onChange={(e) => setItemQty(e.target.value)} className="h-9 text-sm w-28" />
                        <Input placeholder="Notes (optional)" value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} className="h-9 text-sm flex-1" />
                        <Button size="sm" onClick={recordItemUsage} disabled={recordingItem} className="gap-1.5">
                          {recordingItem ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Syringe className="h-3.5 w-3.5" />} Use
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {operation.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Nothing recorded as used yet.</p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead><tr className="border-b text-xs text-muted-foreground"><th scope="col" className="text-left py-1.5">Time</th><th scope="col" className="text-left py-1.5">Item</th><th scope="col" className="text-right py-1.5">Qty</th><th scope="col" className="text-left py-1.5">From</th></tr></thead>
                    <tbody>
                      {operation.items.map((it) => (
                        <tr key={it.id} className="border-b border-border/50">
                          <td className="py-1.5">{new Date(it.dispensed_at).toLocaleTimeString()}</td>
                          <td className="py-1.5">{it.item_name}</td>
                          <td className="py-1.5 text-right font-mono">{it.quantity} {it.unit_of_measure}</td>
                          <td className="py-1.5">{it.location_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
            </div>

            {completing && (
              <Card>
                <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm">Complete Operation</h4></div>
                <CardContent className="p-5 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Outcome</label>
                    <Combobox
                      options={[
                        { value: 'successful', label: 'Successful' }, { value: 'complication', label: 'Complication' },
                        { value: 'aborted', label: 'Aborted' }, { value: 'death', label: 'Patient Died' },
                      ]}
                      value={outcome} onChange={setOutcome} searchPlaceholder="Search..."
                    />
                  </div>
                  {outcome === 'death' && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">Cause of Death</label>
                      <Input value={causeOfDeath} onChange={(e) => setCauseOfDeath(e.target.value)} placeholder="Required" />
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Notes</label>
                    <Input value={outcomeNotes} onChange={(e) => setOutcomeNotes(e.target.value)} placeholder="Optional" />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setCompleting(false)}>Cancel</Button>
                    <Button onClick={handleComplete} disabled={busy} className={outcome === 'death' ? 'bg-destructive hover:bg-destructive/90' : ''}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Confirm Completion
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
