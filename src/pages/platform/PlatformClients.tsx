import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Loader2, Plus, Copy, CheckCircle2, Building2, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from '@/lib/notify';
import { formatDate } from '@/lib/format';

interface ClientRow {
  id: number;
  name: string;
  code: string;
  status: 'active' | 'suspended';
  admin_email: string;
  outstandingAmount: number;
  created_at: string;
  periodEnd: string | null;
  daysUntilExpiry: number | null;
  isCovered: boolean;
}

function expiryTone(days: number): 'destructive' | 'warning' | 'success' {
  if (days <= 3) return 'destructive';
  if (days <= 7) return 'warning';
  return 'success';
}

interface Plan {
  id: number;
  name: string;
  amount: string;
  billing_period: string;
  is_active: boolean;
}

interface NewClientResult {
  code: string;
  email: string;
  tempPassword: string;
  invoice: { amount: string; billing_period: string; period_end: string } | null;
}

const PlatformClients: React.FC = () => {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', adminName: '', adminEmail: '', planId: '' });
  const [result, setResult] = useState<NewClientResult | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [schemaPrefix, setSchemaPrefix] = useState('');

  const loadClients = async () => {
    setLoading(true);
    try {
      const res = await platformFetch('/clients');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load clients');
      setClients(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadPlans = async () => {
    try {
      const res = await platformFetch('/plans');
      const data = await res.json();
      if (res.ok) setPlans(data.filter((p: Plan) => p.is_active));
    } catch {
      // Plan selection is optional at creation time — a failed fetch just
      // leaves the picker showing "No plan", not a blocking error.
    }
  };

  const loadDbNamePrefix = async () => {
    try {
      const res = await platformFetch('/clients/db-name-prefix');
      const data = await res.json();
      if (res.ok) setSchemaPrefix(data.prefix);
    } catch {
      // Purely a UX hint (shows the admin what database to pre-create) —
      // if it fails to load, the create flow still works, it just won't
      // show the live preview.
    }
  };

  useEffect(() => { loadClients(); loadPlans(); loadDbNamePrefix(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await platformFetch('/clients', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          code: form.code,
          adminName: form.adminName,
          adminEmail: form.adminEmail,
          plan_id: form.planId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create client');
      setResult({ ...data.credentials, invoice: data.invoice });
      setForm({ name: '', code: '', adminName: '', adminEmail: '', planId: '' });
      await loadClients();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (client: ClientRow) => {
    const nextStatus = client.status === 'active' ? 'suspended' : 'active';
    try {
      const res = await platformFetch(`/clients/${client.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update status');
      toast.success(`${client.name} ${nextStatus === 'suspended' ? 'suspended' : 'activated'}`);
      await loadClients();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await platformFetch(`/clients/${deleteTarget.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ code: deleteConfirmCode.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete client');
      toast.success(data.message || `${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      setDeleteConfirmCode('');
      await loadClients();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const copyCredentials = () => {
    if (!result) return;
    const text = `Code: ${result.code}\nEmail: ${result.email}\nPassword: ${result.tempPassword}`;
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <PlatformAppLayout>
      <PageHeader
        title="Clients"
        subtitle="Create and manage hospital instances"
        actions={
          <Button onClick={() => { setResult(null); setCreateOpen(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> New Client
          </Button>
        }
      />

      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Admin Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </TableCell></TableRow>
            ) : clients.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No clients yet
              </TableCell></TableRow>
            ) : clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-semibold text-foreground">
                  <Link to={`/platform-admin/clients/${c.id}`} className="hover:text-primary transition-colors">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-muted-foreground text-sm">{c.code}</TableCell>
                <TableCell className="text-muted-foreground">{c.admin_email}</TableCell>
                <TableCell>
                  <Badge variant={c.status === 'active' ? 'success' : 'destructive'} className="capitalize">
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {c.daysUntilExpiry === null ? (
                    <span className="text-muted-foreground text-sm">no subscription</span>
                  ) : (
                    <Badge variant={expiryTone(c.daysUntilExpiry)}>
                      {c.daysUntilExpiry < 0
                        ? `${Math.abs(c.daysUntilExpiry)}d overdue`
                        : c.daysUntilExpiry === 0 ? 'Today' : `${c.daysUntilExpiry}d left`}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className={c.outstandingAmount > 0 ? 'text-primary font-semibold' : 'text-muted-foreground'}>
                  {c.outstandingAmount > 0 ? `$${c.outstandingAmount.toFixed(2)}` : '—'}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="outline" size="sm" onClick={() => toggleStatus(c)}>
                    {c.status === 'active' ? 'Suspend' : 'Activate'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                    onClick={() => { setDeleteTarget(c); setDeleteConfirmCode(''); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          {result ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Client created
                </DialogTitle>
              </DialogHeader>
              <div className="px-5 py-4 space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Share these with the client now — the password won't be shown again.
                </p>
                <div className="bg-muted/50 border border-border rounded-lg p-3 font-mono space-y-1 text-foreground">
                  <div>Code: {result.code}</div>
                  <div>Email: {result.email}</div>
                  <div>Password: {result.tempPassword}</div>
                </div>
                {result.invoice && (
                  <p className="text-muted-foreground">
                    First invoice created: <span className="text-primary font-semibold">${Number(result.invoice.amount).toFixed(2)}</span>{' '}
                    ({result.invoice.billing_period}), due by {formatDate(result.invoice.period_end)}. The client is
                    automatically suspended if it's not marked paid by then.
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={copyCredentials}>
                  <Copy className="w-4 h-4 mr-1.5" /> Copy
                </Button>
                <Button onClick={() => setCreateOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>New Client</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate}>
                <div className="px-5 py-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label>Company Name</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Code (used to log in — e.g. nationmc)</Label>
                    <Input
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
                      required
                      pattern="[a-z][a-z0-9]{2,29}"
                      className="font-mono"
                    />
                    {schemaPrefix && form.code && (
                      <p className="text-xs text-muted-foreground">
                        Gets its own isolated schema:{' '}
                        <span className="font-mono text-foreground">{schemaPrefix}{form.code}</span>
                        {' '}— created automatically.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Admin Name</Label>
                    <Input
                      value={form.adminName}
                      onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Admin Email</Label>
                    <Input
                      type="email"
                      value={form.adminEmail}
                      onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Subscription Plan</Label>
                    <Select value={form.planId} onValueChange={(v) => setForm({ ...form, planId: v })}>
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
                  <Button type="submit" disabled={creating}>
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteConfirmCode(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="w-5 h-5" /> Delete client
            </DialogTitle>
          </DialogHeader>
          <div className="px-5 py-4 space-y-4 text-sm">
            <p className="text-muted-foreground">
              This permanently deletes <span className="font-semibold text-foreground">{deleteTarget?.name}</span>{' '}
              — its database, every patient record, invoice, and login inside it. This action{' '}
              <span className="font-semibold text-foreground">cannot be undone</span>.
            </p>
            <div className="space-y-1.5">
              <Label>
                Type <span className="font-mono text-foreground">{deleteTarget?.code}</span> to confirm
              </Label>
              <Input
                value={deleteConfirmCode}
                onChange={(e) => setDeleteConfirmCode(e.target.value)}
                placeholder={deleteTarget?.code}
                className="font-mono"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirmCode(''); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting || deleteConfirmCode.trim().toLowerCase() !== deleteTarget?.code}
              onClick={handleDelete}
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlatformAppLayout>
  );
};

export default PlatformClients;
