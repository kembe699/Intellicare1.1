import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { authFetch } from '@/api/apiClient';
import { Plus, Trash2, Edit, Wrench, X, Search, Download, Upload, FileText, Settings, Loader2, Percent, FlaskConical, Scan } from 'lucide-react';
import { toast } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
// Import the ClinicalApiClient from Clinical.tsx temporarily
// In production, this should be moved to a separate API module
class ClinicalApiClient {
  private baseUrl = '/api/clinical';

  async getServices(clinicId: string): Promise<any[]> {
    try {
      const response = await authFetch(`${this.baseUrl}/services/${clinicId}`);
      if (!response.ok) throw new Error('Failed to fetch services');
      return await response.json();
    } catch (error) {
      console.error('Error fetching services:', error);
      throw error;
    }
  }

  async createService(serviceData: any): Promise<any> {
    try {
      const response = await authFetch(`${this.baseUrl}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceData),
      });
      if (!response.ok) throw new Error('Failed to create service');
      return await response.json();
    } catch (error) {
      console.error('Error creating service:', error);
      throw error;
    }
  }

  async updateService(serviceId: string, serviceData: any): Promise<any> {
    try {
      const response = await authFetch(`${this.baseUrl}/services/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceData),
      });
      if (!response.ok) throw new Error('Failed to update service');
      return await response.json();
    } catch (error) {
      console.error('Error updating service:', error);
      throw error;
    }
  }

  async deleteService(serviceId: string): Promise<void> {
    try {
      const response = await authFetch(`${this.baseUrl}/services/${serviceId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete service');
    } catch (error) {
      console.error('Error deleting service:', error);
      throw error;
    }
  }

  async bulkPriceAdjustment(payload: { mode: 'percentage' | 'rate'; percentage?: number; direction?: 'increase' | 'decrease'; new_rate?: number; category?: string }): Promise<any> {
    const response = await authFetch(`${this.baseUrl}/services/bulk-price-adjustment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to apply price adjustment');
    return data;
  }
}

const clinicalApi = new ClinicalApiClient();

interface Service {
  id: string;
  service_name: string;
  category: string;
  price: number;
  description?: string;
  department_id?: string;
  is_active: boolean;
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
}

interface Department {
  id: string;
  department_name: string;
  department_code: string;
  description?: string;
  is_active: boolean;
}

const serviceCategories = [
  'Consultation',
  'Procedure',
  'Nursing',
  'Surgery',
  'Diagnostic',
  'Therapy',
  'Emergency',
  'Other'
];

// Flexible category matching - maps variations to standard names
const normalizeCategory = (input: string): string | null => {
  const normalized = input.toLowerCase().trim();

  // Direct match (case-insensitive)
  const directMatch = serviceCategories.find(cat => cat.toLowerCase() === normalized);
  if (directMatch) return directMatch;

  // Fuzzy matching for common variations
  if (normalized.includes('consult')) {
    return 'Consultation';
  }
  if (normalized.includes('surgery') || normalized.includes('surgical') || normalized.includes('operation')) {
    return 'Surgery';
  }
  if (normalized.includes('nursing') || normalized.includes('injection') || normalized.includes('dressing') ||
      normalized.includes('dress') || normalized.includes('wound') || normalized.includes('im/iv')) {
    return 'Nursing';
  }
  if (normalized.includes('procedure') || normalized.includes('treatment') || normalized.includes('ward') ||
      normalized.includes('room') || normalized.includes('bed') || normalized.includes('admission') ||
      normalized.includes('stitch')) {
    return 'Procedure';
  }
  if (normalized.includes('diagnostic') || normalized.includes('test') || normalized.includes('scan') ||
      normalized.includes('imaging') || normalized.includes('x-ray') || normalized.includes('ultrasound') ||
      normalized.includes('lab') || normalized.includes('blood')) {
    return 'Diagnostic';
  }
  if (normalized.includes('therapy') || normalized.includes('rehab') || normalized.includes('physiotherapy') ||
      normalized.includes('counseling')) {
    return 'Therapy';
  }
  if (normalized.includes('emergency') || normalized.includes('urgent') || normalized.includes('er') ||
      normalized.includes('trauma')) {
    return 'Emergency';
  }

  // Default fallback to Other
  return 'Other';
};

const departments = [
  'General Medicine',
  'Pediatrics',
  'Surgery',
  'Obstetrics & Gynecology',
  'Orthopedics',
  'Cardiology',
  'Dermatology',
  'Psychiatry',
  'Radiology',
  'Laboratory',
  'Emergency',
  'Other'
];

// Flexible department matching - maps variations to standard names
const normalizeDepartment = (input: string): string | null => {
  const normalized = input.toLowerCase().trim();

  // Direct match (case-insensitive)
  const directMatch = departments.find(dept => dept.toLowerCase() === normalized);
  if (directMatch) return directMatch;

  // Fuzzy matching for common variations
  if (normalized.includes('general') || normalized.includes('gp') || normalized.includes('doctor')) {
    return 'General Medicine';
  }
  if (normalized.includes('pediatric') || normalized.includes('paediatric') || normalized.includes('child')) {
    return 'Pediatrics';
  }
  if (normalized.includes('surgery') || normalized.includes('surgical') || normalized.includes('trauma')) {
    return 'Surgery';
  }
  if (normalized.includes('obstetric') || normalized.includes('gynecolog') || normalized.includes('gynaecolog') ||
      normalized.includes('maternity') || normalized.includes('ob') || normalized.includes('gyn')) {
    return 'Obstetrics & Gynecology';
  }
  if (normalized.includes('orthopedic') || normalized.includes('orthopaedic') || normalized.includes('bone')) {
    return 'Orthopedics';
  }
  if (normalized.includes('cardio') || normalized.includes('heart')) {
    return 'Cardiology';
  }
  if (normalized.includes('derma') || normalized.includes('skin')) {
    return 'Dermatology';
  }
  if (normalized.includes('psychiat') || normalized.includes('mental')) {
    return 'Psychiatry';
  }
  if (normalized.includes('radio') || normalized.includes('imaging') || normalized.includes('x-ray') || normalized.includes('xray')) {
    return 'Radiology';
  }
  if (normalized.includes('lab') || normalized.includes('patholog') || normalized.includes('test')) {
    return 'Laboratory';
  }
  if (normalized.includes('emergency') || normalized.includes('urgent') || normalized.includes('er')) {
    return 'Emergency';
  }
  if (normalized.includes('vaccination') || normalized.includes('vaccine') || normalized.includes('immunization')) {
    return 'Pediatrics'; // Vaccinations typically fall under Pediatrics
  }
  if (normalized.includes('specialized') || normalized.includes('specialist') || normalized.includes('clinic')) {
    return 'Other'; // Specialized clinics go to Other
  }

  // If no match found, return Other as fallback
  return 'Other';
};

const Services: React.FC = () => {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { user } = useAuth();
  const { currency: baseCurrency } = useCurrency();
  const [services, setServices] = useState<Service[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [seedingLab, setSeedingLab] = useState(false);
  const [seedingRadiology, setSeedingRadiology] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bulk price adjustment
  const [showPriceAdjustment, setShowPriceAdjustment] = useState(false);
  const [priceAdjForm, setPriceAdjForm] = useState({ mode: 'percentage' as 'percentage' | 'rate', percentage: '', direction: 'increase' as 'increase' | 'decrease', newRate: '', category: '' });
  const [applyingPriceAdj, setApplyingPriceAdj] = useState(false);
  const [currentExchangeRate, setCurrentExchangeRate] = useState<number | null>(null);

  // Form state
  const [serviceName, setServiceName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');

  useEffect(() => {
    fetchServices();
    fetchDepartments();
    fetchCurrentExchangeRate();
  }, [user?.clinic]);

  const fetchCurrentExchangeRate = async () => {
    try {
      const response = await authFetch('/api/exchange-rates/rates?from_currency=USD&to_currency=SSP', { credentials: 'include' });
      if (response.ok) {
        const { data } = await response.json();
        if (data?.[0]) setCurrentExchangeRate(parseFloat(data[0].effective_rate));
      }
    } catch (error) { /* rate display is best-effort */ }
  };

  const fetchDepartments = async () => {
    try {
      const clinicId = user?.clinic || '1';
      const response = await authFetch(`/api/departments?clinic=${encodeURIComponent(clinicId)}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Failed to fetch departments');
      }

      const data = await response.json();
      setDepartments(Array.isArray(data) ? data.filter((d: Department) => d.is_active) : []);
    } catch (error) {
      console.error('Error fetching departments:', error);
      setDepartments([]);
    }
  };

  const fetchServices = async () => {
    try {
      setLoading(true);

      // Use default clinic ID if user clinic is not available
      const clinicId = user?.clinic || '6'; // Default to General Medicine clinic
      const servicesData = await clinicalApi.getServices(clinicId);

      setServices(servicesData || []);
    } catch (error) {
      console.error('Error fetching services:', error);
      setServices([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleSeedLabServices = async () => {
    try {
      setSeedingLab(true);
      const clinicId = user?.clinic || '6';
      const response = await authFetch('/api/services/seed-lab-services', {
        method: 'POST',
        body: JSON.stringify({ clinic_id: clinicId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to seed lab services');
      if (result.success) {
        toast.success(result.message);
        await fetchServices();
      } else {
        toast.info(result.message);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to seed lab services');
    } finally {
      setSeedingLab(false);
    }
  };

  const handleSeedRadiologyServices = async () => {
    try {
      setSeedingRadiology(true);
      const clinicId = user?.clinic || '6';
      const response = await authFetch('/api/services/seed-radiology-services', {
        method: 'POST',
        body: JSON.stringify({ clinic_id: clinicId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to seed radiology services');
      if (result.success) {
        toast.success(result.message);
        await fetchServices();
      } else {
        toast.info(result.message);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to seed radiology services');
    } finally {
      setSeedingRadiology(false);
    }
  };

  const resetForm = () => {
    setServiceName('');
    setCategory('');
    setDescription('');
    setPrice('');
    setSelectedDepartment('');
    setEditingService(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (saving) return;

    if (!serviceName.trim() || !category || !price) {
      toast.error('Please fill in all required fields');
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      toast.error('Please enter a valid price');
      return;
    }

    setSaving(true);
    try {
      const serviceData = {
        service_name: serviceName.trim(),
        category,
        description,
        price: priceNum,
        department_id: selectedDepartment || null,
        created_by: user?.displayName || 'Unknown'
      };

      if (editingService) {
        await clinicalApi.updateService(editingService.id, { ...serviceData, updated_by: user?.displayName || 'Unknown' });
        toast.success('Service updated successfully');
      } else {
        await clinicalApi.createService(serviceData);
        toast.success('Service created successfully');
      }

      resetForm();
      fetchServices();
    } catch (error) {
      console.error('Error saving service:', error);
      toast.error('Failed to save service');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (service: Service) => {
    setEditingService(service);
    setServiceName(service.service_name);
    setCategory(service.category);
    setDescription(service.description || '');
    setPrice(service.price.toString());
    setSelectedDepartment(service.department_id || '');
  };

  const handleDelete = async (serviceId: string) => {
    if (deletingId) return;
    if (!(await confirm({ description: 'Are you sure you want to delete this service?' }))) return;

    setDeletingId(serviceId);
    try {
      await clinicalApi.deleteService(serviceId);
      toast.success('Service deleted successfully');
      if (editingService?.id === serviceId) resetForm();
      fetchServices();
    } catch (error) {
      console.error('Error deleting service:', error);
      toast.error('Failed to delete service');
    } finally {
      setDeletingId(null);
    }
  };

  const handleApplyPriceAdjustment = async () => {
    if (applyingPriceAdj) return;
    const scopeLabel = priceAdjForm.category ? `services in category "${priceAdjForm.category}"` : 'ALL active services';

    let payload: any = { category: priceAdjForm.category || undefined, mode: priceAdjForm.mode };
    let confirmMsg: string;

    if (priceAdjForm.mode === 'rate') {
      const rate = parseFloat(priceAdjForm.newRate);
      if (isNaN(rate) || rate <= 0) { toast.error('Enter a valid exchange rate greater than 0'); return; }
      payload.new_rate = rate;
      confirmMsg = `Rebase the price of ${scopeLabel} from the current rate (1 USD = ${currentExchangeRate ?? '?'} SSP) to 1 USD = ${rate} SSP? This applies immediately and cannot be undone automatically.`;
    } else {
      const pct = parseFloat(priceAdjForm.percentage);
      if (isNaN(pct) || pct <= 0) { toast.error('Enter a valid percentage greater than 0'); return; }
      payload.percentage = pct;
      payload.direction = priceAdjForm.direction;
      confirmMsg = `${priceAdjForm.direction === 'increase' ? 'Increase' : 'Decrease'} the price of ${scopeLabel} by ${pct}%? This applies immediately and cannot be undone automatically.`;
    }

    if (!(await confirm({ description: confirmMsg }))) return;

    setApplyingPriceAdj(true);
    try {
      const result = await clinicalApi.bulkPriceAdjustment(payload);
      toast.success(
        priceAdjForm.mode === 'rate'
          ? `Price rebased to 1 USD = ${result.newRate} SSP on ${result.affected_count} service(s)`
          : `Price ${priceAdjForm.direction}d by ${result.percentage}% on ${result.affected_count} service(s)`
      );
      setShowPriceAdjustment(false);
      setPriceAdjForm({ mode: 'percentage', percentage: '', direction: 'increase', newRate: '', category: '' });
      fetchServices();
      fetchCurrentExchangeRate();
    } catch (error: any) {
      toast.error(error.message || 'Failed to apply price adjustment');
    } finally {
      setApplyingPriceAdj(false);
    }
  };

  // Filter services based on search query
  const filteredServices = services.filter(service => {
    const matchesSearch = searchQuery === '' ||
      service.service_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      service.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (service.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  // Export services to CSV
  const exportToCSV = () => {
    const headers = ['Service Name', 'Category', 'Description', 'Price'];
    const csvData = [
      headers,
      ...filteredServices.map(service => [
        service.service_name,
        service.category,
        service.description || '',
        `${baseCurrency.symbol}${parseFloat(service.price.toString()).toFixed(2)}`
      ])
    ];

    const csvContent = csvData.map(row =>
      row.map(field => `"${field}"`).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `services_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success(`Exported ${filteredServices.length} services to CSV`);
  };

  // Download CSV template
  const downloadTemplate = () => {
    const headers = ['Service Name', 'Category', 'Department', 'Price'];
    const sampleData = [
      ['General Consultation', 'Consultation', 'General Medicine', '50.00'],
      ['Blood Test - CBC', 'Diagnostic', 'Laboratory', '25.00'],
      ['X-Ray Chest', 'Diagnostic', 'Radiology', '80.00']
    ];

    const csvData = [headers, ...sampleData];
    const csvContent = csvData.map(row =>
      row.map(field => `"${field}"`).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'services_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success('Template downloaded successfully');
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setCsvFile(file);
    } else {
      toast.error('Please select a valid CSV file');
      event.target.value = '';
    }
  };

  // RFC 4180-aware CSV line parser — handles quoted fields, including
  // commas and escaped "" quotes inside a field (naive split(',') would
  // corrupt any row whose Service Name/Department contains a comma).
  const parseCsvLine = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else { inQuotes = false; }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    fields.push(cur);
    return fields.map(f => f.trim());
  };

  // Parse and import CSV
  const importFromCSV = async () => {
    if (importing) return;
    if (!csvFile || !user?.clinic) return;

    setImporting(true);
    try {
      const text = await csvFile.text();
      const lines = text.split('\n').filter(line => line.trim());

      if (lines.length < 2) {
        toast.error('CSV file must contain at least a header row and one data row');
        return;
      }

      // Skip header row
      const dataLines = lines.slice(1);
      const importedServices = [];
      const errors = [];

      for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i].trim();

        // Skip empty lines
        if (!line) {
          continue;
        }

        const matches = parseCsvLine(line);

        // Skip rows with insufficient columns
        if (!matches || matches.length < 4) {
          errors.push(`Row ${i + 2}: Missing required columns (skipped)`);
          continue;
        }

        const serviceName = matches[0].trim();
        const category = matches[1].trim();
        const department = matches[2].trim();
        const priceStr = matches[3].trim();

        // Parse price - remove commas and convert to number
        const price = priceStr ? parseFloat(priceStr.replace(/,/g, '')) : 0;

        // Skip rows with missing or invalid data
        if (!serviceName || !category || isNaN(price) || price < 0) {
          errors.push(`Row ${i + 2}: Invalid data (skipped)`);
          continue;
        }

        // Use flexible category matching
        const normalizedCategory = normalizeCategory(category);

        importedServices.push({
          service_name: serviceName,
          category: normalizedCategory || category,
          description: department || '',
          price,
          is_active: true
        });
      }

      // Only fail if no valid services were found
      if (importedServices.length === 0) {
        toast.error(`Import failed - no valid services found. Check console for details.`);
        console.error('Import errors:', errors);
        return;
      }

      // Show warnings if there were errors but continue with valid data
      if (errors.length > 0) {
        console.warn(`Import completed with ${errors.length} rows skipped:`, errors);
      }

      // Import services one by one
      let successCount = 0;
      const failedNames: string[] = [];
      for (const serviceData of importedServices) {
        try {
          await clinicalApi.createService(serviceData);
          successCount++;
        } catch (error) {
          console.error('Error importing service:', serviceData.service_name, error);
          failedNames.push(serviceData.service_name);
        }
      }

      const skippedTotal = errors.length + failedNames.length;
      if (skippedTotal > 0) {
        toast.success(`Successfully imported ${successCount} services (${skippedTotal} row(s) skipped — see console for details)`);
      } else {
        toast.success(`Successfully imported ${successCount} services`);
      }
      setImportDialogOpen(false);
      setCsvFile(null);
      fetchServices();
    } catch (error) {
      console.error('Error importing CSV:', error);
      toast.error('Failed to import CSV file');
    } finally {
      setImporting(false);
    }
  };

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<Settings />}
          title="Services Management"
        />
        {loading && <LoadingState message="Loading services..." />}

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">
          {/* Left: inline form */}
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden lg:sticky lg:top-4">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Wrench className="w-4 h-4 text-primary" />
                {editingService ? 'Edit Service' : 'Add New Service'}
              </h3>
              {editingService && (
                <Button variant="ghost" size="sm" onClick={resetForm} className="h-7 text-xs">
                  <X className="w-3.5 h-3.5 mr-1" /> Cancel edit
                </Button>
              )}
            </div>
            <form onSubmit={handleSubmit}>
              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="serviceName">Service Name *</Label>
                  <Input
                    id="serviceName"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder="e.g., General Consultation"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category *</Label>
                  <Combobox
                    options={serviceCategories.map((cat) => ({ value: cat, label: cat }))}
                    value={category}
                    onChange={setCategory}
                    placeholder="Select category"
                    searchPlaceholder="Search categories..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="department">Department (Optional)</Label>
                  <div className="flex gap-2">
                    {selectedDepartment ? (
                      <>
                        <Combobox
                          options={departments.map((dept) => ({ value: dept.id, label: `${dept.department_name} (${dept.department_code})` }))}
                          value={selectedDepartment}
                          onChange={setSelectedDepartment}
                          placeholder="Select department"
                          searchPlaceholder="Search departments..."
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedDepartment('')}
                          className="px-3"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <Combobox
                        options={departments.map((dept) => ({ value: dept.id, label: `${dept.department_name} (${dept.department_code})` }))}
                        value={selectedDepartment}
                        onChange={(val) => setSelectedDepartment(val)}
                        placeholder="Select department"
                        searchPlaceholder="Search departments..."
                        className="flex-1"
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    type="text"
                    placeholder="Service description (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="price">Price *</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div className="px-4 py-3 border-t bg-muted/30 flex justify-end gap-2">
                {editingService && (
                  <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {saving ? (editingService ? 'Updating...' : 'Creating...') : (editingService ? 'Update Service' : 'Create Service')}
                </Button>
              </div>
            </form>
          </div>

          {/* Right: search, actions, and list */}
          <div className="space-y-4 min-w-0">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search services by name, category, or department..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-9"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={handleSeedLabServices}
                  disabled={seedingLab}
                  className="h-9"
                >
                  {seedingLab ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
                  Seed
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSeedRadiologyServices}
                  disabled={seedingRadiology}
                  className="h-9"
                >
                  {seedingRadiology ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Scan className="w-4 h-4 mr-2" />}
                  Seed Radiology
                </Button>
                <Button
                  variant="outline"
                  onClick={exportToCSV}
                  disabled={filteredServices.length === 0}
                  className="h-9"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
                <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="h-9">
                      <Upload className="w-4 h-4 mr-2" />
                      Import CSV
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Upload className="w-5 h-5" />
                        Import Services from CSV
                      </DialogTitle>
                      <DialogDescription className="sr-only">Form to import services from a CSV file</DialogDescription>
                    </DialogHeader>
                    <div className="px-5 py-4 space-y-4">
                      <div className="text-sm text-muted-foreground">
                        <p className="mb-3">Upload a CSV file to import multiple services at once.</p>
                        <div className="bg-muted/50 p-3 rounded-lg">
                          <p className="font-medium mb-2">CSV Format Requirements:</p>
                          <ul className="text-xs space-y-1 list-disc list-inside">
                            <li>Header row: Service Name, Category, Department, Price</li>
                            <li>Category must be one of: {serviceCategories.join(', ')}</li>
                            <li>Department must be one of: {departments.slice(0, 3).join(', ')}, etc.</li>
                            <li>Price must be a valid number (e.g., 50.00)</li>
                          </ul>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={downloadTemplate}
                          className="flex-1"
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          Download Template
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="csvFile">Upload CSV File</Label>
                        <Input
                          id="csvFile"
                          type="file"
                          accept=".csv"
                          onChange={handleFileUpload}
                          className="cursor-pointer"
                        />
                        {csvFile && (
                          <p className="text-xs text-muted-foreground">
                            Selected: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)
                          </p>
                        )}
                      </div>

                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setImportDialogOpen(false);
                          setCsvFile(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={importFromCSV}
                        disabled={!csvFile || importing}
                      >
                        {importing ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-2" />
                            Import Services
                          </>
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button variant="outline" className="h-9" onClick={() => setShowPriceAdjustment(true)}>
                  <Percent className="w-4 h-4 mr-2" />
                  Price Adjustment
                </Button>
              </div>
            </div>

            {/* Services Table */}
            <AdvancedDataTable<Service>
              data={filteredServices}
              keyExtractor={(service) => service.id}
              loading={loading}
              emptyMessage={
                searchQuery
                  ? 'Try adjusting your search terms or clear the search to see all services.'
                  : 'Get started by adding your first service using the form on the left.'
              }
              rowClassName={(service) => (editingService?.id === service.id ? 'bg-primary/5' : '')}
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'service_name', header: 'Service Name', sortable: true, render: (v) => <span className="font-semibold text-foreground">{v}</span> },
                { key: 'category', header: 'Category', sortable: true, render: (v) => <span className="text-muted-foreground">{v}</span> },
                {
                  key: 'department_id', header: 'Department',
                  render: (v) => <span className="text-muted-foreground">{v ? departments.find(d => d.id === v)?.department_name || '-' : '-'}</span>,
                },
                { key: 'description', header: 'Description', render: (v) => <span className="text-muted-foreground">{v || 'No description'}</span> },
                {
                  key: 'price', header: 'Price', align: 'right', sortable: true,
                  render: (v) => <span className="font-mono font-semibold text-primary">{baseCurrency.symbol}{parseFloat(v.toString()).toFixed(2)}</span>,
                },
                {
                  key: '__actions', header: 'Actions', align: 'right',
                  render: (_v, service) => (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(service)} disabled={deletingId === service.id} className="h-7 w-7">
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(service.id)}
                        disabled={deletingId === service.id}
                        className="h-7 w-7 text-destructive hover:text-destructive"
                      >
                        {deletingId === service.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>
      </div>

      {/* Bulk Price Adjustment Modal */}
      <Dialog open={showPriceAdjustment} onOpenChange={setShowPriceAdjustment}>
        <DialogContent className="p-0 max-w-md flex flex-col">
          <div className="flex justify-between items-center p-4 pr-12 border-b bg-muted/30">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Percent className="w-5 h-5 text-primary" /> Bulk Price Adjustment
            </h3>
          </div>
          <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                Raise or lower the price on every matching service in one step, instead of editing services one at a time.
              </p>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Adjust by</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPriceAdjForm({ ...priceAdjForm, mode: 'percentage' })}
                    className={cn("h-9 rounded-md border text-sm font-medium transition-colors", priceAdjForm.mode === 'percentage' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50")}
                  >
                    Percentage
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriceAdjForm({ ...priceAdjForm, mode: 'rate' })}
                    className={cn("h-9 rounded-md border text-sm font-medium transition-colors", priceAdjForm.mode === 'rate' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50")}
                  >
                    Exchange Rate
                  </button>
                </div>
              </div>

              {priceAdjForm.mode === 'percentage' ? (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Direction</label>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPriceAdjForm({ ...priceAdjForm, direction: 'increase' })}
                        className={cn("h-9 rounded-md border text-sm font-medium transition-colors", priceAdjForm.direction === 'increase' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50")}
                      >
                        Increase
                      </button>
                      <button
                        type="button"
                        onClick={() => setPriceAdjForm({ ...priceAdjForm, direction: 'decrease' })}
                        className={cn("h-9 rounded-md border text-sm font-medium transition-colors", priceAdjForm.direction === 'decrease' ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-input hover:bg-muted/50")}
                      >
                        Decrease
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Percentage</label>
                    <div className="relative mt-1">
                      <Input
                        type="number" min="0.01" step="0.01" placeholder="e.g. 10"
                        value={priceAdjForm.percentage}
                        onChange={e => setPriceAdjForm({ ...priceAdjForm, percentage: e.target.value })}
                        className="pr-8"
                      />
                      <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">New Exchange Rate (SSP per 1 USD)</label>
                  <Input
                    type="number" min="0.01" step="0.01" placeholder="e.g. 6000"
                    value={priceAdjForm.newRate}
                    onChange={e => setPriceAdjForm({ ...priceAdjForm, newRate: e.target.value })}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {currentExchangeRate != null
                      ? `Current system rate: 1 USD = ${currentExchangeRate.toLocaleString()} SSP. Every matching service's price is rescaled to reflect the new rate you enter here.`
                      : 'No active USD → SSP rate is configured yet — set one on the Exchange Rates page first.'}
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground">Category (optional — leave blank for all)</label>
                <Combobox
                  options={[{ value: '', label: 'All categories' }, ...serviceCategories.map(c => ({ value: c, label: c }))]}
                  value={priceAdjForm.category}
                  onChange={v => setPriceAdjForm({ ...priceAdjForm, category: v })}
                  placeholder="All categories"
                  searchPlaceholder="Search categories..."
                  className="w-full h-9 mt-1"
                />
              </div>

              {priceAdjForm.mode === 'percentage' && priceAdjForm.percentage && !isNaN(parseFloat(priceAdjForm.percentage)) && (
                <div className="p-2.5 rounded-lg border border-warning-border bg-warning-bg text-xs text-warning">
                  Example: a service priced at 100.00 becomes{' '}
                  <strong>
                    {priceAdjForm.direction === 'increase'
                      ? (100 * (1 + parseFloat(priceAdjForm.percentage) / 100)).toFixed(2)
                      : (100 * (1 - parseFloat(priceAdjForm.percentage) / 100)).toFixed(2)}
                  </strong>.
                  This applies immediately to {priceAdjForm.category ? `all "${priceAdjForm.category}" services` : 'ALL active services'} and cannot be undone automatically.
                </div>
              )}

              {priceAdjForm.mode === 'rate' && priceAdjForm.newRate && !isNaN(parseFloat(priceAdjForm.newRate)) && currentExchangeRate != null && (
                <div className="p-2.5 rounded-lg border border-warning-border bg-warning-bg text-xs text-warning">
                  Example: a service priced at 100.00 becomes{' '}
                  <strong>{(100 * (parseFloat(priceAdjForm.newRate) / currentExchangeRate)).toFixed(2)}</strong>.
                  This applies immediately to {priceAdjForm.category ? `all "${priceAdjForm.category}" services` : 'ALL active services'} and cannot be undone automatically.
                </div>
              )}
            </div>
          <div className="p-4 border-t bg-muted/30 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowPriceAdjustment(false)} disabled={applyingPriceAdj}>Cancel</Button>
            <Button
              onClick={handleApplyPriceAdjustment}
              disabled={applyingPriceAdj || (priceAdjForm.mode === 'percentage' ? !priceAdjForm.percentage : !priceAdjForm.newRate)}
            >
              {applyingPriceAdj ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Percent className="w-4 h-4 mr-2" />}
              {applyingPriceAdj ? 'Applying...' : 'Apply Adjustment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Services;
