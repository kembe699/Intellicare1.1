import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { ReportLetterhead } from './ReportLetterhead';
import { toast } from 'sonner';
import { ReportSubPageShell } from './ReportSubPageShell';
import { LoadingState } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Calendar, RefreshCw, Download, Printer, Eye } from 'lucide-react';
import { fmtCurrency, fmtCount, fmtDate, fmtNum, CsvColumn, getDatePresets, exportCSV, triggerPrint } from '@/utils/reportUtils';

// One Clinical Reports page, one dropdown — same shape as Revenue Report:
// nothing loads until "View" is clicked, letterhead + selector stay pinned
// while the table scrolls underneath.
//
// Two choices made without a schema-backed distinction to point to:
//  - "Inpatient Register [MOH 301]": pulls the same columns as the plain
//    Inpatient Register — there was no MOH 301 paper-form layout to match
//    against, so flag if the real 301 form needs different/additional
//    columns and I'll adjust.
//  - "Morbidity By Diagnosis" vs "By Impression": the schema only has one
//    diagnosis concept, so these were split as formally ICD-coded
//    (visit_diagnoses) vs. the clinician's free-text point-of-care note
//    (lis_test_orders.clinical_notes) — flag if that's not the intended
//    distinction.

type Mode =
  | 'patient-register' | 'workload' | 'visits-by-role' | 'morbidity' | 'nursing-notes-summary'
  | 'lab-data-summary' | 'lab-tat-summary' | 'radiology-register'
  | 'prescription-register' | 'inpatient-register' | 'inpatient-admissions-attending'
  | 'daily-bed-return' | 'laboratory-register' | 'outpatient-register';

interface ReportOption {
  value: string;
  label: string;
  group: string;
  mode: Mode;
  allBranches: boolean;
  morbidityBy?: 'diagnosis' | 'impression';
  ageMode?: 'overFive' | 'underFive' | 'underSelected' | 'overSelected';
  needsSelectedAge?: boolean;
  needsClinician?: boolean;
  needsTest?: boolean;
}

const REPORT_OPTIONS: ReportOption[] = [
  { value: 'patient_register_branch', label: 'Patient Register (By Branch)', group: 'Patients', mode: 'patient-register', allBranches: false },
  { value: 'patient_register_all', label: 'Patient Register (All Branches)', group: 'Patients', mode: 'patient-register', allBranches: true },
  { value: 'workload_all', label: 'Workload (All Branches)', group: 'Patients', mode: 'workload', allBranches: true },
  { value: 'workload_branch', label: 'Workload (By Branch)', group: 'Patients', mode: 'workload', allBranches: false },
  { value: 'visits_by_role_branch', label: 'Patient Visits By Role(s) (By Branch)', group: 'Patients', mode: 'visits-by-role', allBranches: false },

  { value: 'morbidity_diagnosis_branch', label: 'Morbidity By Diagnosis (By Branch)', group: 'Clinical Notes', mode: 'morbidity', allBranches: false, morbidityBy: 'diagnosis' },
  { value: 'morbidity_impression_branch', label: 'Morbidity By Impression (By Branch)', group: 'Clinical Notes', mode: 'morbidity', allBranches: false, morbidityBy: 'impression' },
  { value: 'nursing_notes_summary_branch', label: 'Nursing Notes Summary (By Branch)', group: 'Clinical Notes', mode: 'nursing-notes-summary', allBranches: false },

  { value: 'lab_data_summary_branch', label: 'Laboratory Data Summary (By Branch)', group: 'Laboratory', mode: 'lab-data-summary', allBranches: false },
  { value: 'lab_tat_summary', label: 'Laboratory Turn Around Time Summary', group: 'Laboratory', mode: 'lab-tat-summary', allBranches: true },
  { value: 'lab_register_all', label: 'Laboratory Register (All Branches)', group: 'Laboratory', mode: 'laboratory-register', allBranches: true },
  { value: 'lab_register_by_test', label: 'Laboratory Register (By Test)', group: 'Laboratory', mode: 'laboratory-register', allBranches: true, needsTest: true },

  { value: 'radiology_register_all', label: 'Radiology Register (All Branches)', group: 'Radiology', mode: 'radiology-register', allBranches: true },
  { value: 'radiology_register_branch', label: 'Radiology Register (By Branch)', group: 'Radiology', mode: 'radiology-register', allBranches: false },

  { value: 'prescription_register_all', label: 'Prescription Register (All Branches)', group: 'Pharmacy', mode: 'prescription-register', allBranches: true },
  { value: 'prescription_register_branch', label: 'Prescription Register (By Branch)', group: 'Pharmacy', mode: 'prescription-register', allBranches: false },
  { value: 'prescription_register_clinician', label: 'Prescription Register (Per Clinician)', group: 'Pharmacy', mode: 'prescription-register', allBranches: true, needsClinician: true },

  { value: 'inpatient_moh301_all', label: 'Inpatient Register [MOH 301] (All Branches)', group: 'Inpatient', mode: 'inpatient-register', allBranches: true },
  { value: 'inpatient_moh301_branch', label: 'Inpatient Register [MOH 301] (By Branch)', group: 'Inpatient', mode: 'inpatient-register', allBranches: false },
  { value: 'inpatient_admissions_attending', label: 'Inpatient Admissions With Attending Doctor', group: 'Inpatient', mode: 'inpatient-admissions-attending', allBranches: true },
  { value: 'inpatient_register_branch', label: 'Inpatient Register (By Branch)', group: 'Inpatient', mode: 'inpatient-register', allBranches: false },
  { value: 'daily_bed_return_branch', label: 'Daily Bed Return (By Branch)', group: 'Inpatient', mode: 'daily-bed-return', allBranches: false },

  { value: 'outpatient_over5_all', label: 'OutPatient Register Over Five (All Branches)', group: 'Outpatient', mode: 'outpatient-register', allBranches: true, ageMode: 'overFive' },
  { value: 'outpatient_over5_branch', label: 'OutPatient Register Over Five (By Branch)', group: 'Outpatient', mode: 'outpatient-register', allBranches: false, ageMode: 'overFive' },
  { value: 'outpatient_under5_all', label: 'OutPatient Register Under Five (All Branches)', group: 'Outpatient', mode: 'outpatient-register', allBranches: true, ageMode: 'underFive' },
  { value: 'outpatient_under5_branch', label: 'OutPatient Register Under Five (By Branch)', group: 'Outpatient', mode: 'outpatient-register', allBranches: false, ageMode: 'underFive' },
  { value: 'outpatient_under_selected_all', label: 'OutPatient Register Under Selected Age (All Branches)', group: 'Outpatient', mode: 'outpatient-register', allBranches: true, ageMode: 'underSelected', needsSelectedAge: true },
  { value: 'outpatient_under_selected_branch', label: 'OutPatient Register Under Selected Age (By Branch)', group: 'Outpatient', mode: 'outpatient-register', allBranches: false, ageMode: 'underSelected', needsSelectedAge: true },
  { value: 'outpatient_over_selected_all', label: 'OutPatient Register Over Selected Age (All Branches)', group: 'Outpatient', mode: 'outpatient-register', allBranches: true, ageMode: 'overSelected', needsSelectedAge: true },
];

const OPTION_GROUPS = ['Patients', 'Clinical Notes', 'Laboratory', 'Radiology', 'Pharmacy', 'Inpatient', 'Outpatient'];

function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m + 1)}-01`, to: now.toISOString().split('T')[0] };
}

export default function ClinicalReport() {
  const { user } = useAuth();
  const defaults = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [reportType, setReportType] = useState('patient_register_branch');
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [clinicians, setClinicians] = useState<{ id: number; display_name: string }[]>([]);
  const [selectedClinicianId, setSelectedClinicianId] = useState('');
  const [labTests, setLabTests] = useState<{ test_code: string; test_name: string }[]>([]);
  const [selectedTestCode, setSelectedTestCode] = useState('');
  const [selectedAge, setSelectedAge] = useState('18');

  useEffect(() => {
    if (!user?.clinic) return;
    authFetch(`/api/users/clinic/${user.clinic}`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => setClinicians((Array.isArray(data) ? data : []).filter((u: any) => u.role === 'doctor')))
      .catch(() => setClinicians([]));
    authFetch(`/api/lab-tests`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => setLabTests(Array.isArray(data) ? data : []))
      .catch(() => setLabTests([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.clinic]);

  const option = REPORT_OPTIONS.find(o => o.value === reportType)!;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo, allBranches: String(option.allBranches) });

      let path = '';
      if (option.mode === 'patient-register') path = '/patient-register';
      else if (option.mode === 'workload') path = '/workload';
      else if (option.mode === 'visits-by-role') path = '/visits-by-role';
      else if (option.mode === 'morbidity') { path = '/morbidity'; params.set('by', option.morbidityBy!); }
      else if (option.mode === 'nursing-notes-summary') path = '/nursing-notes-summary';
      else if (option.mode === 'lab-data-summary') path = '/laboratory-data-summary';
      else if (option.mode === 'lab-tat-summary') path = '/laboratory-tat-summary';
      else if (option.mode === 'laboratory-register') {
        path = '/laboratory-register';
        if (option.needsTest && selectedTestCode) params.set('testCode', selectedTestCode);
      } else if (option.mode === 'radiology-register') path = '/radiology-register';
      else if (option.mode === 'prescription-register') {
        path = '/prescription-register';
        if (option.needsClinician && selectedClinicianId) params.set('clinicianId', selectedClinicianId);
      } else if (option.mode === 'inpatient-register') path = '/inpatient-register';
      else if (option.mode === 'inpatient-admissions-attending') path = '/inpatient-admissions-attending-doctor';
      else if (option.mode === 'daily-bed-return') path = '/daily-bed-return';
      else if (option.mode === 'outpatient-register') {
        path = '/outpatient-register';
        params.set('ageMode', option.ageMode!);
        if (option.needsSelectedAge) params.set('selectedAge', selectedAge || '18');
      }

      const res = await authFetch(`/api/reports-v2/clinical${path}?${params}`);
      if (!res.ok) throw new Error('Failed to load report');
      const json = await res.json();
      setRows(json.rows || []);
      setGeneratedAt(new Date());
      setHasLoaded(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load clinical report');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, reportType, selectedClinicianId, selectedTestCode, selectedAge]);

  // ── Columns per mode ─────────────────────────────────────────────────────
  let columns: Column<any>[] = [];
  let csvColumns: CsvColumn[] = [];
  let keyExtractor: (row: any, i: number) => string | number = (r, i) => r.id ?? i;
  let emptyMessage = 'No records in this period.';

  if (option.mode === 'patient-register') {
    columns = [
      { key: 'firstName', header: 'First Name', sortable: true },
      { key: 'lastName', header: 'Last Name', sortable: true },
      { key: 'age', header: 'Age', align: 'right', sortable: true, render: v => v ?? '—' },
      { key: 'gender', header: 'Gender', sortable: true },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
      { key: 'visitDate', header: 'Registered', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'source', header: 'Registry', render: v => <span className="text-[11px] uppercase text-muted-foreground">{v}</span> },
    ];
    csvColumns = [{ header: 'First Name', key: 'firstName' }, { header: 'Last Name', key: 'lastName' }, { header: 'Age', key: 'age' }, { header: 'Gender', key: 'gender' }, { header: 'Branch', key: 'branchName' }, { header: 'Registered', key: 'visitDate', transform: v => fmtDate(v) }];
  } else if (option.mode === 'workload') {
    keyExtractor = (r, i) => `${r.doctorName}-${r.branchName}-${i}`;
    columns = [
      { key: 'doctorName', header: 'Doctor', sortable: true },
      { key: 'branchName', header: 'Branch', sortable: true },
      { key: 'visitCount', header: 'Visits', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCount(v)}</span> },
    ];
    csvColumns = [{ header: 'Doctor', key: 'doctorName' }, { header: 'Branch', key: 'branchName' }, { header: 'Visits', key: 'visitCount' }];
  } else if (option.mode === 'visits-by-role') {
    keyExtractor = r => r.role;
    columns = [
      { key: 'role', header: 'Role', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'visitCount', header: 'Visits', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCount(v)}</span> },
    ];
    csvColumns = [{ header: 'Role', key: 'role' }, { header: 'Visits', key: 'visitCount' }];
  } else if (option.mode === 'morbidity') {
    keyExtractor = (r, i) => r.icdCode ?? i;
    columns = option.morbidityBy === 'diagnosis'
      ? [
          { key: 'icdCode', header: 'ICD Code', sortable: true, render: v => <span className="font-mono text-xs">{v}</span> },
          { key: 'description', header: 'Diagnosis', sortable: true },
          { key: 'count', header: 'Cases', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCount(v)}</span> },
        ]
      : [
          { key: 'description', header: 'Clinical Impression', sortable: true },
          { key: 'count', header: 'Cases', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCount(v)}</span> },
        ];
    csvColumns = option.morbidityBy === 'diagnosis'
      ? [{ header: 'ICD Code', key: 'icdCode' }, { header: 'Diagnosis', key: 'description' }, { header: 'Cases', key: 'count' }]
      : [{ header: 'Clinical Impression', key: 'description' }, { header: 'Cases', key: 'count' }];
  } else if (option.mode === 'nursing-notes-summary') {
    keyExtractor = (r, i) => `${r.branchName}-${r.shift}-${i}`;
    columns = [
      { key: 'branchName', header: 'Branch', sortable: true },
      { key: 'shift', header: 'Shift', sortable: true, render: v => <span className="capitalize">{v || '—'}</span> },
      { key: 'noteCount', header: 'Notes', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'patientCount', header: 'Patients', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCount(v)}</span> },
    ];
    csvColumns = [{ header: 'Branch', key: 'branchName' }, { header: 'Shift', key: 'shift' }, { header: 'Notes', key: 'noteCount' }, { header: 'Patients', key: 'patientCount' }];
  } else if (option.mode === 'lab-data-summary') {
    keyExtractor = r => r.testCode;
    columns = [
      { key: 'testCode', header: 'Test Code', sortable: true, render: v => <span className="font-mono text-xs">{v}</span> },
      { key: 'testName', header: 'Test', sortable: true },
      { key: 'volume', header: 'Volume', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'distinctPatients', header: 'Distinct Patients', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'completed', header: 'Completed', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCount(v)}</span> },
    ];
    csvColumns = [{ header: 'Test Code', key: 'testCode' }, { header: 'Test', key: 'testName' }, { header: 'Volume', key: 'volume' }, { header: 'Distinct Patients', key: 'distinctPatients' }, { header: 'Completed', key: 'completed' }];
  } else if (option.mode === 'lab-tat-summary') {
    keyExtractor = r => r.testCode;
    columns = [
      { key: 'testCode', header: 'Test Code', sortable: true, render: v => <span className="font-mono text-xs">{v}</span> },
      { key: 'testName', header: 'Test', sortable: true },
      { key: 'specimenCount', header: 'Specimens', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'avgHours', header: 'Avg Turnaround', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{v != null ? `${fmtNum(v, 1)} hrs` : '—'}</span> },
    ];
    csvColumns = [{ header: 'Test Code', key: 'testCode' }, { header: 'Test', key: 'testName' }, { header: 'Specimens', key: 'specimenCount' }, { header: 'Avg Hours', key: 'avgHours' }];
  } else if (option.mode === 'laboratory-register') {
    columns = [
      { key: 'orderedAt', header: 'Ordered', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'testName', header: 'Test', sortable: true },
      { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Ordered', key: 'orderedAt', transform: v => fmtDate(v) }, { header: 'Patient', key: 'patientName' }, { header: 'Test', key: 'testName' }, { header: 'Status', key: 'status' }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'radiology-register') {
    columns = [
      { key: 'requestDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'examName', header: 'Exam', sortable: true },
      { key: 'setting', header: 'Setting', sortable: true },
      { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Date', key: 'requestDate', transform: v => fmtDate(v) }, { header: 'Patient', key: 'patientName' }, { header: 'Exam', key: 'examName' }, { header: 'Setting', key: 'setting' }, { header: 'Status', key: 'status' }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'prescription-register') {
    columns = [
      { key: 'prescriptionDate', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'drugName', header: 'Drug', sortable: true },
      { key: 'dosage', header: 'Dosage', render: v => v || '—' },
      { key: 'prescriberName', header: 'Prescriber', sortable: true },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Date', key: 'prescriptionDate', transform: v => fmtDate(v) }, { header: 'Patient', key: 'patientName' }, { header: 'Drug', key: 'drugName' }, { header: 'Dosage', key: 'dosage' }, { header: 'Prescriber', key: 'prescriberName' }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'inpatient-register') {
    columns = [
      { key: 'admissionDate', header: 'Admitted', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'age', header: 'Age', align: 'right', render: v => v ?? '—' },
      { key: 'gender', header: 'Gender' },
      { key: 'wardName', header: 'Ward', sortable: true },
      { key: 'diagnosis', header: 'Diagnosis', render: v => v || '—' },
      { key: 'attendingDoctor', header: 'Attending Doctor', sortable: true },
      { key: 'dischargeDate', header: 'Discharged', sortable: true, render: v => v ? fmtDate(v) : '—' },
      { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Admitted', key: 'admissionDate', transform: v => fmtDate(v) }, { header: 'Patient', key: 'patientName' }, { header: 'Age', key: 'age' }, { header: 'Gender', key: 'gender' }, { header: 'Ward', key: 'wardName' }, { header: 'Diagnosis', key: 'diagnosis' }, { header: 'Attending Doctor', key: 'attendingDoctor' }, { header: 'Discharged', key: 'dischargeDate', transform: v => v ? fmtDate(v) : '' }, { header: 'Status', key: 'status' }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'inpatient-admissions-attending') {
    columns = [
      { key: 'admissionDate', header: 'Admitted', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'patientName', header: 'Patient', sortable: true },
      { key: 'attendingDoctor', header: 'Attending Doctor', sortable: true },
      { key: 'status', header: 'Status', sortable: true, render: v => <span className="capitalize">{v}</span> },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Admitted', key: 'admissionDate', transform: v => fmtDate(v) }, { header: 'Patient', key: 'patientName' }, { header: 'Attending Doctor', key: 'attendingDoctor' }, { header: 'Status', key: 'status' }, { header: 'Branch', key: 'branchName' }];
  } else if (option.mode === 'daily-bed-return') {
    keyExtractor = r => r.day;
    columns = [
      { key: 'day', header: 'Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'admissions', header: 'Admissions', align: 'right', sortable: true, render: v => <span className="font-mono">{fmtCount(v)}</span> },
      { key: 'discharges', header: 'Discharges', align: 'right', sortable: true, render: v => <span className="font-mono font-medium">{fmtCount(v)}</span> },
    ];
    csvColumns = [{ header: 'Date', key: 'day', transform: v => fmtDate(v) }, { header: 'Admissions', key: 'admissions' }, { header: 'Discharges', key: 'discharges' }];
  } else if (option.mode === 'outpatient-register') {
    keyExtractor = r => r.orderId;
    columns = [
      { key: 'visitDate', header: 'Visit Date', sortable: true, render: v => <span className="text-muted-foreground">{fmtDate(v)}</span> },
      { key: 'firstName', header: 'First Name', sortable: true },
      { key: 'lastName', header: 'Last Name', sortable: true },
      { key: 'age', header: 'Age', align: 'right', sortable: true },
      { key: 'gender', header: 'Gender' },
      { key: 'branchName', header: 'Branch', sortable: true, render: v => v || '—' },
    ];
    csvColumns = [{ header: 'Visit Date', key: 'visitDate', transform: v => fmtDate(v) }, { header: 'First Name', key: 'firstName' }, { header: 'Last Name', key: 'lastName' }, { header: 'Age', key: 'age' }, { header: 'Gender', key: 'gender' }, { header: 'Branch', key: 'branchName' }];
  }

  const numberedRows = useMemo(() => rows.map((r, i) => ({ ...r, no: i + 1 })), [rows]);
  const columnsWithNo: Column<any>[] = [
    { key: 'no', header: 'No', width: '56px', render: v => <span className="text-muted-foreground tabular-nums">{v}</span> },
    ...columns,
  ];

  const presets = getDatePresets();
  const handlePreset = (label: string) => {
    const p = presets.find(x => x.label === label);
    if (!p) return;
    setDateFrom(p.from);
    setDateTo(p.to);
  };
  const handleExportCSV = () => exportCSV(numberedRows, csvColumns, `clinical-${option.value}-${dateFrom}-${dateTo}.csv`);

  return (
    <ReportSubPageShell
      title="Clinical Reports"
      description="Pick a report type and date range, then click View."
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      onRefresh={fetchData}
      loading={loading}
      hideControls
    >
      <div className="sticky top-0 z-10 -mx-6 -mt-6 px-6 pt-6 pb-4 mb-8 bg-background border-b border-border shadow-sm print:static print:mx-0 print:px-0 print:pt-0 print:pb-0 print:mb-0 print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-end gap-3 mb-4 print:hidden">
          <select
            value={reportType}
            onChange={e => setReportType(e.target.value)}
            className="h-9 min-w-[320px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {OPTION_GROUPS.map(group => (
              <optgroup key={group} label={group}>
                {REPORT_OPTIONS.filter(o => o.group === group).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {option.needsClinician && (
            <select
              value={selectedClinicianId}
              onChange={e => setSelectedClinicianId(e.target.value)}
              className="h-9 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Clinicians</option>
              {clinicians.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
          )}

          {option.needsTest && (
            <select
              value={selectedTestCode}
              onChange={e => setSelectedTestCode(e.target.value)}
              className="h-9 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Tests</option>
              {labTests.map(t => <option key={t.test_code} value={t.test_code}>{t.test_name}</option>)}
            </select>
          )}

          {option.needsSelectedAge && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Age</span>
              <Input type="number" min="0" value={selectedAge} onChange={e => setSelectedAge(e.target.value)} className="w-[72px] h-9 text-sm" />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center gap-1">
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px] h-9 text-sm" />
              <span className="text-muted-foreground text-sm">—</span>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[140px] h-9 text-sm" />
            </div>
          </div>
          <Combobox
            options={presets.map(p => ({ value: p.label, label: p.label }))}
            value=""
            onChange={handlePreset}
            placeholder="Quick range"
            searchPlaceholder="Search..."
            className="w-[130px] h-9 text-sm"
          />

          <Button size="sm" onClick={fetchData} disabled={loading} className="h-9 gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            View
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={fetchData} disabled={loading} className="h-9 gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!hasLoaded} className="h-9 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={triggerPrint} disabled={!hasLoaded} className="h-9 gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              Print
            </Button>
          </div>
        </div>

        <ReportLetterhead title={option.label} dateFrom={dateFrom} dateTo={dateTo} generatedAt={generatedAt} className="mb-0" />
      </div>

      {loading ? (
        <LoadingState message="Loading report..." />
      ) : !hasLoaded ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed border-border rounded-md">
          Pick a report type and date range above, then click View.
        </div>
      ) : (
        <AdvancedDataTable
          headerClassName="bg-sky-100 dark:bg-sky-950/40 border-b border-border"
          data={numberedRows}
          keyExtractor={keyExtractor}
          columns={columnsWithNo}
          emptyMessage={emptyMessage}
          pagination={{ enabled: true, pageSize: 25, pageSizeOptions: [25, 50, 100] }}
          maxRows={15}
          searchable
          searchPlaceholder="Search this report..."
        />
      )}
    </ReportSubPageShell>
  );
}
