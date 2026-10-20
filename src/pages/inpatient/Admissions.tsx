import React, { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Search, LogIn, X, Check, Loader2, BedDouble, ClipboardList, Clock, Receipt, UserCheck, FileSpreadsheet } from 'lucide-react';
import { toast } from '@/lib/notify';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Combobox } from '@/components/ui/combobox';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { exportCSV } from '@/utils/reportUtils';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { formatDate } from '@/lib/format';


export default function Admissions() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [patientSearch, setPatientSearch] = useState('');
  const [formData, setFormData] = useState({ patient_id: '', patient_name: '', ward_id: '', room_id: '', bed_id: '', admission_reason: '', diagnosis: '', admission_type: 'planned', attending_doctor_id: '', consultant_id: '', request_id: '' });
  const [resolvingBillFor, setResolvingBillFor] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);

  // Directory filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Patients search — merges the main Patient Registry with LIS-registered patients so both are admittable.
  const { data: patients = [] } = useQuery({
    queryKey: ['patients-search', patientSearch],
    queryFn: async () => {
      if (!patientSearch || patientSearch.length < 2) return [];
      const [patientsRes, lisRes] = await Promise.all([
        authFetch(`/api/patients/search?q=${encodeURIComponent(patientSearch)}`).catch(() => null),
        authFetch('/api/lis/participants').catch(() => null),
      ]);
      const merged: any[] = [];
      if (patientsRes?.ok) {
        const data = await patientsRes.json();
        (Array.isArray(data) ? data : []).forEach((p: any) => merged.push({
          id: p.id, first_name: p.first_name, last_name: p.last_name, patient_number: p.patient_id,
        }));
      }
      if (lisRes?.ok) {
        const data = await lisRes.json();
        const q = patientSearch.toLowerCase();
        (Array.isArray(data) ? data : [])
          .filter((p: any) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) || p.participant_number?.toLowerCase().includes(q))
          .forEach((p: any) => merged.push({
            id: p.id, first_name: p.first_name, last_name: p.last_name, patient_number: p.participant_number,
          }));
      }
      return merged.slice(0, 10);
    },
    enabled: patientSearch.length >= 2,
  });

  const { data: wards = [] } = useQuery({
    queryKey: ['wards', clinicId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/wards?clinic_id=${clinicId}`); return r.ok ? r.json() : []; },
  });

  const { data: rooms = [] } = useQuery({
    queryKey: ['rooms-admission', formData.ward_id],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/rooms?clinic_id=${clinicId}&ward_id=${formData.ward_id}`); return r.ok ? r.json() : []; },
    enabled: !!formData.ward_id,
  });

  const { data: beds = [] } = useQuery({
    queryKey: ['beds-available', formData.room_id],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/beds?clinic_id=${clinicId}&room_id=${formData.room_id}&status=available`); return r.ok ? r.json() : []; },
    enabled: !!formData.room_id,
  });

  // Merges role='doctor' user accounts with the HR consultant roster — a
  // consultant with a linked login is already covered by the first half (and
  // skipped from the second to avoid listing them twice), one with no
  // account gets a synthetic "c:<employeeId>" value since there's no
  // users.id to use. Same merge LISRegistration.tsx uses for its own
  // doctor-or-consultant picker.
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors-and-consultants'],
    queryFn: async () => {
      const r = await authFetch('/api/users?all=true');
      const allUsers = r.ok ? await r.json() : [];
      const roleDoctors = allUsers.filter((u: any) => u.role === 'doctor' && u.is_active);
      let consultantDoctors: any[] = [];
      try {
        const cRes = await authFetch('/api/hr/consultants/for-doctor-picker');
        if (cRes.ok) {
          const consultants = await cRes.json();
          const usersById = new Map<string, any>(allUsers.map((u: any) => [u.id, u]));
          consultantDoctors = consultants.map((c: any) => {
            const linkedUser = c.user_id ? usersById.get(c.user_id) : null;
            if (linkedUser && !roleDoctors.some((d: any) => d.id === c.user_id)) {
              return { ...linkedUser, display_name: `${linkedUser.display_name} (Consultant)` };
            }
            if (linkedUser) return null; // already listed as a role='doctor' account
            return {
              id: `c:${c.id}`, display_name: `${c.first_name} ${c.last_name} (Consultant)`,
              isConsultantOnly: true, employeeId: c.id,
            };
          }).filter(Boolean);
        }
      } catch (e) { /* non-blocking — role='doctor' accounts still work without this */ }
      return [...roleDoctors, ...consultantDoctors];
    },
  });

  // Recent admissions
  const { data: recentAdmissions = [] } = useQuery({
    queryKey: ['recent-admissions', clinicId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/admissions?clinic_id=${clinicId}`); return r.ok ? r.json() : []; },
  });

  // Pending admission requests — doctors raise these from LIS Orders; staff processes them here.
  const { data: admissionRequests = [] } = useQuery({
    queryKey: ['admission-requests', clinicId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/admission-requests?clinic_id=${clinicId}&status=pending`); return r.ok ? r.json() : []; },
    refetchInterval: 30000,
  });

  const admitMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await authFetch('/api/inpatient/admissions', { method: 'POST', body: JSON.stringify({ ...data, clinic_id: clinicId }) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed'); }
      return r.json();
    },
    onSuccess: () => {
      toast.success('Patient admitted successfully');
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['recent-admissions'] });
      queryClient.invalidateQueries({ queryKey: ['inpatient-stats'] });
      queryClient.invalidateQueries({ queryKey: ['beds-available'] });
      queryClient.invalidateQueries({ queryKey: ['admission-requests'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const declineMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await authFetch(`/api/inpatient/admission-requests/${id}/cancel`, { method: 'PUT' });
      if (!r.ok) throw new Error('Failed to decline request');
      return r.json();
    },
    onMutate: (id: string) => setDecliningId(id),
    onSuccess: () => { toast.success('Request declined'); queryClient.invalidateQueries({ queryKey: ['admission-requests'] }); },
    onError: () => toast.error('Failed to decline request'),
    onSettled: () => setDecliningId(null),
  });

  const resetForm = () => {
    setPatientSearch('');
    setFormData({ patient_id: '', patient_name: '', ward_id: '', room_id: '', bed_id: '', admission_reason: '', diagnosis: '', admission_type: 'planned', attending_doctor_id: '', consultant_id: '', request_id: '' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.patient_id || !formData.bed_id || !formData.admission_reason) { toast.error('Patient, bed, and admission reason are required'); return; }
    admitMutation.mutate(formData);
  };

  const processRequest = (req: any) => {
    setFormData({
      patient_id: req.patient_id, patient_name: req.patient_name, ward_id: '', room_id: '', bed_id: '',
      admission_reason: req.reason || '', diagnosis: req.diagnosis || '', admission_type: 'planned', attending_doctor_id: req.requested_by || '', consultant_id: '',
      request_id: req.id,
    });
  };

  const viewBill = async (admission: any) => {
    setResolvingBillFor(admission.id);
    try {
      const r = await authFetch(`/api/patient-bills/active/${admission.patient_id}/${clinicId}`);
      if (r.ok) {
        const bill = await r.json();
        navigate(`/patients-bill/${bill.id}`);
      } else {
        toast.error(`No bill found yet for ${admission.patient_name}`);
      }
    } catch {
      toast.error('Failed to look up bill');
    } finally {
      setResolvingBillFor(null);
    }
  };

  const patientsArr = Array.isArray(patients) ? patients : (patients as any)?.data || [];
  const doctorsArr = Array.isArray(doctors) ? doctors : (doctors as any)?.data || [];

  const filteredAdmissions = useMemo(() => {
    return (recentAdmissions as any[]).filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      const q = search.toLowerCase();
      if (q && !a.patient_name?.toLowerCase().includes(q) && !a.ward_name?.toLowerCase().includes(q)) return false;
      const admDate = a.admission_date ? String(a.admission_date).split('T')[0] : '';
      if (dateFrom && admDate && admDate < dateFrom) return false;
      if (dateTo && admDate && admDate > dateTo) return false;
      return true;
    });
  }, [recentAdmissions, search, statusFilter, dateFrom, dateTo]);

  // Days in the ward — from admission to discharge if discharged, otherwise to now (ongoing).
  const getDuration = (a: any) => {
    if (!a.admission_date) return '—';
    const start = new Date(a.admission_date).getTime();
    const end = a.discharge_date ? new Date(a.discharge_date).getTime() : Date.now();
    const days = Math.max(1, Math.ceil((end - start) / 86400000));
    return a.discharge_date ? `${days} day${days === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'} (ongoing)`;
  };

  const handleExportCSV = () => {
    if (filteredAdmissions.length === 0) { toast.error('No admissions to export'); return; }
    exportCSV(filteredAdmissions, [
      { header: 'Patient', key: 'patient_name' },
      { header: 'Ward', key: 'ward_name' },
      { header: 'Room', key: 'room_number' },
      { header: 'Bed', key: 'bed_number' },
      { header: 'Admission Date', key: 'admission_date', transform: (v) => v ? formatDate(v) : '' },
      { header: 'Duration', key: 'admission_date', transform: (_v, row) => getDuration(row) },
      { header: 'Type', key: 'admission_type' },
      { header: 'Status', key: 'status' },
    ], `admissions${dateFrom ? `-${dateFrom}` : ''}${dateTo ? `_to_${dateTo}` : ''}.csv`);
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          title="Patient Admissions"
          className="mb-0"
        />

        {/* Pending Admission Requests — raised by doctors from LIS Orders */}
        {admissionRequests.length > 0 && (
          <Card className="border-warning-border">
            <CardContent className="p-0">
              <div className="px-5 py-3 border-b bg-warning-bg/60 flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2 text-warning">
                  <ClipboardList className="h-4 w-4" /> Pending Admission Requests
                </h3>
                <Badge className="bg-warning text-white">{admissionRequests.length}</Badge>
              </div>
              <div className="divide-y">
                {admissionRequests.map((req: any) => (
                  <div key={req.id} className="px-5 py-3 flex items-center gap-4 hover:bg-muted/30 transition-colors">
                    <div className="h-9 w-9 rounded-full bg-warning-bg flex items-center justify-center text-warning font-bold text-xs flex-shrink-0">
                      {req.patient_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{req.patient_name}</p>
                      <p className="text-xs text-foreground/80 truncate"><span className="font-medium">Dx:</span> {req.diagnosis || '—'}</p>
                      {req.reason && <p className="text-xs text-muted-foreground truncate">{req.reason}</p>}
                    </div>
                    <div className="text-right text-xs text-muted-foreground flex-shrink-0 hidden sm:block">
                      <p className="flex items-center gap-1 justify-end"><Clock className="h-3 w-3" />{new Date(req.created_at).toLocaleString()}</p>
                      <p>by {req.requested_by_name}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button variant="outline" size="sm" disabled={decliningId === req.id} onClick={() => declineMutation.mutate(req.id)}>
                        {decliningId === req.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Decline'}
                      </Button>
                      <Button size="sm" className="gap-1.5" onClick={() => processRequest(req)}>
                        <UserCheck className="h-3.5 w-3.5" /> Process
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Admit Patient — stacked above the list, always visible, no modal */}
        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex-shrink-0">
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <LogIn className="w-4 h-4 text-primary shrink-0" />
              Admit New Patient
            </h3>
          </div>

          {formData.request_id && (
            <div className="mx-4 mt-4 p-2.5 rounded-lg border border-primary/20 bg-primary/5 text-xs text-primary flex items-center gap-2">
              <ClipboardList className="h-3.5 w-3.5 flex-shrink-0" /> Processing an admission request — completing this will mark it fulfilled.
            </div>
          )}

          <form onSubmit={handleSubmit} className="p-4 grid grid-cols-2 gap-4">
            {/* Card 1: Patient & Placement */}
            <div className="border rounded-lg p-3 space-y-3 bg-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Patient &amp; Placement</p>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Patient *</Label>
                {formData.patient_id ? (
                  <div className="mt-1 flex items-center gap-2 p-3 bg-success-bg border border-success-border rounded-lg">
                    <Check className="h-4 w-4 text-success" />
                    <span className="font-medium text-sm flex-1">{formData.patient_name}</span>
                    <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setFormData({ ...formData, patient_id: '', patient_name: '', request_id: '' })}><X className="h-3 w-3" /></Button>
                  </div>
                ) : (
                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search patient by name or ID..." value={patientSearch} onChange={e => setPatientSearch(e.target.value)} className="pl-9 rounded-md shadow-sm" />
                    {patientsArr.length > 0 && patientSearch.length >= 2 && (
                      <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-40 overflow-y-auto p-1">
                        {patientsArr.slice(0, 8).map((p: any) => (
                          <button key={p.id} type="button" className="group w-full text-left flex items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors" onClick={() => { setFormData({ ...formData, patient_id: p.id, patient_name: `${p.first_name || ''} ${p.last_name || ''}`.trim() }); setPatientSearch(''); }}>
                            <span className="font-medium group-hover:text-white">{p.first_name} {p.last_name}</span>
                            <span className="text-xs text-muted-foreground ml-2 group-hover:text-white">{p.patient_number}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Ward *</Label>
                  <Combobox
                    options={wards.map((w: any) => ({ value: w.id, label: `${w.name} (${w.total_beds - (w.current_occupancy || 0)} available)` }))}
                    value={formData.ward_id}
                    onChange={v => setFormData({ ...formData, ward_id: v, room_id: '', bed_id: '' })}
                    placeholder="Select ward"
                    searchPlaceholder="Search wards..."
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Room *</Label>
                  <Combobox
                    options={rooms.map((r: any) => ({ value: r.id, label: `Room ${r.room_number} (${(r.total_beds || 0) - (r.current_occupancy || 0)} available)` }))}
                    value={formData.room_id}
                    onChange={v => setFormData({ ...formData, room_id: v, bed_id: '' })}
                    disabled={!formData.ward_id}
                    placeholder="Select room"
                    searchPlaceholder="Search rooms..."
                    className="mt-1"
                  />
                </div>
              </div>

              {formData.room_id && (
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Bed *</Label>
                  {beds.length === 0 ? (
                    <p className="text-sm text-warning p-2 bg-warning-bg rounded mt-1">No available beds in this room</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 mt-1">
                      {beds.map((b: any) => (
                        <button key={b.id} type="button" onClick={() => setFormData({ ...formData, bed_id: b.id })}
                          className={`p-2.5 rounded-lg border-2 text-center text-xs transition-all ${formData.bed_id === b.id ? 'border-success-border bg-success-bg font-semibold' : 'border-border hover:border-success-border'}`}>
                          <BedDouble className="h-3.5 w-3.5 mx-auto mb-1 opacity-50" />
                          {b.bed_number}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Card 2: Admission Details */}
            <div className="border rounded-lg p-3 space-y-3 bg-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Admission Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Admission Type</Label>
                  <Combobox
                    options={[
                      { value: 'planned', label: 'Planned' },
                      { value: 'emergency', label: 'Emergency' },
                      { value: 'transfer', label: 'Transfer' },
                    ]}
                    value={formData.admission_type}
                    onChange={v => setFormData({ ...formData, admission_type: v })}
                    searchPlaceholder="Search..."
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Attending Doctor</Label>
                  <Combobox
                    options={doctorsArr.map((d: any) => ({ value: String(d.id), label: d.display_name || d.email }))}
                    value={formData.attending_doctor_id || (formData.consultant_id ? `c:${formData.consultant_id}` : '')}
                    onChange={v => {
                      const doctor = doctorsArr.find((d: any) => String(d.id) === String(v));
                      if (doctor?.isConsultantOnly) {
                        // No user account linked — nothing to store in
                        // attending_doctor_id, so the admission records
                        // employees.id as consultant_id instead (see
                        // inpatient.js).
                        setFormData({ ...formData, attending_doctor_id: '', consultant_id: doctor.employeeId });
                      } else {
                        setFormData({ ...formData, attending_doctor_id: v, consultant_id: '' });
                      }
                    }}
                    placeholder="Select doctor"
                    searchPlaceholder="Search doctors..."
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Admission Reason *</Label>
                  <Textarea placeholder="Reason for admission..." value={formData.admission_reason} onChange={e => setFormData({ ...formData, admission_reason: e.target.value })} rows={3} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Preliminary Diagnosis</Label>
                  <Textarea placeholder="Diagnosis..." value={formData.diagnosis} onChange={e => setFormData({ ...formData, diagnosis: e.target.value })} rows={3} className="mt-1" />
                </div>
              </div>
            </div>

            <div className="col-span-2 flex justify-end gap-2">
              {formData.patient_id && (
                <Button type="button" variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
              )}
              <Button type="submit" size="sm" className="px-6 gap-2" disabled={admitMutation.isPending}>
                {admitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                Admit Patient
              </Button>
            </div>
          </form>
        </div>

        {/* Admissions Directory */}
        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search patient or ward..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">From</Label>
              <Input type="date" className="w-[150px]" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">To</Label>
              <Input type="date" className="w-[150px]" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <Combobox
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'active', label: 'Active' },
                { value: 'discharged', label: 'Discharged' },
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
              searchPlaceholder="Search..."
              className="w-[150px]"
            />
            <Button type="button" variant="outline" onClick={handleExportCSV} className="gap-1.5">
              <FileSpreadsheet className="w-4 h-4" /> Export CSV
            </Button>
          </div>

          <div className="p-4">
            <AdvancedDataTable<any>
              data={filteredAdmissions}
              keyExtractor={(a) => a.id}
              emptyMessage="No admissions found."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                {
                  key: 'patient_name', header: 'Patient', sortable: true,
                  render: (v) => <span className="font-medium">{v}</span>,
                },
                { key: 'ward_name', header: 'Ward', sortable: true, render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                { key: 'room_number', header: 'Room', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                { key: 'bed_number', header: 'Bed', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                { key: 'admission_date', header: 'Admission Date', sortable: true, render: (v) => <span className="text-muted-foreground">{v ? formatDate(v) : '—'}</span> },
                { key: '__duration', header: 'Duration', render: (_v, a) => <span className="text-muted-foreground">{getDuration(a)}</span> },
                {
                  key: 'admission_type', header: 'Type', sortable: true,
                  render: (v) => (
                    <Badge className={`text-xs capitalize ${v === 'emergency' ? 'bg-destructive-bg text-destructive' : v === 'transfer' ? 'bg-warning-bg text-warning' : 'bg-primary/10 text-primary'}`}>
                      {v}
                    </Badge>
                  ),
                },
                {
                  key: 'status', header: 'Status', sortable: true,
                  render: (v) => <Badge variant={v === 'active' ? 'default' : 'secondary'} className="text-xs capitalize">{v}</Badge>,
                },
                {
                  key: '__actions', header: 'Actions',
                  render: (_v, a) => (
                    <Button variant="outline" size="sm" className="gap-1.5" disabled={resolvingBillFor === a.id} onClick={() => viewBill(a)}>
                      {resolvingBillFor === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />} Bill
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>
      </div>
    </AppLayout>
  );
}
