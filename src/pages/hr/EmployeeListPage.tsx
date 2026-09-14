import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { exportCSV } from '@/utils/reportUtils';
import { toast } from 'sonner';
import { Users, Search, Eye, Edit, Ban, CheckCircle, Loader2, X, Check, FileSpreadsheet, Stethoscope } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

export interface Employee {
  id: string;
  employee_number: string;
  employment_type: 'staff' | 'consultant';
  user_id?: number | null;
  first_name: string;
  last_name: string;
  gender?: string;
  date_of_birth?: string;
  national_id?: string;
  phone?: string;
  email?: string;
  address?: string;
  job_title?: string;
  department?: string;
  hire_date?: string;
  termination_date?: string;
  employment_status: 'active' | 'on_leave' | 'terminated';
  contract_type: 'full_time' | 'part_time' | 'contract';
  bank_name?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  basic_salary: number;
  salary_currency: string;
  pay_frequency: string;
  notes?: string;
  is_active: boolean;
}

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  active: 'success',
  on_leave: 'warning',
  terminated: 'neutral',
};

const CONTRACT_TYPES = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'contract', label: 'Contract' },
];

const emptyForm = (employmentType: 'staff' | 'consultant') => ({
  user_id: '', first_name: '', last_name: '', gender: '', date_of_birth: '', national_id: '', phone: '', email: '', address: '',
  job_title: '', department: '', hire_date: '', contract_type: 'full_time', employment_status: 'active',
  bank_name: '', bank_account_name: '', bank_account_number: '',
  emergency_contact_name: '', emergency_contact_phone: '', notes: '',
  employment_type: employmentType,
});

interface Props {
  employmentType: 'staff' | 'consultant';
  title: string;
  singularLabel: string; // e.g. 'Employee' or 'Consultant/Doctor' — "Consultants & Doctors" doesn't singularize by stripping an 's'
  subtitle: string;
  profileBasePath: string; // e.g. '/hr/employees' or '/hr/consultants'
}

export const EmployeeListPage: React.FC<Props> = ({ employmentType, title, singularLabel, subtitle, profileBasePath }) => {
  const { user } = useAuth();
  const { currency } = useCurrency();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyForm(employmentType));

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/hr/employees?employment_type=${employmentType}`);
      if (res.ok) setEmployees(await res.json());
      else toast.error('Failed to load employees');
    } catch (error) {
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrencies = async () => {
    try {
      const res = await authFetch('/api/currencies');
      if (res.ok) setCurrencies(await res.json());
    } catch (e) { /* non-blocking */ }
  };

  const fetchUsers = async () => {
    try {
      const res = await authFetch('/api/users?all=true');
      if (res.ok) setUsers(await res.json());
    } catch (e) { /* non-blocking */ }
  };

  const fetchDepartments = async () => {
    try {
      const res = await authFetch(`/api/departments?clinic=${user?.clinic || 1}`);
      if (res.ok) setDepartments((await res.json()).filter((d: any) => d.is_active));
    } catch (e) { /* non-blocking */ }
  };

  useEffect(() => { fetchEmployees(); fetchCurrencies(); fetchUsers(); fetchDepartments(); }, [employmentType]);

  // Coming back from the profile page's Edit link (?edit=<id>)
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId && employees.length > 0) {
      const match = employees.find(e => e.id === editId);
      if (match) openEdit(match);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees]);

  const filteredEmployees = useMemo(() => employees.filter(e => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const hay = `${e.first_name} ${e.last_name} ${e.employee_number} ${e.job_title || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (statusFilter !== 'all' && e.employment_status !== statusFilter) return false;
    return true;
  }), [employees, searchQuery, statusFilter]);

  const userOptions = useMemo(() => [
    { value: '', label: '— Not linked —' },
    ...users.filter((u: any) => u.is_active !== false).map((u: any) => ({ value: String(u.id), label: `${u.display_name || u.email} (${u.role})` })),
  ], [users]);

  const departmentOptions = useMemo(() => [
    { value: '', label: '— None —' },
    ...departments.map((d: any) => ({ value: d.department_name, label: d.department_name })),
  ], [departments]);

  const formatInCurrency = (amount: number, code?: string) => {
    const match = currencies.find((c: any) => c.code === code);
    const symbol = match?.symbol || code || currency.symbol || currency.code;
    const decimals = match?.decimal_places ?? currency.decimal_places ?? 2;
    return `${symbol} ${Number(amount || 0).toFixed(decimals)}`;
  };

  const openCreate = () => {
    setEditingEmployee(null);
    setFormData(emptyForm(employmentType));
  };

  const openEdit = (e: Employee) => {
    setEditingEmployee(e);
    setFormData({
      user_id: e.user_id ? String(e.user_id) : '',
      first_name: e.first_name || '', last_name: e.last_name || '', gender: e.gender || '',
      date_of_birth: e.date_of_birth ? e.date_of_birth.split('T')[0] : '', national_id: e.national_id || '',
      phone: e.phone || '', email: e.email || '', address: e.address || '',
      job_title: e.job_title || '', department: e.department || '',
      hire_date: e.hire_date ? e.hire_date.split('T')[0] : '', contract_type: e.contract_type || 'full_time',
      employment_status: e.employment_status || 'active',
      bank_name: e.bank_name || '', bank_account_name: e.bank_account_name || '', bank_account_number: e.bank_account_number || '',
      emergency_contact_name: e.emergency_contact_name || '', emergency_contact_phone: e.emergency_contact_phone || '',
      notes: e.notes || '', employment_type: e.employment_type,
    });
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const url = editingEmployee ? `/api/hr/employees/${editingEmployee.id}` : '/api/hr/employees';
      const method = editingEmployee ? 'PUT' : 'POST';
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save');
      }
      toast.success(editingEmployee ? `${singularLabel} updated` : `${singularLabel} added`);
      openCreate();
      fetchEmployees();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleTermination = async (e: Employee) => {
    if (busyId === e.id) return;
    const terminating = e.employment_status !== 'terminated';
    if (terminating && !confirm(`Terminate ${e.first_name} ${e.last_name}? Their salary structure stays on record, but payroll will no longer include them.`)) return;
    setBusyId(e.id);
    try {
      const res = await authFetch(`/api/hr/employees/${e.id}/${terminating ? 'terminate' : 'reactivate'}`, { method: 'POST' });
      if (res.ok) {
        toast.success(terminating ? 'Employee terminated' : 'Employee reactivated');
        fetchEmployees();
      } else {
        toast.error('Failed to update status');
      }
    } catch (error) {
      toast.error('Failed to update status');
    } finally {
      setBusyId(null);
    }
  };

  const handleExportCSV = () => {
    if (filteredEmployees.length === 0) { toast.error(`No ${title.toLowerCase()} to export`); return; }
    exportCSV(filteredEmployees, [
      { header: 'Employee No.', key: 'employee_number' },
      { header: 'First Name', key: 'first_name' },
      { header: 'Last Name', key: 'last_name' },
      { header: 'Job Title', key: 'job_title' },
      { header: 'Department', key: 'department' },
      { header: 'Phone', key: 'phone' },
      { header: 'Email', key: 'email' },
      { header: 'Basic Salary', key: 'basic_salary' },
      { header: 'Currency', key: 'salary_currency' },
      { header: 'Status', key: 'employment_status' },
    ], `${employmentType}s.csv`);
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader icon={employmentType === 'consultant' ? <Stethoscope /> : <Users />} title={title} subtitle={subtitle} />

        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex justify-between items-center flex-shrink-0">
            <h3 className="font-medium flex items-center gap-2">
              {editingEmployee ? `Edit — ${editingEmployee.first_name} ${editingEmployee.last_name}` : `Add New ${singularLabel}`}
            </h3>
            {editingEmployee && (
              <Button variant="ghost" size="sm" onClick={openCreate}>
                <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
              </Button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-auto">
            {employmentType === 'consultant' ? (
              <div className="p-4">
                <div className="border rounded-lg p-4 space-y-3 bg-card max-w-2xl">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{singularLabel} Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><Label className="text-xs font-medium text-muted-foreground">First Name *</Label><Input className="mt-1" value={formData.first_name} onChange={e => setFormData({ ...formData, first_name: e.target.value })} required /></div>
                    <div><Label className="text-xs font-medium text-muted-foreground">Last Name *</Label><Input className="mt-1" value={formData.last_name} onChange={e => setFormData({ ...formData, last_name: e.target.value })} required /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><Label className="text-xs font-medium text-muted-foreground">Specialty</Label><Input className="mt-1" placeholder="e.g. Cardiology" value={formData.job_title} onChange={e => setFormData({ ...formData, job_title: e.target.value })} /></div>
                    <div><Label className="text-xs font-medium text-muted-foreground">Date of Birth</Label><Input type="date" className="mt-1" value={formData.date_of_birth} onChange={e => setFormData({ ...formData, date_of_birth: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><Label className="text-xs font-medium text-muted-foreground">Phone Number</Label><Input className="mt-1" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Link to User Account</Label>
                      <Combobox options={userOptions} value={formData.user_id} onChange={v => setFormData({ ...formData, user_id: v })} searchPlaceholder="Search users..." className="mt-1" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="border rounded-lg p-3 space-y-3 bg-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basic Information</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs font-medium text-muted-foreground">First Name *</Label><Input className="mt-1" value={formData.first_name} onChange={e => setFormData({ ...formData, first_name: e.target.value })} required /></div>
                  <div><Label className="text-xs font-medium text-muted-foreground">Last Name *</Label><Input className="mt-1" value={formData.last_name} onChange={e => setFormData({ ...formData, last_name: e.target.value })} required /></div>
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Gender</Label>
                  <Combobox options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }]} value={formData.gender} onChange={v => setFormData({ ...formData, gender: v })} searchPlaceholder="Search..." className="mt-1" />
                </div>
                <div><Label className="text-xs font-medium text-muted-foreground">Date of Birth</Label><Input type="date" className="mt-1" value={formData.date_of_birth} onChange={e => setFormData({ ...formData, date_of_birth: e.target.value })} /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">National ID</Label><Input className="mt-1" value={formData.national_id} onChange={e => setFormData({ ...formData, national_id: e.target.value })} /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">Phone</Label><Input className="mt-1" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">Email</Label><Input type="email" className="mt-1" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">Address</Label><Textarea className="mt-1" rows={2} value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} /></div>
              </div>

              <div className="border rounded-lg p-3 space-y-3 bg-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Employment Details</p>
                <div><Label className="text-xs font-medium text-muted-foreground">Job Title</Label><Input className="mt-1" value={formData.job_title} onChange={e => setFormData({ ...formData, job_title: e.target.value })} /></div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Department</Label>
                  <Combobox options={departmentOptions} value={formData.department} onChange={v => setFormData({ ...formData, department: v })} searchPlaceholder="Search departments..." emptyText="No departments yet — add one under Setup > Departments." className="mt-1" />
                </div>
                <div><Label className="text-xs font-medium text-muted-foreground">Hire Date</Label><Input type="date" className="mt-1" value={formData.hire_date} onChange={e => setFormData({ ...formData, hire_date: e.target.value })} /></div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Contract Type</Label>
                  <Combobox options={CONTRACT_TYPES} value={formData.contract_type} onChange={v => setFormData({ ...formData, contract_type: v })} searchPlaceholder="Search..." className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Status</Label>
                  <Combobox options={[{ value: 'active', label: 'Active' }, { value: 'on_leave', label: 'On Leave' }, { value: 'terminated', label: 'Terminated' }]} value={formData.employment_status} onChange={v => setFormData({ ...formData, employment_status: v })} searchPlaceholder="Search..." className="mt-1" />
                </div>
                <div className="pt-1 border-t">
                  <Label className="text-xs font-medium text-muted-foreground">Link to User Account</Label>
                  <Combobox options={userOptions} value={formData.user_id} onChange={v => setFormData({ ...formData, user_id: v })} searchPlaceholder="Search users..." className="mt-1" />
                </div>
              </div>

              <div className="border rounded-lg p-3 space-y-3 bg-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bank Details</p>
                <div><Label className="text-xs font-medium text-muted-foreground">Bank Name</Label><Input className="mt-1" value={formData.bank_name} onChange={e => setFormData({ ...formData, bank_name: e.target.value })} /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">Account Name</Label><Input className="mt-1" value={formData.bank_account_name} onChange={e => setFormData({ ...formData, bank_account_name: e.target.value })} /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">Account Number</Label><Input className="mt-1" value={formData.bank_account_number} onChange={e => setFormData({ ...formData, bank_account_number: e.target.value })} /></div>
                <div className="pt-1 border-t">
                  <Label className="text-xs font-medium text-muted-foreground">Emergency Contact Name</Label>
                  <Input className="mt-1" value={formData.emergency_contact_name} onChange={e => setFormData({ ...formData, emergency_contact_name: e.target.value })} />
                </div>
                <div><Label className="text-xs font-medium text-muted-foreground">Emergency Contact Phone</Label><Input className="mt-1" value={formData.emergency_contact_phone} onChange={e => setFormData({ ...formData, emergency_contact_phone: e.target.value })} /></div>
                <div className="pt-1 border-t">
                  <Label className="text-xs font-medium text-muted-foreground">Notes</Label>
                  <Textarea className="mt-1 text-sm" rows={2} value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
                </div>
              </div>
              <p className="lg:col-span-3 text-xs text-muted-foreground -mt-1">Salary is set from the Salary Structures page after the {singularLabel.toLowerCase()} is added.</p>
            </div>
            )}

            <div className="p-4 border-t bg-muted flex justify-end gap-2 sticky bottom-0">
              <Button type="submit" size="sm" className="px-6" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {saving ? (editingEmployee ? 'Updating...' : 'Adding...') : (editingEmployee ? `Update ${singularLabel}` : `Add ${singularLabel}`)}
              </Button>
            </div>
          </form>
        </div>

        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
            <h3 className="font-medium">{title}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input className="pl-8 h-9" placeholder={`Search ${title.toLowerCase()}...`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
              <Combobox
                options={[{ value: 'all', label: 'All Status' }, { value: 'active', label: 'Active' }, { value: 'on_leave', label: 'On Leave' }, { value: 'terminated', label: 'Terminated' }]}
                value={statusFilter} onChange={setStatusFilter} searchPlaceholder="Search..." className="w-[150px] h-9"
              />
              <Button type="button" variant="outline" onClick={handleExportCSV} className="gap-1.5 h-9">
                <FileSpreadsheet className="w-4 h-4" /> Export CSV
              </Button>
            </div>
          </div>

          <div className="p-4">
            <AdvancedDataTable<Employee>
              data={filteredEmployees}
              keyExtractor={(e) => e.id}
              loading={loading}
              emptyMessage={searchQuery || statusFilter !== 'all' ? `No ${title.toLowerCase()} match your filters` : `No ${title.toLowerCase()} yet. Use the form above to add one.`}
              onRowClick={(e) => openEdit(e)}
              rowClassName={(e) => editingEmployee?.id === e.id ? 'bg-primary/5' : ''}
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'employee_number', header: 'ID', render: (v) => <span className="font-mono text-xs text-muted-foreground">{v}</span> },
                { key: 'first_name', header: 'Name', sortable: true, render: (_v, e) => <p className="font-medium">{e.first_name} {e.last_name}</p> },
                { key: 'job_title', header: 'Job Title', render: (v) => v || '—' },
                { key: 'department', header: 'Department', render: (v) => v || '—' },
                { key: 'phone', header: 'Phone', render: (v) => v || '—' },
                { key: 'basic_salary', header: 'Salary', align: 'right', sortable: true, render: (v, e) => <span className="font-mono">{formatInCurrency(v, e.salary_currency)}</span> },
                {
                  key: '__status', header: 'Status', align: 'center',
                  render: (_v, e) => <StatusBadge status={e.employment_status} label={e.employment_status.replace('_', ' ')} map={STATUS_TONE} />,
                },
                {
                  key: '__actions', header: 'Actions', align: 'center',
                  render: (_v, e) => (
                    <div className="flex items-center justify-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(ev) => { ev.stopPropagation(); navigate(`${profileBasePath}/${e.id}`); }}><Eye className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}><Edit className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(ev) => { ev.stopPropagation(); toggleTermination(e); }} disabled={busyId === e.id}>
                        {busyId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (e.employment_status === 'terminated' ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Ban className="w-3.5 h-3.5 text-amber-600" />)}
                      </Button>
                    </div>
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
};
