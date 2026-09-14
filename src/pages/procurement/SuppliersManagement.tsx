import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { exportCSV } from '@/utils/reportUtils';
import { toast } from 'sonner';
import { Building2, Edit, Search, Star, Phone, Mail, MapPin, RefreshCw, CheckCircle, Ban, Eye, Truck, Loader2, X, Check, FileSpreadsheet, Receipt, Plus, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [holdingId, setHoldingId] = useState<number | null>(null);
  const [formData, setFormData] = useState(emptyForm(currency.code));

  // Supplier profile: this supplier's own PO/bill history, shown in the details view
  const [supplierBills, setSupplierBills] = useState<any[]>([]);
  const [billSummary, setBillSummary] = useState({ total_billed: 0, total_paid: 0, total_outstanding: 0 });
  const [loadingBills, setLoadingBills] = useState(false);
  const [showCreateBill, setShowCreateBill] = useState(false);
  const [billAmount, setBillAmount] = useState('');
  const [billDescription, setBillDescription] = useState('');
  const [creatingBill, setCreatingBill] = useState(false);

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

  const viewSupplier = async (s: Supplier) => {
    try {
      const res = await authFetch(`/api/procurement/suppliers/${s.id}`);
      if (res.ok) {
        setSelectedSupplier(await res.json());
        setShowDetailsModal(true);
        setShowCreateBill(false);
        setBillAmount(''); setBillDescription('');
        fetchSupplierBills(s.id);
      }
    } catch (error) {
      toast.error('Failed to load supplier details');
    }
  };

  const fetchSupplierBills = async (supplierId: number) => {
    setLoadingBills(true);
    try {
      const res = await authFetch(`/api/procurement/suppliers/${supplierId}/purchase-orders`);
      if (res.ok) {
        const data = await res.json();
        setSupplierBills(data.purchase_orders || []);
        setBillSummary(data.summary || { total_billed: 0, total_paid: 0, total_outstanding: 0 });
      }
    } catch (error) {
      toast.error('Failed to load this supplier\'s purchase orders');
    } finally {
      setLoadingBills(false);
    }
  };

  const handleCreateBill = async () => {
    if (creatingBill || !selectedSupplier) return;
    const amt = parseFloat(billAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!billDescription.trim()) { toast.error('Add a short description of what this bill is for'); return; }
    setCreatingBill(true);
    try {
      const res = await authFetch('/api/procurement/purchase-orders/quick-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: selectedSupplier.id, amount: amt, description: billDescription.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success(`Bill ${created.po_number} recorded`);
        setShowCreateBill(false);
        setBillAmount(''); setBillDescription('');
        fetchSupplierBills(selectedSupplier.id);
        fetchSuppliers();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create bill');
      }
    } catch (error) {
      toast.error('Network error');
    } finally {
      setCreatingBill(false);
    }
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
    const reason = s.on_hold ? '' : prompt('Reason for placing on hold:');
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
        // Keep the details modal (if open for this supplier) in sync with the new status
        setSelectedSupplier((prev: any) => prev && prev.id === s.id ? { ...prev, on_hold: !s.on_hold, hold_reason: reason || '' } : prev);
      } else {
        toast.error('Failed to update hold status');
      }
    } catch (error) {
      toast.error('Failed to update hold status');
    } finally {
      setHoldingId(null);
    }
  };

  const renderStars = (rating: number) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star key={i} className={`w-3 h-3 ${i <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
      );
    }
    return <div className="flex gap-0.5">{stars}</div>;
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<Truck />}
          title="Supplier Management"
          actions={
            <Button onClick={fetchSuppliers} variant="outline" size="icon" disabled={loading}>
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
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
              <h3 className="font-medium">Supplier Directory</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-8 h-9" placeholder="Search suppliers..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
                <Combobox
                  options={[{ value: 'all', label: 'All Types' }, ...supplierTypes]}
                  value={typeFilter}
                  onChange={setTypeFilter}
                  searchPlaceholder="Search..."
                  className="w-[160px] h-9"
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
                  className="w-[130px] h-9"
                />
                <Button type="button" variant="outline" onClick={handleExportCSV} className="gap-1.5 h-9">
                  <FileSpreadsheet className="w-4 h-4" /> Export CSV
                </Button>
              </div>
            </div>

            <div className="p-4">
              <AdvancedDataTable<Supplier>
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
                        {!!s.is_preferred && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />}
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
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); viewSupplier(s); }}><Eye className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(s); }}><Edit className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); toggleHold(s); }} disabled={holdingId === s.id}>
                          {holdingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (s.on_hold ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Ban className="w-3.5 h-3.5 text-amber-600" />)}
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Supplier Details Dialog */}
        <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Supplier Profile</DialogTitle>
              <DialogDescription>Profile, performance, and billing history.</DialogDescription>
            </DialogHeader>
            {selectedSupplier && (
              <div className="space-y-4 px-6 pb-6 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold">{selectedSupplier.name}</h3>
                    <p className="text-sm text-muted-foreground font-mono">{selectedSupplier.supplier_code}</p>
                  </div>
                  {(() => {
                    const st = supplierStatus(selectedSupplier);
                    return <StatusBadge status={st.status} label={st.label} map={SUPPLIER_STATUS_TONE} />;
                  })()}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" />{selectedSupplier.phone || '—'}</div>
                  <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" />{selectedSupplier.email || '—'}</div>
                  <div className="col-span-2 flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" />{selectedSupplier.address || '—'}, {selectedSupplier.town || ''}</div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t pt-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Total POs</p>
                    <p className="text-lg font-bold">{selectedSupplier.stats?.total_pos || 0}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Total Spend</p>
                    <p className="text-lg font-bold font-mono">{fmt(selectedSupplier.stats?.total_po_amount || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Open POs</p>
                    <p className="text-lg font-bold">{selectedSupplier.stats?.open_pos || 0}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Rating</p>
                    <div className="flex items-center gap-1 mt-1">
                      {selectedSupplier.performance?.avg_rating > 0 ? (
                        <>
                          {renderStars(selectedSupplier.performance.avg_rating)}
                          <span className="text-sm ml-1">({selectedSupplier.performance.total_reviews})</span>
                        </>
                      ) : <span className="text-sm text-muted-foreground">No ratings</span>}
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{(selectedSupplier.supplier_type || 'general').replace('_', ' ')}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Payment Terms</span><span>{selectedSupplier.payment_terms || 'Net30'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Currency</span><span>{selectedSupplier.currency || currency.code}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Credit Limit</span><span className="font-mono">{formatInCurrency(selectedSupplier.credit_limit || 0, selectedSupplier.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax ID</span><span>{selectedSupplier.tax_id || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Bank</span><span>{selectedSupplier.bank_name || '—'}</span></div>
                </div>

                {/* Billing: what this supplier is owed, what's already been paid, and
                    every PO/bill behind those numbers — the actual "how much does
                    this supplier want from us" the profile view exists to answer. */}
                <div className="border-t pt-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" /> Billing &amp; Purchase Orders</h4>
                    <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => setShowCreateBill(v => !v)}>
                      <Plus className="w-3 h-3 mr-1.5" /> Create Bill
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                      <p className="text-xs text-amber-800">Outstanding</p>
                      <p className="text-lg font-bold font-mono text-amber-900">{fmt(billSummary.total_outstanding)}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <p className="text-xs text-emerald-800">Paid</p>
                      <p className="text-lg font-bold font-mono text-emerald-900">{fmt(billSummary.total_paid)}</p>
                    </div>
                  </div>

                  {showCreateBill && (
                    <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">New bill for {selectedSupplier.name} — items not required</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs font-medium text-muted-foreground">Amount ({selectedSupplier.currency || currency.code})</Label>
                          <Input type="number" step="0.01" min="0" className="mt-1 h-9" placeholder="0.00" value={billAmount} onChange={e => setBillAmount(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-muted-foreground">What's it for?</Label>
                          <Input className="mt-1 h-9" placeholder="e.g. Equipment repair" value={billDescription} onChange={e => setBillDescription(e.target.value)} />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <Button size="sm" variant="ghost" className="h-7 px-3 text-xs" onClick={() => setShowCreateBill(false)}>Cancel</Button>
                        <Button size="sm" className="h-7 px-3 text-xs" onClick={handleCreateBill} disabled={creatingBill}>
                          {creatingBill ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Check className="w-3 h-3 mr-1.5" />}
                          {creatingBill ? 'Saving...' : 'Save Bill'}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="border rounded-lg overflow-hidden">
                    {loadingBills ? (
                      <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                    ) : supplierBills.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-1">
                        <FileText className="w-5 h-5 text-muted-foreground/50" />
                        No purchase orders or bills for this supplier yet.
                      </div>
                    ) : (
                      <div className="max-h-56 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/30 sticky top-0">
                            <tr className="text-left text-muted-foreground">
                              <th className="px-3 py-2 font-medium">PO / Bill No.</th>
                              <th className="px-3 py-2 font-medium">Date</th>
                              <th className="px-3 py-2 font-medium">Status</th>
                              <th className="px-3 py-2 font-medium text-right">Total</th>
                              <th className="px-3 py-2 font-medium text-right">Paid</th>
                              <th className="px-3 py-2 font-medium text-right">Balance Due</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {supplierBills.map((b: any) => (
                              <tr key={b.id}>
                                <td className="px-3 py-2 font-mono text-primary">{b.po_number}</td>
                                <td className="px-3 py-2 text-muted-foreground">{new Date(b.order_date).toLocaleDateString()}</td>
                                <td className="px-3 py-2"><StatusBadge status={b.status} label={b.status} map={PO_STATUS_TONE} /></td>
                                <td className="px-3 py-2 text-right font-mono">{formatInCurrency(b.total_amount, b.po_currency)}</td>
                                <td className="px-3 py-2 text-right font-mono">{formatInCurrency(b.paid_amount, b.po_currency)}</td>
                                <td className={cn("px-3 py-2 text-right font-mono font-semibold", parseFloat(b.balance_due) > 0 ? "text-amber-700" : "text-emerald-700")}>
                                  {formatInCurrency(b.balance_due, b.po_currency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" variant="outline" className="h-8 px-4 text-xs" onClick={() => { setShowDetailsModal(false); openEdit(selectedSupplier); }}>
                    <Edit className="w-3 h-3 mr-2" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 px-4 text-xs" disabled={holdingId === selectedSupplier.id} onClick={() => toggleHold(selectedSupplier)}>
                    {holdingId === selectedSupplier.id ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : (selectedSupplier.on_hold ? <><CheckCircle className="w-3 h-3 mr-2" /> Release Hold</> : <><Ban className="w-3 h-3 mr-2" /> Place on Hold</>)}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 px-4 text-xs ml-auto" onClick={() => setShowDetailsModal(false)}>Close</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default SuppliersManagement;
