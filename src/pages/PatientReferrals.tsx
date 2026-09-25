import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge } from '@/components/common';
import { ArrowLeftRight, Plus, Loader2, Send, User, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { fetchPatientDirectory, type DirectoryPerson } from '@/lib/patientDirectory';

export interface ReferralRow {
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
  queued_at: string | null;
  queued_order_id: string | null;
}

export const REFERRAL_STATUS_TONE: Record<string, any> = { pending: 'warning', accepted: 'success', rejected: 'danger', cancelled: 'neutral' };

export default function PatientReferrals() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [newPatientId, setNewPatientId] = useState('');
  const [newToBranchId, setNewToBranchId] = useState('');
  const [newReason, setNewReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  const myBranchId = user?.branchId ? Number(user.branchId) : null;
  const isAdmin = !!user?.isAdmin;
  const canRespond = (r: ReferralRow) => r.status === 'pending' && (isAdmin || Number(r.to_branch_id) === myBranchId);

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
                  onClick={() => navigate(`/patient-referrals/${r.id}`)}
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
                    {r.status === 'accepted' && !r.queued_order_id && (isAdmin || Number(r.to_branch_id) === myBranchId) && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 uppercase">
                        Ready to queue
                      </span>
                    )}
                    <StatusBadge status={r.status} map={REFERRAL_STATUS_TONE} label={r.status} />
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
    </AppLayout>
  );
}
