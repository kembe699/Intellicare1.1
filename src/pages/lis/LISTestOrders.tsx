import React, { useState, useEffect, useRef, useMemo } from 'react';
import { offerCashBilling } from '@/lib/schemeCashFallback';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { RadiologyBodyPartPicker } from '@/components/radiology/RadiologyBodyPartPicker';
import { TestTube2, CheckCircle2, FlaskConical, Search, Plus, Activity, ArrowRight, ArrowLeft, ArrowLeftRight, FileText, ClipboardList, Printer, ChevronsUpDown, Check, X, History, Calendar, Loader2, Download, Pill, BedDouble, Save, UserPlus, Send, Scan, Syringe, CalendarClock, Egg, HeartPulse, Brain, Wind, Bone, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { cn } from '@/lib/utils';
import * as docTemplate from '@/utils/documentTemplate';
import { FREQUENCY_OPTIONS, calculateQuantity, describeDosage, findFrequency, doseUnitLabel, packEquivalent, drugBillLine } from '@/lib/prescriptionFrequency';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { DiagnosisPicker } from '@/components/clinical/DiagnosisPicker';
import GynaeFields, { EMPTY_GYNAE_INFO, GynaeInfo, GynaeFieldsReadOnly, hasGynaeInfo } from '@/components/clinical/GynaeFields';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { formatDate } from '@/lib/format';
import { PrescriptionReceipt } from '@/components/receipts/PrescriptionReceipt';
import { printReceiptWhenPainted } from '@/components/receipts/PaymentReceipt';

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const calculateAge = (dob: string): number | null => {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age >= 0 ? age : null;
};

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
];

// General Examination — a fixed checklist of body systems (matching the
// facility's own paper visit form), each a free-text finding rather than a
// structured value, since normal/abnormal phrasing varies by examiner. The
// icon is a stand-in for the paper form's own system illustration — drawn
// from the existing lucide-react set already used throughout this file
// rather than a fetched image, so there's no external asset/licensing
// dependency and it matches the rest of the app's icon style.
const GENERAL_EXAM_FIELDS: Array<{ key: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  // 'abdomen' was briefly relabelled Systematic Examination (Oct 28-30); it's
  // Abdomen again so the findings saved under it before that read correctly.
  { key: 'abdomen', label: 'Abdomen', icon: Egg },
  { key: 'systematic_examination', label: 'Systematic Examination', icon: ClipboardList },
  { key: 'cardiovascular_system', label: 'Cardiovascular System', icon: HeartPulse },
  { key: 'central_nervous_system', label: 'Central Nervous System', icon: Brain },
  { key: 'respiratory_system', label: 'Respiratory System', icon: Wind },
  { key: 'musculoskeletal_system', label: 'Musculo-skeletal System', icon: Bone },
  { key: 'other_examinations', label: 'Other Examinations', icon: Stethoscope },
];
const EMPTY_GENERAL_EXAM: Record<string, string> = Object.fromEntries(GENERAL_EXAM_FIELDS.map(f => [f.key, '']));

const EMPTY_CLINICAL_NOTES_FORM = {
  history_of_presenting_illness: '', medical_history: '', surgical_history: '',
  family_history: '', social_history: '', economic_history: '', allergies: '', impressions: '', general_examination_notes: '',
  gynae: EMPTY_GYNAE_INFO as GynaeInfo,
  general_examination: { ...EMPTY_GENERAL_EXAM },
};

// Visit Summary's editable Clinical Notes form only ever carries the notes/
// history-style subset of the full vitals object (never the numeric vitals
// triage/Record Vitals write) — pulling just that subset out, pre-filled
// from whatever's already saved, is what lets Save merge its own fields
// back into the order's vitals without touching anything else already there.
function buildClinicalNotesForm(existingVitals: any) {
  const v = existingVitals || {};
  return {
    ...EMPTY_CLINICAL_NOTES_FORM,
    history_of_presenting_illness: v.history_of_presenting_illness || '',
    medical_history: v.medical_history || '',
    surgical_history: v.surgical_history || '',
    family_history: v.family_history || '',
    social_history: v.social_history || '',
    economic_history: v.economic_history || '',
    allergies: v.allergies || '',
    impressions: v.impressions || '',
    general_examination_notes: v.general_examination_notes || '',
    gynae: { ...EMPTY_GYNAE_INFO, ...(v.gynae || {}) },
    general_examination: { ...EMPTY_GENERAL_EXAM, ...(v.general_examination || {}) },
  };
}

// dpoc-only quick registration (see the "Register New Patient" button/dialog below): a
// deliberately minimal, all-mandatory form for fast walk-in intake — full name, age,
// gender, scheme, phone, next of kin, straight into this same doctor's queue. Scoped to
// this one tenant via user.tenantCode (see AuthContext.tsx/auth.js) rather than a page
// route or config flag, since it's specific to how this facility's front desk works, not
// a general product feature.
const QUICK_REGISTER_TENANT = 'dpoc';
const EMPTY_QUICK_REGISTER = { full_name: '', age_years: '', age_months: '', gender: '', scheme_id: '', phone: '', next_of_kin: '', army_unit: '' };

// Units of measure for a prescription bought outside this pharmacy — there's
// no drug master row to read unit_of_measure from, so the prescriber picks
// one directly. Only used for the "Not in stock" / outside-pharmacy path;
// a drug picked from the catalog keeps showing its own real unit_of_measure.
const RX_EXTERNAL_UOM_OPTIONS = [
  { value: 'Tab', label: 'Tablet(s)' }, { value: 'Cap', label: 'Capsule(s)' },
  { value: 'Inj', label: 'Injection' }, { value: 'Amp', label: 'Ampoule(s)' },
  { value: 'Vial', label: 'Vial(s)' }, { value: 'Syrup', label: 'Syrup' },
  { value: 'Susp', label: 'Suspension' }, { value: 'Drop', label: 'Drop(s)' },
  { value: 'Cream', label: 'Cream' }, { value: 'Ointment', label: 'Ointment' },
  { value: 'Gel', label: 'Gel' }, { value: 'Lotion', label: 'Lotion' },
  { value: 'Patch', label: 'Patch(es)' }, { value: 'Supp', label: 'Suppository/Suppositories' },
  { value: 'Inhaler', label: 'Inhaler/Puff' }, { value: 'Spray', label: 'Spray' },
  { value: 'Sachet', label: 'Sachet(s)' }, { value: 'Bottle', label: 'Bottle(s)' },
  { value: 'mL', label: 'Millilitre(s)' }, { value: 'g', label: 'Gram(s)' },
  { value: 'mg', label: 'Milligram(s)' }, { value: 'IU', label: 'International Units' },
  { value: 'Strip', label: 'Strip(s)' }, { value: 'Pack', label: 'Pack(s)' },
  { value: 'Unit', label: 'Unit(s)' },
];

// Same dpoc-only scoping idea as QUICK_REGISTER_TENANT above — radiology
// ordering itself is now available to every tenant (see fetchRadiologyExamTypes
// and the Radiology picker below), but requesting an admission straight from
// this "Place Order" screen (instead of only from Visit Summary) is still a
// dpoc-specific workflow tweak, so this constant now only gates that one button.
const DPOC_TENANT = 'dpoc';

export default function LISTestOrders() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { user, hasPrivilege } = useAuth();
  const { currency: baseCurrency } = useCurrency();
  const navigate = useNavigate();
  const location = useLocation();
  const { participantId: urlParticipantId, orderId: urlOrderId } = useParams<{ participantId?: string; orderId?: string }>();
  const facilityInfo = useFacilityInfo();
  const [queuedPatients, setQueuedPatients] = useState<any[]>([]);
  const [labTests, setLabTests] = useState<any[]>([]);
  const [searchPart, setSearchPart] = useState('');
  const [searchTest, setSearchTest] = useState('');
  const [testPopoverOpen, setTestPopoverOpen] = useState(false);
  const [orderForm, setOrderForm] = useState({ participant_id: '', order_id: '', clinical_notes: '' });

  // dpoc-only quick registration (see GENDER_OPTIONS/EMPTY_QUICK_REGISTER above).
  const [showQuickRegister, setShowQuickRegister] = useState(false);
  const [quickRegisterSchemes, setQuickRegisterSchemes] = useState<any[]>([]);
  const [quickRegisterForm, setQuickRegisterForm] = useState(EMPTY_QUICK_REGISTER);
  const [quickRegisterSubmitting, setQuickRegisterSubmitting] = useState(false);

  // Refer Patient — quick inter-branch referral from wherever the current
  // patient is already in view, so a doctor doesn't have to leave this
  // screen and re-search for them on the Patient Referral page.
  const [showReferDialog, setShowReferDialog] = useState(false);
  const [referBranches, setReferBranches] = useState<{ id: number; name: string }[]>([]);
  const [referToBranchId, setReferToBranchId] = useState('');
  const [referReason, setReferReason] = useState('');
  const [referring, setReferring] = useState(false);
  const EMPTY_VITALS = {
    blood_pressure: '', temperature: '', pulse: '', weight: '',
    height: '', respiratory_rate: '', spo2: '', fasting_status: 'No', chief_complaints: [] as string[],
    history_of_presenting_illness: '', medical_history: '', surgical_history: '',
    family_history: '', social_history: '', economic_history: '', allergies: '', impressions: '', general_examination_notes: '',
    gynae: EMPTY_GYNAE_INFO as GynaeInfo,
    general_examination: { ...EMPTY_GENERAL_EXAM },
  };
  const [vitals, setVitals] = useState(EMPTY_VITALS);
  // Visit Summary's own editable Clinical Notes (separate from the "Place
  // Order" vitals form's own `vitals` state above) — see openVisitSummary
  // and buildClinicalNotesForm.
  const [editingClinicalNotes, setEditingClinicalNotes] = useState(false);
  const [clinicalNotesForm, setClinicalNotesForm] = useState(EMPTY_CLINICAL_NOTES_FORM);
  const [savingClinicalNotes, setSavingClinicalNotes] = useState(false);
  // Set only when the currently-selected queued patient's vitals came from a nurse's
  // triage (not typed by the doctor themselves) — purely informational, shown next to the
  // Vitals section so the doctor knows where the pre-filled numbers came from.
  const [triagedByName, setTriagedByName] = useState<string | null>(null);
  const [triagedAt, setTriagedAt] = useState<string | null>(null);
  const [selectedTests, setSelectedTests] = useState<any[]>([]);
  const [middleStep, setMiddleStep] = useState<1 | 2>(1);
  // /lis/orders/summary(/...) is a distinct route from /lis/orders — read the
  // initial tab from the URL so a direct link/refresh lands on the right one.
  const [activeMode, setActiveMode] = useState<'order' | 'results' | 'summary'>(() =>
    location.pathname.startsWith('/lis/orders/summary') ? 'summary' : 'order'
  );
  const [submittingOrder, setSubmittingOrder] = useState(false);
  // React state updates are batched, so two clicks landing in the same tick
  // could both read submittingOrder as still false before a re-render. A ref
  // is read/written synchronously, so it can't be raced the same way.
  const submittingOrderRef = useRef(false);
  // Serializes addBillItem calls so rapidly toggling several tests/services
  // can't race the "does this patient already have an active bill" check —
  // without this, two near-simultaneous calls can both see "no bill yet"
  // and each create their own, splitting one visit across multiple bills.
  const billingQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Billable services (excluding consultation/lab-diagnostic categories, which are
  // billed via clinic queueing and the lab test picker respectively) + chief complaints
  const [services, setServices] = useState<any[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  // Radiology ordering — placed order-mode side by side with tests/services
  // rather than folded into the picker above it, so that existing combined
  // picker needed no change to add this. Requests are created (not billed —
  // radiology billing isn't wired up yet, same as when this started as a
  // dpoc-only pilot) via POST /api/radiology/requests after the order itself
  // is submitted.
  const [radiologyExamTypes, setRadiologyExamTypes] = useState<any[]>([]);
  const [selectedRadiologyIds, setSelectedRadiologyIds] = useState<string[]>([]);
  // Part/region per selected exam ("Abdomen, Pelvis"), keyed by exam id.
  const [radiologyBodyParts, setRadiologyBodyParts] = useState<Record<string, string>>({});
  const [radiologyPopoverOpen, setRadiologyPopoverOpen] = useState(false);
  const [searchRadiology, setSearchRadiology] = useState('');
  const [billedItemKeys, setBilledItemKeys] = useState<Set<string>>(new Set());
  const [chiefComplaints, setChiefComplaints] = useState<any[]>([]);
  const [complaintPopoverOpen, setComplaintPopoverOpen] = useState(false);
  const [complaintSearch, setComplaintSearch] = useState('');
  const [savingComplaint, setSavingComplaint] = useState(false);

  // Cash vs. Scheme billing mode — mirrors /patients-bill and /pharmacy-prescriptions:
  // Scheme is only offered when the selected patient has an active membership, and the
  // test/service pickers then only show items that scheme has a configured price for.
  // Scheme pricing lives in scheme_service_pricing (keyed to services.id). Lab tests link
  // to that same services row via lab_tests.service_id when it's been set — matched first,
  // since it's exact — falling back to a name match (services and lab_tests are separate
  // catalogs that don't always use identical names, e.g. lab_tests "Liver Function Test
  // (LFT)" vs. services "Liver Profile") only for tests that have no service_id link yet.
  const [billingMode, setBillingMode] = useState<'cash' | 'scheme'>('cash');
  const [patientSchemes, setPatientSchemes] = useState<any[]>([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState('');
  const [schemePriceByName, setSchemePriceByName] = useState<Record<string, { price: number; currency: string; serviceId: string }>>({});
  const [schemePriceByServiceId, setSchemePriceByServiceId] = useState<Record<string, { price: number; currency: string; serviceId: string }>>({});
  const [loadingSchemeCatalog, setLoadingSchemeCatalog] = useState(false);
  const [patientActiveBill, setPatientActiveBill] = useState<any | null>(null);

  // Results Mode States
  const [approvedOrders, setApprovedOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [orderResults, setOrderResults] = useState<Record<string, any[]>>({});
  const [resultsLoading, setResultsLoading] = useState(false);

  // Visit Summary Mode States
  const [summaryDateFrom, setSummaryDateFrom] = useState(() => toLocalDateStr(new Date()));
  const [summaryDateTo, setSummaryDateTo] = useState(() => toLocalDateStr(new Date()));
  const [patientSearch, setPatientSearch] = useState('');
  const [allVisitSummaries, setAllVisitSummaries] = useState<any[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selectedSummary, setSelectedSummary] = useState<any | null>(null);
  const [summaryResults, setSummaryResults] = useState<Record<string, any[]>>({});
  const [summaryResultsLoading, setSummaryResultsLoading] = useState(false);
  const [summaryRadiology, setSummaryRadiology] = useState<any[]>([]);
  const [closingVisit, setClosingVisit] = useState(false);
  const [showAdmitRequestModal, setShowAdmitRequestModal] = useState(false);
  const [admitReason, setAdmitReason] = useState('');
  const [admitDiagnosis, setAdmitDiagnosis] = useState('');
  const [requestingAdmission, setRequestingAdmission] = useState(false);

  // Schedule Follow-up Appointment (within Visit Summary detail)
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentReason, setAppointmentReason] = useState('');
  const [schedulingAppointment, setSchedulingAppointment] = useState(false);

  // Prescription (within Visit Summary detail)
  const [pharmacyDrugs, setPharmacyDrugs] = useState<any[]>([]);
  const [rxDrugId, setRxDrugId] = useState('');
  const [rxQty, setRxQty] = useState('1');
  const [rxDose, setRxDose] = useState('');
  const [rxFrequency, setRxFrequency] = useState('');
  const [rxDuration, setRxDuration] = useState('');
  const [rxLines, setRxLines] = useState<any[]>([]);
  const [prescribing, setPrescribing] = useState(false);
  // Numeric dose per administration — the multiplier in the quantity
  // arithmetic. Kept separate from dose_strength ("500mg"), which is a label.
  const [rxDoseAmount, setRxDoseAmount] = useState('1');
  // Out-of-stock item the patient buys outside: typed name, no inventory row.
  const [rxIsExternal, setRxIsExternal] = useState(false);
  const [rxExternalName, setRxExternalName] = useState('');
  const [rxExternalUnit, setRxExternalUnit] = useState('');
  const [rxNotes, setRxNotes] = useState('');
  // Which stock_locations row this line is dispensed from — default to
  // whichever one pharmacy_settings.default_pharmacy_location_id names
  // (typically "Pharmacy"), changeable per line.
  const [pharmacyLocations, setPharmacyLocations] = useState<any[]>([]);
  const [rxLocationId, setRxLocationId] = useState('');
  // Quantity is derived (dose x per-day x days) until a prescriber types their
  // own, at which point their number wins — PRN and STAT have no derivable
  // total at all, so the field simply stays theirs.
  const [rxQtyTouched, setRxQtyTouched] = useState(false);
  const [printingRx, setPrintingRx] = useState(false);
  // Printed on the same signed 80mm thermal template the Pharmacy module
  // uses — an off-screen render + printReceiptWhenPainted.
  const [rxReceiptData, setRxReceiptData] = useState<any | null>(null);
  const rxReceiptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rxReceiptData) return;
    const cancel = printReceiptWhenPainted(
      () => rxReceiptRef.current,
      (printed) => {
        setRxReceiptData(null);
        if (!printed) toast.error('Prescription receipt could not be prepared for printing');
      }
    );
    return cancel;
  }, [rxReceiptData]);

  const rxSuggestedQty = useMemo(
    () => calculateQuantity(parseFloat(rxDoseAmount), rxFrequency, parseInt(rxDuration, 10)),
    [rxDoseAmount, rxFrequency, rxDuration]
  );

  useEffect(() => {
    if (rxQtyTouched) return;
    if (rxSuggestedQty != null) setRxQty(String(rxSuggestedQty));
  }, [rxSuggestedQty, rxQtyTouched]);

  // Request Another Service (within Visit Summary detail) — lets a doctor order a
  // confirmatory/follow-up test or service on the same visit without leaving the summary.
  const [reqServiceQuery, setReqServiceQuery] = useState('');
  const [reqServicePopoverOpen, setReqServicePopoverOpen] = useState(false);
  const [reqServiceSelected, setReqServiceSelected] = useState<any[]>([]);
  // Switches the same combobox between the existing tests+services list and
  // the radiology exam catalog (radiologyExamTypes, already fetched at page
  // level for the Place Order screen's own picker) — rather than a second,
  // separate radiology control.
  const [reqServiceMode, setReqServiceMode] = useState<'other' | 'radiology'>('other');
  const [reqRadiologyBodyParts, setReqRadiologyBodyParts] = useState<Record<string, string>>({});
  const [requestingService, setRequestingService] = useState(false);

  useEffect(() => {
    if (activeMode === 'order') {
      fetchQueue();
      fetchLabTests();
      fetchServices();
      fetchChiefComplaints();
      if (pharmacyDrugs.length === 0) fetchPharmacyDrugs();
      if (pharmacyLocations.length === 0) fetchPharmacyLocations();
      fetchRadiologyExamTypes();
      const interval = setInterval(fetchQueue, 3000);
      return () => clearInterval(interval);
    } else if (activeMode === 'results') {
      fetchApprovedOrders();
    } else {
      fetchVisitSummaries();
    }
  }, [activeMode]);

  const fetchApprovedOrders = async () => {
    setResultsLoading(true);
    try {
      const res = await authFetch('/api/lis/specimens/history', { credentials: 'include' });
      if (res.ok) {
        const history = await res.json();
        const approved = history.filter((s: any) => s.status === 'approved');
        
        // Group by order_id
        const orderMap = new Map();
        for (const s of approved) {
          if (!orderMap.has(s.order_id)) {
            orderMap.set(s.order_id, {
              order_id: s.order_id,
              order_time: s.order_time,
              participant_id: s.participant_id,
              participant_number: s.participant_number,
              first_name: s.first_name,
              last_name: s.last_name,
              updated_at: s.updated_at,
              specimens: []
            });
          }
          const orderGroup = orderMap.get(s.order_id);
          orderGroup.specimens.push(s);
          if (new Date(s.updated_at) > new Date(orderGroup.updated_at)) {
            orderGroup.updated_at = s.updated_at;
          }
        }
        setApprovedOrders(Array.from(orderMap.values()));
      }
    } catch (e) {
      toast.error('Failed to fetch approved results');
    } finally {
      setResultsLoading(false);
    }
  };

  const loadOrderResults = async (order: any) => {
    setSelectedOrder(order);
    try {
      const resultsMap: Record<string, any[]> = {};
      for (const s of order.specimens) {
        const res = await authFetch(`/api/lis/specimens/${s.id}/results`, { credentials: 'include' });
        if (res.ok) {
          resultsMap[s.id] = await res.json();
        }
      }
      setOrderResults(resultsMap);
    } catch (e) {
      toast.error('Failed to load results');
    }
  };

  const fetchVisitSummaries = async () => {
    setSummaryLoading(true);
    try {
      const res = await authFetch('/api/lis/visit-summaries', { credentials: 'include' });
      if (res.ok) setAllVisitSummaries(await res.json());
    } catch (e) {
      toast.error('Failed to load visit summaries');
    } finally {
      setSummaryLoading(false);
    }
  };

  const openVisitSummary = async (summary: any) => {
    setSelectedSummary(summary);
    setRxLines([]);
    setRxDrugId(''); setRxQty('1'); setRxDose(''); setRxFrequency(''); setRxDuration('');
    setReqServiceSelected([]); setReqServiceQuery(''); setReqRadiologyBodyParts({});
    setEditingClinicalNotes(false);
    setClinicalNotesForm(buildClinicalNotesForm(summary.vitals));
    fetchPharmacyDrugs();
    if (pharmacyLocations.length === 0) fetchPharmacyLocations();
    if (labTests.length === 0) fetchLabTests();
    if (services.length === 0) fetchServices();
    // Independent of the lab-results fetch below (and its early return when
    // there's nothing to show there) — a visit can have radiology requests
    // with zero lab tests ordered, or vice versa.
    setSummaryRadiology([]);
    authFetch(`/api/radiology/requests?order_id=${summary.order_id}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(setSummaryRadiology)
      .catch(() => {});
    const readyTests = (summary.tests || []).filter((t: any) => t.status === 'approved');
    if (readyTests.length === 0) { setSummaryResults({}); return; }
    setSummaryResultsLoading(true);
    try {
      const resultsMap: Record<string, any[]> = {};
      for (const t of readyTests) {
        const res = await authFetch(`/api/lis/specimens/${t.id}/results`, { credentials: 'include' });
        if (res.ok) resultsMap[t.id] = await res.json();
      }
      setSummaryResults(resultsMap);
    } catch (e) {
      toast.error('Failed to load results');
    } finally {
      setSummaryResultsLoading(false);
    }
  };

  // Keeps activeMode/selectedSummary in sync with the URL on EVERY route
  // change, not just the initial mount. /lis/orders and /lis/orders/summary(/...)
  // are sibling <Route>s rendering this exact same component — React Router
  // does not remount/recreate the component instance when navigating between
  // sibling routes that render the same element type at the same tree
  // position, so a plain `useState(() => ...)` initializer (which only runs
  // once, at first mount) never re-fires on a later in-app navigation. That
  // was the actual bug: the address bar changed, but nothing re-ran to make
  // the page follow it — only a hard refresh (a real remount) picked it up.
  // This effect is what makes every navigation (tab click or URL/back-button
  // change) actually re-render the right view, with no refresh needed.
  useEffect(() => {
    if (!location.pathname.startsWith('/lis/orders/summary')) {
      setActiveMode('order');
      return;
    }
    if (!urlParticipantId || !urlOrderId) {
      // Bare /lis/orders/summary — the list-to-pick-from view, no specific
      // visit selected yet.
      setActiveMode('summary');
      setSelectedSummary(null);
      return;
    }

    const alreadySelected = selectedSummary
      && String(selectedSummary.participant_id) === urlParticipantId
      && String(selectedSummary.order_id) === urlOrderId;
    if (alreadySelected) {
      setActiveMode('summary');
      return;
    }

    setActiveMode('summary');
    const cached = allVisitSummaries.find((s) => String(s.order_id) === urlOrderId && String(s.participant_id) === urlParticipantId);
    if (cached) {
      openVisitSummary(cached);
      return;
    }
    (async () => {
      try {
        const res = await authFetch(`/api/lis/visit-summaries?participant_id=${urlParticipantId}`, { credentials: 'include' });
        if (!res.ok) { toast.error('Failed to load that visit summary'); return; }
        const list = await res.json();
        const found = list.find((o: any) => String(o.order_id) === urlOrderId);
        if (!found) {
          toast.error('That visit could not be found.');
          navigate('/lis/orders', { replace: true });
          return;
        }
        setAllVisitSummaries((prev) => (prev.some((s) => s.order_id === found.order_id) ? prev : [...prev, found]));
        openVisitSummary(found);
      } catch (e) {
        toast.error('Failed to load that visit summary');
      }
    })();
    // Only the URL identifies which visit to restore — re-running this on
    // every selectedSummary/allVisitSummaries change would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, urlParticipantId, urlOrderId]);

  const fetchPharmacyDrugs = async () => {
    try {
      const branchClinicId = user?.clinic || 1;
      // Only what the chosen store holds (defaults to the selling store).
      const store = rxLocationId ? `&location_id=${rxLocationId}&stocked_only=true` : '';
      const res = await authFetch(`/api/pharmacy-module/drugs?clinic_id=${branchClinicId}&is_active=true${store}`, { credentials: 'include' });
      if (res.ok) setPharmacyDrugs(await res.json());
    } catch (e) {
      console.error('Failed to fetch pharmacy drugs', e);
    }
  };

  // Re-list the drugs when the store changes (and once the default store is known).
  useEffect(() => {
    if (rxLocationId) fetchPharmacyDrugs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rxLocationId]);

  const fetchPharmacyLocations = async () => {
    try {
      const res = await authFetch('/api/pharmacy-module/locations', { credentials: 'include' });
      if (res.ok) {
        const locs = await res.json();
        setPharmacyLocations(locs);
        const def = locs.find((l: any) => l.is_default) || locs[0];
        if (def) setRxLocationId((prev) => prev || def.id);
      }
    } catch (e) {
      console.error('Failed to fetch pharmacy locations', e);
    }
  };

  const resetRxForm = () => {
    setRxDrugId(''); setRxQty('1'); setRxDose(''); setRxFrequency(''); setRxDuration('');
    setRxDoseAmount('1'); setRxExternalName(''); setRxExternalUnit(''); setRxNotes(''); setRxQtyTouched(false);
  };

  const handleAddRxLine = () => {
    const qty = parseInt(rxQty, 10) || 1;
    const duration = parseInt(rxDuration, 10) || 0;

    // An out-of-stock drug the patient buys outside: there is no inventory item
    // to pick, so the name is typed and the line carries no drug_id. It is never
    // stock-checked or billed here, because this pharmacy isn't supplying it.
    if (rxIsExternal) {
      if (!rxExternalName.trim()) { toast.error('Enter the medicine name'); return; }
      if (!rxExternalUnit) { toast.error('Select a unit of measure'); return; }
      setRxLines(prev => [...prev, {
        drug_id: null, is_external: true,
        external_drug_name: rxExternalName.trim(), drug_name: rxExternalName.trim(),
        unit_of_measure: rxExternalUnit, quantity_prescribed: qty,
        dose_amount: parseFloat(rxDoseAmount) || null, dose_strength: rxDose,
        frequency: rxFrequency, duration_days: duration,
        notes: rxNotes.trim(), selling_price: 0,
        // External lines aren't supplied by this pharmacy at all, so a
        // storage location means nothing for them.
        location_id: null, location_name: null,
      }]);
      resetRxForm();
      return;
    }

    if (!rxDrugId) { toast.error('Select a drug'); return; }
    const drug = pharmacyDrugs.find(d => d.id === rxDrugId);
    if (!drug) return;
    const stockOnHand = drug.stock_on_hand != null ? parseFloat(drug.stock_on_hand) : null;
    const alreadyQueued = rxLines.filter(l => l.drug_id === drug.id).reduce((sum, l) => sum + (l.quantity_prescribed || 0), 0);
    // stock_on_hand is tracked in the item's pack unit (Strip/Bottle/etc.),
    // qty is always a dose-unit count — compare like units via packEquivalent,
    // not the raw dose count, or a 10-per-strip drug looks "out of stock" at
    // 1/10th its real capacity.
    if (stockOnHand != null && !isNaN(stockOnHand) && packEquivalent(qty + alreadyQueued, drug) > stockOnHand) {
      toast.error(`Only ${stockOnHand} ${drug.unit_of_measure || 'unit'}(s) of ${drug.drug_name} in stock (≈ ${Math.floor(stockOnHand * (Number(drug.units_per_pack) || 1))} ${doseUnitLabel(drug)}) — reduce the quantity, or tick "Not in stock" to prescribe it for purchase outside.`);
      return;
    }
    const rxLocation = pharmacyLocations.find((l: any) => l.id === rxLocationId);
    setRxLines(prev => [...prev, {
      drug_id: drug.id, is_external: false, drug_name: drug.drug_name,
      unit_of_measure: doseUnitLabel(drug),
      quantity_prescribed: qty, dose_amount: parseFloat(rxDoseAmount) || null,
      dose_strength: rxDose, frequency: rxFrequency,
      duration_days: duration, notes: rxNotes.trim(), selling_price: parseFloat(drug.selling_price) || 0,
      units_per_pack: Number(drug.units_per_pack) || 1,
      location_id: rxLocation?.id || null, location_name: rxLocation?.name || null,
    }]);
    resetRxForm();
  };

  const removeRxLine = (index: number) => {
    setRxLines(prev => prev.filter((_, i) => i !== index));
  };

  // Works from either screen: Visit Summary (an existing order, keyed on
  // selectedSummary) or Place Order (a patient picked but no order submitted
  // yet, keyed on selectedParticipant/orderForm) — a prescription only ever
  // needs a patient_id, never an order id (pharmacy_prescriptions has no FK to
  // lis_test_orders; it's matched back to a visit by patient + same day, same
  // as the visit-summaries endpoint's own read side), so prescribing here
  // doesn't need the order to exist first.
  const handleSubmitPrescription = async () => {
    const inSummaryMode = activeMode === 'summary';
    const patientId = inSummaryMode ? selectedSummary?.participant_id : orderForm.participant_id;
    const patientName = inSummaryMode
      ? (selectedSummary ? `${selectedSummary.first_name} ${selectedSummary.last_name}` : '')
      : (selectedParticipant ? `${selectedParticipant.first_name} ${selectedParticipant.last_name}` : '');
    const doctorId = inSummaryMode ? (selectedSummary?.doctor_id || user?.id) : user?.id;
    if (!patientId || rxLines.length === 0) return;
    if (inSummaryMode && selectedSummary?.status === 'closed') { toast.error('This visit is closed — start a new visit to prescribe medicine.'); return; }
    setPrescribing(true);
    try {
      const branchClinicId = user?.clinic || 1;
      const res = await authFetch('/api/pharmacy-module/prescriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clinic_id: branchClinicId,
          patient_id: patientId,
          doctor_id: doctorId,
          prescription_date: new Date().toISOString().split('T')[0],
          prescribed_by_name: user?.displayName,
          lines: rxLines.map(l => ({
            drug_id: l.drug_id, quantity_prescribed: l.quantity_prescribed, unit_of_measure: l.unit_of_measure,
            dose_strength: l.dose_strength, frequency: l.frequency, duration_days: l.duration_days, notes: l.notes,
            is_external: !!l.is_external, external_drug_name: l.external_drug_name || null, dose_amount: l.dose_amount ?? null,
            location_id: l.location_id || null, location_name: l.location_name || null,
          })),
        }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success(`Prescription ${created.prescription_number} created`);
        const patient = { id: patientId, name: patientName };
        // Only what this pharmacy actually supplies goes on the bill. An
        // external line is bought outside, so billing it here would charge the
        // patient twice for one medicine.
        for (const l of rxLines.filter(x => !x.is_external)) {
          // Priced per pack: doses ÷ pack size × pack price (not doses × pack price).
          await addBillItem(`rx-${created.id}-${l.drug_id}`, l.drug_name, l.selling_price, patient, l.quantity_prescribed, l.drug_id, undefined,
            drugBillLine({ drugId: l.drug_id, drugName: l.drug_name, doses: l.quantity_prescribed, packPrice: l.selling_price, unitsPerPack: l.units_per_pack }));
        }
        const externalCount = rxLines.filter(x => x.is_external).length;
        if (externalCount > 0) {
          toast.info(`${externalCount} item${externalCount === 1 ? '' : 's'} marked for purchase outside — not billed here. Print the prescription for the patient.`);
        }
        setRxLines([]);
        if (inSummaryMode) await refreshSelectedSummary();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create prescription');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setPrescribing(false);
    }
  };

  // Same dual-mode pattern as handleSubmitPrescription — works from either
  // Place Order (selectedParticipant) or Visit Summary (selectedSummary),
  // since a referral only ever needs a patient_id.
  const openReferDialog = async () => {
    setShowReferDialog(true);
    setReferToBranchId('');
    setReferReason('');
    if (referBranches.length === 0) {
      try {
        const res = await authFetch('/api/facilities/branches/all', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const rows = Array.isArray(data) ? data : (data.data || []);
          setReferBranches(rows.filter((b: any) => b.is_active !== false).map((b: any) => ({ id: Number(b.id), name: b.name })));
        }
      } catch { /* branch picker just stays empty */ }
    }
  };

  const handleCreateReferral = async () => {
    const inSummaryMode = activeMode === 'summary';
    const patientId = inSummaryMode ? selectedSummary?.participant_id : orderForm.participant_id;
    if (!patientId) return;
    if (!referToBranchId) return toast.error('Select the receiving branch');
    setReferring(true);
    try {
      const res = await authFetch('/api/patient-referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ patient_id: patientId, to_branch_id: parseInt(referToBranchId, 10), reason: referReason.trim() || null }),
      });
      if (res.ok) {
        toast.success('Referral sent');
        setShowReferDialog(false);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to send referral');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setReferring(false);
    }
  };

  // Re-pulls just this one visit's summary (tests + prescriptions) after an action that
  // changes it (prescribing a drug, requesting another service) — cheaper than reloading
  // the whole list, and keeps allVisitSummaries in sync so it's still correct if the doctor
  // navigates away and back without a full refetch.
  const refreshSelectedSummary = async () => {
    if (!selectedSummary) return;
    try {
      const res = await authFetch(`/api/lis/visit-summaries?participant_id=${selectedSummary.participant_id}`, { credentials: 'include' });
      if (res.ok) {
        const list = await res.json();
        const updated = list.find((o: any) => o.order_id === selectedSummary.order_id);
        if (updated) {
          setSelectedSummary(updated);
          setAllVisitSummaries(prev => prev.map(s => s.order_id === updated.order_id ? updated : s));
        }
      }
    } catch (e) {
      console.error('Failed to refresh visit summary', e);
    }
  };

  // Merges clinicalNotesForm's fields into whatever's already in this order's
  // vitals (triage's own numeric BP/pulse/etc, if any) rather than replacing
  // the whole object — see PUT /orders/:id/clinical-notes's own comment in
  // lisModule.js for why the server does a plain overwrite and the client is
  // what's responsible for carrying the rest of vitals forward.
  const handleSaveClinicalNotes = async () => {
    if (!selectedSummary || savingClinicalNotes) return;
    setSavingClinicalNotes(true);
    try {
      const mergedVitals = { ...(selectedSummary.vitals || {}), ...clinicalNotesForm };
      const res = await authFetch(`/api/lis/orders/${selectedSummary.order_id}/clinical-notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vitals: mergedVitals }),
      });
      if (res.ok) {
        toast.success('Clinical notes saved');
        setEditingClinicalNotes(false);
        await refreshSelectedSummary();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to save clinical notes');
      }
    } catch {
      toast.error('Network error saving clinical notes');
    } finally {
      setSavingClinicalNotes(false);
    }
  };

  const toggleReqService = (item: any) => {
    const isSelected = reqServiceSelected.some(x => x.key === item.key);
    if (!isSelected && item.type === 'test' && item.is_available === false) {
      toast.error(`${item.name} is unavailable — its linked reagent/kit is out of stock.`);
      return;
    }
    setReqServiceSelected(prev =>
      prev.some(x => x.key === item.key) ? prev.filter(x => x.key !== item.key) : [...prev, item]
    );
    if (isSelected) setReqRadiologyBodyParts(({ [item.key]: _, ...rest }) => rest);
  };

  // A confirmatory/follow-up test or service requested directly from an open Visit Summary —
  // lab tests get a new specimen appended to this same order (POST /orders/:id/add-tests, so
  // it flows through Collection/QC/Results like any other test on this visit); plain services
  // skip specimen tracking entirely, same split the main order form (Step 3) already uses.
  // Either way it's billed the same way everything else on this visit is.
  const handleRequestService = async () => {
    if (!selectedSummary || reqServiceSelected.length === 0 || requestingService) return;
    if (selectedSummary.status === 'closed') { toast.error('This visit is closed — start a new visit to request more tests or services.'); return; }
    setRequestingService(true);
    try {
      const testItems = reqServiceSelected.filter(i => i.type === 'test');
      const serviceItems = reqServiceSelected.filter(i => i.type === 'service');
      const radiologyItems = reqServiceSelected.filter(i => i.type === 'radiology');

      if (radiologyItems.length > 0) {
        // Radiology requests go through their own endpoint — kept separate
        // from the generic bill-item path below, same as the Place Order
        // screen's own radiology picker, since radiology isn't billed
        // through that path yet (see that picker's own comment).
        const res = await authFetch('/api/radiology/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            participant_id: selectedSummary.participant_id,
            order_id: selectedSummary.order_id,
            doctor_id: selectedSummary.doctor_id || user?.id,
            items: radiologyItems.map(i => ({ service_id: i.examId, exam_name: i.name, body_part: reqRadiologyBodyParts[i.key] || null })),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || 'Failed to request radiology exam');
        }
      }

      if (testItems.length > 0) {
        const res = await authFetch(`/api/lis/orders/${selectedSummary.order_id}/add-tests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tests: testItems.map(i => ({ code: i.code, name: i.name, department: i.department })) }),
        });
        if (res.ok) {
          const body = await res.json();
          const skippedNames: string[] = body.skipped_duplicates || [];
          if (skippedNames.length > 0) {
            toast.warning(`${skippedNames.join(', ')} already pending collection for this visit — not re-requested.`);
          }
        } else {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || 'Failed to request test');
        }
      }

      const patient = { id: selectedSummary.participant_id, name: `${selectedSummary.first_name} ${selectedSummary.last_name}` };
      for (const item of [...testItems, ...serviceItems]) {
        await addBillItem(`req-${selectedSummary.order_id}-${item.key}-${Date.now()}`, item.name, item.price, patient, 1, item.serviceId, item.currency);
      }

      toast.success(`Requested ${reqServiceSelected.length} item${reqServiceSelected.length > 1 ? 's' : ''}`);
      setReqServiceSelected([]);
      setReqRadiologyBodyParts({});
      setReqServiceQuery('');
      await refreshSelectedSummary();
    } finally {
      setRequestingService(false);
    }
  };

  const handleCloseVisit = async () => {
    if (!selectedSummary) return;
    if (!(await confirm({ description: 'Close this visit? This marks the encounter as complete.' }))) return;
    setClosingVisit(true);
    try {
      const res = await authFetch(`/api/lis/orders/${selectedSummary.order_id}/close`, { method: 'PUT', credentials: 'include' });
      if (res.ok) {
        toast.success('Visit closed');
        setAllVisitSummaries(prev => prev.map(s => s.order_id === selectedSummary.order_id ? { ...s, status: 'closed' } : s));
        setSelectedSummary((prev: any) => prev ? { ...prev, status: 'closed' } : prev);
      } else {
        toast.error('Failed to close visit');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setClosingVisit(false);
    }
  };

  // The doctor already records a diagnosis for the visit (saved into
  // clinical_notes as "Diagnosis: ..." by DiagnosisPicker, either coded
  // "<code> - <description>" or free-text) — the admission-request flow
  // below used to make them retype it from scratch. Pull the most recently
  // saved one straight out of clinical_notes instead.
  const extractDiagnosisFromNotes = (notes?: string | null): string => {
    if (!notes) return '';
    const idx = notes.lastIndexOf('Diagnosis:');
    if (idx === -1) return '';
    return notes.slice(idx + 'Diagnosis:'.length).trim();
  };

  // Every "Diagnosis: X" entry appended by DiagnosisPicker, in the order they
  // were added — used to render them as a proper list instead of one run-on
  // paragraph. De-duped case-insensitively so visits saved before that
  // duplicate-check existed still display cleanly.
  const getDiagnosesFromNotes = (notes?: string | null): string[] => {
    const all = (notes || '').split('Diagnosis:').slice(1).map(s => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    return all.filter(d => {
      const key = d.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  // Whatever free-text notes came before the first "Diagnosis:" marker — the diagnoses
  // themselves are rendered separately, so they shouldn't also show up as a wall of text
  // inside Clinical Notes.
  const getPlainNotes = (notes?: string | null): string => {
    if (!notes) return '';
    const idx = notes.indexOf('Diagnosis:');
    return (idx === -1 ? notes : notes.slice(0, idx)).trim();
  };

  // Vitals rendered as a table (Vital Sign / Unit / Normal Values / Input),
  // shared by the live Visit Summary view and the printed/downloaded one so
  // both always show the same rows. blood_pressure is stored as one
  // "systolic/diastolic" string and height in cm — split/converted here for
  // display only; the underlying data model is unchanged. Fasting status is
  // intentionally left out of this table (shown elsewhere) since it isn't a
  // vital sign with a normal range.
  const VITALS_TABLE_SPEC: Array<{ key: string; label: string; unit: string; normal: string }> = [
    { key: 'temperature', label: 'Temperature', unit: '°C', normal: '35.5 - 37.5' },
    { key: 'pulse', label: 'Pulse Rate', unit: 'Beats/minute', normal: '60 - 90' },
    { key: 'respiratory_rate', label: 'Respiratory Rate', unit: 'Brth/minute', normal: '18 - 30' },
    { key: 'systolic', label: 'Systolic', unit: 'mmHg', normal: '90 - 140' },
    { key: 'diastolic', label: 'Diastolic', unit: 'mmHg', normal: '50 - 90' },
    { key: 'weight', label: 'Weight', unit: 'Kilograms', normal: '0 - 100' },
    { key: 'height', label: 'Height', unit: 'Metres', normal: '0 - 2' },
    { key: 'spo2', label: 'SPO2', unit: '%', normal: '85 - 100' },
  ];
  const getVitalsTableRows = (vitals?: any): Array<{ label: string; unit: string; normal: string; value: string }> => {
    const v = vitals || {};
    const [systolic, diastolic] = (v.blood_pressure || '').split('/').map((s: string) => s.trim());
    const values: Record<string, string> = {
      temperature: v.temperature || '',
      pulse: v.pulse || '',
      respiratory_rate: v.respiratory_rate || '',
      systolic: systolic || '',
      diastolic: diastolic || '',
      weight: v.weight || '',
      height: v.height ? (parseFloat(v.height) / 100).toFixed(2) : '',
      spo2: v.spo2 || '',
    };
    return VITALS_TABLE_SPEC.map((spec) => ({
      label: spec.label,
      unit: spec.unit,
      normal: spec.normal,
      value: values[spec.key] || '—',
    }));
  };

  const handleRequestAdmission = async () => {
    // Reachable from either Visit Summary (selectedSummary) or, dpoc-only, this
    // "Place Order" screen directly (selectedParticipant) — same dual-mode
    // branch shape as handleSubmitPrescription above. The admission-requests
    // endpoint only ever needs patient_id/patient_name/diagnosis, no
    // visit/order id, so either source works unchanged.
    const inSummaryMode = activeMode === 'summary';
    const patient = inSummaryMode ? selectedSummary : selectedParticipant;
    if (requestingAdmission) return;
    if (!patient) return;
    if (!admitDiagnosis.trim()) { toast.error('Diagnosis is required to request admission'); return; }
    setRequestingAdmission(true);
    try {
      const res = await authFetch('/api/inpatient/admission-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patient_id: patient.participant_id,
          patient_name: `${patient.first_name} ${patient.last_name}`.trim(),
          reason: admitReason,
          diagnosis: admitDiagnosis,
          clinic_id: user?.clinic || 1,
        }),
      });
      if (res.ok) {
        toast.success('Admission requested — ward staff will process it shortly');
        setShowAdmitRequestModal(false);
        setAdmitReason('');
        setAdmitDiagnosis('');
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to request admission');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setRequestingAdmission(false);
    }
  };

  // Books a follow-up appointment for this visit's patient, defaulting to the
  // doctor already attending them — it shows up on the new /appointments page,
  // and queuing it there on the day hands the patient straight back into this
  // same doctor's consultation queue.
  const handleScheduleAppointment = async () => {
    if (!selectedSummary) return;
    if (!appointmentDate) { toast.error('Pick a date for the follow-up'); return; }
    setSchedulingAppointment(true);
    try {
      const res = await authFetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          participant_id: selectedSummary.participant_id,
          doctor_id: selectedSummary.doctor_id || undefined,
          scheduled_date: appointmentDate,
          reason: appointmentReason.trim() || undefined,
          source_order_id: selectedSummary.order_id,
        }),
      });
      if (res.ok) {
        toast.success('Follow-up appointment scheduled');
        setShowAppointmentModal(false);
        setAppointmentDate('');
        setAppointmentReason('');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to schedule appointment');
      }
    } catch {
      toast.error('Network error scheduling appointment');
    } finally {
      setSchedulingAppointment(false);
    }
  };

  /**
   * A standalone prescription the patient can take away, printed on the same
   * signed 80mm thermal template the Pharmacy module uses.
   *
   * Deliberately separate from the visit summary: a patient buying medicine at
   * an outside pharmacy needs the medicines, the prescriber and the hospital's
   * identity on one page, and nothing else. A visit summary carries diagnoses,
   * vitals and lab results that have no business crossing a pharmacy counter.
   *
   * Items the hospital could not supply are marked, so the dispensing pharmacy
   * can see at a glance which lines are theirs to fill.
   */
  const handlePrintPrescription = async () => {
    if (!selectedSummary) return;
    const s = selectedSummary;
    const lines: any[] = s.prescriptions || [];
    if (lines.length === 0) { toast.error('No medicines prescribed for this visit yet.'); return; }

    setPrintingRx(true);
    try {
      const doctorSignature = await docTemplate.fetchUserSignature(s.doctor_id || user?.uid);
      const patientName = `${s.first_name || ''} ${s.last_name || ''}`.trim();
      const rxNumber = lines[0]?.prescription_number || '';

      setRxReceiptData({
        prescriptionNumber: rxNumber || `RX-${String(s.order_id).slice(-6).toUpperCase()}`,
        patientName: patientName || 'Unknown patient',
        patientNumber: s.participant_number,
        doctorName: s.doctor_name || user?.displayName,
        doctorSignature,
        date: lines[0]?.prescription_date || new Date().toISOString(),
        notes: s.clinical_notes ? String(s.clinical_notes).slice(0, 120) : undefined,
        lines: lines.map((l) => ({
          drugName: l.drug_name || l.external_drug_name || 'Medicine',
          doseStrength: l.dose_strength,
          frequency: describeDosage(l.dose_amount, l.unit_of_measure, l.frequency, l.duration_days),
          quantity: l.quantity_prescribed,
          unit: l.unit_of_measure,
          isExternal: !!l.is_external,
        })),
      });
    } catch (e) {
      console.error('Prescription print failed', e);
      toast.error('Could not build the prescription receipt');
    } finally {
      setPrintingRx(false);
    }
  };

  const handlePrintSummary = async () => {
    if (!selectedSummary) return;
    const signature = await docTemplate.fetchUserSignature(user?.uid);
    const s = selectedSummary;
    const v = s.vitals || {};
    const patientName = `${s.first_name} ${s.last_name}`.trim();
    const age = calculateAge(s.date_of_birth);

    const plainNote = (label: string, value?: string | null) =>
      value ? `<p style="margin:2px 0 8px 0;font-size:11px;line-height:1.5;color:#334155;"><strong style="color:#0F172A">${label}:</strong> ${value}</p>` : '';

    const vitalsHTML = docTemplate.buildTable(
      [{ label: 'Vital Sign' }, { label: 'Unit' }, { label: 'Normal Values' }, { label: 'Input' }],
      getVitalsTableRows(v).map((row) => ({ cells: [row.label, row.unit, row.normal, row.value] }))
    );

    const gynae = v.gynae;
    const gynaeHTML = hasGynaeInfo(gynae) ? [
      '<div class="ic-section-title">Gynecology / Obstetric</div>',
      plainNote('Pregnancy Status', gynae?.pregnancy_status),
      plainNote('LMP', gynae?.lmp),
      plainNote('EDD', gynae?.edd),
      plainNote('Gravida', gynae?.gravida),
      plainNote('Para', gynae?.para),
      plainNote('Menstrual Cycle', gynae?.menstrual_cycle),
      plainNote('Presenting Symptoms', gynae?.presenting_symptoms),
      gynae?.antenatal_enabled ? plainNote('Gestational Age', gynae?.antenatal?.gestational_age_weeks ? `${gynae.antenatal.gestational_age_weeks} weeks` : '') : '',
      gynae?.antenatal_enabled ? plainNote('Fundal Height', gynae?.antenatal?.fundal_height_cm ? `${gynae.antenatal.fundal_height_cm} cm` : '') : '',
      gynae?.antenatal_enabled ? plainNote('Fetal Heart Rate', gynae?.antenatal?.fetal_heart_rate ? `${gynae.antenatal.fetal_heart_rate} bpm` : '') : '',
      gynae?.antenatal_enabled ? plainNote('Fetal Presentation', gynae?.antenatal?.fetal_presentation) : '',
      gynae?.antenatal_enabled ? plainNote('Antenatal Notes', gynae?.antenatal?.notes) : '',
    ].join('\n') : '';

    const generalExam = v.general_examination || {};
    const generalExamHTML = [
      '<div class="ic-section-title">General Examination</div>',
      ...GENERAL_EXAM_FIELDS.map(({ key, label }) => plainNote(label, generalExam[key] || '—')),
    ].join('\n');

    const diagnosesHTML = getDiagnosesFromNotes(s.clinical_notes).length > 0 ? [
      '<div class="ic-section-title">Diagnosis</div>',
      `<p style="margin:2px 0 8px 0;font-size:11px;line-height:1.5;color:#334155;">${getDiagnosesFromNotes(s.clinical_notes).join('; ')}</p>`,
    ].join('\n') : '';

    const testsHTML = docTemplate.buildTable(
      [{ label: 'Test' }, { label: 'Status' }],
      (s.tests || []).map((t: any) => ({ cells: [t.test_name, t.status.replace(/_/g, ' ')] }))
    );

    const nursingProcedures = s.nursing_procedures || [];
    const nursingHTML = nursingProcedures.length > 0 ? [
      '<div class="ic-section-title">Nursing Procedures</div>',
      docTemplate.buildTable(
        [{ label: 'Procedure' }, { label: 'By' }, { label: 'Date/Time' }, { label: 'Status' }],
        nursingProcedures.map((np: any) => ({
          cells: [
            np.description,
            np.status === 'completed' ? (np.nurse_name || '—') : `Ordered: ${np.ordered_by_name || '—'}`,
            new Date(np.performed_at).toLocaleString(),
            (np.status || '—').replace(/_/g, ' '),
          ],
        }))
      ),
    ].join('\n') : '';

    const prescriptions = s.prescriptions || [];
    const prescriptionsHTML = prescriptions.length > 0 ? [
      '<div class="ic-section-title">Medications Prescribed</div>',
      docTemplate.buildTable(
        [{ label: 'Drug' }, { label: 'Qty' }, { label: 'Dosage / Sig' }, { label: 'Duration' }, { label: 'Status' }],
        prescriptions.map((rx: any) => ({
          cells: [
            `${rx.drug_name || 'Unknown'}${rx.unit_of_measure ? ` (${rx.unit_of_measure})` : ''}`
              + (rx.is_external ? ' <span style="color:#b45309;font-weight:600">[buy outside]</span>' : ''),
            String(rx.quantity_prescribed ?? '—'),
            // One readable sig rather than three columns the reader has to
            // reassemble: "1 tablet three times daily for 5 days".
            describeDosage(rx.dose_amount, rx.unit_of_measure, rx.frequency, rx.duration_days),
            rx.duration_days ? `${rx.duration_days} day(s)` : '—',
            (rx.line_status || rx.status || '—').toString().replace(/_/g, ' '),
          ],
        }))
      ),
    ].join('\n') : '';

    // One block per requested exam: a small table row up top (matches the
    // Tests Ordered summary style) plus, once completed, the full report text
    // right below its own row rather than in a separate document — a doctor
    // printing the visit summary wants the radiology finding right there.
    const radiologyHTML = summaryRadiology.length > 0 ? [
      '<div class="ic-section-title">Radiology</div>',
      docTemplate.buildTable(
        [{ label: 'Exam' }, { label: 'Status' }],
        summaryRadiology.map((r: any) => ({ cells: [r.body_part ? `${r.exam_name} (${r.body_part})` : r.exam_name, r.status.replace(/_/g, ' ')] }))
      ),
      ...summaryRadiology
        .filter((r: any) => r.status === 'completed')
        .map((r: any) => `
          <div class="ic-section-title">Radiology Report: ${r.exam_name}${r.body_part ? ` (${r.body_part})` : ''} <span>${r.request_number}</span></div>
          <div style="font-size:12px;line-height:1.6;margin-bottom:12px;">${r.report_html || ''}</div>
        `),
    ].join('\n') : '';

    const resultSectionsHTML = (s.tests || []).map((t: any) => {
      const rawResults = summaryResults[t.id] || [];
      if (t.status !== 'approved' || rawResults.length === 0) return '';
      const results = [...rawResults].sort((a: any, b: any) => {
        const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
        return ao - bo;
      });
      const rows = results.map((r: any) => {
        let remark = 'NORMAL', remarkClass = 'remark-normal', remarkIcon = '';
        if (r.reference_range && r.value) {
          const parts = r.reference_range.split('-').map((p: string) => p.trim());
          if (parts.length === 2) {
            const min = parseFloat(parts[0]), max = parseFloat(parts[1]), val = parseFloat(r.value);
            if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
              if (val < min) { remark = 'LOW'; remarkClass = 'remark-low'; remarkIcon = ' ▼'; }
              if (val > max) { remark = 'HIGH'; remarkClass = 'remark-high'; remarkIcon = ' ▲'; }
            }
          }
        }
        return `<tr>
          <td class="bold" style="color:#0F172A">${r.analyte}</td>
          <td class="bold" style="color:${remark === 'HIGH' ? '#dc2626' : remark === 'LOW' ? '#1A7A75' : '#0F172A'}">${r.value || '—'}</td>
          <td class="center" style="color:#64748B">${r.reference_range || '—'}</td>
          <td class="center" style="color:#64748B">${r.unit || '—'}</td>
          <td class="${remarkClass}">${remark}${remarkIcon}</td>
        </tr>`;
      }).join('');
      return `
      <div class="ic-section-title">Results: ${t.test_name}</div>
      <table class="ic-table">
        <thead><tr><th scope="col" style="width:30%">Component</th><th scope="col" style="width:15%">Value</th><th class="center" style="width:25%">Reference Range</th><th class="center" style="width:15%">Units</th><th scope="col" style="width:15%">Remark</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }).join('\n');

    const bodyHTML = [
      docTemplate.buildInfoGrid(
        { title: 'Patient Details', rows: [
          { label: 'Patient Name', value: patientName, bold: true },
          { label: 'Participant ID', value: s.participant_number },
          { label: 'Age / Gender', value: `${age ?? '—'}${s.gender ? ` · ${s.gender}` : ''}` },
        ]},
        { title: 'Visit Details', rows: [
          { label: 'Doctor', value: s.doctor_name ? `Dr. ${s.doctor_name}` : '—' },
          { label: 'Room / Clinic', value: s.room_number || s.clinic_name || '—' },
          { label: 'Visit Time', value: docTemplate.formatDate(new Date(s.created_at)) },
        ]}
      ),
      '<div class="ic-section-title">Vitals</div>',
      vitalsHTML,
      plainNote('Chief Complaints', (v.chief_complaints || []).length > 0 ? v.chief_complaints.join(', ') : ''),
      plainNote('History of Presenting Illness', v.history_of_presenting_illness),
      plainNote('Medical History', v.medical_history),
      plainNote('Surgical History', v.surgical_history),
      plainNote('Family History', v.family_history),
      plainNote('Social History', v.social_history),
      plainNote('Economic History', v.economic_history),
      plainNote('Allergies', v.allergies),
      gynaeHTML,
      generalExamHTML,
      plainNote('General Examination', v.general_examination_notes),
      plainNote('Impressions', v.impressions),
      plainNote('Clinical Notes', getPlainNotes(s.clinical_notes)),
      '<div class="ic-section-title">Tests Ordered</div>',
      testsHTML,
      resultSectionsHTML,
      diagnosesHTML,
      prescriptionsHTML,
      nursingHTML,
      radiologyHTML,
      docTemplate.buildSignatures([
        { label: 'Printed By', name: user?.displayName || '', signature: signature || undefined },
        { label: 'Attending Doctor', name: s.doctor_name ? `Dr. ${s.doctor_name}` : '' },
      ]),
    ].join('\n');

    const html = docTemplate.buildDocument({
      title: 'Visit Summary',
      docType: 'Visit Summary Report',
      docNumber: `VS-${s.order_id.slice(-6).toUpperCase()}`,
      date: new Date(),
      bodyHTML,
      logoUrl: facilityInfo.facilityLogo || `${window.location.origin}/hjd-icon.png`,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });

    docTemplate.openPrintWindow(html);
  };

  const handlePrint = async () => {
    if (!selectedOrder) return;

    const signature = await docTemplate.fetchUserSignature(user?.uid);
    const patientName = `${selectedOrder.first_name} ${selectedOrder.last_name}`.trim();
    const reqDate = new Date(selectedOrder.order_time || selectedOrder.updated_at);
    const requestNo = selectedOrder.order_id.slice(-6).toUpperCase();

    const testSectionsHTML = selectedOrder.specimens.map((s: any) => {
      const results = orderResults[s.id] || [];
      if (results.length === 0) return '';
      
      const rows = results.map(r => {
        let remark = 'NORMAL';
        let remarkClass = 'remark-normal';
        let remarkIcon = '';
        
        if (r.reference_range && r.value) {
          const parts = r.reference_range.split('-').map((p:string) => p.trim());
          if (parts.length === 2) {
            const min = parseFloat(parts[0]);
            const max = parseFloat(parts[1]);
            const val = parseFloat(r.value);
            if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
              if (val < min) { remark = 'LOW'; remarkClass = 'remark-low'; remarkIcon = ' ▼'; }
              if (val > max) { remark = 'HIGH'; remarkClass = 'remark-high'; remarkIcon = ' ▲'; }
            }
          }
        }
        
        return `
        <tr>
          <td class="bold" style="color:#0F172A">${r.analyte}</td>
          <td class="bold" style="color:${remark === 'HIGH' ? '#dc2626' : remark === 'LOW' ? '#1A7A75' : '#0F172A'}">${r.value || '—'}</td>
          <td class="center" style="color:#64748B">${r.reference_range || '—'}</td>
          <td class="center" style="color:#64748B">${r.unit || '—'}</td>
          <td class="${remarkClass}">${remark}${remarkIcon}</td>
        </tr>`;
      }).join('');
      
      return `
      <div class="ic-section-title">Test: ${s.test_name} <span>Barcode: ${s.barcode}</span></div>
      <table class="ic-table">
        <thead><tr>
          <th scope="col" style="width:30%">Component</th><th scope="col" style="width:15%">Value</th><th class="center" style="width:25%">Reference Range</th><th class="center" style="width:15%">Units</th><th scope="col" style="width:15%">Remark</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }).join('\n');

    const bodyHTML = [
      docTemplate.buildInfoGrid(
        { title: 'Patient Details', rows: [
          { label: 'Patient Name', value: patientName, bold: true },
          { label: 'Participant ID', value: selectedOrder.participant_number },
        ]},
        { title: 'Report Details', rows: [
          { label: 'Request No', value: requestNo, bold: true },
          { label: 'Report Date', value: docTemplate.formatDate(new Date()) },
          { label: 'Facility', value: facilityInfo.facilityName },
        ]}
      ),
      testSectionsHTML,
      docTemplate.buildSignatures([
        { label: 'Printed By', name: user?.displayName || '', signature: signature || undefined },
        { label: 'Lab Manager', name: '' }
      ]),
    ].join('\n');

    const html = docTemplate.buildDocument({
      title: 'Laboratory Report',
      docType: 'Laboratory Report',
      docNumber: `LAB-${requestNo}`,
      date: new Date(),
      bodyHTML,
      logoUrl: facilityInfo.facilityLogo || `${window.location.origin}/hjd-icon.png`,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });

    docTemplate.openPrintWindow(html);
  };

  const fetchQueue = async () => {
    try {
      const res = await authFetch('/api/lis/queue', { credentials: 'include' });
      if (res.ok) setQueuedPatients(await res.json());
    } catch (e) {
      console.error('Failed to fetch queue', e);
    }
  };

  // Fetched lazily (only once the dialog is actually opened) rather than on every page
  // load — this whole feature only ever renders for the one tenant it's built for.
  useEffect(() => {
    if (!showQuickRegister) return;
    authFetch(`/api/schemes/active?clinic_id=${user?.clinic || 1}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => setQuickRegisterSchemes(Array.isArray(data) ? data : []))
      .catch(() => setQuickRegisterSchemes([]));
  }, [showQuickRegister, user?.clinic]);

  const quickRegisterSelectedScheme = quickRegisterSchemes.find((s: any) => s.id === quickRegisterForm.scheme_id);
  // Matched by scheme_code (the stable identifier set at creation), not the display
  // name, which an admin could rename later without meaning to change this behavior.
  const quickRegisterIsArmedGroup = quickRegisterSelectedScheme?.scheme_code === 'ARMED-GROUPS';

  const handleQuickRegisterSubmit = async () => {
    const { full_name, age_years, age_months, gender, scheme_id, phone, next_of_kin, army_unit } = quickRegisterForm;

    // Nothing here is mandatory — staff can register with just whatever they
    // know at the moment and fill the rest in later. Only sanitize what was
    // actually given, never block on what wasn't. Months matters as its own
    // field, not just years rounded down to 0 — a 5-month-old baby has to be
    // registrable as exactly that, not silently "0 years old".
    const yearsNum = parseInt(age_years, 10);
    const monthsNum = parseInt(age_months, 10);
    const hasValidYears = Number.isFinite(yearsNum) && yearsNum >= 0 && yearsNum <= 130;
    const hasValidMonths = Number.isFinite(monthsNum) && monthsNum >= 0 && monthsNum <= 11;
    const hasValidAge = hasValidYears || hasValidMonths;

    const trimmedName = full_name.trim();
    const nameParts = trimmedName ? trimmedName.split(/\s+/) : [''];
    const first_name = nameParts[0] || '';
    const last_name = nameParts.length > 1 ? nameParts.slice(1).join(' ') : (nameParts[0] || '');
    // lis_participants only has date_of_birth, not a plain age column — today
    // minus the given years and months is the closest this can get to a real
    // DOB without an exact birth date (day is fixed at the 1st, since that's
    // never known either). The exact years/months given are also kept in
    // demographics so nothing is lost to the day-of-month rounding.
    let date_of_birth: string | null = null;
    if (hasValidAge) {
      const dob = new Date();
      dob.setDate(1);
      dob.setFullYear(dob.getFullYear() - (hasValidYears ? yearsNum : 0));
      dob.setMonth(dob.getMonth() - (hasValidMonths ? monthsNum : 0));
      date_of_birth = dob.toISOString().split('T')[0];
    }

    setQuickRegisterSubmitting(true);
    try {
      const res = await authFetch('/api/lis/participants', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name, last_name, gender: gender || null, date_of_birth,
          phone: phone.trim(),
          doctor_id: user?.id,
          clinic_id: user?.clinic || 1,
          demographics: {
            ...(scheme_id ? { scheme_id, scheme_name: quickRegisterSelectedScheme?.scheme_name || '' } : {}),
            ...(hasValidYears ? { age_years: yearsNum } : {}),
            ...(hasValidMonths ? { age_months: monthsNum } : {}),
            ...(next_of_kin.trim() ? { next_of_kin: next_of_kin.trim() } : {}),
            ...(quickRegisterIsArmedGroup && army_unit.trim() ? { army_or_police_unit: army_unit.trim() } : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || data.error || 'Failed to register patient');
        return;
      }

      // Recording scheme_id in demographics alone never actually enrolls the patient —
      // applySchemePrice (patientBills.js) checks scheme_membership before it'll price
      // anything under a scheme, so without this every bill for this patient would
      // reject with "not priced under this scheme" despite scheme_id being set. Same
      // enrollPatientInScheme call LISRegistration.tsx's own full form makes. Skipped
      // entirely when no scheme was chosen — nothing to enroll into.
      if (scheme_id) {
        try {
          const enrollRes = await authFetch(`/api/schemes/patient-schemes/${data.id}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheme_id, clinic_id: user?.clinic || 1, member_number: null }),
          });
          if (!enrollRes.ok) {
            const enrollErr = await enrollRes.json().catch(() => ({}));
            toast.error(enrollErr.error || 'Registered and queued, but scheme enrollment failed — billing may not price correctly under this scheme.');
          }
        } catch (e) {
          toast.error('Registered and queued, but scheme enrollment failed — billing may not price correctly under this scheme.');
        }
      }

      toast.success(`${trimmedName || 'Patient'} registered and added to your queue.`);
      setShowQuickRegister(false);
      setQuickRegisterForm(EMPTY_QUICK_REGISTER);
      fetchQueue();
    } catch (e) {
      toast.error('Network error registering patient');
    } finally {
      setQuickRegisterSubmitting(false);
    }
  };

  const [callingId, setCallingId] = useState('');
  const handleCallPatient = async (e: React.MouseEvent, orderId: string) => {
    e.stopPropagation();
    if (callingId) return;
    setCallingId(orderId);
    try {
      const res = await authFetch(`/api/lis/queue/${orderId}/call`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        toast.success('Patient called');
        fetchQueue();
      } else {
        toast.error('Failed to call patient');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setCallingId('');
    }
  };

  const fetchLabTests = async () => {
    try {
      const res = await authFetch('/api/lab-tests', { credentials: 'include' });
      if (res.ok) setLabTests(await res.json());
    } catch (e) {
      toast.error('Failed to fetch lab tests');
    }
  };

  // Everything except consultation (billed at queueing), lab/diagnostic services
  // (billed via the lab test picker below), and radiology/examination (its own
  // picker below, see fetchRadiologyExamTypes — the backend pulls both
  // category='Radiology' and category='Examination' into that list) — so
  // nothing is offered twice.
  const fetchServices = async () => {
    try {
      const res = await authFetch('/api/services', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setServices((Array.isArray(data) ? data : []).filter((s: any) =>
          s.isActive !== false && s.is_active !== false &&
          !/consult|diagnos|lab|radiology|examination/i.test(s.category || '')
        ));
      }
    } catch (e) {
      console.error('Failed to fetch services', e);
    }
  };

  const fetchRadiologyExamTypes = async () => {
    try {
      const res = await authFetch('/api/radiology/exam-types', { credentials: 'include' });
      if (res.ok) setRadiologyExamTypes(await res.json());
    } catch (e) {
      console.error('Failed to fetch radiology exam types', e);
    }
  };

  const fetchPatientSchemes = async (patientId: string) => {
    try {
      const res = await authFetch(`/api/schemes/membership/patient/${patientId}`, { credentials: 'include' });
      return res.ok ? await res.json() : [];
    } catch (e) {
      console.error('Failed to fetch patient schemes', e);
      return [];
    }
  };

  // Surfaces whether the patient already has an open bill and under which mode — a bill
  // is always wholly cash or wholly scheme-priced server-side, so the mode picker below
  // is locked to match rather than letting staff pick a mode that'd be silently ignored.
  const fetchPatientActiveBillInfo = async (patientId: string) => {
    try {
      const res = await authFetch(`/api/patient-bills/active/${patientId}/${user?.clinic || 1}`, { credentials: 'include' });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };

  // Runs both lookups together and decides the billing mode from their combined result —
  // doing this separately (each setting billingMode on its own) was a race between "does
  // this patient have exactly one scheme" and "is there already a cash bill open", so an
  // insured patient's order could default to Cash and require a manual click to Scheme
  // every time. An existing bill's mode always wins (a bill is never mixed); with no bill
  // yet, a single unambiguous scheme membership is now selected automatically instead of
  // requiring that click — multiple memberships still need a manual pick, same as today.
  const loadPatientBillingContext = async (patientId: string) => {
    const [schemes, bill] = await Promise.all([
      fetchPatientSchemes(patientId),
      fetchPatientActiveBillInfo(patientId),
    ]);
    setPatientSchemes(schemes);
    setPatientActiveBill(bill);
    if (bill?.scheme_id) {
      setBillingMode('scheme');
      setSelectedSchemeId(bill.scheme_id);
      fetchSchemeCatalog(bill.scheme_id);
    } else if (!bill && schemes.length === 1) {
      setBillingMode('scheme');
      setSelectedSchemeId(schemes[0].scheme_id);
      fetchSchemeCatalog(schemes[0].scheme_id);
    }
  };

  // scheme_service_pricing is keyed to services.id — lab tests (a separate catalog,
  // /api/lab-tests) don't have their own scheme-pricing rows, so a scheme-priced test is
  // matched by name against services here. Names don't always line up 1:1 between the
  // two catalogs (e.g. lab_tests "Liver Function Test (LFT)" vs. services "Liver
  // Profile") — an unmatched test simply won't show in Scheme mode rather than risk
  // showing one at an unconfirmed price.
  const fetchSchemeCatalog = async (schemeId: string) => {
    setLoadingSchemeCatalog(true);
    try {
      const [pricingRes, schemeRes] = await Promise.all([
        authFetch(`/api/schemes/${schemeId}/service-pricing`, { credentials: 'include' }),
        authFetch(`/api/schemes/${schemeId}`, { credentials: 'include' }),
      ]);
      const rows = pricingRes.ok ? await pricingRes.json() : [];
      // The scheme's own currency (set explicitly when the scheme was created) wins over
      // each pricing row's own scheme_currency column — that column defaults to the base
      // currency whenever the Scheme Management pricing form doesn't send one (effectively
      // always), so it can't be trusted on its own — same gap already fixed server-side in
      // applySchemePrice; this keeps what's shown here consistent with what actually bills.
      const schemeCurrency = schemeRes.ok ? (await schemeRes.json())?.currency : null;
      const byName: Record<string, { price: number; currency: string; serviceId: string }> = {};
      const byServiceId: Record<string, { price: number; currency: string; serviceId: string }> = {};
      rows.forEach((r: any) => {
        const entry = { price: parseFloat(r.scheme_price) || 0, currency: schemeCurrency || r.scheme_currency || baseCurrency.code, serviceId: r.service_id };
        const key = (r.service_name || '').toLowerCase().trim();
        if (key) byName[key] = entry;
        if (r.service_id) byServiceId[r.service_id] = entry;
      });
      setSchemePriceByName(byName);
      setSchemePriceByServiceId(byServiceId);
    } catch (e) {
      console.error('Failed to fetch scheme catalog', e);
      setSchemePriceByName({});
      setSchemePriceByServiceId({});
    } finally {
      setLoadingSchemeCatalog(false);
    }
  };

  const handleBillingModeChange = (mode: 'cash' | 'scheme') => {
    setBillingMode(mode);
    if (mode === 'cash') {
      setSelectedSchemeId('');
      setSchemePriceByName({});
    } else if (patientSchemes.length === 1) {
      setSelectedSchemeId(patientSchemes[0].scheme_id);
      fetchSchemeCatalog(patientSchemes[0].scheme_id);
    }
  };

  const handleSchemeChange = (schemeId: string) => {
    setSelectedSchemeId(schemeId);
    if (schemeId) fetchSchemeCatalog(schemeId); else setSchemePriceByName({});
  };

  const fetchChiefComplaints = async () => {
    try {
      const res = await authFetch('/api/chief-complaints', { credentials: 'include' });
      if (res.ok) setChiefComplaints(await res.json());
    } catch (e) {
      console.error('Failed to fetch chief complaints', e);
    }
  };

  const toggleComplaint = (text: string) => {
    setVitals(v => ({
      ...v,
      chief_complaints: v.chief_complaints.includes(text)
        ? v.chief_complaints.filter(c => c !== text)
        : [...v.chief_complaints, text],
    }));
  };

  const removeComplaint = (text: string) => {
    setVitals(v => ({ ...v, chief_complaints: v.chief_complaints.filter(c => c !== text) }));
  };

  const handleAddComplaint = async () => {
    const text = complaintSearch.trim();
    if (!text) return;
    setSavingComplaint(true);
    try {
      const res = await authFetch('/api/chief-complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ complaint_text: text }),
      });
      if (res.ok) {
        const created = await res.json();
        setChiefComplaints(prev => prev.some(c => c.id === created.id) ? prev : [...prev, created].sort((a, b) => a.complaint_text.localeCompare(b.complaint_text)));
        setVitals(v => v.chief_complaints.includes(created.complaint_text) ? v : { ...v, chief_complaints: [...v.chief_complaints, created.complaint_text] });
        setComplaintSearch('');
        toast.success('Complaint added');
      } else {
        toast.error('Failed to add complaint');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSavingComplaint(false);
    }
  };

  // Best-effort: creates (or adds to) the patient's active bill for this branch. Never
  // blocks the clinical workflow if billing fails — mirrors createBillForClinic in
  // LISRegistration.tsx. Deduped per session so re-toggling a test/service on/off/on
  // doesn't create duplicate line items.
  const addBillItem = async (
    dedupeKey: string,
    label: string,
    price: number,
    patient?: { id: string; name: string },
    quantity: number = 1,
    serviceId?: string,
    currency?: string,
    // A ready-made line (drugs: doses + pack equivalent, see drugBillLine).
    prebuiltLine?: any
  ) => {
    const patientId = patient?.id ?? selectedParticipant?.participant_id;
    const patientName = patient?.name ?? (selectedParticipant ? `${selectedParticipant.first_name} ${selectedParticipant.last_name}` : '');
    if (!patientId) return;
    if (billedItemKeys.has(dedupeKey)) return;
    // A price of exactly 0 (a deliberately free drug/service, e.g. under a zero-priced
    // scheme) must still create a bill line — only a genuinely missing/invalid price
    // skips billing. See billOrderItems' identical fix above for why: with no bill line
    // at all, this item can never show as paid/collectible downstream.
    if (price == null || Number.isNaN(price) || price < 0) return;
    setBilledItemKeys(prev => new Set(prev).add(dedupeKey));

    // Chained onto the shared queue so the "does an active bill already
    // exist" check and the create-or-add that follows it never overlap with
    // another in-flight call for the same patient — see billingQueueRef.
    const task = billingQueueRef.current.then(async () => {
      try {
        const lineItem = prebuiltLine
          ? { currency: currency || baseCurrency.code, ...prebuiltLine }
          : { serviceId, serviceName: label, quantity, unitPrice: price, totalPrice: price * quantity, currency: currency || baseCurrency.code };
        const totalPrice = lineItem.totalPrice;
        const branchClinicId = user?.clinic || 1;
        const schemeIdToSend = billingMode === 'scheme' ? selectedSchemeId : undefined;

        const activeQuery = schemeIdToSend ? `?scheme_id=${schemeIdToSend}` : '?mode=cash';
        const forget = () => setBilledItemKeys(prev => { const next = new Set(prev); next.delete(dedupeKey); return next; });
        let result: { ok: boolean; body: any; billNumber?: string };
        const existingBillRes = await authFetch(`/api/patient-bills/active/${patientId}/${branchClinicId}${activeQuery}`, { credentials: 'include' });
        if (existingBillRes.ok) {
          const existingBill = await existingBillRes.json();
          const addRes = await authFetch(`/api/patient-bills/${existingBill.id}/add-services`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ services: [lineItem] }),
          });
          result = { ok: addRes.ok, body: await addRes.json().catch(() => ({})), billNumber: existingBill.bill_number };
        } else {
          const billNumber = `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
          const billRes = await authFetch('/api/patient-bills', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              bill_number: billNumber, patient_id: patientId, patient_name: patientName,
              clinic_id: parseInt(String(branchClinicId)), total_amount: totalPrice, paid_amount: 0,
              balance_amount: totalPrice, status: 'pending', bill_date: new Date().toISOString(),
              due_date: null, services: [lineItem],
              notes: 'Auto-generated from LIS order', created_by: user?.displayName || 'System',
              scheme_id: schemeIdToSend,
            }),
          });
          result = { ok: billRes.ok, body: await billRes.json().catch(() => ({})), billNumber };
        }
        if (result.ok) {
          toast.success(`${label} added to bill ${result.body?.bill_number || result.billNumber}`);
        } else {
          // Not priced under the scheme: offer the cash price on the cash bill.
          const handled = await offerCashBilling({
            body: result.body, lines: [lineItem], confirm, patientId, patientName, clinicId: branchClinicId,
            createdBy: user?.displayName, notes: 'Auto-generated from LIS order',
          });
          if (handled === null) toast.error(`Failed to bill "${label}": ${result.body?.error || 'unknown error'}`);
          if (!handled?.billed) forget();
        }
      } catch (e) {
        console.error('Error adding bill item', e);
      }
    });
    billingQueueRef.current = task;
    await task;
  };

  // Selecting/deselecting a test or service is local-only now — no bill is
  // touched until Submit Order actually creates the visit. Toggling used to
  // fire a bill create-or-add-item call per click, which both hit the API
  // for selections that might never be submitted and raced when several
  // items were toggled in quick succession (see billOrderItems).
  const toggleService = (service: any) => {
    const isSelected = selectedServiceIds.includes(service.id);
    setSelectedServiceIds(prev => isSelected ? prev.filter(id => id !== service.id) : [...prev, service.id]);
  };

  const toggleRadiology = (exam: any) => {
    const isSelected = selectedRadiologyIds.includes(exam.id);
    setSelectedRadiologyIds(prev => isSelected ? prev.filter(id => id !== exam.id) : [...prev, exam.id]);
    if (isSelected) setRadiologyBodyParts(({ [exam.id]: _, ...rest }) => rest);
  };

  // Bills every selected test + service in ONE combined add-services (or
  // create-bill) call, run once from handleOrder right after the order
  // itself is created. Best-effort — a billing failure here is logged and
  // toasted but never rolls back the order that was already created.
  const billOrderItems = async (patientId: string, patientName: string, tests: any[], serviceIds: string[]) => {
    const branchClinicId = user?.clinic || 1;
    const schemeIdToSend = billingMode === 'scheme' ? selectedSchemeId : undefined;

    const testLines = tests.map(t => {
      const unitPrice = parseFloat(t.price) || 0;
      return { serviceId: t.scheme_service_id, serviceName: t.test_name, quantity: 1, unitPrice, totalPrice: unitPrice, currency: t.currency || baseCurrency.code };
    });
    const serviceLines = serviceIds.map(id => visibleServices.find(s => s.id === id)).filter(Boolean).map((s: any) => {
      const unitPrice = parseFloat(s.price) || 0;
      return { serviceId: s.id, serviceName: s.service_name || s.name, quantity: 1, unitPrice, totalPrice: unitPrice, currency: s.currency || baseCurrency.code };
    });
    // A test/service priced at exactly 0 (deliberately free — e.g. dpoc's zero-priced
    // schemes) used to get filtered out here entirely, so no bill line was ever created
    // for it. Without a matching patient_bills.services[] entry, getCollectiblePool() /
    // markCollectible() in lisModule.js can never find it, so item_paid stayed false
    // forever — the specimen was permanently stuck on "Payment Required" for a test that
    // should have needed no payment at all. unitPrice is already a real, valid number
    // here (parseFloat(...) || 0 above), never undefined/NaN, so every line is billable.
    const lineItems = [...testLines, ...serviceLines];
    if (lineItems.length === 0) return;

    // The bill for this billing mode: the scheme's bill, or the cash bill.
    const activeQuery = schemeIdToSend ? `?scheme_id=${schemeIdToSend}` : '?mode=cash';
    const send = async (lines: any[]): Promise<{ ok: boolean; body: any; billNumber?: string }> => {
      const existingBillRes = await authFetch(`/api/patient-bills/active/${patientId}/${branchClinicId}${activeQuery}`, { credentials: 'include' });
      if (existingBillRes.ok) {
        const existingBill = await existingBillRes.json();
        const addRes = await authFetch(`/api/patient-bills/${existingBill.id}/add-services`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ services: lines }),
        });
        return { ok: addRes.ok, body: await addRes.json().catch(() => ({})), billNumber: existingBill.bill_number };
      }
      const totalPrice = lines.reduce((sum, l) => sum + l.totalPrice, 0);
      const billNumber = `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
      const billRes = await authFetch('/api/patient-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bill_number: billNumber, patient_id: patientId, patient_name: patientName,
          clinic_id: parseInt(String(branchClinicId)), total_amount: totalPrice, paid_amount: 0,
          balance_amount: totalPrice, status: 'pending', bill_date: new Date().toISOString(),
          due_date: null, services: lines,
          notes: 'Auto-generated from LIS order', created_by: user?.displayName || 'System',
          scheme_id: schemeIdToSend,
        }),
      });
      return { ok: billRes.ok, body: await billRes.json().catch(() => ({})), billNumber };
    };

    try {
      const r = await send(lineItems);
      if (r.ok) {
        toast.success(`${lineItems.length} item(s) added to bill ${r.body?.bill_number || r.billNumber}`);
        return;
      }
      // Items the scheme doesn't price: offer to bill them at the cash price on the cash bill.
      const handled = await offerCashBilling({
        body: r.body, lines: lineItems, confirm, patientId, patientName, clinicId: branchClinicId,
        createdBy: user?.displayName, notes: 'Auto-generated from LIS order',
        retryCovered: async (covered) => {
          const r2 = await send(covered);
          if (r2.ok) toast.success(`${covered.length} item(s) added to bill ${r2.body?.bill_number || r2.billNumber}`);
          else toast.error(`Billing the covered items failed: ${r2.body?.error || 'unknown error'}`);
          return r2.ok;
        },
      });
      if (handled === null) toast.error(`Order created, but billing failed: ${r.body?.error || 'unknown error'}`);
    } catch (e) {
      console.error('Error billing order items', e);
      toast.error('Order created, but billing failed due to a network error');
    }
  };

  const handleOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingOrderRef.current) return;
    if (!orderForm.participant_id) return toast.error('Select a participant');
    // No test-count requirement — a doctor can save vitals/notes (and now a
    // prescription, see handleSubmitPrescription) as a visit on their own,
    // with no lab test ordered at all.

    const formattedTests = selectedTests.map(t => ({
      code: t.test_code,
      name: t.test_name,
      department: t.category
    }));

    submittingOrderRef.current = true;
    setSubmittingOrder(true);
    try {
      const res = await authFetch('/api/lis/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          participant_id: orderForm.participant_id,
          order_id: orderForm.order_id,
          clinical_notes: orderForm.clinical_notes,
          vitals,
          doctor_id: user?.id,
          tests: formattedTests
        })
      });
      if (res.ok) {
        const body = await res.json();
        const skippedNames: string[] = body.skipped_duplicates || [];
        if (skippedNames.length > 0) {
          toast.warning(`${skippedNames.join(', ')} already pending collection for this visit — not re-ordered or re-billed.`);
        }
        toast.success('Order created successfully!');

        // Don't bill (or double-count) a test the backend just told us it skipped as an
        // already-pending duplicate for this visit — only bill what was actually ordered.
        const testsToBill = selectedTests.filter(t => !skippedNames.includes(t.test_name));
        const patientName = selectedParticipant ? `${selectedParticipant.first_name} ${selectedParticipant.last_name}` : '';
        await billOrderItems(orderForm.participant_id, patientName, testsToBill, selectedServiceIds);

        // Radiology requests are created (not billed — see the state comment
        // near selectedRadiologyIds) so the exam shows up in the /radiology
        // queue immediately. Best-effort: a failure here is toasted but never
        // rolls back the order/tests/services that were already saved above.
        if (selectedRadiologyIds.length > 0) {
          const radiologyItems = selectedRadiologyIds
            .map(id => radiologyExamTypes.find((e: any) => e.id === id))
            .filter(Boolean)
            .map((exam: any) => ({ service_id: exam.id, exam_name: exam.name, body_part: radiologyBodyParts[exam.id] || null }));
          try {
            const radRes = await authFetch('/api/radiology/requests', {
              method: 'POST',
              body: JSON.stringify({ participant_id: orderForm.participant_id, order_id: body.order_id, doctor_id: user?.id, items: radiologyItems }),
            });
            if (!radRes.ok) {
              const radErr = await radRes.json().catch(() => ({}));
              toast.error(radErr.error || 'Order saved, but the radiology request failed');
            }
          } catch {
            toast.error('Order saved, but the radiology request failed (network error)');
          }
        }

        setOrderForm({ participant_id: '', order_id: '', clinical_notes: '' });
        setVitals(EMPTY_VITALS);
        setTriagedByName(null);
        setTriagedAt(null);
        setSelectedTests([]);
        setSelectedServiceIds([]);
        setSelectedRadiologyIds([]);
        setRadiologyBodyParts({});
        setBilledItemKeys(new Set());
        setMiddleStep(1);
        setBillingMode('cash');
        setSelectedSchemeId('');
        setSchemePriceByName({});
        setPatientSchemes([]);
        setPatientActiveBill(null);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create order');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      submittingOrderRef.current = false;
      setSubmittingOrder(false);
    }
  };

  const toggleTest = (test: any) => {
    const isSelected = selectedTests.some(t => t.test_code === test.test_code);
    // A test whose linked reagent/kit has run out can't be deselected into
    // existence by a direct call either — only selecting back OUT is allowed.
    if (!isSelected && test.is_available === false) {
      toast.error(`${test.test_name} is unavailable — its linked reagent/kit is out of stock.`);
      return;
    }
    setSelectedTests(isSelected ? selectedTests.filter(t => t.test_code !== test.test_code) : [...selectedTests, test]);
  };

  // Latest-queued patient first — the backend returns oldest-first (FIFO, correct for the
  // public /lis/queue waiting-room display), so re-sort just for this list.
  const filteredQueue = queuedPatients
    .filter(p =>
      p.participant_number?.toLowerCase().includes(searchPart.toLowerCase()) ||
      p.first_name?.toLowerCase().includes(searchPart.toLowerCase()) ||
      p.last_name?.toLowerCase().includes(searchPart.toLowerCase())
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // In Scheme mode, only tests/services this scheme actually has a price for are
  // offered — priced at the scheme's rate, not the cash catalog rate — so staff can't
  // select something not covered by construction, rather than finding out after billing.
  // A lab test's own service_id link (when set) is matched first — it's exact — before
  // falling back to a name match, which misses tests named differently across the two
  // catalogs (e.g. lab_tests "Liver Function Test (LFT)" vs. services "Liver Profile").
  // A plain services-catalog row IS the row scheme pricing references (t.id), while a lab
  // test links to one via its own t.service_id — check whichever applies, then fall back to
  // name matching.
  const schemePricingFor = (t: any) => (t.service_id && schemePriceByServiceId[t.service_id])
    || schemePriceByServiceId[t.id]
    || schemePriceByName[(t.test_name || t.service_name || t.name || '').toLowerCase().trim()];
  const visibleLabTests = billingMode === 'scheme'
    ? labTests
        .filter(t => schemePricingFor(t))
        .map(t => {
          const sp = schemePricingFor(t);
          return { ...t, price: sp.price, currency: sp.currency, scheme_service_id: sp.serviceId };
        })
    : labTests;

  const visibleServices = billingMode === 'scheme'
    ? services
        .filter(s => schemePricingFor(s))
        .map(s => {
          const sp = schemePricingFor(s);
          return { ...s, price: sp.price, currency: sp.currency, scheme_service_id: sp.serviceId };
        })
    : services;

  const filteredTests = visibleLabTests.filter(t =>
    t.test_name?.toLowerCase().includes(searchTest.toLowerCase()) ||
    t.test_code?.toLowerCase().includes(searchTest.toLowerCase()) ||
    t.category?.toLowerCase().includes(searchTest.toLowerCase())
  );

  // Group tests by category
  const categorizedTests = filteredTests.reduce((acc, test) => {
    const cat = test.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(test);
    return acc;
  }, {} as Record<string, any[]>);

  const filteredServices = visibleServices.filter(s =>
    (s.service_name || s.name || '').toLowerCase().includes(searchTest.toLowerCase())
  );

  const selectedParticipant = queuedPatients.find(p => p.participant_id === orderForm.participant_id);

  const selectedServiceObjs = selectedServiceIds.map(id => visibleServices.find((s: any) => s.id === id)).filter(Boolean) as any[];
  const orderCurrency = selectedTests[0]?.currency || selectedServiceObjs[0]?.currency || baseCurrency.code;
  const orderTotal = [...selectedTests, ...selectedServiceObjs].reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);

  // Combined test+service picker for "Request Another Service" in Visit Summary — plain
  // cash catalog price (this add-on flow has no scheme-mode context of its own to price
  // against, unlike the main order form).
  const reqServiceOptions = reqServiceMode === 'radiology'
    ? radiologyExamTypes
        .filter((e: any) => (e.name || '').toLowerCase().includes(reqServiceQuery.toLowerCase()))
        .map((e: any) => ({ key: `rad-${e.id}`, type: 'radiology' as const, examId: e.id, name: e.name, price: parseFloat(e.price) || 0, currency: baseCurrency.code }))
    : [
        ...labTests
          .filter((t: any) => t.test_name?.toLowerCase().includes(reqServiceQuery.toLowerCase()) || t.test_code?.toLowerCase().includes(reqServiceQuery.toLowerCase()))
          .map((t: any) => ({ key: `test-${t.id}`, type: 'test' as const, code: t.test_code, name: t.test_name, department: t.category, price: parseFloat(t.price) || 0, currency: t.currency || baseCurrency.code, is_available: t.is_available !== false })),
        ...services
          .filter((s: any) => (s.service_name || s.name || '').toLowerCase().includes(reqServiceQuery.toLowerCase()))
          .map((s: any) => ({ key: `svc-${s.id}`, type: 'service' as const, serviceId: s.id, name: s.service_name || s.name, price: parseFloat(s.price) || 0, currency: s.currency || baseCurrency.code })),
      ];

  // Searching a patient shows their full visit history across all fetched dates; otherwise
  // it's the selected date range. created_at is UTC, so day-matching goes through a local
  // Date conversion (not a raw string compare) so visits from the first few hours of the
  // local day aren't misfiled under "yesterday".
  const visitSummaries = patientSearch.trim()
    ? allVisitSummaries.filter(s => {
        const q = patientSearch.toLowerCase();
        return `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
          s.participant_number?.toLowerCase().includes(q) ||
          s.phone?.toLowerCase().includes(q);
      })
    : allVisitSummaries.filter(s => {
        const d = toLocalDateStr(new Date(s.created_at));
        return (!summaryDateFrom || d >= summaryDateFrom) && (!summaryDateTo || d <= summaryDateTo);
      });

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="w-full h-[calc(100vh-64px)] flex flex-col">
        <div className="flex justify-between items-start">
          <PageHeader
            title={activeMode === 'order' ? "Test Orders" : activeMode === 'results' ? "Lab Results" : "Visit Summary"}
            icon={<TestTube2 />}
          />

          <div className="flex items-center gap-3">
          {user?.tenantCode === QUICK_REGISTER_TENANT && (
            <Button variant="outline" size="sm" onClick={() => setShowQuickRegister(true)} className="gap-2">
              <UserPlus className="w-4 h-4" /> Register New Patient
            </Button>
          )}
          <div className="flex bg-muted p-1 rounded-lg">
            <button
              onClick={() => navigate('/lis/orders')}
              className={cn("px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2", activeMode === 'order' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <ClipboardList className="w-4 h-4" /> Place Order
            </button>
            <button
              onClick={() => navigate('/lis/orders/summary')}
              className={cn("px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2", activeMode === 'summary' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <History className="w-4 h-4" /> Visit Summary
            </button>
          </div>
          </div>
        </div>

        {activeMode === 'order' ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mt-6 flex-1 min-h-0">
          
          {/* LEFT: Participant Selection */}
          <div className="md:col-span-3 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30">
              <h3 className="font-medium mb-3">1. Select Patient</h3>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input 
                  placeholder="Search Participant..." 
                  className="pl-8 h-9" 
                  value={searchPart}
                  onChange={(e) => setSearchPart(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-2">
              {filteredQueue.map(p => {
                const isSelected = orderForm.participant_id === p.participant_id;
                const waitTimeMin = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 60000);
                return (
                <div
                  key={p.order_id}
                  onClick={() => {
                    if (p.participant_id !== orderForm.participant_id) {
                      // Switching participants without submitting used to leave the
                      // previous patient's selected tests/vitals in place — clicking
                      // Patient B here could carry Patient A's clinical selections
                      // straight into Patient B's order. Reset everything selection-
                      // related, not just services, on every participant switch.
                      setSelectedServiceIds([]);
                      setSelectedTests([]);
                      setBilledItemKeys(new Set());
                      // A nurse may have already triaged this patient (vitals recorded on
                      // this same queue row before the doctor opened it) — merge that in
                      // instead of always starting blank, so it isn't silently overwritten
                      // on submit. Falls back to blank exactly as before when nothing was
                      // triaged.
                      const hasTriageVitals = p.vitals && Object.entries(p.vitals).some(([k, v]) => k !== 'fasting_status' && v !== '' && v != null);
                      setVitals(hasTriageVitals ? { ...EMPTY_VITALS, ...p.vitals } : EMPTY_VITALS);
                      setTriagedByName(hasTriageVitals ? (p.triaged_by_name || null) : null);
                      setTriagedAt(hasTriageVitals ? (p.triaged_at || null) : null);
                      setBillingMode('cash');
                      setSelectedSchemeId('');
                      setSchemePriceByName({});
                      setPatientSchemes([]);
                      setPatientActiveBill(null);
                      loadPatientBillingContext(p.participant_id);
                    }
                    setOrderForm({ participant_id: p.participant_id, order_id: p.order_id, clinical_notes: '' });
                  }}
                  className={cn(
                    "w-full text-left p-3 rounded-md transition-colors border text-sm cursor-pointer relative",
                    isSelected 
                      ? "bg-primary/10 border-primary text-primary" 
                      : "bg-card hover:bg-muted border-border"
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-medium font-mono">{p.participant_number}</div>
                    <div className="text-xs font-semibold text-muted-foreground whitespace-nowrap">{waitTimeMin} min</div>
                  </div>
                  <div className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
                    {p.first_name} {p.last_name} • {p.gender}
                    {p.appointment_id && (
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 whitespace-nowrap" title={p.appointment_reason || 'Follow-up appointment'}>
                        Follow-up
                      </span>
                    )}
                  </div>
                  {p.appointment_id && p.appointment_reason && (
                    <div className="text-xs text-violet-700 mt-0.5 truncate">{p.appointment_reason}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1 flex justify-between items-center">
                    <span>{p.doctor_name ? `Dr. ${p.doctor_name}` : 'General Queue'}</span>
                    <Button 
                      size="sm" 
                      variant={p.status === 'called' ? 'secondary' : 'outline'} 
                      className="h-6 text-xs px-2"
                      onClick={(e) => handleCallPatient(e, p.order_id)}
                      disabled={callingId === p.order_id}
                    >
                      {p.status === 'called' ? 'Called' : 'Call'}
                    </Button>
                  </div>
                </div>
              )})}
              {filteredQueue.length === 0 && (
                <div className="p-4 text-center text-muted-foreground text-sm border border-dashed rounded-md">
                  Queue is empty
                </div>
              )}
            </div>
          </div>

          {/* MIDDLE: Vitals & Test Selection (Multi-step) */}
          <div className="md:col-span-6 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex justify-between items-center h-16">
              <h3 className="font-medium flex items-center gap-2">
                {middleStep === 1 ? (
                  <><Activity className="w-4 h-4 text-primary" /> 2. Record Vitals</>
                ) : (
                  <><FlaskConical className="w-4 h-4 text-primary" /> 3. Select Services</>
                )}
              </h3>
              {middleStep === 1 && triagedByName && (
                <span className="text-xs text-success bg-success-bg border border-success-border px-2 py-1 rounded-full whitespace-nowrap">
                  Triaged by {triagedByName}{triagedAt ? ` · ${new Date(triagedAt).toLocaleTimeString()}` : ''}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-auto p-4">
              {middleStep === 1 ? (
                <div className="space-y-4 w-full mt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Blood Pressure (mmHg)</label>
                      <Input placeholder="e.g. 120/80" value={vitals.blood_pressure} onChange={e => setVitals({...vitals, blood_pressure: e.target.value})} className="mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Pulse (bpm)</label>
                      <Input placeholder="e.g. 75" type="number" value={vitals.pulse} onChange={e => setVitals({...vitals, pulse: e.target.value})} className="mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Temperature (°C)</label>
                      <Input placeholder="e.g. 37.2" type="number" step="0.1" value={vitals.temperature} onChange={e => setVitals({...vitals, temperature: e.target.value})} className="mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Resp. Rate (bpm)</label>
                      <Input placeholder="e.g. 16" type="number" value={vitals.respiratory_rate} onChange={e => setVitals({...vitals, respiratory_rate: e.target.value})} className="mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Weight (kg)</label>
                      <Input placeholder="e.g. 70.5" type="number" step="0.1" value={vitals.weight} onChange={e => setVitals({...vitals, weight: e.target.value})} className="mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Height (cm)</label>
                      <Input placeholder="e.g. 175" type="number" step="0.1" value={vitals.height} onChange={e => setVitals({...vitals, height: e.target.value})} className="mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">SpO2 (%)</label>
                      <Input placeholder="e.g. 98" type="number" value={vitals.spo2} onChange={e => setVitals({...vitals, spo2: e.target.value})} className="mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Fasting Status</label>
                      <Combobox
                        options={[{ value: 'No', label: 'No (Non-Fasting)' }, { value: 'Yes', label: 'Yes (Fasting)' }]}
                        value={vitals.fasting_status}
                        onChange={v => setVitals({...vitals, fasting_status: v})}
                        searchPlaceholder="Search..."
                        className="mt-1 h-9"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Chief Complaint / Notes</label>
                    <Popover open={complaintPopoverOpen} onOpenChange={setComplaintPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          className="mt-1 w-full justify-between font-normal h-auto min-h-9 py-2 text-left"
                        >
                          <span className="text-muted-foreground">
                            {vitals.chief_complaints.length > 0 ? `${vitals.chief_complaints.length} selected` : 'Select or add complaints...'}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Search complaints..."
                            value={complaintSearch}
                            onValueChange={setComplaintSearch}
                          />
                          <CommandList>
                            <CommandEmpty className="p-0">
                              {complaintSearch.trim() && (
                                <button
                                  type="button"
                                  onClick={handleAddComplaint}
                                  disabled={savingComplaint}
                                  className="w-full flex items-center gap-2 px-2 py-2 text-sm hover:bg-muted/50 text-left"
                                >
                                  <Plus className="w-3.5 h-3.5" /> Add "{complaintSearch.trim()}"
                                </button>
                              )}
                            </CommandEmpty>
                            <CommandGroup className="max-h-64 overflow-auto">
                              {chiefComplaints
                                .filter(c => c.complaint_text.toLowerCase().includes(complaintSearch.toLowerCase()))
                                .map(c => {
                                  const isSelected = vitals.chief_complaints.includes(c.complaint_text);
                                  return (
                                    <CommandItem key={c.id} value={c.complaint_text} onSelect={() => toggleComplaint(c.complaint_text)}>
                                      <Check className={cn('mr-2 h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')} />
                                      {c.complaint_text}
                                    </CommandItem>
                                  );
                                })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {vitals.chief_complaints.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {vitals.chief_complaints.map(text => (
                          <span key={text} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                            {text}
                            <button type="button" onClick={() => removeComplaint(text)} className="hover:bg-primary/20 rounded-full p-0.5">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">History of Presenting Illness</label>
                    <Textarea
                      placeholder="Enter history of presenting illness"
                      className="resize-none mt-1"
                      rows={2}
                      value={vitals.history_of_presenting_illness}
                      onChange={e => setVitals({ ...vitals, history_of_presenting_illness: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Medical History</label>
                      <Textarea
                        placeholder="Enter medical history"
                        className="resize-none mt-1"
                        rows={2}
                        value={vitals.medical_history}
                        onChange={e => setVitals({ ...vitals, medical_history: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Surgical History</label>
                      <Textarea
                        placeholder="Enter surgical history"
                        className="resize-none mt-1"
                        rows={2}
                        value={vitals.surgical_history}
                        onChange={e => setVitals({ ...vitals, surgical_history: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Family History</label>
                      <Textarea
                        placeholder="Enter family history"
                        className="resize-none mt-1"
                        rows={2}
                        value={vitals.family_history}
                        onChange={e => setVitals({ ...vitals, family_history: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Social History</label>
                      <Textarea
                        placeholder="Enter social history"
                        className="resize-none mt-1"
                        rows={2}
                        value={vitals.social_history}
                        onChange={e => setVitals({ ...vitals, social_history: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Economic History</label>
                      <Textarea
                        placeholder="Enter economic history"
                        className="resize-none mt-1"
                        rows={2}
                        value={vitals.economic_history}
                        onChange={e => setVitals({ ...vitals, economic_history: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Allergies</label>
                      <Textarea
                        placeholder="Enter allergy"
                        className="resize-none mt-1"
                        rows={2}
                        value={vitals.allergies}
                        onChange={e => setVitals({ ...vitals, allergies: e.target.value })}
                      />
                    </div>
                  </div>

                  {selectedParticipant?.gender?.toLowerCase() === 'female' && (
                    <GynaeFields value={vitals.gynae} onChange={(gynae) => setVitals({ ...vitals, gynae })} />
                  )}

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">General Examination</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                      {GENERAL_EXAM_FIELDS.map(({ key, label, icon: Icon }) => (
                        <div key={key}>
                          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5" /> {label}
                          </label>
                          <Textarea
                            placeholder={`Enter ${label.toLowerCase()} findings`}
                            className="resize-none mt-1"
                            rows={2}
                            value={vitals.general_examination[key]}
                            onChange={e => setVitals({
                              ...vitals,
                              general_examination: { ...vitals.general_examination, [key]: e.target.value },
                            })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">General Examination</label>
                      <Textarea
                        placeholder="Enter general examination findings..."
                        className="resize-none mt-1"
                        rows={2}
                        value={vitals.general_examination_notes}
                        onChange={e => setVitals({ ...vitals, general_examination_notes: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Impressions</label>
                      <Textarea
                        placeholder="Enter your impression..."
                        className="resize-none mt-1"
                        rows={2}
                        value={vitals.impressions}
                        onChange={e => setVitals({ ...vitals, impressions: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="sticky bottom-0 -mx-4 -mb-4 px-4 pb-4 pt-4 flex justify-end border-t mt-4 bg-background">
                    <Button onClick={() => setMiddleStep(2)} className="w-full sm:w-auto">
                      Next: Select Tests <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-4 flex items-center">
                    <Button variant="ghost" size="sm" onClick={() => setMiddleStep(1)} className="text-muted-foreground hover:text-foreground">
                      <ArrowLeft className="w-4 h-4 mr-2" /> Back to Vitals
                    </Button>
                  </div>

                  <div className="mb-5 p-3 rounded-lg border bg-card">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Billing Mode</p>
                    {patientActiveBill ? (
                      <div className="text-xs text-info bg-info-bg border border-info-border rounded-md px-2.5 py-1.5">
                        This patient has an open {patientActiveBill.scheme_id ? `scheme (${patientActiveBill.scheme_name})` : 'cash'} bill ({patientActiveBill.bill_number}) — new items are added to it under that same mode.
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2 max-w-xs">
                          <button
                            type="button"
                            onClick={() => handleBillingModeChange('cash')}
                            className={cn("h-8 rounded-md border text-sm font-medium transition-colors", billingMode === 'cash' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50")}
                          >
                            Cash
                          </button>
                          <button
                            type="button"
                            onClick={() => patientSchemes.length > 0 && handleBillingModeChange('scheme')}
                            disabled={patientSchemes.length === 0}
                            title={patientSchemes.length === 0 ? 'This patient has no active scheme membership' : undefined}
                            className={cn(
                              "h-8 rounded-md border text-sm font-medium transition-colors",
                              billingMode === 'scheme' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50",
                              patientSchemes.length === 0 && "opacity-40 cursor-not-allowed"
                            )}
                          >
                            Scheme
                          </button>
                        </div>
                        {patientSchemes.length === 0 && (
                          <p className="text-xs text-muted-foreground mt-1.5">No active scheme membership — cash prices only.</p>
                        )}
                        {billingMode === 'scheme' && patientSchemes.length > 1 && (
                          <Combobox
                            options={[{ value: '', label: 'Select scheme...' }, ...patientSchemes.map((s: any) => ({ value: s.scheme_id, label: s.scheme_name }))]}
                            value={selectedSchemeId}
                            onChange={v => handleSchemeChange(v)}
                            placeholder="Select scheme..."
                            searchPlaceholder="Search schemes..."
                            className="mt-2 max-w-xs h-8 text-sm"
                          />
                        )}
                        {billingMode === 'scheme' && selectedSchemeId && (
                          <p className="text-xs text-muted-foreground mt-1.5">
                            {loadingSchemeCatalog ? 'Loading scheme price list...' : `Only tests/services priced under this scheme are shown below (${Object.keys(schemePriceByName).length} priced items).`}
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Tests &amp; Services</label>
                    <Popover open={testPopoverOpen} onOpenChange={setTestPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          className="mt-1 w-full justify-between font-normal h-auto min-h-9 py-2 text-left"
                        >
                          <span className="text-muted-foreground">
                            {selectedTests.length + selectedServiceIds.length > 0
                              ? `${selectedTests.length + selectedServiceIds.length} selected`
                              : 'Search and select tests/services...'}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Search tests or services..."
                            value={searchTest}
                            onValueChange={setSearchTest}
                          />
                          <CommandList className="max-h-72">
                            <CommandEmpty>No matching tests or services.</CommandEmpty>
                            {Object.entries(categorizedTests).map(([category, tests]: [string, any[]]) => (
                              <CommandGroup key={category} heading={category}>
                                {tests.map(test => {
                                  const isSelected = selectedTests.some(t => t.test_code === test.test_code);
                                  const isUnavailable = test.is_available === false;
                                  return (
                                    <CommandItem
                                      key={test.id} value={test.test_name} onSelect={() => toggleTest(test)}
                                      disabled={isUnavailable && !isSelected}
                                      className={cn('group', isUnavailable && !isSelected && 'opacity-50 cursor-not-allowed')}
                                    >
                                      <Check className={cn('mr-2 h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                                      <div className="flex items-center justify-between gap-2 min-w-0 flex-1">
                                        <span className="truncate">{test.test_name}</span>
                                        {isUnavailable ? (
                                          <span className="text-xs text-destructive font-medium shrink-0">Out of stock</span>
                                        ) : (
                                          <span className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground font-mono shrink-0">
                                            {parseFloat(test.price || 0).toFixed(2)} {test.currency || baseCurrency.code}
                                          </span>
                                        )}
                                      </div>
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            ))}
                            {filteredServices.length > 0 && (
                              <CommandGroup heading="Services">
                                {filteredServices.map(service => {
                                  const isSelected = selectedServiceIds.includes(service.id);
                                  return (
                                    <CommandItem key={service.id} value={service.service_name || service.name} onSelect={() => toggleService(service)} className="group">
                                      <Check className={cn('mr-2 h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                                      <div className="flex items-center justify-between gap-2 min-w-0 flex-1">
                                        <span className="truncate">{service.service_name || service.name}</span>
                                        <span className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground font-mono shrink-0">
                                          {parseFloat(service.price || 0).toFixed(2)} {service.currency || baseCurrency.code}
                                        </span>
                                      </div>
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            )}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {(selectedTests.length > 0 || selectedServiceIds.length > 0) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {selectedTests.map(test => (
                          <span key={test.test_code} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                            {test.test_name}
                            <button type="button" onClick={() => toggleTest(test)} className="hover:bg-primary/20 rounded-full p-0.5">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                        {selectedServiceIds.map(id => {
                          const service = visibleServices.find((s: any) => s.id === id);
                          if (!service) return null;
                          return (
                            <span key={id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                              {service.service_name || service.name}
                              <button type="button" onClick={() => toggleService(service)} className="hover:bg-primary/20 rounded-full p-0.5">
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Radiology — kept as its own picker rather than a 3rd group folded
                      into "Tests & Services" above, so that combined picker needed no
                      change to add this. */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Radiology</label>
                    <Popover open={radiologyPopoverOpen} onOpenChange={setRadiologyPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          className="mt-1 w-full justify-between font-normal h-auto min-h-9 py-2 text-left"
                        >
                          <span className="text-muted-foreground">
                            {selectedRadiologyIds.length > 0 ? `${selectedRadiologyIds.length} selected` : 'Search and select an exam...'}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Search X-Ray, Ultrasound..."
                            value={searchRadiology}
                            onValueChange={setSearchRadiology}
                          />
                          <CommandList className="max-h-72">
                            <CommandEmpty>No matching exams.</CommandEmpty>
                            <CommandGroup>
                              {radiologyExamTypes
                                .filter((exam: any) => exam.name?.toLowerCase().includes(searchRadiology.toLowerCase()))
                                .map((exam: any) => {
                                  const isSelected = selectedRadiologyIds.includes(exam.id);
                                  return (
                                    <CommandItem key={exam.id} value={exam.name} onSelect={() => toggleRadiology(exam)}>
                                      <Check className={cn('mr-2 h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                                      <span className="truncate">{exam.name}</span>
                                    </CommandItem>
                                  );
                                })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {selectedRadiologyIds.length > 0 && (
                      <div className="space-y-2 mt-2">
                        {selectedRadiologyIds.map(id => {
                          const exam = radiologyExamTypes.find((e: any) => e.id === id);
                          if (!exam) return null;
                          return (
                            <div key={id} className="rounded-md border p-2.5 space-y-2 bg-card">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-primary truncate">{exam.name}</span>
                                <button type="button" onClick={() => toggleRadiology(exam)} className="hover:bg-muted rounded-full p-0.5 shrink-0" aria-label={`Remove ${exam.name}`}>
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <RadiologyBodyPartPicker
                                examName={exam.name}
                                value={radiologyBodyParts[id] || ''}
                                onChange={part => setRadiologyBodyParts(prev => ({ ...prev, [id]: part }))}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Order Summary */}
          <div className="md:col-span-3 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30">
              <h3 className="font-medium">4. Order Summary</h3>
            </div>
            <div className="flex-1 overflow-auto p-4 flex flex-col">
              
              <div className="mb-6">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Selected Participant</h4>
                {selectedParticipant ? (
                  <div className="p-3 bg-muted/50 rounded-md border text-sm">
                    <div className="font-mono font-medium text-primary mb-1">{selectedParticipant.participant_number}</div>
                    <div>{selectedParticipant.first_name} {selectedParticipant.last_name}</div>
                    <div className="text-muted-foreground text-xs mt-1">Study: {selectedParticipant.study_ref || 'None'}</div>
                    {hasPrivilege('referrals.write') && (
                      <Button variant="outline" size="sm" className="w-full mt-2" onClick={openReferDialog}>
                        <ArrowLeftRight className="w-3.5 h-3.5 mr-2" /> Refer to Another Branch
                      </Button>
                    )}
                    {user?.tenantCode === DPOC_TENANT && (
                      <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => { setAdmitReason(''); setAdmitDiagnosis(''); setShowAdmitRequestModal(true); }}>
                        <BedDouble className="w-3.5 h-3.5 mr-2" /> Request Admission
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="p-3 border border-dashed rounded-md text-sm text-muted-foreground text-center">
                    No participant selected
                  </div>
                )}
              </div>

              <div className="flex-1 mb-6">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex justify-between">
                  Selected Tests
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full">{selectedTests.length}</span>
                </h4>
                {selectedTests.length > 0 ? (
                  <div className="space-y-2">
                    {selectedTests.map(test => (
                      <div key={test.test_code} className="flex justify-between items-center gap-2 p-2 border rounded-md text-sm bg-card">
                        <span className="truncate">{test.test_name}</span>
                        <span className="text-xs text-muted-foreground font-mono shrink-0">
                          {parseFloat(test.price || 0).toFixed(2)} {test.currency || baseCurrency.code}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 border border-dashed rounded-md text-sm text-muted-foreground text-center">
                    No tests selected
                  </div>
                )}

                {selectedServiceObjs.length > 0 && (
                  <>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mt-4 mb-2 flex justify-between">
                      Selected Services
                      <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full">{selectedServiceObjs.length}</span>
                    </h4>
                    <div className="space-y-2">
                      {selectedServiceObjs.map(service => (
                        <div key={service.id} className="flex justify-between items-center gap-2 p-2 border rounded-md text-sm bg-card">
                          <span className="truncate">{service.service_name || service.name}</span>
                          <span className="text-xs text-muted-foreground font-mono shrink-0">
                            {parseFloat(service.price || 0).toFixed(2)} {service.currency || baseCurrency.code}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {selectedRadiologyIds.length > 0 && (
                  <>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mt-4 mb-2 flex justify-between">
                      Selected Radiology
                      <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full">{selectedRadiologyIds.length}</span>
                    </h4>
                    <div className="space-y-2">
                      {selectedRadiologyIds.map(id => {
                        const exam = radiologyExamTypes.find((e: any) => e.id === id);
                        if (!exam) return null;
                        return (
                          <div key={id} className="flex justify-between items-center gap-2 p-2 border rounded-md text-sm bg-card">
                            <span className="min-w-0">
                              <span className="block truncate">{exam.name}</span>
                              {radiologyBodyParts[id] && <span className="block text-xs text-muted-foreground truncate">{radiologyBodyParts[id]}</span>}
                            </span>
                            <span className="text-xs text-muted-foreground shrink-0">Not billed</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {(selectedTests.length > 0 || selectedServiceObjs.length > 0) && (
                  <div className="flex justify-between items-center gap-2 p-2 mt-3 border-t-2 border-foreground/20 font-semibold text-sm">
                    <span>Total</span>
                    <span className="font-mono">{orderTotal.toFixed(2)} {orderCurrency}</span>
                  </div>
                )}
              </div>

              {/* Prescribe Medicine — same as Visit Summary's, but usable before an
                  order even exists: a prescription only ever needs a patient_id (see
                  handleSubmitPrescription), never an order id. */}
              {selectedParticipant && (
                <div className="mb-6">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                    <Pill className="w-3.5 h-3.5" /> Prescribe Medicine
                  </h4>
                  <div className="border rounded-lg p-3 space-y-2.5 bg-card">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-input"
                        checked={rxIsExternal}
                        onChange={e => { setRxIsExternal(e.target.checked); setRxDrugId(''); setRxExternalName(''); setRxExternalUnit(''); }}
                      />
                      Not in stock — patient buys from an outside pharmacy
                    </label>

                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Drug *</label>
                      {rxIsExternal ? (
                        <Input
                          placeholder="Medicine name e.g. Amoxicillin 500mg caps"
                          value={rxExternalName}
                          onChange={e => setRxExternalName(e.target.value)}
                          className="mt-1"
                        />
                      ) : (
                        <Combobox
                          options={[{ value: '', label: 'Select drug...' }, ...pharmacyDrugs.map((d: any) => ({ value: d.id, label: `${d.drug_name}${d.strength ? ` (${d.strength})` : ''} — stock ${d.stock_on_hand ?? 0}` }))]}
                          value={rxDrugId}
                          onChange={v => setRxDrugId(v)}
                          placeholder="Select drug..."
                          searchPlaceholder="Search drugs..."
                          className="mt-1 h-9"
                        />
                      )}
                    </div>

                    {!rxIsExternal && pharmacyLocations.length > 0 && (
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground">Storage Location</label>
                        <Combobox
                          options={pharmacyLocations.map((l: any) => ({ value: l.id, label: l.name }))}
                          value={rxLocationId}
                          onChange={v => setRxLocationId(v)}
                          placeholder="Select location..."
                          searchPlaceholder="Search locations..."
                          className="mt-1 h-9"
                        />
                      </div>
                    )}

                    {/* Reads as the Rx itself, in order: dose + unit, strength, frequency,
                        duration — e.g. "2 tabs, 200mg, twice a day, for 5 days". Total
                        quantity to dispense (for stock/billing) is a separate, derived
                        field further down, not part of that reading. */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground">Dose Amount *</label>
                        <Input
                          type="number" min="0.25" step="0.25"
                          placeholder="e.g. 2"
                          title="How much is taken each time — e.g. 2 tablets per dose"
                          value={rxDoseAmount}
                          onChange={e => setRxDoseAmount(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground">Unit</label>
                        {rxIsExternal ? (
                          <Combobox
                            options={RX_EXTERNAL_UOM_OPTIONS}
                            value={rxExternalUnit}
                            onChange={v => setRxExternalUnit(v)}
                            placeholder="Unit..."
                            searchPlaceholder="Search units..."
                            className="mt-1 h-9 text-xs"
                          />
                        ) : (
                          <div
                            className="mt-1 flex items-center text-xs text-muted-foreground border rounded-md px-3 h-9 bg-muted/30 truncate"
                            title="Unit of measure — what one dose amount actually is (tablet, capsule, ml, etc.)"
                          >
                            {rxDrugId ? doseUnitLabel(pharmacyDrugs.find((d: any) => d.id === rxDrugId)) : '—'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground">Strength</label>
                        <Input placeholder="e.g. 200mg" value={rxDose} onChange={e => setRxDose(e.target.value)} className="mt-1" />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-muted-foreground">Frequency *</label>
                        <Combobox
                          options={FREQUENCY_OPTIONS.map(f => ({
                            value: f.code,
                            label: `${f.code} — ${f.label}`,
                          }))}
                          value={rxFrequency}
                          onChange={v => setRxFrequency(v)}
                          placeholder="e.g. twice a day"
                          searchPlaceholder="Search e.g. TDS, twice, 8 hourly..."
                          className="mt-1 h-9"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground">Duration (days)</label>
                        <Input
                          type="number" min="0" placeholder="e.g. 5"
                          value={rxDuration}
                          onChange={e => setRxDuration(e.target.value)}
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-muted-foreground">Quantity to Dispense *</label>
                        <Input
                          type="number" min="1" placeholder="Total units to give out"
                          value={rxQty}
                          onChange={e => { setRxQtyTouched(true); setRxQty(e.target.value); }}
                          className="mt-1"
                        />
                        {rxSuggestedQty != null && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {rxDoseAmount} × {findFrequency(rxFrequency)?.perDay}/day × {rxDuration} days = <strong>{rxSuggestedQty}</strong>
                            {rxQtyTouched && String(rxSuggestedQty) !== rxQty && (
                              <button type="button" className="ml-2 underline" onClick={() => { setRxQtyTouched(false); setRxQty(String(rxSuggestedQty)); }}>
                                use this
                              </button>
                            )}
                          </p>
                        )}
                        {rxFrequency && !findFrequency(rxFrequency)?.perDay && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {findFrequency(rxFrequency)?.code === 'PRN' ? 'As needed — enter the quantity to dispense.' : 'Single dose — enter the quantity to dispense.'}
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Instructions{rxIsExternal ? ' *' : ''}</label>
                      <Input
                        placeholder={rxIsExternal ? 'Instructions for the patient (required for outside purchase)' : 'Optional'}
                        value={rxNotes}
                        onChange={e => setRxNotes(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <Button type="button" variant="outline" className="w-full" onClick={handleAddRxLine}>
                      <Plus className="w-4 h-4 mr-2" /> Add
                    </Button>

                    {rxLines.length > 0 && (
                      <div className="space-y-2 pt-2 border-t">
                        {rxLines.map((l, i) => (
                          <div key={i} className="flex justify-between items-center text-sm bg-muted/30 rounded px-2 py-1.5">
                            <span>
                              {l.drug_name} × {l.quantity_prescribed} {l.unit_of_measure}
                              {l.dose_strength ? ` · ${l.dose_strength}` : ''}{l.frequency ? ` · ${l.frequency}` : ''}
                              {l.duration_days ? ` · ${l.duration_days}d` : ''}
                              {l.is_external && (
                                <span className="ml-1.5 rounded bg-warning-bg px-1.5 py-0.5 text-xs font-medium text-warning">
                                  buy outside
                                </span>
                              )}
                            </span>
                            <button type="button" onClick={() => removeRxLine(i)} className="text-muted-foreground hover:text-foreground">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <Button className="w-full" onClick={handleSubmitPrescription} disabled={prescribing}>
                          {prescribing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Pill className="w-4 h-4 mr-2" />}
                          Submit Prescription & Bill
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Clinical Notes</h4>
                <Textarea
                  placeholder="Enter clinical notes or research instructions..."
                  className="resize-none h-24 mb-4"
                  value={orderForm.clinical_notes}
                  onChange={e => setOrderForm({...orderForm, clinical_notes: e.target.value})}
                />
                
                <Button
                  onClick={handleOrder}
                  className="w-full"
                  disabled={!orderForm.participant_id || submittingOrder}
                >
                  {submittingOrder ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  {submittingOrder ? 'Saving...' : (selectedTests.length === 0 && selectedServiceIds.length === 0 && selectedRadiologyIds.length === 0) ? 'Save Visit' : 'Submit Order'}
                </Button>
              </div>

            </div>
          </div>
        </div>
        ) : activeMode === 'results' ? (
          /* RESULTS MODE VIEW */
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mt-6 flex-1 min-h-0">
            {/* LEFT: Approved Orders Queue */}
            <div className="md:col-span-4 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
              <div className="p-4 border-b bg-muted/30">
                <h3 className="font-medium">Approved Results</h3>
                <p className="text-xs text-muted-foreground mt-1">Select a patient to view their lab report</p>
              </div>
              <div className="flex-1 overflow-auto p-2 space-y-1 bg-card">
                {resultsLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
                ) : approvedOrders.length > 0 ? (
                  approvedOrders.map(order => (
                    <button
                      key={order.order_id}
                      onClick={() => loadOrderResults(order)}
                      className={cn(
                        "w-full text-left p-3 rounded-md transition-colors border text-sm flex flex-col gap-1 bg-card",
                        selectedOrder?.order_id === order.order_id 
                          ? "bg-primary/5 border-primary text-primary shadow-sm" 
                          : "hover:border-primary/50 border-transparent shadow-sm"
                      )}
                    >
                      <div className="flex justify-between items-start">
                        <div className="font-medium">{order.first_name} {order.last_name}</div>
                        <span className="text-xs bg-success-bg text-success px-1.5 py-0.5 rounded uppercase font-bold whitespace-nowrap">Approved</span>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        ID: {order.participant_number}
                      </div>
                      <div className="text-xs text-muted-foreground border-t pt-1 mt-1">
                        <span className="font-semibold text-foreground">Tests:</span> {order.specimens.map((s: any) => s.test_name).join(', ')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Approved: {formatDate(order.updated_at)}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                    No approved results available.
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Lab Report Viewer */}
            <div className="md:col-span-8 flex flex-col gap-6 h-full min-h-0">
              <div className="bg-card rounded-lg border shadow-sm p-4 h-fit flex-shrink-0">
                <h3 className="font-medium border-b pb-2 mb-3 flex items-center gap-2">
                  Patient Details
                </h3>
                {selectedOrder ? (
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground font-semibold uppercase">Participant</div>
                      <div className="font-medium">{selectedOrder.first_name} {selectedOrder.last_name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-semibold uppercase">ID</div>
                      <div className="font-mono text-primary font-medium">{selectedOrder.participant_number}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-semibold uppercase">Latest Approval</div>
                      <div>{new Date(selectedOrder.updated_at).toLocaleString()}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm py-2">Select a result to view details.</div>
                )}
              </div>

              <div className="bg-card rounded-lg border shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
                  <h3 className="font-medium flex items-center gap-2">
                    Lab Report
                  </h3>
                  <Button variant="outline" size="sm" className="h-8 gap-2 text-primary border-primary/20 hover:bg-primary/5" disabled={!selectedOrder} onClick={handlePrint}>
                    <Printer className="w-4 h-4" />
                    Print Report
                  </Button>
                </div>
                
                <div className="flex-1 overflow-auto p-6 space-y-8">
                  {selectedOrder ? (
                    selectedOrder.specimens.map((s: any) => {
                      const results = orderResults[s.id] || [];
                      return (
                        <div key={s.id} className="w-full">
                          <h4 className="font-semibold text-primary mb-2 flex justify-between items-end border-b pb-1">
                            {s.test_name}
                            <span className="text-xs font-mono text-muted-foreground font-normal">Barcode: {s.barcode}</span>
                          </h4>
                          <AdvancedDataTable<any>
                            toolbar="count"
                            data={results}
                            keyExtractor={(r) => r.id}
                            emptyMessage="No results recorded."
                            columns={[
                              { key: 'analyte', header: 'Parameter', render: (v) => <span className="font-medium">{v}</span> },
                              { key: 'value', header: 'Result', render: (v) => <span className="font-bold">{v}</span> },
                              { key: 'unit', header: 'Unit', render: (v) => <span className="text-muted-foreground">{v || '-'}</span> },
                              { key: 'reference_range', header: 'Ref Range', render: (v) => <span className="text-xs text-muted-foreground">{v || '-'}</span> },
                              {
                                key: '__remarks', header: 'Remarks',
                                render: (_v, r) => {
                                  let remark = <span className="text-success font-bold text-xs bg-success-bg px-2 py-0.5 rounded border border-success-border">NORMAL</span>;
                                  if (r.reference_range && r.value) {
                                    const parts = r.reference_range.split('-').map((p: string) => p.trim());
                                    if (parts.length === 2) {
                                      const min = parseFloat(parts[0]);
                                      const max = parseFloat(parts[1]);
                                      const val = parseFloat(r.value);
                                      if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
                                        if (val < min) remark = <span className="text-destructive font-bold text-xs bg-destructive-bg px-2 py-0.5 rounded border border-destructive-border">LOW</span>;
                                        if (val > max) remark = <span className="text-destructive font-bold text-xs bg-destructive-bg px-2 py-0.5 rounded border border-destructive-border">HIGH</span>;
                                      }
                                    }
                                  }
                                  return remark;
                                },
                              },
                            ]}
                          />
                          {s.manager_notes && (
                            <div className="mt-3 p-3 bg-card border rounded-md text-sm">
                              <span className="font-semibold text-muted-foreground uppercase text-xs mr-2">Manager Notes:</span>
                              {s.manager_notes}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg p-8">
                      Select a result from the left panel to view the report.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* VISIT SUMMARY MODE VIEW */
          <div className="flex flex-col mt-6 flex-1 min-h-0">
            {selectedSummary ? (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedSummary(null); navigate('/lis/orders/summary'); }} className="text-muted-foreground hover:text-foreground -ml-2">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back to Visits
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handlePrintSummary}>
                      <Download className="w-4 h-4 mr-2" /> Download PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAdmitDiagnosis(extractDiagnosisFromNotes(selectedSummary.clinical_notes));
                        setShowAdmitRequestModal(true);
                      }}
                      className="text-primary border-primary/30 hover:bg-primary/5"
                    >
                      <BedDouble className="w-4 h-4 mr-2" /> Request Admission
                    </Button>
                    {hasPrivilege('appointments.write') && (
                      <Button variant="outline" size="sm" onClick={() => setShowAppointmentModal(true)} className="text-primary border-primary/30 hover:bg-primary/5">
                        <CalendarClock className="w-4 h-4 mr-2" /> Schedule Follow-up
                      </Button>
                    )}
                    {selectedSummary.status !== 'closed' && (
                      <Button variant="outline" size="sm" onClick={handleCloseVisit} disabled={closingVisit} className="text-destructive hover:text-destructive">
                        {closingVisit ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                        Close Visit
                      </Button>
                    )}
                    {hasPrivilege('referrals.write') && (
                      <Button variant="outline" size="sm" onClick={openReferDialog}>
                        <ArrowLeftRight className="w-4 h-4 mr-2" /> Refer
                      </Button>
                    )}
                  </div>
                </div>
                <div className="bg-card rounded-lg border shadow-sm flex-1 overflow-auto p-6 space-y-5">
                  <div className="flex justify-between items-start border-b pb-4">
                    <div>
                      <h3 className="font-semibold text-xl">{selectedSummary.first_name} {selectedSummary.last_name}</h3>
                      <p className="text-sm text-muted-foreground font-mono mt-0.5">{selectedSummary.participant_number}</p>
                      {selectedSummary.appointment_id && (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-violet-50 text-violet-700 border border-violet-200">
                          <CalendarClock className="w-3.5 h-3.5" />
                          Follow-up appointment{selectedSummary.appointment_date ? ` (booked for ${formatDate(selectedSummary.appointment_date)})` : ''}
                          {selectedSummary.appointment_reason ? ` — ${selectedSummary.appointment_reason}` : ''}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{new Date(selectedSummary.created_at).toLocaleString()}</p>
                      {selectedSummary.status === 'closed' && (
                        <span className="inline-block mt-1 text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Closed</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* LEFT: Visit details */}
                    <div className="lg:col-span-2 space-y-5">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-semibold">Age / Gender</p>
                          <p className="font-medium">{calculateAge(selectedSummary.date_of_birth) ?? '—'}{selectedSummary.gender ? ` · ${selectedSummary.gender}` : ''}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-semibold">Doctor</p>
                          <p className="font-medium">{selectedSummary.doctor_name ? `Dr. ${selectedSummary.doctor_name}` : '—'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-semibold">Room / Clinic</p>
                          <p className="font-medium">{selectedSummary.room_number || selectedSummary.clinic_name || '—'}</p>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Vitals</p>
                        <div className="border rounded-lg overflow-hidden bg-card">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/30">
                              <tr>
                                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Vital Sign</th>
                                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Unit</th>
                                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Normal Values</th>
                                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Input</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {getVitalsTableRows(selectedSummary.vitals).map((row) => (
                                <tr key={row.label}>
                                  <td className="px-3 py-2 font-medium">{row.label}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{row.unit}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{row.normal}</td>
                                  <td className="px-3 py-2 font-medium">{row.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {(selectedSummary.vitals?.chief_complaints || []).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Chief Complaints</p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedSummary.vitals.chief_complaints.map((c: string) => (
                              <span key={c} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">{c}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase">Clinical Notes</p>
                        {selectedSummary.status !== 'closed' && !editingClinicalNotes && (
                          <Button variant="outline" size="sm" onClick={() => setEditingClinicalNotes(true)}>Edit Clinical Notes</Button>
                        )}
                      </div>

                      {editingClinicalNotes && (
                        <div className="space-y-3 border rounded-lg p-3 bg-card">
                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">History of Presenting Illness</label>
                            <Textarea
                              placeholder="Enter history of presenting illness"
                              className="resize-none mt-1"
                              rows={2}
                              value={clinicalNotesForm.history_of_presenting_illness}
                              onChange={e => setClinicalNotesForm({ ...clinicalNotesForm, history_of_presenting_illness: e.target.value })}
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground">Medical History</label>
                              <Textarea placeholder="Enter medical history" className="resize-none mt-1" rows={2} value={clinicalNotesForm.medical_history} onChange={e => setClinicalNotesForm({ ...clinicalNotesForm, medical_history: e.target.value })} />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground">Surgical History</label>
                              <Textarea placeholder="Enter surgical history" className="resize-none mt-1" rows={2} value={clinicalNotesForm.surgical_history} onChange={e => setClinicalNotesForm({ ...clinicalNotesForm, surgical_history: e.target.value })} />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground">Family History</label>
                              <Textarea placeholder="Enter family history" className="resize-none mt-1" rows={2} value={clinicalNotesForm.family_history} onChange={e => setClinicalNotesForm({ ...clinicalNotesForm, family_history: e.target.value })} />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground">Social History</label>
                              <Textarea placeholder="Enter social history" className="resize-none mt-1" rows={2} value={clinicalNotesForm.social_history} onChange={e => setClinicalNotesForm({ ...clinicalNotesForm, social_history: e.target.value })} />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground">Economic History</label>
                              <Textarea placeholder="Enter economic history" className="resize-none mt-1" rows={2} value={clinicalNotesForm.economic_history} onChange={e => setClinicalNotesForm({ ...clinicalNotesForm, economic_history: e.target.value })} />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground">Allergies</label>
                              <Textarea placeholder="Enter allergy" className="resize-none mt-1" rows={2} value={clinicalNotesForm.allergies} onChange={e => setClinicalNotesForm({ ...clinicalNotesForm, allergies: e.target.value })} />
                            </div>
                          </div>

                          {selectedSummary.gender?.toLowerCase() === 'female' && (
                            <GynaeFields value={clinicalNotesForm.gynae} onChange={(gynae) => setClinicalNotesForm({ ...clinicalNotesForm, gynae })} />
                          )}

                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">General Examination</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                              {GENERAL_EXAM_FIELDS.map(({ key, label, icon: Icon }) => (
                                <div key={key}>
                                  <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                                    <Icon className="w-3.5 h-3.5" /> {label}
                                  </label>
                                  <Textarea
                                    placeholder={`Enter ${label.toLowerCase()} findings`}
                                    className="resize-none mt-1"
                                    rows={2}
                                    value={clinicalNotesForm.general_examination[key]}
                                    onChange={e => setClinicalNotesForm({
                                      ...clinicalNotesForm,
                                      general_examination: { ...clinicalNotesForm.general_examination, [key]: e.target.value },
                                    })}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground">General Examination</label>
                              <Textarea placeholder="Enter general examination findings..." className="resize-none mt-1" rows={2} value={clinicalNotesForm.general_examination_notes} onChange={e => setClinicalNotesForm({ ...clinicalNotesForm, general_examination_notes: e.target.value })} />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground">Impressions</label>
                              <Textarea placeholder="Enter your impression..." className="resize-none mt-1" rows={2} value={clinicalNotesForm.impressions} onChange={e => setClinicalNotesForm({ ...clinicalNotesForm, impressions: e.target.value })} />
                            </div>
                          </div>

                          <div className="flex justify-end gap-2 pt-1">
                            <Button variant="outline" onClick={() => { setEditingClinicalNotes(false); setClinicalNotesForm(buildClinicalNotesForm(selectedSummary.vitals)); }}>Cancel</Button>
                            <Button onClick={handleSaveClinicalNotes} disabled={savingClinicalNotes}>
                              {savingClinicalNotes ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />} Save
                            </Button>
                          </div>
                        </div>
                      )}

                      {!editingClinicalNotes && [
                        ['History of Presenting Illness', selectedSummary.vitals?.history_of_presenting_illness],
                        ['Medical History', selectedSummary.vitals?.medical_history],
                        ['Surgical History', selectedSummary.vitals?.surgical_history],
                        ['Family History', selectedSummary.vitals?.family_history],
                        ['Social History', selectedSummary.vitals?.social_history],
                        ['Economic History', selectedSummary.vitals?.economic_history],
                        ['Allergies', selectedSummary.vitals?.allergies],
                      ].filter(([, value]) => value).length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          {[
                            ['History of Presenting Illness', selectedSummary.vitals?.history_of_presenting_illness],
                            ['Medical History', selectedSummary.vitals?.medical_history],
                            ['Surgical History', selectedSummary.vitals?.surgical_history],
                            ['Family History', selectedSummary.vitals?.family_history],
                            ['Social History', selectedSummary.vitals?.social_history],
                            ['Economic History', selectedSummary.vitals?.economic_history],
                            ['Allergies', selectedSummary.vitals?.allergies],
                          ].filter(([, value]) => value).map(([label, value]) => (
                            <div key={label as string} className="p-3 border rounded-lg bg-card">
                              <p className="text-xs text-muted-foreground uppercase font-semibold mb-1">{label}</p>
                              <p>{value}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {getPlainNotes(selectedSummary.clinical_notes) && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Clinical Notes</p>
                          <p className="text-sm p-3 border rounded-lg bg-card">{getPlainNotes(selectedSummary.clinical_notes)}</p>
                        </div>
                      )}

                      {!editingClinicalNotes && <GynaeFieldsReadOnly value={selectedSummary.vitals?.gynae || {}} />}

                      {!editingClinicalNotes && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">General Examination</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            {GENERAL_EXAM_FIELDS.map(({ key, label, icon: Icon }) => (
                              <div key={key} className="p-3 border rounded-lg bg-card">
                                <p className="text-xs text-muted-foreground uppercase font-semibold mb-1 flex items-center gap-1.5">
                                  <Icon className="w-3.5 h-3.5" /> {label}
                                </p>
                                <p>{selectedSummary.vitals?.general_examination?.[key] || '—'}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {!editingClinicalNotes && (selectedSummary.vitals?.general_examination_notes || selectedSummary.vitals?.impressions) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          {[
                            ['General Examination', selectedSummary.vitals?.general_examination_notes],
                            ['Impressions', selectedSummary.vitals?.impressions],
                          ].filter(([, value]) => value).map(([label, value]) => (
                            <div key={label as string}>
                              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">{label}</p>
                              <p className="p-3 border rounded-lg bg-card">{value}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                          Tests Ordered ({selectedSummary.tests_total})
                        </p>
                        {(selectedSummary.tests || []).length > 0 ? (
                          <div className="space-y-3">
                            {selectedSummary.tests.map((t: any) => {
                              const results = summaryResults[t.id] || [];
                              const isReady = t.status === 'approved';
                              return (
                                <div key={t.id} className="border rounded-lg overflow-hidden">
                                  <div className="flex justify-between items-center px-3 py-2 bg-muted/30">
                                    <span className="font-medium text-sm">{t.test_name}</span>
                                    <span className={cn(
                                      "text-xs font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap",
                                      isReady ? "bg-success-bg text-success" : "bg-muted text-muted-foreground"
                                    )}>
                                      {t.status.replace(/_/g, ' ')}
                                    </span>
                                  </div>
                                  {isReady && (
                                    summaryResultsLoading ? (
                                      <div className="p-3 text-xs text-muted-foreground">Loading results...</div>
                                    ) : results.length > 0 ? (
                                      <AdvancedDataTable<any>
                                        toolbar="count"
                                        data={[...results].sort((a: any, b: any) => (a.display_order ?? Infinity) - (b.display_order ?? Infinity))}
                                        keyExtractor={(r) => r.id}
                                        columns={[
                                          { key: 'analyte', header: 'Component' },
                                          { key: 'value', header: 'Value', render: (v) => <span className="font-semibold">{v || '—'}</span> },
                                          { key: 'reference_range', header: 'Range', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                                          { key: 'unit', header: 'Unit', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                                        ]}
                                      />
                                    ) : (
                                      <div className="p-3 text-xs text-muted-foreground">No results recorded.</div>
                                    )
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg">No tests ordered on this visit.</div>
                        )}
                      </div>

                      {getDiagnosesFromNotes(selectedSummary.clinical_notes).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Diagnoses</p>
                          <div className="flex flex-wrap gap-1.5">
                            {getDiagnosesFromNotes(selectedSummary.clinical_notes).map((d, i) => (
                              <span key={`${d}-${i}`} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">{d}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                          <Pill className="w-3.5 h-3.5" /> Medications Prescribed ({(selectedSummary.prescriptions || []).length})
                        </p>
                        {(selectedSummary.prescriptions || []).length > 0 ? (
                          <div className="border rounded-lg divide-y">
                            {selectedSummary.prescriptions.map((l: any) => (
                              <div key={l.line_id} className="flex justify-between items-center px-3 py-2 text-sm">
                                <span>
                                  {l.drug_name || 'Unknown drug'} × {l.quantity_prescribed} {l.unit_of_measure}
                                  {l.dose_strength ? ` · ${l.dose_strength}` : ''}{l.frequency ? ` · ${l.frequency}` : ''}
                                  {l.duration_days ? ` · ${l.duration_days}d` : ''}
                                </span>
                                {l.is_external ? (
                                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-warning-bg text-warning whitespace-nowrap">
                                    Buy from outside pharmacy — not billed
                                  </span>
                                ) : (
                                  <span className="text-xs font-bold px-2 py-0.5 rounded-full capitalize bg-muted text-muted-foreground whitespace-nowrap">
                                    {l.line_status}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg">No medications prescribed on this visit.</div>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                          <Syringe className="w-3.5 h-3.5" /> Nursing Procedures ({(selectedSummary.nursing_procedures || []).length})
                        </p>
                        {(selectedSummary.nursing_procedures || []).length > 0 ? (
                          <div className="border rounded-lg divide-y">
                            {selectedSummary.nursing_procedures.map((np: any) => (
                              <div key={np.id} className="flex justify-between items-start gap-2 px-3 py-2 text-sm">
                                <div>
                                  <span className="font-medium">{np.description}</span>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {np.status === 'completed' ? `By ${np.nurse_name || 'Unknown'}` : `Ordered by ${np.ordered_by_name || 'Unknown'}`} · {new Date(np.performed_at).toLocaleString()}
                                  </p>
                                </div>
                                <span className={cn(
                                  "text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap",
                                  np.status === 'completed' ? "bg-success-bg text-success" : "bg-warning-bg text-warning"
                                )}>
                                  {np.status === 'completed' ? 'Completed' : 'Pending'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg">No nursing procedures logged on this visit.</div>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                          <Scan className="w-3.5 h-3.5" /> Radiology ({summaryRadiology.length})
                        </p>
                        {summaryRadiology.length > 0 ? (
                          <div className="space-y-3">
                            {summaryRadiology.map((r: any) => (
                              <div key={r.id} className="border rounded-lg overflow-hidden">
                                <div className="flex justify-between items-center px-3 py-2 bg-muted/30 gap-2">
                                  <span className="min-w-0">
                                    <span className="block font-medium text-sm truncate">{r.exam_name}</span>
                                    {r.body_part && <span className="block text-xs text-muted-foreground truncate">{r.body_part}</span>}
                                  </span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className={cn(
                                      "text-xs font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap",
                                      r.status === 'completed' ? "bg-success-bg text-success"
                                        : r.status === 'in_progress' ? "bg-info-bg text-info"
                                        : "bg-warning-bg text-warning"
                                    )}>
                                      {r.status.replace(/_/g, ' ')}
                                    </span>
                                    <button
                                      type="button"
                                      className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
                                      onClick={() => navigate(`/radiology/requests/${r.id}`)}
                                    >
                                      {r.status === 'completed' ? 'View / Print' : 'Open'}
                                    </button>
                                  </div>
                                </div>
                                {r.status === 'completed' ? (
                                  <div className="p-3 text-sm" dangerouslySetInnerHTML={{ __html: r.report_html || '' }} />
                                ) : (
                                  <div className="p-3 text-xs text-muted-foreground">
                                    {r.status === 'in_progress' ? 'Exam confirmed — report not yet filed.' : 'Awaiting confirmation by radiology.'}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg">No radiology requested on this visit.</div>
                        )}
                      </div>
                    </div>

                    {/* RIGHT: Prescribe Medicine & Diagnosis — sticky so it stays in view
                        while the (usually longer) Visit details column on the left scrolls;
                        its own max-height + overflow-y-auto is a safety net for when its own
                        content (diagnosis + prescribe + request service) runs taller than the
                        visible viewport, so nothing in it becomes permanently unreachable. */}
                    <div className="lg:col-span-1 space-y-6 lg:sticky lg:top-0 lg:max-h-[calc(100vh-180px)] lg:overflow-y-auto lg:pr-1">
                    {selectedSummary.status === 'closed' ? (
                      <div className="border border-dashed rounded-lg p-4 text-center text-sm text-muted-foreground bg-card">
                        <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                        This visit is closed and read-only. Start a new visit to add a diagnosis, prescribe medicine, or request another service.
                      </div>
                    ) : (
                    <>
                      {/* Diagnosis Section */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5" /> Diagnoses
                        </p>
                        <div className="border rounded-lg p-3 bg-card">
                          <DiagnosisPicker
                            orderId={selectedSummary.order_id}
                            readOnly={selectedSummary.status === 'closed'}
                            onNotesUpdated={refreshSelectedSummary}
                          />
                        </div>
                      </div>

                      {/* Prescribe Medicine */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                          <Pill className="w-3.5 h-3.5" /> Prescribe Medicine
                        </p>
                        <div className="border rounded-lg p-3 space-y-2.5 bg-card lg:sticky lg:top-0">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            className="rounded border-input"
                            checked={rxIsExternal}
                            onChange={e => { setRxIsExternal(e.target.checked); setRxDrugId(''); setRxExternalName(''); setRxExternalUnit(''); }}
                          />
                          Not in stock — patient buys from an outside pharmacy
                        </label>

                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">Drug *</label>
                          {rxIsExternal ? (
                            <Input
                              placeholder="Medicine name e.g. Amoxicillin 500mg caps"
                              value={rxExternalName}
                              onChange={e => setRxExternalName(e.target.value)}
                              className="mt-1"
                            />
                          ) : (
                            <Combobox
                              options={[{ value: '', label: 'Select drug...' }, ...pharmacyDrugs.map((d: any) => ({ value: d.id, label: `${d.drug_name}${d.strength ? ` (${d.strength})` : ''} — stock ${d.stock_on_hand ?? 0}` }))]}
                              value={rxDrugId}
                              onChange={v => setRxDrugId(v)}
                              placeholder="Select drug..."
                              searchPlaceholder="Search drugs..."
                              className="mt-1 h-9"
                            />
                          )}
                        </div>

                        {!rxIsExternal && pharmacyLocations.length > 0 && (
                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">Storage Location</label>
                            <Combobox
                              options={pharmacyLocations.map((l: any) => ({ value: l.id, label: l.name }))}
                              value={rxLocationId}
                              onChange={v => setRxLocationId(v)}
                              placeholder="Select location..."
                              searchPlaceholder="Search locations..."
                              className="mt-1 h-9"
                            />
                          </div>
                        )}

                        {/* Reads as the Rx itself, in order: dose + unit, strength,
                            frequency, duration — e.g. "2 tabs, 200mg, twice a day, for
                            5 days". Total quantity to dispense (for stock/billing) is a
                            separate, derived field further down, not part of that
                            reading. */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">Dose Amount *</label>
                            <Input
                              type="number" min="0.25" step="0.25"
                              placeholder="e.g. 2"
                              title="How much is taken each time — e.g. 2 tablets per dose"
                              value={rxDoseAmount}
                              onChange={e => setRxDoseAmount(e.target.value)}
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">Unit</label>
                            {rxIsExternal ? (
                              <Combobox
                                options={RX_EXTERNAL_UOM_OPTIONS}
                                value={rxExternalUnit}
                                onChange={v => setRxExternalUnit(v)}
                                placeholder="Unit..."
                                searchPlaceholder="Search units..."
                                className="mt-1 h-9 text-xs"
                              />
                            ) : (
                              <div
                                className="mt-1 flex items-center text-xs text-muted-foreground border rounded-md px-3 h-9 bg-muted/30 truncate"
                                title="Unit of measure — what one dose amount actually is (tablet, capsule, ml, etc.)"
                              >
                                {rxDrugId ? doseUnitLabel(pharmacyDrugs.find((d: any) => d.id === rxDrugId)) : '—'}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">Strength</label>
                            <Input placeholder="e.g. 200mg" value={rxDose} onChange={e => setRxDose(e.target.value)} className="mt-1" />
                          </div>

                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">Frequency *</label>
                            <Combobox
                              options={FREQUENCY_OPTIONS.map(f => ({
                                value: f.code,
                                label: `${f.code} — ${f.label}`,
                              }))}
                              value={rxFrequency}
                              onChange={v => setRxFrequency(v)}
                              placeholder="e.g. twice a day"
                              searchPlaceholder="Search e.g. TDS, twice, 8 hourly..."
                              className="mt-1 h-9"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">Duration (days)</label>
                            <Input
                              type="number" min="0" placeholder="e.g. 5"
                              value={rxDuration}
                              onChange={e => setRxDuration(e.target.value)}
                              className="mt-1"
                            />
                          </div>

                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">Quantity to Dispense *</label>
                            <Input
                              type="number" min="1" placeholder="Total units to give out"
                              value={rxQty}
                              onChange={e => { setRxQtyTouched(true); setRxQty(e.target.value); }}
                              className="mt-1"
                            />
                            {/* Show the arithmetic rather than silently overwriting the
                                prescriber's number, so a computed total is always
                                traceable back to dose x frequency x days. */}
                            {rxSuggestedQty != null && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {rxDoseAmount} × {findFrequency(rxFrequency)?.perDay}/day × {rxDuration} days = <strong>{rxSuggestedQty}</strong>
                                {rxQtyTouched && String(rxSuggestedQty) !== rxQty && (
                                  <button type="button" className="ml-2 underline" onClick={() => { setRxQtyTouched(false); setRxQty(String(rxSuggestedQty)); }}>
                                    use this
                                  </button>
                                )}
                              </p>
                            )}
                            {rxFrequency && !findFrequency(rxFrequency)?.perDay && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {findFrequency(rxFrequency)?.code === 'PRN' ? 'As needed — enter the quantity to dispense.' : 'Single dose — enter the quantity to dispense.'}
                              </p>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">Instructions{rxIsExternal ? ' *' : ''}</label>
                          <Input
                            placeholder={rxIsExternal ? 'Instructions for the patient (required for outside purchase)' : 'Optional'}
                            value={rxNotes}
                            onChange={e => setRxNotes(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                        <Button type="button" variant="outline" className="w-full" onClick={handleAddRxLine}>
                          <Plus className="w-4 h-4 mr-2" /> Add
                        </Button>
                      {rxLines.length > 0 && (
                        <div className="space-y-2 pt-2 border-t">
                          {rxLines.map((l, i) => (
                            <div key={i} className="flex justify-between items-center text-sm bg-muted/30 rounded px-2 py-1.5">
                              <span>
                                {l.drug_name} × {l.quantity_prescribed} {l.unit_of_measure}
                                {l.dose_strength ? ` · ${l.dose_strength}` : ''}{l.frequency ? ` · ${l.frequency}` : ''}
                                {l.duration_days ? ` · ${l.duration_days}d` : ''}
                                {l.is_external && (
                                  <span className="ml-1.5 rounded bg-warning-bg px-1.5 py-0.5 text-xs font-medium text-warning">
                                    buy outside
                                  </span>
                                )}
                              </span>
                              <button type="button" onClick={() => removeRxLine(i)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <Button className="w-full" onClick={handleSubmitPrescription} disabled={prescribing}>
                            {prescribing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Pill className="w-4 h-4 mr-2" />}
                            Submit Prescription & Bill
                          </Button>
                        </div>
                      )}

                      {(selectedSummary?.prescriptions?.length ?? 0) > 0 && (
                        <div className="pt-2 border-t">
                          <Button type="button" variant="outline" size="sm" className="w-full"
                            onClick={() => handlePrintPrescription()} disabled={printingRx}>
                            {printingRx ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Printer className="w-3.5 h-3.5 mr-1.5" />}
                            Print Rx
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                      {/* Request Another Service */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                          <FlaskConical className="w-3.5 h-3.5" /> Request Another Service
                        </p>
                        <div className="border rounded-lg p-3 space-y-2.5 bg-card">
                          <div className="flex gap-1.5 p-0.5 bg-muted rounded-md w-fit">
                            <button
                              type="button"
                              className={cn('px-2.5 py-1 text-xs font-medium rounded', reqServiceMode === 'other' ? 'bg-card shadow-sm' : 'text-muted-foreground')}
                              onClick={() => { setReqServiceMode('other'); setReqServiceQuery(''); }}
                            >
                              Other Services
                            </button>
                            <button
                              type="button"
                              className={cn('px-2.5 py-1 text-xs font-medium rounded', reqServiceMode === 'radiology' ? 'bg-card shadow-sm' : 'text-muted-foreground')}
                              onClick={() => { setReqServiceMode('radiology'); setReqServiceQuery(''); }}
                            >
                              Radiology
                            </button>
                          </div>
                          <Popover open={reqServicePopoverOpen} onOpenChange={setReqServicePopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal h-auto min-h-9 py-2 text-left">
                                <span className="text-muted-foreground">
                                  {reqServiceSelected.length > 0 ? `${reqServiceSelected.length} selected` : reqServiceMode === 'radiology' ? 'Search radiology exams...' : 'Search tests/services...'}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                              <Command shouldFilter={false}>
                                <CommandInput placeholder={reqServiceMode === 'radiology' ? 'Search radiology exams...' : 'Search tests or services...'} value={reqServiceQuery} onValueChange={setReqServiceQuery} />
                                <CommandList className="max-h-64">
                                  <CommandEmpty>{reqServiceMode === 'radiology' ? 'No matching radiology exams.' : 'No matching tests or services.'}</CommandEmpty>
                                  <CommandGroup>
                                    {reqServiceOptions.map(item => {
                                      const isSelected = reqServiceSelected.some(x => x.key === item.key);
                                      const isUnavailable = item.type === 'test' && item.is_available === false;
                                      return (
                                        <CommandItem
                                          key={item.key} value={item.name} onSelect={() => toggleReqService(item)}
                                          disabled={isUnavailable && !isSelected}
                                          className={cn(isUnavailable && !isSelected && 'opacity-50 cursor-not-allowed')}
                                        >
                                          <Check className={cn('mr-2 h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate">{item.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                              {isUnavailable ? <span className="text-destructive font-medium">Out of stock</span> : <>{item.type === 'test' ? 'Lab Test' : item.type === 'radiology' ? 'Radiology' : 'Service'} · {item.currency} {item.price.toFixed(2)}</>}
                                            </div>
                                          </div>
                                        </CommandItem>
                                      );
                                    })}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          {reqServiceSelected.filter(item => item.type === 'radiology').map(item => (
                            <div key={`part-${item.key}`} className="rounded-md border p-2.5 space-y-2 bg-card">
                              <p className="text-sm font-medium text-primary truncate">{item.name}</p>
                              <RadiologyBodyPartPicker
                                examName={item.name}
                                value={reqRadiologyBodyParts[item.key] || ''}
                                onChange={part => setReqRadiologyBodyParts(prev => ({ ...prev, [item.key]: part }))}
                              />
                            </div>
                          ))}
                          {reqServiceSelected.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {reqServiceSelected.map(item => (
                                <span key={item.key} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                                  {item.name}
                                  <button type="button" onClick={() => toggleReqService(item)} className="hover:bg-primary/20 rounded-full p-0.5">
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <Button type="button" className="w-full" onClick={handleRequestService} disabled={reqServiceSelected.length === 0 || requestingService}>
                            {requestingService ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                            Request & Bill
                          </Button>
                        </div>
                      </div>
                    </>
                    )}
                </div>
              </div>
            </div>
          </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative w-64">
                      <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                      <Input
                        placeholder="Search patient by name, ID, or phone..."
                        className="pl-8 h-9"
                        value={patientSearch}
                        onChange={e => setPatientSearch(e.target.value)}
                      />
                    </div>
                    {patientSearch.trim() ? (
                      <Button variant="outline" size="sm" className="h-9" onClick={() => setPatientSearch('')}>
                        <X className="w-3.5 h-3.5 mr-1.5" /> Clear Search
                      </Button>
                    ) : (
                      <>
                        <Calendar className="w-4 h-4 text-muted-foreground ml-2" />
                        <Input
                          type="date"
                          className="h-9 w-[150px]"
                          value={summaryDateFrom}
                          max={summaryDateTo || undefined}
                          onChange={e => setSummaryDateFrom(e.target.value)}
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <Input
                          type="date"
                          className="h-9 w-[150px]"
                          value={summaryDateTo}
                          min={summaryDateFrom || undefined}
                          max={toLocalDateStr(new Date())}
                          onChange={e => setSummaryDateTo(e.target.value)}
                        />
                        {(summaryDateFrom !== toLocalDateStr(new Date()) || summaryDateTo !== toLocalDateStr(new Date())) && (
                          <Button variant="outline" size="sm" className="h-9" onClick={() => { setSummaryDateFrom(toLocalDateStr(new Date())); setSummaryDateTo(toLocalDateStr(new Date())); }}>
                            Today
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {patientSearch.trim()
                      ? `${visitSummaries.length} visit${visitSummaries.length !== 1 ? 's' : ''} found`
                      : `${visitSummaries.length} visit${visitSummaries.length !== 1 ? 's' : ''}`}
                  </span>
                </div>

                <div className="flex-1 overflow-auto">
                  {summaryLoading ? (
                    <div className="flex items-center justify-center h-40 text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : visitSummaries.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {visitSummaries.map(summary => {
                        const v = summary.vitals || {};
                        const complaints: string[] = v.chief_complaints || [];
                        const age = calculateAge(summary.date_of_birth);
                        const readyAll = summary.tests_total > 0 && summary.tests_ready === summary.tests_total;
                        const readySome = summary.tests_ready > 0 && !readyAll;
                        return (
                          <div
                            key={summary.order_id}
                            onClick={() => navigate(`/lis/orders/summary/${summary.participant_id}/${summary.order_id}`)}
                            className="bg-card rounded-lg border shadow-sm p-4 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all flex flex-col gap-3"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-semibold leading-tight">{summary.first_name} {summary.last_name}</p>
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                  {summary.participant_number}{age !== null ? ` · ${age}y` : ''}{summary.gender ? ` · ${summary.gender}` : ''}
                                </p>
                              </div>
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {patientSearch.trim()
                                  ? new Date(summary.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })
                                  : new Date(summary.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>

                            {complaints.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {complaints.slice(0, 3).map(c => (
                                  <span key={c} className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{c}</span>
                                ))}
                                {complaints.length > 3 && <span className="text-xs text-muted-foreground self-center">+{complaints.length - 3} more</span>}
                              </div>
                            )}

                            {(v.blood_pressure || v.temperature || v.pulse || v.spo2) && (
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground border-t pt-2">
                                {v.blood_pressure && <span>BP {v.blood_pressure}</span>}
                                {v.temperature && <span>Temp {v.temperature}°C</span>}
                                {v.pulse && <span>Pulse {v.pulse}bpm</span>}
                                {v.spo2 && <span>SpO2 {v.spo2}%</span>}
                              </div>
                            )}

                            <div className="flex items-center justify-between border-t pt-2 mt-auto">
                              <span className="text-xs text-muted-foreground truncate">{summary.doctor_name ? `Dr. ${summary.doctor_name}` : 'No doctor assigned'}</span>
                              {summary.tests_total > 0 ? (
                                <span className={cn(
                                  "text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap",
                                  readyAll ? "bg-success-bg text-success" : readySome ? "bg-warning-bg text-warning" : "bg-muted text-muted-foreground"
                                )}>
                                  {summary.tests_ready}/{summary.tests_total} Ready
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground whitespace-nowrap">No tests ordered</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                      {patientSearch.trim() ? `No visits found for "${patientSearch}".` : 'No visits recorded for this date.'}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Request Admission Modal */}
      <Dialog open={showAdmitRequestModal} onOpenChange={(open) => { setShowAdmitRequestModal(open); if (!open) { setAdmitReason(''); setAdmitDiagnosis(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BedDouble className="w-5 h-5 text-primary" /> Request Admission</DialogTitle>
            <DialogDescription>
              {(() => {
                const patient = activeMode === 'summary' ? selectedSummary : selectedParticipant;
                return patient ? `Flag ${patient.first_name} ${patient.last_name} for inpatient admission — ward staff will assign a bed.` : '';
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Diagnosis *</label>
              <Textarea placeholder="e.g. Acute appendicitis, requires surgical admission" value={admitDiagnosis} onChange={e => setAdmitDiagnosis(e.target.value)} rows={2} />
              <p className="text-xs text-muted-foreground">
                {activeMode === 'summary' && admitDiagnosis ? 'Pre-filled from the visit\'s saved diagnosis — edit if needed.' : 'Required — this diagnosis carries through to the admission record.'}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Reason for admission</label>
              <Textarea placeholder="e.g. Requires close monitoring, IV fluids..." value={admitReason} onChange={e => setAdmitReason(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdmitRequestModal(false)}>Cancel</Button>
            <Button onClick={handleRequestAdmission} disabled={requestingAdmission || !admitDiagnosis.trim()}>
              {requestingAdmission ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BedDouble className="w-4 h-4 mr-2" />}
              {requestingAdmission ? 'Requesting...' : 'Request Admission'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Follow-up Appointment Modal */}
      <Dialog open={showAppointmentModal} onOpenChange={(open) => { setShowAppointmentModal(open); if (!open) { setAppointmentDate(''); setAppointmentReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarClock className="w-5 h-5 text-primary" /> Schedule Follow-up</DialogTitle>
            <DialogDescription>
              {selectedSummary ? `Book a next visit for ${selectedSummary.first_name} ${selectedSummary.last_name}${selectedSummary.doctor_name ? ` with Dr. ${selectedSummary.doctor_name}` : ''} — it'll appear on the Appointments page, and queuing it there on the day sends them straight back to this doctor.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Date *</label>
              <Input type="date" value={appointmentDate} onChange={e => setAppointmentDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Reason</label>
              <Textarea placeholder="e.g. Review labs, follow-up on treatment" value={appointmentReason} onChange={e => setAppointmentReason(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAppointmentModal(false)}>Cancel</Button>
            <Button onClick={handleScheduleAppointment} disabled={schedulingAppointment || !appointmentDate}>
              {schedulingAppointment ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarClock className="w-4 h-4 mr-2" />}
              {schedulingAppointment ? 'Scheduling...' : 'Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Register New Patient (dpoc only) */}
      <Dialog open={showQuickRegister} onOpenChange={(open) => { setShowQuickRegister(open); if (!open) setQuickRegisterForm(EMPTY_QUICK_REGISTER); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" /> Register New Patient</DialogTitle>
            <DialogDescription>Quick registration — the patient goes straight into your queue.</DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Full Name</label>
              <Input value={quickRegisterForm.full_name} onChange={e => setQuickRegisterForm({ ...quickRegisterForm, full_name: e.target.value })} placeholder="e.g. John Deng" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Age</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <Input type="number" min="0" max="130" value={quickRegisterForm.age_years} onChange={e => setQuickRegisterForm({ ...quickRegisterForm, age_years: e.target.value })} placeholder="Years" title="Years" />
                  <Input type="number" min="0" max="11" value={quickRegisterForm.age_months} onChange={e => setQuickRegisterForm({ ...quickRegisterForm, age_months: e.target.value })} placeholder="Months" title="Months — for a baby under 1 year" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Gender</label>
                <Combobox options={GENDER_OPTIONS} value={quickRegisterForm.gender} onChange={v => setQuickRegisterForm({ ...quickRegisterForm, gender: v })} searchPlaceholder="Search..." className="h-9" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Scheme</label>
              <Combobox
                options={quickRegisterSchemes.map((s: any) => ({ value: s.id, label: s.scheme_name }))}
                value={quickRegisterForm.scheme_id}
                onChange={v => setQuickRegisterForm({ ...quickRegisterForm, scheme_id: v })}
                searchPlaceholder="Search schemes..."
                className="h-9"
              />
            </div>
            {quickRegisterIsArmedGroup && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Which Army or Police?</label>
                <Input value={quickRegisterForm.army_unit} onChange={e => setQuickRegisterForm({ ...quickRegisterForm, army_unit: e.target.value })} placeholder="e.g. SSPDF, SSNPS..." />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Phone Number</label>
              <Input value={quickRegisterForm.phone} onChange={e => setQuickRegisterForm({ ...quickRegisterForm, phone: e.target.value })} placeholder="09XXXXXXXX" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Next of Kin</label>
              <Input value={quickRegisterForm.next_of_kin} onChange={e => setQuickRegisterForm({ ...quickRegisterForm, next_of_kin: e.target.value })} placeholder="Full name of next of kin" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQuickRegister(false)}>Cancel</Button>
            <Button onClick={handleQuickRegisterSubmit} disabled={quickRegisterSubmitting}>
              {quickRegisterSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
              {quickRegisterSubmitting ? 'Registering...' : 'Register & Queue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refer Patient — pre-filled with whichever patient is already in
          view (Place Order's selectedParticipant or Visit Summary's
          selectedSummary), see handleCreateReferral. */}
      <Dialog open={showReferDialog} onOpenChange={setShowReferDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="w-5 h-5 text-primary" /> Refer Patient</DialogTitle>
            <DialogDescription>
              Send {activeMode === 'summary' ? (selectedSummary ? `${selectedSummary.first_name} ${selectedSummary.last_name}` : 'this patient') : (selectedParticipant ? `${selectedParticipant.first_name} ${selectedParticipant.last_name}` : 'this patient')}'s care to another branch for review.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 pt-2 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Receiving Branch</label>
              <Combobox
                options={referBranches.filter((b) => !user?.branchId || b.id !== Number(user.branchId)).map((b) => ({ value: String(b.id), label: b.name }))}
                value={referToBranchId}
                onChange={setReferToBranchId}
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
                value={referReason}
                onChange={(e) => setReferReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReferDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateReferral} disabled={referring || !referToBranchId}>
              {referring ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {referring ? 'Sending...' : 'Send Referral'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Off-screen only so printReceiptWhenPainted has a DOM node with real
          content to read from — same pattern as the Pharmacy module's receipt. */}
      {rxReceiptData && (
        <div className="fixed -left-[9999px] top-0">
          <div ref={rxReceiptRef}>
            <PrescriptionReceipt {...rxReceiptData} facilityName={facilityInfo.facilityName} branchName={facilityInfo.branchName} />
          </div>
        </div>
      )}
    </AppLayout>
  );
}
