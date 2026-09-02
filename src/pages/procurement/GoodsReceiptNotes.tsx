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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { getStatusColor } from '@/lib/statusColors';
import { useCurrency } from '@/contexts/CurrencyContext';
import { AttachmentField } from '@/components/procurement/AttachmentField';
import { AttachmentList } from '@/components/procurement/AttachmentList';
import { uploadProcurementAttachments } from '@/api/procurementAttachments';
import * as docTemplate from '@/utils/documentTemplate';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { exportCSV } from '@/utils/reportUtils';
import { toast } from 'sonner';
import {
  Package, Plus, Eye, Search, RefreshCw, CheckCircle, XCircle,
  ClipboardCheck, Truck, AlertTriangle, FileText, Loader2, Download, FileSpreadsheet
} from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface GRNLine {
  id?: string;
  po_line_item_id?: number;
  item_code: string;
  item_description: string;
  quantity_expected: number;
  quantity_received: number;
  unit_of_measure: string;
  item_condition: string;
  batch_number: string;
  expiry_date: string;
  serial_number: string;
  inspection_status: string;
  inspection_notes: string;
}

interface GRN {
  id: string;
  grn_number: string;
  po_id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  receipt_date: string;
  received_by: string;
  received_by_name: string;
  received_location: string;
  received_condition: string;
  total_items_received: number;
  notes: string;
  invoice_number?: string;
  status: string;
  inspected_by: string;
  inspected_by_name: string;
  inspection_date: string;
  inspection_notes: string;
  line_count: number;
  lines?: GRNLine[];
}

interface PO {
  id: number;
  po_number: string;
  supplier_name: string;
  supplier_id: number;
  total_amount: number;
  po_currency?: string;
  status: string;
  delivery_address?: string;
  items?: any[];
}

interface StoreLocation {
  id: string | number;
  location_name: string;
  location_type?: string;
  item_count?: number;
}


const GoodsReceiptNotes: React.FC = () => {
  const { user } = useAuth();
  const [grns, setGrns] = useState<GRN[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedGRN, setSelectedGRN] = useState<GRN | null>(null);

  // Create GRN form
  const [availablePOs, setAvailablePOs] = useState<PO[]>([]);
  const [storageLocations, setStorageLocations] = useState<StoreLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [selectedPOId, setSelectedPOId] = useState('');
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [grnFormData, setGrnFormData] = useState({
    received_location: '', received_condition: 'good', notes: '', invoice_number: ''
  });
  const [newGRNFiles, setNewGRNFiles] = useState<File[]>([]);
  const [grnLines, setGrnLines] = useState<GRNLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState<{ id: string; action: 'inspect' | 'accept' | 'reject' } | null>(null);

  const { fmt, currency } = useCurrency();
  const { facilityInfo } = useFacilityInfo();

  // Format an amount in a PO's own currency (GRNs have no currency of their own —
  // they inherit the linked PO's po_currency). Falls back to the base-currency
  // formatter when the code matches base or is unknown, mirroring PurchaseOrders.tsx's fmtAs.
  const fmtPO = (amount: number | string, code?: string) => {
    const n = parseFloat(String(amount || 0));
    if (!code || code === currency.code) return fmt(n);
    return `${code} ${n.toFixed(2)}`;
  };

  const downloadGRNReport = async (grn: GRN) => {
    const statusLabels: Record<string, string> = {
      pending_inspection: 'PENDING INSPECTION',
      inspected: 'INSPECTED - Pending Acceptance',
      accepted: 'ACCEPTED - Completed',
      rejected: 'REJECTED'
    };

    let fullGRN = grn;
    try {
      const res = await authFetch(`/api/procurement/goods-receipt-notes/${grn.id}`);
      if (res.ok) fullGRN = await res.json();
    } catch (error) {
      console.error('Error loading full GRN:', error);
    }

    const receiptDate = new Date(fullGRN.receipt_date).toLocaleDateString();

    const itemRows: docTemplate.TableRow[] = (fullGRN.lines || []).map((item, i) => ({
      bold: false,
      cells: [
        i + 1,
        item.item_description || item.item_code,
        item.quantity_expected,
        item.quantity_received,
        item.unit_of_measure,
        item.item_condition,
        item.batch_number || '-',
        item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '-'
      ]
    }));

    const receivedBySig = fullGRN.received_by ? await docTemplate.fetchUserSignature(fullGRN.received_by) : null;
    const inspectedBySig = fullGRN.inspected_by ? await docTemplate.fetchUserSignature(fullGRN.inspected_by) : null;

    const signersHtml = docTemplate.buildSignatures([
      { label: 'Received By', name: fullGRN.received_by_name || '—', signature: receivedBySig || undefined },
      { label: 'Inspected / Accepted By', name: fullGRN.inspected_by_name || '—', signature: inspectedBySig || undefined }
    ].filter(s => s.name !== '—'));

    const bodyHTML = [
      docTemplate.buildInfoGrid(
        { title: 'Receipt Details', rows: [
          { label: 'GRN Number', value: fullGRN.grn_number, bold: true },
          { label: 'PO Number', value: fullGRN.po_number || '—' },
          { label: 'Date', value: receiptDate },
          { label: 'Location', value: fullGRN.received_location || '—' },
          { label: 'Status', value: statusLabels[fullGRN.status] || fullGRN.status },
        ]},
        { title: 'Supplier Info', rows: [
          { label: 'Supplier', value: fullGRN.supplier_name || 'Unknown', bold: true },
        ]}
      ),
      `<div class="ic-section-title">Received Items</div>`,
      docTemplate.buildTable(
        [
          { label: '#', align: 'center', width: '40px' },
          { label: 'Description' },
          { label: 'Expected', align: 'center' },
          { label: 'Received', align: 'center' },
          { label: 'UOM' },
          { label: 'Condition' },
          { label: 'Batch' },
          { label: 'Expiry' },
        ],
        itemRows
      ),
      docTemplate.buildNotes([
        fullGRN.notes ? `Notes: ${fullGRN.notes}` : '',
        fullGRN.inspection_notes ? `Inspection Notes: ${fullGRN.inspection_notes}` : ''
      ].filter(Boolean).join(' | ')),
      signersHtml,
    ].join('\n');

    const html = docTemplate.buildDocument({
      title: `Goods Receipt Note - ${fullGRN.grn_number}`,
      docType: 'Goods Receipt Note',
      docNumber: fullGRN.grn_number,
      status: fullGRN.status,
      date: fullGRN.receipt_date,
      bodyHTML,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });

    const pw = docTemplate.openPrintWindow(html);
    if (pw) { toast.success('PDF generated'); }
    else { toast.error('Please allow popups'); }
  };

  const fetchGRNs = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/procurement/goods-receipt-notes?clinic_id=${user?.clinic || ''}`);
      if (res.ok) setGrns(await res.json());
    } catch (error) {
      console.error('Error fetching GRNs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStorageLocations = async () => {
    setLoadingLocations(true);
    try {
      const res = await authFetch(`/api/inventory/locations?clinic_id=${user?.clinic || ''}`);
      if (res.ok) setStorageLocations(await res.json());
    } catch (error) {
      console.error('Error fetching storage locations:', error);
    } finally {
      setLoadingLocations(false);
    }
  };

  const fetchAvailablePOs = async () => {
    try {
      const res = await authFetch(`/api/procurement/purchase-orders?clinic_id=${user?.clinic || ''}`);
      if (res.ok) {
        const all = await res.json();
        setAvailablePOs(all.filter((po: PO) => ['approved', 'authorized'].includes(po.status)));
      }
    } catch (error) {
      console.error('Error fetching POs:', error);
    }
  };

  useEffect(() => { 
    fetchGRNs(); 
    fetchAvailablePOs();
    fetchStorageLocations();
  }, []);

  const filteredGRNs = useMemo(() => {
    return grns.filter(g => {
      if (searchQuery && !g.grn_number?.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !g.po_number?.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !g.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (statusFilter !== 'all' && g.status !== statusFilter) return false;
      if (dateFrom && g.receipt_date && g.receipt_date.split('T')[0] < dateFrom) return false;
      if (dateTo && g.receipt_date && g.receipt_date.split('T')[0] > dateTo) return false;
      return true;
    });
  }, [grns, searchQuery, statusFilter, dateFrom, dateTo]);

  const handleExportCSV = () => {
    if (filteredGRNs.length === 0) { toast.error('No GRNs to export'); return; }
    exportCSV(filteredGRNs, [
      { header: 'GRN Number', key: 'grn_number' },
      { header: 'PO Number', key: 'po_number' },
      { header: 'Supplier', key: 'supplier_name' },
      { header: 'Receipt Date', key: 'receipt_date', transform: (v) => v ? new Date(v).toLocaleDateString() : '' },
      { header: 'Items', key: 'total_items_received' },
      { header: 'Status', key: 'status' },
      { header: 'Invoice Number', key: 'invoice_number', transform: (v) => v || '' },
    ], `goods-receipts${dateFrom ? `-${dateFrom}` : ''}${dateTo ? `_to_${dateTo}` : ''}.csv`);
  };

  const openCreate = async () => {
    await Promise.all([fetchAvailablePOs(), fetchStorageLocations()]);
    setSelectedPOId('');
    setSelectedPO(null);
    setGrnFormData({ received_location: '', received_condition: 'good', notes: '', invoice_number: '' });
    setGrnLines([]);
    setNewGRNFiles([]);
  };

  const selectPO = async (poId: string) => {
    setSelectedPOId(poId);
    try {
      const res = await authFetch(`/api/procurement/purchase-orders/${poId}`);
      if (res.ok) {
        const po = await res.json();
        setSelectedPO(po);
        // Auto-fill received_location from PO delivery_address
        if (po.delivery_address) {
          const matched = storageLocations.find(
            loc => loc.location_name.toLowerCase() === po.delivery_address.toLowerCase()
          );
          setGrnFormData(prev => ({
            ...prev,
            received_location: matched ? matched.location_name : po.delivery_address
          }));
        }
        // Pre-populate lines from PO items
        setGrnLines((po.items || []).map((item: any) => ({
          po_line_item_id: item.id,
          item_code: '',
          item_description: item.item_name || '',
          quantity_expected: item.quantity || 0,
          quantity_received: item.quantity - (item.quantity_received || 0),
          unit_of_measure: item.unit_of_measure || 'Each',
          item_condition: 'good',
          batch_number: '',
          expiry_date: '',
          serial_number: '',
          inspection_status: 'pass',
          inspection_notes: ''
        })));
      }
    } catch (error) {
      toast.error('Failed to load PO details');
    }
  };

  const updateGRNLine = (idx: number, field: string, value: any) => {
    const updated = [...grnLines];
    (updated[idx] as any)[field] = value;
    setGrnLines(updated);
  };

  const handleCreateGRN = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!selectedPOId) { toast.error('Select a purchase order'); return; }
    const validLines = grnLines.filter(l => l.quantity_received > 0);
    if (validLines.length === 0) { toast.error('Enter received quantities'); return; }

    setSaving(true);
    try {
      const res = await authFetch('/api/procurement/goods-receipt-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_id: user?.clinic, po_id: parseInt(selectedPOId),
          received_by: user?.uid, ...grnFormData, lines: validLines
        })
      });
      if (!res.ok) throw new Error('Failed');
      const newGRN = await res.json();
      toast.success('GRN created successfully');

      // Attachments are optional and best-effort — a failed upload never undoes the
      // already-successful GRN creation, it just surfaces a separate warning toast.
      if (newGRNFiles.length > 0) {
        try {
          await uploadProcurementAttachments('goods-receipt-note', newGRN.id, newGRNFiles);
          toast.success(`${newGRNFiles.length} attachment${newGRNFiles.length === 1 ? '' : 's'} uploaded`);
        } catch {
          toast.error('GRN created, but attachments failed to upload');
        }
      }

      fetchGRNs();
      openCreate();
    } catch (error) {
      toast.error('Failed to create GRN');
    } finally {
      setSaving(false);
    }
  };

  const viewGRN = async (grn: GRN) => {
    try {
      const res = await authFetch(`/api/procurement/goods-receipt-notes/${grn.id}`);
      if (res.ok) {
        setSelectedGRN(await res.json());
        setShowDetailsModal(true);
      }
    } catch (error) {
      toast.error('Failed to load GRN details');
    }
  };

  const acceptGRN = async (id: string) => {
    if (processing?.id === id) return;
    setProcessing({ id, action: 'accept' });
    try {
      const res = await authFetch(`/api/procurement/goods-receipt-notes/${id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('GRN accepted');
      fetchGRNs();
      setShowDetailsModal(false);
    } catch (error) {
      toast.error('Failed to accept GRN');
    } finally {
      setProcessing(null);
    }
  };

  const rejectGRN = async (id: string) => {
    if (processing?.id === id) return;
    const notes = prompt('Reason for rejection:');
    if (!notes) return;
    setProcessing({ id, action: 'reject' });
    try {
      const res = await authFetch(`/api/procurement/goods-receipt-notes/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspection_notes: notes })
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('GRN rejected');
      fetchGRNs();
      setShowDetailsModal(false);
    } catch (error) {
      toast.error('Failed to reject GRN');
    } finally {
      setProcessing(null);
    }
  };

  const inspectGRN = async (id: string) => {
    if (processing?.id === id) return;
    const notes = prompt('Inspection notes (optional):') || '';
    setProcessing({ id, action: 'inspect' });
    try {
      const res = await authFetch(`/api/procurement/goods-receipt-notes/${id}/inspect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspected_by: user?.uid, inspection_notes: notes, status: 'inspected' })
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('GRN inspection recorded');
      fetchGRNs();
      setShowDetailsModal(false);
    } catch (error) {
      toast.error('Failed to inspect GRN');
    } finally {
      setProcessing(null);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<Package />}
          title="Goods Receipt Notes"
          actions={
            <div className="flex gap-2">
              <Button onClick={fetchGRNs} variant="outline" size="icon" disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-2" />Receive Goods
              </Button>
            </div>
          }
        />


        {/* Main Content Layout (stacked: form above the list, not side-by-side) */}
        <div className="space-y-6">

          {/* Create GRN Form */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex justify-between items-center flex-shrink-0">
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
                  <Truck className="w-4 h-4 text-primary" />
                </div>
                Receive Goods
              </h3>
              {selectedPOId && (
                <Button variant="ghost" size="sm" onClick={openCreate}>
                  <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancel
                </Button>
              )}
            </div>

            <form onSubmit={handleCreateGRN} className="flex-1 overflow-auto">
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* Card 1: Receipt Details */}
                  <div className="border rounded-lg p-3 space-y-3 bg-card">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Receipt Details</p>
                    <div>
                      <Label className="text-xs">Select Purchase Order *</Label>
                      <div className="flex gap-2">
                        <Combobox
                          options={availablePOs.map(po => ({
                            value: String(po.id),
                            label: `${po.po_number} — ${po.supplier_name} (${fmtPO(po.total_amount, po.po_currency)})`,
                          }))}
                          value={selectedPOId}
                          onChange={selectPO}
                          placeholder="Select a PO..."
                          searchPlaceholder="Search..."
                          className="flex-1"
                        />
                        <Button type="button" variant="outline" size="icon" onClick={fetchAvailablePOs} disabled={loadingLocations}>
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Received Location</Label>
                        <Combobox
                          options={storageLocations.map(loc => ({
                            value: loc.location_name,
                            label: `${loc.location_name}${loc.item_count ? ` (${loc.item_count} items)` : ''}`,
                          }))}
                          value={grnFormData.received_location}
                          onChange={v => setGrnFormData({...grnFormData, received_location: v})}
                          placeholder={loadingLocations ? 'Loading locations…' : 'Select storage location…'}
                          searchPlaceholder="Search..."
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Overall Condition</Label>
                        <Combobox
                          options={[
                            { value: 'good', label: 'Good' },
                            { value: 'damaged', label: 'Damaged' },
                            { value: 'partial', label: 'Partial' },
                          ]}
                          value={grnFormData.received_condition}
                          onChange={v => setGrnFormData({...grnFormData, received_condition: v})}
                          searchPlaceholder="Search..."
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Invoice Number</Label>
                      <Input className="text-xs" value={grnFormData.invoice_number} onChange={e => setGrnFormData({...grnFormData, invoice_number: e.target.value})} placeholder="Optional — supplier's invoice reference" />
                    </div>
                  </div>

                  {/* Card 2: Notes & Attachment */}
                  <div className="border rounded-lg p-3 space-y-3 bg-card">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes &amp; Attachment</p>
                    <div>
                      <Label className="text-xs">Notes</Label>
                      <Textarea className="text-xs min-h-[60px]" value={grnFormData.notes} onChange={e => setGrnFormData({...grnFormData, notes: e.target.value})} rows={2} placeholder="Optional notes..." />
                    </div>
                    <AttachmentField files={newGRNFiles} onChange={setNewGRNFiles} label="Invoice attachment (optional)" />
                  </div>
                </div>

                {/* Line Items from PO */}
                {grnLines.length > 0 && (
                  <div className="border-t pt-4">
                    <Label className="text-xs font-semibold mb-2 block text-muted-foreground uppercase tracking-wider">Items to Receive</Label>
                    <div className="space-y-3">
                      {grnLines.map((line, idx) => (
                        <div key={idx} className="border rounded-lg p-3 space-y-2 bg-muted/20">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-semibold flex-1 leading-tight">{line.item_description}</span>
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded flex-none">Exp: {line.quantity_expected} {line.unit_of_measure}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px] text-muted-foreground mb-1 block">Rcvd Qty</Label>
                              <Input className="h-8 text-xs font-mono" type="number" min={0}
                                max={line.quantity_expected}
                                value={line.quantity_received}
                                onChange={e => updateGRNLine(idx, 'quantity_received', parseInt(e.target.value) || 0)} />
                            </div>
                            <div>
                              <Label className="text-[10px] text-muted-foreground mb-1 block">Condition</Label>
                              <Combobox
                                options={[
                                  { value: 'good', label: 'Good' },
                                  { value: 'damaged', label: 'Damaged' },
                                  { value: 'expired', label: 'Expired' },
                                ]}
                                value={line.item_condition}
                                onChange={v => updateGRNLine(idx, 'item_condition', v)}
                                searchPlaceholder="Search..."
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px] text-muted-foreground mb-1 block">Batch #</Label>
                              <Input className="h-8 text-xs font-mono placeholder:text-muted-foreground/50" placeholder="Optional" value={line.batch_number}
                                onChange={e => updateGRNLine(idx, 'batch_number', e.target.value)} />
                            </div>
                            <div>
                              <Label className="text-[10px] text-muted-foreground mb-1 block">Expiry Date</Label>
                              <Input className="h-8 text-xs" type="date" value={line.expiry_date}
                                onChange={e => updateGRNLine(idx, 'expiry_date', e.target.value)} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border-t bg-muted flex justify-end gap-2 sticky bottom-0">
                <Button type="button" size="sm" variant="outline" onClick={openCreate}>Reset</Button>
                <Button type="submit" size="sm" className="px-6" disabled={!selectedPOId || saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                  {saving ? 'Creating...' : 'Create GRN'}
                </Button>
              </div>
            </form>
          </div>

          {/* RIGHT: Table */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex flex-wrap items-end gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search GRNs..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
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
                  { value: 'pending_inspection', label: 'Pending' },
                  { value: 'inspected', label: 'Inspected' },
                  { value: 'accepted', label: 'Accepted' },
                  { value: 'rejected', label: 'Rejected' },
                  { value: 'partial', label: 'Partial' },
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
                searchPlaceholder="Search..."
                className="w-[150px]"
              />
              <Button type="button" variant="outline" onClick={handleExportCSV} className="gap-1.5">
                <FileSpreadsheet className="w-4 h-4" /> Export CSV
              </Button>
            </div>

            <div className="p-4">
              <AdvancedDataTable<GRN>
                data={filteredGRNs}
                keyExtractor={(grn) => grn.id}
                emptyMessage="No goods receipt notes found"
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  { key: 'grn_number', header: 'GRN Number', sortable: true, render: (v) => <span className="font-mono text-xs font-medium">{v}</span> },
                  { key: 'po_number', header: 'PO Number', render: (v) => <span className="font-mono text-xs text-muted-foreground">{v || '—'}</span> },
                  { key: 'supplier_name', header: 'Supplier', sortable: true, render: (v) => <span className="text-xs">{v || '—'}</span> },
                  { key: 'receipt_date', header: 'Date', sortable: true, render: (v) => <span className="text-xs">{v ? new Date(v).toLocaleDateString() : '—'}</span> },
                  { key: '__items', header: 'Items', align: 'center', render: (_v, grn) => <span className="text-xs">{grn.total_items_received || grn.line_count || 0}</span> },
                  {
                    key: 'status', header: 'Status', align: 'center', sortable: true,
                    render: (v) => <Badge className={`text-[10px] ${getStatusColor(v)}`}>{v?.replace('_', ' ')}</Badge>,
                  },
                  {
                    key: '__actions', header: 'Actions', align: 'center',
                    render: (_v, grn) => (
                      <div className="flex items-center justify-center gap-1">
                        <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => downloadGRNReport(grn)}><Download className="w-3.5 h-3.5 text-emerald-600" /></Button>
                        <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => viewGRN(grn)}><Eye className="w-3.5 h-3.5" /></Button>
                        {grn.status === 'pending_inspection' && (
                          <>
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => inspectGRN(grn.id)} disabled={processing?.id === grn.id}>
                              {processing?.id === grn.id && processing.action === 'inspect' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5 text-primary" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => acceptGRN(grn.id)} disabled={processing?.id === grn.id}>
                              {processing?.id === grn.id && processing.action === 'accept' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => rejectGRN(grn.id)} disabled={processing?.id === grn.id}>
                              {processing?.id === grn.id && processing.action === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5 text-red-600" />}
                            </Button>
                          </>
                        )}
                        {grn.status === 'inspected' && (
                          <>
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => acceptGRN(grn.id)} disabled={processing?.id === grn.id}>
                              {processing?.id === grn.id && processing.action === 'accept' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => rejectGRN(grn.id)} disabled={processing?.id === grn.id}>
                              {processing?.id === grn.id && processing.action === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5 text-red-600" />}
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
              <DialogTitle>GRN Details</DialogTitle>
              <DialogDescription>View goods receipt details and inspection status.</DialogDescription>
            </DialogHeader>
            {selectedGRN && (
              <div className="space-y-4 px-6 pb-6 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold font-mono">{selectedGRN.grn_number}</h3>
                    <p className="text-sm text-muted-foreground">PO: {selectedGRN.po_number}</p>
                  </div>
                  <Badge className={`${getStatusColor(selectedGRN.status)} text-sm`}>{selectedGRN.status?.replace('_', ' ')}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Supplier:</span> <span className="font-medium">{selectedGRN.supplier_name}</span></div>
                  <div><span className="text-muted-foreground">Receipt Date:</span> <span className="font-medium">{selectedGRN.receipt_date ? new Date(selectedGRN.receipt_date).toLocaleDateString() : '—'}</span></div>
                  <div><span className="text-muted-foreground">Received By:</span> <span className="font-medium">{selectedGRN.received_by_name || '—'}</span></div>
                  <div><span className="text-muted-foreground">Location:</span> <span className="font-medium">{selectedGRN.received_location || '—'}</span></div>
                  <div><span className="text-muted-foreground">Condition:</span> <span className="font-medium capitalize">{selectedGRN.received_condition}</span></div>
                  {selectedGRN.invoice_number && <div><span className="text-muted-foreground">Invoice Number:</span> <span className="font-medium">{selectedGRN.invoice_number}</span></div>}
                  {selectedGRN.inspected_by_name && <div><span className="text-muted-foreground">Inspected By:</span> <span className="font-medium">{selectedGRN.inspected_by_name}</span></div>}
                </div>

                {selectedGRN.notes && (
                  <div className="p-3 rounded-lg bg-muted/50 text-sm">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                    {selectedGRN.notes}
                  </div>
                )}

                {/* Attachments — invoice uploaded at creation, viewable here by anyone
                    who can see the GRN (including inspectors/approvers) */}
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Attachments</p>
                  <AttachmentList entityType="goods-receipt-note" entityId={selectedGRN.id} emptyText="No invoice attached" />
                </div>

                {selectedGRN.inspection_notes && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 text-sm border border-amber-200 dark:border-amber-800">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">Inspection Notes</p>
                    {selectedGRN.inspection_notes}
                  </div>
                )}

                {/* Line Items */}
                <AdvancedDataTable<GRNLine>
                  data={selectedGRN.lines || []}
                  keyExtractor={(line, idx) => line.id ?? idx}
                  columns={[
                    { key: 'item_description', header: 'Item' },
                    { key: 'quantity_expected', header: 'Expected', align: 'center' },
                    {
                      key: 'quantity_received', header: 'Received', align: 'center',
                      render: (v, line) => (
                        <span className={`font-medium ${v < line.quantity_expected ? 'text-amber-600' : 'text-emerald-600'}`}>{v}</span>
                      ),
                    },
                    { key: 'item_condition', header: 'Condition', render: (v) => <span className="capitalize">{v}</span> },
                    { key: 'batch_number', header: 'Batch', render: (v) => <span className="font-mono text-xs">{v || '—'}</span> },
                    { key: 'expiry_date', header: 'Expiry', render: (v) => <span className="text-xs">{v ? new Date(v).toLocaleDateString() : '—'}</span> },
                    {
                      key: 'inspection_status', header: 'Inspection', align: 'center',
                      render: (v) => <Badge className={`text-xs ${getStatusColor(v)}`}>{v}</Badge>,
                    },
                  ]}
                />

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="outline" size="sm" className="h-8 px-4 text-xs" onClick={() => downloadGRNReport(selectedGRN)}>
                    <Download className="w-3 h-3 mr-2" /> Download PDF
                  </Button>
                  {selectedGRN.status === 'pending_inspection' && (
                    <>
                      <Button size="sm" onClick={() => inspectGRN(selectedGRN.id)} variant="outline" className="h-8 px-4 text-xs" disabled={processing?.id === selectedGRN.id}>
                        {processing?.id === selectedGRN.id && processing.action === 'inspect' ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <ClipboardCheck className="w-3 h-3 mr-2" />}
                        {processing?.id === selectedGRN.id && processing.action === 'inspect' ? 'Marking Inspected...' : 'Mark Inspected'}
                      </Button>
                      <Button size="sm" onClick={() => acceptGRN(selectedGRN.id)} className="h-8 px-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={processing?.id === selectedGRN.id}>
                        {processing?.id === selectedGRN.id && processing.action === 'accept' ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-2" />}
                        {processing?.id === selectedGRN.id && processing.action === 'accept' ? 'Accepting...' : 'Accept'}
                      </Button>
                      <Button size="sm" onClick={() => rejectGRN(selectedGRN.id)} variant="destructive" className="h-8 px-4 text-xs" disabled={processing?.id === selectedGRN.id}>
                        {processing?.id === selectedGRN.id && processing.action === 'reject' ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <XCircle className="w-3 h-3 mr-2" />}
                        {processing?.id === selectedGRN.id && processing.action === 'reject' ? 'Rejecting...' : 'Reject'}
                      </Button>
                    </>
                  )}
                  {selectedGRN.status === 'inspected' && (
                    <>
                      <Button size="sm" onClick={() => acceptGRN(selectedGRN.id)} className="h-8 px-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={processing?.id === selectedGRN.id}>
                        {processing?.id === selectedGRN.id && processing.action === 'accept' ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-2" />}
                        {processing?.id === selectedGRN.id && processing.action === 'accept' ? 'Accepting...' : 'Accept'}
                      </Button>
                      <Button size="sm" onClick={() => rejectGRN(selectedGRN.id)} variant="destructive" className="h-8 px-4 text-xs" disabled={processing?.id === selectedGRN.id}>
                        {processing?.id === selectedGRN.id && processing.action === 'reject' ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <XCircle className="w-3 h-3 mr-2" />}
                        {processing?.id === selectedGRN.id && processing.action === 'reject' ? 'Rejecting...' : 'Reject'}
                      </Button>
                    </>
                  )}
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

export default GoodsReceiptNotes;
