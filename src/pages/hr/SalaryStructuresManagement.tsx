import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/lib/notify';
import { Wallet, Plus, Trash2, Loader2, Check, X, Users2, Edit } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface SalaryStructure {
  id: string;
  name: string;
  description?: string;
  basic_salary: number;
  currency: string;
  pay_frequency: string;
  component_count: number;
}

interface Component {
  id: string;
  component_type: 'allowance' | 'deduction';
  name: string;
  amount: number;
  is_percentage: boolean;
  account_code?: string;
}

const emptyForm = (currencyCode: string) => ({ name: '', description: '', basic_salary: '0', currency: currencyCode, pay_frequency: 'monthly' });

export default function SalaryStructuresManagement() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { currency } = useCurrency();
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<SalaryStructure | null>(null);
  const [form, setForm] = useState(emptyForm(currency.code));

  const [components, setComponents] = useState<Component[]>([]);
  const [showAddComponent, setShowAddComponent] = useState(false);
  const [componentForm, setComponentForm] = useState({ component_type: 'allowance', name: '', amount: '', is_percentage: false, account_code: '' });
  const [savingComponent, setSavingComponent] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [assignTarget, setAssignTarget] = useState<SalaryStructure | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);

  const fetchStructures = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/hr/salary-structures');
      if (res.ok) setStructures(await res.json());
      else toast.error('Failed to load salary structures');
    } catch (e) {
      toast.error('Failed to load salary structures');
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

  useEffect(() => { fetchStructures(); fetchCurrencies(); }, []);

  const openCreate = () => {
    setEditing(null);
    setComponents([]);
    setForm(emptyForm(currency.code));
  };

  const openEdit = async (s: SalaryStructure) => {
    setEditing(s);
    setForm({ name: s.name, description: s.description || '', basic_salary: String(s.basic_salary), currency: s.currency, pay_frequency: s.pay_frequency });
    try {
      const res = await authFetch(`/api/hr/salary-structures/${s.id}`);
      if (res.ok) setComponents((await res.json()).components || []);
    } catch (e) { /* non-blocking */ }
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    if (!form.name.trim()) { toast.error('Enter a name for this structure'); return; }
    setSaving(true);
    try {
      const url = editing ? `/api/hr/salary-structures/${editing.id}` : '/api/hr/salary-structures';
      const method = editing ? 'PUT' : 'POST';
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save');
      }
      const saved = await res.json();
      toast.success(editing ? 'Salary structure updated' : 'Salary structure created — now add its allowances/deductions below');
      setEditing(saved);
      fetchStructures();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: SalaryStructure) => {
    if (!(await confirm({ description: `Delete the "${s.name}" salary structure? Employees already assigned it keep their current salary — this only removes the template.` }))) return;
    try {
      const res = await authFetch(`/api/hr/salary-structures/${s.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Salary structure removed');
        if (editing?.id === s.id) openCreate();
        fetchStructures();
      } else {
        toast.error('Failed to remove salary structure');
      }
    } catch (e) {
      toast.error('Failed to remove salary structure');
    }
  };

  const handleAddComponent = async () => {
    if (savingComponent || !editing) return;
    if (!componentForm.name.trim()) { toast.error('Enter a name for this component'); return; }
    const amt = parseFloat(componentForm.amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setSavingComponent(true);
    try {
      const res = await authFetch(`/api/hr/salary-structures/${editing.id}/components`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...componentForm, amount: amt }),
      });
      if (res.ok) {
        toast.success(`${componentForm.component_type === 'allowance' ? 'Allowance' : 'Deduction'} added`);
        setShowAddComponent(false);
        setComponentForm({ component_type: 'allowance', name: '', amount: '', is_percentage: false, account_code: '' });
        openEdit(editing);
        fetchStructures();
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
    if (removingId || !editing) return;
    setRemovingId(componentId);
    try {
      const res = await authFetch(`/api/hr/salary-structure-components/${componentId}`, { method: 'DELETE' });
      if (res.ok) {
        setComponents(cs => cs.filter(c => c.id !== componentId));
        fetchStructures();
      } else {
        toast.error('Failed to remove component');
      }
    } catch (e) {
      toast.error('Failed to remove component');
    } finally {
      setRemovingId(null);
    }
  };

  const openAssign = async (s: SalaryStructure) => {
    setAssignTarget(s);
    setSelectedEmployeeIds([]);
    try {
      const res = await authFetch('/api/hr/employees');
      if (res.ok) setEmployees((await res.json()).filter((e: any) => e.employment_status === 'active'));
    } catch (e) { /* non-blocking */ }
  };

  const handleAssign = async () => {
    if (!assignTarget || assigning) return;
    if (selectedEmployeeIds.length === 0) { toast.error('Select at least one employee'); return; }
    setAssigning(true);
    try {
      const res = await authFetch(`/api/hr/salary-structures/${assignTarget.id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_ids: selectedEmployeeIds }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(`Applied "${assignTarget.name}" to ${result.applied_to} employee(s)`);
        setAssignTarget(null);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to assign');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setAssigning(false);
    }
  };

  const formatAmount = (amt: number, code: string) => {
    const match = currencies.find((c: any) => c.code === code);
    const symbol = match?.symbol || code;
    return `${symbol} ${Number(amt || 0).toFixed(match?.decimal_places ?? 2)}`;
  };

  const allowances = components.filter(c => c.component_type === 'allowance');
  const deductions = components.filter(c => c.component_type === 'deduction');

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader icon={<Wallet />} title="Salary Structures" subtitle="Define standard pay templates once, then assign them to employees or consultants" />

        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
            <h3 className="font-medium">{editing ? `Edit — ${editing.name}` : 'Add New Salary Structure'}</h3>
            {editing && (
              <Button variant="ghost" size="sm" onClick={openCreate}>
                <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
              </Button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              <div className="lg:col-span-2">
                <Label className="text-xs font-medium text-muted-foreground">Name *</Label>
                <Input className="mt-1" placeholder="e.g. Standard Nurse Grade II" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Basic Salary</Label>
                <Input type="number" step="0.01" min="0" className="mt-1" value={form.basic_salary} onChange={e => setForm({ ...form, basic_salary: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Currency</Label>
                <Combobox options={(currencies.length ? currencies : [{ code: currency.code }]).map((c: any) => ({ value: c.code, label: c.code }))} value={form.currency} onChange={v => setForm({ ...form, currency: v })} searchPlaceholder="Search..." className="mt-1" />
              </div>
              <div className="lg:col-span-3">
                <Label className="text-xs font-medium text-muted-foreground">Description</Label>
                <Textarea className="mt-1" rows={1} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Pay Frequency</Label>
                <Combobox options={[{ value: 'monthly', label: 'Monthly' }, { value: 'biweekly', label: 'Bi-weekly' }, { value: 'weekly', label: 'Weekly' }]} value={form.pay_frequency} onChange={v => setForm({ ...form, pay_frequency: v })} searchPlaceholder="Search..." className="mt-1" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" className="px-6" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {saving ? 'Saving...' : editing ? 'Update Structure' : 'Create Structure'}
              </Button>
            </div>
          </form>

          {editing && (
            <div className="p-4 border-t space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm flex items-center gap-2">Allowances &amp; Deductions</h4>
                <Button size="sm" variant="outline" onClick={() => setShowAddComponent(v => !v)}>
                  <Plus className="w-4 h-4 mr-2" /> Add Component
                </Button>
              </div>

              {showAddComponent && (
                <div className="p-4 rounded-lg border bg-muted/20 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Type</Label>
                      <Combobox options={[{ value: 'allowance', label: 'Allowance' }, { value: 'deduction', label: 'Deduction' }]} value={componentForm.component_type} onChange={v => setComponentForm({ ...componentForm, component_type: v })} searchPlaceholder="Search..." className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Name</Label>
                      <Input className="mt-1" placeholder="e.g. Housing Allowance" value={componentForm.name} onChange={e => setComponentForm({ ...componentForm, name: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Amount {componentForm.is_percentage ? '(%)' : `(${form.currency})`}</Label>
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
                  {allowances.length === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
                    <div className="space-y-1.5">
                      {allowances.map(c => (
                        <div key={c.id} className="flex items-center justify-between text-sm p-2 rounded border bg-success-bg/50">
                          <span>{c.name}{c.is_percentage ? ` (${c.amount}%)` : ''}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium">{c.is_percentage ? `${c.amount}%` : formatAmount(c.amount, form.currency)}</span>
                            <Button size="icon" aria-label="Delete" variant="ghost" className="h-6 w-6" onClick={() => handleRemoveComponent(c.id)} disabled={removingId === c.id}>
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
                  {deductions.length === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
                    <div className="space-y-1.5">
                      {deductions.map(c => (
                        <div key={c.id} className="flex items-center justify-between text-sm p-2 rounded border bg-warning-bg/50">
                          <span>{c.name}{c.is_percentage ? ` (${c.amount}%)` : ''}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium">{c.is_percentage ? `${c.amount}%` : formatAmount(c.amount, form.currency)}</span>
                            <Button size="icon" aria-label="Delete" variant="ghost" className="h-6 w-6" onClick={() => handleRemoveComponent(c.id)} disabled={removingId === c.id}>
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
          )}
        </div>

        <AdvancedDataTable<SalaryStructure>
          data={structures}
          keyExtractor={(s) => s.id}
          loading={loading}
          emptyMessage="No salary structures yet. Use the form above to create one."
          rowClassName={(s) => editing?.id === s.id ? 'bg-primary/5' : ''}
          pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
          columns={[
            { key: 'name', header: 'Name', sortable: true, render: (v, s) => <div><p className="font-medium">{v}</p>{s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}</div> },
            { key: 'basic_salary', header: 'Basic Salary', align: 'right', render: (v, s) => <span className="font-mono">{formatAmount(v, s.currency)}</span> },
            { key: 'pay_frequency', header: 'Frequency', render: (v) => <span className="capitalize">{v}</span> },
            { key: 'component_count', header: 'Components', align: 'center' },
            {
              key: '__actions', header: 'Actions', align: 'center',
              render: (_v, s) => (
                <div className="flex items-center justify-center gap-1">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => openAssign(s)}>
                    <Users2 className="w-3.5 h-3.5 mr-1.5" /> Assign
                  </Button>
                  <Button size="icon" aria-label="Edit" variant="ghost" className="h-7 w-7" onClick={() => openEdit(s)}><Edit className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" aria-label="Delete" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(s)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Dialog open={!!assignTarget} onOpenChange={(o) => !o && setAssignTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign "{assignTarget?.name}"</DialogTitle>
            <DialogDescription>Sets basic salary, currency, and allowances/deductions for each selected employee — replacing what they currently have.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 pt-2 space-y-3">
            <div className="max-h-80 overflow-auto border rounded-lg divide-y">
              {employees.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">No active employees found.</p>
              ) : employees.map((e: any) => (
                <label key={e.id} className="flex items-center gap-3 p-2.5 text-sm cursor-pointer hover:bg-muted/40">
                  <Checkbox
                    checked={selectedEmployeeIds.includes(e.id)}
                    onCheckedChange={(checked) => {
                      setSelectedEmployeeIds(ids => checked ? [...ids, e.id] : ids.filter(id => id !== e.id));
                    }}
                  />
                  <span className="flex-1">{e.first_name} {e.last_name}</span>
                  <span className="text-xs text-muted-foreground font-mono">{e.employee_number}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAssignTarget(null)}>Cancel</Button>
              <Button size="sm" onClick={handleAssign} disabled={assigning}>
                {assigning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Apply to {selectedEmployeeIds.length || ''} Employee{selectedEmployeeIds.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </AppLayout>
  );
}
