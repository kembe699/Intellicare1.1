import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Plus, FileText, Eye } from 'lucide-react';
import { toast } from '@/lib/notify';

interface Customer { id: number; name: string; }
interface QuotationRow {
  id: number;
  quote_number: string;
  currency: string;
  total_amount: string;
  status: 'draft' | 'sent' | 'accepted' | 'expired';
  valid_until: string;
  created_at: string;
  customer: { id: number; name: string };
}

const STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  draft: 'neutral', sent: 'info', accepted: 'success', expired: 'warning',
};

const emptyForm = {
  customer_id: '', currency: 'USD', total_amount: '', deployment_model: 'cloud',
  concurrent_users: '', training_hours: '20', scope_notes: '',
};

const PlatformQuotations: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', email: '', phone: '' });
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const loadQuotations = async () => {
    setLoading(true);
    try {
      const res = await platformFetch('/quotations');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load quotations');
      setQuotations(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomers = async () => {
    try {
      const res = await platformFetch('/customers');
      const data = await res.json();
      if (res.ok) setCustomers(data);
    } catch {
      // Customer list is only needed to populate the picker — a failed
      // fetch just leaves it empty, the rest of the page still works.
    }
  };

  useEffect(() => {
    loadQuotations();
    loadCustomers();
    const preselect = searchParams.get('customer_id');
    if (preselect) setForm((f) => ({ ...f, customer_id: preselect }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id) { toast.error('Select a customer'); return; }
    setSaving(true);
    try {
      const res = await platformFetch('/quotations', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          total_amount: Number(form.total_amount),
          concurrent_users: form.concurrent_users ? Number(form.concurrent_users) : null,
          training_hours: Number(form.training_hours),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create quotation');
      toast.success(`Quotation ${data.quote_number} created`);
      setForm({ ...emptyForm, customer_id: form.customer_id });
      await loadQuotations();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingCustomer(true);
    try {
      const res = await platformFetch('/customers', { method: 'POST', body: JSON.stringify(newCustomerForm) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create customer');
      toast.success('Customer registered');
      setNewCustomerOpen(false);
      setNewCustomerForm({ name: '', email: '', phone: '' });
      await loadCustomers();
      setForm((f) => ({ ...f, customer_id: String(data.id) }));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreatingCustomer(false);
    }
  };

  const customerOptions = customers.map((c) => ({ value: String(c.id), label: c.name }));

  return (
    <PlatformAppLayout>
      <PageHeader
        icon={<FileText />}
        title="Quotations"
        subtitle="Generate a priced quotation for a customer, then download it as a printable document"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden lg:sticky lg:top-4 h-fit">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" /> New Quotation
            </h3>
          </div>
          <form onSubmit={handleCreate} className="p-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Combobox
                options={customerOptions}
                value={form.customer_id}
                onChange={(v) => setForm({ ...form, customer_id: v })}
                placeholder="Select customer *"
                searchPlaceholder="Search customers..."
                emptyText="No matching customers"
              />
              <button
                type="button"
                onClick={() => setNewCustomerOpen(true)}
                className="text-xs text-primary hover:underline"
              >
                + New Customer
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Input
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  placeholder="USD"
                  maxLength={10}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Total Amount</Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={form.total_amount}
                  onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Deployment Model</Label>
              <Select value={form.deployment_model} onValueChange={(v) => setForm({ ...form, deployment_model: v })}>
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
                <Input
                  type="number" min="1"
                  value={form.concurrent_users}
                  onChange={(e) => setForm({ ...form, concurrent_users: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Training Hours</Label>
                <Input
                  type="number" min="0"
                  value={form.training_hours}
                  onChange={(e) => setForm({ ...form, training_hours: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Scope Notes (optional)</Label>
              <Textarea
                rows={3}
                value={form.scope_notes}
                onChange={(e) => setForm({ ...form, scope_notes: e.target.value })}
                placeholder="Anything specific to this deal — extra branches, custom reports, etc."
              />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1.5" /> Create Quotation</>}
            </Button>
          </form>
        </div>

        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden h-fit">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Quote #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell></TableRow>
              ) : quotations.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No quotations yet
                </TableCell></TableRow>
              ) : quotations.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-mono text-sm text-foreground">{q.quote_number}</TableCell>
                  <TableCell className="font-medium text-foreground">{q.customer?.name}</TableCell>
                  <TableCell className="text-primary font-semibold">{q.currency} {Number(q.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[q.status]} className="capitalize">{q.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{new Date(q.valid_until).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Link to={`/platform-admin/quotations/${q.id}`}>
                      <Button variant="outline" size="sm"><Eye className="w-3.5 h-3.5 mr-1.5" /> View</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateCustomer}>
            <div className="px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <Label>Organization / Hospital Name</Label>
                <Input value={newCustomerForm.name} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={newCustomerForm.email} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewCustomerOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creatingCustomer}>
                {creatingCustomer ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PlatformAppLayout>
  );
};

export default PlatformQuotations;
