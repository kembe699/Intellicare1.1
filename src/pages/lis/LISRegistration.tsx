import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common';
import { Users, Plus, RefreshCw, Search, Stethoscope, Phone, MapPin, Calendar, X, Check, CreditCard, Loader2, AlertTriangle, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { QueueReceipt } from '@/components/receipts/QueueReceipt';
import { printReceiptWhenPainted } from '@/components/receipts/PaymentReceipt';

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
];

const timeAgo = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

// Local (not UTC) date string, so "today" matches the user's actual calendar day.
const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const calculateAgeFromDob = (dob: string): string => {
  if (!dob) return '';
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age >= 0 ? String(age) : '';
};

const calculateDobFromAge = (age: string): string => {
  const ageNum = parseInt(age, 10);
  if (isNaN(ageNum) || ageNum < 0) return '';
  const today = new Date();
  const dob = new Date(today.getFullYear() - ageNum, today.getMonth(), today.getDate());
  return toLocalDateStr(dob);
};

export default function LISRegistration() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const facilityInfo = useFacilityInfo();
  // Setup > Configurations — was a hardcoded "kuelmc only" tenantCode check;
  // now a real, admin-editable per-facility setting (see facilitySettings.js).
  // Defaults to both enabled until the setting loads, matching every
  // facility's behavior before this setting existed.
  const [facilitySettings, setFacilitySettings] = useState({ queueReceiptEnabled: true, billingRedirectEnabled: true });
  useEffect(() => {
    authFetch('/api/facility-settings', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((s) => {
        if (!s) return;
        setFacilitySettings({
          queueReceiptEnabled: s.queue_receipt_enabled !== false,
          billingRedirectEnabled: s.billing_redirect_after_queue_enabled !== false,
        });
      })
      .catch(() => {});
  }, []);
  const { queueReceiptEnabled, billingRedirectEnabled } = facilitySettings;
  const [participants, setParticipants] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [schemes, setSchemes] = useState<any[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [regForm, setRegForm] = useState({
    first_name: '', last_name: '', gender: '', study_ref: '',
    date_of_birth: '', age: '', phone: '', residence: '', doctor_id: '', consultant_id: '', clinic_id: '', room_id: '', scheme_id: '', member_number: ''
  });
  const [genderError, setGenderError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [duplicatePatient, setDuplicatePatient] = useState<any | null>(null);
  const [queuingDuplicate, setQueuingDuplicate] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState<any | null>(null);
  const [filterDateFrom, setFilterDateFrom] = useState(() => toLocalDateStr(new Date()));
  const [filterDateTo, setFilterDateTo] = useState(() => toLocalDateStr(new Date()));

  // Printed the same way a payment receipt is — an off-screen 80mm thermal
  // slip, not the A4 letterhead documentTemplate.ts builds — see
  // printReceiptWhenPainted below.
  const [queueReceiptData, setQueueReceiptData] = useState<{
    patientName: string; participantNumber?: string; queueNumber: number | null;
    clinicName?: string; doctorName?: string; roomNumber?: string; date: string;
  } | null>(null);
  const queueReceiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchParticipants();
    fetchDoctors();
    fetchSchemes();
    fetchClinics();
    fetchRooms();
  }, []);

  // Fires the print dialog the moment the off-screen receipt has actually
  // painted — same pattern PatientsBill.tsx uses for payment receipts, so a
  // slow render never prints a slip with the queue number/patient blank.
  useEffect(() => {
    if (!queueReceiptData) return;
    const cancel = printReceiptWhenPainted(
      () => queueReceiptRef.current,
      (printed) => {
        setQueueReceiptData(null);
        if (!printed) toast.error('Queue receipt could not be prepared for printing');
      }
    );
    return cancel;
  }, [queueReceiptData]);

  const fetchDoctors = async () => {
    try {
      const res = await authFetch('/api/users?all=true', { credentials: 'include' });
      const users = res.ok ? await res.json() : [];
      const roleDoctors = users.filter((u: any) => u.role === 'doctor' && u.is_active);

      // Consultants on the HR roster show up here whether or not they have a
      // linked user account — linking one is optional (see hr.js). A linked
      // consultant is represented by their real user (doctor_id, same as a
      // role='doctor' account); an unlinked one gets a synthetic id
      // ("c:<employeeId>") since there's no users.id to use, and the visit
      // records employees.id as consultant_id instead (see lisModule.js) —
      // isConsultantOnly/employeeId below is how the Doctor picker's onChange
      // tells the two apart.
      // Uses the unprivileged /consultants/for-doctor-picker endpoint, not
      // /api/hr/employees (hr.employees.read, admin-only) — this page is
      // used by front-desk/lab staff who have no reason to hold an HR
      // privilege, and gating it there silently emptied this half of the
      // list for exactly those users.
      let consultantDoctors: any[] = [];
      try {
        const cRes = await authFetch('/api/hr/consultants/for-doctor-picker', { credentials: 'include' });
        if (cRes.ok) {
          const consultants = await cRes.json();
          const usersById = new Map<string, any>(users.map((u: any) => [u.id, u]));
          consultantDoctors = consultants.map((c: any) => {
            const linkedUser = c.user_id ? usersById.get(c.user_id) : null;
            if (linkedUser && !roleDoctors.some((d: any) => d.id === c.user_id)) {
              return { ...linkedUser, display_name: `${linkedUser.display_name} (Consultant)` };
            }
            if (linkedUser) return null; // already listed as a role='doctor' account
            return {
              id: `c:${c.id}`, display_name: `${c.first_name} ${c.last_name} (Consultant)`,
              current_room_id: null, isConsultantOnly: true, employeeId: c.id,
            };
          }).filter(Boolean);
        }
      } catch (e) { /* non-blocking — role='doctor' accounts still work without this */ }

      setDoctors([...roleDoctors, ...consultantDoctors]);
    } catch (e) {
      console.error('Failed to fetch doctors', e);
    }
  };

  const fetchSchemes = async () => {
    try {
      const res = await authFetch(`/api/schemes/active?clinic_id=${user?.clinic || 1}`, { credentials: 'include' });
      if (res.ok) {
        setSchemes(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch schemes', e);
    }
  };

  const fetchClinics = async () => {
    try {
      const res = await authFetch('/api/clinics', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setClinics(data.filter((c: any) => c.isActive !== false));
      }
    } catch (e) {
      console.error('Failed to fetch clinics', e);
    }
  };

  const fetchRooms = async () => {
    try {
      const res = await authFetch(`/api/inpatient/rooms?clinic_id=${user?.clinic || 1}`, { credentials: 'include' });
      if (res.ok) {
        const allRooms = await res.json();
        setRooms(allRooms.filter((r: any) => r.room_type === 'consultation'));
      }
    } catch (e) {
      console.error('Failed to fetch rooms', e);
    }
  };

  useEffect(() => {
    fetchParticipants();
  }, []);

  // Re-queries the server as the user types instead of only ever filtering whatever the
  // last unfiltered fetch happened to return — see fetchParticipants' search param.
  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchParticipants(search.trim() || undefined);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const fetchParticipants = async (searchTerm?: string) => {
    setLoading(true);
    try {
      const q = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
      const res = await authFetch(`/api/lis/participants${q}`, { credentials: 'include' });
      if (res.ok) setParticipants(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch patients');
    } finally {
      setLoading(false);
    }
  };

  const openEditParticipant = async (p: any) => {
    const dob = p.date_of_birth ? toLocalDateStr(new Date(p.date_of_birth)) : '';
    const schemeId = p.demographics?.scheme_id || '';
    let memberNumber = '';
    if (schemeId) {
      try {
        const res = await authFetch(`/api/schemes/patient-schemes/${p.id}`, { credentials: 'include' });
        const memberships = res.ok ? await res.json() : [];
        memberNumber = memberships.find((m: any) => m.scheme_id === schemeId)?.member_number || '';
      } catch (e) { console.error('Failed to fetch existing membership number', e); }
    }
    setEditingParticipant(p);
    setRegForm({
      first_name: p.first_name || '', last_name: p.last_name || '',
      gender: p.gender || '', date_of_birth: dob, age: calculateAgeFromDob(dob),
      phone: p.phone || '', residence: p.residence || '',
      study_ref: p.study_ref || '', scheme_id: schemeId, member_number: memberNumber,
      doctor_id: '', consultant_id: '', clinic_id: '', room_id: '',
    });
  };

  const cancelEdit = () => {
    setEditingParticipant(null);
    setRegForm({ first_name: '', last_name: '', gender: '', study_ref: '', date_of_birth: '', age: '', phone: '', residence: '', doctor_id: '', consultant_id: '', clinic_id: '', room_id: '', scheme_id: '', member_number: '' });
  };

  const handleUpdateParticipant = async () => {
    if (!editingParticipant) return;
    if (!regForm.first_name.trim() || !regForm.last_name.trim()) {
      toast.error('First and last name are required');
      return;
    }
    setRegistering(true);
    try {
      const defaultScheme = schemes.find((s: any) => s.is_default) || schemes[0];
      const effectiveScheme = schemes.find((s: any) => s.id === regForm.scheme_id) || defaultScheme;
      const { scheme_id, clinic_id, doctor_id, consultant_id, room_id, ...formRest } = regForm;
      const res = await authFetch(`/api/lis/participants/${editingParticipant.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...formRest,
          demographics: { ...editingParticipant.demographics, scheme_id: effectiveScheme?.id || '', scheme_name: effectiveScheme?.scheme_name || 'Cash' },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Failed to update patient');
        return;
      }
      if (scheme_id) {
        await enrollPatientInScheme(editingParticipant.id, scheme_id, regForm.member_number);
      }
      let billId: string | null = null;
      if (!editingParticipant.is_queued && clinic_id) {
        const clinic = clinics.find((c: any) => c.id === clinic_id);
        const room = rooms.find((r: any) => r.id === room_id);
        if (clinic) {
          const queueRes = await authFetch(`/api/lis/participants/${editingParticipant.id}/queue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              doctor_id: doctor_id || null,
              consultant_id: consultant_id || null,
              room_number: room?.room_number || '',
              clinic_id,
              clinic_name: clinic.name,
            }),
          });
          if (queueRes.ok) {
            const queueData = await queueRes.json().catch(() => ({}));
            toast.success(`${regForm.first_name} ${regForm.last_name} added to queue`);
            const doctorName = doctors.find((d: any) => d.id === doctor_id || d.employeeId === consultant_id)?.display_name;
            if (queueReceiptEnabled) setQueueReceiptData({
              patientName: `${regForm.first_name} ${regForm.last_name}`,
              participantNumber: queueData.participant_number || editingParticipant.participant_number,
              queueNumber: queueData.queue_number ?? null,
              clinicName: clinic.name, doctorName, roomNumber: room?.room_number, date: new Date().toISOString(),
            });
            billId = await createBillForClinic(clinic, editingParticipant.id, `${regForm.first_name} ${regForm.last_name}`, scheme_id || undefined);
          } else {
            const err = await queueRes.json().catch(() => ({}));
            toast.error(err.error || 'Failed to add to queue');
          }
        }
      }
      toast.success('Patient details updated');
      cancelEdit();
      if (billingRedirectEnabled && billId) {
        navigate(`/patients-bill/${billId}`);
        return;
      }
      fetchParticipants();
    } catch {
      toast.error('Network error');
    } finally {
      setRegistering(false);
    }
  };

  const validateRegForm = (): boolean => {
    let ok = true;
    if (!regForm.gender) {
      setGenderError("Choose the patient's gender.");
      ok = false;
    } else {
      setGenderError('');
    }
    const phoneDigits = regForm.phone.replace(/[^\d]/g, '');
    if (regForm.phone && phoneDigits.length < 9) {
      setPhoneError('Enter a full phone number, e.g. +211 920 123 907.');
      ok = false;
    } else {
      setPhoneError('');
    }
    return ok;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registering) return;
    if (!validateRegForm()) return;
    if (editingParticipant) { await handleUpdateParticipant(); return; }
    setRegistering(true);
    try {
      // No scheme explicitly chosen ("Select Scheme" left as-is) => save as the clinic's Cash/default payer.
      const defaultScheme = schemes.find((s: any) => s.is_default) || schemes[0];
      const effectiveScheme = schemes.find((s: any) => s.id === regForm.scheme_id) || defaultScheme;
      const { scheme_id, clinic_id, room_id, ...regFormRest } = regForm;
      const clinic = clinics.find((c: any) => c.id === clinic_id);
      const room = rooms.find((r: any) => r.id === room_id);
      const res = await authFetch('/api/lis/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...regFormRest,
          clinic_id: clinic_id || null,
          clinic_name: clinic?.name || null,
          room_number: room?.room_number || '',
          demographics: { scheme_id: effectiveScheme?.id || '', scheme_name: effectiveScheme?.scheme_name || 'Cash' }
        })
      });
      if (res.ok) {
        const data = await res.json();
        toast.success('Patient registered successfully');
        if (scheme_id) {
          await enrollPatientInScheme(data.id, scheme_id, regForm.member_number);
        }
        let billId: string | null = null;
        if (clinic) {
          billId = await createBillForClinic(clinic, data.id, `${regForm.first_name} ${regForm.last_name}`, scheme_id || undefined);
        }
        if (queueReceiptEnabled && data.queue_number != null) {
          const doctorName = doctors.find((d: any) => d.id === regFormRest.doctor_id || d.employeeId === regFormRest.consultant_id)?.display_name;
          setQueueReceiptData({
            patientName: `${regForm.first_name} ${regForm.last_name}`,
            participantNumber: data.participant_number,
            queueNumber: data.queue_number,
            clinicName: clinic?.name, doctorName, roomNumber: room?.room_number, date: new Date().toISOString(),
          });
        }
        setRegForm({ first_name: '', last_name: '', gender: '', study_ref: '', date_of_birth: '', age: '', phone: '', residence: '', doctor_id: '', consultant_id: '', clinic_id: '', room_id: '', scheme_id: '', member_number: '' });
        if (billingRedirectEnabled && billId) {
          navigate(`/patients-bill/${billId}`);
          return;
        }
        fetchParticipants();
      } else {
        const err = await res.json();
        if ((err.error === 'duplicate_phone' || err.error === 'duplicate_name_dob') && err.patient) {
          setDuplicatePatient(err.patient);
        } else {
          toast.error(err.error || 'Failed to register');
        }
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setRegistering(false);
    }
  };

  // Queues the pre-existing patient found by the duplicate-phone check, using
  // whatever doctor/room/clinic the user had already picked in the registration form.
  const handleQueueDuplicate = async () => {
    if (!duplicatePatient) return;
    const { clinic_id, doctor_id, consultant_id, room_id } = regForm;
    if (!clinic_id) { toast.error('Please select a clinic'); return; }

    const clinic = clinics.find((c: any) => c.id === clinic_id);
    const room = rooms.find((r: any) => r.id === room_id);

    setQueuingDuplicate(true);
    try {
      const res = await authFetch(`/api/lis/participants/${duplicatePatient.id}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          doctor_id: doctor_id || null,
          consultant_id: consultant_id || null,
          room_number: room?.room_number || '',
          clinic_id,
          clinic_name: clinic?.name || '',
        }),
      });
      if (res.ok) {
        const queueData = await res.json().catch(() => ({}));
        if (regForm.scheme_id) {
          await enrollPatientInScheme(duplicatePatient.id, regForm.scheme_id, regForm.member_number);
        }
        const billId = await createBillForClinic(clinic, duplicatePatient.id, `${duplicatePatient.first_name} ${duplicatePatient.last_name}`, regForm.scheme_id || undefined);
        toast.success(`${duplicatePatient.first_name} ${duplicatePatient.last_name} added to queue`);
        if (queueReceiptEnabled && queueData.queue_number != null) {
          const doctorName = doctors.find((d: any) => d.id === doctor_id || d.employeeId === consultant_id)?.display_name;
          setQueueReceiptData({
            patientName: `${duplicatePatient.first_name} ${duplicatePatient.last_name}`,
            participantNumber: queueData.participant_number || duplicatePatient.participant_number,
            queueNumber: queueData.queue_number,
            clinicName: clinic?.name, doctorName, roomNumber: room?.room_number, date: new Date().toISOString(),
          });
        }
        setDuplicatePatient(null);
        setRegForm({ first_name: '', last_name: '', gender: '', study_ref: '', date_of_birth: '', age: '', phone: '', residence: '', doctor_id: '', consultant_id: '', clinic_id: '', room_id: '', scheme_id: '', member_number: '' });
        if (billingRedirectEnabled && billId) {
          navigate(`/patients-bill/${billId}`);
          return;
        }
        fetchParticipants();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to add to queue');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setQueuingDuplicate(false);
    }
  };


  // Picking a scheme only ever recorded it on the patient's demographics — it never
  // actually enrolled them in scheme_membership, which is what applySchemePrice checks
  // before it'll price anything under that scheme ("not an active member" otherwise, no
  // matter how the bill is billed). Enrolling here, right before billing, is what makes
  // the scheme price actually apply. Idempotent (ON DUPLICATE KEY UPDATE server-side) —
  // safe to call again if this patient is already enrolled.
  const enrollPatientInScheme = async (patientId: string, schemeId: string, memberNumber: string) => {
    try {
      const res = await authFetch(`/api/schemes/patient-schemes/${patientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scheme_id: schemeId, clinic_id: user?.clinic || 1, member_number: memberNumber || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to enroll patient in scheme — billing will fall back to an error');
      }
    } catch {
      toast.error('Network error enrolling patient in scheme');
    }
  };

  // Best-effort: creates (or adds to) a patient bill for the clinic's linked service.
  // Never blocks/rolls back the queue action if billing fails. Returns the bill's id
  // (existing or newly created) so the caller can jump straight to it for payment.
  // When schemeId is given (the patient was explicitly registered/queued under a real
  // insurance scheme, not left on Cash), it's only ever passed to *new* bill creation —
  // POST /patient-bills applies the scheme's own price there. An *existing* bill's mode
  // is fixed at creation (a bill is never mixed cash/scheme), so add-services deliberately
  // ignores anything passed here and re-prices from the bill's own scheme_id instead.
  const createBillForClinic = async (clinic: any, patientId: string, patientName: string, schemeId?: string): Promise<string | null> => {
    if (!clinic?.service) return null;
    try {
      const svcRes = await authFetch(`/api/services/${clinic.service}`, { credentials: 'include' });
      if (!svcRes.ok) return null;
      const service = await svcRes.json();
      const price = parseFloat(service.price) || 0;
      const lineItem = { serviceId: service.id, serviceName: service.service_name || clinic.name, quantity: 1, unitPrice: price, totalPrice: price };

      const branchClinicId = user?.clinic || 1;

      const existingBillRes = await authFetch(`/api/patient-bills/active/${patientId}/${branchClinicId}`, { credentials: 'include' });
      if (existingBillRes.ok) {
        const existingBill = await existingBillRes.json();
        const addRes = await authFetch(`/api/patient-bills/${existingBill.id}/add-services`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ services: [lineItem] }),
        });
        if (addRes.ok) {
          toast.success(`Added ${service.service_name} to existing bill ${existingBill.bill_number}`);
          return existingBill.id;
        }
        const err = await addRes.json().catch(() => ({}));
        toast.error(err.error || `Failed to bill ${service.service_name}`);
        return null;
      } else {
        const billNumber = `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
        const billRes = await authFetch('/api/patient-bills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            bill_number: billNumber, patient_id: patientId, patient_name: patientName,
            clinic_id: parseInt(String(branchClinicId)), total_amount: price, paid_amount: 0,
            balance_amount: price, status: 'pending', bill_date: new Date().toISOString(),
            due_date: null, services: [lineItem],
            notes: `Auto-generated on queueing to ${clinic.name}`,
            created_by: user?.displayName || 'System',
            scheme_id: schemeId || undefined,
          }),
        });
        if (billRes.ok) {
          toast.success(`Bill ${billNumber} created for ${clinic.name}`);
          const newBill = await billRes.json();
          return newBill.id;
        }
        const err = await billRes.json().catch(() => ({}));
        toast.error(err.error || `Failed to create bill for ${clinic.name}`);
        return null;
      }
    } catch (e) {
      console.error('Error creating bill for clinic queue:', e);
      return null;
    }
  };

  const filteredParticipants = participants.filter(p => {
    const regDate = p.created_at ? toLocalDateStr(new Date(p.created_at)) : '';
    const matchesDate =
      (!filterDateFrom || !regDate || regDate >= filterDateFrom) &&
      (!filterDateTo || !regDate || regDate <= filterDateTo);
    const matchesSearch =
      p.participant_number?.toLowerCase().includes(search.toLowerCase()) ||
      p.first_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.last_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.study_ref?.toLowerCase().includes(search.toLowerCase());
    return matchesDate && matchesSearch;
  });

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full flex flex-col">
        <PageHeader title="Patient Registration" icon={<Users />} className="mb-3" />

        <div className="flex flex-col gap-6">
          <div className="bg-card rounded-lg border shadow-sm p-4">
            <div className="flex items-center justify-between mb-4 border-b pb-2">
              <h3 className="font-medium text-lg">
                {editingParticipant ? `Edit — ${editingParticipant.first_name} ${editingParticipant.last_name}` : 'Register New Patient'}
              </h3>
              {editingParticipant && (
                <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
                  <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                </Button>
              )}
            </div>
            {editingParticipant?.is_queued && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 mb-4 text-sm">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">This patient already has an active visit</p>
                  <p className="text-muted-foreground">
                    {editingParticipant.active_visit_status === 'ordered' ? 'Being seen' : 'Waiting'}
                    {editingParticipant.active_visit_doctor ? ` by Dr. ${editingParticipant.active_visit_doctor}` : ''}
                    {editingParticipant.active_visit_room ? ` in ${editingParticipant.active_visit_room}` : ''}
                    {editingParticipant.active_visit_since ? ` — queued ${timeAgo(editingParticipant.active_visit_since)}` : ''}
                  </p>
                </div>
              </div>
            )}
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-3 rounded-lg border p-3 bg-card">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basic Information</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">First Name</label>
                      <Input required value={regForm.first_name} onChange={e => setRegForm({...regForm, first_name: e.target.value})} className="mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Last Name</label>
                      <Input required value={regForm.last_name} onChange={e => setRegForm({...regForm, last_name: e.target.value})} className="mt-1" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Gender<span className="text-destructive ml-0.5">*</span></label>
                      <Combobox
                        options={GENDER_OPTIONS}
                        value={regForm.gender}
                        onChange={v => { setRegForm({...regForm, gender: v}); setGenderError(''); }}
                        placeholder="Select gender"
                        searchPlaceholder="Search..."
                        className={cn('mt-1 h-9', genderError && 'border-destructive border-2')}
                      />
                      {genderError && <p className="text-xs text-destructive mt-1">{genderError}</p>}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3"/> Phone Number</label>
                      <Input
                        value={regForm.phone}
                        onChange={e => { setRegForm({...regForm, phone: e.target.value}); setPhoneError(''); }}
                        placeholder="e.g. +211 920 123 907"
                        aria-invalid={!!phoneError}
                        className={cn('mt-1', phoneError && 'border-destructive border-2')}
                      />
                      {phoneError && <p className="text-xs text-destructive mt-1">{phoneError}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3"/> Date of Birth</label>
                      <Input
                        type="date"
                        value={regForm.date_of_birth}
                        onChange={e => {
                          const dob = e.target.value;
                          setRegForm({ ...regForm, date_of_birth: dob, age: calculateAgeFromDob(dob) });
                        }}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Age</label>
                      <Input
                        type="number"
                        min="0"
                        value={regForm.age}
                        onChange={e => {
                          const age = e.target.value;
                          setRegForm({ ...regForm, age, date_of_birth: calculateDobFromAge(age) });
                        }}
                        placeholder="Years"
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3"/> Residence</label>
                    <Input value={regForm.residence} onChange={e => setRegForm({...regForm, residence: e.target.value})} placeholder="City / District" className="mt-1" />
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border p-3 bg-card">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Insurance &amp; Queue</p>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><CreditCard className="w-3 h-3"/> Scheme</label>
                    <Combobox
                      options={[{ value: '', label: 'Select Scheme (defaults to Cash)' }, ...schemes.map((s: any) => ({ value: s.id, label: `${s.scheme_name}${s.is_default ? ' (Default)' : ''}` }))]}
                      value={regForm.scheme_id}
                      onChange={v => setRegForm({...regForm, scheme_id: v})}
                      placeholder="Select Scheme (defaults to Cash)"
                      searchPlaceholder="Search schemes..."
                      className="mt-1 h-9"
                    />
                  </div>
                  {regForm.scheme_id && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><CreditCard className="w-3 h-3"/> Membership Number</label>
                      <Input
                        value={regForm.member_number}
                        onChange={e => setRegForm({ ...regForm, member_number: e.target.value })}
                        placeholder="This patient's ID card / membership number with the scheme"
                        className="mt-1"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Enrolls the patient in this scheme so consultation/services bill at its price instead of cash.</p>
                    </div>
                  )}
                  {(!editingParticipant || !editingParticipant.is_queued) && (
                    <div className="pt-3 border-t space-y-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase">
                        {editingParticipant ? 'Queue this Patient (Optional)' : 'Queue on Registration (Optional)'}
                      </p>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Clinic</label>
                        <Combobox
                          options={[{ value: '', label: '-- Do not queue --' }, ...clinics.map((c: any) => ({ value: c.id, label: c.name }))]}
                          value={regForm.clinic_id}
                          onChange={v => setRegForm({...regForm, clinic_id: v})}
                          placeholder="-- Do not queue --"
                          searchPlaceholder="Search clinics..."
                          className="mt-1 h-9"
                        />
                      </div>
                      {regForm.clinic_id && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Stethoscope className="w-3 h-3"/> Doctor</label>
                            <Combobox
                              options={[{ value: '', label: 'No doctor yet' }, ...doctors.map((d: any) => ({ value: String(d.id), label: `Dr. ${d.display_name}` }))]}
                              value={regForm.doctor_id || (regForm.consultant_id ? `c:${regForm.consultant_id}` : '')}
                              onChange={v => {
                                // doctors[].id comes straight from the users API as a number
                                // (users.id is a real int column), but Combobox's declared
                                // option type is string — so despite the String() on the left
                                // side here, doctorId itself was still a number at runtime and
                                // this comparison silently never matched, meaning the auto-fill
                                // below never fired: doctor was always undefined regardless of
                                // which doctor was picked.
                                const doctor = doctors.find((d: any) => String(d.id) === String(v));
                                if (doctor?.isConsultantOnly) {
                                  // No user account linked — nothing to store in doctor_id,
                                  // so the visit records employees.id as consultant_id instead
                                  // (see lisModule.js). No room auto-fill either: current_room_id
                                  // only exists on a real user's own record.
                                  setRegForm({ ...regForm, doctor_id: '', consultant_id: doctor.employeeId, room_id: '' });
                                } else {
                                  setRegForm({ ...regForm, doctor_id: v, consultant_id: '', room_id: doctor?.current_room_id || '' });
                                }
                              }}
                              placeholder="No doctor yet"
                              searchPlaceholder="Search doctors..."
                              className="mt-1 h-9"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">Room</label>
                            <Combobox
                              options={[{ value: '', label: 'No room yet' }, ...rooms.map((r: any) => ({ value: r.id, label: `${r.room_number}${r.ward_name ? ` (${r.ward_name})` : ''}` }))]}
                              value={regForm.room_id}
                              onChange={v => setRegForm({...regForm, room_id: v})}
                              placeholder="No room yet"
                              searchPlaceholder="Search rooms..."
                              className="mt-1 h-9"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end mt-6">
                <Button type="submit" size="sm" disabled={registering}>
                  {registering ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : editingParticipant ? <Check className="w-4 h-4 mr-2"/> : <Plus className="w-4 h-4 mr-2"/>}
                  {registering ? (editingParticipant ? 'Updating...' : 'Registering...') : (editingParticipant ? 'Update Patient' : 'Register Patient')}
                </Button>
              </div>
            </form>
          </div>

          <div className="bg-card rounded-lg border shadow-sm p-0 flex flex-col">
            <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
              <h3 className="font-medium">Patient Directory</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative w-64">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search by ID or Name..."
                    className="pl-8 h-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <Input
                    type="date"
                    className="h-9 w-[150px]"
                    value={filterDateFrom}
                    max={filterDateTo || undefined}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    className="h-9 w-[150px]"
                    value={filterDateTo}
                    min={filterDateFrom || undefined}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                  />
                </div>
                {(filterDateFrom !== toLocalDateStr(new Date()) || filterDateTo !== toLocalDateStr(new Date())) && (
                  <Button variant="outline" size="sm" className="h-9" onClick={() => { setFilterDateFrom(toLocalDateStr(new Date())); setFilterDateTo(toLocalDateStr(new Date())); }}>
                    Today
                  </Button>
                )}
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => fetchParticipants()} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
            
            <div className="p-4">
              <AdvancedDataTable<any>
                data={filteredParticipants}
                keyExtractor={(p) => p.id}
                loading={loading}
                emptyMessage={`No patients found${filterDateFrom || filterDateTo ? ` for ${filterDateFrom || '…'} to ${filterDateTo || '…'}` : ''}.`}
                onRowClick={(p) => openEditParticipant(p)}
                pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50, 100] }}
                columns={[
                  { key: 'participant_number', header: 'Patient No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                  { key: 'first_name', header: 'Name', sortable: true, render: (_v, p) => <>{p.first_name} {p.last_name}</> },
                  { key: 'gender', header: 'Gender', sortable: true },
                  { key: 'study_ref', header: 'Study Ref', render: (v) => v || '-' },
                  { key: 'created_at', header: 'Registered At', sortable: true, render: (v) => <span className="text-muted-foreground">{new Date(v).toLocaleString()}</span> },
                ]}
              />
            </div>
            <div className="p-3 border-t bg-muted/30 text-xs text-muted-foreground flex justify-between">
              <span>Total: {filteredParticipants.length}</span>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* ═══ Duplicate Phone Number Modal ═══ */}
      <Dialog open={!!duplicatePatient} onOpenChange={(open) => { if (!open) setDuplicatePatient(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
              Patient Already Exists
            </DialogTitle>
          </DialogHeader>

          {duplicatePatient && (
            <div className="px-1 py-2 space-y-4">
              <p className="text-sm text-muted-foreground">
                Sorry, a patient with this phone number already exists. If this is the same person, just queue them instead of creating a duplicate record.
              </p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1 border">
                <p className="font-medium text-base flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-primary" />
                  {duplicatePatient.first_name} {duplicatePatient.last_name}
                </p>
                <p className="text-sm text-muted-foreground">ID: {duplicatePatient.participant_number}</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> {duplicatePatient.phone}
                </p>
                {duplicatePatient.residence && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> {duplicatePatient.residence}
                  </p>
                )}
                {duplicatePatient.is_queued ? (
                  <p className="text-sm text-emerald-600 font-medium pt-1">Already queued today</p>
                ) : null}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicatePatient(null)}>
              <X className="w-4 h-4 mr-2" /> Edit Phone Number
            </Button>
            {duplicatePatient && !duplicatePatient.is_queued && (
              <Button onClick={handleQueueDuplicate} disabled={queuingDuplicate}>
                {queuingDuplicate ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                {queuingDuplicate ? 'Queuing...' : 'Queue This Patient'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Off-screen only so printReceiptWhenPainted has a DOM node with real
          content to read from — same pattern PatientsBill.tsx uses for
          payment receipts. */}
      {queueReceiptData && (
        <div className="fixed -left-[9999px] top-0">
          <div ref={queueReceiptRef}>
            <QueueReceipt {...queueReceiptData} facilityName={facilityInfo.facilityName} branchName={facilityInfo.branchName} />
          </div>
        </div>
      )}
    </AppLayout>
  );
}
