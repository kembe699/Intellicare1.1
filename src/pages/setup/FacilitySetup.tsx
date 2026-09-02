import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge } from '@/components/common';
import { toast } from 'sonner';
import {
  Building2, Plus, Search, Edit2, Trash2, Save, X, Loader2,
  Phone, Mail, MapPin, Clock, Globe, Shield, Users, CheckCircle,
  XCircle, ChevronDown, ChevronUp, Hospital, FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

// ─── Interfaces ─────────────────────────────────────────────
interface FacilityData {
  id?: number;
  name: string;
  type: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  website: string;
  license_number: string;
  established_date: string;
  bed_capacity: number | '';
  is_active: boolean;
  fax: string;
  updated_at?: string;
}

interface BranchData {
  id?: number;
  facility_id?: number;
  name: string;
  description: string;
  is_main_branch: boolean;
  phone: string;
  email: string;
  address: string;
  city: string;
  region: string;
  country: string;
  manager_name: string;
  manager_phone: string;
  opening_time: string;
  closing_time: string;
  bed_capacity: number | '';
  staff_count: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

const emptyFacility: FacilityData = {
  name: '', type: 'Hospital', description: '', phone: '', email: '',
  address: '', city: '', state: '', postal_code: '', country: 'South Sudan',
  website: '', license_number: '', established_date: '', bed_capacity: '',
  is_active: true, fax: ''
};

const emptyBranch: BranchData = {
  name: '', description: '', is_main_branch: false, phone: '', email: '',
  address: '', city: '', region: '', country: 'South Sudan',
  manager_name: '', manager_phone: '',
  opening_time: '08:00', closing_time: '17:00',
  bed_capacity: '', staff_count: 0, is_active: true
};

// ─── Main Component ─────────────────────────────────────────
const FacilitySetup: React.FC = () => {
  const { user } = useAuth();

  // Tab state
  const [activeTab, setActiveTab] = useState<'details' | 'branches' | 'create'>('details');

  // Facility state
  const [facility, setFacility] = useState<FacilityData | null>(null);
  const [facilityForm, setFacilityForm] = useState<FacilityData>(emptyFacility);
  const [isEditingFacility, setIsEditingFacility] = useState(false);
  const [facilityLoading, setFacilityLoading] = useState(true);
  const [savingFacility, setSavingFacility] = useState(false);

  // Branches state
  const [branches, setBranches] = useState<BranchData[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchStatusFilter, setBranchStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Create branch state
  const [newBranch, setNewBranch] = useState<BranchData>({ ...emptyBranch });
  const [creatingBranch, setCreatingBranch] = useState(false);

  // Edit branch modal state
  const [editingBranch, setEditingBranch] = useState<BranchData | null>(null);
  const [showEditBranchModal, setShowEditBranchModal] = useState(false);
  const [savingBranch, setSavingBranch] = useState(false);

  // Delete confirmation
  const [deletingBranchId, setDeletingBranchId] = useState<number | null>(null);

  // ─── API Methods ──────────────────────────────────────────
  const fetchFacility = async () => {
    setFacilityLoading(true);
    try {
      const res = await authFetch('/api/facilities');
      if (!res.ok) throw new Error('Failed to load facility');
      const data = await res.json();
      if (data.data) {
        setFacility(data.data);
        setFacilityForm(data.data);
      } else {
        setFacility(null);
      }
    } catch (err) {
      console.error('Error fetching facility:', err);
    } finally {
      setFacilityLoading(false);
    }
  };

  const fetchBranches = async () => {
    setBranchesLoading(true);
    try {
      const res = await authFetch('/api/facilities/branches/all');
      if (!res.ok) throw new Error('Failed to load branches');
      const data = await res.json();
      setBranches(data.data || []);
    } catch (err) {
      console.error('Error fetching branches:', err);
    } finally {
      setBranchesLoading(false);
    }
  };

  useEffect(() => {
    fetchFacility();
    fetchBranches();
  }, []);

  // ─── Facility Handlers ────────────────────────────────────
  const handleSaveFacility = async () => {
    if (!facilityForm.name?.trim()) {
      toast.error('Facility name is required');
      return;
    }
    if (!facilityForm.phone?.trim()) {
      toast.error('Phone number is required');
      return;
    }
    if (!facilityForm.email?.trim()) {
      toast.error('Email is required');
      return;
    }
    if (!facilityForm.address?.trim()) {
      toast.error('Address is required');
      return;
    }

    setSavingFacility(true);
    try {
      let res;
      if (facility?.id) {
        res = await authFetch(`/api/facilities/${facility.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(facilityForm)
        });
      } else {
        res = await authFetch('/api/facilities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(facilityForm)
        });
      }
      if (!res.ok) throw new Error('Failed to save facility');
      toast.success(facility?.id ? 'Facility updated successfully' : 'Facility created successfully');
      setIsEditingFacility(false);
      fetchFacility();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save facility');
    } finally {
      setSavingFacility(false);
    }
  };

  // ─── Branch Handlers ──────────────────────────────────────
  const handleCreateBranch = async () => {
    if (!newBranch.name?.trim()) {
      toast.error('Branch name is required');
      return;
    }
    if (!newBranch.phone?.trim()) {
      toast.error('Phone number is required');
      return;
    }
    if (!newBranch.address?.trim()) {
      toast.error('Address is required');
      return;
    }

    setCreatingBranch(true);
    try {
      const res = await authFetch('/api/facilities/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newBranch, facility_id: facility?.id || null })
      });
      if (!res.ok) throw new Error('Failed to create branch');
      toast.success('Branch created successfully');
      setNewBranch({ ...emptyBranch });
      fetchBranches();
      setActiveTab('branches');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create branch');
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleEditBranch = (branch: BranchData) => {
    setEditingBranch({ ...branch });
    setShowEditBranchModal(true);
  };

  const handleSaveBranch = async () => {
    if (!editingBranch || !editingBranch.id) return;
    if (!editingBranch.name?.trim()) {
      toast.error('Branch name is required');
      return;
    }

    setSavingBranch(true);
    try {
      const res = await authFetch(`/api/facilities/branches/${editingBranch.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingBranch)
      });
      if (!res.ok) throw new Error('Failed to update branch');
      toast.success('Branch updated successfully');
      setShowEditBranchModal(false);
      setEditingBranch(null);
      fetchBranches();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update branch');
    } finally {
      setSavingBranch(false);
    }
  };

  const handleDeleteBranch = async (branchId: number) => {
    setDeletingBranchId(branchId);
    try {
      const res = await authFetch(`/api/facilities/branches/${branchId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete branch');
      toast.success('Branch deleted successfully');
      fetchBranches();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete branch');
    } finally {
      setDeletingBranchId(null);
    }
  };

  const handleToggleBranch = async (branchId: number) => {
    try {
      const res = await authFetch(`/api/facilities/branches/${branchId}/toggle`, {
        method: 'PATCH'
      });
      if (!res.ok) throw new Error('Failed to toggle branch');
      toast.success('Branch status updated');
      fetchBranches();
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle branch status');
    }
  };

  // ─── Filter Branches ─────────────────────────────────────
  const filteredBranches = branches.filter(b => {
    const matchesSearch =
      b.name?.toLowerCase().includes(branchSearch.toLowerCase()) ||
      b.address?.toLowerCase().includes(branchSearch.toLowerCase()) ||
      b.city?.toLowerCase().includes(branchSearch.toLowerCase());
    const matchesStatus =
      branchStatusFilter === 'all' ||
      (branchStatusFilter === 'active' ? b.is_active : !b.is_active);
    return matchesSearch && matchesStatus;
  });

  // ─── Render ───────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="animate-fade-in w-full flex flex-col">
        <PageHeader
          title="Facility Setup"
          icon={<Building2 />}
          actions={
            <Badge variant="outline">
              <Building2 className="w-3.5 h-3.5 mr-1" />
              {branches.length} Branch{branches.length !== 1 ? 'es' : ''}
            </Badge>
          }
        />

        {/* Tabs */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg mb-6">
          <button
            onClick={() => setActiveTab('details')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-md transition-all ${
              activeTab === 'details'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Hospital className="w-4 h-4 inline mr-2" />
            Hospital Details
          </button>
          <button
            onClick={() => setActiveTab('branches')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-md transition-all ${
              activeTab === 'branches'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Building2 className="w-4 h-4 inline mr-2" />
            Branches ({branches.length})
          </button>
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-md transition-all ${
              activeTab === 'create'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Plus className="w-4 h-4 inline mr-2" />
            Create Branch
          </button>
        </div>

        {/* ═══ TAB: Hospital Details ═══ */}
        {activeTab === 'details' && (
          <div className="bg-card rounded-lg border shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Hospital / Clinic Details</h2>
                <p className="text-sm text-muted-foreground">Manage your primary facility information</p>
              </div>
              {!isEditingFacility && !facilityLoading && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (facility) setFacilityForm(facility);
                    else setFacilityForm({ ...emptyFacility });
                    setIsEditingFacility(true);
                  }}
                >
                  <Edit2 className="w-4 h-4 mr-2" />
                  {facility ? 'Edit' : 'Setup Facility'}
                </Button>
              )}
            </div>

            <div className="p-6">
              {facilityLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : isEditingFacility ? (
                /* ─── Edit Mode ─── */
                <div className="space-y-5 max-w-3xl">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Facility Name *</label>
                      <Input
                        value={facilityForm.name}
                        onChange={(e) => setFacilityForm({ ...facilityForm, name: e.target.value })}
                        placeholder="Enter facility name"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Facility Type *</label>
                      <Combobox
                        options={[
                          { value: 'Hospital', label: 'Hospital' },
                          { value: 'Clinic', label: 'Clinic' },
                          { value: 'Diagnostic Center', label: 'Diagnostic Center' },
                          { value: 'Pharmacy', label: 'Pharmacy' },
                          { value: 'Laboratory', label: 'Laboratory' },
                        ]}
                        value={facilityForm.type}
                        onChange={(val) => setFacilityForm({ ...facilityForm, type: val })}
                        searchPlaceholder="Search types..."
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Description</label>
                    <textarea
                      value={facilityForm.description}
                      onChange={(e) => setFacilityForm({ ...facilityForm, description: e.target.value })}
                      placeholder="Brief description of the facility"
                      rows={3}
                      className="mt-1 w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Phone *</label>
                      <Input
                        value={facilityForm.phone}
                        onChange={(e) => setFacilityForm({ ...facilityForm, phone: e.target.value })}
                        placeholder="Phone number"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Email *</label>
                      <Input
                        type="email"
                        value={facilityForm.email}
                        onChange={(e) => setFacilityForm({ ...facilityForm, email: e.target.value })}
                        placeholder="Email address"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Street Address *</label>
                    <Input
                      value={facilityForm.address}
                      onChange={(e) => setFacilityForm({ ...facilityForm, address: e.target.value })}
                      placeholder="Street address"
                      className="mt-1"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">City</label>
                      <Input
                        value={facilityForm.city}
                        onChange={(e) => setFacilityForm({ ...facilityForm, city: e.target.value })}
                        placeholder="City"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">State / Region</label>
                      <Input
                        value={facilityForm.state}
                        onChange={(e) => setFacilityForm({ ...facilityForm, state: e.target.value })}
                        placeholder="State / Region"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Country</label>
                      <Input
                        value={facilityForm.country}
                        onChange={(e) => setFacilityForm({ ...facilityForm, country: e.target.value })}
                        placeholder="Country"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">License Number</label>
                      <Input
                        value={facilityForm.license_number}
                        onChange={(e) => setFacilityForm({ ...facilityForm, license_number: e.target.value })}
                        placeholder="License number"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Website</label>
                      <Input
                        value={facilityForm.website}
                        onChange={(e) => setFacilityForm({ ...facilityForm, website: e.target.value })}
                        placeholder="https://example.com"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Bed Capacity</label>
                      <Input
                        type="number"
                        value={facilityForm.bed_capacity}
                        onChange={(e) => setFacilityForm({ ...facilityForm, bed_capacity: e.target.value ? parseInt(e.target.value) : '' })}
                        placeholder="Bed capacity"
                        className="mt-1"
                        min={0}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <Button onClick={handleSaveFacility} disabled={savingFacility}>
                      {savingFacility ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                      ) : (
                        <><Save className="w-4 h-4 mr-2" /> Save Details</>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsEditingFacility(false);
                        if (facility) setFacilityForm(facility);
                      }}
                      disabled={savingFacility}
                    >
                      <X className="w-4 h-4 mr-2" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : facility ? (
                /* ─── View Mode ─── */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <InfoField icon={<Hospital className="w-4 h-4" />} label="Facility Name" value={facility.name} />
                  <InfoField icon={<FileText className="w-4 h-4" />} label="Facility Type" value={facility.type} />
                  <InfoField icon={<Phone className="w-4 h-4" />} label="Phone" value={facility.phone} />
                  <InfoField icon={<Mail className="w-4 h-4" />} label="Email" value={facility.email} />
                  <div className="md:col-span-2">
                    <InfoField
                      icon={<MapPin className="w-4 h-4" />}
                      label="Address"
                      value={[facility.address, facility.city, facility.state, facility.country].filter(Boolean).join(', ')}
                    />
                  </div>
                  <InfoField icon={<Shield className="w-4 h-4" />} label="License Number" value={facility.license_number} />
                  <InfoField icon={<Globe className="w-4 h-4" />} label="Website" value={facility.website} />
                  {facility.bed_capacity != null ? (
                    <InfoField icon={<Building2 className="w-4 h-4" />} label="Bed Capacity" value={String(facility.bed_capacity)} />
                  ) : null}
                  {facility.description && (
                    <div className="md:col-span-2">
                      <InfoField icon={<FileText className="w-4 h-4" />} label="Description" value={facility.description} />
                    </div>
                  )}
                  {facility.updated_at && (
                    <div className="md:col-span-2 pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground">
                        Last updated: {new Date(facility.updated_at).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* ─── No facility yet ─── */
                <div className="text-center py-16">
                  <Hospital className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-medium text-foreground">No Facility Configured</h3>
                  <p className="text-sm text-muted-foreground mt-1">Click "Setup Facility" to add your hospital details</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ TAB: Branches ═══ */}
        {activeTab === 'branches' && (
          <div className="bg-card rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Branches / Locations</h2>
              <p className="text-sm text-muted-foreground">Manage all branch locations of your facility</p>
            </div>

            <div className="p-6 space-y-4">
              {/* Search & Filter */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search branches by name, address, city..."
                    value={branchSearch}
                    onChange={(e) => setBranchSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Combobox
                  options={[
                    { value: 'all', label: 'All Status' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                  ]}
                  value={branchStatusFilter}
                  onChange={(val) => setBranchStatusFilter(val as any)}
                  searchPlaceholder="Search..."
                  className="w-[160px]"
                />
              </div>

              {/* Branches Table */}
              <AdvancedDataTable<BranchData>
                data={filteredBranches}
                keyExtractor={(branch) => branch.id!}
                loading={branchesLoading}
                emptyMessage={
                  branches.length === 0
                    ? 'Go to the "Create Branch" tab to add your first branch'
                    : 'Try adjusting your search or filter'
                }
                pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
                columns={[
                  {
                    key: 'name', header: 'Branch Name', sortable: true,
                    render: (v, branch) => (
                      <>
                        <div className="font-medium text-foreground">{v}</div>
                        {branch.email && <div className="text-xs text-muted-foreground">{branch.email}</div>}
                      </>
                    ),
                  },
                  {
                    key: 'is_main_branch', header: 'Type', sortable: true,
                    render: (v) => <Badge variant={v ? 'default' : 'secondary'} className="text-xs">{v ? 'Main Branch' : 'Branch'}</Badge>,
                  },
                  {
                    key: 'address', header: 'Location',
                    render: (_v, branch) => <span className="text-muted-foreground">{[branch.address, branch.city, branch.country].filter(Boolean).join(', ') || '—'}</span>,
                  },
                  { key: 'phone', header: 'Phone', sortable: true, render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                  { key: 'manager_name', header: 'Manager', sortable: true, render: (v) => <span className="text-muted-foreground">{v || '—'}</span> },
                  {
                    key: 'opening_time', header: 'Hours',
                    render: (_v, branch) => <span className="text-muted-foreground text-xs">{branch.opening_time && branch.closing_time ? `${branch.opening_time} - ${branch.closing_time}` : '—'}</span>,
                  },
                  {
                    key: 'is_active', header: 'Status', align: 'center', sortable: true,
                    render: (v, branch) => (
                      <button onClick={() => branch.id && handleToggleBranch(branch.id)} title="Toggle status">
                        <StatusBadge
                          status={v ? 'active' : 'inactive'}
                          map={{ active: 'success', inactive: 'neutral' }}
                          label={
                            <>
                              {v ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {v ? 'Active' : 'Inactive'}
                            </>
                          }
                          className="cursor-pointer hover:opacity-80"
                        />
                      </button>
                    ),
                  },
                  {
                    key: '__actions', header: 'Actions', align: 'right',
                    render: (_v, branch) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditBranch(branch)} title="Edit branch">
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (branch.id && confirm(`Delete branch "${branch.name}"? This cannot be undone.`)) {
                              handleDeleteBranch(branch.id);
                            }
                          }}
                          disabled={deletingBranchId === branch.id}
                          title="Delete branch"
                        >
                          {deletingBranchId === branch.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />

              {/* Statistics */}
              {branches.length > 0 && (
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{branches.length}</p>
                    <p className="text-xs text-muted-foreground">Total Branches</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{branches.filter(b => b.is_active).length}</p>
                    <p className="text-xs text-muted-foreground">Active</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-muted-foreground">{branches.filter(b => !b.is_active).length}</p>
                    <p className="text-xs text-muted-foreground">Inactive</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ TAB: Create Branch ═══ */}
        {activeTab === 'create' && (
          <div className="bg-card rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Create New Branch</h2>
              <p className="text-sm text-muted-foreground">Add a new branch location to your facility</p>
            </div>

            <div className="p-6">
              <BranchFormFields
                data={newBranch}
                onChange={setNewBranch}
              />
              <div className="flex items-center gap-3 mt-6">
                <Button onClick={handleCreateBranch} disabled={creatingBranch}>
                  {creatingBranch ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
                  ) : (
                    <><Plus className="w-4 h-4 mr-2" /> Create Branch</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setNewBranch({ ...emptyBranch })}
                  disabled={creatingBranch}
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Edit Branch Modal ═══ */}
        <Dialog open={showEditBranchModal} onOpenChange={setShowEditBranchModal}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Branch</DialogTitle>
              <DialogDescription>Update branch information</DialogDescription>
            </DialogHeader>
            {editingBranch && (
              <div className="px-5 py-4">
                <BranchFormFields
                  data={editingBranch}
                  onChange={setEditingBranch}
                />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditBranchModal(false)} disabled={savingBranch}>
                Cancel
              </Button>
              <Button onClick={handleSaveBranch} disabled={savingBranch}>
                {savingBranch ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" /> Save Changes</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

// ─── Reusable: Info Field (View Mode) ───────────────────────
const InfoField: React.FC<{ icon: React.ReactNode; label: string; value?: string | null }> = ({ icon, label, value }) => (
  <div>
    <div className="flex items-center gap-2 mb-1">
      <span className="text-muted-foreground">{icon}</span>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
    </div>
    <p className="text-sm text-foreground pl-6">{value || '—'}</p>
  </div>
);

// ─── Reusable: Branch Form Fields ───────────────────────────
const BranchFormFields: React.FC<{
  data: BranchData;
  onChange: (data: BranchData) => void;
}> = ({ data, onChange }) => {
  const update = (field: keyof BranchData, value: any) => {
    onChange({ ...data, [field]: value });
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Branch Name *</label>
          <Input
            value={data.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Enter branch name"
            className="mt-1"
          />
        </div>
        <div className="flex items-end gap-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="main-branch-check"
              checked={data.is_main_branch}
              onChange={(e) => update('is_main_branch', e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="main-branch-check" className="text-xs font-medium text-muted-foreground cursor-pointer">
              Set as Main Branch
            </label>
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Description</label>
        <textarea
          value={data.description}
          onChange={(e) => update('description', e.target.value)}
          placeholder="Branch description"
          rows={2}
          className="mt-1 w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Phone *</label>
          <Input
            value={data.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="Phone number"
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Email</label>
          <Input
            type="email"
            value={data.email}
            onChange={(e) => update('email', e.target.value)}
            placeholder="Email address"
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Street Address *</label>
        <Input
          value={data.address}
          onChange={(e) => update('address', e.target.value)}
          placeholder="Street address"
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">City</label>
          <Input
            value={data.city}
            onChange={(e) => update('city', e.target.value)}
            placeholder="City"
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Region</label>
          <Input
            value={data.region}
            onChange={(e) => update('region', e.target.value)}
            placeholder="Region / State"
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Country</label>
          <Input
            value={data.country}
            onChange={(e) => update('country', e.target.value)}
            placeholder="Country"
            className="mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Manager Name</label>
          <Input
            value={data.manager_name}
            onChange={(e) => update('manager_name', e.target.value)}
            placeholder="Branch manager"
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Manager Phone</label>
          <Input
            value={data.manager_phone}
            onChange={(e) => update('manager_phone', e.target.value)}
            placeholder="Manager phone"
            className="mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Opening Time</label>
          <Input
            type="time"
            value={data.opening_time}
            onChange={(e) => update('opening_time', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Closing Time</label>
          <Input
            type="time"
            value={data.closing_time}
            onChange={(e) => update('closing_time', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Bed Capacity</label>
          <Input
            type="number"
            value={data.bed_capacity}
            onChange={(e) => update('bed_capacity', e.target.value ? parseInt(e.target.value) : '')}
            placeholder="0"
            className="mt-1"
            min={0}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="branch-active-check"
          checked={data.is_active}
          onChange={(e) => update('is_active', e.target.checked)}
          className="rounded border-border"
        />
        <label htmlFor="branch-active-check" className="text-xs font-medium text-muted-foreground cursor-pointer">
          Active
        </label>
      </div>
    </div>
  );
};

export default FacilitySetup;
