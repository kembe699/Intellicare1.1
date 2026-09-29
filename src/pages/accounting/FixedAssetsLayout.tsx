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
import { Building2, Plus, Settings, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Category, ChartAccount, NATURE_LABEL } from './fixedAssetsShared';

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
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [nature, setNature] = useState<'depreciating' | 'appreciating' | 'non_depreciating'>('depreciating');
  const [usefulLife, setUsefulLife] = useState('');
  const [salvagePercent, setSalvagePercent] = useState('0');
  const [assetAccountCode, setAssetAccountCode] = useState('');
  const [accumAccountCode, setAccumAccountCode] = useState('');
  const [expenseAccountCode, setExpenseAccountCode] = useState('');
  const [saving, setSaving] = useState(false);

  const assetAccounts = accounts.filter((a) => a.account_type === 'asset');
  const expenseAccounts = accounts.filter((a) => a.account_type === 'expense');

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const assetAccount = accounts.find((a) => a.account_code === assetAccountCode);
    const accumAccount = accounts.find((a) => a.account_code === accumAccountCode);
    const expenseAccount = accounts.find((a) => a.account_code === expenseAccountCode);
    if (!assetAccount) { toast.error('Select the asset GL account'); return; }
    if (nature === 'depreciating' && (!accumAccount || !expenseAccount)) { toast.error('A depreciating category needs both an accumulated-depreciation and a depreciation-expense account'); return; }

    setSaving(true);
    try {
      const res = await authFetch('/api/fixed-assets/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(), nature, default_useful_life_years: usefulLife ? parseInt(usefulLife, 10) : null,
          default_salvage_percent: parseFloat(salvagePercent) || 0, asset_account_id: assetAccount.id,
          accumulated_depreciation_account_id: accumAccount?.id, depreciation_expense_account_id: expenseAccount?.id,
        }),
      });
      if (res.ok) {
        toast.success('Category created');
        setCreating(false); setName(''); setUsefulLife(''); setAssetAccountCode(''); setAccumAccountCode(''); setExpenseAccountCode('');
        onChanged();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to create category');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Asset Categories</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{NATURE_LABEL[c.nature]}{c.default_useful_life_years ? ` · ${c.default_useful_life_years}y` : ''}</span>
              </div>
              <span className="text-xs text-muted-foreground">{c.asset_account_name}</span>
            </div>
          ))}
        </div>

        {!creating ? (
          <Button variant="outline" size="sm" className="gap-1.5 w-fit" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> New Category</Button>
        ) : (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vehicles" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Nature</label>
                <Combobox
                  options={[{ value: 'depreciating', label: 'Depreciating' }, { value: 'appreciating', label: 'Appreciating' }, { value: 'non_depreciating', label: 'Non-depreciating' }]}
                  value={nature} onChange={(v) => setNature(v as any)} searchPlaceholder="Search..."
                />
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
              <Button variant="outline" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}Save Category</Button>
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
