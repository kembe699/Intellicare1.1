import React, { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Syringe, Printer, Send, RefreshCw, AlertCircle, Search, Calendar, Download, Loader2, CheckCircle2, Circle, ClipboardList } from 'lucide-react';
import Barcode from 'react-barcode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface PatientGroup {
  key: string;
  participant_number: string;
  first_name: string;
  last_name: string;
  specimens: any[];
  outstandingBalance: number;
  insuranceBalance: number;
  earliestOrderTime: string;
  hasRecollection: boolean;
}

interface HistoryOrderGroup {
  order_id: string;
  order_time: string;
  requested_by_name: string | null;
  specimens: any[];
}

interface HistoryGroup {
  key: string;
  participant_number: string;
  first_name: string;
  last_name: string;
  specimens: any[];
  orders: HistoryOrderGroup[];
  latestTime: string;
}

const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export default function LISCollection() {
  const { user } = useAuth();
  const [specimens, setSpecimens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'queue' | 'history'>('queue');
  const [queueSearch, setQueueSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  // Defaults to today only — From/To let staff step back to previous days when needed.
  const [historyDateFrom, setHistoryDateFrom] = useState(() => toLocalDateStr(new Date()));
  const [historyDateTo, setHistoryDateTo] = useState(() => toLocalDateStr(new Date()));
  const [collecting, setCollecting] = useState(false);
  const [dispatchingKey, setDispatchingKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedHistoryKey, setSelectedHistoryKey] = useState<string | null>(null);

  // The specimen(s) currently being printed — rendered off-screen (not a
  // dialog) purely so the print-media CSS below has a target element.
  // Setting this immediately fires the browser print dialog via the effect.
  const [printGroup, setPrintGroup] = useState<any[] | null>(null);

  useEffect(() => {
    fetchSpecimens();
  }, []);

  useEffect(() => {
    if (!printGroup || printGroup.length === 0) return;
    const toCollect = printGroup.filter(s => s.status === 'pending_collection' || s.status === 'recollection_required');
    // Let the off-screen labels render before invoking print.
    const t = setTimeout(async () => {
      window.print();
      if (toCollect.length > 0) {
        setCollecting(true);
        try {
          for (const s of toCollect) {
            const res = await authFetch(`/api/lis/specimens/${s.id}/collect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ collected_by: user?.id })
            });
            if (!res.ok) throw new Error('collect failed');
          }
          toast.success(
            toCollect.length > 1
              ? `${toCollect.length} specimens collected & labels printed`
              : 'Specimen collected & label printed'
          );
          fetchSpecimens();
        } catch (e) {
          toast.error('Some specimens failed to collect — please check the queue.');
        } finally {
          setCollecting(false);
        }
      }
      setPrintGroup(null);
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printGroup]);

  const fetchSpecimens = async () => {
    setLoading(true);
    try {
      // /specimens/pending alone excludes analyzed/approved specimens, so the
      // "Collection History" table below lost every specimen the moment it was
      // analyzed — this fetches both, matching the pattern LISLabQC.tsx and
      // LISResultsEntry.tsx already use correctly.
      const [resPending, resHistory] = await Promise.all([
        authFetch('/api/lis/specimens/pending', { credentials: 'include' }),
        authFetch('/api/lis/specimens/history', { credentials: 'include' })
      ]);
      // Was silently swallowing a non-OK response into an empty array — a 403
      // (or any other failure) on just the Active Queue call made the whole
      // queue look empty, with nothing on screen to say a request had actually
      // failed rather than there genuinely being nothing pending.
      if (!resPending.ok) toast.error('Could not load the active collection queue — some specimens may not be shown.');
      if (!resHistory.ok) toast.error('Could not load collection history — some specimens may not be shown.');
      const pendingData = resPending.ok ? await resPending.json() : [];
      const historyData = resHistory.ok ? await resHistory.json() : [];
      const combined = [...pendingData, ...historyData];
      const uniqueSpecimens = Array.from(new Map(combined.map((item: any) => [item.id, item])).values());
      setSpecimens(uniqueSpecimens);
    } catch (e) {
      toast.error('Failed to fetch collection queue');
    } finally {
      setLoading(false);
    }
  };

  const handleDispatch = async (ids: string[]) => {
    const key = ids.join(',');
    if (dispatchingKey) return;
    setDispatchingKey(key);
    try {
      const results = await Promise.all(ids.map(id =>
        authFetch(`/api/lis/specimens/${id}/dispatch`, { method: 'POST', credentials: 'include' })
      ));
      if (results.every(r => r.ok)) {
        toast.success(ids.length > 1 ? `${ids.length} specimens dispatched to Lab Reception` : 'Specimen dispatched to Lab Reception');
        fetchSpecimens();
      } else {
        toast.error('Failed to dispatch one or more specimens');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setDispatchingKey(null);
    }
  };

  const collectionQueue = specimens.filter(s =>
    s.status === 'pending_collection' ||
    s.status === 'recollection_required' ||
    s.status === 'collected'
  );

  const collectionHistory = specimens.filter(s =>
    s.status !== 'pending_collection' &&
    s.status !== 'recollection_required' &&
    s.status !== 'collected'
  );

  // Group the queue by patient — a real collection station works one
  // patient/one draw at a time, and a single visit commonly covers several
  // ordered tests that all get collected and labeled together.
  const queueGroups = useMemo<PatientGroup[]>(() => {
    const map = new Map<string, PatientGroup>();
    for (const s of collectionQueue) {
      const key = s.participant_number || s.participant_id;
      if (!map.has(key)) {
        map.set(key, {
          key,
          participant_number: s.participant_number,
          first_name: s.first_name,
          last_name: s.last_name,
          specimens: [],
          outstandingBalance: parseFloat(s.outstanding_balance) || 0,
          insuranceBalance: parseFloat(s.insurance_balance) || 0,
          earliestOrderTime: s.order_time,
          hasRecollection: false,
        });
      }
      const g = map.get(key)!;
      g.specimens.push(s);
      if (s.status === 'recollection_required') g.hasRecollection = true;
      if (new Date(s.order_time) < new Date(g.earliestOrderTime)) g.earliestOrderTime = s.order_time;
    }
    // Latest orders first — most recently ordered patient sits at the top of the queue.
    return Array.from(map.values()).sort((a, b) => new Date(b.earliestOrderTime).getTime() - new Date(a.earliestOrderTime).getTime());
  }, [specimens]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredGroups = queueGroups.filter(g => {
    if (!queueSearch) return true;
    const q = queueSearch.toLowerCase();
    return g.participant_number?.toLowerCase().includes(q) ||
      g.first_name?.toLowerCase().includes(q) ||
      g.last_name?.toLowerCase().includes(q) ||
      g.specimens.some(s => s.test_name?.toLowerCase().includes(q) || s.barcode?.toLowerCase().includes(q));
  });

  // Keep a valid selection: default to the first group, and fall through to
  // the next one if the selected patient's queue empties out (fully
  // collected & auto-dispatched) after a refresh.
  useEffect(() => {
    if (selectedKey && filteredGroups.some(g => g.key === selectedKey)) return;
    setSelectedKey(filteredGroups.length > 0 ? filteredGroups[0].key : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredGroups.map(g => g.key).join(',')]);

  const selectedGroup = filteredGroups.find(g => g.key === selectedKey) || null;

  const filteredHistory = collectionHistory.filter(s => {
    const matchesSearch =
      s.participant_number?.toLowerCase().includes(historySearch.toLowerCase()) ||
      s.first_name?.toLowerCase().includes(historySearch.toLowerCase()) ||
      s.last_name?.toLowerCase().includes(historySearch.toLowerCase()) ||
      s.test_name?.toLowerCase().includes(historySearch.toLowerCase()) ||
      s.barcode?.toLowerCase().includes(historySearch.toLowerCase());

    const activityDate = new Date(s.updated_at || s.order_time).toISOString().split('T')[0];
    const matchesDate = (!historyDateFrom || activityDate >= historyDateFrom) && (!historyDateTo || activityDate <= historyDateTo);

    return matchesSearch && matchesDate;
  });

  // Group history the same way the Active Queue groups the collection list — one entry
  // per patient (most recently active patient first), and within each patient one entry
  // per order (a single order commonly covers several tests drawn/collected together).
  const historyGroups = useMemo<HistoryGroup[]>(() => {
    const map = new Map<string, HistoryGroup>();
    for (const s of filteredHistory) {
      const key = s.participant_number || s.participant_id;
      const activityTime = s.updated_at || s.order_time;
      if (!map.has(key)) {
        map.set(key, {
          key,
          participant_number: s.participant_number,
          first_name: s.first_name,
          last_name: s.last_name,
          specimens: [],
          orders: [],
          latestTime: activityTime,
        });
      }
      const g = map.get(key)!;
      g.specimens.push(s);
      if (new Date(activityTime) > new Date(g.latestTime)) g.latestTime = activityTime;
    }
    const groups = Array.from(map.values());
    for (const g of groups) {
      g.specimens.sort((a, b) => new Date(b.updated_at || b.order_time).getTime() - new Date(a.updated_at || a.order_time).getTime());

      const orderMap = new Map<string, HistoryOrderGroup>();
      for (const s of g.specimens) {
        const orderId = s.order_id || 'unknown';
        if (!orderMap.has(orderId)) {
          orderMap.set(orderId, { order_id: orderId, order_time: s.order_time, requested_by_name: s.requested_by_name || null, specimens: [] });
        }
        orderMap.get(orderId)!.specimens.push(s);
      }
      g.orders = Array.from(orderMap.values()).sort((a, b) => new Date(b.order_time).getTime() - new Date(a.order_time).getTime());
    }
    return groups.sort((a, b) => new Date(b.latestTime).getTime() - new Date(a.latestTime).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredHistory.map(s => s.id).join(','), historySearch, historyDateFrom, historyDateTo]);

  useEffect(() => {
    if (selectedHistoryKey && historyGroups.some(g => g.key === selectedHistoryKey)) return;
    setSelectedHistoryKey(historyGroups.length > 0 ? historyGroups[0].key : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyGroups.map(g => g.key).join(',')]);

  const selectedHistoryGroup = historyGroups.find(g => g.key === selectedHistoryKey) || null;

  // Gated per specimen now, not per patient — a patient who paid for 2 of 3 ordered tests
  // can collect those 2 while the unpaid one stays put (see item_paid, resolved server-side
  // in /specimens/pending by matching each specimen to its own bill line).
  const handleCollectGroup = (group: PatientGroup) => {
    if (collecting || printGroup) return;
    const payable = group.specimens.filter(s => (s.status === 'pending_collection' || s.status === 'recollection_required') && s.item_paid);
    if (payable.length === 0) {
      toast.error('None of this patient\'s pending tests have been paid for yet.');
      return;
    }
    setPrintGroup(payable);
  };

  const handleCollectOne = (specimen: any) => {
    if (collecting || printGroup) return;
    if (!specimen.item_paid) {
      toast.error('This test has not been paid for yet — collect payment before proceeding.');
      return;
    }
    setPrintGroup([specimen]);
  };

  const exportToCSV = () => {
    const headers = ['Collected Time', 'Participant ID', 'Name', 'Test Name', 'Test Code', 'Barcode', 'Status'];
    const rows = filteredHistory.map(s => [
      `"${new Date(s.updated_at || s.order_time).toLocaleString()}"`,
      `"${s.participant_number}"`,
      `"${s.first_name} ${s.last_name}"`,
      `"${s.test_name}"`,
      `"${s.test_code}"`,
      `"${s.barcode}"`,
      `"${s.status}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8,"
      + headers.join(",") + "\n"
      + rows.map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `collection_history_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const pendingInSelected = selectedGroup ? selectedGroup.specimens.filter(s => s.status === 'pending_collection' || s.status === 'recollection_required') : [];
  const payablePendingInSelected = pendingInSelected.filter(s => s.item_paid);
  const unpaidPendingInSelected = pendingInSelected.filter(s => !s.item_paid);
  const collectedInSelected = selectedGroup ? selectedGroup.specimens.filter(s => s.status === 'collected') : [];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full flex flex-col space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader title="Specimen Collection" icon={<Syringe />} />
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg shrink-0">
            <button
              onClick={() => setView('queue')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                view === 'queue' ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Active Queue
            </button>
            <button
              onClick={() => setView('history')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                view === 'history' ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              History
            </button>
          </div>
        </div>

        {view === 'queue' ? (
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">
            {/* Patient queue — left */}
            <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-muted/30 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Search patients..."
                      className="pl-8 h-9"
                      value={queueSearch}
                      onChange={(e) => setQueueSearch(e.target.value)}
                    />
                  </div>
                  <Button variant="outline" size="icon" aria-label="Refresh" className="h-9 w-9 shrink-0" onClick={fetchSpecimens} disabled={loading} title="Refresh">
                    <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground px-0.5">{filteredGroups.length} patient(s) in queue</div>
              </div>

              <div className="max-h-[72vh] overflow-auto divide-y">
                {filteredGroups.length > 0 ? (
                  filteredGroups.map(g => {
                    const pendingSpecimens = g.specimens.filter(s => s.status === 'pending_collection' || s.status === 'recollection_required');
                    const pendingCount = pendingSpecimens.length;
                    const payableCount = pendingSpecimens.filter(s => s.item_paid).length;
                    const unpaidCount = pendingCount - payableCount;
                    const isSelected = g.key === selectedKey;
                    return (
                      <button
                        key={g.key}
                        onClick={() => setSelectedKey(g.key)}
                        className={cn(
                          "w-full text-left px-3.5 py-2.5 flex items-center gap-2 transition-colors",
                          isSelected ? "bg-primary/5" : "hover:bg-muted/40"
                        )}
                      >
                        {isSelected ? <CheckCircle2 className="w-4 h-4 text-primary shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                        <span className={cn("font-medium text-sm truncate flex-1 min-w-0", isSelected && "text-primary")}>{g.first_name} {g.last_name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {g.specimens.length} test{g.specimens.length !== 1 ? 's' : ''}
                        </span>
                        {unpaidCount > 0 && payableCount > 0 ? (
                          <span className="text-xs font-medium text-orange-600 shrink-0">{payableCount} ready · {unpaidCount} unpaid</span>
                        ) : unpaidCount > 0 ? (
                          <span className="text-xs font-medium text-orange-600 shrink-0">Unpaid</span>
                        ) : pendingCount > 0 ? (
                          <span className="text-xs font-medium text-success shrink-0">Ready to collect</span>
                        ) : (
                          <span className="text-xs font-medium text-info shrink-0">Awaiting dispatch</span>
                        )}
                        {g.insuranceBalance > 0 && (
                          <span className="text-xs font-medium text-info shrink-0">Insurance</span>
                        )}
                        {g.hasRecollection && (
                          <span className="text-xs font-medium text-destructive shrink-0">Recollection</span>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    {loading ? 'Loading queue...' : queueSearch ? 'No matching patients.' : 'No pending collections.'}
                  </div>
                )}
              </div>
            </div>

            {/* Collection detail — right */}
            <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden min-h-[72vh]">
              {selectedGroup ? (
                <>
                  <div className="p-4 border-b bg-muted/30">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Collecting</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="text-lg font-semibold">{selectedGroup.first_name} {selectedGroup.last_name}</div>
                      {selectedGroup.insuranceBalance > 0 && (
                        <span className="bg-info-bg text-info px-2 py-0.5 rounded-full text-xs font-medium">Insurance</span>
                      )}
                    </div>
                    <div className="text-sm font-mono text-muted-foreground">{selectedGroup.participant_number}</div>
                  </div>

                  <div className="flex-1 overflow-auto p-4">
                    <AdvancedDataTable<any>
                      data={selectedGroup.specimens}
                      keyExtractor={(s) => s.id}
                      columns={[
                        {
                          key: '__status', header: '', width: '2rem',
                          render: (_v, s) => (
                            s.status === 'collected' ? (
                              <CheckCircle2 className="w-4 h-4 text-success" />
                            ) : s.status === 'recollection_required' ? (
                              <AlertCircle className="w-4 h-4 text-destructive" />
                            ) : (
                              <Circle className="w-4 h-4 text-muted-foreground/50" />
                            )
                          ),
                        },
                        {
                          key: 'test_name', header: 'Test Details',
                          render: (v, s) => (
                            <>
                              <div className="font-medium text-sm">{v}</div>
                              <div className="text-xs text-muted-foreground font-mono">{s.test_code} • {s.department || 'General'} • {s.barcode}</div>
                            </>
                          ),
                        },
                        {
                          key: '__actions', header: 'Action', align: 'right',
                          render: (_v, s) => (
                            s.status === 'collected' ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleDispatch([s.id])}
                                disabled={!!dispatchingKey}
                                className="h-7 text-xs"
                              >
                                {dispatchingKey === s.id ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Send className="w-3 h-3 mr-1.5" />}
                                Send to Lab
                              </Button>
                            ) : !s.item_paid ? (
                              <Button size="sm" disabled className="h-7 text-xs" title="Unpaid — collect payment for this test first">
                                <Printer className="w-3 h-3 mr-1.5" /> Payment Required
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant={s.status === 'recollection_required' ? 'destructive' : 'default'}
                                onClick={() => handleCollectOne(s)}
                                disabled={collecting || !!printGroup}
                                className="h-7 text-xs"
                              >
                                {collecting && printGroup?.length === 1 && printGroup[0]?.id === s.id ? (
                                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                ) : (
                                  <Printer className="w-3 h-3 mr-1.5" />
                                )}
                                {s.status === 'recollection_required' ? 'Recollect' : 'Print & Collect'}
                              </Button>
                            )
                          ),
                        },
                      ]}
                    />
                  </div>

                  <div className="p-4 border-t bg-muted/30 space-y-2">
                    {unpaidPendingInSelected.length > 0 && (
                      <div className="p-2.5 rounded-lg border border-warning-border bg-warning-bg text-xs text-warning flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {unpaidPendingInSelected.length} test{unpaidPendingInSelected.length > 1 ? 's' : ''} still unpaid — collect payment to unlock {unpaidPendingInSelected.length > 1 ? 'them' : 'it'}. {payablePendingInSelected.length > 0 ? 'The rest are ready to collect below.' : ''}
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      {collectedInSelected.length > 1 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleDispatch(collectedInSelected.map(s => s.id))}
                          disabled={!!dispatchingKey}
                          className="h-8"
                        >
                          {dispatchingKey ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                          Send All to Lab
                        </Button>
                      )}
                      {payablePendingInSelected.length > 0 && (
                        <Button
                          size="sm"
                          onClick={() => handleCollectGroup(selectedGroup)}
                          disabled={collecting || !!printGroup}
                          className="h-8"
                        >
                          {collecting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Printer className="w-3.5 h-3.5 mr-1.5" />}
                          Print Labels & Collect All ({payablePendingInSelected.length})
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                  <ClipboardList className="w-8 h-8 mb-3 opacity-40" />
                  <div className="text-sm">Select a patient from the queue to begin collection.</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">
            {/* Patient history — left, grouped the same way as the Active Queue */}
            <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-muted/30 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Search patients..."
                      className="pl-8 h-9"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                    />
                  </div>
                  <Button variant="outline" size="icon" aria-label="Export CSV" className="h-9 w-9 shrink-0" onClick={exportToCSV} title="Export CSV">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <Calendar className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      type="date"
                      className="pl-8 h-9 text-sm"
                      value={historyDateFrom}
                      max={historyDateTo || undefined}
                      onChange={(e) => setHistoryDateFrom(e.target.value)}
                      title="From date"
                    />
                  </div>
                  <div className="relative">
                    <Calendar className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      type="date"
                      className="pl-8 h-9 text-sm"
                      value={historyDateTo}
                      min={historyDateFrom || undefined}
                      onChange={(e) => setHistoryDateTo(e.target.value)}
                      title="To date"
                    />
                  </div>
                </div>
                {(historyDateFrom !== toLocalDateStr(new Date()) || historyDateTo !== toLocalDateStr(new Date())) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs w-full"
                    onClick={() => { const today = toLocalDateStr(new Date()); setHistoryDateFrom(today); setHistoryDateTo(today); }}
                  >
                    Reset to today
                  </Button>
                )}
                <div className="text-xs text-muted-foreground px-0.5">{historyGroups.length} patient(s)</div>
              </div>

              <div className="max-h-[72vh] overflow-auto divide-y">
                {historyGroups.length > 0 ? (
                  historyGroups.map(g => {
                    const isSelected = g.key === selectedHistoryKey;
                    return (
                      <button
                        key={g.key}
                        onClick={() => setSelectedHistoryKey(g.key)}
                        className={cn(
                          "w-full text-left p-3.5 flex items-start gap-3 transition-colors",
                          isSelected ? "bg-primary/5" : "hover:bg-muted/40"
                        )}
                      >
                        <div className="mt-0.5 shrink-0">
                          {isSelected ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <Circle className="w-4 h-4 text-muted-foreground/40" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className={cn("font-medium text-sm truncate", isSelected && "text-primary")}>{g.first_name} {g.last_name}</div>
                            <span className="text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                              {g.specimens.length} test{g.specimens.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="text-xs font-mono text-muted-foreground mt-0.5">{g.participant_number}</div>
                          <div className="text-xs text-muted-foreground mt-1">{new Date(g.latestTime).toLocaleString()}</div>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    {loading ? 'Loading history...' : 'No matching collection history found.'}
                  </div>
                )}
              </div>
            </div>

            {/* Patient's history detail — right */}
            <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden min-h-[72vh]">
              {selectedHistoryGroup ? (
                <>
                  <div className="p-4 border-b bg-muted/30">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Collection History</div>
                    <div className="text-lg font-semibold mt-0.5">{selectedHistoryGroup.first_name} {selectedHistoryGroup.last_name}</div>
                    <div className="text-sm font-mono text-muted-foreground">{selectedHistoryGroup.participant_number}</div>
                  </div>
                  <div className="max-h-[72vh] overflow-auto divide-y">
                    {selectedHistoryGroup.orders.map(o => (
                      <div key={o.order_id}>
                        <div className="px-4 py-2 bg-muted flex items-center justify-between flex-wrap gap-1 sticky top-0">
                          <div className="text-xs font-medium text-foreground">
                            Order • {new Date(o.order_time).toLocaleString()}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {o.requested_by_name ? `Dr. ${o.requested_by_name} • ` : ''}{o.specimens.length} test{o.specimens.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <AdvancedDataTable<any>
                          data={o.specimens}
                          keyExtractor={(s) => s.id}
                          columns={[
                            { key: 'updated_at', header: 'Collected Time', render: (_v, s) => <span className="text-muted-foreground">{new Date(s.updated_at || s.order_time).toLocaleString()}</span> },
                            {
                              key: 'test_name', header: 'Test Details',
                              render: (v, s) => (
                                <>
                                  <div className="font-medium">{v}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{s.test_code} • {s.department || 'General'}</div>
                                </>
                              ),
                            },
                            { key: 'barcode', header: 'Barcode ID', render: (v) => <span className="font-mono text-xs">{v}</span> },
                            {
                              key: 'status', header: 'Current Status',
                              render: (v) => (
                                <span className="bg-muted text-foreground px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wider">
                                  {v.replace('_', ' ')}
                                </span>
                              ),
                            },
                            {
                              key: '__actions', header: 'Action', align: 'right',
                              render: (_v, s) => (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setPrintGroup([s])}
                                  disabled={collecting || !!printGroup}
                                  title="Reprint label"
                                >
                                  <Printer className="w-4 h-4" />
                                </Button>
                              ),
                            },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                  <ClipboardList className="w-8 h-8 mb-3 opacity-40" />
                  <div className="text-sm">Select a patient from the list to view their collection history.</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>

      {printGroup && printGroup.length > 0 && (
        <>
          {/* Real label size (50mm x 25mm — a common small thermal barcode
              label; adjust the @page size below to match the actual label
              stock/printer if different), scoped to this component's own
              @page rule so it doesn't affect any other print flow in the
              app (the global one in index.css is still A4 for everything
              else) — same pattern src/components/receipts/PaymentReceipt
              .tsx already uses for its own 80mm receipt size. */}
          <style type="text/css">
            {`
              @media print {
                @page {
                  size: 50mm 25mm;
                  margin: 0;
                }
                /* "visibility: hidden" on the rest of the page (the old
                   approach) still reserves its full layout space, which the
                   print engine then has to paginate into many 50mm-tall
                   slices even though nothing is visible on most of them —
                   that's where the extra blank pages were coming from, only
                   fixed at a page size this small. Removing the rest of the
                   page from the flow entirely with display:none, instead of
                   just hiding it, means the only thing left to paginate is
                   the label itself. */
                body *:not(#printable-labels):not(#printable-labels *) {
                  display: none !important;
                }
                #printable-labels {
                  position: static !important;
                  left: auto !important;
                  top: auto !important;
                  width: 100%;
                  margin: 0;
                }
                .print-label {
                  page-break-after: always;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  width: 50mm;
                  height: 25mm;
                  margin: 0 auto;
                  padding: 1mm;
                  box-sizing: border-box;
                  overflow: hidden;
                }
                .print-label:last-child {
                  page-break-after: auto;
                }
              }
            `}
          </style>
          <div id="printable-labels" className="fixed -left-[9999px] top-0 bg-white text-black">
            {printGroup.map(s => (
              <div key={s.id} className="print-label">
                <Barcode
                  value={s.barcode}
                  width={1}
                  height={22}
                  fontSize={8}
                  margin={2}
                  background="#ffffff"
                  lineColor="#000000"
                />
                <div className="text-center text-[8px] font-medium uppercase leading-tight">{s.test_name}</div>
                <div className="text-center text-[7px] text-gray-700">{new Date(s.order_time).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </AppLayout>
  );
}
