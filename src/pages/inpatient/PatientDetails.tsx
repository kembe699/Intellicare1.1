import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { useParams, useNavigate } from 'react-router-dom';
import { Stethoscope, Pill, Syringe, ClipboardList, FlaskConical, Radio, LogOut, Loader2, X, Check, AlertTriangle, Receipt, Clock, BedDouble, User2, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FREQUENCY_OPTIONS, calculateQuantity, findFrequency } from '@/lib/prescriptionFrequency';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingState } from '@/components/common';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { Combobox } from '@/components/ui/combobox';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import * as docTemplate from '@/utils/documentTemplate';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

function Field({ label, value, capitalize }: { label: string; value: React.ReactNode; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium text-foreground ${capitalize ? 'capitalize' : ''}`}>{value}</p>
    </div>
  );
}

function FormCard({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" /><h4 className="font-semibold text-sm text-foreground">{title}</h4>
      </div>
      <CardContent className="p-5 space-y-3">{children}</CardContent>
    </Card>
  );
}

// Maps this app's clinical status vocabulary onto the shared Badge's semantic
// variants (success/warning/danger/info/neutral) instead of one-off hex
// classes repeated at every call site — same palette the rest of the redesign
// already standardized on.
const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  improving: 'success', given: 'success', completed: 'success', active: 'info',
  stable: 'info',
  deteriorating: 'warning', delayed: 'warning', held: 'warning',
  critical: 'danger', refused: 'danger', missed: 'danger',
};
const statusVariant = (status?: string) => STATUS_VARIANT[status || ''] || 'neutral';

const OUTCOME_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = { alive: 'success', absconded: 'warning', dead: 'danger' };
const OUTCOME_LABEL: Record<string, string> = { alive: 'Alive', dead: 'Deceased', absconded: 'Absconded' };

export default function PatientDetails() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { id: admissionId } = useParams<{ id: string }>();
  const { user, hasPrivilege } = useAuth();
  const { fmt } = useCurrency();
  const facilityInfo = useFacilityInfo();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('notes');
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [loadingBill, setLoadingBill] = useState(false);
  const [dischargeData, setDischargeData] = useState({ discharge_reason: '', discharge_summary: '', discharge_outcome: '' });

  // ── Forms State ──
  const [noteForm, setNoteForm] = useState({ clinical_assessment: '', examination_findings: '', treatment_plan: '', progress_status: 'stable' });

  const [rxForm, setRxForm] = useState({ drug_id: '', medication_name: '', unit_price: 0, unit_of_measure: '', dosage: '', frequency: '', duration: '', route: 'oral', instructions: '', quantity: '',
    dose_amount: '1', duration_days: '', is_external: false, external_drug_name: '', location_id: '' });
  // Dispensing immediately after prescribing is a separate step from the prescribing
  // form itself (matches how Pharmacy already treats prescribe/dispense everywhere
  // else) — kept as its own flag rather than folded into rxForm.
  const [dispenseNow, setDispenseNow] = useState(false);
  // Same rule as the outpatient flow: quantity = dose x per-day x days, unless
  // the prescriber types their own, and never for PRN/STAT where no total is
  // derivable. See src/lib/prescriptionFrequency.ts.
  const [rxQtyTouched, setRxQtyTouched] = useState(false);
  const rxSuggestedQty = useMemo(
    () => calculateQuantity(parseFloat(rxForm.dose_amount), rxForm.frequency, parseInt(rxForm.duration_days, 10)),
    [rxForm.dose_amount, rxForm.frequency, rxForm.duration_days]
  );
  useEffect(() => {
    if (rxQtyTouched || rxSuggestedQty == null) return;
    setRxForm(f => (f.quantity === String(rxSuggestedQty) ? f : { ...f, quantity: String(rxSuggestedQty) }));
  }, [rxSuggestedQty, rxQtyTouched]);

  const [nursingForm, setNursingForm] = useState({ shift: 'morning', care_activities: '', patient_condition: '', pain_level: '', mobility_status: '', fluid_intake: '', fluid_output: '', notes: '', temperature: '', blood_pressure: '', pulse: '', respiratory_rate: '' });

  const [showAdminForm, setShowAdminForm] = useState(false);
  const [adminForm, setAdminForm] = useState({ prescription_id: '', medication_name: '', dosage_given: '', route: 'oral', notes: '', status: 'given' });

  const [labForm, setLabForm] = useState({ test_id: '', test_type: '', test_code: '', category: '', unit_price: 0, clinical_indication: '', sample_type: '', urgent: false });

  const [radForm, setRadForm] = useState({ service_id: '', imaging_type: '', unit_price: 0, body_part: '', clinical_indication: '', urgent: false });

  // ── Queries ──
  const { data: admission, isLoading } = useQuery({
    queryKey: ['admission', admissionId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/admissions/${admissionId}`); return r.ok ? r.json() : null; },
    enabled: !!admissionId,
  });

  const { data: doctorNotes = [] } = useQuery({
    queryKey: ['doctor-notes', admissionId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/doctor-notes?admission_id=${admissionId}`); return r.ok ? r.json() : []; },
    enabled: !!admissionId,
  });

  const { data: prescriptions = [] } = useQuery({
    queryKey: ['ip-prescriptions', admissionId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/prescriptions?admission_id=${admissionId}`); return r.ok ? r.json() : []; },
    enabled: !!admissionId,
  });

  const { data: nursingNotes = [] } = useQuery({
    queryKey: ['nursing-notes', admissionId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/nursing-notes?admission_id=${admissionId}`); return r.ok ? r.json() : []; },
    enabled: !!admissionId,
  });

  const { data: drugAdmins = [] } = useQuery({
    queryKey: ['drug-admins', admissionId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/drug-administrations?admission_id=${admissionId}`); return r.ok ? r.json() : []; },
    enabled: !!admissionId,
  });

  const { data: labRequests = [] } = useQuery({
    queryKey: ['ip-lab-requests', admissionId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/lab-requests?admission_id=${admissionId}`); return r.ok ? r.json() : []; },
    enabled: !!admissionId,
  });

  const { data: radRequests = [] } = useQuery({
    queryKey: ['ip-radiology', admissionId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/radiology-requests?admission_id=${admissionId}`); return r.ok ? r.json() : []; },
    enabled: !!admissionId,
  });

  // ── Billing catalogs (drive pickers so prescriptions/lab/imaging carry a real price onto the bill) ──
  const clinicId = user?.clinic || 1;

  // "View Bills" goes straight to this patient's actual bill (same active-bill
  // lookup used everywhere else in the app) instead of dropping onto the
  // generic, unfiltered /patients-bill list.
  const handleViewBills = async () => {
    if (!admission?.patient_id || loadingBill) return;
    setLoadingBill(true);
    try {
      const r = await authFetch(`/api/patient-bills/active/${admission.patient_id}/${clinicId}`);
      if (r.ok) {
        const bill = await r.json();
        navigate(`/patients-bill/${bill.id}`);
      } else {
        toast.error('This patient has no active bill yet');
        navigate('/patients-bill');
      }
    } catch {
      toast.error('Failed to look up this patient\'s bill');
      navigate('/patients-bill');
    } finally {
      setLoadingBill(false);
    }
  };
  const { data: drugCatalog = [] } = useQuery({
    queryKey: ['ip-drug-catalog', clinicId, rxForm.location_id],
    queryFn: async () => {
      const locationParam = rxForm.location_id ? `&location_id=${rxForm.location_id}` : '';
      const r = await authFetch(`/api/pharmacy-module/drugs?clinic_id=${clinicId}&is_active=true${locationParam}`);
      return r.ok ? r.json() : [];
    },
  });
  // Multi-store pharmacies (e.g. a ward's own "nurse store" separate from the
  // main pharmacy) — optional; tenants with no stock_locations configured just
  // see an empty list and prescribe against clinic-wide stock as before.
  const { data: storeLocations = [] } = useQuery({
    queryKey: ['ip-pharmacy-locations', clinicId],
    queryFn: async () => { const r = await authFetch(`/api/pharmacy-module/locations?clinic_id=${clinicId}`); return r.ok ? r.json() : []; },
  });
  const { data: labCatalog = [] } = useQuery({
    queryKey: ['ip-lab-catalog', clinicId],
    queryFn: async () => { const r = await authFetch(`/api/lab-tests?clinic=${clinicId}`); return r.ok ? r.json() : []; },
  });
  const { data: serviceCatalog = [] } = useQuery({
    queryKey: ['ip-service-catalog'],
    queryFn: async () => { const r = await authFetch(`/api/services`); return r.ok ? r.json() : []; },
  });

  const drugOptions = drugCatalog.map((d: any) => ({ value: String(d.id), label: `${d.drug_name}${d.strength ? ` (${d.strength})` : ''}` }));
  const locationOptions = storeLocations.map((l: any) => ({ value: String(l.id), label: l.name }));
  const labOptions = labCatalog.map((t: any) => ({ value: String(t.id), label: t.test_name }));
  const serviceOptions = serviceCatalog.map((s: any) => ({ value: String(s.id), label: s.name }));

  // ── Mutations ──
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admission', admissionId] });
    queryClient.invalidateQueries({ queryKey: ['doctor-notes', admissionId] });
    queryClient.invalidateQueries({ queryKey: ['ip-prescriptions', admissionId] });
    queryClient.invalidateQueries({ queryKey: ['nursing-notes', admissionId] });
    queryClient.invalidateQueries({ queryKey: ['drug-admins', admissionId] });
    queryClient.invalidateQueries({ queryKey: ['ip-lab-requests', admissionId] });
    queryClient.invalidateQueries({ queryKey: ['ip-radiology', admissionId] });
  };

  // Named useCreateMutation (not createMutation) so ESLint's rules-of-hooks
  // check recognizes this as a hook and can verify its own call sites — every
  // one below is called unconditionally, in the same fixed order, on every
  // render, which is what actually keeps this safe; the naming is what lets
  // the linter confirm that instead of silently trusting it.
  const useCreateMutation = (url: string, successMsg: string, onDone: () => void) => useMutation({
    mutationFn: async (data: any) => {
      const r = await authFetch(url, { method: 'POST', body: JSON.stringify({ ...data, admission_id: admissionId, patient_id: admission?.patient_id, clinic_id: user?.clinic || 1 }) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed'); }
      return r.json();
    },
    onSuccess: () => { toast.success(successMsg); onDone(); invalidateAll(); },
    onError: (e: any) => toast.error(e.message),
  });

  const notesMut = useCreateMutation('/api/inpatient/doctor-notes', 'Doctor note saved', () => { setNoteForm({ clinical_assessment: '', examination_findings: '', treatment_plan: '', progress_status: 'stable' }); });

  const resetRxForm = () => { setRxForm({ drug_id: '', medication_name: '', unit_price: 0, unit_of_measure: '', dosage: '', frequency: '', duration: '', route: 'oral', instructions: '', quantity: '', dose_amount: '1', duration_days: '', is_external: false, external_drug_name: '', location_id: '' }); setRxQtyTouched(false); setDispenseNow(false); };

  // Prescribing and dispensing are two separate real-world steps (same as
  // everywhere else in this app), so a failed dispense never rolls back an
  // already-successful prescription — it just surfaces its own toast.
  const rxMut = useMutation({
    mutationFn: async (data: typeof rxForm) => {
      const r = await authFetch('/api/inpatient/prescriptions', {
        method: 'POST',
        body: JSON.stringify({ ...data, admission_id: admissionId, patient_id: admission?.patient_id, clinic_id: user?.clinic || 1 }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed'); }
      const created = await r.json();

      if (dispenseNow && !data.is_external && data.drug_id && created.pharmacy_line_id) {
        const dr = await authFetch('/api/pharmacy-module/dispensing', {
          method: 'POST',
          body: JSON.stringify({
            clinic_id: user?.clinic || 1,
            prescription_line_id: created.pharmacy_line_id,
            inventory_item_id: data.drug_id,
            quantity_dispensed: parseInt(data.quantity, 10) || 1,
            unit_of_measure: data.unit_of_measure,
            patient_id: admission?.patient_id,
            pharmacist_id: user?.id,
            from_location_id: data.location_id || undefined,
          }),
        });
        if (!dr.ok) {
          const de = await dr.json().catch(() => ({}));
          toast.error(de.error || 'Prescription saved, but dispensing failed');
        } else {
          toast.success('Dispensed');
        }
      }
      return created;
    },
    onSuccess: () => { toast.success('Prescription created'); resetRxForm(); invalidateAll(); },
    onError: (e: any) => toast.error(e.message),
  });
  const nursingMut = useCreateMutation('/api/inpatient/nursing-notes', 'Nursing note saved', () => { setNursingForm({ shift: 'morning', care_activities: '', patient_condition: '', pain_level: '', mobility_status: '', fluid_intake: '', fluid_output: '', notes: '', temperature: '', blood_pressure: '', pulse: '', respiratory_rate: '' }); });
  const adminMut = useCreateMutation('/api/inpatient/drug-administrations', 'Administration recorded', () => { setShowAdminForm(false); setAdminForm({ prescription_id: '', medication_name: '', dosage_given: '', route: 'oral', notes: '', status: 'given' }); });
  const labMut = useCreateMutation('/api/inpatient/lab-requests', 'Lab request created', () => { setLabForm({ test_id: '', test_type: '', test_code: '', category: '', unit_price: 0, clinical_indication: '', sample_type: '', urgent: false }); });
  const radMut = useCreateMutation('/api/inpatient/radiology-requests', 'Radiology request created', () => { setRadForm({ service_id: '', imaging_type: '', unit_price: 0, body_part: '', clinical_indication: '', urgent: false }); });

  const dischargeMut = useMutation({
    mutationFn: async (data: any) => {
      const r = await authFetch(`/api/inpatient/admissions/${admissionId}/discharge`, { method: 'PUT', body: JSON.stringify(data) });
      if (!r.ok) throw new Error('Failed to discharge');
      return r.json();
    },
    onSuccess: () => { toast.success('Patient discharged'); setDischargeOpen(false); invalidateAll(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <AppLayout><LoadingState message="Loading patient details..." /></AppLayout>;
  if (!admission) return <AppLayout><div className="p-12 text-center text-muted-foreground">Admission not found</div></AppLayout>;

  const days = Math.max(1, Math.floor((Date.now() - new Date(admission.admission_date).getTime()) / 86400000));
  const routes = ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'rectal', 'sublingual'];

  // One row per remaining un-administered dose (e.g. quantity=5 with 2 given shows 3 rows) —
  // rows disappear as they're administered instead of leaving a single static "add" form.
  const pendingDoses = prescriptions
    .filter((p: any) => p.status === 'active')
    .flatMap((p: any) => {
      const totalUnits = parseInt(p.quantity, 10) > 0 ? parseInt(p.quantity, 10) : 1;
      const givenCount = drugAdmins.filter((a: any) => a.prescription_id === p.id).length;
      const remaining = Math.max(0, totalUnits - givenCount);
      return Array.from({ length: remaining }, (_, doseIndex) => ({ ...p, doseIndex }));
    });

  // Discharge summary — pulls together every clinical record already loaded for
  // this admission (doctor notes, prescriptions cross-referenced against what was
  // actually administered, nursing notes, lab/radiology requests with results)
  // into the same printable document template used across the rest of the app.
  const buildDischargeSummary = () => {
    const patientBox = {
      title: 'Patient Information',
      rows: [
        { label: 'Name', value: admission.patient_name, bold: true },
        { label: 'Patient No', value: admission.patient_number },
        { label: 'Gender', value: admission.gender || 'N/A' },
        { label: 'Ward / Bed', value: `${admission.ward_name} • Rm ${admission.room_number}/${admission.bed_number}` },
      ],
    };
    const admissionBox = {
      title: 'Admission Details',
      rows: [
        { label: 'Attending Doctor', value: admission.doctor_name ? `Dr. ${admission.doctor_name}` : '-' },
        { label: 'Admitted', value: new Date(admission.admission_date).toLocaleString() },
        { label: 'Discharged', value: admission.discharge_date ? new Date(admission.discharge_date).toLocaleString() : '-' },
        { label: 'Length of Stay', value: `${days} day${days > 1 ? 's' : ''}` },
        { label: 'Outcome', value: OUTCOME_LABEL[admission.discharge_outcome] || admission.discharge_outcome || '-', bold: true },
      ],
    };

    let body = docTemplate.buildInfoGrid(patientBox, admissionBox);

    if (admission.diagnosis) {
      body += `<div class="ic-section-title">Diagnosis</div><p style="font-size:11px;margin:0 0 12px;">${admission.diagnosis}</p>`;
    }
    if (admission.discharge_reason) {
      body += `<div class="ic-section-title">Discharge Reason</div><p style="font-size:11px;margin:0 0 12px;">${admission.discharge_reason}</p>`;
    }
    if (admission.discharge_summary) {
      body += `<div class="ic-section-title">Discharge Summary</div>` + docTemplate.buildNotes(admission.discharge_summary);
    }

    const emptyMsg = (msg: string) => `<p style="font-size:11px;color:#64748B;margin:0 0 12px;">${msg}</p>`;

    body += `<div class="ic-section-title">Doctor's Notes <span>${doctorNotes.length} entr${doctorNotes.length === 1 ? 'y' : 'ies'}</span></div>`;
    body += doctorNotes.length === 0 ? emptyMsg('No doctor notes recorded.') : docTemplate.buildTable(
      [{ label: 'Date' }, { label: 'Doctor' }, { label: 'Assessment / Plan' }, { label: 'Status' }],
      doctorNotes.map((n: any) => ({
        cells: [
          new Date(n.note_date).toLocaleString(),
          n.doctor_name ? `Dr. ${n.doctor_name}` : '-',
          [
            n.clinical_assessment ? `<strong>Assessment:</strong> ${n.clinical_assessment}` : '',
            n.treatment_plan ? `<strong>Plan:</strong> ${n.treatment_plan}` : '',
          ].filter(Boolean).join('<br/>'),
          n.progress_status || '-',
        ],
      })),
    );

    body += `<div class="ic-section-title">Medications Prescribed <span>${prescriptions.length}</span></div>`;
    body += prescriptions.length === 0 ? emptyMsg('No medications prescribed.') : docTemplate.buildTable(
      [{ label: 'Medication' }, { label: 'Dosage' }, { label: 'Frequency' }, { label: 'Route' }, { label: 'Duration' }, { label: 'Qty' }, { label: 'Given / Total' }, { label: 'Status' }],
      prescriptions.map((p: any) => {
        const totalUnits = parseInt(p.quantity, 10) > 0 ? parseInt(p.quantity, 10) : 1;
        const givenCount = drugAdmins.filter((a: any) => a.prescription_id === p.id && a.status === 'given').length;
        return {
          cells: [
            `${p.medication_name}${p.is_external ? ' (buy outside)' : ''}`,
            p.dosage || '-', p.frequency || '-', p.route?.toUpperCase() || '-', p.duration || '-', p.quantity ?? '-',
            `${givenCount} / ${totalUnits}`,
            p.status || '-',
          ],
        };
      }),
    );

    body += `<div class="ic-section-title">Medication Administration Record <span>${drugAdmins.length}</span></div>`;
    body += drugAdmins.length === 0 ? emptyMsg('No administrations recorded.') : docTemplate.buildTable(
      [{ label: 'Date/Time' }, { label: 'Medication' }, { label: 'Dosage Given' }, { label: 'Route' }, { label: 'Status' }, { label: 'Nurse' }, { label: 'Notes' }],
      drugAdmins.map((a: any) => ({
        cells: [
          new Date(a.administered_at).toLocaleString(),
          a.medication_name, a.dosage_given || '-', a.route?.toUpperCase() || '-', a.status || '-', a.nurse_name || '-', a.notes || '-',
        ],
      })),
    );

    body += `<div class="ic-section-title">Nursing Notes <span>${nursingNotes.length}</span></div>`;
    body += nursingNotes.length === 0 ? emptyMsg('No nursing notes recorded.') : docTemplate.buildTable(
      [{ label: 'Date' }, { label: 'Shift' }, { label: 'Nurse' }, { label: 'Vitals' }, { label: 'Condition' }, { label: 'Pain' }, { label: 'I/O (ml)' }, { label: 'Activities / Notes' }],
      nursingNotes.map((n: any) => ({
        cells: [
          new Date(n.note_date).toLocaleString(),
          n.shift || '-', n.nurse_name || '-',
          n.vital_signs ? `T ${n.vital_signs.temperature || '-'}°C, BP ${n.vital_signs.blood_pressure || '-'}, P ${n.vital_signs.pulse || '-'}, RR ${n.vital_signs.respiratory_rate || '-'}` : '-',
          n.patient_condition || '-', n.pain_level ?? '-',
          `${n.fluid_intake || 0} / ${n.fluid_output || 0}`,
          [n.care_activities, n.notes].filter(Boolean).join('<br/>'),
        ],
      })),
    );

    body += `<div class="ic-section-title">Laboratory Tests & Results <span>${labRequests.length}</span></div>`;
    body += labRequests.length === 0 ? emptyMsg('No laboratory tests requested.') : docTemplate.buildTable(
      [{ label: 'Date' }, { label: 'Test' }, { label: 'Sample' }, { label: 'Status' }, { label: 'Results' }],
      labRequests.map((l: any) => {
        // results comes back from the raw SQL query as a JSON string, not a
        // pre-parsed object, so it has to be parsed here before being turned
        // into readable "key: value" pairs — otherwise it prints as raw braces.
        let parsedResults: any = l.results;
        if (typeof parsedResults === 'string') { try { parsedResults = JSON.parse(parsedResults); } catch { /* not JSON — leave as plain text */ } }
        const resultText = parsedResults && typeof parsedResults === 'object'
          ? Object.entries(parsedResults).map(([k, v]) => `${k}: ${v}`).join(', ')
          : (parsedResults || '');
        return {
          cells: [
            new Date(l.request_date).toLocaleDateString(),
            `${l.test_type}${l.urgent ? ' (Urgent)' : ''}`,
            l.sample_type || '-', l.status || '-',
            [resultText, l.result_notes].filter(Boolean).join('<br/>') || '-',
          ],
        };
      }),
    );

    body += `<div class="ic-section-title">Radiology / Imaging <span>${radRequests.length}</span></div>`;
    body += radRequests.length === 0 ? emptyMsg('No imaging requested.') : docTemplate.buildTable(
      [{ label: 'Date' }, { label: 'Imaging' }, { label: 'Body Part' }, { label: 'Status' }, { label: 'Findings / Impression' }],
      radRequests.map((r: any) => ({
        cells: [
          new Date(r.request_date).toLocaleDateString(),
          `${r.imaging_type}${r.urgent ? ' (Urgent)' : ''}`,
          r.body_part || '-', r.status || '-',
          [r.findings ? `<strong>Findings:</strong> ${r.findings}` : '', r.impression ? `<strong>Impression:</strong> ${r.impression}` : ''].filter(Boolean).join('<br/>') || '-',
        ],
      })),
    );

    body += docTemplate.buildSignatures([
      { label: 'Attending Doctor', name: admission.doctor_name ? `Dr. ${admission.doctor_name}` : '' },
      { label: 'Nurse in Charge' },
      { label: 'Patient / Guardian' },
    ]);

    return docTemplate.buildDocument({
      title: `Discharge Summary - ${admission.patient_name}`,
      docType: 'DISCHARGE SUMMARY',
      docNumber: admission.patient_number,
      status: admission.status,
      date: admission.discharge_date || new Date(),
      bodyHTML: body,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });
  };

  const handleDownloadDischargeSummary = () => {
    const pw = docTemplate.openPrintWindow(buildDischargeSummary());
    if (!pw) toast.error('Please allow popups to generate the discharge summary');
  };

  const TABS = [
    { value: 'notes', label: 'Doctor Notes', icon: Stethoscope, count: doctorNotes.length },
    { value: 'prescriptions', label: 'Prescriptions', icon: Pill, count: prescriptions.length },
    { value: 'nursing', label: 'Nursing', icon: ClipboardList, count: nursingNotes.length },
    { value: 'drug-admin', label: 'Drug Admin', icon: Syringe, count: pendingDoses.length || undefined },
    { value: 'lab', label: 'Lab Requests', icon: FlaskConical, count: labRequests.length },
    { value: 'radiology', label: 'Radiology', icon: Radio, count: radRequests.length },
  ];

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-5 w-full flex flex-col">
        {/* ── Patient header: identity, key facts, and the two things you actually do from here ── */}
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-base flex-shrink-0">
                  {admission.patient_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-lg font-bold tracking-tight text-foreground truncate">{admission.patient_name}</h1>
                    <Badge variant={admission.admission_type === 'emergency' ? 'danger' : 'info'} className="capitalize">{admission.admission_type}</Badge>
                    <Badge variant={admission.status === 'active' ? 'success' : 'neutral'} className="capitalize">{admission.status}</Badge>
                    {admission.discharge_outcome && (
                      <Badge variant={OUTCOME_VARIANT[admission.discharge_outcome] || 'neutral'}>{OUTCOME_LABEL[admission.discharge_outcome] || admission.discharge_outcome}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{admission.patient_number} • {admission.gender || 'N/A'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleViewBills} disabled={loadingBill}>
                  {loadingBill ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />} View Bills
                </Button>
                {admission.status === 'active' ? (
                  <Button size="sm" className="gap-1.5" onClick={() => setDischargeOpen(true)}>
                    <LogOut className="h-3.5 w-3.5" /> Discharge
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadDischargeSummary}>
                    <FileDown className="h-3.5 w-3.5" /> Discharge Summary
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="flex items-center gap-2.5">
                <BedDouble className="h-4 w-4 text-muted-foreground shrink-0" />
                <Field label="Ward / Bed" value={`${admission.ward_name} • Rm ${admission.room_number}/${admission.bed_number}`} />
              </div>
              <div className="flex items-center gap-2.5">
                <User2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <Field label="Attending Doctor" value={admission.doctor_name ? `Dr. ${admission.doctor_name}` : '—'} />
              </div>
              <div className="flex items-center gap-2.5">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <Field label="Admitted" value={`${new Date(admission.admission_date).toLocaleDateString()} • ${days} day${days > 1 ? 's' : ''}`} />
              </div>
              <div className="flex items-center gap-2.5">
                <Receipt className="h-4 w-4 text-muted-foreground shrink-0" />
                <Field label="Ward Rate" value={`${fmt(admission.ward_daily_rate)} / day`} />
              </div>
            </div>

            {admission.diagnosis && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Diagnosis</p>
                <p className="text-sm font-medium text-foreground mt-0.5">{admission.diagnosis}</p>
              </div>
            )}

            {admission.status !== 'active' && (admission.discharge_reason || admission.discharge_summary || admission.discharge_outcome) && (
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Discharged On" value={admission.discharge_date ? new Date(admission.discharge_date).toLocaleString() : '—'} />
                {admission.discharge_outcome && <Field label="Outcome" value={OUTCOME_LABEL[admission.discharge_outcome] || admission.discharge_outcome} />}
                {admission.discharge_reason && <Field label="Discharge Reason" value={admission.discharge_reason} />}
                {admission.discharge_summary && <Field label="Discharge Summary" value={admission.discharge_summary} />}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Visible section tabs — every clinical record type is one click away and always visible ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto flex-wrap gap-1 bg-muted/60 p-1">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5 px-3 py-2">
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                {!!t.count && <Badge variant="neutral" className="ml-0.5 px-1.5 py-0 text-[10px]">{t.count}</Badge>}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Doctor Notes */}
          <TabsContent value="notes" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
              <div className="lg:sticky lg:top-4">
                <FormCard icon={Stethoscope} title="New Doctor's Note">
                    <Textarea placeholder="Clinical assessment *" value={noteForm.clinical_assessment} onChange={e => setNoteForm({ ...noteForm, clinical_assessment: e.target.value })} rows={3} />
                    <Textarea placeholder="Examination findings" value={noteForm.examination_findings} onChange={e => setNoteForm({ ...noteForm, examination_findings: e.target.value })} rows={2} />
                    <Combobox
                      options={[
                        { value: 'improving', label: 'Improving' },
                        { value: 'stable', label: 'Stable' },
                        { value: 'deteriorating', label: 'Deteriorating' },
                        { value: 'critical', label: 'Critical' },
                      ]}
                      value={noteForm.progress_status}
                      onChange={v => setNoteForm({ ...noteForm, progress_status: v })}
                      searchPlaceholder="Search..."
                    />
                    <Textarea placeholder="Treatment plan" value={noteForm.treatment_plan} onChange={e => setNoteForm({ ...noteForm, treatment_plan: e.target.value })} rows={2} />
                    <Button className="w-full gap-1.5" disabled={notesMut.isPending} onClick={() => { if (!noteForm.clinical_assessment) { toast.error('Assessment required'); return; } notesMut.mutate(noteForm); }}>
                      {notesMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save Note
                    </Button>
                </FormCard>
              </div>
              <div className="min-w-0">
                <Card className="overflow-hidden">
                  <AdvancedDataTable<any>
                    data={doctorNotes}
                    keyExtractor={(n) => n.id}
                    emptyMessage="No doctor notes yet"
                    pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
                    columns={[
                      { key: 'note_date', header: 'Date/Time', render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(v).toLocaleString()}</span> },
                      { key: 'doctor_name', header: 'Doctor', render: (v) => <span className="font-medium text-foreground whitespace-nowrap">Dr. {v}</span> },
                      { key: 'progress_status', header: 'Status', render: (v) => <Badge variant={statusVariant(v)} className="capitalize">{v}</Badge> },
                      { key: 'clinical_assessment', header: 'Assessment', render: (v) => <span className="whitespace-pre-wrap">{v}</span> },
                      { key: 'treatment_plan', header: 'Plan', render: (v) => <span className="text-muted-foreground whitespace-pre-wrap">{v || '-'}</span> },
                    ]}
                  />
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Prescriptions */}
          <TabsContent value="prescriptions" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
              <div className="lg:sticky lg:top-4">
                <FormCard icon={Pill} title="New Prescription">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-input"
                        checked={rxForm.is_external}
                        onChange={e => setRxForm({ ...rxForm, is_external: e.target.checked, drug_id: '', medication_name: '', external_drug_name: '', unit_price: 0 })}
                      />
                      Not in stock — family buys from an outside pharmacy
                    </label>

                    {!rxForm.is_external && locationOptions.length > 0 && (
                      <div>
                        <Combobox
                          options={locationOptions}
                          value={rxForm.location_id}
                          onChange={v => setRxForm({ ...rxForm, location_id: v, drug_id: '', medication_name: '', unit_price: 0, unit_of_measure: '' })}
                          placeholder="Store (optional — clinic-wide stock)"
                          searchPlaceholder="Search stores..."
                          emptyText="No matching stores"
                        />
                        <p className="text-[11px] mt-1 text-muted-foreground">Pick a store (e.g. a ward's own stock) to see and prescribe from its stock specifically.</p>
                      </div>
                    )}

                    {rxForm.is_external ? (
                      <Input
                        placeholder="Medicine name e.g. Amoxicillin 500mg caps"
                        value={rxForm.external_drug_name}
                        onChange={e => setRxForm({ ...rxForm, external_drug_name: e.target.value, medication_name: e.target.value })}
                      />
                    ) : (
                      <div>
                        <Combobox
                          options={drugOptions}
                          value={rxForm.drug_id}
                          onChange={v => { const d = drugCatalog.find((x: any) => String(x.id) === v); setRxForm({ ...rxForm, drug_id: v, medication_name: d?.drug_name || '', unit_price: parseFloat(d?.selling_price) || 0, unit_of_measure: d?.unit_of_measure || '' }); }}
                          placeholder="Select medication *"
                          searchPlaceholder="Search drug catalog..."
                          emptyText="No matching drugs"
                        />
                        {rxForm.drug_id && (
                          <p className="text-xs mt-1.5 text-muted-foreground">
                            {rxForm.unit_price > 0 ? `Bills at ${fmt(rxForm.unit_price)} per unit • sent to Pharmacy` : 'No price set — will not be added to the bill, but is still sent to Pharmacy'}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number" min="0.25" step="0.25"
                        placeholder="Dose e.g. 1"
                        title="How much is given each time — the multiplier for the quantity"
                        value={rxForm.dose_amount}
                        onChange={e => setRxForm({ ...rxForm, dose_amount: e.target.value })}
                      />
                      <Input placeholder="Strength (e.g., 500mg)" value={rxForm.dosage} onChange={e => setRxForm({ ...rxForm, dosage: e.target.value })} />
                    </div>

                    <Combobox
                      options={FREQUENCY_OPTIONS.map(f => ({ value: f.code, label: `${f.code} — ${f.label}` }))}
                      value={rxForm.frequency}
                      onChange={v => setRxForm({ ...rxForm, frequency: v })}
                      placeholder="Frequency *"
                      searchPlaceholder="Search e.g. TDS, twice, 8 hourly..."
                      emptyText="No matching frequency"
                    />

                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        type="number" min="0" placeholder="Days"
                        value={rxForm.duration_days}
                        onChange={e => setRxForm({ ...rxForm, duration_days: e.target.value, duration: e.target.value ? `${e.target.value} days` : '' })}
                      />
                      <Input
                        type="number" placeholder="Quantity"
                        value={rxForm.quantity}
                        onChange={e => { setRxQtyTouched(true); setRxForm({ ...rxForm, quantity: e.target.value }); }}
                      />
                      <Combobox options={routes.map(r => ({ value: r, label: r.toUpperCase() }))} value={rxForm.route} onChange={v => setRxForm({ ...rxForm, route: v })} searchPlaceholder="Search..." />
                    </div>

                    {rxSuggestedQty != null && (
                      <p className="text-[11px] text-muted-foreground">
                        {rxForm.dose_amount} × {findFrequency(rxForm.frequency)?.perDay}/day × {rxForm.duration_days} days = <strong>{rxSuggestedQty}</strong>
                        {rxQtyTouched && String(rxSuggestedQty) !== rxForm.quantity && (
                          <button type="button" className="ml-2 underline" onClick={() => { setRxQtyTouched(false); setRxForm({ ...rxForm, quantity: String(rxSuggestedQty) }); }}>
                            use this
                          </button>
                        )}
                      </p>
                    )}
                    {rxForm.frequency && !findFrequency(rxForm.frequency)?.perDay && (
                      <p className="text-[11px] text-muted-foreground">
                        {rxForm.frequency === 'PRN' ? 'As needed — enter the quantity to dispense.' : 'Single dose — enter the quantity to dispense.'}
                      </p>
                    )}
                    <Textarea placeholder="Instructions" value={rxForm.instructions} onChange={e => setRxForm({ ...rxForm, instructions: e.target.value })} rows={2} />
                    {!rxForm.is_external && rxForm.drug_id && hasPrivilege('pharmacy.write') && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <input type="checkbox" className="rounded border-input" checked={dispenseNow} onChange={e => setDispenseNow(e.target.checked)} />
                        Dispense now from {rxForm.location_id ? (locationOptions.find((l: any) => l.value === rxForm.location_id)?.label || 'selected store') : 'clinic-wide stock'}
                      </label>
                    )}
                    <Button className="w-full gap-1.5" disabled={rxMut.isPending} onClick={() => {
                      if (!rxForm.medication_name || !rxForm.frequency) { toast.error('Medicine and frequency are required'); return; }
                      // Heads-up before the round trip — the server enforces this for
                      // real (see findInsufficientStockLine in inpatient.js), so this
                      // is just a faster "no" than waiting for that response.
                      if (!rxForm.is_external && rxForm.drug_id) {
                        const drug = drugCatalog.find((d: any) => String(d.id) === rxForm.drug_id);
                        const stockOnHand = drug?.stock_on_hand != null ? parseInt(drug.stock_on_hand, 10) : null;
                        const qty = parseInt(rxForm.quantity, 10) || 0;
                        if (drug && stockOnHand != null && !isNaN(stockOnHand) && qty > stockOnHand) {
                          toast.error(`Only ${stockOnHand} ${drug.unit_of_measure || 'unit'}(s) of ${drug.drug_name} in stock — reduce the quantity, or tick "Not in stock" to prescribe it for purchase outside.`);
                          return;
                        }
                      }
                      rxMut.mutate(rxForm);
                    }}>
                      {rxMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save Prescription{dispenseNow && !rxForm.is_external && rxForm.drug_id ? ' & Dispense' : ''}
                    </Button>
                </FormCard>
              </div>
              <div className="min-w-0">
                {prescriptions.length === 0 ? <p className="text-center text-muted-foreground py-12">No prescriptions yet</p> : (
                  <div className="divide-y divide-border border rounded-xl overflow-hidden bg-card max-h-[640px] overflow-y-auto scrollbar-hide">
                    {prescriptions.map((p: any) => (
                      <div key={p.id} className="p-4 flex items-center gap-3">
                        <Pill className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-foreground truncate">
                            {p.medication_name}
                            {p.is_external && (
                              <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">buy outside</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{p.dosage} • {p.frequency} • {p.route?.toUpperCase()} {p.duration ? `• ${p.duration}` : ''}</p>
                        </div>
                        <Badge variant={statusVariant(p.status)} className="capitalize flex-shrink-0">{p.status}</Badge>
                        <p className="text-xs text-muted-foreground flex-shrink-0">{new Date(p.prescription_date).toLocaleDateString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Nursing */}
          <TabsContent value="nursing" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
              <div className="lg:sticky lg:top-4">
                <FormCard icon={ClipboardList} title="New Nursing Note">
                    <Combobox
                      options={[
                        { value: 'morning', label: 'Morning' },
                        { value: 'afternoon', label: 'Afternoon' },
                        { value: 'night', label: 'Night' },
                      ]}
                      value={nursingForm.shift}
                      onChange={v => setNursingForm({ ...nursingForm, shift: v })}
                      searchPlaceholder="Search..."
                    />
                    {/* Vitals are recorded by the nurse, not the doctor — moved here from
                        Doctor's Note, which used to carry this (and never actually displayed
                        it correctly — see parseVitalSigns in inpatient.js for why). */}
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Temp °C" value={nursingForm.temperature} onChange={e => setNursingForm({ ...nursingForm, temperature: e.target.value })} />
                      <Input placeholder="BP (120/80)" value={nursingForm.blood_pressure} onChange={e => setNursingForm({ ...nursingForm, blood_pressure: e.target.value })} />
                      <Input placeholder="Pulse bpm" value={nursingForm.pulse} onChange={e => setNursingForm({ ...nursingForm, pulse: e.target.value })} />
                      <Input placeholder="RR /min" value={nursingForm.respiratory_rate} onChange={e => setNursingForm({ ...nursingForm, respiratory_rate: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Patient condition" value={nursingForm.patient_condition} onChange={e => setNursingForm({ ...nursingForm, patient_condition: e.target.value })} />
                      <Input placeholder="Pain (0-10)" type="number" min="0" max="10" value={nursingForm.pain_level} onChange={e => setNursingForm({ ...nursingForm, pain_level: e.target.value })} />
                    </div>
                    <Textarea placeholder="Care activities *" value={nursingForm.care_activities} onChange={e => setNursingForm({ ...nursingForm, care_activities: e.target.value })} rows={3} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Fluid intake (ml)" value={nursingForm.fluid_intake} onChange={e => setNursingForm({ ...nursingForm, fluid_intake: e.target.value })} />
                      <Input placeholder="Fluid output (ml)" value={nursingForm.fluid_output} onChange={e => setNursingForm({ ...nursingForm, fluid_output: e.target.value })} />
                    </div>
                    <Input placeholder="Mobility status" value={nursingForm.mobility_status} onChange={e => setNursingForm({ ...nursingForm, mobility_status: e.target.value })} />
                    <Textarea placeholder="Additional notes" value={nursingForm.notes} onChange={e => setNursingForm({ ...nursingForm, notes: e.target.value })} rows={2} />
                    <Button className="w-full gap-1.5" disabled={nursingMut.isPending} onClick={() => { if (!nursingForm.care_activities) { toast.error('Care activities required'); return; } nursingMut.mutate({ ...nursingForm, vital_signs: { temperature: nursingForm.temperature, blood_pressure: nursingForm.blood_pressure, pulse: nursingForm.pulse, respiratory_rate: nursingForm.respiratory_rate } }); }}>
                      {nursingMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save Note
                    </Button>
                </FormCard>
              </div>
              <div className="min-w-0">
                <Card className="overflow-hidden">
                  <AdvancedDataTable<any>
                    data={nursingNotes}
                    keyExtractor={(n) => n.id}
                    emptyMessage="No nursing notes yet"
                    pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
                    columns={[
                      { key: 'note_date', header: 'Date/Time', render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(v).toLocaleString()}</span> },
                      { key: 'nurse_name', header: 'Nurse', render: (v) => <span className="font-medium text-foreground whitespace-nowrap">{v}</span> },
                      { key: 'shift', header: 'Shift', render: (v) => <Badge variant="outline" className="capitalize">{v} shift</Badge> },
                      {
                        key: 'vital_signs', header: 'Vitals', width: '14rem',
                        render: (v) => v ? (
                          <span className="text-xs whitespace-nowrap">Temp: {v.temperature || '-'}°C • BP: {v.blood_pressure || '-'} • Pulse: {v.pulse || '-'} • RR: {v.respiratory_rate || '-'}</span>
                        ) : <span className="text-muted-foreground">-</span>,
                      },
                      { key: 'patient_condition', header: 'Condition', render: (v) => v || '-' },
                      { key: 'pain_level', header: 'Pain', render: (v) => v ?? '-' },
                      {
                        key: '__io', header: 'I/O (ml)',
                        render: (_v, n) => (n.fluid_intake || n.fluid_output) ? `${n.fluid_intake || 0} / ${n.fluid_output || 0}` : '-',
                      },
                      { key: 'care_activities', header: 'Activities / Notes', render: (v, n) => <span className="whitespace-pre-wrap">{[v, n.notes].filter(Boolean).join(' — ')}</span> },
                    ]}
                  />
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Drug Administration */}
          <TabsContent value="drug-admin" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
              <div className="lg:sticky lg:top-4">
                <Card className="overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-border bg-muted/30"><div className="flex items-center gap-2"><Pill className="h-4 w-4 text-primary" /><h4 className="font-semibold text-sm text-foreground">Prescribed Drugs</h4></div></div>
                  {pendingDoses.length === 0 ? (
                    <CardContent className="p-4"><p className="text-center text-muted-foreground py-8">{prescriptions.length === 0 ? 'No prescriptions yet' : 'All prescribed doses administered'}</p></CardContent>
                  ) : (
                    <div className="divide-y divide-border max-h-[680px] overflow-y-auto scrollbar-hide">
                      {pendingDoses.map((p: any) => (
                        <div key={`${p.id}-${p.doseIndex}`} className="p-3.5">
                          {showAdminForm && adminForm.prescription_id === p.id && p.doseIndex === 0 ? (
                            <div className="space-y-2.5">
                              <div className="flex items-center justify-between">
                                <p className="font-semibold text-sm text-foreground truncate">{p.medication_name}</p>
                                <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={() => setShowAdminForm(false)}><X className="h-3.5 w-3.5" /></Button>
                              </div>
                              <Input placeholder="Dosage given" value={adminForm.dosage_given} onChange={e => setAdminForm({ ...adminForm, dosage_given: e.target.value })} />
                              <div className="grid grid-cols-2 gap-2">
                                <Combobox options={routes.map(r => ({ value: r, label: r.toUpperCase() }))} value={adminForm.route} onChange={v => setAdminForm({ ...adminForm, route: v })} searchPlaceholder="Search..." />
                                <Combobox
                                  options={[
                                    { value: 'given', label: 'Given' },
                                    { value: 'refused', label: 'Refused' },
                                    { value: 'delayed', label: 'Delayed' },
                                    { value: 'missed', label: 'Missed' },
                                    { value: 'held', label: 'Held' },
                                  ]}
                                  value={adminForm.status}
                                  onChange={v => setAdminForm({ ...adminForm, status: v })}
                                  searchPlaceholder="Search..."
                                />
                              </div>
                              <Textarea placeholder="Notes" value={adminForm.notes} onChange={e => setAdminForm({ ...adminForm, notes: e.target.value })} rows={2} />
                              <Button className="w-full gap-1.5" disabled={adminMut.isPending} onClick={() => { if (!adminForm.medication_name || !adminForm.dosage_given) { toast.error('Medication & dosage required'); return; } adminMut.mutate(adminForm); }}>
                                {adminMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Record
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <Pill className="h-4 w-4 text-primary shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm text-foreground truncate">{p.medication_name}</p>
                                <p className="text-xs text-muted-foreground">{p.dosage} • {p.frequency} • {p.route?.toUpperCase()}</p>
                              </div>
                              {p.is_dispensed ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="flex-shrink-0 gap-1"
                                  onClick={() => { setAdminForm({ prescription_id: p.id, medication_name: p.medication_name, dosage_given: p.dosage || '', route: p.route || 'oral', notes: '', status: 'given' }); setShowAdminForm(true); }}
                                >
                                  <Syringe className="h-3 w-3" />Administer
                                </Button>
                              ) : (
                                <span className="text-[10px] text-muted-foreground italic flex-shrink-0">Awaiting pharmacy dispensing</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
              <div className="min-w-0">
                <Card className="overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm text-foreground">Administration Chart</h4></div>
                  <AdvancedDataTable<any>
                    data={drugAdmins}
                    keyExtractor={(a) => a.id}
                    emptyMessage="No administrations recorded yet"
                    pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
                    columns={[
                      { key: 'medication_name', header: 'Medication', render: (v) => <span className="font-medium text-foreground">{v}</span> },
                      { key: 'dosage_given', header: 'Dosage' },
                      { key: 'route', header: 'Route', render: (v) => v?.toUpperCase() },
                      { key: 'status', header: 'Status', render: (v, a) => <Badge variant={statusVariant(a.status)} className="capitalize">{v}</Badge> },
                      { key: 'nurse_name', header: 'Nurse', render: (v) => <span className="text-muted-foreground">{v}</span> },
                      { key: 'administered_at', header: 'Time', render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(v).toLocaleString()}</span> },
                    ]}
                  />
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Lab Requests */}
          <TabsContent value="lab" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
              <div className="lg:sticky lg:top-4">
                <FormCard icon={FlaskConical} title="New Lab Request">
                    <div>
                      <Combobox
                        options={labOptions}
                        value={labForm.test_id}
                        onChange={v => { const t = labCatalog.find((x: any) => String(x.id) === v); setLabForm({ ...labForm, test_id: v, test_type: t?.test_name || '', test_code: t?.test_code || '', category: t?.category || '', unit_price: parseFloat(t?.price) || 0 }); }}
                        placeholder="Select lab test *"
                        searchPlaceholder="Search lab test catalog..."
                        emptyText="No matching tests"
                      />
                      {labForm.test_id && (
                        <p className="text-xs mt-1.5 text-muted-foreground">
                          {labForm.unit_price > 0 ? `Bills at ${fmt(labForm.unit_price)} • sent to LIS` : 'No price set — will not be added to the bill, but is still sent to LIS'}
                        </p>
                      )}
                    </div>
                    <Input placeholder="Sample type" value={labForm.sample_type} onChange={e => setLabForm({ ...labForm, sample_type: e.target.value })} />
                    <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={labForm.urgent} onChange={e => setLabForm({ ...labForm, urgent: e.target.checked })} className="rounded" /> <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Urgent</label>
                    <Textarea placeholder="Clinical indication" value={labForm.clinical_indication} onChange={e => setLabForm({ ...labForm, clinical_indication: e.target.value })} rows={2} />
                    <Button className="w-full gap-1.5" disabled={labMut.isPending} onClick={() => { if (!labForm.test_type) { toast.error('Test type required'); return; } labMut.mutate(labForm); }}>
                      {labMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Send Request
                    </Button>
                </FormCard>
              </div>
              <div className="min-w-0">
                {labRequests.length === 0 ? <p className="text-center text-muted-foreground py-12">No lab requests yet</p> : (
                  <div className="divide-y divide-border border rounded-xl overflow-hidden bg-card max-h-[640px] overflow-y-auto scrollbar-hide">
                    {labRequests.map((l: any) => (
                      <div key={l.id} className="p-4 flex items-center gap-3">
                        <FlaskConical className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-foreground truncate flex items-center gap-1.5">{l.test_type} {!!l.urgent && <Badge variant="danger" className="text-[9px]">URGENT</Badge>}</div>
                          <p className="text-xs text-muted-foreground">Dr. {l.doctor_name} • {l.sample_type || 'N/A'}</p>
                        </div>
                        <Badge variant={l.status === 'completed' ? 'success' : 'outline'} className="capitalize flex-shrink-0">{l.status}</Badge>
                        <p className="text-xs text-muted-foreground flex-shrink-0">{new Date(l.request_date).toLocaleDateString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Radiology */}
          <TabsContent value="radiology" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
              <div className="lg:sticky lg:top-4">
                <FormCard icon={Radio} title="New Radiology Request">
                    <div>
                      <Combobox
                        options={serviceOptions}
                        value={radForm.service_id}
                        onChange={v => { const s = serviceCatalog.find((x: any) => String(x.id) === v); setRadForm({ ...radForm, service_id: v, imaging_type: s?.name || '', unit_price: parseFloat(s?.price) || 0 }); }}
                        placeholder="Select imaging / service *"
                        searchPlaceholder="Search e.g. X-Ray, CT, Ultrasound..."
                        emptyText="No matching services"
                      />
                      {radForm.service_id && (
                        <p className="text-xs mt-1.5 text-muted-foreground">
                          {radForm.unit_price > 0 ? `Bills at ${fmt(radForm.unit_price)}` : 'No price set on this service — will not be added to the bill'}
                        </p>
                      )}
                    </div>
                    <Input placeholder="Body part" value={radForm.body_part} onChange={e => setRadForm({ ...radForm, body_part: e.target.value })} />
                    <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={radForm.urgent} onChange={e => setRadForm({ ...radForm, urgent: e.target.checked })} className="rounded" /> <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Urgent</label>
                    <Textarea placeholder="Clinical indication" value={radForm.clinical_indication} onChange={e => setRadForm({ ...radForm, clinical_indication: e.target.value })} rows={2} />
                    <Button className="w-full gap-1.5" disabled={radMut.isPending} onClick={() => { if (!radForm.imaging_type) { toast.error('Imaging type required'); return; } radMut.mutate(radForm); }}>
                      {radMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Send Request
                    </Button>
                </FormCard>
              </div>
              <div className="min-w-0">
                {radRequests.length === 0 ? <p className="text-center text-muted-foreground py-12">No radiology requests yet</p> : (
                  <div className="divide-y divide-border border rounded-xl overflow-hidden bg-card max-h-[640px] overflow-y-auto scrollbar-hide">
                    {radRequests.map((r: any) => (
                      <div key={r.id} className="p-4 flex items-center gap-3">
                        <Radio className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-foreground truncate flex items-center gap-1.5">{r.imaging_type} {r.body_part ? `- ${r.body_part}` : ''} {!!r.urgent && <Badge variant="danger" className="text-[9px]">URGENT</Badge>}</div>
                          <p className="text-xs text-muted-foreground">Dr. {r.doctor_name}</p>
                        </div>
                        <Badge variant={r.status === 'completed' ? 'success' : 'outline'} className="capitalize flex-shrink-0">{r.status}</Badge>
                        <p className="text-xs text-muted-foreground flex-shrink-0">{new Date(r.request_date).toLocaleDateString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      </div>

      {/* Discharge — a deliberate, occasional terminal action; a dialog keeps it out of the
          way of day-to-day charting while still being one click away from the header. */}
      <Dialog open={dischargeOpen} onOpenChange={setDischargeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><LogOut className="h-4 w-4 text-primary" /> Discharge Patient</DialogTitle>
            <DialogDescription>Ends this admission for {admission.patient_name}. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {parseFloat(admission.ward_daily_rate) > 0 && (
              <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800">
                Discharging now will charge <span className="font-semibold">{fmt(days * parseFloat(admission.ward_daily_rate))}</span> for {days} day{days > 1 ? 's' : ''} in {admission.ward_name} ({fmt(admission.ward_daily_rate)}/day).
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Outcome *</Label>
              <Combobox
                options={[
                  { value: 'alive', label: 'Alive' },
                  { value: 'dead', label: 'Deceased' },
                  { value: 'absconded', label: 'Absconded' },
                ]}
                value={dischargeData.discharge_outcome}
                onChange={v => setDischargeData({ ...dischargeData, discharge_outcome: v })}
                placeholder="Select outcome *"
                searchPlaceholder="Search..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Discharge reason *</Label>
              <Textarea value={dischargeData.discharge_reason} onChange={e => setDischargeData({ ...dischargeData, discharge_reason: e.target.value })} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Discharge summary *</Label>
              <Textarea value={dischargeData.discharge_summary} onChange={e => setDischargeData({ ...dischargeData, discharge_summary: e.target.value })} rows={3} />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setDischargeOpen(false)}>Cancel</Button>
              <Button
                disabled={dischargeMut.isPending}
                className="gap-1.5"
                onClick={async () => {
                  if (!dischargeData.discharge_outcome) { toast.error('Outcome is required'); return; }
                  if (!dischargeData.discharge_reason.trim()) { toast.error('Discharge reason is required'); return; }
                  if (!dischargeData.discharge_summary.trim()) { toast.error('Discharge summary is required'); return; }
                  if (!(await confirm({ description: 'Discharge this patient? This ends the admission and cannot be undone.' }))) return;
                  dischargeMut.mutate(dischargeData);
                }}
              >
                {dischargeMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Discharge Patient
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
