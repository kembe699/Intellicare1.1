import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingState, StatusBadge } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { ArrowLeft, Scan, Check, Printer, Save, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from 'sonner';
import * as docTemplate from '@/utils/documentTemplate';

interface RadiologyRequestItem {
  id: string;
  request_number: string;
  exam_name: string;
  status: string;
  urgent: boolean;
  request_date: string;
  clinical_indication: string | null;
  report_html: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  reported_by_name: string | null;
  reported_at: string | null;
  first_name: string;
  last_name: string;
  participant_number: string;
  gender: string | null;
  date_of_birth: string | null;
  doctor_name: string | null;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = { pending: 'warning', in_progress: 'neutral', completed: 'success' };
const STATUS_LABEL: Record<string, string> = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground break-words">{value}</p>
    </div>
  );
}

function buildPrintHtml(request: RadiologyRequestItem, facilityInfo: ReturnType<typeof useFacilityInfo>): string {
  const patientBox = {
    title: 'Patient Information',
    rows: [
      { label: 'Name', value: `${request.first_name} ${request.last_name}`, bold: true },
      { label: 'Patient No', value: request.participant_number },
      { label: 'Gender', value: request.gender || 'N/A' },
      { label: 'Date of Birth', value: request.date_of_birth ? new Date(request.date_of_birth).toLocaleDateString() : 'N/A' },
    ],
  };
  const examBox = {
    title: 'Exam Details',
    rows: [
      { label: 'Exam', value: request.exam_name, bold: true },
      { label: 'Requested By', value: request.doctor_name || '-' },
      { label: 'Request Date', value: new Date(request.request_date).toLocaleString() },
      { label: 'Reported By', value: request.reported_by_name || '-' },
    ],
  };
  let body = docTemplate.buildInfoGrid(patientBox, examBox);
  if (request.clinical_indication) {
    body += `<div class="ic-section-title">Clinical Indication</div><p style="font-size:11px;margin:0 0 12px;">${request.clinical_indication}</p>`;
  }
  body += `<div class="ic-section-title">Report</div><div style="font-size:12px;line-height:1.6;">${request.report_html || ''}</div>`;
  body += docTemplate.buildSignatures([{ label: 'Reporting Officer', name: request.reported_by_name || '' }]);

  return docTemplate.buildDocument({
    title: `Radiology Report - ${request.first_name} ${request.last_name}`,
    docType: 'Radiology Report',
    docNumber: request.request_number,
    status: request.status,
    date: request.reported_at || request.request_date,
    bodyHTML: body,
    facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
    branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
  });
}

// One exam's own confirm -> report -> print workflow, unchanged in behavior
// from before this page started showing a whole visit at once — just given
// its own local state so several of these can sit on one page independently.
function RequestCard({ request, canWrite, onChanged }: { request: RadiologyRequestItem; canWrite: boolean; onChanged: () => void }) {
  const facilityInfo = useFacilityInfo();
  const [reportHtml, setReportHtml] = useState(request.report_html || '');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setReportHtml(request.report_html || ''); }, [request.report_html]);

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await authFetch(`/api/radiology/requests/${request.id}/confirm`, { method: 'PUT' });
      if (res.ok) { toast.success(`${request.exam_name} confirmed`); onChanged(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to confirm request'); }
    } catch {
      toast.error('Network error');
    } finally {
      setConfirming(false);
    }
  };

  const handleSaveReport = async (complete: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/radiology/requests/${request.id}/report`, {
        method: 'PUT',
        body: JSON.stringify({ report_html: reportHtml, complete }),
      });
      if (res.ok) { toast.success(complete ? `${request.exam_name} completed` : 'Draft saved'); onChanged(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to save report'); }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    const pw = docTemplate.openPrintWindow(buildPrintHtml(request, facilityInfo));
    if (!pw) toast.error('Please allow popups to print this report');
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
        <Scan className="h-4 w-4 text-primary" />
        <h4 className="font-semibold text-sm text-foreground">{request.exam_name}</h4>
        <span className="text-xs text-muted-foreground font-mono">{request.request_number}</span>
        {request.urgent && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-destructive">
            <AlertTriangle className="h-3 w-3" /> Urgent
          </span>
        )}
        <span className="ml-auto">
          <StatusBadge status={request.status} map={STATUS_TONE} label={STATUS_LABEL[request.status] || request.status} />
        </span>
      </div>
      <CardContent className="p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Requested" value={new Date(request.request_date).toLocaleString()} />
          {request.clinical_indication && (
            <div className="col-span-2 sm:col-span-3">
              <Field label="Clinical Indication" value={request.clinical_indication} />
            </div>
          )}
          {request.confirmed_by_name && (
            <Field label="Confirmed By" value={`${request.confirmed_by_name} · ${new Date(request.confirmed_at!).toLocaleString()}`} />
          )}
          {request.reported_by_name && (
            <Field label="Reported By" value={`${request.reported_by_name} · ${new Date(request.reported_at!).toLocaleString()}`} />
          )}
        </div>

        {request.status === 'pending' && (
          <div className="flex items-center justify-between border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">Confirm this request to begin the exam and unlock the report.</p>
            <Button className="gap-1.5" disabled={confirming || !canWrite} onClick={handleConfirm}>
              {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirm
            </Button>
          </div>
        )}

        {(request.status === 'in_progress' || request.status === 'completed') && (
          <div className="border-t border-border pt-4 space-y-3">
            <RichTextEditor
              value={reportHtml}
              onChange={setReportHtml}
              readOnly={request.status === 'completed' || !canWrite}
              placeholder="Findings and impression..."
            />
            {request.status === 'in_progress' && canWrite && (
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" className="gap-1.5" disabled={saving} onClick={() => handleSaveReport(false)}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Draft
                </Button>
                <Button className="gap-1.5" disabled={saving} onClick={() => handleSaveReport(true)}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Save & Complete
                </Button>
              </div>
            )}
            {request.status === 'completed' && (
              <div className="flex items-center justify-end">
                <Button variant="outline" className="gap-1.5" onClick={handlePrint}>
                  <Printer className="h-3.5 w-3.5" /> Print
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function RadiologyRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPrivilege } = useAuth();
  const [requests, setRequests] = useState<RadiologyRequestItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchVisit = async () => {
    try {
      const res = await authFetch(`/api/radiology/requests/${id}/visit`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      } else {
        toast.error('Radiology request not found');
        setRequests([]);
      }
    } catch (e) {
      toast.error('Failed to load radiology request');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVisit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const canWrite = hasPrivilege('radiology.write');

  if (loading) return <AppLayout><LoadingState message="Loading radiology request..." /></AppLayout>;
  if (!requests || requests.length === 0) return <AppLayout><div className="p-12 text-center text-muted-foreground">Radiology request not found</div></AppLayout>;

  const patient = requests[0];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-5 w-full max-w-4xl mx-auto flex flex-col">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 self-start" onClick={() => navigate('/radiology')}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Radiology
          </Button>

          <Card className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/30">
              <h4 className="font-semibold text-sm text-foreground">Visit — {requests.length} exam{requests.length === 1 ? '' : 's'} requested</h4>
            </div>
            <CardContent className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Patient" value={`${patient.first_name} ${patient.last_name}`} />
              <Field label="Patient No" value={patient.participant_number} />
              <Field label="Doctor" value={patient.doctor_name || '—'} />
              <Field label="Requested" value={new Date(patient.request_date).toLocaleString()} />
            </CardContent>
          </Card>

          {requests.map((r) => (
            <RequestCard key={r.id} request={r} canWrite={canWrite} onChanged={fetchVisit} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
