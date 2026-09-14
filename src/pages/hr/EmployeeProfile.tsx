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
import {
  Users, Edit, Phone, Mail, MapPin, Loader2, Check, Plus, Trash2,
  ArrowLeft, Wallet, Calendar, Landmark, Stethoscope,
} from 'lucide-react';

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  active: 'success',
  on_leave: 'warning',
  terminated: 'neutral',
};

export default function EmployeeProfile() {
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

  useEffect(() => { fetchEmployee(); fetchCurrencies(); }, [id]);

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
    if (!confirm('Remove this salary component?')) return;
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

              <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Salary Structure</h3>
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
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
