import React, { useEffect, useState } from 'react';
import { LoadingState } from '@/components/common/LoadingState';
import { platformFetch } from '@/api/platformApiClient';
import { usePlatformAuth } from '@/contexts/PlatformAuthContext';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Loader2, UserPlus, Users, Trash2 } from 'lucide-react';
import { toast } from '@/lib/notify';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

const PlatformUsers: React.FC = () => {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { admin: currentAdmin } = usePlatformAuth();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformFetch('/admins');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users');
      setAdmins(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await platformFetch('/admins', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create user');
      toast.success('User added');
      setForm({ name: '', email: '', password: '' });
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (user: AdminUser) => {
    if (!(await confirm({ description: `Remove ${user.name} (${user.email}) from platform admin access?` }))) return;
    try {
      const res = await platformFetch(`/admins/${user.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to remove user');
      toast.success('User removed');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <PlatformAppLayout>
      {confirmDialog}
      <PageHeader title="Platform Users" subtitle="Who has access to this admin panel" />

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden lg:sticky lg:top-4 h-fit">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-primary" /> Add User
            </h3>
          </div>
          <form onSubmit={handleCreate} className="p-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserPlus className="w-4 h-4 mr-1.5" /> Add User</>}
            </Button>
          </form>
        </div>

        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden h-fit">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={4} className="p-0"><LoadingState size="sm" message="" className="py-8" /></TableCell></TableRow>
              ) : admins.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No users yet
                </TableCell></TableRow>
              ) : admins.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-semibold text-foreground">
                    {a.name}
                    {a.id === currentAdmin?.id && <span className="ml-2 text-xs text-muted-foreground font-normal">(you)</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.email}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    {a.id !== currentAdmin?.id && (
                      <Button variant="outline" size="sm" onClick={() => handleRemove(a)}>
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                      </Button>
                    )}
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

export default PlatformUsers;
