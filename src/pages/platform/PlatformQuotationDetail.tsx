import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, CheckCircle2, Clock, Copy, CreditCard, Download, FileText, Loader2, Receipt, Save, Send, ServerCog, Trash2 } from 'lucide-react';
import { toast } from '@/lib/notify';
import { buildQuotationHTML } from '@/utils/quotationTemplate';
import { openPrintWindow, downloadDocumentAsPdf } from '@/utils/documentTemplate';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { formatDate } from '@/lib/format';

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
  customer: {
    id: number; name: string; contact_person: string | null; email: string | null; phone: string | null; address: string | null;
    status: 'prospect' | 'converted'; client_id: number | null;
  };
  invoice: { id: number; invoice_number: string; status: 'unpaid' | 'partial' | 'paid' } | null;
}

interface Plan { id: number; name: string; amount: string; billing_period: string; }

interface NewInstanceResult {
  code: string;
  email: string;
  tempPassword: string;
  invoice: { amount: string; billing_period: string; period_end: string } | null;
}

// Derives a starting point for the "Code" field from the customer's own
// name, matching the [a-z][a-z0-9]{2,29} slug POST /clients requires — the
// admin can still edit it before submitting, this just saves typing for the
// common case where the customer's name already makes a sensible slug.
function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
  return /^[a-z]/.test(slug) ? slug : `c${slug}`.slice(0, 30);
}

const STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  draft: 'neutral', sent: 'info', accepted: 'success', expired: 'warning',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

const PlatformQuotationDetail: React.FC = () => {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ currency: '', total_amount: '', deployment_model: 'cloud', concurrent_users: '', training_hours: '', scope_notes: '' });
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Create Instance (turns an accepted quotation's customer into a real,
  // provisioned Client) — same request this panel's Clients page already
  // makes, just pre-filled from the customer/quotation instead of the admin
  // re-typing everything they already told the customer about. ──
  const [plans, setPlans] = useState<Plan[]>([]);
  const [schemaPrefix, setSchemaPrefix] = useState('');
  const [createInstanceOpen, setCreateInstanceOpen] = useState(false);
  const [instanceForm, setInstanceForm] = useState({ name: '', code: '', adminName: '', adminEmail: '', planId: '' });
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [instanceResult, setInstanceResult] = useState<NewInstanceResult | null>(null);

  const loadPlans = async () => {
    try {
      const res = await platformFetch('/plans');
      const data = await res.json();
      if (res.ok) setPlans(data.filter((p: Plan & { is_active: boolean }) => p.is_active));
    } catch {
      // Plan selection is optional — a failed fetch just leaves the picker empty.
    }
  };

  const loadSchemaPrefix = async () => {
    try {
      const res = await platformFetch('/clients/db-name-prefix');
      const data = await res.json();
      if (res.ok) setSchemaPrefix(data.prefix);
    } catch {
      // Purely a UX hint — the create flow still works without it.
    }
  };

  useEffect(() => { loadPlans(); loadSchemaPrefix(); }, []);

  const openCreateInstance = () => {
    if (!quotation) return;
    setInstanceResult(null);
    setInstanceForm({
      name: quotation.customer.name,
      code: slugify(quotation.customer.name),
      adminName: quotation.customer.contact_person || '',
      adminEmail: quotation.customer.email || '',
      planId: '',
    });
    setCreateInstanceOpen(true);
  };

  const handleCreateInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quotation) return;
    setCreatingInstance(true);
    try {
      const res = await platformFetch('/clients', {
        method: 'POST',
        body: JSON.stringify({
          name: instanceForm.name,
          code: instanceForm.code,
          adminName: instanceForm.adminName,
          adminEmail: instanceForm.adminEmail,
          plan_id: instanceForm.planId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create instance');

      // Link the prospect record to the client it just became, so this
      // button turns into "View Client Instance" on every future visit
      // instead of offering to provision a second instance for the same
      // customer.
      try {
        await platformFetch(`/customers/${quotation.customer.id}`, {
          method: 'PUT',
          body: JSON.stringify({ client_id: data.client.id, status: 'converted' }),
        });
      } catch {
        // The instance itself was created successfully — a failure here
        // just means the prospect record's own status stays stale until
        // the next edit; not worth failing the whole action over.
      }

      setInstanceResult({ ...data.credentials, invoice: data.invoice });
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreatingInstance(false);
    }
  };

  const copyInstanceCredentials = () => {
    if (!instanceResult) return;
    const text = `Code: ${instanceResult.code}\nEmail: ${instanceResult.email}\nPassword: ${instanceResult.tempPassword}`;
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const [convertingInvoice, setConvertingInvoice] = useState(false);
  const handleConvertToInvoice = async () => {
    if (!quotation) return;
    setConvertingInvoice(true);
    try {
      const res = await platformFetch('/quotation-invoices', {
        method: 'POST',
        body: JSON.stringify({ quotation_id: quotation.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to convert to invoice');
      toast.success(`Invoice ${data.invoice_number} created`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setConvertingInvoice(false);
    }
  };

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
    if (!(await confirm({ description: 'Delete this draft quotation? This cannot be undone.' }))) return;
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

  const generateDocument = async (mode: 'print' | 'pdf') => {
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
        await downloadDocumentAsPdf(html, `${quotation.quote_number}-${quotation.customer.name}`);
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
      {confirmDialog}
      <PageHeader
        icon={<FileText />}
        title={quotation.quote_number}
        subtitle={`For ${quotation.customer.name}`}
        actions={
          <>
            <Badge variant={STATUS_VARIANT[quotation.status]} className="capitalize text-sm px-3 py-1">{quotation.status}</Badge>
            <Button variant="outline" onClick={() => generateDocument('print')} disabled={downloading}>
              <FileText className="w-4 h-4 mr-1.5" /> Print
            </Button>
            <Button onClick={() => generateDocument('pdf')} disabled={downloading}>
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Download className="w-4 h-4 mr-1.5" /> Download PDF</>}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Issue Date" value={formatDate(quotation.issue_date)} />
              <Field label="Valid Until" value={formatDate(quotation.valid_until)} />
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
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Scope Notes</p>
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
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Customer</p>
              <p className="font-semibold text-foreground">{quotation.customer.name}</p>
              {quotation.customer.contact_person && <p className="text-sm text-muted-foreground">{quotation.customer.contact_person}</p>}
              {quotation.customer.email && <p className="text-sm text-muted-foreground">{quotation.customer.email}</p>}
              {quotation.customer.phone && <p className="text-sm text-muted-foreground">{quotation.customer.phone}</p>}
            </div>

            <div className="pt-4 border-t border-border space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Status</p>
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

            {quotation.status === 'accepted' && (
              <div className="pt-4 border-t border-border space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Instance</p>
                {quotation.customer.status === 'converted' && quotation.customer.client_id ? (
                  <Link to={`/platform-admin/clients/${quotation.customer.client_id}`}>
                    <Button variant="outline" className="w-full gap-1.5">
                      <Building2 className="w-3.5 h-3.5" /> View Client Instance
                    </Button>
                  </Link>
                ) : (
                  <Button className="w-full gap-1.5" onClick={openCreateInstance}>
                    <ServerCog className="w-3.5 h-3.5" /> Create Instance
                  </Button>
                )}
              </div>
            )}

            {quotation.status === 'accepted' && (
              <div className="pt-4 border-t border-border space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Invoice</p>
                {quotation.invoice ? (
                  <Link to={`/platform-admin/invoices/${quotation.invoice.id}`}>
                    <Button variant="outline" className="w-full gap-1.5">
                      <CreditCard className="w-3.5 h-3.5" /> View Invoice ({quotation.invoice.invoice_number})
                    </Button>
                  </Link>
                ) : (
                  <Button variant="outline" className="w-full gap-1.5" onClick={handleConvertToInvoice} disabled={convertingInvoice}>
                    {convertingInvoice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Receipt className="w-3.5 h-3.5" /> Convert to Invoice</>}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Instance — provisions a real tenant for this quotation's
          customer, the same POST /clients this panel's Clients page uses,
          just pre-filled so nothing already known has to be retyped. */}
      <Dialog open={createInstanceOpen} onOpenChange={setCreateInstanceOpen}>
        <DialogContent className="sm:max-w-md">
          {instanceResult ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success" /> Instance created
                </DialogTitle>
              </DialogHeader>
              <div className="px-5 py-4 space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Share these with the client now — the password won't be shown again.
                </p>
                <div className="bg-muted/50 border border-border rounded-lg p-3 font-mono space-y-1 text-foreground">
                  <div>Code: {instanceResult.code}</div>
                  <div>Email: {instanceResult.email}</div>
                  <div>Password: {instanceResult.tempPassword}</div>
                </div>
                {instanceResult.invoice && (
                  <p className="text-muted-foreground">
                    First invoice created: <span className="text-primary font-semibold">${Number(instanceResult.invoice.amount).toFixed(2)}</span>{' '}
                    ({instanceResult.invoice.billing_period}), due by {formatDate(instanceResult.invoice.period_end)}.
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={copyInstanceCredentials}>
                  <Copy className="w-4 h-4 mr-1.5" /> Copy
                </Button>
                <Button onClick={() => setCreateInstanceOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create Instance</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateInstance}>
                <div className="px-5 py-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label>Company Name</Label>
                    <Input
                      value={instanceForm.name}
                      onChange={(e) => setInstanceForm({ ...instanceForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Code (used to log in — e.g. nationmc)</Label>
                    <Input
                      value={instanceForm.code}
                      onChange={(e) => setInstanceForm({ ...instanceForm, code: e.target.value.toLowerCase() })}
                      required
                      pattern="[a-z][a-z0-9]{2,29}"
                      className="font-mono"
                    />
                    {schemaPrefix && instanceForm.code && (
                      <p className="text-xs text-muted-foreground">
                        Gets its own isolated schema:{' '}
                        <span className="font-mono text-foreground">{schemaPrefix}{instanceForm.code}</span>
                        {' '}— created automatically.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Admin Name</Label>
                    <Input
                      value={instanceForm.adminName}
                      onChange={(e) => setInstanceForm({ ...instanceForm, adminName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Admin Email</Label>
                    <Input
                      type="email"
                      value={instanceForm.adminEmail}
                      onChange={(e) => setInstanceForm({ ...instanceForm, adminEmail: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Subscription Plan</Label>
                    <Select value={instanceForm.planId} onValueChange={(v) => setInstanceForm({ ...instanceForm, planId: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="No plan (bill manually later)" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name} — ${p.amount} / {p.billing_period}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Creates the first invoice immediately. The client is suspended automatically if it lapses unpaid.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateInstanceOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={creatingInstance}>
                    {creatingInstance ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PlatformAppLayout>
  );
};

export default PlatformQuotationDetail;
