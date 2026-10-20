import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Loader2, Plus, Users, FileText, Search } from 'lucide-react';
import { toast } from '@/lib/notify';

interface CustomerRow {
  id: number;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  status: 'prospect' | 'converted';
  quotationCount: number;
  created_at: string;
}

const emptyForm = { name: '', contact_person: '', email: '', phone: '', address: '', notes: '' };

const PlatformCustomers: React.FC = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);

  const load = async (q?: string) => {
    setLoading(true);
    try {
      const res = await platformFetch(`/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load customers');
      setCustomers(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await platformFetch('/customers', { method: 'POST', body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create customer');
      toast.success('Customer registered');
      setForm(emptyForm);
      await load(search || undefined);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PlatformAppLayout>
      <PageHeader
        icon={<Users />}
        title="Customers"
        subtitle="Register a prospective customer before generating a quotation or provisioning their instance"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden lg:sticky lg:top-4 h-fit">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" /> New Customer
            </h3>
          </div>
          <form onSubmit={handleCreate} className="p-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Organization / Hospital Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Person</Label>
              <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1.5" /> Register Customer</>}
            </Button>
          </form>
        </div>

        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden h-fit">
          <div className="p-3 border-b border-border bg-muted/30">
            <div className="relative max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email / Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Quotations</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell></TableRow>
              ) : customers.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No customers yet
                </TableCell></TableRow>
              ) : customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold text-foreground">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.contact_person || '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {c.email || '—'}{c.phone ? ` • ${c.phone}` : ''}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'converted' ? 'success' : 'neutral'} className="capitalize">{c.status}</Badge>
                  </TableCell>
                  <TableCell>{c.quotationCount}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() => navigate(`/platform-admin/quotations?customer_id=${c.id}`)}
                    >
                      <FileText className="w-3.5 h-3.5 mr-1.5" /> New Quotation
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </PlatformAppLayout>
  );
};

export default PlatformCustomers;
