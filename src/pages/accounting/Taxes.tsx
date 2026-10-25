import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Percent, Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge } from '@/components/common';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface TaxRate {
  id: string; name: string; code?: string | null; rate: number; account_id?: string | null;
  account_code?: string | null; account_name?: string | null; description?: string | null; is_active: boolean;
}
interface Account { id: string; account_code: string; account_name: string; is_active: boolean }
interface CategoryRow { id: string; name: string; type: string; tax_rate_id: string | null }
interface ItemRow {
  kind: 'service' | 'item' | 'lab_test'; id: string; name: string; category_name: string | null;
  category_tax_rate_id: string | null; tax_rate_id: string | null; tax_exempt: boolean;
}

const KIND_LABEL: Record<ItemRow['kind'], string> = { service: 'Service', item: 'Product', lab_test: 'Lab test' };
const EMPTY = { name: '', code: '', rate: '', account_id: '', description: '', is_active: true };

/**
 * Accounting › Taxes. Tax types (name, rate, the liability account it is owed
 * on); the tax each category carries; and per-item overrides (own rate, or
 * exempt). Tax is added on top of the price when a bill is raised, as its
 * own line, and posts to the tax's account — never to revenue.
 */
export default function Taxes() {
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TaxRate | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [kindFilter, setKindFilter] = useState('all');
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, a, s] = await Promise.all([
        authFetch('/api/tax-rates'), authFetch('/api/tax-rates/accounts'), authFetch('/api/tax-rates/assignments'),
      ]);
      if (!r.ok || !s.ok) throw new Error('Could not load taxes');
      setRates(await r.json());
      setAccounts(a.ok ? await a.json() : []);
      const sj = await s.json();
      setCategories(sj.categories || []);
      setItems(sj.items || []);
    } catch (e: any) {
      toast.error(e.message || 'Could not load taxes');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const activeRates = rates.filter((r) => r.is_active);
  const rateById = useMemo(() => new Map(rates.map((r) => [r.id, r])), [rates]);
  const rateLabel = (id?: string | null) => {
    const r = id ? rateById.get(id) : null;
    return r ? `${r.name} ${r.rate}%` : null;
  };
  const rateOptions = activeRates.map((r) => ({ value: r.id, label: `${r.name} (${r.rate}%)` }));

  const openNew = () => {
    const vat = accounts.find((a) => a.account_code === '2300');
    setEditing(null);
    setForm({ ...EMPTY, account_id: vat?.id || '' });
    setOpen(true);
  };
  const openEdit = (r: TaxRate) => {
    setEditing(r);
    setForm({ name: r.name, code: r.code || '', rate: String(r.rate), account_id: r.account_id || '', description: r.description || '', is_active: r.is_active });
    setOpen(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const body = { ...form, rate: Number(form.rate), account_id: form.account_id || null };
      const res = await authFetch(editing ? `/api/tax-rates/${editing.id}` : '/api/tax-rates', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not save');
      toast.success(editing ? `${form.name} updated` : `${form.name} added`);
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: TaxRate) => {
    if (!(await confirm({ title: `Delete ${r.name}?`, description: 'If bills already carry this tax it is deactivated instead, so those bills keep their tax lines.', confirmLabel: 'Delete', destructive: true }))) return;
    const res = await authFetch(`/api/tax-rates/${r.id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(j.error || 'Could not delete'); return; }
    toast.success(j.deactivated ? `${r.name} deactivated (already on bills)` : `${r.name} deleted`);
    load();
  };

  const assign = async (kind: string, id: string, value: string) => {
    const body = kind === 'category'
      ? { kind, id, tax_rate_id: value === 'none' ? null : value }
      : { kind, id, tax_rate_id: value === 'inherit' || value === 'exempt' ? null : value, tax_exempt: value === 'exempt' };
    const res = await authFetch('/api/tax-rates/assign', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error || 'Could not save'); return; }
    if (kind === 'category') {
      setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, tax_rate_id: body.tax_rate_id } : c)));
      setItems((its) => its.map((it) => (it.category_name && categories.find((c) => c.id === id)?.name === it.category_name ? { ...it, category_tax_rate_id: body.tax_rate_id } : it)));
    } else {
      setItems((its) => its.map((it) => (it.kind === kind && it.id === id ? { ...it, tax_rate_id: body.tax_rate_id, tax_exempt: !!(body as any).tax_exempt } : it)));
    }
    toast.success('Tax setting saved');
  };

  const shownItems = items.filter((it) => kindFilter === 'all' || it.kind === kindFilter);

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="space-y-4 w-full">
          <PageHeader
            icon={<Percent />}
            title="Taxes"
            subtitle="Tax is added on top of the price when a bill is raised, and posted to the tax's own account"
            actions={
              <div className="flex gap-2">
                <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
                <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Add tax</Button>
              </div>
            }
          />

          <AdvancedDataTable<TaxRate>
            title="Tax types"
            countLabel={['tax', 'taxes']}
            data={rates}
            loading={loading}
            keyExtractor={(r) => r.id}
            searchable={false}
            toolbar="count"
            columns={[
              { key: 'name', header: 'Name', render: (v, r) => <span className="font-medium">{v}{r.code ? <span className="ml-2 text-xs text-muted-foreground font-mono">{r.code}</span> : null}</span> },
              { key: 'rate', header: 'Rate', align: 'right', render: (v) => <span className="font-mono tabular-nums">{Number(v)}%</span> },
              { key: 'account_name', header: 'Posts to', render: (_v, r) => r.account_code ? <span><span className="font-mono text-xs">{r.account_code}</span> {r.account_name}</span> : '—' },
              { key: 'is_active', header: 'Status', render: (v) => <StatusBadge status={v ? 'active' : 'inactive'} map={{ active: 'success', inactive: 'neutral' }} label={v ? 'Active' : 'Inactive'} /> },
              {
                key: '__actions', header: '', align: 'right',
                render: (_v, r) => (
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" aria-label="Edit" title="Edit" onClick={() => openEdit(r)}><Pencil /></Button>
                    <Button size="icon" variant="ghost" aria-label="Delete" title="Delete" className="text-destructive" onClick={() => remove(r)}><Trash2 /></Button>
                  </div>
                ),
              },
            ]}
            empty={{ icon: Percent, title: 'No taxes yet', message: 'Add a tax (e.g. VAT 18%), then give it to a category or an item below.' }}
          />

          <AdvancedDataTable<CategoryRow>
            title="Tax by category"
            countLabel={['category', 'categories']}
            data={categories}
            loading={loading}
            keyExtractor={(c) => c.id}
            searchPlaceholder="Search category..."
            pagination={{ enabled: true, pageSize: 20 }}
            columns={[
              { key: 'name', header: 'Category', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
              { key: 'type', header: 'Type', render: (v) => <span className="capitalize text-muted-foreground">{v === 'item' ? 'Products' : v === 'service' ? 'Services' : v}</span> },
              {
                key: 'tax_rate_id', header: 'Tax for every item in it', width: '16rem',
                exportValue: (c) => rateLabel(c.tax_rate_id) || 'No tax',
                render: (_v, c) => (
                  <Combobox
                    options={[{ value: 'none', label: 'No tax' }, ...rateOptions]}
                    value={c.tax_rate_id || 'none'}
                    onChange={(v) => assign('category', c.id, v || 'none')}
                    searchPlaceholder="Search..."
                    className="h-8 text-sm"
                  />
                ),
              },
            ]}
            empty={{ icon: Percent, title: 'No categories', message: 'Categories come from Setup › Categories.' }}
          />

          <AdvancedDataTable<ItemRow>
            title="Item overrides"
            countLabel={['item', 'items']}
            data={shownItems}
            loading={loading}
            keyExtractor={(it) => `${it.kind}:${it.id}`}
            searchPlaceholder="Search service, product or test..."
            pagination={{ enabled: true, pageSize: 20 }}
            toolbarExtra={
              <Combobox
                options={[{ value: 'all', label: 'All items' }, { value: 'service', label: 'Services' }, { value: 'item', label: 'Products' }, { value: 'lab_test', label: 'Lab tests' }]}
                value={kindFilter}
                onChange={(v) => setKindFilter(v || 'all')}
                searchPlaceholder="Search..."
                className="h-8 w-36 text-sm"
              />
            }
            columns={[
              { key: 'name', header: 'Item', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
              { key: 'kind', header: 'Kind', render: (v) => <span className="text-muted-foreground">{KIND_LABEL[v as ItemRow['kind']]}</span> },
              { key: 'category_name', header: 'Category', sortable: true, render: (v) => v || <span className="text-muted-foreground">—</span> },
              {
                key: '__effective', header: 'Tax applied',
                exportValue: (it) => it.tax_exempt ? 'Exempt' : rateLabel(it.tax_rate_id) || rateLabel(it.category_tax_rate_id) || 'No tax',
                render: (_v, it) => it.tax_exempt
                  ? <span className="text-muted-foreground">Exempt</span>
                  : rateLabel(it.tax_rate_id)
                    ? <span className="font-medium">{rateLabel(it.tax_rate_id)}</span>
                    : rateLabel(it.category_tax_rate_id)
                      ? <span>{rateLabel(it.category_tax_rate_id)} <span className="text-xs text-muted-foreground">(from category)</span></span>
                      : <span className="text-muted-foreground">No tax</span>,
              },
              {
                key: '__override', header: 'Override', width: '15rem',
                render: (_v, it) => (
                  <Combobox
                    options={[{ value: 'inherit', label: 'Same as category' }, { value: 'exempt', label: 'Exempt' }, ...rateOptions]}
                    value={it.tax_exempt ? 'exempt' : it.tax_rate_id || 'inherit'}
                    onChange={(v) => assign(it.kind, it.id, v || 'inherit')}
                    searchPlaceholder="Search..."
                    className="h-8 text-sm"
                  />
                ),
              },
            ]}
            empty={{ icon: Percent, title: 'No items found' }}
          />
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'Add tax'}</DialogTitle>
            <DialogDescription>Added on top of the price of every item it applies to.</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>Name *</Label>
                <Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VAT" />
              </div>
              <div>
                <Label>Rate (%) *</Label>
                <Input className="mt-1" type="number" min="0" max="100" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="18" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Code</Label>
                <Input className="mt-1" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="VAT18" />
              </div>
              <div className="col-span-2">
                <Label>Posts to</Label>
                <Combobox
                  options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} · ${a.account_name}` }))}
                  value={form.account_id}
                  onChange={(v) => setForm({ ...form, account_id: v })}
                  placeholder="2300 VAT Payable"
                  searchPlaceholder="Search accounts..."
                  className="ic-select mt-1"
                />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea className="mt-1" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            {editing && (
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">An inactive tax stops being added to new bills.</p>
                </div>
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim() || form.rate === ''}>{editing ? 'Save' : 'Add tax'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
