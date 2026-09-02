# Component Usage Examples

This file provides practical examples of how to use the standardized components in the design system.

## StatCard

### Basic Usage
```tsx
import { StatCard } from '@/components/common';
import { Users } from 'lucide-react';

<StatCard
  title="Total Patients"
  value={1234}
  icon={Users}
/>
```

### With Trend Indicator
```tsx
<StatCard
  title="Today's Revenue"
  value="$12,500"
  icon={DollarSign}
  trend={{ value: 15, isPositive: true }}
  iconColor="text-success"
  iconBgColor="bg-success/10"
/>
```

### Clickable Card
```tsx
<StatCard
  title="Pending Lab Tests"
  value={45}
  icon={FlaskConical}
  onClick={() => navigate('/laboratory')}
  iconColor="text-warning"
  iconBgColor="bg-warning/10"
/>
```

### Grid Layout
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  <StatCard title="Patients" value={120} icon={Users} />
  <StatCard title="Visits" value={45} icon={Activity} />
  <StatCard title="Revenue" value="$12,500" icon={DollarSign} />
  <StatCard title="Alerts" value={3} icon={AlertTriangle} />
</div>
```

## PageHeader

### Simple Header
```tsx
import { PageHeader } from '@/components/common';

<PageHeader
  title="Dashboard"
  subtitle="Welcome back, John Doe"
/>
```

### With Breadcrumbs
```tsx
<PageHeader
  title="Patient Details"
  subtitle="John Doe - #P12345"
  breadcrumbs={[
    { label: 'Home', href: '/' },
    { label: 'Patients', href: '/patients' },
    { label: 'John Doe' }
  ]}
/>
```

### With Actions
```tsx
<PageHeader
  title="Inventory"
  subtitle="Manage your stock"
  actions={
    <>
      <Button variant="outline">
        <Download className="h-4 w-4 mr-2" />
        Export
      </Button>
      <Button>
        <Plus className="h-4 w-4 mr-2" />
        Add Item
      </Button>
    </>
  }
/>
```

## DataTable

### Basic Table
```tsx
import { DataTable } from '@/components/common';

const columns = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'email', header: 'Email' },
  { key: 'status', header: 'Status' },
];

<DataTable
  data={patients}
  columns={columns}
  loading={isLoading}
/>
```

### With Custom Rendering
```tsx
const columns = [
  {
    key: 'name',
    header: 'Patient Name',
    sortable: true,
    render: (value, row) => (
      <div className="flex items-center gap-2">
        <Avatar>{value[0]}</Avatar>
        <span className="font-medium">{value}</span>
      </div>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (value) => (
      <Badge variant={value === 'active' ? 'success' : 'default'}>
        {value}
      </Badge>
    ),
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    render: (_, row) => (
      <Button variant="ghost" size="sm">
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    ),
  },
];
```

### With Row Click Handler
```tsx
<DataTable
  data={patients}
  columns={columns}
  onRowClick={(patient) => navigate(`/patients/${patient.id}`)}
  emptyMessage="No patients found"
/>
```

### With Custom Row Styling
```tsx
<DataTable
  data={appointments}
  columns={columns}
  rowClassName={(row) => 
    row.status === 'cancelled' ? 'opacity-50' : ''
  }
/>
```

## LoadingState

### Default Loading
```tsx
import { LoadingState } from '@/components/common';

{isLoading && <LoadingState />}
```

### With Custom Message
```tsx
<LoadingState message="Loading patient records..." />
```

### Different Sizes
```tsx
<LoadingState size="sm" message="Saving..." />
<LoadingState size="md" message="Loading..." />
<LoadingState size="lg" message="Processing..." />
```

### Conditional Rendering
```tsx
function MyComponent() {
  if (loading) return <LoadingState message="Loading data..." />;
  if (error) return <ErrorState />;
  return <DataDisplay />;
}
```

## EmptyState

### Basic Empty State
```tsx
import { EmptyState } from '@/components/common';
import { Users } from 'lucide-react';

<EmptyState
  icon={Users}
  message="No patients found"
/>
```

### With Title and Action
```tsx
<EmptyState
  icon={FileText}
  title="No records found"
  message="Get started by creating your first patient record"
  action={{
    label: 'Add Patient',
    onClick: () => setShowModal(true)
  }}
/>
```

### Search Results Empty
```tsx
<EmptyState
  icon={Search}
  title="No results"
  message={`No results found for "${searchQuery}"`}
  action={{
    label: 'Clear Search',
    onClick: () => setSearchQuery('')
  }}
/>
```

## ErrorBoundary

### Wrap Page Content
```tsx
import { ErrorBoundary } from '@/components/common';

function MyPage() {
  return (
    <ErrorBoundary>
      <PageContent />
    </ErrorBoundary>
  );
}
```

### With Custom Fallback
```tsx
<ErrorBoundary
  fallback={
    <div className="p-8 text-center">
      <h2>Oops! Something went wrong</h2>
      <Button onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  }
>
  <RiskyComponent />
</ErrorBoundary>
```

### With Error Logging
```tsx
<ErrorBoundary
  onError={(error, errorInfo) => {
    console.error('Error caught:', error);
    // Send to error tracking service
    logErrorToService(error, errorInfo);
  }}
>
  <App />
</ErrorBoundary>
```

## Complete Page Example

### Dashboard Page with All Components
```tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  PageHeader,
  StatCard,
  DataTable,
  LoadingState,
  EmptyState,
  ErrorBoundary,
} from '@/components/common';
import { Users, Activity, DollarSign, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [recentVisits, setRecentVisits] = useState([]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const columns = [
    { key: 'patientName', header: 'Patient', sortable: true },
    { key: 'visitDate', header: 'Date', sortable: true },
    { key: 'doctor', header: 'Doctor' },
    {
      key: 'status',
      header: 'Status',
      render: (value) => (
        <Badge variant={value === 'completed' ? 'success' : 'warning'}>
          {value}
        </Badge>
      ),
    },
  ];

  if (loading) {
    return (
      <AppLayout>
        <LoadingState message="Loading dashboard..." />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ErrorBoundary>
        <PageHeader
          title="Dashboard"
          subtitle="Overview of your clinic"
          actions={
            <Button onClick={() => navigate('/patients/new')}>
              New Patient
            </Button>
          }
        />

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="Total Patients"
            value={stats.totalPatients}
            icon={Users}
            onClick={() => navigate('/patients')}
          />
          <StatCard
            title="Today's Visits"
            value={stats.todayVisits}
            icon={Activity}
            trend={{ value: 12, isPositive: true }}
          />
          <StatCard
            title="Revenue"
            value={`$${stats.revenue}`}
            icon={DollarSign}
            iconColor="text-success"
            iconBgColor="bg-success/10"
          />
          <StatCard
            title="Alerts"
            value={stats.alerts}
            icon={AlertTriangle}
            iconColor="text-warning"
            iconBgColor="bg-warning/10"
          />
        </div>

        {/* Recent Visits Table */}
        <div className="bg-card rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Visits</h2>
          {recentVisits.length > 0 ? (
            <DataTable
              data={recentVisits}
              columns={columns}
              onRowClick={(visit) => navigate(`/visits/${visit.id}`)}
            />
          ) : (
            <EmptyState
              icon={Activity}
              message="No recent visits"
              action={{
                label: 'Create Visit',
                onClick: () => navigate('/clinical')
              }}
            />
          )}
        </div>
      </ErrorBoundary>
    </AppLayout>
  );
}

export default Dashboard;
```

## Best Practices

### 1. Always Use Loading States
```tsx
// ✅ Good
if (loading) return <LoadingState />;
if (error) return <ErrorState />;
return <Content />;

// ❌ Bad
return loading ? <div>Loading...</div> : <Content />;
```

### 2. Consistent Empty States
```tsx
// ✅ Good
{data.length === 0 && (
  <EmptyState
    icon={Icon}
    message="No data available"
    action={{ label: 'Add New', onClick: handleAdd }}
  />
)}

// ❌ Bad
{data.length === 0 && <p>No data</p>}
```

### 3. Error Boundaries for Sections
```tsx
// ✅ Good - Isolate errors to sections
<ErrorBoundary>
  <CriticalSection />
</ErrorBoundary>
<ErrorBoundary>
  <AnotherSection />
</ErrorBoundary>

// ❌ Bad - One error breaks entire page
<ErrorBoundary>
  <CriticalSection />
  <AnotherSection />
</ErrorBoundary>
```

### 4. Responsive Grids
```tsx
// ✅ Good - Mobile-first responsive
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

// ❌ Bad - Fixed columns
<div className="grid grid-cols-4 gap-4">
```

### 5. Semantic Actions
```tsx
// ✅ Good - Clear action purpose
<PageHeader
  title="Patients"
  actions={
    <Button onClick={handleAddPatient}>
      <Plus className="h-4 w-4 mr-2" />
      Add Patient
    </Button>
  }
/>

// ❌ Bad - Generic action
<PageHeader
  title="Patients"
  actions={<Button>Add</Button>}
/>
```
