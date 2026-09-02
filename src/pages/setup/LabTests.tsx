import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingState } from '@/components/common';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { authFetch } from '@/api/apiClient';
import { Plus, Trash2, Edit, TestTube, X, Database, Search, Download, Upload, FileText, Check, ChevronsUpDown, GripVertical, Cpu, Settings, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { LabTest, LabTestComponent } from '@/types';

const testCategories = [
  'Hematology',
  'Chemistry',
  'Microbiology',
  'Urinalysis',
  'Serology',
  'Parasitology',
  'Other'
];

const LabTests: React.FC = () => {
  const { user } = useAuth();
  const { currency: baseCurrency } = useCurrency();
  const [tests, setTests] = useState<LabTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTest, setEditingTest] = useState<LabTest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selection state
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Bulk upload state
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
  const [bulkUploadFile, setBulkUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  
  // Form state
  const [testName, setTestName] = useState('');
  const [testCode, setTestCode] = useState('');
  const [category, setCategory] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [price, setPrice] = useState('');
  const [services, setServices] = useState<any[]>([]);
  const [serviceComboOpen, setServiceComboOpen] = useState(false);
  const [machineIntegration, setMachineIntegration] = useState<string>('none');
  const dragIndex = React.useRef<number | null>(null);

  const [components, setComponents] = useState<LabTestComponent[]>([
    { name: '', unit: '', normalRangeMin: undefined, normalRangeMax: undefined, normalRangeText: '' }
  ]);

  useEffect(() => {
    if (user?.clinic) {
      const loadData = async () => {
        await fetchServices();
        await fetchTests();
      };
      loadData();
    }
  }, [user]);

  const fetchServices = async () => {
    console.log('LabTests fetchServices called, user:', user);
    
    try {
      // Use default clinic if user clinic not available
      const clinicId = user?.clinic || '1';
      console.log('Fetching services for clinic:', clinicId);
      
      const response = await authFetch(`/api/clinical/services/${clinicId}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch services');
      }
      
      const servicesData = await response.json();
      setServices(servicesData || []);
      console.log('Successfully loaded', (servicesData || []).length, 'services');
    } catch (error) {
      console.error('Error fetching services:', error);
      setServices([]); // Set empty array on error
    }
  };

  const fetchTests = async () => {
    console.log('LabTests fetchTests called, user:', user);
    
    try {
      setLoading(true);
      
      // Use default clinic if user clinic not available
      const clinicId = user?.clinic || '1';
      console.log('Fetching lab tests for clinic:', clinicId);
      
      const response = await authFetch(`/api/lab-tests?clinic=${encodeURIComponent(clinicId)}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API response error:', errorText);
        throw new Error(`Failed to fetch lab tests: ${response.status}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const responseText = await response.text();
        console.error('Non-JSON response received:', responseText);
        throw new Error('Server returned non-JSON response');
      }
      
      const testsData = await response.json();
      
      // Transform the raw database results to match our LabTest interface
      const transformedTests = Array.isArray(testsData) ? testsData.map(test => ({
        id: test.id,
        testName: test.test_name || test.testName,
        testCode: test.test_code || test.testCode,
        category: test.category,
        price: test.price,
        service_id: test.service_id,
        machine_integration: test.machine_integration || null,
        components: test.components || [],
        clinic: test.clinic_id || test.clinic,
        createdBy: test.created_by || test.createdBy,
        createdAt: test.createdAt,
        updatedAt: test.updatedAt
      })) : [];
      
      setTests(transformedTests);
      console.log('Successfully loaded', transformedTests.length, 'lab tests');
      console.log('Sample test with service_id:', transformedTests[0]?.service_id, typeof transformedTests[0]?.service_id);
      console.log('Available services at test load time:', services.length, services.map(s => ({ id: s.id, type: typeof s.id, name: s.service_name })));
    } catch (error) {
      console.error('Error fetching tests:', error);
      setTests([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setTestName('');
    setTestCode('');
    setCategory('');
    setSelectedService('');
    setPrice('');
    setMachineIntegration('none');
    setComponents([{ name: '', unit: '', normalRangeMin: undefined, normalRangeMax: undefined, normalRangeText: '' }]);
    setEditingTest(null);
  };

  const openEditDialog = (test: LabTest) => {
    setEditingTest(test);
    setTestName(test.testName);
    setTestCode(test.testCode);
    setCategory(test.category);
    setSelectedService(test.service_id?.toString() || '');
    setPrice(test.price?.toString() || '');
    setMachineIntegration(test.machine_integration || 'none');
    
    // Transform database components to frontend format, parsing reference_range into min/max
    const transformedComponents = test.components.length > 0 
      ? test.components.map(comp => {
          const refRange = comp.reference_range || comp.normalRangeText || '';
          // Try to parse "number-number" format (e.g. "12.0-16.0")
          const numericRangeMatch = refRange.match(/^([\d.]+)-([\d.]+)$/);
          if (numericRangeMatch) {
            return {
              name: comp.component_name || comp.name || '',
              unit: comp.unit || '',
              normalRangeMin: parseFloat(numericRangeMatch[1]),
              normalRangeMax: parseFloat(numericRangeMatch[2]),
              normalRangeText: ''
            };
          }
          return {
            name: comp.component_name || comp.name || '',
            unit: comp.unit || '',
            normalRangeMin: undefined,
            normalRangeMax: undefined,
            normalRangeText: refRange
          };
        })
      : [{ name: '', unit: '', normalRangeMin: undefined, normalRangeMax: undefined, normalRangeText: '' }];
    
    setComponents(transformedComponents);
    setDialogOpen(true);
  };

  const handleServiceChange = (serviceId: string) => {
    setSelectedService(serviceId);
    const selectedServiceData = services.find(service => service.id.toString() === serviceId);
    if (selectedServiceData) {
      setPrice(selectedServiceData.price.toString());
    }
    setServiceComboOpen(false);
  };

  const addComponent = () => {
    setComponents([...components, { name: '', unit: '', normalRangeMin: undefined, normalRangeMax: undefined, normalRangeText: '' }]);
  };

  const removeComponent = (index: number) => {
    if (components.length > 1) {
      setComponents(components.filter((_, i) => i !== index));
    }
  };

  const updateComponent = (index: number, field: keyof LabTestComponent, value: string | number | undefined) => {
    const updated = [...components];
    updated[index] = { ...updated[index], [field]: value };
    setComponents(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (saving) return;

    if (!testName || !testCode || !category) {
      toast.error('Please fill in all required fields');
      return;
    }

    const validComponents = components.filter(c => c.name && c.name.trim() !== '');
    console.log('Valid components before transformation:', JSON.stringify(validComponents, null, 2));

    if (validComponents.length === 0) {
      toast.error('Please add at least one component');
      return;
    }

    setSaving(true);
    try {
      // Transform data to match server expectations (snake_case)
      const testData = {
        test_name: testName,
        test_code: testCode.toUpperCase(),
        category,
        clinic_id: user?.clinic,
        price: parseFloat(price) || 0,
        service_id: selectedService || null,
        machine_integration: machineIntegration === 'none' ? null : (machineIntegration || null),
        ...(editingTest ? {} : { created_by: user?.displayName })
      };

      const url = editingTest ? `/api/lab-tests/${editingTest.id}/with-components` : '/api/lab-tests/with-components';
      const method = editingTest ? 'PUT' : 'POST';

      // Transform components to match backend expectations
      const transformedComponents = validComponents.map((comp, index) => ({
        component_name: comp.name || '',
        unit: comp.unit || '',
        reference_range: comp.normalRangeText || 
          (comp.normalRangeMin !== undefined && comp.normalRangeMax !== undefined 
            ? `${comp.normalRangeMin}-${comp.normalRangeMax}` 
            : ''),
        display_order: index
      })).filter(comp => comp.component_name.trim() !== ''); // Filter out empty component names
      
      console.log('Transformed components for API:', JSON.stringify(transformedComponents, null, 2));

      const requestBody = editingTest ? {
        test: {
          test_name: testName,
          test_code: testCode.toUpperCase(),
          category,
          price: parseFloat(price) || 0,
          service_id: selectedService || null,
          machine_integration: machineIntegration === 'none' ? null : (machineIntegration || null)
        },
        components: transformedComponents
      } : {
        test: testData,
        components: transformedComponents
      };

      console.log('Request body:', JSON.stringify(requestBody, null, 2));
      console.log('Service ID being sent:', selectedService);
      console.log('Price being sent:', price);

      const response = await authFetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Save error response:', errorText);
        let errorMessage = 'Failed to save lab test';
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || errorMessage;
        } catch (parseError) {
          // Use default error message if response isn't JSON
        }
        throw new Error(errorMessage);
      }

      toast.success(editingTest ? 'Lab test updated successfully' : 'Lab test added successfully');
      resetForm();
      setDialogOpen(false);
      fetchTests();
    } catch (error) {
      console.error('Error saving test:', error);
      toast.error(`Failed to save lab test: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

const handleBulkDelete = async () => {
  if (isDeleting) return;
  if (selectedTests.size === 0) {
    toast.error('Please select at least one test to delete');
    return;
  }

  if (!confirm(`Are you sure you want to delete ${selectedTests.size} selected test(s)?`)) {
    return;
  }

  setIsDeleting(true);
  let successCount = 0;
  let errorCount = 0;

  for (const testId of Array.from(selectedTests)) {
    try {
      const response = await authFetch(`/api/lab-tests/${testId}/with-components`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        successCount++;
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error(`Error deleting test ${testId}:`, error);
      errorCount++;
    }
  }

  setIsDeleting(false);
  setSelectedTests(new Set());

  if (successCount > 0) {
    toast.success(`Successfully deleted ${successCount} test(s)`);
    fetchTests();
  }
  if (errorCount > 0) {
    toast.error(`Failed to delete ${errorCount} test(s)`);
  }
};

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    if (!confirm('Are you sure you want to delete this lab test?')) {
      return;
    }

    setDeletingId(id);
    try {
      const response = await authFetch(`/api/lab-tests/${id}/with-components`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Delete error response:', errorText);
        let errorMessage = 'Failed to delete lab test';
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || errorMessage;
        } catch (parseError) {
          // Use default error message if response isn't JSON
        }
        throw new Error(errorMessage);
      }

      toast.success('Lab test deleted successfully');
      fetchTests();
    } catch (error) {
      console.error('Error deleting test:', error);
      toast.error(`Failed to delete lab test: ${error.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // Filter tests based on search query
  const filteredTests = tests.filter(test => {
    const matchesSearch = searchQuery === '' || 
      test.testName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      test.testCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      test.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  // Export tests to CSV — flat per-component rows matching the import template
  const exportToCSV = () => {
    const headers = ['test_code', 'test_name', 'category', 'price', 'service_name', 'component_name', 'unit', 'reference_range', 'display_order'];
    const rows: string[][] = [headers];

    filteredTests.forEach(test => {
      const code    = test.testCode || '';
      const name    = test.testName || '';
      const cat     = test.category || '';
      const price   = test.price != null ? String(test.price) : '';
      const svcName = test.service_id
        ? (services.find(s => String(s.id) === String(test.service_id))?.service_name || '')
        : '';
      const comps   = test.components || [];

      if (comps.length === 0) {
        rows.push([code, name, cat, price, svcName, '', '', '', '']);
      } else {
        comps.forEach((c, idx) => {
          const compName = c.component_name || c.name || '';
          const unit     = c.unit || '';
          const ref      = c.reference_range
            || (c.normalRangeText ? c.normalRangeText
              : (c.normalRangeMin != null || c.normalRangeMax != null)
                ? `${c.normalRangeMin ?? ''}-${c.normalRangeMax ?? ''}`
                : '');
          rows.push([code, name, cat, price, svcName, compName, unit, ref, String(idx + 1)]);
        });
      }
    });

    const csvContent = rows.map(row =>
      row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `lab_tests_${new Date().toISOString().split('T')[0]}.csv`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    const totalRows = rows.length - 1;
    toast.success(`Exported ${filteredTests.length} tests (${totalRows} rows) to CSV`);
  };

  // Download bulk upload template
  const downloadTemplate = () => {
    const headers = [
      'test_code',
      'test_name',
      'category',
      'price',
      'service_name',
      'component_name',
      'unit',
      'reference_range',
      'display_order'
    ];
    
    const sampleData = [
      // CBC - Complete Blood Count (20 components)
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'Hemoglobin', 'g/dL', '12.0-16.0', '1'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'Hematocrit', '%', '36-46', '2'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'RBC Count', '10^12/L', '4.0-5.5', '3'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'MCV', 'fL', '80-100', '4'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'MCH', 'pg', '27-32', '5'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'MCHC', 'g/dL', '32-36', '6'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'RDW', '%', '11.5-14.5', '7'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'WBC Count', '10^9/L', '4.0-11.0', '8'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'Neutrophils', '%', '40-70', '9'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'Lymphocytes', '%', '20-40', '10'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'Monocytes', '%', '2-8', '11'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'Eosinophils', '%', '1-4', '12'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'Basophils', '%', '0-1', '13'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'Platelet Count', '10^9/L', '150-400', '14'],
      ['CBC', 'Complete Blood Count', 'Hematology', '50', 'Complete Blood Count', 'MPV', 'fL', '7.5-11.5', '15'],
      
      // RFT - Renal Function Test (6 components)
      ['RFT', 'Renal Function Test', 'Chemistry', '60', 'Renal Function Test', 'Urea', 'mg/dL', '15-40', '1'],
      ['RFT', 'Renal Function Test', 'Chemistry', '60', 'Renal Function Test', 'Creatinine', 'mg/dL', '0.6-1.2', '2'],
      ['RFT', 'Renal Function Test', 'Chemistry', '60', 'Renal Function Test', 'Sodium', 'mmol/L', '135-145', '3'],
      ['RFT', 'Renal Function Test', 'Chemistry', '60', 'Renal Function Test', 'Potassium', 'mmol/L', '3.5-5.0', '4'],
      ['RFT', 'Renal Function Test', 'Chemistry', '60', 'Renal Function Test', 'Chloride', 'mmol/L', '98-107', '5'],
      ['RFT', 'Renal Function Test', 'Chemistry', '60', 'Renal Function Test', 'Bicarbonate', 'mmol/L', '22-29', '6'],
      
      // LFT - Liver Function Test (8 components)
      ['LFT', 'Liver Function Test', 'Chemistry', '55', 'Liver Function Test', 'Total Bilirubin', 'mg/dL', '0.3-1.2', '1'],
      ['LFT', 'Liver Function Test', 'Chemistry', '55', 'Liver Function Test', 'Direct Bilirubin', 'mg/dL', '0.0-0.3', '2'],
      ['LFT', 'Liver Function Test', 'Chemistry', '55', 'Liver Function Test', 'ALT', 'U/L', '7-56', '3'],
      ['LFT', 'Liver Function Test', 'Chemistry', '55', 'Liver Function Test', 'AST', 'U/L', '10-40', '4'],
      ['LFT', 'Liver Function Test', 'Chemistry', '55', 'Liver Function Test', 'ALP', 'U/L', '44-147', '5'],
      ['LFT', 'Liver Function Test', 'Chemistry', '55', 'Liver Function Test', 'Total Protein', 'g/dL', '6.0-8.3', '6'],
      ['LFT', 'Liver Function Test', 'Chemistry', '55', 'Liver Function Test', 'Albumin', 'g/dL', '3.5-5.5', '7'],
      ['LFT', 'Liver Function Test', 'Chemistry', '55', 'Liver Function Test', 'Globulin', 'g/dL', '2.0-3.5', '8'],
      
      // FBS - Fasting Blood Sugar (1 component)
      ['FBS', 'Fasting Blood Sugar', 'Chemistry', '30', 'Fasting Blood Sugar', 'Glucose', 'mg/dL', '70-100', '1'],
      
      // URINE - Urinalysis (10 components)
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'Color', '', 'Yellow', '1'],
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'Appearance', '', 'Clear', '2'],
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'pH', '', '5.0-8.0', '3'],
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'Specific Gravity', '', '1.005-1.030', '4'],
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'Protein', '', 'Negative', '5'],
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'Glucose', '', 'Negative', '6'],
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'Ketones', '', 'Negative', '7'],
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'Blood', '', 'Negative', '8'],
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'Leukocytes', '', 'Negative', '9'],
      ['URINE', 'Urinalysis', 'Urinalysis', '25', 'Urinalysis', 'Nitrites', '', 'Negative', '10']
    ];

    const csvContent = [headers, ...sampleData]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'lab_tests_bulk_upload_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success('Template downloaded successfully');
  };

  // Handle file selection for bulk upload
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.csv')) {
        toast.error('Please select a CSV file');
        return;
      }
      setBulkUploadFile(file);
    }
  };

  // Seed the curated common lab-test catalog — each test comes with its own
  // component and gets linked to a matching Service (created if none exists).
  const handleSeedCommonTests = async () => {
    try {
      setSeeding(true);
      const response = await authFetch('/api/lab-tests/seed-common', {
        method: 'POST',
        body: JSON.stringify({ clinic_id: user?.clinic || '1' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to seed lab tests');
      toast.success(result.message);
      await fetchTests();
    } catch (error: any) {
      toast.error(error.message || 'Failed to seed lab tests');
    } finally {
      setSeeding(false);
    }
  };

  // Handle bulk upload
  const handleBulkUpload = async () => {
    if (uploading) return;
    if (!bulkUploadFile) {
      toast.error('Please select a file first');
      return;
    }

    setUploading(true);
    try {
      const text = await bulkUploadFile.text();
      
      const response = await authFetch('/api/lab-tests/bulk-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvData: text,
          clinic_id: user?.clinic || '1'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const result = await response.json();
      toast.success(`Successfully uploaded ${result.created || 0} lab tests with ${result.componentsCreated || 0} components`);
      
      setShowBulkUploadModal(false);
      setBulkUploadFile(null);
      fetchTests();
    } catch (error: any) {
      console.error('Bulk upload error:', error);
      toast.error(error.message || 'Failed to upload lab tests');
    } finally {
      setUploading(false);
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 w-full flex flex-col">
        <PageHeader
          icon={<Settings />}
          title="Lab Tests Management"
        />

        {/* Search Bar and Actions */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search tests by name, code, or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleSeedCommonTests}
              disabled={seeding}
              className="h-9"
            >
              {seeding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
              Seed
            </Button>
            <Button
              variant="outline"
              onClick={exportToCSV}
              disabled={filteredTests.length === 0}
              className="h-9"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowBulkUploadModal(true)}
              className="h-9"
            >
              <Upload className="w-4 h-4 mr-2" />
              Bulk Upload
            </Button>
            {selectedTests.size > 0 && (
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={isDeleting}
                className="h-9"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                {isDeleting ? 'Deleting...' : `Delete Selected (${selectedTests.size})`}
              </Button>
            )}
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button className="h-9">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Lab Test
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingTest ? 'Edit Lab Test' : 'Add New Lab Test'}</DialogTitle>
                <DialogDescription>
                  {editingTest ? 'Update the lab test details and components below.' : 'Create a new lab test by filling in the details and adding components.'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit}>
                <div className="px-5 py-4 space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="testName">Test Name *</Label>
                    <Input
                      id="testName"
                      value={testName}
                      onChange={(e) => setTestName(e.target.value)}
                      placeholder="e.g., Complete Blood Count"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="testCode">Test Code *</Label>
                    <Input
                      id="testCode"
                      value={testCode}
                      onChange={(e) => setTestCode(e.target.value.toUpperCase())}
                      placeholder="e.g., CBC"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category *</Label>
                    <Combobox
                      options={testCategories.map((cat) => ({ value: cat, label: cat }))}
                      value={category}
                      onChange={setCategory}
                      placeholder="Select category"
                      searchPlaceholder="Search categories..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="service">Service</Label>
                    <Popover open={serviceComboOpen} onOpenChange={setServiceComboOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={serviceComboOpen}
                          className="w-full justify-between"
                        >
                          {selectedService
                            ? services.find((service) => service.id.toString() === selectedService)?.service_name
                            : "Select service (optional)..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] max-w-none p-0">
                        <Command>
                          <CommandInput placeholder="Search services..." />
                          <CommandEmpty>No service found.</CommandEmpty>
                          <CommandGroup className="max-h-64 overflow-auto">
                            {services.map((service) => (
                              <CommandItem
                                key={service.id}
                                value={service.service_name}
                                onSelect={() => handleServiceChange(service.id.toString())}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedService === service.id.toString() ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {service.service_name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="price">Price</Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Machine Integration */}
                <div className="space-y-2">
                  <Label htmlFor="machineIntegration" className="flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-primary" />
                    Machine Integration
                  </Label>
                  <Combobox
                    options={[
                      { value: 'none', label: 'None — Manual Entry' },
                      { value: 'mindray', label: '🔬 Mindray BC-10 / BC-30' },
                    ]}
                    value={machineIntegration}
                    onChange={setMachineIntegration}
                    placeholder="No machine integration (manual entry)"
                    searchPlaceholder="Search..."
                    className="w-full"
                  />
                  {machineIntegration === 'mindray' && (
                    <p className="text-xs text-primary bg-primary/10 border border-primary/30 rounded-md px-3 py-2 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
                      The <strong>Fetch from Mindray</strong> panel will automatically appear in the Lab module when this test is selected.
                    </p>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">Test Components / Parameters</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addComponent}>
                      <Plus className="w-4 h-4 mr-1" />
                      Add Component
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {components.map((component, index) => (
                      <Card
                        key={index}
                        className="p-4 cursor-grab active:cursor-grabbing"
                        draggable
                        onDragStart={() => { dragIndex.current = index; }}
                        onDragOver={(e) => { e.preventDefault(); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = dragIndex.current;
                          if (from === null || from === index) return;
                          const reordered = [...components];
                          const [moved] = reordered.splice(from, 1);
                          reordered.splice(index, 0, moved);
                          setComponents(reordered);
                          dragIndex.current = null;
                        }}
                        style={{ opacity: dragIndex.current === index ? 0.5 : 1 }}
                      >
                        <div className="grid grid-cols-6 gap-3 items-end">
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">Component Name *</Label>
                            <div className="flex items-center gap-1">
                            <GripVertical className="w-4 h-4 text-muted-foreground shrink-0 cursor-grab" />
                            <Input
                              value={component.name}
                              onChange={(e) => updateComponent(index, 'name', e.target.value)}
                              placeholder="e.g., Hemoglobin"
                            />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Unit</Label>
                            <Input
                              value={component.unit}
                              onChange={(e) => updateComponent(index, 'unit', e.target.value)}
                              placeholder="e.g., g/dL"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Min Range</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={component.normalRangeMin?.toString() ?? ''}
                              onChange={(e) => updateComponent(index, 'normalRangeMin', e.target.value ? parseFloat(e.target.value) : undefined)}
                              placeholder="Min"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Max Range</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={component.normalRangeMax?.toString() ?? ''}
                              onChange={(e) => updateComponent(index, 'normalRangeMax', e.target.value ? parseFloat(e.target.value) : undefined)}
                              placeholder="Max"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 space-y-1">
                              <Label className="text-xs">Or Text Range</Label>
                              <Input
                                value={component.normalRangeText ?? ''}
                                onChange={(e) => updateComponent(index, 'normalRangeText', e.target.value)}
                                placeholder="e.g., Negative"
                              />
                            </div>
                            {components.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => removeComponent(index)}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => {
                    setDialogOpen(false);
                    resetForm();
                  }} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {saving ? (editingTest ? 'Updating...' : 'Saving...') : (editingTest ? 'Update Test' : 'Save Test')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Lab Tests Table */}
        <AdvancedDataTable<LabTest>
          data={filteredTests}
          keyExtractor={(test) => test.id}
          loading={loading}
          emptyMessage={
            searchQuery
              ? 'Try adjusting your search terms or clear the search to see all tests.'
              : 'Get started by adding your first lab test.'
          }
          selectable
          onSelectionChange={(selected) => setSelectedTests(new Set(selected.map(t => t.id)))}
          pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
          columns={[
            { key: 'testCode', header: 'Test Code', sortable: true, render: (v) => <span className="font-mono font-semibold text-primary">{v}</span> },
            { key: 'testName', header: 'Test Name', sortable: true, render: (v) => <span className="font-semibold text-foreground">{v}</span> },
            { key: 'category', header: 'Category', sortable: true, render: (v) => <span className="text-muted-foreground">{v}</span> },
            {
              key: 'service_id', header: 'Service',
              render: (v) => {
                if (!v) return <span className="text-muted-foreground">-</span>;
                const service = services.find(s => s.id.toString() === v.toString());
                return <span className="text-muted-foreground">{service?.service_name || 'Unknown Service'}</span>;
              },
            },
            {
              key: 'machine_integration', header: 'Machine',
              render: (v) => v === 'mindray' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                  <Cpu className="w-3 h-3" /> Mindray
                </span>
              ) : <span className="text-muted-foreground">-</span>,
            },
            {
              key: 'price', header: 'Price', sortable: true,
              render: (v) => <span className="text-muted-foreground">{v != null ? `${baseCurrency.symbol}${parseFloat(v.toString()).toFixed(2)}` : '-'}</span>,
            },
            {
              key: 'components', header: 'Components',
              render: (v: LabTestComponent[]) => (
                <div className="text-muted-foreground">
                  {v.length} component{v.length !== 1 ? 's' : ''}
                  {v.length > 0 && <div className="text-xs mt-1 max-w-xs truncate">{v.map(c => c.name).join(', ')}</div>}
                </div>
              ),
            },
            {
              key: '__actions', header: 'Actions', align: 'right',
              render: (_v, test) => (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEditDialog(test)} disabled={deletingId === test.id} className="h-7 w-7">
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(test.id)}
                    disabled={deletingId === test.id}
                    className="h-7 w-7 text-destructive hover:text-destructive"
                  >
                    {deletingId === test.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              ),
            },
          ]}
        />

        {/* Bulk Upload Dialog */}
        <Dialog open={showBulkUploadModal} onOpenChange={setShowBulkUploadModal}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bulk Upload Lab Tests</DialogTitle>
              <DialogDescription>
                Upload multiple lab tests with their components using a CSV file
              </DialogDescription>
            </DialogHeader>
            <div className="px-5 py-4 space-y-4">
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  CSV Format Instructions
                </h4>
                <p className="text-sm text-muted-foreground">
                  Your CSV file should have the following columns:
                </p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li><strong>test_code</strong>: Unique code for the test (e.g., CBC, FBS)</li>
                  <li><strong>test_name</strong>: Full name of the test</li>
                  <li><strong>category</strong>: Test category (Hematology, Chemistry, etc.)</li>
                  <li><strong>price</strong>: Test price</li>
                  <li><strong>component_name</strong>: Name of the test component</li>
                  <li><strong>unit</strong>: Unit of measurement (optional)</li>
                  <li><strong>reference_range</strong>: Normal range (e.g., "12.0-16.0" or "Yellow")</li>
                  <li><strong>display_order</strong>: Order to display component (1, 2, 3...)</li>
                </ul>
                <p className="text-sm text-muted-foreground mt-2">
                  <strong>Note:</strong> Each row represents one component. Tests with multiple components should have multiple rows with the same test_code.
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={downloadTemplate}
                  className="flex-1"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Template
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bulk-upload-file">Select CSV File</Label>
                <Input
                  id="bulk-upload-file"
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  disabled={uploading}
                />
                {bulkUploadFile && (
                  <p className="text-sm text-muted-foreground">
                    Selected: {bulkUploadFile.name}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowBulkUploadModal(false);
                  setBulkUploadFile(null);
                }}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleBulkUpload}
                disabled={!bulkUploadFile || uploading}
              >
                {uploading ? (
                  <>
                    <Upload className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload
                  </>
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

export default LabTests;
