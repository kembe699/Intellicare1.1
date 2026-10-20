import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge } from '@/components/common';
import {
  ArrowLeft, ArrowLeftRight, Loader2, Check, X, Building2, User, Calendar,
  Pill, TestTube2, UserPlus, CheckCircle2, Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from '@/lib/notify';
import * as docTemplate from '@/utils/documentTemplate';
import { type ReferralRow, REFERRAL_STATUS_TONE } from './PatientReferrals';
import { formatDate } from '@/lib/format';

// Mirrors LISTestOrders.tsx's own print-time remark logic exactly — a
// result's flag column is set by whoever entered it and isn't always
// reliable, so the value is checked against its own reference range rather
// than trusting r.flag alone.
function computeRemark(value: string | null, referenceRange: string | null): { label: string; tone: 'high' | 'low' | 'normal' | 'unknown' } {
  if (!referenceRange || !value) return { label: '—', tone: 'unknown' };
  const parts = referenceRange.split('-').map((p) => p.trim());
  if (parts.length !== 2) return { label: 'NORMAL', tone: 'normal' };
  const min = parseFloat(parts[0]);
  const max = parseFloat(parts[1]);
  const val = parseFloat(value);
  if (Number.isNaN(min) || Number.isNaN(max) || Number.isNaN(val)) return { label: 'NORMAL', tone: 'normal' };
  if (val < min) return { label: 'LOW', tone: 'low' };
  if (val > max) return { label: 'HIGH', tone: 'high' };
  return { label: 'NORMAL', tone: 'normal' };
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

export default function PatientReferralDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const facilityInfo = useFacilityInfo();

  const [detail, setDetail] = useState<ReferralDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [doctors, setDoctors] = useState<{ id: number; display_name: string; branch_ids: number[]; branch_id: number | null }[]>([]);
  const [queueDoctorId, setQueueDoctorId] = useState('');
  const [queuing, setQueuing] = useState(false);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/patient-referrals/${id}`, { credentials: 'include' });
      if (res.ok) setDetail(await res.json());
      else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to load referral');
        navigate('/patient-referrals');
      }
    } catch {
      toast.error('Network error');
      navigate('/patient-referrals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDetail(); }, [id]);

  const fetchDoctors = async () => {
    if (doctors.length > 0) return;
    try {
      const res = await authFetch('/api/users?role=doctor&all=true', { credentials: 'include' });
      if (res.ok) {
        const rows = await res.json();
        setDoctors(rows.map((d: any) => ({
          id: d.id, display_name: d.display_name, branch_id: d.branch_id != null ? Number(d.branch_id) : null,
          branch_ids: Array.isArray(d.branch_ids) ? d.branch_ids.map(Number) : [],
        })));
      }
    } catch { /* doctor picker just stays empty */ }
  };

  useEffect(() => {
    if (detail?.referral.status === 'accepted' && !detail.referral.queued_order_id) fetchDoctors();
  }, [detail?.referral.status, detail?.referral.queued_order_id]);

  const decide = async (action: 'accept' | 'reject' | 'cancel', reason?: string) => {
    if (!id) return;
    setDeciding(true);
    try {
      const res = await authFetch(`/api/patient-referrals/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(reason ? { decision_reason: reason } : {}),
      });
      if (res.ok) {
        toast.success(
          action === 'accept' ? 'Referral accepted — now select a doctor to queue the patient' :
          action === 'reject' ? 'Referral rejected' : 'Referral cancelled'
        );
        setShowRejectReason(false);
        fetchDetail();
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

  const handleQueue = async () => {
    if (!id || !queueDoctorId) return toast.error('Select a doctor');
    setQueuing(true);
    try {
      const res = await authFetch(`/api/patient-referrals/${id}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ doctor_id: parseInt(queueDoctorId, 10) }),
      });
      if (res.ok) {
        toast.success('Patient queued');
        fetchDetail();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to queue patient');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setQueuing(false);
    }
  };

  // Same shared template/print-window flow LISTestOrders.tsx's Visit Summary
  // print already uses — buildDocument for the branded letterhead/footer,
  // openPrintWindow triggers the browser's own print dialog, whose "Save as
  // PDF" destination is this app's download path (no separate PDF library
  // anywhere else in the codebase to diverge from).
  const handlePrint = async () => {
    if (!detail) return;
    const { referral, patient, visits, lab_results, prescriptions } = detail;
    const patientName = patient ? `${patient.first_name} ${patient.last_name}`.trim() : referral.patient_name;
    const signature = await docTemplate.fetchUserSignature(user?.uid);

    const plainNote = (label: string, value?: string | null) =>
      value ? `<p style="margin:2px 0 8px 0;font-size:11px;line-height:1.5;color:#334155;"><strong style="color:#0F172A">${label}:</strong> ${value}</p>` : '';

    const visitsHTML = visits.length > 0 ? [
      '<div class="ic-section-title">Recent Visits</div>',
      docTemplate.buildTable(
        [{ label: 'Date' }, { label: 'Status' }, { label: 'Notes' }],
        visits.map((v) => ({ cells: [docTemplate.formatDate(v.created_at), v.status, v.clinical_notes || '—'] }))
      ),
    ].join('\n') : '';

    const labResultsHTML = lab_results.length > 0 ? [
      '<div class="ic-section-title">Lab Results</div>',
      (() => {
        const rows = lab_results.map((l) => {
          const remark = computeRemark(l.value, l.reference_range);
          return `<tr>
            <td class="bold" style="color:#0F172A">${l.test ? `${l.test} — ` : ''}${l.analyte}</td>
            <td class="bold" style="color:${remark.tone === 'high' ? '#dc2626' : remark.tone === 'low' ? '#1A7A75' : '#0F172A'}">${l.value || '—'}</td>
            <td class="center" style="color:#64748B">${l.reference_range || '—'}</td>
            <td class="center" style="color:#64748B">${l.unit || '—'}</td>
            <td>${remark.label}</td>
          </tr>`;
        }).join('');
        return `<table class="ic-table">
          <thead><tr><th style="width:30%">Component</th><th style="width:15%">Value</th><th class="center" style="width:25%">Reference Range</th><th class="center" style="width:15%">Units</th><th style="width:15%">Remark</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      })(),
    ].join('\n') : '';

    const prescriptionsHTML = prescriptions.length > 0 ? [
      '<div class="ic-section-title">Prescriptions</div>',
      docTemplate.buildTable(
        [{ label: 'Drug' }, { label: 'Strength' }, { label: 'Frequency' }, { label: 'Duration' }, { label: 'Date' }],
        prescriptions.map((p) => ({
          cells: [p.drug_name, p.dose_strength || '—', p.frequency || '—', p.duration_days ? `${p.duration_days} day(s)` : '—', docTemplate.formatDate(p.prescription_date)],
        }))
      ),
    ].join('\n') : '';

    const bodyHTML = [
      docTemplate.buildInfoGrid(
        { title: 'Patient Details', rows: [
          { label: 'Patient Name', value: patientName, bold: true },
          { label: 'Participant ID', value: patient?.participant_number || '—' },
          { label: 'Age / Gender', value: `${calculateAge(patient?.date_of_birth || null) ?? '—'}${patient?.gender ? ` · ${patient.gender}` : ''}` },
          { label: 'Phone', value: patient?.phone || '—' },
        ]},
        { title: 'Referral Details', rows: [
          { label: 'From Branch', value: referral.from_branch_name },
          { label: 'To Branch', value: referral.to_branch_name },
          { label: 'Status', value: referral.status.charAt(0).toUpperCase() + referral.status.slice(1), bold: true },
          { label: 'Requested By', value: referral.requested_by_name || 'Unknown' },
          { label: 'Requested At', value: docTemplate.formatDate(referral.created_at) },
        ]}
      ),
      plainNote('Reason for Referral', referral.reason),
      referral.status !== 'pending' ? plainNote(`Decision Note — ${referral.decided_by_name || ''}`, referral.decision_reason) : '',
      visitsHTML,
      labResultsHTML,
      prescriptionsHTML,
      docTemplate.buildSignatures([
        { label: 'Printed By', name: user?.displayName || '', signature: signature || undefined },
        { label: 'Requesting Doctor', name: referral.requested_by_name || '' },
      ]),
    ].join('\n');

    const html = docTemplate.buildDocument({
      title: 'Patient Referral',
      docType: 'Patient Referral Report',
      docNumber: `REF-${referral.id.slice(-6).toUpperCase()}`,
      status: referral.status,
      date: new Date(referral.created_at),
      bodyHTML,
      logoUrl: facilityInfo.facilityLogo || `${window.location.origin}/hjd-icon.png`,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });

    docTemplate.openPrintWindow(html);
  };

  const myBranchId = user?.branchId ? Number(user.branchId) : null;
  const isAdmin = !!user?.isAdmin;
  const canRespond = detail ? detail.referral.status === 'pending' && (isAdmin || Number(detail.referral.to_branch_id) === myBranchId) : false;
  const canCancel = detail ? detail.referral.status === 'pending' && (isAdmin || String(detail.referral.requested_by) === String(user?.id)) : false;
  const canQueue = detail ? detail.referral.status === 'accepted' && !detail.referral.queued_order_id && (isAdmin || Number(detail.referral.to_branch_id) === myBranchId) : false;
  const eligibleDoctors = detail ? doctors.filter((d) => d.branch_id === detail.referral.to_branch_id || d.branch_ids.includes(detail.referral.to_branch_id)) : [];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="w-full max-w-4xl mx-auto flex flex-col">
          <Button variant="ghost" size="sm" onClick={() => navigate('/patient-referrals')} className="self-start text-muted-foreground hover:text-foreground -ml-2 mb-2">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Referrals
          </Button>
          <div className="flex justify-between items-start">
            <PageHeader title="Referral Details" icon={<ArrowLeftRight />} />
            {detail && (
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" /> Print / Download PDF
              </Button>
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
            </div>
          )}

          {detail && (
            <div className="mt-4 bg-card rounded-lg border shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between gap-3 p-3 bg-muted/40 rounded-lg border">
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{detail.referral.from_branch_name}</span>
                  <ArrowLeftRight className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium">{detail.referral.to_branch_name}</span>
                </div>
                <StatusBadge status={detail.referral.status} map={REFERRAL_STATUS_TONE} label={detail.referral.status} />
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
                    <div><div className="text-xs text-muted-foreground uppercase font-semibold">Name</div>{detail.patient.first_name} {detail.patient.last_name}</div>
                    <div><div className="text-xs text-muted-foreground uppercase font-semibold">Age / Gender</div>{calculateAge(detail.patient.date_of_birth) ?? '—'}{detail.patient.gender ? ` · ${detail.patient.gender}` : ''}</div>
                    <div><div className="text-xs text-muted-foreground uppercase font-semibold">ID</div><span className="font-mono">{detail.patient.participant_number}</span></div>
                    <div><div className="text-xs text-muted-foreground uppercase font-semibold">Phone</div>{detail.patient.phone || '—'}</div>
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
                  <div className="border rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                          <th className="px-3 py-2 font-semibold">Test</th>
                          <th className="px-3 py-2 font-semibold">Component</th>
                          <th className="px-3 py-2 font-semibold">Value</th>
                          <th className="px-3 py-2 font-semibold">Reference Range</th>
                          <th className="px-3 py-2 font-semibold">Unit</th>
                          <th className="px-3 py-2 font-semibold">Remark</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {detail.lab_results.map((l, i) => {
                          const remark = computeRemark(l.value, l.reference_range);
                          return (
                            <tr key={i}>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{l.test || '—'}</td>
                              <td className="px-3 py-2 font-medium">{l.analyte}</td>
                              <td className={`px-3 py-2 font-mono font-semibold ${remark.tone === 'high' ? 'text-destructive' : remark.tone === 'low' ? 'text-primary' : ''}`}>{l.value || '—'}</td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{l.reference_range || '—'}</td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{l.unit || '—'}</td>
                              <td className="px-3 py-2">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${
                                  remark.tone === 'high' ? 'bg-destructive-bg text-destructive' :
                                  remark.tone === 'low' ? 'bg-info-bg text-info' :
                                  remark.tone === 'normal' ? 'bg-success-bg text-success' : 'bg-muted text-muted-foreground'
                                }`}>{remark.label}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-3 border rounded-lg text-sm text-muted-foreground text-center">No approved lab results on record.</div>
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
                        <span className="text-xs text-muted-foreground">{formatDate(p.prescription_date)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 border rounded-lg text-sm text-muted-foreground text-center">No prescriptions on record.</div>
                )}
              </div>

              {/* ── Queue Patient — appears once accepted, until actually queued ── */}
              {detail.referral.status === 'accepted' && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5" /> Queue Patient
                  </h4>
                  {detail.referral.queued_order_id ? (
                    <div className="p-3 border rounded-lg bg-success-bg border-success-border text-sm text-success flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Patient has been queued at {detail.referral.to_branch_name}.
                    </div>
                  ) : (
                    <div className="p-3 border rounded-lg bg-card space-y-2.5">
                      <p className="text-xs text-muted-foreground">Select the doctor this patient should be queued to at {detail.referral.to_branch_name}.</p>
                      <Combobox
                        options={eligibleDoctors.map((d) => ({ value: String(d.id), label: d.display_name }))}
                        value={queueDoctorId}
                        onChange={setQueueDoctorId}
                        placeholder={eligibleDoctors.length === 0 ? 'No doctors found at this branch' : 'Select doctor...'}
                        searchPlaceholder="Search doctors..."
                        className="h-9"
                      />
                      <Button onClick={handleQueue} disabled={queuing || !queueDoctorId || !canQueue} className="w-full">
                        {queuing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                        Queue Patient
                      </Button>
                    </div>
                  )}
                </div>
              )}

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

              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {canRespond && !showRejectReason && (
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
                {canRespond && showRejectReason && (
                  <>
                    <Button variant="outline" onClick={() => setShowRejectReason(false)} disabled={deciding}>Back</Button>
                    <Button variant="destructive" onClick={() => decide('reject', rejectReason.trim() || undefined)} disabled={deciding}>
                      {deciding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-2" />}
                      Confirm Reject
                    </Button>
                  </>
                )}
                {!canRespond && canCancel && (
                  <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => decide('cancel')} disabled={deciding}>
                    {deciding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-2" />}
                    Cancel Referral
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
