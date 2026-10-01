import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { UserRole } from '@/types';
import {
  UserPlus, Search, Eye, EyeOff, Edit, Check, X, Loader2, AlertCircle, Trash2, Settings,
  Users, ShieldCheck, Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, KeyRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Combobox, MultiSelectCombobox } from '@/components/ui/combobox';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

// ─── Types ──────────────────────────────────────────────────
interface UserData {
  id: string;
  displayName: string;
  email: string;
  role: UserRole | string;
  // Extra roles held alongside `role` — effective privileges are the union
  // of every role held (see permissionsCatalog.js / authorize.js). Managed
  // from the Edit User dialog below.
  additionalRoles: string[];
  clinic: string;
  clinic_id?: number;
  branch_id?: number | null;
  branchName?: string;
  // Full multi-branch assignment — branch_id/branchName above stay as just the
  // primary (branchIds[0]) for anywhere that only ever needs one.
  branchIds?: number[];
  isActive: boolean;
  createdAt?: string;
  lastLogin?: string;
}

interface BranchData {
  id: number;
  name: string;
  is_active: boolean;
}

interface RoleData {
  id: number;
  role_key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  privilege_count: number;
}

interface PrivilegeData {
  id: number;
  privilege_key: string;
  name: string;
  module: string | null;
  description: string | null;
}

// ─── Constants ──────────────────────────────────────────────
// Loading-state fallback only, for the brief window before GET /api/roles
// resolves (or if it fails) — roleOptions below already prefers the live
// `roles` state once it has loaded. The real, authoritative role list is
// whatever's in the database (src/server/config/permissionsCatalog.js seeds
// it, but an admin can add more via the Roles tab) — do not treat this array
// as complete or as a source of truth for anything beyond that brief window.
const ROLES: { value: string; label: string }[] = [
  { value: 'admin', label: 'Administrator' },
  { value: 'reception', label: 'Reception' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'lab', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'reports', label: 'Reports' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'finance_manager', label: 'Finance Manager' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'cashier', label: 'Cashier' },
];

// Badge color for the 12 built-in roles only — StatusBadge already falls
// back to a neutral tone for any role not listed here (custom roles created
// via the Roles tab included), so this needs no entry added when a new
// custom role is created.
const ROLE_TONES: Record<string, StatusBadgeTone> = {
  admin: 'danger',
  doctor: 'primary',
  reception: 'success',
  lab: 'info',
  pharmacy: 'info',
  reports: 'neutral',
  accountant: 'warning',
  finance_manager: 'primary',
  auditor: 'danger',
  procurement: 'success',
  nurse: 'info',
  cashier: 'warning',
};

// ─── Main Component ─────────────────────────────────────────
const Security: React.FC = () => {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { user } = useAuth();

  // Data state
  const [users, setUsers] = useState<UserData[]>([]);
  const [branches, setBranches] = useState<BranchData[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchesLoading, setBranchesLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal state
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserData | null>(null);
  const [saving, setSaving] = useState(false);
  const [newCredentials, setNewCredentials] = useState<{ name: string; email: string; password: string; emailDelivered?: boolean; mode?: 'created' | 'reset' } | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  // Create form
  const [createFormData, setCreateFormData] = useState({
    displayName: '',
    email: '',
    role: '' as string,
    additionalRoles: [] as string[],
    clinic: user?.clinic || 'IntelliCare',
    // First selected = primary branch, same convention the backend uses when
    // syncing user_branches (see resolveBranchIdsForNewUser in users.js).
    branch_ids: [] as string[],
  });

  // Edit form
  const [editFormData, setEditFormData] = useState({
    displayName: '',
    role: '' as string,
    additionalRoles: [] as string[],
    clinic: '',
    branch_ids: [] as string[],
  });

  // ─── Roles & Privileges tab state ──────────────────────────
  const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users');
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [privileges, setPrivileges] = useState<PrivilegeData[]>([]);
  const [privilegesLoading, setPrivilegesLoading] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [assignedIds, setAssignedIds] = useState<Set<number>>(new Set());
  const [loadingAssigned, setLoadingAssigned] = useState(false);
  const [savingPrivileges, setSavingPrivileges] = useState(false);
  const [checkedAssigned, setCheckedAssigned] = useState<Set<number>>(new Set());
  const [checkedAvailable, setCheckedAvailable] = useState<Set<number>>(new Set());
  const [assignedSearch, setAssignedSearch] = useState('');
  const [availableSearch, setAvailableSearch] = useState('');

  const [showNewRoleForm, setShowNewRoleForm] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState({ role_key: '', name: '', description: '' });
  const [creatingRole, setCreatingRole] = useState(false);

  const [newPrivilegeName, setNewPrivilegeName] = useState('');
  const [addingPrivilege, setAddingPrivilege] = useState(false);

  // ─── API: Fetch Users ─────────────────────────────────────
  const fetchUsers = async () => {
    try {
      const response = await authFetch('/api/users?all=true');
      if (!response.ok) throw new Error('Failed to fetch users');
      const usersData = await response.json();

      const clinicIdToName: Record<number, string> = { 1: 'IntelliCare' };

      const transformed: UserData[] = usersData.map((u: any) => ({
        id: u.id,
        displayName: u.display_name || u.displayName || '',
        email: u.email || '',
        role: u.role || '',
        additionalRoles: Array.isArray(u.additional_roles) ? u.additional_roles : [],
        clinic: clinicIdToName[u.clinic_id] || u.clinic || '',
        clinic_id: u.clinic_id,
        branch_id: u.branch_id || null,
        branchName: u.branch_name || null,
        branchIds: Array.isArray(u.branch_ids) ? u.branch_ids : (u.branch_id ? [u.branch_id] : []),
        isActive: u.is_active !== undefined ? !!u.is_active : true,
        createdAt: u.created_at || u.createdAt,
        lastLogin: u.last_login || u.lastLogin,
      }));

      setUsers(transformed.sort((a, b) => a.displayName.localeCompare(b.displayName)));
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  // ─── API: Fetch Branches ──────────────────────────────────
  const fetchBranches = async () => {
    setBranchesLoading(true);
    try {
      const response = await authFetch('/api/facilities/branches/all');
      if (!response.ok) throw new Error('Failed to fetch branches');
      const data = await response.json();
      setBranches(data.data || []);
    } catch (error) {
      console.error('Error fetching branches:', error);
    } finally {
      setBranchesLoading(false);
    }
  };

  // ─── API: Roles & Privileges ────────────────────────────────
  const fetchRoles = async () => {
    setRolesLoading(true);
    try {
      const response = await authFetch('/api/roles');
      if (!response.ok) throw new Error('Failed to fetch roles');
      const data: RoleData[] = await response.json();
      setRoles(data);
      setSelectedRoleId(prev => prev ?? (data[0]?.id ?? null));
    } catch (error) {
      console.error('Error fetching roles:', error);
      toast.error('Failed to load roles');
    } finally {
      setRolesLoading(false);
    }
  };

  const fetchPrivileges = async () => {
    setPrivilegesLoading(true);
    try {
      const response = await authFetch('/api/roles/privileges/all');
      if (!response.ok) throw new Error('Failed to fetch privileges');
      setPrivileges(await response.json());
    } catch (error) {
      console.error('Error fetching privileges:', error);
      toast.error('Failed to load privileges');
    } finally {
      setPrivilegesLoading(false);
    }
  };

  const fetchAssignedPrivileges = async (roleId: number) => {
    setLoadingAssigned(true);
    try {
      const response = await authFetch(`/api/roles/${roleId}/privileges`);
      if (!response.ok) throw new Error('Failed to fetch role privileges');
      const ids: number[] = await response.json();
      setAssignedIds(new Set(ids));
      setCheckedAssigned(new Set());
      setCheckedAvailable(new Set());
    } catch (error) {
      console.error('Error fetching role privileges:', error);
      toast.error('Failed to load this role\'s privileges');
    } finally {
      setLoadingAssigned(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchBranches();
    fetchRoles();
    fetchPrivileges();
  }, []);

  useEffect(() => {
    if (selectedRoleId != null) fetchAssignedPrivileges(selectedRoleId);
  }, [selectedRoleId]);

  // Persists a full replacement set of assigned privilege IDs for the selected role.
  const persistAssignments = async (nextAssigned: Set<number>) => {
    if (selectedRoleId == null) return;
    setSavingPrivileges(true);
    try {
      const response = await authFetch(`/api/roles/${selectedRoleId}/privileges`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privilege_ids: Array.from(nextAssigned) }),
      });
      if (!response.ok) throw new Error('Failed to save privileges');
      setAssignedIds(nextAssigned);
      setRoles(prev => prev.map(r => r.id === selectedRoleId ? { ...r, privilege_count: nextAssigned.size } : r));
    } catch (error) {
      toast.error('Failed to save privilege changes');
    } finally {
      setSavingPrivileges(false);
    }
  };

  const moveToAssigned = () => {
    if (checkedAvailable.size === 0) return;
    const next = new Set(assignedIds);
    checkedAvailable.forEach(id => next.add(id));
    setCheckedAvailable(new Set());
    persistAssignments(next);
  };

  const moveToAvailable = () => {
    if (checkedAssigned.size === 0) return;
    const next = new Set(assignedIds);
    checkedAssigned.forEach(id => next.delete(id));
    setCheckedAssigned(new Set());
    persistAssignments(next);
  };

  const moveAllToAssigned = () => {
    persistAssignments(new Set(privileges.map(p => p.id)));
  };

  const moveAllToAvailable = () => {
    persistAssignments(new Set());
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleForm.role_key.trim() || !newRoleForm.name.trim()) {
      toast.error('Role key and name are required');
      return;
    }
    setCreatingRole(true);
    try {
      const response = await authFetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRoleForm),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create role');
      }
      const created: RoleData = await response.json();
      toast.success(`Role "${created.name}" created`);
      setShowNewRoleForm(false);
      setNewRoleForm({ role_key: '', name: '', description: '' });
      await fetchRoles();
      setSelectedRoleId(created.id);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create role');
    } finally {
      setCreatingRole(false);
    }
  };

  const handleAddPrivilege = async () => {
    if (!newPrivilegeName.trim()) return;
    setAddingPrivilege(true);
    try {
      const response = await authFetch('/api/roles/privileges/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPrivilegeName.trim(), module: 'Custom' }),
      });
      if (!response.ok) throw new Error('Failed to add privilege');
      toast.success('Privilege added');
      setNewPrivilegeName('');
      await fetchPrivileges();
    } catch {
      toast.error('Failed to add privilege');
    } finally {
      setAddingPrivilege(false);
    }
  };

  // ─── Handlers ─────────────────────────────────────────────
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!createFormData.displayName.trim()) { toast.error('Full name is required'); return; }
    if (!createFormData.email.trim()) { toast.error('Email is required'); return; }
    if (!createFormData.role) { toast.error('Role is required'); return; }

    setSaving(true);
    try {
      const response = await authFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: createFormData.email.toLowerCase().trim(),
          displayName: createFormData.displayName.trim(),
          role: createFormData.role,
          additionalRoles: createFormData.additionalRoles.filter((r) => r !== createFormData.role),
          // clinic is intentionally not sent. It used to carry a clinic *name*
          // that the server looked up in a hardcoded map from the original
          // single-tenant deployment, where the default 'IntelliCare' resolved
          // to 1 on every tenant — stranding new users on a clinic holding none
          // of that tenant's data. The server now resolves it from the tenant.
          branch_ids: createFormData.branch_ids.map((id) => parseInt(id, 10)),
          isActive: true,
          status: 'pending',
          createdBy: user.displayName,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || err.error || 'Failed to create user');
      }

      // Shown once, in a dialog the admin has to dismiss deliberately — a toast
      // would disappear on its own and take the only copy of the password with
      // it. There is no way to retrieve it afterwards; the account would have to
      // be reset instead.
      const created = await response.json().catch(() => null);
      setNewCredentials({
        name: createFormData.displayName,
        email: createFormData.email.toLowerCase().trim(),
        password: created?.tempPassword || '',
        emailDelivered: created?.emailDelivered,
        mode: 'created',
      });
      setCreateFormData({ displayName: '', email: '', role: '', additionalRoles: [], clinic: user?.clinic || 'IntelliCare', branch_ids: [] });
      fetchUsers();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  // Admin-triggered reset for a locked-out user — generates a brand-new
  // temporary password (same mechanism as account creation) and, if the
  // account has an email on file, sends it there too. Shown once in the same
  // "credentials" dialog account creation already uses.
  const handleResetPassword = async (u: UserData) => {
    if (!(await confirm({ description: `Reset the password for ${u.displayName}? A new temporary password will be generated${u.email ? ' and emailed to them if possible' : ''}.` }))) return;
    setResettingUserId(u.id);
    try {
      const response = await authFetch(`/api/users/${u.id}/reset-password`, { method: 'POST' });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to reset password');
      }
      const data = await response.json();
      setNewCredentials({
        name: u.displayName,
        email: u.email,
        password: data.tempPassword || '',
        emailDelivered: data.emailDelivered,
        mode: 'reset',
      });
    } catch (error: any) {
      toast.error(error.message || 'Failed to reset password');
    } finally {
      setResettingUserId(null);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setSaving(true);
    try {
      const response = await authFetch(`/api/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: (editFormData.displayName || '').trim(),
          role: editFormData.role,
          additionalRoles: editFormData.additionalRoles.filter((r) => r !== editFormData.role),
          clinic: editFormData.clinic,
          branch_ids: editFormData.branch_ids.map((id) => parseInt(id, 10)),
          updatedBy: user?.displayName,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Failed to update user');
      }

      toast.success(`User ${editFormData.displayName || 'User'} updated successfully`);
      setShowEditForm(false);
      setEditingUser(null);
      fetchUsers();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    if (togglingUserId) return;
    setTogglingUserId(userId);
    try {
      const response = await authFetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus, updatedBy: user?.displayName }),
      });
      if (!response.ok) throw new Error('Failed to update user status');
      toast.success(`User ${!currentStatus ? 'enabled' : 'disabled'} successfully`);
      fetchUsers();
    } catch (error) {
      toast.error('Failed to update user status');
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setSaving(true);
    try {
      const response = await authFetch(`/api/users/${deletingUser.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete user');
      toast.success(`User ${deletingUser.displayName} deleted successfully`);
      setShowDeleteDialog(false);
      setDeletingUser(null);
      fetchUsers();
    } catch (error) {
      toast.error('Failed to delete user');
    } finally {
      setSaving(false);
    }
  };

  const openEditForm = (u: UserData) => {
    setEditingUser(u);
    setEditFormData({
      displayName: u.displayName || '',
      role: u.role || '',
      additionalRoles: u.additionalRoles || [],
      clinic: u.clinic || 'IntelliCare',
      branch_ids: (u.branchIds && u.branchIds.length ? u.branchIds : (u.branch_id ? [u.branch_id] : [])).map(String),
    });
    setShowEditForm(true);
  };

  const openDeleteDialog = (u: UserData) => {
    setDeletingUser(u);
    setShowDeleteDialog(true);
  };

  // ─── Filters ──────────────────────────────────────────────
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      (u.displayName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesBranch =
      branchFilter === 'all' ||
      (branchFilter === 'unassigned'
        ? !(u.branchIds && u.branchIds.length)
        : (u.branchIds || []).map(String).includes(branchFilter));
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' ? u.isActive : !u.isActive);
    return matchesSearch && matchesRole && matchesBranch && matchesStatus;
  });

  // ─── Helpers ──────────────────────────────────────────────
  const getBranchName = (branchId: number | null | undefined) => {
    if (!branchId) return '—';
    return branches.find((b) => b.id === branchId)?.name || '—';
  };

  const getRoleLabel = (role: string) => {
    const found = roles.find((r) => r.role_key === role) || ROLES.find((r) => r.value === role);
    return found ? ('name' in found ? found.name : found.label) : role;
  };

  // Custom roles created on the Roles tab show up here too, so they're
  // immediately assignable to a user — falls back to the static list while
  // roles are still loading.
  const roleOptions = roles.length > 0
    ? roles.map((r) => ({ value: r.role_key, label: r.name }))
    : ROLES;

  // ─── Render ───────────────────────────────────────────────
  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="animate-fade-in w-full flex flex-col">
        <PageHeader
          icon={<Settings />}
          title="Security & User Management"
        />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'users' | 'roles')} className="space-y-6">
          <TabsList>
            <TabsTrigger value="users" className="gap-1.5"><Users className="w-3.5 h-3.5" /> Users</TabsTrigger>
            <TabsTrigger value="roles" className="gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Roles & Privileges</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-0">
        {/* Left: Create User form (always visible) · Right: Search/filters + list */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Create User panel */}
          <div className="lg:col-span-1">
            <div className="bg-card rounded-lg border shadow-sm p-4 lg:sticky lg:top-4">
              <div className="flex items-center gap-2 mb-4">
                <UserPlus className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-[15px]">Create New User</h2>
              </div>

              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Full Name *</Label>
                  <Input
                    value={createFormData.displayName}
                    onChange={(e) => setCreateFormData({ ...createFormData, displayName: e.target.value })}
                    placeholder="Enter full name"
                    required
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Email Address *</Label>
                  <Input
                    type="email"
                    value={createFormData.email}
                    onChange={(e) => setCreateFormData({ ...createFormData, email: e.target.value })}
                    placeholder="Enter email address"
                    required
                    className="mt-1"
                  />
                </div>

                <div className="bg-card p-3 rounded-md">
                  <p className="text-xs text-muted-foreground">
                    <strong>Note:</strong> A random temporary password is generated for this account. You'll see it once, right after creating the user — hand it over to them then, since it can't be shown again.
                  </p>
                </div>

                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Role *</Label>
                  <Combobox
                    options={roleOptions}
                    value={createFormData.role}
                    onChange={(value) => setCreateFormData({
                      ...createFormData,
                      role: value,
                      additionalRoles: createFormData.additionalRoles.filter((r) => r !== value),
                    })}
                    placeholder="Select role"
                    searchPlaceholder="Search roles..."
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Additional Roles</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                    This user gets everything each role below can do, on top of their primary role above.
                  </p>
                  <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1.5">
                    {roleOptions.filter((r) => r.value !== createFormData.role).map((r) => (
                      <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={createFormData.additionalRoles.includes(r.value)}
                          onCheckedChange={(checked) => setCreateFormData((prev) => ({
                            ...prev,
                            additionalRoles: checked
                              ? [...prev.additionalRoles, r.value]
                              : prev.additionalRoles.filter((x) => x !== r.value),
                          }))}
                        />
                        {r.label}
                      </label>
                    ))}
                    {roleOptions.filter((r) => r.value !== createFormData.role).length === 0 && (
                      <p className="text-xs text-muted-foreground">No other roles available</p>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Assign to Branch(es)</Label>
                  <MultiSelectCombobox
                    options={branches.filter(b => b.is_active).map((b) => ({ value: String(b.id), label: b.name }))}
                    values={createFormData.branch_ids}
                    onChange={(values) => setCreateFormData({ ...createFormData, branch_ids: values })}
                    placeholder="Select branch(es) (optional)"
                    searchPlaceholder="Search branches..."
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {createFormData.branch_ids.length > 1
                      ? `Access to ${createFormData.branch_ids.length} branches — the first one picked is their primary/default branch.`
                      : 'Assign the user to one or more branch locations'}
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={saving || !createFormData.displayName.trim() || !createFormData.email.trim() || !createFormData.role}
                >
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  {saving ? 'Creating...' : 'Create User'}
                </Button>
              </form>
            </div>
          </div>

          {/* User list panel */}
          <div className="lg:col-span-2 space-y-4">
            {/* Search & Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Combobox
                options={[{ value: 'all', label: 'All Roles' }, ...ROLES]}
                value={roleFilter}
                onChange={setRoleFilter}
                searchPlaceholder="Search roles..."
                className="w-[160px]"
              />
              <Combobox
                options={[
                  { value: 'all', label: 'All Branches' },
                  { value: 'unassigned', label: 'Unassigned' },
                  ...branches.map((b) => ({ value: String(b.id), label: b.name })),
                ]}
                value={branchFilter}
                onChange={setBranchFilter}
                searchPlaceholder="Search branches..."
                className="w-[170px]"
              />
              <Combobox
                options={[
                  { value: 'all', label: 'All Status' },
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                ]}
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as any)}
                searchPlaceholder="Search..."
                className="w-[140px]"
              />
            </div>

            {/* Users Table */}
            <AdvancedDataTable<UserData>
              data={filteredUsers}
              keyExtractor={(u) => u.id}
              loading={loading}
              emptyMessage={
                searchQuery || roleFilter !== 'all' || branchFilter !== 'all' || statusFilter !== 'all'
                  ? 'No users match your filters'
                  : 'No users found'
              }
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'displayName', header: 'Name', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
                { key: 'email', header: 'Email', sortable: true, render: (v) => <span className="text-muted-foreground">{v}</span> },
                {
                  key: 'role', header: 'Role', sortable: true,
                  render: (v, u) => (
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={v} map={ROLE_TONES} label={getRoleLabel(v)} />
                      {u.additionalRoles?.map((r) => (
                        <StatusBadge key={r} status={r} map={ROLE_TONES} label={`+ ${getRoleLabel(r)}`} />
                      ))}
                    </div>
                  ),
                },
                {
                  key: 'branchName', header: 'Branch', sortable: true,
                  render: (_v, u) => {
                    const primary = u.branchName || getBranchName(u.branch_id);
                    const extra = (u.branchIds?.length || 0) - 1;
                    return (
                      <span className="text-muted-foreground">
                        {primary}
                        {extra > 0 && <span className="text-xs ml-1" title={`Also assigned to ${extra} more branch${extra === 1 ? '' : 'es'}`}>+{extra} more</span>}
                      </span>
                    );
                  },
                },
                {
                  key: 'isActive', header: 'Status', sortable: true,
                  render: (v) => <StatusBadge status={v ? 'active' : 'inactive'} map={{ active: 'success', inactive: 'danger' }} label={v ? 'Active' : 'Disabled'} />,
                },
                {
                  key: '__actions', header: 'Actions',
                  render: (_v, u) => (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditForm(u)} className="h-7 w-7" title="Edit user">
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleResetPassword(u)}
                        disabled={resettingUserId === u.id}
                        className="h-7 w-7"
                        title="Reset password"
                      >
                        {resettingUserId === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleUserStatus(u.id, u.isActive)}
                        disabled={togglingUserId === u.id}
                        className={`h-7 w-7 ${u.isActive ? 'text-destructive hover:text-destructive' : 'text-emerald-600 hover:text-emerald-600'}`}
                        title={u.isActive ? 'Disable user' : 'Enable user'}
                      >
                        {togglingUserId === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : u.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDeleteDialog(u)}
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Delete user"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ),
                },
              ]}
            />

            {/* Result count */}
            {!loading && (
              <p className="text-xs text-muted-foreground">
                Showing {filteredUsers.length} of {users.length} users
              </p>
            )}
          </div>
        </div>
          </TabsContent>

          <TabsContent value="roles" className="mt-0 space-y-4">
            {/* Role picker + new-role affordance */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-64">
                <Label className="text-xs font-medium text-muted-foreground">Role</Label>
                <Combobox
                  options={roles.map((r) => ({ value: String(r.id), label: `${r.name}${r.is_system ? '' : ' (custom)'}` }))}
                  value={selectedRoleId != null ? String(selectedRoleId) : ''}
                  onChange={(v) => setSelectedRoleId(v ? parseInt(v, 10) : null)}
                  placeholder={rolesLoading ? 'Loading roles...' : 'Select a role'}
                  searchPlaceholder="Search roles..."
                />
              </div>
              {selectedRoleId != null && (
                <span className="text-xs text-muted-foreground pb-2">
                  {assignedIds.size} of {privileges.length} privileges assigned
                </span>
              )}
              <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setShowNewRoleForm(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" /> New Role
              </Button>
            </div>

            {!selectedRoleId ? (
              <div className="bg-card rounded-lg border p-8 text-center text-sm text-muted-foreground">
                {rolesLoading ? 'Loading roles...' : 'Select a role above to manage its privileges.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
                {/* Role Privileges (assigned) */}
                <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
                  <div className="p-3 border-b bg-muted/30">
                    <h3 className="text-sm font-semibold mb-2">Role Privileges</h3>
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
                    {loadingAssigned ? (
                      <div className="p-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>
                    ) : (
                      privileges
                        .filter(p => assignedIds.has(p.id))
                        .filter(p => !assignedSearch || p.name.toLowerCase().includes(assignedSearch.toLowerCase()))
                        .map(p => (
                          <label key={p.id} className="flex items-start gap-2.5 px-3 py-2 text-sm hover:bg-muted/40 cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded"
                              checked={checkedAssigned.has(p.id)}
                              onChange={(e) => {
                                setCheckedAssigned(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(p.id); else next.delete(p.id);
                                  return next;
                                });
                              }}
                            />
                            <span>
                              {p.name}
                              {p.module && <span className="block text-[11px] text-muted-foreground">{p.module}</span>}
                            </span>
                          </label>
                        ))
                    )}
                    {!loadingAssigned && privileges.filter(p => assignedIds.has(p.id)).length === 0 && (
                      <div className="p-8 text-center text-sm text-muted-foreground">No privileges assigned yet</div>
                    )}
                  </div>
                </div>

                {/* Transfer controls */}
                <div className="flex lg:flex-col items-center justify-center gap-2 py-2">
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9" title="Assign all" onClick={moveAllToAssigned} disabled={savingPrivileges}>
                    <ChevronsLeft className="w-4 h-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9" title="Assign selected" onClick={moveToAssigned} disabled={savingPrivileges || checkedAvailable.size === 0}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9" title="Unassign selected" onClick={moveToAvailable} disabled={savingPrivileges || checkedAssigned.size === 0}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9" title="Unassign all" onClick={moveAllToAvailable} disabled={savingPrivileges}>
                    <ChevronsRight className="w-4 h-4" />
                  </Button>
                  {savingPrivileges && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-1" />}
                </div>

                {/* All Privileges (available) */}
                <div className="bg-card rounded-lg border shadow-sm flex flex-col overflow-hidden">
                  <div className="p-3 border-b bg-muted/30 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">All Privileges</h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        placeholder="Add a privilege here..."
                        value={newPrivilegeName}
                        onChange={(e) => setNewPrivilegeName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddPrivilege(); } }}
                        className="h-8 text-sm"
                      />
                      <Button type="button" size="icon" className="h-8 w-8 shrink-0" onClick={handleAddPrivilege} disabled={addingPrivilege || !newPrivilegeName.trim()}>
                        {addingPrivilege ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
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
                    {privilegesLoading ? (
                      <div className="p-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>
                    ) : (
                      privileges
                        .filter(p => !assignedIds.has(p.id))
                        .filter(p => !availableSearch || p.name.toLowerCase().includes(availableSearch.toLowerCase()))
                        .map(p => (
                          <label key={p.id} className="flex items-start gap-2.5 px-3 py-2 text-sm hover:bg-muted/40 cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded"
                              checked={checkedAvailable.has(p.id)}
                              onChange={(e) => {
                                setCheckedAvailable(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(p.id); else next.delete(p.id);
                                  return next;
                                });
                              }}
                            />
                            <span>
                              {p.name}
                              {p.module && <span className="block text-[11px] text-muted-foreground">{p.module}</span>}
                            </span>
                          </label>
                        ))
                    )}
                    {!privilegesLoading && privileges.filter(p => !assignedIds.has(p.id)).length === 0 && (
                      <div className="p-8 text-center text-sm text-muted-foreground">Every privilege is assigned to this role</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* ═══ New Role Modal ═══ */}
        <Dialog open={showNewRoleForm} onOpenChange={setShowNewRoleForm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                New Role
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateRole} className="px-5 py-4 space-y-4 mt-2">
              <div>
                <Label className="text-sm font-medium">Role Key *</Label>
                <Input
                  value={newRoleForm.role_key}
                  onChange={(e) => setNewRoleForm({ ...newRoleForm, role_key: e.target.value })}
                  placeholder="e.g. data_clerk"
                  required
                  autoFocus
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">Lowercase, no spaces — this is what gets stored on a user's account.</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Display Name *</Label>
                <Input
                  value={newRoleForm.name}
                  onChange={(e) => setNewRoleForm({ ...newRoleForm, name: e.target.value })}
                  placeholder="e.g. Data Clerk"
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Description</Label>
                <Textarea
                  value={newRoleForm.description}
                  onChange={(e) => setNewRoleForm({ ...newRoleForm, description: e.target.value })}
                  placeholder="Optional notes about this role"
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNewRoleForm(false)} className="flex-1" disabled={creatingRole}>
                  <X className="w-4 h-4 mr-2" /> Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={creatingRole || !newRoleForm.role_key.trim() || !newRoleForm.name.trim()}>
                  {creatingRole ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  Create Role
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ═══ Edit User Modal ═══ */}
        <Dialog open={showEditForm} onOpenChange={setShowEditForm}>
          <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit className="w-5 h-5" />
                Edit User
              </DialogTitle>
            </DialogHeader>

            {editingUser && (
              <form onSubmit={handleEditUser} className="px-5 py-4 space-y-4 mt-4">
                <div className="bg-muted/50 p-3 rounded-md">
                  <p className="text-sm font-medium">Email: {editingUser.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Status: {editingUser.isActive ? 'Active' : 'Disabled'} • ID: {String(editingUser.id).slice(0, 8)}...
                  </p>
                </div>

                <div>
                  <Label className="text-sm font-medium">Full Name *</Label>
                  <Input
                    value={editFormData.displayName}
                    onChange={(e) => setEditFormData({ ...editFormData, displayName: e.target.value })}
                    placeholder="Enter full name"
                    required
                    autoFocus
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium">Role *</Label>
                  <Combobox
                    options={roleOptions}
                    value={editFormData.role}
                    onChange={(value) => setEditFormData({
                      ...editFormData,
                      role: value,
                      additionalRoles: editFormData.additionalRoles.filter((r) => r !== value),
                    })}
                    placeholder="Select role"
                    searchPlaceholder="Search roles..."
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium">Additional Roles</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                    This user gets everything each role below can do, on top of their primary role above.
                  </p>
                  <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1.5">
                    {roleOptions.filter((r) => r.value !== editFormData.role).map((r) => (
                      <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={editFormData.additionalRoles.includes(r.value)}
                          onCheckedChange={(checked) => setEditFormData((prev) => ({
                            ...prev,
                            additionalRoles: checked
                              ? [...prev.additionalRoles, r.value]
                              : prev.additionalRoles.filter((x) => x !== r.value),
                          }))}
                        />
                        {r.label}
                      </label>
                    ))}
                    {roleOptions.filter((r) => r.value !== editFormData.role).length === 0 && (
                      <p className="text-xs text-muted-foreground">No other roles available</p>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">Assign to Branch(es)</Label>
                  <MultiSelectCombobox
                    options={branches.filter(b => b.is_active).map((b) => ({ value: String(b.id), label: b.name }))}
                    values={editFormData.branch_ids}
                    onChange={(values) => setEditFormData({ ...editFormData, branch_ids: values })}
                    placeholder="Select branch(es) (optional)"
                    searchPlaceholder="Search branches..."
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {editFormData.branch_ids.length > 1
                      ? `Access to ${editFormData.branch_ids.length} branches — the first one picked is their primary/default branch.`
                      : 'Assign the user to one or more branch locations'}
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowEditForm(false)} className="flex-1" disabled={saving}>
                    <X className="w-4 h-4 mr-2" /> Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={saving || !(editFormData.displayName || '').trim() || !editFormData.role}
                  >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    Update User
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* ═══ Delete User Confirmation ═══ */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-destructive" />
                Delete User
              </DialogTitle>
            </DialogHeader>

            {deletingUser && (
              <div className="px-5 py-4 space-y-4 mt-4">
                <div className="bg-destructive/10 p-4 rounded-md border border-destructive/20">
                  <p className="text-sm font-medium text-destructive mb-2">
                    Warning: This action cannot be undone!
                  </p>
                  <p className="text-sm text-muted-foreground">
                    You are about to permanently delete the user account for:
                  </p>
                  <div className="mt-3 p-3 bg-muted rounded-md">
                    <p className="font-medium">{deletingUser.displayName}</p>
                    <p className="text-sm text-muted-foreground">{deletingUser.email}</p>
                    <p className="text-sm text-muted-foreground capitalize">
                      {getRoleLabel(deletingUser.role)}
                      {deletingUser.branchName ? ` • ${deletingUser.branchName}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setShowDeleteDialog(false); setDeletingUser(null); }}
                    className="flex-1"
                    disabled={saving}
                  >
                    <X className="w-4 h-4 mr-2" /> Cancel
                  </Button>
                  <Button type="button" variant="destructive" onClick={handleDeleteUser} className="flex-1" disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                    Delete User
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
      </div>
      {/* ── NEW USER CREDENTIALS — shown once ── */}
      <Dialog open={!!newCredentials} onOpenChange={(o) => { if (!o) setNewCredentials(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{newCredentials?.mode === 'reset' ? 'Password reset' : 'Account created'}</DialogTitle>
            <DialogDescription>
              Give these details to {newCredentials?.name}. The password is shown only now.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-6 pt-2">
            <div className="rounded-md border bg-muted/40 p-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium break-all">{newCredentials?.email}</span>
              </div>
              <div className="flex justify-between gap-3 items-center">
                <span className="text-muted-foreground">Temporary password</span>
                <span className="font-mono font-semibold tracking-wide">{newCredentials?.password || '—'}</span>
              </div>
            </div>
            {newCredentials?.emailDelivered === true && (
              <p className="text-xs text-emerald-600">It was also emailed to {newCredentials?.email}.</p>
            )}
            {newCredentials?.emailDelivered === false && (
              <p className="text-xs text-amber-600">The email could not be sent — please share this password with them directly.</p>
            )}
            <p className="text-xs text-muted-foreground">
              It cannot be shown again. If it is lost, reset the account instead.
              Ask them to change it after signing in.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-4 text-xs"
                onClick={() => {
                  const text = `Email: ${newCredentials?.email}\nTemporary password: ${newCredentials?.password}`;
                  navigator.clipboard?.writeText(text).then(
                    () => toast.success('Copied'),
                    () => toast.error('Could not copy — write it down instead'),
                  );
                }}
              >
                Copy
              </Button>
              <Button size="sm" className="h-8 px-4 text-xs" onClick={() => setNewCredentials(null)}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </AppLayout>
  );
};

export default Security;
