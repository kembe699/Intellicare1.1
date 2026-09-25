import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge } from '@/components/common';
import {
  ArrowLeftRight, Plus, Loader2, Check, X, Send, Building2, User, Calendar,
  Pill, TestTube2, FileText, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { fetchPatientDirectory, type DirectoryPerson } from '@/lib/patientDirectory';

interface ReferralRow {
  id: string;
  patient_id: string;
  patient_name: string;
  from_branch_id: number;
  to_branch_id: number;
  from_branch_name: string;
  to_branch_name: string;
  reason: string | null;
  requested_by_name: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  decision_reason: string | null;
  decided_by_name: string | null;
  requested_by: number | null;
  created_at: string;
  decided_at: string | null;
}

interface ReferralDetail {
  referral: ReferralRow;
  patient: { id: string; participant_number: string; first_name: string; last_name: string; gender: string | null; date_of_birth: string | null; phone: string | null; residence: string | null } | null;
  visits: { id: string; created_at: string; status: string; clinical_notes: string | null; vitals: Record<string, any> }[];
  lab_results: { test: string | null; analyte: string; value: string; unit: string | null; reference_range: string | null; flag: string | null; status: string }[];
  prescriptions: { prescription_number: string; prescription_date: string; drug_name: string; dose_strength: string | null; frequency: string | null; duration_days: number | null }[];
}

const calculateAge = (dob: string | null): number | null => {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
};

export default function PatientReferrals() {
  const { user } = useAuth();
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [newPatientId, setNewPatientId] = useState('');
  const [newToBranchId, setNewToBranchId] = useState('');
  const [newReason, setNewReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReferralDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const fetchReferrals = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/patient-referrals', { credentials: 'include' });
      if (res.ok) setReferrals(await res.json());
      else toast.error('Failed to load referrals');
    } catch {
      toast.error('Network error loading referrals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReferrals(); }, []);

  const openNewDialog = async () => {
    setShowNewDialog(true);
    setNewPatientId(''); setNewToBranchId(''); setNewReason('');
    if (people.length === 0) {
      const { people: dir, failed } = await fetchPatientDirectory();
      // Referrals are keyed on lis_participants — the main registry's own
      // patients table isn't what this feature (or the rest of the LIS
      // clinical workflow) reads from.
      setPeople(dir.filter((p) => p.source === 'lis'));
      if (failed.length) toast.error(`Could not load ${failed.join(' and ')} — the patient list is incomplete.`);
    }
    if (branches.length === 0) {
      try {
        const res = await authFetch('/api/facilities/branches/all', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const rows = Array.isArray(data) ? data : (data.data || []);
          setBranches(rows.filter((b: any) => b.is_active !== false).map((b: any) => ({ id: Number(b.id), name: b.name })));
        }
      } catch { /* branch picker just stays empty */ }
    }
  };

  const handleCreateReferral = async () => {
    if (!newPatientId) return toast.error('Select a patient');
    if (!newToBranchId) return toast.error('Select the receiving branch');
    setSubmitting(true);
    try {
      const res = await authFetch('/api/patient-referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ patient_id: newPatientId, to_branch_id: parseInt(newToBranchId, 10), reason: newReason.trim() || null }),
      });
      if (res.ok) {
        toast.success('Referral sent');
        setShowNewDialog(false);
        fetchReferrals();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to send referral');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setShowRejectReason(false);
    setRejectReason('');
    setDetailLoading(true);
    try {
      const res = await authFetch(`/api/patient-referrals/${id}`, { credentials: 'include' });
      if (res.ok) setDetail(await res.json());
      else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to load referral');
        setSelectedId(null);
      }
    } catch {
      toast.error('Network error');
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const decide = async (action: 'accept' | 'reject' | 'cancel', reason?: string) => {
    if (!selectedId) return;
    setDeciding(true);
    try {
      const res = await authFetch(`/api/patient-referrals/${selectedId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(reason ? { decision_reason: reason } : {}),
      });
      if (res.ok) {
        toast.success(
          action === 'accept' ? 'Referral accepted — the patient now belongs to this branch' :
          action === 'reject' ? 'Referral rejected' : 'Referral cancelled'
        );
        setSelectedId(null);
        setDetail(null);
        fetchReferrals();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to update referral');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setDeciding(false);
    }
  };

  const myBranchId = user?.branchId ? Number(user.branchId) : null;
  const isAdmin = !!user?.isAdmin;
  const canRespond = (r: ReferralRow) => r.status === 'pending' && (isAdmin || Number(r.to_branch_id) === myBranchId);
  const canCancel = (r: ReferralRow) => r.status === 'pending' && (isAdmin || String(r.requested_by) === String(user?.id));

  const statusTone: Record<string, any> = { pending: 'warning', accepted: 'success', rejected: 'danger', cancelled: 'neutral' };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="w-full flex flex-col">
          <div className="flex justify-between items-start mb-6">
            <PageHeader title="Patient Referral" icon={<ArrowLeftRight />} />
            <Button onClick={openNewDialog} className="gap-2">
              <Plus className="w-4 h-4" /> New Referral
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading referrals...
            </div>
          ) : referrals.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground border border-dashed rounded-lg bg-card">
              No referrals yet. Click "New Referral" to send a patient's care to another branch.
            </div>
          ) : (
            <div className="space-y-2">
              {referrals.map((r) => (
                <button
                  key={r.id}
                  onClick={() => openDetail(r.id)}
                  className="w-full text-left bg-card border rounded-lg p-4 flex items-center justify-between gap-4 hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.patient_name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="font-medium">{r.from_branch_name}</span>
                        <ArrowLeftRight className="w-3 h-3" />
                        <span className="font-medium">{r.to_branch_name}</span>
                        <span className="mx-1">·</span>
                        {r.requested_by_name || 'Unknown'}
                        <span className="mx-1">·</span>
                        {new Date(r.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {canRespond(r) && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase">
                        Needs your response
                      </span>
                    )}
                    <StatusBadge status={r.status} map={statusTone} label={r.status} />
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── New Referral ── */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="w-5 h-5 text-primary" /> New Referral</DialogTitle>
            <DialogDescription>Send this patient's care to another branch for review.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 pt-2 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Patient</label>
              <Combobox
                options={people.map((p) => ({ value: p.id, label: p.label }))}
                value={newPatientId}
                onChange={setNewPatientId}
                placeholder="Search patient..."
                searchPlaceholder="Search by name..."
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Receiving Branch</label>
              <Combobox
                options={branches.filter((b) => !myBranchId || b.id !== myBranchId).map((b) => ({ value: String(b.id), label: b.name }))}
                value={newToBranchId}
                onChange={setNewToBranchId}
                placeholder="Select branch..."
                searchPlaceholder="Search branches..."
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Reason for Referral</label>
              <Textarea
                placeholder="Why this patient needs to be seen at the other branch..."
                className="resize-none h-24"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateReferral} disabled={submitting || !newPatientId || !newToBranchId}>
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {submitting ? 'Sending...' : 'Send Referral'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Referral Detail ── */}
      <Dialog open={!!selectedId} onOpenChange={(o) => { if (!o) { setSelectedId(null); setDetail(null); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-primary" /> Referral Details</DialogTitle>
          </DialogHeader>

          {detailLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
            </div>
          )}

          {detail && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3 p-3 bg-muted/40 rounded-lg border">
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{detail.referral.from_branch_name}</span>
                  <ArrowLeftRight className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium">{detail.referral.to_branch_name}</span>
                </div>
                <StatusBadge status={detail.referral.status} map={statusTone} label={detail.referral.status} />
              </div>

              {detail.referral.reason && (
                <div className="text-sm p-3 border rounded-lg bg-card">
                  <span className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Reason for Referral</span>
                  {detail.referral.reason}
                </div>
              )}

              {detail.referral.status !== 'pending' && detail.referral.decision_reason && (
                <div className="text-sm p-3 border rounded-lg bg-card">
                  <span className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
                    Decision note — {detail.referral.decided_by_name}
                  </span>
                  {detail.referral.decision_reason}
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Patient
                </h4>
                {detail.patient ? (
                  <div className="p-3 border rounded-lg bg-card text-sm grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div><div className="text-[10px] text-muted-foreground uppercase font-semibold">Name</div>{detail.patient.first_name} {detail.patient.last_name}</div>
                    <div><div className="text-[10px] text-muted-foreground uppercase font-semibold">Age / Gender</div>{calculateAge(detail.patient.date_of_birth) ?? '—'}{detail.patient.gender ? ` · ${detail.patient.gender}` : ''}</div>
                    <div><div className="text-[10px] text-muted-foreground uppercase font-semibold">ID</div><span className="font-mono">{detail.patient.participant_number}</span></div>
                    <div><div className="text-[10px] text-muted-foreground uppercase font-semibold">Phone</div>{detail.patient.phone || '—'}</div>
                  </div>
                ) : (
                  <div className="p-3 border rounded-lg text-sm text-muted-foreground text-center">Patient record not found.</div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Recent Visits ({detail.visits.length})
                </h4>
                {detail.visits.length > 0 ? (
                  <div className="space-y-2">
                    {detail.visits.map((v) => (
                      <div key={v.id} className="p-3 border rounded-lg bg-card text-sm">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>{new Date(v.created_at).toLocaleString()}</span>
                          <span className="capitalize">{v.status}</span>
                        </div>
                        {v.clinical_notes && <p className="text-sm">{v.clinical_notes}</p>}
                        {Object.keys(v.vitals || {}).length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {Object.entries(v.vitals).filter(([, val]) => val).map(([k, val]) => `${k.replace(/_/g, ' ')}: ${val}`).join(' · ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 border rounded-lg text-sm text-muted-foreground text-center">No visits on record.</div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                  <TestTube2 className="w-3.5 h-3.5" /> Lab Results ({detail.lab_results.length})
                </h4>
                {detail.lab_results.length > 0 ? (
                  <div className="border rounded-lg divide-y">
                    {detail.lab_results.map((l, i) => (
                      <div key={i} className="flex justify-between items-center px-3 py-2 text-sm">
                        <span>{l.test ? `${l.test} — ` : ''}{l.analyte}: {l.value} {l.unit || ''}{l.reference_range ? ` (ref: ${l.reference_range})` : ''}</span>
                        {l.flag && l.flag !== 'normal' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-red-100 text-red-700">{l.flag}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 border rounded-lg text-sm text-muted-foreground text-center">No lab results on record.</div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                  <Pill className="w-3.5 h-3.5" /> Prescriptions ({detail.prescriptions.length})
                </h4>
                {detail.prescriptions.length > 0 ? (
                  <div className="border rounded-lg divide-y">
                    {detail.prescriptions.map((p, i) => (
                      <div key={i} className="flex justify-between items-center px-3 py-2 text-sm">
                        <span>{p.drug_name}{p.dose_strength ? ` · ${p.dose_strength}` : ''}{p.frequency ? ` · ${p.frequency}` : ''}{p.duration_days ? ` · ${p.duration_days}d` : ''}</span>
                        <span className="text-xs text-muted-foreground">{new Date(p.prescription_date).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 border rounded-lg text-sm text-muted-foreground text-center">No prescriptions on record.</div>
                )}
              </div>

              {showRejectReason && (
                <div className="space-y-2 p-3 border rounded-lg bg-card">
                  <label className="text-xs font-medium text-muted-foreground">Reason for rejecting (optional)</label>
                  <Textarea
                    placeholder="Why can't this branch take the case..."
                    className="resize-none h-20"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {detail && (
            <DialogFooter className="flex-wrap gap-2">
              {canRespond(detail.referral) && !showRejectReason && (
                <>
                  <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setShowRejectReason(true)} disabled={deciding}>
                    <X className="w-4 h-4 mr-2" /> Reject
                  </Button>
                  <Button onClick={() => decide('accept')} disabled={deciding}>
                    {deciding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    Accept
                  </Button>
                </>
              )}
              {canRespond(detail.referral) && showRejectReason && (
                <>
                  <Button variant="outline" onClick={() => setShowRejectReason(false)} disabled={deciding}>Back</Button>
                  <Button variant="destructive" onClick={() => decide('reject', rejectReason.trim() || undefined)} disabled={deciding}>
                    {deciding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-2" />}
                    Confirm Reject
                  </Button>
                </>
              )}
              {!canRespond(detail.referral) && canCancel(detail.referral) && (
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => decide('cancel')} disabled={deciding}>
                  {deciding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-2" />}
                  Cancel Referral
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
