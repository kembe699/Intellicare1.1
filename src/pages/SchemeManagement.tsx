import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { authFetch } from '@/api/apiClient';
import { fetchPatientDirectory } from '@/lib/patientDirectory';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { toast } from 'sonner';
import {
  Plus, Search, Eye, Edit, Trash2, DollarSign, Users, Shield, Settings,
  BarChart3, Loader2, Save, X, RefreshCw, CheckCircle, AlertCircle,
  FileSpreadsheet, ArrowRightLeft, TrendingUp, Upload, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

type TabType = 'schemes' | 'service-pricing' | 'product-pricing' | 'membership' | 'discounts' | 'reports';

const SCHEME_TYPES = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'individual', label: 'Individual' },
  { value: 'govt', label: 'Government' },
  { value: 'ngo', label: 'NGO / Charity' },
  { value: 'military', label: 'Military' },
  { value: 'vip', label: 'VIP / Premium' },
  { value: 'student', label: 'Student' },
  { value: 'senior_citizen', label: 'Senior Citizen' },
  { value: 'subsidized', label: 'Subsidized' },
  { value: 'other', label: 'Other' },
];

const SchemeManagement: React.FC = () => {
  const { user } = useAuth();
  const { currency, fmt } = useCurrency();
  const clinicId = user?.clinic || '1';
  const [activeTab, setActiveTab] = useState<TabType>('schemes');
  const [loading, setLoading] = useState(false);

  // Schemes
  const [schemes, setSchemes] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSchemeForm, setShowSchemeForm] = useState(false);
  const [editingScheme, setEditingScheme] = useState<any>(null);
  const [schemeForm, setSchemeForm] = useState(getEmptySchemeForm());

  // Service Pricing
  const [selectedSchemeId, setSelectedSchemeId] = useState('');
  const [servicePricing, setServicePricing] = useState<any[]>([]);
  const [allServices, setAllServices] = useState<any[]>([]);
  const [showServicePriceForm, setShowServicePriceForm] = useState(false);
  const [servicePriceForm, setServicePriceForm] = useState(getEmptyServicePriceForm());

  // Product Pricing
  const [productPricing, setProductPricing] = useState<any[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [showProductPriceForm, setShowProductPriceForm] = useState(false);
  const [productPriceForm, setProductPriceForm] = useState(getEmptyProductPriceForm());

  // Membership
  const [members, setMembers] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [showAddMemberForm, setShowAddMemberForm] = useState(false);
  const [memberForm, setMemberForm] = useState({ patient_id: '', member_number: '', effective_from: new Date().toISOString().split('T')[0], relationship_to_member: 'self' });
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // Discounts
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [discountForm, setDiscountForm] = useState(getEmptyDiscountForm());

  // Reports
  const [membershipReport, setMembershipReport] = useState<any[]>([]);
  const [marginReport, setMarginReport] = useState<any[]>([]);

  // Price test

  // CSV Upload
  const [showCsvUpload, setShowCsvUpload] = useState(false);
  const [csvUploadType, setCsvUploadType] = useState<'service' | 'product'>('service');
  const [csvParsedRows, setCsvParsedRows] = useState<any[]>([]);
  const [csvSchemeColumns, setCsvSchemeColumns] = useState<{ name: string; id: string }[]>([]);
  const [csvUploading, setCsvUploading] = useState(false);

  function getEmptySchemeForm() {
    return {
      scheme_code: '', scheme_name: '', scheme_description: '', scheme_type: 'individual',
      is_default: false, pricing_strategy: 'fixed', base_markup_percentage: '0', base_discount_percentage: '0',
      is_insurance: false, insurance_provider_name: '', insurance_provider_code: '',
      requires_authorization: false, has_copay: true, default_copay_percentage: '10', copay_cap_per_visit: '',
      payment_terms: 'immediate', is_credit_allowed: false, credit_limit: '0',
      requires_deposit: false, deposit_amount: '',
      allows_negotiation: false, requires_verification: false, requires_approval: false,
      contact_person: '', contact_phone: '', contact_email: '', notes: '',
      currency: currency.code
    };
  }
  function getEmptyServicePriceForm() {
    return { service_id: '', scheme_price: '', markup_percentage: '0', discount_percentage: '0',
      insurance_copay: '', insurance_copay_percentage: '', effective_from: new Date().toISOString().split('T')[0], notes: '' };
  }
  function getEmptyProductPriceForm() {
    return { product_id: '', product_type: 'drug', scheme_price: '', markup_percentage: '0', discount_percentage: '0',
      insurance_copay: '', insurance_copay_percentage: '', effective_from: new Date().toISOString().split('T')[0], notes: '' };
  }
  function getEmptyDiscountForm() {
    return { discount_code: '', discount_type: 'percentage', discount_name: '', discount_value: '',
      applies_to: 'all', min_bill_amount: '', effective_from: '', effective_to: '', notes: '' };
  }

  useEffect(() => { loadSchemes(); }, []);

  useEffect(() => {
    if (activeTab === 'service-pricing' && selectedSchemeId) loadServicePricing();
    if (activeTab === 'product-pricing' && selectedSchemeId) loadProductPricing();
    if (activeTab === 'membership' && selectedSchemeId) loadMembers();
    if (activeTab === 'discounts' && selectedSchemeId) loadDiscounts();
    if (activeTab === 'reports') loadReports();
  }, [activeTab, selectedSchemeId]);

  // ── Loaders ──

  async function loadSchemes() {
    setLoading(true);
    try {
      const res = await authFetch(`/api/schemes?clinic_id=${clinicId}&is_active=true`);
      if (res.ok) setSchemes(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadServicePricing() {
    if (!selectedSchemeId) return;
    setLoading(true);
    try {
      const [pricingRes, servicesRes] = await Promise.all([
        authFetch(`/api/schemes/${selectedSchemeId}/service-pricing`),
        authFetch(`/api/services`)
      ]);
      if (pricingRes.ok) setServicePricing(await pricingRes.json());
      if (servicesRes.ok) setAllServices(await servicesRes.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadProductPricing() {
    if (!selectedSchemeId) return;
    setLoading(true);
    try {
      const [pricingRes, productsRes] = await Promise.all([
        authFetch(`/api/schemes/${selectedSchemeId}/product-pricing`),
        authFetch(`/api/inventory/items?clinic_id=${clinicId}&is_active=true`)
      ]);
      if (pricingRes.ok) setProductPricing(await pricingRes.json());
      if (productsRes.ok) {
        const data = await productsRes.json();
        setAllProducts(Array.isArray(data) ? data : (data.items || []));
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadMembers() {
    if (!selectedSchemeId) return;
    setLoading(true);
    try {
      // Scheme membership can be linked to either a main-registry patient or an
      // LIS-registered participant (the same dual-source pattern billing uses
      // throughout the app — e.g. the "link to scheme" action on a credit invoice can
      // target either) — merge both into the picker so an LIS-only patient can still
      // be added as a member here, instead of only being reachable through that
      // other, indirect path.
      // Shares lib/patientDirectory with every other people-picker in the app.
      // This used to be a fifth private copy of the same merge, reading the
      // clinic-scoped patient route, so someone enrolled under a different
      // clinic could not be found and a failed half was silently dropped.
      const [membersRes, directory] = await Promise.all([
        authFetch(`/api/schemes/${selectedSchemeId}/members`),
        fetchPatientDirectory(),
      ]);
      if (membersRes.ok) setMembers(await membersRes.json());
      if (directory.failed.length) {
        toast.error(`Could not load ${directory.failed.join(' and ')} — the patient list is incomplete.`);
      }
      setPatients(directory.people.map((p) => ({
        id: p.id, first_name: p.firstName, last_name: p.lastName,
        patient_id: p.code, source: p.source,
      })));
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadDiscounts() {
    if (!selectedSchemeId) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/schemes/${selectedSchemeId}/discounts`);
      if (res.ok) setDiscounts(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadReports() {
    setLoading(true);
    try {
      const [memRes, marginRes] = await Promise.all([
        authFetch(`/api/schemes/reports/membership?clinic_id=${clinicId}`),
        authFetch(`/api/schemes/reports/margin-analysis?clinic_id=${clinicId}`)
      ]);
      if (memRes.ok) setMembershipReport(await memRes.json());
      if (marginRes.ok) setMarginReport(await marginRes.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  // ── Actions ──

  async function handleSaveScheme() {
    try {
      const payload = { ...schemeForm, clinic_id: clinicId };
      const url = editingScheme ? `/api/schemes/${editingScheme.id}` : '/api/schemes';
      const method = editingScheme ? 'PUT' : 'POST';
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        toast.success(editingScheme ? 'Scheme updated' : 'Scheme created');
        setShowSchemeForm(false); setEditingScheme(null); setSchemeForm(getEmptySchemeForm());
        loadSchemes();
      } else { const err = await res.json(); toast.error(err.error || 'Failed to save scheme'); }
    } catch { toast.error('Failed to save scheme'); }
  }

  async function handleDeleteScheme(id: string) {
    if (!confirm('Deactivate this scheme?')) return;
    try {
      const res = await authFetch(`/api/schemes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Scheme deactivated');
        setSchemes(prev => prev.filter((scheme: any) => scheme.id !== id));
        if (selectedSchemeId === id) {
          setSelectedSchemeId('');
        }
        loadSchemes();
      }
    } catch { toast.error('Failed to deactivate scheme'); }
  }

  async function handleSaveServicePrice() {
    try {
      const payload = { ...servicePriceForm, clinic_id: clinicId };
      const res = await authFetch(`/api/schemes/${selectedSchemeId}/service-pricing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (res.ok) { toast.success('Service price saved'); setShowServicePriceForm(false); loadServicePricing(); }
      else toast.error('Failed to save service price');
    } catch { toast.error('Failed to save service price'); }
  }

  async function handleDeleteServicePrice(pricingId: string) {
    try {
      const res = await authFetch(`/api/schemes/${selectedSchemeId}/service-pricing/${pricingId}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Price removed'); loadServicePricing(); }
    } catch { toast.error('Failed to remove price'); }
  }

  async function handleSaveProductPrice() {
    try {
      const payload = { ...productPriceForm, clinic_id: clinicId };
      const res = await authFetch(`/api/schemes/${selectedSchemeId}/product-pricing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (res.ok) { toast.success('Product price saved'); setShowProductPriceForm(false); loadProductPricing(); }
      else toast.error('Failed to save product price');
    } catch { toast.error('Failed to save product price'); }
  }

  async function handleDeleteProductPrice(pricingId: string) {
    try {
      const res = await authFetch(`/api/schemes/${selectedSchemeId}/product-pricing/${pricingId}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Price removed'); loadProductPricing(); }
    } catch { toast.error('Failed to remove price'); }
  }

  async function handleAddMember() {
    try {
      const payload = { ...memberForm, clinic_id: clinicId };
      const res = await authFetch(`/api/schemes/${selectedSchemeId}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (res.ok) { toast.success('Member added'); setShowAddMemberForm(false); loadMembers(); }
      else toast.error('Failed to add member');
    } catch { toast.error('Failed to add member'); }
  }

  async function handleRemoveMember(membershipId: string) {
    if (!confirm('Remove this member?')) return;
    try {
      const res = await authFetch(`/api/schemes/membership/${membershipId}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Member removed'); loadMembers(); }
    } catch { toast.error('Failed to remove member'); }
  }

  async function handleVerifyMember(membershipId: string) {
    setVerifyingId(membershipId);
    try {
      const res = await authFetch(`/api/schemes/membership/${membershipId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: true, verified_by: user?.displayName || user?.email || 'System' }),
      });
      if (res.ok) { toast.success('Membership verified'); loadMembers(); }
      else toast.error('Failed to verify membership');
    } catch { toast.error('Failed to verify membership'); }
    finally { setVerifyingId(null); }
  }

  async function handleSaveDiscount() {
    try {
      const payload = { ...discountForm, clinic_id: clinicId };
      const res = await authFetch(`/api/schemes/${selectedSchemeId}/discounts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (res.ok) { toast.success('Discount created'); setShowDiscountForm(false); loadDiscounts(); }
      else toast.error('Failed to create discount');
    } catch { toast.error('Failed to create discount'); }
  }

  // ── CSV Upload Functions ──

  async function openCsvUpload(type: 'service' | 'product') {
    setCsvUploadType(type);
    setCsvParsedRows([]);
    setCsvSchemeColumns([]);
    // Pre-load items if not already loaded
    if (type === 'service' && allServices.length === 0) {
      try { const r = await authFetch('/api/services'); if (r.ok) setAllServices(await r.json()); } catch {}
    }
    if (type === 'product' && allProducts.length === 0) {
      try {
        const r = await authFetch(`/api/inventory/items?clinic_id=${clinicId}&is_active=true`);
        if (r.ok) { const d = await r.json(); setAllProducts(Array.isArray(d) ? d : (d.items || [])); }
      } catch {}
    }
    setShowCsvUpload(true);
  }

  async function downloadCsvTemplate(scope: 'selected' | 'all' = 'all') {
    const activeSchemes = scope === 'selected' && selectedScheme
      ? [selectedScheme]
      : schemes.filter(s => s.is_active);
    const schemeHeaders = activeSchemes.map(s => `${s.scheme_name} (${s.currency || currency.code})`);

    // Fetch existing prices to pre-fill template
    let priceMap: Record<string, string> = {}; // key: "itemId_schemeId" → price
    try {
      const res = await authFetch(`/api/schemes/all-pricing?clinic_id=${clinicId}&item_type=${csvUploadType}`);
      if (res.ok) {
        const data = await res.json();
        for (const row of data) {
          priceMap[`${row.item_id}_${row.scheme_id}`] = String(row.scheme_price ?? '');
        }
      }
    } catch {}

    let rows: string[][] = [];
    if (csvUploadType === 'service') {
      rows.push(['Service Code', 'Service Name', 'Category', 'Base Price', ...schemeHeaders]);
      allServices.forEach((s: any) => {
        rows.push([
          s.service_code || s.code || '',
          s.service_name || s.name || '',
          s.service_category || s.category || '',
          String(s.price || 0),
          ...activeSchemes.map(sch => priceMap[`${s.id}_${sch.id}`] || '')
        ]);
      });
    } else {
      rows.push(['Product Code', 'Product Name', 'Type', 'Base Price', ...schemeHeaders]);
      allProducts.forEach((p: any) => {
        rows.push([
          p.item_code || p.code || '',
          p.item_name || p.name || '',
          p.item_type || 'drug',
          String(p.selling_price || p.cost_price || 0),
          ...activeSchemes.map(sch => priceMap[`${p.id}_${sch.id}`] || '')
        ]);
      });
    }

    // Build CSV string with proper escaping
    const csv = rows.map(row => row.map(cell => {
      const s = String(cell);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const scopeSuffix = scope === 'selected' && selectedScheme ? (selectedScheme.scheme_code || selectedScheme.scheme_name).replace(/\s+/g, '-') : 'all-schemes';
    a.download = `scheme_${csvUploadType}_pricing_${scopeSuffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCsvFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      parseCsvText(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function parseCsvText(text: string) {
    // Simple CSV parser handling quoted fields
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { toast.error('CSV must have a header row and at least one data row'); return; }

    const parseRow = (line: string): string[] => {
      const cells: string[] = [];
      let current = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuote) {
          if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
          else if (ch === '"') { inQuote = false; }
          else { current += ch; }
        } else {
          if (ch === '"') { inQuote = true; }
          else if (ch === ',') { cells.push(current.trim()); current = ''; }
          else { current += ch; }
        }
      }
      cells.push(current.trim());
      return cells;
    };

    const header = parseRow(lines[0]);
    // First 4 columns are item info, rest are scheme columns
    const schemeCols = header.slice(4);
    const activeSchemes = schemes.filter(s => s.is_active);

    // Match scheme columns to scheme IDs by name
    const matched = schemeCols.map(colHeader => {
      // Column header format: "SchemeName (Currency)" - extract name
      const name = colHeader.replace(/\s*\([^)]*\)\s*$/, '').trim();
      const scheme = activeSchemes.find(s =>
        s.scheme_name.toLowerCase() === name.toLowerCase() ||
        s.scheme_code.toLowerCase() === name.toLowerCase()
      );
      return { name: colHeader, id: scheme?.id || '' };
    });
    setCsvSchemeColumns(matched);

    const items = csvUploadType === 'service' ? allServices : allProducts;

    const dataRows = lines.slice(1).map(line => {
      const cells = parseRow(line);
      const code = cells[0] || '';
      const itemName = cells[1] || '';

      // Match item by code (only if non-empty) or by name
      let item: any = null;
      if (csvUploadType === 'service') {
        item = items.find((s: any) => {
          if (code && (s.service_code || s.code || '') === code) return true;
          return itemName && (s.service_name || s.name || '').toLowerCase() === itemName.toLowerCase();
        });
      } else {
        item = items.find((p: any) => {
          if (code && (p.item_code || p.code || '') === code) return true;
          return itemName && (p.item_name || p.name || '').toLowerCase() === itemName.toLowerCase();
        });
      }

      const prices: Record<string, string> = {};
      schemeCols.forEach((_, idx) => {
        prices[idx] = cells[4 + idx] || '';
      });

      return {
        code,
        name: itemName,
        category: cells[2] || '',
        basePrice: cells[3] || '',
        itemId: item?.id || '',
        matched: !!item,
        prices
      };
    });

    setCsvParsedRows(dataRows);

    const unmatchedItems = dataRows.filter(r => !r.matched);
    const unmatchedSchemes = matched.filter(m => !m.id);
    if (unmatchedItems.length > 0) {
      toast.warning(`${unmatchedItems.length} item(s) could not be matched to existing records`);
    }
    if (unmatchedSchemes.length > 0) {
      toast.warning(`${unmatchedSchemes.length} scheme column(s) could not be matched: ${unmatchedSchemes.map(s => s.name).join(', ')}`);
    }
  }

  async function handleCsvUpload() {
    // Build flat array of { scheme_id, item_id, scheme_price }
    const prices: { scheme_id: string; item_id: string; scheme_price: string }[] = [];
    for (const row of csvParsedRows) {
      if (!row.itemId) continue;
      for (let i = 0; i < csvSchemeColumns.length; i++) {
        const schemeId = csvSchemeColumns[i].id;
        const val = row.prices[i];
        if (schemeId && val !== '' && val !== undefined) {
          prices.push({ scheme_id: schemeId, item_id: row.itemId, scheme_price: val });
        }
      }
    }

    if (prices.length === 0) { toast.error('No valid prices to upload'); return; }

    setCsvUploading(true);
    try {
      const res = await authFetch('/api/schemes/bulk-csv-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic_id: clinicId, item_type: csvUploadType, prices })
      });
      if (res.ok) {
        const result = await res.json();
        const msg = `${result.saved} prices saved, ${result.skipped} skipped${result.failed ? `, ${result.failed} failed` : ''}`;
        if (result.failed > 0) { toast.warning(msg); console.error('CSV upload errors:', result.errors); }
        else toast.success(msg);
        setShowCsvUpload(false);
        if (csvUploadType === 'service') loadServicePricing();
        else loadProductPricing();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to upload prices');
      }
    } catch { toast.error('Failed to upload prices'); }
    setCsvUploading(false);
  }

  // ── Tab config ──

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'schemes', label: 'Schemes', icon: Shield },
    { id: 'service-pricing', label: 'Service Pricing', icon: DollarSign },
    { id: 'product-pricing', label: 'Product Pricing', icon: FileSpreadsheet },
    { id: 'membership', label: 'Membership', icon: Users },
    { id: 'discounts', label: 'Discounts', icon: ArrowRightLeft },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
  ];

  const filteredSchemes = schemes.filter(s =>
    s.scheme_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.scheme_code?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedScheme = schemes.find(s => s.id === selectedSchemeId);

  // ── Scheme selector (shared across pricing/membership/discount tabs) ──
  function renderSchemeSelector() {
    return (
      <div className="flex items-center gap-4 mb-6">
        <div className="flex-1 max-w-sm">
          <Label className="text-xs">Select Scheme</Label>
          <Combobox
            options={schemes.filter(s => s.is_active).map(s => ({ value: s.id, label: `${s.scheme_name} (${s.scheme_code})` }))}
            value={selectedSchemeId}
            onChange={setSelectedSchemeId}
            placeholder="Choose a scheme..."
            searchPlaceholder="Search schemes..."
          />
        </div>
        {selectedScheme && (
          <div className="flex items-center gap-2 mt-5">
            <Badge variant={selectedScheme.is_insurance ? 'default' : 'secondary'} className="capitalize">
              {selectedScheme.scheme_type}
            </Badge>
            <Badge variant="outline">{selectedScheme.pricing_strategy}</Badge>
            {!!selectedScheme.is_insurance && <Badge className="bg-primary/10 text-primary">Copay: {selectedScheme.default_copay_percentage}%</Badge>}
          </div>
        )}
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="animate-fade-in w-full flex flex-col">
        <PageHeader
          icon={<Shield />}
          title="Patient Schemes & Pricing"
        />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="space-y-6">
          <TabsList className="w-full flex justify-start h-auto p-0 bg-transparent border-b border-border rounded-none gap-1 overflow-x-auto">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-none whitespace-nowrap"
              >
                <tab.icon className="w-4 h-4" />{tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {loading ? (
            <LoadingState message="Loading schemes data..." />
          ) : (
            <>
              <TabsContent value="schemes">{renderSchemesTab()}</TabsContent>
              <TabsContent value="service-pricing">{renderServicePricingTab()}</TabsContent>
              <TabsContent value="product-pricing">{renderProductPricingTab()}</TabsContent>
              <TabsContent value="membership">{renderMembershipTab()}</TabsContent>
              <TabsContent value="discounts">{renderDiscountsTab()}</TabsContent>
              <TabsContent value="reports">{renderReportsTab()}</TabsContent>
            </>
          )}
        </Tabs>

        {renderSchemeFormDialog()}
        {renderServicePriceDialog()}
        {renderProductPriceDialog()}
        {renderAddMemberDialog()}
        {renderDiscountDialog()}
        {renderCsvUploadDialog()}
      </div>
      </div>
    </AppLayout>
  );

  // ═══════ TAB RENDERS ═══════

  function renderSchemesTab() {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search schemes..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10 h-9" />
          </div>
          <Button onClick={() => { setEditingScheme(null); setSchemeForm(getEmptySchemeForm()); setShowSchemeForm(true); }}>
            <Plus className="w-4 h-4 mr-2" /> New Scheme
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSchemes.map(scheme => (
            <div key={scheme.id} className={`ic-card bg-white ${!scheme.is_active ? 'opacity-50' : ''}`}>
              <div className="ic-card-header">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-semibold text-[13px] text-foreground">{scheme.scheme_name}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{scheme.scheme_code}</p>
                  </div>
                  <div className="flex gap-1">
                    {!!scheme.is_default && <Badge className="bg-green-100 text-green-800 text-[10px]">Default</Badge>}
                    <Badge variant={scheme.is_active ? 'secondary' : 'destructive'} className="text-[10px] capitalize">{scheme.scheme_type}</Badge>
                  </div>
                </div>
              </div>
              <div className="ic-card-body">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Currency</span>
                    <Badge variant="outline" className="text-[10px] font-bold">{scheme.currency || currency.code}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Strategy</span>
                    <span className="capitalize font-medium">{scheme.pricing_strategy}</span>
                  </div>
                  {!!scheme.is_insurance && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Copay</span>
                      <span className="font-medium">{scheme.default_copay_percentage}%</span>
                    </div>
                  )}
                  {(scheme.base_markup_percentage > 0 || scheme.base_discount_percentage > 0) && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Markup/Disc</span>
                      <span className="font-medium">
                        {scheme.base_markup_percentage > 0 ? `+${scheme.base_markup_percentage}%` : ''}
                        {scheme.base_discount_percentage > 0 ? ` -${scheme.base_discount_percentage}%` : ''}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Members</span>
                    <span className="font-medium">{scheme.member_count || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment</span>
                    <span className="capitalize font-medium">{scheme.payment_terms?.replace(/_/g, ' ')}</span>
                  </div>
                </div>
                <div className="flex gap-1 mt-3 pt-3 border-t">
                  <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => {
                    setEditingScheme(scheme);
                    setSchemeForm({
                      scheme_code: scheme.scheme_code, scheme_name: scheme.scheme_name,
                      scheme_description: scheme.scheme_description || '', scheme_type: scheme.scheme_type,
                      is_default: !!scheme.is_default, pricing_strategy: scheme.pricing_strategy,
                      base_markup_percentage: String(scheme.base_markup_percentage || 0),
                      base_discount_percentage: String(scheme.base_discount_percentage || 0),
                      is_insurance: !!scheme.is_insurance, insurance_provider_name: scheme.insurance_provider_name || '',
                      insurance_provider_code: scheme.insurance_provider_code || '',
                      requires_authorization: !!scheme.requires_authorization, has_copay: !!scheme.has_copay,
                      default_copay_percentage: String(scheme.default_copay_percentage || 0),
                      copay_cap_per_visit: String(scheme.copay_cap_per_visit || ''),
                      payment_terms: scheme.payment_terms || 'immediate',
                      is_credit_allowed: !!scheme.is_credit_allowed, credit_limit: String(scheme.credit_limit || 0),
                      requires_deposit: !!scheme.requires_deposit, deposit_amount: String(scheme.deposit_amount || ''),
                      allows_negotiation: !!scheme.allows_negotiation, requires_verification: !!scheme.requires_verification,
                      requires_approval: !!scheme.requires_approval,
                      contact_person: scheme.contact_person || '', contact_phone: scheme.contact_phone || '',
                      contact_email: scheme.contact_email || '', notes: scheme.notes || '',
                      currency: scheme.currency || currency.code
                    });
                    setShowSchemeForm(true);
                  }}><Edit className="w-3 h-3 mr-1" />Edit</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                    setSelectedSchemeId(scheme.id); setActiveTab('service-pricing');
                  }}><DollarSign className="w-3 h-3 mr-1" />Pricing</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                    setSelectedSchemeId(scheme.id); setActiveTab('membership');
                  }}><Users className="w-3 h-3 mr-1" />Members</Button>
                  {!scheme.is_default && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => handleDeleteScheme(scheme.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filteredSchemes.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground">No schemes found</div>
          )}
        </div>
      </div>
    );
  }

  function renderServicePricingTab() {
    return (
      <div className="space-y-4">
        {renderSchemeSelector()}
        {!selectedSchemeId ? (
          <div className="text-center py-12 text-muted-foreground">Select a scheme to manage service pricing</div>
        ) : (
          <>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => openCsvUpload('service')}>
                <Upload className="w-4 h-4 mr-2" /> Upload CSV
              </Button>
              <Button onClick={() => { setServicePriceForm(getEmptyServicePriceForm()); setShowServicePriceForm(true); }}>
                <Plus className="w-4 h-4 mr-2" /> Set Service Price
              </Button>
            </div>
            <div className="ic-card bg-white">
              <div className="ic-card-header"><span className="font-semibold text-[13px] text-foreground">Service Prices for {selectedScheme?.scheme_name}</span></div>
              <div className="ic-card-body">
                <AdvancedDataTable<any>
                  data={servicePricing}
                  keyExtractor={(sp) => sp.id}
                  emptyMessage="No service prices set for this scheme. Services will use base price or scheme markup/discount."
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  searchable
                  searchPlaceholder="Search services..."
                  exportable
                  exportFileName={`${selectedScheme?.scheme_code || 'scheme'}-service-prices`}
                  columns={[
                    {
                      key: 'service_name', header: 'Service', sortable: true,
                      render: (v, sp) => (
                        <>
                          <div className="font-medium">{v}</div>
                          <div className="text-xs text-muted-foreground">{sp.catalog_category || sp.service_category}</div>
                        </>
                      ),
                    },
                    { key: 'base_price', header: 'Base Price', align: 'right', render: (v) => `${currency.code} ${parseFloat(v || 0).toFixed(2)}` },
                    {
                      key: 'scheme_price', header: 'Scheme Price', align: 'right',
                      render: (v) => <span className="font-bold">{v ? `${selectedScheme?.currency || currency.code} ${parseFloat(v).toFixed(2)}` : '-'}</span>,
                    },
                    {
                      key: '__markup', header: 'Markup/Disc', align: 'right',
                      render: (_v, sp) => (
                        <>
                          {sp.markup_percentage > 0 && <span className="text-green-600">+{sp.markup_percentage}%</span>}
                          {sp.discount_percentage > 0 && <span className="text-red-600">-{sp.discount_percentage}%</span>}
                        </>
                      ),
                    },
                    {
                      key: 'insurance_copay', header: 'Copay', align: 'right',
                      render: (v, sp) => v ? `${selectedScheme?.currency || currency.code} ${parseFloat(v).toFixed(2)}` : sp.insurance_copay_percentage ? `${sp.insurance_copay_percentage}%` : '-',
                    },
                    { key: 'effective_from', header: 'Effective', render: (v, sp) => <span className="text-xs">{v || '-'}{sp.effective_to ? ` to ${sp.effective_to}` : ''}</span> },
                    {
                      key: '__actions', header: 'Actions', align: 'right',
                      render: (_v, sp) => (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => handleDeleteServicePrice(sp.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderProductPricingTab() {
    return (
      <div className="space-y-4">
        {renderSchemeSelector()}
        {!selectedSchemeId ? (
          <div className="text-center py-12 text-muted-foreground">Select a scheme to manage product pricing</div>
        ) : (
          <>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => openCsvUpload('product')}>
                <Upload className="w-4 h-4 mr-2" /> Upload CSV
              </Button>
              <Button onClick={() => { setProductPriceForm(getEmptyProductPriceForm()); setShowProductPriceForm(true); }}>
                <Plus className="w-4 h-4 mr-2" /> Set Product Price
              </Button>
            </div>
            <div className="ic-card bg-white">
              <div className="ic-card-header"><span className="font-semibold text-[13px] text-foreground">Product Prices for {selectedScheme?.scheme_name}</span></div>
              <div className="ic-card-body">
                <AdvancedDataTable<any>
                  data={productPricing}
                  keyExtractor={(pp) => pp.id}
                  emptyMessage="No product prices set for this scheme"
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  searchable
                  searchPlaceholder="Search products..."
                  exportable
                  exportFileName={`${selectedScheme?.scheme_code || 'scheme'}-product-prices`}
                  columns={[
                    { key: 'product_name', header: 'Product', sortable: true, render: (v, pp) => <span className="font-medium">{v || pp.product_code}</span> },
                    { key: 'product_type', header: 'Type', render: (v) => <span className="capitalize">{v}</span> },
                    { key: 'base_price', header: 'Base Price', align: 'right', render: (v) => `${currency.code} ${parseFloat(v || 0).toFixed(2)}` },
                    { key: 'scheme_price', header: 'Scheme Price', align: 'right', render: (v) => <span className="font-bold">{v ? `${selectedScheme?.currency || currency.code} ${parseFloat(v).toFixed(2)}` : '-'}</span> },
                    {
                      key: 'insurance_copay', header: 'Copay', align: 'right',
                      render: (v, pp) => v ? `${selectedScheme?.currency || currency.code} ${parseFloat(v).toFixed(2)}` : pp.insurance_copay_percentage ? `${pp.insurance_copay_percentage}%` : '-',
                    },
                    { key: 'effective_from', header: 'Effective', render: (v) => <span className="text-xs">{v || '-'}</span> },
                    {
                      key: '__actions', header: 'Actions', align: 'right',
                      render: (_v, pp) => (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => handleDeleteProductPrice(pp.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderMembershipTab() {
    return (
      <div className="space-y-4">
        {renderSchemeSelector()}
        {!selectedSchemeId ? (
          <div className="text-center py-12 text-muted-foreground">Select a scheme to manage membership</div>
        ) : (
          <>
            <div className="flex justify-end">
              <Button onClick={() => setShowAddMemberForm(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Member
              </Button>
            </div>
            <div className="ic-card bg-white">
              <div className="ic-card-header"><span className="font-semibold text-[13px] text-foreground">Members of {selectedScheme?.scheme_name}</span></div>
              <div className="ic-card-body">
                <AdvancedDataTable<any>
                  data={members}
                  keyExtractor={(m) => m.id}
                  emptyMessage="No members in this scheme"
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    {
                      key: 'patient_name', header: 'Patient', sortable: true,
                      render: (v, m) => (
                        <>
                          {v || 'Unknown patient'}
                          {m.patient_number && <span className="ml-1.5 text-xs text-muted-foreground font-mono">({m.patient_number})</span>}
                        </>
                      ),
                    },
                    { key: 'member_number', header: 'Member #', render: (v) => <span className="font-mono text-xs">{v || '-'}</span> },
                    { key: 'relationship_to_member', header: 'Relationship', render: (v) => <span className="capitalize">{v}</span> },
                    { key: 'effective_from', header: 'From', render: (v) => <span className="text-xs">{v}</span> },
                    { key: 'effective_to', header: 'To', render: (v) => <span className="text-xs">{v || 'Ongoing'}</span> },
                    {
                      key: 'verified', header: 'Verified', align: 'center',
                      render: (v, m) => v ? (
                        <span title={m.verified_by ? `Verified by ${m.verified_by}${m.verified_date ? ` on ${m.verified_date}` : ''}` : undefined}>
                          <CheckCircle className="w-4 h-4 text-green-600 inline" />
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => handleVerifyMember(m.id)} disabled={verifyingId === m.id}>
                          {verifyingId === m.id ? 'Verifying...' : 'Verify'}
                        </Button>
                      ),
                    },
                    {
                      key: 'is_active', header: 'Status', align: 'center',
                      render: (v) => <Badge variant={v ? 'default' : 'destructive'} className="text-[10px]">{v ? 'Active' : 'Inactive'}</Badge>,
                    },
                    {
                      key: '__actions', header: 'Actions', align: 'right',
                      render: (_v, m) => (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => handleRemoveMember(m.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderDiscountsTab() {
    return (
      <div className="space-y-4">
        {renderSchemeSelector()}
        {!selectedSchemeId ? (
          <div className="text-center py-12 text-muted-foreground">Select a scheme to manage discounts</div>
        ) : (
          <>
            <div className="flex justify-end">
              <Button onClick={() => { setDiscountForm(getEmptyDiscountForm()); setShowDiscountForm(true); }}>
                <Plus className="w-4 h-4 mr-2" /> New Discount
              </Button>
            </div>
            <div className="ic-card bg-white">
              <div className="ic-card-header"><span className="font-semibold text-[13px] text-foreground">Discounts for {selectedScheme?.scheme_name}</span></div>
              <div className="ic-card-body">
                <AdvancedDataTable<any>
                  data={discounts}
                  keyExtractor={(d) => d.id}
                  emptyMessage="No discounts configured"
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    { key: 'discount_code', header: 'Code', render: (v) => <span className="font-mono text-xs">{v}</span> },
                    { key: 'discount_name', header: 'Name', sortable: true },
                    { key: 'discount_type', header: 'Type', render: (v) => <span className="capitalize">{v?.replace('_', ' ')}</span> },
                    {
                      key: 'discount_value', header: 'Value', align: 'right',
                      render: (v, d) => <span className="font-bold">{d.discount_type === 'percentage' ? `${v}%` : `${selectedScheme?.currency || currency.code} ${parseFloat(v || 0).toFixed(2)}`}</span>,
                    },
                    { key: 'applies_to', header: 'Applies To', render: (v) => <span className="capitalize">{v?.replace('_', ' ')}</span> },
                    { key: 'effective_from', header: 'Period', render: (v, d) => <span className="text-xs">{v || 'Always'}{d.effective_to ? ` - ${d.effective_to}` : ''}</span> },
                    {
                      key: 'is_active', header: 'Status', align: 'center',
                      render: (v) => <Badge variant={v ? 'default' : 'destructive'} className="text-[10px]">{v ? 'Active' : 'Inactive'}</Badge>,
                    },
                  ]}
                />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderReportsTab() {
    return (
      <div className="space-y-6">
        <div className="flex justify-end"><Button variant="outline" size="sm" onClick={loadReports}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button></div>

        {/* Membership Report */}
        <div className="ic-card bg-white">
          <div className="ic-card-header"><span className="font-semibold text-[13px] text-foreground">Membership by Scheme</span></div>
          <div className="ic-card-body">
            <AdvancedDataTable<any>
              data={membershipReport}
              keyExtractor={(r, i) => i}
              columns={[
                { key: 'scheme_name', header: 'Scheme', render: (v) => <span className="font-medium">{v}</span> },
                { key: 'scheme_type', header: 'Type', render: (v) => <span className="capitalize">{v}</span> },
                { key: 'active_members', header: 'Active', align: 'right', render: (v) => <span className="text-green-600 font-bold">{v}</span> },
                { key: 'inactive_members', header: 'Inactive', align: 'right', render: (v) => <span className="text-muted-foreground">{v}</span> },
                { key: 'total_members', header: 'Total', align: 'right', render: (v) => <span className="font-bold">{v}</span> },
              ]}
            />
          </div>
        </div>

        {/* Margin Analysis */}
        <div className="ic-card bg-white">
          <div className="ic-card-header"><span className="font-semibold text-[13px] text-foreground">Margin Analysis by Scheme</span></div>
          <div className="ic-card-body">
            <AdvancedDataTable<any>
              data={marginReport}
              keyExtractor={(r, i) => i}
              columns={[
                { key: 'scheme_name', header: 'Scheme', render: (v) => <span className="font-medium">{v}</span> },
                { key: 'services_priced', header: 'Services Priced', align: 'right', render: (v) => v || 0 },
                {
                  key: 'avg_margin_pct', header: 'Avg Margin %', align: 'right',
                  render: (v) => v !== null ? <span className={parseFloat(v) >= 0 ? 'text-green-600' : 'text-red-600'}>{parseFloat(v || 0).toFixed(1)}%</span> : '-',
                },
                { key: 'above_base', header: 'Above Base', align: 'right', render: (v) => <span className="text-green-600">{v || 0}</span> },
                { key: 'below_base', header: 'Below Base', align: 'right', render: (v) => <span className="text-red-600">{v || 0}</span> },
                { key: 'at_base', header: 'At Base', align: 'right', render: (v) => v || 0 },
              ]}
            />
          </div>
        </div>
      </div>
    );
  }

  // ═══════ DIALOGS ═══════

  function renderSchemeFormDialog() {
    return (
      <Dialog open={showSchemeForm} onOpenChange={setShowSchemeForm}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingScheme ? 'Edit Scheme' : 'New Scheme'}</DialogTitle>
            <DialogDescription>Configure patient scheme details, pricing strategy, and financial terms</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Scheme Code *</Label>
                <Input value={schemeForm.scheme_code} onChange={e => setSchemeForm(f => ({...f, scheme_code: e.target.value.toUpperCase()}))}
                  placeholder="e.g. NHIF" disabled={!!editingScheme} /></div>
              <div><Label>Scheme Name *</Label>
                <Input value={schemeForm.scheme_name} onChange={e => setSchemeForm(f => ({...f, scheme_name: e.target.value}))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Scheme Type *</Label>
                <Combobox
                  options={SCHEME_TYPES}
                  value={schemeForm.scheme_type}
                  onChange={v => setSchemeForm(f => ({...f, scheme_type: v, is_insurance: v === 'insurance'}))}
                  searchPlaceholder="Search..."
                />
              </div>
              <div><Label>Pricing Strategy</Label>
                <Combobox
                  options={[
                    { value: 'fixed', label: 'Fixed (Exact scheme prices)' },
                    { value: 'percentage', label: 'Percentage (Markup/discount from base)' },
                    { value: 'tiered', label: 'Tiered (Volume-based)' },
                    { value: 'formula', label: 'Formula (Custom calculation)' },
                  ]}
                  value={schemeForm.pricing_strategy}
                  onChange={v => setSchemeForm(f => ({...f, pricing_strategy: v}))}
                  searchPlaceholder="Search..."
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Description</Label>
                <Textarea value={schemeForm.scheme_description} onChange={e => setSchemeForm(f => ({...f, scheme_description: e.target.value}))} rows={2} /></div>
              <div><Label>Currency *</Label>
                <Combobox
                  options={[
                    ...(currency.code ? [{ value: currency.code, label: `${currency.code} (${currency.name})` }] : []),
                    ...(currency.code !== 'USD' ? [{ value: 'USD', label: 'USD (US Dollar)' }] : []),
                  ]}
                  value={schemeForm.currency}
                  onChange={v => setSchemeForm(f => ({...f, currency: v}))}
                  searchPlaceholder="Search..."
                />
                <p className="text-[11px] text-muted-foreground mt-1">All prices for this scheme will be in this currency</p>
              </div>
            </div>

            {schemeForm.pricing_strategy === 'percentage' && (
              <div className="grid grid-cols-2 gap-4 p-3 bg-muted/30 rounded-lg">
                <div><Label>Base Markup %</Label>
                  <Input type="number" value={schemeForm.base_markup_percentage} onChange={e => setSchemeForm(f => ({...f, base_markup_percentage: e.target.value}))} /></div>
                <div><Label>Base Discount %</Label>
                  <Input type="number" value={schemeForm.base_discount_percentage} onChange={e => setSchemeForm(f => ({...f, base_discount_percentage: e.target.value}))} /></div>
              </div>
            )}

            {schemeForm.is_insurance && (
              <div className="p-3 bg-primary/10 rounded-lg space-y-3">
                <h4 className="font-medium text-primary text-sm">Insurance Configuration</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Provider Name</Label>
                    <Input value={schemeForm.insurance_provider_name} onChange={e => setSchemeForm(f => ({...f, insurance_provider_name: e.target.value}))} /></div>
                  <div><Label>Provider Code</Label>
                    <Input value={schemeForm.insurance_provider_code} onChange={e => setSchemeForm(f => ({...f, insurance_provider_code: e.target.value}))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Default Copay %</Label>
                    <Input type="number" value={schemeForm.default_copay_percentage} onChange={e => setSchemeForm(f => ({...f, default_copay_percentage: e.target.value}))} /></div>
                  <div><Label>Copay Cap Per Visit ({schemeForm.currency || currency.code})</Label>
                    <Input type="number" value={schemeForm.copay_cap_per_visit} onChange={e => setSchemeForm(f => ({...f, copay_cap_per_visit: e.target.value}))} placeholder="No cap" /></div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={schemeForm.requires_authorization} onChange={() => setSchemeForm(f => ({...f, requires_authorization: !f.requires_authorization}))}
                    className="w-4 h-4 rounded" />
                  <span className="text-sm">Requires pre-authorization for procedures</span>
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Payment Terms</Label>
                <Combobox
                  options={[
                    { value: 'immediate', label: 'Immediate' },
                    { value: 'net_7', label: 'Net 7 Days' },
                    { value: 'net_15', label: 'Net 15 Days' },
                    { value: 'net_30', label: 'Net 30 Days' },
                    { value: 'net_60', label: 'Net 60 Days' },
                  ]}
                  value={schemeForm.payment_terms}
                  onChange={v => setSchemeForm(f => ({...f, payment_terms: v}))}
                  searchPlaceholder="Search..."
                />
              </div>
              <div><Label>Credit Limit ({schemeForm.currency || currency.code})</Label>
                <Input type="number" value={schemeForm.credit_limit} onChange={e => setSchemeForm(f => ({...f, credit_limit: e.target.value}))} /></div>
            </div>

            <div className="flex flex-wrap gap-4">
              {[
                ['is_default', 'Set as default scheme'],
                ['is_credit_allowed', 'Allow credit'],
                ['requires_verification', 'Requires verification'],
                ['requires_approval', 'Requires approval'],
                ['allows_negotiation', 'Allows price negotiation'],
                ['requires_deposit', 'Requires deposit'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!(schemeForm as any)[key]}
                    onChange={() => setSchemeForm(f => ({...f, [key]: !(f as any)[key]}))}
                    className="w-4 h-4 rounded" />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div><Label>Contact Person</Label>
                <Input value={schemeForm.contact_person} onChange={e => setSchemeForm(f => ({...f, contact_person: e.target.value}))} /></div>
              <div><Label>Phone</Label>
                <Input value={schemeForm.contact_phone} onChange={e => setSchemeForm(f => ({...f, contact_phone: e.target.value}))} /></div>
              <div><Label>Email</Label>
                <Input value={schemeForm.contact_email} onChange={e => setSchemeForm(f => ({...f, contact_email: e.target.value}))} /></div>
            </div>

            <div><Label>Notes</Label>
              <Textarea value={schemeForm.notes} onChange={e => setSchemeForm(f => ({...f, notes: e.target.value}))} rows={2} /></div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowSchemeForm(false)}>Cancel</Button>
              <Button onClick={handleSaveScheme}><Save className="w-4 h-4 mr-2" />{editingScheme ? 'Update' : 'Create'} Scheme</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function renderServicePriceDialog() {
    return (
      <Dialog open={showServicePriceForm} onOpenChange={setShowServicePriceForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Set Service Price</DialogTitle><DialogDescription>Set a custom price for this service in the selected scheme</DialogDescription></DialogHeader>
          <div className="px-5 py-4 space-y-4">
            <div><Label>Service *</Label>
              <Combobox
                options={allServices.map((s: any) => ({ value: s.id, label: `${s.service_name || s.name} - ${selectedScheme?.currency || currency.code} ${parseFloat(s.price || 0).toFixed(2)}` }))}
                value={servicePriceForm.service_id}
                onChange={v => setServicePriceForm(f => ({...f, service_id: v}))}
                placeholder="Select service..."
                searchPlaceholder="Search services..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Scheme Price ({selectedScheme?.currency || currency.code})</Label>
                <Input type="number" value={servicePriceForm.scheme_price} onChange={e => setServicePriceForm(f => ({...f, scheme_price: e.target.value}))} placeholder="Leave blank for auto-calculate" /></div>
              <div><Label>Effective From</Label>
                <Input type="date" value={servicePriceForm.effective_from} onChange={e => setServicePriceForm(f => ({...f, effective_from: e.target.value}))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Markup %</Label>
                <Input type="number" value={servicePriceForm.markup_percentage} onChange={e => setServicePriceForm(f => ({...f, markup_percentage: e.target.value}))} /></div>
              <div><Label>Discount %</Label>
                <Input type="number" value={servicePriceForm.discount_percentage} onChange={e => setServicePriceForm(f => ({...f, discount_percentage: e.target.value}))} /></div>
            </div>
            {selectedScheme?.is_insurance && (
              <div className="grid grid-cols-2 gap-4 p-3 bg-primary/10 rounded-lg">
                <div><Label>Insurance Copay ({selectedScheme?.currency || currency.code})</Label>
                  <Input type="number" value={servicePriceForm.insurance_copay} onChange={e => setServicePriceForm(f => ({...f, insurance_copay: e.target.value}))} /></div>
                <div><Label>Copay %</Label>
                  <Input type="number" value={servicePriceForm.insurance_copay_percentage} onChange={e => setServicePriceForm(f => ({...f, insurance_copay_percentage: e.target.value}))} /></div>
              </div>
            )}
            <div><Label>Notes</Label>
              <Textarea value={servicePriceForm.notes} onChange={e => setServicePriceForm(f => ({...f, notes: e.target.value}))} rows={2} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowServicePriceForm(false)}>Cancel</Button>
              <Button onClick={handleSaveServicePrice}>Save Price</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function renderProductPriceDialog() {
    return (
      <Dialog open={showProductPriceForm} onOpenChange={setShowProductPriceForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Set Product Price</DialogTitle></DialogHeader>
          <div className="px-5 py-4 space-y-4">
            <div><Label>Product *</Label>
              <Combobox
                options={allProducts.map((p: any) => ({ value: p.id, label: `${p.item_name} - ${selectedScheme?.currency || currency.code} ${parseFloat(p.selling_price || p.cost_price || 0).toFixed(2)}` }))}
                value={productPriceForm.product_id}
                onChange={v => setProductPriceForm(f => ({...f, product_id: v}))}
                placeholder="Select product..."
                searchPlaceholder="Search products..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Product Type</Label>
                <Combobox
                  options={[
                    { value: 'drug', label: 'Drug' },
                    { value: 'supply', label: 'Supply' },
                    { value: 'equipment', label: 'Equipment' },
                    { value: 'other', label: 'Other' },
                  ]}
                  value={productPriceForm.product_type}
                  onChange={v => setProductPriceForm(f => ({...f, product_type: v}))}
                  searchPlaceholder="Search..."
                />
              </div>
              <div><Label>Scheme Price ({selectedScheme?.currency || currency.code})</Label>
                <Input type="number" value={productPriceForm.scheme_price} onChange={e => setProductPriceForm(f => ({...f, scheme_price: e.target.value}))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Markup %</Label>
                <Input type="number" value={productPriceForm.markup_percentage} onChange={e => setProductPriceForm(f => ({...f, markup_percentage: e.target.value}))} /></div>
              <div><Label>Discount %</Label>
                <Input type="number" value={productPriceForm.discount_percentage} onChange={e => setProductPriceForm(f => ({...f, discount_percentage: e.target.value}))} /></div>
            </div>
            {selectedScheme?.is_insurance && (
              <div className="grid grid-cols-2 gap-4 p-3 bg-primary/10 rounded-lg">
                <div><Label>Insurance Copay ({selectedScheme?.currency || currency.code})</Label>
                  <Input type="number" value={productPriceForm.insurance_copay} onChange={e => setProductPriceForm(f => ({...f, insurance_copay: e.target.value}))} /></div>
                <div><Label>Copay %</Label>
                  <Input type="number" value={productPriceForm.insurance_copay_percentage} onChange={e => setProductPriceForm(f => ({...f, insurance_copay_percentage: e.target.value}))} /></div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowProductPriceForm(false)}>Cancel</Button>
              <Button onClick={handleSaveProductPrice}>Save Price</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function renderAddMemberDialog() {
    return (
      <Dialog open={showAddMemberForm} onOpenChange={setShowAddMemberForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Member to Scheme</DialogTitle></DialogHeader>
          <div className="px-5 py-4 space-y-4">
            <div><Label>Patient *</Label>
              <Combobox
                options={patients.map((p: any) => ({ value: p.id, label: `${p.first_name} ${p.last_name} (${p.patient_id}${p.source === 'lis' ? ' · LIS' : ''})` }))}
                value={memberForm.patient_id}
                onChange={v => setMemberForm(f => ({...f, patient_id: v}))}
                placeholder="Select patient..."
                searchPlaceholder="Search patients..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Member Number</Label>
                <Input value={memberForm.member_number} onChange={e => setMemberForm(f => ({...f, member_number: e.target.value}))} placeholder="Optional" /></div>
              <div><Label>Effective From</Label>
                <Input type="date" value={memberForm.effective_from} onChange={e => setMemberForm(f => ({...f, effective_from: e.target.value}))} /></div>
            </div>
            <div><Label>Relationship</Label>
              <Combobox
                options={[
                  { value: 'self', label: 'Self' },
                  { value: 'spouse', label: 'Spouse' },
                  { value: 'child', label: 'Child' },
                  { value: 'dependent', label: 'Dependent' },
                ]}
                value={memberForm.relationship_to_member}
                onChange={v => setMemberForm(f => ({...f, relationship_to_member: v}))}
                searchPlaceholder="Search..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddMemberForm(false)}>Cancel</Button>
              <Button onClick={handleAddMember}>Add Member</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function renderDiscountDialog() {
    return (
      <Dialog open={showDiscountForm} onOpenChange={setShowDiscountForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Scheme Discount</DialogTitle></DialogHeader>
          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Discount Code *</Label>
                <Input value={discountForm.discount_code} onChange={e => setDiscountForm(f => ({...f, discount_code: e.target.value.toUpperCase()}))} /></div>
              <div><Label>Discount Name</Label>
                <Input value={discountForm.discount_name} onChange={e => setDiscountForm(f => ({...f, discount_name: e.target.value}))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Discount Type</Label>
                <Combobox
                  options={[
                    { value: 'percentage', label: 'Percentage' },
                    { value: 'fixed_amount', label: 'Fixed Amount' },
                    { value: 'bundle', label: 'Bundle' },
                    { value: 'loyalty', label: 'Loyalty' },
                  ]}
                  value={discountForm.discount_type}
                  onChange={v => setDiscountForm(f => ({...f, discount_type: v}))}
                  searchPlaceholder="Search..."
                />
              </div>
              <div><Label>Value {discountForm.discount_type === 'percentage' ? '(%)' : `(${selectedScheme?.currency || currency.code})`}</Label>
                <Input type="number" value={discountForm.discount_value} onChange={e => setDiscountForm(f => ({...f, discount_value: e.target.value}))} /></div>
            </div>
            <div><Label>Applies To</Label>
              <Combobox
                options={[
                  { value: 'all', label: 'All Items' },
                  { value: 'all_services', label: 'All Services' },
                  { value: 'all_products', label: 'All Products' },
                  { value: 'selected_services', label: 'Selected Services' },
                  { value: 'selected_products', label: 'Selected Products' },
                ]}
                value={discountForm.applies_to}
                onChange={v => setDiscountForm(f => ({...f, applies_to: v}))}
                searchPlaceholder="Search..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Min Bill Amount</Label>
                <Input type="number" value={discountForm.min_bill_amount} onChange={e => setDiscountForm(f => ({...f, min_bill_amount: e.target.value}))} placeholder="No minimum" /></div>
              <div><Label>Effective From</Label>
                <Input type="date" value={discountForm.effective_from} onChange={e => setDiscountForm(f => ({...f, effective_from: e.target.value}))} /></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowDiscountForm(false)}>Cancel</Button>
              <Button onClick={handleSaveDiscount}>Create Discount</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function renderCsvUploadDialog() {
    const totalPrices = csvParsedRows.reduce((acc, row) => {
      return acc + csvSchemeColumns.filter((_, i) => row.prices[i] && row.prices[i] !== '' && row.matched).length;
    }, 0);
    const matchedItems = csvParsedRows.filter(r => r.matched).length;
    const matchedSchemes = csvSchemeColumns.filter(s => s.id).length;

    return (
      <Dialog open={showCsvUpload} onOpenChange={setShowCsvUpload}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <Upload className="w-5 h-5 inline mr-2" />
              Upload {csvUploadType === 'service' ? 'Service' : 'Product'} Pricing CSV
            </DialogTitle>
            <DialogDescription>
              Upload a CSV file with {csvUploadType} prices for one scheme or every scheme at once. Each row is a {csvUploadType}, and each scheme has its own price column.
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-4 space-y-4">
            {/* Step 1: Download template & Upload file */}
            <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-lg border border-dashed">
              <div className="flex-1">
                <p className="text-sm font-medium mb-1">Step 1: Download a template, fill in the price column(s), then upload</p>
                <p className="text-xs text-muted-foreground">
                  Every {csvUploadType === 'service' ? 'service' : 'product'} is a row, with its current base price and any existing scheme price(s) pre-filled.
                  Edit the price under a scheme's column and leave the rest blank to skip them — the upload applies each column to its own scheme.
                </p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => downloadCsvTemplate('selected')} disabled={!selectedScheme}>
                  <Download className="w-4 h-4 mr-2" /> This Scheme{selectedScheme ? ` (${selectedScheme.scheme_name})` : ''}
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadCsvTemplate('all')}>
                  <Download className="w-4 h-4 mr-2" /> All Schemes
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-lg border border-dashed">
              <div className="flex-1">
                <p className="text-sm font-medium mb-1">Step 2: Upload your filled CSV file</p>
                <p className="text-xs text-muted-foreground">
                  The file must have the same column structure as the template. Items are matched by code or name.
                </p>
              </div>
              <label className="cursor-pointer">
                <input type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvFileSelect} />
                <Button variant="default" size="sm" asChild>
                  <span><Upload className="w-4 h-4 mr-2" /> Choose File</span>
                </Button>
              </label>
            </div>

            {/* Preview parsed data */}
            {csvParsedRows.length > 0 && (
              <>
                <div className="flex items-center gap-4 text-sm">
                  <Badge variant="outline">{csvParsedRows.length} rows</Badge>
                  <Badge variant={matchedItems === csvParsedRows.length ? 'default' : 'destructive'}>
                    {matchedItems}/{csvParsedRows.length} items matched
                  </Badge>
                  <Badge variant={matchedSchemes === csvSchemeColumns.length ? 'default' : 'destructive'}>
                    {matchedSchemes}/{csvSchemeColumns.length} schemes matched
                  </Badge>
                  <Badge className="bg-green-100 text-green-800">{totalPrices} prices to upload</Badge>
                </div>

                <AdvancedDataTable<any>
                  data={csvParsedRows.slice(0, 100)}
                  keyExtractor={(row, idx) => idx}
                  rowClassName={(row) => row.matched ? '' : 'bg-red-50'}
                  columns={[
                    {
                      key: 'matched', header: 'Status',
                      render: (v) => v ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <AlertCircle className="w-3.5 h-3.5 text-red-500" />,
                    },
                    { key: 'code', header: 'Code', render: (v) => <span className="font-mono">{v}</span> },
                    { key: 'name', header: 'Name', render: (v) => <span className="max-w-[200px] truncate block">{v}</span> },
                    { key: 'basePrice', header: 'Base Price', align: 'right' },
                    ...csvSchemeColumns.map((sc, i) => ({
                      key: `__scheme_${i}`,
                      header: sc.name.length > 20 ? sc.name.slice(0, 20) + '...' : sc.name,
                      align: 'right' as const,
                      render: (_v: any, row: any) => (
                        <span className={row.prices[i] ? 'text-primary font-medium' : 'text-muted-foreground'}>{row.prices[i] || '-'}</span>
                      ),
                    })),
                  ]}
                />
                {csvParsedRows.length > 100 && (
                  <p className="text-xs text-muted-foreground text-center">Showing first 100 of {csvParsedRows.length} rows</p>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setShowCsvUpload(false)}>Cancel</Button>
                  <Button onClick={handleCsvUpload} disabled={csvUploading || totalPrices === 0}>
                    {csvUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    Upload {totalPrices} Prices
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }
};

export default SchemeManagement;
