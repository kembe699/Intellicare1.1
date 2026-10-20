import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { ArrowLeft, Loader2, Building2, Info, MapPinned, CalendarClock, Landmark, FileText } from 'lucide-react';
import { Category, ChartAccount, Employee, Currency, NATURE_LABEL } from './fixedAssetsShared';

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

function Field({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="text-xs font-medium text-muted-foreground block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

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
  const activeCategories = categories.filter((c) => c.is_active !== false);

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
    <div className="space-y-4">
      <PageHeader
        icon={<Building2 />}
        title="Register a Fixed Asset"
        subtitle="Add a new asset to the register"
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/accounting/fixed-assets/register')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Register
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <SectionHeader icon={Info} title="Basic Information" subtitle="What the asset is and which category it belongs to" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name" span2>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ultrasound Machine - GE Voluson" />
                </Field>
                <Field label="Category">
                  <Combobox
                    options={activeCategories.map((c) => ({ value: c.id, label: `${c.name} (${NATURE_LABEL[c.nature]})` }))}
                    value={categoryId} onChange={setCategoryId} placeholder="Select category..." searchPlaceholder="Search categories..."
                  />
                </Field>
                <Field label="Serial Number">
                  <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="Optional" />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <SectionHeader icon={MapPinned} title="Location & Assignment" subtitle="Where it's kept and who's responsible for it" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Location">
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Ward 3 Store" />
                </Field>
                <Field label="Assigned To (optional)">
                  <Combobox
                    options={[{ value: '', label: 'Not assigned' }, ...employees.map((e) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` }))]}
                    value={assignedTo} onChange={setAssignedTo} placeholder="Not assigned" searchPlaceholder="Search employees..."
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <SectionHeader icon={FileText} title="Notes" />
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes or description" />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <SectionHeader icon={CalendarClock} title="Acquisition & Depreciation" subtitle="Cost, currency, and how the asset loses value over time" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Acquisition Date">
                  <Input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
                </Field>
                <Field label="Acquisition Cost">
                  <div className="flex gap-2">
                    <Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="flex-1" />
                    <Combobox
                      options={currencies.map((c) => ({ value: c.code, label: c.code }))}
                      value={currencyCode} onChange={setCurrencyCode} placeholder="Currency" searchPlaceholder="Search..."
                      className="w-28 shrink-0"
                    />
                  </div>
                </Field>
                {isDepreciating && (
                  <>
                    <Field label="Useful Life (years)">
                      <Input type="number" min="1" value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} placeholder={category?.default_useful_life_years ? String(category.default_useful_life_years) : ''} />
                    </Field>
                    <Field label="Salvage Value (optional)">
                      <Input type="number" min="0" step="0.01" value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} placeholder="Defaults from category" />
                    </Field>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <SectionHeader icon={Landmark} title="Funding Source" subtitle="Where the money for this purchase came from" />
              <label className="flex items-center gap-2 text-sm cursor-pointer mb-3">
                <input type="checkbox" checked={postToGl} onChange={(e) => setPostToGl(e.target.checked)} className="rounded border-input" />
                Post this acquisition to the General Ledger now
              </label>
              {postToGl ? (
                <Combobox
                  options={[...cashAccounts, ...payableAccounts].map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))}
                  value={paymentAccountCode} onChange={setPaymentAccountCode} placeholder="Paid from / owed to which account?" searchPlaceholder="Search accounts..."
                />
              ) : (
                <p className="text-xs text-muted-foreground">Use this for assets the facility already owned before this module existed — nothing to post twice for.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex justify-end gap-2 pb-2">
        <Button variant="outline" onClick={() => navigate('/accounting/fixed-assets/register')}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving || loadingMeta}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Register Asset</Button>
      </div>
    </div>
  );
}
