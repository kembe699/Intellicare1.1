import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { getStatusColor } from '@/lib/statusColors';
import { authFetch } from '@/api/apiClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { AttachmentField } from '@/components/procurement/AttachmentField';
import { uploadProcurementAttachments } from '@/api/procurementAttachments';
import { exportCSV } from '@/utils/reportUtils';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList, Plus, Edit, Search, Eye, RefreshCw, Send,
  CheckCircle, XCircle, FileText, Clock, AlertTriangle,
  ShoppingCart, Loader2, PenLine, ArrowLeft, ChevronsUpDown, Check as CheckIcon, X, Download
} from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface PRLine {
  id?: string;
  location_id: string;
  item_code: string;
  item_description: string;
  item_specification: string;
  quantity_required: number;
  unit_of_measure: string;
  estimated_unit_price: number;
  estimated_line_total: number;
  notes: string;
  manual_entry?: boolean;
}

interface StoreLocation {
  id: string;
  location_name: string;
  location_code: string;
  location_type: string;
  item_count: number;
  total_stock: number;
}

interface StockItem {
  item_id: string;
  item_name: string;
  item_code: string;
  item_category: string;
  unit_of_measure: string;
  current_unit_cost: number;
  average_unit_cost: number;
  quantity_on_hand: number;
}

interface PR {
  id: string;
  pr_number: string;
  clinic_id: number;
  requisition_date: string;
  requested_by: string;
  requester_name: string;
  department: string;
  requisition_type: string;
  delivery_date_required: string;
  total_amount: number;
  currency: string;
  status: string;
  approved_by: string;
  approver_name: string;
  approval_date: string;
  rejection_reason: string;
  notes: string;
  line_count: number;
  lines?: PRLine[];
}

interface SupplierOption {
  id: number;
  name: string;
  supplier_code: string;
  payment_terms: string;
  currency: string;
}

interface InventoryItem {
  id: string;
  drug_name: string;
  generic_name: string;
  unit_of_measure: string;
  selling_price: number;
  unit_cost: number;
}

interface InventoryItemMaster {
  id: string;
  item_name: string;
  item_code: string;
  item_category: string;
  unit_of_measure: string;
  unit_cost: number;
  reorder_level?: number;
  source?: 'pharmacy' | 'inventory';
}

interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
  is_base_currency: boolean;
}


const emptyLine = (): PRLine => ({
  location_id: '', item_code: '', item_description: '', item_specification: '',
  quantity_required: 1, unit_of_measure: 'pcs', estimated_unit_price: 0,
  estimated_line_total: 0, notes: '', manual_entry: false
});

const PurchaseRequisitions: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { currency, fmt } = useCurrency();
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [editingPR, setEditingPR] = useState<PR | null>(null);
  const [selectedPR, setSelectedPR] = useState<PR | null>(null);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState<{ id: string; action: 'submit' | 'approve' | 'reject' | 'cancel' } | null>(null);

  // Create PO from PR state
  const [showCreatePOModal, setShowCreatePOModal] = useState(false);
  const [prForPO, setPrForPO] = useState<PR | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [creatingPO, setCreatingPO] = useState(false);
  const [poFormData, setPOFormData] = useState({
    supplier_id: '', delivery_address: '', requested_delivery_date: '',
    payment_terms: 'Net30', po_currency: '', notes: ''
  });
  const [poFromPRFiles, setPOFromPRFiles] = useState<File[]>([]);
  // How many units of poFormData.po_currency equal 1 unit of the base currency — the PR's
  // own estimated prices are always in the base currency (PRs have no currency of their
  // own), so this is what actually converts them for display when a non-base currency is
  // picked for the PO being created.
  const [poCreateRate, setPOCreateRate] = useState(1);
  const [loadingRate, setLoadingRate] = useState(false);

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemMaster[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [draftComboboxOpen, setDraftComboboxOpen] = useState(false);
  const [availableCurrencies, setAvailableCurrencies] = useState<CurrencyOption[]>([]);
  const [departments, setDepartments] = useState<{ id: string; department_name: string }[]>([]);
  const [storageLocations, setStorageLocations] = useState<StoreLocation[]>([]);
  const [locationStockCache, setLocationStockCache] = useState<Record<string, StockItem[]>>({});
  const [loadingStock, setLoadingStock] = useState<Record<string, boolean>>({});
  // Storage location is chosen once for the whole requisition — every line item is picked
  // from that same location's stock, rather than re-selecting a location per line.
  const [selectedLocationId, setSelectedLocationId] = useState('');

  const [formData, setFormData] = useState({
    department: '', requisition_type: 'routine', delivery_date_required: '',
    notes: ''
  });
  // lines = items already added to the requisition (shown as a compact list); draft = the
  // single item currently being entered before it's added to that list.
  const [lines, setLines] = useState<PRLine[]>([]);
  const [draft, setDraft] = useState<PRLine>(emptyLine());

  const fetchPRs = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/procurement/purchase-requisitions?clinic_id=${user?.clinic || ''}`);
      if (res.ok) setPrs(await res.json());
    } catch (error) {
      console.error('Error fetching PRs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchInventory = async () => {
    try {
      const res = await authFetch(`/api/pharmacy/inventory/${user?.clinic || '1'}`);
      if (res.ok) setInventory((await res.json()) || []);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  };

  const fetchAllItems = async () => {
    setLoadingItems(true);
    try {
      const combined: InventoryItemMaster[] = [];

      // Fetch from pharmacy inventory (drug_name based)
      const pharmRes = await authFetch(`/api/pharmacy/inventory/${user?.clinic || '1'}`);
      if (pharmRes.ok) {
        const pharmData = await pharmRes.json();
        const pharmItems = (Array.isArray(pharmData) ? pharmData : []).map((d: any) => ({
          id: String(d.id),
          item_name: d.drug_name || d.item_name || '',
          item_code: d.item_code || d.drug_code || '',
          item_category: d.category || d.drug_category || 'Pharmacy',
          unit_of_measure: d.unit_of_measure || 'pcs',
          unit_cost: parseFloat(d.unit_cost || d.cost_price || '0') || 0,
          source: 'pharmacy' as const,
        }));
        combined.push(...pharmItems);
      }

      // Also fetch from inventory items table (item_name based)
      const invRes = await authFetch(`/api/inventory/items?clinic_id=${user?.clinic || '1'}&is_active=true`);
      if (invRes.ok) {
        const invData = await invRes.json();
        const invItems = (Array.isArray(invData) ? invData : []).map((d: any) => ({
          id: `inv-${d.id}`,
          item_name: d.item_name || '',
          item_code: d.item_code || '',
          item_category: d.item_category || 'Inventory',
          unit_of_measure: d.unit_of_measure || 'pcs',
          unit_cost: parseFloat(d.unit_cost || '0') || 0,
          source: 'inventory' as const,
        }));
        // Add only items not already in combined (avoid duplicates by name)
        const existingNames = new Set(combined.map(i => i.item_name.toLowerCase()));
        invItems.forEach(item => {
          if (item.item_name && !existingNames.has(item.item_name.toLowerCase())) {
            combined.push(item);
          }
        });
      }

      setInventoryItems(combined.filter(i => i.item_name));
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const fetchCurrencies = async () => {
    try {
      const res = await authFetch('/api/currencies');
      if (res.ok) {
        const data = await res.json();
        setAvailableCurrencies(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching currencies:', error);
    }
  };

  const handleItemSelect = (idx: number, itemId: string) => {
    const item = inventoryItems.find(i => String(i.id) === itemId);
    if (!item) return;
    const updated = [...lines];
    updated[idx] = {
      ...updated[idx],
      item_description: item.item_name,
      item_code: item.item_code || '',
      item_specification: item.item_category || '',
      unit_of_measure: item.unit_of_measure || 'pcs',
      estimated_unit_price: item.unit_cost || 0,
      estimated_line_total: (updated[idx].quantity_required || 1) * (item.unit_cost || 0),
    };
    setLines(updated);
    // setItemSearch was left behind when the per-row search state was removed;
    // there is no such state any more, so this threw a ReferenceError and
    // aborted item selection on a requisition line.
  };

  const fetchDepartments = async () => {
    try {
      const res = await authFetch(`/api/departments?clinic=${user?.clinic || '1'}`);
      if (res.ok) setDepartments((await res.json()) || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const res = await authFetch(`/api/inventory/locations?clinic_id=${user?.clinic || '1'}`);
      if (res.ok) setStorageLocations((await res.json()) || []);
    } catch (error) {
      console.error('Error fetching storage locations:', error);
    }
  };

  const fetchLocationStock = async (locationId: string) => {
    if (!locationId || locationStockCache[locationId]) return;
    setLoadingStock(prev => ({ ...prev, [locationId]: true }));
    try {
      const res = await authFetch(`/api/inventory/locations/${locationId}/stock`);
      if (res.ok) {
        const stock: StockItem[] = await res.json();
        setLocationStockCache(prev => ({ ...prev, [locationId]: stock }));
      }
    } catch (error) {
      console.error('Error fetching stock:', error);
    } finally {
      setLoadingStock(prev => ({ ...prev, [locationId]: false }));
    }
  };

  // Storage location is now chosen once for the whole requisition (see selectedLocationId)
  // rather than per line — this just loads that location's stock for every line's picker.
  const handleTopLocationChange = async (locationId: string) => {
    setSelectedLocationId(locationId);
    await fetchLocationStock(locationId);
  };

  const handleDraftStockItemSelect = (itemName: string) => {
    const item = (locationStockCache[selectedLocationId] || []).find(i => i.item_name === itemName);
    if (!item) return;
    const price = item.average_unit_cost || item.current_unit_cost || 0;
    setDraft(prev => ({
      ...prev,
      item_description: item.item_name,
      item_code: item.item_code || '',
      item_specification: item.item_category || '',
      unit_of_measure: item.unit_of_measure || 'pcs',
      estimated_unit_price: price,
      estimated_line_total: (prev.quantity_required || 1) * price,
    }));
  };

  const toggleDraftManualEntry = () => {
    setDraft(prev => ({ ...prev, manual_entry: !prev.manual_entry, item_description: '', item_code: '' }));
  };

  useEffect(() => { fetchPRs(); fetchInventory(); fetchDepartments(); fetchLocations(); fetchAllItems(); fetchCurrencies(); }, []);

  const filteredPRs = useMemo(() => {
    return prs.filter(pr => {
      if (searchQuery && !pr.pr_number?.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !pr.department?.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !pr.requester_name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (statusFilter !== 'all' && pr.status !== statusFilter) return false;
      if (dateFrom && pr.requisition_date && pr.requisition_date.split('T')[0] < dateFrom) return false;
      if (dateTo && pr.requisition_date && pr.requisition_date.split('T')[0] > dateTo) return false;
      return true;
    });
  }, [prs, searchQuery, statusFilter, dateFrom, dateTo]);

  const handleExportCSV = () => {
    if (filteredPRs.length === 0) { toast.error('No requisitions to export'); return; }
    exportCSV(filteredPRs, [
      { header: 'PR Number', key: 'pr_number' },
      { header: 'Date', key: 'requisition_date', transform: (v) => v ? new Date(v).toLocaleDateString() : '' },
      { header: 'Requested By', key: 'requester_name' },
      { header: 'Department', key: 'department' },
      { header: 'Type', key: 'requisition_type' },
      { header: 'Items', key: 'line_count' },
      { header: 'Amount', key: 'total_amount', transform: (v) => parseFloat(v || 0).toFixed(2) },
      { header: 'Status', key: 'status' },
    ], `purchase-requisitions${dateFrom ? `-${dateFrom}` : ''}${dateTo ? `_to_${dateTo}` : ''}.csv`);
  };

  const openCreate = () => {
    setEditingPR(null);
    setFormData({ department: '', requisition_type: 'routine', delivery_date_required: '', notes: '' });
    setLines([]);
    setDraft(emptyLine());
    setSelectedLocationId('');
  };

  const openEdit = async (pr: PR) => {
    try {
      const res = await authFetch(`/api/procurement/purchase-requisitions/${pr.id}`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setEditingPR(data);
      setFormData({
        department: data.department || '', requisition_type: data.requisition_type || 'routine',
        delivery_date_required: data.delivery_date_required ? data.delivery_date_required.split('T')[0] : '',
        notes: data.notes || ''
      });
      setLines(data.lines || []);
      setDraft(emptyLine());
      setSelectedLocationId('');
    } catch (error) {
      toast.error('Failed to load PR details');
    }
  };

  const viewPR = async (pr: PR) => {
    try {
      const res = await authFetch(`/api/procurement/purchase-requisitions/${pr.id}`);
      if (res.ok) {
        setSelectedPR(await res.json());
        setShowDetailsModal(true);
      }
    } catch (error) {
      toast.error('Failed to load PR details');
    }
  };

  const updateDraft = (field: string, value: any) => {
    setDraft(prev => {
      const updated: PRLine = { ...prev, [field]: value };
      if (field === 'quantity_required' || field === 'estimated_unit_price') {
        updated.estimated_line_total = (updated.quantity_required || 0) * (updated.estimated_unit_price || 0);
      }
      return updated;
    });
  };

  const addItemToList = () => {
    if (!draft.item_description.trim()) { toast.error('Enter an item description'); return; }
    setLines([...lines, draft]);
    setDraft(emptyLine());
  };

  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const validLines = lines.filter(l => l.item_description.trim()).map(({ location_id: _l, manual_entry: _m, ...rest }) => rest);
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }

    setSaving(true);
    try {
      const url = editingPR
        ? `/api/procurement/purchase-requisitions/${editingPR.id}`
        : '/api/procurement/purchase-requisitions';
      const method = editingPR ? 'PUT' : 'POST';
      const body = {
        ...formData, lines: validLines,
        clinic_id: user?.clinic, requested_by: user?.uid
      };

      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Failed');

      toast.success(editingPR ? 'PR updated' : 'PR created');
      openCreate();
      fetchPRs();
    } catch (error) {
      toast.error('Failed to save PR');
    } finally {
      setSaving(false);
    }
  };

  const submitPR = async (id: string) => {
    if (processing?.id === id) return;
    setProcessing({ id, action: 'submit' });
    try {
      const res = await authFetch(`/api/procurement/purchase-requisitions/${id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      toast.success('PR submitted for approval');
      fetchPRs();
      setShowDetailsModal(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit PR');
    } finally {
      setProcessing(null);
    }
  };

  const approvePR = async (id: string) => {
    if (processing?.id === id) return;
    setProcessing({ id, action: 'approve' });
    try {
      const res = await authFetch(`/api/procurement/purchase-requisitions/${id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: user?.uid })
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('PR approved');
      fetchPRs();
      setShowDetailsModal(false);
    } catch (error) {
      toast.error('Failed to approve PR');
    } finally {
      setProcessing(null);
    }
  };

  const rejectPR = async (id: string) => {
    if (processing?.id === id) return;
    const reason = prompt('Reason for rejection:');
    if (!reason) return;
    setProcessing({ id, action: 'reject' });
    try {
      const res = await authFetch(`/api/procurement/purchase-requisitions/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: user?.uid, rejection_reason: reason })
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('PR rejected');
      fetchPRs();
      setShowDetailsModal(false);
    } catch (error) {
      toast.error('Failed to reject PR');
    } finally {
      setProcessing(null);
    }
  };

  const cancelPR = async (id: string) => {
    if (processing?.id === id) return;
    if (!confirm('Cancel this requisition?')) return;
    setProcessing({ id, action: 'cancel' });
    try {
      const res = await authFetch(`/api/procurement/purchase-requisitions/${id}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      toast.success('PR cancelled');
      fetchPRs();
      setShowDetailsModal(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel PR');
    } finally {
      setProcessing(null);
    }
  };

  // Format an amount in the PO-currency being created from this PR (may differ
  // from the tenant's base/display currency) — mirrors PurchaseOrders.tsx's fmtAs.
  const fmtAs = (amount: number | string, code?: string) => {
    const n = parseFloat(String(amount || 0));
    if (!code || code === currency.code) return fmt(n);
    const meta = availableCurrencies.find(c => c.code === code);
    const symbol = meta?.symbol || code;
    return `${symbol} ${n.toFixed(2)}`;
  };

  const totalAmount = useMemo(() => lines.reduce((s, l) => s + (l.estimated_line_total || 0), 0), [lines]);

  // === Create PO from approved PR ===
  const fetchSuppliers = async () => {
    try {
      const res = await authFetch(`/api/procurement/suppliers?clinic_id=${user?.clinic || ''}`);
      if (res.ok) setSuppliers(await res.json());
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  };

  // Fetches how many units of `toCode` equal 1 unit of the base currency, for converting
  // the PR's base-currency estimated prices into whatever currency is picked for the PO.
  const fetchPOCreateRate = async (toCode: string) => {
    if (!toCode || toCode === currency.code) { setPOCreateRate(1); return; }
    setLoadingRate(true);
    try {
      const res = await authFetch(`/api/accounting/exchange-rates/current?clinic_id=${user?.clinic || ''}&from_currency=${currency.code}&to_currency=${toCode}`);
      if (res.ok) {
        const data = await res.json();
        setPOCreateRate(parseFloat(data.rate) || 1);
      } else {
        setPOCreateRate(1);
      }
    } catch {
      setPOCreateRate(1);
    } finally {
      setLoadingRate(false);
    }
  };

  const openCreatePO = async (pr: PR) => {
    setPrForPO(pr);
    setPOFormData({
      supplier_id: '', delivery_address: '',
      requested_delivery_date: pr.delivery_date_required ? pr.delivery_date_required.split('T')[0] : '',
      // Currency is decided here at PO creation, not carried over from the PR (which no
      // longer has its own currency selector) — defaults to the tenant's base currency.
      payment_terms: 'Net30', po_currency: currency.code, notes: `Created from ${pr.pr_number}`
    });
    setPOCreateRate(1);
    setPOFromPRFiles([]);
    await fetchSuppliers();
    setShowDetailsModal(false);
    setShowCreatePOModal(true);
  };

  const createPOFromPR = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingPO) return;
    if (!poFormData.supplier_id) { toast.error('Please select a supplier'); return; }
    if (!prForPO) return;

    setCreatingPO(true);
    try {
      // Map PR line items to PO items — the PR's estimated prices are always in the base
      // currency, so convert them into whatever currency was picked for this PO (poCreateRate)
      // rather than sending the raw base-currency numbers mislabeled as the new currency.
      const items = (prForPO.lines || []).map(line => ({
        item_name: line.item_description,
        description: line.item_specification || '',
        quantity: line.quantity_required,
        unit_price: Math.round(line.estimated_unit_price * poCreateRate * 100) / 100,
        unit_of_measure: line.unit_of_measure
      }));

      const res = await authFetch('/api/procurement/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_id: user?.clinic,
          supplier_id: parseInt(poFormData.supplier_id),
          pr_id: prForPO.id,
          po_type: 'standard',
          order_date: new Date().toISOString().split('T')[0],
          delivery_address: poFormData.delivery_address || null,
          requested_delivery_date: poFormData.requested_delivery_date || null,
          payment_terms: poFormData.payment_terms,
          po_currency: poFormData.po_currency,
          exchange_rate: 1,
          notes: poFormData.notes,
          items,
          created_by: user?.uid
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed');
      }

      const newPO = await res.json();
      toast.success(`Purchase Order ${newPO.po_number} created from ${prForPO.pr_number}`);

      // Attachments are optional and best-effort — a failed upload never undoes the
      // already-successful PO creation, it just surfaces a separate warning toast.
      if (poFromPRFiles.length > 0) {
        try {
          await uploadProcurementAttachments('purchase-order', newPO.id, poFromPRFiles);
          toast.success(`${poFromPRFiles.length} attachment${poFromPRFiles.length === 1 ? '' : 's'} uploaded`);
        } catch {
          toast.error('Purchase order created, but attachments failed to upload');
        }
      }

      setShowCreatePOModal(false);
      setPrForPO(null);
      setPOFromPRFiles([]);
      navigate('/procurement/purchase-orders');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create purchase order');
    } finally {
      setCreatingPO(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<ShoppingCart />}
          title="Purchase Requisitions"
          actions={
            <Button onClick={fetchPRs} variant="outline" size="icon" disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          }
        />


        <div className="space-y-6">
          {/* Create/Edit form (stacked above the list, always visible) */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex justify-between items-center flex-shrink-0">
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
                  <span className="text-primary text-xs font-bold">PR</span>
                </div>
                {editingPR ? `Edit ${editingPR.pr_number}` : 'New Purchase Requisition'}
              </h3>
              {editingPR && (
                <Button variant="ghost" size="sm" onClick={openCreate}>
                  <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancel
                </Button>
              )}
            </div>
            <form onSubmit={handleSubmit} className="flex-1 overflow-auto">
              <div className="p-4 grid grid-cols-12 gap-6">
                {/* LEFT (4/12): requisition-level fields + submit */}
                <div className="col-span-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Department</Label>
                      <Combobox
                        options={departments.map(d => ({ value: d.department_name, label: d.department_name }))}
                        value={formData.department}
                        onChange={v => setFormData({...formData, department: v})}
                        placeholder="Select department..."
                        searchPlaceholder="Search..."
                        className="h-9 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Type</Label>
                      <Combobox
                        options={[
                          { value: 'routine', label: 'Routine' },
                          { value: 'urgent', label: 'Urgent' },
                          { value: 'emergency', label: 'Emergency' },
                        ]}
                        value={formData.requisition_type}
                        onChange={v => setFormData({...formData, requisition_type: v})}
                        searchPlaceholder="Search..."
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Required By</Label>
                    <Input className="h-9 text-xs" type="date" value={formData.delivery_date_required} onChange={e => setFormData({...formData, delivery_date_required: e.target.value})} />
                  </div>

                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} rows={2} placeholder="Additional notes or justification..." className="text-xs" />
                  </div>

                  {/* Storage location — chosen once for the whole requisition; every line
                      item to the right is picked from this same location's stock. */}
                  <div>
                    <Label className="text-xs mb-1 block">Storage Location</Label>
                    <Combobox
                      options={storageLocations.map(loc => ({
                        value: loc.id,
                        label: `${loc.location_name}${loc.item_count > 0 ? ` (${loc.item_count} items)` : ''}`,
                      }))}
                      value={selectedLocationId}
                      onChange={handleTopLocationChange}
                      placeholder="Select store..."
                      searchPlaceholder="Search..."
                      className="h-9 text-xs"
                    />
                  </div>
                </div>

                {/* MIDDLE (4/12): single item-entry form — filling this out and clicking
                    "Add Item to List" appends a compact row to the list on the right,
                    instead of the entry area itself growing with every item. */}
                <div className="col-span-4">
                  <Label className="text-sm font-semibold mb-2 block">Add Item</Label>
                  <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs">Item Description *</Label>
                        {selectedLocationId && (
                          <button
                            type="button"
                            onClick={toggleDraftManualEntry}
                            className="text-xs text-primary hover:underline flex items-center gap-0.5"
                          >
                            {draft.manual_entry
                              ? <><ArrowLeft className="w-3 h-3" /> Pick from store</>
                              : <><PenLine className="w-3 h-3" /> Not in store?</>}
                          </button>
                        )}
                      </div>
                      {!selectedLocationId ? (
                        <div className="h-8 flex items-center px-2 text-xs text-muted-foreground border rounded-md bg-muted/30">
                          Select a store first
                        </div>
                      ) : draft.manual_entry ? (
                        <Input
                          className="h-8 text-xs"
                          value={draft.item_description}
                          onChange={e => updateDraft('item_description', e.target.value)}
                          placeholder="Type item name..."
                        />
                      ) : (
                        <Popover open={draftComboboxOpen} onOpenChange={setDraftComboboxOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              role="combobox"
                              className="h-8 w-full justify-between text-xs font-normal px-2"
                              disabled={loadingStock[selectedLocationId]}
                            >
                              <span className="truncate">
                                {loadingStock[selectedLocationId]
                                  ? 'Loading store items...'
                                  : draft.item_description || (
                                      (locationStockCache[selectedLocationId]?.length ?? 0) === 0
                                        ? 'No items in this store'
                                        : 'Select item...'
                                    )
                                }
                              </span>
                              <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[280px] p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Search item name or code..." className="h-8 text-xs" />
                              <CommandList className="max-h-48">
                                <CommandEmpty>No items found in this store.</CommandEmpty>
                                <CommandGroup>
                                  {(locationStockCache[selectedLocationId] || []).map(item => (
                                    <CommandItem
                                      key={item.item_id}
                                      value={item.item_name}
                                      onSelect={() => {
                                        handleDraftStockItemSelect(item.item_name);
                                        setDraftComboboxOpen(false);
                                      }}
                                      className="text-xs"
                                    >
                                      <CheckIcon className={`mr-2 h-3 w-3 ${draft.item_description === item.item_name ? 'opacity-100' : 'opacity-0'}`} />
                                      <div className="flex flex-col flex-1 min-w-0">
                                        <span className="font-medium truncate">{item.item_name}</span>
                                      </div>
                                      <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
                                        {item.quantity_on_hand} {item.unit_of_measure}
                                      </span>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs mb-1 block">Item Code</Label>
                        <Input className="h-8 text-xs" value={draft.item_code} onChange={e => updateDraft('item_code', e.target.value)} placeholder="Code" />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Qty</Label>
                        <Input className="h-8 text-xs" type="number" min={1} value={draft.quantity_required} onChange={e => updateDraft('quantity_required', parseInt(e.target.value) || 1)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">UOM</Label>
                        <Input className="h-8 text-xs" value={draft.unit_of_measure} onChange={e => updateDraft('unit_of_measure', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Est. Unit Price</Label>
                        <Input className="h-8 text-xs" type="number" step="0.01" value={draft.estimated_unit_price} onChange={e => updateDraft('estimated_unit_price', parseFloat(e.target.value) || 0)} />
                      </div>
                    </div>

                    <Button type="button" size="sm" className="w-full" onClick={addItemToList}>
                      <Plus className="w-3 h-3 mr-1" /> Add Item to List
                    </Button>
                  </div>
                </div>

                {/* RIGHT (4/12): compact list of items already added */}
                <div className="col-span-4">
                  <Label className="text-sm font-semibold mb-2 block">Items Added ({lines.length})</Label>
                  <div className="border rounded-lg bg-card divide-y max-h-[360px] overflow-y-auto">
                    {lines.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">No items added yet</div>
                    ) : (
                      lines.map((line, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-3 py-2 text-xs">
                          <span className="flex-1 min-w-0 font-medium truncate" title={line.item_description}>{line.item_description}</span>
                          <span className="text-muted-foreground w-12 text-center shrink-0">{line.unit_of_measure}</span>
                          <span className="text-muted-foreground w-8 text-right shrink-0">{line.quantity_required}</span>
                          <span className="font-mono w-20 text-right shrink-0">{fmt(line.estimated_line_total)}</span>
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="text-muted-foreground hover:text-destructive shrink-0"
                            aria-label={`Remove ${line.item_description}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex justify-end pt-2">
                    <div className="text-sm font-semibold flex items-center gap-3 px-3 py-2 bg-muted/40 rounded-lg">
                      <span>Total:</span>
                      <span className="font-mono text-base">{fmt(totalAmount)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-4 pb-4 flex justify-end">
                <Button type="submit" size="sm" className="px-6" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {saving ? (editingPR ? 'Updating...' : 'Creating...') : `${editingPR ? 'Update' : 'Create'} Requisition`}
                </Button>
              </div>
            </form>
          </div>

          {/* RIGHT: Filters + Table */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex flex-wrap items-end gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search PRs..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
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
                options={[
                  { value: 'all', label: 'All Status' },
                  { value: 'draft', label: 'Draft' },
                  { value: 'submitted', label: 'Submitted' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'rejected', label: 'Rejected' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
                searchPlaceholder="Search..."
                className="w-[150px]"
              />
              <Button type="button" variant="outline" onClick={handleExportCSV} className="gap-1.5">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
            </div>
            <div className="p-4">
              <AdvancedDataTable<PR>
                data={filteredPRs}
                keyExtractor={(pr) => pr.id}
                emptyMessage="No requisitions found"
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'pr_number', header: 'PR Number', sortable: true, render: (v) => <span className="text-sm font-mono font-medium">{v}</span> },
                  { key: 'requisition_date', header: 'Date', sortable: true, render: (v) => <span className="text-sm">{v ? new Date(v).toLocaleDateString() : '—'}</span> },
                  { key: 'requester_name', header: 'Requested By', sortable: true, render: (v) => <span className="text-sm">{v || '—'}</span> },
                  { key: 'department', header: 'Department', sortable: true, render: (v) => <span className="text-sm">{v || '—'}</span> },
                  { key: 'requisition_type', header: 'Type', align: 'center', render: (v) => <Badge variant="outline" className="text-xs capitalize">{v}</Badge> },
                  { key: 'total_amount', header: 'Amount', align: 'right', sortable: true, render: (v) => <span className="font-mono text-sm">{fmt(v)}</span> },
                  { key: 'status', header: 'Status', align: 'center', sortable: true, render: (v) => <Badge className={`text-xs ${getStatusColor(v)}`}>{v}</Badge> },
                  {
                    key: '__actions', header: 'Actions', align: 'center',
                    render: (_v, pr) => (
                      <div className="flex items-center justify-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => viewPR(pr)}><Eye className="w-3.5 h-3.5" /></Button>
                        {pr.status === 'draft' && (
                          <Button size="sm" variant="ghost" onClick={() => openEdit(pr)}><Edit className="w-3.5 h-3.5" /></Button>
                        )}
                        {pr.status === 'draft' && (
                          <Button size="sm" variant="ghost" onClick={() => submitPR(pr.id)} disabled={processing?.id === pr.id}>
                            {processing?.id === pr.id && processing.action === 'submit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 text-primary" />}
                          </Button>
                        )}
                        {pr.status === 'submitted' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => approvePR(pr.id)} disabled={processing?.id === pr.id}>
                              {processing?.id === pr.id && processing.action === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => rejectPR(pr.id)} disabled={processing?.id === pr.id}>
                              {processing?.id === pr.id && processing.action === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5 text-red-600" />}
                            </Button>
                          </>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Details Dialog */}
        <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Purchase Requisition Details</DialogTitle>
              <DialogDescription>View requisition information and take actions.</DialogDescription>
            </DialogHeader>
            {selectedPR && (
              <div className="space-y-4 px-6 pb-6 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold font-mono">{selectedPR.pr_number}</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedPR.requisition_date ? new Date(selectedPR.requisition_date).toLocaleDateString() : '—'}
                    </p>
                  </div>
                  <Badge className={`${getStatusColor(selectedPR.status)} text-sm`}>{selectedPR.status}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Requested By:</span> <span className="font-medium">{selectedPR.requester_name || '—'}</span></div>
                  <div><span className="text-muted-foreground">Department:</span> <span className="font-medium">{selectedPR.department || '—'}</span></div>
                  <div><span className="text-muted-foreground">Type:</span> <Badge variant="outline" className="capitalize text-xs ml-1">{selectedPR.requisition_type}</Badge></div>
                  <div><span className="text-muted-foreground">Required By:</span> <span className="font-medium">{selectedPR.delivery_date_required ? new Date(selectedPR.delivery_date_required).toLocaleDateString() : '—'}</span></div>
                  {selectedPR.approver_name && <div><span className="text-muted-foreground">Approved By:</span> <span className="font-medium">{selectedPR.approver_name}</span></div>}
                  {selectedPR.rejection_reason && <div className="col-span-2"><span className="text-muted-foreground">Rejection Reason:</span> <span className="text-red-600">{selectedPR.rejection_reason}</span></div>}
                </div>

                {selectedPR.notes && (
                  <div className="p-3 rounded-lg bg-muted/50 text-sm">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                    {selectedPR.notes}
                  </div>
                )}

                {/* Line Items */}
                <div>
                  <AdvancedDataTable<PRLine>
                    data={selectedPR.lines || []}
                    keyExtractor={(line, idx) => line.id ?? idx}
                    columns={[
                      { key: '__idx', header: '#', render: (_v, _l, idx) => <span className="text-muted-foreground">{idx + 1}</span> },
                      { key: 'item_code', header: 'Code', render: (v) => <span className="font-mono text-xs">{v || '—'}</span> },
                      { key: 'item_description', header: 'Description' },
                      { key: 'quantity_required', header: 'Qty', align: 'right' },
                      { key: 'unit_of_measure', header: 'UOM' },
                      { key: 'estimated_unit_price', header: 'Unit Price', align: 'right', render: (v) => <span className="font-mono">{fmt(v)}</span> },
                      { key: 'estimated_line_total', header: 'Total', align: 'right', render: (v) => <span className="font-mono">{fmt(v)}</span> },
                    ]}
                  />
                  {(selectedPR.lines || []).length > 0 && (
                    <div className="border border-t-0 border-border rounded-b-md bg-muted/20 -mt-px px-3 py-2 flex justify-between text-sm font-semibold">
                      <span>Total (estimated):</span>
                      <span className="font-mono">{fmt(selectedPR.total_amount)}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {selectedPR.status === 'draft' && (
                    <>
                      <Button size="sm" onClick={() => { setShowDetailsModal(false); openEdit(selectedPR); }} variant="outline" className="h-8 px-4 text-xs" disabled={processing?.id === selectedPR.id}>
                        <Edit className="w-3 h-3 mr-2" /> Edit
                      </Button>
                      <Button size="sm" onClick={() => submitPR(selectedPR.id)} className="h-8 px-4 text-xs" disabled={processing?.id === selectedPR.id}>
                        {processing?.id === selectedPR.id && processing.action === 'submit' ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Send className="w-3 h-3 mr-2" />}
                        {processing?.id === selectedPR.id && processing.action === 'submit' ? 'Submitting...' : 'Submit for Approval'}
                      </Button>
                      <Button size="sm" onClick={() => cancelPR(selectedPR.id)} variant="destructive" className="h-8 px-4 text-xs" disabled={processing?.id === selectedPR.id}>
                        {processing?.id === selectedPR.id && processing.action === 'cancel' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <XCircle className="w-3 h-3 mr-1" />}
                        {processing?.id === selectedPR.id && processing.action === 'cancel' ? 'Cancelling...' : 'Cancel'}
                      </Button>
                    </>
                  )}
                  {selectedPR.status === 'submitted' && (
                    <>
                      <Button size="sm" onClick={() => approvePR(selectedPR.id)} className="h-8 px-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={processing?.id === selectedPR.id}>
                        {processing?.id === selectedPR.id && processing.action === 'approve' ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-2" />}
                        {processing?.id === selectedPR.id && processing.action === 'approve' ? 'Approving...' : 'Approve'}
                      </Button>
                      <Button size="sm" onClick={() => rejectPR(selectedPR.id)} variant="destructive" className="h-8 px-4 text-xs" disabled={processing?.id === selectedPR.id}>
                        {processing?.id === selectedPR.id && processing.action === 'reject' ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <XCircle className="w-3 h-3 mr-2" />}
                        {processing?.id === selectedPR.id && processing.action === 'reject' ? 'Rejecting...' : 'Reject'}
                      </Button>
                    </>
                  )}
                  {selectedPR.status === 'approved' && (
                    <Button size="sm" onClick={() => openCreatePO(selectedPR)} className="h-8 px-4 text-xs">
                      <ShoppingCart className="w-3 h-3 mr-2" /> Create Purchase Order
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8 px-4 text-xs ml-auto" onClick={() => setShowDetailsModal(false)}>Close</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        {/* Create PO from PR Dialog */}
        <Dialog open={showCreatePOModal} onOpenChange={setShowCreatePOModal}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Purchase Order from {prForPO?.pr_number}</DialogTitle>
              <DialogDescription>Select a supplier and configure the purchase order details.</DialogDescription>
            </DialogHeader>
            {prForPO && (
              <form onSubmit={createPOFromPR} className="space-y-4 px-6 pb-6 pt-2">
                {/* PR Summary */}
                <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
                  <p className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-1">Requisition Summary</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Department:</span> {prForPO.department || '—'}</div>
                    <div><span className="text-muted-foreground">Items:</span> {prForPO.lines?.length || 0}</div>
                    <div><span className="text-muted-foreground">Est. Total:</span> <span className="font-mono font-semibold">{fmt(prForPO.total_amount)}</span></div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Supplier *</Label>
                    <Combobox
                      options={suppliers.map(s => ({
                        value: String(s.id),
                        label: `${s.name} ${s.supplier_code ? `(${s.supplier_code})` : ''}`.trim(),
                      }))}
                      value={poFormData.supplier_id}
                      onChange={v => setPOFormData({...poFormData, supplier_id: v})}
                      placeholder="Select a supplier..."
                      searchPlaceholder="Search suppliers..."
                    />
                  </div>
                  <div>
                    <Label>Required Delivery Date</Label>
                    <Input type="date" value={poFormData.requested_delivery_date}
                      onChange={e => setPOFormData({...poFormData, requested_delivery_date: e.target.value})} />
                  </div>
                  <div>
                    <Label>Payment Terms</Label>
                    <Combobox
                      options={[
                        { value: 'Net30', label: 'Net 30' },
                        { value: 'Net60', label: 'Net 60' },
                        { value: 'Net90', label: 'Net 90' },
                        { value: 'COD', label: 'Cash on Delivery' },
                        { value: 'Prepaid', label: 'Prepaid' },
                      ]}
                      value={poFormData.payment_terms}
                      onChange={v => setPOFormData({...poFormData, payment_terms: v})}
                      searchPlaceholder="Search..."
                    />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Combobox
                      options={
                        availableCurrencies.length > 0
                          ? availableCurrencies.map(c => ({
                              value: c.code,
                              label: `${c.code} — ${c.name} ${c.is_base_currency ? '(Base)' : ''}`.trim(),
                            }))
                          : (currency.code ? [{ value: currency.code, label: currency.code }] : [])
                      }
                      value={poFormData.po_currency}
                      onChange={v => { setPOFormData({...poFormData, po_currency: v}); fetchPOCreateRate(v); }}
                      searchPlaceholder="Search..."
                    />
                  </div>
                  <div>
                    <Label>Delivery Address</Label>
                    <Input value={poFormData.delivery_address}
                      onChange={e => setPOFormData({...poFormData, delivery_address: e.target.value})}
                      placeholder="e.g., Main Warehouse" />
                  </div>
                  <div className="col-span-2">
                    <Label>Notes</Label>
                    <Textarea value={poFormData.notes}
                      onChange={e => setPOFormData({...poFormData, notes: e.target.value})} rows={2} />
                  </div>
                  <div className="col-span-2">
                    <AttachmentField files={poFromPRFiles} onChange={setPOFromPRFiles} label="Quotation (optional)" />
                  </div>
                </div>

                {/* Line Items Preview — converted from the PR's base-currency estimates using
                    the real exchange rate for whichever currency is picked above. */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-semibold">Items from Requisition</Label>
                    {loadingRate && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Fetching exchange rate...</span>}
                  </div>
                  <div>
                    <AdvancedDataTable<PRLine>
                      data={prForPO.lines || []}
                      keyExtractor={(line, idx) => line.id ?? idx}
                      columns={[
                        { key: '__idx', header: '#', render: (_v, _l, idx) => <span className="text-muted-foreground">{idx + 1}</span> },
                        { key: 'item_description', header: 'Description' },
                        { key: 'quantity_required', header: 'Qty', align: 'right' },
                        { key: 'unit_of_measure', header: 'UOM' },
                        { key: 'estimated_unit_price', header: 'Unit Price', align: 'right', render: (v) => <span className="font-mono">{fmtAs(v * poCreateRate, poFormData.po_currency)}</span> },
                        { key: 'estimated_line_total', header: 'Total', align: 'right', render: (v) => <span className="font-mono">{fmtAs(v * poCreateRate, poFormData.po_currency)}</span> },
                      ]}
                    />
                    {(prForPO.lines || []).length > 0 && (
                      <div className="border border-t-0 border-border rounded-b-md bg-muted/20 -mt-px px-3 py-2 flex justify-between text-sm font-semibold">
                        <span>Total ({poFormData.po_currency}):</span>
                        <span className="font-mono">{fmtAs(prForPO.total_amount * poCreateRate, poFormData.po_currency)}</span>
                      </div>
                    )}
                  </div>
                  {poFormData.po_currency !== currency.code && !loadingRate && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Converted at 1 {currency.code} = {poCreateRate.toFixed(4)} {poFormData.po_currency}
                    </p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <Button size="sm" type="submit" className="h-8 px-4 text-xs ml-auto" disabled={creatingPO || !poFormData.supplier_id}>
                    {creatingPO ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <ShoppingCart className="w-3 h-3 mr-2" />}
                    {creatingPO ? 'Creating...' : 'Create Purchase Order'}
                  </Button>
                  <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs" onClick={() => setShowCreatePOModal(false)}>Cancel</Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default PurchaseRequisitions;
