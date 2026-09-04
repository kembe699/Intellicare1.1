import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { FREQUENCY_OPTIONS, calculateQuantity, findFrequency } from '@/lib/prescriptionFrequency';
import { exportCSV } from '@/utils/reportUtils';
import { toast } from 'sonner';
import {
  ClipboardList, Plus, Search, X, Pill, Loader2, Ban, RefreshCw, FileSpreadsheet,
} from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

const API = '/api/pharmacy-module';

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'partial_dispensed', label: 'Partial' },
  { value: 'dispensed', label: 'Dispensed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    pending: 'bg-sky-50 text-sky-700 border-sky-200',
    partial: 'bg-amber-50 text-amber-700 border-amber-200',
    partial_dispensed: 'bg-amber-50 text-amber-700 border-amber-200',
    dispensed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize ${map[status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
};

export default function PrescriptionManagement() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const clinicId = user?.clinic || 1;

  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [people, setPeople] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [drugs, setDrugs] = useState<any[]>([]);

  const [personSearch, setPersonSearch] = useState('');
  const [personDropdownOpen, setPersonDropdownOpen] = useState(false);
  const [rxForm, setRxForm] = useState({ person_id: '', person_name: '', doctor_id: '', notes: '' });

  const [rxDrugId, setRxDrugId] = useState('');
  const [rxQty, setRxQty] = useState('1');
  const [rxDose, setRxDose] = useState('');
  const [rxFrequency, setRxFrequency] = useState('');
  const [rxDuration, setRxDuration] = useState('');
  // Parity with the Prescribe Medicine form on /lis/orders: a dose amount the
  // quantity can be derived from, a picked frequency rather than free text, an
  // out-of-stock route, and per-line instructions.
  const [rxDoseAmount, setRxDoseAmount] = useState('');
  const [rxQtyTouched, setRxQtyTouched] = useState(false);
  const [rxIsExternal, setRxIsExternal] = useState(false);
  const [rxExternalName, setRxExternalName] = useState('');
  const [rxNotes, setRxNotes] = useState('');
  const [rxLines, setRxLines] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  // Cash vs. Scheme billing mode — mirrors /patients-bill: Scheme is only offered when
  // the selected patient has an active membership, and the drug picker then only shows
  // drugs that scheme has a configured price for (nothing to silently mis-price).
  const [billingMode, setBillingMode] = useState<'cash' | 'scheme'>('cash');
  const [patientSchemes, setPatientSchemes] = useState<any[]>([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState('');
  const [schemeProducts, setSchemeProducts] = useState<any[]>([]);
  const [loadingSchemeCatalog, setLoadingSchemeCatalog] = useState(false);
  const [patientActiveBill, setPatientActiveBill] = useState<any | null>(null);

  const [selectedRx, setSelectedRx] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    fetchPrescriptions();
    fetchPeople();
    fetchDoctors();
    fetchDrugs();
  }, []);

  const fetchPrescriptions = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API}/prescriptions?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setPrescriptions(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch prescriptions');
    } finally {
      setLoading(false);
    }
  };

  // Merges the main Patient Registry with LIS-registered patients, matching the picker
  // already used on /patients-bill — prescriptions can be written against either.
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
          id: p.id, label: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.full_name, code: p.patient_id, source: 'patients',
        }));
      }
      if (lisRes?.ok) {
        const data = await lisRes.json();
        (Array.isArray(data) ? data : []).forEach((p: any) => merged.push({
          id: p.id, label: `${p.first_name || ''} ${p.last_name || ''}`.trim(), code: p.participant_number, source: 'lis',
        }));
      }
      setPeople(merged);
    } catch (e) {
      console.error('Failed to fetch people', e);
    }
  };

  const fetchDoctors = async () => {
    try {
      const res = await authFetch('/api/users?role=doctor', { credentials: 'include' });
      if (res.ok) setDoctors(await res.json());
    } catch (e) {
      console.error('Failed to fetch doctors', e);
    }
  };

  const fetchDrugs = async () => {
    try {
      const res = await authFetch(`${API}/drugs?clinic_id=${clinicId}&is_active=true`, { credentials: 'include' });
      if (res.ok) setDrugs(await res.json());
    } catch (e) {
      console.error('Failed to fetch drugs', e);
    }
  };

  const filteredPeople = people.filter(p =>
    p.label?.toLowerCase().includes(personSearch.toLowerCase()) || p.code?.toLowerCase().includes(personSearch.toLowerCase())
  );

  const fetchPatientSchemes = async (patientId: string) => {
    try {
      const res = await authFetch(`/api/schemes/membership/patient/${patientId}`, { credentials: 'include' });
      setPatientSchemes(res.ok ? await res.json() : []);
    } catch (e) {
      console.error('Failed to fetch patient schemes', e);
      setPatientSchemes([]);
    }
  };

  // Surfaces whether the patient already has an open bill and under which mode — a bill
  // is always wholly cash or wholly scheme-priced (add-services inherits the existing
  // bill's mode server-side no matter what's picked here), so the mode picker below is
  // locked to match rather than letting the cashier pick a mode that'd be silently ignored.
  const fetchPatientActiveBillInfo = async (patientId: string) => {
    try {
      const res = await authFetch(`/api/patient-bills/active/${patientId}/${clinicId}`, { credentials: 'include' });
      const bill = res.ok ? await res.json() : null;
      setPatientActiveBill(bill);
      if (bill?.scheme_id) {
        setBillingMode('scheme');
        setSelectedSchemeId(bill.scheme_id);
        fetchSchemeCatalog(bill.scheme_id);
      }
    } catch {
      setPatientActiveBill(null);
    }
  };

  const fetchSchemeCatalog = async (schemeId: string) => {
    setLoadingSchemeCatalog(true);
    try {
      const res = await authFetch(`/api/schemes/${schemeId}/product-pricing`, { credentials: 'include' });
      setSchemeProducts(res.ok ? await res.json() : []);
    } catch (e) {
      console.error('Failed to fetch scheme catalog', e);
      setSchemeProducts([]);
    } finally {
      setLoadingSchemeCatalog(false);
    }
  };

  const handleSelectPerson = (p: any) => {
    setRxForm({ ...rxForm, person_id: p.id, person_name: p.label });
    setPersonSearch(`${p.label} (${p.code || '—'})`);
    setPersonDropdownOpen(false);
    setBillingMode('cash');
    setSelectedSchemeId('');
    setSchemeProducts([]);
    setRxLines([]);
    setRxDrugId('');
    fetchPatientSchemes(p.id);
    fetchPatientActiveBillInfo(p.id);
  };

  const handleBillingModeChange = (mode: 'cash' | 'scheme') => {
    setBillingMode(mode);
    setRxDrugId('');
    setRxLines([]);
    if (mode === 'cash') {
      setSelectedSchemeId('');
    } else if (patientSchemes.length === 1) {
      setSelectedSchemeId(patientSchemes[0].scheme_id);
      fetchSchemeCatalog(patientSchemes[0].scheme_id);
    }
  };

  const handleSchemeChange = (schemeId: string) => {
    setSelectedSchemeId(schemeId);
    setRxDrugId('');
    setRxLines([]);
    if (schemeId) fetchSchemeCatalog(schemeId);
  };

  const drugCatalog = billingMode === 'scheme' ? schemeProducts : drugs;

  // quantity = dose x administrations/day x days. Suggested rather than forced:
  // the prescriber keeps whatever they typed themselves (rxQtyTouched), because
  // PRN and STAT have no derivable total at all.
  const rxSuggestedQty = useMemo(
    () => calculateQuantity(parseFloat(rxDoseAmount), rxFrequency, parseInt(rxDuration, 10)),
    [rxDoseAmount, rxFrequency, rxDuration],
  );

  useEffect(() => {
    if (rxSuggestedQty != null && !rxQtyTouched) setRxQty(String(rxSuggestedQty));
  }, [rxSuggestedQty, rxQtyTouched]);

  const rxSelectedDrug = drugCatalog.find((d: any) => d.id === rxDrugId);
  const rxUnit = rxIsExternal ? 'unit' : (rxSelectedDrug?.unit_of_measure || (rxDrugId ? 'tablet' : '—'));

  const resetRxDrugFields = () => {
    setRxDrugId(''); setRxQty('1'); setRxDose(''); setRxFrequency(''); setRxDuration('');
    setRxDoseAmount(''); setRxQtyTouched(false); setRxExternalName(''); setRxNotes('');
  };

  const handleAddRxLine = () => {
    // An out-of-stock medicine has no catalogue row, no price and no stock to
    // check against — it is recorded by name so it prints on the prescription
    // for the patient to buy elsewhere, and is never billed here.
    if (rxIsExternal) {
      if (!rxExternalName.trim()) { toast.error('Enter the medicine name'); return; }
      if (!rxNotes.trim()) { toast.error('Add instructions — the patient is buying this outside'); return; }
      setRxLines(prev => [...prev, {
        drug_id: null, is_external: true,
        external_drug_name: rxExternalName.trim(), drug_name: rxExternalName.trim(),
        unit_of_measure: 'unit', quantity_prescribed: parseInt(rxQty, 10) || 1,
        dose_strength: rxDose, dose_amount: rxDoseAmount ? parseFloat(rxDoseAmount) : null,
        frequency: rxFrequency, duration_days: parseInt(rxDuration, 10) || 0,
        notes: rxNotes.trim(), selling_price: 0,
      }]);
      resetRxDrugFields();
      return;
    }
    if (!rxDrugId) { toast.error('Select a drug'); return; }
    if (billingMode === 'scheme' && !selectedSchemeId) { toast.error('Select a scheme first'); return; }
    const drug = drugCatalog.find((d: any) => d.id === rxDrugId);
    if (!drug) return;
    const qty = parseInt(rxQty, 10) || 1;
    const drugKey = billingMode === 'scheme' ? drug.product_id : drug.id;
    const drugName = billingMode === 'scheme' ? drug.product_name : drug.drug_name;
    const stockOnHand = drug.stock_on_hand != null ? parseInt(drug.stock_on_hand, 10) : null;
    const alreadyQueued = rxLines.filter(l => l.drug_id === drugKey).reduce((sum, l) => sum + (l.quantity_prescribed || 0), 0);
    if (stockOnHand != null && !isNaN(stockOnHand) && qty + alreadyQueued > stockOnHand) {
      toast.error(`Only ${stockOnHand} ${drug.unit_of_measure || 'unit'}(s) of ${drugName} in stock — reduce the quantity.`);
      return;
    }

    if (billingMode === 'scheme') {
      setRxLines(prev => [...prev, {
        drug_id: drug.product_id, drug_name: drug.product_name, unit_of_measure: drug.unit_of_measure || 'tablet',
        quantity_prescribed: qty, dose_strength: rxDose, frequency: rxFrequency,
        dose_amount: rxDoseAmount ? parseFloat(rxDoseAmount) : null, is_external: false,
        duration_days: parseInt(rxDuration, 10) || 0, notes: rxNotes.trim(),
        selling_price: parseFloat(drug.scheme_price) || 0, currency: drug.scheme_currency || 'SSP',
      }]);
    } else {
      setRxLines(prev => [...prev, {
        drug_id: drug.id, drug_name: drug.drug_name, unit_of_measure: drug.unit_of_measure || 'tablet',
        quantity_prescribed: qty, dose_strength: rxDose, frequency: rxFrequency,
        dose_amount: rxDoseAmount ? parseFloat(rxDoseAmount) : null, is_external: false,
        duration_days: parseInt(rxDuration, 10) || 0, notes: rxNotes.trim(),
        selling_price: parseFloat(drug.selling_price) || 0,
      }]);
    }
    resetRxDrugFields();
  };

  const removeRxLine = (index: number) => {
    setRxLines(prev => prev.filter((_, i) => i !== index));
  };

  // Bills once, at prescription-creation time (matching the Prescribe Medicine flow on
  // /lis/orders) — best-effort, never blocks since the prescription itself already
  // succeeded. Dispensing is pure fulfillment and does not bill again.
  const billForPrescription = async (patientId: string, patientName: string, lines: any[]) => {
    try {
      const lineItems = lines
        .filter(l => l.selling_price > 0)
        .map(l => ({ serviceId: l.drug_id, serviceName: l.drug_name, quantity: l.quantity_prescribed, unitPrice: l.selling_price, totalPrice: l.selling_price * l.quantity_prescribed, currency: l.currency || 'SSP' }));
      const schemeIdToSend = billingMode === 'scheme' ? selectedSchemeId : undefined;
      if (lineItems.length === 0 && lines.every(l => l.is_external)) {
        // Everything was prescribed for outside purchase, so there is genuinely
        // nothing to bill — that is the expected outcome, not a pricing gap.
        toast.info('Nothing billed — every medicine is being bought outside.');
        return;
      }
      if (lineItems.length === 0) {
        // Every line had no price configured — nothing was billed, and this
        // prescription won't show up anywhere for the cashier to collect
        // payment on. Silent here previously made "why isn't this in billing"
        // look like a bug rather than a missing-price data issue.
        toast.error('No prices are configured for these drugs — nothing was billed. Ask an admin to set drug prices.');
        return;
      }
      const total = lineItems.reduce((sum, li) => sum + li.totalPrice, 0);

      const existingBillRes = await authFetch(`/api/patient-bills/active/${patientId}/${clinicId}`, { credentials: 'include' });
      if (existingBillRes.ok) {
        const existingBill = await existingBillRes.json();
        const addRes = await authFetch(`/api/patient-bills/${existingBill.id}/add-services`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ services: lineItems }),
        });
        if (addRes.ok) {
          toast.success(`Added to bill ${existingBill.bill_number}`);
        } else {
          const err = await addRes.json().catch(() => ({}));
          toast.error(`Failed to bill this prescription: ${err.error || 'unknown error'}. The patient will not be charged — please bill manually.`);
        }
      } else {
        const billNumber = `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
        const billRes = await authFetch('/api/patient-bills', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({
            bill_number: billNumber, patient_id: patientId, patient_name: patientName,
            clinic_id: parseInt(String(clinicId)), total_amount: total, paid_amount: 0,
            balance_amount: total, status: 'pending', bill_date: new Date().toISOString(),
            due_date: null, services: lineItems,
            notes: 'Auto-generated from pharmacy prescription', created_by: user?.displayName || 'System',
            scheme_id: schemeIdToSend,
          }),
        });
        if (billRes.ok) {
          toast.success(`Bill ${billNumber} created`);
        } else {
          const err = await billRes.json().catch(() => ({}));
          toast.error(`Failed to bill this prescription: ${err.error || 'unknown error'}. The patient will not be charged — please bill manually.`);
        }
      }
    } catch (e) {
      console.error('Error billing for prescription', e);
      toast.error('Failed to bill this prescription due to a network error — please bill manually.');
    }
  };

  const handleCreatePrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    if (!rxForm.person_id) { toast.error('Select a patient'); return; }
    if (rxLines.length === 0) { toast.error('Add at least one drug'); return; }

    setCreating(true);
    try {
      const res = await authFetch(`${API}/prescriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: rxForm.person_id,
          doctor_id: rxForm.doctor_id || null,
          prescription_date: new Date().toISOString().split('T')[0],
          prescribed_by_name: user?.displayName,
          prescription_notes: rxForm.notes,
          lines: rxLines.map(l => ({
            drug_id: l.drug_id, quantity_prescribed: l.quantity_prescribed, unit_of_measure: l.unit_of_measure,
            dose_strength: l.dose_strength, frequency: l.frequency, duration_days: l.duration_days, notes: l.notes,
            is_external: !!l.is_external, external_drug_name: l.external_drug_name || null,
            dose_amount: l.dose_amount ?? null,
          })),
        }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success(`Prescription ${created.prescription_number} created`);
        await billForPrescription(rxForm.person_id, rxForm.person_name, rxLines);
        setRxForm({ person_id: '', person_name: '', doctor_id: '', notes: '' });
        setPersonSearch('');
        setRxLines([]);
        setBillingMode('cash');
        setSelectedSchemeId('');
        setPatientSchemes([]);
        setPatientActiveBill(null);
        fetchPrescriptions();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create prescription');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setCreating(false);
    }
  };

  const openDetail = async (rx: any) => {
    setSelectedRx(rx);
    setDetailLoading(true);
    try {
      const res = await authFetch(`${API}/prescriptions/${rx.id}`, { credentials: 'include' });
      if (res.ok) setSelectedRx(await res.json());
    } catch {
      toast.error('Failed to load prescription');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCancelPrescription = async () => {
    if (cancelling) return;
    if (!selectedRx) return;
    if (!confirm(`Cancel prescription ${selectedRx.prescription_number}?`)) return;
    setCancelling(true);
    try {
      const res = await authFetch(`${API}/prescriptions/${selectedRx.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: 'Cancelled by pharmacist' }),
      });
      if (res.ok) {
        toast.success('Prescription cancelled');
        setSelectedRx(null);
        fetchPrescriptions();
      } else {
        toast.error('Failed to cancel prescription');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setCancelling(false);
    }
  };

  const filteredRx = prescriptions.filter((rx: any) => {
    const matchesStatus = statusFilter === 'all' || rx.status === statusFilter;
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      rx.prescription_number?.toLowerCase().includes(q) ||
      rx.patient_name?.toLowerCase().includes(q);
    const rxDate = rx.prescription_date ? String(rx.prescription_date).split('T')[0] : '';
    const matchesFrom = !dateFrom || (rxDate && rxDate >= dateFrom);
    const matchesTo = !dateTo || (rxDate && rxDate <= dateTo);
    return matchesStatus && matchesSearch && matchesFrom && matchesTo;
  });

  const handleExportCSV = () => {
    if (filteredRx.length === 0) { toast.error('No prescriptions to export'); return; }
    exportCSV(filteredRx, [
      { header: 'Rx Number', key: 'prescription_number' },
      { header: 'Patient', key: 'patient_name' },
      { header: 'Doctor', key: 'doctor_name', transform: (v) => v ? `Dr. ${v}` : '' },
      { header: 'Date', key: 'prescription_date', transform: (v) => v ? new Date(v).toLocaleDateString() : '' },
      { header: 'Dispensed', key: 'dispensed_count' },
      { header: 'Total Items', key: 'line_count' },
      { header: 'Status', key: 'status' },
    ], `prescriptions${dateFrom ? `-${dateFrom}` : ''}${dateTo ? `_to_${dateTo}` : ''}.csv`);
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader title="Prescriptions" icon={<ClipboardList />} />

        {/* Create Prescription (stacked above the list, not side-by-side) */}
        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex-shrink-0">
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Pill className="w-4 h-4 text-primary" />
              Create Prescription
            </h3>
          </div>
          <form onSubmit={handleCreatePrescription} className="p-4 grid grid-cols-2 gap-4">
            {/* Card 1: Patient & Prescriber */}
            <div className="border rounded-lg p-3 space-y-3 bg-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Patient &amp; Prescriber</p>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Patient</label>
                <Input
                  value={personSearch}
                  onChange={e => {
                    setPersonSearch(e.target.value);
                    setPersonDropdownOpen(true);
                    if (rxForm.person_id) setRxForm({ ...rxForm, person_id: '' });
                  }}
                  onFocus={() => setPersonDropdownOpen(true)}
                  placeholder="Search patient by name or ID..."
                  className="mt-1"
                />
                {personDropdownOpen && personSearch && (
                  <div className="mt-1 border rounded-lg max-h-40 overflow-y-auto">
                    {filteredPeople.slice(0, 8).map(p => (
                      <div
                        key={`${p.source}-${p.id}`}
                        onClick={() => handleSelectPerson(p)}
                        className={`px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer border-b last:border-0 ${rxForm.person_id === p.id ? 'bg-primary/5' : ''}`}
                      >
                        <span className="font-medium">{p.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">{p.code || '—'} · {p.source === 'lis' ? 'LIS' : 'Registry'}</span>
                      </div>
                    ))}
                    {filteredPeople.length === 0 && <div className="p-3 text-sm text-muted-foreground text-center">No patients found</div>}
                  </div>
                )}
              </div>

              {rxForm.person_id && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Billing Mode</label>
                  {patientActiveBill ? (
                    <div className="mt-1 p-2.5 rounded-lg border border-sky-200 bg-sky-50 text-xs text-sky-800">
                      This patient has an open {patientActiveBill.scheme_id ? `scheme (${patientActiveBill.scheme_name})` : 'cash'} bill ({patientActiveBill.bill_number}) — new items are added to it under that same mode.
                    </div>
                  ) : (
                    <>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleBillingModeChange('cash')}
                          className={`h-9 rounded-md border text-sm font-medium transition-colors ${billingMode === 'cash' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-input hover:bg-muted/50'}`}
                        >
                          Cash
                        </button>
                        <button
                          type="button"
                          onClick={() => patientSchemes.length > 0 && handleBillingModeChange('scheme')}
                          disabled={patientSchemes.length === 0}
                          title={patientSchemes.length === 0 ? 'This patient has no active scheme membership' : undefined}
                          className={`h-9 rounded-md border text-sm font-medium transition-colors ${billingMode === 'scheme' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-input hover:bg-muted/50'} ${patientSchemes.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                          Scheme
                        </button>
                      </div>
                      {patientSchemes.length === 0 && (
                        <p className="text-[11px] text-muted-foreground mt-1">No active scheme membership — cash prices only.</p>
                      )}
                      {billingMode === 'scheme' && patientSchemes.length > 1 && (
                        <Combobox
                          options={patientSchemes.map((s: any) => ({ value: s.scheme_id, label: s.scheme_name }))}
                          value={selectedSchemeId}
                          onChange={handleSchemeChange}
                          placeholder="Select scheme..."
                          searchPlaceholder="Search schemes..."
                          className="mt-2 h-9"
                        />
                      )}
                      {billingMode === 'scheme' && selectedSchemeId && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {loadingSchemeCatalog ? 'Loading scheme price list...' : `Only drugs priced under this scheme are shown below (${schemeProducts.length}).`}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground">Doctor (Optional)</label>
                <Combobox
                  options={[{ value: '', label: 'No doctor' }, ...doctors.map((d: any) => ({ value: d.id, label: `Dr. ${d.display_name}` }))]}
                  value={rxForm.doctor_id}
                  onChange={v => setRxForm({ ...rxForm, doctor_id: v })}
                  placeholder="No doctor"
                  searchPlaceholder="Search doctors..."
                  className="mt-1 h-9"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <textarea
                  value={rxForm.notes}
                  onChange={e => setRxForm({ ...rxForm, notes: e.target.value })}
                  placeholder="Optional notes..."
                  className="w-full mt-1 p-3 border border-input rounded-md resize-none h-16 text-sm bg-background shadow-sm"
                />
              </div>
            </div>

            {/* Card 2: Add Drug */}
            <div className="border rounded-lg p-3 space-y-2.5 bg-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add Drug</p>

                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-input"
                    checked={rxIsExternal}
                    onChange={e => { setRxIsExternal(e.target.checked); setRxDrugId(''); setRxExternalName(''); }}
                  />
                  Not in stock — patient buys from an outside pharmacy
                </label>

                {rxIsExternal ? (
                  <Input
                    placeholder="Medicine name e.g. Amoxicillin 500mg caps"
                    value={rxExternalName}
                    onChange={e => setRxExternalName(e.target.value)}
                  />
                ) : (
                <Combobox
                  options={billingMode === 'scheme' ? (
                    drugCatalog.map((d: any) => ({
                      value: d.id,
                      label: `${d.product_name} — ${d.unit_of_measure || 'unit'} — stock ${d.stock_on_hand ?? 0} — ${parseFloat(d.scheme_price || 0).toFixed(2)} ${d.scheme_currency || 'SSP'}`,
                    }))
                  ) : drugs.map((d: any) => ({
                    value: d.id,
                    label: `${d.drug_name}${d.strength ? ` (${d.strength})` : ''} — ${d.unit_of_measure || 'unit'} — stock ${d.stock_on_hand ?? 0} — ${parseFloat(d.selling_price) > 0 ? `SSP ${parseFloat(d.selling_price).toLocaleString()}` : 'NO PRICE SET'}`,
                  }))}
                  value={rxDrugId}
                  onChange={setRxDrugId}
                  placeholder="Select drug..."
                  searchPlaceholder="Search drugs..."
                  className="h-9"
                />
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number" min="0.25" step="0.25"
                    placeholder="Dose e.g. 1"
                    title="How much is taken each time — the multiplier for the quantity"
                    value={rxDoseAmount}
                    onChange={e => setRxDoseAmount(e.target.value)}
                  />
                  <Input placeholder="Strength e.g. 500mg" value={rxDose} onChange={e => setRxDose(e.target.value)} />
                </div>

                <Combobox
                  options={FREQUENCY_OPTIONS.map(f => ({ value: f.code, label: `${f.code} — ${f.label}` }))}
                  value={rxFrequency}
                  onChange={v => setRxFrequency(v)}
                  placeholder="Frequency..."
                  searchPlaceholder="Search e.g. TDS, twice, 8 hourly..."
                  className="h-9"
                />

                <div className="grid grid-cols-3 gap-2">
                  <Input
                    type="number" min="0" placeholder="Days"
                    value={rxDuration}
                    onChange={e => setRxDuration(e.target.value)}
                  />
                  <Input
                    type="number" min="1" placeholder="Qty"
                    value={rxQty}
                    onChange={e => { setRxQtyTouched(true); setRxQty(e.target.value); }}
                  />
                  <div
                    className="flex items-center justify-center text-xs text-muted-foreground border rounded-md px-2 h-9 bg-muted/30 truncate"
                    title="Unit of measure — what one unit of this qty actually is (tablet, strip, bottle, etc.)"
                  >
                    {rxUnit}
                  </div>
                </div>

                {/* Show the arithmetic rather than silently overwriting the
                    prescriber's number, so a computed total is always traceable
                    back to dose x frequency x days. */}
                {rxSuggestedQty != null && (
                  <p className="text-[11px] text-muted-foreground">
                    {rxDoseAmount} × {findFrequency(rxFrequency)?.perDay}/day × {rxDuration} days = <strong>{rxSuggestedQty}</strong>
                    {rxQtyTouched && String(rxSuggestedQty) !== rxQty && (
                      <button type="button" className="ml-2 underline" onClick={() => { setRxQtyTouched(false); setRxQty(String(rxSuggestedQty)); }}>
                        use this
                      </button>
                    )}
                  </p>
                )}
                {rxFrequency && !findFrequency(rxFrequency)?.perDay && (
                  <p className="text-[11px] text-muted-foreground">
                    {findFrequency(rxFrequency)?.code === 'PRN' ? 'As needed — enter the quantity to dispense.' : 'Single dose — enter the quantity to dispense.'}
                  </p>
                )}

                <Input
                  placeholder={rxIsExternal ? 'Instructions for the patient (required for outside purchase)' : 'Instructions (optional)'}
                  value={rxNotes}
                  onChange={e => setRxNotes(e.target.value)}
                />

                <Button type="button" variant="outline" className="w-full" onClick={handleAddRxLine}>
                  <Plus className="w-4 h-4 mr-2" /> Add
                </Button>

                {rxLines.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {rxLines.map((l, i) => (
                      <div key={i} className="flex justify-between items-center text-sm bg-muted/30 rounded px-2 py-1.5">
                        <span>
                          {l.drug_name} × {l.quantity_prescribed} {l.unit_of_measure}
                          {l.dose_strength ? ` · ${l.dose_strength}` : ''}{l.frequency ? ` · ${l.frequency}` : ''}
                          {l.duration_days ? ` · ${l.duration_days}d` : ''}
                          {l.is_external ? (
                            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                              buy outside
                            </span>
                          ) : l.selling_price > 0 ? (
                            <span className="text-muted-foreground"> · {(l.selling_price * l.quantity_prescribed).toLocaleString()} SSP</span>
                          ) : (
                            <span className="text-amber-600 font-medium"> · no price set — will not be billed</span>
                          )}
                        </span>
                        <button type="button" onClick={() => removeRxLine(i)} className="text-muted-foreground hover:text-foreground">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            <div className="col-span-2 flex justify-end">
              <Button type="submit" size="sm" className="px-6" disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Pill className="w-4 h-4 mr-2" />}
                Create Prescription
              </Button>
            </div>
          </form>
        </div>

        {/* Prescription Directory */}
        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex flex-wrap items-end gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search Rx or patient..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">From</Label>
                <Input type="date" className="w-[150px]" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">To</Label>
                <Input type="date" className="w-[150px]" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
              <Combobox
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={setStatusFilter}
                searchPlaceholder="Search..."
                className="w-40 h-9"
              />
              <Button type="button" variant="outline" onClick={handleExportCSV} className="gap-1.5">
                <FileSpreadsheet className="w-4 h-4" /> Export CSV
              </Button>
              <Button variant="outline" size="icon" onClick={fetchPrescriptions} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <div className="p-4">
              <AdvancedDataTable<any>
                data={filteredRx}
                keyExtractor={(rx) => rx.id}
                loading={loading}
                emptyMessage="No prescriptions found."
                onRowClick={(rx) => openDetail(rx)}
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'prescription_number', header: 'Rx No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
                  { key: 'patient_name', header: 'Patient', render: (v) => v || 'Unknown' },
                  { key: 'doctor_name', header: 'Doctor', sortable: true, render: (v) => <span className="text-muted-foreground">{v ? `Dr. ${v}` : '—'}</span> },
                  { key: 'prescription_date', header: 'Date', sortable: true, render: (v) => <span className="text-muted-foreground">{new Date(v).toLocaleDateString()}</span> },
                  { key: '__items', header: 'Items', render: (_v, rx) => <span className="text-muted-foreground">{rx.dispensed_count}/{rx.line_count}</span> },
                  { key: 'status', header: 'Status', render: (v) => statusBadge(v) },
                ]}
              />
            </div>
        </div>
      </div>
      </div>

      {/* Prescription Detail Modal */}
      {selectedRx && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-lg rounded-xl shadow-lg border overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30">
              <div>
                <h3 className="font-semibold text-lg">{selectedRx.prescription_number}</h3>
                <p className="text-xs text-muted-foreground">{selectedRx.patient_name || 'Unknown patient'}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedRx(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-6 flex-1 overflow-auto space-y-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-y-2 text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <span className="text-right">{statusBadge(selectedRx.status)}</span>
                    <span className="text-muted-foreground">Doctor</span>
                    <span className="text-right">{selectedRx.doctor_name ? `Dr. ${selectedRx.doctor_name}` : '—'}</span>
                    <span className="text-muted-foreground">Date</span>
                    <span className="text-right">{new Date(selectedRx.prescription_date).toLocaleDateString()}</span>
                  </div>

                  {selectedRx.prescription_notes && (
                    <div className="bg-muted/30 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm">{selectedRx.prescription_notes}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Medications</p>
                    {(selectedRx.lines || []).length > 0 ? (
                      <AdvancedDataTable<any>
                        data={selectedRx.lines}
                        keyExtractor={(l) => l.id}
                        columns={[
                          { key: 'drug_name', header: 'Drug' },
                          { key: 'dose_strength', header: 'Dose', render: (v, l) => <span className="text-muted-foreground">{v}{l.frequency ? ` · ${l.frequency}` : ''}</span> },
                          { key: 'quantity_prescribed', header: 'Qty', align: 'right' },
                          { key: 'status', header: 'Status', render: (v) => statusBadge(v) },
                        ]}
                      />
                    ) : (
                      <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg">No medications on this prescription.</div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t bg-muted/30 flex justify-between">
              {selectedRx.status === 'pending' ? (
                <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={handleCancelPrescription} disabled={cancelling}>
                  {cancelling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ban className="w-4 h-4 mr-2" />}
                  Cancel Prescription
                </Button>
              ) : <span />}
              {(selectedRx.status === 'pending' || selectedRx.status === 'partial_dispensed') ? (
                <Button onClick={() => navigate('/pharmacy-dispensing', { state: { prescriptionId: selectedRx.id } })}>
                  <Pill className="w-4 h-4 mr-2" /> Dispense
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setSelectedRx(null)}>Close</Button>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
