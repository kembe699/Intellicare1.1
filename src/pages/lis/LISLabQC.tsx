import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { ShieldCheck, Check, X, ArrowRightLeft, RefreshCw, Box, Search, Calendar, Filter, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { usePromptDialog } from '@/hooks/use-prompt-dialog';

const DEPARTMENT_OPTIONS = [
  { value: '', label: 'Dept...' },
  { value: 'Hematology', label: 'Hematology' },
  { value: 'Chemistry', label: 'Chemistry' },
  { value: 'Microbiology', label: 'Microbiology' },
  { value: 'Immunology', label: 'Immunology' },
  { value: 'Molecular', label: 'Molecular / PCR' },
];

const HISTORY_STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending QC' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
];

export default function LISLabQC() {
  const { user } = useAuth();
  const { prompt, promptDialog } = usePromptDialog();
  const [specimens, setSpecimens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [routeDepartments, setRouteDepartments] = useState<Record<string, string>>({});
  const [qcProcessingId, setQcProcessingId] = useState<string | null>(null);
  const [routingId, setRoutingId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDate, setHistoryDate] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');

  useEffect(() => {
    fetchSpecimens();
  }, []);

  const fetchSpecimens = async () => {
    setLoading(true);
    try {
      const [resPending, resHistory] = await Promise.all([
        authFetch('/api/lis/specimens/pending', { credentials: 'include' }),
        authFetch('/api/lis/specimens/history', { credentials: 'include' })
      ]);
      
      let pendingData = [];
      let historyData = [];
      
      if (resPending.ok) pendingData = await resPending.json();
      if (resHistory.ok) historyData = await resHistory.json();
      
      // Combine and deduplicate just in case
      const combined = [...pendingData, ...historyData];
      const uniqueSpecimens = Array.from(new Map(combined.map(item => [item.id, item])).values());
      
      setSpecimens(uniqueSpecimens);
    } catch (e) {
      toast.error('Failed to fetch QC queue');
    } finally {
      setLoading(false);
    }
  };

  const handleQC = async (id: string, action: 'accepted' | 'rejected') => {
    if (qcProcessingId) return;

    const reason = action === 'rejected'
      ? await prompt({ title: 'Rejection reason', placeholder: 'e.g. Hemolyzed, Clotted, Insufficient' })
      : '';
    if (action === 'rejected' && !reason) return; // cancelled — the dialog itself requires non-empty text to confirm

    setQcProcessingId(id);
    try {
      const res = await authFetch(`/api/lis/specimens/${id}/qc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, reason, checked_by: user?.id })
      });
      if (res.ok) {
        toast.success(`Specimen ${action}`);
        fetchSpecimens();
      } else {
        toast.error('Failed to process QC');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setQcProcessingId(null);
    }
  };

  const handleRoute = async (id: string) => {
    if (routingId) return;

    const dept = routeDepartments[id];
    if (!dept) return toast.error('Please select a department to route to');

    setRoutingId(id);
    try {
      const res = await authFetch(`/api/lis/specimens/${id}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ department: dept })
      });
      if (res.ok) {
        toast.success(`Specimen routed to ${dept}`);
        fetchSpecimens();
      } else {
        toast.error('Failed to route specimen');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setRoutingId(null);
    }
  };

  const incomingQueue = specimens.filter(s => s.status === 'in_transit');
  const routingQueue = specimens.filter(s => s.status === 'accepted');

  // Peak-traffic relief: accepting/routing one specimen at a time is the whole bottleneck
  // when dozens land at once. These fire every request in parallel and report one summary
  // instead of making staff click Accept/Route once per specimen.
  const [bulkAccepting, setBulkAccepting] = useState(false);
  const handleAcceptAll = async () => {
    if (bulkAccepting || incomingQueue.length === 0) return;
    setBulkAccepting(true);
    try {
      const results = await Promise.all(incomingQueue.map(s =>
        authFetch(`/api/lis/specimens/${s.id}/qc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: 'accepted', checked_by: user?.id }),
        }).then(r => r.ok)
      ));
      const okCount = results.filter(Boolean).length;
      if (okCount > 0) toast.success(`Accepted ${okCount} specimen${okCount > 1 ? 's' : ''}`);
      if (okCount < results.length) toast.error(`${results.length - okCount} failed to accept — still awaiting QC`);
      fetchSpecimens();
    } finally {
      setBulkAccepting(false);
    }
  };

  const [bulkRouting, setBulkRouting] = useState(false);
  const handleRouteAll = async () => {
    if (bulkRouting || routingQueue.length === 0) return;
    // Each specimen already defaults to its own test's department (see the per-row select
    // below) — this routes every specimen that has one resolved, cash or overridden, in one
    // shot; anything with no department at all (never set, no default) is skipped and
    // called out so it isn't silently mis-routed.
    const toRoute = routingQueue.map(s => ({ id: s.id, dept: routeDepartments[s.id] || s.department || '' })).filter(x => x.dept);
    const skipped = routingQueue.length - toRoute.length;
    if (toRoute.length === 0) {
      toast.error('None of these specimens have a department set — pick one per specimen first.');
      return;
    }
    setBulkRouting(true);
    try {
      const results = await Promise.all(toRoute.map(({ id, dept }) =>
        authFetch(`/api/lis/specimens/${id}/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ department: dept }),
        }).then(r => r.ok)
      ));
      const okCount = results.filter(Boolean).length;
      if (okCount > 0) toast.success(`Routed ${okCount} specimen${okCount > 1 ? 's' : ''}`);
      if (okCount < results.length) toast.error(`${results.length - okCount} failed to route`);
      if (skipped > 0) toast.warning(`${skipped} specimen${skipped > 1 ? 's have' : ' has'} no department set — pick one to route ${skipped > 1 ? 'them' : 'it'}.`);
      fetchSpecimens();
    } finally {
      setBulkRouting(false);
    }
  };
  
  // Exclude pending_collection and collected which belong to Phlebotomy (before QC)
  const qcHistoryList = specimens.filter(s => 
    !['pending_collection', 'collected'].includes(s.status)
  );

  const filteredHistory = qcHistoryList.filter(s => {
    // Status Filter (pending = in_transit, accepted = accepted/routed/analyzed/approved, rejected = rejected/recollection_required)
    let matchesStatus = true;
    if (historyStatus === 'pending') matchesStatus = s.status === 'in_transit';
    if (historyStatus === 'accepted') matchesStatus = ['accepted', 'routed', 'analyzed', 'approved'].includes(s.status);
    if (historyStatus === 'rejected') matchesStatus = ['rejected', 'recollection_required'].includes(s.status);

    const matchesSearch = 
      s.participant_number?.toLowerCase().includes(historySearch.toLowerCase()) ||
      s.barcode?.toLowerCase().includes(historySearch.toLowerCase()) ||
      s.test_name?.toLowerCase().includes(historySearch.toLowerCase()) ||
      s.first_name?.toLowerCase().includes(historySearch.toLowerCase());

    const matchesDate = historyDate ? new Date(s.updated_at || s.order_time).toISOString().split('T')[0] === historyDate : true;

    return matchesStatus && matchesSearch && matchesDate;
  }).sort((a, b) => new Date(b.updated_at || b.order_time).getTime() - new Date(a.updated_at || a.order_time).getTime());

  return (
    <AppLayout>
      {promptDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
        <PageHeader title="Lab Reception & QC" icon={<ShieldCheck />} className="mb-3" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-0">

          {/* LEFT: Incoming for QC */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-muted/30">
              <h3 className="font-medium flex items-center gap-2">
                <Box className="w-4 h-4" /> Incoming Deliveries (Awaiting QC)
                <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full text-xs">{incomingQueue.length}</span>
              </h3>
              <div className="flex items-center gap-1.5">
                {incomingQueue.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                    onClick={handleAcceptAll}
                    disabled={bulkAccepting}
                    title="Accept every specimen below at once — for peak-traffic batches"
                  >
                    {bulkAccepting ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-2" />}
                    Accept All ({incomingQueue.length})
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={fetchSpecimens} disabled={loading} className="h-8">
                  <RefreshCw className={cn("w-3.5 h-3.5 mr-2", loading && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            </div>
            
            <div className="flex-1 overflow-auto p-4 space-y-3 bg-card">
              {incomingQueue.length > 0 ? incomingQueue.map(s => (
                <div key={s.id} className="bg-background border rounded-lg p-2.5 shadow-sm flex justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium font-mono text-primary text-sm truncate mb-1">{s.barcode}</h4>
                    <p className="text-xs text-muted-foreground truncate mb-0.5">{s.first_name} {s.last_name} ({s.participant_number})</p>
                    <div className="text-xs truncate">
                      <span className="font-semibold text-muted-foreground uppercase mr-1">Test:</span>
                      {s.test_name} ({s.test_code})
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-[10px] bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">In Transit</span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200 px-2.5"
                        onClick={() => handleQC(s.id, 'accepted')}
                        disabled={qcProcessingId === s.id}
                      >
                        {qcProcessingId === s.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                        {qcProcessingId === s.id ? 'Accepting...' : 'Accept'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 px-2.5"
                        onClick={() => handleQC(s.id, 'rejected')}
                        disabled={qcProcessingId === s.id}
                      >
                        {qcProcessingId === s.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <X className="w-3.5 h-3.5 mr-1" />}
                        {qcProcessingId === s.id ? 'Rejecting...' : 'Reject'}
                      </Button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm border-2 border-dashed rounded-lg p-8 text-center">
                  No incoming specimens to QC.
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Accepted for Routing */}
          <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-muted/30">
              <h3 className="font-medium flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4" /> Ready for Routing
                <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full text-xs">{routingQueue.length}</span>
              </h3>
              {routingQueue.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={handleRouteAll}
                  disabled={bulkRouting}
                  title="Routes every specimen below to its own selected/default department at once"
                >
                  {bulkRouting ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5 mr-2" />}
                  Route All ({routingQueue.length})
                </Button>
              )}
            </div>
            
            <div className="flex-1 overflow-auto p-4 space-y-3 bg-card">
              {routingQueue.length > 0 ? routingQueue.map(s => (
                <div key={s.id} className="bg-background border rounded-lg p-2.5 shadow-sm border-l-4 border-l-green-500 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium font-mono text-primary text-sm truncate">{s.barcode}</h4>
                    <p className="text-xs truncate text-muted-foreground">{s.test_name}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Combobox
                      options={DEPARTMENT_OPTIONS}
                      value={routeDepartments[s.id] || s.department || ''}
                      onChange={(v) => setRouteDepartments({ ...routeDepartments, [s.id]: v })}
                      placeholder="Dept..."
                      searchPlaceholder="Search..."
                      className="h-7 w-28 text-xs"
                    />
                    <Button size="sm" className="h-7 text-xs px-2" onClick={() => handleRoute(s.id)} disabled={routingId === s.id}>
                      {routingId === s.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                      {routingId === s.id ? 'Routing...' : 'Route'}
                    </Button>
                  </div>
                </div>
              )) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm border-2 border-dashed rounded-lg p-8 text-center">
                  No specimens awaiting routing.
                </div>
              )}
            </div>
          </div>

        </div>

        {/* BOTTOM: QC History */}
        <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden mt-6 flex-1 min-h-0">
          <div className="p-4 border-b bg-muted/30 flex justify-between items-center flex-wrap gap-4">
            <h3 className="font-medium">QC Log & History</h3>
            <div className="flex items-center gap-3">
              <div className="relative w-48">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search barcode, test..."
                  className="pl-8 h-9 text-sm"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                />
              </div>
              <div className="relative w-40">
                <Calendar className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  type="date"
                  className="pl-8 h-9 text-sm"
                  value={historyDate}
                  onChange={(e) => setHistoryDate(e.target.value)}
                />
              </div>
              <div className="relative w-40">
                <Filter className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground z-10 pointer-events-none" />
                <Combobox
                  options={HISTORY_STATUS_OPTIONS}
                  value={historyStatus}
                  onChange={(v) => setHistoryStatus(v)}
                  searchPlaceholder="Search..."
                  className="pl-8 h-9 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <AdvancedDataTable<any>
              data={filteredHistory}
              keyExtractor={(s) => s.id}
              loading={loading}
              emptyMessage="No matching records found."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'order_time', header: 'Order Time', sortable: true, render: (v) => <span className="text-muted-foreground">{new Date(v).toLocaleString()}</span> },
                { key: 'barcode', header: 'Barcode ID', sortable: true, render: (v) => <span className="font-mono font-medium text-primary">{v}</span> },
                {
                  key: 'participant_number', header: 'Participant', sortable: true,
                  render: (v, s) => (
                    <>
                      <div className="font-medium">{v}</div>
                      <div className="text-xs text-muted-foreground">{s.first_name} {s.last_name}</div>
                    </>
                  ),
                },
                {
                  key: 'test_name', header: 'Test Details', sortable: true,
                  render: (v, s) => (
                    <>
                      <div className="font-medium">{v}</div>
                      <div className="text-xs text-muted-foreground">{s.department || 'General'}</div>
                    </>
                  ),
                },
                {
                  key: 'status', header: 'QC Status', sortable: true,
                  render: (v) => (
                    <>
                      {v === 'in_transit' && <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full text-xs font-medium">Pending QC</span>}
                      {['accepted', 'routed', 'analyzed', 'approved'].includes(v) && <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs font-medium uppercase">{v}</span>}
                      {['rejected', 'recollection_required'].includes(v) && <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded-full text-xs font-medium uppercase">{v.replace('_', ' ')}</span>}
                    </>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>
      </div>
    </AppLayout>
  );
}
