import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { CalendarDays, Plus, Loader2, Check, Search, X } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface LeaveRequest {
  id: string; employee_id: string; first_name: string; last_name: string; employee_number: string;
  leave_type_id: string; leave_type_name: string; start_date: string; end_date: string; days: number;
  reason?: string; status: string; rejection_reason?: string;
}

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral',
};

const today = () => new Date().toISOString().split('T')[0];

export default function LeaveManagement() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [tab, setTab] = useState('requests');
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ employee_id: '', leave_type_id: '', start_date: today(), end_date: today(), reason: '' });

  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ── Employee lookup tab ──
  const [lookupEmployeeId, setLookupEmployeeId] = useState('');
  const [lookupYear, setLookupYear] = useState(new Date().getFullYear());
  const [lookupData, setLookupData] = useState<any>(null);
  const [loadingLookup, setLoadingLookup] = useState(false);

  const fetchRequests = async () => {
    setLoadingRequests(true);
    try {
      const url = statusFilter === 'all' ? '/api/hr/leave/requests' : `/api/hr/leave/requests?status=${statusFilter}`;
      const res = await authFetch(url);
      if (res.ok) setRequests(await res.json());
      else toast.error('Failed to load leave requests');
    } catch (e) {
      toast.error('Failed to load leave requests');
    } finally {
      setLoadingRequests(false);
    }
  };

  const fetchLeaveTypes = async () => {
    try {
      const res = await authFetch('/api/hr/leave/types');
      if (res.ok) setLeaveTypes(await res.json());
    } catch (e) { /* non-blocking */ }
  };

  const fetchEmployees = async () => {
    try {
      const res = await authFetch('/api/hr/employees?status=active');
      if (res.ok) setEmployees(await res.json());
    } catch (e) { /* non-blocking */ }
  };

  useEffect(() => { fetchLeaveTypes(); fetchEmployees(); }, []);
  useEffect(() => { if (tab === 'requests') fetchRequests(); }, [tab, statusFilter]);

  const days = (() => {
    if (!createForm.start_date || !createForm.end_date) return 0;
    const s = new Date(createForm.start_date); const e = new Date(createForm.end_date);
    const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    return diff > 0 ? diff : 0;
  })();

  const handleCreate = async () => {
    if (creating) return;
    if (!createForm.employee_id || !createForm.leave_type_id) { toast.error('Select an employee and leave type'); return; }
    if (createForm.end_date < createForm.start_date) { toast.error('End date must be on or after the start date'); return; }
    setCreating(true);
    try {
      const res = await authFetch('/api/hr/leave/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createForm),
      });
      if (res.ok) {
        toast.success('Leave request created');
        setShowCreate(false);
        setCreateForm({ employee_id: '', leave_type_id: '', start_date: today(), end_date: today(), reason: '' });
        fetchRequests();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to create leave request');
      }
    } catch (e) {
      toast.error('Network error');
    } finally {
      setCreating(false);
    }
  };

  const handleApprove = async (r: LeaveRequest) => {
    try {
      const res = await authFetch(`/api/hr/leave/requests/${r.id}/approve`, { method: 'POST' });
      if (res.ok) { toast.success('Leave request approved'); fetchRequests(); }
      else toast.error('Failed to approve');
    } catch (e) { toast.error('Failed to approve'); }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    try {
      const res = await authFetch(`/api/hr/leave/requests/${rejectTarget.id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: rejectReason }),
      });
      if (res.ok) { toast.success('Leave request rejected'); setRejectTarget(null); setRejectReason(''); fetchRequests(); }
      else toast.error('Failed to reject');
    } catch (e) { toast.error('Failed to reject'); }
  };

  const handleCancel = async (r: LeaveRequest) => {
    if (!(await confirm({ description: `Cancel this leave request for ${r.first_name} ${r.last_name}?` }))) return;
    try {
      const res = await authFetch(`/api/hr/leave/requests/${r.id}/cancel`, { method: 'POST' });
      if (res.ok) { toast.success('Leave request cancelled'); fetchRequests(); }
      else toast.error('Failed to cancel');
    } catch (e) { toast.error('Failed to cancel'); }
  };

  const fetchLookup = async (employeeId: string, year: number) => {
    if (!employeeId) return;
    setLoadingLookup(true);
    try {
      const res = await authFetch(`/api/hr/leave/employees/${employeeId}/summary?year=${year}`);
      if (res.ok) setLookupData(await res.json());
      else toast.error('Failed to load leave summary');
    } catch (e) {
      toast.error('Failed to load leave summary');
    } finally {
      setLoadingLookup(false);
    }
  };

  useEffect(() => { if (lookupEmployeeId) fetchLookup(lookupEmployeeId, lookupYear); }, [lookupEmployeeId, lookupYear]);

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full">
        <PageHeader
          icon={<CalendarDays />}
          title="Leave"
          subtitle="Leave requests, approvals, and employee leave balances"
          actions={tab === 'requests' ? <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-2" /> New Leave Request</Button> : undefined}
        />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="requests">Requests &amp; Approvals</TabsTrigger>
            <TabsTrigger value="lookup">Employee Lookup</TabsTrigger>
          </TabsList>

          <TabsContent value="requests" className="mt-4">
            <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
              <div className="p-4 border-b flex justify-between items-center bg-muted/30 flex-wrap gap-3">
                <h3 className="font-medium">Leave Requests</h3>
                <Combobox
                  options={[{ value: 'all', label: 'All Status' }, { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'cancelled', label: 'Cancelled' }]}
                  value={statusFilter} onChange={setStatusFilter} searchPlaceholder="Search..." className="w-[160px] h-9"
                />
              </div>
              <div className="p-4">
                <AdvancedDataTable<LeaveRequest>
                  data={requests}
                  keyExtractor={(r) => r.id}
                  loading={loadingRequests}
                  emptyMessage="No leave requests yet."
                  pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                  columns={[
                    { key: 'first_name', header: 'Employee', render: (_v, r) => <span className="font-medium">{r.first_name} {r.last_name}</span> },
                    { key: 'leave_type_name', header: 'Type' },
                    { key: 'start_date', header: 'Period', render: (_v, r) => <span className="text-xs">{new Date(r.start_date).toLocaleDateString()} – {new Date(r.end_date).toLocaleDateString()}</span> },
                    { key: 'days', header: 'Days', align: 'center' },
                    { key: 'reason', header: 'Reason', render: (v) => v || '—' },
                    { key: 'status', header: 'Status', align: 'center', render: (v) => <StatusBadge status={v} label={v} map={STATUS_TONE} /> },
                    {
                      key: '__actions', header: 'Actions', align: 'center',
                      render: (_v, r) => (
                        <div className="flex items-center justify-center gap-1">
                          {r.status === 'pending' && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleApprove(r)}>Approve</Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={() => { setRejectTarget(r); setRejectReason(''); }}>Reject</Button>
                            </>
                          )}
                          {(r.status === 'pending' || r.status === 'approved') && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleCancel(r)}>Cancel</Button>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="lookup" className="mt-4">
            <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-72">
                  <Label className="text-xs font-medium text-muted-foreground">Employee</Label>
                  <Combobox
                    options={employees.map((e: any) => ({ value: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})` }))}
                    value={lookupEmployeeId} onChange={setLookupEmployeeId}
                    placeholder="Search employee..." searchPlaceholder="Search employees..." className="mt-1"
                  />
                </div>
                <div className="w-32">
                  <Label className="text-xs font-medium text-muted-foreground">Year</Label>
                  <Combobox
                    options={[lookupYear - 1, lookupYear, lookupYear + 1].map(y => ({ value: String(y), label: String(y) }))}
                    value={String(lookupYear)} onChange={v => setLookupYear(parseInt(v, 10))}
                    searchPlaceholder="Search..." className="mt-1"
                  />
                </div>
              </div>

              {!lookupEmployeeId ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Search for an employee above to see their leave balance.</p>
              ) : loadingLookup ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
              ) : lookupData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {lookupData.summary.map((s: any) => (
                      <div key={s.leave_type_id} className="border rounded-lg p-4 bg-muted/20">
                        <p className="text-sm font-semibold mb-2">{s.leave_type_name}</p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div><p className="text-xs text-muted-foreground">Entitled</p><p className="font-mono font-bold">{s.entitled_days}</p></div>
                          <div><p className="text-xs text-muted-foreground">Taken</p><p className="font-mono font-bold text-amber-700">{s.taken_days}</p></div>
                          <div><p className="text-xs text-muted-foreground">Remaining</p><p className="font-mono font-bold text-emerald-700">{s.remaining_days}</p></div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Leave History</p>
                    {lookupData.history.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No leave requests on record.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                          <tr className="text-left text-muted-foreground text-xs">
                            <th className="px-3 py-2 font-medium">Type</th>
                            <th className="px-3 py-2 font-medium">Period</th>
                            <th className="px-3 py-2 font-medium text-center">Days</th>
                            <th className="px-3 py-2 font-medium text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {lookupData.history.map((h: any) => (
                            <tr key={h.id}>
                              <td className="px-3 py-2">{h.leave_type_name}</td>
                              <td className="px-3 py-2 text-xs">{new Date(h.start_date).toLocaleDateString()} – {new Date(h.end_date).toLocaleDateString()}</td>
                              <td className="px-3 py-2 text-center">{h.days}</td>
                              <td className="px-3 py-2 text-center"><StatusBadge status={h.status} label={h.status} map={STATUS_TONE} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Leave Request</DialogTitle>
            <DialogDescription>Creates a pending request — approve or reject it from the list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-6 pt-2">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Employee</Label>
              <Combobox
                options={employees.map((e: any) => ({ value: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})` }))}
                value={createForm.employee_id} onChange={v => setCreateForm({ ...createForm, employee_id: v })}
                placeholder="Select employee..." searchPlaceholder="Search employees..." className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Leave Type</Label>
              <Combobox
                options={leaveTypes.map((t: any) => ({ value: t.id, label: `${t.name} (${t.default_annual_days}/yr)` }))}
                value={createForm.leave_type_id} onChange={v => setCreateForm({ ...createForm, leave_type_id: v })}
                placeholder="Select type..." searchPlaceholder="Search..." className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Start Date</Label>
                <Input type="date" className="mt-1" value={createForm.start_date} onChange={e => setCreateForm({ ...createForm, start_date: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">End Date</Label>
                <Input type="date" className="mt-1" min={createForm.start_date} value={createForm.end_date} onChange={e => setCreateForm({ ...createForm, end_date: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{days} day{days === 1 ? '' : 's'} (calendar days, inclusive)</p>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Reason</Label>
              <Textarea className="mt-1" rows={2} value={createForm.reason} onChange={e => setCreateForm({ ...createForm, reason: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Submit Request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Leave Request</DialogTitle>
            <DialogDescription>{rejectTarget && `${rejectTarget.first_name} ${rejectTarget.last_name} — ${rejectTarget.leave_type_name}`}</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 pt-2 space-y-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Reason (optional)</Label>
              <Textarea className="mt-1" rows={2} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRejectTarget(null)}>Cancel</Button>
              <Button size="sm" variant="destructive" onClick={handleReject}>
                <X className="w-4 h-4 mr-2" /> Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </AppLayout>
  );
}
