import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { getStatusColor } from '@/lib/statusColors';
import * as docTemplate from '@/utils/documentTemplate';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { useCurrency } from '@/contexts/CurrencyContext';
import { AttachmentField } from '@/components/procurement/AttachmentField';
import { AttachmentList } from '@/components/procurement/AttachmentList';
import { uploadProcurementAttachments } from '@/api/procurementAttachments';
import { toast } from 'sonner';
import {
  ShoppingCart, Plus, Eye, Search, RefreshCw, Check, CheckCircle,
  Shield, Download, FileText, FileSpreadsheet, Trash2, X, Loader2
} from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface Supplier {
  id: number;
  name: string;
  supplier_code?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  town?: string;
}

interface InventoryItem {
  id: string;
  item_code: string;
  item_name: string;
  item_description?: string | null;
  unit_of_measure: string;
  current_unit_cost?: number | string | null;
  average_unit_cost?: number | string | null;
  selling_price?: number | string | null;
}

interface PurchaseOrderItem {
  id: number;
  item_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit_of_measure: string;
  type?: 'inventory' | 'expense' | 'asset';
}

interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_name?: string;
  pr_id?: string;
  pr_number?: string;
  order_date: string;
  total_amount: number;
  subtotal?: number;
  tax_amount?: number;
  shipping_cost?: number;
  po_currency?: string;
  payment_terms?: string;
  delivery_address?: string;
  requested_delivery_date?: string;
  status: 'draft' | 'check' | 'approved' | 'authorized' | 'received' | 'cancelled';
  notes: string;
  items?: PurchaseOrderItem[];
  created_by?: string;
  created_by_name?: string;
  check_signature?: string;
  check_signed_by?: string;
  check_signed_at?: string;
  approved_signature?: string;
  approved_signed_by?: string;
  approved_signed_at?: string;
  authorized_signature?: string;
  authorized_signed_by?: string;
  authorized_signed_at?: string;
}


// Stops at 'authorized' on purpose — marking a PO received now happens only
// through Goods Receipt Notes, driven by what was actually delivered, not a
// one-click status change here.
const getNextStatus = (s: string) => ({ draft: 'check', check: 'approved', approved: 'authorized' }[s] || null);
const getStatusAction = (s: string) => ({ draft: 'Submit for Check', check: 'Approve', approved: 'Authorize' }[s] || null);
const getStatusIcon = (s: string) => ({ draft: Check, check: CheckCircle, approved: Shield }[s] || CheckCircle);

const PurchaseOrders: React.FC = () => {
  const { user } = useAuth();
  const facilityInfo = useFacilityInfo();
  const { currency, fmt } = useCurrency();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [availableCurrencies, setAvailableCurrencies] = useState<{code: string; name: string; symbol: string; decimal_places: number; is_base_currency: boolean}[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');


  const [showItemModal, setShowItemModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  // Editing the lines of a draft PO, in place in the details modal. Kept as a
  // separate draft copy so Cancel really discards and nothing is written until
  // Save — a purchase order is a financial document and a half-applied edit is
  // worse than no edit.
  const [editingItems, setEditingItems] = useState(false);
  const [itemDrafts, setItemDrafts] = useState<PurchaseOrderItem[]>([]);
  const [removedItemIds, setRemovedItemIds] = useState<Array<string | number>>([]);
  const [savingItemEdits, setSavingItemEdits] = useState(false);
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [userSignature, setUserSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingItems, setSavingItems] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);

  // Deleting a draft PO — kept as a separate confirmation step with a
  // required reason, not a plain confirm(), since this permanently removes
  // the record rather than just changing its status.
  const [deletingOrder, setDeletingOrder] = useState<PurchaseOrder | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingInProgress, setDeletingInProgress] = useState(false);

  const [formData, setFormData] = useState({
    supplier_id: '', order_date: new Date().toISOString().split('T')[0],
    delivery_address: '', requested_delivery_date: '',
    payment_terms: 'Net30', po_currency: currency.code, notes: ''
  });
  const [itemFormData, setItemFormData] = useState({
    type: 'inventory', item_name: '', description: '',
    quantity: '', unit_price: '', unit_of_measure: 'Each', is_new_item: false
  });
  const [newPOFiles, setNewPOFiles] = useState<File[]>([]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/procurement/purchase-orders?clinic_id=${user?.clinic || ''}`);
      if (res.ok) setOrders(await res.json());
    } catch (error) {
      console.error('Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const res = await authFetch(`/api/procurement/suppliers?clinic_id=${user?.clinic || ''}`);
      if (res.ok) setSuppliers(await res.json());
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  };

  const fetchInventory = async () => {
    try {
      // inventory_items (Item Master) — the same source Item Master, Batch
      // Tracking, Scheme Management and billing all read.
      //
      // This used to call /api/pharmacy/inventory/:clinicId, which reads the
      // legacy drug_inventory table. Nothing writes to that table any more
      // (it holds 0 rows while inventory_items holds the real catalogue), so
      // the picker had no options and an item could not be added to a
      // purchase order.
      const res = await authFetch(
        `/api/inventory/items?clinic_id=${user?.clinic || '1'}&is_active=true`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setInventory(Array.isArray(data) ? data : (data?.items || []));
      }
    } catch (error) {
      console.error('Error fetching inventory:', error);
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

  useEffect(() => { fetchOrders(); fetchSuppliers(); fetchInventory(); fetchCurrencies(); }, []);

  // Load user signature
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await authFetch(`/api/users/${user.uid}/signature`, { credentials: 'include' });
        if (res.ok) { const d = await res.json(); setUserSignature(d.signature); }
      } catch (error) { console.error('Error loading signature:', error); }
    })();
  }, [user]);

  const getSupplierName = (id: number) => suppliers.find(s => s.id === id)?.name || 'Unknown';

  // Format an amount in a specific PO's own currency (which may differ from
  // the tenant's base/display currency). Falls back to the base-currency
  // formatter (fmt) when the code matches the base currency or is unknown.
  const fmtAs = (amount: number | string, code?: string) => {
    const n = parseFloat(String(amount || 0));
    if (!code || code === currency.code) return fmt(n);
    const meta = availableCurrencies.find(c => c.code === code);
    const symbol = meta?.symbol || code;
    const decimals = meta?.decimal_places ?? 2;
    return `${symbol} ${n.toFixed(decimals)}`;
  };

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!o.po_number?.toLowerCase().includes(q) &&
            !getSupplierName(o.supplier_id).toLowerCase().includes(q) &&
            !o.notes?.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (dateFrom && o.order_date && o.order_date.split('T')[0] < dateFrom) return false;
      if (dateTo && o.order_date && o.order_date.split('T')[0] > dateTo) return false;
      return true;
    });
  }, [orders, searchQuery, statusFilter, dateFrom, dateTo, suppliers]);

  // === Actions ===
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!formData.supplier_id) { toast.error('Select a supplier'); return; }
    setSaving(true);
    try {
      const res = await authFetch('/api/procurement/purchase-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_id: user?.clinic,
          supplier_id: parseInt(formData.supplier_id),
          order_date: formData.order_date,
          delivery_address: formData.delivery_address || null,
          requested_delivery_date: formData.requested_delivery_date || null,
          payment_terms: formData.payment_terms,
          po_currency: formData.po_currency,
          exchange_rate: 1,
          notes: formData.notes || null,
          items: [],
          created_by: user?.uid
        })
      });
      if (!res.ok) throw new Error('Failed');
      const newPO = await res.json();
      toast.success('Purchase order created');

      // Attachments are optional and best-effort — a failed upload never undoes the
      // already-successful PO creation, it just surfaces a separate warning toast.
      if (newPOFiles.length > 0) {
        try {
          await uploadProcurementAttachments('purchase-order', newPO.id, newPOFiles);
          toast.success(`${newPOFiles.length} attachment${newPOFiles.length === 1 ? '' : 's'} uploaded`);
        } catch {
          toast.error('Purchase order created, but attachments failed to upload');
        }
      }

      setFormData({ supplier_id: '', order_date: new Date().toISOString().split('T')[0], delivery_address: '', requested_delivery_date: '', payment_terms: 'Net30', po_currency: currency.code, notes: '' });
      setNewPOFiles([]);
      fetchOrders();
    } catch (error) { toast.error('Failed to create order'); } finally { setSaving(false); }
  };

  const addToPendingItems = (e: React.FormEvent) => {
    e.preventDefault();
    const newItem = {
      id: Date.now(), type: itemFormData.type,
      item_name: itemFormData.item_name, description: itemFormData.description,
      quantity: parseInt(itemFormData.quantity), unit_price: parseFloat(itemFormData.unit_price),
      unit_of_measure: itemFormData.unit_of_measure,
      total_price: parseInt(itemFormData.quantity) * parseFloat(itemFormData.unit_price),
      is_new_item: itemFormData.is_new_item
    };
    setPendingItems([...pendingItems, newItem]);
    setItemFormData({ type: 'inventory', item_name: '', description: '', quantity: '', unit_price: '', unit_of_measure: 'Each', is_new_item: false });
    toast.success('Item added to list');
  };

  const removePendingItem = (id: number) => setPendingItems(pendingItems.filter(item => item.id !== id));

  const saveAllItems = async () => {
    if (savingItems) return;
    if (!selectedOrder || pendingItems.length === 0) return;
    setSavingItems(true);
    try {
      for (const item of pendingItems) {
        const res = await authFetch(`/api/procurement/purchase-orders/${selectedOrder.id}/items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_name: item.item_name, description: item.description, quantity: item.quantity, unit_price: item.unit_price, unit_of_measure: item.unit_of_measure, type: item.type })
        });
        if (!res.ok) throw new Error('Failed to add item');
      }
      toast.success(`${pendingItems.length} items added`);
      setShowItemModal(false); setPendingItems([]);
      setItemFormData({ type: 'inventory', item_name: '', description: '', quantity: '', unit_price: '', unit_of_measure: 'Each', is_new_item: false });
      fetchOrders();
    } catch (error) { toast.error('Failed to add items'); } finally { setSavingItems(false); }
  };

  const handleInventorySelection = (itemName: string) => {
    const sel = inventory.find(item => item.item_name === itemName);
    if (!sel) return;
    // Prefer the item's current cost, falling back to its moving average — a
    // purchase order is priced at what the item costs to buy, not what it sells
    // for, so selling_price is only a last resort.
    const cost = [sel.current_unit_cost, sel.average_unit_cost, sel.selling_price]
      .map(v => (v == null ? NaN : parseFloat(String(v))))
      .find(v => Number.isFinite(v) && v > 0);
    setItemFormData({
      ...itemFormData,
      item_name: itemName,
      unit_price: cost != null ? String(cost) : '',
      unit_of_measure: sel.unit_of_measure || 'Each',
      description: sel.item_description || '',
    });
  };

  const updateOrderStatus = async (orderId: number, newStatus: string) => {
    if (processingId === orderId) return;
    const actionMap: Record<string, string> = { check: 'check', approved: 'approve', authorized: 'authorize' };
    const action = actionMap[newStatus] || newStatus;
    if (!userSignature) { toast.error('Please add your electronic signature in your profile first'); return; }
    setProcessingId(orderId);
    try {
      const res = await authFetch(`/api/procurement/purchase-orders/${orderId}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, signature: userSignature, user_id: user?.uid, user_name: user?.displayName || 'Unknown User' })
      });
      if (!res.ok) throw new Error('Failed');
      toast.success(`Purchase order ${newStatus}`);
      fetchOrders();
      if (showDetailsModal) { setShowDetailsModal(false); }
    } catch (error) { toast.error('Failed to update status'); } finally { setProcessingId(null); }
  };

  const handleDeleteOrder = async () => {
    if (!deletingOrder) return;
    if (!deleteReason.trim()) { toast.error('Please state a reason for deleting this purchase order'); return; }
    setDeletingInProgress(true);
    try {
      const res = await authFetch(`/api/procurement/purchase-orders/${deletingOrder.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete purchase order');
      }
      toast.success(`Purchase order ${deletingOrder.po_number} deleted`);
      setDeletingOrder(null);
      setDeleteReason('');
      setShowDetailsModal(false);
      fetchOrders();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete purchase order');
    } finally {
      setDeletingInProgress(false);
    }
  };

  const exportFilteredOrders = () => {
    if (filteredOrders.length === 0) { toast.error('No orders to export'); return; }
    const csv = [
      ['PO Number', 'Supplier', 'Order Date', 'Status', 'Total Amount', 'Items', 'Notes'].join(','),
      ...filteredOrders.map(o => [o.po_number, `"${getSupplierName(o.supplier_id)}"`, new Date(o.order_date).toLocaleDateString(), o.status, parseFloat(String(o.total_amount || '0')).toFixed(2), o.items?.length || 0, `"${o.notes || ''}"`].join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `purchase-orders-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); window.URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredOrders.length} orders`);
  };

  const downloadPOReport = async (orderSummary: PurchaseOrder) => {
    const statusLabels: Record<string, string> = {
      draft: 'DRAFT - Pending Review', check: 'UNDER REVIEW - Pending Approval',
      approved: 'APPROVED - Pending Authorization', authorized: 'AUTHORIZED - Ready for Processing',
      received: 'RECEIVED - Completed', cancelled: 'CANCELLED'
    };

    // Row-level PO objects (from the list) never carry `items`, `created_by`,
    // or `created_by_name` — only the single-PO endpoint returns those. Always
    // fetch the full record so the PDF is complete regardless of where the
    // download was triggered from (table row vs. details modal).
    let order = orderSummary;
    try {
      const res = await authFetch(`/api/procurement/purchase-orders/${orderSummary.id}`);
      if (res.ok) order = await res.json();
    } catch (error) {
      console.error('Error loading PO details for PDF:', error);
    }

    const orderDate = new Date(order.order_date).toLocaleDateString();
    const validUntil = new Date(new Date(order.order_date).getTime() + 30*24*60*60*1000).toLocaleDateString();
    const supplier = suppliers.find(s => s.id === order.supplier_id);
    const sn = order.supplier_name || supplier?.name || 'Unknown', sa = supplier?.address || '-', sp = supplier?.phone || '-', se = supplier?.email || '-', st = supplier?.town || '-';

    // Amounts on a PO are recorded in that PO's own currency (po_currency),
    // which may differ from the tenant's base/display currency — always
    // format using the PO's own currency, not the global one.
    const poCurrencyCode = order.po_currency || currency.code;
    const poCurrencyMeta = availableCurrencies.find(c => c.code === poCurrencyCode);
    const poCurrencySymbol = poCurrencyMeta?.symbol || poCurrencyCode;

    // Build items table rows
    const itemRows: docTemplate.TableRow[] = (order.items || []).map((item, i) => ({
      bold: false,
      cells: [
        i + 1,
        item.item_name,
        item.unit_of_measure,
        item.quantity,
        fmtAs(item.unit_price, poCurrencyCode),
        fmtAs(item.total_price, poCurrencyCode),
      ],
    }));

    // The creator's signature isn't stored on the PO row itself (unlike the
    // check/approve/authorize steps, which stamp a signature at the moment
    // of signing) — pull it live via the shared fetchUserSignature helper,
    // same pattern used by LISResultsEntry / LISManagerReview.
    const preparedBySignature = await docTemplate.fetchUserSignature(order.created_by);

    // Build signature blocks HTML
    const signaturesHTML = docTemplate.buildSignatures([
      { label: 'Prepared By', name: order.created_by_name || '', signature: preparedBySignature || undefined },
      { label: 'Checked By', name: order.check_signed_by || '', signature: order.check_signature || undefined },
      { label: 'Approved By', name: order.approved_signed_by || '', signature: order.approved_signature || undefined },
      { label: 'Authorized By', name: order.authorized_signed_by || '', signature: order.authorized_signature || undefined },
    ]);

    const bodyHTML = [
      docTemplate.buildInfoGrid(
        { title: 'Order Details', rows: [
          { label: 'PO Number', value: order.po_number, bold: true },
          { label: 'Order Date', value: orderDate },
          { label: 'Valid Until', value: validUntil },
          { label: 'Currency', value: poCurrencyCode },
          { label: 'Status', value: statusLabels[order.status] || order.status },
        ]},
        { title: 'Supplier Details', rows: [
          { label: 'Supplier', value: sn, bold: true },
          { label: 'Address', value: sa },
          { label: 'Phone', value: sp },
          { label: 'Email', value: se },
          { label: 'Town', value: st },
        ]}
      ),
      `<div class="ic-section-title">Order Items</div>`,
      docTemplate.buildTable(
        [
          { label: '#', align: 'center', width: '40px' },
          { label: 'Item Name' },
          { label: 'Units' },
          { label: 'Qty', align: 'center' },
          { label: 'Rate', align: 'right' },
          { label: 'Total', align: 'right' },
        ],
        itemRows,
        ['', '', '', '', 'Total:', docTemplate.formatCurrency(parseFloat(String(order.total_amount || '0')), poCurrencySymbol)],
      ),
      docTemplate.buildSummary([
        { label: 'Total Amount', value: docTemplate.formatCurrency(parseFloat(String(order.total_amount || '0')), poCurrencySymbol), isTotal: true },
      ]),
      docTemplate.buildNotes(order.notes),
      signaturesHTML,
    ].join('\n');

    const html = docTemplate.buildDocument({
      title: `Purchase Order - ${order.po_number}`,
      docType: 'Purchase Order',
      docNumber: order.po_number,
      status: order.status,
      date: order.order_date,
      bodyHTML,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });

    const pw = docTemplate.openPrintWindow(html);
    if (pw) { toast.success('PDF generated'); }
    else { toast.error('Please allow popups'); }
  };

  const viewOrder = async (order: PurchaseOrder) => {
    setSelectedOrder(order);
    cancelEditItems();
    setShowDetailsModal(true);
    try {
      const res = await authFetch(`/api/procurement/purchase-orders/${order.id}`);
      if (res.ok) setSelectedOrder(await res.json());
    } catch (error) {
      console.error('Error loading PO details:', error);
    }
  };

  // Only a draft may be edited: once it has been submitted for check the
  // figures are what someone signed against, so later stages are read-only.
  const canEditItems = (order: PurchaseOrder | null) => order?.status === 'draft';

  const beginEditItems = () => {
    if (!selectedOrder) return;
    setItemDrafts((selectedOrder.items || []).map(i => ({ ...i })));
    setRemovedItemIds([]);
    setEditingItems(true);
  };

  const cancelEditItems = () => {
    setEditingItems(false);
    setItemDrafts([]);
    setRemovedItemIds([]);
  };

  const updateItemDraft = (id: string | number, field: 'quantity' | 'unit_price' | 'description', value: string) => {
    setItemDrafts(prev => prev.map(i => {
      if ((i.id ?? '') !== id) return i;
      if (field === 'description') return { ...i, description: value };
      // Keep the raw string in state while typing so a half-typed "3." is not
      // clobbered; it is coerced once, on save.
      return { ...i, [field]: value } as PurchaseOrderItem;
    }));
  };

  const markItemRemoved = (id: string | number) => {
    setRemovedItemIds(prev => [...prev, id]);
    setItemDrafts(prev => prev.filter(i => (i.id ?? '') !== id));
  };

  const saveItemEdits = async () => {
    if (!selectedOrder || savingItemEdits) return;

    const invalid = itemDrafts.find(i => !(Number(i.quantity) > 0) || !(Number(i.unit_price) >= 0));
    if (invalid) {
      toast.error(`${invalid.item_name}: quantity must be greater than zero and price cannot be negative`);
      return;
    }
    if (itemDrafts.length === 0 && removedItemIds.length > 0) {
      toast.error('A purchase order needs at least one item — add a replacement before removing the last one.');
      return;
    }

    setSavingItemEdits(true);
    try {
      const original = selectedOrder.items || [];
      const changed = itemDrafts.filter(d => {
        const before = original.find(o => (o.id ?? '') === (d.id ?? ''));
        return !before
          || Number(before.quantity) !== Number(d.quantity)
          || Number(before.unit_price) !== Number(d.unit_price)
          || (before.description || '') !== (d.description || '');
      });

      for (const id of removedItemIds) {
        const res = await authFetch(`/api/procurement/purchase-orders/${selectedOrder.id}/items/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to remove an item');
      }
      for (const item of changed) {
        const res = await authFetch(`/api/procurement/purchase-orders/${selectedOrder.id}/items/${item.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            description: item.description || null,
          }),
        });
        if (!res.ok) throw new Error('Failed to update an item');
      }

      const touched = changed.length + removedItemIds.length;
      toast.success(touched === 0 ? 'No changes to save' : `${touched} line${touched === 1 ? '' : 's'} updated`);

      // Re-read the order rather than patching local state: the server
      // recalculates the PO total from its lines on every item change, and that
      // recalculated figure is the one that must be shown.
      const res = await authFetch(`/api/procurement/purchase-orders/${selectedOrder.id}`);
      if (res.ok) setSelectedOrder(await res.json());
      cancelEditItems();
      fetchOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save changes');
    } finally {
      setSavingItemEdits(false);
    }
  };

  const openAddItems = (order: PurchaseOrder) => {
    setSelectedOrder(order);
    setPendingItems([]);
    setShowItemModal(true);
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<ShoppingCart />}
          title="Purchase Orders"
          actions={
            <div className="flex gap-2">
              <Button onClick={fetchOrders} variant="outline" size="icon" disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button onClick={() => setFormData({ supplier_id: '', order_date: new Date().toISOString().split('T')[0], delivery_address: '', requested_delivery_date: '', payment_terms: 'Net30', po_currency: currency.code, notes: '' })}>
                <Plus className="w-4 h-4 mr-2" />New Purchase Order
              </Button>
            </div>
          }
        />
        {loading && <LoadingState message="Loading purchase orders..." />}

        <div className="space-y-6">
          {/* Create PO form (stacked above the list, not side-by-side) */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex justify-between items-center flex-shrink-0">
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
                  <ShoppingCart className="w-4 h-4 text-primary" />
                </div>
                New Purchase Order
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-4 grid grid-cols-2 gap-4">
              {/* Card 1: Order Details */}
              <div className="border rounded-lg p-3 space-y-3 bg-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order Details</p>
                <div>
                  <Label className="text-xs">Supplier *</Label>
                  <Combobox
                    options={suppliers.map(s => ({
                      value: s.id.toString(),
                      label: `${s.name} ${s.supplier_code ? `(${s.supplier_code})` : ''}`.trim(),
                    }))}
                    value={formData.supplier_id}
                    onChange={v => setFormData({...formData, supplier_id: v})}
                    placeholder="Select a supplier..."
                    searchPlaceholder="Search..."
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Order Date *</Label>
                    <Input type="date" className="mt-1" value={formData.order_date} onChange={e => setFormData({...formData, order_date: e.target.value})} required />
                  </div>
                  <div>
                    <Label className="text-xs">Delivery Date</Label>
                    <Input type="date" className="mt-1" value={formData.requested_delivery_date} onChange={e => setFormData({...formData, requested_delivery_date: e.target.value})} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Payment Terms</Label>
                    <Combobox
                      options={[
                        { value: 'Net30', label: 'Net 30' },
                        { value: 'Net60', label: 'Net 60' },
                        { value: 'Net90', label: 'Net 90' },
                        { value: 'COD', label: 'Cash on Delivery' },
                        { value: 'Prepaid', label: 'Prepaid' },
                      ]}
                      value={formData.payment_terms}
                      onChange={v => setFormData({...formData, payment_terms: v})}
                      searchPlaceholder="Search..."
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Currency</Label>
                    <Combobox
                      options={
                        availableCurrencies.length > 0
                          ? availableCurrencies.map(c => ({
                              value: c.code,
                              label: `${c.code} — ${c.name} ${c.is_base_currency ? '(Base)' : ''}`.trim(),
                            }))
                          : (currency.code ? [{ value: currency.code, label: currency.code }] : [])
                      }
                      value={formData.po_currency}
                      onChange={v => setFormData({...formData, po_currency: v})}
                      placeholder="Select currency..."
                      searchPlaceholder="Search..."
                      className="mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Delivery Address</Label>
                  <Input className="mt-1" value={formData.delivery_address} onChange={e => setFormData({...formData, delivery_address: e.target.value})} placeholder="e.g., Main Warehouse" />
                </div>
              </div>

              {/* Card 2: Notes & Attachment */}
              <div className="border rounded-lg p-3 space-y-3 flex flex-col bg-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes &amp; Attachment</p>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Textarea className="mt-1 text-sm" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Order details..." rows={2} />
                </div>
                <AttachmentField files={newPOFiles} onChange={setNewPOFiles} label="Quotation (optional)" />
              </div>

              <div className="col-span-2 flex justify-end">
                <Button type="submit" size="sm" className="px-6" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {saving ? 'Creating...' : 'Create Purchase Order'}
                </Button>
              </div>
            </form>
          </div>

          {/* RIGHT: List and Filters */}
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search POs, suppliers..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
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
              { value: 'check', label: 'Under Check' },
              { value: 'approved', label: 'Approved' },
              { value: 'authorized', label: 'Authorized' },
              { value: 'received', label: 'Received' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            searchPlaceholder="Search..."
            className="w-[160px]"
          />
          <Button type="button" variant="outline" onClick={exportFilteredOrders} className="gap-1.5">
            <FileSpreadsheet className="w-4 h-4" /> Export CSV
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-4">
            <AdvancedDataTable<PurchaseOrder>
              data={filteredOrders}
              keyExtractor={(order) => order.id}
              emptyMessage="No purchase orders found"
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                {
                  key: 'po_number', header: 'PO Number', sortable: true,
                  render: (v, order) => (
                    <>
                      <p className="text-sm font-mono font-medium">{v}</p>
                      {order.pr_number && <p className="text-xs text-muted-foreground">From {order.pr_number}</p>}
                    </>
                  ),
                },
                { key: 'supplier_name', header: 'Supplier', sortable: true, render: (v, order) => <span className="text-sm">{v || getSupplierName(order.supplier_id)}</span> },
                { key: 'order_date', header: 'Order Date', sortable: true, render: (v) => <span className="text-sm">{v ? new Date(v).toLocaleDateString() : '—'}</span> },
                { key: '__items', header: 'Items', align: 'center', render: (_v, order) => <span className="text-sm">{(order as any).item_count ?? order.items?.length ?? 0}</span> },
                { key: 'total_amount', header: 'Amount', align: 'right', sortable: true, render: (v, order) => <span className="font-mono text-sm">{fmtAs(v, order.po_currency)}</span> },
                {
                  key: 'status', header: 'Status', align: 'center', sortable: true,
                  render: (v) => <Badge className={`text-xs ${getStatusColor(v)}`}>{v}</Badge>,
                },
                {
                  key: '__actions', header: 'Actions', align: 'center',
                  render: (_v, order) => (
                    <div className="flex items-center justify-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => viewOrder(order)}><Eye className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => downloadPOReport(order)}><Download className="w-3.5 h-3.5 text-green-600" /></Button>
                      {order.status === 'draft' && (
                        <Button size="sm" variant="ghost" onClick={() => openAddItems(order)}><Plus className="w-3.5 h-3.5 text-primary" /></Button>
                      )}
                      {order.status === 'draft' && (
                        <Button size="sm" variant="ghost" onClick={() => { setDeletingOrder(order); setDeleteReason(''); }}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      )}
                      {getNextStatus(order.status) && (
                        <Button size="sm" variant="ghost" onClick={() => updateOrderStatus(order.id, getNextStatus(order.status)!)} disabled={processingId === order.id}>
                          {processingId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : React.createElement(getStatusIcon(order.status), { className: 'w-3.5 h-3.5 text-emerald-600' })}
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      </div>

        {/* Add Items Dialog */}
        <Dialog open={showItemModal} onOpenChange={setShowItemModal}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Items to {selectedOrder?.po_number}</DialogTitle>
              <DialogDescription>Add inventory items, expenses, or assets to this purchase order.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-6 pb-6 pt-2">
              {/* Form */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Add New Item</h3>
                <form onSubmit={addToPendingItems} className="space-y-3">
                  <div>
                    <Label>Type *</Label>
                    <Combobox
                      options={[
                        { value: 'inventory', label: 'Inventory' },
                        { value: 'expense', label: 'Expense' },
                        { value: 'asset', label: 'Asset' },
                      ]}
                      value={itemFormData.type}
                      onChange={v => setItemFormData({...itemFormData, type: v as any, item_name: '', unit_price: '', description: '', is_new_item: false})}
                      searchPlaceholder="Search..."
                    />
                  </div>
                  {itemFormData.type === 'inventory' && (
                    <div className="flex items-center space-x-2">
                      <Checkbox id="new-item" checked={itemFormData.is_new_item} onCheckedChange={c => setItemFormData({...itemFormData, is_new_item: !!c, item_name: '', unit_price: '', description: ''})} />
                      <Label htmlFor="new-item" className="text-sm">New item (not in inventory)</Label>
                    </div>
                  )}
                  <div>
                    <Label>Item Name *</Label>
                    {itemFormData.type === 'inventory' && !itemFormData.is_new_item ? (
                      <Combobox
                        options={inventory.map(item => ({
                          value: item.item_name,
                          label: `${item.item_name}${item.item_code ? ` (${item.item_code})` : ''}`,
                        }))}
                        value={itemFormData.item_name}
                        onChange={handleInventorySelection}
                        placeholder="Select from inventory"
                        searchPlaceholder="Search..."
                      />
                    ) : (
                      <Input value={itemFormData.item_name} onChange={e => setItemFormData({...itemFormData, item_name: e.target.value})} required placeholder="Item name..." />
                    )}
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={itemFormData.description} onChange={e => setItemFormData({...itemFormData, description: e.target.value})} rows={2} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Quantity *</Label>
                      <Input type="number" min="1" value={itemFormData.quantity} onChange={e => setItemFormData({...itemFormData, quantity: e.target.value})} required />
                    </div>
                    <div>
                      <Label>Unit Cost *</Label>
                      <Input type="number" step="0.01" min="0" value={itemFormData.unit_price} onChange={e => setItemFormData({...itemFormData, unit_price: e.target.value})} required />
                    </div>
                    <div>
                      <Label>UOM</Label>
                      <Combobox
                        options={['Each','Box','Pack','Bottle','Kg','Liter','Piece','Set','Tablet','Capsule','Vial','Tube','Strip','Sachet'].map(u => ({ value: u, label: u }))}
                        value={itemFormData.unit_of_measure}
                        onChange={v => setItemFormData({...itemFormData, unit_of_measure: v})}
                        searchPlaceholder="Search..."
                      />
                    </div>
                  </div>
                  {itemFormData.quantity && itemFormData.unit_price && (
                    <div className="p-3 bg-muted/50 rounded-lg text-sm">
                      Total: <span className="font-mono font-semibold">{fmtAs(parseFloat(itemFormData.quantity || '0') * parseFloat(itemFormData.unit_price || '0'), selectedOrder?.po_currency)}</span>
                    </div>
                  )}
                  <Button type="submit" className="w-full" size="sm"><Plus className="w-4 h-4 mr-1" /> Add to List</Button>
                </form>
              </div>
              {/* Items list */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Items ({pendingItems.length})</h3>
                  {pendingItems.length > 0 && (
                    <span className="text-xs text-muted-foreground font-mono">
                      Total: {fmtAs(pendingItems.reduce((s: number, i: any) => s + i.total_price, 0), selectedOrder?.po_currency)}
                    </span>
                  )}
                </div>
                {pendingItems.length > 0 ? (
                  <AdvancedDataTable<any>
                    data={pendingItems}
                    keyExtractor={(item) => item.id}
                    columns={[
                      {
                        key: 'item_name', header: 'Item',
                        render: (v, item) => (
                          <>
                            <p className="font-medium text-xs">{v}</p>
                            <Badge variant="outline" className="text-xs capitalize">{item.type}</Badge>
                          </>
                        ),
                      },
                      { key: 'quantity', header: 'Qty', align: 'right', render: (v, item) => <span className="text-xs">{v} {item.unit_of_measure}</span> },
                      { key: 'unit_price', header: 'Price', align: 'right', render: (v) => <span className="font-mono text-xs">{fmtAs(v, selectedOrder?.po_currency)}</span> },
                      { key: 'total_price', header: 'Total', align: 'right', render: (v) => <span className="font-mono text-xs font-semibold">{fmtAs(v, selectedOrder?.po_currency)}</span> },
                      {
                        key: '__remove', header: '', width: '2rem',
                        render: (_v, item) => <Button size="sm" variant="ghost" onClick={() => removePendingItem(item.id)}><Trash2 className="w-3 h-3 text-red-400" /></Button>,
                      },
                    ]}
                  />
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">No items added yet</div>
                )}
              </div>
            </div>
            <div className="flex gap-3 pt-4 border-t px-6 pb-6">
              <Button size="sm" type="button" variant="outline" className="h-8 px-4 text-xs ml-auto" onClick={() => { setShowItemModal(false); setPendingItems([]); }}>Cancel</Button>
              <Button size="sm" onClick={saveAllItems} disabled={pendingItems.length === 0 || savingItems} className="h-8 px-4 text-xs">
                {savingItems ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : null}
                {savingItems ? 'Saving...' : `Save All Items (${pendingItems.length})`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* PO Details Dialog */}
        <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Purchase Order Details</DialogTitle>
              <DialogDescription>View order information, items, and take actions.</DialogDescription>
            </DialogHeader>
            {selectedOrder && (
              <div className="space-y-4 px-6 pb-6 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold font-mono">{selectedOrder.po_number}</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedOrder.order_date ? new Date(selectedOrder.order_date).toLocaleDateString() : '—'}
                      {selectedOrder.pr_number && <span className="ml-2">• From {selectedOrder.pr_number}</span>}
                    </p>
                  </div>
                  <Badge className={`${getStatusColor(selectedOrder.status)} text-sm`}>{selectedOrder.status}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Supplier:</span> <span className="font-medium">{selectedOrder.supplier_name || getSupplierName(selectedOrder.supplier_id)}</span></div>
                  <div><span className="text-muted-foreground">Payment Terms:</span> <span className="font-medium">{selectedOrder.payment_terms || '—'}</span></div>
                  <div><span className="text-muted-foreground">Currency:</span> <span className="font-medium">{selectedOrder.po_currency || currency.code}</span></div>
                  <div><span className="text-muted-foreground">Delivery Date:</span> <span className="font-medium">{selectedOrder.requested_delivery_date ? new Date(selectedOrder.requested_delivery_date).toLocaleDateString() : '—'}</span></div>
                  {selectedOrder.delivery_address && <div className="col-span-2"><span className="text-muted-foreground">Delivery Address:</span> <span className="font-medium">{selectedOrder.delivery_address}</span></div>}
                </div>

                {selectedOrder.notes && (
                  <div className="p-3 rounded-lg bg-muted/50 text-sm">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                    {selectedOrder.notes}
                  </div>
                )}

                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Items</p>
                    {canEditItems(selectedOrder) && !editingItems && (selectedOrder.items || []).length > 0 && (
                      <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={beginEditItems}>
                        <FileText className="w-3 h-3 mr-1.5" /> Edit Items
                      </Button>
                    )}
                    {editingItems && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={cancelEditItems} disabled={savingItemEdits}>
                          <X className="w-3 h-3 mr-1.5" /> Cancel
                        </Button>
                        <Button size="sm" className="h-7 px-3 text-xs" onClick={saveItemEdits} disabled={savingItemEdits}>
                          {savingItemEdits ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Check className="w-3 h-3 mr-1.5" />}
                          {savingItemEdits ? 'Saving...' : 'Save Changes'}
                        </Button>
                      </div>
                    )}
                  </div>

                  {editingItems ? (
                    <div className="overflow-x-auto rounded-md border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-xs text-muted-foreground">
                          <tr>
                            <th className="px-2 py-2 text-left font-medium w-8">#</th>
                            <th className="px-2 py-2 text-left font-medium">Item</th>
                            <th className="px-2 py-2 text-left font-medium">Description</th>
                            <th className="px-2 py-2 text-right font-medium w-24">Qty</th>
                            <th className="px-2 py-2 text-left font-medium w-20">UOM</th>
                            <th className="px-2 py-2 text-right font-medium w-32">Unit Price</th>
                            <th className="px-2 py-2 text-right font-medium w-32">Total</th>
                            <th className="px-2 py-2 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {itemDrafts.map((item, idx) => (
                            <tr key={item.id ?? idx} className="border-t border-border">
                              <td className="px-2 py-1.5 text-xs text-muted-foreground">{idx + 1}</td>
                              <td className="px-2 py-1.5 text-xs font-medium">{item.item_name}</td>
                              <td className="px-2 py-1.5">
                                <Input
                                  className="h-8 text-xs"
                                  value={item.description || ''}
                                  placeholder="—"
                                  onChange={e => updateItemDraft(item.id ?? idx, 'description', e.target.value)}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number" min="1" step="1"
                                  className="h-8 text-xs text-right"
                                  value={String(item.quantity ?? '')}
                                  onChange={e => updateItemDraft(item.id ?? idx, 'quantity', e.target.value)}
                                />
                              </td>
                              <td className="px-2 py-1.5 text-xs text-muted-foreground">{item.unit_of_measure || 'Each'}</td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number" min="0" step="0.01"
                                  className="h-8 text-xs text-right"
                                  value={String(item.unit_price ?? '')}
                                  onChange={e => updateItemDraft(item.id ?? idx, 'unit_price', e.target.value)}
                                />
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono text-xs">
                                {fmtAs(Number(item.quantity) * Number(item.unit_price) || 0, selectedOrder.po_currency)}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <button
                                  type="button"
                                  title="Remove this line"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => markItemRemoved(item.id ?? idx)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {itemDrafts.length === 0 && (
                            <tr><td colSpan={8} className="px-2 py-6 text-center text-xs text-muted-foreground">
                              Every line removed — add an item before saving.
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <AdvancedDataTable<PurchaseOrderItem>
                      data={selectedOrder.items || []}
                      keyExtractor={(item, idx) => item.id ?? idx}
                      emptyMessage="No items"
                      columns={[
                        { key: '__idx', header: '#', render: (_v, _item, idx) => <span className="text-xs text-muted-foreground">{idx + 1}</span> },
                        { key: 'item_name', header: 'Item', render: (v) => <span className="text-xs font-medium">{v}</span> },
                        { key: 'description', header: 'Description', render: (v) => <span className="text-muted-foreground text-xs">{v || '—'}</span> },
                        { key: 'quantity', header: 'Qty', align: 'right' },
                        { key: 'unit_of_measure', header: 'UOM', render: (v) => v || 'Each' },
                        { key: 'unit_price', header: 'Unit Price', align: 'right', render: (v) => <span className="font-mono">{fmtAs(v, selectedOrder.po_currency)}</span> },
                        // Derived, like the footer below, so a stale stored
                        // total_price cannot disagree with the qty x price on
                        // the same row.
                        { key: 'total_price', header: 'Total', align: 'right', render: (_v, item) => <span className="font-mono">{fmtAs(Number(item.quantity) * Number(item.unit_price) || 0, selectedOrder.po_currency)}</span> },
                      ]}
                    />
                  )}

                  {/* Derived from the lines on screen rather than the stored
                      header total, which is written by a separate code path and
                      was showing 0.00 against lines that clearly summed to more.
                      A footer that disagrees with the rows above it is worse
                      than useless on a financial document. */}
                  {(editingItems ? itemDrafts : (selectedOrder.items || [])).length > 0 && (
                    <div className="border border-t-0 border-border rounded-b-md bg-muted/20 -mt-px px-3 py-2 flex justify-between text-sm font-semibold">
                      <span>Total ({selectedOrder.po_currency || currency.code}):</span>
                      <span className="font-mono">
                        {fmtAs(
                          (editingItems ? itemDrafts : (selectedOrder.items || []))
                            .reduce((sum, it) => sum + (Number(it.quantity) * Number(it.unit_price) || 0), 0),
                          selectedOrder.po_currency,
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* Attachments — quotations uploaded at creation, viewable here by anyone
                    who can see the PO (including approvers during check/approve/authorize) */}
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Attachments</p>
                  <AttachmentList entityType="purchase-order" entityId={selectedOrder.id} emptyText="No quotation attached" />
                </div>

                {/* Signature Status */}
                {(selectedOrder.check_signed_by || selectedOrder.approved_signed_by || selectedOrder.authorized_signed_by) && (
                  <div className="p-3 rounded-lg bg-muted/30 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Approval Trail</p>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {selectedOrder.check_signed_by && (
                        <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                          <p className="font-medium text-amber-700 dark:text-amber-300">Checked</p>
                          <p>{selectedOrder.check_signed_by}</p>
                          {selectedOrder.check_signed_at && <p className="text-muted-foreground">{new Date(selectedOrder.check_signed_at).toLocaleDateString()}</p>}
                        </div>
                      )}
                      {selectedOrder.approved_signed_by && (
                        <div className="p-2 rounded bg-primary/10 dark:bg-primary/20 border border-primary/30 dark:border-primary/40">
                          <p className="font-medium text-primary dark:text-primary/50">Approved</p>
                          <p>{selectedOrder.approved_signed_by}</p>
                          {selectedOrder.approved_signed_at && <p className="text-muted-foreground">{new Date(selectedOrder.approved_signed_at).toLocaleDateString()}</p>}
                        </div>
                      )}
                      {selectedOrder.authorized_signed_by && (
                        <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                          <p className="font-medium text-emerald-700 dark:text-emerald-300">Authorized</p>
                          <p>{selectedOrder.authorized_signed_by}</p>
                          {selectedOrder.authorized_signed_at && <p className="text-muted-foreground">{new Date(selectedOrder.authorized_signed_at).toLocaleDateString()}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="outline" size="sm" className="h-8 px-4 text-xs" onClick={() => downloadPOReport(selectedOrder)}>
                    <Download className="w-3 h-3 mr-2" /> Download PDF
                  </Button>
                  {selectedOrder.status === 'draft' && (
                    <Button variant="outline" size="sm" className="h-8 px-4 text-xs" onClick={() => { setShowDetailsModal(false); openAddItems(selectedOrder); }}>
                      <Plus className="w-3 h-3 mr-2" /> Add Items
                    </Button>
                  )}
                  {selectedOrder.status === 'draft' && (
                    <Button
                      variant="outline" size="sm"
                      className="h-8 px-4 text-xs text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => { setDeletingOrder(selectedOrder); setDeleteReason(''); }}
                    >
                      <Trash2 className="w-3 h-3 mr-2" /> Delete
                    </Button>
                  )}
                  {getNextStatus(selectedOrder.status) && (
                    <Button size="sm" className="ml-auto h-8 px-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => updateOrderStatus(selectedOrder.id, getNextStatus(selectedOrder.status)!)} disabled={processingId === selectedOrder.id}>
                      {processingId === selectedOrder.id ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : React.createElement(getStatusIcon(selectedOrder.status), { className: 'w-3 h-3 mr-2' })}
                      {processingId === selectedOrder.id ? 'Processing...' : getStatusAction(selectedOrder.status)}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8 px-4 text-xs" onClick={() => setShowDetailsModal(false)}>Close</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete draft PO confirmation — requires a stated reason */}
        <Dialog open={!!deletingOrder} onOpenChange={(open) => { if (!open) { setDeletingOrder(null); setDeleteReason(''); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete {deletingOrder?.po_number}?</DialogTitle>
              <DialogDescription>
                This permanently deletes this draft purchase order and its items. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6 pt-2 space-y-3">
              <div>
                <Label htmlFor="delete-po-reason">Reason for deletion *</Label>
                <Textarea
                  id="delete-po-reason"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="e.g. duplicate PO, wrong supplier, no longer needed"
                  rows={3}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => { setDeletingOrder(null); setDeleteReason(''); }} disabled={deletingInProgress}>
                  Cancel
                </Button>
                <Button
                  size="sm" variant="destructive"
                  onClick={handleDeleteOrder}
                  disabled={deletingInProgress || !deleteReason.trim()}
                >
                  {deletingInProgress ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-2" />}
                  {deletingInProgress ? 'Deleting...' : 'Delete Purchase Order'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default PurchaseOrders;
