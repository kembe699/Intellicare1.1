# Complete Component Library Guide

## Overview

This is your **single source of truth** for all reusable UI components. Every component in this library is production-ready, fully typed with TypeScript, and designed to work seamlessly together.

---

## Quick Start

```tsx
import {
  // Tables
  AdvancedDataTable,
  
  // Cards
  DataCard,
  ListCard,
  FormCard,
  MetricCard,
  StatCard,
  
  // Forms
  FormField,
  SearchInput,
  DateRangePicker,
  
  // Actions
  ActionButton,
  QuickActions,
  
  // Layout
  PageHeader,
  PageContainer,
  SectionHeader,
  
  // States
  LoadingState,
  EmptyState,
  ErrorBoundary,
} from '@/components/common';
```

---

## 📊 Tables

### AdvancedDataTable

**The ultimate table component** with pagination, search, filters, export, and bulk actions.

```tsx
import { AdvancedDataTable } from '@/components/common';
import { Download, Trash } from 'lucide-react';

const columns = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'email', header: 'Email', sortable: true },
  { key: 'status', header: 'Status', render: (value) => <Badge>{value}</Badge> },
];

<AdvancedDataTable
  data={patients}
  columns={columns}
  
  // Pagination
  pagination={{
    enabled: true,
    pageSize: 20,
    pageSizeOptions: [10, 20, 50, 100]
  }}
  
  // Search
  searchable
  searchPlaceholder="Search patients..."
  
  // Selection & Bulk Actions
  selectable
  onSelectionChange={setSelected}
  bulkActions={[
    { label: 'Delete', icon: Trash, onClick: handleBulkDelete, variant: 'destructive' },
    { label: 'Export', icon: Download, onClick: handleBulkExport }
  ]}
  
  // Export
  exportable
  exportFileName="patients-report"
  
  // Row Actions
  onRowClick={(patient) => navigate(`/patients/${patient.id}`)}
  
  // Styling
  stickyHeader
  compact
/>
```

**Features:**
- ✅ Sorting (click column headers)
- ✅ Pagination with page size selector
- ✅ Global search with debounce
- ✅ Row selection (single/multiple)
- ✅ Bulk actions toolbar
- ✅ Export to CSV
- ✅ Column visibility toggle
- ✅ Sticky headers
- ✅ Loading & empty states
- ✅ Responsive design

---

## 🎴 Cards

### 1. DataCard

Display key-value pairs in a clean card layout.

```tsx
<DataCard
  title="Patient Information"
  data={[
    { label: 'Full Name', value: 'John Doe' },
    { label: 'Age', value: '45 years' },
    { label: 'Gender', value: 'Male' },
    { label: 'Phone', value: '+1234567890' },
  ]}
  columns={2}
  collapsible
  actions={
    <Button size="sm" variant="outline">Edit</Button>
  }
/>
```

### 2. ListCard

Display a list of items with custom rendering.

```tsx
<ListCard
  title="Recent Activities"
  items={activities}
  renderItem={(activity) => (
    <div className="flex items-center justify-between">
      <span>{activity.description}</span>
      <span className="text-sm text-muted-foreground">{activity.time}</span>
    </div>
  )}
  onItemClick={(activity) => viewDetails(activity)}
  maxHeight="400px"
  actions={<Button size="sm">View All</Button>}
/>
```

### 3. FormCard

Wrapper for forms with built-in submit/cancel buttons.

```tsx
<FormCard
  title="Add New Patient"
  description="Enter patient details below"
  onSubmit={handleSubmit}
  onCancel={() => navigate('/patients')}
  submitLabel="Save Patient"
  loading={saving}
>
  <FormField label="Full Name" required>
    <Input value={name} onChange={(e) => setName(e.target.value)} />
  </FormField>
  <FormField label="Email">
    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
  </FormField>
</FormCard>
```

### 4. MetricCard

Display large metrics with trends and comparisons.

```tsx
<MetricCard
  title="Total Revenue"
  value="$125,430"
  change={15.3}
  period="vs last month"
  icon={DollarSign}
  trend={[100, 120, 115, 125, 130]}
  onClick={() => navigate('/reports/revenue')}
/>
```

### 5. StatCard

Quick metric display with icon and optional trend.

```tsx
<StatCard
  title="Total Patients"
  value={1234}
  icon={Users}
  trend={{ value: 12, isPositive: true }}
  onClick={() => navigate('/patients')}
  iconColor="text-primary"
  iconBgColor="bg-primary/10"
/>
```

---

## 📝 Forms

### FormField

Wrapper for form inputs with label, error, and help text.

```tsx
<FormField
  label="Email Address"
  htmlFor="email"
  required
  error={errors.email}
  helpText="We'll never share your email"
>
  <Input
    id="email"
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
  />
</FormField>
```

### SearchInput

Debounced search input with loading state.

```tsx
<SearchInput
  value={searchQuery}
  onChange={setSearchQuery}
  onSearch={handleSearch}
  placeholder="Search patients..."
  loading={searching}
  debounceMs={300}
/>
```

### DateRangePicker

Select date ranges for filtering.

```tsx
<DateRangePicker
  value={{ from: startDate, to: endDate }}
  onChange={(range) => {
    setStartDate(range.from);
    setEndDate(range.to);
  }}
  placeholder="Select date range"
/>
```

---

## ⚡ Actions

### ActionButton

Standardized action button with icon.

```tsx
<ActionButton
  label="Export Data"
  icon={Download}
  onClick={handleExport}
  variant="outline"
  loading={exporting}
/>
```

### QuickActions

Grid of quick action cards.

```tsx
<QuickActions
  columns={4}
  actions={[
    { label: 'New Patient', icon: UserPlus, onClick: () => setShowModal(true) },
    { label: 'Clinical Visit', icon: Stethoscope, href: '/clinical' },
    { label: 'Lab Queue', icon: FlaskConical, href: '/laboratory' },
    { label: 'Dispense Drugs', icon: Pill, href: '/pharmacy' },
  ]}
/>
```

---

## 📐 Layout

### PageHeader

Consistent page headers with breadcrumbs and actions.

```tsx
<PageHeader
  title="Patient Management"
  subtitle="View and manage all patients"
  breadcrumbs={[
    { label: 'Home', href: '/' },
    { label: 'Patients' }
  ]}
  actions={
    <>
      <Button variant="outline">Export</Button>
      <Button>Add Patient</Button>
    </>
  }
/>
```

### PageContainer

Standard page wrapper with max-width.

```tsx
<PageContainer maxWidth="2xl">
  <YourPageContent />
</PageContainer>
```

### SectionHeader

Section title with actions.

```tsx
<SectionHeader
  title="Recent Visits"
  description="Last 30 days"
  actions={<Button size="sm">View All</Button>}
/>
```

---

## 🔄 States

### LoadingState

```tsx
{isLoading && <LoadingState message="Loading patients..." size="md" />}
```

### EmptyState

```tsx
<EmptyState
  icon={Users}
  title="No patients found"
  message="Get started by adding your first patient"
  action={{
    label: 'Add Patient',
    onClick: () => setShowModal(true)
  }}
/>
```

### ErrorBoundary

```tsx
<ErrorBoundary onError={logError}>
  <YourComponent />
</ErrorBoundary>
```

---

## 🎯 Complete Page Example

```tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHeader,
  AdvancedDataTable,
  MetricCard,
  LoadingState,
  EmptyState,
  QuickActions,
  SectionHeader,
} from '@/components/common';
import { Users, Activity, DollarSign, UserPlus, Download, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function PatientsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [stats, setStats] = useState({});

  const columns = [
    { key: 'patient_id', header: 'ID', sortable: true },
    { key: 'full_name', header: 'Name', sortable: true },
    { key: 'age', header: 'Age', sortable: true },
    { key: 'phone_number', header: 'Phone' },
    {
      key: 'status',
      header: 'Status',
      render: (value) => (
        <Badge variant={value === 'active' ? 'success' : 'default'}>
          {value}
        </Badge>
      ),
    },
  ];

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <LoadingState message="Loading patients..." />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Patient Management"
        subtitle="View and manage all patients"
        actions={
          <Button onClick={() => navigate('/patients/new')}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Patient
          </Button>
        }
      />

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <MetricCard
          title="Total Patients"
          value={stats.total}
          icon={Users}
          change={12}
        />
        <MetricCard
          title="Active Today"
          value={stats.active}
          icon={Activity}
          change={5}
        />
        <MetricCard
          title="Revenue"
          value={`$${stats.revenue}`}
          icon={DollarSign}
          change={-3}
        />
      </div>

      {/* Quick Actions */}
      <SectionHeader title="Quick Actions" />
      <QuickActions
        columns={4}
        actions={[
          { label: 'Register Patient', icon: UserPlus, onClick: () => {} },
          { label: 'Clinical Visit', icon: Activity, href: '/clinical' },
        ]}
        className="mb-6"
      />

      {/* Patients Table */}
      <SectionHeader
        title="All Patients"
        description={`${patients.length} total patients`}
      />
      <AdvancedDataTable
        data={patients}
        columns={columns}
        pagination={{ enabled: true, pageSize: 20 }}
        searchable
        searchPlaceholder="Search patients..."
        selectable
        bulkActions={[
          { label: 'Delete', icon: Trash, onClick: () => {}, variant: 'destructive' },
          { label: 'Export', icon: Download, onClick: () => {} },
        ]}
        exportable
        exportFileName="patients"
        onRowClick={(patient) => navigate(`/patients/${patient.id}`)}
        stickyHeader
      />
    </AppLayout>
  );
}

export default PatientsPage;
```

---

## 🎨 Styling Guidelines

### Use Design Tokens

```tsx
// ✅ Good
<div className="p-4 gap-6 mb-8">

// ❌ Bad
<div className="p-[18px] gap-[22px] mb-[34px]">
```

### Semantic Colors

```tsx
// ✅ Good
<Badge variant="success">Active</Badge>
<Badge variant="destructive">Error</Badge>

// ❌ Bad
<span className="text-green-600">Active</span>
<span className="text-red-500">Error</span>
```

### Responsive Design

```tsx
// ✅ Good
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

// ❌ Bad
<div className="grid grid-cols-4 gap-4">
```

---

## 📦 Component Inventory

**Total Components: 20**

### Tables (1)
- AdvancedDataTable

### Cards (5)
- StatCard
- DataCard
- ListCard
- FormCard
- MetricCard

### Forms (3)
- FormField
- SearchInput
- DateRangePicker

### Actions (2)
- ActionButton
- QuickActions

### Layout (3)
- PageHeader
- PageContainer
- SectionHeader

### States (3)
- LoadingState
- EmptyState
- ErrorBoundary

### Supporting (3)
- TablePagination
- TableSearch
- BulkActionsBar

---

## 🚀 Migration Checklist

When refactoring a page:

- [ ] Replace custom header with `PageHeader`
- [ ] Replace custom tables with `AdvancedDataTable`
- [ ] Replace custom cards with appropriate card component
- [ ] Replace custom forms with `FormCard` + `FormField`
- [ ] Add `LoadingState` for loading UX
- [ ] Add `EmptyState` for empty data
- [ ] Wrap in `ErrorBoundary`
- [ ] Use `QuickActions` for action grids
- [ ] Apply design tokens for spacing
- [ ] Remove custom CSS classes

---

## 💡 Tips

1. **Always import from barrel export:**
   ```tsx
   import { AdvancedDataTable, MetricCard } from '@/components/common';
   ```

2. **Combine components for powerful UIs:**
   ```tsx
   <FormCard>
     <FormField>
       <SearchInput />
     </FormField>
   </FormCard>
   ```

3. **Use TypeScript autocomplete** - all components are fully typed

4. **Check EXAMPLES.md** for more usage patterns

5. **Contribute back** - if you create a useful pattern, add it to the library!
