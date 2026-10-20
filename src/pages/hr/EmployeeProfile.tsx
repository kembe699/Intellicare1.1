import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, LoadingState, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import {
  Users, Edit, Phone, Mail, MapPin, Loader2, Check, Plus, Trash2,
  ArrowLeft, Wallet, Calendar, Landmark, Stethoscope, RefreshCw, Percent, Receipt,
} from 'lucide-react';

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  active: 'success',
  on_leave: 'warning',
  terminated: 'neutral',
};

export default function EmployeeProfile() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currency } = useCurrency();

  const [employee, setEmployee] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<any[]>([]);

  const [showAddComponent, setShowAddComponent] = useState(false);
  const [componentForm, setComponentForm] = useState({ component_type: 'allowance', name: '', amount: '', is_percentage: false, account_code: '' });
  const [savingComponent, setSavingComponent] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [salaryStructures, setSalaryStructures] = useState<any[]>([]);
  const [showChangeStructure, setShowChangeStructure] = useState(false);
  const [selectedStructureId, setSelectedStructureId] = useState('');
  const [savingStructure, setSavingStructure] = useState(false);

  const fetchSalaryStructures = async () => {
    try {
      const res = await authFetch('/api/hr/salary-structures');
      if (res.ok) setSalaryStructures(await res.json());
    } catch (e) { /* non-blocking */ }
  };

  const handleAssignStructure = async () => {
    if (!id || !selectedStructureId || savingStructure) return;
    setSavingStructure(true);
    try {
      const res = await authFetch(`/api/hr/salary-structures/${selectedStructureId}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_ids: [id] }),
      });
      if (res.ok) {
        toast.success('Salary structure assigned');
        setShowChangeStructure(false);
        setSelectedStructureId('');
        fetchEmployee();
      } else {
        toast.error('Failed to assign salary structure');
      }
    } catch (e) {
      toast.error('Failed to assign salary structure');
    } finally {
      setSavingStructure(false);
    }
  };

  const handleUnassignStructure = async () => {
    if (!id || savingStructure) return;
    if (!(await confirm({ description: "Remove this employee's assigned salary structure? Their current basic salary and components stay as-is — only the link to the template is cleared." }))) return;
    setSavingStructure(true);
    try {
      const res = await authFetch(`/api/hr/employees/${id}/unassign-salary-structure`, { method: 'POST' });
      if (res.ok) {
        toast.success('Salary structure removed');
        fetchEmployee();
      } else {
        toast.error('Failed to remove salary structure');
      }
    } catch (e) {
      toast.error('Failed to remove salary structure');
    } finally {
      setSavingStructure(false);
    }
  };

  const last30 = () => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().split('T')[0]; };
  const todayStr = () => new Date().toISOString().split('T')[0];
  const [consultFrom, setConsultFrom] = useState(last30);
  const [consultTo, setConsultTo] = useState(todayStr);
  const [consultTrace, setConsultTrace] = useState<any>(null);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [billCurrency, setBillCurrency] = useState('');
  const [creatingBill, setCreatingBill] = useState(false);
  const [consultantBills, setConsultantBills] = useState<any[]>([]);

  const fetchConsultations = async () => {
    if (!id) return;
    setLoadingTrace(true);
    try {
      const res = await authFetch(`/api/hr/consultants/${id}/consultations?from=${consultFrom}&to=${consultTo}`);
      if (res.ok) {
        const data = await res.json();
        setConsultTrace(data);
        const currencies = Object.keys(data.billable || {});
        if (currencies.length && !billCurrency) setBillCurrency(currencies[0]);
      }
    } catch (e) { /* non-blocking */ }
    finally { setLoadingTrace(false); }
  };

  const fetchConsultantBills = async () => {
    if (!id) return;
    try {
      const res = await authFetch(`/api/hr/consultants/${id}/bills`);
      if (res.ok) setConsultantBills(await res.json());
    } catch (e) { /* non-blocking */ }
  };

  const handleCreateBill = async () => {
    if (!id || creatingBill || !billCurrency) return;
    if (!(await confirm({ description: `Create a consultant bill for ${billCurrency} ${consultTrace?.billable?.[billCurrency]?.collected?.toFixed(2)} × ${employee.consultation_fee_percentage}%?` }))) return;
    setCreatingBill(true);
    try {
      const res = await authFetch(`/api/hr/consultants/${id}/bills`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_from: consultFrom, period_to: consultTo, currency: billCurrency }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to create bill'); return; }
      toast.success(`Consultant bill ${data.bill_number} created — pay it from Expenses > Consultant Bills`);
      fetchConsultations();
      fetchConsultantBills();
    } catch (e) {
      toast.error('Failed to create bill');
    } finally {
      setCreatingBill(false);
    }
  };

  const fetchEmployee = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/hr/employees/${id}`);
      if (!res.ok) { setError('Employee not found'); return; }
      setEmployee(await res.json());
    } catch (e) {
      setError('Failed to load employee');
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

  useEffect(() => { fetchEmployee(); fetchCurrencies(); fetchSalaryStructures(); }, [id]);

  useEffect(() => {
    if (employee?.employment_type === 'consultant') {
      fetchConsultations();
      fetchConsultantBills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.employment_type, consultFrom, consultTo]);

  const formatInCurrency = (amount: number, code?: string) => {
    const match = currencies.find((c: any) => c.code === code);
    const symbol = match?.symbol || code || currency.symbol || currency.code;
    const decimals = match?.decimal_places ?? currency.decimal_places ?? 2;
    return `${symbol} ${Number(amount || 0).toFixed(decimals)}`;
  };

  const listPath = employee?.employment_type === 'consultant' ? '/hr/consultants' : '/hr/employees';
  const roleLabel = employee?.employment_type === 'consultant' ? 'Consultant' : 'Employee';

  const handleAddComponent = async () => {
    if (savingComponent || !employee) return;
    if (!componentForm.name.trim()) { toast.error('Enter a name for this component'); return; }
    const amt = parseFloat(componentForm.amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setSavingComponent(true);
    try {
      const res = await authFetch(`/api/hr/employees/${employee.id}/salary-components`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...componentForm, amount: amt }),
      });
      if (res.ok) {
        toast.success(`${componentForm.component_type === 'allowance' ? 'Allowance' : 'Deduction'} added`);
        setShowAddComponent(false);
        setComponentForm({ component_type: 'allowance', name: '', amount: '', is_percentage: false, account_code: '' });
        fetchEmployee();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to add component');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setSavingComponent(false);
    }
  };

  const handleRemoveComponent = async (componentId: string) => {
    if (removingId) return;
    if (!(await confirm({ description: 'Remove this salary component?' }))) return;
    setRemovingId(componentId);
    try {
      const res = await authFetch(`/api/hr/salary-components/${componentId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Component removed');
        fetchEmployee();
      } else {
        toast.error('Failed to remove component');
      }
    } catch (e) {
      toast.error('Failed to remove component');
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return (<AppLayout><div className="p-6"><LoadingState /></div></AppLayout>);
  }

  if (error || !employee) {
    return (
      <AppLayout>
        <div className="p-6 space-y-4">
          <Button variant="outline" onClick={() => navigate('/hr/employees')}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <div className="text-center text-muted-foreground py-12">{error || 'Employee not found'}</div>
        </div>
      </AppLayout>
    );
  }

  const allowances = (employee.salary_components || []).filter((c: any) => c.component_type === 'allowance');
  const deductions = (employee.salary_components || []).filter((c: any) => c.component_type === 'deduction');
  const allowancesTotal = allowances.reduce((s: number, c: any) => s + (c.is_percentage ? employee.basic_salary * c.amount / 100 : parseFloat(c.amount)), 0);
  const deductionsTotal = deductions.reduce((s: number, c: any) => s + (c.is_percentage ? employee.basic_salary * c.amount / 100 : parseFloat(c.amount)), 0);
  const grossPay = parseFloat(employee.basic_salary) + allowancesTotal;
  const netPay = grossPay - deductionsTotal;

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)]">
        <div className="max-w-[1700px] mx-auto space-y-4">
          <PageHeader
            icon={employee.employment_type === 'consultant' ? <Stethoscope /> : <Users />}
            title={`${roleLabel} Profile`}
            subtitle="Personal details, salary structure, and payroll history"
            actions={
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate(listPath)}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back
                </Button>
                <Link to={`${listPath}?edit=${employee.id}`}>
                  <Button variant="outline" size="sm"><Edit className="w-4 h-4 mr-2" /> Edit</Button>
                </Link>
              </div>
            }
          />

          <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
            <div className="space-y-4">
              <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    {employee.employment_type === 'consultant' ? <Stethoscope className="w-5 h-5 text-primary" /> : <Users className="w-5 h-5 text-primary" />}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold leading-tight">{employee.first_name} {employee.last_name}</h2>
                    <p className="text-sm text-muted-foreground font-mono">{employee.employee_number}</p>
                  </div>
                </div>
                <StatusBadge status={employee.employment_status} label={employee.employment_status.replace('_', ' ')} map={STATUS_TONE} />

                <div className="space-y-2.5 text-sm border-t pt-4">
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground shrink-0" />{employee.phone || '—'}</div>
                  <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground shrink-0" />{employee.email || '—'}</div>
                  <div className="flex items-start gap-2"><MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />{employee.address || '—'}</div>
                </div>

                <div className="space-y-2 border-t pt-4 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Job Title</span><span>{employee.job_title || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Department</span><span>{employee.department || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Contract</span><span className="capitalize">{(employee.contract_type || '').replace('_', ' ')}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Hire Date</span><span>{employee.hire_date ? new Date(employee.hire_date).toLocaleDateString() : '—'}</span></div>
                  {employee.termination_date && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Termination Date</span><span>{new Date(employee.termination_date).toLocaleDateString()}</span></div>
                  )}
                </div>

                <div className="space-y-2 border-t pt-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Landmark className="w-3.5 h-3.5" /> Bank Details</p>
                  <div className="flex justify-between"><span className="text-muted-foreground">Bank</span><span>{employee.bank_name || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Account Name</span><span>{employee.bank_account_name || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Account No.</span><span className="font-mono">{employee.bank_account_number || '—'}</span></div>
                </div>

                {employee.emergency_contact_name && (
                  <div className="space-y-2 border-t pt-4 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Emergency Contact</p>
                    <div className="flex justify-between"><span className="text-muted-foreground">{employee.emergency_contact_name}</span><span>{employee.emergency_contact_phone || ''}</span></div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4 min-w-0">
              {employee.employment_type === 'consultant' ? (
                <>
                  <div className="bg-card rounded-lg border shadow-sm p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Consultation Fee</p>
                      <p className="text-xl font-bold font-mono flex items-center gap-1">
                        {employee.consultation_fee_percentage != null ? `${employee.consultation_fee_percentage}%` : <span className="text-sm text-muted-foreground italic font-sans">Not set — set it from the Consultants list</span>}
                      </p>
                    </div>
                    <Percent className="w-8 h-8 text-primary/30" />
                  </div>

                  <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-medium flex items-center gap-2"><Stethoscope className="w-4 h-4 text-primary" /> Consultations &amp; Billing</h3>
                      <div className="flex items-center gap-2">
                        <Input type="date" className="h-8 w-[9.5rem] text-sm" value={consultFrom} max={consultTo} onChange={e => setConsultFrom(e.target.value)} />
                        <span className="text-muted-foreground text-xs">to</span>
                        <Input type="date" className="h-8 w-[9.5rem] text-sm" value={consultTo} min={consultFrom} onChange={e => setConsultTo(e.target.value)} />
                        <Button size="sm" variant="outline" className="h-8" onClick={fetchConsultations} disabled={loadingTrace}>
                          {loadingTrace ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Consultations are matched from lab/visit records to patient bills by same patient + same day — the same best-effort method used in the Doctor Performance report. A visit with no matching bill, or a bill shared with another provider that day, may under- or over-count slightly.
                    </p>

                    {loadingTrace ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
                    ) : (consultTrace?.consultations || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">No consultations found in this period.</p>
                    ) : (
                      <>
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left text-muted-foreground text-xs">
                              <th className="px-3 py-2 font-medium">Date</th>
                              <th className="px-3 py-2 font-medium text-right">Billed</th>
                              <th className="px-3 py-2 font-medium text-right">Collected</th>
                              <th className="px-3 py-2 font-medium text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {consultTrace.consultations.map((c: any, i: number) => (
                              <tr key={i}>
                                <td className="px-3 py-2">{new Date(c.visit_date).toLocaleDateString()}{c.shared && <span className="ml-1.5 text-xs text-amber-600" title="Split with another provider seen the same day">split</span>}</td>
                                <td className="px-3 py-2 text-right font-mono">{c.currency} {c.billed_amount.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right font-mono font-medium">{c.currency} {c.collected_amount.toFixed(2)}</td>
                                <td className="px-3 py-2 text-center">
                                  {c.already_billed
                                    ? <span className="text-xs text-muted-foreground">already billed</span>
                                    : <span className="text-xs text-emerald-700">billable</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Create Consultant Bill</p>
                          {Object.keys(consultTrace.billable || {}).length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nothing unbilled for this period.</p>
                          ) : (
                            <>
                              <div className="flex items-center gap-3 flex-wrap">
                                <Combobox
                                  options={Object.keys(consultTrace.billable).map(cur => ({ value: cur, label: `${cur} — ${consultTrace.billable[cur].collected.toFixed(2)} collected` }))}
                                  value={billCurrency} onChange={setBillCurrency} searchPlaceholder="Search..." className="w-64 h-9"
                                />
                                <span className="text-sm text-muted-foreground">
                                  × {employee.consultation_fee_percentage ?? '—'}% ={' '}
                                  <strong className="text-foreground font-mono">
                                    {billCurrency && employee.consultation_fee_percentage
                                      ? `${billCurrency} ${(consultTrace.billable[billCurrency].collected * employee.consultation_fee_percentage / 100).toFixed(2)}`
                                      : '—'}
                                  </strong>
                                </span>
                              </div>
                              <Button size="sm" onClick={handleCreateBill} disabled={creatingBill || !employee.consultation_fee_percentage || !billCurrency}>
                                {creatingBill ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Receipt className="w-4 h-4 mr-2" />}
                                Create Bill
                              </Button>
                              {!employee.consultation_fee_percentage && <p className="text-xs text-amber-600">Set this consultant's fee % from the Consultants list before creating a bill.</p>}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="bg-card rounded-lg border shadow-sm p-5 space-y-3">
                    <h3 className="font-medium flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" /> Billing History</h3>
                    {consultantBills.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No consultant bills yet.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                          <tr className="text-left text-muted-foreground text-xs">
                            <th className="px-3 py-2 font-medium">Bill No.</th>
                            <th className="px-3 py-2 font-medium">Period</th>
                            <th className="px-3 py-2 font-medium text-right">Amount</th>
                            <th className="px-3 py-2 font-medium text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {consultantBills.map((b: any) => (
                            <tr key={b.id}>
                              <td className="px-3 py-2 font-mono text-primary">{b.bill_number}</td>
                              <td className="px-3 py-2">{new Date(b.period_from).toLocaleDateString()} – {new Date(b.period_to).toLocaleDateString()}</td>
                              <td className="px-3 py-2 text-right font-mono">{b.currency} {parseFloat(b.bill_amount).toFixed(2)}</td>
                              <td className="px-3 py-2 text-center capitalize">{b.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              ) : (
              <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-card rounded-lg border shadow-sm p-4">
                  <p className="text-xs text-muted-foreground mb-1">Basic Salary</p>
                  <p className="text-xl font-bold font-mono">{formatInCurrency(employee.basic_salary, employee.salary_currency)}</p>
                </div>
                <div className="bg-card rounded-lg border shadow-sm p-4">
                  <p className="text-xs text-muted-foreground mb-1">Gross Pay</p>
                  <p className="text-xl font-bold font-mono text-primary">{formatInCurrency(grossPay, employee.salary_currency)}</p>
                </div>
                <div className="bg-card rounded-lg border shadow-sm p-4">
                  <p className="text-xs text-muted-foreground mb-1">Net Pay</p>
                  <p className="text-xl font-bold font-mono text-emerald-700">{formatInCurrency(netPay, employee.salary_currency)}</p>
                </div>
              </div>

              <div className="bg-card rounded-lg border shadow-sm p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-medium flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Assigned Salary Structure</h3>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setShowChangeStructure(v => !v); setSelectedStructureId(employee.salary_structure?.id || ''); }}>
                      {employee.salary_structure ? 'Change' : 'Assign'}
                    </Button>
                    {employee.salary_structure && (
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleUnassignStructure} disabled={savingStructure}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                {employee.salary_structure ? (
                  <div className="flex items-center justify-between text-sm bg-muted/30 rounded-md p-3">
                    <div>
                      <p className="font-medium">{employee.salary_structure.name}</p>
                      <p className="text-xs text-muted-foreground">{employee.salary_structure.pay_frequency}</p>
                    </div>
                    <p className="font-mono font-semibold">{formatInCurrency(employee.salary_structure.basic_salary, employee.salary_structure.currency)}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No structure assigned — this employee's pay is set individually.</p>
                )}
                {showChangeStructure && (
                  <div className="flex items-center gap-2 pt-1">
                    <Combobox
                      options={salaryStructures.map((s: any) => ({ value: s.id, label: `${s.name} — ${formatInCurrency(s.basic_salary, s.currency)}` }))}
                      value={selectedStructureId} onChange={setSelectedStructureId}
                      placeholder="Select a structure..." searchPlaceholder="Search..." className="flex-1"
                    />
                    <Button size="sm" onClick={handleAssignStructure} disabled={!selectedStructureId || savingStructure}>
                      {savingStructure ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowChangeStructure(false)}>Cancel</Button>
                  </div>
                )}
              </div>

              <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Allowances &amp; Deductions</h3>
                  <Button size="sm" variant="outline" onClick={() => setShowAddComponent(v => !v)}>
                    <Plus className="w-4 h-4 mr-2" /> Add Component
                  </Button>
                </div>

                {showAddComponent && (
                  <div className="p-4 rounded-lg border bg-muted/20 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">Type</Label>
                        <Combobox
                          options={[{ value: 'allowance', label: 'Allowance' }, { value: 'deduction', label: 'Deduction' }]}
                          value={componentForm.component_type}
                          onChange={v => setComponentForm({ ...componentForm, component_type: v })}
                          searchPlaceholder="Search..." className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">Name</Label>
                        <Input className="mt-1" placeholder="e.g. Housing Allowance" value={componentForm.name} onChange={e => setComponentForm({ ...componentForm, name: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">Amount {componentForm.is_percentage ? '(%)' : `(${employee.salary_currency})`}</Label>
                        <Input type="number" step="0.01" min="0" className="mt-1" value={componentForm.amount} onChange={e => setComponentForm({ ...componentForm, amount: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">GL Account Code (optional)</Label>
                        <Input className="mt-1" placeholder="e.g. 2200" value={componentForm.account_code} onChange={e => setComponentForm({ ...componentForm, account_code: e.target.value })} />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer w-fit">
                      <input type="checkbox" checked={componentForm.is_percentage} onChange={e => setComponentForm({ ...componentForm, is_percentage: e.target.checked })} className="rounded" />
                      Percentage of basic salary
                    </label>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setShowAddComponent(false)}>Cancel</Button>
                      <Button size="sm" onClick={handleAddComponent} disabled={savingComponent}>
                        {savingComponent ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                        Save
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Allowances</p>
                    {allowances.length === 0 ? (
                      <p className="text-sm text-muted-foreground">None</p>
                    ) : (
                      <div className="space-y-1.5">
                        {allowances.map((c: any) => (
                          <div key={c.id} className="flex items-center justify-between text-sm p-2 rounded border bg-emerald-50/50">
                            <span>{c.name}{c.is_percentage ? ` (${c.amount}%)` : ''}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-medium">{c.is_percentage ? formatInCurrency(employee.basic_salary * c.amount / 100, employee.salary_currency) : formatInCurrency(c.amount, employee.salary_currency)}</span>
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleRemoveComponent(c.id)} disabled={removingId === c.id}>
                                <Trash2 className="w-3 h-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Deductions</p>
                    {deductions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">None</p>
                    ) : (
                      <div className="space-y-1.5">
                        {deductions.map((c: any) => (
                          <div key={c.id} className="flex items-center justify-between text-sm p-2 rounded border bg-amber-50/50">
                            <span>{c.name}{c.is_percentage ? ` (${c.amount}%)` : ''}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-medium">{c.is_percentage ? formatInCurrency(employee.basic_salary * c.amount / 100, employee.salary_currency) : formatInCurrency(c.amount, employee.salary_currency)}</span>
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleRemoveComponent(c.id)} disabled={removingId === c.id}>
                                <Trash2 className="w-3 h-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-card rounded-lg border shadow-sm p-5 space-y-3">
                <h3 className="font-medium flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> Payroll History</h3>
                {(employee.payroll_history || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No payroll runs yet for this {roleLabel.toLowerCase()}.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr className="text-left text-muted-foreground text-xs">
                        <th className="px-3 py-2 font-medium">Run</th>
                        <th className="px-3 py-2 font-medium">Period</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium text-right">Gross</th>
                        <th className="px-3 py-2 font-medium text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {employee.payroll_history.map((h: any) => (
                        <tr key={h.id}>
                          <td className="px-3 py-2 font-mono text-primary">{h.run_number}</td>
                          <td className="px-3 py-2">{h.period_month}/{h.period_year}</td>
                          <td className="px-3 py-2 capitalize">{h.status}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatInCurrency(h.gross_pay, h.currency)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatInCurrency(h.net_pay, h.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
