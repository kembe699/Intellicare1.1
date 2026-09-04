import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import * as docTemplate from '@/utils/documentTemplate';
import {
  FileSignature, Search, Plus, Minus, Trash2, User, Stethoscope, Package,
  Printer, ArrowRightLeft, Loader2, X, Receipt, CheckCircle2, Clock, ChevronsUpDown, Check,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface CartLine {
  type: 'service' | 'product';
  refId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  currency: string;
}

interface ProformaRecord {
  id: string;
  proforma_number: string;
  patient_id: string;
  patient_name: string;
  items: any[];
  subtotal: string | number;
  currency: string;
  notes: string | null;
  status: 'draft' | 'converted';
  converted_bill_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export default function ProformaInvoicePage() {
  const { user } = useAuth();
  const { currency: baseCurrency } = useCurrency();
  const facilityInfo = useFacilityInfo();
  const clinicId = user?.clinic || 1;

  const [view, setView] = useState<'new' | 'history'>('new');

  // Patient search
  const [patientSearch, setPatientSearch] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);

  // Catalog
  const [catalogTab, setCatalogTab] = useState<'services' | 'products'>('services');
  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [catalogQty, setCatalogQty] = useState('1');
  const [catalogPopoverOpen, setCatalogPopoverOpen] = useState(false);

  // Cart
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Just-saved proforma (so Print / Convert actions can appear inline)
  const [savedProforma, setSavedProforma] = useState<ProformaRecord | null>(null);

  // History
  const [history, setHistory] = useState<ProformaRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [convertingId, setConvertingId] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalog();
    fetchPeople();
  }, []);

  useEffect(() => {
    if (view === 'history') fetchHistory();
  }, [view]);

  // Proforma invoices should be available for any patient, whether they were
  // registered as an outpatient (/api/patients) or through the LIS module
  // (/api/lis/participants) — patient_bills already treats both as valid
  // billing subjects, so this mirrors the exact same merge PatientsBill.tsx
  // uses rather than only covering one source.
  const fetchPeople = async () => {
    try {
      const [patientsRes, lisRes] = await Promise.all([
        // Deliberately NOT filtered by clinic. clinic_id is the department a
        // patient was registered under (Outpatient, General, ...), not an access
        // boundary — the tenant schema is the boundary, and the server still
        // scopes this list to the caller's branch. Filtering the picker by the
        // operator's own clinic meant a pharmacist registered under one clinic
        // simply could not find a patient registered under another, which read
        // as names "sometimes" loading. The LIS half of this same picker has
        // always been unfiltered, so the two halves now agree.
        authFetch('/api/patients', { credentials: 'include' }).catch(() => null),
        authFetch('/api/lis/participants', { credentials: 'include' }).catch(() => null),
      ]);
      const merged: any[] = [];
      if (patientsRes?.ok) {
        const data = await patientsRes.json();
        (Array.isArray(data) ? data : []).forEach((p: any) => merged.push({
          id: p.id, first_name: p.first_name, last_name: p.last_name, code: p.patient_id, phone: p.phone_number, source: 'patients',
        }));
      }
      if (lisRes?.ok) {
        const data = await lisRes.json();
        (Array.isArray(data) ? data : []).forEach((p: any) => merged.push({
          id: p.id, first_name: p.first_name, last_name: p.last_name, code: p.participant_number, phone: p.phone_number, source: 'lis',
        }));
      }
      setPeople(merged);
    } catch (e) {
      console.error('Failed to fetch people', e);
    }
  };

  const fetchCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const [svcRes, prodRes] = await Promise.all([
        authFetch(`/api/clinical/services/${clinicId}`, { credentials: 'include' }),
        authFetch(`/api/inventory/items?clinic_id=${clinicId}&is_active=true`, { credentials: 'include' }),
      ]);
      if (svcRes.ok) {
        const data = await svcRes.json();
        setServices(Array.isArray(data) ? data.filter((s: any) => s.is_active) : []);
      }
      if (prodRes.ok) {
        const data = await prodRes.json();
        setProducts(Array.isArray(data) ? data : (data.data || data.items || []));
      }
    } catch (e) {
      toast.error('Failed to load services/products catalog');
    } finally {
      setLoadingCatalog(false);
    }
  };

  const patientResults = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return people.filter(p =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
      p.code?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [patientSearch, people]);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await authFetch(`/api/proforma-invoices?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setHistory(await res.json());
    } catch (e) {
      toast.error('Failed to load proforma invoice history');
    } finally {
      setLoadingHistory(false);
    }
  };

  const addToCart = (type: 'service' | 'product', item: any, quantity: number = 1) => {
    const refId = item.id;
    const name = type === 'service' ? item.service_name : item.item_name;
    const unitPrice = parseFloat(type === 'service' ? item.price : item.selling_price) || 0;
    if (unitPrice <= 0) { toast.error(`${name} has no price set`); return; }

    setCart(prev => {
      const existing = prev.find(l => l.type === type && l.refId === refId);
      if (existing) {
        return prev.map(l => l === existing ? { ...l, quantity: l.quantity + quantity } : l);
      }
      return [...prev, { type, refId, name, quantity, unitPrice, currency: item.currency || baseCurrency.code || 'SSP' }];
    });
  };

  const updateQuantity = (refId: string, type: string, delta: number) => {
    setCart(prev => prev
      .map(l => (l.refId === refId && l.type === type) ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)
    );
  };

  const removeFromCart = (refId: string, type: string) => {
    setCart(prev => prev.filter(l => !(l.refId === refId && l.type === type)));
  };

  const selectedCatalogItem = (catalogTab === 'services' ? services : products).find((x: any) => x.id === selectedCatalogId);
  const selectedCatalogLabel = selectedCatalogItem
    ? (catalogTab === 'services' ? selectedCatalogItem.service_name : selectedCatalogItem.item_name)
    : '';

  const handleAddSelected = () => {
    if (!selectedCatalogId) { toast.error(`Select a ${catalogTab === 'services' ? 'service' : 'product'} first`); return; }
    const qty = parseInt(catalogQty) || 1;
    const list = catalogTab === 'services' ? services : products;
    const item = list.find((x: any) => x.id === selectedCatalogId);
    if (!item) return;
    addToCart(catalogTab === 'services' ? 'service' : 'product', item, qty);
    setSelectedCatalogId('');
    setCatalogQty('1');
  };

  const cartTotal = useMemo(() => cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0), [cart]);

  const resetForm = () => {
    setSelectedPatient(null);
    // patientResults is derived from patientSearch via useMemo — there is no
    // setter, and calling one threw a ReferenceError that aborted the whole
    // reset. Clearing the search above already empties the results.
    setPatientSearch('');
    setCart([]);
    setNotes('');
    setSavedProforma(null);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!selectedPatient) { toast.error('Select a patient first'); return; }
    if (cart.length === 0) { toast.error('Add at least one service or product'); return; }

    setSaving(true);
    try {
      const items = cart.map(l => ({
        serviceId: l.refId, serviceName: l.name, quantity: l.quantity,
        unitPrice: l.unitPrice, totalPrice: l.unitPrice * l.quantity, currency: l.currency,
        itemType: l.type,
      }));
      const res = await authFetch('/api/proforma-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`.trim(),
          items, notes, currency: baseCurrency.code || 'SSP', clinic_id: clinicId,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setSavedProforma(created);
        toast.success(`Proforma ${created.proforma_number} saved`);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save proforma invoice');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const buildProformaHTML = async (proforma: ProformaRecord) => {
    const signature = await docTemplate.fetchUserSignature(proforma.created_by);
    const items = Array.isArray(proforma.items) ? proforma.items : [];
    const itemRows: docTemplate.TableRow[] = items.map((it: any, i: number) => ({
      cells: [
        i + 1,
        it.serviceName,
        it.itemType === 'product' ? 'Product' : 'Service',
        it.quantity,
        docTemplate.formatCurrency(it.unitPrice, proforma.currency),
        docTemplate.formatCurrency(it.totalPrice, proforma.currency),
      ],
    }));

    const bodyHTML = [
      docTemplate.buildInfoGrid(
        { title: 'Proforma Details', rows: [
          { label: 'Proforma No.', value: proforma.proforma_number, bold: true },
          { label: 'Date', value: docTemplate.formatDate(proforma.created_at) },
          { label: 'Status', value: proforma.status === 'converted' ? 'Converted to Bill' : 'Draft — Not Yet Billed' },
          { label: 'Currency', value: proforma.currency },
        ]},
        { title: 'Patient Details', rows: [
          { label: 'Patient', value: proforma.patient_name, bold: true },
        ]}
      ),
      `<div class="ic-section-title">Items &amp; Services Quoted</div>`,
      docTemplate.buildTable(
        [
          { label: '#', align: 'center', width: '40px' },
          { label: 'Description' },
          { label: 'Type', align: 'center' },
          { label: 'Qty', align: 'center' },
          { label: 'Unit Price', align: 'right' },
          { label: 'Total', align: 'right' },
        ],
        itemRows,
        ['', '', '', '', 'Total:', docTemplate.formatCurrency(proforma.subtotal, proforma.currency)],
      ),
      docTemplate.buildSummary([
        { label: 'Estimated Total', value: docTemplate.formatCurrency(proforma.subtotal, proforma.currency), isTotal: true },
      ]),
      `<div class="ic-notes" style="margin-top:8px;"><strong>Note:</strong> This is a price estimate, not a bill — no payment is due until these items are billed. Prices are valid at time of issue and may change.</div>`,
      docTemplate.buildNotes(proforma.notes),
      docTemplate.buildSignatures([
        { label: 'Prepared By', name: proforma.created_by_name || '', signature: signature || undefined },
      ]),
    ].join('\n');

    return docTemplate.buildDocument({
      title: `Proforma Invoice - ${proforma.proforma_number}`,
      docType: 'Proforma Invoice',
      docNumber: proforma.proforma_number,
      status: proforma.status === 'converted' ? 'Converted' : 'Draft',
      date: proforma.created_at,
      bodyHTML,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });
  };

  const handlePrint = async (proforma: ProformaRecord) => {
    const html = await buildProformaHTML(proforma);
    const pw = docTemplate.openPrintWindow(html);
    if (pw) toast.success('PDF generated');
    else toast.error('Please allow popups to print');
  };

  const handleConvert = async (proforma: ProformaRecord) => {
    if (convertingId) return;
    if (!confirm(`Convert ${proforma.proforma_number} into a real bill for ${proforma.patient_name}? This will add these items to their active bill (or create one).`)) return;
    setConvertingId(proforma.id);
    try {
      const res = await authFetch(`/api/proforma-invoices/${proforma.id}/convert`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        toast.success('Converted to bill — visible in Patient Bills now');
        if (savedProforma?.id === proforma.id) setSavedProforma({ ...proforma, status: 'converted' });
        if (view === 'history') fetchHistory();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to convert to bill');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setConvertingId(null);
    }
  };

  const filteredHistory = history.filter(h =>
    !historySearch ||
    h.patient_name?.toLowerCase().includes(historySearch.toLowerCase()) ||
    h.proforma_number?.toLowerCase().includes(historySearch.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1700px] mx-auto space-y-4 w-full">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader
            icon={<FileSignature />}
            title="Proforma Invoice"
          />
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg shrink-0">
            <button
              onClick={() => setView('new')}
              className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors", view === 'new' ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              New Proforma
            </button>
            <button
              onClick={() => setView('history')}
              className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors", view === 'history' ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              History
            </button>
          </div>
        </div>

        {view === 'new' ? (
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr_360px] gap-4 items-start">
            {/* LEFT: Patient */}
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-muted/30">
                <h3 className="font-medium text-sm flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Patient</h3>
              </div>
              <div className="p-4 space-y-3">
                {selectedPatient ? (
                  <div className="p-3 rounded-lg border bg-primary/5 border-primary flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm">{selectedPatient.first_name} {selectedPatient.last_name}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">{selectedPatient.code || selectedPatient.id}</div>
                      {selectedPatient.phone && <div className="text-xs text-muted-foreground mt-0.5">{selectedPatient.phone}</div>}
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setSelectedPatient(null)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                      <Input
                        placeholder="Search patient by name or ID..."
                        className="pl-8 h-9"
                        value={patientSearch}
                        onChange={e => setPatientSearch(e.target.value)}
                      />
                    </div>
                    {patientResults.length > 0 && (
                      <div className="border rounded-lg divide-y max-h-64 overflow-auto">
                        {patientResults.map((p: any) => (
                          <button
                            key={`${p.source}-${p.id}`}
                            onClick={() => { setSelectedPatient(p); setPatientSearch(''); }}
                            className="w-full text-left p-2.5 hover:bg-muted/50 transition-colors"
                          >
                            <div className="font-medium text-sm">{p.first_name} {p.last_name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{p.code || p.id}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    {patientSearch.trim().length >= 2 && patientResults.length === 0 && (
                      <div className="text-xs text-muted-foreground text-center py-2">No matching patients.</div>
                    )}
                  </>
                )}

                <div className="space-y-1.5 pt-2">
                  <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                  <Textarea placeholder="e.g. Valid for 7 days, subject to availability..." value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="text-sm" />
                </div>
              </div>
            </div>

            {/* MIDDLE: Catalog — pick from a dropdown and add, rather than
                browsing a grid of cards */}
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden flex flex-col">
              <div className="p-4 border-b bg-muted/30">
                <h3 className="font-medium text-sm flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Add Item to Quote</h3>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-1 bg-muted p-1 rounded-lg w-fit">
                  <button
                    onClick={() => { setCatalogTab('services'); setSelectedCatalogId(''); }}
                    className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5", catalogTab === 'services' ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    <Stethoscope className="w-3.5 h-3.5" /> Services
                  </button>
                  <button
                    onClick={() => { setCatalogTab('products'); setSelectedCatalogId(''); }}
                    className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5", catalogTab === 'products' ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    <Package className="w-3.5 h-3.5" /> Products
                  </button>
                </div>

                {loadingCatalog ? (
                  <div className="text-center text-muted-foreground text-sm py-4 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading catalog...</div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{catalogTab === 'services' ? 'Service' : 'Product'}</label>
                      <Popover open={catalogPopoverOpen} onOpenChange={setCatalogPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-9">
                            <span className="truncate">{selectedCatalogLabel || `Select ${catalogTab === 'services' ? 'a service' : 'a product'}...`}</span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] max-w-none p-0" align="start">
                          <Command>
                            <CommandInput placeholder={`Search ${catalogTab}...`} />
                            <CommandList>
                              <CommandEmpty>No matching {catalogTab} found.</CommandEmpty>
                              <CommandGroup>
                                {(catalogTab === 'services' ? services : products).map((item: any) => {
                                  const label = catalogTab === 'services' ? item.service_name : item.item_name;
                                  const meta = catalogTab === 'services' ? item.category : item.unit_of_measure;
                                  const priceLabel = docTemplate.formatCurrency(catalogTab === 'services' ? item.price : item.selling_price, baseCurrency.symbol);
                                  return (
                                    <CommandItem
                                      key={item.id}
                                      value={label}
                                      onSelect={() => { setSelectedCatalogId(item.id); setCatalogPopoverOpen(false); }}
                                    >
                                      <Check className={cn("mr-2 h-4 w-4 shrink-0", selectedCatalogId === item.id ? "opacity-100" : "opacity-0")} />
                                      <div className="min-w-0">
                                        <div className="truncate">{label}</div>
                                        <div className="text-xs text-muted-foreground">{meta} — {priceLabel}</div>
                                      </div>
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Quantity</label>
                      <Input type="number" min="1" value={catalogQty} onChange={e => setCatalogQty(e.target.value)} />
                    </div>
                    <Button type="button" variant="outline" className="w-full" onClick={handleAddSelected} disabled={!selectedCatalogId}>
                      <Plus className="w-4 h-4 mr-2" /> Add to Quote
                    </Button>
                  </>
                )}

                {cart.length > 0 && (
                  <div className="pt-3 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Already in this quote</p>
                    <div className="space-y-1.5 max-h-48 overflow-auto">
                      {cart.map(l => (
                        <div key={`${l.type}-${l.refId}`} className="text-xs flex items-center justify-between text-muted-foreground">
                          <span className="truncate">{l.name} × {l.quantity}</span>
                          <span className="font-mono shrink-0 ml-2">{docTemplate.formatCurrency(l.unitPrice * l.quantity, baseCurrency.symbol)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Cart */}
            <div className="bg-card rounded-lg border shadow-sm overflow-hidden flex flex-col">
              <div className="p-4 border-b bg-muted/30">
                <h3 className="font-medium text-sm flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" /> Quote Items ({cart.length})</h3>
              </div>

              {savedProforma ? (
                <div className="p-4 space-y-3">
                  <div className="p-3 rounded-lg border border-green-200 bg-green-50 text-sm text-green-800 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">{savedProforma.proforma_number} saved</div>
                      <div className="text-xs mt-0.5">
                        {savedProforma.status === 'converted' ? 'Already converted to a bill.' : 'Ready to print or convert to a real bill.'}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <Button variant="outline" onClick={() => handlePrint(savedProforma)}>
                      <Printer className="w-4 h-4 mr-2" /> Print Proforma
                    </Button>
                    {savedProforma.status !== 'converted' ? (
                      <Button onClick={() => handleConvert(savedProforma)} disabled={!!convertingId}>
                        {convertingId ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 mr-2" />}
                        Convert to Bill
                      </Button>
                    ) : (
                      <Link to="/patients-bill">
                        <Button variant="secondary" className="w-full">
                          <Receipt className="w-4 h-4 mr-2" /> View in Patient Bills
                        </Button>
                      </Link>
                    )}
                  </div>
                  <Button variant="ghost" className="w-full" onClick={resetForm}>
                    <Plus className="w-4 h-4 mr-2" /> Start New Proforma
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-auto p-3 space-y-2 max-h-[50vh]">
                    {cart.length === 0 ? (
                      <div className="text-center text-muted-foreground text-sm py-10">
                        Select services or products from the catalog to add them here.
                      </div>
                    ) : (
                      cart.map(l => (
                        <div key={`${l.type}-${l.refId}`} className="p-2.5 rounded-lg border bg-muted/20">
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium text-sm">{l.name}</div>
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive" onClick={() => removeFromCart(l.refId, l.type)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <div className="flex items-center gap-1.5">
                              <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantity(l.refId, l.type, -1)}>
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="text-sm font-mono w-6 text-center">{l.quantity}</span>
                              <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantity(l.refId, l.type, 1)}>
                                <Plus className="w-3 h-3" />
                              </Button>
                            </div>
                            <div className="text-sm font-mono font-semibold">{docTemplate.formatCurrency(l.unitPrice * l.quantity, baseCurrency.symbol)}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="p-4 border-t bg-muted/30 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Estimated Total</span>
                      <span className="font-mono font-bold text-lg text-primary">{docTemplate.formatCurrency(cartTotal, baseCurrency.symbol)}</span>
                    </div>
                    <Button className="w-full" onClick={handleSave} disabled={saving || !selectedPatient || cart.length === 0}>
                      {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileSignature className="w-4 h-4 mr-2" />}
                      {saving ? 'Saving...' : 'Save Proforma'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex flex-wrap justify-between items-center gap-3">
              <h3 className="font-medium">All Proforma Invoices</h3>
              <div className="relative w-64">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input placeholder="Search patient or number..." className="pl-8 h-9" value={historySearch} onChange={e => setHistorySearch(e.target.value)} />
              </div>
            </div>
            <div className="max-h-[75vh] overflow-auto p-4">
              <AdvancedDataTable<any>
                data={filteredHistory}
                keyExtractor={(h) => h.id}
                loading={loadingHistory}
                emptyMessage="No proforma invoices yet."
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'proforma_number', header: 'Proforma No.', sortable: true, render: (v) => <span className="font-mono text-primary">{v}</span> },
                  { key: 'patient_name', header: 'Patient', sortable: true },
                  { key: 'created_at', header: 'Date', sortable: true, render: (v) => <span className="text-muted-foreground">{new Date(v).toLocaleString()}</span> },
                  { key: 'subtotal', header: 'Total', align: 'right', sortable: true, render: (v, h) => <span className="font-mono">{docTemplate.formatCurrency(v, h.currency)}</span> },
                  {
                    key: 'status', header: 'Status',
                    render: (v) => v === 'converted' ? (
                      <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs font-medium flex items-center w-fit gap-1"><CheckCircle2 className="w-3 h-3" /> Converted</span>
                    ) : (
                      <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs font-medium flex items-center w-fit gap-1"><Clock className="w-3 h-3" /> Draft</span>
                    ),
                  },
                  {
                    key: '__actions', header: 'Actions', align: 'right',
                    render: (_v, h) => (
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePrint(h)} title="Print">
                          <Printer className="w-3.5 h-3.5" />
                        </Button>
                        {h.status !== 'converted' ? (
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleConvert(h)} disabled={convertingId === h.id}>
                            {convertingId === h.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ArrowRightLeft className="w-3 h-3 mr-1" />}
                            Convert
                          </Button>
                        ) : (
                          <Link to="/patients-bill">
                            <Button variant="ghost" size="sm" className="h-7 text-xs">View Bill</Button>
                          </Link>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </div>
        )}
      </div>
      </div>
    </AppLayout>
  );
}
