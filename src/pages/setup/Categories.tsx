import React, { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { Plus, Tags, Loader2, Pencil, Trash2, EyeOff, Eye } from 'lucide-react';
import { toast } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { CategoriesDialog } from '@/pages/accounting/FixedAssetsLayout';
import type { Category as AssetCategory, ChartAccount } from '@/pages/accounting/fixedAssetsShared';

type CategoryType = 'item' | 'service' | 'expense';

interface CategoryRow {
  id: string;
  name: string;
  code: string;
  type: CategoryType;
  parent_id: string | null;
  parent_name: string | null;
  department_id: string | null;
  department_name: string | null;
  revenue_account_id: string | null; revenue_account_code: string | null; revenue_account_name: string | null;
  cogs_account_id: string | null; cogs_account_code: string | null; cogs_account_name: string | null;
  inventory_account_id: string | null; inventory_account_code: string | null; inventory_account_name: string | null;
  expense_account_id: string | null; expense_account_code: string | null; expense_account_name: string | null;
  is_active: boolean;
  description: string | null;
  item_count: number;
  service_count: number;
  expense_count: number;
}

const TABS: { key: CategoryType | 'fixed_asset'; label: string }[] = [
  { key: 'item', label: 'Items & Drugs' },
  { key: 'service', label: 'Services' },
  { key: 'expense', label: 'Expenses' },
  { key: 'fixed_asset', label: 'Fixed Assets' },
];

const ACCOUNT_FIELDS_BY_TYPE: Record<CategoryType, { field: string; label: string; accountType: string; required: boolean }[]> = {
  item: [
    { field: 'inventory_account_id', label: 'Inventory account (asset)', accountType: 'asset', required: true },
    { field: 'cogs_account_id', label: 'Cost of sales account (expense)', accountType: 'expense', required: false },
    { field: 'revenue_account_id', label: 'Revenue account (revenue)', accountType: 'revenue', required: true },
  ],
  service: [
    { field: 'revenue_account_id', label: 'Revenue account (revenue)', accountType: 'revenue', required: true },
  ],
  expense: [
    { field: 'expense_account_id', label: 'Expense account (expense)', accountType: 'expense', required: true },
  ],
};

function usageCount(row: CategoryRow): number {
  return (row.item_count || 0) + (row.service_count || 0) + (row.expense_count || 0);
}

export default function Categories() {
  const { user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const clinicId = Number(user?.clinic) || 1;
  const [tab, setTab] = useState<CategoryType | 'fixed_asset'>('item');
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [departments, setDepartments] = useState<{ id: string; department_name: string }[]>([]);

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const [assetCategories, setAssetCategories] = useState<AssetCategory[]>([]);
  const [showAssetDialog, setShowAssetDialog] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setAccounts(await res.json());
    } catch { /* non-blocking */ }
  }, [clinicId]);

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await authFetch('/api/departments', { credentials: 'include' });
      if (res.ok) setDepartments(await res.json());
    } catch { /* non-blocking */ }
  }, []);

  const fetchRows = useCallback(async () => {
    if (tab === 'fixed_asset') return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/categories?type=${tab}&include_inactive=true&clinic_id=${clinicId}`, { credentials: 'include' });
      if (res.ok) setRows(await res.json());
    } catch {
      toast.error('Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, [tab, clinicId]);

  const fetchAssetMeta = useCallback(async () => {
    try {
      const [catRes, acctRes] = await Promise.all([
        authFetch('/api/fixed-assets/categories', { credentials: 'include' }),
        authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`, { credentials: 'include' }),
      ]);
      if (catRes.ok) setAssetCategories(await catRes.json());
      if (acctRes.ok) setAccounts(await acctRes.json());
    } catch { /* non-blocking */ }
  }, [clinicId]);

  useEffect(() => { fetchAccounts(); fetchDepartments(); }, [fetchAccounts, fetchDepartments]);
  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { if (tab === 'fixed_asset') fetchAssetMeta(); }, [tab, fetchAssetMeta]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', code: '', parent_id: '', department_id: '', description: '' });
    setShowDialog(true);
  };
  const openEdit = (row: CategoryRow) => {
    setEditing(row);
    setForm({
      name: row.name, code: row.code, parent_id: row.parent_id || '', department_id: row.department_id || '',
      description: row.description || '', revenue_account_id: row.revenue_account_id || '',
      cogs_account_id: row.cogs_account_id || '', inventory_account_id: row.inventory_account_id || '',
      expense_account_id: row.expense_account_id || '',
    });
    setShowDialog(true);
  };

  const accountOptions = (accountType: string) => accounts
    .filter((a) => a.account_type === accountType)
    // A switched-off account is still offered; saving the category switches it on.
    .map((a) => ({ value: a.id, label: `${a.account_code} · ${a.account_name}${(a as any).is_active === false ? ' (off — saving switches it on)' : ''}` }));

  const handleSave = async () => {
    if (tab === 'fixed_asset') return;
    const fieldsSpec = ACCOUNT_FIELDS_BY_TYPE[tab as CategoryType];
    if (!form.name?.trim()) { toast.error('Name is required'); return; }
    const missing = fieldsSpec.filter((f) => f.required && !form[f.field]);
    if (missing.length) { toast.error(`Required: ${missing.map((f) => f.label).join(', ')}`); return; }

    // Editing an existing, already-used category's accounts — confirm first,
    // since it only affects future postings (not past ones).
    if (editing && usageCount(editing) > 0) {
      const accountsChanged = fieldsSpec.some((f) => (form[f.field] || null) !== (editing[f.field as keyof CategoryRow] || null));
      if (accountsChanged) {
        const ok = await confirm({
          title: 'Change this category\'s accounts?',
          description: `This will apply to ${usageCount(editing)} item${usageCount(editing) === 1 ? '' : 's'}/record${usageCount(editing) === 1 ? '' : 's'} from now on. Past postings are not changed.`,
        });
        if (!ok) return;
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(), code: form.code?.trim() || undefined, type: tab,
        parent_id: form.parent_id || null, department_id: form.department_id || null,
        description: form.description || null, clinic_id: clinicId,
      };
      for (const f of fieldsSpec) payload[f.field] = form[f.field] || null;

      const url = editing ? `/api/categories/${editing.id}` : '/api/categories';
      const res = await authFetch(url, { method: editing ? 'PUT' : 'POST', credentials: 'include', body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) {
        toast.success(editing ? 'Category updated' : 'Category created');
        setShowDialog(false);
        fetchRows();
      } else {
        toast.error(data.error || 'Failed to save category');
      }
    } catch {
      toast.error('Network error saving category');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (row: CategoryRow) => {
    try {
      const res = await authFetch(`/api/categories/${row.id}`, { method: 'PUT', credentials: 'include', body: JSON.stringify({ is_active: !row.is_active, clinic_id: clinicId }) });
      if (res.ok) { toast.success(row.is_active ? 'Category deactivated' : 'Category activated'); fetchRows(); }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Failed to update'); }
    } catch { toast.error('Network error'); }
  };

  const handleDelete = async (row: CategoryRow) => {
    if (usageCount(row) > 0) { toast.error('In use — deactivate it instead.'); return; }
    if (!(await confirm({ description: `Delete category "${row.name}"? This cannot be undone.` }))) return;
    try {
      const res = await authFetch(`/api/categories/${row.id}?clinic_id=${clinicId}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { toast.success('Category deleted'); fetchRows(); }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Failed to delete'); }
    } catch { toast.error('Network error'); }
  };

  const columns: Column<CategoryRow>[] = [
    { key: 'name', header: 'Name', sortable: true, render: (v, r) => (
      <div>
        <span className="font-medium">{v}</span>
        {!r.is_active && <Badge variant="outline" className="ml-2 text-xs">Inactive</Badge>}
      </div>
    ) },
    { key: 'code', header: 'Code', render: (v) => <span className="font-mono text-xs text-muted-foreground">{v}</span> },
    { key: 'parent_name', header: 'Parent', render: (v) => v || '—' },
    { key: 'department_name', header: 'Department', render: (v) => v || '—' },
    { key: 'revenue_account_code', header: 'Revenue', render: (v, r) => v ? <span title={r.revenue_account_name || ''}>{v}</span> : <span className="text-muted-foreground">—</span> },
    ...(tab === 'item' ? [
      { key: 'cogs_account_code', header: 'COGS', render: (v: any, r: any) => v ? <span title={r.cogs_account_name || ''}>{v}</span> : <span className="text-muted-foreground">—</span> } as Column<CategoryRow>,
      { key: 'inventory_account_code', header: 'Inventory', render: (v: any, r: any) => v ? <span title={r.inventory_account_name || ''}>{v}</span> : <span className="text-muted-foreground">—</span> } as Column<CategoryRow>,
    ] : []),
    ...(tab === 'expense' ? [
      { key: 'expense_account_code', header: 'Expense Account', render: (v: any, r: any) => v ? <span title={r.expense_account_name || ''}>{v}</span> : <span className="text-muted-foreground">—</span> } as Column<CategoryRow>,
    ] : []),
    { key: 'item_count', header: 'In Use', align: 'right', render: (_v, r) => usageCount(r) },
    { key: 'id', header: '', width: '120px', render: (_v, r) => (
      <div className="flex items-center gap-1 justify-end">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleToggleActive(r)}>{r.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDelete(r)} disabled={usageCount(r) > 0}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    ) },
  ];

  const parentOptions = rows.filter((r) => r.type === tab && (!editing || r.id !== editing.id)).map((r) => ({ value: r.id, label: r.name }));
  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.department_name }));

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PageHeader title="Categories" icon={<Tags />} subtitle="The single source of accounts for items, services, lab tests, and expenses" />
          {tab !== 'fixed_asset' && (
            <Button size="sm" className="gap-1.5 h-11" onClick={openNew}><Plus className="h-4 w-4" /> New Category</Button>
          )}
        </div>

        <div className="border-b border-border">
          <nav className="flex gap-1 -mb-px">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn('px-4 py-2 text-sm font-medium border-b-2 transition-colors', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'fixed_asset' ? (
          <div className="bg-card rounded-lg border p-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              Fixed asset categories keep their own dedicated management dialog (asset/accumulated-depreciation/
              depreciation-expense accounts) — opened from here for convenience, unchanged otherwise.
            </p>
            <Button variant="outline" className="h-11 gap-1.5" onClick={() => setShowAssetDialog(true)}>
              <Tags className="h-4 w-4" /> Manage Fixed Asset Categories
            </Button>
          </div>
        ) : loading ? (
          <LoadingState message="Loading categories..." />
        ) : (
          <AdvancedDataTable
            data={rows}
            keyExtractor={(r) => r.id}
            columns={columns}
            emptyMessage="No categories yet."
            searchable
            searchPlaceholder="Search categories..."
          />
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Category' : 'New Category'}</DialogTitle>
            <DialogDescription>{TABS.find((t) => t.key === tab)?.label} category</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto px-1">
            <div>
              <Label>Name</Label>
              <Input className="h-11 mt-1" value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Code</Label>
              <Input className="h-11 mt-1" value={form.code || ''} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="Auto-generated from name if left blank" />
            </div>
            <div>
              <Label>Parent category (optional)</Label>
              <Combobox options={parentOptions} value={form.parent_id || ''} onChange={(v) => setForm((f) => ({ ...f, parent_id: v }))} placeholder="None" searchPlaceholder="Search..." className="h-11 mt-1" />
            </div>
            <div>
              <Label>Department (optional)</Label>
              <Combobox options={departmentOptions} value={form.department_id || ''} onChange={(v) => setForm((f) => ({ ...f, department_id: v }))} placeholder="None" searchPlaceholder="Search..." className="h-11 mt-1" />
            </div>
            {(ACCOUNT_FIELDS_BY_TYPE[tab as CategoryType] || []).map((f) => (
              <div key={f.field}>
                <Label>{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
                <Combobox
                  options={accountOptions(f.accountType)}
                  value={form[f.field] || ''}
                  onChange={(v) => setForm((prev) => ({ ...prev, [f.field]: v }))}
                  placeholder="Select account..."
                  searchPlaceholder="Search by code or name..."
                  className="h-11 mt-1"
                />
              </div>
            ))}
            <div>
              <Label>Description (optional)</Label>
              <Textarea className="mt-1" value={form.description || ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            {editing && usageCount(editing) > 0 && (
              <p className="text-xs text-muted-foreground">
                Changing the accounts above will apply to future postings only — past postings for the {usageCount(editing)} record(s) already using this category are not changed.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showAssetDialog && (
        <CategoriesDialog
          categories={assetCategories}
          accounts={accounts}
          onClose={() => setShowAssetDialog(false)}
          onChanged={fetchAssetMeta}
        />
      )}
      {confirmDialog}
    </AppLayout>
  );
}
