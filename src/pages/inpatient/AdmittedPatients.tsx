import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Eye, BedDouble, FileSpreadsheet, Calendar, X } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { exportCSV } from '@/utils/reportUtils';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { Combobox } from '@/components/ui/combobox';

const OUTCOME_LABEL: Record<string, string> = { alive: 'Alive', dead: 'Deceased', absconded: 'Absconded' };
const OUTCOME_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = { alive: 'success', absconded: 'warning', dead: 'danger' };

const STATUS_FILTER_OPTIONS = [
  { value: 'active', label: 'In Bed' },
  { value: 'discharged', label: 'Discharged' },
  { value: '', label: 'All' },
];
const OUTCOME_FILTER_OPTIONS = [
  { value: '', label: 'All Outcomes' },
  { value: 'alive', label: 'Alive' },
  { value: 'dead', label: 'Deceased' },
  { value: 'absconded', label: 'Absconded' },
];

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export default function AdmittedPatients() {
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [outcomeFilter, setOutcomeFilter] = useState('');

  const { data: admissions = [], isLoading } = useQuery({
    queryKey: ['admitted-patients', clinicId, searchTerm, statusFilter, outcomeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ clinic_id: String(clinicId) });
      if (statusFilter) params.append('status', statusFilter);
      if (outcomeFilter) params.append('discharge_outcome', outcomeFilter);
      if (searchTerm) params.append('search', searchTerm);
      const r = await authFetch(`/api/inpatient/admissions?${params}`);
      return r.ok ? r.json() : [];
    },
  });

  const filteredAdmissions = admissions.filter((a: any) => {
    if (!dateFrom && !dateTo) return true;
    const admitted = a.admission_date ? toLocalDateStr(new Date(a.admission_date)) : '';
    if (!admitted) return false;
    if (dateFrom && admitted < dateFrom) return false;
    if (dateTo && admitted > dateTo) return false;
    return true;
  });

  // For a discharged patient, "days admitted" is the length of the actual
  // stay (admission to discharge) — counting up to now instead would make
  // the figure keep growing forever for a patient who left months ago.
  const getDaysAdmitted = (admissionDate: string, dischargeDate?: string | null) => {
    const end = dischargeDate ? new Date(dischargeDate).getTime() : Date.now();
    const diff = end - new Date(admissionDate).getTime();
    return Math.max(1, Math.floor(diff / (1000 * 60 * 60 * 24)));
  };

  const handleExportCSV = () => {
    if (filteredAdmissions.length === 0) { toast.error('No admitted patients to export'); return; }
    exportCSV(filteredAdmissions, [
      { header: 'Patient', key: 'patient_name' },
      { header: 'Patient Number', key: 'patient_number' },
      { header: 'Ward', key: 'ward_name' },
      { header: 'Room', key: 'room_number' },
      { header: 'Bed', key: 'bed_number' },
      { header: 'Type', key: 'admission_type' },
      { header: 'Doctor', key: 'doctor_name', transform: (v: string) => v ? `Dr. ${v}` : '' },
      { header: 'Diagnosis', key: 'diagnosis' },
      { header: 'Days Admitted', key: 'admission_date', transform: (v: string, row: any) => v ? String(getDaysAdmitted(v, row.discharge_date)) : '' },
      { header: 'Status', key: 'status', transform: (v: string) => v === 'active' ? 'In Bed' : 'Discharged' },
      { header: 'Outcome', key: 'discharge_outcome', transform: (v: string) => v ? (OUTCOME_LABEL[v] || v) : '' },
    ], 'admitted-patients.csv');
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<BedDouble />}
          title="Admitted Patients"
          actions={<Badge className="bg-primary/10 text-primary text-base px-3 py-1">{filteredAdmissions.length} {STATUS_FILTER_OPTIONS.find(o => o.value === statusFilter)?.label || 'All'}</Badge>}
        />

        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by patient name, ID, or ward..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
            </div>
            <Combobox
              options={STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={setStatusFilter}
              searchPlaceholder="Search..."
              className="h-9 w-[140px]"
            />
            <Combobox
              options={OUTCOME_FILTER_OPTIONS}
              value={outcomeFilter}
              onChange={setOutcomeFilter}
              searchPlaceholder="Search..."
              className="h-9 w-[150px]"
            />
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <Input type="date" className="h-9 w-[150px]" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" className="h-9 w-[150px]" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} />
              {(dateFrom || dateTo) && (
                <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => { setDateFrom(''); setDateTo(''); }} title="Clear date filter">
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            <Button type="button" variant="outline" onClick={handleExportCSV} className="gap-1.5">
              <FileSpreadsheet className="w-4 h-4" /> Export CSV
            </Button>
          </div>

          <div className="p-4">
            <AdvancedDataTable<any>
              data={filteredAdmissions}
              keyExtractor={(a) => a.id}
              loading={isLoading}
              emptyMessage="No admitted patients found"
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'patient_number', header: 'Patient Number', sortable: true, render: (v) => <span className="text-muted-foreground font-mono">{v || '—'}</span> },
                { key: 'patient_name', header: 'Patient', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
                { key: 'ward_name', header: 'Ward', sortable: true, render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                { key: 'room_number', header: 'Room', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                { key: 'bed_number', header: 'Bed', render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                {
                  key: 'admission_type', header: 'Type', sortable: true,
                  render: (v) => <Badge className={`text-xs capitalize ${v === 'emergency' ? 'bg-red-100 text-red-700' : 'bg-primary/10 text-primary'}`}>{v}</Badge>,
                },
                { key: 'doctor_name', header: 'Doctor', sortable: true, render: (v) => <span className="text-muted-foreground">{v ? `Dr. ${v}` : '—'}</span> },
                { key: 'diagnosis', header: 'Diagnosis', render: (v) => <span className="text-muted-foreground truncate max-w-[220px] block">{v || '—'}</span> },
                {
                  key: 'status', header: 'Status', sortable: true,
                  render: (v) => <Badge variant={v === 'active' ? 'success' : 'neutral'}>{v === 'active' ? 'In Bed' : 'Discharged'}</Badge>,
                },
                {
                  key: 'discharge_outcome', header: 'Outcome',
                  render: (v) => v ? <Badge variant={OUTCOME_VARIANT[v] || 'neutral'}>{OUTCOME_LABEL[v] || v}</Badge> : <span className="text-muted-foreground">—</span>,
                },
                { key: 'admission_date', header: 'Duration', sortable: true, render: (v, a) => <span className="text-muted-foreground">{a.status === 'active' ? 'Day' : ''} {getDaysAdmitted(v, a.discharge_date)}{a.status !== 'active' ? ' days' : ''}</span> },
                {
                  key: '__actions', header: 'Actions',
                  render: (_v, a) => (
                    <Button size="sm" className="gap-1.5" onClick={() => navigate(`/inpatient/patient/${a.id}`)}>
                      <Eye className="h-3.5 w-3.5" /> View
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
