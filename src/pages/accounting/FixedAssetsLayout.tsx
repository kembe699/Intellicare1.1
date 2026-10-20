import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Building2, Plus, Settings, Loader2, Edit, Trash2, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Category, ChartAccount, NATURE_LABEL } from './fixedAssetsShared';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

const TABS = [
  { to: '/accounting/fixed-assets/register', label: 'Register' },
  { to: '/accounting/fixed-assets/depreciation', label: 'Depreciation' },
  { to: '/accounting/fixed-assets/reports', label: 'Reports' },
];

// Real routed pages (not client-side <Tabs>) so refreshing on, say, Reports
// keeps you on Reports instead of resetting to Register — same Outlet
// pattern as ReportsDashboard.tsx.
export default function FixedAssetsLayout() {
  const { hasPrivilege, user } = useAuth();
  const canWrite = hasPrivilege('assets.write');
  const clinicId = Number(user?.clinic) || 1;
  const location = useLocation();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);

  const fetchMeta = useCallback(async () => {
    try {
      const [catRes, acctRes] = await Promise.all([
        authFetch('/api/fixed-assets/categories', { credentials: 'include' }),
        authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`, { credentials: 'include' }),
      ]);
      if (catRes.ok) setCategories(await catRes.json());
      if (acctRes.ok) setAccounts(await acctRes.json());
    } catch {
      // Categories dialog will just show empty — not fatal to the rest of the page.
    }
  }, [clinicId]);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PageHeader title="Fixed Assets" icon={<Building2 />} subtitle="Asset register, depreciation and reports" />
          <div className="flex items-center gap-2">
            {canWrite && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCategoryDialogOpen(true)}>
                <Settings className="h-3.5 w-3.5" /> Categories
              </Button>
            )}
            {canWrite && (
              <Button size="sm" className="gap-1.5" onClick={() => navigate('/accounting/fixed-assets/register/new')}>
                <Plus className="h-3.5 w-3.5" /> Add Asset
              </Button>
            )}
          </div>
        </div>

        <div className="border-b border-border">
          <nav className="flex gap-1 -mb-px">
            {TABS.map((tab) => {
              const isActive = location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={cn(
                    'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                    isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab.label}
                </NavLink>
              );
            })}
          </nav>
        </div>

        <Outlet />
      </div>

      {categoryDialogOpen && (
        <CategoriesDialog
          categories={categories}
          accounts={accounts}
          onClose={() => setCategoryDialogOpen(false)}
          onChanged={fetchMeta}
        />
      )}
    </AppLayout>
  );
}

// ── Categories dialog ─────────────────────────────────────────────────────
// Unchanged from the original tabbed page — the user's request was specific
// to Register/Add-Asset/Depreciation/Reports; categories stays a small
// settings-style dialog reachable from any of the three pages.

function CategoriesDialog({ categories, accounts, onClose, onChanged }: {
  categories: Category[]; accounts: ChartAccount[]; onClose: () => void; onChanged: () => void;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nature, setNature] = useState<'depreciating' | 'appreciating' | 'non_depreciating'>('depreciating');
  const [usefulLife, setUsefulLife] = useState('');
  const [salvagePercent, setSalvagePercent] = useState('0');
  const [assetAccountCode, setAssetAccountCode] = useState('');
  const [accumAccountCode, setAccumAccountCode] = useState('');
  const [expenseAccountCode, setExpenseAccountCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const assetAccounts = accounts.filter((a) => a.account_type === 'asset');
  const expenseAccounts = accounts.filter((a) => a.account_type === 'expense');

  const resetForm = () => {
    setFormOpen(false); setEditingId(null);
    setName(''); setNature('depreciating'); setUsefulLife(''); setSalvagePercent('0');
    setAssetAccountCode(''); setAccumAccountCode(''); setExpenseAccountCode('');
  };

  const startCreate = () => { resetForm(); setFormOpen(true); };

  const startEdit = (c: Category) => {
    setEditingId(c.id);
    setFormOpen(true);
    setName(c.name);
    setNature(c.nature);
    setUsefulLife(c.default_useful_life_years ? String(c.default_useful_life_years) : '');
    setSalvagePercent(String(c.default_salvage_percent ?? '0'));
    const assetAcct = accounts.find((a) => a.id === c.asset_account_id);
    const accumAcct = accounts.find((a) => a.id === c.accumulated_depreciation_account_id);
    const expenseAcct = accounts.find((a) => a.id === c.depreciation_expense_account_id);
    setAssetAccountCode(assetAcct?.account_code || '');
    setAccumAccountCode(accumAcct?.account_code || '');
    setExpenseAccountCode(expenseAcct?.account_code || '');
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const assetAccount = accounts.find((a) => a.account_code === assetAccountCode);
    const accumAccount = accounts.find((a) => a.account_code === accumAccountCode);
    const expenseAccount = accounts.find((a) => a.account_code === expenseAccountCode);
    if (!assetAccount) { toast.error('Select the asset GL account'); return; }
    if (nature === 'depreciating' && (!accumAccount || !expenseAccount)) { toast.error('A depreciating category needs both an accumulated-depreciation and a depreciation-expense account'); return; }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(), nature, default_useful_life_years: usefulLife ? parseInt(usefulLife, 10) : null,
        default_salvage_percent: parseFloat(salvagePercent) || 0, asset_account_id: assetAccount.id,
        accumulated_depreciation_account_id: accumAccount?.id, depreciation_expense_account_id: expenseAccount?.id,
      };
      const res = await authFetch(editingId ? `/api/fixed-assets/categories/${editingId}` : '/api/fixed-assets/categories', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success(editingId ? 'Category updated' : 'Category created');
        resetForm();
        onChanged();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to save category');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (c: Category) => {
    setBusyId(c.id);
    try {
      const res = await authFetch(`/api/fixed-assets/categories/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !c.is_active }),
      });
      if (res.ok) { toast.success(c.is_active ? 'Category deactivated' : 'Category activated'); onChanged(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to update category'); }
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (c: Category) => {
    if (!(await confirm({ description: `Delete category "${c.name}"? This only works if no assets use it.` }))) return;
    setBusyId(c.id);
    try {
      const res = await authFetch(`/api/fixed-assets/categories/${c.id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Category deleted'); if (editingId === c.id) resetForm(); onChanged(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to delete category'); }
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      {confirmDialog}
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Asset Categories</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.id} className={cn('flex items-center justify-between border rounded-lg px-3 py-2 text-sm', !c.is_active && 'opacity-60 bg-muted/30')}>
              <div className="min-w-0">
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{NATURE_LABEL[c.nature]}{c.default_useful_life_years ? ` · ${c.default_useful_life_years}y` : ''}</span>
                {!c.is_active && <span className="ml-2 text-xs font-medium text-muted-foreground">(Inactive)</span>}
                <div className="text-xs text-muted-foreground truncate">{c.asset_account_name}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === c.id} onClick={() => startEdit(c)}>
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === c.id} onClick={() => handleToggleActive(c)} title={c.is_active ? 'Deactivate' : 'Activate'}>
                  {c.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" disabled={busyId === c.id} onClick={() => handleDelete(c)}>
                  {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ))}
          {categories.length === 0 && <p className="text-sm text-muted-foreground py-2">No categories yet.</p>}
        </div>

        {!formOpen ? (
          <Button variant="outline" size="sm" className="gap-1.5 w-fit" onClick={startCreate}><Plus className="h-3.5 w-3.5" /> New Category</Button>
        ) : (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
            <h4 className="text-sm font-semibold">{editingId ? 'Edit Category' : 'New Category'}</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vehicles" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Nature</label>
                <Combobox
                  options={[{ value: 'depreciating', label: 'Depreciating' }, { value: 'appreciating', label: 'Appreciating' }, { value: 'non_depreciating', label: 'Non-depreciating' }]}
                  value={nature} onChange={(v) => setNature(v as any)} searchPlaceholder="Search..." disabled={!!editingId}
                />
                {editingId && <p className="text-xs text-muted-foreground mt-1">Nature can't be changed once assets may already have been recorded under it.</p>}
              </div>
              {nature === 'depreciating' && (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Default Useful Life (years)</label>
                    <Input type="number" min="1" value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Default Salvage %</label>
                    <Input type="number" min="0" max="100" value={salvagePercent} onChange={(e) => setSalvagePercent(e.target.value)} />
                  </div>
                </>
              )}
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Asset Account</label>
                <Combobox options={assetAccounts.map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))} value={assetAccountCode} onChange={setAssetAccountCode} placeholder="Select account..." searchPlaceholder="Search..." />
              </div>
              {nature === 'depreciating' && (
                <>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Accumulated Depreciation Account</label>
                    <Combobox options={assetAccounts.map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))} value={accumAccountCode} onChange={setAccumAccountCode} placeholder="Select account..." searchPlaceholder="Search..." />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Depreciation Expense Account</label>
                    <Combobox options={expenseAccounts.map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }))} value={expenseAccountCode} onChange={setExpenseAccountCode} placeholder="Select account..." searchPlaceholder="Search..." />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}{editingId ? 'Update Category' : 'Save Category'}</Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
