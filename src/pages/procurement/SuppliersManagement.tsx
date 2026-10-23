import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { exportCSV } from '@/utils/reportUtils';
import { toast } from '@/lib/notify';
import { usePromptDialog } from '@/hooks/use-prompt-dialog';
import { Building2, Edit, Search, Star, RefreshCw, CheckCircle, Ban, Eye, Truck, Loader2, X, Check, FileSpreadsheet } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface Supplier {
  id: number;
  name: string;
  supplier_code: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  town: string;
  country: string;
  supplier_type: string;
  tax_id: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_name: string;
  payment_terms: string;
  credit_limit: number;
  currency: string;
  is_preferred: boolean;
  is_active: boolean;
  on_hold: boolean;
  hold_reason: string;
  performance_rating: number;
  total_purchases: number;
  total_paid: number;
  clinic_id: number;
}

interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
  decimal_places: number;
  is_base_currency?: boolean;
}

const supplierTypes = [
  { value: 'medical_supplies', label: 'Medical Supplies' },
  { value: 'services', label: 'Services' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'consumables', label: 'Consumables' },
  { value: 'general', label: 'General' },
];

const paymentTerms = ['Net15', 'Net30', 'Net45', 'Net60', 'Net90', 'COD', 'Prepaid'];

const SUPPLIER_STATUS_TONE: Record<string, StatusBadgeTone> = {
  active: 'success',
  on_hold: 'warning',
  inactive: 'neutral',
};

const PO_STATUS_TONE: Record<string, StatusBadgeTone> = {
  draft: 'neutral',
  check: 'warning',
  approved: 'warning',
  authorized: 'info',
  received: 'success',
  cancelled: 'danger',
};

const supplierStatus = (s: Supplier) => {
  if (s.on_hold) return { status: 'on_hold', label: 'On Hold' };
  if (s.is_active) return { status: 'active', label: 'Active' };
  return { status: 'inactive', label: 'Inactive' };
};

const emptyForm = (currencyCode: string) => ({
  name: '', contact_person: '', phone: '', email: '', address: '', town: '',
  country: 'South Sudan', supplier_type: 'general', tax_id: '',
  bank_account_name: '', bank_account_number: '', bank_name: '',
  payment_terms: 'Net30', credit_limit: '0', currency: currencyCode, is_preferred: false
});

const SuppliersManagement: React.FC = () => {
  const { user } = useAuth();
  const { currency, fmt } = useCurrency();
  const { prompt, promptDialog } = usePromptDialog();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [holdingId, setHoldingId] = useState<number | null>(null);
  const [formData, setFormData] = useState(emptyForm(currency.code));
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/procurement/suppliers?clinic_id=${user?.clinic || ''}`);
      if (res.ok) setSuppliers(await res.json());
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      toast.error('Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrencies = async () => {
    try {
      const res = await authFetch('/api/currencies');
      if (res.ok) setCurrencies(await res.json());
    } catch (error) {
      console.error('Error fetching currencies:', error);
    }
  };

  useEffect(() => { fetchSuppliers(); fetchCurrencies(); }, []);

  // Coming back from the Supplier Profile page's "Edit" link (?edit=<id>) —
  // opens that supplier straight into the inline edit form once the list has
  // loaded, rather than making the user find and click Edit again themselves.
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId && suppliers.length > 0) {
      const match = suppliers.find(s => String(s.id) === editId);
      if (match) openEdit(match);
      // One-shot: strip the param so re-fetching the list (e.g. after saving)
      // doesn't keep reopening this supplier's edit form every time.
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers]);

  // Keep the default "currency" on the create form in sync once the base currency loads
  useEffect(() => {
    if (!editingSupplier && currency.code) {
      setFormData(f => (f.currency ? f : { ...f, currency: currency.code }));
    }
  }, [currency.code]);

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(s => {
      if (searchQuery && !s.name?.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !s.supplier_code?.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !s.contact_person?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (typeFilter !== 'all' && s.supplier_type !== typeFilter) return false;
      if (statusFilter === 'active' && (!s.is_active || s.on_hold)) return false;
      if (statusFilter === 'inactive' && s.is_active) return false;
      if (statusFilter === 'on_hold' && !s.on_hold) return false;
      return true;
    });
  }, [suppliers, searchQuery, typeFilter, statusFilter]);

  const handleExportCSV = () => {
    if (filteredSuppliers.length === 0) { toast.error('No suppliers to export'); return; }
    exportCSV(filteredSuppliers, [
      { header: 'Name', key: 'name' },
      { header: 'Supplier Code', key: 'supplier_code' },
      { header: 'Contact Person', key: 'contact_person' },
      { header: 'Phone', key: 'phone' },
      { header: 'Email', key: 'email' },
      { header: 'Type', key: 'supplier_type' },
      { header: 'Payment Terms', key: 'payment_terms' },
      { header: 'Currency', key: 'currency' },
      { header: 'Rating', key: 'performance_rating' },
      { header: 'Status', key: 'is_active', transform: (v, row) => row.on_hold ? 'On Hold' : (v ? 'Active' : 'Inactive') },
    ], 'suppliers.csv');
  };

  const summaryStats = useMemo(() => ({
    total: suppliers.length,
    active: suppliers.filter(s => s.is_active && !s.on_hold).length,
    onHold: suppliers.filter(s => s.on_hold).length,
    preferred: suppliers.filter(s => s.is_preferred).length,
  }), [suppliers]);

  // Look up a currency's symbol/decimal precision so supplier-specific amounts
  // (e.g. credit limit) render in the supplier's own currency, not always the base one.
  const formatInCurrency = (amount: number, code?: string) => {
    const match = currencies.find(c => c.code === code);
    const symbol = match?.symbol || code || currency.symbol || currency.code;
    const decimals = match?.decimal_places ?? currency.decimal_places ?? 2;
    return `${symbol} ${Number(amount || 0).toFixed(decimals)}`;
  };

  const openCreate = () => {
    setEditingSupplier(null);
    setFormData(emptyForm(currency.code));
  };

  const openEdit = (s: Supplier) => {
    setEditingSupplier(s);
    setFormData({
      name: s.name || '', contact_person: s.contact_person || '', phone: s.phone || '',
      email: s.email || '', address: s.address || '', town: s.town || '',
      country: s.country || 'South Sudan', supplier_type: s.supplier_type || 'general',
      tax_id: s.tax_id || '', bank_account_name: s.bank_account_name || '',
      bank_account_number: s.bank_account_number || '', bank_name: s.bank_name || '',
      payment_terms: s.payment_terms || 'Net30', credit_limit: String(s.credit_limit || 0),
      currency: s.currency || currency.code, is_preferred: s.is_preferred || false
    });
  };

  const viewSupplier = (s: Supplier) => {
    navigate(`/procurement/suppliers-mgmt/${s.id}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const url = editingSupplier ? `/api/procurement/suppliers/${editingSupplier.id}` : '/api/procurement/suppliers';
      const method = editingSupplier ? 'PUT' : 'POST';
      const body = { ...formData, credit_limit: parseFloat(formData.credit_limit) || 0, clinic_id: user?.clinic };

      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Failed');

      toast.success(editingSupplier ? 'Supplier updated' : 'Supplier created');
      openCreate();
      fetchSuppliers();
    } catch (error) {
      toast.error('Failed to save supplier');
    } finally {
      setSaving(false);
    }
  };

  const toggleHold = async (s: Supplier) => {
    if (holdingId === s.id) return;
    const reason = s.on_hold ? '' : await prompt({ title: 'Reason for placing on hold' });
    if (!s.on_hold && !reason) return;
    setHoldingId(s.id);
    try {
      const res = await authFetch(`/api/procurement/suppliers/${s.id}/hold`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on_hold: !s.on_hold, hold_reason: reason || '' })
      });
      if (res.ok) {
        toast.success(s.on_hold ? 'Hold released' : 'Supplier placed on hold');
        await fetchSuppliers();
      } else {
        toast.error('Failed to update hold status');
      }
    } catch (error) {
      toast.error('Failed to update hold status');
    } finally {
      setHoldingId(null);
    }
  };

  return (
    <AppLayout>
      {promptDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<Truck />}
          title="Supplier Management"
          actions={
            <Button onClick={fetchSuppliers} variant="outline" size="icon" aria-label="Refresh" disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          }
        />

        <div className="space-y-6">

          {/* Create/Edit form (stacked above the list, always visible) */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex justify-between items-center flex-shrink-0">
              <h3 className="font-medium flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" /> {editingSupplier ? `Edit — ${editingSupplier.name}` : 'New Supplier'}
              </h3>
              {editingSupplier && (
                <Button variant="ghost" size="sm" onClick={openCreate}>
                  <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                </Button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-auto">
              <div className="p-4 grid grid-cols-3 gap-4">
                {/* Card 1: Basic Information */}
                <div className="border rounded-lg p-3 space-y-3 bg-card">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basic Information</p>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">Supplier Name *</Label>
                    <Input className="mt-1" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">Supplier Type</Label>
                    <Combobox
                      options={supplierTypes}
                      value={formData.supplier_type}
                      onChange={v => setFormData({ ...formData, supplier_type: v })}
                      searchPlaceholder="Search..."
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">Tax ID</Label>
                    <Input className="mt-1" value={formData.tax_id} onChange={e => setFormData({ ...formData, tax_id: e.target.value })} />
                  </div>
                </div>

                {/* Card 2: Contact Details */}
                <div className="border rounded-lg p-3 space-y-3 bg-card">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact Details</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Contact Person</Label>
                      <Input className="mt-1" value={formData.contact_person} onChange={e => setFormData({ ...formData, contact_person: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Phone</Label>
                      <Input className="mt-1" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="+211-xxx-xxxxxx" />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Email</Label>
                      <Input className="mt-1" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Town</Label>
                      <Input className="mt-1" value={formData.town} onChange={e => setFormData({ ...formData, town: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs font-medium text-muted-foreground">Country</Label>
                      <Input className="mt-1" value={formData.country} onChange={e => setFormData({ ...formData, country: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs font-medium text-muted-foreground">Address</Label>
                      <Textarea className="mt-1" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} rows={2} />
                    </div>
                  </div>
                </div>

                {/* Card 3: Payment & Banking */}
                <div className="border rounded-lg p-3 space-y-3 bg-card">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payment &amp; Banking</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Payment Terms</Label>
                      <Combobox
                        options={paymentTerms.map(t => ({ value: t, label: t }))}
                        value={formData.payment_terms}
                        onChange={v => setFormData({ ...formData, payment_terms: v })}
                        searchPlaceholder="Search..."
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Credit Limit ({formData.currency || currency.code})</Label>
                      <Input className="mt-1" type="number" step="0.01" min="0" value={formData.credit_limit} onChange={e => setFormData({ ...formData, credit_limit: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Bank Name</Label>
                      <Input className="mt-1" value={formData.bank_name} onChange={e => setFormData({ ...formData, bank_name: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">Bank Account Name</Label>
                      <Input className="mt-1" value={formData.bank_account_name} onChange={e => setFormData({ ...formData, bank_account_name: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs font-medium text-muted-foreground">Bank Account Number</Label>
                      <Input className="mt-1" value={formData.bank_account_number} onChange={e => setFormData({ ...formData, bank_account_number: e.target.value })} />
                    </div>
                    <label className="col-span-2 flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer hover:bg-muted/40 transition-colors">
                      <input type="checkbox" checked={formData.is_preferred}
                        onChange={e => setFormData({ ...formData, is_preferred: e.target.checked })} className="rounded" />
                      <span className="text-xs font-medium">Preferred Supplier</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t bg-muted flex justify-end gap-2 sticky bottom-0">
                <Button type="submit" size="sm" className="px-6" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  {saving ? (editingSupplier ? 'Updating...' : 'Creating...') : (editingSupplier ? 'Update Supplier' : 'Create Supplier')}
                </Button>
              </div>
            </form>
          </div>

          {/* RIGHT: Supplier Directory */}
          <AdvancedDataTable<Supplier>
            title="Supplier Directory"
            searchSlot={
              <div className="relative w-52">
                <Search className="absolute left-2.5 top-2 w-4 h-4 text-muted-foreground" />
                <Input className="text-sm pl-8 h-8" placeholder="Search suppliers..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
            }
            toolbarExtra={
              <>
                <Combobox
                  options={[{ value: 'all', label: 'All Types' }, ...supplierTypes]}
                  value={typeFilter}
                  onChange={setTypeFilter}
                  searchPlaceholder="Search..."
                  className="text-sm w-[160px] h-8"
                />
                <Combobox
                  options={[
                    { value: 'all', label: 'All Status' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                    { value: 'on_hold', label: 'On Hold' },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  searchPlaceholder="Search..."
                  className="text-sm w-[130px] h-8"
                />
              </>
            }
            autoFilters={false}
            data={filteredSuppliers}
            keyExtractor={(s) => s.id}
            loading={loading}
            emptyMessage={searchQuery || typeFilter !== 'all' || statusFilter !== 'all' ? 'No suppliers match your filters' : 'No suppliers yet. Use the form above to create one.'}
            onRowClick={(s) => openEdit(s)}
            rowClassName={(s) => editingSupplier?.id === s.id ? 'bg-primary/5' : ''}
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            columns={[
              {
                key: 'name', header: 'Supplier', sortable: true,
                render: (v, s) => (
                  <div className="flex items-center gap-2">
                    {!!s.is_preferred && <Star className="w-3.5 h-3.5 text-warning fill-warning" />}
                    <p className="font-medium">{v}</p>
                  </div>
                ),
              },
              { key: 'supplier_code', header: 'Supplier Number', render: (v) => <span className="font-mono text-xs text-muted-foreground">{v || '—'}</span> },
              {
                key: 'contact_person', header: 'Contact',
                render: (v, s) => (
                  <>
                    <p>{v || '—'}</p>
                    <p className="text-xs text-muted-foreground">{s.email || '—'}</p>
                  </>
                ),
              },
              { key: 'phone', header: 'Phone Number', render: (v) => v || '—' },
              {
                key: 'supplier_type', header: 'Type',
                render: (v) => <Badge variant="outline" className="text-xs capitalize">{(v || 'general').replace('_', ' ')}</Badge>,
              },
              {
                key: '__status', header: 'Status', align: 'center',
                render: (_v, s) => {
                  const st = supplierStatus(s);
                  return <StatusBadge status={st.status} label={st.label} map={SUPPLIER_STATUS_TONE} />;
                },
              },
              {
                key: '__actions', header: 'Actions', align: 'center',
                render: (_v, s) => (
                  <div className="flex items-center justify-center gap-1">
                    <Button size="icon" aria-label="View" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); viewSupplier(s); }}><Eye className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" aria-label="Edit" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(s); }}><Edit className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" aria-label="Confirm" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); toggleHold(s); }} disabled={holdingId === s.id}>
                      {holdingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (s.on_hold ? <CheckCircle className="w-3.5 h-3.5 text-success" /> : <Ban className="w-3.5 h-3.5 text-warning" />)}
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
      </div>
    </AppLayout>
  );
};

export default SuppliersManagement;
