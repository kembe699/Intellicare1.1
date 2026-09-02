import React, { useState, useEffect } from 'react';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { 
  Download, Loader2, Users, Calendar, Stethoscope, Activity, 
  Search, Eye, ChevronDown, ChevronUp, User, Phone, FileText 
} from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';

interface Visit {
  visit_id: string;
  visit_date: string;
  visit_type: string;
  chief_complaint: string;
  diagnosis: string;
  treatment_plan: string;
  notes: string;
  visit_status: string;
  patient_id: string;
  patient_number: string;
  patient_name: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  phone: string;
  age: number;
  doctor_id: string;
  doctor_name: string;
  doctor_email: string;
  total_visits: number;
  last_visit_date: string;
  created_at: string;
}

export default function PatientVisitsHistory() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('from', dateFrom);
      if (dateTo) params.append('to', dateTo);
      if (searchTerm) params.append('search', searchTerm);
      if (doctorFilter && doctorFilter !== 'all') params.append('doctor_id', doctorFilter);
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter);

      const res = await authFetch(`/api/clinical/patient-visits-history?${params}`);
      if (!res.ok) throw new Error('Failed to load visits');
      setData(await res.json());
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateFrom, dateTo, doctorFilter, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData();
  };

  const handleExport = () => {
    if (!data) return;
    const csv = `Patient Visits History (${dateFrom} to ${dateTo})\n\nDate,Patient,Age,Gender,Phone,Doctor,Chief Complaint,Diagnosis,Status,Total Visits\n${(data.visits || []).map((v: Visit) => 
      `${v.visit_date ? new Date(v.visit_date).toLocaleDateString() : ''},${v.patient_name},${v.age || ''},${v.gender || ''},${v.phone || ''},${v.doctor_name || ''},"${(v.chief_complaint || '').replace(/"/g, '""')}","${(v.diagnosis || '').replace(/"/g, '""')}",${v.visit_status || ''},${v.total_visits || 0}`
    ).join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `patient-visits-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    toast.success('Exported successfully');
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  const summary = data?.summary || {};
  const visits = data?.visits || [];
  const doctors = data?.doctors || [];

  const statusColors: Record<string, string> = {
    completed: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    cancelled: 'bg-red-100 text-red-800',
    scheduled: 'bg-primary/10 text-primary',
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<Users />}
          title="Patient Visits History"
        />

        {/* Filters */}
        <div className="ic-card">
          <div className="ic-card-body">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">From Date</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-40 h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">To Date</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-40 h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Doctor</label>
                <Combobox
                  options={[{ value: 'all', label: 'All Doctors' }, ...doctors.map((doc: any) => ({ value: doc.id, label: doc.display_name }))]}
                  value={doctorFilter}
                  onChange={setDoctorFilter}
                  placeholder="All Doctors"
                  searchPlaceholder="Search doctors..."
                  className="w-52 h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                <Combobox
                  options={[
                    { value: 'all', label: 'All Statuses' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'scheduled', label: 'Scheduled' },
                    { value: 'cancelled', label: 'Cancelled' },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  placeholder="All Statuses"
                  searchPlaceholder="Search..."
                  className="w-40 h-9"
                />
              </div>
              <form onSubmit={handleSearch} className="flex gap-1">
                <Input
                  placeholder="Search patient, complaint, diagnosis..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-64 h-9"
                />
                <Button type="submit" size="sm" variant="outline" className="h-9">
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </form>
              <Button
                onClick={handleExport}
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 ml-auto"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="ic-card">
            <div className="ic-card-body">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Total Visits</p>
                  <p className="text-2xl font-bold mt-1">{summary.total_visits || 0}</p>
                </div>
                <Calendar className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>
          <div className="ic-card">
            <div className="ic-card-body">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Unique Patients</p>
                  <p className="text-2xl font-bold mt-1">{summary.unique_patients || 0}</p>
                </div>
                <Users className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>
          <div className="ic-card">
            <div className="ic-card-body">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Doctors Involved</p>
                  <p className="text-2xl font-bold mt-1">{summary.doctors_involved || 0}</p>
                </div>
                <Stethoscope className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>
          <div className="ic-card">
            <div className="ic-card-body">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Visit Days</p>
                  <p className="text-2xl font-bold mt-1">{summary.visit_days || 0}</p>
                </div>
                <Activity className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>
        </div>

        {/* Visits Table */}
        <div className="ic-card">
          <div className="ic-card-header">
            <span className="font-semibold text-[13px] text-foreground">Patient Visits ({visits.length})</span>
          </div>
          <div className="ic-card-body">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted">
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground w-10"></th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Patient</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Age/Gender</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Doctor</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Chief Complaint</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Diagnosis</th>
                    <th className="text-center py-2.5 px-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Total Visits</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-muted-foreground">
                        <Calendar className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                        No visits found for the selected period
                      </td>
                    </tr>
                  ) : (
                    visits.map((visit: Visit) => (
                      <React.Fragment key={visit.visit_id}>
                        <tr
                          className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => setExpandedRow(expandedRow === visit.visit_id ? null : visit.visit_id)}
                        >
                          <td className="py-2 px-3">
                            {expandedRow === visit.visit_id ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <div className="text-sm font-medium">
                              {visit.visit_date ? new Date(visit.visit_date).toLocaleDateString() : '-'}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {visit.visit_type || 'General'}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <User className="h-3.5 w-3.5 text-primary shrink-0" />
                              <div>
                                <div className="font-medium">{visit.patient_name}</div>
                                <div className="text-xs text-muted-foreground">#{visit.patient_number}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="text-sm">{visit.age || '-'} yrs</div>
                            <div className="text-xs text-muted-foreground capitalize">{visit.gender || '-'}</div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="text-sm">{visit.doctor_name || 'N/A'}</div>
                          </td>
                          <td className="py-2 px-3 max-w-[200px]">
                            <div className="truncate text-sm">{visit.chief_complaint || '-'}</div>
                          </td>
                          <td className="py-2 px-3 max-w-[200px]">
                            <div className="truncate text-sm">{visit.diagnosis || 'Pending'}</div>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                statusColors[visit.visit_status] || 'bg-muted text-foreground'
                              }`}
                            >
                              {visit.visit_status || 'unknown'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs font-medium">
                              <Activity className="h-3 w-3" />
                              {visit.total_visits || 1}
                            </span>
                          </td>
                        </tr>
                        {expandedRow === visit.visit_id && (
                          <tr className="bg-muted border-b">
                            <td colSpan={9} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Patient Details */}
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    Patient Details
                                  </h4>
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">Full Name:</span>
                                      <div className="font-medium">{visit.patient_name}</div>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Patient ID:</span>
                                      <div className="font-medium font-mono">{visit.patient_number}</div>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Date of Birth:</span>
                                      <div className="font-medium">
                                        {visit.date_of_birth ? new Date(visit.date_of_birth).toLocaleDateString() : '-'}
                                      </div>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Phone:</span>
                                      <div className="font-medium flex items-center gap-1">
                                        <Phone className="h-3 w-3" />
                                        {visit.phone || 'N/A'}
                                      </div>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Last Visit:</span>
                                      <div className="font-medium">
                                        {visit.last_visit_date ? new Date(visit.last_visit_date).toLocaleDateString() : 'First visit'}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Visit Details */}
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
                                    <FileText className="h-4 w-4" />
                                    Visit Details
                                  </h4>
                                  <div className="space-y-2 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">Treatment Plan:</span>
                                      <div className="mt-1 p-2 bg-white rounded border text-foreground">
                                        {visit.treatment_plan || 'Not specified'}
                                      </div>
                                    </div>
                                    {visit.notes && (
                                      <div>
                                        <span className="text-muted-foreground">Clinical Notes:</span>
                                        <div className="mt-1 p-2 bg-white rounded border text-foreground">
                                          {visit.notes}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      </div>
    </AppLayout>
  );
}
