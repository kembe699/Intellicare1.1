import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { ShieldCheck, Loader2, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { toast } from '@/lib/notify';

// ─── Types ──────────────────────────────────────────────────
interface UserOption {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

interface ApprovalType {
  key: string;
  label: string;
  module: string;
  description: string;
}

interface ApprovalGrant {
  id: string;
  user_id: string;
  approval_type: string;
  label: string;
  module: string;
  display_name: string;
  email: string;
  granted_by_name: string | null;
  created_at: string;
  sole_approver: boolean;
}

// The only two approval types that are multi-level chains (2-level expense,
// 3-level supplier bill) — sole_approver only means anything for these;
// every other approval type is a single step with no co-approval rule to
// bypass in the first place.
const MULTI_LEVEL_APPROVAL_TYPES = new Set(['expense_approve', 'supplier_bill_approve']);

// ─── Main Component ─────────────────────────────────────────
// Single-page dual-list transfer control — same pattern as the Roles &
// Privileges screen: pick a user, then move approval types between
// "Granted" (left) and "All Approval Types" (right) with the arrows.
const Approvals: React.FC = () => {
  const { user } = useAuth();

  const [users, setUsers] = useState<UserOption[]>([]);
  const [types, setTypes] = useState<ApprovalType[]>([]);
  const [grants, setGrants] = useState<ApprovalGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [checkedAssigned, setCheckedAssigned] = useState<Set<string>>(new Set());
  const [checkedAvailable, setCheckedAvailable] = useState<Set<string>>(new Set());
  const [assignedSearch, setAssignedSearch] = useState('');
  const [availableSearch, setAvailableSearch] = useState('');

  const fetchUsers = async () => {
    try {
      const r = await authFetch('/api/users?all=true');
      if (!r.ok) throw new Error('Failed to fetch users');
      const data = await r.json();
      const transformed: UserOption[] = data
        .map((u: any) => ({
          id: u.id,
          displayName: u.display_name || u.displayName || '',
          email: u.email || '',
          role: u.role || '',
        }))
        // Admins already pass requireApprovalPermission's own permission gate
        // unconditionally, so granting one an approval_type here changes
        // nothing by itself — the one thing it DOES let an admin pick up is
        // sole_approver (see MULTI_LEVEL_APPROVAL_TYPES below), which an
        // admin does NOT get for free: the segregation-of-duties check in
        // daily-expenses.js still blocks an admin from clearing a second
        // level of the same chain unless they hold that explicit grant too.
        // Previously filtered out entirely, which made this screen the only
        // way to set that exemption unreachable for an admin account.
        .sort((a: UserOption, b: UserOption) => a.displayName.localeCompare(b.displayName));
      setUsers(transformed);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    }
  };

  const fetchTypes = async () => {
    try {
      const r = await authFetch('/api/approvals/types');
      if (!r.ok) throw new Error('Failed to fetch approval types');
      setTypes(await r.json());
    } catch (error) {
      console.error('Error fetching approval types:', error);
      toast.error('Failed to load approval types');
    }
  };

  const fetchGrants = async () => {
    try {
      const r = await authFetch('/api/approvals/permissions');
      if (!r.ok) throw new Error('Failed to fetch approval permissions');
      setGrants(await r.json());
    } catch (error) {
      console.error('Error fetching approval permissions:', error);
      toast.error('Failed to load approval permissions');
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchUsers(), fetchTypes(), fetchGrants()]).finally(() => setLoading(false));
  }, []);

  // Grants for whichever user is selected — derived from the already-loaded
  // grants list rather than a separate fetch per selection.
  // user_id comes back from the DB as a number (approval_permissions.user_id
  // is INT); selectedUserId is the Combobox's string value — compare as
  // strings so a real grant doesn't silently fail to match here.
  const grantsForUser = grants.filter((g) => String(g.user_id) === selectedUserId);
  const assignedKeys = new Set(grantsForUser.map((g) => g.approval_type));

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    setCheckedAssigned(new Set());
    setCheckedAvailable(new Set());
  };

  const grantTypes = async (typeKeys: string[]) => {
    if (!selectedUserId || typeKeys.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(typeKeys.map((approval_type) =>
        authFetch('/api/approvals/permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: selectedUserId, approval_type }),
        })
      ));
      setCheckedAvailable(new Set());
      await fetchGrants();
    } catch {
      toast.error('Failed to grant one or more permissions');
    } finally {
      setSaving(false);
    }
  };

  const toggleSoleApprover = async (approvalType: string, soleApprover: boolean) => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      const r = await authFetch('/api/approvals/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUserId, approval_type: approvalType, sole_approver: soleApprover }),
      });
      if (!r.ok) throw new Error('Failed');
      await fetchGrants();
    } catch {
      toast.error('Failed to update sole-approver setting');
    } finally {
      setSaving(false);
    }
  };

  const revokeTypes = async (typeKeys: string[]) => {
    if (!selectedUserId || typeKeys.length === 0) return;
    setSaving(true);
    try {
      const grantIds = grantsForUser.filter((g) => typeKeys.includes(g.approval_type)).map((g) => g.id);
      await Promise.all(grantIds.map((id) =>
        authFetch(`/api/approvals/permissions/${id}`, { method: 'DELETE' })
      ));
      setCheckedAssigned(new Set());
      await fetchGrants();
    } catch {
      toast.error('Failed to revoke one or more permissions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="animate-fade-in w-full flex flex-col space-y-4">
        <PageHeader
          icon={<ShieldCheck />}
          title="Approval Permissions"
        />

        <div className="w-72">
          <Label className="text-xs font-medium text-muted-foreground">User</Label>
          <Combobox
            options={users.map((u) => ({ value: String(u.id), label: `${u.displayName} — ${u.email}` }))}
            value={selectedUserId}
            onChange={handleSelectUser}
            placeholder={loading ? 'Loading users...' : 'Select user'}
            searchPlaceholder="Search users..."
          />
          <p className="text-xs text-muted-foreground mt-1">
            Admins already pass every approval permission check automatically. The only reason
            to grant one here is the "Sole approver" exemption below, for Daily Expense Approval
            or Supplier Bill Approval specifically.
          </p>
        </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
            {/* Granted */}
            <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-muted/30">
                <h3 className="text-sm font-semibold mb-2">Granted Permissions</h3>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={assignedSearch}
                    onChange={(e) => setAssignedSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex-1 min-h-[360px] max-h-[420px] overflow-y-auto divide-y">
                {types
                  .filter((t) => assignedKeys.has(t.key))
                  .filter((t) => !assignedSearch || t.label.toLowerCase().includes(assignedSearch.toLowerCase()))
                  .map((t) => {
                    const grant = grantsForUser.find((g) => g.approval_type === t.key);
                    return (
                      <div key={t.key} className="px-3 py-2 text-sm hover:bg-muted/40">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-0.5 rounded"
                            checked={checkedAssigned.has(t.key)}
                            onChange={(e) => {
                              setCheckedAssigned((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(t.key); else next.delete(t.key);
                                return next;
                              });
                            }}
                          />
                          <span>
                            {t.label}
                            <span className="block text-xs text-muted-foreground">{t.module}</span>
                          </span>
                        </label>
                        {MULTI_LEVEL_APPROVAL_TYPES.has(t.key) && (
                          <label className="flex items-center gap-1.5 mt-1.5 ml-6 text-xs text-amber-700 cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={!!grant?.sole_approver}
                              disabled={saving}
                              onChange={(e) => toggleSoleApprover(t.key, e.target.checked)}
                            />
                            Sole approver — can clear every level alone, bypassing the normal
                            different-approver-per-level requirement
                          </label>
                        )}
                      </div>
                    );
                  })}
                {assignedKeys.size === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    {selectedUserId ? 'No approval permissions granted yet' : 'Select a user above to see what they can approve'}
                  </div>
                )}
              </div>
            </div>

            {/* Transfer controls */}
            <div className="flex lg:flex-col items-center justify-center gap-2 py-2">
              <Button
                type="button" variant="outline" size="icon" className="h-9 w-9" title="Grant all"
                onClick={() => grantTypes(types.filter((t) => !assignedKeys.has(t.key)).map((t) => t.key))}
                disabled={saving || !selectedUserId}
              >
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button
                type="button" variant="outline" size="icon" className="h-9 w-9" title="Grant selected"
                onClick={() => grantTypes(Array.from(checkedAvailable))}
                disabled={saving || !selectedUserId || checkedAvailable.size === 0}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                type="button" variant="outline" size="icon" className="h-9 w-9" title="Revoke selected"
                onClick={() => revokeTypes(Array.from(checkedAssigned))}
                disabled={saving || !selectedUserId || checkedAssigned.size === 0}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                type="button" variant="outline" size="icon" className="h-9 w-9" title="Revoke all"
                onClick={() => revokeTypes(Array.from(assignedKeys))}
                disabled={saving || !selectedUserId}
              >
                <ChevronsRight className="w-4 h-4" />
              </Button>
              {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-1" />}
            </div>

            {/* All approval types */}
            <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-muted/30">
                <h3 className="text-sm font-semibold mb-2">All Privileges</h3>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={availableSearch}
                    onChange={(e) => setAvailableSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex-1 min-h-[360px] max-h-[420px] overflow-y-auto divide-y">
                {types
                  .filter((t) => !assignedKeys.has(t.key))
                  .filter((t) => !availableSearch || t.label.toLowerCase().includes(availableSearch.toLowerCase()))
                  .map((t) => (
                    <label key={t.key} className={`flex items-start gap-2.5 px-3 py-2 text-sm hover:bg-muted/40 ${selectedUserId ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                      <input
                        type="checkbox"
                        className="mt-0.5 rounded"
                        checked={checkedAvailable.has(t.key)}
                        disabled={!selectedUserId}
                        onChange={(e) => {
                          setCheckedAvailable((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(t.key); else next.delete(t.key);
                            return next;
                          });
                        }}
                      />
                      <span>
                        {t.label}
                        <span className="block text-xs text-muted-foreground">{t.module}</span>
                      </span>
                    </label>
                  ))}
                {assignedKeys.size === types.length && types.length > 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground">Every approval type is already granted</div>
                )}
              </div>
            </div>
          </div>
      </div>
      </div>
    </AppLayout>
  );
};

export default Approvals;
