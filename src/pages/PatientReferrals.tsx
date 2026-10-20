import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge } from '@/components/common';
import { ArrowLeftRight, Plus, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { fetchPatientDirectory, type DirectoryPerson } from '@/lib/patientDirectory';
import { AdvancedDataTable, type Column } from '@/components/common/DataTable/AdvancedDataTable';

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

          <AdvancedDataTable<ReferralRow>
            data={referrals}
            keyExtractor={(r) => r.id}
            loading={loading}
            emptyMessage="No referrals yet. Click &quot;New Referral&quot; to send a patient's care to another branch."
            onRowClick={(r) => navigate(`/patient-referrals/${r.id}`)}
            searchable
            searchPlaceholder="Search by patient, branch, or requester..."
            exportable
            exportFileName="patient-referrals"
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            columns={[
              { key: 'patient_name', header: 'Patient', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
              { key: 'from_branch_name', header: 'From Branch', sortable: true },
              { key: 'to_branch_name', header: 'To Branch', sortable: true },
              {
                key: 'reason', header: 'Reason', render: (v) => (
                  <span className="text-muted-foreground truncate block max-w-[220px]" title={v || ''}>{v || '—'}</span>
                ),
              },
              { key: 'requested_by_name', header: 'Requested By', sortable: true, render: (v) => v || 'Unknown' },
              {
                key: 'created_at', header: 'Requested At', sortable: true,
                render: (v) => <span className="text-muted-foreground whitespace-nowrap">{new Date(v).toLocaleString()}</span>,
              },
              {
                key: 'status', header: 'Status', sortable: true,
                render: (v, r) => <StatusBadge status={v} map={REFERRAL_STATUS_TONE} label={v} />,
              },
              {
                key: '__action', header: 'Action',
                render: (_v, r) => (
                  canRespond(r) ? (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-warning-bg text-warning uppercase whitespace-nowrap">
                      Needs your response
                    </span>
                  ) : r.status === 'accepted' && !r.queued_order_id && (isAdmin || Number(r.to_branch_id) === myBranchId) ? (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-info-bg text-info uppercase whitespace-nowrap">
                      Ready to queue
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )
                ),
              },
            ] as Column<ReferralRow>[]}
          />
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
