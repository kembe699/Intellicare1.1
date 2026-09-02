import React, { useEffect, useState } from 'react';
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
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Plus, Tag, Pencil } from 'lucide-react';
import { toast } from 'sonner';

interface Plan {
  id: number;
  name: string;
  amount: string;
  billing_period: 'monthly' | 'quarterly' | 'annual';
  is_active: boolean;
}

const PlatformPlans: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', billing_period: 'monthly' });
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [editForm, setEditForm] = useState({ name: '', amount: '', billing_period: 'monthly' });
  const [savingEdit, setSavingEdit] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformFetch('/plans');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load plans');
      setPlans(data);
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
      const res = await platformFetch('/plans', {
        method: 'POST',
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create plan');
      toast.success('Plan created');
      setForm({ name: '', amount: '', billing_period: 'monthly' });
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (plan: Plan) => {
    try {
      const res = await platformFetch(`/plans/${plan.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !plan.is_active }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update plan');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setEditForm({ name: plan.name, amount: plan.amount, billing_period: plan.billing_period });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;
    setSavingEdit(true);
    try {
      const res = await platformFetch(`/plans/${editingPlan.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...editForm, amount: Number(editForm.amount) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update plan');
      toast.success('Plan updated');
      setEditingPlan(null);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <PlatformAppLayout>
      <PageHeader title="Subscription Plans" subtitle="Manage the plans clients can be billed against" />

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden lg:sticky lg:top-4 h-fit">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" /> New Plan
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
              <Label>Amount ($)</Label>
              <Input
                type="number" step="0.01" min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Billing Period</Label>
              <Select value={form.billing_period} onValueChange={(v) => setForm({ ...form, billing_period: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1.5" /> Create Plan</>}
            </Button>
          </form>
        </div>

        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden h-fit">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Name</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : plans.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No plans yet</TableCell></TableRow>
              ) : plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-semibold text-foreground">{p.name}</TableCell>
                  <TableCell className="text-primary font-semibold">${Number(p.amount).toFixed(2)}</TableCell>
                  <TableCell className="text-muted-foreground capitalize">{p.billing_period}</TableCell>
                  <TableCell>
                    <Badge variant={p.is_active ? 'success' : 'neutral'} className="capitalize">
                      {p.is_active ? 'active' : 'inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                      <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => toggleActive(p)}>
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!editingPlan} onOpenChange={(open) => !open && setEditingPlan(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Plan</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveEdit}>
            <div className="px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Amount ($)</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={editForm.amount}
                  onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Billing Period</Label>
                <Select value={editForm.billing_period} onValueChange={(v) => setEditForm({ ...editForm, billing_period: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingPlan(null)}>Cancel</Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PlatformAppLayout>
  );
};

export default PlatformPlans;
