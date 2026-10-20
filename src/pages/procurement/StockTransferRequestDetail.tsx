import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { getStatusColor } from '@/lib/statusColors';
import { toast } from '@/lib/notify';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { usePromptDialog } from '@/hooks/use-prompt-dialog';
import { ArrowLeft, ArrowRightLeft, Check, X, Trash2, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/format';

interface DetailLine {
  id: string;
  item_name: string;
  item_code: string;
  unit_of_measure: string;
  quantity_requested: number;
  quantity_fulfilled: number;
}

interface RequestDetail {
  id: string;
  transfer_number: string;
  from_location_name: string;
  to_location_name: string;
  requested_by: number;
  requested_by_name: string;
  approved_by_name: string | null;
  status: string;
  notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  items: DetailLine[];
}

export default function StockTransferRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { prompt, promptDialog } = usePromptDialog();

  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/stock-transfers/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load request');
      setDetail(await res.json());
    } catch (error: any) {
      toast.error(error.message || 'Failed to load request');
      navigate('/procurement/stock-transfers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const approve = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: 'Approve & move stock?',
      description: `This will move the requested items out of ${detail.from_location_name} into ${detail.to_location_name} right away.`,
    });
    if (!ok) return;
    setProcessing(true);
    try {
      const res = await authFetch(`/api/stock-transfers/${detail.id}/approve`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to approve');
      toast.success('Request approved — stock moved');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve request');
    } finally {
      setProcessing(false);
    }
  };

  const reject = async () => {
    if (!detail) return;
    const reason = await prompt({ title: 'Reject request', description: 'Reason for rejecting this transfer request', placeholder: 'Why is this being rejected?' });
    if (reason === null) return;
    setProcessing(true);
    try {
      const res = await authFetch(`/api/stock-transfers/${detail.id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ rejection_reason: reason }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to reject');
      toast.success('Request rejected');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject request');
    } finally {
      setProcessing(false);
    }
  };

  const cancel = async () => {
    if (!detail) return;
    const ok = await confirm({ title: 'Cancel this request?', description: 'This cannot be undone.' });
    if (!ok) return;
    setProcessing(true);
    try {
      const res = await authFetch(`/api/stock-transfers/${detail.id}/cancel`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to cancel');
      toast.success('Request cancelled');
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel request');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6"><LoadingState message="Loading request..." /></div>
      </AppLayout>
    );
  }

  if (!detail) return null;

  const canCancel = String(detail.requested_by) === String(user?.id) || user?.role === 'admin';

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)]">
        <div className="max-w-3xl mx-auto w-full">
          <PageHeader
            title={detail.transfer_number}
            icon={<ArrowRightLeft />}
            className="mb-3"
            breadcrumbs={[
              { label: 'Stock Transfer Requests', href: '/procurement/stock-transfers' },
              { label: detail.transfer_number },
            ]}
            actions={
              <Button variant="outline" onClick={() => navigate('/procurement/stock-transfers')}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to List
              </Button>
            }
          />

          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">{detail.from_location_name}</span>
                <ArrowRightLeft className="inline w-3.5 h-3.5 mx-2 text-muted-foreground" />
                <span className="font-medium">{detail.to_location_name}</span>
              </div>
              <Badge className={getStatusColor(detail.status)}>{detail.status.replace('_', ' ')}</Badge>
            </div>

            <div className="p-4 space-y-3">
              <div className="text-sm text-muted-foreground">
                Requested by {detail.requested_by_name || '—'} on {detail.created_at ? formatDate(detail.created_at) : '—'}
                {detail.approved_by_name && ` · ${detail.status === 'rejected' ? 'Rejected' : 'Approved'} by ${detail.approved_by_name}`}
              </div>
              {detail.notes && <p className="text-sm">{detail.notes}</p>}
              {detail.rejection_reason && <p className="text-sm text-red-600">Reason: {detail.rejection_reason}</p>}

              <div className="border rounded-lg divide-y">
                {detail.items?.map((line) => (
                  <div key={line.id} className="px-3 py-2.5 flex justify-between items-center text-sm">
                    <div>
                      <p className="font-medium">{line.item_name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{line.item_code}</p>
                    </div>
                    <div className="text-right">
                      <p>{Number(line.quantity_requested).toLocaleString()} {line.unit_of_measure}</p>
                      {Number(line.quantity_fulfilled) > 0 && (
                        <p className="text-xs text-green-600">{Number(line.quantity_fulfilled).toLocaleString()} moved</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {detail.status === 'pending' && (
              <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
                {canCancel && (
                  <Button variant="outline" onClick={cancel} disabled={processing}>Cancel</Button>
                )}
                <Button variant="outline" className="text-red-600" onClick={reject} disabled={processing}>
                  <X className="w-4 h-4 mr-2" /> Reject
                </Button>
                <Button onClick={approve} disabled={processing}>
                  {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  Approve & Move Stock
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmDialog}
      {promptDialog}
    </AppLayout>
  );
}
