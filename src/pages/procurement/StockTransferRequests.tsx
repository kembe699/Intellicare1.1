import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { getStatusColor } from '@/lib/statusColors';
import { toast } from '@/lib/notify';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { usePromptDialog } from '@/hooks/use-prompt-dialog';
import { ArrowRightLeft, Plus, Package, Check, X, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { formatDate } from '@/lib/format';

interface TransferRequest {
  id: string;
  transfer_number: string;
  from_location_name: string;
  to_location_name: string;
  requested_by: number;
  requested_by_name: string;
  status: string;
  item_count: number;
  created_at: string;
}

export default function StockTransferRequests() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { prompt, promptDialog } = usePromptDialog();

  const [requests, setRequests] = useState<TransferRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/stock-transfers', { credentials: 'include' });
      if (res.ok) setRequests(await res.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to load stock transfer requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const approve = async (row: TransferRequest) => {
    const ok = await confirm({
      title: 'Approve & move stock?',
      description: `This will move the requested items out of ${row.from_location_name} into ${row.to_location_name} right away.`,
    });
    if (!ok) return;
    setProcessingId(row.id);
    try {
      const res = await authFetch(`/api/stock-transfers/${row.id}/approve`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to approve');
      toast.success('Request approved — stock moved');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve request');
    } finally {
      setProcessingId(null);
    }
  };

  const reject = async (row: TransferRequest) => {
    const reason = await prompt({ title: 'Reject request', description: 'Reason for rejecting this transfer request', placeholder: 'Why is this being rejected?' });
    if (reason === null) return;
    setProcessingId(row.id);
    try {
      const res = await authFetch(`/api/stock-transfers/${row.id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ rejection_reason: reason }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to reject');
      toast.success('Request rejected');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject request');
    } finally {
      setProcessingId(null);
    }
  };

  const cancel = async (row: TransferRequest) => {
    const ok = await confirm({ title: 'Cancel this request?', description: 'This cannot be undone.' });
    if (!ok) return;
    setProcessingId(row.id);
    try {
      const res = await authFetch(`/api/stock-transfers/${row.id}/cancel`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to cancel');
      toast.success('Request cancelled');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel request');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="max-w-[1600px] mx-auto w-full h-[calc(100vh-64px)] flex flex-col">
          <PageHeader
            title="Stock Transfer Requests"
            icon={<ArrowRightLeft />}
            className="mb-3"
            actions={
              <>
                <Button variant="outline" onClick={() => navigate('/procurement/stock-transfers/stock')}>
                  <Package className="w-4 h-4 mr-2" /> View Store Stock
                </Button>
                <Button onClick={() => navigate('/procurement/stock-transfers/new')}>
                  <Plus className="w-4 h-4 mr-2" /> New Transfer Request
                </Button>
              </>
            }
          />
          <p className="text-sm text-muted-foreground -mt-2 mb-3">
            Request items from another store when your own has run out. Once approved by that store, the items move straight in.
          </p>

          <div className="flex-1 min-h-0">
            <AdvancedDataTable<TransferRequest>
              data={requests}
              loading={loading}
              loadingMessage="Loading stock transfer requests..."
              emptyMessage="No stock transfer requests yet."
              keyExtractor={(row) => row.id}
              searchable
              searchPlaceholder="Search..."
              pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
              toolbarExtra={
                <Button variant="outline" size="icon" aria-label="Refresh" className="h-9 w-9" onClick={load} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              }
              onRowClick={(row) => navigate(`/procurement/stock-transfers/${row.id}`)}
              columns={[
                { key: 'transfer_number', header: 'Request #', sortable: true, render: (v) => <span className="font-mono text-sm">{v}</span> },
                { key: 'from_location_name', header: 'From', render: (v) => v || '—' },
                { key: 'to_location_name', header: 'To', render: (v) => v || '—' },
                { key: 'requested_by_name', header: 'Requested By', render: (v) => v || '—' },
                { key: 'item_count', header: 'Items', align: 'right' },
                { key: 'status', header: 'Status', render: (v) => <Badge className={getStatusColor(v)}>{String(v).replace('_', ' ')}</Badge> },
                { key: 'created_at', header: 'Date', sortable: true, render: (v) => v ? formatDate(v) : '—' },
                {
                  key: 'id', header: 'Actions', align: 'center',
                  render: (_v, row) => (
                    row.status === 'pending' ? (
                      <div className="flex items-center justify-center gap-1">
                        <Button size="sm" variant="ghost" disabled={processingId === row.id} onClick={(e) => { e.stopPropagation(); approve(row); }}>
                          {processingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-success" />}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={processingId === row.id} onClick={(e) => { e.stopPropagation(); reject(row); }}>
                          <X className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                        {(String(row.requested_by) === String(user?.id) || user?.role === 'admin') && (
                          <Button size="sm" variant="ghost" disabled={processingId === row.id} onClick={(e) => { e.stopPropagation(); cancel(row); }}>
                            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    ) : <span className="text-xs text-muted-foreground block text-center">—</span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>

      {confirmDialog}
      {promptDialog}
    </AppLayout>
  );
}
