import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingState } from '@/components/common';
import { PageHeader } from '@/components/common';
import { StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { Plus, Trash2, Edit, Briefcase, Search, Settings, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface Department {
  id: string;
  department_name: string;
  department_code: string;
  description?: string;
  is_active: boolean;
  clinic_id: number;
  created_at?: string;
  updated_at?: string;
}

const Departments: React.FC = () => {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Form state
  const [departmentName, setDepartmentName] = useState('');
  const [departmentCode, setDepartmentCode] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (user?.clinic) {
      fetchDepartments();
    }
  }, [user]);

  const fetchDepartments = async () => {
    try {
      setLoading(true);
      const clinicId = user?.clinic || '1';
      
      const response = await authFetch(`/api/departments?clinic=${encodeURIComponent(clinicId)}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch departments');
      }
      
      const data = await response.json();
      setDepartments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching departments:', error);
      toast.error('Failed to load departments');
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setDepartmentName('');
    setDepartmentCode('');
    setDescription('');
    setEditingDepartment(null);
  };

  const openEditDialog = (department: Department) => {
    setEditingDepartment(department);
    setDepartmentName(department.department_name);
    setDepartmentCode(department.department_code);
    setDescription(department.description || '');
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (saving) return;

    if (!departmentName || !departmentCode) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      const departmentData = {
        department_name: departmentName,
        department_code: departmentCode.toUpperCase(),
        description,
        clinic_id: user?.clinic || 1,
        is_active: true
      };

      const url = editingDepartment 
        ? `/api/departments/${editingDepartment.id}` 
        : '/api/departments';
      const method = editingDepartment ? 'PUT' : 'POST';

      const response = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(departmentData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save department');
      }

      toast.success(editingDepartment ? 'Department updated successfully' : 'Department created successfully');
      setDialogOpen(false);
      resetForm();
      fetchDepartments();
    } catch (error: any) {
      console.error('Error saving department:', error);
      toast.error(error.message || 'Failed to save department');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    if (!(await confirm({ description: 'Are you sure you want to delete this department?', destructive: true }))) {
      return;
    }

    setDeletingId(id);
    try {
      const response = await authFetch(`/api/departments/${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete department');
      }

      toast.success('Department deleted successfully');
      fetchDepartments();
    } catch (error) {
      console.error('Error deleting department:', error);
      toast.error('Failed to delete department');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredDepartments = departments.filter(dept => {
    const matchesSearch = searchQuery === '' || 
      dept.department_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dept.department_code.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<Settings />}
          title="Departments Management"
        />

        {/* Search Bar and Actions */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search departments by name or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button className="h-9">
                <Plus className="w-4 h-4 mr-2" />
                Add Department
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingDepartment ? 'Edit Department' : 'Add New Department'}</DialogTitle>
                <DialogDescription>
                  {editingDepartment ? 'Update the department details below.' : 'Create a new department by filling in the details.'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="departmentName">Department Name *</Label>
                    <Input
                      id="departmentName"
                      value={departmentName}
                      onChange={(e) => setDepartmentName(e.target.value)}
                      placeholder="e.g., Emergency Department"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="departmentCode">Department Code *</Label>
                    <Input
                      id="departmentCode"
                      value={departmentCode}
                      onChange={(e) => setDepartmentCode(e.target.value.toUpperCase())}
                      placeholder="e.g., ER"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of the department"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      resetForm();
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {saving
                      ? (editingDepartment ? 'Updating...' : 'Creating...')
                      : (editingDepartment ? 'Update Department' : 'Create Department')}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Departments Table */}
        <AdvancedDataTable<Department>
          data={filteredDepartments}
          keyExtractor={(department) => department.id}
          loading={loading}
          emptyMessage={searchQuery ? 'Try adjusting your search criteria' : 'Get started by creating your first department'}
          pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
          columns={[
            { key: 'department_code', header: 'Code', sortable: true, render: (v) => <span className="font-mono font-medium">{v}</span> },
            { key: 'department_name', header: 'Department Name', sortable: true, render: (v) => <span className="font-medium">{v}</span> },
            { key: 'description', header: 'Description', render: (v) => <span className="text-muted-foreground">{v || '-'}</span> },
            {
              key: 'is_active', header: 'Status', sortable: true,
              render: (v) => <StatusBadge status={v ? 'active' : 'inactive'} map={{ active: 'success', inactive: 'neutral' }} label={v ? 'Active' : 'Inactive'} />,
            },
            {
              key: '__actions', header: 'Actions', align: 'right',
              render: (_v, department) => (
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEditDialog(department)} disabled={deletingId === department.id} className="h-7 w-7">
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(department.id)}
                    disabled={deletingId === department.id}
                    className="h-7 w-7 text-destructive hover:text-destructive"
                  >
                    {deletingId === department.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>
      </div>
    </AppLayout>
  );
};

export default Departments;
