import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Building2 } from 'lucide-react';
import { Category, ChartAccount, Employee, Currency, NATURE_LABEL } from './fixedAssetsShared';

export default function FixedAssetNew() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const clinicId = Number(user?.clinic) || 1;

  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [location, setLocation] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [acquisitionDate, setAcquisitionDate] = useState(new Date().toISOString().split('T')[0]);
  const [cost, setCost] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [salvageValue, setSalvageValue] = useState('');
  const [usefulLife, setUsefulLife] = useState('');
  const [postToGl, setPostToGl] = useState(true);
  const [paymentAccountCode, setPaymentAccountCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingMeta(true);
      try {
        const [catRes, acctRes, empRes, curRes] = await Promise.all([
          authFetch('/api/fixed-assets/categories', { credentials: 'include' }),
          authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`, { credentials: 'include' }),
          authFetch('/api/hr/employees', { credentials: 'include' }),
          authFetch('/api/currencies', { credentials: 'include' }),
        ]);
        if (catRes.ok) setCategories(await catRes.json());
        if (acctRes.ok) setAccounts(await acctRes.json());
        if (empRes.ok) setEmployees(await empRes.json());
        if (curRes.ok) {
          const list: Currency[] = await curRes.json();
          setCurrencies(list);
          const base = list.find((c) => c.is_base_currency) || list[0];
          if (base) setCurrencyCode(base.code);
        }
      } catch {
        toast.error('Failed to load form data');
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, [clinicId]);

  const category = categories.find((c) => c.id === categoryId);
  const isDepreciating = category?.nature === 'depreciating';

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!categoryId) { toast.error('Pick a category'); return; }
    if (!cost || parseFloat(cost) <= 0) { toast.error('Acquisition cost must be a positive number'); return; }
    if (!currencyCode) { toast.error('Pick the acquisition currency'); return; }
    if (isDepreciating && (!usefulLife || parseInt(usefulLife, 10) <= 0)) { toast.error('Useful life (years) is required for a depreciating category'); return; }
    if (postToGl && !paymentAccountCode) { toast.error('Pick which account funded this purchase, or turn off "Post to ledger"'); return; }

    setSaving(true);
    try {
      const res = await authFetch('/api/fixed-assets', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(), category_id: categoryId, description: description || null, serial_number: serialNumber || null,
          location: location || null, assigned_to_employee_id: assignedTo || null, acquisition_date: acquisitionDate,
          acquisition_cost: parseFloat(cost), acquisition_currency: currencyCode,
          salvage_value: salvageValue ? parseFloat(salvageValue) : undefined,
          useful_life_years: usefulLife ? parseInt(usefulLife, 10) : undefined,
          payment_account_code: postToGl ? paymentAccountCode : undefined,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success('Asset registered');
        navigate(`/accounting/fixed-assets/register/${created.id}`);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to register asset');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const cashAccounts = accounts.filter((a) => ['1000', '1100'].includes(a.account_code) || /cash|bank/i.test(a.account_name));
  const payableAccounts = accounts.filter((a) => a.account_type === 'liability' && /payable/i.test(a.account_name));

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/accounting/fixed-assets/register')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Register
        </Button>
      </div>
      <PageHeader title="Register a Fixed Asset" icon={<Building2 />} subtitle="Add a new asset to the register" />

      <Card>
        <CardContent className="p-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ultrasound Machine - GE Voluson" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
            <Combobox
              options={categories.map((c) => ({ value: c.id, label: `${c.name} (${NATURE_LABEL[c.nature]})` }))}
              value={categoryId} onChange={setCategoryId} placeholder="Select category..." searchPlaceholder="Search categories..."
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Serial Number</label>
            <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Location</label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Ward 3 Store" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Assigned To (optional)</label>
            <Combobox
              options={[{ value: '', label: 'Not assigned' }, ...employees.map((e) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` }))]}
              value={assignedTo} onChange={setAssignedTo} placeholder="Not assigned" searchPlaceholder="Search employees..."
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Acquisition Date</label>
            <Input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Acquisition Cost</label>
            <div className="flex gap-2">
              <Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="flex-1" />
              <Combobox
                options={currencies.map((c) => ({ value: c.code, label: c.code }))}
                value={currencyCode} onChange={setCurrencyCode} placeholder="Currency" searchPlaceholder="Search..."
                className="w-28 shrink-0"
              />
            </div>
          </div>
          {isDepreciating && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Useful Life (years)</label>
                <Input type="number" min="1" value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} placeholder={category?.default_useful_life_years ? String(category.default_useful_life_years) : ''} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Salvage Value (optional)</label>
                <Input type="number" min="0" step="0.01" value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} />
              </div>
            </>
          )}
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Notes / Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="col-span-2 border-t pt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
              <input type="checkbox" checked={postToGl} onChange={(e) => setPostToGl(e.target.checked)} className="rounded border-input" />
              Post this acquisition to the General Ledger now
            </label>
            {postToGl && (
              <Combobox
                options={[...cashAccounts, ...payableAccounts].map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))}
                value={paymentAccountCode} onChange={setPaymentAccountCode} placeholder="Paid from / owed to which account?" searchPlaceholder="Search accounts..."
              />
            )}
            {!postToGl && <p className="text-xs text-muted-foreground">Use this for assets the facility already owned before this module existed — nothing to post twice for.</p>}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate('/accounting/fixed-assets/register')}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving || loadingMeta}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Register Asset</Button>
      </div>
    </div>
  );
}
