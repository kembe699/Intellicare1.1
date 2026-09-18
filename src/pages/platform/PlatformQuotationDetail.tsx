import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Download, FileText, Loader2, Save, Send, CheckCircle2, Clock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { buildQuotationHTML } from '@/utils/quotationTemplate';
import { openPrintWindow, downloadDocument } from '@/utils/documentTemplate';

interface QuotationDetail {
  id: number;
  quote_number: string;
  issue_date: string;
  valid_until: string;
  currency: string;
  total_amount: string;
  deployment_model: 'cloud' | 'on_premise';
  concurrent_users: number | null;
  training_hours: number;
  scope_notes: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'expired';
  customer: { id: number; name: string; contact_person: string | null; email: string | null; phone: string | null; address: string | null };
}

const STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  draft: 'neutral', sent: 'info', accepted: 'success', expired: 'warning',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

const PlatformQuotationDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ currency: '', total_amount: '', deployment_model: 'cloud', concurrent_users: '', training_hours: '', scope_notes: '' });
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformFetch(`/quotations/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load quotation');
      setQuotation(data);
      setEditForm({
        currency: data.currency, total_amount: data.total_amount, deployment_model: data.deployment_model,
        concurrent_users: data.concurrent_users ? String(data.concurrent_users) : '', training_hours: String(data.training_hours),
        scope_notes: data.scope_notes || '',
      });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await platformFetch(`/quotations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...editForm,
          total_amount: Number(editForm.total_amount),
          concurrent_users: editForm.concurrent_users ? Number(editForm.concurrent_users) : null,
          training_hours: Number(editForm.training_hours),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update quotation');
      toast.success('Quotation updated');
      setEditing(false);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: string) => {
    try {
      const res = await platformFetch(`/quotations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      toast.success(`Marked as ${status}`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this draft quotation? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await platformFetch(`/quotations/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete quotation');
      toast.success('Quotation deleted');
      navigate('/platform-admin/quotations');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const generateDocument = async (mode: 'print' | 'download') => {
    if (!quotation) return;
    setDownloading(true);
    try {
      const res = await platformFetch('/company-profile');
      const company = await res.json();
      if (!res.ok) throw new Error(company.error || 'Failed to load company profile');
      const html = buildQuotationHTML(quotation, quotation.customer, company);
      if (mode === 'print') {
        const pw = openPrintWindow(html);
        if (!pw) toast.error('Please allow popups to generate the quotation');
      } else {
        downloadDocument(html, `${quotation.quote_number}-${quotation.customer.name}`);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <PlatformAppLayout><LoadingState message="Loading quotation..." /></PlatformAppLayout>;
  if (!quotation) return <PlatformAppLayout><div className="p-12 text-center text-muted-foreground">Quotation not found</div></PlatformAppLayout>;

  return (
    <PlatformAppLayout>
      <PageHeader
        icon={<FileText />}
        title={quotation.quote_number}
        subtitle={`For ${quotation.customer.name}`}
        actions={
          <>
            <Badge variant={STATUS_VARIANT[quotation.status]} className="capitalize text-sm px-3 py-1">{quotation.status}</Badge>
            <Button variant="outline" onClick={() => generateDocument('download')} disabled={downloading}>
              <Download className="w-4 h-4 mr-1.5" /> Download
            </Button>
            <Button onClick={() => generateDocument('print')} disabled={downloading}>
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><FileText className="w-4 h-4 mr-1.5" /> Print / Download PDF</>}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Issue Date" value={new Date(quotation.issue_date).toLocaleDateString()} />
              <Field label="Valid Until" value={new Date(quotation.valid_until).toLocaleDateString()} />
              <Field label="Deployment" value={quotation.deployment_model === 'cloud' ? 'Cloud (SaaS)' : 'On-Premise'} />
              <Field label="Training" value={`${quotation.training_hours} hours`} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-border">
              <Field label="Concurrent Users" value={quotation.concurrent_users || '—'} />
              <Field label="Currency" value={quotation.currency} />
              <Field label="Total Amount" value={<span className="text-primary font-semibold">{quotation.currency} {Number(quotation.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>} />
            </div>
            {quotation.scope_notes && (
              <div className="pt-4 border-t border-border">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Scope Notes</p>
                <p className="text-sm text-foreground mt-0.5">{quotation.scope_notes}</p>
              </div>
            )}

            {quotation.status === 'draft' && (
              <div className="pt-4 border-t border-border">
                {editing ? (
                  <form onSubmit={handleSaveEdit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label>Currency</Label>
                        <Input value={editForm.currency} onChange={(e) => setEditForm({ ...editForm, currency: e.target.value.toUpperCase() })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Total Amount</Label>
                        <Input type="number" min="0" step="0.01" value={editForm.total_amount} onChange={(e) => setEditForm({ ...editForm, total_amount: e.target.value })} required />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Deployment Model</Label>
                      <Select value={editForm.deployment_model} onValueChange={(v) => setEditForm({ ...editForm, deployment_model: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cloud">Cloud (SaaS)</SelectItem>
                          <SelectItem value="on_premise">On-Premise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label>Concurrent Users</Label>
                        <Input type="number" min="1" value={editForm.concurrent_users} onChange={(e) => setEditForm({ ...editForm, concurrent_users: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Training Hours</Label>
                        <Input type="number" min="0" value={editForm.training_hours} onChange={(e) => setEditForm({ ...editForm, training_hours: e.target.value })} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Scope Notes</Label>
                      <Textarea rows={3} value={editForm.scope_notes} onChange={(e) => setEditForm({ ...editForm, scope_notes: e.target.value })} />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={saving} className="gap-1.5">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Changes</>}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <Button variant="outline" onClick={() => setEditing(true)}>Edit Quotation</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-5">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Customer</p>
              <p className="font-semibold text-foreground">{quotation.customer.name}</p>
              {quotation.customer.contact_person && <p className="text-sm text-muted-foreground">{quotation.customer.contact_person}</p>}
              {quotation.customer.email && <p className="text-sm text-muted-foreground">{quotation.customer.email}</p>}
              {quotation.customer.phone && <p className="text-sm text-muted-foreground">{quotation.customer.phone}</p>}
            </div>

            <div className="pt-4 border-t border-border space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Status</p>
              {quotation.status === 'draft' && (
                <Button variant="outline" className="w-full gap-1.5" onClick={() => changeStatus('sent')}>
                  <Send className="w-3.5 h-3.5" /> Mark as Sent
                </Button>
              )}
              {quotation.status === 'sent' && (
                <Button variant="outline" className="w-full gap-1.5" onClick={() => changeStatus('accepted')}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Mark as Accepted
                </Button>
              )}
              {(quotation.status === 'sent' || quotation.status === 'draft') && (
                <Button variant="outline" className="w-full gap-1.5" onClick={() => changeStatus('expired')}>
                  <Clock className="w-3.5 h-3.5" /> Mark as Expired
                </Button>
              )}
              {quotation.status === 'draft' && (
                <Button
                  variant="outline"
                  className="w-full gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Trash2 className="w-3.5 h-3.5" /> Delete Draft</>}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </PlatformAppLayout>
  );
};

export default PlatformQuotationDetail;
