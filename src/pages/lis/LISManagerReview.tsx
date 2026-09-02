import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { CheckSquare, Check, X, RefreshCw, Search, User, Activity, Box, History, Loader2, Printer, ChevronRight, CheckCircle2, Circle, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import * as docTemplate from '@/utils/documentTemplate';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

// Groups a flat result-row list into one entry per order (= per patient request),
// each holding its specimens, each holding its own result rows — so the worklist
// shows one row per patient and the right panel shows every test in that order.
const groupByOrder = (list: any[]) => {
  const orders = new Map<string, any>();
  for (const r of list) {
    if (!orders.has(r.order_id)) {
      orders.set(r.order_id, {
        order_id: r.order_id,
        first_name: r.first_name,
        last_name: r.last_name,
        participant_number: r.participant_number,
        order_time: r.order_time,
        specimenMap: new Map<string, any>(),
      });
    }
    const order = orders.get(r.order_id);
    if (!order.specimenMap.has(r.specimen_id)) {
      order.specimenMap.set(r.specimen_id, {
        specimen_id: r.specimen_id,
        barcode: r.barcode,
        test_name: r.test_name,
        status: r.status,
        manager_notes: r.manager_notes,
        updated_at: r.updated_at,
        results: [] as any[],
      });
    }
    order.specimenMap.get(r.specimen_id).results.push(r);
  }
  // Latest orders first — most recently ordered patient sits at the top of the review queue.
  return Array.from(orders.values())
    .map(o => ({ ...o, specimens: Array.from(o.specimenMap.values()) }))
    .sort((a, b) => new Date(b.order_time).getTime() - new Date(a.order_time).getTime());
};

const matchesGroupSearch = (g: any, term: string) => {
  if (!term) return true;
  const q = term.toLowerCase();
  return `${g.first_name} ${g.last_name}`.toLowerCase().includes(q) ||
    g.participant_number?.toLowerCase().includes(q) ||
    g.specimens.some((s: any) => s.test_name?.toLowerCase().includes(q) || s.barcode?.toLowerCase().includes(q));
};

const getRemarkBadge = (value: string, refRange: string) => {
  if (!value || !refRange) return <span className="text-green-600 font-bold text-[10px] bg-green-50 px-2 py-0.5 rounded border border-green-100">NORMAL</span>;
  const parts = refRange.split('-').map((p: string) => p.trim());
  if (parts.length === 2) {
    const min = parseFloat(parts[0]);
    const max = parseFloat(parts[1]);
    const val = parseFloat(value);
    if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
      if (val < min) return <span className="text-red-500 font-bold text-[10px] bg-red-50 px-2 py-0.5 rounded border border-red-100">LOW</span>;
      if (val > max) return <span className="text-red-500 font-bold text-[10px] bg-red-50 px-2 py-0.5 rounded border border-red-100">HIGH</span>;
    }
  }
  return <span className="text-green-600 font-bold text-[10px] bg-green-50 px-2 py-0.5 rounded border border-green-100">NORMAL</span>;
};

// Local (not UTC) date string, so "today" matches the user's actual calendar day.
const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getRemarkText = (value: string, refRange: string): string => {
  if (!value || !refRange) return 'NORMAL';
  const parts = refRange.split('-').map((p: string) => p.trim());
  if (parts.length === 2) {
    const min = parseFloat(parts[0]);
    const max = parseFloat(parts[1]);
    const val = parseFloat(value);
    if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
      if (val < min) return 'LOW';
      if (val > max) return 'HIGH';
    }
  }
  return 'NORMAL';
};

export default function LISManagerReview() {
  const { user } = useAuth();
  const facilityInfo = useFacilityInfo();
  const [results, setResults] = useState<any[]>([]);
  const [historyResults, setHistoryResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewingAction, setReviewingAction] = useState<'approved' | 'queried' | null>(null);
  const [printing, setPrinting] = useState(false);
  const [managerNotes, setManagerNotes] = useState<Record<string, string>>({});

  const [pendingSearch, setPendingSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  // History defaults to today only — broaden the range to review earlier results.
  const [historyDateFrom, setHistoryDateFrom] = useState(() => toLocalDateStr(new Date()));
  const [historyDateTo, setHistoryDateTo] = useState(() => toLocalDateStr(new Date()));
  const [historyStatus, setHistoryStatus] = useState('all');

  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedSpecimenId, setSelectedSpecimenId] = useState<string | null>(null);

  // Fetches on mount, and re-fetches whenever the date range changes (backend does the filtering).
  useEffect(() => {
    fetchResults();
  }, [historyDateFrom, historyDateTo]);

  const fetchResults = async () => {
    setLoading(true);
    try {
      const [resPending, resHistory] = await Promise.all([
        authFetch('/api/lis/results/pending-review', { credentials: 'include' }),
        authFetch(`/api/lis/results/history?dateFrom=${historyDateFrom}&dateTo=${historyDateTo}`, { credentials: 'include' })
      ]);
      if (resPending.ok) setResults(await resPending.json());
      if (resHistory.ok) setHistoryResults(await resHistory.json());
    } catch (e) {
      toast.error('Failed to fetch pending results');
    } finally {
      setLoading(false);
    }
  };

  // Date range is already applied server-side; only status is filtered client-side.
  const filteredHistoryFlat = historyStatus === 'all' ? historyResults : historyResults.filter(r => r.status === historyStatus);

  // Unfiltered-by-search groups, used to keep the open order/specimen stable while typing.
  const pendingOrdersAll = groupByOrder(results);
  const historyOrdersAll = groupByOrder(filteredHistoryFlat);

  const pendingOrders = pendingOrdersAll.filter(g => matchesGroupSearch(g, pendingSearch));
  const historyOrders = historyOrdersAll.filter(g => matchesGroupSearch(g, historySearch));

  const currentOrder = activeTab === 'pending'
    ? pendingOrdersAll.find(g => g.order_id === selectedOrderId)
    : historyOrdersAll.find(g => g.order_id === selectedOrderId);

  const selectedSpecimen = currentOrder?.specimens.find((s: any) => s.specimen_id === selectedSpecimenId) || null;

  const selectOrder = (group: any) => {
    setSelectedOrderId(group.order_id);
    setSelectedSpecimenId(group.specimens[0]?.specimen_id || null);
  };

  const handleReview = async (specimenId: string, action: 'approved' | 'queried') => {
    if (reviewingAction) return;

    // In our backend, review is done per result ID, but realistically we want to approve the whole specimen.
    // The backend route is `/api/lis/results/:id/review` which updates one result.
    // Let's loop through all results for this specimen and approve them.
    const specimenResults = results.filter(r => r.specimen_id === specimenId);
    const notes = managerNotes[specimenId] || '';

    if (action === 'queried' && !notes) return toast.error('Notes required for queries/rejections');

    setReviewingAction(action);
    try {
      let successCount = 0;
      for (const r of specimenResults) {
        const res = await authFetch(`/api/lis/results/${r.id}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action, manager_notes: notes, manager_id: user?.id })
        });
        if (res.ok) successCount++;
      }

      if (successCount === specimenResults.length) {
        toast.success(`Specimen results ${action}`);
        // Only auto-advance once every component actually updated — advancing
        // on a partial failure used to leave the specimen half-approved (some
        // lis_results rows updated, others still pending) with no way to tell
        // and no retry path, since the UI had already moved on.
        const remaining = (currentOrder?.specimens || []).filter((s: any) => s.specimen_id !== specimenId);
        if (remaining.length > 0) {
          setSelectedSpecimenId(remaining[0].specimen_id);
        } else {
          setSelectedSpecimenId(null);
          setSelectedOrderId(null);
        }
      } else {
        toast.error(`${specimenResults.length - successCount} of ${specimenResults.length} result(s) failed to update — still on this specimen, please retry`);
      }
      fetchResults();
    } catch (e) {
      toast.error('Network error');
    } finally {
      setReviewingAction(null);
    }
  };

  // Results come back from the API in whatever order they were written (insertion order),
  // not the test's defined parameter order the entry form itself uses — /results/
  // pending-review and /results/history now also return each result's own
  // lab_test_components.display_order, so re-sort to that before printing. Anything with
  // no match (custom/legacy analyte, display_order NULL) keeps its relative order at the end.
  const sortResultsByComponentOrder = (results: any[]) => {
    return [...results].sort((a, b) => {
      const ao = a.display_order, bo = b.display_order;
      if (ao == null && bo == null) return 0;
      if (ao == null) return 1;
      if (bo == null) return -1;
      return ao - bo;
    });
  };

  // Prints every test in the currently open order together, not just the one being
  // reviewed — pulls "Done By" (who recorded the results) and "Approved By" (the
  // reviewing manager) signatures straight from their saved Profile signature.
  const handlePrintResults = async () => {
    if (printing) return;
    if (!currentOrder || currentOrder.specimens.length === 0) return;
    setPrinting(true);
    try {
      const withResults = currentOrder.specimens.filter((s: any) => s.results?.length > 0);
      if (withResults.length === 0) { toast.error('No results to print yet'); return; }

      const allResults = withResults.flatMap((s: any) => s.results);
      const recordedResult = allResults.find((r: any) => r.recorded_by);
      const approvedResult = allResults.find((r: any) => r.manager_review_by && r.status === 'approved');

      const [doneBySignature, approvedBySignature] = await Promise.all([
        docTemplate.fetchUserSignature(recordedResult?.recorded_by),
        approvedResult ? docTemplate.fetchUserSignature(approvedResult.manager_review_by) : Promise.resolve(null),
      ]);

      const patientName = `${currentOrder.first_name} ${currentOrder.last_name}`.trim();
      const requestedByName = allResults.find((r: any) => r.requested_by_name)?.requested_by_name || '—';

      const testSectionsHTML = withResults.map((s: any) => {
        const rows = sortResultsByComponentOrder(s.results).map((r: any) => ({
          cells: [r.analyte, r.value || '—', r.unit || '—', r.reference_range || '—', getRemarkText(r.value, r.reference_range)],
        }));
        return [
          `<div class="ic-section-title">Test: ${s.test_name} <span>Barcode: ${s.barcode}</span></div>`,
          docTemplate.buildTable([{ label: 'Parameter' }, { label: 'Result' }, { label: 'Unit' }, { label: 'Ref Range' }, { label: 'Remark' }], rows),
          s.manager_notes ? docTemplate.buildNotes(`Manager Notes (${s.test_name}): ${s.manager_notes}`) : '',
        ].join('\n');
      }).join('\n');

      const signers = [
        { label: 'Done By', name: recordedResult?.recorded_by_name || '', signature: doneBySignature || undefined },
      ];
      if (approvedResult) {
        signers.push({ label: 'Approved By', name: approvedResult.manager_review_by_name || '', signature: approvedBySignature || undefined });
      }

      const bodyHTML = [
        docTemplate.buildInfoGrid(
          { title: 'Patient Details', rows: [
            { label: 'Patient Name', value: patientName, bold: true },
            { label: 'Participant ID', value: currentOrder.participant_number },
          ]},
          { title: 'Report Details', rows: [
            { label: 'Report Date', value: docTemplate.formatDate(new Date()) },
            { label: 'Requested By', value: requestedByName },
          ]}
        ),
        testSectionsHTML,
        docTemplate.buildSignatures(signers),
      ].join('\n');

      const html = docTemplate.buildDocument({
        title: 'Laboratory Report',
        docType: 'Laboratory Report',
        docNumber: `LAB-${currentOrder.order_id.slice(-6).toUpperCase()}`,
        date: new Date(),
        bodyHTML,
        logoUrl: `${window.location.origin}/hjd-icon.png`,
        facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
        branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
      });

      docTemplate.openPrintWindow(html);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1800px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
        <PageHeader title="Manager Review" icon={<CheckSquare />} className="mb-3" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">

          {/* LEFT: Worklist — one row per patient/order */}
          <div className="lg:col-span-3 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden h-full min-h-0">
            <div className="flex w-full border-b">
              <button
                className={cn("flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2", activeTab === 'pending' ? "bg-primary/5 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted/50")}
                onClick={() => { setActiveTab('pending'); setSelectedOrderId(null); setSelectedSpecimenId(null); }}
              >
                <Box className="w-4 h-4" /> Pending ({pendingOrders.length})
              </button>
              <button
                className={cn("flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2", activeTab === 'history' ? "bg-primary/5 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted/50")}
                onClick={() => { setActiveTab('history'); setSelectedOrderId(null); setSelectedSpecimenId(null); }}
              >
                <History className="w-4 h-4" /> History
              </button>
            </div>

            <div className="p-3 border-b bg-card space-y-3">
              {activeTab === 'pending' ? (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Search patient, ID, test..."
                      className="pl-8 h-9 text-sm"
                      value={pendingSearch}
                      onChange={(e) => setPendingSearch(e.target.value)}
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchResults} disabled={loading} className="h-9 w-9 p-0">
                    <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                      <Input
                        placeholder="Search patient, ID, test..."
                        className="pl-8 h-9 text-sm"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                      />
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchResults} disabled={loading} className="h-9 w-9 p-0">
                      <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="date"
                      className="h-9 text-xs"
                      value={historyDateFrom}
                      max={historyDateTo}
                      onChange={(e) => setHistoryDateFrom(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground flex-shrink-0">to</span>
                    <Input
                      type="date"
                      className="h-9 text-xs"
                      value={historyDateTo}
                      min={historyDateFrom}
                      onChange={(e) => setHistoryDateTo(e.target.value)}
                    />
                  </div>
                  <Combobox
                    options={[
                      { value: 'all', label: 'All' },
                      { value: 'approved', label: 'Approved' },
                      { value: 'queried', label: 'Queried' },
                    ]}
                    value={historyStatus}
                    onChange={(v) => setHistoryStatus(v)}
                    searchPlaceholder="Search..."
                    className="h-9 text-xs"
                  />
                </>
              )}
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-1 bg-card">
              {activeTab === 'pending' ? (
                pendingOrders.length > 0 ? pendingOrders.map(g => (
                  <button
                    key={g.order_id}
                    onClick={() => selectOrder(g)}
                    className={cn(
                      "w-full text-left p-3 rounded-md transition-colors border text-sm flex flex-col gap-1 bg-card",
                      selectedOrderId === g.order_id
                        ? "bg-primary/5 border-primary text-primary shadow-sm"
                        : "hover:border-primary/50 border-transparent shadow-sm"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{g.first_name} {g.last_name}</span>
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ml-2">{g.specimens.length} test{g.specimens.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{g.participant_number}</div>
                    <div className="text-[11px] text-muted-foreground">{new Date(g.order_time).toLocaleString()}</div>
                  </button>
                )) : (
                  <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                    {loading ? 'Loading...' : 'No specimens pending review.'}
                  </div>
                )
              ) : (
                historyOrders.length > 0 ? historyOrders.map(g => (
                  <button
                    key={g.order_id}
                    onClick={() => selectOrder(g)}
                    className={cn(
                      "w-full text-left p-3 rounded-md transition-colors border text-sm flex flex-col gap-1 bg-card",
                      selectedOrderId === g.order_id
                        ? "bg-primary/5 border-primary text-primary shadow-sm"
                        : "hover:border-primary/50 border-transparent shadow-sm"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{g.first_name} {g.last_name}</span>
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ml-2">{g.specimens.length} test{g.specimens.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{g.participant_number}</div>
                    <div className="text-[11px] text-muted-foreground">{new Date(g.order_time).toLocaleDateString()}</div>
                  </button>
                )) : (
                  <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                    {loading ? 'Loading...' : 'No matching history records.'}
                  </div>
                )
              )}
            </div>
          </div>

          {/* CENTER: Patient Details + Results Review */}
          <div className="lg:col-span-6 flex flex-col gap-6 h-full min-h-0">

            <div className="bg-card rounded-lg border shadow-sm p-4 h-fit flex-shrink-0">
              <div className="flex items-center justify-between border-b pb-2 mb-3">
                <h3 className="font-medium flex items-center gap-2">
                  <User className="w-4 h-4" /> Patient Details
                </h3>
                {currentOrder && (
                  <Button variant="outline" size="sm" onClick={handlePrintResults} disabled={printing}>
                    {printing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Printer className="w-3.5 h-3.5 mr-1.5" />}
                    {printing ? 'Preparing...' : 'Print All Results'}
                  </Button>
                )}
              </div>
              {currentOrder ? (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground font-semibold uppercase">Participant</div>
                    <div className="font-medium">{currentOrder.first_name} {currentOrder.last_name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground font-semibold uppercase">ID</div>
                    <div className="font-mono text-primary font-medium">{currentOrder.participant_number}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground font-semibold uppercase">Ordered</div>
                    <div>{new Date(currentOrder.order_time).toLocaleString()}</div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm py-2">Select a patient from the worklist to view details.</div>
              )}
            </div>

            <div className="bg-card rounded-lg border shadow-sm flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
                <h3 className="font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Results Review
                  {selectedSpecimen && <span className="text-primary ml-2 border-l pl-2 font-mono">{selectedSpecimen.test_name}</span>}
                </h3>
              </div>

              {selectedSpecimen ? (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 overflow-auto p-6">
                    <AdvancedDataTable<any>
                      data={sortResultsByComponentOrder(selectedSpecimen.results)}
                      keyExtractor={(r) => r.id}
                      columns={[
                        { key: 'analyte', header: 'Parameter', render: (v) => <span className="font-medium">{v}</span> },
                        { key: 'value', header: 'Result Value', render: (v) => <span className="font-mono font-bold text-primary">{v}</span> },
                        { key: 'unit', header: 'Unit', render: (v) => <span className="text-muted-foreground">{v || '-'}</span> },
                        { key: 'reference_range', header: 'Ref Range', render: (v) => <span className="text-xs text-muted-foreground">{v || '-'}</span> },
                        { key: '__remarks', header: 'Remarks', render: (_v, r) => getRemarkBadge(r.value, r.reference_range) },
                        {
                          key: '__time', header: 'Time Captured',
                          render: (_v, r) => <span className="text-xs text-muted-foreground">{new Date(r.created_at || r.updated_at).toLocaleString()}</span>,
                        },
                      ]}
                    />
                  </div>

                  <div className="p-4 border-t bg-card shrink-0">
                    {activeTab === 'pending' ? (
                      <div>
                        <label className="block text-sm font-medium mb-2">Manager Notes (Required for queries/rejections)</label>
                        <Textarea
                          placeholder="Enter notes here..."
                          className="resize-none h-20 text-sm mb-4"
                          value={managerNotes[selectedSpecimen.specimen_id] || ''}
                          onChange={e => setManagerNotes({...managerNotes, [selectedSpecimen.specimen_id]: e.target.value})}
                        />
                        <div className="flex justify-end gap-3">
                          <Button
                            variant="outline"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                            onClick={() => handleReview(selectedSpecimen.specimen_id, 'queried')}
                            disabled={!!reviewingAction}
                          >
                            {reviewingAction === 'queried' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-2" />}
                            {reviewingAction === 'queried' ? 'Querying...' : 'Query / Reject'}
                          </Button>
                          <Button
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => handleReview(selectedSpecimen.specimen_id, 'approved')}
                            disabled={!!reviewingAction}
                          >
                            {reviewingAction === 'approved' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                            {reviewingAction === 'approved' ? 'Approving...' : 'Approve Results'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <h4 className="text-sm font-semibold uppercase text-muted-foreground mb-3">Review Outcome</h4>
                        <div className="flex items-center gap-3 mb-4">
                          <span className="text-sm font-medium">Status:</span>
                          {selectedSpecimen.status === 'approved' ? (
                            <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold uppercase">Approved</span>
                          ) : (
                            <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold uppercase">Queried / Rejected</span>
                          )}
                        </div>
                        {selectedSpecimen.manager_notes && (
                          <div className="bg-muted/30 p-3 rounded-md text-sm italic">
                            "{selectedSpecimen.manager_notes}"
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center m-6 text-muted-foreground border-2 border-dashed rounded-lg p-8 text-center">
                  {currentOrder ? 'Select a test from the right panel to review its results.' : 'Select a patient from the worklist to begin.'}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Tests for the selected patient's order */}
          <div className="lg:col-span-3 bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden h-full min-h-0">
            <div className="p-4 border-b bg-muted/30">
              <h3 className="font-medium flex items-center gap-2">
                <FlaskConical className="w-4 h-4" /> Tests {currentOrder ? `(${currentOrder.specimens.length})` : ''}
              </h3>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1 bg-card">
              {currentOrder ? (
                currentOrder.specimens.map((s: any) => (
                  <button
                    key={s.specimen_id}
                    onClick={() => setSelectedSpecimenId(s.specimen_id)}
                    className={cn(
                      "w-full text-left p-3 rounded-md transition-colors border text-sm flex items-start gap-2 bg-card",
                      selectedSpecimenId === s.specimen_id
                        ? "bg-primary/5 border-primary text-primary shadow-sm"
                        : "hover:border-primary/50 border-transparent shadow-sm"
                    )}
                  >
                    {activeTab === 'history' ? (
                      s.status === 'approved'
                        ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        : <X className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.test_name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{s.barcode}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                        <span>{s.results.length} param{s.results.length > 1 ? 's' : ''}</span>
                        {activeTab === 'history' && s.status === 'approved' && <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded uppercase font-bold">Approved</span>}
                        {activeTab === 'history' && s.status === 'queried' && <span className="text-[10px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded uppercase font-bold">Queried</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  </button>
                ))
              ) : (
                <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                  Select a patient to see their tests.
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
      </div>
    </AppLayout>
  );
}
