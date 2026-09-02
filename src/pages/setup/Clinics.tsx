import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingState } from '@/components/common';
import { PageHeader } from '@/components/common';
import { toast } from 'sonner';
import { Plus, Edit, Trash2, Stethoscope, Save, X, Loader2, Search, Building2, Grid3X3, List, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { Combobox } from '@/components/ui/combobox';

interface Clinic {
  id: string;
  name: string;
  description: string;
  department: string;
  service: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Service {
  id: string;
  name: string;
  category: string;
}

// API client for clinics
class ClinicsApiClient {
  private baseUrl = '/api/clinics';

  async getAll(): Promise<Clinic[]> {
    try {
      const response = await authFetch(`${this.baseUrl}?noFallback=true`);
      if (!response.ok) throw new Error('Failed to fetch clinics');
      return await response.json();
    } catch (error) {
      console.error('Error fetching clinics:', error);
      throw error;
    }
  }

  async create(clinicData: any): Promise<Clinic> {
    try {
      const response = await authFetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clinicData),
      });
      if (!response.ok) throw new Error('Failed to create clinic');
      return await response.json();
    } catch (error) {
      console.error('Error creating clinic:', error);
      throw error;
    }
  }

  async update(clinicId: string, clinicData: any): Promise<Clinic> {
    try {
      const response = await authFetch(`${this.baseUrl}/${clinicId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clinicData),
      });
      if (!response.ok) throw new Error('Failed to update clinic');
      return await response.json();
    } catch (error) {
      console.error('Error updating clinic:', error);
      throw error;
    }
  }

  async delete(clinicId: string): Promise<void> {
    try {
      const response = await authFetch(`${this.baseUrl}/${clinicId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete clinic');
    } catch (error) {
      console.error('Error deleting clinic:', error);
      throw error;
    }
  }
}

// API client for services
class ServicesApiClient {
  private baseUrl = '/api/services';

  async getAll(): Promise<Service[]> {
    try {
      const response = await authFetch(this.baseUrl);
      if (!response.ok) throw new Error('Failed to fetch services');
      const data = await response.json();
      
      // Transform the data to match our Service interface
      return data.map((service: any) => ({
        id: service.id,
        name: service.name || service.service_name,
        category: service.category
      }));
    } catch (error) {
      console.error('Error fetching services:', error);
      throw error;
    }
  }
}

const Clinics: React.FC = () => {
  const { user } = useAuth();
  const clinicsApi = new ClinicsApiClient();
  const servicesApi = new ServicesApiClient();
  
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingClinic, setEditingClinic] = useState<Clinic | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    department: '',
    service: '',
    isActive: true
  });

  const departments = [
    'General Medicine',
    'Gynecology',
    'Pediatric',
    'Cardiology',
    'Orthopedic',
    'Dermatology',
    'Ophthalmology',
    'ENT (Ear, Nose, Throat)',
    'Psychiatry',
    'Neurology',
    'Emergency',
    'Dental',
    'Laboratory',
    'Pharmacy',
    'Radiology'
  ];

  useEffect(() => {
    fetchClinics();
    fetchServices();
  }, []);

  const fetchClinics = async () => {
    console.log('fetchClinics called');
    
    try {
      setLoading(true);
      console.log('Fetching clinics...');
      
      const clinicsData = await clinicsApi.getAll();
      console.log('Clinics data received:', clinicsData);
      
      setClinics(clinicsData || []);
      console.log('Successfully loaded', (clinicsData || []).length, 'clinics');
    } catch (error) {
      console.error('Error fetching clinics:', error);
      setClinics([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const fetchServices = async () => {
    try {
      const servicesData = await servicesApi.getAll();
      setServices(servicesData);
    } catch (error) {
      console.error('Error fetching services:', error);
      toast.error('Failed to fetch services');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!formData.name.trim() || !formData.department) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      const clinicData = {
        name: formData.name.trim(),
        description: formData.description?.trim() || '',
        department: formData.department,
        service: formData.service,
        is_active: formData.isActive
      };

      if (editingClinic) {
        await clinicsApi.update(editingClinic.id, clinicData);
        toast.success('Clinic updated successfully');
      } else {
        await clinicsApi.create(clinicData);
        toast.success('Clinic created successfully');
      }

      setShowForm(false);
      setEditingClinic(null);
      setFormData({
        name: '',
        description: '',
        department: '',
        service: '',
        isActive: true
      });
      fetchClinics();
    } catch (error) {
      console.error('Error saving clinic:', error);
      toast.error('Failed to save clinic');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (clinic: Clinic) => {
    setEditingClinic(clinic);
    setFormData({
      name: clinic.name,
      description: clinic.description,
      department: clinic.department,
      service: clinic.service || '',
      isActive: clinic.isActive
    });
    setShowForm(true);
  };

  const handleDelete = async (clinic: Clinic) => {
    if (deletingId) return;
    if (!confirm(`Are you sure you want to delete "${clinic.name}"?`)) {
      return;
    }

    setDeletingId(clinic.id);
    try {
      await clinicsApi.delete(clinic.id);
      toast.success('Clinic deleted successfully');
      fetchClinics();
    } catch (error) {
      console.error('Error deleting clinic:', error);
      toast.error('Failed to delete clinic');
    } finally {
      setDeletingId(null);
    }
  };


  const filteredClinics = clinics.filter(clinic =>
    clinic.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    clinic.department.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<Settings />}
          title="Clinics Management"
        />

        {/* Search Bar and Actions */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search clinics by name or department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex items-center border rounded-lg">
              <Button
                variant={viewMode === 'table' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('table')}
                className="rounded-r-none h-9"
              >
                <List className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'cards' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('cards')}
                className="rounded-l-none h-9"
              >
                <Grid3X3 className="w-4 h-4" />
              </Button>
            </div>
            <Button onClick={() => setShowForm(true)} className="h-9">
              <Plus className="w-4 h-4 mr-2" />
              Add Clinic
            </Button>
          </div>
        </div>

        {/* Clinics Table */}
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <LoadingState message="Loading clinics..." />
            </div>
          ) : filteredClinics.length === 0 ? (
            <div className="text-center py-16">
              <div className="mb-4">
                <Building2 className="w-8 h-8 text-muted-foreground mx-auto" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                {searchQuery ? 'No clinics found' : 'No clinics available'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery 
                  ? 'Try adjusting your search terms or clear the search to see all clinics.'
                  : 'Get started by adding your first clinic.'
                }
              </p>
              {!searchQuery && (
                <Button onClick={() => setShowForm(true)} className="mt-2">
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Clinic
                </Button>
              )}
            </div>
          ) : viewMode === 'table' ? (
            <AdvancedDataTable<Clinic>
              data={filteredClinics}
              keyExtractor={(clinic) => clinic.id}
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                {
                  key: 'name', header: 'Clinic Name', sortable: true,
                  render: (v) => <div className="font-semibold text-foreground flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />{v}</div>,
                },
                { key: 'department', header: 'Department', sortable: true, render: (v) => <span className="text-muted-foreground">{v}</span> },
                { key: 'description', header: 'Description', render: (v) => <span className="text-muted-foreground">{v || 'No description'}</span> },
                {
                  key: 'service', header: 'Services',
                  render: (v) => {
                    if (!v) return <span className="text-muted-foreground">None</span>;
                    const service = services.find(s => String(s.id) === String(v));
                    return service ? <Badge variant="outline" className="text-xs">{service.name}</Badge> : <span className="text-muted-foreground">Unknown</span>;
                  },
                },
                {
                  key: 'isActive', header: 'Status', sortable: true,
                  render: (v) => <Badge variant={v ? 'default' : 'secondary'}>{v ? 'Active' : 'Inactive'}</Badge>,
                },
                {
                  key: '__actions', header: '', align: 'right',
                  render: (_v, clinic) => (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(clinic)} disabled={deletingId === clinic.id} className="h-7 w-7">
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(clinic)} disabled={deletingId === clinic.id} className="h-7 w-7 text-destructive hover:text-destructive">
                        {deletingId === clinic.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
        ) : (
          /* Cards View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredClinics.map((clinic) => (
              <Card key={clinic.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-primary" />
                      <CardTitle className="text-lg">{clinic.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(clinic)}
                        disabled={deletingId === clinic.id}
                        className="h-8 w-8 p-0"
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(clinic)}
                        disabled={deletingId === clinic.id}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        {deletingId === clinic.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="text-sm">
                    {clinic.department}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {clinic.description && (
                    <p className="text-sm text-muted-foreground">
                      {clinic.description}
                    </p>
                  )}
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Status</span>
                      <Badge variant={clinic.isActive ? "default" : "secondary"}>
                        {clinic.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    
                    <div className="space-y-1">
                      <span className="text-sm font-medium">Service</span>
                      <div className="flex flex-wrap gap-1">
                        {clinic.service ? (() => {
                          const service = services.find(s => String(s.id) === String(clinic.service));
                          return service ? (
                            <Badge variant="outline" className="text-xs">
                              {service.name}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Unknown</span>
                          );
                        })() : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </div>
                    </div>
                  </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Form Dialog */}
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Stethoscope className="w-5 h-5" />
                {editingClinic ? 'Edit Clinic' : 'Add New Clinic'}
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Clinic Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Cardiology Clinic"
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="department">Department *</Label>
                  <Combobox
                    options={departments.map((dept) => ({ value: dept, label: dept }))}
                    value={formData.department}
                    onChange={(value) => setFormData({ ...formData, department: value })}
                    placeholder="Select department..."
                    searchPlaceholder="Search departments..."
                    className="w-full"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of the clinic..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="service">Associated Service</Label>
                <Combobox
                  options={[
                    { value: 'none', label: 'None (optional)' },
                    ...services.map((service) => ({ value: service.id, label: service.name })),
                  ]}
                  value={formData.service || 'none'}
                  onChange={(value) => setFormData({ ...formData, service: value === 'none' ? '' : value })}
                  placeholder="Select a service (optional)"
                  searchPlaceholder="Search services..."
                  className="w-full"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: !!checked })}
                />
                <Label htmlFor="isActive">Active</Label>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditingClinic(null);
                    setFormData({
                      name: '',
                      description: '',
                      department: '',
                      service: '',
                      isActive: true
                    });
                  }}
                  className="flex-1"
                  disabled={saving}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={saving || !formData.name.trim() || !formData.department}
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      {editingClinic ? 'Update Clinic' : 'Create Clinic'}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default Clinics;
